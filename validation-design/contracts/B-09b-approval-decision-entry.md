# Contract — B-09b Human/CLI ↔ approval store (decision-entry seam)
Canonical ID: **CORMIDIA-C-B09B-001 (alias: B-09b)**

Status: DRAFT (Phase 4). Defends INV-003, T-2. Journey J-05.

Ownership: human = actor + authority (decision intent); CLI/approval store = state
writer that validates and persists the durable decision.

## 1. Valid inputs
- One org-wide queue, items app-tagged; decisions one-by-one: approve or deny **with
  reason**; same-rule batch review allowed with unchanged per-item audit rows (A3
  `[doc]`).
- Widening at decision time is human-only, into the A1 scoped-grant shape (INV-003
  branch b). An agent-submitted widening is unrepresentable.
- Invalid decision input (unknown item, malformed scope) → typed refusal; store
  unchanged.

## 2. Output guarantees
- Every decision persists: exact content binding, decider identity, timestamp, reason,
  scope shape (once | scoped{rule/path, app/ticket, TTL, use-cap}); audit log
  append-only.
- Deciding never executes (INV-003): the only post-decision actors are the continuation
  seam (B-09a) and the typed executor (B-17).

## 3. Error behavior
- Concurrent decisions on one item: first durable write wins; the second receives a
  typed already-decided outcome (never two grants).
- Revocation mid-wait: takes effect before any later use; uses after revocation are
  refused with audit.

## 4. Idempotency
- Re-submitting an identical decision is a no-op with reference to the original;
  decision records are immutable once written.

## 5. Timing
- Grant TTL 24 h default `[doc]`; expiry produces a typed state, not silence.

## Unattended-L3 cross-reference (prohibition)
The human seam is never a runtime dependency of an unattended campaign. Mechanism: the
ratified sandbox-only test-policy profile (canonical: validation-policy.yaml) — zero
human decisions on the allowed path; **never forge human decisions under a robot
identity**; evidence proves profile identity, sandbox target, permitted auto-grant
categories, zero human decision rows; external publication and non-sandbox effects stay
blocked. `[elicited]` `[doc: PURPOSE v2.9]`
