# Findings

Assessment: `20260805T011102Z-00e00b5b3232`

## FND-RQ-001 — Release qualification has no implemented identity/currency/attestation root

- Severity: **BLOCKER**
- Type: structural harness gap
- Evidence: `validation-policy.yaml` says release gating is suspended; package/CI
  surfaces contain no release manifest, aggregate assessor, attestation, or verifier.
- Consequence: green tests or campaign reports cannot qualify exact publication bytes.
- Disposition: RQ-1 §§2–4 and §§10–12; implement CF-HARNESS-RQ/CURRENCY/ATTEST.

## FND-RQ-002 — Required threat, abuse, and initial soak evidence is absent

- Severity: **BLOCKER**
- Type: human prerequisite and operational evidence gap
- Evidence: HB-072 awaits human author/reviewer, HB-073 is blocked, and the initial
  seven-day soak/natural rotation evidence has not run.
- Consequence: L5 cannot support gate activation.
- Disposition: preserve the human boundary; activation waits for §9, not an agent guess.

## FND-RQ-003 — Current L4 runner does not implement release-quality assessment

- Severity: **HIGH**
- Type: structural evaluator gap
- Evidence: Reviewer only extracts a binary marker; Planner and Validation Designer
  outputs are collected without scoring; no candidate/baseline pairing, anchor grader,
  judge calibration/admission, or exact pairing enforcement exists.
- Consequence: current L4 output is useful evidence collection but not a quality gate.
- Disposition: RQ-1 §§6–8; no invented percentage, sample size, or aggregation.

## FND-RQ-004 — All populated statistical references are pending human validation

- Severity: **HIGH**
- Type: case-admission gap
- Evidence: 6 Reviewer, 10 Planner, and 4 Validation Designer rows remain pending.
- Consequence: a model judge cannot be calibrated and automatic quality conclusions
  are inadmissible.
- Disposition: human confirms expected behavior row-by-row; retain agent authorship.

## FND-RQ-005 — B-17 live target remains unproved

- Severity: **HIGH**
- Type: external evidence gap
- Evidence: B-17 live case is blocked for lack of a disposable real non-GitHub target.
- Consequence: release handoff has deterministic but not real-target evidence.
- Disposition: disclose as bounded pre-V1 evaluator debt only under RQ-1 §5; any B-17
  or release mechanism change blocks qualification.

## FND-RQ-006 — Required merge checks are not mechanically enforceable

- Severity: **HIGH**
- Type: platform limitation / F-PT-018
- Evidence: GitHub ruleset and branch-protection endpoints returned the private-plan
  limitation; Core checks are green but cannot be configured as required through the
  inspected repository controls.
- Consequence: merge fact alone cannot be trusted as gate evidence.
- Disposition: keep F-PT-018 open; human merge protected changes; rerun exact-tag gates.

## FND-RQ-007 — Published/package version state is not a qualified baseline

- Severity: **MEDIUM**
- Type: operating-state discrepancy
- Evidence: repository `package.json` is 0.1.1, npm `latest` is 0.0.1, and no v0.1.1
  tag/GitHub release exists.
- Consequence: 0.1.1 cannot serve as incumbent release evidence.
- Disposition: first RQ-1 campaign is bootstrap; do not redo or infer publication.

## FND-RQ-008 — Root authority pointer digest is stale

- Severity: **MEDIUM**
- Type: governance integrity
- Evidence: root AGENTS records SHA-256 `280df594...`, while the inspected
  `.cormidia/AUTHORITY.md` hashes to `c9d178...`.
- Consequence: an agent cannot verify the advertised authority binding mechanically.
- Disposition: separate protected governance correction with exact diff; no silent edit
  in this proposal.

## FND-RQ-009 — Proposed external benchmark numbers remain unverified

- Severity: **INFO**
- Type: evidence provenance
- Evidence: issue #248 itself marks the cited Airbnb figures as lacking a verified
  primary source; inspection did not establish one.
- Consequence: importing those values would invent a release rule.
- Disposition: RQ-1 adopts no external numeric threshold.

## Finding status

FND-RQ-001 through FND-RQ-006 block current release qualification. RQ-1 is an exact
design disposition, not evidence that they are already closed.
