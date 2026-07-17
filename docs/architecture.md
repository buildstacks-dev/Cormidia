# Operon Architecture

*v1.5 — last aligned 2026-07-14. docs/PURPOSE.md → Decided is upstream and
authoritative; this document holds the implementation detail the decision
layer deliberately does not. §11 records decisions
ratified into docs/PURPOSE.md on 2026-07-06 and 2026-07-13; future new decisions should be
proposed here first, then promoted only after human ratification.*

## 0. Overview

For the human- and company-level view of the system, start with the
[conceptual overview](architecture/conceptual-overview.md). The diagram below
then zooms in on the runtime execution path.

```
launchd (now) / systemd timer (droplet later)
      │  fires every ~5 min
      ▼
operon dispatch  ── reads ──►  roles.yaml · apps.yaml · schedule state · events
      │
      │  for each due (role, app): acquire lock, start turn
      ▼
turn runner (src/org)
      │  assembles context (TASTE layers + memory) ── §5
      │  creates/reuses worktree ── §3
      ▼
runtime adapter (claude | codex | pi)          src/runtime
      │  every tool action → GateFn ── critical ops denied + escalated
      ▼
artifacts land on GitHub (issues, PRs, comments, merges)
escalations land in the CLI approval queue ── §4
telemetry / memory / scorecard events written at turn end ── §6
```

**How the dispatcher "decides":** there is no planning intelligence in the
tick — *deciding is computing what is due*. The model is fully asynchronous:
every ~5 minutes a stateless tick merges roles.yaml triggers with apps.yaml
overrides, checks schedule state ("is the Planner's `daily 07:00` unfired
today?"), polls GitHub for new events ("is there a fresh `op:ready`
ticket?"), starts a detached turn for each due (role, app), and exits.

A worked tick: the Builder has been running a long turn since yesterday —
its lock heartbeat is fresh, so the tick skips that (role, app) and the turn
simply continues (turns outlive ticks, §2). Meanwhile a newly due event
starts an unrelated turn in parallel, up to the org WIP limit.

Newer work never assumes older work finished, for two structural reasons:

1. **State derives from artifacts, not intentions** (§3): a ticket is
   reviewable only when its PR actually exists; a PR ships only when an
   APPROVE review and green gates actually exist. Unfinished work presents
   no artifact, so dependent steps simply are not due yet — nothing infers
   completion from elapsed time or from a task having been scheduled.
2. **Dependencies gate readiness** (`docs/loop.md` §8): a ticket with
   `Depends-on: #N` becomes due only when #N is *merged*; tickets whose
   declared file scopes overlap are never scheduled concurrently.

Module placement respects the one-way import rule
(`src/org` → `src/loop` → `src/runtime`):


| Component                                               | Module                                                         | Notes                                   |
| ------------------------------------------------------- | -------------------------------------------------------------- | --------------------------------------- |
| Dispatcher, schedule state, event polling, locks, trigger routing | `src/org/dispatch.ts`, `src/org/trigger-routing.ts`             | M8 route table maps roles.yaml triggers to protocols |
| App registry (`apps.yaml` loader)                       | `src/org/apps.ts`                                              | implemented (M7)                       |
| Authority charter + resolver                            | `src/org/authority.ts`                                         | versioned org grant, app-only narrowing |
| Context assembler                                       | `src/org/context.ts`                                           | authority + TASTE + memory              |
| Approval queue + grants                                 | `src/org/approvals.ts`                                         | implemented (M7)                       |
| OKF memory read/write                                   | `src/org/memory.ts`                                           | implemented M9                         |
| Scorecards                                              | `src/org/scorecards.ts`                                        | implemented M9                         |
| Retro reports + curation                                | `src/org/retro.ts`                                             | implemented M9                         |
| Ticket state machine                                    | `src/loop/loop.ts`                                             | implemented (M5/M6); full design in `docs/loop.md` |
| Pass executor, brief assembler, quality gates, verdicts | `src/loop/pipeline.ts`, `brief.ts`, `qgates.ts`, `verdicts.ts` | implemented (M5/M6) — `docs/loop.md`   |
| Pass prompt templates + pipeline config                 | `prompts/`, `pipelines.yaml` (org home)                        | human-ratified protocol surfaces        |
| Runtime contract, gate, telemetry, adapters             | `src/runtime/`                                                 | exists                                  |
| Run status + anomaly readers                            | `src/runtime/runlog/status.ts`, `anomalies.ts`                 | implemented M9; L1/L2 only             |
| Read-only Live UI observer                              | `src/observe/`, `src/cli/observe.ts`                           | presentation-only leaf; HTTP snapshot + SSE; no workflow writes |
| Governed learning loop (capture, recurrence, efficacy, activation, resolver) | `src/org/learning/`                                    | design in `docs/learning-loop/`; Phase 4 closure is token-free outside declared replay turns |
| A4 release handoff                                      | `src/org/release.ts`                                           | ship-gate P7; deploy queued as a critical op, then a later dispatch executes the approved command once and comments the ticket |
| Package/org/state boundary                              | `src/org/home.ts`                                              | org init, validation, active pointer, state-home resolution |


### Efficiency control plane

`docs/efficiency.md` (`efficiency/v1`) is the sole normative route, budget,
measurement, and qualification authority. Every organizational **episode**
owns one immutable `planned_route`, a reassessed `current_route`, and a
terminal `final_route`. Admission must record factors, selected pass set,
model/effort, context and human-attention allowances, and cost bounds before
constructing a runtime. The production pass executor enforces that boundary:
the durable route and token-free configuration/capability/artifact preflight
precede runtime construction; each provider invocation reserves remaining
turn, cost, time, and tool allowance and owns one terminal execution step plus
one settlement; and each pass writes a budgeted, component-hashed context
manifest. `route-policy/v1` makes pass/model/effort selection factor-backed and
monotonic. Older planning-depth or timeout settings are not competing
authorities.

Ownership follows the import direction:

| Layer | Efficiency responsibility |
| --- | --- |
| `src/runtime` | Execute adapter calls, checkpoint usage/session facts, and settle each provider turn exactly once. It never chooses a route. |
| `src/loop` | Own provider-neutral route admission and reassessment, pass/model/effort evidence, token-free preflight, episode execution journals and bounds, context manifests/deltas, work fingerprints, pre-turn checks, and terminal provider/mechanical execution-step records. |
| `src/org` | Own organizational episodes, lifecycle and scheduler transactions, human decisions/wait, cross-pipeline coordination, learning outcomes, and final episode disposition. |
| `src/report` / `src/observe` | Read-only projections. They perform no admission, reconciliation, workflow mutation, or provider call. |
| `eval/**` | Qualify an exact candidate. Eval evidence never becomes production workflow authority. |

Phase 6 keeps qualification identity and release evidence separate. Prepared
campaigns pin both the historical whole-checkout hashes and two independently
recomputable identities: the exact prebuilt installable-package tarball and the executable eval
suite. After a terminal campaign is qualified and externally archived, only a
sanitized evidence slice may enter `research/evals/**`. A release attestation
compares the descendant with the exact candidate commit, rejects any
unallowlisted change, and proves package, suite, and org bytes are identical.
Per-contract projections are read by the token-free contract harness and must
recompute the qualifier/report and reconcile archive, grader, GitHub, route,
terminal, and settlement evidence. These files have no import path into
`src/org`, `src/loop`, or `src/runtime` and grant no workflow authority.

Phase 4 learning closure stays in `src/org/learning`: `capture.ts` inventories
eligible finalized provider envelopes and repairs receipts exactly once;
`efficiency-evidence.ts` derives versioned events and comparable recurrence
from orchestrator-owned artifacts; `efficiency-health.ts` projects separate
capture, governance, and efficacy health; and `efficacy.ts` decides declared
control/treatment observations. These modules import no provider adapter and
never infer trusted evidence from model prose. They extend the existing
Candidate, ReplayCapsule, SystemFingerprint, ExperimentRecord, EvalResult,
Intervention, publisher, and canary authority chain instead of creating a
parallel state model. Report and Observe remain presentation-only readers.

A **role invocation** is one scheduled, event-driven, or manual invocation of
an organizational role. A **pass** is a configured protocol stage. A
**provider turn** is one adapter invocation and one provider settlement. An
**execution step** is one terminal provider or deterministic operation record;
a **mechanical step** constructs no adapter and has zero settlements. If a pass
calls the adapter again for recovery or verdict reformatting, that is another
provider turn even when the pass retains one parent summary. Use the specific
identity in normative text instead of ambiguous bare “turn.”

When a provider owner disappears after checkpointing partial usage, stale-step
reconciliation carries that measured partial usage into the terminal step and
ledger settlement. It records usage as unavailable only when no measured
checkpoint exists; unknown usage is never silently treated as measured zero.

The gate stays a pure `GateFn` in `src/runtime`; the org layer *composes* the
effective gate for a turn (default rules + grant lookup, §4) and passes it
down through `TurnHooks`. The runtime layer never imports approval storage.
Shell normalization treats only a literal `/dev/null` redirect as a
non-mutating sink. This lets a compound command read a protocol surface while
discarding diagnostics without manufacturing a `protocol-self-edit` request.
Every other redirect remains material and fail-closed, and a real protocol
write in the same compound command still triggers the rule.

## 1. On-disk layout

Four explicit paths, one rule: **durable, curated artifacts live in git;
high-churn operational state stays outside git.** No command infers an org
home from the current working directory.

### Package root (installed Operon implementation)

```
dist/                    compiled package CLI (`operon` bin)
src/                     source tree in a development checkout
TASTE.md                 org-init template, not an active org instance
roles.yaml               org-init template
pipelines.yaml           org-init template
prompts/                 org-init protocol templates
taste/                   org-init role craft templates
agent-skills/operon/     packaged coding-agent operating guide
```

`pnpm link:local` creates a source-backed launcher, so a development checkout's
next `operon` invocation reads the latest TypeScript source. Packed installs
use `dist/cli.js`. Both modes resolve templates relative to the installed
package, never relative to the caller's current directory.

### Org home (required, committed separately)

```
TASTE.md                 org constitution (human-ratified)
AUTHORITY.md             canonical, versioned human authority grant
AGENTS.md                Codex instructions composed around AUTHORITY.md
CLAUDE.md                Claude Code instructions composed around AUTHORITY.md
roles.yaml               org chart (human-ratified)
apps.yaml                app registry (§7)
pipelines.yaml           executable build/role protocols
prompts/                 pass templates referenced by pipelines.yaml
taste/<role>.md          role craft addenda
memory/roles/<role>/     per-role craft bundles, cross-app (§6)
skills/                  promoted skills (Agent Skills standard)
retro/<date>.md          weekly retro notes (§6)
```

`operon org init <path> --name <name>` atomically creates and validates this
complete tree, creates the state home, and writes `~/.operon/config` with the
active `org_home`. Onboarding selects `delegated-operator` (default),
`conservative`, or an attributable custom authority file and previews both
automatic and human-gated actions. A pre-feature org with no `AUTHORITY.md`
fails closed to the built-in legacy-conservative profile; it never silently
inherits the newer delegated default. `operon org use <path>` selects an existing complete tree.
`OPERON_ORG_HOME` is the explicit non-persistent override.

`operon org upgrade` is the token-free legacy migration boundary. Its default
is a byte-stable, non-mutating schema/change plan. Execution requires an
explicit authority choice when a legacy org has no charter, copies only
missing packaged surfaces, adds the registry schema marker without rewriting
app entries, writes a checksummed archive outside state, and validates the
complete org plus effective authority afterward. Existing ratified surfaces
are never replaced. A deterministic stage and dead-process-aware org lock make
an interrupted migration safely rerunnable; thrown failures restore the exact
archived bytes.

### App reset archives

`operon app reset <app>` is the lifecycle command for repeatable onboarding
and build-loop testing. Planning is the default and reads the selected app's
managed state plus GitHub surface. Execution requires both `--execute` and an
exact `--confirm <app>` value. Before every local or remote change it writes a
checksummed archive outside the state home, by default at
`~/.operon/archives/<org>/<app>-reset-<fingerprint>/`; a reset can therefore
never delete its own recovery material.

The command takes every configured role lock for the app, and refuses if it
finds a fresh-heartbeat running envelope, active journal/lock, or pending approval.
`--force` permits an old running envelope with no heartbeat for ten minutes;
it does not bypass any of the other live-work checks. It archives
and removes only app-scoped managed paths (`repos/<app>`, `worktrees/<app>`,
`runs/<app>`, `tickets/<app>`), app-attributed approval/schedule/budget/ledger
entries, and the app registry entry. Its GitHub plan closes only issues bearing
an `op:*` label plus open PRs whose body closes one of those issues (or whose
branch starts `op/`), then deletes their head branches. It never deletes a
GitHub repository, rewrites its default branch, or touches a human checkout.
GitHub's retained closed issue/PR history is intentional.

Reset also archives the normalized questionnaire record, after checking it
against the canonical secret patterns. Blockers are typed and carry specific
remediation; `--force` suppresses only the stale-run blocker. A durable reset
intent retains the originally reviewed remote plan across process death, and
dead reset-owned role locks are reclaimable without crossing a live lock.
Remote closes/deletes and local cleanup are idempotent; registry writes are
atomic and last. `operon bootstrap <checkout> --answers-from <archive|app>`
recovers the archived identity and answers, so the checkout directory name is
not used as a substitute app identity.

### Token-free app verification and promotion

`operon app verify <app>` performs bounded Git/ref reads, deterministically
recreates or synchronizes the managed clone only after the onboarding commit
is reachable, validates registry/config and authority/config hashes, parses
generated artifacts, runs declared app tests/lint, checks approvals and role
locks, and proves the configured adapter packages/models without constructing
a runtime or provider process. It writes a stable readiness projection and a
terminal mechanical execution step; provider factories, processes, turns,
and settlements remain zero.

`operon app promote <app> --to live` is a non-mutating plan unless
`--execute` is present. Execution is admitted only from passing verification,
then uses a crash-resumable journal to commit and push the app-owned status,
atomically update the one registry entry, refresh the lifecycle hash record,
and verify the final live state. Commit, push, config, and registry boundaries
are individually rerunnable; a dead process lock is reclaimed while a live
one fails closed. Repetition returns `already_live` without a duplicate
commit or side effect.

### App repo (target product repo)

```
.operon/
  TASTE.md               app charter ("what this product is; what good means")
  AUTHORITY.md           session-readable org snapshot + app-only narrowing
  config.yaml            this app's registry entry (same schema as apps.yaml)
  policy.yaml            app-owned quality-gate policy emitted by bootstrap
  memory/<role>/         per-(role, app) domain bundles
  onboarding-report.md   deterministic setup/documentation inventory
  bootstrap/             initial issue and operator next steps for new apps
AGENTS.md                existing content + one marked Operon authority block
CLAUDE.md                existing content + one marked Operon authority block
```

**Containment invariant.** Operon's owned app artifacts live under `.operon/`,
with one deliberately narrow exception: onboarding composes an idempotent,
marked authority pointer into root `AGENTS.md` and `CLAUDE.md` so Codex and
Claude Code see the charter when launched directly. Existing content outside
that marker is preserved byte-for-byte. The remaining transient surface is
GitHub (`op/*` branches,
`op:*` labels) that closes out as work merges. Nothing Operon-specific is
scattered through the app's source tree, so contributors who don't run
Operon can ignore exactly one directory — the same social contract as
`.github/` or `.vscode/`. Under that invariant the directory is safe to
keep in the app repo regardless of whether the Operon tool itself is ever
open-sourced or stays private: it holds app-owned configuration and memory
(which a reader may freely see — it documents how the app is managed),
never tool source. One consequence: if Operon is published, the
`.operon/config.yaml` schema becomes a public contract, so it carries a
`schema_version` field from day one. Flagged in §11.

### Runtime state (`~/.operon/<org>/`, outside git entirely)

```
repos/<app>/             org-managed clone per app (worktree source, §3)
worktrees/<app>/<branch>/
state/schedule.json      last-fired per (role, app, trigger)
state/events/            consumed-event keys (dedup) + file-drop event inbox
state/turns/<turnId>.json  turn journals (§3)
state/budget-overlay.json  dispatcher budget-pause overlay (§7)
scheduler/installation.json  org-scoped scheduler ownership/definition record
scheduler/evidence/      versioned invocation, route-decision, and alert JSON
standing-roles/<app>/    grounded draft artifacts + deterministic Planner feeds
locks/<app>--<role>.lock
approvals/               pending/ decided/ grants/ log.jsonl (§4)
sessions/                adapter session artifacts where the SDK needs a home
tasks/<taskId>/           parent delegated-task record + exact operator prompt;
                         child runs correlate via parent_task_id
runs/<app>/<runId>/      L1–L3 per-pass runlogs: envelope, events, brief,
                         exact prompt, output, activity log (not a full
                         transcript; docs/loop.md §9)
telemetry/<day>.jsonl    org cost ledger (src/runtime/telemetry.ts orgDir)
invocations/<day>.jsonl  one record per loop/dispatch invocation
tickets/<app>/<issue>.json  cross-process ticket claim state (docs/loop.md §7.1)
scorecards/<app>/<role>.jsonl  raw scorecard events (§6)
learning/**              learning-loop capture/episode/activation state;
                         metrics/capture-cursor.json binds eligible runs to
                         exact event ids, metrics/efficiency-health.json is a
                         refresh-only rebuildable projection, and events/,
                         episodes/, canary/, resolved/, and m6-runs/ retain
                         their governed meanings (docs/learning-loop/)
```

The org id `<org>` comes from org-home config. `OPERON_STATE_HOME` overrides
this location explicitly and independently of `OPERON_ORG_HOME`. Note
`~/.operon` is not TCC-protected on macOS, unlike `~/Documents` — launchd jobs
can read it freely (same reasoning that keeps repos at `~/Build`).

### Read-only Live UI (`operon observe`)

`src/observe/` is a presentation-only leaf: it may consume org, loop, and
runtime readers, while no core layer imports it. At startup it resolves the
same package/org/state homes as every installed command, reconstructs a strict
`ObserveSnapshotV1`, reads bounded GitHub issue/PR/review/check state, and
keeps only a disposable in-memory index plus bounded SSE replay events. It
never persists a queue or workflow fact.

The server binds only to `127.0.0.1`, mints a new high-entropy capability on
each process start, and exposes only GET/HEAD routes: `/api/v1/snapshot`,
`/api/v1/events`, `/healthz`, static same-origin assets, and allowlisted local
evidence. Every response is no-store, frame-denied, no-referrer, nosniff, and
covered by a restrictive CSP. Artifact paths are ID-validated and realpath-
checked; traversal, unknown names, cross-home access, and symlink escapes fail
closed. L3 prompt/brief/output/activity content never enters snapshots or SSE
and is fetched deliberately as text. `session.log` is always an activity log,
not a transcript.

Filesystem notifications provide latency; periodic scans provide correctness.
GitHub polling is read-only, bounded, and independently degradable: a GitHub
failure retains the last known external projection with explicit source-health
state while local pass activity keeps updating. A monotonically increasing
observer cursor supports SSE replay; clients outside the bounded buffer receive
`resync` and fetch a fresh durable snapshot. Stopping the server closes only
observer HTTP streams and never signals a runtime, loop, dispatcher, or pass.
The browser's session chooser is a disposable view over the same snapshot:
parent tasks are the preferred historical boundary, standalone traces cover
legacy/orphaned work, and URL state scopes the existing components without
creating a session store or changing correlation semantics.

## 2. Dispatcher & scheduler

**Model: stateless tick, not a daemon.** `operon scheduler install` creates an
org-scoped launchd definition (`StartInterval: 300` by default) that invokes an
absolute Node/package entry with explicit org and state homes. A future systemd
user timer uses the same backend boundary, but Operon does not claim its health
on an unexercised platform. Each tick calls the ordinary `operon dispatch`,
reads config + durable state, computes what is due, starts detached turns, and
exits. There is no competing daemon or workflow engine. A wedged host resumes
on the next tick; cadence remains flexi and ticks run at all hours (decided
2026-07-04).

Lifecycle mutations preview by default and require `--execute` plus exact org
or scheduler-id confirmation. Ownership metadata, the rendered-definition
hash, and a crash-resumable transaction prevent silent overwrite/removal of a
malformed, foreign, or wrong-org definition. `operon scheduler status` and
doctor join definition, loaded/active manager state, recent tick evidence,
duplicate/orphan checks, and provider-settlement agreement. Definition-file
existence is never sufficient for health. The canonical definition schema,
identity derivations, state layout, reason codes, crash boundaries, and health
semantics are in [scheduler.md](scheduler.md).

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
with the app's cadence overrides (§7), then evaluate. An app that is not
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
per role (Support, Marketing, SRE) is a roadmap item, not a dispatcher
change.

The v0 payload contract for file-drop company events is documented in
`docs/event-schemas.md` and validated by `src/org/event-schemas.ts`.

### Locking & concurrency

- **One turn per (role, app).** Lock file `locks/<app>--<role>.lock` created
with `O_EXCL`, containing `{pid, turnId, startedAt, heartbeatAt}`. The turn
runner heartbeats it every 30 s.
- Tick finds a lock with heartbeat < 2 min old → turn still running → skip
(this is how overlapping firings don't collide). Heartbeat stale → crash
recovery (§3), which decides resume vs restart and re-owns the lock.
- **Org-level WIP limit:** live locks ≥ `org.max_concurrent_turns`
(apps.yaml, default 2) → remaining due turns stay due; next tick retries.
Priority when contending: blocked-turn re-dispatches, then events, then
schedules (oldest due first).
- **Turns outlive the tick.** `operon dispatch` spawns
`operon run-role … --turn <id>` as a detached process, so the 5-minute
timer never kills a long turn. `run-role` is thereby also the manual
entrypoint (roadmap item 2) — the dispatcher is just the thing that calls
it on time.



## 3. Turn lifecycle & state machine



### One role invocation

```
dispatch → journal(assembling) → context assembly (§5)
        → worktree acquire
        → journal(running)    → adapter.runTurn(req, {gate, onEvent})
        → journal(collecting) → collect artifacts, escalations, usage
        → telemetry append · scorecard events · memory-write check
        → journal(done | blocked_on_gate | failed) → release lock
```

The journal `state/turns/<turnId>.json` is written synchronously at every
phase transition — it is the crash-recovery source of truth:
`{turnId, role, app, trigger, phase, attempt, session?, worktree?, ticketRef?, escalationIds?, startedAt, updatedAt}`.

**Legacy role-invocation budget.** The adapter tracks running cost from SDK usage events;
crossing `max_turn_budget_usd` aborts the turn gracefully → status `failed`
with an incident note artifact (roles.yaml: "overrun = incident note, not
silent spend"). It remains a safety backstop while episode route admission and
pre-provider-turn remaining-budget enforcement are implemented; it is not a
second canonical route budget.

### Worktrees

- Operon maintains its **own clone** per app at `repos/<app>` (fetch-only
sync with GitHub) and cuts worktrees from it under
`worktrees/<app>/<branch>`. It never touches the human's personal checkouts
of the same repos — GitHub is the only sync point between human and org.
Mutating git operations on that shared clone (fetch, worktree add/remove) are
serialized by a per-app clone lock (`withAppGitLock` in
`src/org/turn-runner.ts`), so two concurrent turns for the same app never
contend on `.git/index.lock` and corrupt the tree.
- Loop items get branch `op/<issue>-<slug>` and keep the same worktree across
build → review → fix cycles; it is removed after merge/return. Non-loop
turns (Planner digest, SRE sweep) get a throwaway worktree on a detached
checkout of main, removed at turn end.
- Turns never run in `repos/<app>` itself, and never on `main`.



### Build-loop state machine (`src/loop`) — see `docs/loop.md`

The loop is Operon's center of gravity — a framework-agnostic TypeScript
re-engineering of the predecessor orchestrator (`docs/loop.md` §0), **not**
a thin state machine over opaque role turns (decided 2026-07-04: control and
gates, never "throw a ticket at an agent"). `docs/loop.md` is the
authoritative design — passes, briefs, gates, verdicts, review dimensions,
and acceptance-criteria discipline all live there. Summary:

- A role invocation may decompose into a **pass pipeline** (`pipelines.yaml` +
versioned prompts in `prompts/`). A configured pass currently invokes
`runTurn` with an assembled, budgeted **brief** and a fresh session; any extra
adapter invocation inside that pass remains a distinct provider turn and
settlement. Per-pass model/effort overrides remain within the admitted episode
(`docs/loop.md` §§2–4).
- **Mechanical quality gates** (setup/tests/lint/e2e/secret-scan/
completeness/review-freshness, risk-tiered by `.operon/policy.yaml`) run
as orchestrator subprocesses after build passes and twice at ship —
distinct from the safety gate; no agent prose ever drives a side effect
(`docs/loop.md` §5).
- Item states: `ready → building → gates → reviewing → shipping → merged`,
with bounded remediation (3) and review cycles (3) → `returned`.
`approve` + green gates + freshness → **the orchestrator squash-merges**
(agents never merge), deletes the branch, closes the ticket via
`Closes #N`. All states derive from GitHub artifacts; any tick advances
any item (`docs/loop.md` §7).



### Crash recovery: artifact boundary first

A stale lock or interrupted tick reopens the episode execution journal before
choosing work. The ordered boundaries are `route → contract → implementation
→ push → gates → pr → findings → approvals → merge → release`. A boundary is
reused only while its recorded artifact fingerprint is still valid. Ticket,
commit, or finding drift writes an invalidation reason and clears only the
affected suffix; the next tick resumes at the first now-legal boundary. A cap
stop, cancellation, crash, or timeout retains the last valid artifact refs and
a typed resume decision.


**Restart clean** currently resets worktree scratch to the branch tip with
`git reset --hard && git clean -fd`. It may discard only scratch that has not
been accepted as a valid episode artifact. Commits, pushed refs, contracts,
findings, approvals, gate evidence, usage checkpoints, execution records, and
any other accepted artifact survive interruption. Repeating a productive pass
requires a durable invalidation reason tied to the artifact or decision it
invalidates. Claim, repair, review, retry, tool-call, active-time, provider-turn,
and cost bounds are route-owned and remain in force across process restarts.

A role invocation whose running pass exceeds its wall-clock cap is killed by
the dispatcher — SIGTERM escalating to SIGKILL. The pass executor derives its
effective watchdog from the smaller of its configured ceiling and the
episode's remaining active-time allowance in `docs/efficiency.md`.
Recovery (restart-clean + respawn) is **deferred until the process is
confirmed dead** (`killHungTurns` in `src/org/dispatch.ts`): a still-alive
child that also holds the per-app clone lock would otherwise let two workers
mutate one clone. If the pid refuses to die this tick, recovery waits for a
later one.

Inside a pass, the executor also owns a shorter adapter-start deadline
(default 30 seconds). The first adapter progress checkpoint or streamed event
proves startup; silence until the deadline aborts the same owned provider tree
and finalizes `failed(error_adapter_start_timeout)`, distinct from the full
turn wall-clock timeout. `operon doctor` uses separate bounded, non-billable
initialize/account/auth probes to catch missing binaries, transports,
credentials, and model configuration before an operator starts live work.

### Idempotency rules

These four rules are why a dead turn never leaves the repo half-done:

1. **Durable progress is explicit.** Git/GitHub operations remain the durable
  product effects: commit, push, PR create, label flip, review, comment, merge.
  Episode contracts, findings, approvals, gate evidence, usage checkpoints,
  and terminal records are also durable orchestration artifacts. Only
  unaccepted worktree/session scratch is disposable.
2. **Artifact before label.** State labels flip only *after* the artifact
  they announce exists (push branch → then `op:building`; open PR → then
   `op:in-review`). A restarted turn re-derives state from artifacts (`gh pr  list --head <branch>`), never trusts the label alone, and skips
   already-done steps.
3. **Claims are label flips.** The Builder claims a ticket by atomically
  swapping `op:ready → op:building`; a dispatcher that polls mid-claim sees
   a consistent state either way.
4. **Non-git writes are append-only and keyed by turnId** (telemetry JSONL,
  scorecard events, journal) — re-running collection dedupes on turnId.
   Whole-file operational state (journal, lock, schedule, consumed-event set,
   approval items) is written atomically via a tmp-file-plus-`rename`
   (`writeFileAtomic` in `src/org/atomic.ts`), so a crash mid-write never
   leaves a torn file a later tick would choke on.



## 4. Approval surface (CLI queue)

Decided 2026-07-04: CLI queue, one-by-one review, approve or
deny-with-reason, persisted audit trail, app-tagged, single queue.

### Storage (`~/.operon/<org>/approvals/`)

```
pending/<id>.json     one file per open item
decided/<id>.json     moved here on decision (decision fields merged in)
grants/<grantId>.json grants created by approvals (single-use by default;
                      the human may widen to ticket/app scope at decision time)
log.jsonl             append-only audit trail (every event: raised, decided)
```

Plain files, no database: one human consumer, no concurrency pressure,
survives the droplet migration as a directory copy, and TASTE §3 (boring
dependencies). `id = <utc-compact-timestamp>-<rand4>`.

Item schema:

```jsonc
{
  "id": "20260704T193201Z-8k2f",
  "app": "civic", "role": "builder", "turnId": "…", "ticketRef": "#42",
  "rule": "secrets-or-auth",              // gate rule that fired
  "action": { "tool": "Bash", "input": "…", "description": "…" },
  "justification": "…",                   // the model's stated intent, from turn events
  "raisedAt": "…", "status": "pending"
}
```



### Flow

1. Gate denies-and-escalates (existing `defaultGate`). The adapter surfaces
  the denial to the model as the tool result ("denied — escalated to human
   approval as ") and records the `GateEscalation`.
2. The model continues if it can deliver value without the op; if its primary
  artifact is unreachable it ends the turn declaring so → status
   `blocked_on_gate`. Either way the item is persisted to `pending/` at
   collection time, tagged with app and turnId.
3. Human reviews via CLI (below). **Approve ≠ auto-execute.** Approval mints
  a grant: `{app, role, actionHash, scope, expiresAt, uses, maxUses,
   revokedAt?}` where `actionHash` = SHA-256 of the normalized
   `{tool, input, description?}` (`normalizeAction`/`actionHash` in
   `src/org/approvals.ts`). The default scope is `once` — a single-use
   action hash, exactly the pre-amendment behavior. At decision time the
   human (never the agent) may widen to `ticket` or `app` scope: every
   action matching (rule, path prefix) for that app±ticket until TTL,
   use-count cap (default 20), or `operon approvals revoke <grant-id>`.
   Self-merge, production deploy, protocol-surface writes, and
   out-of-boundary actions are never scopeable. Nothing replays tool calls
   outside a session.
4. Next tick re-dispatches any `blocked_on_gate` turn whose escalations are
  all decided (resume the session if fresh, else restart with a decision
   summary in context). The effective gate = grant lookup **then** default
   rules — a `once` grant passes exactly once; a scoped grant passes
   matching actions until exhausted, each use appending its own audit row.
   Deny-with-reason: the reason is injected into that turn's context ("your
   request to X was denied: ") — and persisted as a durable denial lesson
   for the (app, role) pair so the same denial is never re-litigated.
   Role-forbidden acts (builder/reviewer self-merge, deploy,
   provider-global-memory) never reach the queue at all: the composed gate
   denies them flat with standing guidance, and on Claude the adapter
   removes them from the tool surface itself (`src/runtime/role-shaping.ts`).
5. Grants expire (default TTL 24 h), count uses against their cap, and are
  revocable; grant mint, each use, exhaustion, and revocation all go to
   `log.jsonl`.



### CLI

```
operon approvals              count + one-line-per-item table (app-tagged)
operon approvals review       one-by-one: full item, then [a]pprove (with
                              optional scope: `a ticket [path]` / `a app
                              [path]`) / [d]eny (reason required) / [s]kip;
                              approving may also re-arm the parked ticket
                              (op:blocked → op:ready) so the next tick
                              continues from artifacts
operon approvals review --batch   group pending items with identical
                              (rule, app); one decision, per-item audit rows
operon approvals show <id>    full detail incl. turn-event context
operon approvals revoke <grant-id>   immediate revocation of a live grant
```

Decision writes are ordered: append to `log.jsonl` first, then move the item
file, then mint the grant — a crash between steps is detected by log-vs-file
reconciliation at next `operon approvals` run.

Budget escalations (§7) enter this same queue as synthetic items
(`rule: "budget-exceeded"`) — one inbox, never two.

## 5. Context assembly

Assembly is **concatenation in fixed order** (PURPOSE v0.8 — layers answer
different questions, so conflicts are rare; narrower layers specialize
defaults):

```
[0] effective delegated authority    org AUTHORITY.md, optionally narrowed
                                      by <app>/.operon/AUTHORITY.md
[1] org TASTE.md                      values + engineering constitution
[2] taste/<role>.md                   role craft (when it exists)
[3] <app>/.operon/TASTE.md            product charter (when it exists)
[4] role turn protocol                generated: expected outputs, GitHub
                                      conventions (§10), end-of-turn learning
                                      note instruction, approval etiquette
[5] memory excerpts                   role craft bundle + this app's domain
                                      bundle (§6) — capped
```

**Authority and the org's "What we never do" section are unoverridable by
narrower context — but the guarantee is the gate, not prompt order.** App
authority can only inherit, select conservative, or add restrictions; a stale
app snapshot fails closed. Current-task instructions can narrow the grant.
Broader authority requires a fresh, attributable human instruction. Layers
[2]/[3] specializing a never-do rule
would merely be ignored text; the critical-ops gate enforces the same list
mechanically on every tool action. Prompt layering is steering; the gate is
the contract.

**Memory excerpt selection v1: no embeddings.** Include each bundle's
`INDEX.md` (curated one-liners) plus any documents whose frontmatter
`keywords` match the task text; hard cap ~16 KB. Curation (§6) keeps bundles
small enough that this stays adequate; retrieval sophistication is earned by
evidence, not assumed.

**Governed concepts resolve ahead of legacy memory** (learning-loop M4/M5,
`docs/learning-loop/`). When learning is enabled, `resolveLearningContext`
(`src/org/learning/resolver.ts`, wired into `src/org/context.ts`) runs once
per turn as a **pinned resolve** — promotion, disable, or rollback mid-turn
never shifts a running turn's context. Its concept sections fill layer [5]
first, and the legacy keyword selection above spends only the bytes the
concepts leave. In the build loop the pin is per (ticket episode, pipeline
role) via `createEpisodeContextResolver` (`src/org/context.ts`), so build
and fix passes on one ticket share one pin and reviewer-scoped concepts
reach review passes. Every governed resolve persists a pinned record at
`learning/resolved/<turnId>.json` in the state home.

**Cache-stable assembly** (added 2026-07-04, reviewed with the human
operator; economics in `research/2026-07-04_prompt-caching.md`). Provider
prompt caches are org-wide *prefix matches*, not session state: a fresh
session whose rendered prefix is byte-identical to a recent request reads it
at ~0.1× input price, and every read refreshes the TTL — so back-to-back
passes stay warm across the loop's fresh-session-per-pass rule for free.
Two rules protect that:

1. **Layers [0]–[4] are a pure function of (role, app, ratified files).**
   Never embed per-turn bytes — timestamps, turn ids, ticket refs, attempt
   counters. Per-turn facts belong in the task payload (the brief), which
   renders after the stable prefix.
2. **Layer [5] is pinned per resolve and held fixed across its passes** —
   once per role turn, and in the build loop once per (ticket episode,
   pipeline role). Keyword matching runs against the *ticket* text,
   never the per-pass brief — re-selecting per pass would silently change
   the prefix on every pass (and hand the builder and the fix pass
   different lessons; pinning is better for coherence, not just cost).

A model switch between adjacent passes forfeits the whole cache (caches are
model-scoped) — weigh that when tuning per-pass overrides in pipelines.yaml.

**Injection per adapter — native channels only** (docs/PURPOSE.md), nothing
assembled ever lands in a commit:


| Runtime | Channel                                   | Mechanics                                                                                 |
| ------- | ----------------------------------------- | ----------------------------------------------------------------------------------------- |
| claude  | system-prompt append (SDK option)         | no files written                                                                          |
| codex   | App Server `developerInstructions`        | per-thread native instruction field; no worktree overlay required                         |
| pi      | `.pi/APPEND_SYSTEM.md` in worktree        | worktree-local, masked via `.git/info/exclude` (never the repo's `.gitignore`)            |


The assembler produces `ContextBundle.authority` (effective text, profile,
version, SHA-256, and source paths), then layers [1]–[4] in `taste: string[]`
and layer [5] in `memoryExcerpts`. Every pass envelope copies the authority
provenance without duplicating its full prose. Parent delegated-task records
capture the same evidence at `operon task begin`.

This section covers the *system context* a pass runs under. The *task
payload* — ticket, spec excerpts, contract, findings, attempt history — is
the loop's brief assembler (`docs/loop.md` §3), a separate, per-pass,
budgeted packet logged verbatim in the run artifact.

## 6. Memory & scorecards



### OKF bundles

Two partitions (PURPOSE v0.8: one-turn-one-app):


| Bundle                         | Home                 | Content                                                          |
| ------------------------------ | -------------------- | ---------------------------------------------------------------- |
| `memory/roles/<role>/`         | org home (committed) | craft: what this role has learned about doing its job, cross-app |
| `<app>/.operon/memory/<role>/` | app repo (committed) | domain: what this role knows about this product                  |


Document format (OKF — markdown + YAML frontmatter):

```markdown
---
name: prefer-fixture-factories
description: one-line hook used for excerpt selection
type: lesson | fact | procedure
keywords: [tests, fixtures]
evidence: ["PR #12 review", "incident 2026-07-02"]
status: active | deprecated
created: 2026-07-04
updated: 2026-07-04
---
Body: the lesson, with the why. Wrong lessons get deleted, not hedged.
```

Each bundle carries an `INDEX.md` (one line per doc) — the always-included
excerpt layer.

**End-of-turn learning notes** (learning-loop M1, design §7.1 in
`docs/learning-loop/`): the role protocol (context layer [4]) instructs
agents to record lessons and corrections as **candidate notes** —
`learning/candidates/<role>/` in the org home, `.operon/learning/candidates/
<role>/` on the ticket branch — never as active OKF docs. Candidate trees are
deliberately agent-writable routine ops; they carry no authority and nothing
in them loads into future context until it passes review. The learning
GOVERNANCE surfaces (`learning/{bundle,quarantine,evals,reviews,experiments,
interventions}/**`, `manifest.yaml`, `policy.yaml`, `rejections.jsonl`, and
their `.operon/learning/**` counterparts) are critical ops by the
`learning-surface-tamper` gate rule — publisher/human-only. Existing
`memory/**` trees remain read-only legacy seed context: still resolved into
layer [5] at lowest precedence, no longer written by anyone.

**Curation** belongs to the governed learning loop (review → approval →
publish, `docs/learning-loop/`); the old direct-write retro curation pass
(`runRetroCuration`) was retired with M1 — its destructive dedupe/delete was
ungated and never wired, and its skill-draft idea moves to the M6 distiller.

### Scorecards

Raw events append to `scorecards/<app>/<role>.jsonl` as they happen, written
by the orchestrator (never self-reported):


| Event                | Source                                          | Scores              |
| -------------------- | ----------------------------------------------- | ------------------- |
| `review_cycles`      | loop item at merge/return (cycles count)        | Builder             |
| `escaped_bug`        | SRE incident note tracing to a merged PR        | Reviewer            |
| `rework`             | ticket returned / reopened after merge          | Planner             |
| `edit_distance`      | human's delta on a published draft              | Support / Marketing |
| `gate_denial_upheld` | approval queue: deny on an item the role raised | any                 |
| `turn_cost`          | telemetry rollup                                | any                 |




### Weekly retro (`operon retro`)

A scheduled org-level turn (Opus, high effort — quality of judgment matters
here) that consumes the week's telemetry + scorecards and emits:

1. `retro/<date>.md` in org home (committed) — scores per (role, app),
  trends, incidents;
2. learning notes into `learning/candidates/` (routine — curation itself is
  the governed learning loop's job, `docs/learning-loop/`);
3. proposed TASTE/roles.yaml changes — **as proposals only** (issues/PRs for
  the human; the gate's `protocol-self-edit` rule backstops this).

The scorecard, not self-assessment, decides autonomy changes (TASTE §13) —
e.g. Support replies graduating from draft-only is a roles.yaml proposal
justified by edit-distance trend.

## 7. Multi-app structure



### App registry — `apps.yaml` (org home)

```yaml
org:
  name: operon
  max_concurrent_turns: 2

defaults:
  budget_usd_month: 1000        # decided 2026-07-04, configurable per app

apps:
  operon-sandbox-alpha:
    repo: bikramgupta/operon-sandbox-alpha       # GitHub slug = identity
    status: live                # live | paused | onboarding
    budget_usd_month: 1000
    cadence: {}                 # optional per-role trigger overrides, e.g.
                                #   support: []          (disable role here)
                                #   planner: [{schedule: "daily 08:00"}]
  operon-sandbox-beta:
    repo: bikramgupta/operon-sandbox-beta
    status: onboarding
```

- **One-turn-one-app is structural:** `TurnRequest` has a single `workdir`;
multi-app exists only in the dispatcher (which iterates apps) and human
surfaces (the app-tagged approval queue, per-app budget rollups). No turn
ever sees two apps.
- "One live app at a time" is **operational policy** expressed as `status:`,
not code — the WIP limit is what code enforces.
- Per-app cadence overrides replace (not merge with) that role's roles.yaml
triggers when present; an empty list disables the role for that app.



### Budget enforcement

Telemetry already records cost per turn; the dispatcher rolls up the current
month per app (telemetry records gain an `app` field — small addition to
`TurnRecord`):

- ≥ 80% of `budget_usd_month` → warning line in the Planner's daily digest.
- ≥ 100% → app auto-set to `paused` (state overlay, not a YAML edit) + a
`budget-exceeded` item in the approval queue; human approval resumes the
app (optionally raising the budget in apps.yaml themselves).

The overlay (`state/budget-overlay.json`) is recomputed on **every dispatch
tick** — `enforceBudgetOverlay` runs before due-turn computation, and
`computeDueTurns` skips any app the overlay marks paused, so an app past its
cap stops spending within one tick rather than at the next human touch. The
rollup is per calendar month, so the overlay clears itself at month rollover
(a new month starts at $0). This is enforcement in code, not just a digest
line.



## 8. Planner co-planning mode

Manual planning has two shapes beside schedule and event: **interactive
co-planning** (this section) and the **non-interactive `--auto` mode**
(Stage 4 of the proportionality campaign) — one Planner turn through the
real pass executor (real gate, approval store, per-provider settlement) whose
schema-validated 1–3-ticket bootstrap plan the ORCHESTRATOR validates
against the loop's label contract and publishes transactionally
(`src/org/plan-auto.ts`, `src/loop/plan-tickets.ts`). Prefer `--auto`
whenever the goal can be stated up front; it exists because the episode's
interactive session published tickets through an agent-authored shell loop.

```
operon plan <app> [--topic "stats percentile helper"] [--workdir <app-checkout>]
operon plan <app> --auto --goal "<product goal>" [--stage bootstrap] [--no-publish]
```

- Assembles the Planner's context exactly as §5 (same TASTE layers, same
memory bundles), creates a throwaway worktree on main, then hands over to
an **interactive** session with the human in the terminal — v1: spawn the
role's native CLI (`claude`) in that worktree with the assembled context
injected via its append-system-prompt channel. Co-planning is
Anthropic-native v1; it generalizes when another runtime hosts the Planner.
- App checkout resolution is shared by manual app CLIs: explicit `--workdir`
  wins; otherwise Operon prefers the managed dispatch clone at
  `~/.operon/<org>/repos/<app>`, then a sibling checkout beside the Operon
  repo (the `~/Build/<app>` laptop layout), then the repo basename. It fails
  loudly instead of silently using the Operon repo as the target app.
- The contract at session end is unchanged — artifacts out: drafted tickets
(GitHub issues in the §10 format, labeled by the human's call: `op:ready`
or left unlabeled for another pass) and/or a spec note committed under the
app's `.operon/planning/`. In `--auto` mode the orchestrator publishes the
validated plan itself with canonical labels — agents author no `gh` side
effects.
- Recorded in telemetry with `trigger: manual`; interactive-session rows
carry `unmeasured: true` (the native CLI's tokens never flow through
Operon), while `--auto` turns settle real usage per pass. The `Trigger`
type's `manual?: boolean` kind is one the dispatcher **never** auto-fires.
- Before an `--auto` runtime is constructed, `route-policy/v1` selects the
  episode route and planning pass set from structured risk, ambiguity,
  coupling, reversibility, external consequence, expected decomposition, and
  sensitive-domain floors. Quick selects one combined planning/decomposition
  pass; standard selects one PM perspective; deep retains competing PMs and
  arbitration. The envelope records factors, selected/skipped passes,
  model/effort, and the pre-execution cost estimate; prompt length is not an
  input.
- Gate applies as always — interactivity doesn't change the approval
boundary; the human approving in-terminal *is* the approval surface for any
critical op raised live (recorded to the same audit log).
- First product-development use: sandbox co-planning against
  operon-sandbox-alpha. Civic co-planning is deferred until production
  onboarding after the product is build-complete.



## 9. Greenfield creation and Bootstrap

Greenfield products start one step earlier than existing-app bootstrap. Both
paths require a complete active org created with `operon org init`:

Readiness claims use this evidence ladder; it does not add registry states or
replace `onboarding | live | paused`:

1. **Generated:** local app/org artifacts exist; registry, remote, runtime,
   and schedule claims do not follow.
2. **Registered:** the org registry and app-owned config agree; the app is
   still onboarding.
3. **Runtime-ready:** deterministic verification proves refs, ancestry,
   managed clone, authority/config hashes, app checks, locks/approvals, and
   required adapters.
4. **Live:** the human-selected registry state permits ordinary manual and
   dispatch work; scheduler installation is not implied.
5. **Autonomously scheduled:** the correct org-scoped scheduler is installed,
   healthy, and producing attributable due/executed/skipped/blocked evidence.

The lifecycle transaction belongs to `src/org`; reporting and observation only
project the evidence. `new-app` reaches generated, and successful bootstrap
reaches registered. Neither command alone proves runtime-ready, live, or
autonomously scheduled.

```
operon new-app "marketplace for dummy products" \
  --name marketplace \
  --target-dir ~/Build/marketplace \
  --repo owner/marketplace
```

`new-app` is deterministic and local. It creates a separate target app repo
skeleton, starter product truth (`docs/VISION.md`, `docs/REQUIREMENTS.md`),
starter architecture/runbook/testing docs, a strict TypeScript web shell, an
initial GitHub issue body under `.operon/bootstrap/`, and a Planner seed under
`.operon/planning/`. It then calls the same bootstrap/register implementation
described below, so greenfield and existing-app onboarding converge at the
`.operon/` contract and `apps.yaml` registry. If Support or Marketing channels
are supplied, they are preserved in the org registry so channel-presence gating
can fire those roles.

`new-app` does not create a GitHub repo, push code, publish marketing content,
or run the Planner. Those are explicit follow-up operations recorded in the
generated `.operon/bootstrap/next-commands.md`: create the private repo, push
the scaffold, create the initial `op:ready` issue, optionally run
`operon plan <app> --topic ...`, then run the normal loop.

```
operon bootstrap        # run inside the product repo
```

1. **Learn.** Scan the GitHub-backed repo: language/build/test commands
  (manifests, CI config), documentation inventory grouped by onboarding
  category, existing agent docs (CLAUDE.md / AGENTS.md), and deploy hints
   (Dockerfiles, DNS/IaC). Bootstrap never runs agents during scan.
2. **Questionnaire.** Interactive alignment pass with the user: what the
  product is and what "good" means (→ app charter); which roles to enable;
   budget; cadence; app-specific critical ops (deploy commands, publish
   targets, secret locations — these extend the gate's rule set for this
   app); support/marketing channels if any; and whether app authority inherits
   the org grant, selects conservative, or adds custom restrictions.
3. **Emit app-owned artifacts.**
  - `.operon/TASTE.md` — the app charter (layer [3]);
  - `.operon/AUTHORITY.md` — the effective, content-bound authority snapshot;
  - `.operon/config.yaml` — the app's registry entry (apps.yaml schema);
  - `.operon/policy.yaml` — the app-owned quality-gate policy;
  - `.operon/onboarding-report.md` — deterministic documentation/setup
  inventory and gap report;
  - `.operon/memory/<role>/INDEX.md` — seeded empty bundles.
  - marked blocks in root `AGENTS.md` and `CLAUDE.md` — safe composition,
    never replacement, pointing top-level harnesses at the app snapshot.
4. **Register / join.** Resolve the complete active org through explicit
  `--org-home`, `OPERON_ORG_HOME`, or `~/.operon/config`, then add the app to
  its `apps.yaml` as `status: onboarding`. If no org resolves, stop before
  writing and direct the operator to `operon org init`; bootstrap never emits
  a parallel `.operon/org/` configuration.

Bootstrap inventories documentation and setup signals; it does not infer
authoritative product, architecture, or roadmap truth from source code. App
owners bring those source-of-truth docs. The onboarding report may suggest
missing categories, but gaps are guidance, not blockers unless app config or
policy makes them so.

Before normal bootstrap reports success it parses the emitted registry,
policy, and authority metadata and checks every generated text artifact for a
final newline, trailing whitespace, and Git formatter errors. With a resolved
state home it also stores the normalized non-secret questionnaire record for
future reset recovery. Recovered bootstrap writes only to an Operon-managed
clone, creates a deterministic onboarding commit, records the remote default
base and source checkout fingerprint, and leaves the human checkout branch,
HEAD, index, tracked changes, and untracked files untouched.

## 10. GitHub substrate conventions



### Labels — the ticket state machine


| Label              | Meaning                                      | Set by                                              |
| ------------------ | -------------------------------------------- | --------------------------------------------------- |
| `op:ready`         | ticket is buildable as specified             | Planner (or human)                                  |
| `op:building`      | claimed; branch/PR in progress               | Builder turn (claim = atomic `ready→building` swap) |
| `op:in-review`     | PR open, review cycle running                | loop, after PR exists                               |
| `op:returned`      | bounced to Planner (max cycles / infeasible) | loop                                                |
| `op:blocked`       | waiting on approval-queue decision           | loop, on `blocked_on_gate`                          |
| `op:incident`      | SRE incident note                            | SRE                                                 |
| `p1` / `p2` / `p3` | priority (dispatch order within events)      | Planner                                             |


Transitions follow §3's artifact-before-label rule; ticket close comes from
the squash-merge's `Closes #N`, never a manual state.

### Ticket format (what the Planner emits)

Fixed headings, parseable by heading, human-first:

```markdown
Title: imperative, one concern (one ticket = one PR, TASTE §5)

## Goal            — what exists after this ships, one paragraph
## Context         — why now; links to feedback/digests/prior art
## Acceptance criteria   — checklist; each item mechanically checkable
## Out of scope    — the temptation fence
## Notes for the builder (optional) — pointers, not prescriptions
```



### Branches, PRs, reviews

- Branch: `op/<issue>-<slug>` from main; one branch per ticket; worktree ↔
branch 1:1 (§3).
- PR: title `<type>: <summary> (#<issue>)` — in v1 the builder loop always
emits the literal `build:` type (`prTitle` in `src/loop/loop.ts` is hardcoded;
a variable type is a later change); body = What / Why, **Evidence**
(pasted test output — TASTE §6), `Closes #<issue>`. Draft on first push;
ready when the Builder declares done.
- Review: verdict as a real GitHub review (APPROVE / REQUEST_CHANGES) plus a
structured findings comment — numbered findings, each must be resolved or
explicitly rebutted before merge (TASTE §8). Findings ride to the fix turn
as context. Single-account pilot caveat: GitHub forbids approving your own
PR, so a same-account approval lands as a marked COMMENTED review — trusted
only when its `operon:self-approval-fallback` marker carries a verifying
HMAC signed with an orchestrator-only secret, plus a structured
`Verdict: approve` and commit freshness. No secret configured = fail
closed; a bare marker is never trusted (`docs/loop.md` §6).
- Merge: squash-merge only, performed by the loop after APPROVE; branch
deleted; PR description survives as the commit body (state-in-markdown, a
predecessor pattern).



## 11. Ratified decisions promoted to docs/PURPOSE.md

Decisions 1–10 were ratified by the human operator beginning 2026-07-06;
decision 11 was ratified on 2026-07-13. All are promoted to docs/PURPOSE.md:

1. **Tick dispatcher, detached turns.** Stateless `operon dispatch` tick
  (launchd/systemd, ~5 min); turns spawn detached so schedulers never kill
   work; events by GitHub polling + file-drop inbox in v1 (webhook parity
   later without dispatcher changes).
2. **Approve ≠ execute — grants.** Queue approval mints an expiring,
  action-hashed grant consumed by the gate on re-dispatch; the orchestrator
   never replays tool calls itself. Amended 2026-07-10 (approval & release
   amendment, ratified): single-use stays the default, and the human may
   widen a decision to a rule+path-scoped ticket/app grant with TTL,
   use-count cap, revocation, and per-use audit rows; self-merge, deploys,
   and protocol-surface writes are never scopeable.
3. **Idempotency contract** (§3): durable product effects are git/GitHub ops;
  artifact-before-label; claims are label flips; durable orchestration records
  are append-only and identity-keyed. P0-07 later clarified that accepted
  non-git episode artifacts also survive interruption.
4. **Org-managed clones.** The org works only in its own clones/worktrees
  under `~/.operon/`; GitHub is the sole sync point with the human's
   checkouts.
5. **Superseded 2026-07-09:** the `.operon/org/` single-app sublayout. The
  packaging/onboarding reconciliation now requires a separate complete org
  home; app repos contain app-owned `.operon/` artifacts only.
6. **Merge is loop-owned.** The orchestrator squash-merges after APPROVE;
  agents never merge.
7. `manual` **trigger kind** for co-planning; interactive Anthropic-native
  v1.
8. **The loop-engineering decisions** in `docs/loop.md` §11 (added
  2026-07-04 after design review with the human): orchestrator-owned pass
   pipelines; mechanical quality gates distinct from the safety gate;
   planning as a Planner pipeline, not a loop phase; assembled briefs;
   ticket-level parallelism only; loud orchestrator failures; risk-selected
   review dimensions with security always-on; acceptance criteria as a
   ratified quality contract.
9. **Containment invariant.** Operon's footprint in an app repo is exactly
  `.operon/` (plus transient `op/*` branches and `op:*` labels); nothing
   Operon-specific elsewhere in the app's tree; `.operon/config.yaml`
   carries `schema_version` from day one.
10. **Company-lifecycle events ride the file-drop inbox** (§2): external
  producers write event JSON; the dispatcher's trigger mechanism is
  unchanged. Enumerating producers per role is roadmap work.
11. **Efficiency control-plane ownership** (ratified 2026-07-13; P0-01 through
   P0-09): the episode owns admission and route history; `src/loop` owns shared
   execution-economy primitives, `src/org` owns organizational lifecycle,
   `src/runtime` executes and settles, and report/observe remain read-only.
   Legacy deep-planning and 60-minute fallbacks are implementation history,
   not policy; `docs/efficiency.md` is the sole numeric authority.



## 12. Open questions

1. **Codex context channel — resolved 2026-07-06.** Codex App Server exposes
   `developerInstructions` on `thread/start` and `thread/resume`; Operon uses
   that native channel. The worktree overlay fallback remains only for
   runtimes that need files (pi uses `.pi/APPEND_SYSTEM.md`).

Resolved 2026-07-06: Support/Marketing stay disabled per app until channels
exist; defaults confirmed as `max_concurrent_turns: 2`, grant TTL 24 h,
dispatch tick 5 min, loop `maxCycles: 3`.
