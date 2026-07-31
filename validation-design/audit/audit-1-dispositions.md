# Audit round-1 disposition record

Written by the orchestrator from the designer's `DISPOSITION:` lines after
the round-1 feedback window. This file — not the conversation — is what the
round-2 auditor verifies.

| Finding | Tier | Claim | Disposition | Rationale |
| --- | --- | --- | --- | --- |
| AUD-101 | blocking | validation-design/contracts/B-06-clock.md — the missed-window reconciliation clause carries a `[rambling]` provenance tag, but no such content exists in ./rambling.txt | fixed | false B-06 `[rambling]` tag removed (compound `[doc][walk]`, footnoted); genuine B-03 rotation-race `[rambling]` provenance restored with the rambling.txt passage cited; all provenance columns recounted from the corpus (contracts 88/19/1/2/8, reproducible convention stated); ratification-package §2, boundary-map, design-state, and log aligned. |
| AUD-102 | significant | validation-design/boundary-map.md — B-12's `[rambling]` citation attributes elicited elaboration to rambling.txt; only the PR #182 anchor exists there | fixed | B-12 bracket narrowed to the real `[rambling: PR #182]` anchor; elaboration retagged `[elicited]`. |
| AUD-103 | significant | validation-design/validation-policy.yaml — no gate in the policy carries a blocking/advisory/waived classification; the per-commit lane's merge-blocking status is undeclared | fixed | policy `ci` declares `per_commit_gate_class: blocking` (required check, fail-closed) and `gate_classes` (no advisory/waived gates; triggered lanes gate their own layer, never merge); YAML re-validated. |
| AUD-104 | minor | validation-design/harness-design-state.md — PROPOSED-register header asserts a blanket expiry that contradicts the policy for items 9–12 | fixed | design-state PROPOSED-register expiry split (1–8, 13 vs 9–12) matching policy; item 13 rejoined the numbered list. |
| AUD-105 | minor | validation-design/invariants.md — phase-gate status headers across the derivation artifacts were never advanced after confirmation | fixed | five artifact status headers advanced to CONFIRMED-at-gate + DRAFT-pending-human-ratification; system-map §5 internal "pending" status also confirmed (round-2 completion). |
| AUD-106 | minor | validation-design/case-catalog.md — §9's blocked-cell enumeration omits the five contract-matrix blocked cells it elsewhere declares | fixed | case-catalog §9 roll-up completed with the five contract-matrix blocked remainders (CF-C-B09A/B13/B14/B15/B17). |
| AUD-107 | minor | validation-design/elicitation-log.md — the gate history omits the confirmation rounds for Phases 2 and 5 that harness-design-state asserts | fixed | Phase 2 and Phase 5 confirming-round entries restored to the elicitation log, marked as audit-time restorations. |
| AUD-108 | minor | validation-design/system-map.md — §4 "Open findings" table lists 4 of the 11 tracked findings without scoping itself | fixed | system-map §4 scoped to Phase 1 with pointer to the policy's authoritative 11-finding list. |
| AUD-109 | minor | validation-design/README.md — warning sentence literally asserts an active incident | fixed | README warnings box reworded to conditional; no active incident asserted. |
