# AGENTS.md

## Scope
Applies to the whole repo. Nested AGENTS.md files specialize local rules in
`src/runtime/`, `src/observe/`, `src/report/`, and `src/narrative/` — read the
nearest one when working there. `docs/PURPOSE.md` is the decision log; on
conflict its Decided section wins and this file is stale — fix this file.

This file governs **building and maintaining the Cormidia platform**, including
when the standing Cormidia org operates this repository as an app (self-hosting
ratified, PURPOSE.md → Decided 2026-08-02: the org may register, onboard, and
operate both `cormidia-web` and this repository). Read `docs/DEVELOPMENT.md`
before development campaigns. Every release-shaped action for every app — npm
publish, version tags, release handoff, deployment, external publication —
requires explicit human approval; after approval, Cormidia may execute only the
exact approved action through its durable release path. Development grants, raw
eval state, and outer-session instructions must never be copied into the org
home, org-global prompts, learning, or approvals. `agent-skills/cormidia/` is
the packaged org-operation guide; `agent-skills/cormidia-job/` the ad-hoc-job
guide.

## What this repo is
An installable **org runtime**: a standing team of AI agents (Planner, Builder,
Reviewer, SRE, Support, Marketing) that develops and operates a software
product through a private GitHub repo, with a human gating critical ops only.
Build-complete and proven live end-to-end — README → Status / Known
limitations are the product view; README → Observability is the authoritative
state-home inventory (`~/.cormidia/<org>/`). Open work lives in the GitHub
issue tracker (`gh issue list`).

## Repository map
| Path | What it is |
| --- | --- |
| `docs/PURPOSE.md` | Decision log — **read first** |
| `docs/DEVELOPMENT.md` | Platform-development lifecycle, standing grants, shipping |
| `TASTE.md` · `roles.yaml` · `pipelines.yaml` · `prompts/` | Human-ratified org templates and protocol surfaces (see Working rules) |
| `src/runtime/` | Runtime contract + adapters — `src/runtime/AGENTS.md` |
| `src/loop/` | Build loop: passes, briefs, quality gates, verdicts, ticket state machine (`docs/loop/design.md`) |
| `src/org/` | Standing-org layer: lifecycle, bootstrap, scheduler, approvals, budget, learning; `src/org/home.ts` owns the package/org/state boundary |
| `src/observe/` · `src/report/` · `src/narrative/` | Presentation-only leaves — local AGENTS.md ×3 |
| `src/cli/` | One module per subcommand; `src/cli.ts` is a thin dispatch table |
| `src/jobs/` · `docs/jobs/` | Ad-hoc job graphs (`cormidia-job`, a SECOND binary) — outside the governed loop: no review, verdicts, tickets, or GitHub authority |
| `validation-design/` | Ratified harness corpus — `validation-policy.yaml` is the contract, **`routing.md` the binding procedure** (moved from this file; its three addenda ratified 2026-08-12), `harness-backlog.md` the build plan |
| `tests/` | Offline L1/L2 harness + explicitly authorized L3/L4/L5 campaign runners; `tests/campaign/acceptance/` is the L-ACC lane (gates nothing, F-PT-029) |
| `archive-do-not-read/` | Frozen pre-rebuild corpus — **never read, cite, run, or take design cues from it** |
| `research/` | Dated decision records |
| `scripts/` | Link/smoke/packaging scripts + the `pnpm check` gate scripts |
| `scripts/self-hosted-runner/` · `docs/ci/` | Pinned ephemeral Mac-backed GitHub Actions runner appliance and operator runbook |

## Common commands
- Node >= 26 (`.nvmrc`; `nvm use`). Node >= 25 has no bundled corepack:
  `npm install -g corepack && corepack enable` once per Node install.
- Install: `pnpm install` — pnpm pinned via `packageManager`. Deliberately NOT
  a workspace; `pnpm-workspace.yaml` is per-repo pnpm config only.
- Check: `pnpm check` (Biome warnings-as-errors, typecheck, and the
  deterministic gate scripts in `scripts/check-*.mjs`).
- Test: `pnpm test` (offline L1/L2 vitest over `tests/`; passWithNoTests
  disabled) · typecheck: `pnpm typecheck` · build: `pnpm build` (tsc → `dist/`).
- Triggered validation (human authorization + reviewed absolute config
  required): `pnpm test:live` · `pnpm test:eval` · `pnpm test:soak`; see
  `docs/qualification/design.md` and never run these casually.
- Local product install: `pnpm link:local` (source-backed bins + skill links).
  Packaged install: `pnpm install:packaged` (npm's real global layout,
  transactional promotion; source conversion needs `--replace-source-links`).
  `scripts/lib/link-artifacts.mjs` is the single install table (pinned by
  `tests/unit/cf-reg-359/`).
- CLI: `pnpm dev <cmd>` in source mode; full catalog: README → Commands plus
  `cormidia <cmd> --help`.
- Packaging checks: `pnpm smoke:onboarding` · `npm pack --dry-run` ·
  `pnpm smoke:package -- <absolute-tarball>`.
- CI runner: `pnpm ci:runner -- build|doctor|once|serve|status|service-install` —
  GitHub orchestrates; internal PR/main Core Checks use the disposable Mac-backed
  Linux ARM64 appliance; fork PRs and explicit SHA-guarded fallback stay hosted;
  release/publication is always GitHub-hosted. See `docs/ci/self-hosted-runner.md`.
- Worktrees: `pnpm worktree -- reconcile` is read-only; `create`/`remove`;
  deletion requires `--apply`.
- Token-spending — never run casually: live `dispatch`/`loop`/`plan` against a
  real org spend provider tokens and can open PRs/approvals.
- Development lifecycle and grants: `docs/DEVELOPMENT.md`.

## Working rules
- **Import direction is one-way:** `src/org` → `src/loop` → `src/runtime`;
  runtime imports nothing above it (`scripts/check-import-direction.mjs`).
- **Never hardcode a default branch.** Resolve with
  `resolveRemoteDefaultBranch()` from `src/loop/default-branch.ts` and thread
  the `BaseRevision` through; never cache a resolved base across ticket claims
  — a stale base diffs against the wrong tree (#101, #203; re-guarded by
  `tests/unit/cf-inv-009/` and `tests/hermetic/cf-reg-203/`).
- **Human-ratified surfaces:** `TASTE.md`, `roles.yaml`, `docs/PURPOSE.md`,
  `pipelines.yaml`, `prompts/**`. Propose changes with rationale; never
  silently rewrite.
- **Never weaken a gate or test to make something pass.** Extend cases, never
  soften one. The builder ≠ reviewer cross-provider pairing in roles.yaml
  encodes uncorrelated review blind spots — never collapse it to one provider.
- **Every defect fix deposits its detector** — fix and offline reproduction
  land in the same change; if not offline-reproducible, guard the nearest
  deterministic seam and say so in the PR.
- **Parse, don't cast.** Anything crossing a trust boundary (env, file/state
  reads, subprocess output, SDK/network responses) gets runtime validation
  that throws on mismatch (the `src/org/authority.ts` / `src/jobs/journal.ts`
  pattern); types flow from the validator, never a bare `as T`.
- **If the compiler fights you, the model is wrong.** Fix the types, not the
  call site: `any`, `as`, and `!` are ratcheted gate failures
  (`scripts/check-type-ratchet.mjs`), not style choices; `unknown` plus
  narrowing is the sanctioned exit.
- **Dependencies minimal and boring** (TASTE.md §3): prefer `node:` built-ins;
  `yaml` plus the four provider SDKs are the whole runtime set, and adding one
  is a decision, not a convenience. Cursor, Grok Build and Muse Code are
  required preinstalled binaries — Cormidia never installs a provider (#224).
- **Grok Build is sandbox-only** until #339's human vendor risk review is
  recorded: never point a grok turn at a real repository and never assign it a
  role in roles.yaml (`research/2026-08-07_grok-build-adapter-certification.md`).
- **Agent-authored engineering standard:**
  `research/2026-08-05_pi-forensic-analysis/pi-engineering-standards-skill.md`
  is binding; public-symbol count is the module gate, line count the smoke
  alarm (`scripts/check-size-ratchet.mjs`).
- **Model IDs** in roles.yaml were human-ratified 2026-07-15
  (`research/2026-07-15_model-assignment-refresh.md`); `gpt-5.6-sol`
  availability is proved by adapter calibration before a candidate campaign.

## Testing expectations
The replacement validation harness is implemented (ratified 2026-07-31,
PURPOSE.md v2.9/v2.10); the legacy corpus is frozen under
`archive-do-not-read/`. The minimum for any change is
`pnpm test && pnpm typecheck` — a populated offline gate, not
green-by-absence. Release qualification is active under RQ-1: the exact
candidate requires a current aggregate attestation and a separate exact human
release approval; missing, stale, corrupt, ceiling-stopped, uncalibrated, or
undispositioned required evidence is never a pass. L3/L4 campaigns are
explicit human-authorized, per-candidate work; the threat model, HB-073 abuse
lane, seven-day soak, and natural rotation remain disclosed future L5
assurance outside RQ-1 and may not be claimed as completed evidence.

## Validation harness — routing stub
The binding procedure moved verbatim (2026-08-11, #402) to
`validation-design/routing.md`; `validation-design/validation-policy.yaml`
remains the contract (tighten-only). Triggers:
- Feature change → derivation chain: routing.md "Feature changes".
- Bug fix → detector deposit + case-catalog §10.3 row in the same change (two
  sanctioned exceptions listed in routing.md's standing-rules digest).
- Structural additions/mismatches: first apply the clause-vs-shape test. A
  conflict confined to one contract/invariant clause is ordinary: open a
  finding and park its cases `BLOCKED:<finding>`; a new journey, boundary,
  invariant, or LLM site, or a conflict with the structure's ownership,
  failure domain, or existence, is structural. Re-enter
  `validation-harness-design` in `harness-revision` mode. If that skill is
  unavailable, never approximate the revision by hand: halt only the
  structural work, record the blocker in the change description (PR body or
  commit message) plus an `F-PT` finding when product-truth-shaped — there is
  no other channel — and split the change. Structure-independent parts may
  land; dependent cases/specs park in the change description as
  pending-the-revision.
- Before picking up any ticket: scan for BLOCKED/PARKED/`Gate:` markers
  (mechanized greps in routing.md; run them from `validation-design/`).
- Never weaken a gate or test. Never read `archive-do-not-read/`.
Tickets normally run through the `implement-harness-ticket` skill. If it is
unavailable and enumeration is unambiguous, hand-implementation is permitted
per routing.md's adoption notes; that fallback is forbidden for
`validation-harness-design`/`harness-revision`.

## Ratified addenda
The three routing addenda parked by the #402 restructure (roadmap/validation/
batching · L-ACC + jobs · traceability conventions + machine catalog) were
ratified by the owner on 2026-08-12 and are binding; they live at the end of
`validation-design/routing.md`. `validation-design/proposals/` was retired in
the same change.

## Navigation
- Product status: README → Status / Known limitations · decisions: `docs/PURPOSE.md` · operator outcome: `docs/VISION.md` · platform development: `docs/DEVELOPMENT.md`
- `docs/architecture.md` is the thin system map (stable §numbering); depth lives in topic folders — one per subsystem, `design.md` as the folder's contract
- Build loop: `docs/loop/` · dispatch/scheduler: `docs/scheduler/` · approvals/release: `docs/approvals/design.md`
- Episode contract: `docs/episodes/contract.md` · qualification: `docs/qualification/` · learning loop: `docs/learning-loop/`
- Adapters: `docs/harness/` (capability-matrix · adding-updating · qualification-evidence)
- Org layer: `docs/org/` (context · memory · apps · onboarding)
- Jobs (`cormidia-job`): `docs/jobs/design.md` — §3 is the non-inherited-guarantee list; it is NOT the build loop
- Live UI / Reports / Narrative contracts: `docs/live-ui/design.md` · `docs/reporting/design.md` · `docs/narrative/design.md`
- Predecessor orchestrator (read-only prior art): `scratchpad-gitignore/claude-loop-teams/`

## Maintenance
When you change code, update the nearest AGENTS.md or linked reference doc if
the change alters architecture, commands, conventions, API contracts,
auth/security behavior, data models, generated-code workflow, deployment
behavior, or testing strategy. When you add a new deployable service, app,
package, or major subsystem, create or update the appropriate AGENTS.md in the
same change.

## Cormidia delegated authority

Read `.cormidia/AUTHORITY.md` before acting. Its recorded authority is version
`delegated-operator/v1+app-inherit/v1` with SHA-256 `280df594080710f4e8df2764b66dc38d3778d7403123b21d66d552779c2e4962`.

The authority file governs routine autonomy but never bypasses Cormidia's
critical-operation approvals. App instructions and the current human task
may narrow it; they cannot broaden it. A broader grant requires a fresh,
attributable human instruction.

### Effective charter projection

---
schema_version: 1
kind: cormidia-org-authority
profile: delegated-operator
version: delegated-operator/v1
---

# Delegated authority — delegated operator

You are my delegated operator. Make ordinary, reversible decisions
independently and continue until the defined outcome is genuinely complete.
Do not pause for routine workflow choices, ordinary token cost within
configured budgets, local edits, tests, branches, tickets, or normal pull
request preparation.

Escalate only for publication or deployment, secrets, cloud/DNS/infrastructure
changes, irreversible data loss, merging when human merge is required, or a
genuinely material product decision.

## Non-bypassable boundaries

- Cormidia's critical-operation approvals always apply. This charter cannot bypass them.
- App policy and the current human instruction may narrow this authority.
- Never infer a broader grant than this recorded charter.
- A broader grant requires a fresh, attributable human instruction.
- Escalate genuine material product decisions whose answer changes the delegated outcome.
<!-- cormidia-authority:end -->
