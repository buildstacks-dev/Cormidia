# Contract — B-08 Dispatcher tick ↔ detached turn
Canonical ID: **CORMIDIA-C-B08-001 (alias: B-08)**

Status: DRAFT (Phase 4). Defends INV-005/007/014, T-5/T-6. Journeys J-09/J-13/J-18.

## 1. Valid inputs
- A tick reads: roles.yaml triggers, apps.yaml cadence/status, schedule and due-window
  claim state, consumed events, budget overlay, locks, WIP count, and deterministic
  actionable-input summaries. "Due" is arithmetic; paid-turn eligibility is a
  token-free preflight, never provider judgment `[doc]`.

## 2. Output guarantees
- Every considered (app, role, trigger, window) terminates in a durable named reason
  from the ratified vocabulary, which is **CLOSED** (F-PT-034, owner ruling
  2026-08-12): exactly `executed`, `no_due_work`, `no_actionable_input`, `not_due`,
  `already_claimed`, `already_settled`, `explicit_retry`, `retry_exhausted`,
  `fresh_lock`, `wip_limit`, `budget_paused`, `approval_blocked`, `channel_gated`,
  `no_subscriber`, `empty_learning_window`, `missed_window_reconciled`,
  `spawn_failure`, `post_spawn_bookkeeping_failure`, `scheduler_definition_failure`,
  `scheduler_state_failure` — the same 20-member set as the Execution/admission row
  of `docs/scheduler/design.md` → "Outcomes and reason codes", which remains the
  canonical table; adding a member is a contract revision, never an in-code addition.
  A malformed schedule/trigger definition terminates as
  `scheduler_definition_failure` and corrupt or unreadable scheduler state as
  `scheduler_state_failure` — validated non-admission with durable evidence, never a
  thrown crash (implemented 2026-08-12 under HB-142) `[doc]` (INV-014).
  <!-- changelog 2026-08-12 (HB-142 landing): "implementation owed under
  HB-142" → implemented; the admission seam now routes both, red-then-green in
  tests/hermetic/cf-c-b08-cf-j09-a-cf-j09-i-cf-j09-r-cf-j09-s/. -->
  <!-- changelog 2026-08-12 (F-PT-034): list closed per owner ruling; it previously
  ended open with an ellipsis while the design doc's table was already closed, and
  the two scheduler_* members existed in the design doc and product type but not
  here. Tighten-only: an open enumeration became exact. -->
- The spawn decision is durably committed **before** the child starts `[doc]`.
- A scheduled due window has one content-bound claim/commit/settle identity; a later
  ordinary tick observes it and cannot retry it. A dead pre-commit owner is reclaimed
  under the same attempt, and one operator-requested retry is bounded under the same
  settlement identity.
- The two asymmetric crash outcomes are distinct, named states — decision-without-child
  (`spawn_failure`) vs child-without-bookkeeping (`post_spawn_bookkeeping_failure`);
  the latter must prevent duplicate-spawn on the next tick via the child's own durable
  claim/lock evidence `[elicited]`.

## 3. Error behavior
- A tick that cannot read its inputs does less, never more (INV-015): unreadable budget
  state → no admission; unreadable schedule → no spawn, durable anomaly.
- Lock contention: fresh heartbeat → skip with `fresh_lock`; stale → recovery path, not
  concurrent start (INV-005).

## 4. Idempotency
- One event wakes a role exactly once per (event, role) mark `[doc]`.
- Missed windows reconcile to one firing with count (B-06).
- Two concurrent ticks (double-fire): admission and lock acquisition are atomic — at
  most one spawns per (role, app); the loser records a named reason.

## 5. Timing
- **Configured** cadence ~5 min `[doc]` <!-- changelog 2026-08-10 (reader test 17,
  new-engineer finding 3): figure was untagged while WIP=2 was tagged; provenance
  verified — docs/architecture.md "fires every ~5 min" --> (not guaranteed firing — B-05); org WIP limit 2 `[doc]`; a turn may run for hours across many ticks.
