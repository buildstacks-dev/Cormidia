# OPERON-BND-007 — Runtime envelope ↔ harness/model/auth/quota

Status: **Ratified — 2026-07-29**

Traces: J-03–09, J-11–13; OPERON-INV-003–010.

## Contract

### 1. Valid input domain

- Every provider invocation receives one complete `TurnRequest`, one atomic
  `{harness, model, effort}` assignment, explicit role/tool authority, bounded
  context, required capability profile, and admitted budget.
- The selected assignment is configured, app-allowed, qualified, currently
  available by bounded non-billable evidence, and compatible with the required
  output/capabilities.
- Missing auth/quota/capability, unknown models, partial tuple substitution,
  over-budget admission, malformed context, or an unapproved alternative are
  invalid.

### 2. Output guarantees

- `[stated]` Claude, Codex, pi, and every future harness normalize into the
  same versioned Operon `TurnResult` contract regardless of provider-native
  format.
- The result carries one truthful terminal status, typed error when present,
  normalized output/verdict payload, session identity when available, tool and
  escalation events, and monotonic usage with explicit quality
  (`complete | partial | estimated | unavailable`).
- Denied tool actions surface as escalations; provider failures are evidence,
  never successful zero-token work.
- A pass-specific structured verdict is validated before orchestration acts on
  it. Unparseable output after the bounded repair path is infrastructure
  failure, never merit pass or fail.

### 3. Error and recovery behavior

- Auth, quota/rate limit, unavailable model, transport timeout, cancellation,
  malformed output, budget exhaustion, missing usage, and internal adapter
  failure remain typed and distinct.
- Missing/partial/unavailable usage is never coerced to zero and blocks unsafe
  further spend.
- Provider backup may select only a complete alternative assignment already
  pre-authorized by the accepted plan. Silent substitution is forbidden.
- A different assignment cannot claim provider-native session continuity it
  does not possess.
- `OPEN (PTF-011/AF-007/AF-008)`: failover order/triggers, portable handoff,
  quality requirements, budget impact, notice, and separately authorized
  replanning remain unsettled.

### 4. Idempotency and retry

- A provider turn is not generically retry-safe. Each actual invocation has a
  unique execution identity and exactly one settlement.
- Same-assignment native session resume is allowed only when the complete
  binding remains valid. A new provider invocation is recorded as a new turn,
  even if it repairs formatting or retries transport.
- Pre-authorized fallback cannot reuse the failed turn's settlement or report
  itself as the same native session.

### 5. Timing, ordering, and freshness

- Progress callbacks are monotonic and carry current usage/session evidence.
- Admission and assignment persistence precede runtime construction.
- Provider timeout/turn ceilings come from the accepted plan/policy; no adapter
  silently extends them.
- Availability/qualification evidence must be current at admission; the exact
  freshness window is an `OPEN` boundary-contract parameter.

## Controlled-seam obligations

The scripted harness/provider must expose every normalized result field and
simulate auth, quota, unavailable model, timeout, cancellation, malformed
output, partial tool effects, session resume, usage quality, budget crossing,
and pre-authorized alternatives. Real provider auth/quota/native sessions stay
in separately authorized Layer 3; judgment quality belongs to Phase 5.
