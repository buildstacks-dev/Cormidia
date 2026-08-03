# Evidence Report

Assessment: `20260803T144458Z-f40f12b10680`
Revision: `f6bb61123d2f7e3b74c6b0e93c27367fc3e93003`
Generated: `2026-08-03T15:30:09Z`

## Scope and assurance target

This C2/L3 assessment asks whether the deterministic #209/#211/#228-#231 slice is ready to merge. It does not assess scheduler activation, paid providers, real GitHub recovery, approvals/safety, #232, #233, #234, or release publication.

## Environment and provenance

- Repository and revision: `cormidia/Cormidia`, base `f40f12b`, target `f6bb611`.
- Working-tree state: implementation committed at `f6bb611`; assurance workspace untracked during evidence capture.
- Runtime/OS/container: host macOS ARM64, Node 26.4.0, pnpm 11.10.0; not a dev container.
- Tool versions: TypeScript via pinned project dependencies, Vitest 3.2.6, git 2.50.1.
- Test data: fake clocks, controlled providers, fake GitHub seams, temporary org/state homes, deterministic process identity, crash hooks.
- External systems: GitHub read-only issue context only; no test mutations, provider calls, scheduler lifecycle, or release operation.
- Reviewer roles and independence: implementer audit plus fresh-context agent verification at I2; no claim of I3 organizational independence.

## Evidence summary by claim

| Claim ID | Status | Evidence class | Concrete evidence | Environment | Independence | Limitations |
|---|---|---|---|---|---|---|
| CLM-209 | verified | test/inspection | 9 CF-REG-209 cases + stopped-state case | offline L2 | I2 follow-up | no host replay |
| CLM-211 | partially verified | test/inspection | 4 CF-REG-211 cases | offline L2 | I2 follow-up | real launchd/systemd unrun |
| CLM-228 | verified | test/analysis | 6 CF-REG-228 cases | offline L2 | I2 follow-up | deterministic guard intentionally needs no paid run |
| CLM-229 | verified | test/analysis/inspection | 5 CF-REG-229 cases and frozen-path inspection | offline L2 | I2 follow-up | chunked cost limitation; input tokens excluded by PURPOSE |
| CLM-230 | partially verified | test/inspection | 7 CF-REG-230 cases + two golden cases | offline L2 | I2 follow-up | real GitHub and #232 unrun |
| CLM-231 | verified | test/analysis | 8 CF-REG-231 + 5 claim-primitive cases | offline L1/L2 | I2 follow-up | no long host soak |
| CLM-SCOPE | partially verified | inspection/test/process | exact diff, 44 focused, 912 pass/1 skip, package/smoke | local host | I2 complete; CI pending | target changes invalidate |

## Commands and procedures executed

| Evidence ID | Command/procedure | Started | Duration | Exit/result | Artifact path | Claims addressed |
|---|---|---|---:|---|---|---|
| EVD-001 | focused Vitest regression families | 15:29:21Z | 1.52s | 0; 44/44 | `evidence/merge-focused-regressions/` | all defect claims |
| EVD-002 | `pnpm test` | 15:28:00Z | 69.25s | 0; 912 pass, 1 accounted skip | `evidence/merge-full-offline-suite/` | all |
| EVD-003 | `pnpm typecheck` | 15:29:21Z | 3.70s | 0 | `evidence/merge-strict-typecheck/` | source contracts |
| EVD-004 | `pnpm build` | 15:29:21Z | 3.57s | 0 | `evidence/merge-build/` | buildability |
| EVD-005 | `pnpm smoke:onboarding` | 15:29:35Z | 14.35s | 0 | `evidence/merge-onboarding-smoke/` | package/runtime integration |
| EVD-006 | `npm pack --dry-run` | 15:29:57Z | 3.81s | 0; 279 files | `evidence/merge-package-dry-run/` | package integration |
| EVD-007 | `git diff --check origin/main...f6bb611` | 15:30:09Z | 0.02s | 0 | `evidence/merge-diff-check/` | CLM-SCOPE |
| EVD-008 | exact frozen-path diff | 15:30:09Z | 0.01s | 0; empty diff | `evidence/merge-frozen-path-diff/` | CLM-229/CLM-SCOPE |
| EVD-009 | changed-file inventory | 15:30:09Z | 0.01s | 0 | `evidence/merge-changed-files/` | CLM-SCOPE |

## Failed, skipped, flaky, blocked, or unavailable checks

- No executed check failed or flaked.
- One pre-existing J-14 harness case is intentionally skipped under a ratified structural hard stop; it is visible in EVD-002 and unrelated to this slice.
- GitHub Actions is pending PR publication.
- Real host scheduler, provider, eval/soak, and disposable GitHub checks were not run because they require separate authorization; related claims remain partial or out of scope.
- No dedicated lint or formatting script exists in `package.json`; strict typecheck, build, diff check, and repository tests are the available token-free gates.

## Sensitivity evidence

Each added detector family includes an explicit seeded negative control. Coverage includes forged duplicate due-window runs, settle-before-commit, two active claim attempts, post-hoc 41st tool execution, zero active-time admission, native terminal cost-cap normalization, ready-only Planner intake, no-input provider construction, scheduler PATH drift, backpressure misclassification, alert resolution without executed recovery, and premature terminalization after post-spawn bookkeeping failure. Crash hooks exercise pre-journal death, post-journal/pre-commit death, and post-provider/pre-settlement reconciliation. All six audit findings were fixed and guarded before final evidence capture.

## Operational and system-level evidence

Temporary-state onboarding smoke and package construction passed. No operational exercise was performed against a host scheduler or external provider/GitHub mutation. This absence limits activation assurance and does not limit the deterministic merge-scoped claim.

## Evidence limitations and invalidation triggers

Any implementation change, semantic rebase resolution, provider/scheduler/planner contract change, or validation-policy change invalidates this report. CI must be added before the final verdict. Scheduler installation/start and live qualification require fresh, separately authorized evidence.
