# Adding and updating runtime harnesses

> **Status 2026-08-07:** the replacement validation harness carries the full
> adapter proof: per-adapter transport doubles with self-tests
> (`tests/fixtures/adapters/`), the hermetic drift-guard pair
> (`tests/hermetic/cf-adapter-conformance/`), and the same two-turn walk
> against real adapters inside the human-triggered live campaign
> (`tests/live/campaign-live.test.ts`, cases CF-B02/03/04-L3 and CF-B24-L3).
> The two claims
> that were briefly archive-only are re-deposited offline (#334): the
> subagent gate-ordering probe (CF-B02/B03/B24-SUBGATE for the fan-out-claiming
> harnesses plus the pi CF-B04-DEGRADE degradation path) and the 300 KB
> payload-transport pin (CF-B02/B03/B04/B24-PAYLOAD), each with permanent seeded
> negative controls. The archived legacy suite stays archived and is never
> read.

*For agents and humans working on this repo. A **harness** (interchangeably:
runtime adapter) is what turns one provider's agent product — Claude Agent
SDK, Codex App Server, pi SDK, `cursor-agent` CLI — into a Cormidia `Runtime`. This doc is the
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
`codex-gate-bridge.ts`, `codex-gate-hook.ts`), `pi.ts` (+ `pi-gate.ts`),
`cursor.ts` (+ `cursor-process.ts`, `cursor-stream.ts`, `cursor-pricing.ts`,
`cursor-config.ts`, `cursor-gate-bridge.ts`, `cursor-gate-handshake.ts`,
`cursor-gate-hook.ts` — a CLI-headless harness splits wider than an SDK one, and
the size/export ratchet caps a new module at 10 exports / 300 lines),
`opencode.ts` (+ `opencode-server.ts`, `opencode-config.ts`,
`opencode-session.ts`, `opencode-gate-bridge.ts`, `opencode-gate-plugin.ts`,
`opencode-gate-client.ts`), and
`grok.ts` (+ `grok-acp-client.ts`, `grok-session.ts`, `grok-gate-bridge.ts`,
`grok-gate-hook.ts`, `grok-isolation.ts`, `grok-tool-actions.ts`,
`grok-turn.ts`) — **sandbox-only while #339's human risk review is open** — and
`muse.ts` (+ `muse-exec.ts`, `muse-usage.ts`, `muse-events.ts`,
`muse-gate-bridge.ts`, `muse-hook-router.ts`, `muse-managed-hooks.ts`,
`muse-gate-hook.ts`).

**A harness whose gate seam cannot be proven refuses; it does not degrade.**
`muse` is the worked example and the standing rule: `muse exec` auto-approves
tool calls headlessly, and its managed-hook seam did not fire on the certified
build, so the adapter proves the seam at the start of every turn with a
token-free handshake and refuses (`error_gate_seam_unavailable`) when the proof
does not arrive. Its capability profile records `tool_gate: unsupported` and
`intra_turn_fanout: unsupported`, its L3 walk reports **incomplete** rather than
pass, and `roles.yaml` stays untouched
(`research/adapters/2026-08-07_muse-code-adapter-certification.md`). Never turn an
unproven gate into a best-effort one.

## 2. The contract a harness must honor

`src/runtime/types.ts` is authoritative, and its ratified validation mirror
is `validation-design/contracts/provider-adapter-core.md`
(**CORMIDIA-C-CORE-001**), shared by the per-adapter boundaries (B-02
Anthropic, B-03 Codex, B-04 pi) whose files carry only deltas. These are the
parts adapters get wrong first:

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
- **Enforce the per-turn budget cap at the finest truthful observation point
  the provider exposes.** `maxTurnBudgetUsd` → `failed` +
  `errorCode: "error_max_budget_usd"` + exactly one incident note, with spend
  still attributed. Budget exhaustion never masquerades as a generic failure or
  an auth escalation. Where the provider streams usage this is a running guard
  that stops the turn mid-run; where it reports usage only in the terminal
  result (Cursor) it is a turn-boundary check, `costEnforcementFor` says so, and
  no surface may imply a hard mid-run ceiling (INV-008).
- **Terminal provider failures are evidence, not completions.** Preserve the
  non-success result and its usage; never fabricate successful zero-token
  work. Classify auth-like failures (`error_auth`) distinctly.
- **Transport the task as a payload, not argv.** Briefs reach 300 KB; the
  CF-B02/B03/B04/B24-PAYLOAD pin in the replacement harness proves intact
  transport per adapter (the ARG_MAX lesson, `docs/loop/design.md` §2).
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

**Before any code, two obligations:**

- **Pick the integration surface from the vendor's canonical docs, on
  record.** A dated `research/` reference states the chosen surface (SDK vs
  CLI-headless vs server protocol), the pinned version, auth model, and risk
  flags, with fetch-verified sources — the current survey is
  `research/adapters/2026-08-06_adapter-upstream-references.md`. Vendors that ship via
  installer scripts (Cursor, Grok Build, Muse Code) are *required
  preinstalled binaries*: the adapter never installs a provider (#224) and
  readiness means usable auth, not binary presence alone.
- **A new harness is a new validation boundary** — a structural addition to
  the ratified design, not a case-level change. Re-enter the
  `validation-harness-design` skill in `harness-revision` mode with the
  existing artifacts as baseline to land the boundary contract
  (`contracts/B-*.md` referencing CORMIDIA-C-CORE-001), catalog rows, and
  lane tags first. If the skill is unavailable, stop and escalate — do not
  improvise the boundary (root AGENTS.md → Validation harness → Structural
  additions).

Then work through these in order; each is a compile error, test failure, or
review blocker if skipped:

1. **`src/runtime/types.ts`** — extend the `RuntimeKind` union.
2. **`src/runtime/adapters/<name>.ts`** — implement `Runtime`. Study the
   nearest-shaped existing adapter first (in-process SDK → `pi.ts`;
   subprocess JSON-RPC → `codex.ts`; owned-CLI SDK → `claude.ts`; headless CLI
   over stdio streams → `cursor.ts`).
3. **`src/runtime/registry.ts`** — add the construction entry. `RUNTIME_KINDS`
   is derived from that exhaustive record, so it cannot drift; the enum that
   still needs a hand edit is `TURN_ASSIGNMENT_HARNESSES` in
   `src/runtime/assignment.ts`, which every schema and validator reads. Then
   sweep the branches a new kind falls through silently rather than failing to
   compile: `costEnforcementFor`, `permissionModeFor`,
   `configuredProviderFamily`, and the `sessionEvidence` builders in
   `src/loop/pipeline.ts` and `src/org/episode-planner/runtime.ts`.
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
   presence (`cormidia doctor` runs this; an expired credential must fail here,
   not inside a paid model turn).
6. **`src/runtime/auth-mode.ts`** — declare the harness's auth support (#333):
   which of `subscription` / `api_key` it can be reached under, whether it is a
   multi-provider backbone (a per-provider-family declaration is accepted only
   there), its canonical provider family, and the **token-free** method that
   reads the real credential state. `HARNESS_AUTH_SUPPORT` is exhaustive over
   `RuntimeKind`, so a new kind is a compile error until it is declared. A mode
   the vendor does not offer must be ABSENT from `modes` — that is what makes
   the declaration refusable at config load rather than at a probe (muse is the
   worked example: API key only). Then classify the credential state in
   `src/runtime/auth-mode-observers.ts` and return the observation from the
   readiness implementation. **Return NO mode when the facts do not determine
   one** — an indeterminate observation refuses a declaration; a guess about
   which account pays is the failure the whole path exists to prevent. Where
   the harness accepts two credentials at once, mirror the ADAPTER's own
   precedence if it has one (grok: `XAI_API_KEY` wins) and report
   indeterminate if it does not (cursor, first-party claude).
7. **`src/runtime/harness-support.ts`** — declare the version bands (#331):
   `floor` (oldest version whose external interface the adapter actually
   speaks — below it readiness refuses before the provider is constructed),
   `testedWith` (the exact version certification ran against, §5), and
   `testedEvidence` (its dated `research/` record). `HARNESS_SUPPORT` is an
   exhaustive `Record<RuntimeKind, …>`, so a new kind is a compile error
   until its bands exist — deliberately: a harness with no floor has no
   refusal. The floor is a real interface claim, not a copy of the pin;
   day-one adapters use stable, widely-available surfaces, so the floor
   usually sits at or below `testedWith`, never above it. Version detection
   is token-free and belongs in the declaration's `versionSource`.
8. **Tests** — all three tiers plus the budget pin (§4), and the auth-mode
   cases: each declared mode matching its credential is ready, each mismatch
   direction is a typed refusal, and an impossible mode is refused by
   construction (`tests/unit/cf-auth-mode/`).
9. **`docs/harness/capability-matrix.md`** — add the adapter's column with honest
   native/adapter-built/degraded labels per row, and its row in the auth-mode
   table (which modes it supports, whether per-provider-family declarations
   apply, and the exact token-free verification). The matrix is the contract
   for what an org loses when a role moves; "degraded" written down is fine,
   "native" claimed loosely is not.
10. **`roles.yaml`** — assigning any role to the new runtime is a
    human-ratified change: propose with rationale, never silently rewrite.
    The builder ≠ reviewer cross-provider pairing in `test/roles.test.ts` is
    a design decision — if it fails, the roles change is wrong, not the test.
    Auth mode is NOT a role field: it is org configuration keyed by connection
    (`apps.yaml` → `harnesses:`), so nothing about #333 touches this file.
11. **`research/`** — record the dated live-conformance result (see §6).
12. **AGENTS.md** — update `src/runtime/AGENTS.md` (the local rules file)
    and the root AGENTS.md dependency list if a new package was added (a new
    dependency is a decision, not a convenience — TASTE.md §3).

## 4. What proves a harness — the three test tiers

> **Worked example (2026-08-07, #338):** the Cursor harness is the first adapter
> to go through this checklist end to end after the replacement harness landed.
> Two lessons generalize. First, a new `RuntimeKind` slides silently into
> `if claude … else if codex … else` branches that compile fine and answer for
> the wrong provider — `costEnforcementFor`, `permissionModeFor`,
> `configuredProviderFamily`, and the `sessionEvidence` builders all needed an
> explicit arm, and the two literal harness enums are now derived from
> `TURN_ASSIGNMENT_HARNESSES` instead of restated. Second, live certification
> earned its keep: it caught a config-schema refusal that exited the CLI before
> any turn, and a stdout-close race that swallowed the resulting diagnostic and
> reported a bare `failed` turn with no reason. Neither was reachable against a
> double, and both now have offline detectors
> (`research/adapters/2026-08-07_cursor-adapter-certification.md`).

| Tier | Where | Runs in | Proves |
| --- | --- | --- | --- |
| L1 — transport double + self-test | `tests/fixtures/adapters/<name>-double.ts` + `<name>-double.test.ts` | `pnpm test` | The scripted transport speaks the provider's real wire shapes; the scenario DSL (`tests/fixtures/adapters/scenario.ts`) expresses tool calls, **subagent attribution**, session identity, usage, and failure outcomes |
| L2 — hermetic conformance walk | `tests/hermetic/cf-adapter-conformance/` | `pnpm test` | The exact two-turn walk (`tests/fixtures/adapters/conformance.ts`) against the scripted transport: gate denial is terminal and observed, exact native-session resume, usage never marked mechanical — with a **seeded liar** proving each detector fires |
| L3 — live certification walk | `runAdapterConformance()` (CF-B02/03/04-L3, CF-B24-L3) inside `tests/live/campaign-live.test.ts` | `pnpm test:live` (human-triggered, spends tokens) | The same walk against the real provider in exactly two turns — the only proof the gate claim holds outside a double |

Rules that keep the tiers meaningful:

- **The walk is shared.** A new adapter contributes its transport double and
  target wiring; the walk itself is reused verbatim, so a failure isolates to
  the adapter, never the contract.
- **Extend cases; never weaken one to make an adapter pass.** Every new gate
  rule gets both a critical case and a routine near-miss (the
  `tests/unit/cf-split-*` suites are the pattern).
- **Negative controls are mandatory.** A detector that has never fired is an
  assumption; the seeded-liar pattern in the pair test is the template.
- **No role goes live** on an adapter before the L3 walk passes and its dated
  `research/` record lands.
- **Live lanes obey policy spend bounds**
  (`docs/qualification/host-policy.yaml`: pre-merge changed-adapter ≤2
  turns/$5). Ceiling exhaustion reports incomplete — never green.

## 5. Certification without the product — the fast lane

Adapter integration must never wait on the whole org/app/loop pipeline. An
adapter is **certified standalone**: a temp git workdir, usable auth, and a
bounded number of provider turns — no org home, no app onboarding, no
scheduler, no tickets. Composition risk (orchestrator + gate + settlement
around the adapter) dies in L2 where it costs nothing; the product's own
journeys are *qualification's* concern, not certification's.

The certification ladder, cheapest first:

1. **Readiness** (`src/runtime/readiness.ts`, surfaced by `cormidia doctor`)
   — usable request authentication, and for installer-shipped vendors the
   preinstalled binary. Configuration presence is never readiness.
2. **Provision + one real call** — the L3 walk's first turn already proves
   launch, payload-safe task transport, a real model response, and honest
   usage settlement.
3. **Per-capability probes** — every tier declared in
   `src/runtime/capabilities.ts` is proven at the declared tier, and only at
   the declared tier (no green by absence; `unsupported` proves its
   degradation artifact instead):

   | Capability | Probe |
   | --- | --- |
   | `tool_gate` | denied tool action → `blocked_on_gate` + escalation, gate observed (the walk) |
   | `session_resume` | second turn resumes the exact prior session id (the walk) |
   | `structured_verdict` | schema round-trip (native/adapter) or lenient-parse fallback exercised |
   | `cancellation` | abort mid-turn → `cancelled`/`timed_out`, partial usage preserved |
   | `cache_telemetry` | declared cache fields present and plausible on a warm second turn |
   | `intra_turn_fanout` | **the load-bearing probe**: a spawned subagent's critical op reaches the gate identically (event → gate → escalation ordering); `unsupported` proves the serial-degradation note instead — and, where the harness *has* a reachable spawn tool, proves the adapter DENIES it (grok, B-25) rather than leaving an ungated route open |

   The budget guard (`error_max_budget_usd`, exactly one incident note, spend
   still attributed) is pinned offline against the double — never live.
4. **Representative-model smokes** — for multi-model backbones (pi,
   OpenCode), certify one or two models per provider family and publish the
   full roster through the harness's own catalog
   (`src/runtime/model-catalog.ts`). Certification is per harness surface,
   not per model.

**Certification ≠ qualification.** Certification proves the adapter works and
its declared capability tiers are honest — standalone, spend-bounded,
repeated on every version bump. Qualification proves a specific
harness/model/effort tuple does a *role's job well* — that is the L4
campaign machinery: per-candidate, human-authorized, and unchanged by this
section. Publishing a model in a roster never assigns it to a role;
`roles.yaml` ratification plus qualification evidence remain the only path to
live work.

## 6. Updating an existing harness

Minimum bar for **any** `src/runtime/adapters/**` change:

1. `pnpm test && pnpm typecheck` (seconds).
2. `pnpm test:live` — and record the dated result in `research/`. The live
   run is the only proof the gate claim still holds outside a double; the
   research record is what makes that proof citable later.
3. On a **version bump** of a provider package, re-read the vendor's current
   docs before touching code (fast-moving uploads break SDK/RPC surfaces —
   pi warns about this explicitly), re-run certification (§5), and re-check
   every capability tier the bump could move (e.g. an effort level or
   fan-out surface appearing upstream). **Move `testedWith` in
   `src/runtime/harness-support.ts` to the exact version certification just
   ran against, and point `testedEvidence` at its dated `research/` record**
   — the declaration is what `cormidia doctor` reports and what the drift
   note is measured from, so a bump that leaves it behind makes the tool lie.
   Raise `floor` only when the adapter genuinely stopped speaking the older
   interface; a floor raised to match the pin refuses operators who have not
   upgraded, which is exactly what bands exist to avoid.
4. If a capability's tier or behavior changed, update the matching
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

### 6.1 Upstream freshness automation — what it does and does not do

Versions, model rosters and prices drift on the vendor's schedule, not ours
(pi shipped ~19 releases in seven weeks), and a manual refresh loses to
schedule pressure. `scripts/harness-freshness.mjs` (#332) closes that loop
without spending a token: it fetches each harness's declared upstream sources,
diffs them against `src/runtime/harness-metadata.json` — the one machine-readable
home for those drifting facts — and, on a delta, opens **one** pull request for
a human to read and merge. A GitHub Actions schedule
(`.github/workflows/harness-freshness.yml`) runs it weekly; `pnpm harness:freshness`
runs it by hand.

**It never moves a band.** Version drift against `testedWith` is REPORTED and
nothing more, because moving the band is a claim that certification ran against
that version — obligation 3 above, in full. The probe reads
`harness-support.ts`; it never writes it. The same rule covers the ratified
surfaces: a roster change becomes a `roles.yaml` **proposal in the pull-request
body**, never an edit. And a source the probe could not read is a typed
FAILURE with a non-zero exit, never a quiet "no changes" — an unreadable
upstream must never be mistaken for a current one.

So the obligations above are unchanged by the automation. What changes is who
notices: the pull request tells you a bump exists and what moved with it; §6.3
and §5 are still what you owe before `testedWith` follows.

Prices the probe extracts from a vendor page are **proposals**, shown old → new
per field. It reads figures positionally in the order a harness declares in
`pricing.fields`, so a reordered vendor table yields wrong numbers rather than
an error — which is exactly why nothing merges itself. Offline coverage,
including the seeded stale-snapshot and unreadable-source negative controls,
is `tests/unit/cf-reg-332/` over the recorded corpus in
`tests/fixtures/harness-freshness/`.

## 7. What the agent inside a turn knows

Every assignment-aware provider turn now carries a small **Turn execution
facts** section through the ordinary `ContextBundle` native channel. It names
the role and atomic harness/model/effort assignment, then renders every
machine-profile surface with its honest tier:

- `native` — the harness exposes the surface directly;
- `adapter-built` — Cormidia's adapter supplies it;
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
[#116](https://github.com/cormidia/Cormidia/issues/116); publication is
still required before the issue can be called completed.

## 8. Command reference

| Purpose | Command |
| --- | --- |
| Offline lanes (L1 doubles + L2 hermetic walk) | `pnpm test` |
| Typecheck | `pnpm typecheck` |
| Live certification walk (human-triggered; spends tokens) | `pnpm test:live` |
| Adapter readiness without a model turn | `cormidia doctor` / `pnpm dev doctor` |
| Capability profiles as the org sees them | `cormidia capabilities` |
| Upstream surface survey (dated) | `research/adapters/2026-08-06_adapter-upstream-references.md` |
| Cursor certification record (dated) | `research/adapters/2026-08-07_cursor-adapter-certification.md` |
| Grok Build certification + F-PT-027 disposition | `research/adapters/2026-08-07_grok-build-adapter-certification.md` |
