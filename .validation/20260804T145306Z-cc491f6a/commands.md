# Command evidence

| Command | Result |
| --- | --- |
| Environment detection | Host machine detected; work performed only in the isolated worktree |
| `git fetch origin --prune` | Pass; `origin/main` = `cc491f6adbce464923af833bccac742dc082691c` |
| Focused #181/#154 plus routing/authority tests | Pass; 4 files, 29 tests |
| `pnpm test` | Pass; 159 files, 1,031 pass, 1 intentional skip |
| `pnpm typecheck` | Pass |
| `pnpm build` | Pass |
| `git diff --check` | Pass |
| Protected-path diff query | Pass; empty result |
| Production provider-path source trace | Pass; paid entry points receive app-resolved roles/policy |
| GitHub open-issue enumeration | Pass; 55 issues classified in the routing report snapshot |
| GitHub stale-comment patch | Pass; five historical comments updated in place |

No provider-backed, live, eval, soak, publication, deployment,
scheduler-installation, protected-surface, or release command was run.
