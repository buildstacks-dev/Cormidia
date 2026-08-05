# Traceability Matrix

Assessment: `20260805T102101Z-58596de4f03a`

| RQ-1 obligation | Contract/catalog surface | Final evidence | Status |
| --- | --- | --- | --- |
| Release contract | RQ-1 proposal; CF-HARNESS-RQ | closed manifest and aggregate truth-table tests | verified offline |
| Identity/currency | CF-HARNESS-CURRENCY | exact Git/package inputs, subject/producer digests, isolated candidate execution | verified offline |
| Deterministic-first | CF-HARNESS-RQ/CI | 169-file executed inventory; stale/missing/skip/config/runner controls | verified offline + CI |
| Campaign identity | existing L3 cases | exact six-case release inventory and target-bound reports | machinery verified; campaign unrun |
| Calibrated judge/pairing | CF-HARNESS-JUDGE | 20 references; exact site/pairing/attempt/composite grade identity | verified; numeric decisions inconclusive |
| Completeness/verdict | CF-HARNESS-REPORT | no-green-by-absence and debt eligibility controls | verified offline |
| Cost/retry | RQ-1 ceilings/retry schema | hard bounds, reservation and typed retry collectors | verified schema; campaign unrun |
| Candidate equivalence | CF-HARNESS-CURRENCY/ATTEST | evidence-only descendant, package/policy/golden binding | verified offline |
| Enforcement | B-17; CF-HARNESS-RELEASE | annotated tag, actor equality, exact-tag CI, sealed package | verified machinery; F-PT-018 retained |
| Migration/rollback | proposal and operator docs | 0.1.1 exception; revert/disable without archive fallback | verified design |
| Future assurance | HB-072/HB-073/L5 | visible future state outside denominator | correctly not passed |

Every new defect detector has a seeded negative control. Missing external evidence is
reported as unrun/incomplete, never as pass.
