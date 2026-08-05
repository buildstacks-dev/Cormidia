# Traceability Matrix

Assessment: `20260805T040848Z-4bbb360974f4`

| RQ-1 claim | Contract / catalog | Implemented evidence | Status |
| --- | --- | --- | --- |
| Identity/currency | RQ-1 §3; CF-HARNESS-CURRENCY | canonical manifest; repo snapshot; subject/producer digests; evidence-change disposition | verified offline |
| Deterministic-first | RQ-1 §4; CF-HARNESS-RQ | exact required checks, skip handling, wrong/missing/stale controls | verified offline |
| Live seams | RQ-1 §5; existing L3 cases | raw `ValidationCampaignReportV1` derivation and stale-target refusal | collector verified; release run absent |
| L4 scope | RQ-1 §§6–8; CF-HARNESS-JUDGE | 6 Reviewer + 10 Planner + 4 Validation Designer rows; exact site/operation/arm/producer/evaluator/rubric/attempt identity | verified collection; numeric conclusions inconclusive |
| Human references | workbook + golden ledger | source-commit/hash verified, agent authors retained, validator `bikramgupta` | verified |
| L5 | RQ-1 §9; HB-072/HB-073 | status gate refuses non-human scaffold | blocked/unrun |
| Spend/retry | RQ-1 §10 | fixed L3/L5 ceilings, exact human L4 envelope, typed retry schema | verified schema; no campaign evidence |
| Packet/attestation | RQ-1 §11; CF-HARNESS-ATTEST | required evidence files, lane re-derivation, sanitizer, exact lineage and package | verified offline |
| Supported release | RQ-1 §12; B-17; CF-HARNESS-RELEASE | hermetic B-17 annotated tag/push; exact-tag workflow; sealed artifact | partial: F-PT-021 |
| Merge enforcement | RQ-1 §12; F-PT-018 | exact-SHA rerun and protected human-merge process | mechanical required checks unavailable |

Every new detector family has a seeded negative control. No provider-backed evidence
was collected and no absence is represented as pass.
