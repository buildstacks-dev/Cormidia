# Command Evidence

Assessment: `20260804T164335Z-abe087e950dc`
Working directory: `/Users/bikram/Build/Cormidia-worktree-230-232`

Every retained final command was executed without a shell by the audit skill's
`record_command.py`. Each evidence directory contains the argv/cwd/timestamps,
exit code, duration, output hashes, and complete stdout/stderr.
Recorder-added terminal blank lines were removed to satisfy the repository's
`git diff --check` gate; the corresponding stdout hashes were recomputed after
that whitespace-only normalization.

| Command | Result | Retained evidence |
|---|---|---|
| `pnpm vitest run tests/hermetic/cf-reg-232/cf-reg-232-planner-publication.test.ts tests/hermetic/cf-reg-230/cf-reg-230-planner-intake.test.ts tests/unit/cf-reg-230/production-scheduler-lifecycle.test.ts tests/unit/cf-hb103-105/production-wiring.test.ts` | exit 0; 4 files, 22 tests passed, 0 skipped | `evidence/focused-lifecycle-final4/` |
| `pnpm test` | exit 0; 161 files passed; 1,044 passed and 1 established unrelated skip | `evidence/pnpm-test-final4/` |
| `pnpm typecheck` | exit 0 | `evidence/pnpm-typecheck-final4/` |
| `pnpm build` | exit 0 | `evidence/pnpm-build-final4/` |
| `git diff --check` | exit 0, empty output | `evidence/git-diff-check-final4/` |
| `git diff --cached --check` | exit 0, empty output after the complete candidate and evidence package were staged | `evidence/git-cached-diff-check-final2/` |
| `git diff --cached --name-only` | exit 0; complete non-audit candidate path inventory, no protected path | `evidence/candidate-path-list-final/` |
| `git -C /Users/bikram/Build/Cormidia diff --exit-code` | exit 0, empty output; operator tracked bytes unchanged | `evidence/operator-checkout-diff-final/` |
| `git -C /Users/bikram/Build/Cormidia status --short` | exit 0; only pre-existing `?? .agents/` | `evidence/operator-checkout-status-final/` |
| assurance artifact checker | exit 0, `Assurance artifact check: PASS` | `evidence/assurance-artifact-check-final/` |

## Sensitivity and hardening history

During audit hardening, the new targeted RoadmapPlan lost-acknowledgement test
first failed: the durable snapshot source had not been threaded through the
scheduled-roadmap wrapper, so replay classified its own accepted authority as
a conflict. The source binding was fixed, the targeted seed passed, and the
complete 21-case focused gate plus full repository gate above were rerun green.
This intermediate detector failure is implementation evidence, not a waived or
retried final gate.

## Repository and scope checks

- Candidate base was fetched `origin/main@abe087e950dcb0721a753c56432f116be01483a8`.
- The isolated candidate worktree was created at the path above on
  `codex/issues-230-232`.
- The human checkout remained on `main@abe087e950dcb0721a753c56432f116be01483a8`;
  its tracked diff hash was the empty-patch Git hash
  `e69de29bb2d1d6434b8b29ae775ad8c2e48c5391`, and its only status entry remained
  the pre-existing untracked `.agents/` directory.
- Candidate path review found no change to `TASTE.md`, `roles.yaml`,
  `pipelines.yaml`, `prompts/**`, `docs/PURPOSE.md`, or any `AGENTS.md`.
- No file under `archive-do-not-read/**` was read, cited, run, or changed.
- No provider-backed, real-GitHub mutation, live, eval, soak, deployment,
  publication, scheduler-installation, or release command ran.

## Unavailable evidence

`CLM-EXTERNAL` and I2 semantic review remain explicitly unavailable. Their
bounded next procedure and acceptance/cleanup conditions are in
`docs/qualification/planner-publication-qualification.md`; they are not inferred
from the green offline commands.
