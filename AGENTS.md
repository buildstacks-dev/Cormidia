# AGENTS.md

## Scope
Applies to the whole repo. There are no nested AGENTS.md files — this is a
single TypeScript package and one file covers it. `PURPOSE.md` is the decision
log; on conflict, its Decided section wins and this file is stale — fix this file.

## What this repo is
An **org runtime**: a standing team of AI agents (Planner, Builder, Reviewer,
SRE, Support, Marketing) that develops and operates a software product through
a private GitHub repo, with a human gating critical ops only. Currently a
scaffold: the contracts, gate, and tests are real; the three runtime adapters
and the build loop are documented stubs.

## Map
| Path | What it is |
| --- | --- |
| `PURPOSE.md` | Decision log — **read first**; every decision to date |
| `TASTE.md` | Org constitution, loaded by every agent the org runs (human-ratified) |
| `roles.yaml` | Org chart made executable: role → runtime/model/effort/triggers |
| `TODO.md` | Roadmap + session-handoff state — pick up the top unchecked item |
| `docs/architecture.md` | Detailed design: dispatcher, turn lifecycle, approvals, context, memory, multi-app, bootstrap, GitHub conventions (§11 = proposals pending ratification) |
| `docs/loop.md` | Build-loop engineering design (the center of gravity): pass pipelines, briefs, quality gates, verdicts, ticket state machine — predecessor-orchestrator inheritance audit included |
| `src/runtime/` | Runtime contract: `Runtime` interface, critical-ops gate, telemetry, adapters (claude / codex / pi) |
| `src/loop/` | Build loop: pass executor, briefs, quality gates, ticket state machine (skeleton — design in `docs/loop.md`) |
| `src/org/` | Standing-org layer: roles.yaml loader; scheduler/memory/retro to come |
| `test/` | Gate conformance seed + roles.yaml validation |
| `research/` | Decision records (runtime adapter integration facts, prompt-caching economics) |

## Commands (all verified 2026-07-03)
- Install: `pnpm install`
- Test: `pnpm test` (vitest — fast; run for any `src/` or `roles.yaml` change)
- Typecheck: `pnpm typecheck`
- Build: `pnpm build` (tsc → `dist/`)
- CLI in dev: `pnpm dev roles` · `pnpm dev doctor`

## Working rules
- **Import direction is one-way:** `src/org` → `src/loop` → `src/runtime`;
  `src/runtime` imports nothing above it. Not lint-enforced yet — hold the
  line manually. This is what keeps the loop extractable.
- **`TASTE.md`, `roles.yaml`, and `PURPOSE.md` are human-ratified surfaces.**
  Propose changes with rationale; never silently rewrite. (The org's own gate
  treats agent writes to these as critical ops — the same etiquette applies to
  agents working *on* this repo.)
- **`test/gate.test.ts` is the seed of the adapter conformance suite.** Every
  adapter must pass these cases end-to-end (including subagent tool calls)
  before a role goes live on it. Extend the cases; never weaken one to make an
  adapter pass.
- **The builder ≠ reviewer cross-provider test** in `test/roles.test.ts`
  encodes a design decision (uncorrelated review blind spots). If it fails,
  the roles.yaml edit is wrong — don't "fix" the test.
- **Dependencies: minimal and boring** (TASTE.md §3). Only `yaml` at runtime
  today. Adding a dependency is a decision, not a convenience.
- **Model IDs:** Anthropic IDs in roles.yaml are exact; `gpt-5.5` entries are
  PLACEHOLDERS — verify real OpenAI IDs before wiring the Codex adapter.
- Single package, deliberately **not** a pnpm workspace (PURPOSE.md → Repo shape).

## Testing expectations
- Any `src/` change: `pnpm test && pnpm typecheck` (seconds).
- `gate.ts` changes: add cases to `test/gate.test.ts` for every new rule —
  both the critical side and a routine near-miss.
- `roles.yaml` changes: `pnpm dev roles` must print cleanly; tests stay green.
- Docs-only changes: nothing to run.

## Navigation
- Decisions & rationale: `PURPOSE.md` (Decided section is authoritative)
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
