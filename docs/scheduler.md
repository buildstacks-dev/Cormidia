# Scheduler lifecycle and evidence

This document is the canonical contract for Operon's scheduler definition,
identities, durable evidence, reason codes, and health semantics. The scheduler
is an org-scoped host trigger for the ordinary stateless `operon dispatch`
boundary. It is not a daemon, workflow engine, provider runtime, or replacement
for turn journals, locks, approvals, budgets, continuation, or telemetry.

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
└── planner-feeds/<feed-id>.json
```

All scheduler evidence is `schema_version: 1`, canonical-key JSON, and sorted
on read, making projections deterministic and byte-stable. Initial identity
publication uses exclusive create semantics; later stage transitions use
atomic replacement. Corrupt/torn records fail closed and stay named in health
output.

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
not execution evidence.
