# OPERON-BND-002 — Shared installation/selector ↔ isolated org scope

Status: **Ratified — 2026-07-29**

Traces: J-02, J-04–12; OPERON-INV-001–003, OPERON-INV-010–011.

## Contract

### 1. Valid input domain

- An org-scoped operation receives one valid committed org home and its exact
  state home, whether explicitly supplied or safely resolved for an
  interactive command.
- Scheduled/background execution requires explicit org and state homes; it
  does not inherit an interactive active-org pointer.
- A mismatched org id/path/state home, ambiguous pointer, duplicate identity,
  or foreign lock/approval/state artifact is invalid.

### 2. Output guarantees

- Resolution returns exactly one immutable org identity and explicit paths for
  the invocation.
- Every durable work identity, budget, scheduler, secret, approval, and
  learning artifact remains namespaced to that org.
- Failure of org A cannot change the readiness, state, or secrets of org B.

### 3. Error and recovery behavior

- Missing, invalid, or mismatched scope fails closed before any org mutation or
  provider work.
- Changing the active pointer affects only later interactive resolutions; it
  cannot rebind an in-flight or recovering invocation.
- One org's corrupt state is reported against that org and does not cause a
  shared global repair.

### 4. Idempotency and retry

- Org-scoped identifiers and idempotency keys include the immutable org
  identity; equal local names in two orgs do not alias.
- Retrying a scoped operation resolves the original recorded org, not the
  current interactive default.

### 5. Timing, ordering, and freshness

- Org resolution is pinned before the first scoped read/write and remains
  stable for the invocation.
- Concurrent org operations may interleave but may not share locks, WIP
  counters, settlements, or approval identities unless an explicit
  installation-level contract later authorizes it.

## Controlled-seam obligations

Compose one installed implementation with multiple real temporary org/state
homes. Inject pointer changes, simultaneous invocations, identifier
collisions, foreign artifacts, and per-org permission failure.
