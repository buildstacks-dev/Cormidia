# S-3 Reviewer meta-eval — STATUS: POPULATED / HUMAN REFERENCE REVIEW PENDING
`cases.json` contains the first committed seeded-defect and clean-control set,
authored before prompt tuning. It may be used for data collection now, but cannot
support model-swap or qualification evidence until a human validates the reference
labels and F-PT-009 ratifies the statistical decision rule. FIRST-FUNDED.

Rubric axes: catch-by-severity over seeded defect classes (correctness, security,
evidence-fabrication, contract violation, secret exposure) · clean-change
false-positive rate · verdict usability.
Threshold + N + sample design: **OPEN — F-PT-009** (case counts per class/clean pool,
severity+pairing aggregation, inconclusive rule all unratified). Budgeting hypotheses
on file (≥95% serious catch / ≤10% clean FP / N≥3) yield `inconclusive` only.
Cadence: reviewer prompt/model/instruction change; release qualification; nightly shards.
Qualifying tuple dimensions: (builder harness/model/effort) × (reviewer
harness/model/effort) — reported per pairing, never pooled.
Case schema: {id, seeded-defect class+severity | clean-control, fixture repo ref +
ground truth, expected verdict, provenance (author, date, source incident if any),
never derived from archive-do-not-read/**}.
