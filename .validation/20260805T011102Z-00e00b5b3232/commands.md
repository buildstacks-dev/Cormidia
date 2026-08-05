# Command Evidence

Assessment: `20260805T011102Z-00e00b5b3232`

All mutating development commands ran only in the isolated worktree. No command read
`archive-do-not-read/**`.

| Command/action | Result |
| --- | --- |
| environment detection | host machine; cautious mode |
| `git fetch origin --prune` | success |
| isolated worktree/branch creation | `codex/restore-release-evidence-gate` at `00e00b5b...` |
| `git rev-parse HEAD origin/main` | identical `00e00b5b3232f4a6f60dc0fc3ee38f84d51e106e` |
| GitHub repository/issue/PR/check inspection | #248 open; named predecessors merged; latest main Core checks green |
| GitHub ruleset and branch-protection inspection | both unavailable under current private-repository plan |
| npm/tag/release inspection | npm latest 0.0.1; repository package 0.1.1; no v0.1.1 tag/release |
| `pnpm install --frozen-lockfile` | success |
| `pnpm test` | success: 167 files, 1,058 passed, one ratified skip |
| `pnpm typecheck` | success |
| `pnpm build` | success |
| `git diff --check` before proposal | success |
| provider/live/eval/soak/release actions | not run |

These command results establish the inspected deterministic baseline only. They are
not a release attestation and are deliberately not represented as one.
