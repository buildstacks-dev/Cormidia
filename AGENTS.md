# AGENTS.md

## Scope
Applies to the whole repo. There are no nested AGENTS.md files — this is a
single TypeScript package and one file covers it. `docs/PURPOSE.md` is the decision
log; on conflict, its Decided section wins and this file is stale — fix this file.

## What this repo is
An installable **org runtime**: a standing team of AI agents (Planner, Builder,
Reviewer, SRE, Support, Marketing) that develops and operates a software
product through a private GitHub repo, with a human gating critical ops only.
Build-complete and proven live end-to-end: ClaudeRuntime/CodexRuntime/
PiRuntime are live-conformance-tested; the GitHub ticket state machine takes
a real issue through Builder/Reviewer passes, quality gates (a `setup` gate
installs app deps in the fresh worktree first), PR, cross-provider review,
and squash-merge with unforgeable HMAC merge authorization; company events
route by payload kind to Planner/SRE/Support/Marketing pipelines with
channel-presence gating. Planning is proportional (one-pass bootstrap plans,
schema-validated and orchestrator-published with canonical labels); tickets
continue from durable artifacts across interruptions; every provider turn
settles once into the org ledger where budget caps are enforced; the approval
boundary supports scoped grants, role toolset shaping (forbidden acts
unrepresentable on Claude, flat-denied everywhere), durable denial lessons,
and the A4 release handoff (`release:` block, ship-gate P7, deploy trigger
queued as a critical op, then executed exactly once by a later dispatch after
approval — `src/org/release.ts`). `operon-sandbox-delta`
("Ledgerette") is the from-scratch onboarding + loop proof; buildstacks.dev
is onboarded as a production app in `status: onboarding`. Run `pnpm test`
for the current offline suite. Known limitations live in README.md → Known
limitations; open work lives in the GitHub issue tracker.

`operon observe` is the read-only Live UI: a presentation-only `src/observe/`
leaf over durable state and bounded GitHub reads. It binds only to loopback
with a per-process capability, owns no workflow state, exposes no mutation
routes, and stopping it never affects a run. Its URL-stable session chooser
projects historical parent tasks and standalone traces through the same UI;
it adds no session store. `docs/live-ui/design.md` is its authoritative
contract.

`operon report` and Observe `/reports` are the deterministic ledger-first
reporting surface. The pure `src/report/` leaf owns UTC ranges, diagnostic
ledger/detail reads, presentation-session grouping, projections, portable
rendering, and the lazy bounded report service; it persists no index or
session store. `docs/reporting/design.md` is its authoritative contract.

**Where agent activity is recorded** (state home, `~/.operon/<org>/`;
README.md → Observability is the authoritative inventory):
`runs/<app>/<runId>/` is the per-pass source of truth (`envelope.json`,
`events.jsonl`, verbatim `brief.md`/`prompt.md`/`output.md`, and activity-only
`session.log`); `telemetry/<date>.jsonl`
is the org ledger every provider turn settles into exactly once, keyed on
`runId` (`operon budget --reconcile` back-fills); `invocations/<date>.jsonl`
records each loop/dispatch invocation; `tasks/<taskId>/` holds the broader
delegated-task record plus exact outer prompt (child envelopes and ledger
rows carry `parent_task_id`); `learning/` holds the capture
projection (`events/`), rebuildable episode records (`episodes/`),
ReplayCapsules + SystemFingerprints (`capsules/`, `fingerprints/`), per-turn
pinned resolve records with `bundle_lineage` (`resolved/`), episode-sticky
canary assignments (`canary/assignments/`), and the publisher's
crash-resumable journal (`publish-journal/`); `runs/learning-replay/` is the
reserved replay namespace (reconciled for spend, excluded from capture).
The M3–M5 experiment + activation substrate lives in the **committed org
home** `learning/**`: experiments (declared-before-results), interventions
(lineage), evals (trusted only after independent validation), candidates
(agent-emitted, never resolvable — deliberately NOT gate-protected), reviews
+ `rejections.jsonl` (fail-closed verdicts + suppression), quarantine
(human provisionals, resolver-enforced TTL), `bundle/**` + `manifest.yaml`
(active concepts, version cuts, canary trial state), and `proposals/**`
(unmerged drafts). M4+M5 are live: context assembly resolves governed
concepts once per turn (pinned) and per (ticket episode, pipeline role) in
the build loop; a T3 live canary is structurally forbidden by the policy
loader; `operon learn` is the manual surface — activation verbs
(`review|publish|resolve|disable|rollback|provisional`), the offline §9.5
funnel (`experiment declare|run|list`, learning-budget-capped, rendered by
`operon budget`), and the live-trial lifecycle
(`canary start|status|promote|stop`). M6 is live: daily deterministic-prechecked
distillation, weekly cross-provider review, policy frequency/volume caps, and
report-only compaction run through the ordinary dispatch/pipeline/ledger path.

## Map
| Path | What it is |
| --- | --- |
| `docs/PURPOSE.md` | Decision log — **read first**; every decision to date |
| `docs/wiki.html` | Standalone code wiki — the three layers, build loop, adapters, gates, and curated reading paths, for an engineer coming up to speed (open in a browser) |
| `TASTE.md` | Packaged org-constitution template, copied by `operon org init` (human-ratified) |
| `roles.yaml` | Packaged executable org-chart template: role → runtime/model/effort/triggers |
| `pipelines.yaml` | Packaged build-protocol template (build/review/fix/ship) — human-ratified; validated by `operon pipelines` |
| `prompts/` | Versioned pass templates the pipelines reference — human-ratified protocol surfaces, one file per pass |
| `docs/architecture.md` | Detailed design: dispatcher, turn lifecycle, approvals, context, memory, multi-app, bootstrap, GitHub conventions (§11 decisions ratified into docs/PURPOSE.md) |
| `docs/loop.md` | Build-loop engineering design (the center of gravity): pass pipelines, briefs, quality gates, verdicts, ticket state machine — predecessor-orchestrator inheritance audit included |
| `docs/testing-journey.md` | Plain-language explainer: the sandbox test apps, what each build-plan stage proves against them, and the approved gamma coverage for SRE-on-live-service / Support / Marketing |
| `docs/event-schemas.md` | File-drop company-lifecycle event payload contract for Support / Marketing / SRE inputs |
| `docs/capability-matrix.md` | Adapter capability matrix: native / adapter-built / degraded surfaces for Claude, Codex, and pi |
| `docs/benchmark-runbook.md` | Stage 7 clean-room benchmark: procedure, targets, and rules |
| `docs/proportionality-review.md` | The 2026-07-10 systemic review + staged plan (landed); §7 records benchmark rounds 1–2 |
| `docs/approval-and-release-amendment.md` | A1–A5 approval & release boundary design (ratified 2026-07-10, implemented; cited by code) |
| `docs/learning-loop/` | Learning-loop design suite (v0.8, 2026-07-11): governed self-improvement — design, spec, milestones, control/data-flow diagrams; superseded review feedback under `archive/` |
| `src/runtime/` | Runtime contract: `Runtime` interface, critical-ops gate, telemetry, L1–L3 runlog writers, `secret-patterns.ts` (the ONE secret-regex list — redaction and qgates both import it), adapters (Claude Agent SDK, Codex App Server, pi SDK) |
| `src/loop/` | Build loop: pass executor, briefs, quality gates, typed verdicts, GitHub ops, ticket scheduler, M5 ticket state machine, and M6 real pipeline integration (design in `docs/loop.md`) |
| `src/org/` | Standing-org layer: roles/apps loaders, bootstrap, co-planning, scheduler, approvals, budget overlays, trigger routing, context, memory, scorecards, retro |
| `src/observe/` | Presentation-only Live UI: versioned projection, URL-stable live/historical session selection, source health, bounded read-only GitHub polling, loopback HTTP/SSE, allowlisted local evidence, and embedded framework-free assets |
| `src/report/` | Presentation-only Reporting V1: diagnostic daily-ledger/range readers, direct run/task enrichment, deterministic sessions, usage/budget projections, portable HTML, and lazy bounded server cache |
| `src/org/home.ts` | Package/org/state boundary: complete org initialization, validation, active pointer, and independent state-home resolution |
| `src/org/learning/` | Learning loop (design in `docs/learning-loop/`): M1–M5 capture/episode/replay/experiment/governed activation/evaluation/canary substrate, plus M6 `distillation.ts` (deterministic evidence clustering, live-bundle/candidate/rejection dedupe, policy caps, candidate-store writes, independent structured review, durable skip/cap records, and report-only compaction). Distiller/reviewer/replay turns use the ordinary pass executor and org ledger; the deterministic publisher remains the sole protected-surface writer. |
| `src/cli/` | One module per CLI subcommand (`roles.ts`, `doctor.ts`, …); `src/cli.ts` is a thin dispatch table over them — new subcommands are a new file + one registry line |
| `agent-skills/operon/` | Packaged `$operon` Agent Skill: agent-facing CLI discovery, onboarding, safety, and diagnosis workflow |
| `scripts/link-local.mjs`, `scripts/operon-local.mjs` | Source-backed local installation; exposes `operon` and the skill without conflating package and org homes |
| `test/` | The offline suite (~100 files): gates, adapter conformance, loop state machine, qgates, learning loop, org layer, CLI dispatch |
| `test/fixtures/orgHome.ts`, `test/fixtures/fakeClock.ts` | Composable temp-dir fixtures for `~/.operon/<org>/` and app-repo `.operon/` trees, plus a deterministic clock — reuse instead of a new ad-hoc mkdtemp scaffold |
| `test/conformance/` | The adapter-generic conformance suite (`harness.ts` + `cases.ts`): every `Runtime` must pass `runConformanceSuite(name, makeRuntime, opts)` before its role goes live — proven against `src/runtime/testing/fakeRuntime.ts` in `conformance.test.ts`; a live adapter gets its own file reusing the same suite |
| `research/` | Decision records (runtime adapter integration facts, prompt-caching economics) |
| `eval/` | Highly-efficient-organization qualification assets: exact contract inventory, schemas, content-addressed app seeds, content-hashed hidden graders/references/mutants, adapter capability and content-bound operator declarations, corpora, cases, campaign templates, and price catalogs. Raw attempts live under ignored `.eval-artifacts/`. |

## Commands (verified 2026-07-11)
- Node: >= 26 (`engines`, `.nvmrc`; `nvm use`). Node >= 25 no longer bundles
  corepack — `npm install -g corepack && corepack enable` once per Node
  install. `node:sqlite` is stable on this floor (relevant to the learning
  loop's metrics upgrade path).
- Install: `pnpm install` — pnpm is pinned via `packageManager` (corepack);
  an older global pnpm will fail with store/workspace errors. `corepack
  enable` once if `pnpm --version` doesn't match the pin.
- Local product install: `pnpm link:local` — creates a source-backed
  `~/.local/bin/operon` (or `$OPERON_BIN_DIR/operon`) and links the packaged
  skill into the Codex, Claude, and pi skill homes (respecting `CODEX_HOME`,
  `CLAUDE_CONFIG_DIR`, and `PI_CODING_AGENT_DIR`); later source edits need no
  update, rebuild, or relink.
- Test: `pnpm test` (vitest — fast, offline; run for any `src/` or
  `roles.yaml` change; `*.live.test.ts` files are excluded here)
- Efficiency eval, token-free: `pnpm eval:validate` · `pnpm
  test:transformation` (required + exact known-red) · `pnpm
  eval:deterministic` · `pnpm test:transformation:strict` (final gate; expected
  non-zero while declared transformation debt remains).
- Efficiency eval, explicit external boundary: `pnpm eval:prepare -- --campaign
  <template> --github-owner <owner>` · preview/execute `pnpm eval:github` and
  `pnpm eval:live` only with their environment switches, exact campaign
  confirmation, and human-authorized cap · `pnpm eval:soak -- --campaign
  <prepared-file>` previews the separate 48–72 hour L6 runner (execution also
  requires `OPERON_EVAL_SOAK=1`, an exact confirmation, and an explicit cap) ·
  `pnpm eval:qualify` is read-only.
- Live UI browser tests: `pnpm test:observe-browser` (Playwright Chromium;
  offline loopback fixtures, responsive/keyboard/reduced-motion/reconnect and
  injection coverage; install the browser once with `pnpm exec playwright
  install chromium`)
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
  `pnpm dev app reset <app> [--execute --confirm <app>] [--force]` ·
  `pnpm dev new-app marketplace --target-dir ../marketplace --repo owner/marketplace --goal "A marketplace for dummy products" --dry-run` ·
  `pnpm dev bootstrap --scan-only <repo>` · `pnpm dev plan <app> --dry-run` ·
  `pnpm dev plan <app> --auto --goal "<text>" [--stage bootstrap|growth|mature]
  [--depth quick|standard|deep] [--no-publish]` (adaptive runtime-backed
  plan: schema-validated, orchestrator-published) ·
  `pnpm dev loop --app <app> --once --dry-run` ·
  `pnpm dev dispatch --dry-run` · `pnpm dev approvals` ·
  `pnpm dev observe [--app <app>] [--port 0] [--open]` ·
  `pnpm dev report [--app <app>] [--period 7d|30d|90d|1y|all] [--json] [--html out.html]` ·
  `pnpm dev budget` · `pnpm dev status` · `pnpm dev analyze` ·
  `pnpm dev telemetry --app <app> --date 2026-07-04 --html out.html` ·
  `pnpm dev task begin --id <id> --prompt-file <path> [--app <app>]` ·
  `pnpm dev task fallback --id <id> --reason "<why>"` ·
  `pnpm dev task finish --id <id> --status completed` ·
  `pnpm dev retro --date 2026-07-04` ·
  `pnpm dev learn report [--refresh]` (read-only unless refreshed) ·
  `pnpm dev learn inspect <episode-id>` ·
  `pnpm dev learn emit --episode <id> --observation "<text>"` ·
  `pnpm dev learn fixture <episode-id> --set roles/<role>/<set>
  [--validate --by <name>]` ·
  `pnpm dev learn review <candidate-id> --verdict approve --rationale "<why>"
  --by <name>` · `pnpm dev learn publish <candidate-id> [--waiver "<why>"]` ·
  `pnpm dev learn resolve --app <app> --role <role>` ·
  `pnpm dev learn disable <concept-id>` ·
  `pnpm dev learn rollback --root org|app [--app <name>]` ·
  `pnpm dev learn provisional --scope <scope> --name <n> --description <d>
  --ttl-days N --by <name> --body "<text>"` ·
  `pnpm dev learn experiment declare --candidate <id> --evals <scope>/<set>
  --hypothesis "<why>"` · `pnpm dev learn experiment run <exp-id> [--by <name>]` ·
  `pnpm dev learn experiment list` ·
  `pnpm dev learn canary start <intervention-id> [--app <name>]` ·
  `pnpm dev learn canary status` ·
  `pnpm dev learn canary promote --root org|app [--app <name>]` ·
  `pnpm dev learn canary stop --root org|app --reason "<why>"` ·
  `pnpm dev learn distill [--app <name>] [--dry-run]` ·
  `pnpm dev run-role <role> --app <app> --dry-run` ·
  `pnpm dev run-role <role> --dry-run` · `pnpm dev prune-runs` ·
  `pnpm dev doctor [--config-only]` (default probes configured adapter readiness
  without a model turn; config-only never claims readiness)
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
- Changes under `eval/**`, `scripts/eval/**`, or transformation eval fixtures:
  run `pnpm eval:validate`, `pnpm test:transformation`, `pnpm
  eval:deterministic`, the complete `pnpm test`, and `pnpm typecheck`.
  `test:transformation:strict` must fail only for the exact declared known-red
  set until production work promotes those contracts. Never run `eval:github`
  or `eval:live` merely because these files changed.
  Do not execute `eval:soak` merely because soak files changed; preview and
  deterministic scheduler tests are token-free, but L6 execution is a
  separately authorized 48–72 hour provider campaign.
- Any `src/` change: `pnpm test && pnpm typecheck` (seconds).
- `src/observe/**` or `src/cli/observe.ts` changes: also run `pnpm
  test:observe-browser`, `pnpm build`, `pnpm smoke:onboarding`, and `npm pack
  --dry-run`; server tests must use a real ephemeral loopback port and cover
  capability/security headers, SSE replay/resync, corrupt/torn/legacy state,
  traversal/symlink rejection, and observer-shutdown independence.
- `src/report/**`, `src/cli/report.ts`, or Reports-mode changes: run the same
  browser/build/smoke/pack checks; semantic tests must pin UTC boundaries,
  ledger corruption/concurrency, accounting quality and duplicates,
  deterministic session identity, budget agreement, CSP/L3 exclusion,
  pagination resync, immutable app scope, and read-only behavior.
- Packaging, home resolution, CLI discovery, or onboarding changes: also run
  `pnpm smoke:onboarding` and `npm pack --dry-run`; the smoke must use a neutral
  cwd and temporary provider homes so it cannot depend on the source repo as
  an implicit org or touch real installed skills.
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
- Open work / where the last session stopped: the GitHub issue tracker
  (`gh issue list`)

## Maintenance
When you change code, update the nearest AGENTS.md or linked reference doc if
the change alters architecture, commands, conventions, API contracts,
auth/security behavior, data models, generated-code workflow, deployment
behavior, or testing strategy. When you add a new deployable service, app,
package, crate, or major subsystem, create or update the appropriate AGENTS.md
in the same change.
