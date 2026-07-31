# AGENTS.md

## Scope
Applies to the whole repo. Nested AGENTS.md files specialize local rules in
`src/runtime/`, `src/observe/`, `src/report/`, and `src/narrative/` —
read the nearest one when working there. `docs/PURPOSE.md` is the decision log; on conflict its
Decided section wins and this file is stale — fix this file.

This file governs **building and maintaining the Operon platform**, not
operating an org with Operon. Read `docs/DEVELOPMENT.md` before development
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
| `docs/DEVELOPMENT.md` | Canonical platform-development lifecycle, standing grants, shipping |
| `TASTE.md` · `roles.yaml` · `pipelines.yaml` · `prompts/` | Human-ratified org templates and protocol surfaces (see Working rules) |
| `src/runtime/` | Runtime contract + adapters — `src/runtime/AGENTS.md` |
| `src/loop/` | Build loop: passes, briefs, quality gates, verdicts, ticket state machine (`docs/loop/design.md`) |
| `src/org/` | Standing-org layer: lifecycle, bootstrap, scheduler, approvals, budget, learning (`src/org/learning/`); `src/org/home.ts` is the package/org/state boundary |
| `src/observe/` · `src/report/` · `src/narrative/` | Presentation-only leaves — local AGENTS.md ×3 |
| `src/cli/` | One module per subcommand; `src/cli.ts` is a thin dispatch table — new subcommand = new file + one registry line |
| `agent-skills/operon/` | Packaged `$operon` Agent Skill (org operation, not development) |
| `claude-tests/` | Replacement validation harness (Validation-Design-Agent, five-layer model) — being built; absent until its first change lands |
| `archive-do-not-read/` | Frozen pre-rebuild validation corpus (old `test/`, `eval/`, `docs/testing/`, eval/CI scripts) — **never read, cite, run, or take design cues from it** |
| `research/` | Dated decision records (adapter facts, caching economics, live evidence) |
| `scripts/` | Link/smoke/packaging scripts |

## Common commands
Verified against `package.json` scripts 2026-07-31 (validation-rebuild
rewrite; legacy test/eval scripts removed with the archive move).
- Node >= 26 (`.nvmrc`; `nvm use`). Node >= 25 has no bundled corepack:
  `npm install -g corepack && corepack enable` once per Node install.
- Install: `pnpm install` — pnpm pinned via `packageManager`. Deliberately NOT
  a workspace; `pnpm-workspace.yaml` is per-repo pnpm config only.
- Test: `pnpm test` (vitest over `claude-tests/`; passWithNoTests until the
  first spec lands) · typecheck: `pnpm typecheck` · build: `pnpm build`
  (tsc → `dist/`).
- Local product install: `pnpm link:local` (source-backed `operon` bin + skill
  links; later source edits need no relink).
- CLI: `pnpm dev <cmd>` in source mode; the full catalog with flags and
  caveats is README → Commands (substitute `pnpm dev` for `operon`), plus
  `operon <cmd> --help`.
- Packaging checks: `pnpm smoke:onboarding` · `npm pack --dry-run`.
- Token-spending — never run casually: live `dispatch`/`loop`/`plan` against
  a real org spend provider tokens and can open PRs/approvals.
- Development lifecycle and grants: `docs/DEVELOPMENT.md`.

## Working rules
- **Import direction is one-way:** `src/org` → `src/loop` → `src/runtime`;
  runtime imports nothing above it. Not lint-enforced — hold the line manually.
- **Never hardcode a default branch.** Resolve with
  `resolveRemoteDefaultBranch()` from `src/loop/default-branch.ts` and thread
  the resulting `BaseRevision` through; the option types make it required.
  A guessed base silently diffs against the wrong tree (#101). (The literal
  scanner that enforced this is archived with the legacy suite; the rule
  stands on its own until the replacement harness re-guards it.)
- **Human-ratified surfaces:** `TASTE.md`, `roles.yaml`, `docs/PURPOSE.md`,
  `pipelines.yaml`, `prompts/**`. Propose changes with rationale; never
  silently rewrite.
- **Never weaken a gate or test to make something pass.** Extend cases, never
  soften one. The builder ≠ reviewer cross-provider pairing in roles.yaml
  encodes uncorrelated review blind spots — do not collapse it to one provider.
- **Every defect fix deposits its detector.** Fix and offline test that
  reproduces the defect land in the same change (in `claude-tests/` once the
  harness exists); if the failure is not offline-reproducible, guard the
  nearest deterministic seam (provision/preflight) and say so in the PR. A fix
  without a guard is incomplete — a live run is not a regression test.
- **Dependencies minimal and boring** (TASTE.md §3): `yaml` plus the three
  provider SDKs. Adding one is a decision, not a convenience.
- **Model IDs** in roles.yaml were human-ratified 2026-07-15
  (`research/2026-07-15_model-assignment-refresh.md`); `gpt-5.6-sol`
  availability is proved by adapter calibration before a candidate campaign.

## Testing expectations
**Validation rebuild in progress (decided 2026-07-31, docs/PURPOSE.md →
Decided v2.9).** The legacy suite, the eval/qualification machinery, and
`docs/testing/` are frozen under `archive-do-not-read/` — never read, cite,
run, or take design cues from that directory; the rebuild is deliberately
unanchored from the incumbent suite. The Validation-Design-Agent owns harness
design; the replacement harness lands under `claude-tests/` and its own
`validation-policy.yaml` + runbook become the per-path rulebook when ratified.

Until then the interim minimum for any change is `pnpm test && pnpm typecheck`
(`pnpm test` is green-by-absence via passWithNoTests until the first spec
lands — do not mistake it for coverage). Release gating is **suspended**: the
fail-closed release-currency lane and attestation were archived with `eval/`;
do not tag a release expecting a gate to catch anything. Live sandbox checks
(`docs/org/apps.md` sandbox apps) remain the only behavioral net — use them
deliberately, never casually.

## Navigation
- Product status: README → Status / Known limitations · decisions: `docs/PURPOSE.md` · operator outcome: `docs/VISION.md` · platform development: `docs/DEVELOPMENT.md`
- `docs/architecture.md` is the thin system map (stable §numbering); depth lives in topic folders — one per subsystem, `design.md` as the folder's contract
- Build loop: `docs/loop/` (design · turns · github-conventions) · dispatch/scheduler: `docs/scheduler/` (design · event-schemas) · approvals/release: `docs/approvals/design.md`
- Episode operating contract: `docs/episodes/contract.md` · qualification/release gating: `docs/qualification/` (design · benchmark-runbook) · learning loop: `docs/learning-loop/`
- Adapters: `docs/harness/` (capability-matrix · adding-updating · qualification-evidence) · `research/2026-07-03_runtime-layer.md` · `research/2026-07-04_prompt-caching.md`
- Org layer: `docs/org/` (context · memory · apps · onboarding)
- Live UI / Reports / Narrative contracts: `docs/live-ui/design.md` · `docs/reporting/design.md` · `docs/narrative/design.md`
- Predecessor orchestrator (read-only prior art; "the predecessor" in docs): `scratchpad-gitignore/claude-loop-teams/`

## Maintenance
When you change code, update the nearest AGENTS.md or linked reference doc if
the change alters architecture, commands, conventions, API contracts,
auth/security behavior, data models, generated-code workflow, deployment
behavior, or testing strategy. When you add a new deployable service, app,
package, crate, or major subsystem, create or update the appropriate AGENTS.md
in the same change.
