# Adding and updating runtime harnesses

*For agents and humans working on this repo. A **harness** (interchangeably:
runtime adapter) is what turns one provider's agent product — Claude Agent
SDK, Codex App Server, pi SDK — into an Operon `Runtime`. This doc is the
procedure: what a harness must implement, where it registers, what proves it,
and what an update obligates. The per-capability contract itself lives in
[`capability-matrix.md`](capability-matrix.md); accounting rules live in
[`docs/episodes/contract.md`](../episodes/contract.md); this doc does not restate them.*

## 1. What a harness is

A harness is one file under `src/runtime/adapters/` implementing the
`Runtime` interface from `src/runtime/types.ts`:

```ts
interface Runtime {
  readonly kind: RuntimeKind;
  runTurn(req: TurnRequest, hooks: TurnHooks): Promise<TurnResult>;
}
```

Everything above it — loop, org, approvals, telemetry settlement — is
provider-neutral and reaches providers only through this seam. The import
direction is one-way (`src/org` → `src/loop` → `src/runtime`; the runtime
layer imports nothing above it), which is what keeps harnesses swappable and
the loop extractable. Current harnesses: `claude.ts`, `codex.ts` (+
`codex-gate-bridge.ts`, `codex-gate-hook.ts`), `pi.ts` (+ `pi-gate.ts`).

## 2. The contract a harness must honor

`src/runtime/types.ts` is authoritative; these are the parts adapters get
wrong first:

- **Gate every tool action — including subagents.** `TurnHooks.gate` MUST be
  consulted for every tool action the provider attempts, including actions
  issued by intra-turn subagents. Denied critical ops become `escalations`
  on the `TurnResult`, never silent drops. This is the claim the conformance
  suite exists to prove.
- **Emit events through the shared builders.** `tool_use` events are built by
  the ONE shared builder in `src/runtime/tool-events.ts` so the
  `environment_retry` classification cannot drift per adapter. Subagent
  lifecycle uses paired `started`/`completed` events with a `spanId`.
- **Report progress durably.** `TurnHooks.onProgress` carries monotonic
  cumulative usage and the session handle so a crash or cancellation before
  the final result still settles real spend.
- **Label usage quality honestly.** `TurnUsage.quality` is
  `complete | partial | estimated | unavailable`. Estimated cost (Codex) is
  flagged `costEstimated: true`; unknown spend is never silently zero;
  `unavailable` keeps its typed cause and is never coerced or retried as a
  merit miss (`docs/episodes/contract.md`).
- **Enforce the per-turn budget cap as a running guard.** `maxTurnBudgetUsd`
  stops the turn mid-run → `failed` + `errorCode: "error_max_budget_usd"` +
  exactly one incident note. Budget exhaustion never masquerades as a generic
  failure or an auth escalation.
- **Terminal provider failures are evidence, not completions.** Preserve the
  non-success result and its usage; never fabricate successful zero-token
  work. Classify auth-like failures (`error_auth`) distinctly.
- **Transport the task as a payload, not argv.** Briefs reach 300 KB; the
  conformance suite pins intact transport (the ARG_MAX lesson,
  `docs/loop/design.md` §2).
- **Redact with the shared list.** Secret patterns come only from
  `src/runtime/secret-patterns.ts` — redaction and quality gates import the
  same list.
- **Shape role toolsets where the provider allows.** Builder/Reviewer deny
  rules come from `src/runtime/role-shaping.ts`; on providers without a
  native deny surface, the composed gate's flat role deny is the enforcement
  (see the matrix's "Role toolset shaping" row for what each tier means).
- **Advertise capabilities through shared context.** Do not inject
  harness-specific prompt prose in an adapter. `runtimeCapabilityProfile()` is
  the machine source for both preflight and the required per-turn execution
  note. `renderContextBundle()` derives concise native / adapter-built /
  fallback (degraded) / unsupported guidance from that profile and combines it
  with the role's existing delegation allowlist. The note grants no tool,
  permission, or approval authority.

## 3. Adding a new harness — registration checklist

Work through these in order; each is a compile error, test failure, or review
blocker if skipped:

1. **`src/runtime/types.ts`** — extend the `RuntimeKind` union.
2. **`src/runtime/adapters/<name>.ts`** — implement `Runtime`. Study the
   nearest-shaped existing adapter first (in-process SDK → `pi.ts`;
   subprocess JSON-RPC → `codex.ts`; owned-CLI SDK → `claude.ts`).
3. **`src/runtime/registry.ts`** — add the construction entry and extend
   `RUNTIME_KINDS`.
4. **`src/runtime/capabilities.ts`** — declare the
   `RuntimeCapabilityProfile`: per-capability
   `native | adapter | fallback | unsupported` (including
   `intra_turn_fanout`) plus observable cache fields.
   `src/loop/context-manifest.ts`, `src/loop/preflight.ts`, and the agent's
   profile-derived execution note consume this — it is a functional input,
   not documentation. `unsupported` fan-out must stay explicitly absent; do
   not label a post-turn degradation note as a working fan-out surface.
5. **`src/runtime/readiness.ts`** — add a readiness implementation. Readiness
   means **usable request authentication**, never configuration or account
   presence (`operon doctor` runs this; an expired credential must fail here,
   not inside a paid model turn).
6. **Tests** — all three tiers plus the budget pin (§4).
7. **`docs/harness/capability-matrix.md`** — add the adapter's column with honest
   native/adapter-built/degraded labels per row. The matrix is the contract
   for what an org loses when a role moves; "degraded" written down is fine,
   "native" claimed loosely is not.
8. **`roles.yaml`** — assigning any role to the new runtime is a
   human-ratified change: propose with rationale, never silently rewrite.
   The builder ≠ reviewer cross-provider pairing in `test/roles.test.ts` is
   a design decision — if it fails, the roles change is wrong, not the test.
9. **`research/`** — record the dated live-conformance result (see §5).
10. **AGENTS.md** — update `src/runtime/AGENTS.md` (the local rules file)
    and the root AGENTS.md dependency list if a new package was added (a new
    dependency is a decision, not a convenience — TASTE.md §3).

## 4. What proves a harness — the three test tiers

| Tier | Where | Runs in | Proves |
| --- | --- | --- | --- |
| Per-adapter unit tests | `test/adapters/<name>.test.ts` | `pnpm test` | Adapter-specific mechanics: event mapping, gate bridging, session handling, error classification |
| Budget-guard pin | `test/runtime/<name>-budget.unit.test.ts` | `pnpm test` | Under/over-budget split, the single incident note, spend still attributed (mocked SDK) |
| Conformance suite | `runConformanceSuite(name, makeRuntime, opts)` from `test/conformance/harness.ts` | `pnpm test` (mocked) | The adapter-generic contract: critical ops escalate with the tripped rule named, routine ops pass, a **subagent** critical op is caught identically (event → gate → escalation ordering), 300 KB payload transports intact |
| Live conformance | `test/runtime/<name>.live.test.ts` | `pnpm test:live` (opt-in, spends tokens) | The same claims against the real provider — the only proof the subagent-gate claim holds outside a mock |

Rules that keep the tiers meaningful:

- `test/gate.test.ts` is the seed of the conformance cases. **Extend cases;
  never weaken one to make an adapter pass.** Every new gate rule gets both
  a critical case and a routine near-miss.
- The conformance suite is driven by `ScriptedTurn`
  (`src/runtime/testing/fakeRuntime.ts`) and proven against `FakeRuntime` in
  `test/conformance/conformance.test.ts`; a new adapter supplies its own
  `makeRuntime` over a mocked SDK and reuses every case, so a failure
  isolates to the adapter, never the contract.
- No role goes live on an adapter before it passes the conformance suite
  end-to-end, including the subagent case (AGENTS.md working rule).
- Codex and pi live smokes are opt-in (`OPERON_CODEX_LIVE=1`,
  `OPERON_PI_LIVE=1`) because they spend provider quota and need local auth;
  `pnpm test` never runs any `*.live.test.ts`.

## 5. Updating an existing harness

Minimum bar for **any** `src/runtime/adapters/**` change:

1. `pnpm test && pnpm typecheck` (seconds).
2. `pnpm test:live` — and record the dated result in `research/`. The live
   run is the only proof the subagent-gate claim still holds; the research
   record is what makes that proof citable later.
3. If a capability's tier or behavior changed, update the matching
   `docs/harness/capability-matrix.md` row **in the same change**, and the
   `RuntimeCapabilityProfile` if the machine-readable tier moved.

Additional obligations by blast radius:

- **Qualification evidence.** Adapter executor bytes are covered by Phase 6
  campaign hashes: a change to covered bytes means retained calibration
  campaigns remain historical evidence but cannot admit a new candidate by
  resemblance — a fresh, separately authorized adapter admission campaign is
  required (`docs/harness/qualification-evidence.md`,
  `docs/DEVELOPMENT.md`). Never rerun or repair a terminal campaign; never
  run `eval:github`/`eval:live` merely because adapter files changed.
- **Known limitations are documented, not hidden.** A gate-enforcement gap
  that can't be closed adapter-side (e.g. #20, the Codex App-Server trusted
  read-only bypass, `blocked:upstream`) gets a capability-matrix caveat and a
  README Known-limitations entry, and stays an open issue until a
  live-verified fix lands.
- **Model IDs** in `roles.yaml` are human-ratified against live catalogs
  (latest refresh: `research/2026-07-15_model-assignment-refresh.md`).
  Adapter work that changes which models are reachable re-opens that
  ratification, it doesn't edit around it.

## 6. What the agent inside a turn knows

Every assignment-aware provider turn now carries a small **Turn execution
facts** section through the ordinary `ContextBundle` native channel. It names
the role and atomic harness/model/effort assignment, then renders every
machine-profile surface with its honest tier:

- `native` — the harness exposes the surface directly;
- `adapter-built` — Operon's adapter supplies it;
- `fallback (degraded)` — a weaker deterministic fallback exists; and
- `unsupported` — the turn is told not to rely on the surface.

The note also marks the runtime capabilities required by this turn and states
the role's existing delegation allowlist. If the selected harness cannot fan
out, the note says that explicitly and directs the agent to work serially even
when the portable role configuration names subagent types.

The data flow is single-source and fail-closed:

1. `runtimeCapabilityProfile(harness)` owns support tiers, including
   `intra_turn_fanout`.
2. `buildTurnExecutionFacts(...)` derives the supported-name projection and
   intersects deterministic turn requirements with that profile. Callers
   cannot author capability prose or claim an unsupported surface.
3. `renderContextBundle(...)` derives the concise note from the same profile.
4. `src/loop/context-manifest.ts` records it as a required, never-evicted
   `(runtime, role)` component with a content-stable `cacheIdentity`.
5. The adapter revalidates assignment, role, and delegation against its
   `TurnRequest` before crossing the provider boundary.

This advertises existing affordances only. It does not load filesystem skills,
slash commands, plugins, MCP servers, or user settings; Claude remains
hermetic with `settingSources: []`. Gates, role-shaping denies, and approval
boundaries remain the enforcement, and `prompts/**` stay runtime-agnostic.
This mechanism implements the repository side of
[#116](https://github.com/buildstacks-dev/Operon/issues/116); publication is
still required before the issue can be called completed.

## 7. Command reference

| Purpose | Command |
| --- | --- |
| Offline suite (all three tiers, mocked) | `pnpm test` |
| Typecheck | `pnpm typecheck` |
| Live conformance (spends tokens; Codex/pi opt-in) | `pnpm test:live` |
| Adapter readiness without a model turn | `operon doctor` / `pnpm dev doctor` |
| Capability profiles as the org sees them | `operon capabilities` |
