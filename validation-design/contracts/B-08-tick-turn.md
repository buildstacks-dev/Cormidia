# Contract — B-08 Dispatcher tick ↔ detached turn
Canonical ID: **CORMIDIA-C-B08-001 (alias: B-08)**

Status: DRAFT (Phase 4). Defends INV-005/007/014, T-5/T-6. Journeys J-09/J-13/J-18.

## 1. Valid inputs
- A tick reads: roles.yaml triggers, apps.yaml cadence/status, schedule state, consumed
  events, budget overlay, locks, WIP count. "Due" is arithmetic, never judgment `[doc]`.

## 2. Output guarantees
- Every considered (app, role, trigger, window) terminates in a durable named reason
  from the ratified vocabulary (`executed`, `no_due_work`, `fresh_lock`, `wip_limit`,
  `budget_paused`, `approval_blocked`, `channel_gated`, `no_subscriber`,
  `empty_learning_window`, `missed_window_reconciled`, `spawn_failure`,
  `post_spawn_bookkeeping_failure`, …) `[doc]` (INV-014).
- The spawn decision is durably committed **before** the child starts `[doc]`.
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
- **Configured** cadence ~5 min (not guaranteed firing — B-05); org WIP limit 2 `[doc]`; a turn may run for hours across many ticks.
