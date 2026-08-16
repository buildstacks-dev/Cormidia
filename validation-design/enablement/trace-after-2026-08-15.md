# Validation trace result — after #431 Parts A/B remediation

Date: 2026-08-15
Source base revision: `e1208dd5ef419f4fda86be0782da005f756773c3`
Command: `pnpm exec validation-trace . --manifest validation-design/case-catalog.yaml --tests tests`
Exit code: `0`

This is the complete post-remediation output required by VA-PLATFORM-001 #431.
It proves deterministic closure only, not test fidelity or product quality.

```text
# Trace report — cormidia

Deterministic design→implementation closure over the case-catalog manifest.
This proves **closure, not fidelity** — whether a citing test truly falsifies
its ratified seed is the fidelity audit's judgment, not this report's claim.

## Summary

- **Families:** 409 (370 implementable · 38 pruned · 1 blocked)
- **Specs:** 312 files · 2224 tests
- **Evidence-cited families:** 9 (0 complete · 5 incomplete · 3 inconclusive · 1 unobserved)
- **Agreement (manifest ↔ markdown catalog):** green
- **Forward closure:** green
- **Backward closure:** green
- **Status honesty:** green
- **Spec structure:** green

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
| HB-012 | HB-012 | 6 | 5 | 29 | landed · 6/6 families traced |
| HB-013 | HB-013 | 11 | 10 | 44 | landed · 11/11 families traced |
| HB-014 | HB-014 | 4 | 10 | 87 | landed · 4/4 families traced |
| HB-015 | HB-015 | 12 | 12 | 75 | landed · 12/12 families traced |
| HB-016 | HB-016 | 1 | 9 | 40 | landed · 1/1 families traced |
| HB-017 | HB-017 | 10 | 9 | 56 | landed · 10/10 families traced |
| HB-141 | HB-141 | 3 | 1 | 13 | landed · 3/3 families traced |
| HB-150 | conservative cross-family error sweep (LANDED) | 1 | 1 | 15 | landed · 1/1 families traced |

### Wave 2

| Ticket | What it covers | Families | Files | Tests | Status |
| --- | --- | --- | --- | --- | --- |
| HB-020 | HB-020 | 6 | 10 | 58 | landed · 6/6 families traced |
| HB-021 | HB-021 | 2 | 3 | 8 | landed · 2/2 families traced |
| HB-022 | HB-022 | 6 | 5 | 17 | landed · 6/6 families traced |
| HB-023 | HB-023 | 7 | 7 | 39 | landed · 7/7 families traced |
| HB-024 | HB-024 | 2 | 2 | 13 | landed · 2/2 families traced |
| HB-025 | HB-025 | 1 | 3 | 21 | landed · 1/1 families traced |
| HB-142 | scheduler-admission matrix and contract (PENDING) | 5 | 5 | 39 | landed · 5/5 families traced |
| HB-148 | store-class crash/truncation/quarantine invariant (LANDED) | 1 | 1 | 9 | landed · 1/1 families traced |

### Wave 3

| Ticket | What it covers | Families | Files | Tests | Status |
| --- | --- | --- | --- | --- | --- |
| HB-030 | HB-030 | 2 | 3 | 17 | landed · 2/2 families traced |
| HB-031 | HB-031 | 5 | 6 | 26 | landed · 5/5 families traced |
| HB-032 | HB-032 | 8 | 8 | 25 | landed · 8/8 families traced |
| HB-033 | HB-033 | 6 | 6 | 29 | landed · 6/6 families traced |
| HB-143 | internal-artifact and incident journeys (PENDING) | 4 | 1 | 8 | landed · 4/4 families traced |
| HB-146 | HB-146 | 1 | 1 | 3 | landed · 1/1 families traced |
| HB-149 | admission/bookkeeping evidence invariant (LANDED) | 1 | 1 | 6 | landed · 1/1 families traced |

### Wave 4

| Ticket | What it covers | Families | Files | Tests | Status |
| --- | --- | --- | --- | --- | --- |
| HB-040 | HB-040 | 10 | 2 | 12 | landed · 10/10 families traced |
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
| HB-051 | HB-051 | 5 | 12 | 144 | landed · 5/5 families traced |
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
| HB-P2 | HB-P2 | 3 | 6 | 42 | landed · 3/3 families traced |
| HB-P4 | HB-P4 | 2 | 4 | 33 | landed · 2/2 families traced |

### Wave parked

| Ticket | What it covers | Families | Files | Tests | Status |
| --- | --- | --- | --- | --- | --- |
| HB-P3 | HB-P3 | 0 | 0 | 0 | landed |
| HB-P5 | HB-P5 | 0 | 0 | 0 | landed |
| HB-P6 | UNPARKED 2026-08-12 by your rulings | 1 | 2 | 43 | landed · 1/1 families traced |
| HB-P7 | still parked, and it is not our choice | 1 | 5 | 52 | pending · 1/1 families traced |

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
| HB-101 | HB-101 | 12 | 3 | 22 | landed · 12/12 families traced |
| HB-102 | HB-102 | 9 | 5 | 32 | landed · 9/9 families traced |
| HB-103 | HB-103 | 9 | 14 | 62 | landed · 9/9 families traced |
| HB-104 | HB-104 | 12 | 5 | 31 | landed · 12/12 families traced |
| HB-105 | HB-105 | 4 | 4 | 31 | landed · 4/4 families traced |
| HB-106 | HB-106 | 2 | 3 | 15 | landed · 2/2 families traced |
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
| HB-126 | HB-126 | 1 | 3 | 22 | landed · 1/1 families traced |
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
| HB-140 | machine-catalog drift gate (LANDED) | 1 | 5 | 52 | landed · 1/1 families traced |

### Wave ci

| Ticket | What it covers | Families | Files | Tests | Status |
| --- | --- | --- | --- | --- | --- |
| HB-152 | HB-152 | 2 | 7 | 84 | landed · 2/2 families traced |

### Wave retrospective

| Ticket | What it covers | Families | Files | Tests | Status |
| --- | --- | --- | --- | --- | --- |
| HB-137 | a record naming the adapter families the #337–#340 GitHub PRs already | 14 | 14 | 206 | landed · 13/14 families traced |
| HB-138 | the same kind of record for the consequence-split families the #313–#316 | 4 | 9 | 63 | landed · 4/4 families traced |
| HB-139 | the same for the forty-plus regression detectors, including CF-REG-403, | 56 | 82 | 558 | landed · 56/56 families traced |

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
| HB-156 | HB-156 | 1 | 5 | 45 | pending · 1/1 families traced |

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

[validation-trace] green — agreement, spec structure, forward, backward, and status-honesty closure hold.
```
