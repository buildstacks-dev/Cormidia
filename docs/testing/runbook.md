# Testing: what runs, when, and why

Reference companion to AGENTS.md → Testing expectations. **Root AGENTS.md holds
the summary table; [Required runs by changed path](#required-runs-by-changed-path)
below is the full per-path rulebook**, and the rest of this file is the **map**
(what each command covers, what CI does with it, and why the integrity machinery
exists). If they disagree, root AGENTS.md wins and this file is stale — fix it.
The nested AGENTS.md files in `src/runtime/`, `src/observe/`, `src/report/`,
and `eval/` restate the local subset for agents working in those trees.

Everything on this page is **token-free**. No command here constructs a provider
runtime or spends money. The provider-spending commands are listed in
[Never run these by accident](#never-run-these-by-accident).

## The local loop

CI is not your inner loop. These are the numbers that decide your day:

| When | Command | Time |
| --- | --- | --- |
| While editing | `pnpm exec vitest run test/<area>` (or watch mode) | 0.2–3s |
| Check one contract gate | `pnpm eval:contracts:strict` | 0.6s |
| Observer/Reports UI change | `pnpm test:observe-browser` | ~4s |
| Packaging/onboarding change | `pnpm smoke:onboarding` | ~25s |
| **Before you push** | `pnpm test && pnpm typecheck` | **~2.3 min** |

Run the focused suite while you work and the full suite once before pushing.
Re-running the whole suite after every edit is the single easiest way to make
this repo feel slow.

If you have already run `pnpm test`, use the **atomic** contract commands
(`pnpm eval:contracts`, `pnpm eval:contracts:strict`) rather than the
`test:transformation*` composites — the composites re-run ~98s of Vitest to
reach a 0.6s assertion. The composites exist so a single command is
self-contained when you have *not* run the suite.

### EpisodePlanner coverage

The EpisodePlanner change is tested at behavior boundaries rather than by
snapshotting one model response:

| Contract | Focused files |
| --- | --- |
| Fixed default, adaptive candidate narrowing, atomic tuple validation | `test/apps.test.ts`, `test/roles.test.ts`, `test/execution-assignments.test.ts` |
| Creator-scope completeness/provenance and non-inferred bypass | `test/episode-planner.test.ts`, `test/episode-orchestrator.test.ts` |
| Plan schema, DAG, budgets, safety route, immutable versions/revisions | `test/loop/episode-plan.test.ts`, `test/loop/episode-replan.test.ts`, `test/loop/episode-plan-executor.test.ts` |
| Fixed planner boot admission, bounded repair, exactly-once settlement | `test/efficiency/planner-admission.test.ts`, `test/episode-planner-runtime.test.ts` |
| Exact plan-derived assignment through adapter request, envelope, journal and ledger | `test/episode-plan-execution.test.ts`, `test/loop/pipeline.test.ts`, adapter tests |
| Scenario presence and important absence (docs, bugs, prototype, product, deploy, migration/auth, incident) | `test/episode-planner-scenarios.test.ts` |

Run the narrowest relevant files while editing, then follow `AGENTS.md` for
the changed paths. Source/config changes require at least `pnpm test`, `pnpm
typecheck`, and `pnpm build`; app/planning/loop paths may also trigger the
repository's sandbox commands. These tests use fake runtimes and temporary
state homes. They do not authorize `pnpm test:live`, GitHub sandbox mutation,
learning activation, or a soak campaign.

The required matrix is explicit: unscoped fixed and adaptive episodes invoke
EpisodePlanner; complete creator-scoped fixed and adaptive episodes normalize
without that provider turn; incomplete or merely inferred scope invokes the
planner. A token-free preview test must assert that it exposes intent,
candidates, safety facts, and the expected planning path while leaving the
exact provider-authored plan `null`. An explain test reads only a persisted
plan and journal; it does not reconstruct workflow from route/tier history.

## Required runs by changed path

The per-path rulebook (moved from root AGENTS.md 2026-07-21).

- Any `src/` change: `pnpm test && pnpm typecheck` (seconds).
- `src/observe/**` or `src/cli/observe.ts` changes: also run `pnpm
  test:observe-browser`, `pnpm build`, `pnpm smoke:onboarding`, and `npm pack
  --dry-run`; server tests must use a real ephemeral loopback port and cover
  capability/security headers, SSE replay/resync, corrupt/torn/legacy state,
  traversal/symlink rejection, and observer-shutdown independence. (Local
  detail: `src/observe/AGENTS.md`.)
- `src/report/**`, `src/cli/report.ts`, or Reports-mode changes: run the same
  browser/build/smoke/pack checks; semantic tests must pin UTC boundaries,
  ledger corruption/concurrency, accounting quality and duplicates,
  deterministic session identity, budget agreement, CSP/L3 exclusion,
  pagination resync, immutable app scope, and read-only behavior. (Local
  detail: `src/report/AGENTS.md`.)
- Packaging, home resolution, CLI discovery, or onboarding changes: also run
  `pnpm smoke:onboarding` and `npm pack --dry-run`; the smoke must use a
  neutral cwd and temporary provider homes so it cannot depend on the source
  repo as an implicit org or touch real installed skills.
- Changes under `eval/**`, `scripts/eval/**`, or transformation eval fixtures:
  run `pnpm eval:validate`, `pnpm test:transformation`, `pnpm
  eval:deterministic`, the complete `pnpm test`, and `pnpm typecheck`.
  `test:transformation:strict` must pass the current scope after the nine
  Phase 6 provider-evidence promotions;
  `test:transformation:future-soak-strict` must independently fail only for
  `I-LIVE-01`. The canonical boundary is `docs/qualification/design.md` → Phase 6
  qualification scope. Never run `eval:github` or `eval:live` merely because
  these files changed, and never execute `eval:soak` merely because soak
  files changed. The provider-quality, first-failure, and
  one-decisive-campaign invariants live in `eval/AGENTS.md` → Invariants and
  `docs/DEVELOPMENT.md`.
- Changes that affect app onboarding, `apps.yaml`, bootstrap, planning, or
  loop behavior must also be exercised against the live sandbox apps, not
  only unit tests. Current targets: `~/Build/operon-sandbox-alpha`,
  `~/Build/operon-sandbox-beta`, `~/Build/operon-sandbox-gamma`, and
  `~/Build/operon-sandbox-delta` (Ledgerette — the from-scratch onboarding +
  loop proof). Run the relevant bootstrap/plan/loop smoke plus each sandbox
  app's own available checks (alpha: `npm test && npm run lint`; beta:
  `npm test`; gamma: `npm test && npm run lint` plus the role smokes; delta:
  `npm test && npm run lint` — its `.operon/config.yaml` sets the
  `setup_command` the `setup` gate runs) and report the exact
  commands/results.
- Scheduler lifecycle, dispatch-evidence, or scheduler-health changes must run
  the production-backed `test/scheduler/` suite under temporary HOME, TMPDIR,
  org, state, app, and definition trees with an injected manager. Never
  invoke a real launchd/systemd mutation in tests. The seven-day virtual soak
  must use fake clocks, include restart/fault/isolation cases, and prove
  exact provider settlement plus zero mechanical-runtime construction. L6
  execution remains separately authorized; ordinary changes may run preview
  only.
- M5 loop-state-machine changes should also run the disposable GitHub e2e
  when `gh` auth and `GH_SANDBOX_REPO` are available:
  `pnpm e2e:sandbox:setup` twice for idempotency, then `pnpm e2e:sandbox`.
- `gate.ts` changes: add cases to `test/gate.test.ts` for every new rule —
  both the critical side and a routine near-miss.
- Adapter changes (`src/runtime/adapters/**`): also run `pnpm test:live` and
  record the dated result in `research/` — the live conformance run is the
  only proof the subagent-gate claim still holds.
- `roles.yaml` changes: `pnpm dev roles` must print cleanly; tests stay green.
- `pipelines.yaml` / `prompts/**` changes: `pnpm dev pipelines` must print
  cleanly; `test/loop/pipelines-root.test.ts` pins the selection semantics
  (which passes each tier/trigger runs) — an intent change must change that
  test deliberately, via the same proposal PR.
- CI admission-rule changes (`scripts/ci/**`, `.github/workflows/**`): add a
  case to `test/ci/classify-changes.test.ts` for every rule change — these
  files select which tests run, so they are part of the executable suite (see
  [CI lanes](#ci-lanes)).
- New tests: reuse the composable fixtures `test/fixtures/orgHome.ts` and
  `test/fixtures/fakeClock.ts` instead of a new ad-hoc mkdtemp scaffold.
- Any defect fix: deposit its detector in the same change — the cheapest
  offline test that reconstructs the exact failing state and asserts the
  correct recovery, red against the pre-fix code (prove it by revert or a
  targeted mutation) and green with the fix. Extend the suite that already
  owns the area rather than opening a per-issue file; findings from operator
  runs follow the existing `*-runN-regression` naming. When the failure
  depends on environment, sandbox, or timing and cannot be cheaply reproduced
  offline, guard the nearest deterministic seam instead — a
  provision/preflight assertion that fails cheaply when the invariant is
  broken — and state in the PR that the finding is guarded by preflight, not
  reproduction. A fix that lands without either is incomplete; a live run is
  not a regression test.
- Docs-only changes: nothing to run.

## When CI runs at all

Pushing a branch does **not** run CI. Only these do:

| What you do | CI runs? |
| --- | --- |
| Edit, commit, push a branch with **no PR open** | No |
| Open a PR | Yes |
| Push to a branch **with an open PR** | Yes (previous run is cancelled) |
| Push / merge to `main` | Yes |
| Push a `v*` or `release-*` tag | Yes, plus the release gate |
| Nightly 08:17 UTC | Yes |
| `workflow_dispatch` | Yes, plus the release gate |

Superseded pull-request runs are cancelled. `main` and tag runs never are — this
repository has no branch-protection enforcement, so the `main` run is the only
check a direct push receives.

## CI lanes

`.github/workflows/efficiency-qualification.yml`. A `classify` job resolves the
changed paths through `scripts/ci/classify-changes.mjs` and admits lanes:

| Change | Lanes | What actually runs | Time |
| --- | --- | --- | --- |
| Docs only (`docs/**`, `review/**`, `research/**`, `AGENTS.md`, root `*.md`) | none | nothing | 0.2 min |
| `src/**` | core | build · offline suite ×1 · typecheck · `eval:validate` · `eval:contracts` · `eval:contracts:strict` | 5.1 min |
| `test/**` only | core (no build) | as above, without build | 5.0 min |
| Observer/Reports/packaging/onboarding | core + observer-reports | core, plus Chromium · `test:observe-browser` · `smoke:onboarding` · `npm pack --dry-run` | 7.0 min |
| `eval/**`, `scripts/eval/**` | core | as `src/**` | 5.1 min |
| Workflow, `scripts/ci/**`, `vitest.*`, `playwright.*`, `package.json`, lockfile, `tsconfig*`, `eval/contracts.yaml` | **all** | everything above | 7.0 min |
| Push to `main` (source) | core | as `src/**` | 5.1 min |
| Nightly schedule | **all** + nightly | everything, plus two shuffled runs | 12.4 min |
| Release tag / `workflow_dispatch` | **all** + release-currency | everything, plus `eval:release-verify` | 7.5 min |
| Unresolvable diff, unknown path type | **all** | everything | 7.0 min |

Two rules govern admission:

- **The offline suite runs exactly once.** `test/transformation`, `test/eval`,
  `test/efficiency`, `test/lifecycle`, `test/continuation` and `test/scheduler`
  are all inside `pnpm test:offline`, so no umbrella script re-enters Vitest to
  reach them. `test/transformation/release-gate.test.ts` asserts this and fails
  if a duplicate step reappears.
- **Admission fails open into more testing.** Schedules, tags, manual dispatch,
  an unresolvable diff, and any path matching no rule admit *every* lane. Only
  provably behaviour-free paths admit none. When in doubt the classifier runs
  more, never less.

The nightly shuffle is the one deliberate repetition: seed `20260712` at two
workers detects **order** dependence, seed `12072026` at one worker detects
**concurrency/serialisation** dependence. Neither is testable by the ordinary
run.

Packaged docs (`docs/scheduler/design.md`, `docs/policy.yaml.template`, `README.md`)
count as **product**, not docs — they ship in `npm pack`.

Changing an admission rule requires a case in `test/ci/classify-changes.test.ts`.

## Command reference

| Command | Covers | Notes |
| --- | --- | --- |
| `pnpm test` | every `test/**/*.test.ts`, excluding `*.live.test.ts` | the offline suite; ~2 min |
| `pnpm test:offline` | same, with the CI timeout | what CI runs |
| `pnpm typecheck` | `tsc --noEmit` | seconds |
| `pnpm build` | `tsc` → `dist/` | no offline test needs a real `dist/` |
| `pnpm eval:validate` | contract inventory schema | 0.9s |
| `pnpm eval:contracts` | inventory, scope `all`, exact known-red set | 0.6s |
| `pnpm eval:contracts:strict` | inventory, scope `current`, must be clean | 0.6s |
| `pnpm eval:contracts:future-soak-strict` | scope `future_soak` | **exits non-zero by design** — `I-LIVE-01` until the real soak passes |
| `pnpm test:transformation[:strict]` | `test/transformation` + `test/eval` + the matching contract gate | self-contained composite for local use |
| `pnpm eval:deterministic` | the six eval-adjacent directories | subset of `pnpm test`; ~77s |
| `pnpm eval:deterministic:nightly` | those directories, twice, shuffled | flake/order tripwire |
| `pnpm test:observe-browser` | Playwright Chromium over the Live UI + Reports | ~4s; install once with `pnpm exec playwright install chromium` |
| `pnpm smoke:onboarding` | installed-product fixture from a neutral cwd | ~25s |
| `npm pack --dry-run` | packaged file list | packaging contract |
| `pnpm eval:release-verify` | live product vs the qualified pin | release gate; fail-closed |

## Why the integrity machinery exists

Qualification campaigns cost real money (the Phase 6 grant carries a `$2000`
cumulative ceiling). An efficiency claim is only worth that spend if it cannot be
quietly detached from the thing it certifies. Four content hashes do that:

| Hash | Governs |
| --- | --- |
| `release_package_sha256` | the packaged artifact — what `npm pack` ships, plus the `src` that compiles into it |
| `executable_suite_sha256` | the suite that *grades* the product: `test/`, `scripts/eval/`, `scripts/ci/`, `eval/`, `.github/workflows/`, and the Vitest/Playwright configs |
| `org_fingerprint` | the ratified org surfaces (`roles.yaml`, `pipelines.yaml`, `prompts/`, `TASTE.md`) |
| `system_fingerprint` | resolved runtime dependencies |

The suite hash is the one that looks like overkill and isn't. It exists because
of two defects found in review, not hypotheticals:

- **Shallow checkout (ROOT-001).** The verifier skipped its changed-path check
  when the qualified commit was absent. CI used the default `fetch-depth: 1`, so
  the commit was *always* absent — CI reported green, and deleting git history
  made the integrity check pass. Fixed by failing closed and `fetch-depth: 0`.
- **Ungoverned runner config.** `vitest.config.ts` ships in no package, so
  `release_package_sha256` never saw it — yet it decides which tests run. Adding
  `test/transformation/contracts/**` to its `exclude` would skip the red contract
  tests, report the suite green, and still verify the attestation. Fixed by
  putting the runner configs in the executable suite.

The threat model is not sabotage. It is **an agent or a human under schedule
pressure making CI green by weakening a gate** — which is why AGENTS.md forbids
that in prose and these hashes forbid it mechanically. `scripts/ci/` and
`.github/workflows/` are covered for the same reason: lane admission decides
which tests execute, so a classifier that quietly admitted no lane would be the
same defect wearing different clothes.

The everyday cost of all this is about two seconds per CI run. Integrity is
asserted on every push/PR (deterministic, green whenever the committed evidence
is intact); live product-**currency** is recomputed only at the release gate, so
a legitimate `src` change does not leave per-commit CI permanently red.

## Never run these by accident

These spend provider tokens, mutate external state, or drive an operated org.
None of them is in CI, and `test/transformation/release-gate.test.ts` asserts
they cannot enter it:

`pnpm test:live` · `pnpm eval:live` · `pnpm eval:github` · `pnpm eval:soak` ·
`pnpm eval:prepare` · `pnpm eval:promote` · `pnpm eval:learning-activation` ·
`pnpm e2e:sandbox` · any `operon dispatch` / `loop` / `plan` operation.

Each requires explicit human authorization, an environment switch, and exact
campaign confirmation. See `docs/DEVELOPMENT.md` for the authorization boundary.
