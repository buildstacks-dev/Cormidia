# Boundary contract — CORMIDIA-C-B21-001

Boundary: **B-21 validation contract authority ↔ readiness, Builder evidence, and
Reviewer verdict**. Status: ACCEPTED implementation contract (2026-08-03);
implementation in progress.

## Inputs
- Exact RoadmapPlan and delivery-unit versions.
- Strict validation contract or policy-authorized waiver.
- Builder evidence manifest and candidate HEAD for review.

## Guarantees
- Contract IDs resolve against the accepted harness; structural mismatches re-enter
  harness-revision mode; omissions never imply waiver.
- Readiness, EpisodePlan, Builder output and Reviewer verdict bind the same contract
  hash/unit membership. Evidence binds the exact HEAD and case/gate identities.
- Reviewer independently refuses missing/stale/copied/suppressed evidence and cannot
  inherit Builder's private session.

## Failure vocabulary
`validation_contract_missing | validation_contract_invalid | validation_id_unknown |
validation_structure_mismatch | validation_waiver_invalid | negative_control_missing |
builder_evidence_missing | evidence_head_mismatch | evidence_unit_mismatch |
reviewer_evidence_incomplete | reviewer_independence_invalid`.

## Falsification
Strict ID/schema fixtures; waiver matrix; seeded red/green detector families; exact-HEAD
mutation; cross-unit evidence swaps; missing/suppressed evidence; independent-session
assertions; shared-boundary cases spanning multiple member tickets.
