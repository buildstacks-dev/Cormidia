# AGENTS.md

## Scope
Applies to the whole repo. There are no nested AGENTS.md files — this is a
single TypeScript package and one file covers it. `docs/PURPOSE.md` is the decision
log; on conflict, its Decided section wins and this file is stale — fix this file.

## What this repo is
An **org runtime**: a standing team of AI agents (Planner, Builder, Reviewer,
SRE, Support, Marketing) that develops and operates a software product through
a private GitHub repo, with a human gating critical ops only. Currently a
buildable runtime scaffold: M0-M6 are complete, ClaudeRuntime is live-tested,
the pass executor/runlog/bootstrap/qgates layers are real, and the GitHub
ticket state machine can take a real sandbox-alpha issue through Builder /
Reviewer passes, PR, gates, review fallback, and squash-merge. Upcoming work
starts at autonomous dispatch and approvals (M7). CodexRuntime, PiRuntime, dispatcher,
approvals, memory, retro, and full standing-role operation remain roadmap
work.

## Map
| Path | What it is |
| --- | --- |
| `docs/PURPOSE.md` | Decision log — **read first**; every decision to date |
| `TASTE.md` | Org constitution, loaded by every agent the org runs (human-ratified) |
| `roles.yaml` | Org chart made executable: role → runtime/model/effort/triggers |
| `pipelines.yaml` | The build protocol as ordered passes (build/review/fix/ship) — human-ratified; validated by `pnpm dev pipelines` |
| `prompts/` | Versioned pass templates the pipelines reference — human-ratified protocol surfaces, one file per pass |
| `TODO.md` | Roadmap + session-handoff state — pick up the top unchecked item |
| `docs/architecture.md` | Detailed design: dispatcher, turn lifecycle, approvals, context, memory, multi-app, bootstrap, GitHub conventions (§11 decisions ratified into docs/PURPOSE.md) |
| `docs/loop.md` | Build-loop engineering design (the center of gravity): pass pipelines, briefs, quality gates, verdicts, ticket state machine — predecessor-orchestrator inheritance audit included |
| `docs/testing-journey.md` | Plain-language explainer: the sandbox test apps, what each build-plan stage proves against them, and the approved gamma coverage for SRE-on-live-service / Support / Marketing |
| `src/runtime/` | Runtime contract: `Runtime` interface, critical-ops gate, telemetry, L1–L3 runlog writers, `secret-patterns.ts` (the ONE secret-regex list — redaction and qgates both import it), adapters (Claude live; Codex/pi stubs) |
| `src/loop/` | Build loop: pass executor, briefs, quality gates, typed verdicts, GitHub ops, ticket scheduler, M5 ticket state machine, and M6 real pipeline integration (design in `docs/loop.md`) |
| `src/org/` | Standing-org layer: roles/apps loaders, bootstrap, co-planning; scheduler/approvals/context/memory/retro to come |
| `src/cli/` | One module per CLI subcommand (`roles.ts`, `doctor.ts`, …); `src/cli.ts` is a thin dispatch table over them — new subcommands are a new file + one registry line |
| `test/` | Gate conformance seed + roles.yaml validation + CLI dispatch conformance |
| `test/fixtures/orgHome.ts`, `test/fixtures/fakeClock.ts` | Composable temp-dir fixtures for `~/.operon/<org>/` and app-repo `.operon/` trees, plus a deterministic clock — reuse instead of a new ad-hoc mkdtemp scaffold |
| `test/conformance/` | The adapter-generic conformance suite (`harness.ts` + `cases.ts`): every `Runtime` must pass `runConformanceSuite(name, makeRuntime, opts)` before its role goes live — proven against `src/runtime/testing/fakeRuntime.ts` in `conformance.test.ts`; a live adapter gets its own file reusing the same suite |
| `research/` | Decision records (runtime adapter integration facts, prompt-caching economics) |

## Commands (all verified 2026-07-06)
- Install: `pnpm install` — pnpm is pinned via `packageManager` (corepack);
  an older global pnpm will fail with store/workspace errors. `corepack
  enable` once if `pnpm --version` doesn't match the pin.
- Test: `pnpm test` (vitest — fast, offline; run for any `src/` or
  `roles.yaml` change; `*.live.test.ts` files are excluded here)
- Live adapter tests: `pnpm test:live` (real Claude Agent SDK turns, real
  tokens; subscription auth first, API key fallback; skips without usable
  auth — never run by `pnpm test`)
- Typecheck: `pnpm typecheck`
- Build: `pnpm build` (tsc → `dist/`)
- CLI in dev: `pnpm dev roles` · `pnpm dev apps` · `pnpm dev pipelines` ·
  `pnpm dev bootstrap --scan-only <repo>` · `pnpm dev plan <app> --dry-run`
  · `pnpm dev loop --app <app> --once --dry-run` ·
  `pnpm dev dispatch --dry-run` · `pnpm dev approvals` ·
  `pnpm dev budget` · `pnpm dev run-role <role> --dry-run` ·
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
  `yaml` and `@anthropic-ai/claude-agent-sdk` (the ClaudeRuntime adapter —
  the first SDK dependency, flagged and landed with M1.2). Adding a
  dependency is a decision, not a convenience.
- **Model IDs:** all roles.yaml IDs verified against live catalogs and
  human-ratified 2026-07-05 (PR #1; sources in
  `research/2026-07-05_model-id-verification.md`). One live caveat: `gpt-5.5`
  in Codex currently requires ChatGPT-account auth, not an API key —
  re-verify when wiring the Codex adapter (M10).
- Single package, deliberately **not** a pnpm workspace (docs/PURPOSE.md → Repo shape).

## Testing expectations
- Any `src/` change: `pnpm test && pnpm typecheck` (seconds).
- Changes that affect app onboarding, `apps.yaml`, bootstrap, planning, or
  loop behavior must also be exercised against the live sandbox apps, not
  only unit tests. Current targets: `~/Build/operon-sandbox-alpha` and
  `~/Build/operon-sandbox-beta` (and `operon-sandbox-gamma` once created).
  Run the relevant bootstrap/plan/loop smoke plus each sandbox app's own
  available checks (for example alpha: `npm test && npm run lint`; beta:
  `npm test`) and report the exact commands/results.
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
