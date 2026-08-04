# Command evidence

| Command | Result |
| --- | --- |
| `git fetch origin` | Pass; `origin/main` = `86f0727326d17063e23878d0c846b52154c8f3dd` |
| Focused CF-REG-251, HB-108, HB-109, HB-110 tests | Pass, including seeded violations |
| `pnpm test` | Pass; 157 files, 1,024 pass, 1 intentional skip |
| Repeated pre-final `pnpm test` runs | Two consecutive passes after hardening |
| `pnpm typecheck` | Pass |
| `pnpm build` | Pass |
| `git diff --check` | Pass |
| Protected-path diff query | Pass; empty result |
| `git write-tree` | `9a9453188e6a2fb51bedf9e74059f40f8968f758` |

No provider-backed, live, eval, soak, publication, deployment, scheduler, or
release command was run.
