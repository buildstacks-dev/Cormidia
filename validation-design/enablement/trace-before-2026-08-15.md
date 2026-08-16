# Validation trace baseline — before #431 remediation

Date: 2026-08-15
Source revision: `e1208dd5ef419f4fda86be0782da005f756773c3`
Command: `pnpm exec validation-trace . --manifest validation-design/case-catalog.yaml --tests tests`
Exit code: `1`

This is the complete pre-remediation output required by VA-PLATFORM-001 #431.
It proves deterministic closure only, not test fidelity or product quality.

```text
# Trace report — cormidia

Deterministic design→implementation closure over the case-catalog manifest.
This proves **closure, not fidelity** — whether a citing test truly falsifies
its ratified seed is the fidelity audit's judgment, not this report's claim.

## Summary

- **Families:** 409 (370 implementable · 38 pruned · 1 blocked)
- **Specs:** 311 files · 2213 tests
- **Evidence-cited families:** 9 (0 complete · 5 incomplete · 3 inconclusive · 1 unobserved)
- **Agreement (manifest ↔ markdown catalog):** RED (7)
- **Forward closure:** RED (7)
- **Backward closure:** RED (5)
- **Status honesty:** RED (7)
- **Spec structure:** RED (39)

## Tickets by wave

### Wave 0

| Ticket | What it covers | Families | Files | Tests | Status |
| --- | --- | --- | --- | --- | --- |
| HB-001 | real CI lane, fail-closed, with a canary that proves the scanner can fire | 0 | 0 | 0 | landed |
| HB-002 | fixture kit with self-tests — the harness distrusts its own tools first | 2 | 1 | 5 | landed · 2/2 families traced |
| HB-003 | a GitHub double that can lie on demand, so ambiguity is rehearsed offline | 3 | 4 | 24 | landed · 3/3 families traced |
| HB-004 | first adapter double; unknown usage renders unknown, never zero | 1 | 1 | 36 | landed · 1/1 families traced |
| HB-005 | one real detector per layer, each born red against a seeded violation | 1 | 4 | 19 | landed · 1/1 families traced |
| HB-006 | the policy file is pinned by tests — moving an artifact without updating | 0 | 0 | 0 | landed |
| HB-007 | every provisional number was put in front of you; 1–8 and 13 ratified | 0 | 0 | 0 | landed |

### Wave 1

| Ticket | What it covers | Families | Files | Tests | Status |
| --- | --- | --- | --- | --- | --- |
| HB-010 | HB-010 | 1 | 8 | 43 | landed · 1/1 families traced |
| HB-011 | HB-011 | 11 | 11 | 93 | landed · 11/11 families traced |
| HB-012 | HB-012 | 6 | 4 | 22 | landed · 4/6 families traced |
| HB-013 | HB-013 | 11 | 10 | 44 | landed · 10/11 families traced |
| HB-014 | HB-014 | 4 | 8 | 66 | landed · 4/4 families traced |
| HB-015 | HB-015 | 12 | 12 | 75 | landed · 12/12 families traced |
| HB-016 | HB-016 | 1 | 8 | 35 | landed · 1/1 families traced |
| HB-017 | HB-017 | 10 | 9 | 56 | landed · 10/10 families traced |
| HB-141 | HB-141 | 3 | 1 | 13 | landed · 3/3 families traced |
| HB-150 | conservative cross-family error sweep (LANDED) | 1 | 1 | 15 | landed · 1/1 families traced |

### Wave 2

| Ticket | What it covers | Families | Files | Tests | Status |
| --- | --- | --- | --- | --- | --- |
| HB-020 | HB-020 | 6 | 8 | 41 | landed · 6/6 families traced |
| HB-021 | HB-021 | 2 | 3 | 8 | landed · 2/2 families traced |
| HB-022 | HB-022 | 6 | 5 | 17 | landed · 6/6 families traced |
| HB-023 | HB-023 | 7 | 5 | 30 | landed · 7/7 families traced |
| HB-024 | HB-024 | 2 | 2 | 13 | landed · 2/2 families traced |
| HB-025 | HB-025 | 1 | 2 | 13 | landed · 1/1 families traced |
| HB-142 | scheduler-admission matrix and contract (PENDING) | 5 | 5 | 39 | landed · 5/5 families traced |
| HB-148 | store-class crash/truncation/quarantine invariant (LANDED) | 1 | 1 | 9 | landed · 1/1 families traced |

### Wave 3

| Ticket | What it covers | Families | Files | Tests | Status |
| --- | --- | --- | --- | --- | --- |
| HB-030 | HB-030 | 2 | 3 | 17 | landed · 2/2 families traced |
| HB-031 | HB-031 | 5 | 6 | 26 | landed · 5/5 families traced |
| HB-032 | HB-032 | 8 | 8 | 25 | landed · 8/8 families traced |
| HB-033 | HB-033 | 8 | 7 | 42 | landed · 7/8 families traced |
| HB-143 | internal-artifact and incident journeys (PENDING) | 4 | 1 | 8 | landed · 4/4 families traced |
| HB-146 | HB-146 | 1 | 1 | 3 | landed · 1/1 families traced |
| HB-149 | admission/bookkeeping evidence invariant (LANDED) | 1 | 1 | 6 | landed · 1/1 families traced |

### Wave 4

| Ticket | What it covers | Families | Files | Tests | Status |
| --- | --- | --- | --- | --- | --- |
| HB-040 | HB-040 | 10 | 1 | 4 | landed · 9/10 families traced |
| HB-041 | HB-041 | 5 | 2 | 20 | landed · 5/5 families traced |
| HB-042 | HB-042 | 7 | 3 | 13 | landed · 7/7 families traced |
| HB-043 | HB-043 | 5 | 1 | 4 | landed · 5/5 families traced |
| HB-044 | HB-044 | 1 | 1 | 1 | landed · 1/1 families traced |
| HB-045 | HB-045 | 0 | 0 | 0 | landed |
| HB-046 | HB-046 | 1 | 1 | 4 | landed · 1/1 families traced |
| HB-047 | HB-047 | 1 | 1 | 2 | landed · 1/1 families traced |
| HB-147 | HB-147 | 4 | 1 | 6 | landed · 4/4 families traced |

### Wave L3

| Ticket | What it covers | Families | Files | Tests | Status |
| --- | --- | --- | --- | --- | --- |
| HB-050 | HB-050 | 1 | 5 | 20 | landed · 1/1 families traced |
| HB-051 | HB-051 | 5 | 10 | 117 | landed · 5/5 families traced |
| HB-052 | HB-052 | 4 | 5 | 32 | landed · 4/4 families traced |
| HB-053 | HB-053 | 1 | 1 | 4 | landed · 1/1 families traced |
| HB-054 | HB-054 | 1 | 1 | 4 | landed · 1/1 families traced |
| HB-055 | BLOCKED by design: the generic external-effect live target | 0 | 0 | 0 | pending |
| HB-144 | HB-144 | 4 | 1 | 2 | landed · 4/4 families traced |

### Wave L4

| Ticket | What it covers | Families | Files | Tests | Status |
| --- | --- | --- | --- | --- | --- |
| HB-060 | HB-060 | 0 | 0 | 0 | landed |
| HB-061 | HB-061 | 2 | 0 | 0 | landed · 0/2 families traced |
| HB-062 | HB-062 | 10 | 0 | 0 | pending · 0/10 families traced |
| HB-063 | builder-trajectory scenario fixtures (landed) | 0 | 0 | 0 | landed |

### Wave L5

| Ticket | What it covers | Families | Files | Tests | Status |
| --- | --- | --- | --- | --- | --- |
| HB-070 | HB-070 | 1 | 1 | 2 | landed · 1/1 families traced |
| HB-071 | HB-071 | 2 | 1 | 4 | landed · 1/2 families traced |
| HB-072 | HB-072 | 0 | 0 | 0 | pending |
| HB-073 | the threat model is yours to author | 1 | 1 | 2 | pending · 1/1 families traced |

### Wave unparked

| Ticket | What it covers | Families | Files | Tests | Status |
| --- | --- | --- | --- | --- | --- |
| HB-P1 | HB-P1 | 1 | 1 | 2 | landed · 1/1 families traced |
| HB-P2 | HB-P2 | 3 | 5 | 34 | landed · 3/3 families traced |
| HB-P4 | HB-P4 | 2 | 4 | 33 | landed · 2/2 families traced |

### Wave parked

| Ticket | What it covers | Families | Files | Tests | Status |
| --- | --- | --- | --- | --- | --- |
| HB-P3 | HB-P3 | 0 | 0 | 0 | landed |
| HB-P5 | HB-P5 | 0 | 0 | 0 | landed |
| HB-P6 | UNPARKED 2026-08-12 by your rulings | 1 | 2 | 43 | landed · 1/1 families traced |
| HB-P7 | still parked, and it is not our choice | 1 | 2 | 27 | pending · 1/1 families traced |

### Wave post-ratification

| Ticket | What it covers | Families | Files | Tests | Status |
| --- | --- | --- | --- | --- | --- |
| HB-080 | HB-080 | 0 | 0 | 0 | landed |
| HB-081 | HB-081 | 0 | 0 | 0 | landed |

### Wave proposed

| Ticket | What it covers | Families | Files | Tests | Status |
| --- | --- | --- | --- | --- | --- |
| HB-090 | comparison contracts + hermetic skeleton | 12 | 0 | 0 | pending · 0/12 families traced |
| HB-091 | the standalone `cormidia compare` slice | 2 | 0 | 0 | pending · 0/2 families traced |
| HB-092 | EpisodePlan integration | 0 | 0 | 0 | pending |
| HB-093 | the selection-judge corpus and calibration | 3 | 0 | 0 | pending · 0/3 families traced |
| HB-094 | planner activation and optional parallelism | 0 | 0 | 0 | pending |
| HB-100 | HB-100 | 2 | 6 | 40 | landed · 2/2 families traced |
| HB-101 | HB-101 | 12 | 2 | 20 | landed · 12/12 families traced |
| HB-102 | HB-102 | 9 | 5 | 32 | landed · 8/9 families traced |
| HB-103 | HB-103 | 9 | 13 | 60 | landed · 9/9 families traced |
| HB-104 | HB-104 | 12 | 4 | 29 | landed · 12/12 families traced |
| HB-105 | HB-105 | 4 | 3 | 29 | landed · 4/4 families traced |
| HB-106 | HB-106 | 2 | 2 | 13 | landed · 2/2 families traced |
| HB-107 | HB-107 | 4 | 3 | 24 | landed · 4/4 families traced |
| HB-108 | HB-108 | 1 | 0 | 0 | landed · 0/1 families traced |
| HB-109 | HB-109 | 2 | 2 | 6 | landed · 2/2 families traced |
| HB-110 | HB-110 | 1 | 2 | 5 | landed · 1/1 families traced |
| HB-111 | HB-111 | 0 | 0 | 0 | landed |
| HB-112 | DONE 2026-08-12 | 0 | 0 | 0 | landed |
| HB-113 | HB-113 | 2 | 1 | 26 | landed · 2/2 families traced |
| HB-114 | HB-114 | 0 | 0 | 0 | landed |
| HB-115 | HB-115 | 1 | 1 | 26 | landed · 1/1 families traced |
| HB-116 | HB-116 | 1 | 1 | 26 | landed · 1/1 families traced |
| HB-117 | HB-117 | 1 | 2 | 32 | landed · 1/1 families traced |
| HB-118 | HB-118 | 0 | 0 | 0 | landed |
| HB-151 | malformed roadmap and | 1 | 1 | 5 | landed · 1/1 families traced |

### Wave outcome-acceptance

| Ticket | What it covers | Families | Files | Tests | Status |
| --- | --- | --- | --- | --- | --- |
| HB-120 | HB-120 | 1 | 5 | 31 | landed · 1/1 families traced |
| HB-121 | HB-121 | 3 | 2 | 30 | landed · 3/3 families traced |
| HB-122 | HB-122 | 3 | 4 | 39 | landed · 3/3 families traced |
| HB-123 | HB-123 | 1 | 1 | 12 | landed · 1/1 families traced |
| HB-124 | HB-124 | 2 | 1 | 17 | landed · 2/2 families traced |
| HB-125 | HB-125 | 1 | 4 | 27 | landed · 1/1 families traced |
| HB-126 | HB-126 | 1 | 2 | 20 | landed · 1/1 families traced |
| HB-127 | HB-127 | 7 | 10 | 93 | landed · 7/7 families traced |
| HB-128 | HB-128 | 15 | 7 | 73 | landed · 15/15 families traced |
| HB-129 | HB-129 | 1 | 4 | 37 | landed · 1/1 families traced |
| HB-130 | HB-130 | 3 | 5 | 48 | landed · 3/3 families traced |
| HB-145 | job refusal, agreement, and critical-operation contract (LANDED) | 3 | 1 | 6 | landed · 3/3 families traced |

### Wave execution

| Ticket | What it covers | Families | Files | Tests | Status |
| --- | --- | --- | --- | --- | --- |
| HB-131 | HB-131 | 4 | 0 | 0 | landed · 0/4 families traced |

### Wave run-1

| Ticket | What it covers | Families | Files | Tests | Status |
| --- | --- | --- | --- | --- | --- |
| HB-132 | HB-132 | 0 | 0 | 0 | landed |

### Wave steady-state

| Ticket | What it covers | Families | Files | Tests | Status |
| --- | --- | --- | --- | --- | --- |
| HB-133 | Builder/Reviewer provider-family pin (LANDED 2026-08-12, | 1 | 3 | 16 | landed · 1/1 families traced |
| HB-134 | GTM tripwires (TRIGGERED — deliberately no work now) | 0 | 0 | 0 | pending |
| HB-135 | operation-aware secrets classifier (LANDED 2026-08-12) | 2 | 2 | 24 | landed · 2/2 families traced |
| HB-136 | campaign kill-boundary sweep (LANDED) | 3 | 9 | 69 | landed · 3/3 families traced |
| HB-140 | machine-catalog drift gate (LANDED) | 1 | 2 | 27 | landed · 1/1 families traced |

### Wave ci

| Ticket | What it covers | Families | Files | Tests | Status |
| --- | --- | --- | --- | --- | --- |
| HB-152 | HB-152 | 2 | 4 | 59 | landed · 2/2 families traced |

### Wave retrospective

| Ticket | What it covers | Families | Files | Tests | Status |
| --- | --- | --- | --- | --- | --- |
| HB-137 | a record naming the adapter families the #337–#340 GitHub PRs already | 14 | 12 | 179 | landed · 13/14 families traced |
| HB-138 | the same kind of record for the consequence-split families the #313–#316 | 4 | 9 | 63 | landed · 4/4 families traced |
| HB-139 | the same for the forty-plus regression detectors, including CF-REG-403, | 56 | 75 | 489 | landed · 55/56 families traced |

### Wave campaign-finding

| Ticket | What it covers | Families | Files | Tests | Status |
| --- | --- | --- | --- | --- | --- |
| HB-153 | when a gate | 1 | 1 | 15 | landed · 1/1 families traced |
| HB-154 | two new rulings you gave the same day | 1 | 3 | 16 | landed · 1/1 families traced |

### Wave structural

| Ticket | What it covers | Families | Files | Tests | Status |
| --- | --- | --- | --- | --- | --- |
| HB-155 | HB-155 | 6 | 5 | 46 | pending · 3/6 families traced |

### Wave governed

| Ticket | What it covers | Families | Files | Tests | Status |
| --- | --- | --- | --- | --- | --- |
| HB-156 | HB-156 | 1 | 2 | 15 | pending · 1/1 families traced |

## Evidence-cited families (non-test lanes)

Existence is verified; the state is the family's own honest declaration. Whether
the artifact proves its obligation is the fidelity audit's judgment.

| Family | State | Artifact | Found |
| --- | --- | --- | --- |
| CF-ACC-GATE | incomplete | `acceptance/run-1-result.md` | yes |
| CF-ACC-S1 | incomplete | `acceptance/run-1-result.md` | yes |
| CF-ACC-S2 | incomplete | `acceptance/run-1-human-report.md` | yes |
| CF-ACC-S3 | incomplete | `acceptance/run-1-human-report.md` | yes |
| CF-B23-L3 | incomplete | `research/adapters/2026-08-07_opencode-adapter-certification.md` | yes |
| CF-OPS-ROT | unobserved | `tests/ops/soak-protocol.ts` | yes |
| CF-S10-qual | inconclusive | `validation-design/golden-sets/human-validation.json` | yes |
| CF-S3-judge | inconclusive | `validation-design/golden-sets/human-validation.json` | yes |
| CF-S3-qual | inconclusive | `validation-design/golden-sets/human-validation.json` | yes |

## Red findings

- **agreement:** family CF-INV-017 is in the manifest but not in case-catalog.md
- **agreement:** family CF-B31 is in the manifest but not in case-catalog.md
- **agreement:** family CF-B31-L3 is in the manifest but not in case-catalog.md
- **agreement:** family CF-REG-382: layers disagrees (manifest "app provision-repo --execute`, with `ACTION_IDENTITY_VERSION` 7→8 cancelling in-flight grants at landing per the F-PT-023 implementation rule; deliberately NOT folded into `repo-collaboration`, whose budgeted tier the composed gate reaches whenever the target verifies as the app's own configured repository — which a provisioning target IS, so folding them would have made repository creation agent-decidable; spec: `tests/unit/cf-reg-382/repo-provisioning-classification.test.ts` (red-then-green: 19 failures against the pre-fix classifier), plus the CI-found companion defect — `git commit-tree` needs an author identity git resolves from config Cormidia does not own, so a machine with none (a fresh onboarding machine, and the CI runner) would have created the repository on GitHub and THEN failed at the commit; the preflight now refuses locally before any network call, and the detector forces the condition deterministically with `user.useConfigOnly` because `git var` auto-detects `user@hostname` on macOS but not on CI — the exact asymmetry that let it through a green local run; the SECOND CI run then exposed the cause underneath — `publicationGit` snapshotted `process.env` at module load, so the suites' own `GIT_AUTHOR_*` pinning did nothing (ESM hoists imports above module bodies, so a caller setting a variable at the top of its file is already too late), and the substrate now reads the environment at CALL time with the hardened values still layered last; detector `tests/hermetic/cf-reg-382/git-env-call-time.test.ts`, red-then-green — plus `tests/hermetic/cf-reg-382/provisioning-transaction.test.ts`, `…/provisioning-verification.test.ts`, and `…/scaffold-path-agreement.test.ts` for the governed lifecycle this class exists to make safe]", markdown "1/2")
- **agreement:** family CF-REG-382: oracle disagrees (manifest "1/2", markdown "refusal+det")
- **agreement:** family CF-REG-382: risk disagrees (manifest "refusal+det", markdown "REG")
- **agreement:** ticket HB-155: families disagree (manifest "CF-B31,CF-B31-L3,CF-C-B31,CF-INV-017,CF-J03-R,CF-REG-374", backlog "CF-C-B31,CF-J03-R,CF-REG-374")
- **forward:** CF-B09a has no citing spec but its owning ticket HB-012 is LANDED
- **forward:** CF-C-B09A has no citing spec but its owning ticket HB-012 is LANDED
- **forward:** CF-C-B13 has no citing spec but its owning ticket HB-040 is LANDED
- **forward:** CF-C-B17 has no citing spec but its owning ticket HB-013 is LANDED
- **forward:** CF-IF-COMPARE has no citing spec but its owning ticket HB-033 is LANDED
- **forward:** CF-S10-env has no citing spec but its owning ticket HB-102 is LANDED
- **forward:** CF-REG-403 has no citing spec but its owning ticket HB-139 is LANDED
- **backward:** tests/unit/cf-auth-mode/credential-observation.test.ts cites unknown family "CF-AUTH-MODE"
- **backward:** tests/unit/cf-auth-mode/harness-auth-config.test.ts cites unknown family "CF-AUTH-MODE"
- **backward:** tests/unit/cf-auth-mode/readiness-auth-verification.test.ts cites unknown family "CF-AUTH-MODE"
- **backward:** tests/unit/cf-auth-mode/subscription-accounting.test.ts cites unknown family "CF-AUTH-MODE"
- **backward:** tests/unit/cf-reg-360/install-proof-contract.test.ts cites unknown family "CF-REG-360"
- **status-honesty:** HB-012 is LANDED but its family CF-B09a has no citing spec
- **status-honesty:** HB-012 is LANDED but its family CF-C-B09A has no citing spec
- **status-honesty:** HB-013 is LANDED but its family CF-C-B17 has no citing spec
- **status-honesty:** HB-033 is LANDED but its family CF-IF-COMPARE has no citing spec
- **status-honesty:** HB-040 is LANDED but its family CF-C-B13 has no citing spec
- **status-honesty:** HB-102 is LANDED but its family CF-S10-env has no citing spec
- **status-honesty:** HB-139 is LANDED but its family CF-REG-403 has no citing spec

[validation-trace] RED — 65 finding(s):
  - agreement: family CF-INV-017 is in the manifest but not in case-catalog.md
  - agreement: family CF-B31 is in the manifest but not in case-catalog.md
  - agreement: family CF-B31-L3 is in the manifest but not in case-catalog.md
  - agreement: family CF-REG-382: layers disagrees (manifest "app provision-repo --execute`, with `ACTION_IDENTITY_VERSION` 7→8 cancelling in-flight grants at landing per the F-PT-023 implementation rule; deliberately NOT folded into `repo-collaboration`, whose budgeted tier the composed gate reaches whenever the target verifies as the app's own configured repository — which a provisioning target IS, so folding them would have made repository creation agent-decidable; spec: `tests/unit/cf-reg-382/repo-provisioning-classification.test.ts` (red-then-green: 19 failures against the pre-fix classifier), plus the CI-found companion defect — `git commit-tree` needs an author identity git resolves from config Cormidia does not own, so a machine with none (a fresh onboarding machine, and the CI runner) would have created the repository on GitHub and THEN failed at the commit; the preflight now refuses locally before any network call, and the detector forces the condition deterministically with `user.useConfigOnly` because `git var` auto-detects `user@hostname` on macOS but not on CI — the exact asymmetry that let it through a green local run; the SECOND CI run then exposed the cause underneath — `publicationGit` snapshotted `process.env` at module load, so the suites' own `GIT_AUTHOR_*` pinning did nothing (ESM hoists imports above module bodies, so a caller setting a variable at the top of its file is already too late), and the substrate now reads the environment at CALL time with the hardened values still layered last; detector `tests/hermetic/cf-reg-382/git-env-call-time.test.ts`, red-then-green — plus `tests/hermetic/cf-reg-382/provisioning-transaction.test.ts`, `…/provisioning-verification.test.ts`, and `…/scaffold-path-agreement.test.ts` for the governed lifecycle this class exists to make safe]", markdown "1/2")
  - agreement: family CF-REG-382: oracle disagrees (manifest "1/2", markdown "refusal+det")
  - agreement: family CF-REG-382: risk disagrees (manifest "refusal+det", markdown "REG")
  - agreement: ticket HB-155: families disagree (manifest "CF-B31,CF-B31-L3,CF-C-B31,CF-INV-017,CF-J03-R,CF-REG-374", backlog "CF-C-B31,CF-J03-R,CF-REG-374")
  - forward: CF-B09a has no citing spec but its owning ticket HB-012 is LANDED
  - forward: CF-C-B09A has no citing spec but its owning ticket HB-012 is LANDED
  - forward: CF-C-B13 has no citing spec but its owning ticket HB-040 is LANDED
  - forward: CF-C-B17 has no citing spec but its owning ticket HB-013 is LANDED
  - forward: CF-IF-COMPARE has no citing spec but its owning ticket HB-033 is LANDED
  - forward: CF-S10-env has no citing spec but its owning ticket HB-102 is LANDED
  - forward: CF-REG-403 has no citing spec but its owning ticket HB-139 is LANDED
  - backward: tests/unit/cf-auth-mode/credential-observation.test.ts cites unknown family "CF-AUTH-MODE"
  - backward: tests/unit/cf-auth-mode/harness-auth-config.test.ts cites unknown family "CF-AUTH-MODE"
  - backward: tests/unit/cf-auth-mode/readiness-auth-verification.test.ts cites unknown family "CF-AUTH-MODE"
  - backward: tests/unit/cf-auth-mode/subscription-accounting.test.ts cites unknown family "CF-AUTH-MODE"
  - backward: tests/unit/cf-reg-360/install-proof-contract.test.ts cites unknown family "CF-REG-360"
  - status-honesty: HB-012 is LANDED but its family CF-B09a has no citing spec
  - status-honesty: HB-012 is LANDED but its family CF-C-B09A has no citing spec
  - status-honesty: HB-013 is LANDED but its family CF-C-B17 has no citing spec
  - status-honesty: HB-033 is LANDED but its family CF-IF-COMPARE has no citing spec
  - status-honesty: HB-040 is LANDED but its family CF-C-B13 has no citing spec
  - status-honesty: HB-102 is LANDED but its family CF-S10-env has no citing spec
  - status-honesty: HB-139 is LANDED but its family CF-REG-403 has no citing spec
  - structure: tests/fixtures/adapters/cf-b24-cf-c-b24/cursor-double.test.ts cites CF-REG-403 but is not under a directory named for that family
  - structure: tests/fixtures/git-repo.test.ts header cites no concrete CF family
  - structure: tests/fixtures/kill-point.test.ts header cites no concrete CF family
  - structure: tests/fixtures/org-home.test.ts header cites no concrete CF family
  - structure: tests/fixtures/state-home.test.ts header cites no concrete CF family
  - structure: tests/fixtures/synthetic-secret.test.ts header cites no concrete CF family
  - structure: tests/fixtures/walk.test.ts header cites no concrete CF family
  - structure: tests/hermetic/cf-b13-cf-j10-i-cf-j10-r-cf-j10-rc-cf-j10-s-cf-sm-event-c-cf-sm-event-i-cf-sm-event-l-cf-sm-event-r/cf-b13-content-identity.test.ts cites CF-B13 but its header does not cite owning ticket HB-040
  - structure: tests/hermetic/cf-b13-cf-j10-i-cf-j10-r-cf-j10-rc-cf-j10-s-cf-sm-event-c-cf-sm-event-i-cf-sm-event-l-cf-sm-event-r/cf-b13-content-identity.test.ts cites CF-J10-I but its header does not cite owning ticket HB-040
  - structure: tests/hermetic/cf-b13-cf-j10-i-cf-j10-r-cf-j10-rc-cf-j10-s-cf-sm-event-c-cf-sm-event-i-cf-sm-event-l-cf-sm-event-r/cf-b13-content-identity.test.ts cites CF-SM-EVENT-I but its header does not cite owning ticket HB-040
  - structure: tests/hermetic/cf-b13-cf-j10-i-cf-j10-r-cf-j10-rc-cf-j10-s-cf-sm-event-c-cf-sm-event-i-cf-sm-event-l-cf-sm-event-r/cf-b13-content-identity.test.ts cites CF-SM-EVENT-L but its header does not cite owning ticket HB-040
  - structure: tests/hermetic/cf-j06-i-cf-j06-r-cf-j06-rc-cf-j06-s/cf-b09a-grant-expiry-disposition.test.ts cites CF-B09a but is not under a directory named for that family
  - structure: tests/hermetic/cf-j06-i-cf-j06-r-cf-j06-rc-cf-j06-s/cf-b09a-grant-expiry-disposition.test.ts cites CF-C-B09A but is not under a directory named for that family
  - structure: tests/hermetic/cf-j06-i-cf-j06-r-cf-j06-rc-cf-j06-s/cf-b09a-grant-expiry-disposition.test.ts cites CF-J06-I but its header does not cite owning ticket HB-012
  - structure: tests/hermetic/cf-reg-374/stateful-decomposition.test.ts cites family group CF-J03; cite a concrete family id
  - structure: tests/hermetic/cf-reg-382/provisioning-transaction.test.ts cites CF-REG-382 but its header does not cite owning ticket HB-139
  - structure: tests/hermetic/cf-reg-382/provisioning-verification.test.ts cites CF-REG-382 but its header does not cite owning ticket HB-139
  - structure: tests/hermetic/cf-reg-382/scaffold-path-agreement.test.ts cites CF-REG-382 but its header does not cite owning ticket HB-139
  - structure: tests/hermetic/cf-reg-384/new-app-target-preflight.test.ts cites CF-B15 but is not under a directory named for that family
  - structure: tests/hermetic/cf-reg-384/new-app-target-preflight.test.ts cites CF-INV-015 but is not under a directory named for that family
  - structure: tests/hermetic/cf-reg-384/new-app-target-preflight.test.ts cites CF-J02-R but is not under a directory named for that family
  - structure: tests/hermetic/cf-reg-384/new-app-target-preflight.test.ts cites CF-J02-S but is not under a directory named for that family
  - structure: tests/hermetic/cf-reg-385/onboarding-identity-refusal.test.ts cites CF-B01 but is not under a directory named for that family
  - structure: tests/hermetic/cf-reg-385/onboarding-identity-refusal.test.ts cites CF-INV-008 but is not under a directory named for that family
  - structure: tests/hermetic/cf-reg-385/onboarding-identity-refusal.test.ts cites CF-INV-015 but is not under a directory named for that family
  - structure: tests/hermetic/cf-reg-385/onboarding-identity-refusal.test.ts cites CF-J02-R but is not under a directory named for that family
  - structure: tests/hermetic/cf-reg-385/onboarding-identity-refusal.test.ts cites CF-J02-S but is not under a directory named for that family
  - structure: tests/unit/cf-hb107/shared-orchestrator-facade.test.ts header cites no concrete CF family
  - structure: tests/unit/cf-reg-359/install-target-classification.test.ts cites CF-REG-359 but its header does not cite owning ticket HB-139
  - structure: tests/unit/cf-reg-359/skill-link-resilience.test.ts cites CF-REG-359 but its header does not cite owning ticket HB-139
  - structure: tests/unit/cf-reg-385/repository-identity.test.ts cites CF-B01 but is not under a directory named for that family
  - structure: tests/unit/cf-reg-385/repository-identity.test.ts cites CF-INV-008 but is not under a directory named for that family
  - structure: tests/unit/cf-reg-385/repository-identity.test.ts cites CF-INV-015 but is not under a directory named for that family
  - structure: tests/unit/cf-reg-385/repository-identity.test.ts cites CF-J02-R but is not under a directory named for that family
  - structure: tests/unit/cf-reg-385/repository-identity.test.ts cites CF-J02-S but is not under a directory named for that family
  - structure: tests/unit/taste-placeholder-skip.test.ts does not begin with a comment header
  - structure: tests/unit/taste-placeholder-skip.test.ts header cites no concrete CF family
  - structure: tests/unit/worktree-lifecycle.test.ts does not begin with a comment header
  - structure: tests/unit/worktree-lifecycle.test.ts header cites no concrete CF family
```
