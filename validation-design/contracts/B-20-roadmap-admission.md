# Boundary contract — CORMIDIA-C-B20-001

Boundary: **B-20 RoadmapPlan authority ↔ ready-frontier and delivery admission**.
Status: ACCEPTED implementation contract (2026-08-03); HB-100/HB-101 and the
HB-102 readiness/hash guard are implemented. HB-108 closes the complete deterministic
catalog/detector family; HB-109 closes the batch-contention machinery while external
soak evidence remains pending.

## Inputs
- One schema/versioned RoadmapPlan with content hash and predecessor reference.
- For scaffolded initial work, one current content-bound product-document disposition.
- Content-hashed backlog snapshot manifest with completeness/pagination evidence.
- Current dependency, routing, validation, lifecycle, claim and WIP facts.
- A complete durable TicketPlan decomposition plus one bounded publication
  selection in the original decomposition index space.

## Guarantees
- Reconcile materializes one documentation delivery unit through normal Builder and
  Reviewer governance and keeps dependent implementation outside the ready frontier
  until that unit completes. Bare scaffolds additionally keep it behind the single
  stack-and-gates unit. Keep/remove create no disposition-only documentation unit.
- Every considered issue is accounted for exactly once; workstream and delivery-unit
  identities are stable across revisions and moves are append-only evidence.
- A ready entry binds one exact unit membership, plan/frontier version and validation
  contract through an immutable delivery-unit-readiness authority. Current roadmap,
  validation-catalog, validation-contract and routing facts are reread before admission;
  disagreement refuses typed.
- Labels/trailers are projections. Missing/corrupt/stale authority never becomes ready.
- Either exact exclusion independently blocks a whole unit: `routing:human-only` for
  technical/self-judging routing or `manual-review` for a human review hold. Planner
  and projections never remove either label; no `manual-*` wildcard exists.
- Unchanged regions and prior summaries may be referenced; the consumer never requires
  a provider turn per issue or an EpisodePlan for a non-admitted unit.
- Publication never truncates or renumbers the underlying decomposition.
  Prepared batches preserve their own provenance and cap; recovery can bind
  dependencies to previously delivered issues in a later sparse batch of that
  same decomposition without treating their older publication identity as
  conflicting. Remaining-only delta dependencies are local to the delta;
  preserved indexes are metadata context, not supported cross-episode edges.
- A prepared batch remains recoverable until issue projection, auxiliary
  publication evidence, and the RoadmapPlan are durable; coverage completion
  is the final commit barrier. Pre-publication secret refusal scans the entire
  active decomposition, not merely the bounded selection.
- Future admission can tighten but never auto-loosen from fresh repository
  evidence. A prepared batch retains its immutable authorization and stored
  hash-only source evidence, and is recovered before current source resolution,
  invalidation, or revision.

## Failure vocabulary
`roadmap_missing | roadmap_invalid | backlog_incomplete | issue_unaccounted |
issue_multiply_assigned | workstream_cycle | unit_cycle | frontier_stale |
dependency_unmet | routing_ineligible | validation_incomplete |
validation_contract_stale | validation_catalog_stale | already_claimed |
projection_contradiction`.

## Falsification
Strict schema/graph/property tests, 100+ issue fixtures, delta/revision tests, concurrent
GitHub edits, projection partial-success, empty-vs-unavailable controls, and sweeps that
prove no eager provider/EpisodePlan construction.
