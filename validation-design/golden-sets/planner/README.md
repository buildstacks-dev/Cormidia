# S-1 Planner (S-1a TicketPlan / S-1b episode design) — STATUS: POPULATED / HUMAN REFERENCE REVIEW PENDING
`cases.json` contains the first committed S-1a/S-1b goals and rubric anchors,
authored before prompt tuning. Data collection is permitted; model-swap and
qualification evidence remain inadmissible until human reference review and
F-PT-010 ratification.

Rubric axes: decomposition sanity · dependency correctness · acceptance-criteria
usefulness (binary/testable/mapped) · role/step necessity · proportionality (expected
process cost vs work).
Threshold + N + sample design: **OPEN — F-PT-010** (≥85%/N≥3 are budgeting hypotheses
from neither owner nor docs; inconclusive-only until ratified).
Cadence: planner prompt/model change; release qualification.
Qualifying tuple dimensions: planner assignment tuple (harness/model/effort), per
sub-site.
Case schema: {id, sub-site, bounded goal or episode intent, source refs, human-rated
reference plan + rating rationale, provenance}.
