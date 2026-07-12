# Learning Loop - Milestones

**Status:** v0.4 - ratified 2026-07-11 (`docs/PURPOSE.md` → Decided → Learning
loop design); revised per the consolidated design feedback of 2026-07-10
(`archive/2026-07-10_feedback.md`); Preflight rebased against the
post-proportionality codebase on 2026-07-11  
**Companions:** `learning-loop-design.md`, `learning-loop-spec.md`

**Build status (2026-07-12):**

| Milestone | Status |
| --- | --- |
| Preflight | Done — PRs #29, #30, #31, #32 (all rebased items landed) |
| M1 (+M1b) | Done — PRs #37, #39, #40; M1b PR #38 |
| M2 | Done — PRs #44, #45, #46 |
| M3 | Done — PR #48 |
| M4 | Done — PR #50; the `cacheReadTokens > 0` two-pass case lives in the live suite only (`test/runtime/claude-sdk.live.test.ts`) — the offline suite pins byte-identical rendering (`test/learning/resolver.test.ts`) |
| M5 | Done — PR #52 |
| M6 | Built — offline conformance complete; live week observation begins after merge |

The cadence follows one rule:

> Autonomy is earned by measurement, never granted by release.

v0.3's single V1 mega-milestone bundled capture, migration, two new agents,
six destinations, approvals, manifests, resolution, metrics, canaries,
rollback, and compaction into one proving milestone. v0.4 splits it into six
milestones (M1–M6), each independently provable, matching the feedback's
recommended sequencing. Design changes that motivated the split: episodes as
the assignment/measurement unit, conditional experiment contracts, the
three-layer eval system, and the deterministic publisher.

## Preflight - Repair the Evidence Plumbing (rebased 2026-07-11)

Bad evidence teaches bad lessons. The 2026-07-07 audit found six defects; the
proportionality campaign (PRs #4–#15, #22) has since landed fixes for part of
them. The rebased split:

**Landed by the proportionality campaign — convert to conformance tests:**

- **Loop passes feed the telemetry ledger.** `recordTurnOnce` now settles
  every provider turn exactly once (`src/loop/pipeline.ts`); `operon budget
  --reconcile` back-fills from envelopes. *Preflight work:* a conformance test
  pinning that loop-driven passes settle exactly once, so learning metrics can
  never silently undercount builder/reviewer activity again.
- **Stale `running` envelopes are detectable.** Pass runs now heartbeat
  (`src/runtime/runlog/status.ts`), so a reader distinguishes live from
  stalled, and reconcile finalizes interrupted work. *Preflight work:* a
  conformance test that a killed pass is distinguishable and reconcilable —
  the episode projector depends on it to close episodes truthfully.

**Since landed — the tickets that blocked capture becoming authoritative
(all three closed before M1):**

- **Event fan-out consumes per `(eventKey, role)`.** One file-drop event that
  matches multiple roles now survives WIP-limited ticks: each spawn marks
  consumption for its own role only (`roleConsumedKey`,
  `src/org/events.ts:67`; `src/org/dispatch.ts:227`), and the bare key
  retires only once every subscriber holds a mark (PR #29).
- **Dispatched role briefs quote the original event payload, verbatim, with
  a provenance stamp.** The dispatch journal persists the payload and
  `protocolBrief` renders it as externally sourced data, never as
  instructions (`src/org/turn-runner.ts:429-451`; PR #30). Also feeds the
  resolver's selection text (spec §8.1).
- **Runtime adapters emit named `tool_use` events.** All three adapters emit
  them for the L2 bridge and the tool-count anomaly detectors
  (`src/runtime/adapters/claude.ts:164`, `codex.ts:382`, `pi-gate.ts:62`;
  issue #27, PR #32 — live-verified in
  `research/2026-07-11_adapter-tool-events.md`).

The human correction input path (v0.3 Preflight's sixth item) moved into M1,
where it ships as the complete episode-linked workflow rather than a stopgap
inbox.

**Done means:**

1. A support-feedback event can drive both Planner and Support across
   WIP-limited ticks.
2. Support/Marketing/SRE briefs can quote the original file-drop event payload.
3. Conformance tests pin loop-pass telemetry settlement and stale-run
   reconciliation.
4. `bash_heavy` and `environment_retry` can fire from real adapter tool events.

## M1 - Capture and Human Review (capture-only)

Exact-once evidence capture, the complete human review workflow, and closure
of the agent-direct active-memory path. Nothing activates; nothing distills.

**Ships:**

- `LearningEventSink` writing JSONL under `~/.operon/<org>/learning/events/`.
- Idempotent capture projector with a persistent cursor over
  `runs/<app>/<runId>/` (runlogs, quality gates, scorecards, approvals,
  telemetry). Each cursor receipt binds the derived event-file paths; if a
  promised file disappears, the projector reconstructs it from immutable run
  evidence and records the repair instead of permanently skipping the run.
  Readers tolerate a concurrently vanished file while reporting the
  incomplete evidence explicitly. Every event carries `episode_id` and
  episode context fields (spec §4).
- End-of-turn protocol change (`src/org/context.ts`): agents emit learning
  notes as candidate input instead of writing active OKF docs directly
  (design §7.1).
- Gate rules for **all** protected learning paths — bundles, manifests,
  `policy.yaml`, quarantine, evals, reviews, rejections, experiments,
  interventions (spec §1) — each with `test/gate.test.ts` cases for the
  critical side and a routine near-miss.
- `runRetroCuration` retired; its skill-draft logic noted for the M6
  distiller.
- OKF frontmatter validator extended to parse, validate, and preserve the
  `loop` block, with the round-trip preservation test (spec §3).
- Episode-linked human review workflow (design §10.1):
  `operon learn inspect <episode-id>`, `operon learn emit --episode <id>`
  (observation / cause hypothesis / suggested intervention kept separate),
  `operon learn show <id>` tracing an observation to its disposition.
- Read-only reports over captured events (`operon learn report`, capture-only
  sections). Projection writes are explicit through `operon learn report
  --refresh`; the default report only previews whether a refresh is required.

**Done means:**

1. Replaying the projector over the same runs produces no duplicate events
   (idempotency).
2. An agent attempt to write into any protected learning path is denied and
   escalated by the gate; legacy `memory/**` writes no longer occur because
   the end-of-turn protocol no longer requests them.
3. A human reviews a completed episode, submits two observations, and each is
   traceable by id — even though nothing downstream consumes them yet.
4. A round-tripped concept file preserves its `loop` block byte-for-byte.

## M2 - Episode and Replay Substrate

The deterministic recording half of the evaluation system (design §9.4). No
model turns are spent here.

**Ships:**

- `EpisodeRecord` as a cursor-based projection over the M5 ticket state
  machine's process-owned state, runlogs, telemetry, and approvals — never a
  second writable store (design §8.3). Deterministic episode ids from durable
  anchors (spec §5).
- Episode boundaries for all four kinds (`build_ticket`, `incident`,
  `feedback_thread`, `campaign`), with outcome capture on close and
  append-only `late_outcomes`.
- `SystemFingerprint`, content-addressed (spec §6).
- `ReplayCapsule` assembly and completeness validation for **build episodes
  only** (spec §7): seed commit, inputs, fingerprint, artifacts, observed
  outcome, side-effect policy.
- Replayability classification
  (`replayable | partially_replayable | non_replayable`).
- `episode_opened` / `episode_closed` / `late_outcome` events; `operon learn
  inspect` upgraded to render the full record.

**Done means:**

1. A completed sandbox build ticket projects into an `EpisodeRecord` whose
   turns, gates, costs, and release disposition match its runlogs and ledger.
2. Deleting the projection state and re-projecting rebuilds identical records.
3. A finalized build capsule for a real sandbox episode classifies its own
   replayability and lists what is missing for trusted replay.
4. An interrupted episode (killed pass) still closes truthfully via the
   heartbeat/reconcile path.

## M3 - Experiment Substrate

The decision half: contracts and comparison, still offline, still no live
exposure.

**Ships:**

- `ExperimentRecord` schema and validator: declared-before-results, control
  and treatment fingerprints, eligibility, primary metric with expected
  direction and minimum useful effect, guardrails, repetitions, outcome
  maturity, stop thresholds (spec §10).
- `InterventionRecord` lineage for every destination (spec §11).
- `EvalResult` with the four verdicts
  (`improved | regressed | inconclusive | not_evaluatable`) and grader
  provenance (spec §12).
- Eval fixture layout under `learning/evals/**`; conversion of a selected
  episode capsule into a sanitized eval fixture, with independent validation
  before trust (spec §7).
- Deterministic graders (tests/gates); model graders deferred until a
  qualitative guardrail needs one.
- The `authorized` vs. `validated` claim distinction wired through concept
  frontmatter and reports (design §9.1).

**Done means:**

1. An experiment declared against two fingerprints validates, and a scripted
   pair of fixture outcomes produces the correct verdict for each of the four
   verdict classes.
2. A candidate with `claims_efficacy: true` cannot proceed without a declared
   experiment; a T0 fact proceeds and is reported as `authorized`/unproven.
3. Every published change — including a plain ticket — has a complete
   `InterventionRecord` chain.

## M4 - Manual Governed Activation

The write path into future context opens, human-gated and content-bound.

**Ships:**

- Candidate storage under `learning/candidates/` (never resolvable);
  quarantine under `learning/quarantine/` with resolver-enforced TTL (spec §3).
- Reviewer verdict schema and fail-closed review (spec §15); reviewer runs
  cross-provider from the distiller when both exist (M6) — in M4, review can
  be human-invoked (`operon learn review`).
- Approval binding: `learning_publish` item kind in the existing approvals
  store, binding candidate hash, verdict hash, destination, tier, scope, base
  manifest version, and final diff hash (spec §14).
- The deterministic publisher: one atomic, idempotent, journaled transaction
  per approval; sole writer inside protected paths (design §11.1).
- Proportional approval routing (design §6.1): tickets and unmerged proposal
  drafts publish routinely (deduped, rate-capped); activation, ratified-surface
  merges, T2/T3, and promotions require the human gate.
- `GhOps.createIssue` for the `ticket` destination.
- Resolver integrated into context assembly: one `(app, role, turnId,
  episodeId)` resolve, pinned for the whole turn/pipeline; conflict resolution
  before budgeting; per-scope budget shares with narrowest-first
  redistribution; deterministic in-scope ordering (spec §8.1).
- Manifests and version cuts; `concept_loaded`, `context_evicted`,
  `conflict_resolved`, `provisional_expired`, `publish_committed` events.
- Publish-time bundle-size validation for protected tiers (spec §3).
- Rejection ledger with suppression windows.
- `operon learn disable <concept-id>` and
  `operon learn rollback --root org|app`.
- Cache-stability conformance case: two back-to-back passes under the same
  pinned bundle show `cacheReadTokens > 0` on the second.
- Metrics as JSONL projections; `operon learn report` gains activation,
  lineage, and agreement sections.
- Tests reuse `test/fixtures/orgHome.ts` and `test/fixtures/fakeClock.ts`.

**Done means:**

1. A seeded bad concept is disabled with `operon learn disable`, taking effect
   for every subsequently resolved turn immediately, while sibling concepts
   still resolve. In-flight turns keep their pin.
2. No active concept exists without a reviewer verdict and a content-bound
   human approval; mutating an approved candidate voids the approval and the
   publish refuses.
3. A crashed publish resumes idempotently by approval id — no double publish,
   no half-written bundle.
4. A candidate rejected once does not reappear inside the suppression window
   unless evidence crosses the configured threshold.
5. An expired provisional never resolves, and its expiry is an event, not a
   compaction footnote.
6. A learning event cluster from the marketplace assessment routes at least
   one item to a ticket (published routinely, deduped), one to an OKF concept
   (human-gated), and one to an eval/gate proposal (draft PR, routine).
7. A missing reviewer causes queued candidates and an SLA alert/report, never
   a merge or activation.
8. An org-scope concept flood cannot starve `apps/<app>/roles/<role>`
   selection (budget-share test).

## M5 - Offline Evaluation and Human-Started Canary

Model tokens enter, in the §9.5 funnel order: deterministic checks, targeted
evals, paired replay, then a live canary only when a human starts it.

**Ships:**

- `ExperimentRunner` executing paired control/treatment replays from build
  capsules, with repetition caps and early stopping (held-in failure or
  guardrail trip aborts).
- Targeted role-level behavioral evals as the cheap step before full episode
  replay.
- Held-out cases kept verifier-only (design §9.3).
- Episode-sticky canary: lineage chosen by hash of `episode_id`, recorded on
  the `EpisodeRecord`, identical across every turn/retry in the episode
  (design §8.4). Human-started, tier-gated; T3 live canary structurally
  forbidden (policy §13).
- Learning budget as an overlay in the existing budget system: monthly cap,
  per-candidate replay cap, repetition caps; replay turns settle into the org
  ledger like all provider turns.
- Canary and experiment reports: verdicts, guardrails, episode outcomes by
  lineage, cost per experiment, cost per accepted improvement.

**Done means:**

1. A paired replay on a seeded weakness produces `improved` for a genuinely
   fixing candidate and `regressed`/`inconclusive` for a sham one.
2. Every turn of a canaried episode resolved the same lineage, verified from
   resolved-context records.
3. An attempted T3 live canary is refused by policy, not by convention.
4. Replay spend halts at the per-candidate cap and is visible in
   `operon budget`.

## M6 - Scheduled Distillation

The standing agents arrive last, once everything they feed is proven.

**Ships:**

- Distiller and learning-reviewer as `roles.yaml` entries (proposal PR;
  cross-provider from each other), triggered `daily 06:00` /
  `weekly mon 07:00` via the existing dispatch tick — no cron engine.
- Deterministic prechecks: no model turn when the evidence window has no
  actionable cluster (design §9.5).
- Candidate volume and distillation frequency caps (policy §13).
- `runRetroCuration`'s skill-draft idea lands here as the distiller's
  `skill_draft` destination.
- Compaction report (report-only): deprecation, merge, promotion, and
  supersession proposals for human execution.

**Done means:**

1. A week of live sandbox operation produces distilled candidates only on days
   with actionable evidence; empty windows spend zero model tokens.
2. Distiller and reviewer turns appear in telemetry, scorecards, and budget
   like any role's turns, and the learning overlay caps them.

## End-to-End Acceptance

A convincing full-loop demonstration, runnable against the sandbox apps:

```text
seeded failure
-> trusted evidence (capture)
-> finalized ReplayCapsule (episode substrate)
-> candidate
-> independent review
-> executable ExperimentRecord
-> paired baseline/treatment replay
-> held-in improvement
-> held-out non-regression
-> bounded episode-level canary
-> promotion (claim: validated)
-> later regression
-> disable/rollback
```

Plus the human lane: a human reviews a completed episode, submits multiple
observations, and traces each to a distinct final disposition (activated,
rejected, ticketed, deferred).

## V1.x - Earned Automation

Each automation turns on only when named metrics clear their gates.
**Agreement alone is insufficient**: every gate below also requires
demonstrated outcome improvement on promoted changes and zero guardrail
regressions over the qualification window.

**T0 reviewer-only activation.**  
Gate: reviewer-human agreement on T0 candidates >= 95% over four consecutive
weekly samples, with no harmful activation in the window. Revoked if agreement
drops below 90%.

**Canary auto-execution for T1, then T2.**  
Gate: four weeks where human decisions match the deterministic recommendation
>= 95%, and promoted changes' post-promotion episode outcomes do not regress.
T3 stays manual forever.

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

**Non-build replay.**  
Support/Marketing capsules need synthetic channels and fake publishing
destinations; SRE and deployment capsules need disposable services, staging,
simulated incidents, or shadow execution. Deliberately excluded from V1
(design §9.4); replay must never repeat an irreversible production side
effect.

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

Preflight makes the evidence trustworthy. M1 proves capture and the human lane
without opening any write path. M2–M3 build the episode, replay, and
experiment substrate deterministically — cheap, offline, no trust required.
M4 opens the governed write path with content-bound approvals and a
deterministic publisher. M5 spends model tokens in a strict funnel and adds
live exposure only episode-sticky, tier-gated, and human-started. M6 adds the
standing agents last, behind prechecks and budget caps. V1.x earns specific
automations from measured agreement *plus* outcomes. V2 adds scope and
ecosystem complexity only after the simple Operon-native loop works.
