# Validation harness enablement

This directory is the executable handoff that accompanies the ratified design corpus. It deliberately does not rewrite the product repo's package manifest, agent instructions, or CI configuration without review.

1. Pin the architect package in the product repo (use the exact released
   version, or the exact `.tgz` release artifact before registry publication):

   ```bash
   pnpm add --save-dev --save-exact validation-architect@0.1.0
   ```

2. Install `skills/implement-harness-ticket/` in the repository's supported agent-skill location (for example `.agents/skills/implement-harness-ticket/`) and land the ratified `validation-design/agents-md-contribution.md` in the standing agent instructions.
3. Review `ci/validation-trace.yml`, then copy it into the repository's CI workflow directory. It assumes the package and lockfile from step 1 are committed.
4. Prove the same command locally before enabling the gate:

   ```bash
   pnpm exec validation-trace . \
     --manifest validation-design/case-catalog.yaml \
     --tests <tests-root>
   ```

`validation-trace` proves deterministic closure only. Fidelity remains a separate architect audit. A live outcome-acceptance (`L-ACC`) campaign is never implied by installation or CI: it still requires fresh human authorization for its target, scenario set, spend/time ceiling, and permitted effects.
