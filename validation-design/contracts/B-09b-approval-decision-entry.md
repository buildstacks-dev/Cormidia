# Contract — B-09b Human/CLI ↔ approval store (decision-entry seam)
Canonical ID: **CORMIDIA-C-B09B-001 (alias: B-09b)**

Status: DRAFT (Phase 4). Defends INV-003, T-2. Journey J-05.
<!-- changelog 2026-08-06 (harness-revision, F-PT-023 ratified #296): disposition-tier
decision boundary and the objective-grant creation/coverage clauses added (§1a/§2a);
everything else unchanged. -->

Ownership: human = actor + authority (decision intent); CLI/approval store = state
writer that validates and persists the durable decision.

## 1. Valid inputs
- One org-wide queue, items app-tagged; decisions one-by-one: approve or deny **with
  reason**; same-rule batch review allowed with unchanged per-item audit rows (A3
  `[doc]`).
- Widening at decision time is human-only, into the A1 scoped-grant shape (INV-003
  branch b). An agent-submitted widening is unrepresentable. Widening and agent
  deciders are refused for every rule whose ratified tier is `human-only` or
  `un-grantable` (`RULE_DISPOSITION_TIERS`, the derived NEVER_SCOPEABLE boundary).
- Invalid decision input (unknown item, malformed scope) → typed refusal; store
  unchanged.

## 1a. Objective grants (INV-003 branch c; #296 Stage 3)
- Creation is human-facing-CLI-only: an agent-namespaced identity is a typed refusal;
  the gate classifies in-turn `cormidia objective grant|grant-critical|revoke` as
  `approval-store-tamper`.
- A grant names `grantable`-tier classes explicitly (no wildcard, no unknown rule), or
  exactly one `human-only` class through the §4.1 ceremony verb with a bounded scope,
  optional precondition, and TTL/use caps **strictly below** the ordinary defaults
  (24 h / 20 uses). `un-grantable` classes are rejected at creation and refused at
  use, whatever is on disk. `outwardEffects` is invariantly false.
- Coverage at use requires: same app, live (unexpired, unrevoked), uses remaining,
  ledger total strictly under the ceiling, and the rule's PRESENT tier matching the
  list it appears in. Every covering use decrements and appends a per-use audit row.
- Ledger debits land BEFORE execution under the per-grant lock; a debit that would
  cross the ceiling refuses and raises exactly one `objective-budget-exceeded` item
  (key `objective-budget:<grantId>`); the ceiling is raisable only by a human editing
  the grant, defaulting from apps.yaml `objective_budget_usd` (never hardcoded).

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
