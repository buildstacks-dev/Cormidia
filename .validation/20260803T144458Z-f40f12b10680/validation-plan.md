# Validation Plan

Assessment: `20260803T144458Z-f40f12b10680`
Revision: `f6bb61123d2f7e3b74c6b0e93c27367fc3e93003`

## Assurance target

Commit `f6bb611` has sufficient deterministic L1/L2 evidence for merge of the #209/#211/#228-#231 implementation slice, without authorizing scheduler activation, live qualification, approval/safety changes, #232 recovery, or closure of #230/#227.

## Prioritization rationale

The C2 runtime contains C3 slices at T-5/T-9/T-11: due-window settlement and hard-budget admission can duplicate spend or authorize an extra action, while scheduler evidence can silently mislead operators. Those invariants receive concurrency, crash/restart, partial-settlement, strict-refusal, evidence-state, and negative-control coverage before lower-consequence documentation/package checks. Planner intake and host environment are C2 integration boundaries with explicit external qualification remainders.

## Environments and test data

- Clean linked worktree on macOS ARM64, Node 26.4.0, pnpm 11.10.0.
- Temporary org/state homes, fake clocks, controlled runtimes, deterministic process-owner probes, and fake GitHub seams.
- No credentials, real providers, real scheduler lifecycle mutation, or production GitHub repository mutation.
- Target commit is fixed at `f6bb611`; the `.validation` directory is evidence-only.

## Mandatory merge-blocking gates

| Gate ID | Claim / risk | Technique | Environment | Oracle | Independence | Entry criteria | Pass criteria | Evidence retained |
|---|---|---|---|---|---|---|---|---|
| GATE-001 | CLM-209/211/228/229/230/231 | Focused regression families | offline L1/L2 | typed state/refusal/evidence | I1 + I2 inspection | implementation frozen | 44/44 pass | `evidence/merge-focused-regressions/` |
| GATE-002 | all deterministic claims | Full replacement suite | offline L1/L2 | repository harness | I1 | populated suite | no failures; skip accounted | `evidence/merge-full-offline-suite/` |
| GATE-003 | source/type contracts | strict TypeScript and build | local host | compiler exit | I1 | dependencies installed | exit 0 | `evidence/merge-strict-typecheck/`, `evidence/merge-build/` |
| GATE-004 | packaged/installable behavior | onboarding and npm dry-run | local temp install/package | smoke assertions and package manifest | I1 | build green | exit 0 | `evidence/merge-onboarding-smoke/`, `evidence/merge-package-dry-run/` |
| GATE-005 | scope/frozen paths | adversarial diff inspection | git commit graph | exact path/name review | I2 | target/base fixed | no frozen diff; no parallel recovery vocabulary | verifier report and PR diff |
| GATE-006 | repository process | GitHub required checks/reviews | GitHub Actions | branch protection | external process control | PR published | all required checks green; no unresolved findings | PR checks |

## Conditional gates

- Scheduler activation requires a separately authorized real launchd/systemd install/readback/attributable tick and scoped removal exercise.
- Complete #230 closure requires a disposable real-GitHub publication exercise; general ambiguous recovery remains #232.
- Changed provider adapters would require the authorized changed-adapter L3 campaign; this commit changes no adapter implementation.

## Advisory checks

`git diff --check`, documentation consistency, package contents, and absence of dedicated lint/format scripts. These support maintainability but do not replace behavioral oracles.

## Holdout and adversarial validation

A fresh-context read-only agent receives only the commit/base, constraints, required sources, and audit questions. It inspects implementation and tests independently and may rerun offline checks. The same Codex session provides role separation at I2, not organizational independence.

## Hardening work

- Defect corrections: #209, #211, #228, #229, #230, #231.
- Testability refactor: reusable `DurableClaimStore` with a domain-neutral test family and an enforced claim/commit/settle boundary.
- Validation-only additions: regression families, seeded negative controls, case catalog/contracts, Planner golden cases, and assurance artifacts.
- Audit hardening: zero-time pre-admission, native-cap evidence normalization, pre-commit journal recovery, executed-only alert resolution, pending-until-receipt post-spawn bookkeeping failures, and settle-before-commit refusal.
- Behavioral exclusions: budget escalation and #232 recovery are not implemented.

## Flake, skip, and exception policy

No failing or flaky check may be waived. The full suite has one intentional pre-existing J-14 skip tied to a ratified structural hard stop; it is unrelated to this change and is reported, not counted green. Missing live/CI evidence is incomplete, never inferred from offline success.

## Stop and escalation criteria

Stop for any frozen-path diff, approval/safety dependency, need to invent #232 recovery, failed/empty/weak test, hidden skip, rebase conflict affecting semantics, unresolved review finding, or required-check failure. Never run scheduler install/start, live/eval/soak, release publication, or approval decisions under this assessment.

## Completion criteria

- `SUFFICIENT_FOR_STATED_TARGET`: GATE-001 through GATE-006 pass, I2 review has no unresolved material finding, and the conclusion remains merge-scoped.
- `CONDITIONALLY_SUFFICIENT_FOR_STATED_TARGET`: deterministic gates pass but CI/I2 review is pending or a named non-merge condition remains.
- `INSUFFICIENT_FOR_STATED_TARGET`: a required deterministic/CI gate fails or an unresolved material finding undermines a claim.
- `BLOCKED_FROM_ASSESSMENT`: target, requirements, or safe evidence access cannot be established.
