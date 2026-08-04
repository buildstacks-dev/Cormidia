# Operation contract — C-OP-VALIDATION (validation obligations through delivery)
Canonical ID: **CORMIDIA-C-OPVALIDATION-001 (alias: C-OP-VALIDATION)**

Status: ACCEPTED implementation contract (2026-08-03); implementation in progress.
Defends INV-008/012/015/016, M4/M17. Journeys J-03/J-04/J-18. Interfaces with
B-20/B-21/B-22 and the affected product boundary contracts.

## §1 Authorship and timing
- Planner owns product intent, priority, dependencies, workstream/delivery-unit
  membership and behavioral acceptance criteria. It does not invent validation truth.
- A validation-design pass is a governed capability/call site, not a free-running
  organizational employee. Before a unit becomes ready it attaches one versioned,
  machine-readable validation contract to the exact RoadmapPlan and delivery-unit
  versions.
- Structurally complete obligations may normalize token-free from an existing contract
  or governed template. Missing design decisions require one bounded validation-design
  turn over compatible units in the same workstream/session, not one cold turn per
  ticket.

## §2 Contract shape and deterministic admission
- Required fields: affected journey IDs; boundary/operation-contract/invariant IDs;
  affected interfaces and state owners; behavioral acceptance criteria; cheapest
  falsifying layer per obligation; failure cases; detector and seeded negative-control
  requirements; expected evidence; exact shared-boundary detector refs; and any waiver.
- Every ID resolves against the accepted harness artifact set. A structural change that
  needs a new journey/boundary/invariant is marked `requires_harness_revision`; it cannot
  be smuggled through a case-only contract.
- A waiver is explicit, policy-classed, provenance-bearing, bounded to the exact
  obligation/unit/version, and never available for invariant floors or C3 control-point
  obligations. No omitted field is interpreted as a waiver.
- Missing/malformed/stale/unknown IDs, an unratified structural decision, absent shared-
  boundary coverage, or missing negative control fails readiness with typed reasons.
- Validation contracts move forward-only `proposed → validated → accepted →
  superseded`; an accepted contract may contain a separately explicit valid waiver but
  omission is never a lifecycle state or waiver. An interrupted successor leaves the
  prior accepted version authoritative and marks readiness stale until the exact
  RoadmapPlan/unit binding is reconciled.

## §3 Builder handoff
- The accepted delivery EpisodePlan carries the exact validation-contract ref+hash.
  Builder receives the contract, implements required detectors at the cheapest layer,
  runs its named token-free gates, and emits a machine-readable evidence manifest bound
  to delivery-unit ID, EpisodePlan version, repository/base, candidate HEAD and case IDs.
- A deterministic defect found at L3/L4 deposits its L1/L2 detector in the same change.
  Builder may propose a contract correction but cannot silently rewrite or waive the
  accepted obligation.
- Missing evidence is a typed incomplete Builder outcome; prose such as “tests passed”
  cannot satisfy an evidence entry.

## §4 Reviewer handoff and verdict
- Reviewer uses an independent role/assignment/session and receives the accepted
  contract plus exact-HEAD evidence. It verifies conformance, evidence completeness,
  negative controls, named gates, shared-boundary detectors and any waiver.
- Reviewer must reject or return when declared evidence is missing, stale, belongs to a
  different unit/HEAD, or cannot be independently reproduced at the promised layer.
  Suppressed critical operations are evidence states, never silently equivalent to a
  completed check.
- A pass verdict is bound to the exact contract version, delivery-unit membership and
  HEAD. Any change invalidates the verdict and requires the affected suffix to rerun.

## §5 Proportionality
- Low-risk routine work may use a governed validation template or explicit policy waiver;
  this is a deterministic fast path, not absence of validation.
- Cross-ticket/state-owner seams, migrations, auth/security/secret/privacy/payment/data
  surfaces, C3 control points and architecture-contract changes cannot take the silent
  low-risk path.
