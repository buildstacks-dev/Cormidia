# OPERON-BND-009 — Local orchestration state ↔ GitHub

Status: **Ratified — 2026-07-29**

Traces: J-03–10, J-13; OPERON-INV-001–010.

## Contract

### 1. Valid input domain

- A GitHub operation has one org/app/repository, resolved remote default
  branch, authenticated actor, accepted-plan/effect identity, exact ref or
  content payload, and idempotency marker where the operation mutates state.
- Reads name the repository and required freshness/consistency expectation.
- Guessed default branches, foreign repos, stale reviewed commits, malformed
  remote identity, missing authorization, and payload/binding mismatch are
  invalid.

### 2. Output guarantees

- Reads return typed GitHub facts with repository/ref identity and observation
  time; absence, permission denial, and transport failure remain distinct.
- Mutations return or reconcile a stable remote identity and exact accepted
  content/ref.
- GitHub owns ticket, PR, review, check, ref, merge, and remote-effect facts;
  local journals own orchestration decisions. Neither silently overwrites the
  other's domain.

### 3. Error and recovery behavior

- Authentication, authorization, rate limit, unavailable, not found,
  conflict, stale ref/review, validation, and timeout-after-possible-write are
  typed separately.
- A timeout after possible mutation becomes ambiguous until reconciliation by
  stable remote marker/identity.
- Concurrent human/CI changes are observed as drift or conflict, not silently
  overwritten.

### 4. Idempotency and retry

- Mutations use stable operation/content identities. Recovery searches for the
  exact remote marker before attempting an effect again.
- Issue/comment/review/merge/publication operations are not retried under a new
  identity merely because acknowledgement was lost.

### 5. Timing, ordering, and freshness

- Artifact creation precedes the GitHub state marker/label that announces it.
- Reads used for irreversible decisions specify and prove required commit/ref
  freshness.
- GitHub event/poll ordering is not assumed global; reconciliation uses stable
  identities and observed revisions.

## Controlled-seam obligations

The stateful GitHub seam must model auth/rate errors, timeout-after-write,
stale reads, concurrent labels/refs, changing default branch, PR/check/review
state, stable remote markers, and eventual acknowledgement. Real GitHub
behavior remains a separately authorized disposable-repo obligation.
