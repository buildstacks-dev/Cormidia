# Boundary contract — CORMIDIA-C-B21-001

Boundary: **B-21 validation contract authority ↔ readiness, Builder evidence, and
Reviewer verdict**. Status: ACCEPTED implementation contract (2026-08-03);
HB-102 deterministic authority/readiness enforcement is implemented; the broader
delivery/batch campaign remains in progress.

## Inputs
- Exact RoadmapPlan and delivery-unit versions.
- Strict validation contract or policy-authorized waiver.
- Builder evidence manifest and candidate HEAD for review.

## Guarantees
- Contract IDs resolve against the accepted harness; structural mismatches re-enter
  harness-revision mode; omissions never imply waiver.
- The installed catalog binds the ratified harness revision; successor catalogs are
  forward-only and tighten-only. Existing IDs/aliases, floors, shared detectors,
  negative controls, templates and waiver bounds cannot be weakened or removed.
  The implemented HB-100…102 catalog slice is content-pinned by SHA-256; additions are
  refused until HB-108 expands the pin through an accepted harness revision.
- Readiness, EpisodePlan creator provenance, Builder output, Reviewer verdict and claim
  settlement bind the same contract ref+hash/unit membership. Evidence binds the exact
  HEAD and case/gate identities.
- Reviewer independently refuses missing/stale/copied/suppressed evidence and cannot
  inherit Builder's private session.
- Waiver expiry is rechecked at readiness, batch admission, EpisodePlan normalization,
  Builder claim/evidence, Reviewer verdict and settlement; expiry never becomes a
  silent pass. Every downstream join also rechecks the current RoadmapPlan/frontier.
  Each waiver resolves an exact, unrevoked durable human approval whose action binds
  app/unit/contract/version/obligation/policy/reason/expiry; non-empty prose is not
  authority.

## Failure vocabulary
`validation_contract_missing | validation_contract_invalid | validation_contract_stale |
validation_catalog_missing | validation_catalog_stale | validation_id_unknown |
validation_structure_mismatch | validation_waiver_invalid | negative_control_missing |
builder_evidence_missing | evidence_head_mismatch | evidence_unit_mismatch |
reviewer_evidence_incomplete | reviewer_independence_invalid`.

## Falsification
Strict ID/schema fixtures; waiver matrix; seeded red/green detector families; exact-HEAD
mutation; cross-unit evidence swaps; missing/suppressed evidence; independent-session
assertions; shared-boundary cases spanning multiple member tickets.
