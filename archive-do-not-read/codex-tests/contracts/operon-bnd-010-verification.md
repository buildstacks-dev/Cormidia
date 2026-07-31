# OPERON-BND-010 — Artifact workflow ↔ CI/lab/verification systems

Status: **Ratified — 2026-07-29**

Traces: J-03, J-07–09, J-13; OPERON-INV-003–005, OPERON-INV-008–010.

## Contract

### 1. Valid input domain

- A verification request identifies one org/app/product profile, exact
  accepted artifact revision/content hash, verification operation, environment
  specification, required evidence, budget/timeout, and request identity.
- Verification output is admissible only when it binds to that same artifact,
  environment, operation, and run identity.
- Missing revision, unverifiable environment, unknown operation, stale or
  foreign evidence, and capability/budget mismatch are invalid.

### 2. Output guarantees

- A terminal result is one of passed, failed, blocked/unavailable, cancelled,
  timed out, or ambiguous/incomplete—never an untyped boolean detached from
  evidence.
- It contains exact artifact/environment/run identity, checks performed,
  evidence/artifact references, omissions, and timestamps.
- `[stated]` A tutorial lab, software CI run, or other product-specific
  verifier must normalize into this evidence envelope before it can satisfy
  review/completion.

### 3. Error and recovery behavior

- Pending, infrastructure unavailable, merit failure, stale result, missing
  artifact, corrupt evidence, timeout, and partial completion remain distinct.
- A stale or wrong-revision pass cannot satisfy the accepted plan.
- Missing/unavailable required verification yields governed wait/failure, never
  pass.

### 4. Idempotency and retry

- Repeated submission uses one verification request identity or records a new
  attempt explicitly; duplicate terminal messages deduplicate by run identity.
- Re-run evidence never overwrites the earlier attempt or changes which
  artifact it tested.

### 5. Timing, ordering, and freshness

- Evidence for an older revision may arrive later but cannot replace evidence
  required for the current accepted artifact.
- `OPEN by product profile`: maximum pending duration, artifact retention,
  lab lease lifetime, and retry allowance must be declared by each verifier.

## Controlled-seam obligations

Simulate pending, unavailable, partial, duplicate, out-of-order, stale-revision,
conflicting, timed-out, and corrupt verification evidence. Each real CI/lab
variant retains a named disposable-target obligation.
