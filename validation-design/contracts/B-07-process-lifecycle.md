# Contract — B-07 OS process lifecycle (sealed seam)
Canonical ID: **CORMIDIA-C-B07-001 (alias: B-07)**

Status: DRAFT (Phase 4). Defends INV-005/013/014, T-6. Journeys J-09/J-13.

## 1. Valid inputs
- Spawn: journal entry durably written before detach. **Semantic contract: liveness
  identity survives PID reuse** — bare pid is insufficient. **Human-ratified at
  HB-007 review 2026-07-31:** identity is PID + process-start identity + nonce, so a
  reused PID cannot impersonate the recorded holder.

## 2. Output guarantees
- A live child maintains its lock heartbeat (30 s cadence `[doc]`); freshness: <2 min =
  fresh, older = recovery path `[doc]`; the 10-min threshold applies only to the
  destructive `--force` condition (B-06).
- Kill at any phase leaves the journal readable and the last synchronous phase entry
  intact (INV-013).
- The productive journal path is forward-only
  `assembling → running → collecting → done`; same-phase replay is idempotent,
  productive-phase skips are refused, and error terminals may record the phase in
  which execution stopped. This guard is implemented in the journal writer, not
  inferred by readers.

## 3. Error behavior
- "Child exited" is never the whole answer — the caller must determine **how far the
  child got** from journal + durable artifacts, not exit status alone `[elicited]`.
- Signal racing a terminal write: the journal's recognized-intermediate rule applies;
  recovery reconciles, never assumes. The replacement harness exercises every
  productive phase with a real SIGKILL and a non-empty marker walk.
- Orphaned descendants — **semantic contract: terminate the owned descendant tree**;
  **human-ratified at HB-007 review 2026-07-31:** use an owned process group/session;
  TERM, wait a bounded grace period, then KILL; completion evidence proves no owned
  descendants remain. **The grace-period DURATION deliberately carries no figure**
  <!-- changelog 2026-08-10 (reader test 18, new-engineer finding 2): this is
  the one ratified timing clause without a number; stating the test-authoring
  rule here prevents the silent invention the rest of the corpus avoids -->:
  the ratification fixed the ORDER (TERM → bounded wait → KILL), not the wait
  length. Tests assert the sequence and that the wait is bounded (terminates),
  treating the duration as configuration — never assert a specific length. A
  concrete figure is owner-owned: it must enter the authored decision register
  in `../harness-design-state.md` and the affected checked-model facts (then
  ratification) before any
  timing assertion is written against it. Signalling is authorized only when journal and current lock
  agree on the complete PID + process-start + nonce ownership token and the OS probe
  confirms the PID/start match. Missing/mismatched/unknown ownership defers without
  signalling or recovery; PID reuse is never treated as authority to kill.
- Turn-lock acquire, adoption, heartbeat, and release are serialized by an
  atomically installed, nonce-owned mutation guard. Release compares the full
  durable ownership token while holding that guard; non-recursive guard removal
  cannot delete a successor if a prior holder finishes after reclamation.

## 4. Idempotency
- Liveness checks are read-only; dead-process reconciliation (journals → `interrupted`)
  is idempotent and keyed by turn/invocation identity `[doc]`.
- Release is idempotent and returns false when its exact PID + process-start +
  nonce + turn identity no longer owns the path; path ownership alone is never
  sufficient.

## 5. Timing
- Detached turns outlive ticks by design; no supervisor exists — the next tick is the
  recovery actor `[doc]`.
- Laptop sleep/wake: L5 obligation (Phase 6), not simulated away here.
