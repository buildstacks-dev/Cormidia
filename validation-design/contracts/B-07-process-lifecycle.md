# Contract — B-07 OS process lifecycle (sealed seam)
Canonical ID: **OPERON-C-B07-001 (alias: B-07)**

Status: DRAFT (Phase 4). Defends INV-005/013/014, T-6. Journeys J-09/J-13.

## 1. Valid inputs
- Spawn: journal entry durably written before detach. **Semantic contract: liveness
  identity survives PID reuse** — bare pid is insufficient; the mechanism (e.g. a
  (pid, start-time) pair) is **PROPOSED**, not product truth; owner: human; expiry:
  first harness build review.

## 2. Output guarantees
- A live child maintains its lock heartbeat (30 s cadence `[doc]`); freshness: <2 min =
  fresh, older = recovery path `[doc]`; the 10-min threshold applies only to the
  destructive `--force` condition (B-06).
- Kill at any phase leaves the journal readable and the last synchronous phase entry
  intact (INV-013).

## 3. Error behavior
- "Child exited" is never the whole answer — the caller must determine **how far the
  child got** from journal + durable artifacts, not exit status alone `[elicited]`.
- Signal racing a terminal write: the journal's recognized-intermediate rule applies;
  recovery reconciles, never assumes.
- Orphaned descendants — **semantic contract: terminate the owned descendant tree**;
  the mechanism (own process group, group-targeted cleanup) is **PROPOSED**; owner:
  human; expiry: first harness build review.

## 4. Idempotency
- Liveness checks are read-only; dead-process reconciliation (journals → `interrupted`)
  is idempotent and keyed by turn/invocation identity `[doc]`.

## 5. Timing
- Detached turns outlive ticks by design; no supervisor exists — the next tick is the
  recovery actor `[doc]`.
- Laptop sleep/wake: L5 obligation (Phase 6), not simulated away here.
