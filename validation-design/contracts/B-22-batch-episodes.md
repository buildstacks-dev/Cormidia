# Boundary contract — CORMIDIA-C-B22-001

Boundary: **B-22 execution-batch admission ↔ independently authoritative execution
episodes**. Status: ACCEPTED implementation contract (2026-08-03); implementation in
progress.

## Inputs
- Exact roadmap-ready-frontier hash or complete direct-work authority, plus a bounded
  ordered execution-unit set.
- Per-unit hard constraints and deterministic context-affinity manifests.
- Current aggregate/per-unit budgets, WIP and assignment readiness.

## Guarantees
- Batch creation is token-free and creates no EpisodePlan. One plan is created lazily
  per admitted unit; a batch never authorizes steps or transfers authority.
- Sessions are same-app, same-role, exact-assignment and compatible-operation only.
  Reviewer never resumes Builder state. Every turn/evidence/settlement remains per unit.
- Unit failure/replan/recovery cannot transfer claim, budget, evidence or completion to
  a sibling. Batch completion records a typed disposition for every admitted unit.
- Cache use is reported only from adapter evidence; missing evidence is unknown and has
  no correctness effect.
- Code units retain RoadmapPlan accounting and one-PR semantics. Direct operational
  units may omit RoadmapPlan only with complete provenance, scope, expected outputs,
  validation/effect policy and source dedupe identity. Every external payload keeps a
  separate exact approval/execution acknowledgement; batching never widens the grant.

## Failure vocabulary
`batch_frontier_stale | batch_unit_duplicate | batch_unit_cross_app |
batch_hard_constraint_failed | batch_budget_refused | batch_context_mismatch |
batch_session_mismatch | batch_cache_measurement_unknown | batch_unit_failed |
batch_unit_returned | batch_interrupted`.

## Falsification
Property tests over unit sets/order; overlapping batch races; budget conservation;
context/session swaps; Builder→Reviewer resume attempts; crash/kill sweeps between unit
terminals; actual-hit/miss/unavailable telemetry fixtures; one failed unit with healthy
siblings; no-eager-plan structural assertions.
