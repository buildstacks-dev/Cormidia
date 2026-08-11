# Audit round-1 disposition record

Written by the orchestrator from the designer's `DISPOSITION:` lines after
the round-1 feedback window. This file — not the conversation — is what the
round-2 auditor verifies.

| Finding | Tier | Claim | Disposition | Rationale | Stakeholder confirmation | Confirmation evidence | Arbitration | Arbitration evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| AUD-101 | blocking | validation-design/invariants.md (also boundary-map.md, llm-eval-plan.md, ratification-package.md §2) — the corpus's `[rambling]` provenance class points at passages that do not exist in the workspace's ./rambling.txt, and the rev-2026-08-10 revision that ingested the replacement file never rescoped the definition or the citations | fixed | rambling-archive.md created (supersession event, pre-/post-2026-08-10 scope rule, complete [Q]/[V]/[A] anchor register from a corpus-wide grep, no-preimage byte-recovery note); tag definitions rescoped at every legend site; ratification-package §2's B-03 sentence corrected; archive registered in policy `artifacts:` and README | confirmed | Persistence bookkeeping is internally consistent: the conventional-path [disposition record](/Users/bikram/Build/validation-architect/runs/cormidia-rev1-20260810/workspace/validation-design/audit/audit-1-dispositions.md:12), July preservation copy, §13, and state mirror agree. Non-regression remains clean: byte-identical regeneration, two `F-PT-018` rows, `rambling` count 1, and unchanged rollups.

DISPOSITION: AUD-101 = fixed — rambling-archive.md created (supersession event, pre-/post-2026-08-10 scope rule, complete [Q]/[V]/[A] anchor register from a corpus-wide grep, no-preimage byte-recovery note); tag definitions rescoped at every legend site; ratification-package §2's B-03 sentence corrected; archive registered in policy `artifacts:` and README  
STAKEHOLDER-CONFIRMED: AUD-101

DISPOSITION: AUD-102 = fixed — case-catalog-generator.awk extracts `KNOWN-LIMITATION:` into `known_limitation:`; case-catalog.yaml regenerated with F-PT-018 on CF-HARNESS-CI and CF-HARNESS-RELEASE and rollups unchanged; README claim split 8 parked + 1 known-limitation; case-catalog.md §9 register annotated  
STAKEHOLDER-CONFIRMED: AUD-102

DISPOSITION: AUD-103 = fixed — harness-state.yaml `convergence.last_diff_verdict` names #376 (fd3bb8158) as absorbed by existing CF-IF-CLI progressive-help coverage (#371 tests, THIN/C1); no new row owed  
STAKEHOLDER-CONFIRMED: AUD-103

DISPOSITION: AUD-104 = fixed — README glossary comment corrected to record the …032→…033 two-step extension and defer to the normative `F-PT-001…033` row  
STAKEHOLDER-CONFIRMED: AUD-104

CONFIRMED | n/a |  |
| AUD-102 | significant | validation-design/case-catalog.yaml (vs case-catalog.md §9 and README.md) — the ninth parked cell (F-PT-018, CF-HARNESS-CI required-check enforcement) is invisible to the machine-readable catalog, which the corpus declares must agree with the markdown | fixed | case-catalog-generator.awk extracts `KNOWN-LIMITATION:` into `known_limitation:`; case-catalog.yaml regenerated with F-PT-018 on CF-HARNESS-CI and CF-HARNESS-RELEASE and rollups unchanged; README claim split 8 parked + 1 known-limitation; case-catalog.md §9 register annotated | confirmed | Persistence bookkeeping is internally consistent: the conventional-path [disposition record](/Users/bikram/Build/validation-architect/runs/cormidia-rev1-20260810/workspace/validation-design/audit/audit-1-dispositions.md:12), July preservation copy, §13, and state mirror agree. Non-regression remains clean: byte-identical regeneration, two `F-PT-018` rows, `rambling` count 1, and unchanged rollups.

DISPOSITION: AUD-101 = fixed — rambling-archive.md created (supersession event, pre-/post-2026-08-10 scope rule, complete [Q]/[V]/[A] anchor register from a corpus-wide grep, no-preimage byte-recovery note); tag definitions rescoped at every legend site; ratification-package §2's B-03 sentence corrected; archive registered in policy `artifacts:` and README  
STAKEHOLDER-CONFIRMED: AUD-101

DISPOSITION: AUD-102 = fixed — case-catalog-generator.awk extracts `KNOWN-LIMITATION:` into `known_limitation:`; case-catalog.yaml regenerated with F-PT-018 on CF-HARNESS-CI and CF-HARNESS-RELEASE and rollups unchanged; README claim split 8 parked + 1 known-limitation; case-catalog.md §9 register annotated  
STAKEHOLDER-CONFIRMED: AUD-102

DISPOSITION: AUD-103 = fixed — harness-state.yaml `convergence.last_diff_verdict` names #376 (fd3bb8158) as absorbed by existing CF-IF-CLI progressive-help coverage (#371 tests, THIN/C1); no new row owed  
STAKEHOLDER-CONFIRMED: AUD-103

DISPOSITION: AUD-104 = fixed — README glossary comment corrected to record the …032→…033 two-step extension and defer to the normative `F-PT-001…033` row  
STAKEHOLDER-CONFIRMED: AUD-104

CONFIRMED | n/a |  |
| AUD-103 | minor | validation-design/harness-state.yaml (`convergence.last_diff_verdict`) — the revision's diff-walk record leaves one changed-source item (#376, progressive CLI help hierarchy) with no named disposition | fixed | harness-state.yaml `convergence.last_diff_verdict` names #376 (fd3bb8158) as absorbed by existing CF-IF-CLI progressive-help coverage (#371 tests, THIN/C1); no new row owed | confirmed | Persistence bookkeeping is internally consistent: the conventional-path [disposition record](/Users/bikram/Build/validation-architect/runs/cormidia-rev1-20260810/workspace/validation-design/audit/audit-1-dispositions.md:12), July preservation copy, §13, and state mirror agree. Non-regression remains clean: byte-identical regeneration, two `F-PT-018` rows, `rambling` count 1, and unchanged rollups.

DISPOSITION: AUD-101 = fixed — rambling-archive.md created (supersession event, pre-/post-2026-08-10 scope rule, complete [Q]/[V]/[A] anchor register from a corpus-wide grep, no-preimage byte-recovery note); tag definitions rescoped at every legend site; ratification-package §2's B-03 sentence corrected; archive registered in policy `artifacts:` and README  
STAKEHOLDER-CONFIRMED: AUD-101

DISPOSITION: AUD-102 = fixed — case-catalog-generator.awk extracts `KNOWN-LIMITATION:` into `known_limitation:`; case-catalog.yaml regenerated with F-PT-018 on CF-HARNESS-CI and CF-HARNESS-RELEASE and rollups unchanged; README claim split 8 parked + 1 known-limitation; case-catalog.md §9 register annotated  
STAKEHOLDER-CONFIRMED: AUD-102

DISPOSITION: AUD-103 = fixed — harness-state.yaml `convergence.last_diff_verdict` names #376 (fd3bb8158) as absorbed by existing CF-IF-CLI progressive-help coverage (#371 tests, THIN/C1); no new row owed  
STAKEHOLDER-CONFIRMED: AUD-103

DISPOSITION: AUD-104 = fixed — README glossary comment corrected to record the …032→…033 two-step extension and defer to the normative `F-PT-001…033` row  
STAKEHOLDER-CONFIRMED: AUD-104

CONFIRMED | n/a |  |
| AUD-104 | minor | validation-design/README.md (ID glossary) — a same-day changelog comment asserts "F-PT range extended to …032" three lines below the register row that reads `F-PT-001…033` | fixed | README glossary comment corrected to record the …032→…033 two-step extension and defer to the normative `F-PT-001…033` row | confirmed | Persistence bookkeeping is internally consistent: the conventional-path [disposition record](/Users/bikram/Build/validation-architect/runs/cormidia-rev1-20260810/workspace/validation-design/audit/audit-1-dispositions.md:12), July preservation copy, §13, and state mirror agree. Non-regression remains clean: byte-identical regeneration, two `F-PT-018` rows, `rambling` count 1, and unchanged rollups.

DISPOSITION: AUD-101 = fixed — rambling-archive.md created (supersession event, pre-/post-2026-08-10 scope rule, complete [Q]/[V]/[A] anchor register from a corpus-wide grep, no-preimage byte-recovery note); tag definitions rescoped at every legend site; ratification-package §2's B-03 sentence corrected; archive registered in policy `artifacts:` and README  
STAKEHOLDER-CONFIRMED: AUD-101

DISPOSITION: AUD-102 = fixed — case-catalog-generator.awk extracts `KNOWN-LIMITATION:` into `known_limitation:`; case-catalog.yaml regenerated with F-PT-018 on CF-HARNESS-CI and CF-HARNESS-RELEASE and rollups unchanged; README claim split 8 parked + 1 known-limitation; case-catalog.md §9 register annotated  
STAKEHOLDER-CONFIRMED: AUD-102

DISPOSITION: AUD-103 = fixed — harness-state.yaml `convergence.last_diff_verdict` names #376 (fd3bb8158) as absorbed by existing CF-IF-CLI progressive-help coverage (#371 tests, THIN/C1); no new row owed  
STAKEHOLDER-CONFIRMED: AUD-103

DISPOSITION: AUD-104 = fixed — README glossary comment corrected to record the …032→…033 two-step extension and defer to the normative `F-PT-001…033` row  
STAKEHOLDER-CONFIRMED: AUD-104

CONFIRMED | n/a |  |
