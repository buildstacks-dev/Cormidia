# TODO — Operon roadmap & session handoff

A fresh session should read `docs/PURPOSE.md` → `AGENTS.md` → this file, then pick
up the top unchecked item. Keep this list current as items land; move finished
items to Done with a date.

> **Handoff (2026-07-04, evening; roadmap audit 2026-07-06):** "Next up"
> below is the comprehensive build plan, produced by a multi-agent decomposition +
> adversarial validation pass over `docs/architecture.md` + `docs/loop.md`.
> Execute items strictly top-down unless a parallel-track note says otherwise.
> A fresh session executes one item: read `docs/PURPOSE.md` → `AGENTS.md` → this
> file, pick the top unchecked item, read that item's **Read** pointers, then
> implement to its acceptance checks. Do not start an item whose **Deps** are
> unchecked.
>
> **Scope updates (2026-07-05, human decisions):** (1) the civic pilot is ON
> HOLD until the product is ready — the two real sandbox apps
> (operon-sandbox-alpha/beta) are the functional targets throughout; see the
> M3 header note. (2) M11 (buildstacks.dev) is DEFERRED POST-LAUNCH — the
> product is **build-complete at M10**; M11's approval-queue acceptance moved
> to M7.14, its config-not-fork check into M3.7. Production onboarding of
> civic + buildstacks happens with the human once M10 lands.
> (3) A 2026-07-06 GPT roadmap audit found three concrete gaps and slotted
> them below instead of leaving them as prose: trigger-to-pipeline routing for
> non-builder roles (M8.3), SRE/Support/Marketing v0 pipelines plus third
> sandbox coverage (M8.4-M8.5), and cache-token telemetry/anomaly tracking
> promised by `docs/loop.md` §9-§10 (M9.10). Product build-complete remains
> M10; these items make "standing org" true before that line.

## Next up (ordered)

### How to read an item

Every item is atomic (one fresh session), mechanically testable (exact
commands / named test cases / observable CLI output), and milestone-bearing
(the **Demo** line). Fields: **Goal**, **Files** (create/modify), **Deps**
(item ids), **Accept** (the checks), **Demo**, **Read** (everything a fresh
session needs), **Session** (suggested model tier + fan-out shape).

Standing decisions binding all items (arbitrated 2026-07-04):
- **`src/runtime/telemetry.ts` stays** as the per-turn cost ledger (budget
  rollups + retro read it; architecture §1 lists it in the layout). The
  runlog layer (L1/L2/L3, `docs/loop.md` §9) is per-pass observability —
  `envelope.json` references turn telemetry, never replaces it.
- **One-way imports hold everywhere**: `src/loop` never imports `src/org`.
  Where the design assigns a writer to `src/org` (scorecards, approvals,
  context), loop code returns plain data and the org layer persists it.
- **CLI subcommands are one file each** under `src/cli/` (item M0.1) so ~20
  later items don't serialize on `src/cli.ts`.
- **Secret-detection regexes have one home**: `src/runtime/secret-patterns.ts`
  (created by M2.4). Runlog redaction and the qgates security scan both
  import it — loop→runtime is the legal direction; a second pattern list
  anywhere is a bug.
- **Human-ratified surfaces** (TASTE.md, roles.yaml, docs/PURPOSE.md, and — once
  created — pipelines.yaml, prompts/**, taste/*.md, apps.yaml): items that
  add or change them land as proposal PRs, never silent merges.

Parallel tracks: **M4 (quality gates + verdicts) may run in parallel with
M1–M3** (single exception: M4.4 depends on M2.4 for the shared
secret-pattern module). **M1 may run in parallel with M2.** All other
milestones are sequential.

---

### M0 — Foundations: shared fixtures, conformance harness, gate expansion
*Milestone demo: `pnpm test` proves the adapter-conformance suite green
against a scripted FakeRuntime, and the gate denies writes to every current
and future protocol surface — before any adapter or loop code exists.*

- [x] **M0.1 CLI subcommand registry refactor** ✅ 2026-07-05
  **Goal:** `src/cli.ts` becomes a thin dispatch table over one module per
  subcommand (`src/cli/roles.ts`, `src/cli/doctor.ts`, …) so the ~20 CLI
  items in this plan add files instead of colliding on one shared switch.
  Behavior of existing commands is unchanged.
  **Files:** src/cli.ts, src/cli/roles.ts, src/cli/doctor.ts, test/cli.test.ts
  **Deps:** —
  **Accept:** `pnpm dev roles` and `pnpm dev doctor` print byte-identical
  output to before (capture before/after); new test/cli.test.ts case
  "unknown command prints usage and exits 1"; `pnpm test && pnpm typecheck`.
  **Demo:** Same CLI, but adding a subcommand is now a new file + one
  registry line.
  **Read:** src/cli.ts; AGENTS.md (Commands).
  **Session:** sonnet, single session.

- [x] **M0.2 Canonical FakeRuntime test double** ✅ 2026-07-05
  **Goal:** Exactly one scriptable `Runtime` double, in
  `src/runtime/testing/fakeRuntime.ts` (source-visible — future adapters
  reuse it), with the union capability set: scripted `TurnResult[]` consumed
  in call order (clear throw when over-called); full TurnRequest/TurnHooks
  recording; routing scripted ToolActions through `hooks.gate` and surfacing
  escalations; emitting `onEvent({type:"subagent"…})` before a scripted
  subagent critical-op so the gate provably sees subagent actions; accepting
  a >300 KB `req.task` without truncation.
  **Files:** src/runtime/testing/fakeRuntime.ts, test/runtime/fakeRuntime.test.ts
  **Deps:** —
  **Accept:** named cases "returns scripted TurnResults in call order",
  "invokes hooks.gate and surfaces escalate:true on denial", "emits subagent
  event then routes its action through the gate", "accepts a 300KB task",
  "throws clearly when over-called"; `grep -rn "class FakeRuntime" src test`
  → exactly 1 match; `pnpm test && pnpm typecheck`.
  **Demo:** Any later test scripts a full multi-turn Runtime interaction with
  zero SDK/network dependency.
  **Read:** src/runtime/types.ts; docs/loop.md §2.
  **Session:** sonnet, single session.

- [x] **M0.3 Composable org-home/app-repo temp fixture + FakeClock** ✅ 2026-07-05
  **Goal:** One fixture module builds any slice of the `~/.operon/<org>/`
  tree and an app-repo `.operon/` tree in temp dirs:
  `makeOrgHome({taste, memory, state, approvals, runs})` with opt-in
  sub-builders, `makeAppRepo(...)`, plus a deterministic `FakeClock`
  (`advance(ms)`). Replaces what would otherwise be four ad-hoc mkdtemp
  scaffolds across memory, dispatcher, approvals, and runlog tests.
  **Files:** test/fixtures/orgHome.ts, test/fixtures/fakeClock.ts,
  test/fixtures/orgHome.test.ts
  **Deps:** —
  **Accept:** cases proving each sub-builder alone and in combination
  (e.g. memory+approvals together), `cleanup()` removes everything;
  FakeClock.advance moves `now()` deterministically; `pnpm test && pnpm
  typecheck`.
  **Demo:** One import gives any later test a faithful org-home tree.
  **Read:** docs/architecture.md §1 (both layouts); docs/architecture.md §6
  (bundle homes).
  **Session:** sonnet, single session.

- [x] **M0.4 Adapter conformance harness + FakeRuntime self-test** ✅ 2026-07-05
  **Goal:** The adapter-generic conformance suite every Runtime must pass
  before a role goes live on it (AGENTS.md rule): critical ops denied +
  escalated, routine ops allowed, a *subagent-issued* critical op caught
  identically, and a multi-hundred-KB brief transported intact
  (docs/loop.md §2's ARG_MAX lesson). Exposed as
  `runConformanceSuite(name, makeRuntime, opts)` over shared case fixtures
  extending test/gate.test.ts patterns; proven first against M0.2's
  FakeRuntime so later failures isolate to the adapter.
  **Files:** test/conformance/cases.ts, test/conformance/harness.ts,
  test/conformance/conformance.test.ts
  **Deps:** M0.2
  **Accept:** `pnpm test` shows named cases "Conformance: fake — critical ops
  escalate", "… — subagent critical op escalates", "… — large payload
  (300KB) transports"; test/gate.test.ts and test/roles.test.ts stay green
  and unmodified; `pnpm typecheck`.
  **Demo:** The conformance contract exists and is executable before any
  live adapter — Claude/Codex/pi all get judged by the same suite.
  **Read:** test/gate.test.ts; docs/loop.md §2; src/runtime/types.ts;
  src/runtime/gate.ts.
  **Session:** sonnet, single session.

- [x] **M0.5 Gate coverage expansion — all protocol surfaces, one pass** ✅ 2026-07-05
  **Goal:** Extend `protocol-self-edit` (and add a scorecard rule) to cover
  every surface this plan creates, in one edit instead of three colliding
  ones: `pipelines.yaml`, `prompts/**`, `taste/<role>.md` (the current
  `\btaste\.md\b` regex misses path-qualified files — fix it),
  `scorecards/**` (orchestrator-only writes, architecture §6), `apps.yaml`,
  `.operon/config.yaml`, `.operon/TASTE.md`. Memory dirs
  (`memory/roles/**`, `.operon/memory/**`) must stay routine-writable, with
  cases proving it.
  **Files:** src/runtime/gate.ts, test/gate.test.ts
  **Deps:** —
  **Accept:** new CRITICAL cases (write to each of the seven surfaces) and
  new ROUTINE near-misses (read of each; write to
  memory/roles/reviewer/lesson.md and .operon/memory/builder/lesson.md stay
  allowed); all 16 pre-existing cases green and unweakened; `pnpm test &&
  pnpm typecheck`.
  **Demo:** An agent write to any org protocol surface is denied + escalated
  before those surfaces even exist in the repo.
  **Read:** src/runtime/gate.ts; test/gate.test.ts; AGENTS.md (working
  rules); docs/loop.md §2 rule 2; docs/architecture.md §6 (scorecards).
  **Session:** sonnet, single session.

### M1 — ClaudeRuntime passes conformance *(may run parallel with M2)*
*Milestone demo: with an API key, `ClaudeRuntime` drives a live turn
end-to-end and a subagent's critical op is denied + escalated — the SDK's
session-wide `canUseTool` question settled with evidence.*

- [x] **M1.1 Model-ID verification + roles.yaml proposal PR** ✅ 2026-07-05 —
  research/2026-07-05_model-id-verification.md on main; PR #1 ratified by
  Bikram and squash-merged same day (builder/sre → gpt-5.5, support/marketing
  → claude-sonnet-5, planner/reviewer stay claude-opus-4-8).
  **Goal:** Verify real OpenAI IDs to replace the `gpt-5.5` placeholders and
  re-verify `claude-sonnet-4-6` against the live Anthropic catalog; record
  findings in a dated research note; open a proposal PR against roles.yaml
  (human-ratified — never self-merge).
  **Files:** research/2026-07-04_model-id-verification.md, roles.yaml (via PR)
  **Deps:** —
  **Accept:** research note states, per role, the exact replacement ID or
  "no public ID as of <date>" with source URL+date; `gh pr view` shows an
  open un-merged PR with per-line rationale; on the branch `pnpm test` and
  `pnpm dev roles` pass.
  **Demo:** The human has an exact, sourced roles.yaml diff to ratify.
  **Read:** AGENTS.md (Model IDs rule); roles.yaml; docs/PURPOSE.md → Decided →
  runtime layer.
  **Session:** sonnet, single session (needs web access).

- [x] **M1.2 ClaudeRuntime core: SDK wiring, context injection, resume, session-wide gate** ✅ 2026-07-05 —
  full conformance suite passed LIVE on subscription auth (11 turns, $2.43,
  claude-sonnet-5); subagent-gate claim proven. Key finding: canUseTool alone
  is insufficient (misses auto-allowed bash + subagent calls) — the gate is a
  PreToolUse hook. See research/2026-07-05_claude-runtime-live-conformance.md.
  Live suite: `pnpm test:live` (excluded from fast `pnpm test`).
  **Goal:** Implement `src/runtime/adapters/claude.ts` on the Claude Agent
  SDK (TS): TurnRequest→SDK options (model/effort/workdir), ContextBundle
  via system-prompt append (no files written), session resume from
  `SessionHandle.id`, `canUseTool`→`hooks.gate` for every tool action —
  and *empirically verify* subagent calls hit the same callback via a live
  AgentDefinition subagent instructed to attempt a critical op. Adds
  `@anthropic-ai/claude-agent-sdk` — the first non-yaml runtime dependency;
  flag it prominently in the PR (AGENTS.md: a dependency is a decision).
  **Files:** src/runtime/adapters/claude.ts, package.json,
  test/runtime/claude-sdk.unit.test.ts, test/runtime/claude-sdk.live.test.ts
  **Deps:** M0.4
  **Accept:** unit tests green with no API key (SDK mocked: system prompt
  contains taste layers in order; resume option set from session.id;
  canUseTool wired to hooks.gate); `ANTHROPIC_API_KEY=… pnpm test
  test/runtime/claude-sdk.live.test.ts` passes the full conformance suite
  live including the subagent-critical-op case; live file *skips* (not
  fails) without the key; record the dated live-run result in
  research/ (one paragraph — the always-skipped CI line needs a record it
  ever ran); `pnpm dev doctor` exits 0.
  **Demo:** First real Runtime; subagent gate coverage proven, not assumed.
  **Read:** research/2026-07-03_runtime-layer.md (Claude section);
  docs/architecture.md §5 (claude row); src/runtime/types.ts;
  test/conformance/harness.ts.
  **Session:** opus, single session — SDK-integration risk with an
  empirical claim to settle.

- [x] **M1.3 ClaudeRuntime telemetry + per-turn budget abort** ✅ 2026-07-05 —
  role.maxTurnBudgetUsd → SDK-native running guard (`maxBudgetUsd`);
  `error_max_budget_usd` → failed + exactly one incident-note artifact;
  real usage flows through toRecord (pinned in claude-budget.unit.test.ts);
  live suite re-run 3/3 with the cap active.
  **Goal:** Extract real TurnUsage (tokens/cost/subagentTurns/wallClock)
  from SDK events into the existing `toRecord`/`recordTurn`, and enforce
  `role.maxTurnBudgetUsd` as a running guard: crossing it mid-turn stops
  the session gracefully → status `failed` + an incident-note artifact
  (roles.yaml: "overrun = incident note, not silent spend").
  **Files:** src/runtime/adapters/claude.ts, test/runtime/claude-budget.unit.test.ts
  **Deps:** M1.2
  **Accept:** mocked-SDK cases: over-budget turn → status "failed" +
  exactly one kind:"note" artifact mentioning the overrun; under-budget
  turn → "completed" with usage.costUsd equal to the mocked total (not
  placeholder); `pnpm test && pnpm typecheck`.
  **Demo:** A runaway turn stops itself at the budget cap.
  **Read:** src/runtime/telemetry.ts; roles.yaml defaults; docs/PURPOSE.md →
  Budget & cadence.
  **Session:** sonnet, single session.

- [x] **M1.4 `TurnRequest.verdictSchema` + native structured output** ✅ 2026-07-05 —
  verdictSchema → SDK `outputFormat: {type:"json_schema", schema}` only when
  present (absent = options untouched); pinned in claude-verdict.unit.test.ts.
  Also fixed a live-suite subagent race (async agent spawns — see research
  note run log); two consecutive full live passes after.
  **Goal:** Add the optional `verdictSchema` field (docs/loop.md §10 delta)
  to `types.ts`; ClaudeRuntime requests SDK-native structured output when
  present; adapters without support ignore it (parser fallback lives in
  M4.6). Keep the type minimal (JSON-schema-shaped) — verdict *types*
  belong to src/loop/verdicts.ts, not here.
  **Files:** src/runtime/types.ts, src/runtime/adapters/claude.ts,
  test/runtime/claude-verdict.unit.test.ts
  **Deps:** M1.2
  **Accept:** with schema set, mocked SDK receives structured-output
  options; without it, options unchanged; full suite stays green after the
  types.ts change; `pnpm typecheck`.
  **Demo:** A pass can demand typed verdicts from adapters that support it.
  **Read:** docs/loop.md §6, §10.
  **Session:** sonnet, single session.

### M2 — Pass engine: pipelines, briefs, run-role, run logs
*Milestone demo: `pnpm dev run-role planner --dry-run` prints a real
assembled brief token-free, and any executed pass leaves an L1/L2/L3 run
record on disk — "if something executes, its logs exist."*

- [x] **M2.1 pipelines.yaml schema, types, loader** ✅ 2026-07-05 —
  src/loop/pipelines.ts: loadPipelines/getPipeline/selectPasses/parallelStages;
  only_on is OR across risk/labels/dimension_globs (per §4 prose);
  parallel grouping is adjacency-based; per-pass model-provider check
  deferred to the executor (loader knows role names only). 8 named cases.
  **Goal:** `src/loop/pipelines.ts`: typed PipelineConfig/PassConfig
  (ordered passes; per-pass role/template/effort/model overrides within the
  role's provider; `parallel_group`; `skip_on_tier`; `only_on`) and
  `loadPipelines(path, {roleNames, promptsDir})` validating role refs and
  template existence — against test fixtures only; the real root file is
  M2.2.
  **Files:** src/loop/pipelines.ts, test/loop/pipelines.test.ts,
  test/fixtures/pipelines/** (fixture yaml + two templates)
  **Deps:** —
  **Accept:** named cases: ordered passes load; unknown role rejected;
  missing template rejected; skip_on_tier excludes; only_on filters;
  parallel_group grouping returned; unknown pipeline throws descriptively;
  `pnpm test && pnpm typecheck`.
  **Demo:** Pipelines are typed, validated config — not YAML hope.
  **Read:** docs/loop.md §4, §10; src/runtime/types.ts (Effort, RoleConfig);
  src/org/roles.ts (parsing pattern).
  **Session:** sonnet, single session.

- [x] **M2.2 Seed root pipelines.yaml + prompts/ (build/review/fix/ship) + `operon pipelines` CLI** ✅ 2026-07-05 —
  PR #3 squash-merged under the delegated ratification process (review →
  live test → merge). The pre-merge review caught a real protocol bug:
  `only_on` gained a first-class `tier` key (deep-tier tickets would
  otherwise have silently skipped ship-check) + loader strictness (unknown
  keys rejected, template containment under prompts/, mechanical-pipeline
  invariant enforced). Live verification 16/16 — real SDK turns; contract +
  verify templates followed protocol incl. write-no-code /
  never-modify-source (research/2026-07-05_m2.2-live-template-verification.md).
  Deferred: `perf` finding category → decide in M4.6; shared org-home
  layout helper → extract when M2.8 becomes the third consumer.
  **Goal:** Land the real, human-ratified `pipelines.yaml` (build / review /
  fix / ship per docs/loop.md §4's sketch) and the pass templates under
  `prompts/`, each encoding the *fixed protocol content* of §4 (contract:
  files/approach/tests/risks/complexity as issue comment, no code;
  implement: read-before-write, baseline run, minimal diff, plan-adherence
  self-check, full suite, atomic `#<issue>:` commits, 3-attempt cap,
  blocked-with-evidence; verify: per-criterion check + structured findings
  + security lens + never modify source; fix: resolve-or-rebut every
  finding). The review pipeline seeds all three §4 dimensions: verify
  (always-on, security lens baked in), security-deep (`only_on` high risk /
  security dimension_globs), and perf-scale (`only_on` perf label/globs) —
  conditional-pass selection is wired live in M6.2. `operon pipelines`
  validates and prints them. Planner pipelines (plan/groom/triage) are
  deliberately M8 — do not seed here. These are new ratified surfaces:
  land as a proposal PR.
  **Files:** pipelines.yaml, prompts/build/contract.md,
  prompts/build/implement.md, prompts/review/verify.md,
  prompts/review/security.md, prompts/review/perf.md, prompts/build/fix.md,
  prompts/ship/check.md, src/cli/pipelines.ts
  **Deps:** M2.1, M0.1, M0.5 (gate already protects these files)
  **Accept:** on the PR branch: `pnpm dev pipelines` prints
  "pipelines.yaml: OK — 4 pipelines" + one line per pipeline with pass
  ids/roles, exit 0; a test loads the real root file through
  loadPipelines; `pnpm test && pnpm typecheck`. This checkbox (and every
  item depending on M2.2) is satisfied only after the human merges the
  proposal PR.
  **Demo:** The org's build protocol is versioned, diffable code.
  **Read:** docs/loop.md §4 (sketch + pass protocol requirements), §2 rule 2.
  **Session:** opus, single session — the templates encode the protocol;
  wording quality matters.

- [x] **M2.3 Brief assembler** ✅ 2026-07-05 —
  src/loop/brief.ts: assembleBrief/estimateTokens; §3 section order
  [ticket][spec][contract][findings][history][memory][repo]; reductions in
  fixed order (resolved findings oldest-first → attempts latest-exempt →
  spec heading-match excerpting), re-measured per step; ticket/criteria/
  gate output never summarized even when the budget can't be met. 8 named
  cases incl. byte-identical reproducibility.
  **Goal:** `src/loop/brief.ts`: deterministic, token-budgeted brief
  assembly — [ticket][spec excerpts][contract][findings][history][memory]
  [repo conventions]; len/4 token estimate; over budget, summarize
  oldest-resolved material first; ticket + acceptance criteria never
  summarized; byte-identical output for identical inputs.
  **Files:** src/loop/brief.ts, test/loop/brief.test.ts,
  test/fixtures/briefs/**
  **Deps:** —
  **Accept:** named cases: ticket+criteria verbatim at any budget; spec
  excerpted by heading match when over budget; oldest resolved findings
  summarized first, active verbatim; criteria intact under a 200-token
  budget; reproducible byte-identical output; `pnpm test && pnpm typecheck`.
  **Demo:** "Feature doc + relevant PRD + learnings" is now a function.
  **Read:** docs/loop.md §3.
  **Session:** sonnet, single session.

- [x] **M2.4 Runlog foundation: runId, paths, redaction, fixture** ✅ 2026-07-05 —
  src/runtime/runlog/{paths,redact}.ts + src/runtime/secret-patterns.ts
  (stateless patterns + asGlobal(); PEM redaction swallows to end-of-text
  when END marker missing — fail closed on truncated blocks); orgHome
  fixture runs.records builds full run dirs through the REAL runPaths
  builder. mintRunId takes the clock as a param (FakeClock-compatible);
  id parts sanitized path-safe.
  **Goal:** `src/runtime/runlog/paths.ts` (mintRunId
  `YYYYMMDD-HHMMSS-<pipeline>-<pass>`, path builders for
  `runs/<app>/<runId>/{envelope.json,events.jsonl,brief.md,output.md,session.log}`)
  and `redact.ts` (truncatePreview ~120 chars, deterministic hashArgs,
  scrubSecrets) — the secret regex families themselves exported from a new
  `src/runtime/secret-patterns.ts`, the single canonical list the qgates
  security scan (M4.4) also imports — plus the runs/ sub-builder hook in
  M0.3's fixture.
  **Files:** src/runtime/runlog/paths.ts, src/runtime/runlog/redact.ts,
  src/runtime/secret-patterns.ts, test/runlog-paths.test.ts,
  test/runlog-redact.test.ts, test/fixtures/orgHome.ts (extend)
  **Deps:** M0.3
  **Accept:** runId format regex; same-ms different-pass ids differ and
  sort chronologically; scrubSecrets redacts sk-/ghp_/AWS/PEM patterns,
  leaves normal text; hashArgs deterministic; `pnpm test && pnpm typecheck`.
  **Demo:** The on-disk observability contract exists and is testable.
  **Read:** docs/loop.md §9; docs/architecture.md §1.
  **Session:** sonnet, single session.

- [x] **M2.5 L1 envelope writer + reader** ✅ 2026-07-05 —
  src/runtime/runlog/envelope.ts: startRun/updateEnvelope/finalizeRun/
  readEnvelope; previews + verdict summary always scrubbed & truncated;
  refs-only to L3 (raw-JSON test proves no inlining); update/finalize on a
  terminal envelope throws loudly; tmp+rename writes; telemetry.ts
  untouched. 6 named cases.
  **Goal:** `envelope.json` lifecycle: startRun (ids, status running),
  updateEnvelope (token/cost rollups, tool counts, gate results, redacted
  previews), finalizeRun (terminal status, verdict summary, REFERENCES to
  L3 files — never inlined content), readEnvelope. **telemetry.ts stays**
  (standing decision): envelopes are per-pass; per-turn cost still flows
  through recordTurn.
  **Files:** src/runtime/runlog/envelope.ts, test/runlog-envelope.test.ts
  **Deps:** M2.4
  **Accept:** named cases: startRun writes running envelope; update merges
  without clobbering; finalize references L3 paths and never inlines
  brief/session content; readEnvelope round-trips typed fields; previews
  >120 chars truncated via redact; `pnpm test && pnpm typecheck`;
  src/runtime/telemetry.ts unmodified.
  **Demo:** Every pass can leave a machine-readable envelope.
  **Read:** docs/loop.md §9; the standing telemetry decision above.
  **Session:** sonnet, single session.

- [x] **M2.6 L2 structured events writer + reader** ✅ 2026-07-05 —
  src/runtime/runlog/events.ts: createEventWriter (identity + correlation
  ids stamped on every line; injected clock; detail strings scrubbed;
  toolCalled() API makes raw args unrepresentable — hash only),
  readEvents (torn trailing append dropped, mid-file corruption throws),
  reconstructSpanTree (subagent spans nest via parent_span_id). 6 named
  cases incl. infra-vs-merit code separation.
  **Goal:** Append-only `events.jsonl`: taxonomy events
  (run/pass/gate/tool/subagent/ticket.transition/verdict/escalation) with
  trace_id=turnId, span_id=pass, parent_span_id for subagent fan-out, plus
  app/ticket/pipeline/pass/role/model, timestamp, severity, machine
  error_code; every string field through redact; `tool.called` records
  name/duration/success only. Reader streams typed records +
  `reconstructSpanTree`. Infra vs merit outcomes carry distinct codes.
  **Files:** src/runtime/runlog/events.ts, test/runlog-events.test.ts
  **Deps:** M2.4
  **Accept:** named cases: one JSON line per event with correlation ids;
  tool.called never contains raw args; span tree nests subagent under
  parent; malformed trailing line tolerated (partial-write resilience);
  `pnpm test && pnpm typecheck`.
  **Demo:** Subagent fan-out trees reconstruct without opening transcripts.
  **Read:** docs/loop.md §9 (taxonomy, correlation ids, infra-vs-merit).
  **Session:** sonnet, single session.

- [x] **M2.7 L3 forensics writers + retention pruning** ✅ 2026-07-05 —
  forensics.ts (writeBrief/writeOutput verbatim + unredacted by design;
  createSessionLogSink for TurnHooks.onEvent), retention.ts (pruneRuns:
  deletes only provably finalized+old dirs — running kept at any age,
  missing/unreadable envelope kept fail-safe), src/cli/prune-runs.ts
  (`operon prune-runs [root] [--retention-days N]`). CLI case drives the
  real entrypoint against a fixture tree.
  **Goal:** writeBrief/writeOutput (verbatim, local-only, unredacted) +
  appendSessionLog sink for TurnHooks.onEvent; `pruneRuns()` deletes
  finalized run dirs older than `session_retention_days` (never unfinished
  ones), exposed as `operon prune-runs [--retention-days N]`.
  **Files:** src/runtime/runlog/forensics.ts, src/runtime/runlog/retention.ts,
  src/cli/prune-runs.ts, test/runlog-retention.test.ts
  **Deps:** M2.4, M2.5, M0.1
  **Accept:** prune deletes old finalized run, keeps fresh run, keeps
  running-status run regardless of age; `pnpm dev prune-runs
  --retention-days 0` against a fixture deletes only the old finalized one
  and prints the count; `pnpm test && pnpm typecheck`.
  **Demo:** Forensics exist for every pass and clean themselves up.
  **Read:** docs/loop.md §9 (L3, retention); docs/architecture.md §2.
  **Session:** sonnet, single session.

- [x] **M2.8 Pass executor (`src/loop/pipeline.ts`) — writes run logs** ✅ 2026-07-05 —
  executePipeline: fresh session per pass (req.session never set); task =
  brief + template (same composition the M2.2 live smoke used); per-pass
  model/effort overrides copy the RoleConfig and cannot touch `runtime`
  (cross-provider unrepresentable); parallel stages via Promise.all;
  gate propagates by identity; non-completed pass aborts later stages.
  Every pass writes envelope+events+brief+output+session.log — 8 named
  cases incl. concurrency proof and complete-run-record assertion.
  **Goal:** Execute a loaded pipeline against a Runtime: fresh session per
  pass; brief → `req.task`; per-pass model/effort overrides without
  mutating the base RoleConfig; skip_on_tier/only_on filtering;
  same-`parallel_group` passes run concurrently with disjoint outputs;
  hooks propagate unchanged. **Every pass writes its run record**: envelope
  opened/finalized (M2.5), onEvent → events.jsonl (M2.6), brief/output
  verbatim (M2.7) — closing the "library nobody calls" gap.
  **Files:** src/loop/pipeline.ts, test/loop/pipeline.test.ts
  **Deps:** M0.2, M2.1, M2.3, M2.5, M2.6, M2.7
  **Accept:** named cases: single-pass pipeline calls runTurn once with no
  session field; sequential passes in order; parallel_group pair runs
  concurrently; skip_on_tier omits contract on quick; override doesn't
  mutate base config; gate propagated to every call; after one executed
  fixture pipeline, envelope.json/events.jsonl/brief.md/output.md exist in
  the fixture run dir with matching runIds; `pnpm test && pnpm typecheck`.
  **Demo:** A pipeline of passes executes deterministically against
  FakeRuntime and leaves a complete run record.
  **Read:** docs/loop.md §2, §4, §9, §10.
  **Session:** opus lead + delegated test-writer subagent — cross-cutting
  integration of five prior pieces.

- [x] **M2.9 `run-role` CLI with `--dry-run`** ✅ 2026-07-05 —
  src/loop/runRole.ts fixes the dispatcher spawn contract (role/app/turn/
  template/dry-run); dry-run assembles+prints the brief with zero Runtime
  construction; live path goes through the M2.8 executor (full run record,
  defaultGate applied when no hooks given — manual turns are gated too).
  CLI wires --dry-run; live CLI runs deliberately deferred to the
  dispatcher wiring (M7.8/M7.9 call the loop function directly).
  **M2 milestone demo met:** `pnpm dev run-role planner --dry-run` prints
  a real assembled brief token-free; every executed pass leaves L1/L2/L3.
  **Goal:** `operon run-role <role> [--app <app>] [--turn <id>]
  [--template <path>] [--dry-run]` — a plain role turn as a synthesized
  one-pass pipeline. `--dry-run` prints the assembled brief, constructs no
  Runtime. The `--app/--turn` flags are accepted and passed through now
  (telemetry recording of them arrives with M3.2/M7.9) because the M7.8
  dispatcher spawns exactly this signature — the contract is fixed here
  once.
  **Files:** src/cli/run-role.ts, src/loop/runRole.ts, test/loop/runRole.test.ts
  **Deps:** M2.8, M0.1
  **Accept:** `pnpm dev run-role planner --dry-run` prints the brief, exit
  0; named cases: dry-run never calls FakeRuntime (call count 0);
  non-dry-run calls it exactly once with the brief in task; unknown role →
  non-zero exit + clear message; `pnpm test && pnpm typecheck`.
  **Demo:** First CLI path through briefs + executor, token-free.
  **Read:** docs/loop.md §2, §3; docs/architecture.md §2 (dispatcher spawn
  contract).
  **Session:** sonnet, single session.

### M3 — App registry, bootstrap, sandbox apps onboarded *(civic pilot ON HOLD)*
*Milestone demo: `operon plan <app> --topic …` opens a real Planner
co-planning session against an onboarded app repo and the drafted spec
lands under its `.operon/planning/` (architecture §8 decides co-planning
is the mechanism).*

> **Civic on hold (decided 2026-07-05):** onboarding the real civic app
> (old M3.7) waits until the product is ready end to end. The two real
> sandbox apps stand in for every functional test until then:
> `operon-sandbox-alpha` (bikramgupta/operon-sandbox-alpha; node:test +
> lint + CI + AGENTS.md — also the M5 loop sandbox) and
> `operon-sandbox-beta` (bikramgupta/operon-sandbox-beta; deliberately no
> CI/AGENTS.md, exercises scan-detection absence and the M3.5 second-app
> join). M3.3–M3.6 run their acceptance against these repos; civic's
> pilot acceptance re-enters as the final pre-launch milestone.

- [x] **M3.1 App registry loader (`apps.yaml`) + `operon apps` CLI** ✅ 2026-07-06 —
  `src/org/apps.ts` loads the schema + resolveTriggers semantics;
  `operon apps` prints the root registry. Root apps.yaml now carries the
  Operon placeholder plus sandbox alpha/beta.
  **Goal:** `src/org/apps.ts`: schema (org{name,max_concurrent_turns},
  defaults{budget_usd_month}, apps{repo,status live|paused|onboarding,
  budget_usd_month, cadence}) mirroring roles.ts patterns;
  `resolveTriggers(role, appEntry)` — cadence override *replaces* the
  role's roles.yaml triggers when present; empty list disables the role.
  Root `apps.yaml` created fresh (self-referential placeholder entry) — a
  new human-ratified surface, so it lands via proposal PR.
  **Files:** src/org/apps.ts, apps.yaml, test/apps.test.ts, src/cli/apps.ts
  **Deps:** M0.1, M0.5 (gate already covers apps.yaml)
  **Accept:** named cases: valid file parses; unknown status rejected;
  missing apps mapping rejected; resolveTriggers falls back / disables on
  empty / replaces-not-merges; on the PR branch `pnpm dev apps` prints the
  APP/REPO/STATUS/BUDGET table and `pnpm test && pnpm typecheck` pass;
  satisfied only after the human merges.
  **Demo:** Multi-app config is machine-checked from day one.
  **Read:** docs/architecture.md §7; docs/PURPOSE.md → multi-app + one-turn-one-app.
  **Session:** sonnet, single session.

- [x] **M3.2 Manual trigger kind + per-app/trigger telemetry fields** ✅ 2026-07-06 —
  `Trigger.manual`, app/trigger telemetry attribution, and back-compatible
  JSONL records are pinned in tests; roles/apps loaders accept manual
  triggers.
  **Goal:** `Trigger` gains optional `manual` (dispatcher must never
  auto-fire it — M7.8 encodes that); `TurnRecord` gains optional `app` and
  `trigger` fields (back-compat) so co-planning and dispatched turns roll
  up per app. This is the single owner of the telemetry-field change —
  M7.12 consumes it, never re-adds it.
  **Files:** src/runtime/types.ts, src/runtime/telemetry.ts, test/telemetry.test.ts
  **Deps:** —
  **Accept:** named cases: toRecord omits app/trigger when absent
  (back-compat); sets trigger:"manual"+app when passed; recordTurn line
  contains both fields (temp dir); existing suites green; `pnpm typecheck`.
  **Demo:** Manual turns are distinguishable and app-attributable.
  **Read:** docs/architecture.md §7 (budget), §8 (manual trigger).
  **Session:** sonnet, single session.

- [x] **M3.3 `operon bootstrap` — repo scan + org-template emission** ✅ 2026-07-06 —
  scan detects manifests/CI/agent docs/deploy hints/remotes; single-app
  org templates emit from root TASTE.md/roles.yaml plus an apps.yaml stub.
  **Goal:** The non-interactive half: `scanRepo()` (language/build/test
  commands from manifests+CI, agent docs, Dockerfile/deploy hints) and
  `emitOrgTemplates()` — single-app profile `.operon/org/{TASTE.md,
  roles.yaml, apps.yaml}` templated from this repo's root files (the
  PURPOSE v0.8 dogfood note made real), apps.yaml stub carrying
  `schema_version`.
  **Files:** src/org/bootstrap.ts, src/cli/bootstrap.ts, test/bootstrap.test.ts
  **Deps:** M3.1, M0.1
  **Accept:** named cases: scan detects package.json+CI+AGENTS.md in a
  fixture; reports absence cleanly; emitted org TASTE.md/roles.yaml
  byte-identical to root; emitted apps.yaml parses via loadApps and carries
  schema_version; `pnpm dev bootstrap --scan-only <fixture>` prints the
  profile and would-create list without writing; `pnpm test && pnpm typecheck`.
  **Demo:** Bootstrap can learn a repo and emit a valid org skeleton.
  **Read:** docs/architecture.md §9 (steps 1,3), §1 (.operon/org/ sublayout);
  docs/PURPOSE.md → Bootstrap & artifact home.
  **Session:** sonnet, single session.

- [x] **M3.4 `operon bootstrap` — questionnaire + app charter/config emission** ✅ 2026-07-06 —
  answers emit app charter, config, policy.yaml (from M4.2 template when
  available), and per-role memory indexes; config round-trips through
  loadApps.
  **Goal:** Given scan results + an answers object (interactive in real
  use, injectable via `--answers answers.json` for tests/scripting), emit
  `.operon/TASTE.md` (product charter), `.operon/config.yaml`
  (apps.yaml-schema entry: schema_version, budget, cadence, app-specific
  critical-op extensions, channels), and seeded
  `.operon/memory/<role>/INDEX.md` per enabled role.
  **Files:** src/org/bootstrap.ts, src/cli/bootstrap.ts,
  test/bootstrap-questionnaire.test.ts
  **Deps:** M3.3
  **Accept:** named cases: charter renders answers; config.yaml embeds
  schema_version/budget/default-empty cadence; critical-op extensions
  included; one INDEX.md per enabled role; full bootstrapRun writes the
  tree to a fixture and config.yaml round-trips through the apps parser;
  `pnpm dev bootstrap <fixture> --answers answers.json` creates the tree
  (ls/cat observable); `pnpm test && pnpm typecheck`.
  **Demo:** `operon bootstrap` produces a complete, reviewable `.operon/`.
  **Read:** docs/architecture.md §9 (steps 2–3), §1; docs/PURPOSE.md → TASTE
  layers.
  **Session:** opus, single session — questionnaire content shape has real
  design ambiguity.

- [x] **M3.5 `operon bootstrap` — detect and join an existing org** ✅ 2026-07-06 —
  `findExistingOrg` supports `--org-home`/OPERON_HOME/pointer files;
  `joinExistingOrg` appends without rewriting existing app entries and
  rejects duplicate repo slugs; CLI prints `joined existing org at ...`.
  **Goal:** Register/join: find an existing org home (pointer file /
  OPERON_HOME), append the new app to its apps.yaml as
  `status: onboarding` via a merge-not-overwrite helper; reject duplicate
  repo slugs; never fork a parallel org.
  **Files:** src/org/apps.ts, src/org/bootstrap.ts, test/bootstrap-register.test.ts
  **Deps:** M3.4
  **Accept:** named cases: findExistingOrg present/absent; joinExistingOrg
  appends without altering existing entries (byte-compare the untouched
  entry); duplicate slug throws; `pnpm dev bootstrap <fixture> --org-home
  <tmp>` prints "joined existing org at …"; `pnpm test && pnpm typecheck`.
  **Demo:** Second-app bootstrap joins, never forks.
  **Read:** docs/architecture.md §9 step 4, §1 (graduation).
  **Session:** sonnet, single session.

- [x] **M3.6 `operon plan <app>` — co-planning session launcher** ✅ 2026-07-06 —
  `assembleMinimalContext()` concatenates org/app TASTE layers, `operon
  plan` builds a Claude `--append-system-prompt` invocation, dry-run creates
  and cleans an `op/plan-<slug>` worktree, and live runs record manual
  telemetry under `.org`.
  **Goal:** The manual, interactive invocation shape (architecture §8):
  `operon plan <app> [--topic <string>] [--dry-run] [--workdir <path>]` —
  resolve app via apps.ts; create a throwaway worktree on main
  (`--workdir` stand-in until org-managed clones land in M7.9); assemble
  minimal context via a function named exactly `assembleMinimalContext()`
  (org TASTE.md + app `.operon/TASTE.md` when present; the topic string
  becomes the session's opening task line); spawn interactive `claude`
  with `--append-system-prompt`; record telemetry `trigger:"manual"`.
  Full 5-layer assembly replaces `assembleMinimalContext` in M9.3.
  In-terminal approvals during co-planning are NOT yet audit-logged — an
  explicit deferral until the approval store exists (M7.1); noted so
  architecture §8's audit-trail line is a deliberate gap, not a missed one.
  **Files:** src/org/plan.ts, src/cli/plan.ts, test/plan.test.ts
  **Deps:** M3.1, M3.2, M0.1
  **Accept:** named cases: context concatenation with/without app charter;
  buildClaudeInvocation argv includes --append-system-prompt + worktree
  cwd; throwaway worktree created on op/plan-<slug> off main in a temp git
  fixture and cleaned up; `pnpm dev plan operon-sandbox-alpha --topic
  "stats percentile helper" --dry-run --workdir <tmp>` prints app, branch,
  topic, and context byte size without spawning; `pnpm test && pnpm
  typecheck`. (App name follows apps.yaml — civic on hold, M3 header note.)
  **Demo:** One command gives the human a Planner-primed live session.
  **Read:** docs/architecture.md §8, §5 (layers [1],[3] only here).
  **Session:** opus, single session — worktree lifecycle + interactive
  handover.

- [x] **M3.7 Onboard the sandbox apps as apps #1/#2 (functional acceptance)** ✅ 2026-07-06 —
  `operon-sandbox-alpha` and `operon-sandbox-beta` were bootstrapped with
  app-owned `.operon/TASTE.md`, `.operon/config.yaml`, `.operon/policy.yaml`
  (byte-identical to `docs/policy.yaml.template`), and memory indexes.
  Root apps.yaml registers alpha as `live` and beta as `onboarding`;
  `operon plan operon-sandbox-alpha --topic "stats percentile helper"
  --dry-run --workdir ~/Build/operon-sandbox-alpha` printed app/branch/topic
  and context bytes without spawning Claude.
  ⏸ **Civic version ON HOLD (2026-07-05, human decision):** the original
  item — onboard civic + draft the US-states spec with the human — is
  deferred until the entire product is ready; it re-enters as the
  pre-launch pilot acceptance (see M6.3 note and the M3 header note).
  Until then this item means: `operon bootstrap` inside
  `~/Build/operon-sandbox-alpha` (scan finds CI+AGENTS.md) and
  `~/Build/operon-sandbox-beta` (scan handles their absence; beta joins
  the existing org via M3.5), both registered in root apps.yaml, and one
  `operon plan operon-sandbox-alpha --topic …` co-planning smoke run.
  Beta's join also carries old M11.1's config-not-fork acceptance:
  `git -C ~/Build/Operon diff --stat` shows apps.yaml as the ONLY
  Operon-repo change for the second app (second app = config file, never
  code). Doable without the human present except apps.yaml ratification.
  **Original goal (deferred):** Run the real thing: `operon bootstrap` inside
  `~/Build/Government/AgentSkill-CivicIntelligence` (answers reviewed with
  the human), register civic `status: live` in root apps.yaml, then run
  `operon plan civic --topic "US-states extension"` with the human — the
  session's artifact is the spec under civic's `.operon/planning/`. This
  is PURPOSE v0.8's first pilot acceptance test executed for real.
  **Files:** apps.yaml; (in the civic repo:) .operon/**
  **Deps:** M3.4, M3.5, M3.6
  **Accept (sandbox substitute while civic is on hold):** `pnpm dev apps`
  shows `operon-sandbox-alpha` STATUS=live and `operon-sandbox-beta`
  STATUS=onboarding; `find ~/Build/operon-sandbox-{alpha,beta}/.operon`
  shows TASTE.md, config.yaml, policy.yaml, and memory/; both policy files
  byte-match `docs/policy.yaml.template`; the plan dry-run prints app,
  branch, topic, and context byte size without spawning; existing test
  suites stay green. The deferred civic acceptance remains below for the
  pre-launch milestone.
  **Demo:** The org has real app entries for both sandbox repos, app-owned
  bootstrap output in each repo, and a Planner co-planning command that can
  prime a live session against alpha.
  **Read:** docs/PURPOSE.md → Validation and launch path; docs/architecture.md §8
  (co-planning mode).
  **Session:** sonnet, single session + the human present for the
  questionnaire and co-planning (irreducibly interactive).

### M4 — Quality gates + typed verdicts *(parallel track; only M4.4 needs M2.4)*
*Milestone demo: `runGates("high", repo, …)` runs
tests+lint+security+completeness+freshness in order against a real temp
repo and returns per-gate detail — the full mechanical layer, no adapter,
no LLM.*

> **Completed 2026-07-06:** M4 landed as the quality-gate/verdict layer.
> Offline proof: `pnpm test && pnpm typecheck`. Functional proof against
> real sandbox apps: alpha passed high-tier
> tests+lint+security+completeness+freshness; beta passed low-tier without a
> lint command and failed medium-tier with the intended missing-lint message.
> `operon-sandbox-gamma` is approved as a later third test app for
> SRE/Support/Marketing surface coverage; it is not an M4 dependency.

- [x] **M4.1 Local git-repo test fixtures (working repo + bare/clone pair)** ✅ 2026-07-06
  **Goal:** One module, two constructors sharing commit helpers:
  `makeWorkingRepo({testCommand, lintCommand})` (init + package.json with
  configurable scripts; write/commit files; changedFiles between refs) for
  qgates, and `makeBareWithClone()` (bare origin + working clone) for real
  push/squash-merge/branch-delete semantics in M5. Pure child_process git —
  no new dependency.
  **Files:** test/fixtures/gitRepo.ts, test/fixtures/gitRepo.test.ts
  **Deps:** —
  **Accept:** named cases: clean init; commit visible in log; changedFiles
  correct between two commits; bare/clone pair supports push + merge into
  origin main observable via `git log`; cleanup removes both; `pnpm test
  && pnpm typecheck`.
  **Demo:** Real-git tests with zero network.
  **Read:** docs/loop.md §5 (gates run against a real worktree);
  docs/architecture.md §3 (idempotency rule 1).
  **Session:** sonnet, single session.

- [x] **M4.2 policy.yaml schema, template, tier resolution** ✅ 2026-07-06
  **Goal:** `src/loop/policy.ts`: typed `.operon/policy.yaml` (risk-tier
  globs → gate sets; dimension_globs for review dimensions;
  remediation.max_attempts) + predecessor-mirroring default template
  (high: tests+lint+security+completeness; medium drops security; low:
  tests+completeness); `resolveTier(policy, changedFiles)` — highest tier
  wins, unmatched → medium; `gatesForTier`.
  **Files:** src/loop/policy.ts, docs/policy.yaml.template, test/policy.test.ts
  **Deps:** —
  **Accept:** named cases: unmatched→medium; highest wins; gate sets per
  tier match the mirrored defaults; malformed file throws clearly; template
  parses as valid YAML (node -e yaml.parse check); `pnpm test && pnpm
  typecheck`.
  **Demo:** Risk tiering is a pure, provable function.
  **Read:** docs/loop.md §5 (table + defaults), §4 (tiering axes).
  **Session:** sonnet, single session.

- [x] **M4.3 qgates: process gates (tests, lint, e2e)** ✅ 2026-07-06
  **Goal:** Subprocess gates: run configured test/lint/e2e commands in the
  worktree; capture exit code + bounded output tail on failure; timeout
  with a timeout-specific message; e2e *skipped* (not failed) when
  unconfigured. Typed `GateResult` per gate.
  **Files:** src/loop/qgates.ts, test/qgates.test.ts
  **Deps:** M4.1
  **Accept:** named cases: pass on exit 0; fail captures tail; timeout
  message distinct; lint analogous; e2e skipped when unconfigured; `pnpm
  test && pnpm typecheck`.
  **Demo:** `runTestsGate(repo)` mechanically catches a failing suite.
  **Read:** docs/loop.md §5 (rows), §10 (qgates is pure subprocess+git).
  **Session:** sonnet, single session.

- [x] **M4.4 qgates: security regex scan** ✅ 2026-07-06
  **Goal:** Scan changed files (via git diff) for the §5 secret families
  (sk-…, ghp_…, AWS keys, PEM blocks, generic key/token/password
  assignments), skipping binaries; GateResult lists file:line matches.
  The pattern list is imported from `src/runtime/secret-patterns.ts`
  (owned by M2.4, per the standing decision) — never a second definition.
  **Files:** src/loop/qgates.ts, test/qgates.security.test.ts
  **Deps:** M4.1, M4.3 (same-file sequencing), M2.4 (canonical secret
  patterns — the one M4 dependency outside the parallel track)
  **Accept:** named cases: flags each secret family; binary skipped even
  with matching bytes; clean diff passes; `grep -n secret-patterns
  src/loop/qgates.ts` shows the import and qgates.ts defines no second
  regex list (`grep -c "BEGIN PRIVATE KEY" src/loop/qgates.ts` → 0);
  `pnpm test && pnpm typecheck`.
  **Demo:** A committed AWS key fails the gate with file:line.
  **Read:** docs/loop.md §5 (security row).
  **Session:** sonnet, single session.

- [x] **M4.5 qgates: completeness + review-freshness + tier orchestrator** ✅ 2026-07-06
  **Goal:** Data gates: completeness (every acceptance criterion checked
  off, no unresolved findings, AND every criterion mapped to a named test —
  the contract pass's criterion→test mapping is an input; an unmapped
  criterion fails, not warns, per loop.md §5) and review-freshness (branch
  HEAD == APPROVE commit_id; always runs regardless of tier) over plain
  inputs — no live GitHub. Then `runGates(tier, worktree, criteria, findings, reviewState)`
  selecting the gate set via gatesForTier, running in order, returning
  aggregate + per-gate detail and respecting remediation.max_attempts as a
  counter contract (persistence is the caller's job).
  **Files:** src/loop/qgates.ts, test/qgates.orchestrator.test.ts
  **Deps:** M4.2, M4.3, M4.4
  **Accept:** named cases: unchecked criterion fails; unresolved finding
  fails; criterion with no covering test in the contract mapping fails;
  stale approval fails freshness; freshness runs even at low tier;
  medium tier skips security per defaults; attempt counter stops at
  max_attempts; `pnpm test && pnpm typecheck`.
  **Demo:** The complete §5 mechanical layer runs standalone.
  **Read:** docs/loop.md §5 (incl. acceptance-criteria contract).
  **Session:** sonnet, single session.

- [x] **M4.6 verdicts.ts: typed verdicts + lenient parser + reformat retry** ✅ 2026-07-06
  **Goal:** ContractVerdict/BuildVerdict/ReviewVerdict/Finding types
  (docs/loop.md §6 sketch); lenient line-grammar parser
  (`- category/severity file:line -- description -> action`; three status
  formats; unicode or ASCII delimiters); `parseWithRetry(kind, text,
  reformat)` — one caller-supplied reformat, then loud typed failure. Also
  export self-describing JSON-schema shapes for each verdict kind —
  adapters with native structured output (M1.4) consume them when loop
  passes request typed verdicts; that reconciliation is verified in M6.2,
  not assumed here.
  **Files:** src/loop/verdicts.ts, test/verdicts.test.ts
  **Deps:** —
  **Accept:** named cases: ASCII + unicode delimiter parses; all three
  status formats; parse failure returns typed marker (no throw);
  parseWithRetry retries exactly once then fails loudly; exported schemas
  validate a sample of each verdict type; `pnpm test && pnpm typecheck`.
  **Demo:** Scrappy agent markdown becomes typed Finding[] — no
  prose-driven control flow.
  **Read:** docs/loop.md §6, §10.
  **Session:** sonnet, single session.

### M5 — Loop v1: one ticket flows ready→merged on a sandbox repo
*Milestone demo: `GH_SANDBOX_REPO=… pnpm e2e:sandbox` takes one seeded
ticket in a disposable private GitHub repo from `op:ready` through claim →
real gates → review → ship to squash-merged and closed. (Note: TODO's old
item 3 was stale — buildstacks-dev/Operon already exists; what the loop
needs is this sandbox.)*

> **Completed 2026-07-06:** M5 landed the provider-blind `GhOps` layer,
> offline `FakeGhOps`+real-git harness, loop phase functions, scheduler,
> `operon loop`, and disposable GitHub sandbox e2e. Verification:
> `pnpm test` (36 files / 353 tests), `pnpm typecheck`, `pnpm build`,
> two successful `GH_SANDBOX_REPO=bikramgupta/operon-m5-sandbox pnpm
> e2e:sandbox:setup` runs, and `GH_SANDBOX_REPO=bikramgupta/operon-m5-sandbox
> pnpm e2e:sandbox` → `RESULT: merged #10`; `gh issue view 10` showed
> `state: CLOSED` and PR #11 was merged. Alpha functional check:
> `npm test && npm run lint`; beta: `npm test`; `operon loop --dry-run`
> against both found no ready tickets. Gamma was not present locally.

- [x] **M5.1 GitHub ops module (`github.ts`)** ✅ 2026-07-06 —
  `src/loop/github.ts` exposes `GhOps`, `GhCliOps`, loud `GhOpsError`,
  JSON parsing, PR/review/label/comment/merge/branch operations; tests pin
  exact `gh` argv and stderr behavior.
  **Goal:** Provider-blind `GhOps` interface + `GhCliOps` over the `gh` CLI
  (injectable exec for tests, no new npm dependency): label add/remove/
  atomic swap, issue comments, PR create/read/list-by-branch, review
  create/read, squash-merge, branch delete. Every call succeeds or throws
  loud `GhOpsError` with stderr — no silent best-effort (loop.md §1 drop).
  **Files:** src/loop/github.ts, test/github.test.ts
  **Deps:** —
  **Accept:** fake-exec cases: swapLabel is one atomic add+remove call;
  createPR/squashMerge/listPRsForBranch parse --json outputs; non-zero exit
  throws GhOpsError carrying stderr verbatim; `pnpm test && pnpm typecheck`.
  **Demo:** Exact gh argv proven for claim, PR, and merge without a repo.
  **Read:** docs/architecture.md §3 (idempotency), §10 (conventions);
  AGENTS.md (dependency discipline).
  **Session:** sonnet, single session.

- [x] **M5.2 FakeGhOps + sandbox harness** ✅ 2026-07-06 —
  `test/support/fakeGhOps.ts` models label preconditions, issue/PR/review
  state, and real local squash-merge/branch-delete via M4.1's bare/clone
  fixture.
  **Goal:** In-memory `FakeGhOps` (real label-state + PR/review
  bookkeeping, atomic-swap precondition semantics, call log) paired with
  M4.1's bare/clone fixture so squash-merge and branch-delete run real git
  locally. Every loop phase test runs offline through this.
  **Files:** test/support/fakeGhOps.ts, test/support/fakeGhOps.test.ts
  **Deps:** M5.1, M4.1
  **Accept:** named cases: label swap fails when precondition label absent;
  listPRsForBranch reflects created PR; squashMerge performs a real merge
  into fixture main (git log verifiable); deleteBranch removes the ref;
  `pnpm test && pnpm typecheck`.
  **Demo:** A faithful offline GitHub for the whole state machine.
  **Read:** docs/architecture.md §3; docs/loop.md §7.
  **Session:** sonnet, single session.

- [x] **M5.3 LoopItem/LoopPhase rewrite + claim phase** ✅ 2026-07-06 —
  `LoopPhase` now covers ready/building/gates/reviewing/shipping/merged/
  returned/blocked; claim does the atomic ready→building label swap then
  creates `op/<issue>-<slug>` and a worktree.
  **Goal:** Rewrite src/loop/loop.ts's data model per loop.md §10:
  LoopPhase = ready|building|gates|reviewing|shipping|merged|returned|
  blocked; LoopItem gains tier (parsed from the ticket's
  `op:tier-quick|standard|deep` label, default standard — loop.md §4),
  remediationAttempts, gateResults.
  `claimTicket()`: atomic `op:ready→op:building` swap, then branch
  `op/<issue>-<slug>` + worktree — ordering per architecture §3
  (claims are label flips; artifact-before-label for later states).
  **Files:** src/loop/loop.ts, src/loop/types.ts, test/loop.test.ts
  **Deps:** M5.2
  **Accept:** named cases: claim swaps label and creates branch; concurrent
  second claim rejected by precondition; ordering asserted via FakeGhOps
  call log; tier parses from an op:tier-quick label and defaults to
  standard when absent; `pnpm test && pnpm typecheck`.
  **Demo:** A ticket is claimed exactly once, atomically.
  **Read:** docs/loop.md §7, §10; docs/architecture.md §3.
  **Session:** sonnet, single session.

- [x] **M5.4 Gates phase + remediation cycle (real qgates wired)** ✅ 2026-07-06 —
  `advanceGates()` calls real `runGates`, supports bounded remediation,
  returns exhausted tickets with blocked-with-evidence comments, and opens
  PRs only after green gates.
  **Goal:** building→gates transition wired **directly to M4.5's
  `runGates`** (no throwaway fake boundary — M4 is done on this track):
  gate failure → bounded remediation (≤ policy max_attempts, gate output
  destined for the fix brief); exhaustion is an engineering dead-end →
  `op:returned` with the structured blocked-with-evidence comment (error
  verbatim / attempted fix / result / assessment — loop.md §7) for the
  Planner's groom to consume; `op:blocked` is reserved for approval-queue
  waits (blocked_on_gate, raised in M7.9). Green → push, open PR
  (`Closes #N`), `op:in-review` — artifact before label.
  **Files:** src/loop/loop.ts, test/loop-gates.test.ts
  **Deps:** M5.3, M4.5
  **Accept:** named cases: fail-fail-pass → reviewing with
  remediationAttempts=2; exhaustion → op:returned + a blocked-with-evidence
  comment containing the verbatim gate output; green → push +
  PR with Closes #N + op:in-review (FakeGhOps log order proves
  artifact-before-label); uses a real tiny policy fixture + real
  runGates against the git fixture; `pnpm test && pnpm typecheck`.
  **Demo:** Broken code cannot reach review; the reviewer's tokens are
  spent only on mechanically-green work.
  **Read:** docs/loop.md §5 (where gates run), §7, §13 #9.
  **Session:** sonnet, single session.

- [x] **M5.5 Reviewing phase — verdict-parsed findings, cycles, freshness** ✅ 2026-07-06 —
  `advanceReviewing()` parses `REQUEST_CHANGES` bodies through
  `parseVerdict("review", ...)`, enforces review-cycle cap, and advances
  only fresh approvals whose commit id matches branch HEAD.
  **Goal:** Read review state via GhOps; the structured findings comment is
  parsed through **M4.6's `parseVerdict("review", …)`** into Finding[]
  (wiring the parser into the loop — no raw-prose handling);
  REQUEST_CHANGES → cycles++ → back through fix/gates; cycles > 3 →
  `op:returned` with findings preserved; APPROVE honored only when its
  commit_id == branch HEAD (GitHub-native freshness).
  **Files:** src/loop/loop.ts, test/loop-review.test.ts
  **Deps:** M5.4, M4.6
  **Accept:** named cases: findings comment parses to typed Finding[]
  attached to the item; REQUEST_CHANGES increments cycles and routes to
  fix; cycle 4 → returned + op:returned; stale APPROVE (HEAD moved) keeps
  reviewing; fresh APPROVE → shipping; `pnpm test && pnpm typecheck`.
  **Demo:** A stale approval provably cannot ship.
  **Read:** docs/loop.md §1 (freshness), §6, §7, §13 #10.
  **Session:** sonnet, single session.

- [x] **M5.6 Shipping phase, squash-merge, conflict path** ✅ 2026-07-06 —
  `advanceShipping()` runs gates twice, squash-merges through `GhOps`,
  deletes the branch, removes the worktree, removes the transient
  `op:in-review` label after merge, returns scorecard events, and handles
  merge conflicts by returning to building with a rebase note.
  **Goal:** shipping: gates run TWICE at ship — once on entering shipping
  and once immediately before the squash-merge (the predecessor's
  double-run, kept exactly; both include freshness); green → the
  orchestrator squash-merges via GhOps (agents never merge), deletes
  branch, removes worktree, phase merged; the phase **returns scorecard
  event data** (e.g. review_cycles keyed by turnId) as plain values — the
  org layer persists them in M9.4 (one-way imports). Merge conflict →
  `merge --abort`, item back to gates/fix carrying a rebase-instruction
  note.
  **Files:** src/loop/loop.ts, test/loop-ship.test.ts
  **Deps:** M5.5
  **Accept:** named cases: gate runner invoked exactly twice on a green
  ship (entry + pre-merge); green ship → real squashed commit on fixture
  main, branch gone, worktree dir removed, phase merged, returned
  ScorecardEvent[] contains review_cycles with the item's turnId;
  simulated conflict (two branches, one merged first) → abort + item back
  to building with rebase note, never lost; `pnpm test && pnpm typecheck`.
  **Demo:** The full ready→merged machine works offline end-to-end.
  **Read:** docs/loop.md §7, §13 #16; docs/architecture.md §3, §10.
  **Session:** sonnet, single session.

- [x] **M5.7 Ticket scheduling: Depends-on edges + scope-overlap conservatism** ✅ 2026-07-06 —
  `src/loop/scheduling.ts` implements pure dependency/scope/cap selection
  plus parsers for `Depends-on:` and `## Scope`.
  **Goal:** Pure `selectReadyTickets(tickets, maxConcurrent)`: ready only
  when all `Depends-on:` tickets are merged; intersecting declared file
  scopes never scheduled concurrently ("when in doubt, sequential");
  bounded by max_concurrent_turns. Consumed by M7.9's turn runner —
  that wiring is owned there, stated here for the contract.
  **Files:** src/loop/scheduling.ts, test/scheduling.test.ts
  **Deps:** M5.3
  **Accept:** named cases: unmerged dep excludes; overlapping pair never
  both selected; cap respected; independent tickets both selected under
  cap; `pnpm test && pnpm typecheck`.
  **Demo:** Parallelism that cannot produce merge-conflict chaos.
  **Read:** docs/loop.md §8.
  **Session:** sonnet, single session.

- [x] **M5.8 Idempotent sandbox-repo provisioning script** ✅ 2026-07-06 —
  `scripts/setup-sandbox-repo.sh` and `pnpm e2e:sandbox:setup` create/view
  the private disposable repo and ensure the full op/priority/tier label
  set; run twice successfully against `bikramgupta/operon-m5-sandbox`.
  **Goal:** `pnpm e2e:sandbox:setup`: checks `gh repo view
  $GH_SANDBOX_REPO` before creating (private), ensures the full `op:*` +
  `p1..p3` label set (architecture §10) plus the tier labels
  `op:tier-quick|standard|deep` (loop.md §4) via existence-checked
  `gh label create`; running twice yields identical end state, exit 0 both
  times. The one place real GitHub API access is unavoidable — kept out of
  `pnpm test` entirely.
  **Files:** scripts/setup-sandbox-repo.sh, package.json
  **Deps:** —
  **Accept:** two consecutive runs both exit 0 and `gh label list` diffs
  identically; plain `pnpm test` unaffected (script never invoked by it).
  **Demo:** A disposable, correctly-labeled loop target on demand.
  **Read:** docs/architecture.md §10 (labels).
  **Session:** sonnet, single session.

- [x] **M5.9 `operon loop` driver + sandbox e2e (real gates, injected review)** ✅ 2026-07-06 —
  `src/loop/driver.ts`, `src/cli/loop.ts`, and `test/e2e/sandboxLoop.ts`
  wire the tick driver and real disposable-GitHub e2e; final run merged
  issue #10 / PR #11 in `bikramgupta/operon-m5-sandbox`.
  **Goal:** Wire `operon loop --app <app> [--once|--follow]` to a tick
  driver running the phase functions against real GhCliOps + a real
  clone/worktree; offline tests via FakeGhOps. Then the milestone: `pnpm
  e2e:sandbox` drives one seeded ticket in the sandbox repo through claim →
  **real qgates** (trivial test command in the seeded repo) → PR →
  *injected* APPROVE review (real reviewer turns arrive in M6) → ship →
  squash-merged + closed.
  **Files:** src/cli/loop.ts, src/loop/driver.ts, test/driver.test.ts,
  test/e2e/sandboxLoop.ts, package.json
  **Deps:** M5.6, M5.7, M5.8, M0.1
  **Accept:** offline case: the driver with an injected FakeGhOps under
  `--once` prints the phase plan for a seeded ready ticket with zero gh
  invocations (fake exec recorder proves it); `GH_SANDBOX_REPO=…
  pnpm e2e:sandbox` prints "RESULT: merged", exits 0, and `gh issue view
  <n> --json state` shows CLOSED; `pnpm test && pnpm typecheck`.
  **Demo:** The state machine works against real GitHub before ever
  touching a production app (civic on hold — sandbox apps are the target
  throughout; M3 header note).
  **Read:** docs/loop.md §7; docs/architecture.md §10; docs/PURPOSE.md →
  Validation and launch path.
  **Session:** opus, single session — reconciles every prior boundary
  against real GitHub.

### M6 — Loop ↔ engine integration: a real ticket on a real repo
*Milestone demo: one real, small ticket flows ready→merged with real
Builder and Reviewer turns — loop v1 complete on a real app repo.
(Civic on hold — the sandbox apps are the target; see the M3 note.)*

> **Completed 2026-07-06:** M6 wired real Builder/Reviewer pass pipelines
> into the loop, applied the temporary Claude Builder waiver until M10,
> and shipped alpha issue #1 through PR #2 to squash commit `d71f965`.
> Verification: `pnpm test` (37 files / 362 tests), `pnpm typecheck`,
> `pnpm build`, `pnpm dev roles`, `pnpm dev pipelines`, `pnpm dev doctor`,
> alpha `npm test && npm run lint` after merge, beta `npm test`, and alpha /
> beta loop dry-runs with no ready tickets. Gamma was not present locally.
> Evidence: `research/2026-07-06_sandbox-loop-v1.md`. M6 found and fixed two
> real integration bugs: app config command fallback and GitHub same-account
> approval fallback.

- [x] **M6.1 roles.yaml pilot expedient — proposal PR + explicit test waiver** ✅ 2026-07-06 —
  Builder now temporarily uses `runtime: claude` + `claude-sonnet-5`;
  reviewer stays Claude Opus. `test/roles.test.ts` names this as an M6
  waiver and pins M10 as the restoration point for cross-provider review.
  Note: this was applied in the M6 working tree under the direct milestone
  request; if preserving the strict proposal-PR ceremony, cut this diff as
  the ratification PR before merging the stack.
  **Goal:** Until CodexRuntime lands (M10), builder and reviewer must both
  run on ClaudeRuntime with different models (TODO's recorded pilot
  expedient). That breaks test/roles.test.ts's cross-provider case — which
  AGENTS.md says never to weaken silently. Resolve by proposal: PR changes
  builder to `runtime: claude` + a distinct model, and replaces the test
  case with an explicitly-marked temporary waiver (`builder and reviewer
  differ by model at minimum; cross-provider pairing restored when
  CodexRuntime lands — see M10`), including a revert plan in the PR body.
  Human ratifies; nothing self-merges.
  **Files:** roles.yaml (via PR), test/roles.test.ts (same PR)
  **Deps:** M1.2
  **Accept:** open PR with rationale + revert plan; on the branch `pnpm
  test` green with the waiver case naming M10 as the restoration point;
  `pnpm dev roles` prints cleanly.
  **Demo:** The expedient is ratified and time-boxed, not smuggled.
  **Read:** AGENTS.md (builder≠reviewer rule); TODO old item 5 note;
  docs/PURPOSE.md → runtime layer.
  **Session:** sonnet, single session.

- [x] **M6.2 Loop phases run real pipelines (build / fix / verify)** ✅ 2026-07-06 —
  `runBuilderPipeline`, `runReviewPipeline`, and `runShipCheckPipeline`
  call the real pass executor with verdict schemas, comments the contract,
  carries gate output into fix briefs, selects conditional review passes from
  real policy/diff state, requires app-owned policy, and records a narrow
  GitHub same-account review fallback. `test/loop-integration.test.ts`
  covers the M6 acceptance matrix with FakeRuntime plus real local git.
  **Goal:** Replace M5's injected artifacts with real passes: building
  runs the `build` pipeline (contract unless tier:quick, then implement)
  via M2.8's runPipeline + ClaudeRuntime in the ticket worktree; bounce
  runs `fix` with findings + verbatim gate output in the brief (M2.3);
  reviewing runs `verify` — the Reviewer posts a real GitHub review +
  structured findings comment (double-entry: typed verdict AND GitHub
  state, GitHub authoritative); the conditional review dimensions go live —
  security-deep and perf-scale passes selected via M4.2's dimension_globs
  and risk tier/labels (`only_on` evaluated against real policy) — and the
  high-risk ship-check pass (prompts/ship/check.md) is invoked in
  shipping. The loop loads the app-owned `.operon/policy.yaml` emitted by
  bootstrap and fails loud if it is missing — M6 consumes policy, never
  creates it. Contract comment lands on the issue. The brief's [memory]
  section stays empty until M9.3 wires it — a deliberate deferral.
  **Files:** src/loop/loop.ts, src/loop/driver.ts, test/loop-integration.test.ts
  **Deps:** M5.9, M2.8, M2.2, M4.2, M4.6, M6.1, M1.2
  **Accept:** FakeRuntime-scripted integration cases: building invokes
  contract+implement passes in order with the ticket brief in req.task;
  fix pass brief contains verbatim gate output; verify pass result posts
  review + findings comment through GhOps (call log); tier:quick skips
  contract; a diff touching an auth-glob fixture selects the security-deep
  pass while a plain diff does not; a high-risk item invokes ship-check
  before merge; `pnpm test && pnpm typecheck`.
  **Demo:** The loop is no longer a state machine over stubs — passes are
  real.
  **Read:** docs/loop.md §2–§7; docs/architecture.md §10.
  **Session:** opus lead + delegated test-writer subagent — the central
  integration of the whole plan.

- [x] **M6.3 First real ticket ready→merged (sandbox app; civic version on hold)** ✅ 2026-07-06 —
  Alpha issue #1 / PR #2 merged after real Claude Builder and Reviewer
  passes. First attempt returned because the command loader missed
  package-script fallbacks; second exposed GitHub's same-account approval
  restriction; both fixes are now covered by tests and documented in the
  research note.
  **Goal:** Execute the end-to-end proof against `operon-sandbox-alpha`
  (civic deferred — M3 header note): a small, real one-file ticket
  (criteria binary and mechanically checkable), seeded `op:ready` in the
  sandbox repo (with §10 labels and the bootstrap-emitted
  `.operon/policy.yaml` already present from M3.7), then `operon loop --app
  operon-sandbox-alpha --follow` to merged. Record the run's evidence (PR
  link, gate results, review) in a dated research note. The civic re-run of
  this item is part of the deferred pilot acceptance.
  **Files:** (sandbox repo:) the ticket, the merged PR;
  research/2026-XX-XX_sandbox-loop-v1.md
  **Deps:** M6.2, M3.7
  **Accept:** `gh issue view <n>` in the sandbox repo shows CLOSED with the
  label history ready→building→in-review; the squash-merge commit body
  carries the PR description; the app's test suite green post-merge;
  research note records PR/URL + gate outputs.
  **Demo:** Loop v1 shipped a real change to a real app repo end-to-end.
  **Read:** docs/PURPOSE.md → Validation and launch path; docs/loop.md §7;
  docs/architecture.md §10.
  **Session:** sonnet, single session (mostly driving + observing; human
  reviews the ticket beforehand).

### M7 — Autonomous operation: dispatcher ticks + approval queue
*Milestone demo: `operon dispatch` starts due turns by itself (the launchd
template + doctor line make installing the timer one command); a denied
critical op appears in `operon approvals`, is approved, and the grant
admits exactly that action on re-dispatch; a simulated crash resumes or
restarts per the recovery table; a hung turn is killed at the wall-clock
cap instead of holding its lock forever.*

> **Completed 2026-07-06:** M7 landed the file-backed approval queue,
> single-use grants, grant-aware gate composition, schedule/event/lock/
> journal state, dispatcher tick, dispatched turn runner, stale-lock and
> wall-clock recovery, launchd doctor surface, budget rollup/overlay pause,
> and CLI surfaces for `dispatch`, `approvals`, and `budget`. Verification:
> `pnpm test` (50 files / 400 tests), `pnpm typecheck`, `pnpm build`,
> `pnpm test:live` (3 live ClaudeRuntime conformance tests, 11 turns,
> $3.1653), the sandbox-tagged approval e2e recorded in
> `research/2026-07-06_sandbox-approval-e2e.md`, plus alpha/beta functional
> checks recorded in the session summary. Gamma was checked and not present
> locally.

- [x] **M7.1 Approval store core (file-based, crash-safe)** ✅ 2026-07-06
  **Goal:** `src/org/approvals.ts`: raise/list/decide over
  `pending/ decided/ grants/ log.jsonl` (architecture §4 schema; id =
  utc-compact+rand4); ordered decision writes (log append → file move →
  grant mint); `reconcile()` completes a crash-torn decision idempotently.
  **Files:** src/org/approvals.ts, test/approvals.test.ts
  **Deps:** M0.3
  **Accept:** named cases: raise writes pending item + raised log event;
  approve moves item, mints {app, role, actionHash, expiresAt, uses:1},
  logs in order; deny requires non-empty reason, no grant; reconcile
  completes a simulated crash without duplicate log entries; `pnpm test &&
  pnpm typecheck`.
  **Demo:** The approval lifecycle is provably crash-safe in isolation.
  **Read:** docs/architecture.md §4; docs/PURPOSE.md → Approval surface.
  **Session:** sonnet, single session — write the reconciliation test
  carefully.

- [x] **M7.2 Approval queue CLI (`approvals` / `review` / `show`)** ✅ 2026-07-06
  **Goal:** The operator surface: app-tagged table; one-by-one review
  ([a]pprove / [d]eny-with-reason / [s]kip); full-detail show. `--home` /
  OPERON_HOME override so tests never touch a real org home.
  **Files:** src/cli/approvals.ts, src/org/approvals.ts, test/approvals-cli.test.ts
  **Deps:** M7.1, M0.1
  **Accept:** spawned-CLI cases: empty home prints header + 0 pending;
  seeded item listed with app/role/rule/age columns (age computed from
  raisedAt — loop.md §13 #21); stdin "a\n" approves and
  show reports grantId; "d\nreason\n" persists the reason; `pnpm test &&
  pnpm typecheck`.
  **Demo:** The human works the queue entirely from the terminal.
  **Read:** docs/architecture.md §4 (CLI).
  **Session:** sonnet, single session.

- [x] **M7.3 Grant-aware gate composition** ✅ 2026-07-06
  **Goal:** `composeGate(baseGate, store, {app, role})` → the effective
  GateFn: SHA-256 actionHash over normalized {tool, input}; matching
  unexpired grant → allow + consume exactly once; otherwise fall through
  to base gate, persisting a new escalation on denial. Lives in src/org —
  src/runtime stays untouched (one-way imports; runtime never sees
  approval storage).
  **Files:** src/org/gate-compose.ts, test/gate-compose.test.ts
  **Deps:** M7.1
  **Accept:** named cases: grant admits once and uses→0; second identical
  retry denied + re-escalated (no double-spend); expired grant ignored;
  different input → different hash → no match; no grant replicates
  defaultGate exactly with escalation persisted; `pnpm test && pnpm
  typecheck`.
  **Demo:** Approve ≠ execute — a grant admits exactly one retry.
  **Read:** docs/architecture.md §4 (grants); src/runtime/gate.ts.
  **Session:** opus, single session — actionHash normalization is
  security-load-bearing.

- [x] **M7.4 Trigger grammar evaluator + schedule state** ✅ 2026-07-06
  **Goal:** `src/org/schedule.ts`: the roles.yaml grammar (hourly / every
  Nh|m / daily HH:MM / weekly dow [HH:MM], local time); due when
  `now ≥ next(lastFired, spec)`; missed windows collapse to one firing;
  schedule.json keyed (app, role, trigger), written only after turn start.
  **Files:** src/org/schedule.ts, test/schedule.test.ts
  **Deps:** M0.3 (FakeClock)
  **Accept:** named cases: hourly due at 61min not 10; daily 08:00 fires
  once after a 3-day gap; weekly defaults 09:00; every-30m boundary
  inclusive; not due before next(); `pnpm test && pnpm typecheck`.
  **Demo:** The trigger comments in roles.yaml are now executable.
  **Read:** docs/architecture.md §2 (trigger resolution); roles.yaml.
  **Session:** sonnet, single session.

- [x] **M7.5 Lock file mechanics** ✅ 2026-07-06
  **Goal:** `src/org/locks.ts`: O_EXCL create of `locks/<app>--<role>.lock`
  ({pid, turnId, startedAt, heartbeatAt}); heartbeat updater; staleness
  check (>2 min); release.
  **Files:** src/org/locks.ts, test/locks.test.ts
  **Deps:** M0.3
  **Accept:** named cases: acquire succeeds when absent; busy when present
  (O_EXCL); heartbeat updates; stale flips exactly past threshold; release
  removes; `pnpm test && pnpm typecheck`.
  **Demo:** One turn per (role, app), enforced by the filesystem.
  **Read:** docs/architecture.md §2 (locking).
  **Session:** sonnet, single session.

- [x] **M7.6 Turn journal + resume-vs-restart decision** ✅ 2026-07-06
  **Goal:** `src/org/journal.ts`: synchronous journal writes per phase
  transition (`state/turns/<turnId>.json`, architecture §3 schema) and a
  pure `decideRecovery()` encoding the §3 table verbatim (resume once with
  interruption notice / restart clean / recollect-only / fail+incident at
  attempt≥3).
  **Files:** src/org/journal.ts, test/journal.test.ts
  **Deps:** M0.3
  **Accept:** five named cases — one per table row, matching it verbatim;
  journal round-trips patch merges; `pnpm test && pnpm typecheck`.
  **Demo:** Crash decisions are a lookup, not a judgment call.
  **Read:** docs/architecture.md §3 (journal + recovery table);
  docs/loop.md §13 #1, #6.
  **Session:** sonnet, single session.

- [x] **M7.7 Event polling + dedup + file-drop inbox** ✅ 2026-07-06
  **Goal:** `src/org/events.ts`: `GitHubEventSource` interface (fake
  injectable), the five stable dedup keys from architecture §2's table,
  consumed-key store under `state/events/`, and inbox reading
  (`state/events/inbox/*.json`, consumed by filename) — company-lifecycle
  events ride the same path.
  **Files:** src/org/events.ts, test/events.test.ts
  **Deps:** M0.3
  **Accept:** named cases: each key formula exact (incl. pr-opened key
  changing with head SHA); consumed key filtered on next poll; inbox file
  returned once; an injected API error emits a loud, machine-coded error
  event and the poll returns cleanly for the next tick (failure-mode #5 —
  never silent); `pnpm test && pnpm typecheck`.
  **Demo:** The same PR never fires twice; a dropped JSON file is an event.
  **Read:** docs/architecture.md §2 (events table + scope note).
  **Session:** sonnet, single session.

- [x] **M7.8 Dispatcher tick core** ✅ 2026-07-06
  **Goal:** `src/org/dispatch.ts` + `operon dispatch`: stateless tick —
  for each live app (apps.ts) × role, merge roles.yaml triggers with
  cadence overrides; evaluate schedule (M7.4) + events (M7.7); skip
  fresh-locked (role,app); apply WIP limit with blocked-turns → events →
  oldest-schedule priority; spawn detached `operon run-role <role> --app
  <app> --turn <id>` (M2.9's fixed signature); recordFired only after
  spawn succeeds. Never fires `manual` triggers (M3.2).
  **Files:** src/org/dispatch.ts, src/cli/dispatch.ts, test/dispatch.test.ts
  **Deps:** M7.4, M7.5, M7.6, M7.7, M3.1, M2.9, M0.1
  **Accept:** named cases (fake spawn recorder): due schedule spawns with
  correct argv; WIP limit defers; event beats schedule under contention;
  fresh lock skips; recordFired only post-spawn; manual trigger never
  fires; a due role with no pipeline/template configured is skipped with a
  loud log line, never spawned into an undefined turn;
  `pnpm dev dispatch` against a fixture home prints a tick summary
  line and exits 0; `pnpm test && pnpm typecheck`.
  **Demo:** "Deciding is computing what is due" — in code.
  **Read:** docs/architecture.md §0 (worked tick), §2.
  **Session:** opus, single session — integrates four modules + process
  semantics.

- [x] **M7.9 Turn runner: dispatched turns become real** ✅ 2026-07-06
  **Goal:** The org-layer glue no draft owned: `run-role --app <app>
  --turn <id>` (non-interactive path) resolves the app, ensures the
  org-managed clone (`repos/<app>`, fetch-only) and worktree per
  architecture §3; composes the effective gate via M7.3; assembles minimal
  context (M3.6's `assembleMinimalContext` until M9.3 upgrades it); for a
  builder
  `ticket-ready` turn, picks the ticket via M5.7's selectReadyTickets +
  claims via M5.3; journals every phase (M7.6) with heartbeats (M7.5);
  records telemetry with app/trigger (M3.2); on gate escalations persists
  approval items and sets `blocked_on_gate`; re-dispatch of a decided
  blocked turn injects the decision summary (deny reason → context).
  **Files:** src/org/turn-runner.ts, src/cli/run-role.ts (extend),
  test/turn-runner.test.ts
  **Deps:** M7.3, M7.5, M7.6, M7.8, M5.7, M5.3, M3.2, M3.6
  **Accept:** FakeRuntime cases: composed gate consulted (a granted action
  passes once); journal phases written in order with heartbeat updates;
  builder event turn claims exactly one eligible ticket; escalation lands
  in the approval store and journal ends blocked_on_gate; decided-deny
  re-dispatch includes the reason in context; telemetry line carries
  app+trigger; clone provisioning against a real temp git fixture —
  created fetch-only when absent, reused when present, worktree created
  per turn and never on main; `pnpm test && pnpm typecheck`.
  **Demo:** A dispatched turn is gated, journaled, attributed, and
  recoverable — autonomy with guarantees.
  **Read:** docs/architecture.md §0, §3, §4; docs/loop.md §7.
  **Session:** top-tier lead + delegated test-writer subagent — the
  highest-integration item in the plan.

- [x] **M7.10 Crash recovery integration: stale-lock reconciliation** ✅ 2026-07-06
  **Goal:** Before computing due turns, the tick scans stale locks, reads
  journals, applies decideRecovery, and acts: resume-spawn with
  interruption notice; restart clean (`git reset --hard && git clean -fd`
  — proven against a real temp repo); recollect-only; attempt≥3 →
  failed + incident note + lock release.
  **Files:** src/org/recovery.ts, src/org/dispatch.ts, test/recovery.test.ts
  **Deps:** M7.8, M7.9
  **Accept:** named cases per recovery row observed via fake spawn
  recorder; restartClean removes an uncommitted stray file in a real temp
  repo; `pnpm test && pnpm typecheck`.
  **Demo:** A killed turn is never silently stuck.
  **Read:** docs/architecture.md §3; docs/loop.md §13 #1–#7.
  **Session:** opus, single session — a wrong branch loses work silently.

- [x] **M7.11 Per-pass wall-clock cap + turn caps — hung sessions die** ✅ 2026-07-06
  **Goal:** Heartbeats cannot catch a turn hung inside an SDK call — the
  process stays alive, keeps heartbeating, and holds its (role, app) lock
  forever, silently defeating autonomy (loop.md §13 #2). Fix: the dispatch
  tick compares each running journal's pass start time against a per-pass
  wall-clock cap (default 60 min, ratified 2026-07-06;
  per-pass override in pipelines.yaml), kills the turn process via an
  injected killer, and routes it into M7.10's recovery path. Also enforce
  per-pass turn caps (loop.md §2 rule 6): pipelines.yaml per-pass
  `max_turns` flows through a new optional `TurnRequest.maxTurns` into the
  adapter's native option.
  **Files:** src/org/dispatch.ts, src/loop/pipelines.ts (schema),
  src/loop/pipeline.ts, src/runtime/types.ts,
  src/runtime/adapters/claude.ts, test/wallclock.test.ts
  **Deps:** M7.8, M7.10, M2.8, M1.2
  **Accept:** named cases (FakeClock + fake killer): a running pass older
  than its cap gets exactly one kill and its journal enters the recovery
  path; a pass under the cap is untouched; pipelines.yaml per-pass
  wall_clock/max_turns overrides land in TurnRequest (executor test);
  ClaudeRuntime maps maxTurns to the mocked SDK option; `pnpm test &&
  pnpm typecheck`.
  **Demo:** A wedged SDK session frees its lock at the cap instead of
  wedging the org.
  **Read:** docs/loop.md §13 #2, §2 rule 6; docs/architecture.md §2;
  docs/PURPOSE.md → Resolved operating defaults.
  **Session:** opus, single session — kill/recover semantics must not lose
  work.

- [x] **M7.12 Scheduler installation: launchd plist + doctor** ✅ 2026-07-06
  **Goal:** `config/launchd/operon-dispatch.plist.template`
  (StartInterval 300) + systemd-timer parity notes; `operon doctor` gains
  a scheduler line (installed / not-installed + exact load/unload
  commands).
  **Files:** config/launchd/operon-dispatch.plist.template,
  src/cli/doctor.ts, test/doctor.test.ts
  **Deps:** M7.8
  **Accept:** `plutil -lint` exits 0 on the template; doctor cases against
  a fake LaunchAgents dir (absent → not-installed + command; present →
  installed); `pnpm test && pnpm typecheck`.
  **Demo:** Migration = install the timer (PURPOSE's droplet story).
  **Read:** docs/architecture.md §2; docs/PURPOSE.md → Runtime host.
  **Session:** sonnet, single session.

- [x] **M7.13 Budget rollup + auto-pause + budget-exceeded queue item** ✅ 2026-07-06
  **Goal:** `src/org/budget.ts` reads the month's telemetry JSONL (app
  field from M3.2, budgets via loadApps — never re-parse YAML), sums per
  app: ≥80% → a warning row in `operon budget`'s output (the
  architecture's Planner-digest surface is fed later by M8.2's groom
  brief); ≥100% → paused state overlay (never a YAML
  edit) + exactly one synthetic `budget-exceeded` approval item
  (idempotent on re-run) in the same queue. Dispatcher skips
  overlay-paused apps.
  **Files:** src/org/budget.ts, src/cli/budget.ts, src/org/dispatch.ts
  (skip overlay), test/budget.test.ts
  **Deps:** M7.1, M7.8, M3.1, M3.2, M0.1
  **Accept:** named cases: current-month-only summation; 85% → warning, no
  overlay; 110% → overlay + exactly one queue item; second run adds no
  duplicate; dispatch skips an overlay-paused app; `pnpm dev budget --home
  <tmp>` prints per-app table with an EXCEEDED row; `pnpm test && pnpm
  typecheck`.
  **Demo:** An over-budget app pauses itself and asks the human — one
  inbox, never two.
  **Read:** docs/architecture.md §7; docs/PURPOSE.md → Budget & cadence.
  **Session:** sonnet, single session.

- [x] **M7.14 Approval surface end-to-end on a sandbox app** ✅ 2026-07-06 *(absorbs old
  M11.2 — moved here 2026-07-05 when M11 was deferred post-launch; its
  deps were M7-internal all along)*
  **Goal:** Run one real turn against a sandbox app whose task requires a
  gate-critical op (benign but critical-classified — e.g. a write to the
  app's `.operon/config.yaml` or a synthetic `dns record` command):
  verify deny → `blocked_on_gate` → item in `operon approvals` → human
  approves → grant → re-dispatch executes exactly that op → audit trail
  complete in log.jsonl. Record the flow transcript in a dated research
  note — this is the approval surface's real acceptance test.
  **Files:** research/2026-XX-XX_sandbox-approval-e2e.md
  **Deps:** M7.9, M7.2
  **Accept:** log.jsonl shows raised→decided→grant-minted→consumed for one
  item; the op executed exactly once (idempotent evidence in the note);
  `operon approvals` shows zero pending afterward.
  **Demo:** The human-gating story works on a real critical op, end to
  end.
  **Read:** docs/architecture.md §4; docs/PURPOSE.md → Approval boundary.
  **Session:** sonnet, single session + human present for the approval.

### M8 — Planner pipelines: plan / groom / triage
*Milestone demo: `operon run-role planner` on a schedule executes a real
groom pipeline — issues in, prioritized `op:ready` tickets out — honoring
the intake invariant (only Planner pipelines or the human apply
`op:ready`). SRE, Support, and Marketing also have v0 scheduled/event
pipelines by the end of the milestone, so every role in `roles.yaml` has a
concrete execution path rather than being skipped by the dispatcher.*

- [x] **M8.1 `plan` pipeline: visionary → competing PMs → arbitrator → decomposer** ✅ 2026-07-06 —
  root `pipelines.yaml` now has the five-pass Planner plan pipeline with
  `pm-a`/`pm-b` in the `competing-pms` parallel group; templates encode
  atomic tickets, `Depends-on:`, execution groups, file scope, binary
  criteria, and human sign-off before `op:ready` for deep/high-risk work.
  `test/loop/planning-pipelines.test.ts` proves concurrent PM execution and
  decomposer access to arbitrator output.
  **Goal:** Seed the deep-planning pipeline in pipelines.yaml + prompts/
  (proposal PR — ratified surfaces): visionary, pm-a ∥ pm-b
  (parallel_group with disjoint output files), arbitrator (agreed/
  disputed/gap merge), decomposer (atomic/testable/scoped/ordered tickets;
  binary criteria; `Depends-on:` edges; execution-group + declared
  file-scope annotations feeding M5.7; test-infra-first; §10 ticket
  format; grep-verifiable statement that deep-tier/high-risk tickets need
  human sign-off on criteria before `op:ready` — loop.md §5's ownership
  chain). Executor already supports parallel groups (M2.8) — this proves
  it on the real config.
  **Files:** pipelines.yaml, prompts/plan/visionary.md, prompts/plan/pm.md,
  prompts/plan/pm-b.md, prompts/plan/arbitrator.md, prompts/plan/decomposer.md
  **Deps:** M2.8, M2.2
  **Accept:** `pnpm dev pipelines` prints the plan pipeline with the
  competing-pms parallel group; a FakeRuntime integration test runs the
  five passes with pm-a/pm-b concurrent and decomposer receiving the
  arbitrator output in its brief; decomposer template mechanically
  requires Depends-on + file-scope + binary-criteria sections and the
  human-sign-off rule for deep/high-risk tickets; checks run on the PR
  branch — satisfied only after human merge; `pnpm test && pnpm typecheck`.
  **Demo:** Greenfield planning is an executable pipeline, not a vibe.
  **Read:** docs/loop.md §0 (workloads), §4 (plan sketch + decomposer
  protocol), §8.
  **Session:** opus, single session — template quality is the product.

- [x] **M8.2 `groom` + `triage` pipelines + intake invariant** ✅ 2026-07-06 —
  groom, triage, and SRE incident pipelines/templates landed; templates pin
  the Planner-only `op:ready` invariant, doc reconciliation, fixed incident
  issue format, pending-approval ages, and budget warnings in the groom
  brief. Focused FakeRuntime coverage runs the one-pass pipelines.
  **Goal:** Seed groom (digests/incidents/returned items → specs + tickets
  + re-prioritization; doc-reconciliation duty: small drift appends a
  doc-update criterion, large drift emits a docs ticket; vision/charter
  changes proposal-only) and triage (bug batches → tier + `op:ready` |
  backlog | close-with-reason; `p1..p3`). Also seed the SRE `incident`
  pipeline/template (ci-failed/alert events → a fixed-format `op:incident`
  issue feeding groom and the escaped_bug scorecard — failure-mode #17's
  consumer), and give groom its digest duty: its brief includes
  pending-approval ages and budget warnings (the operator surfaces
  loop.md §13 #21 and architecture §7 route to the Planner's digest).
  Templates encode the invariant: only Planner pipelines (or the human)
  apply `op:ready`.
  **Files:** pipelines.yaml, prompts/groom/groom.md,
  prompts/triage/triage.md, prompts/sre/incident.md
  **Deps:** M8.1
  **Accept:** on the PR branch `pnpm dev pipelines` shows 8 pipelines;
  FakeRuntime test runs each as a one/two-pass pipeline; templates
  grep-verifiably contain the op:ready invariant, the doc-reconciliation
  instructions, and the incident-issue format; satisfied only after human
  merge; `pnpm test && pnpm typecheck`.
  **Demo:** Steady-state intake is protocol, and untriaged issues can
  never reach the loop.
  **Read:** docs/loop.md §4 (issue intake), §12.2 (depth defaults —
  open decision, note in PR).
  **Session:** opus, single session.

- [x] **M8.3 Trigger-to-pipeline routing for standing roles** ✅ 2026-07-06 —
  `src/org/trigger-routing.ts` maps effective triggers to named protocols;
  dispatch uses it for loud skips; turn-runner executes routed scheduled/event
  pipelines through the real pass executor. The scheduled Planner groom path
  is covered end-to-end with FakeRuntime, pending approval context, and budget
  warning context.
  **Goal:** Add the org-layer routing table that M7 deliberately avoided
  hardcoding: given `{role, trigger, app}`, resolve the pipeline or
  one-pass template to run. Required v1 mapping: planner daily→groom,
  planner weekly→plan; builder ticket-ready→loop claim/build path;
  reviewer pr-opened→loop review path; sre hourly→sre-health, sre
  ci-failed/alert-webhook→sre-incident; support schedule→support-digest;
  marketing release-shipped→marketing-release, marketing weekly→ci-sweep.
  Unknown mappings keep M7.8's loud skip behavior. This is the missing
  bridge between `roles.yaml` triggers and real pass execution for
  non-builder roles.
  **Files:** src/org/trigger-routing.ts, src/org/turn-runner.ts,
  src/org/dispatch.ts, test/trigger-routing.test.ts,
  test/turn-runner-routing.test.ts
  **Deps:** M7.9, M8.2
  **Accept:** named cases for every mapping above; cadence overrides still
  route by the effective trigger; manual triggers never auto-route; an
  unmapped `{role, trigger}` returns a typed skip reason and is logged,
  never spawned into an undefined turn; turn-runner integration proves a
  scheduled Planner turn runs the groom pipeline, not a generic one-pass
  placeholder; `pnpm test && pnpm typecheck`.
  **Demo:** Scheduled/event roles execute named protocols instead of
  existing only as config.
  **Read:** docs/architecture.md §2; docs/loop.md §4; roles.yaml.
  **Session:** opus, single session — this is load-bearing autonomy glue.

- [x] **M8.4 SRE/Support/Marketing v0 pipelines + event schemas** ✅ 2026-07-06 —
  `sre-health`, `support-digest`, `marketing-release`, and `ci-sweep`
  pipelines/templates landed; `docs/event-schemas.md` plus
  `src/org/event-schemas.ts` define/validate support-feedback,
  adoption-signal, health-alert, and launch-calendar payloads; root pipeline
  tests pin all 12 protocol ids and role ownership.
  **Goal:** Seed the non-build standing-role protocols as ratified
  pipeline/template surfaces: `sre-health` (scheduled health/deploy sweep,
  emits incident issues or infra PRs), `support-digest` (file-drop feedback
  events → digest + reply drafts; never sends), `marketing-release`
  (release-shipped → changelog/launch drafts; never publishes), and
  `ci-sweep` (weekly competitive/adoption digest feeding Planner). Add
  `docs/event-schemas.md` for the file-drop company-lifecycle events
  these templates consume: support-feedback, adoption-signal,
  health-alert, and launch-calendar. All outward actions terminate as
  drafts or approval items.
  **Files:** pipelines.yaml, prompts/sre/health.md,
  prompts/support/digest.md, prompts/marketing/release.md,
  prompts/marketing/ci-sweep.md, docs/event-schemas.md,
  test/loop/pipelines-root.test.ts
  **Deps:** M8.3
  **Accept:** on the proposal PR branch `pnpm dev pipelines` shows the
  added pipelines; root-pipeline tests pin selection semantics for the new
  ids; templates grep-verifiably contain draft-only / external-publish-
  is-critical language, Planner-feed instructions, and exact output
  artifact headings; event-schema fixtures parse and reject unknown
  event kinds; satisfied only after human merge; `pnpm test &&
  pnpm typecheck`.
  **Demo:** SRE, Support, and Marketing have executable v0 protocols, not
  just role names.
  **Read:** docs/architecture.md §2 scope note; docs/testing-journey.md;
  docs/PURPOSE.md → org chart.
  **Session:** opus, single session — template quality and safety wording
  matter.

- [x] **M8.5 `operon-sandbox-gamma` functional coverage for non-build roles** ✅ 2026-07-06 —
  Created private repo `bikramgupta/operon-sandbox-gamma`, a tiny Node HTTP
  service with `/health`, Dockerfile, deploy-shaped local drill, seeded
  support/adoption/health/launch events, and bootstrap-emitted `.operon/**`.
  Registered it in `apps.yaml` as onboarding. Smokes passed: healthy/down SRE
  checks emitted private issue #1 labeled `op:incident` + `p3`; Support and
  Marketing produced draft-only artifacts; `npm run deploy:local` classified
  as a denied/escalated `production-deploy` critical op by the gate. Evidence:
  `research/2026-07-06_sandbox-gamma-role-smoke.md`.
  **Goal:** Create the human-approved third sandbox repo
  `operon-sandbox-gamma`: a tiny deployable HTTP service with `/health`,
  a local/container deploy script, and seeded file-drop inbox examples for
  feedback/adoption/health events. Bootstrap and register it, then run
  three real smokes: SRE health sweep detects healthy and unhealthy states
  and emits an incident issue on failure; Support produces a digest + reply
  drafts from synthetic feedback; Marketing produces a release/changelog
  draft from a real sandbox release. No public send/publish/deploy happens
  without the approval queue.
  **Files:** apps.yaml; (new sandbox repo:) .operon/**, service source,
  feedback fixtures; research/2026-XX-XX_sandbox-gamma-role-smoke.md
  **Deps:** M8.4, M7.14
  **Accept:** `pnpm dev apps` lists gamma with the intended status;
  gamma's own tests pass; SRE smoke records healthy→failed evidence and an
  `op:incident` issue; Support/Marketing smokes produce draft artifacts
  only; any deploy-shaped command is denied/escalated unless approved;
  research note links exact issues/PRs/artifacts and command results.
  **Demo:** The non-build org roles are proven against a running service
  and realistic input material before production onboarding.
  **Read:** docs/testing-journey.md (coverage gap + approved answer);
  docs/architecture.md §2, §4; docs/PURPOSE.md → validation and launch path.
  **Session:** sonnet, single session + human present for repo creation
  and any approval drill.

### M9 — Memory, context, scorecards, retro, observability CLIs
*Milestone demo: a real pass leaves an OKF memory write, a scorecard event,
and an L1/L2 record — and `operon status` / `analyze` / `retro` each read a
different slice back as a human-readable report.*

- [ ] **M9.1 OKF bundle reader: frontmatter, INDEX, excerpt selection**
  **Goal:** `src/org/memory.ts` read path: parseOkfDocument (seven
  frontmatter fields + body; malformed → named error); loadBundle
  (INDEX.md + docs); selectExcerpts(bundleDirs, taskText, capBytes) —
  INDEX.md always included, then keyword-overlap matches, hard ~16 KB cap,
  no embeddings (retrieval sophistication is earned by evidence).
  **Files:** src/org/memory.ts, test/memory.test.ts
  **Deps:** M0.3
  **Accept:** named cases: full frontmatter parse; malformed throws named
  error; INDEX unconditional; keyword match includes/excludes correctly;
  cap truncation (tiny cap fixture); `pnpm test && pnpm typecheck`.
  **Demo:** Memory excerpts are a deterministic function of the task text.
  **Read:** docs/architecture.md §5 (excerpt selection), §6 (OKF format).
  **Session:** sonnet, single session.

- [ ] **M9.2 OKF bundle writer: end-of-turn write + INDEX maintenance**
  **Goal:** Write path: writeMemoryDoc (validate frontmatter, stamp
  updated, regenerate INDEX.md — one line per non-deprecated doc, sorted);
  deprecateMemoryDoc (status flip + INDEX drop; wrong lessons get deleted,
  not hedged). No git here — commits ride the turn's normal flow.
  **Files:** src/org/memory.ts, test/memory.test.ts
  **Deps:** M9.1
  **Accept:** named cases: create appends to INDEX; same-name overwrite
  updates in place without duplication; deprecate drops from INDEX, file
  survives with status: deprecated; `pnpm test && pnpm typecheck`.
  **Demo:** Roles can record lessons the org can later curate.
  **Read:** docs/architecture.md §6; TASTE.md §12.
  **Session:** sonnet, single session.

- [ ] **M9.3 Context assembler — and wire it into real turns**
  **Goal:** `src/org/context.ts` `assembleContext()`: fixed-order
  concatenation (org TASTE.md → taste/<role>.md → app .operon/TASTE.md →
  *generated* layer-4 turn protocol: expected outputs from
  RoleConfig.outputs, §10 GitHub conventions, end-of-turn memory-write
  instruction, approval etiquette) into `ContextBundle.taste[]` unchanged;
  memoryExcerpts via M9.1. Then replace M3.6/M7.9's
  `assembleMinimalContext` with this, and thread memory into the loop's
  briefs: the turn-runner/driver compute selectExcerpts() and pass the
  result down as plain data into brief inputs (loop.md §3's [memory]
  section — same return-and-persist pattern as scorecards; src/loop never
  imports src/org).
  **Files:** src/org/context.ts, src/org/turn-runner.ts (swap),
  src/org/plan.ts (swap), src/loop/driver.ts (brief inputs),
  test/context.test.ts
  **Deps:** M9.1, M7.9, M3.6, M2.3
  **Accept:** named cases: 4 taste entries in order when all layers exist;
  role addendum omitted cleanly when absent; protocol entry contains
  outputs + conventions marker + memory-write instruction; excerpts
  respect cap; turn-runner/plan tests assert assembleContext is the source
  and `grep -rn assembleMinimalContext src` returns zero matches; an
  integration case shows a loop pass brief containing a [memory] section
  fed from a fixture bundle; `pnpm test && pnpm typecheck`.
  **Demo:** Every turn now carries the full TASTE + memory stack.
  **Read:** docs/architecture.md §5, §10; src/runtime/types.ts.
  **Session:** opus, single session.

- [ ] **M9.4 Scorecard writer/reader + persist loop's returned events**
  **Goal:** `src/org/scorecards.ts`: appendScorecardEvent (six kinds from
  architecture §6's table, orchestrator-written only — gate rule from M0.5
  backstops) + readScorecards(app, role, since); wire M5.6's returned
  ScorecardEvent[] into persistence at the turn-runner/driver layer (the
  one-way-imports resolution decided in this plan).
  **Files:** src/org/scorecards.ts, src/org/turn-runner.ts,
  src/loop/driver.ts (pass-through), test/scorecards.test.ts
  **Deps:** M9.2 (co-located module conventions), M7.9, M5.6
  **Accept:** named cases: each of six kinds appends valid JSONL with
  app/role/timestamp; unknown kind rejected with named error; since-filter
  works; a merged loop item's review_cycles event lands on disk via the
  runner (integration case, FakeGhOps+FakeRuntime); re-run dedupes by
  turnId; `pnpm test && pnpm typecheck`.
  **Demo:** Merit data accumulates without self-reporting.
  **Read:** docs/architecture.md §6 (scorecards table).
  **Session:** sonnet, single session.

- [ ] **M9.5 Weekly retro v0 (`operon retro`)**
  **Goal:** runRetro(week): read telemetry JSONL + scorecards per (role,
  app); emit `retro/<date>.md` (scores, trends, incidents, anomaly-flag
  summary once M9.9 lands — reference, don't block). Curation and
  proposal emission are M9.6's job — this item is the reporting skeleton
  only.
  **Files:** src/org/retro.ts, src/cli/retro.ts, test/retro.test.ts
  **Deps:** M9.4, M3.2, M0.1
  **Accept:** fixture-driven case: retro/<date>.md contains a heading per
  (role, app) with the exact expected aggregates (string-matched); `pnpm
  dev retro --date 2026-07-04` against a temp home prints the written
  path, exit 0; `pnpm test && pnpm typecheck`.
  **Demo:** The org grades itself weekly from evidence, not vibes.
  **Read:** docs/architecture.md §6 (weekly retro — emits #1 only here).
  **Session:** opus, single session — judgment on which aggregates matter.

- [ ] **M9.6 Retro v1: memory curation + skills promotion + proposal emission**
  **Goal:** Complete architecture §6's retro triad beyond M9.5's report:
  (2) curation edits — dedupe lessons, deprecate doubtful ones, delete
  wrong ones (M9.2 primitives), keyed off evidence links (the mitigation
  for failure-mode #14, wrong-lesson poisoning); promotion of recurring
  lessons up a tier to `skills/` as a review-gated PR (PURPOSE knowledge
  tiers); (3) proposed TASTE/roles.yaml changes emitted as issues/PRs
  only — the gate's protocol-self-edit rule backstops that nothing edits
  the ratified files directly.
  **Files:** src/org/retro.ts, src/cli/retro.ts, test/retro-curation.test.ts
  **Deps:** M9.5, M9.2
  **Accept:** named cases: duplicate lessons merged (one survives, INDEX
  updated); a lesson contradicted by evidence is deleted, not hedged; a
  recurring lesson produces a skills/<name>/SKILL.md draft on a PR branch,
  never a direct write; proposal output is an issue/PR body — a test
  asserts no write path touches TASTE.md/roles.yaml; `pnpm test && pnpm
  typecheck`.
  **Demo:** The org can unlearn — wrong lessons die on schedule instead of
  poisoning future briefs.
  **Read:** docs/architecture.md §6 (curation, retro emits #2–#3);
  docs/PURPOSE.md → knowledge tiers; docs/loop.md §13 #14.
  **Session:** opus, single session.

- [ ] **M9.7 TASTE role addenda proposals (`taste/reviewer.md`, `taste/support.md`)**
  **Goal:** Author the two materially-different role addenda as proposal
  PRs (reviewer: concrete checklist — criteria coverage, security lens,
  numbered-findings format; support: tone/voice for drafts), each opening
  with a proposal-pending-ratification note. Gives layer [2] real content
  and the M0.5 gate cases a real target.
  **Files:** taste/reviewer.md, taste/support.md (via PR)
  **Deps:** M0.5, M9.3
  **Accept:** open un-merged PR; both files <~2 KB with the proposal note;
  suites green (no code change); an assembleContext run against the real
  org home now yields 4 taste layers for reviewer (manual check recorded
  in the PR body).
  **Demo:** Role craft is versioned, ratified content — not lore.
  **Read:** docs/PURPOSE.md → TASTE layers; docs/architecture.md §1, §5.
  **Session:** sonnet, single session — content, not code; human ratifies.

- [ ] **M9.8 `operon status` — L1+L2 dashboard**
  **Goal:** `operon status [--app] [--limit N]`: recent runs newest-first
  from envelope.json + events.jsonl ONLY (never L3); columns runId,
  pipeline/pass, status with infra-`failed(error_code)` vs merit-`blocked/
  findings` visibly distinct, duration, tokens/cost, escalations.
  **Files:** src/cli/status.ts, src/runtime/runlog/status.ts,
  test/cli-status.test.ts
  **Deps:** M2.5, M2.6, M0.1
  **Accept:** named cases: newest-first over synthetic runs; infra vs
  merit labels never conflated; --limit truncates; `pnpm dev status`
  against a fixture home prints the documented columns; `pnpm test &&
  pnpm typecheck`.
  **Demo:** A human reads the org's recent work without opening
  transcripts.
  **Read:** docs/loop.md §9 (dashboards read L1+L2 only; infra≠merit).
  **Session:** sonnet, single session.

- [ ] **M9.9 `operon analyze` — anomaly detectors**
  **Goal:** The four ported detectors over L1+L2 (low_tokens_high_time
  >300s <1k; single_turn_long_run; bash_heavy ≥20; environment_retry ≥3),
  each mapping to a canned recommendation; output feeds retro.
  **Files:** src/runtime/runlog/anomalies.ts, src/cli/analyze.ts,
  test/runlog-anomalies.test.ts
  **Deps:** M2.5, M2.6, M0.1
  **Accept:** boundary-exact named cases (fires at 20 not 19; at 3 not 2;
  at >300s not 299); clean run → zero flags; `pnpm dev analyze` against a
  fixture prints exactly one flag + recommendation; `pnpm test && pnpm
  typecheck`.
  **Demo:** Stuck-on-environment turns surface themselves.
  **Read:** docs/loop.md §9 (detectors, canned recommendations).
  **Session:** sonnet, single session.

- [ ] **M9.10 Cache-token telemetry + `cold_cache` anomaly**
  **Goal:** Close the gap between docs/loop.md §9-§10 and the runtime
  contract: extend `TurnUsage` with `tokensInUncached`,
  `cacheCreationTokens`, and `cacheReadTokens` while keeping `tokensIn` as
  the sum; populate ClaudeRuntime from SDK usage; carry the split through
  telemetry and L1 envelopes; add `cold_cache` to `operon analyze`
  (zero cache reads on a pass whose prior pass in the same pipeline ran
  within the provider cache TTL). Codex/pi adapters must later fill the
  same fields in M10 or explicitly mark them unsupported in the capability
  matrix.
  **Files:** src/runtime/types.ts, src/runtime/adapters/claude.ts,
  src/runtime/telemetry.ts, src/runtime/runlog/envelope.ts,
  src/loop/pipeline.ts, src/runtime/runlog/anomalies.ts,
  test/runtime/claude-sdk.unit.test.ts, test/telemetry.test.ts,
  test/runlog-envelope.test.ts, test/runlog-anomalies.test.ts
  **Deps:** M9.9, M1.3, M2.5
  **Accept:** mocked Claude usage with cache creation/read tokens maps to
  all four fields; old JSONL telemetry without cache fields still reads or
  is ignored gracefully by consumers; envelope usage includes cache read
  and write tokens; `cold_cache` fires only on the documented boundary;
  flat-rate cost math is not reintroduced; `pnpm test && pnpm typecheck`.
  **Demo:** Prompt-cache health is observable instead of only described in
  docs.
  **Read:** docs/loop.md §9 cache visibility + anomaly flags; §10
  TurnUsage delta; research/2026-07-04_prompt-caching.md.
  **Session:** sonnet, single session.

### M10 — Second and third adapters: Codex, pi, capability matrix
*Milestone demo: an all-pi org enforces identical gate verdicts to an
all-Claude org on the same conformance cases, and
`docs/capability-matrix.md` states exactly what each adapter degrades.
Restores the cross-provider builder/reviewer pairing (reverts M6.1's
waiver).*

- [ ] **M10.1 CodexRuntime core (mocked SDK + env-gated live conformance)**
  **Goal:** Happy-path turn via the official Codex TS SDK (confirm exact
  npm package in-session from research/): thread start with model +
  mapped effort; run() with the task; resume by thread id;
  TurnResult/TurnUsage population. Mirror M1.2's testing pattern exactly:
  mocked unit tests + an env-gated live conformance file that *skips*
  without credentials.
  **Files:** src/runtime/adapters/codex.ts, package.json,
  test/adapters/codex.test.ts, test/runtime/codex-sdk.live.test.ts
  **Deps:** M0.4, M1.1
  **Accept:** mocked cases: thread/start gets {model, mapped effort};
  run() gets req.task; resume path used when session set;
  TurnResult.session = {runtime:'codex', id}; live file skips (not fails)
  without the credential and runs runConformanceSuite with it; `pnpm test
  && pnpm build` green.
  **Demo:** Second Runtime returns real TurnResults.
  **Read:** research/2026-07-03_runtime-layer.md (Codex); src/runtime/types.ts;
  docs/loop.md §2.
  **Session:** opus, single session — SDK-shape risk.

- [ ] **M10.2 Codex gate mapping + context-channel resolution**
  **Goal:** Map Codex approval events → hooks.gate (denial →
  blocked_on_gate + escalations); resolve architecture §12.1 in code:
  per-thread instructions if exposed, else the specified fallback —
  worktree AGENTS.md overlay masked via `.git/info/exclude` (never
  .gitignore) — built as a shared `worktree-context.ts` helper (pi reuses
  it). Mark §12.1 resolved with a dated note. Conformance via the shared
  harness — no hand-copied case lists.
  **Files:** src/runtime/adapters/codex.ts, src/runtime/worktree-context.ts,
  test/adapters/codex.test.ts, test/runtime/worktree-context.test.ts,
  docs/architecture.md (§12.1 note)
  **Deps:** M10.1, M0.4
  **Accept:** test/adapters/codex.test.ts calls
  runConformanceSuite('codex-mocked', …) over the shared cases (grep: no
  duplicated CRITICAL_CASES list); worktree-context test proves overlay +
  .git/info/exclude entry in a temp repo; §12.1 carries "resolved <date>";
  `pnpm test && pnpm typecheck`.
  **Demo:** Codex enforces the same gate ClaudeRuntime proves.
  **Read:** docs/architecture.md §5 (injection table), §12.1;
  research/2026-07-03_runtime-layer.md.
  **Session:** opus, single session — safety-critical wiring + a design
  resolution.

- [ ] **M10.3 PiRuntime core (`createAgentSession` + context injection)**
  **Goal:** Happy path via pi SDK createAgentSession: model/effort routing
  incl. a models.json-routed non-Anthropic/OpenAI model (the all-pi
  profile's point); resume by session id; context via
  `.pi/APPEND_SYSTEM.md` written through worktree-context (same masking).
  Env-gated live conformance file mirroring M1.2's pattern.
  **Files:** src/runtime/adapters/pi.ts, package.json,
  test/adapters/pi.test.ts, test/runtime/pi-sdk.live.test.ts
  **Deps:** M10.2
  **Accept:** mocked cases: both a native and a models.json-routed model
  pass through; APPEND_SYSTEM.md written with taste layers via
  worktree-context; resume uses session.id; live file skips without
  credentials; `pnpm test && pnpm build`.
  **Demo:** Third Runtime, including the exotic-model path.
  **Read:** research/2026-07-03_runtime-layer.md (pi); docs/PURPOSE.md →
  single-runtime orgs.
  **Session:** opus, single session.

- [ ] **M10.4 pi gating extension — GateFn on pi tool events**
  **Goal:** The TS extension intercepting pi tool events and enforcing the
  same GateFn (pi has no native approval flow — the known work item from
  PURPOSE). Wired into PiRuntime.runTurn; conformance via the shared
  harness; delegation.allow on pi must not silently fake subagent fan-out
  — documented capability error or telemetered no-op, never a lie.
  **Files:** src/runtime/adapters/pi-gate.ts, src/runtime/adapters/pi.ts,
  test/adapters/pi-gate.test.ts
  **Deps:** M10.3, M0.4
  **Accept:** runConformanceSuite('pi-mocked', …) passes over the shared
  cases with identical verdicts + rule names; the no-silent-fanout case;
  `pnpm test` green.
  **Demo:** The all-pi profile has the real gate, unlocking every model pi
  can route.
  **Read:** research/2026-07-03_runtime-layer.md (pi risk #1); AGENTS.md
  (conformance rule); docs/PURPOSE.md → single-runtime orgs.
  **Session:** opus, single session — safety-critical.

- [ ] **M10.5 Capability matrix + restore cross-provider pairing**
  **Goal:** `docs/capability-matrix.md`: rows {gate enforcement, context
  channel, session resume, large-payload transport, intra-turn fan-out} ×
  columns {claude, codex, pi}, each cell native/adapter-built/degraded
  with a file:line pointer into real adapter code. Then the M6.1 revert:
  proposal PR restoring builder to a Codex model (per M1.1's verified IDs)
  and reinstating the strict cross-provider test case.
  **Files:** docs/capability-matrix.md, AGENTS.md (Map row), roles.yaml +
  test/roles.test.ts (via PR)
  **Deps:** M10.1–M10.4, M6.1
  **Accept:** `grep -q 'no native intra-turn subagent fan-out'
  docs/capability-matrix.md`; AGENTS.md Map gains the row; open PR
  restores cross-provider builder/reviewer + strict test (green on
  branch); `pnpm test` green.
  **Demo:** "What does an all-pi org lose?" is one table; the pilot
  expedient is repaid.
  **Read:** docs/PURPOSE.md → capability matrix requirement; AGENTS.md
  (builder≠reviewer rule).
  **Session:** sonnet, single session.

### M11 — Second app: buildstacks.dev *(DEFERRED POST-LAUNCH — not part of the buildable product)*

> **Deferred (decided 2026-07-05, with the civic hold):** the product is
> build-complete at **M10**. Everything M11 proved functionally is covered
> earlier against the sandbox apps: join-not-fork + "apps.yaml is the ONLY
> Operon-repo change" moved into M3.7's sandbox-beta join; the approval
> queue's end-to-end acceptance moved to **M7.14** (it never needed a
> production app). What remains below is production onboarding of a real
> second app — a launch activity, like the civic pilot, executed with the
> human when the product is ready.

- [ ] **M11.1 Onboard buildstacks.dev as app #2** *(post-launch)*
  **Goal:** Create the buildstacks.dev repo (private, human co-drives the
  gh commands — repo creation is itself the kind of op the org gates);
  run `operon bootstrap` inside it; join the existing org (M3.5 path) as
  `status: onboarding`; flip to live only with the human. Zero Operon
  code changes permitted — the whole point (PURPOSE v0.8: second app =
  config file, not a fork).
  **Files:** apps.yaml; (in the new repo:) .operon/**
  **Deps:** M3.5, M6.3 (loop v1 solid on a real repo first — PURPOSE
  sequencing; sandbox-beta already exercised the join path, and civic's
  onboarding is deferred to pre-launch per the M3 header note)
  **Accept:** `git -C ~/Build/Operon diff --stat` shows apps.yaml as the
  ONLY Operon-repo change; `pnpm dev apps` lists buildstacks; bootstrap
  emitted .operon/ tree verifiable by ls; suites green.
  **Demo:** Second app onboarded without touching org code — config-not-
  fork proven.
  **Read:** docs/PURPOSE.md → Validation and launch path; docs/architecture.md §9
  (join).
  **Session:** sonnet, single session + human present.

- ~~**M11.2 SRE/approval surface exercise**~~ → moved to **M7.14** (the
  approval-queue end-to-end acceptance runs against a sandbox app; it was
  only ever parked here because buildstacks was the first app whose ops
  were mostly critical). A production-flavored re-run on buildstacks can
  accompany M11.1 post-launch, but the functional acceptance is M7.14's.

## Open decisions (need the human)
No human decisions are open as of 2026-07-06. Build-time verification
questions remain in the relevant implementation items (for example Codex
context channel, Codex/pi structured output support, and provider cache knobs).

## Human's own items
- [ ] Archive the predecessor orchestrator repo
  (`~/Documents/Build/claude-loop-teams`) — stated 2026-07-03.

## Done
- 2026-07-06 — **operon-sandbox-gamma approved** as the third sandbox target
  for SRE/Support/Marketing real-functionality coverage: a tiny deployable
  HTTP service with `/health`, local/container deploy script as approval-drill
  target, and seeded synthetic feedback/adoption events. Created and
  smoke-tested in M8.5; nothing outward-facing is published in tests.
- 2026-07-06 — **Architecture + loop decisions ratified**: dispatcher ticks,
  approval grants, idempotency rules, org-managed clones, `.operon/org/`
  layout, loop-owned merges, manual trigger kind, `.operon/` containment,
  file-drop company events, pass pipelines, mechanical gates, Planner
  pipelines, assembled briefs, ticket-level parallelism, loud failures,
  risk-selected review dimensions with security always-on, acceptance criteria
  as quality contract. Operational choices resolved: high-tier contracts stay
  autonomous in v1; deep milestone planning + lighter weekly groom; Lab role
  future opt-in; competitive intelligence as Marketing `ci-sweep`; 60-minute
  wall-clock cap; Support/Marketing disabled per app until channels exist;
  defaults accepted (`max_concurrent_turns: 2`, grant TTL 24 h, dispatch tick
  5 min, `maxCycles: 3`). Naming sweep deferred as non-urgent.
- 2026-07-04 — **"Next up" rebuilt into the comprehensive build plan** (74
  atomic items, milestones M0–M11) via multi-agent workflow: 10 subsystem
  analysts + a dependency mapper + a test strategist (66 draft items),
  top-tier synthesis and arbitration, then three adversarial validation
  passes (atomicity/testability, doc-coverage diff against
  architecture.md + loop.md, semantic dependency check) plus a mechanical
  graph check — all findings fixed. Notable arbitrations: telemetry.ts
  stays as the per-turn cost ledger beside the runlog layers; gate-
  remediation exhaustion routes to op:returned (op:blocked reserved for
  approval waits); a hung-SDK wall-clock-kill item added (M7.11);
  security-deep/perf review passes seeded (M2.2) and wired (M6.2);
  loop-brief [memory] wiring owned (M9.3); retro curation/skills item
  added (M9.6). Old item 3 (private GitHub repo) was stale —
  buildstacks-dev/Operon already exists; superseded by the sandbox-repo
  strategy (M5.8).
- 2026-07-04 — **Review-feedback pass (the human's [BG] comments) resolved**:
  naming swept for external readers across README / docs / AGENTS.md / this
  file ("the human operator", "the predecessor orchestrator"; docs/PURPOSE.md
  naming sweep deferred as non-urgent on 2026-07-06); README mermaid architecture
  diagram + usage placeholder; dispatcher "how it decides" walkthrough
  (architecture §0 — async ticks, artifact-derived state, dependency-gated
  readiness); `.operon/` containment invariant + `schema_version`
  (architecture §1, §11.9); company-lifecycle events via file-drop inbox
  (architecture §2, §11.10); review dimensions risk-selected with security
  always-on at two depths (loop §4, §11.7); acceptance criteria as a
  human-touched quality contract (loop §5, §11.8).
- 2026-07-04 — **Loop doc extended after alignment review with the human**:
  observability restructured to his three-layer model (envelope / structured
  events with trace ids / local-only forensics, infra-vs-merit outcome
  codes, redaction-before-export) per the civic methodology doc
  `agentic-observability-and-logging.md`; issue-intake invariant added
  (only Planner pipelines apply `op:ready`; doc reconciliation is a
  groom/triage duty; vision/charter changes proposal-only); failure-mode
  catalog added (§13, 21 cases, four-terminal-outcomes rule); Lab role +
  competitive-intelligence takes recorded and later resolved on 2026-07-06.
- 2026-07-04 — **Loop redesigned as engineering-heavy** (`docs/loop.md` v0)
  after the human's review flagged the build-loop section as too thin. Full
  audit of the predecessor orchestrator (state model, session loop, gate
  engine, bounce mechanics, observability, sharp edges) → keep/change/drop
  inheritance table; pass pipelines with versioned prompts
  (`pipelines.yaml` + `prompts/`); brief assembler (ticket + spec excerpts
  + findings + memory, budgeted); mechanical quality gates
  (`.operon/policy.yaml`, twice at ship, GitHub-native review freshness);
  structured verdicts (no prose-driven control flow); tick-advanced ticket
  state machine; ticket-level parallelism via dependency edges; exact cost
  attribution. Planning broken out of the loop into Planner pipelines.
  Roadmap resequenced (pass executor + quality gates added as items 2 and
  4). Ratification items later resolved on 2026-07-06.
- 2026-07-04 — **Architecture doc landed** (`docs/architecture.md` v0): all
  nine required areas covered — dispatcher/scheduler (stateless tick, polling
  events, locks), turn lifecycle (journal, worktrees, resume-vs-restart
  table, idempotency rules), approval queue (files + grants), context
  assembly (TASTE layers → native channels), memory & scorecards (OKF
  bundles, weekly retro), multi-app (apps.yaml, budget enforcement),
  co-planning (`operon plan`), bootstrap, GitHub conventions (op:* labels,
  ticket format, PR/branch rules). §11 promotions + relevant §12 questions
  later resolved on 2026-07-06.
- 2026-07-04 — Approval channel (CLI queue, one-by-one review, audit trail),
  budget ($1K/month per app, configurable), and cadence (flexi, no
  restrictions) decided — docs/PURPOSE.md v0.9. No open decisions remain before
  the architecture doc.
- 2026-07-04 — Pilots + multi-app posture decided (docs/PURPOSE.md v0.8): civic =
  app #1 with real tasks as roadmap acceptance tests; buildstacks.dev = app #2
  (config-not-fork + SRE/approval proof); one-turn-one-app invariant;
  bootstrap artifact home (`.operon/` in product repo, org-home repo
  optional); TASTE layer semantics (org values / app charter / role craft).
  Resolved "first-app onboarding": civic already at
  `~/Build/Government/AgentSkill-CivicIntelligence`; the org starts operating
  on it at item 3.
- 2026-07-03 — Purpose iterated to v0.6 (all decisions in docs/PURPOSE.md → Status);
  TASTE.md v0; roles.yaml v0 (6 roles, cross-provider builder/reviewer);
  runtime contract + critical-ops gate v0 + conformance seed (16 tests green);
  roles loader; CLI (`roles`, `doctor`); repo scaffolded, git-initialized,
  committed; agent docs added (AGENTS.md, CLAUDE.md stub, this file).
