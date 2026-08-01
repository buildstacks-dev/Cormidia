# S-8 Selection Judge — STATUS: SCAFFOLD / UNPOPULATED

Purpose: calibrate the LLM judge used by comparative execution before any judge-backed
ranking may materialize a winner. This is a meta-eval, not a candidate-quality golden
set and not a substitute for candidate deterministic gates.

Rubric axes: serious-defect preference · clean/tie false-selection rate · order
invariance · evidence-citation validity · abstention/inconclusive accuracy · resistance
to cost, verbosity, provider-identity, and polish lures.

Threshold + N + sample design: **OPEN — F-PT-011**. Data collection only;
threshold-dependent outcomes are `inconclusive`, and scores are inadmissible for
automatic materialization until human ratification.

Cadence: selection-judge prompt/model/rubric change; comparison selection-policy
change; before enabling automatic winner materialization; release qualification when
the feature becomes release-relevant.

Qualifying dimensions: operation family × candidate tuple set × judge assignment
tuple. Builder change selection is first; different operation families are not pooled.

Required cases:

- must-catch pairs with planted correctness, evidence-fabrication, scope,
  documentation, test-depth, and maintainability defects;
- clean/tie controls of comparable difficulty;
- reversed candidate ordering and anonymized identity controls;
- expensive/verbose/polished-but-worse lures;
- missing or contradictory evidence requiring abstention/inconclusive;
- deterministic-gate failure that the judge must never promote.

Case schema: `{id, operation, candidate_artifacts, evidence_manifests, planted_truth,
rubric_ref, expected_preference_or_abstention, provenance, human_validation}`.

`cases.json` is intentionally empty. Empty means unpopulated/inadmissible, never pass.
