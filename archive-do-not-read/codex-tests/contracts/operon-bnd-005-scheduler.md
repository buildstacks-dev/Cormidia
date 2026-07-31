# OPERON-BND-005 — Host scheduler/process manager ↔ dispatcher

Status: **Ratified — 2026-07-29**

Traces: J-04, J-06–07, J-09, J-11–12; OPERON-INV-001–005,
OPERON-INV-009–010.

## Contract

### 1. Valid input domain

- A scheduled invocation carries an owned scheduler definition, immutable org
  identity, explicit org/state homes, executable identity, cadence window, and
  supported host backend.
- A manual dispatch invocation is valid without an installed scheduler but
  still requires valid org scope.
- Malformed, foreign, wrong-org, wrong-home, wrong-executable, unsupported, or
  ownership-mismatched definitions are invalid.

### 2. Output guarantees

- Every observed due window yields one attributable invocation and each due
  decision reaches one typed terminal outcome: executed, skipped, blocked,
  missed/reconciled, or failed.
- The host decides when to invoke; Operon alone decides due work, admission,
  and what the episode may do.
- A spawned child has one durable decision/episode identity even if
  post-spawn bookkeeping fails.

### 3. Error and recovery behavior

- Missing/inactive/stale/corrupt manager state is reported distinctly from
  “no due work.”
- Host sleep or missed windows produces one reconciled firing with missed
  counts, not backfill of every interval.
- Fresh locks cause a typed skip; stale locks enter recovery only after
  liveness checks. Corrupt state fails closed.

### 4. Idempotency and retry

- Stable identities derive from org, cadence window, app, role, trigger, and
  source event—not enumeration order or process randomness.
- Duplicate host invocations and retry after spawn cannot create a second
  child for the same decision.

### 5. Timing, ordering, and freshness

- The configured cadence, not a hardcoded default, defines due windows.
- Decision evidence is durable before crossing lock/journal/spawn boundaries.
- Scheduler health states the latest completed tick, overdue/missed windows,
  and measurement validity; definition presence alone is never “healthy.”

## Controlled-seam obligations

Control clock, sleep/skew, host-manager state, duplicate invocation, spawn
outcome, lock liveness, and bookkeeping failure. Actual launchd/systemd
semantics remain a separately authorized disposable-host obligation.
