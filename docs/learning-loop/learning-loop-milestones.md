# Learning Loop - Milestones

**Status:** Draft v0.3 - aligned to code audit of 2026-07-07  
**Companions:** `learning-loop-design.md`, `learning-loop-spec.md`

The cadence follows one rule:

> Autonomy is earned by measurement, never granted by release.

V1 should make the loop useful and safe with a human at every gate. Later
versions remove humans from individual gates only when V1 evidence shows the
machine agrees with them.

## Preflight - Repair the Evidence Plumbing

These fixes come before the learning loop becomes authoritative, because bad
evidence teaches bad lessons.

Every item below is a confirmed defect, verified against the code on
2026-07-07. Anchors are included so each item is implementable as a ticket
without re-discovery.

**Ships:**

- **Event fan-out fix**: one file-drop event that matches multiple roles must
  not be consumed after the first spawned turn.  
  *Anchor:* `src/org/dispatch.ts` slices due turns to WIP capacity
  (`due.slice(0, capacity)`), then `markConsumed([turn.eventKey])` runs after
  each spawn — but co-subscribed roles share ONE `eventKey`, so the first
  spawn consumes it and the next tick's poll filters it out before the second
  role runs.  
  *Fix shape:* consume per `(eventKey, role)`, or defer `markConsumed` until
  every subscribed role has spawned or explicitly skipped. Test: two
  subscribers, `max_concurrent_turns` forcing the second onto a later tick.
- **Dispatched role briefs include the original event payload, with
  provenance.**  
  *Anchor:* dispatch spawns only `{role, app, turnId, runtimeHome}`;
  `protocolBrief` (`src/org/turn-runner.ts`) renders trigger metadata only.  
  *Fix shape:* persist the payload (or its inbox path) into the dispatch
  journal and spawn args; render into the brief with a provenance stamp. Also
  feeds the resolver's selection text (spec §8.1).
- **Stale `running` runlog envelopes are finalized or reported loudly.**  
  *Anchor:* no recovery exists anywhere; retention deliberately keeps
  `running` envelopes forever (`src/runtime/runlog/retention.ts`).  
  *Fix shape:* reconcile in the dispatch tick — `running` envelopes older
  than a threshold with no live lock finalize as `failed` with
  `error_code: "interrupted"`.
- **Runtime adapters emit enough `tool_use` events for the existing L2 bridge
  and tool-count anomaly detectors to work.**  
  *Anchor:* adapters emit only `subagent` events today
  (`src/runtime/adapters/claude.ts`, `codex.ts`); the L2 bridge in
  `src/loop/pipeline.ts` (`flushBridgedEvents`) is ready but receives no
  named `tool_use` events, so `tool_counts` stays empty, `bash_heavy` reads a
  constant 0, and nothing ever sets `category: "environment_retry"`.
- **Manual `loop` passes feed the telemetry ledger.**  
  *Anchor:* `recordTurn` is called from `src/org/turn-runner.ts` and
  `src/org/plan.ts` but never from `src/loop/pipeline.ts`, so loop-driven
  passes are invisible to `telemetry/*.jsonl`. Learning metrics would
  silently undercount exactly the builder/reviewer activity the loop most
  needs to learn from.
- **Human correction input path exists**, even if it starts as a JSON/markdown
  inbox.

**Done means:**

1. A support-feedback event can drive both Planner and Support across WIP-limited
   ticks.
2. Support/Marketing/SRE briefs can quote the original file-drop event payload.
3. `operon status` does not leave known-dead pass runs as silently `running`.
4. `bash_heavy` and `environment_retry` can fire from real adapter tool events.
5. `operon budget` accounts for passes run via `operon loop`.

## V1 - Solid Operon Loop, Human-Gated

V1 is complete enough to improve Operon without trusting automation too early.
Every activation or publication is human-approved.

**Ships:**

- `LearningEventSink` writing JSONL under `~/.operon/<org>/learning/events/`.
- Event projections from runlogs, quality gates, scorecards, approvals,
  telemetry, resolver loads, and human corrections — an idempotent projector
  with a persistent cursor over `runs/<app>/<runId>/`.
- End-of-turn protocol change (`src/org/context.ts`): agents emit learning
  notes as candidate input instead of writing active OKF docs directly
  (design §7.1).
- Gate rule: writes to `learning/bundle/**` and `learning/manifest.yaml` are
  critical ops, with `test/gate.test.ts` cases for the critical side and a
  routine near-miss.
- `runRetroCuration` retired; its skill-draft logic ported into the
  distiller's `skill_draft` destination.
- Distiller and learning-reviewer as `roles.yaml` entries (proposal PR;
  cross-provider from each other), triggered `daily 06:00` /
  `weekly mon 07:00` via the existing dispatch tick — no cron engine.
- `GhOps.createIssue` added for the `ticket` destination.
- Human approvals routed through the existing approvals store as a new item
  kind, surfaced in `operon approvals`.
- Destination-aware candidate artifacts:
  `okf_concept`, `skill_draft`, `protocol_proposal`,
  `eval_or_gate_proposal`, `ticket`, `reject`.
- Four V1 scopes only:
  `org`, `roles/<role>`, `apps/<app>`, `apps/<app>/roles/<role>`.
- Rejection ledger with suppression windows.
- Reviewer verdict schema with destination fit, scope fit, provenance, conflict,
  and injection screening.
- Human approval required for every V1 publish/activation.
- Active OKF concept bundle under `learning/bundle/**`, with manifests in org
  and app roots.
- Resolver integrated into context assembly:
  one `(app, role, turnId)` resolve, pinned for the whole turn/pipeline.
- `concept_loaded`, `context_evicted`, and `conflict_resolved` events.
- Context budget enforcement (bytes); T2/T3 concepts fail loud if they do not
  fit.
- Metrics as JSONL projections under `~/.operon/<org>/learning/metrics/` —
  no new dependency (`node:sqlite` is the later upgrade path on the Node 26
  floor).
- `operon learn report` with recurrence, loads, baseline evals, context budget,
  reviewer-human agreement, and rejection suppressions.
- Cache-stability conformance case: two back-to-back passes under the same
  pinned bundle show `cacheReadTokens > 0` on the second.
- Tests reuse `test/fixtures/orgHome.ts` and `test/fixtures/fakeClock.ts`.
- `operon learn disable <concept-id>` for surgical containment.
- `operon learn rollback --root org|app` for version rollback.
- Quarantine/provisional concepts authored by a human, TTL <= 14 days,
  explicitly labeled UNVERIFIED.
- Compaction report only: no automated deprecation PRs in V1.

**Explicitly out:**

- T0 auto-merge.
- Canary auto-execution.
- Identity scopes.
- Account scopes.
- Machine-authored provisionals.
- Automated contradiction-scanner PRs.
- Standalone npm package extraction.
- Non-GitHub stores.
- Dashboards beyond CLI reports.
- New npm dependencies (metrics are JSONL; SQLite only via built-in
  `node:sqlite` and only if reports measurably drag).
- Relevance ranking in the resolver (scope-based load-all first; spec §8.1).

**Done means:**

1. A seeded bad concept is disabled with `operon learn disable`, taking effect
   for every subsequently resolved turn immediately, while sibling concepts
   still resolve. (In-flight turns correctly keep their pin; the next resolve
   happens no later than the next dispatch tick.)
2. No active concept exists without a reviewer verdict and human approval.
   An agent attempt to write into `learning/bundle/**` is denied and
   escalated by the gate.
3. A candidate rejected once does not reappear inside the suppression window
   unless evidence crosses the configured threshold.
4. A learning event cluster from the marketplace assessment routes at least one
   item to a ticket, one to an OKF concept, and one to an eval/gate proposal.
5. Context assembly records the resolved bundle versions and concept ids for a
   turn, and a retry of that turn keeps the same pin.
6. A missing reviewer causes queued candidates and an SLA alert/report, never a
   merge or activation.

## V1.x - Earned Automation

Each automation turns on only when a named V1 metric clears its gate.

**T0 reviewer-only activation.**  
Gate: reviewer-human agreement on T0 candidates >= 95% over four consecutive
weekly samples. Revoked if agreement drops below 90%.

**Canary auto-execution for T1, then T2.**  
Gate: four weeks where human decisions match the deterministic recommendation
>= 95%. T3 stays manual forever.

**Automated compaction PRs.**  
Gate: four weeks of human-approved report recommendations with no harmful
deprecations.

**Active-active contradiction scanner.**  
Starts report-only, then opens supersede/deprecate PRs automatically after the
report accuracy gate clears. Human still approves merges.

**Reviewer ensemble option.**  
Add a second model family as tie-breaker on `escalate`, `flagged`, or
low-confidence verdicts.

**Operational surface.**  
Add dashboards/alerts only after CLI reports expose enough signal to know what
should be visualized.

## V2 - Scale and Extensions

V2 expands only after V1.x evidence shows the core loop is valuable.

**Identity scopes.**  
Add `identities/<id>` if Operon has multiple named employees inside one role
whose durable behavior should differ.

**Account scopes.**  
Add `accounts/<id>` for customer-specific product operations, such as account
SLAs, billing requirements, or support commitments. Imported account knowledge
is untrusted by default.

**Better attribution.**  
Move from version-level efficacy with suspicion flags toward per-concept
attribution only if V1 data shows multi-concept versions hide regressions.

**Embedding dedup.**  
Replace fingerprint-only dedup when real duplicate pressure justifies it.

**Machine-authored provisionals.**  
Allow only with human co-sign for severe operational flows.

**Second store/backend.**  
GitLab or bare-git proves the Store boundary.

**Standalone library extraction.**  
Extract after a second orchestrator wants the loop. Until then, keep the code in
Operon and reuse Operon's runlogs, approvals, scorecards, GitHub operations, and
gates directly.

**Cross-org OKF exchange.**  
Out of scope until provenance, trust downgrade, and containment have a track
record.

## Sequencing Rationale

Preflight makes the evidence trustworthy. V1 makes improvement useful while
human-gated. V1.x earns specific automations from measured agreement. V2 adds
scope and ecosystem complexity only after the simple Operon-native loop works.
