# Command Evidence

Assessment: `20260805T040848Z-4bbb360974f4`

All mutations occurred in `/Users/bikram/Build/Cormidia-release-evidence-gate`.
The dirty human checkout was not altered. `archive-do-not-read/**` was never read,
cited or run.

| Command/action | Result |
| --- | --- |
| origin/GitHub/issue/PR/check inspection | origin/main base `00e00b5b...`; #248 open; named predecessors merged |
| ruleset/branch-protection inspection | unavailable under current private-repository plan; F-PT-018 retained |
| npm/tag/release inspection | npm latest 0.0.1; repo 0.1.1; no v0.1.1 tag/release |
| focused RQ-1/eval/B-17 tests | 39/39 green before full run; later packet hardening green |
| `pnpm test` | 169 files; 1,084 passed; one ratified skip |
| `pnpm typecheck` | success |
| `pnpm build` | success |
| `git diff --check` | success |
| YAML parsing of changed workflow/policy/config | success |
| `npm pack --dry-run --ignore-scripts` | success; 296 files |
| actual `npm pack --ignore-scripts` | success; `cormidia-0.1.1.tgz` in disposable `/tmp` directory |
| `pnpm smoke:package -- <exact tarball>` | success; installed command reported 0.1.1 |
| live/eval/soak/provider campaigns | not run |
| tag/publish/deploy/release/scheduler install | not run |

The pack result is packaging evidence for this implementation only; 0.1.1 remains a
narrow exception and is not represented as an RQ-1-qualified baseline.
