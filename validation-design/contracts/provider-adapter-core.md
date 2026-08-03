# Contract — Provider adapter core (shared by B-02, B-03, B-04)
Canonical ID: **CORMIDIA-C-CORE-001 (alias: adapter core)**

Status: DRAFT (Phase 4 propose-then-correct). `[doc]` unless marked. Per-adapter deltas
live in B-02/B-03/B-04 files, which reference this core and never restate it.
Defends: INV-001/002/003/004/006, T-1/T-5/T-11. Journeys: any provider turn (J-03/04/06/08/18).

## 1. Valid inputs
- One `TurnRequest`: exactly one `workdir` (app-bound, INV-004); one indivisible
  `TurnAssignment {harness, model, effort}` — no member substitutable; role toolset ∩
  adapter capabilities; the composed `GateFn`; per-turn budget cap; brief bytes;
  session-resume identity when continuing.
- Invalid classes → typed refusal **before provider construction** (unknown model,
  unapproved adaptive tuple, missing workdir, absent gate). Never coercion, never
  silent fallback to a different tuple.

## 2. Output guarantees
- Always: a run envelope with terminal status ∈ {completed, failed, cancelled,
  blocked_on_gate, interrupted}; ids (app, runId, providerTurnId, session identity);
  timings. <!-- harness revision 2026-07-31: src/runtime/types.ts currently exposes
  "timed_out" instead of this ratified "interrupted" vocabulary. The implementation
  is not treated as the specification; the enum-conformance clause is
  BLOCKED:F-PT-017 pending a product-owner decision. -->
- Usage: reported **as provided or as `unknown`** — never fabricated, never zero-when-
  absent (INV-006).
- Tool events as surfaced by the provider; outcome fields (`success`, `durationMs`) only
  where the provider emits them (Codex today) — absence documented, not synthesized.
- Agent prose passed through verbatim; no adapter interprets prose into effects (INV-012).

## 3. Error behavior
- Typed, distinguished: missing launch artifact; transport failure; auth missing/expired;
  invalid model config; probe/turn timeout; malformed output; provider rate limit.
- Auth loss mid-turn: **preserve checkpoint and session identity; never discard evidence;
  recovery resumes exactly or terminates honestly** `[elicited, Phase 3]`.
- A gate denial is not an adapter error: the turn ends `blocked_on_gate` honestly.

## 4. Idempotency
- A provider turn is **never auto-retried** by the adapter; retry policy belongs to the
  orchestrator under INV-003/INV-005 rules.
- Resume binds the exact prior session; a resume that authenticates but cannot restore
  that session is a typed failure, not a fresh session (fail closed pre-spend).

## 5. Timing / ordering
- Per-turn budget cap enforced at the adapter boundary on all three adapters `[doc:
  PURPOSE v1.3]`, **at the finest truthful observation point each adapter exposes**
  `[doc: capability matrix]` — Claude: native running guard; Codex: check at each
  token-usage update; pi: provider-cost polling at turn boundaries plus a final
  defensive check. On crossing: stop; any overshoot is retained and settled (INV-006).
  The configured cap is **not** claimed as a mathematically hard spend ceiling where a
  provider reports usage in jumps — surfaces must not imply otherwise (INV-008).
- Gate classification precedes every tool action's execution — no post-hoc classification
  (INV-002).
- Exactly one settlement obligation per turn regardless of outcome (INV-006).

## L1/L2 split
- L1: adapter honors this contract against the scripted fake (per-adapter).
- L2: orchestrator + adapter + gate + settlement composed against the fake; conformance
  suite runs identically against fake and real adapter (drift guard); real-adapter runs
  are the L3 lane.
