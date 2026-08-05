# Traceability Matrix

Assessment: `20260805T011102Z-00e00b5b3232`

| Claim | Existing contract/cases | Existing evidence | Gap / required detector family | Disposition |
| --- | --- | --- | --- | --- |
| CLM-IDENTITY | INV-012/014/015; B-12/B-17; nine §5 obligations | campaign IDs/config hashes | no canonical release/package subject or producer currency | CF-HARNESS-CURRENCY |
| CLM-DETERMINISTIC | CF-HARNESS-TEST/CI; INV-008/009 | 1,058 passing; typecheck/build green; Core checks green | release admission, pack/install, skip and wrong-SHA aggregation | CF-HARNESS-RQ |
| CLM-L3 | CF-B01-L3, CF-B02-L3, CF-B03-L3, CF-B04-L3, CF-J16-A, CF-J18-A | runner/report/refusal tests; #270/#275 fixes merged | exact release campaign absent; B-17-L3 blocked | CF-HARNESS-RQ + debt row |
| CLM-L4 | F-PT-009/010/011; GS-REV/PLAN/VAL | 6/10/4 committed cases; runner stores outputs | Planner/Validator unscored; no pair comparison, rubric grader, judge admission, or dedupe | CF-HARNESS-JUDGE |
| CLM-L5 | HB-072/HB-073; CF-OPS-SOAK/ROT | deterministic contention and soak collector tests | human threat model, abuse detectors, initial soak absent | HB-072-human + HB-073 + campaign |
| CLM-VERDICT | validation-policy verdict semantics | lane reports fail closed on missing/ceiling states | aggregate completeness/verdict/qualification and debt truth table absent | CF-HARNESS-RQ |
| CLM-SPEND | L3 and L5 ratified envelopes | reservation/settlement tests | no manifest-bound L4 envelope or cross-lane release ledger | CF-HARNESS-RQ |
| CLM-ATTEST | llm-eval-plan §5 obligations 4/7/8/9 | none | packet schema, equivalence, sanitizer, attestation, tamper seeds | CF-HARNESS-ATTEST |
| CLM-ENFORCEMENT | B-17; F-PT-018; approvals contract | critical-operation approval runtime | no package release declaration/workflow/prepublish verifier; required-check enforcement unavailable | CF-HARNESS-RELEASE |

## Current golden coverage

| Site | Cases | Human validation | Current automatic interpretation |
| --- | ---: | --- | --- |
| Reviewer | 6 | 0 validated / 6 pending | binary marker only |
| Planner | 10 | 0 validated / 10 pending | collection only |
| Validation Designer | 4 | 0 validated / 4 pending | collection only |
| Builder trajectory | 4 | deterministic | L1/L2 only, correctly outside L4 judge |
| Other statistical sites / S-8 | 0 | not applicable | no release-quality claim |

No empty or pending row is treated as green.
