# M12 release hardening verification - 2026-07-06

## Scope

M12 closed a post-M11 hardening gap found during sandbox verification:
manual app commands could still assemble against the Operon repo or an empty
context instead of the selected app checkout.

Implemented:

- `src/org/app-workdir.ts` resolves local app checkouts for manual CLIs:
  explicit `--workdir`, managed dispatch clone, sibling app checkout, then
  repo basename.
- `operon plan <app> --dry-run` now uses that resolver instead of defaulting
  to the current working directory.
- `operon run-role <role> --app <app> --dry-run` assembles app-aware context
  and passes it through the synthesized one-pass `runRole` pipeline.
- Dispatched fallback turns now pass their already assembled context into
  `runRole`.

## Package gates

- `pnpm test` - passed, 64 files / 460 tests.
- `pnpm typecheck` - passed.
- `pnpm build` - passed.
- Focused regression run - passed:
  `pnpm test test/app-workdir.test.ts test/loop/runRole.test.ts test/plan.test.ts test/turn-runner.test.ts`
  with 21 tests.

## Sandbox-native checks

- Alpha:
  - `npm test` in `~/Build/operon-sandbox-alpha` - passed, 5 tests.
  - `npm run lint` - passed.
- Beta:
  - `npm test` in `~/Build/operon-sandbox-beta` - passed, 4 tests.
- Gamma:
  - `npm test` in `~/Build/operon-sandbox-gamma` - passed, 3 tests.
  - `npm run lint` - passed.
  - `npm run smoke:sre` - passed, wrote `artifacts/sre/incident-health-down.md`.
  - `npm run smoke:support` - passed, wrote `artifacts/support/digest.md`.
  - `npm run smoke:marketing` - passed, wrote `artifacts/marketing/release-draft.md`.

## Operon app-facing smokes

- `pnpm dev apps` - passed, listed 5 apps.
- `pnpm dev roles` - passed, listed 6 roles.
- `pnpm dev pipelines` - passed, listed 12 pipelines.
- `pnpm dev bootstrap --scan-only` against alpha, beta, and gamma - passed.
- `pnpm dev plan <app> --dry-run` against alpha, beta, and gamma - passed.
  Context bytes differed per app after the fix:
  - alpha: 5121
  - beta: 5189
  - gamma: 5325
- `pnpm dev run-role ... --app ... --dry-run` - passed:
  - planner/alpha: 3 taste layers, 1 memory excerpt.
  - builder/beta: 3 taste layers, 1 memory excerpt.
  - reviewer/alpha: 4 taste layers, 1 memory excerpt.
  - sre/gamma: 3 taste layers, 1 memory excerpt.
  - support/gamma: 4 taste layers, 1 memory excerpt.
  - marketing/gamma: 3 taste layers, 1 memory excerpt.
- `pnpm dev loop --app <app> --once --dry-run` against alpha, beta, and gamma
  - passed; all three reported no ready tickets.
- `pnpm dev dispatch --dry-run` - passed; selected two due alpha scheduled
  turns under the WIP limit.

## Live adapter check

- `pnpm test:live` - passed Claude live conformance:
  - 3 tests passed.
  - 11 live turns.
  - total reported cost: $2.4365.
  - model: `claude-sonnet-5`.
- Codex and pi live tests skipped as expected because `OPERON_CODEX_LIVE=1`
  and `OPERON_PI_LIVE=1` were not set.

## GitHub e2e

`gh auth status` passed for account `bikramkgupta`, but `GH_SANDBOX_REPO` was
not set. The disposable GitHub e2e was not run rather than guessing a target
repo for issue/PR creation.
