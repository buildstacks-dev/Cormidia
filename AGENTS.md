# AGENTS.md

## Scope
Applies to the whole repo. There are no nested AGENTS.md files — this is a
single TypeScript package and one file covers it. `docs/PURPOSE.md` is the decision
log; on conflict, its Decided section wins and this file is stale — fix this file.

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
boundary supports action-aware classification, scoped grants, role toolset
shaping (forbidden acts unrepresentable on Claude, flat-denied everywhere),
durable denial lessons, and a persisted decision/execution lifecycle. A later
dispatch executes only typed content-bound GitHub deliveries plus the A4
release handoff, records acknowledgement, reconciles stable idempotency markers,
and never blindly retries ambiguity (`src/org/approval-delivery.ts`,
`src/org/release.ts`). `operon-sandbox-delta`
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
rendering, efficiency/invariant projections, and the lazy bounded report
service; it persists no index or session store. `docs/reporting/design.md` is
its authoritative contract.

`operon narrative` is the deterministic, token-free human-level causal
timeline: one captured markdown story per episode (prompt → plan → tickets →
build → merge, joined through the #128 `Planned-by` provenance) plus a
per-app `INDEX.md`, under state-home `narrative/` (1825-day retention).
Quotes are captured at render time through secret scrubbing and survive the
30-day `runs/` sweep; re-renders merge, never lose. `docs/narrative/design.md`
is its authoritative contract.

`operon scheduler` is the org-scoped autonomous-operation surface. Install and
uninstall preview by default, require exact confirmation to execute, and call
the ordinary stateless `operon dispatch` boundary through an absolute command.
`scheduler/evidence/**` keeps versioned invocation/decision/alert records;
`operon scheduler status` and doctor require definition, manager, tick, and
settlement evidence rather than treating file presence as health.
`docs/scheduler.md` is the authoritative schema, identity, reason-code, and
health contract.

**Where agent activity is recorded** (state home, `~/.operon/<org>/`;
README.md → Observability is the authoritative inventory):
`runs/<app>/<runId>/` is the per-pass source of truth (`envelope.json`,
`events.jsonl`, verbatim `brief.md`/`prompt.md`/`output.md`, and activity-only
`session.log`); `telemetry/<date>.jsonl`
is the org ledger every provider turn settles into exactly once, keyed on
`(app, providerTurnId)` with `(app, runId)` fallback for legacy rows (`operon
budget --reconcile` back-fills), with a derived keys-only sidecar in the
sibling `telemetry-index/settled.keys` (deliberately outside `telemetry/` so
bare ledger-directory enumerators never parse or double-count it) that keeps
the exactly-once check off the full ledger rescan (F-002, ledger-first so it
can only lag, never lead — rebuilt from the ledger when absent);
`efficiency/episodes/<hash>/` holds the
episode route, route-bounded execution journal, terminal provider/mechanical
execution steps, and component-hashed context manifest/delta projections;
`invocations/<date>.jsonl`
records each loop/dispatch invocation; `tasks/<taskId>/` holds the broader
delegated-task record plus exact outer prompt (child envelopes and ledger
rows carry `parent_task_id`); `learning/` holds the capture
projection (`events/`), rebuildable episode records (`episodes/`),
ReplayCapsules + SystemFingerprints (`capsules/`, `fingerprints/`), per-turn
pinned resolve records with `bundle_lineage` (`resolved/`), episode-sticky
canary assignments (`canary/assignments/`), and the publisher's
crash-resumable journal (`publish-journal/`); `runs/learning-replay/` is the
reserved replay namespace (reconciled for spend, excluded from capture).
`scheduler/installation.json` and `scheduler/evidence/{invocations,decisions,alerts}/`
hold scheduler ownership, exact-once ticks, route decisions, and local alerts;
`standing-roles/<app>/{artifacts,planner-feeds}/` holds source-bound draft-only
SRE/Support/Marketing results and deterministic Planner feeds; critical/down
SRE events also queue a source-linked `op:incident` action through the durable
approval-delivery boundary. Every state
subtree has a retention window, swept fail-safe once per UTC day from the
dispatch tick (`src/org/retention.ts`; docs/scheduler.md → State retention;
manual form `operon prune-runs --sweep`) — the ledger sweep never deletes
rows still re-settleable by `budget --reconcile`, and `learning/` is swept
only under `events/<date>/`.
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
Phase 4 closes that loop in production: `efficiency-evidence/v1` projects
orchestrator-owned run, route, journal, execution-step, approval-analyzer, and
scheduler-miss records into stable trusted learning events; deterministic
app/role-scoped recurrence and durable dispositions feed the existing governed
candidate/review/experiment/publisher/canary chain; efficacy declarations pin
fingerprints, hidden-guardrail commitments, pairing, budgets, missingness, and
side-effect replacement before results; and `operon learn report
--efficiency-health [--json] [--refresh]` reports capture, governance, and
efficacy health independently. The mechanics construct no provider runtime.

That closed loop was **built but not actually live** until 2026-07-19: capture
overwrote the run envelope's efficiency-namespace `episode_id` with the
learning anchor before handing the run to the projector, so the provider-step
filter matched nothing, every provider run classified as mechanical, and zero
efficiency evidence reached `learning/events/` in any org (#137). A failed pass
additionally produced no learning event of any kind (#138), and
`--efficiency-health` reported `capture.status: "healthy"` throughout, because
it counted runs projected rather than evidence produced (#141). The two episode
id namespaces are now threaded separately at the seam, a terminal `failed`
envelope is evidence on its own `error_code`, and health degrades on a run that
demonstrably failed while yielding nothing. `test/learning/evidence-projection.test.ts`
drives capture → `prepareDistillation` end-to-end and fails the build if a
cluster stops forming — the coverage gap that let this ship green (#142).

## Map
| Path | What it is |
| --- | --- |
| `docs/PURPOSE.md` | Decision log — **read first**; every decision to date |
| `docs/development.md` | Canonical platform-development lifecycle: independent control plane, standing objective grants, incremental admission, circuit breakers, and shipping |
| `docs/wiki.html` | Standalone code wiki — the three layers, build loop, adapters, gates, and curated reading paths, for an engineer coming up to speed (open in a browser) |
| `TASTE.md` | Packaged org-constitution template, copied by `operon org init` (human-ratified) |
| `roles.yaml` | Packaged executable org-chart template: role → runtime/model/effort/triggers |
| `pipelines.yaml` | Packaged build-protocol template (build/review/fix/ship) — human-ratified; validated by `operon pipelines` |
| `prompts/` | Versioned pass templates the pipelines reference — human-ratified protocol surfaces, one file per pass |
| `docs/architecture.md` | Detailed design: dispatcher, turn lifecycle, approvals, context, memory, multi-app, bootstrap, GitHub conventions (§11 decisions ratified into docs/PURPOSE.md) |
| `docs/loop.md` | Build-loop engineering design (the center of gravity): pass pipelines, briefs, quality gates, verdicts, ticket state machine — predecessor-orchestrator inheritance audit included |
| `docs/scheduler.md` | Authoritative autonomous scheduler contract: lifecycle CLI, backend boundary, definition/evidence schemas, exact identities, reason codes, health semantics, and L6 boundary |
| `docs/testing.md` | What runs when: the local loop, the CI lane table, a command reference, and why the content-hash integrity machinery exists — reference companion to Testing expectations below |
| `docs/testing-journey.md` | Plain-language explainer: the sandbox test apps, what each build-plan stage proves against them, and the approved gamma coverage for SRE-on-live-service / Support / Marketing |
| `docs/event-schemas.md` | File-drop company-lifecycle event payload contract for Support / Marketing / SRE inputs |
| `docs/capability-matrix.md` | Adapter capability matrix: native / adapter-built / degraded surfaces for Claude, Codex, and pi |
| `docs/adding-updating-harnesses.md` | Runtime-harness procedure: the adapter contract, registration checklist, three test tiers, update obligations, and the one-way capability flow (#116) |
| `docs/benchmark-runbook.md` | Stage 7 clean-room benchmark: procedure, targets, and rules |
| `docs/proportionality-review.md` | The 2026-07-10 systemic review + staged plan (landed); §7 records benchmark rounds 1–2 |
| `docs/approval-and-release-amendment.md` | A1–A5 approval & release boundary design (ratified 2026-07-10, implemented; cited by code) |
| `docs/learning-loop/` | Learning-loop design suite (v0.8, 2026-07-11): governed self-improvement — design, spec, milestones, control/data-flow diagrams; superseded review feedback under `archive/` |
| `src/runtime/` | Runtime contract: `Runtime` interface, critical-ops gate, telemetry, L1–L3 runlog writers, `secret-patterns.ts` (the ONE secret-regex list — redaction and qgates both import it), `file-lock.ts` (the shared O_EXCL + pid/nonce ownership-token + liveness/stale-reclamation lock primitive — the app git-clone lock is a configuration of it; the settlement and turn locks are the model but not yet re-expressed onto it), adapters (Claude Agent SDK, Codex App Server, pi SDK) |
| `src/loop/` | Build loop: pass executor, briefs, quality gates, typed verdicts, GitHub ops, ticket scheduler, M5 ticket state machine, M6 real pipeline integration (design in `docs/loop.md`), and `default-branch.ts` (the ONE default-branch resolver — loop, turn runner, planner, and bootstrap all import it — plus the `BaseRevision` every execution path carries) |
| `src/org/` | Standing-org layer: roles/apps loaders, token-free upgrade/reset/recovery/verify/promote lifecycle, bootstrap, `bootstrap-publish.ts` (coordinated draft-PR publication of bootstrap-owned app + org changes), co-planning, scheduler, approvals, budget overlays, trigger routing, context, memory, scorecards, retro |
| `src/observe/` | Presentation-only Live UI: versioned projection, URL-stable live/historical session selection, source health, bounded read-only GitHub polling, loopback HTTP/SSE, allowlisted local evidence, and embedded framework-free assets |
| `src/report/` | Presentation-only Reporting V1: diagnostic daily-ledger/range readers, direct run/task enrichment, deterministic sessions, usage/budget projections, portable HTML, and lazy bounded server cache; also hosts `time-policy.ts`, the ONE timestamp-display policy shared with the Observer (it lives here because nothing may import `src/observe`) |
| `src/narrative/` | Presentation-only Narrative V1 (`operon narrative`): deterministic, token-free causal timeline — one captured story per episode + per-app INDEX.md under state-home `narrative/`, quote-at-capture with secret scrubbing, merge-never-lose across retention sweeps. `docs/narrative/design.md` is its authoritative contract |
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

## Commands (verified 2026-07-14)
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
- Test: `pnpm test` (vitest — offline and capped at two workers to prevent
  subprocess/disk contention; run for any `src/` or `roles.yaml` change;
  `*.live.test.ts` files are excluded here)
- Efficiency eval, token-free: `pnpm eval:validate` · `pnpm
  test:transformation` (required + exact known-red) · `pnpm
  eval:deterministic` (subprocess/disk-heavy umbrella, capped at two workers) ·
  `pnpm test:transformation:strict` (green current Phase 6
  scope) · `pnpm test:transformation:future-soak-strict` (separate future gate;
  expected non-zero only for `I-LIVE-01` until the genuine campaign passes).
  Each of those is a self-contained local command that bundles a vitest run with
  a contract assertion. The contract assertions are also available **atomically**
  — `pnpm eval:contracts` (scope `all`, exact known-red), `pnpm
  eval:contracts:strict` (scope `current`), `pnpm
  eval:contracts:future-soak-strict` — so a caller that has already run the
  offline suite does not re-enter vitest to reach them. CI uses the atomic form;
  `evaluateContracts` verifies evidence presence and the declared debt set
  without probing source text, so one offline-suite run plus the atomic gates is
  complete coverage. `pnpm test:offline` is `pnpm test` with the CI timeout.
- Efficiency eval, explicit external boundary: `pnpm eval:prepare -- --campaign
  <template> --github-owner <owner> [--authorization <standing-grant>]` ·
  preview/execute `pnpm eval:github` and `pnpm eval:live` with the same grant,
  their environment switches, and exact campaign confirmation. Under a bound
  developer objective, the switch and confirmation are agent-supplied accident
  guards rather than a repeated human approval; the grant's cumulative
  equivalent-cost ceiling remains the authority. `pnpm eval:soak -- --campaign
  <prepared-file>` previews the separate 48–72 hour L6 runner (execution also
  requires `OPERON_EVAL_SOAK=1`, an exact confirmation, and an explicit cap) ·
  `pnpm eval:qualify` is read-only.
- Phase 6 provider qualification uses at most one decisive full campaign per
  repaired candidate. Exact-candidate adapter and non-promotable focused
  admission remain the default for material provider uncertainty, while the
  ratified proportionate-release path may retain prior content-bound admission
  evidence for evaluator-only repairs. Such debt is disclosed and never turns
  a failed campaign into promotion evidence. See `docs/development.md` and
  `docs/benchmark-runbook.md`.
- Phase 6 paired learning has a separate post-L5 boundary: `pnpm
  eval:learning-activation -- --campaign <prepared-file>` previews the exact
  candidate and action hashes. Execution requires its own human authorization,
  `OPERON_EVAL_LEARNING_ACTIVATION=1`, `--execute`, and exact
  `--confirm-campaign`, `--confirm-candidate`, and `--confirm-action`; L5 spend
  authorization does not authorize activation. The command is token-free and
  may mutate only the campaign-local synthetic learning roots.
- Phase 6 evidence promotion, token-free after an authorized terminal run:
  `pnpm eval:archive -- --campaign <prepared-file> --out <fresh-external-root>` ·
  `pnpm eval:import-evidence -- --archive <schema-v2-archive> --receipt
  <campaign-receipt>` · `pnpm eval:attest-release -- --campaign
  <sanitized-campaign> [--campaign <sanitized-soak>]` · `pnpm eval:promote --
  --campaign <sanitized-campaign> --attestation
  research/evals/phase6-release-attestation.json`. These commands never repair
  results; promotion requires exact campaign/candidate/case/repetition,
  qualifier/report/archive/GitHub/grader/accounting, and package/suite
  equivalence evidence.
- Release product-currency gate, token-free and fail-closed: `pnpm
  eval:release-verify [--attestation <path>] [--campaign <path> ...]` runs the
  full `verifyReleaseAttestation` (live `npm pack`, executable suite, org
  surfaces, on-disk bytes, git changed-path) against the committed attestation +
  its committed campaign(s) and exits non-zero when the live product no longer
  matches the qualified pin. The offline suite asserts evidence **integrity**
  only (deterministic, green on intact evidence); this command and the
  `release-currency` CI job (gated to release tags / `workflow_dispatch`, off
  ordinary push/PR) enforce product **currency** at release. A release from
  post-Wave-5 `main` is expected to fail this until a fresh qualification
  campaign re-attests (docs/PURPOSE.md 2026-07-17).
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
- CLI after local install: `operon org init <path> --name <name> [--dry-run] [--json]` · `operon
  context` · `operon capabilities` · `operon doctor`; every command resolves
  the active org independently of cwd.
- CLI in source-development mode: `pnpm dev roles` · `pnpm dev apps` · `pnpm dev pipelines` ·
  `pnpm dev org upgrade [--authority preserve|delegated-operator|conservative|custom] [--execute] [--json]` ·
  `pnpm dev app reset <app> [--execute --confirm <app>] [--force]` ·
  `pnpm dev app verify <app> [--json]` ·
  `pnpm dev app promote <app> --to live [--execute] [--json]` ·
  `pnpm dev new-app marketplace --target-dir ../marketplace --repo owner/marketplace --goal "A marketplace for dummy products" --dry-run` ·
  `pnpm dev bootstrap --scan-only <repo>` ·
  `pnpm dev bootstrap <repo> --answers-from <archive|app> [--json]` ·
  `pnpm dev bootstrap publish <app> [--app-dir <path>] [--app-only] [--json]`
  (preview; `--execute` stages ONLY bootstrap-owned paths, cuts
  `op/bootstrap-<app>` from each remote's resolved default branch, and opens
  DRAFT pull requests — never merges, never marks ready, idempotent on retry,
  and refuses when unrelated staged changes / a merge in progress / a detached
  HEAD make the scope ambiguous) ·
  `pnpm dev plan <app> --dry-run` ·
  `pnpm dev plan <app> --auto --goal "<text>" [--stage bootstrap|growth|mature]
  [--source <file-or-dir>]... [--optional-source <file-or-dir>]...
  [--work-lifecycle existing-ticket|bounded-goal|milestone|strategy]
  [--depth quick|standard|deep] [--dry-run] [--no-publish] [--json]` (adaptive runtime-backed
  plan: schema-validated, orchestrator-published) ·
  `pnpm dev plan <app> --creator-scope <scope.json|scope.yaml> --execution-ready
  [--dry-run] [--no-publish] [--json]` (explicit strict creator-scope bypass;
  no inferred readiness) ·
  `pnpm dev plan <app> --explain-route --goal "<text>" [--stage …]` (token-free
  route preview; rejects `--auto` — the two forms are mutually exclusive) ·
  `pnpm dev loop --app <app> --once --dry-run` · `pnpm dev loop
  --explain-context <episode-id>` · `pnpm dev loop --resume-episode
  <episode-id>` · `pnpm dev loop rearm --app <app> --ticket <number> --reason
  "<why>" --actor <identity> --from-allowance N --to-allowance N [--execute
  --confirm <app#number>]` ·
  `pnpm dev dispatch --dry-run` · `pnpm dev approvals` · `pnpm dev approvals status` ·
  `pnpm dev scheduler install [--backend launchd|systemd] [--json]` (preview) ·
  `pnpm dev scheduler install --execute --confirm <scheduler-id-or-org>` ·
  `pnpm dev scheduler status [--json]` ·
  `pnpm dev scheduler uninstall [--json]` (preview; execution also requires
  exact confirmation) ·
  `pnpm dev observe [--app <app>] [--port 0] [--open]` ·
  `pnpm dev report [--app <app>] [--period 7d|30d|90d|1y|all] [--json] [--html out.html]` ·
  `pnpm dev narrative [--app <app>] [--episode <id>] [--json]` ·
  `pnpm dev budget` · `pnpm dev status` · `pnpm dev analyze` ·
  `pnpm dev telemetry --app <app> --date 2026-07-04 --html out.html` ·
  `pnpm dev task begin --id <id> --prompt-file <path> [--app <app>]` ·
  `pnpm dev task fallback --id <id> --reason "<why>"` ·
  `pnpm dev task finish --id <id> --status completed` ·
  `pnpm dev retro --date 2026-07-04` ·
  `pnpm dev learn report [--efficiency-health] [--json] [--refresh]` (read-only unless refreshed) ·
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
  `pnpm dev run-role <role> --dry-run` · `pnpm dev prune-runs [--sweep]` ·
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
- **Never hardcode a default branch.** `main` is not the default branch — it
  is *a* default branch. Resolve with `resolveRemoteDefaultBranch()` from
  `src/loop/default-branch.ts`, then thread the resulting `BaseRevision`
  (`ref` = what you diff/branch from, `defaultBranch` = what you merge into)
  through instead of re-deriving or defaulting it. The option types make it
  required, so a missed call site is a compile error, and
  `test/loop/default-branch.test.ts` fails the build on any new hardcoded
  `main`/`master`/`trunk` literal outside the presentation-only
  `src/observe` and `src/report` leaves. A guessed base silently diffs a
  ticket against the wrong tree, which is worse than not running (#101).
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
- **Model IDs:** all roles.yaml IDs were refreshed against live catalogs and
  human-ratified 2026-07-15 (sources in
  `research/2026-07-15_model-assignment-refresh.md`). One live caveat:
  `gpt-5.6-sol` in Codex uses the installed ChatGPT-account-authenticated App
  Server path; exact availability is proved by adapter calibration before a
  candidate campaign.
- Single package, deliberately **not** a pnpm workspace (docs/PURPOSE.md → Repo shape).

## Testing expectations
This section is the **rules** — what you must run for a given change.
[`docs/testing.md`](docs/testing.md) is the **map**: the local loop, the full CI
lane table with timings, a per-command reference, and why the content-hash
integrity machinery exists. On conflict this section wins; fix the other file.
- **CI runs change-aware lanes** (`.github/workflows/efficiency-qualification.yml`).
  `classify` resolves the changed paths through `scripts/ci/classify-changes.mjs`
  and admits: `core` (offline suite **exactly once** + typecheck + the atomic
  token-free contract gates, plus the nightly shuffle tripwire on the schedule),
  `observer-reports` (Chromium browser tests, `smoke:onboarding`, `npm pack
  --dry-run` — only for Observer/Reports/packaging surfaces), and
  `release-currency` (release tags / `workflow_dispatch` only). Admission fails
  open into more testing: a schedule, tag, dispatch, unresolvable diff, or
  unrecognised path admits every lane; only provably behaviour-free paths
  (documentation, reviewer notes) admit none. Superseded pull-request runs are
  cancelled; `main` and tag runs never are. `scripts/ci/**` and
  `.github/workflows/**` are part of the executable suite because they select
  which tests run — the same reason `vitest.config.ts` is. Add a case to
  `test/ci/classify-changes.test.ts` for every admission-rule change.
- Changes under `eval/**`, `scripts/eval/**`, or transformation eval fixtures:
  run `pnpm eval:validate`, `pnpm test:transformation`, `pnpm
  eval:deterministic`, the complete `pnpm test`, and `pnpm typecheck`.
  `test:transformation:strict` must pass the current scope after the nine
  Phase 6 provider-evidence promotions;
  `test:transformation:future-soak-strict` must independently fail only for
  `I-LIVE-01`. The canonical boundary is `docs/efficiency.md` → Phase 6
  qualification scope. Never run `eval:github`
  or `eval:live` merely because these files changed.
  Do not execute `eval:soak` merely because soak files changed; preview and
  deterministic scheduler tests are token-free, but L6 execution is a
  separately authorized 48–72 hour provider campaign.
  Provider usage quality marked unavailable must remain an invalid missing
  denominator with its original typed infrastructure/account cause; never
  coerce it to zero, retry it as a merit miss, or substitute a model.
  For a genuine repaired provider behavior, use the smallest evidence sequence
  that resolves material risk and run at most one decisive full campaign for
  that candidate. Preserve every first failure and its cause; evaluator-only
  defects do not recursively restart adapter, focused, and full campaigns. Do
  not resample an aggregate learning experiment to seek a favorable draw—replay
  deterministic verifier defects token-free instead.
  Standing development authorization, cumulative equivalent-cost accounting,
  and new-decision boundaries are defined only in `docs/development.md` and
  never apply to an operated org.
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
- Scheduler lifecycle, dispatch-evidence, or scheduler-health changes must run
  the production-backed `test/scheduler/` suite under temporary HOME, TMPDIR,
  org, state, app, and definition trees with an injected manager. Never invoke
  a real launchd/systemd mutation in tests. The seven-day virtual soak must use
  fake clocks, include restart/fault/isolation cases, and prove exact provider
  settlement plus zero mechanical-runtime construction. L6 execution remains
  separately authorized; ordinary changes may run preview only.
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
