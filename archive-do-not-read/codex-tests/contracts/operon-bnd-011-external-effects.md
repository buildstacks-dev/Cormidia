# OPERON-BND-011 — Effect executor ↔ deployment/publication target

Status: **Ratified — 2026-07-29**

Traces: J-08–09, J-11, J-13; OPERON-INV-001–002, OPERON-INV-006–011.

## Contract

### 1. Valid input domain

- An effect request carries one stable operation identity, exact target,
  content/payload hash, source artifact revision, actor, content-bound
  unexpired authority, and target-specific idempotency/reconciliation marker.
- A broad grant cannot stand in for exact authorization where the effect is
  external publication, deployment, or otherwise never-scopeable.
- Changed payload/target/base revision, missing grant, unsupported target,
  consumed/revoked authority, or unknown idempotency behavior is invalid.

### 2. Output guarantees

- One authoritative lifecycle records `approved → executing →
  executed | failed | ambiguous`.
- `executed` includes an acknowledgement/remote reference proving the exact
  target effect. Approval alone is never execution evidence.
- Failure and ambiguity retain attempt, cause, known remote facts, and the
  permitted next action.

### 3. Error and recovery behavior

- Authentication, authorization, target rejection, transport failure,
  timeout-after-possible-effect, acknowledgement loss, and target drift remain
  distinct.
- An unknown remote outcome becomes `ambiguous`; automatic blind retry is
  forbidden.
- Human reconciliation is required when the target cannot prove effect
  identity.

### 4. Idempotency and retry

- One approval/action identity authorizes one effect transaction.
- Replay first reconciles the stable marker; it completes or no-ops when the
  target proves the effect.
- A retry after explicit reconciliation is a recorded attempt under the same
  authoritative lifecycle, not a new silent effect.

### 5. Timing, ordering, and freshness

- Authorization and durable effect intent precede execution.
- Terminal acknowledgement follows the target response/reconciliation and
  names observation time.
- Source artifact/approval freshness is revalidated immediately before claim;
  a changed source invalidates the effect.

## Controlled-seam obligations

Simulate success, rejection, timeout-before-effect, timeout-after-effect,
lost acknowledgement, duplicate call, stale target state, marker lookup, and
reconciliation. Real target protocol remains a separately authorized staging
obligation.
