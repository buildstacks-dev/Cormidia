# Findings

Assessment: `20260805T040848Z-4bbb360974f4`

## Closed or materially reduced

- **FND-RQ-001 — CLOSED OFFLINE:** canonical identity, currency, aggregate assessment,
  exact packet derivation and attestation now exist with negative controls.
- **FND-RQ-003 — REDUCED TO RATIFIED INCONCLUSIVE BOUNDARY:** L4 records exact
  pairings and all current sites; uncalibrated scores cannot become automatic claims.
  F-PT-009/010/011 remain open by design.
- **FND-RQ-004 — CLOSED:** all 20 current references were confirmed by the human and
  are source-hash checked without changing agent authorship.

## Blocking activation

### FND-RQ-002 — Human threat, abuse and initial soak evidence is absent

- Severity: **BLOCKER**
- Evidence: `threat-model-status.yaml` remains `awaiting_human_author`; HB-073 and
  seven-day/natural-rotation evidence do not exist.
- Disposition: preserve human authorship and run only after separate authorization.

### FND-RQ-010 — Tag workflow cannot authenticate B-17 approval provenance

- Severity: **BLOCKER**
- Policy finding: **F-PT-021**
- Evidence: B-17 correctly derives `ReleaseApprovalV1` from an attributable human
  `ApprovalStore` decision, but the GitHub workflow sees only self-contained JSON in
  the annotated tag. Another tag-authorized actor could construct a hash-consistent
  envelope asserting a human identity; the workflow has no independent provenance
  check.
- Disposition: activation remains blocked. The human threat-model/owner must choose
  the admissible authenticity/enforcement mechanism; this audit invents none.

### FND-RQ-006 — Required merge checks remain unenforceable

- Severity: **HIGH**
- Policy finding: **F-PT-018**
- Evidence: branch protection/ruleset APIs remain unavailable on the private plan.
- Disposition: protected human merge and exact-tag rerun remain the current bounded
  process, not a claim of mechanical merge enforcement.

### FND-RQ-005 — B-17 real target remains unproved

- Severity: **HIGH**
- Evidence: no disposable live non-GitHub target exists.
- Disposition: retain the blocked cell and any exact bounded human debt disclosure;
  never label it pass.

## Other retained findings

- **FND-RQ-007 (MEDIUM):** 0.1.1 is an exception, not a qualified baseline.
- **FND-RQ-008 (MEDIUM):** root AGENTS advertises a stale authority SHA; untouched
  because its correction requires a separate protected diff.
- **FND-RQ-009 (INFO):** issue #248's unverified external benchmark numbers were not
  imported as thresholds.
