# Frozen pre-rebuild validation corpus — DO NOT READ

**Agents must never read, cite, run, or take design cues from anything under
this directory.** That is the point of the name.

Archived 2026-07-31 (docs/PURPOSE.md → Decided, v2.9). Operon's validation
surface is being rebuilt from first principles by the Validation-Design-Agent
(validation-harness-design skill, five-layer nomenclature); the replacement
harness lands under `claude-tests/`. Reading the incumbent suite would anchor
the new design on the old one's structure — the rebuild protocol forbids it.

Contents (moved intact, full history preserved by git):

| Path here | Was |
| --- | --- |
| `test/` | offline vitest suite, conformance/gate/guard tests |
| `eval/` | qualification & release-gate machinery, benchmarks, campaign data |
| `docs-testing/` | `docs/testing/` runbook + journey |
| `scripts-eval/` · `scripts-ci/` | eval entrypoints, CI change classifier |
| `codex-tests/` | prior Codex-built harness-design corpus (untracked node_modules removed) |
| `vitest.live.config.ts` · `playwright.observe.config.ts` | live-suite and browser-suite configs |
| `seed-benchmark-repo.sh` · `setup-sandbox-repo.sh` | benchmark/e2e sandbox seeding |

Release gating is **suspended** while archived (the fail-closed
release-currency lane and attestation lived in `eval/` + `scripts-eval/`);
the replacement harness owns qualification going forward.

To resurrect anything: `git mv` it back out and restore the package.json
scripts and workflow lanes from git history at commit ee34616's lineage.
