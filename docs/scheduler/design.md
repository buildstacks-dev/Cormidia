# Dispatch and scheduler

*Canonical contract for the dispatch tick and the org-scoped host scheduler:
trigger grammar, event polling and routing, locking and concurrency, manual
invocation, the scheduler definition and identity schema, durable evidence,
state retention, reason codes, and health semantics. The scheduler is an
org-scoped host trigger for the ordinary stateless `operon dispatch` boundary.
It is not a daemon, workflow engine, provider runtime, or replacement for turn
journals, locks, approvals, budgets, continuation, or telemetry. The system
map is [`../architecture.md`](../architecture.md) §2.*

## Dispatch model

**Model: stateless tick, not a daemon.** `operon scheduler install` creates an
org-scoped launchd definition (`StartInterval: 300` by default) that invokes an
absolute Node/package entry with explicit org and state homes. A future systemd
user timer uses the same backend boundary, but Operon does not claim its health
on an unexercised platform. Each tick calls the ordinary `operon dispatch`,
reads config + durable state, computes what is due, starts detached turns, and
exits. There is no competing daemon or workflow engine. A wedged host resumes
on the next tick; cadence remains flexi and ticks run at all hours (decided
2026-07-04). Due work that needs a provider turn still enters only through the
EpisodePlanner boundary (`../architecture.md` §0, §8): the tick computes *what is due*; the accepted
EpisodePlan authorizes *what may run*.

Lifecycle mutations preview by default and require `--execute` plus exact org
or scheduler-id confirmation. Ownership metadata, the rendered-definition
hash, and a crash-resumable transaction prevent silent overwrite/removal of a
malformed, foreign, or wrong-org definition. `operon scheduler status` and
doctor join definition, loaded/active manager state, recent tick evidence,
duplicate/orphan checks, and provider-settlement agreement. Definition-file
existence is never sufficient for health.

The scheduler evidence model deliberately keeps four ids separate: OS cadence
invocation, app/role/trigger decision, spawned episode/turn, and ordinary
provider turn/settlement. A decision is durable before lock/journal/spawn
boundaries and reaches one typed terminal outcome. Stable hashes bind org,
window, app, role, trigger, and event rather than enumeration order or random
process state. `spawn_committed` precedes detached spawn, so retry after
post-spawn bookkeeping failure cannot start a second child. Missed host windows
still collapse to one firing with explicit missed/reconciled counts.

### Trigger resolution

For each app with `status: live`, for each role, merge `roles.yaml` triggers
with the app's cadence overrides (`../architecture.md` §7), then evaluate. An app that is not
`status: live` is a **named skip** in the tick result (app + actual status,
printed by `operon dispatch` as a `skip` line), never a silent no-op — its
pending inbox events stay unpolled, and the operator can see why:

**Schedule triggers.** Grammar (already in roles.yaml): `hourly`,
`every <N>h|m`, `daily HH:MM`, `weekly <dow> [HH:MM]` (default 09:00). Local
host time. A trigger is due when `now ≥ next(lastFired, spec)`;
`state/schedule.json` keys `(app, role, trigger)` → last-fired timestamp,
written only after the turn actually starts. Missed windows (laptop asleep)
collapse to **one** firing — no backfill.

**Event triggers.** v1 is **polling, not webhooks** — the laptop has no
public ingress. Each tick polls GitHub (via `gh`/REST) per live app:


| roles.yaml event  | Poll                                                               | Stable dedup key            |
| ----------------- | ------------------------------------------------------------------ | --------------------------- |
| `ticket-ready`    | issues labeled `op:ready`                                          | `ticket-ready:<issue>`      |
| `pr-opened`       | open `op/*` PRs lacking a fresh verdict (no review after head SHA) | `pr-opened:<pr>@<head-sha>` |
| `ci-failed`       | failed check runs on main / open op PRs                            | `ci-failed:<sha>:<check>`   |
| `release-shipped` | new release/tag since last seen                                    | `release:<tag>`             |
| `alert-webhook`   | file-drop inbox `state/events/inbox/*.json`                        | file name                   |


Consumed-event state is recorded in `state/events/` per (event, role): a
spawn writes a `<key>::role::<role>` mark, so one event fans out to every
subscribed role even when the WIP limit splits them across ticks, and a role
never refires on an event it already handled. The dispatcher's per-tick sweep
retires the bare key — what polling filters on — once every *current*
subscriber holds a mark, pruning the per-role marks in the same atomic write;
because retirement is evaluated fresh against roles.yaml each tick, a
subscriber removed mid-fan-out cannot strand an event live forever. A
channel-gated subscriber deliberately holds retirement open: the event stays
observably pending (a skip line per tick) until the app grows the channel and
the gated role runs. The file-drop inbox gives webhook parity later: a
droplet webhook receiver just writes JSON files into the same inbox — the
dispatcher does not change.

### Trigger routing

`roles.yaml` declares when a role wakes; `src/org/trigger-routing.ts` maps
the effective trigger (after app cadence overrides) to the protocol that
runs. Unknown mappings remain loud skips in dispatch, never undefined turns.

| Role trigger | Route |
| --- | --- |
| Planner `daily ...` | `groom` pipeline |
| Planner `weekly ...` | `plan` pipeline |
| Planner `support-feedback` / `adoption-signal` (file-drop) | `groom` pipeline |
| Builder `ticket-ready` | build-loop claim/build path |
| Reviewer `pr-opened` | review-loop path owned by the ticket state machine |
| SRE `hourly` | `sre-health` pipeline |
| SRE `ci-failed` / `alert-webhook` / `health-alert` | `sre-incident` pipeline |
| Support `support-feedback` | `support-digest` pipeline |
| Support scheduled trigger | `support-digest` pipeline |
| Marketing `release-shipped` | `marketing-release` pipeline |
| Marketing `launch-calendar` | `marketing-release` pipeline |
| Marketing `adoption-signal` | `ci-sweep` pipeline |
| Marketing weekly trigger | `ci-sweep` pipeline |

**Scope note — software lifecycle now, company lifecycle via the same
inbox.** The polled events above are deliberately all software-lifecycle:
GitHub is the only source a laptop can poll in v1 without new ingress or
credentials. Company-lifecycle events — support inbox items, billing/usage
thresholds, signup or churn spikes, launch-calendar dates, compliance
deadlines — enter through the file-drop inbox: any producer (a mail poller,
a payment-webhook relay on the droplet, a calendar script) writes an event
JSON into `state/events/inbox/`, and the dispatcher routes it through the
same roles.yaml trigger mechanism, unchanged. Enumerating these producers
per role (Support, Marketing, SRE) is operator configuration, not a dispatcher
change.

The v0 payload contract for file-drop company events is documented in
[`event-schemas.md`](event-schemas.md) and validated by `src/org/event-schemas.ts`.
For a `critical` or `down` health alert, the SRE pipeline persists its grounded
analysis and queues a typed GitHub issue action with `op:incident`, the source
event key, payload hash, and stable incident identity. A later dispatch performs
that action through the orchestrator-owned `GhOps` boundary, so SRE and Builder
do not depend on different provider-local network/tool behavior. Analysis
completion and filing acknowledgement remain separate facts.

### Locking & concurrency

- **One turn per (role, app).** Lock file `locks/<app>--<role>.lock` created
with `O_EXCL`, containing `{pid, turnId, startedAt, heartbeatAt}`. The turn
runner heartbeats it every 30 s. Acquisition is atomic on the `O_EXCL` create;
ordinary contention — including a holder releasing exactly as the tick reads it
— resolves to a holder snapshot or a retry, never an unhandled `ENOENT` that
aborts the tick.
- Tick finds a lock with heartbeat < 2 min old → turn still running → skip
(this is how overlapping firings don't collide). Heartbeat stale → crash
recovery (`../loop/turns.md`), which decides resume vs restart and re-owns the lock.
- **Org-level WIP limit:** live locks ≥ `org.max_concurrent_turns`
(apps.yaml, default 2) → remaining due turns stay due; next tick retries.
Priority when contending: blocked-turn re-dispatches, then events, then
schedules (oldest due first).
- **Turns outlive the tick.** `operon dispatch` spawns
`operon run-role … --turn <id>` as a detached process, so the 5-minute
timer never kills a long turn. `run-role` is thereby also the manual
entry point. `--turn` is the invocation/trace identity used by the journal and
run evidence; it is not a GitHub ticket number and never creates a ticket
binding. Ticket context, when present, comes from the already-durable dispatch
journal.

### Manual and standalone invocation (`run-role`)

- A fresh manual standalone invocation requires `--app`, `--turn`, and one
non-empty bounded `--template` in both dry-run and live forms. Both forms enter
the same read-only journal/route/durable-intent/template/assignment/scope
inspection first. The dry-run reports the template hash and summary,
provenance, objective, execution-ready creator scope, and atomic assignment,
then stops with zero provider turns and no workflow-state writes beyond the
command audit row. Live persists the
already-inspected manual journal before provider entry. Provider readiness,
budget/approval outcomes, managed-clone synchronization, and mutable external
state are explicit preview exclusions.
- A durable resume may reuse its accepted creator bytes without rereading a
mutable template. Scheduled/event dispatch journals already name a governed
pipeline or ticket protocol, so those routes may omit the standalone template
and reject CLI template/assignment overrides instead of ignoring them.
`--workdir` is unsupported: preview reads a discovered registered checkout;
live always synchronizes the org-managed clone, then an explicit standalone
creator scope executes in a durable per-turn worktree cut from that exact
resolved base. Provider egress is denied by default. A manual invocation may
admit it with
`--allow-network`; that boolean is shown by `--dry-run`, bound into the creator
scope, and copied to only that episode's `TurnRequest`s. Resume rejects a
different value instead of silently widening or narrowing the persisted
invocation.

## Lifecycle CLI

```bash
operon scheduler install [--backend launchd|systemd] [--cadence-minutes N] [--json]
operon scheduler install ... --execute --confirm <scheduler-id-or-exact-org-name>
operon scheduler status [--backend launchd|systemd] [--cadence-minutes N] [--json]
operon scheduler uninstall [--backend launchd|systemd] [--cadence-minutes N] [--json]
operon scheduler uninstall ... --execute --confirm <scheduler-id-or-exact-org-name>
```

Install and uninstall preview by default and write nothing. Execution requires
both `--execute` and exact confirmation. Repeated preview, execution, status,
repair, and uninstall converge idempotently. The commands resolve the package,
org home, and state home independently of cwd. `status` is read-only.

The installed definition invokes an absolute Node executable and absolute
package entry with explicit `--org-home` and `--state-home` arguments. It does
not rely on an active-org pointer, cwd, an interactive shell, inherited `PATH`,
or an environment dump. Definition metadata contains no credentials. The
identity is `dev.operon.dispatch.<org-slug>.<org-home-hash>`; the org id also
binds the exact org name and org-home path, so two orgs cannot collide.

launchd is the supported host backend on macOS. A systemd user-timer
representation exists behind the same small manager boundary, but Operon does
not claim installed or active health on an unexercised/unsupported platform.
Production host commands are isolated in `src/org/scheduler/manager.ts`; tests
inject a manager and temporary definition directory and never call the host
scheduler.

## Definition and lifecycle schema

The ownership metadata marker and `scheduler/installation.json` are
`schema_version: 1` and bind:

- `owner: operon`, scheduler id, org id, and org name;
- backend and cadence minutes;
- absolute executable and package-entry paths;
- absolute org and state homes;
- command hash, rendered-definition hash, definition path, and install time.

`scheduler/lifecycle-transaction.json` records install/uninstall progress
through `prepared`, `definition_written`, `manager_updated`, and `committed`.
Definitions and records are atomically replaced. A retry resumes by converging
the same definition and installation record. A foreign, malformed, unowned, or
wrong-org definition is never overwritten or removed; lifecycle returns a
typed refusal instead.

## Durable state and identities

Scheduler-owned state lives under the independently resolved state home:

```text
scheduler/
├── installation.json
├── lifecycle-transaction.json        # present only while a mutation is incomplete
├── logs/                              # host scheduler stdout/stderr target
└── evidence/
    ├── invocations/<tick-id>.json
    ├── decisions/<decision-id>.json
    └── alerts/<alert-id>.json
standing-roles/<app>/
├── artifacts/<artifact-id>.json
├── planner-feeds/<feed-id>.json
└── planner-feed-consumptions/<batch-id>.json
```

All scheduler evidence is `schema_version: 1`, canonical-key JSON, and sorted
on read, making projections deterministic and byte-stable. Initial identity
publication uses exclusive create semantics; later stage transitions use
atomic replacement. Corrupt/torn records fail closed and stay named in health
output.

Planner feeds use their own schema-v2 lifecycle. Identity binds app,
producing role, event source/kind/key, and payload hash, preventing cross-role
collisions. Groom selects only `pending` records under a fixed count/byte
budget; a content-bound receipt advances the selected batch to `consumed`
only after the Planner pipeline completes. New payload bytes for the same
source advance older pending records to `superseded`. Terminal records become
`expired` and are pruned after their retention window, while pending evidence
is never removed merely because it is old.

The four identity layers remain distinct:

1. Invocation: `SHA-256(org-id, cadence-window)` identifies the OS due window.
2. Decision: `SHA-256(org-id, cadence-window, app, role, trigger-kind,
   trigger, event-key)` identifies one route-admission decision.
3. Episode/turn: derived from the decision id and carried into the ordinary
   turn journal, run envelope, and trace.
4. Provider turn: the adapter's provider-turn id and its ordinary telemetry
   settlement; mechanical scheduling creates neither.

Enumeration order and process randomness are not identity inputs. Org, app,
role, trigger, cadence window, and event attribution prevent cross-scope
deduplication. A transient, non-executed decision may receive a deterministic
retry identity; an executed or spawn-committed decision is never spawned
again.

The decision stage sequence is `prepared` → `lock_acquired` → `journaled` →
`spawn_committed` → `spawned` → `terminal`. A retry at every boundary either
finishes the same record or resumes its existing child. In particular,
`spawn_committed` is durable before detached spawn, so a successful spawn
followed by bookkeeping failure cannot duplicate the child. Turn completion
joins the ordinary journal, run envelopes, and telemetry settlements into the
terminal receipt. Existing stale-lock recovery remains authoritative; fresh
locks block, while corrupt lock/journal/evidence state fails closed and remains
visible.

Missed host windows follow the ratified one-firing/no-backfill rule: a later
invocation records the number of missed windows and one reconciled firing. The
same record projects through Phase 4's `scheduler.missed_tick` trusted
efficiency-evidence class; it does not create a second learning model.

## State retention

The dispatch tick owns org-wide state-home retention (`src/org/retention.ts`;
review P1-14 / F-003): under an autonomous scheduler no operator is in the
loop, so no state subtree may grow forever waiting on a manual prune. Every
non-dry-run tick attempts `runScheduledRetentionSweep`; an O_EXCL marker claim
at `state/retention/sweeps/<utc-date>.json` makes the sweep exactly-once per
UTC day per state home (concurrent ticks race the claim safely; the marker is
overwritten with the completed sweep record). A sweep failure is reported in
the tick output but never fails the tick, and each subtree fails
independently — an error keeps that subtree's files for a later sweep. The
manual surface is `operon prune-runs --sweep` (same windows, immediate run);
`operon prune-runs` without `--sweep` remains the runs-only manual prune.

Default windows (days) and fail-safe prune rules:

| Subtree | Window | Deletes only when |
| --- | --- | --- |
| `runs/<app>/<runId>/` | 30 | the existing `pruneRuns` rule: envelope proves a terminal status and `finished_at` past the window; running/unprovable dirs are kept |
| `telemetry/<date>.jsonl` | 365 | the whole UTC day is past the window, the file is not in the current UTC month (monthly budget caps read it), every line parses, and **no row is still re-settleable** (below); deletions hold the settlement lock |
| `efficiency/episodes/<hash>/` | 180 | the route is terminal, no started provider receipt is pending, nothing is corrupt, every timestamp is past the window, and every provider step is already settled in the ledger |
| `invocations/<date>.jsonl` | 90 | the whole UTC day is past the window |
| `tasks/<taskId>/` | 180 | `task.json` proves a non-`running` status with `endedAt` past the window |
| `learning/events/<date>/` | 180 | the whole UTC day is past the window — the ONLY `learning/` child ever swept |
| `scheduler/evidence/**` | 365 | see the health-truthfulness rules below |
| `state/retention/sweeps/` | 90 | the sweep's own day records |
| `narrative/<app>/` | 1825 | the capture's own `captured_at` is past the window and its `story_id`/`app` map to the file it sits in; orphaned `.md` and quarantined `.json.corrupt` bytes age by mtime |
| `planning/<app>/refused-decompositions/` | 90 | the record's own `refused_at` is past the window and its `app`/`decomposition_id` map to the file it sits in; torn or foreign files are kept |

**Human decisions are never swept.** `lifecycle/` is outside the sweep
entirely — the app lifecycle record, the config-ratification journal, and the
ticket-budget ratifications
(`lifecycle/apps/<app>/ticket-budget-ratifications/`) persist for the life of
the state home. That is what makes the 90-day window on refused decompositions
safe: a refused decomposition is provider-derived evidence *awaiting* a
decision, and the ratification that accepts one embeds the accepted plan
verbatim, so ageing the refusal can never lose something a human decided.

**Ledger retention respects the reconciliation window.** `operon budget
--reconcile` can back-fill the ledger from surviving run envelopes and
efficiency provider steps, so deleting a ledger row while its source evidence
survives would let a later reconcile re-append that spend as a duplicate,
re-dated row. Two guards enforce this: the effective ledger window (and the
`learning/events/` window) is clamped to at least the largest evidence window
plus a 2-day reconcile margin, and — exactly, not by age arithmetic — a
day-file is kept while any of its rows' settlement identities still appear in
surviving evidence on disk. Symmetrically, an efficiency episode is kept until
its provider spend is provably in the ledger, so spend evidence is never
deleted from both sides at once.

**Scheduler evidence never falsifies health.** A decision record is deleted
only when terminal, past the window, with agreeing provider turn/settlement
counts (an executed decision with missing denominators is a health signal and
is kept), and only when its episode id is no longer referenced by any
surviving lock, turn journal, run envelope, or ledger row — the exact sources
of the orphan cross-check — so pruning can never mint orphaned locks,
journals, runs, or settlements. An invocation is deleted only when terminal,
past the window, and only after all of its decisions are gone; the newest
invocation and the newest completed invocation survive regardless of age, so
an idle org keeps its last-tick evidence for `status`/`doctor`. Non-terminal
invocations (crashed ticks) are never deleted. Alerts age out on the same
window. The scheduler-evidence window is clamped to the effective ledger
window plus the margin.

`learning/` is otherwise untouched: the durable archives (`episodes/`,
`capsules/`, `fingerprints/`, `resolved/`, `canary/`, `publish-journal/`,
`metrics/`) persist, and the committed org-home `learning/**` governance
substrate lives outside the state home entirely — the sweep only ever names
the state home's `learning/events` child, so it is structurally unable to
reach either.

## Outcomes and reason codes

Every due decision terminates as `executed`, `skipped`, `blocked`, `missed`,
`reconciled`, or `failed`, with exactly one reason code:

| Area | Canonical reason codes |
| --- | --- |
| Execution/admission | `executed`, `no_due_work`, `fresh_lock`, `wip_limit`, `budget_paused`, `approval_blocked`, `channel_gated`, `no_subscriber`, `empty_learning_window`, `missed_window_reconciled`, `spawn_failure`, `post_spawn_bookkeeping_failure`, `scheduler_definition_failure`, `scheduler_state_failure` |
| Definition/install | `unsupported_platform`, `unsupported_backend`, `not_installed`, `definition_valid`, `inactive`, `stale_definition`, `malformed_definition`, `wrong_org`, `wrong_state_home`, `wrong_executable`, `cadence_drift`, `ownership_mismatch`, `scheduler_state_missing`, `scheduler_state_corrupt` |
| Operational health | `healthy_recent_tick`, `overdue_tick`, `last_tick_failed`, `measurement_unavailable` |

Budget, approval, channel, and learning outcomes are ordinary Operon decisions:
per-app budget overlays remain isolated; approval parking and denial recurrence
remain in force; scheduled distillation/review uses the learning-budget overlay
and governed publisher; empty learning windows are mechanical and construct no
runtime. Local durable alerts are the only scheduler notification surface.

## Health semantics

`operon scheduler status --json` is the canonical read projection. Terminal
output renders the same facts. It reports definition/install/loaded/active
state and hashes; expected/observed paths and cadence; last due window,
invocation, completed tick, next tick, overdue and missed windows; outcome and
reason counts; app/role/trigger attribution; duplicate decisions/episodes;
orphaned locks, journals, runs, and settlements; scheduled learning outcomes;
provider-turn/settlement agreement; missing denominators; corrupt records; and
durable local alerts.

Healthy means all of the following are observed: supported backend, owned and
current definition, valid installation state, loaded/active manager state, a
recent completed tick, no overdue/failure/corruption/integrity blocker, and
valid provider denominators with settlement agreement. A file's existence is
never health. Missing denominators, config-only inspection, absent runtime
manager evidence, and corrupt state yield invalid/unavailable measurement—not
zero and not healthy.

`operon doctor` uses this projection without constructing a provider runtime.
Normal doctor performs the bounded host-manager inspection; `--config-only`
checks only definition/config facts and explicitly cannot claim execution
health. Repair is the explicit idempotent `scheduler install --execute` path;
status never mutates files.

## Release evidence boundary

The production-backed seven-day virtual soak is the deterministic release
gate. It uses fake clocks, temporary homes, an injected scheduler manager, and
FakeRuntime receipts to prove thousands of due decisions, restart/crash
boundaries, typed blockers, exact settlements, app isolation, and byte-stable
replay with zero outward effects. It does not prove provider standing-role
quality or the real-time L6 contract.

The 48–72 hour L6 soak remains a separately authorized immutable campaign with
an exact commit, repository, duration, restart/useful-turn limits, provider
assignments, cost cap, environment switch, and confirmation. Preview output is
not execution evidence. Under the ratified Phase 6 boundary, `I-LIVE-01` is the
sole `future_soak` contract: neither this preview, the virtual soak, nor
read-only production confirmation can promote it. Phase 6 may finish with that
future campaign pending, but the broader fully proven “highly efficient
organization” claim may not. See
[`docs/qualification/design.md`](../qualification/design.md#phase-6-qualification-scope).
