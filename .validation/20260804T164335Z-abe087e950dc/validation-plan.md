# Validation Plan

Assessment: `20260804T164335Z-abe087e950dc`

## Assurance target

Determine whether the deterministic #230/#232 code-maintenance lifecycle is
suitable for a ready ordinary PR, while keeping real-GitHub/live-org claims
explicitly incomplete.

## Prioritization

The C3 publication state machine and scheduler admission path lead. The plan
first proves failure sensitivity at every ambiguous boundary, then checkout
containment and content safety, then complete intake/authority integration,
then full repository regression/type/build gates. Read-only presentation is
lower criticality but remains acceptance-relevant.

## Environments and test data

- Isolated worktree from fetched `origin/main@abe087e950dc` on macOS arm64.
- Node 26.4.0, pnpm 11.10.0, frozen dependency install.
- Synthetic GitHub double and real local bare/seed/operator/managed Git repos.
- No credentials, provider calls, real GitHub mutations, scheduler install,
  deployment, release, eval, or soak.

## Mandatory gates

| Gate | Claim/risk | Technique | Oracle | Independence | Pass criteria | Evidence |
|---|---|---|---|---|---|---|
| G1 | CLM-EXACTLY-ONCE / RSK-DUPLICATE | L2 fault matrix, intent-tamper seeds, and concurrent resume | exact push/label/roadmap/provider identities and durable state | I1 | all CF-REG-232 cases green, false completion/tamper/successor seeds red | command evidence + test file |
| G2 | CLM-ISO / RSK-WRONG-CHECKOUT | real local Git composition | detached/read-only branch absence and byte-identical operator checkout | I1 | no operator delta, only mutating turn creates branch | command evidence + test file |
| G3 | CLM-INTAKE / RSK-INCOMPLETE-BACKLOG | boundary/value tests | typed diagnostics, 10,001 refusal, Builder remains ready-only | I1 | all CF-REG-230 cases green, ready-only/truncation seeds red | command evidence + test file |
| G4 | CLM-LIFECYCLE | roadmap migration and source-wiring detector | accepted refs/unit/frontier and required production seams | I1 | all composition/source tests green; removed scheduler seam seed red | command evidence + test files |
| G5 | CLM-PUBLICATION-SAFETY | registered-origin, canonical credential, and repository/app protocol-path refusal seeds | refused state, no secret/foreign remote echo, no push | I1 | seeds detected; existing policy-source family green | command evidence |
| G6 | all deterministic claims | `pnpm test`, typecheck, build, diff check | zero failures/skips affecting scope; populated suite | I1 + CI later | all exit zero | commands.md and CI URL |
| G7 | protected-surface preservation | diff review | no protected file changed | I1 | exact path sweep empty | commands.md |

## Conditional/external gates

`CLM-EXTERNAL` requires the separately authorized two-phase plan in
`docs/qualification/planner-publication-qualification.md`. It is not a merge
gate for the deterministic scope requested here, but it remains a blocker for
#230 closure and any broad live-operation claim.

## Holdout and adversarial evidence

Seeded controls cover completed-before-publication, push and RoadmapPlan lost
acknowledgement, remote/roadmap conflict, permanent discovery/push refusal,
transaction tampering, registered-origin mismatch, credential content/error
redaction, ready-only input,
source completeness saturation, partial delivery-unit closure, and removed
production scheduler recovery. No protected external holdout was available;
independence stays I1.

## Hardening work

- Defect corrections: detached Planner worktree, durable transaction,
  recovery-before-admission, completeness refusal, parked-unit migration.
- Testability refactors: extracted managed checkout, injected Git/GitHub/fault
  seams, source lifecycle detector.
- Validation-only: CF-REG-230/232 cases, catalog rows, assurance package,
  non-executed qualification plan.
- Security hardening: canonical credential scan and closed transaction parser.

## Flake, skip, exception policy

Any scoped skip, flaky rerun, empty walk, or failed seeded control blocks the
offline verdict. The repository's one established skipped test is outside the
changed lifecycle and must remain identified in the full-suite evidence; it is
not counted as a pass for these claims. No waiver weakens a gate.

## Stop criteria

Stop on protected-surface diffs, missing predecessor, any live/provider action,
operator checkout mutation, transaction identity ambiguity, remote conflict,
full-suite/type/build failure, or a new product-truth ambiguity. External
qualification stops without an exact human-reviewed config and disposable target.

## Completion criteria

- `CONDITIONALLY_SUFFICIENT_FOR_STATED_TARGET`: G1-G7 pass, focused PR CI is
  pending, CLM-EXTERNAL remains named incomplete.
- `SUFFICIENT_FOR_STATED_TARGET`: G1-G7 and required PR CI pass for the exact
  candidate; this still does not verify CLM-EXTERNAL.
- `INSUFFICIENT_FOR_STATED_TARGET`: a mandatory deterministic gate fails or a
  high/blocker finding remains unresolved.
- `BLOCKED_FROM_ASSESSMENT`: candidate/provenance is unavailable or conflicting.
