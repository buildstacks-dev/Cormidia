# OPERON-BND-006 — Autonomous work ↔ human decision availability

Status: **Ratified — 2026-07-29**

Traces: J-04–09, J-11–13; OPERON-INV-004–008, OPERON-INV-010–011.

## Contract

### 1. Valid input domain

- An escalation decision packet is content-bound to the exact org/work scope,
  action, payload, actor/context, current practice, requested deviation,
  consequences, and approve/deny effect.
- Only an attributable human may approve, deny, widen scope, revoke, or
  reconcile an ambiguous effect.
- Opaque, incomplete, stale, mismatched, self-approved, expired, or foreign
  decision inputs are invalid.

### 2. Output guarantees

- The human decision becomes one durable approved or denied record. Approval
  may mint only the exact permitted grant; it is not execution evidence.
- A pending decision blocks only DAG branches/effects that depend on it.
  Independent authorized work remains eligible under normal WIP/budget policy.
- The queue exposes decision context and later execution state without forcing
  the human to reconstruct opaque references.

### 3. Error and recovery behavior

- Human absence leaves the item pending and dependent work in a governed wait;
  it does not create approval, denial, timeout-success, or global org failure.
- Context/payload drift voids the decision binding and requires a fresh
  decision.
- Interrupted decision/grant persistence reconciles without producing a
  decision lacking its authorization record.
- `OPEN (PTF-010/AF-011)`: queue-size backpressure, fairness, aging,
  prioritization, and alert thresholds are not yet ratified.

### 4. Idempotency and retry

- One decision identity yields one authoritative result. Reopening the same
  unchanged item shows that result rather than minting duplicate grants.
- Repeated materially identical escalation after unchanged denial is measured
  and cannot silently bypass the prior outcome.

### 5. Timing, ordering, and freshness

- No human response-time promise is assumed.
- Decision is durable before dependent work becomes eligible.
- Revocation or binding drift observed before effect claim prevents execution;
  after claim, the typed effect lifecycle governs reconciliation.

## Controlled-seam obligations

Simulate an absent/delayed human, approve/deny/revoke, interrupted persistence,
stale context, queue growth, and DAGs containing both dependent and independent
ready work. Human comprehensibility is evaluated statistically in Phase 5.
