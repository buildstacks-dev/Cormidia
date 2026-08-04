# Boundary contract — CORMIDIA-C-B20-001

Boundary: **B-20 RoadmapPlan authority ↔ ready-frontier and delivery admission**.
Status: ACCEPTED implementation contract (2026-08-03); HB-100/HB-101 and the
HB-102 readiness/hash guard are implemented. HB-108 closes the complete deterministic
catalog/detector family; HB-109 closes the batch-contention machinery while external
soak evidence remains pending.

## Inputs
- One schema/versioned RoadmapPlan with content hash and predecessor reference.
- Content-hashed backlog snapshot manifest with completeness/pagination evidence.
- Current dependency, routing, validation, lifecycle, claim and WIP facts.

## Guarantees
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
