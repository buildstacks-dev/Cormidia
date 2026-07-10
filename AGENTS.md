# AGENTS.md

## Scope
Applies to the whole repo. There are no nested AGENTS.md files — this is a
single TypeScript package and one file covers it. `docs/PURPOSE.md` is the decision
log; on conflict, its Decided section wins and this file is stale — fix this file.

## What this repo is
An installable **org runtime**: a standing team of AI agents (Planner, Builder, Reviewer,
SRE, Support, Marketing) that develops and operates a software product through
a private GitHub repo, with a human gating critical ops only. M0-M12 are
complete and the runtime has since been hardened and proven live end-to-end.
ClaudeRuntime/CodexRuntime/PiRuntime are live-conformance-tested; the pass
executor/runlog/bootstrap/qgates layers are real. Quality gates now run a
`setup` gate first (GateId `"setup"`, driven by `setup_command` in an app's
`.operon/config.yaml`) so app deps install in the fresh worktree before
tests/lint. The GitHub ticket state machine takes a real issue through
Builder/Reviewer passes, PR, gates, review fallback, and squash-merge with
unforgeable HMAC merge authorization; company events route by payload kind to
Planner/SRE/Support/Marketing pipelines with channel-presence gating. OKF
memory, full context assembly, scorecards, retro reporting/curation,
status/analyze CLIs, cache-token telemetry, atomic org state, and per-turn
budget caps across adapters are implemented; manual app commands resolve real
app checkouts and app-aware context. `operon-sandbox-delta` ("Ledgerette") is
the primary from-scratch onboarding + loop proof — onboarded live this
campaign and driven end-to-end (both planted bugs fixed by the loop and
merged, PRs #11/#12). alpha and gamma were hardened with more modules/tests;
beta stays deliberately minimal. buildstacks.dev is onboarded as a production
app in `status: onboarding`. The offline suite is 579 tests
(`pnpm test`). Three known limitations are documented in README.md → Known
limitations (empty `tool_counts` + two inert anomaly detectors pending adapter
`tool_use` emission; the manual `loop` path not feeding the org telemetry
ledger; the Codex App-Server read bypass).

## Map
| Path | What it is |
| --- | --- |
| `docs/PURPOSE.md` | Decision log — **read first**; every decision to date |
| `docs/wiki.html` | Standalone code wiki — the three layers, build loop, adapters, gates, and curated reading paths, for an engineer coming up to speed (open in a browser) |
| `TASTE.md` | Packaged org-constitution template, copied by `operon org init` (human-ratified) |
| `roles.yaml` | Packaged executable org-chart template: role → runtime/model/effort/triggers |
| `pipelines.yaml` | Packaged build-protocol template (build/review/fix/ship) — human-ratified; validated by `operon pipelines` |
| `prompts/` | Versioned pass templates the pipelines reference — human-ratified protocol surfaces, one file per pass |
| `TODO.md` | Roadmap + session-handoff state — pick up the top unchecked item |
| `docs/architecture.md` | Detailed design: dispatcher, turn lifecycle, approvals, context, memory, multi-app, bootstrap, GitHub conventions (§11 decisions ratified into docs/PURPOSE.md) |
| `docs/loop.md` | Build-loop engineering design (the center of gravity): pass pipelines, briefs, quality gates, verdicts, ticket state machine — predecessor-orchestrator inheritance audit included |
| `docs/testing-journey.md` | Plain-language explainer: the sandbox test apps, what each build-plan stage proves against them, and the approved gamma coverage for SRE-on-live-service / Support / Marketing |
| `docs/event-schemas.md` | File-drop company-lifecycle event payload contract for Support / Marketing / SRE inputs |
| `docs/capability-matrix.md` | Adapter capability matrix: native / adapter-built / degraded surfaces for Claude, Codex, and pi |
| `src/runtime/` | Runtime contract: `Runtime` interface, critical-ops gate, telemetry, L1–L3 runlog writers, `secret-patterns.ts` (the ONE secret-regex list — redaction and qgates both import it), adapters (Claude Agent SDK, Codex App Server, pi SDK) |
| `src/loop/` | Build loop: pass executor, briefs, quality gates, typed verdicts, GitHub ops, ticket scheduler, M5 ticket state machine, and M6 real pipeline integration (design in `docs/loop.md`) |
| `src/org/` | Standing-org layer: roles/apps loaders, bootstrap, co-planning, scheduler, approvals, budget overlays, trigger routing, context, memory, scorecards, retro |
| `src/org/home.ts` | Package/org/state boundary: complete org initialization, validation, active pointer, and independent state-home resolution |
| `src/cli/` | One module per CLI subcommand (`roles.ts`, `doctor.ts`, …); `src/cli.ts` is a thin dispatch table over them — new subcommands are a new file + one registry line |
| `agent-skills/operon/` | Packaged `$operon` Agent Skill: agent-facing CLI discovery, onboarding, safety, and diagnosis workflow |
| `scripts/link-local.mjs`, `scripts/operon-local.mjs` | Source-backed local installation; exposes `operon` and the skill without conflating package and org homes |
| `test/` | Gate conformance seed + roles.yaml validation + CLI dispatch conformance |
| `test/fixtures/orgHome.ts`, `test/fixtures/fakeClock.ts` | Composable temp-dir fixtures for `~/.operon/<org>/` and app-repo `.operon/` trees, plus a deterministic clock — reuse instead of a new ad-hoc mkdtemp scaffold |
| `test/conformance/` | The adapter-generic conformance suite (`harness.ts` + `cases.ts`): every `Runtime` must pass `runConformanceSuite(name, makeRuntime, opts)` before its role goes live — proven against `src/runtime/testing/fakeRuntime.ts` in `conformance.test.ts`; a live adapter gets its own file reusing the same suite |
| `research/` | Decision records (runtime adapter integration facts, prompt-caching economics) |

## Commands (all verified 2026-07-09)
- Node: >= 26 (`engines`, `.nvmrc`; `nvm use`). Node >= 25 no longer bundles
  corepack — `npm install -g corepack && corepack enable` once per Node
  install. `node:sqlite` is stable on this floor (relevant to the learning
  loop's metrics upgrade path).
- Install: `pnpm install` — pnpm is pinned via `packageManager` (corepack);
  an older global pnpm will fail with store/workspace errors. `corepack
  enable` once if `pnpm --version` doesn't match the pin.
- Local product install: `pnpm link:local` — creates a source-backed
  `~/.local/bin/operon` (or `$OPERON_BIN_DIR/operon`) and links the packaged
  skill at `$CODEX_HOME/skills/operon`; later source edits need no update,
  rebuild, or relink.
- Test: `pnpm test` (vitest — fast, offline; run for any `src/` or
  `roles.yaml` change; `*.live.test.ts` files are excluded here)
- Live adapter tests: `pnpm test:live` (real Claude Agent SDK turns, plus
  opt-in Codex/pi smokes via `OPERON_CODEX_LIVE=1` /
  `OPERON_PI_LIVE=1`; spends real tokens; skips without usable auth — never
  run by `pnpm test`)
- Typecheck: `pnpm typecheck`
- Build: `pnpm build` (tsc → `dist/`)
- Installed-product fixture: `pnpm smoke:onboarding` — temporary home/bin/org/
  state/app trees; exercises source link, skill link, org init, scan + full
  bootstrap, agent introspection, doctor, greenfield dry-run, and compiled CLI
  from a neutral cwd.
- CLI after local install: `operon org init <path> --name <name>` · `operon
  context` · `operon capabilities` · `operon doctor`; every command resolves
  the active org independently of cwd.
- CLI in source-development mode: `pnpm dev roles` · `pnpm dev apps` · `pnpm dev pipelines` ·
  `pnpm dev new-app marketplace --target-dir ../marketplace --repo owner/marketplace --goal "A marketplace for dummy products" --dry-run` ·
  `pnpm dev bootstrap --scan-only <repo>` · `pnpm dev plan <app> --dry-run`
  · `pnpm dev loop --app <app> --once --dry-run` ·
  `pnpm dev dispatch --dry-run` · `pnpm dev approvals` ·
  `pnpm dev budget` · `pnpm dev status` · `pnpm dev analyze` ·
  `pnpm dev retro --date 2026-07-04` ·
  `pnpm dev run-role <role> --app <app> --dry-run` ·
  `pnpm dev run-role <role> --dry-run` · `pnpm dev prune-runs` ·
  `pnpm dev doctor`
- M5 GitHub sandbox e2e: `GH_SANDBOX_REPO=<owner/repo> pnpm e2e:sandbox:setup`
  (idempotent private repo/label setup) then
  `GH_SANDBOX_REPO=<owner/repo> pnpm e2e:sandbox` (creates and merges one
  disposable issue/PR; not part of `pnpm test`)

## Working rules
- **Import direction is one-way:** `src/org` → `src/loop` → `src/runtime`;
  `src/runtime` imports nothing above it. Not lint-enforced yet — hold the
  line manually. This is what keeps the loop extractable.
- **`TASTE.md`, `roles.yaml`, `docs/PURPOSE.md`, `pipelines.yaml`, and `prompts/**`
  are human-ratified surfaces.** Propose changes with rationale; never
  silently rewrite. (The org's own gate treats agent writes to these as
  critical ops — the same etiquette applies to agents working *on* this repo.)
- **`test/gate.test.ts` is the seed of the adapter conformance suite.** Every
  adapter must pass these cases end-to-end (including subagent tool calls)
  before a role goes live on it. Extend the cases; never weaken one to make an
  adapter pass.
- **The builder ≠ reviewer cross-provider test** in `test/roles.test.ts`
  encodes a design decision (uncorrelated review blind spots). If it fails,
  the roles.yaml edit is wrong — don't "fix" the test.
- **Dependencies: minimal and boring** (TASTE.md §3). Runtime deps today:
  `yaml`, `@anthropic-ai/claude-agent-sdk`, `@openai/codex`, and
  `@earendil-works/pi-coding-agent`. Adding another dependency is a
  decision, not a convenience.
- **Model IDs:** all roles.yaml IDs verified against live catalogs and
  human-ratified 2026-07-05 (PR #1; sources in
  `research/2026-07-05_model-id-verification.md`). One live caveat: `gpt-5.5`
  in Codex currently requires ChatGPT-account auth, not an API key.
- Single package, deliberately **not** a pnpm workspace (docs/PURPOSE.md → Repo shape).

## Testing expectations
- Any `src/` change: `pnpm test && pnpm typecheck` (seconds).
- Packaging, home resolution, CLI discovery, or onboarding changes: also run
  `pnpm smoke:onboarding` and `npm pack --dry-run`; the smoke must use a neutral
  cwd and temporary HOME/CODEX_HOME so it cannot depend on the source repo as
  an implicit org.
- Changes that affect app onboarding, `apps.yaml`, bootstrap, planning, or
  loop behavior must also be exercised against the live sandbox apps, not
  only unit tests. Current targets: `~/Build/operon-sandbox-alpha`,
  `~/Build/operon-sandbox-beta`, `~/Build/operon-sandbox-gamma`, and
  `~/Build/operon-sandbox-delta` (Ledgerette — the from-scratch onboarding +
  loop proof). Run the relevant bootstrap/plan/loop smoke plus each sandbox
  app's own available checks (for example alpha: `npm test && npm run lint`;
  beta: `npm test`; gamma: `npm test && npm run lint` plus the role smokes;
  delta: `npm test && npm run lint` — its `.operon/config.yaml` sets the
  `setup_command` the `setup` gate runs) and report the exact commands/results.
- M5 loop-state-machine changes should also run the disposable GitHub e2e
  when `gh` auth and `GH_SANDBOX_REPO` are available:
  `pnpm e2e:sandbox:setup` twice for idempotency, then `pnpm e2e:sandbox`.
- `gate.ts` changes: add cases to `test/gate.test.ts` for every new rule —
  both the critical side and a routine near-miss.
- `roles.yaml` changes: `pnpm dev roles` must print cleanly; tests stay green.
- `pipelines.yaml` / `prompts/**` changes: `pnpm dev pipelines` must print
  cleanly; `test/loop/pipelines-root.test.ts` pins the selection semantics
  (which passes each tier/trigger runs) — an intent change must change that
  test deliberately, via the same proposal PR.
- Adapter changes (`src/runtime/adapters/**`): also run `pnpm test:live` and
  record the dated result in `research/` — the live conformance run is the
  only proof the subagent-gate claim still holds.
- Docs-only changes: nothing to run.

## Navigation
- Decisions & rationale: `docs/PURPOSE.md` (Decided section is authoritative)
- Detailed design (how each subsystem works): `docs/architecture.md`
- Build-loop engineering design (passes, briefs, gates, verdicts): `docs/loop.md`
- Predecessor orchestrator (prior-art reference being ported; "the predecessor" in docs): `scratchpad-gitignore/claude-loop-teams/` (Python, read-only)
- Constitution the org's agents load: `TASTE.md`
- Adapter integration facts (SDKs, embedding modes, risks): `research/2026-07-03_runtime-layer.md`
- Prompt-caching economics + cache-stable assembly rules: `research/2026-07-04_prompt-caching.md`
- Roadmap / where the last session stopped: `TODO.md`

## Maintenance
When you change code, update the nearest AGENTS.md or linked reference doc if
the change alters architecture, commands, conventions, API contracts,
auth/security behavior, data models, generated-code workflow, deployment
behavior, or testing strategy. When you add a new deployable service, app,
package, crate, or major subsystem, create or update the appropriate AGENTS.md
in the same change.
