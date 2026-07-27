# AGENTS.md

## Scope
Applies to the whole repo. Nested AGENTS.md files specialize local rules in
`src/runtime/`, `src/observe/`, `src/report/`, and `eval/` — read the nearest
one when working there. `docs/PURPOSE.md` is the decision log; on conflict its
Decided section wins and this file is stale — fix this file.

This file governs **building and maintaining the Operon platform**, not
operating an org with Operon. Read `docs/development.md` before development
campaigns. Operon does not self-host its own development: root instructions,
developer grants, eval state, and CI/release authority must never enter an
Operon org's prompts, state, learning, or approvals. The packaged
`agent-skills/operon/` skill is the separate org-operation guide.

## What this repo is
An installable **org runtime**: a standing team of AI agents (Planner, Builder,
Reviewer, SRE, Support, Marketing) that develops and operates a software
product through a private GitHub repo, with a human gating critical ops only.
Build-complete and proven live end-to-end — README → Status / Known
limitations are the product view; README → Observability is the authoritative
state-home inventory (`~/.operon/<org>/`). Open work lives in the GitHub issue
tracker (`gh issue list`).

## Repository map
| Path | What it is |
| --- | --- |
| `docs/PURPOSE.md` | Decision log — **read first** |
| `docs/development.md` | Canonical platform-development lifecycle, standing grants, shipping |
| `TASTE.md` · `roles.yaml` · `pipelines.yaml` · `prompts/` | Human-ratified org templates and protocol surfaces (see Working rules) |
| `src/runtime/` | Runtime contract + adapters — `src/runtime/AGENTS.md` |
| `src/loop/` | Build loop: passes, briefs, quality gates, verdicts, ticket state machine (`docs/loop/design.md`) |
| `src/org/` | Standing-org layer: lifecycle, bootstrap, scheduler, approvals, budget, learning (`src/org/learning/`); `src/org/home.ts` is the package/org/state boundary |
| `src/observe/` · `src/report/` · `src/narrative/` | Presentation-only leaves — local AGENTS.md ×2, `docs/narrative/design.md` |
| `src/cli/` | One module per subcommand; `src/cli.ts` is a thin dispatch table — new subcommand = new file + one registry line |
| `agent-skills/operon/` | Packaged `$operon` Agent Skill (org operation, not development) |
| `test/` | Offline suite; reuse `test/fixtures/` (orgHome, fakeClock); `test/conformance/` is the adapter-generic suite |
| `eval/` | Qualification assets — `eval/AGENTS.md`; raw attempts in ignored `.eval-artifacts/` |
| `research/` | Dated decision records (adapter facts, caching economics, live evidence) |
| `scripts/` | CI classifier (`scripts/ci/`), eval entrypoints (`scripts/eval/`), link/smoke/packaging |

## Common commands
Verified against `package.json` scripts 2026-07-21 (scripts read, not
re-executed; semantics last maintainer-verified 2026-07-14).
- Node >= 26 (`.nvmrc`; `nvm use`). Node >= 25 has no bundled corepack:
  `npm install -g corepack && corepack enable` once per Node install.
- Install: `pnpm install` — pnpm pinned via `packageManager`. Deliberately NOT
  a workspace; `pnpm-workspace.yaml` is per-repo pnpm config only.
- Test: `pnpm test` (offline vitest, two workers, excludes `*.live.test.ts`) ·
  typecheck: `pnpm typecheck` · build: `pnpm build` (tsc → `dist/`).
- Local product install: `pnpm link:local` (source-backed `operon` bin + skill
  links; later source edits need no relink).
- CLI: `pnpm dev <cmd>` in source mode; the full catalog with flags and
  caveats is README → Commands (substitute `pnpm dev` for `operon`), plus
  `operon <cmd> --help`.
- UI/packaging checks: `pnpm test:observe-browser` · `pnpm smoke:onboarding` ·
  `npm pack --dry-run`.
- Token-spending — never run casually (docs/testing/runbook.md → Never run these by
  accident): `pnpm test:live`, `eval:github|live|soak`, live
  `dispatch`/`loop`/`plan`, `pnpm e2e:sandbox` (needs `GH_SANDBOX_REPO`).
- Eval/qualification boundary: `eval/AGENTS.md` · `docs/development.md`.

## Working rules
- **Import direction is one-way:** `src/org` → `src/loop` → `src/runtime`;
  runtime imports nothing above it. Not lint-enforced — hold the line manually.
- **Never hardcode a default branch.** Resolve with
  `resolveRemoteDefaultBranch()` from `src/loop/default-branch.ts` and thread
  the resulting `BaseRevision` through; the option types make it required.
  `test/loop/default-branch.test.ts` fails the build on any new
  `main`/`master`/`trunk` literal outside presentation-only `src/observe` and
  `src/report`. A guessed base silently diffs against the wrong tree (#101).
- **Human-ratified surfaces:** `TASTE.md`, `roles.yaml`, `docs/PURPOSE.md`,
  `pipelines.yaml`, `prompts/**`. Propose changes with rationale; never
  silently rewrite.
- **Never weaken a gate or test to make something pass.** `test/gate.test.ts`
  seeds the adapter conformance suite — extend cases, never soften one. The
  builder ≠ reviewer cross-provider test in `test/roles.test.ts` encodes
  uncorrelated review blind spots — if it fails, the roles.yaml edit is wrong.
- **Every defect fix deposits its detector.** Fix and offline test that
  reproduces the defect land in the same change; if the failure is not
  offline-reproducible, guard the nearest deterministic seam
  (provision/preflight) and say so in the PR. A fix without a guard is
  incomplete — a live run is not a regression test (docs/testing/runbook.md).
- **Dependencies minimal and boring** (TASTE.md §3): `yaml` plus the three
  provider SDKs. Adding one is a decision, not a convenience.
- **Model IDs** in roles.yaml were human-ratified 2026-07-15
  (`research/2026-07-15_model-assignment-refresh.md`); `gpt-5.6-sol`
  availability is proved by adapter calibration before a candidate campaign.

## Testing expectations
`docs/testing/runbook.md` → Required runs by changed path is the full per-path
rulebook; the rest of that file maps commands, CI lanes, and the integrity
machinery. On conflict this summary wins — fix that file.
| Change | Minimum required |
| --- | --- |
| Any `src/` | `pnpm test && pnpm typecheck` |
| `src/observe/**` · `src/report/**` (+ their CLI files) | + browser/build/smoke/pack — local AGENTS.md |
| `src/runtime/adapters/**` | + `pnpm test:live` + dated `research/` record |
| `eval/**` · `scripts/eval/**` · transformation fixtures | `eval/AGENTS.md` → Required on any change |
| Packaging · home resolution · CLI discovery · onboarding | + `pnpm smoke:onboarding`, `npm pack --dry-run` |
| Onboarding · `apps.yaml` · bootstrap · planning · loop behavior | + live sandbox apps (docs/testing/runbook.md) |
| Scheduler lifecycle/evidence/health | `test/scheduler/` suite; fake clocks; never real launchd/systemd |
| M5 loop state machine | + `pnpm e2e:sandbox` when `gh` auth + `GH_SANDBOX_REPO` allow |
| `gate.ts` | new `test/gate.test.ts` cases: critical + routine near-miss |
| `roles.yaml` · `pipelines.yaml` · `prompts/**` | `pnpm dev roles` / `pnpm dev pipelines` print cleanly; intent changes go through `test/loop/pipelines-root.test.ts` deliberately |
| CI admission rules (`scripts/ci/**`, workflows) | case in `test/ci/classify-changes.test.ts` |
| Docs-only | nothing |

## Navigation
- Product status: README → Status / Known limitations · decisions: `docs/PURPOSE.md` · code wiki: `docs/wiki.html` (open in a browser)
- Architecture: `docs/architecture.md` · build loop: `docs/loop/design.md` · testing map: `docs/testing/runbook.md` · sandbox-app journey: `docs/testing/journey.md`
- Scheduler contract: `docs/scheduler/design.md` · event payloads: `docs/scheduler/event-schemas.md` · approvals/release boundary: `docs/approvals/design.md`
- Learning loop: `docs/learning-loop/` · episode operating contract: `docs/episodes/contract.md` · qualification/release gating: `docs/qualification/design.md` · benchmarks: `docs/qualification/benchmark-runbook.md`
- Adapters: `docs/harness/capability-matrix.md` · `docs/harness/adding-updating.md` · `research/2026-07-03_runtime-layer.md` · `research/2026-07-04_prompt-caching.md`
- Live UI / Reports / Narrative contracts: `docs/live-ui/design.md` · `docs/reporting/design.md` · `docs/narrative/design.md`
- Predecessor orchestrator (read-only prior art; "the predecessor" in docs): `scratchpad-gitignore/claude-loop-teams/`

## Maintenance
When you change code, update the nearest AGENTS.md or linked reference doc if
the change alters architecture, commands, conventions, API contracts,
auth/security behavior, data models, generated-code workflow, deployment
behavior, or testing strategy. When you add a new deployable service, app,
package, crate, or major subsystem, create or update the appropriate AGENTS.md
in the same change.
