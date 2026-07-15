# Operon Highly Efficient Organization Transformation Charter

| Field | Value |
| --- | --- |
| Status | Phases 0–5 complete; Phase 6 retained one invalid candidate campaign and corrected external evidence remains pending exact authorization |
| Evidence date | 2026-07-15 |
| Primary implementation repo | `/Users/bikram/Build/Operon` |
| Benchmark org | `/Users/bikram/Build/Bikram-Org` |
| Benchmark app | `/Users/bikram/Build/buildstacks.dev` |

## New-session mandate

Use this document as the controlling brief for the next Operon improvement
campaign.

Do not begin by fixing one isolated defect. First align Operon's purpose,
vision, architecture, operating contracts, metrics, and tests around one
outcome: **Operon must operate as a highly efficient, governed organization.**
Then implement the work in the sequence defined here and prove it through
reproducible benchmarks.

Efficiency must not be achieved by weakening review, hiding failures, using a
cheaper model indiscriminately, bypassing approvals, or declaring incomplete
work successful. The goal is to remove waste while preserving or improving
correctness, safety, evidence quality, and terminal integrity.

## 1. Executive decision

Operon is already closer to a safe and auditable organization than most agent
orchestrators. It has independent roles, durable artifacts, mechanical gates,
critical-operation approvals, telemetry, budgets, reset archives, and a
governed learning design.

It is not yet a highly efficient organization.

The observed workflow showed that Operon can eventually reach a correct result,
but still spends too much model context, too many passes, and too much operator
attention on coordination and recovery. It also demonstrated an important
regression: the historical proportionality benchmark reached six passes and
$6.83, but the later production workflow consumed 28 passes and $51.60. The
product has proved that efficient execution is possible; it has not made
efficiency a durable invariant.

This charter makes five decisions:

1. **Efficiency is a correctness property.** A workflow that reaches the right
   code through disproportionate cost, retries, or human supervision is not
   fully correct.
2. **Deterministic work spends zero model tokens.** Lifecycle mechanics,
   migrations, synchronization, validation, reconciliation, capture, and
   reporting belong in deterministic code.
3. **Process scales with demonstrated risk and complexity.** Ceremony class,
   keywords, or role availability must not automatically select a heavyweight
   route.
4. **Forward progress is durable.** Completed reasoning and artifacts survive
   interruption, approval, retry, reset, and process restart.
5. **Learning must improve measured future episodes.** Capturing events is not
   organizational learning. A learning loop is working only when validated
   interventions reduce recurrence or improve cost, quality, latency, or human
   load.

## 2. Evidence and diagnosis

### 2.1 Observed production workflow

The 2026-07-12 `buildstacks.dev` record contained:

| Measure | Observed |
| --- | ---: |
| Passes | 28 across 17 traces |
| Model-driven passes | 24 |
| Terminal state | 25 completed, 2 cancelled, 1 stale running |
| Equivalent cost | $51.60 |
| Input tokens | 12.63M |
| Output tokens | 227k |
| Builder share | $42.08, or 81.6% of cost |
| Largest pass | $14.40, 2.79M input tokens, 50 tool calls |
| Longest reviews | 420s and 601s |
| Cache-read ratio | 62.8% overall; roughly 43-49% on expensive Builder runs |
| Escalations | 8, split between Planner and Reviewer |
| Learning projection | 27 of 28 runs, 1 pending |
| Actionable learning evidence | 0 clusters |

The final work was small relative to the process. Repeated context assembly,
planning, builds, reviews, retries, environment recovery, false-positive
approvals, and incomplete finalization dominated the unit economics.

### 2.2 Historical comparison

Operon's proportionality campaign already established two useful baselines:

| Episode | Passes | Spend | Human decisions | Outcome |
| --- | ---: | ---: | ---: | --- |
| 2026-07-10 failure | 55 | $266.41 | 42+ | No merge |
| 2026-07-11 benchmark round 2 | 6 | $6.83 | 0 blocking | Merged green |
| 2026-07-12 production workflow | 28 | $51.60 | 8 escalations | Eventually recovered |

This is not evidence that Operon cannot be efficient. It is evidence that the
successful benchmark was not converted into an enforced operating contract and
regression suite.

### 2.3 Root diagnosis

Operon currently has three different maturity levels:

- **Governance plane: strong.** Authority provenance, gates, archives, and
  auditability generally fail closed.
- **Execution plane: uneven.** Proportionality, context size, continuation,
  finalization, and lifecycle transitions are not consistently bounded.
- **Improvement plane: incomplete.** Telemetry can observe failures, but the
  anomaly-to-evidence-to-candidate path did not carry those failures into
  actionable learning.

The next campaign must improve all three planes together. Fixing learning alone
would help repeated episodes, but would not make deterministic lifecycle work
token-free or guarantee proportional routing.

## 3. Revised purpose and vision

### 3.1 Proposed PURPOSE one-liner

Replace the current outcome-neutral one-liner with:

> Operon is a governed org runtime that turns approved goals into verified
> software outcomes with process proportional to risk, minimal human attention,
> durable forward progress, and continuously improving unit economics.

The existing definition of Operon as an installable, multi-app org runtime
remains correct. The amendment adds the missing promise: how economically and
reliably the organization must operate.

### 3.2 Proposed vision

Create `docs/VISION.md` and adopt this vision:

> One human should be able to direct a small portfolio of software products at
> the quality bar of an excellent engineering organization without becoming
> its scheduler, retry loop, state reconciler, or approval clerk.
>
> Operon should spend intelligence on judgment and deterministic computation on
> mechanics. It should select the smallest safe workflow, preserve every unit
> of forward progress, surface genuine decisions, learn from evidence, and make
> comparable work measurably cheaper and more reliable over time.

### 3.3 Highly efficient organization definition

Operon qualifies as highly efficient only when it consistently satisfies all
of the following:

1. **Outcome integrity:** requested work reaches an explicit terminal outcome
   with required stages and evidence intact.
2. **Proportionality:** pass count, models, effort, context, review depth, and
   human attention scale with actual risk and uncertainty.
3. **Mechanics without models:** deterministic lifecycle and bookkeeping work
   uses no provider turns.
4. **Durable continuation:** interruptions resume from artifacts rather than
   re-deriving completed work.
5. **Bounded execution:** every pass and episode has enforceable budgets and an
   honest stop path.
6. **Precise escalation:** the human sees genuine material or irreversible
   decisions, not prose matches or repeated judgments.
7. **Complete observability:** every turn and mechanical pass settles once and
   can be attributed to an outcome.
8. **Measured learning:** validated interventions reduce recurrence or improve
   cost, latency, quality, or human load on later episodes.
9. **Operational autonomy:** scheduled work runs without babysitting and parks
   safely when it cannot proceed.
10. **Regression resistance:** efficiency targets are release gates, not
    historical anecdotes.

### 3.4 New non-negotiables for PURPOSE.md

Add these high-level decisions to `docs/PURPOSE.md`:

- **Intelligence is reserved for judgment.** Parsing, migration, synchronization,
  status transitions, validation, capture, aggregation, and reconciliation are
  deterministic by default.
- **Risk buys process.** Additional planning, review, isolation, or model effort
  requires a recorded risk or uncertainty factor.
- **Context is a budgeted resource.** Each pass receives the smallest sufficient
  evidence set, with provenance and an explicit reason for every large context
  component.
- **Forward progress is never casually discarded.** Restart is a last resort
  with a recorded reason; continuation from durable artifacts is the default.
- **Human attention is budgeted.** Repeated or false-positive approvals are
  organizational defects.
- **Efficiency never weakens safety.** Savings come from better routing,
  deterministic mechanics, narrower context, continuation, and learning—not
  from skipping necessary evidence.
- **Learning is outcome-accountable.** No candidate becomes active merely
  because it is plausible; no learning system is considered successful merely
  because it emitted events.

### 3.5 Explicit non-goals

- Do not optimize only for the lowest dollar cost.
- Do not replace frontier models everywhere with smaller models without
  outcome evidence.
- Do not collapse independent review for high-risk work.
- Do not weaken critical-operation boundaries.
- Do not hide cancelled, stale, partial, or manually completed work.
- Do not permit agents to self-activate protocol or authority changes.
- Do not build a second workflow database merely for efficiency reporting.
- Do not use aggregate cache hits to excuse excessive context assembly.

## 4. Target operating model

### 4.1 Token-free lifecycle lane

The following sequence must be executable through deterministic CLI operations
with zero model turns:

```text
inspect org
  -> preview/apply org migration
  -> reset app with archived recovery state
  -> recover normalized onboarding answers
  -> bootstrap app
  -> verify generated artifacts and remote reachability
  -> promote app to live
  -> synchronize managed clone
  -> verify authority/config/ref hashes
  -> project telemetry and learning events
  -> produce readiness report
```

Human decisions may still be required where policy demands them. The mechanics
around those decisions must not require model reasoning.

### 4.2 Low-risk delivery lane

The default route for a bounded, low-risk change should be:

```text
token-free preflight
  -> zero- or one-turn plan/contract decision
  -> one Builder turn
  -> deterministic gates
  -> one bounded review when policy requires it
  -> at most one repair turn before reassessment
  -> terminal settlement
```

No competing-PM plan, deep security review, performance review, or frontier
effort is selected without a recorded factor that justifies it.

### 4.3 Standard and deep lanes

Standard and deep work retain stronger planning and independent review. The
difference is that depth is selected from explicit factors:

- blast radius;
- reversibility;
- sensitive domains;
- uncertainty and ambiguity;
- number of components and external systems;
- release consequence;
- novelty relative to validated memory;
- evidence quality and test coverage.

Keywords in prose are not risk factors. Role availability is not a reason to
invoke a role.

### 4.4 Learning lane

The closed loop must be:

```text
settled run evidence
  -> typed anomaly/outcome events
  -> complete episode
  -> deterministic cluster/dedupe/suppression
  -> candidate only when actionable
  -> independent review
  -> experiment when efficacy is claimed
  -> human-governed publication/activation
  -> canary or bounded rollout
  -> measured effect on later episodes
  -> retain, revise, disable, or roll back
```

The system must distinguish:

- **capture health:** events are complete and idempotent;
- **learning health:** useful evidence reaches candidates;
- **governance health:** review and activation remain fail-closed;
- **efficacy:** later outcomes improve.

## 5. Initial efficiency service levels

These are provisional V1 budgets derived from the observed workflow and the
successful historical benchmark. Recalibrate them after ten clean comparable
episodes; do not silently loosen them.

| Route | Model turns | Input tokens | Output tokens | Equivalent cost | Active wall time | Human decisions |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Deterministic lifecycle | 0 | 0 | 0 | $0 | <=5 min | 0 except policy gates |
| Quick / low risk | <=3 | <=2M | <=40k | <=$8 | <=20 min | <=1 |
| Standard | <=5 | <=4M | <=80k | <=$15 | <=45 min | <=2 |
| Deep / high risk | <=8 | <=8M | <=160k | <=$40 | <=90 min | <=5 |

Budgets are admission and reassessment boundaries, not permission to falsify
completion. If a route needs more, Operon must preserve artifacts, explain the
variance, recompute the route, and either continue under an authorized budget
or park with evidence.

### 5.1 Organization-wide invariants

| Metric | Required invariant |
| --- | --- |
| Terminal integrity | 100% of runs settle to a truthful terminal state |
| Ledger coverage | 100% of provider and mechanical passes settle exactly once |
| Deterministic token leakage | 0 provider turns for supported lifecycle operations |
| Artifact continuation | >=95% of interrupted work resumes without repeating completed passes |
| Approval precision | >=90% of approval requests correspond to genuine governed actions |
| Approval recurrence | No identical denied action recurs in the next comparable episode |
| Productive-pass ratio | >=80% of model passes create new decision value or durable progress |
| Context regression | No route's median input grows >20% without an explained scope change |
| Learning capture | 100% of eligible finalized runs projected; pending runs identified by ID |
| Learning efficacy | Activated interventions show measured improvement or are rolled back |
| Scheduler reliability | >=99% of due ticks execute or emit a durable skipped/blocked reason |

### 5.2 Required efficiency attribution

Every episode report must show:

- planned route and risk factors;
- actual model and mechanical passes;
- context bytes and tokens by source category;
- cached, uncached, and generated tokens where available;
- cost, latency, tool calls, retries, and escalations by pass;
- repeated work and why it repeated;
- durable artifacts created or reused;
- human decisions and wait time;
- terminal integrity;
- variance from the route budget;
- applicable learned interventions and measured effect.

## 6. Transformation workstreams

### Workstream A — Ratify efficiency doctrine and remove document drift

**Problem:** PURPOSE records many correct subsystem decisions, but sustained
unit economics is not a top-level product promise. Historical benchmark success
did not prevent production regression.

**Changes:**

1. Update `docs/PURPOSE.md` with the one-liner and non-negotiables in section 3.
2. Create `docs/VISION.md` with the proposed vision and definition of a highly
   efficient organization.
3. Create `docs/efficiency.md` as the canonical metric, tier-budget, and
   variance contract; keep PURPOSE high-level.
4. Update `README.md` so installation and onboarding promises distinguish
   generated, registered, runtime-ready, live, and autonomously scheduled.
5. Update `docs/architecture.md`, `docs/loop.md`, reporting, learning, approval,
   and testing documents to reference the same efficiency contract.
6. Mark superseded defaults explicitly. In particular, deep planning as a
   general milestone default and a 60-minute pass cap must not override the
   proportional route budgets above.

**Acceptance:** no normative document describes a lifecycle, budget, planning
depth, or completion rule that conflicts with `docs/efficiency.md`; a doc-link
and terminology check enforces this in CI.

### Workstream B — Build an efficiency ledger and route admission controller

**Problem:** telemetry reports what happened after the fact, but Operon does not
consistently use comparable history and budgets to admit or reassess a route.

**Changes:**

1. Define versioned route classes: deterministic, quick, standard, and deep.
2. Record the selected route, factors, estimated lower/upper cost, context
   budget, pass budget, and human-attention budget before the first model turn.
3. Add per-episode counters that survive process restarts.
4. Reassess before a repair/review cycle when remaining budget cannot complete
   the planned route.
5. Add `operon report` efficiency views: route variance, productive-pass ratio,
   repeated-work cost, context growth, approval precision, and cost per verified
   outcome.
6. Convert benchmark thresholds into CI/release regressions for Operon.

**Acceptance:** before spending tokens, Operon can answer why this route was
selected and what it may cost; afterward it can attribute every variance.

### Workstream C — Make lifecycle operations deterministic and transactional

**Problem:** upgrade, reset, re-onboarding, promotion, default-branch alignment,
and managed-clone readiness required manual reconstruction and model judgment.

**Changes:**

1. Add `operon org upgrade` with non-mutating plan, schema diff, checksummed
   rollback archive, explicit authority choice, additive migrations, and
   post-upgrade doctor verification.
2. Preserve normalized, non-secret onboarding answers in reset archives and
   support `operon bootstrap --answers-from <archive|app>`.
3. Make reset remediation explicit when approvals or stale envelopes block it;
   clarify that `--force` crosses only stale runs.
4. Generate formatter-clean app instructions and validate generated artifacts
   before reporting success.
5. Add `operon app verify <app>` to prove registry/config agreement, remote ref
   reachability, default-branch ancestry, managed-clone HEAD, authority hashes,
   app checks, approvals, locks, and runtime readiness.
6. Add transactional `operon app promote <app> --to live` with dry-run and
   execute modes. Promotion updates org/app surfaces only after verification.
7. Refresh or recreate managed clones deterministically after the onboarding
   commit becomes reachable.
8. Make each lifecycle command idempotent and machine-readable.

**Acceptance:** the complete lifecycle benchmark in section 8.1 uses zero model
turns, leaves no partial state, and can be safely rerun.

**Delivered 2026-07-14 (Phase 2):** the production `src/org` lifecycle plane
implements the eight changes above. `LIFE-LEGACY-001` runs both production APIs
and public CLI commands from isolated old-schema/reset state through recovered
bootstrap, ref refusal/convergence, verification, and journaled promotion in
well under five active minutes. The exhaustive named-boundary, corruption,
concurrency, path, ancestry, and second-app suites promote `C-LIFE-01` through
`C-LIFE-04` to required without invoking a runtime factory or provider.

### Workstream D — Enforce proportional planning and review

**Problem:** route selection can still invoke heavyweight roles and effort for
small work, and prose keywords can inflate risk.

**Changes:**

1. Centralize route selection in deterministic policy rather than prompt-only
   guidance.
2. Default bounded low-risk fixes to no model plan or a single contract step.
3. Require a recorded factor for every additional Planner, Reviewer,
   security-deep, perf-scale, or high/xhigh-effort pass.
4. Separate action classification from content classification. Structured plan
   or review prose about deploy/auth is not a deploy/auth action.
5. Select model and effort per pass from evidence and escalation policy, not a
   permanently maximal role default.
6. Preserve independent review where risk requires it; allow mechanical-only
   completion only where a ratified policy and evidence explicitly permit it.
7. Recompute route after an unexpected finding instead of blindly consuming
   every configured remediation cycle.

**Acceptance:** the low-risk benchmark selects at most three model turns; the
deep benchmark retains the required independent checks and stays within its
declared budget.

### Workstream E — Treat context as an engineered budget

**Problem:** repeated large contexts dominate input tokens. Caching reduces
price but does not remove latency, provider dependence, or reasoning noise.

**Changes:**

1. Emit a context manifest for every pass: source, bytes/tokens, cache identity,
   inclusion reason, and whether the source changed since the prior pass.
2. Send references, typed summaries, and deltas for stable artifacts instead of
   concatenating full histories repeatedly.
3. Pin immutable shared context once per episode/provider session where the
   runtime supports it.
4. Separate required authority/taste from optional memory and historical
   evidence; cap each category independently.
5. Retrieve only unresolved findings, relevant acceptance criteria, changed
   files, and applicable learned concepts.
6. Deduplicate repeated prompt/output material before adapter submission.
7. Add context-growth regression tests and an explain command for oversized
   briefs.
8. Never truncate authority, safety constraints, acceptance criteria, or
   unresolved findings to meet a budget; reassess the route instead.

**Acceptance:** comparable second and later passes consume materially less
uncached context, and no low-risk episode exceeds the context budget without an
explicit variance record.

### Workstream F — Preserve progress and guarantee terminal finalization

**Problem:** cancelled, interrupted, capped, or stale work can lose progress,
repeat passes, or remain permanently running.

**Changes:**

1. Persist a ticket/episode execution journal with completed stages, artifact
   hashes, findings, approvals, attempts, and next legal transition.
2. Resume from the last valid artifact boundary by default.
3. Make every provider pass and mechanical pass finalize through one idempotent
   settlement path.
4. Add watchdog reconciliation for missing heartbeat/finalization.
5. Distinguish model outcome, durable artifact outcome, and overall episode
   outcome.
6. Close, cancel, or reset-abandon learning episodes when app reset makes normal
   continuation impossible.
7. Identify every learning `runsPending` item by run ID and reason.
8. Bound environment retries, tool calls, wall time, and claim attempts by
   route; park with a concise evidence digest when the bound is reached.

**Acceptance:** injected interruptions after plan, build, gate, review, and
approval resume at the correct boundary; no run remains stale and no completed
stage repeats without a recorded invalidation reason.

### Workstream G — Optimize the human-attention boundary

**Problem:** false-positive and repeated approvals make the human part of the
retry loop.

**Changes:**

1. Classify actual tool/action semantics, paths, destinations, and effects
   before inspecting free-form prose.
2. Make actions forbidden to a role unreachable through capability shaping.
3. Preserve scoped grants with TTL/use limits and per-use audit where already
   ratified.
4. Store denial lessons through the validated governed learning writer; never
   emit malformed memory.
5. Detect materially identical pending/decided requests and reuse or explain
   the prior decision within policy.
6. Measure approval precision, recurrence, decision time, and blocked model
   spend.

**Acceptance:** the replay produces no approval for planning/review prose, no
malformed denial memory, and no repeated request for an unchanged denied act.

### Workstream H — Complete the learning signal and efficacy loop

**Problem:** the archive contained stale finalization, cancellations,
shell-heavy behavior, long reviews, and environment retries, but refreshed
learning reported no gate failures and the distiller saw zero evidence events.

**Changes:**

1. Project analyzer signals, cancellation reasons, retry clusters, budget
   variance, stale/missing finalization, approval false positives, repeated
   work, and route overruns into typed evidence with stable error classes.
2. Guarantee 100% eligible run projection or emit the blocking run IDs.
3. Close reset-affected episodes with an explicit reset-abandoned disposition.
4. Keep deterministic capture, clustering, dedupe, and suppression token-free.
5. Make candidate eligibility explainable: why evidence was actionable,
   deduped, suppressed, capped, or rejected.
6. Preserve independent cross-provider review and content-bound human
   activation.
7. Attach every active intervention to a measurable hypothesis and baseline.
8. Compare later episodes by lineage and automatically recommend retain,
   revise, disable, or roll back.
9. Add a learning-health report that separately scores capture, governance,
   and efficacy.

**Acceptance:** the archived workflow produces actionable clusters for at least
stale finalization, environment retries, long review, and shell-heavy/repeated
work; a sandbox intervention completes review and measured evaluation without
self-activation.

### Workstream I — Install reliable autonomous operation

**Problem:** the org is live but autonomous dispatch is not scheduled. A highly
efficient org cannot depend on a human remembering every tick.

**Changes:**

1. Add a first-class scheduler install/status/uninstall surface for launchd and
   the future server scheduler.
2. Verify scheduler health in `doctor` and report due, executed, skipped,
   blocked, and missed ticks.
3. Keep dispatch idempotent and lock-safe.

**Phase 5 status (2026-07-14): complete for deterministic production.**
`operon scheduler install|status|uninstall` now owns an org-scoped,
preview-first, exact-confirmation lifecycle behind an injected backend manager.
The versioned scheduler ledger separates due-window invocations, app/role/trigger
decisions, spawned episodes, and ordinary provider turns/settlements; stable
identities and durable spawn boundaries make retries restart-safe. Status and
doctor join definition ownership/hash/cadence, manager active state, recent
ticks, typed outcomes, duplicates/orphans, and settlement denominators. The
production-backed seven-day virtual soak proves 2,016 decisions, four
restart/crash points, zero duplicates/orphans/mechanical runtime construction,
and exact receipt settlement; the standing-role gate separately proves three
ordinary FakeRuntime turns and three ledger settlements. The canonical operational contract is
`docs/scheduler.md`.

The deterministic `I-INSTALL-01..02` and `I-SOAK-01..03` contracts are
required. `I-ROLE-01..03` remain provider-result contracts despite completed
deterministic production paths, and `I-LIVE-01` remains the separately
authorized 48–72 hour L6 campaign. No provider or L6 campaign was run.
4. Ensure scheduled learning uses the same budgets and ledger as product work.
5. Alert through durable local state first; external notification remains a
   separately governed integration.

**Acceptance:** a multi-day sandbox soak runs without babysitting, duplicates,
or silent missed ticks; all skipped work has an attributable reason.

### Workstream J — Make efficiency a release-gated benchmark

**Problem:** one successful benchmark did not prevent a later regression.

**Changes:**

1. Create deterministic benchmark fixtures for the scenarios in section 8.
2. Record expected route, model turns, mechanical passes, tokens, cost, human
   decisions, wall time, terminal state, and learning outcome.
3. Run deterministic portions in ordinary CI and provider-backed calibration
   on an explicit cadence or release candidate.
4. Compare distributions, not only one golden run.
5. Fail release when terminal integrity, ledger coverage, or deterministic
   token leakage regress. Require review for material cost/latency regressions.
6. Publish an evidence report; do not rewrite a miss as a pass.

**Acceptance:** five consecutive clean episodes meet their route targets, then
ten mixed-route episodes show no critical regression before Operon claims
high-efficiency status.

## 7. Implementation sequence and gates

Do not parallelize changes whose contracts depend on unfinished prior phases.

### Phase 0 — Ratify the organizational doctrine

Deliver a docs-only PR covering PURPOSE, VISION, efficiency metrics,
architecture ownership, and terminology. Resolve contradictions before code.

**Gate:** human ratification of the efficiency doctrine and initial budgets.

### Phase 1 — Measurement and invariants

Implement route records, context manifests, complete ledger settlement,
terminal reconciliation, and benchmark reporting.

**Delivered 2026-07-13:** production execution now admits a durable episode
route before runtime construction, reserves route allowance atomically per
provider invocation, writes versioned context manifests and terminal
provider/mechanical step records, settles provider identities exactly once
under a cross-process lock, reconciles stale receipts, and projects the
evidence read-only through CLI/JSON/HTML/Observe reports. The historical
archive remains legacy evidence: every missing route, context manifest,
execution step, and incomplete run is named rather than inferred away.

**Gate:** the existing archive can be explained end to end with no unattributed
pass and every pending/incomplete item named.

### Phase 2 — Token-free lifecycle plane

Implement org upgrade, answers recovery, app verification, promotion, clone
synchronization, and lifecycle idempotency.

**Gate:** lifecycle benchmark uses zero model turns and reaches a clean live
app from the reset fixture.

**Status:** complete on 2026-07-14. The gate is carried by
`test/lifecycle/{transaction,cli,faults,security,isolation}.test.ts` and remains
part of every later phase gate.

### Phase 3 — Execution economy

Implement proportional routing, context budgets/deltas, preflight, durable
continuation, bounded repair, and approval precision.

**Gate:** low-risk and interrupted-work benchmarks meet their targets without
weakening gates.

**Status:** deterministic production slice complete on 2026-07-14. Structured
routing, context budgets/deltas, token-free admission, route-to-release
execution journals, route-wide bounds, semantic approvals, denial recurrence,
and reset-abandonment closure are executable. D/E live provider samples and
the live portion of G-MET-01 remain unpromoted because no campaign was
authorized; the next sequential implementation phase is Phase 4.

### Phase 4 — Closed learning loop

Repair evidence projection, episode finalization, clustering, candidate
explainability, evaluation, and efficacy reporting.

**Gate:** injected anomalies reach governed candidates/evaluations and an
activated sandbox intervention measurably improves later comparable episodes.

**Status:** complete on 2026-07-14. Production now projects versioned trusted
efficiency evidence from orchestrator artifacts, repairs capture receipts
exactly once, closes reset/stale episodes explicitly, clusters only comparable
app/role evidence, and records explainable candidate dispositions. The existing
governed Candidate → review → ExperimentRecord → content-bound approval →
publisher → Intervention/Canary chain remains the only authority path.
Experiments pin baselines, SystemFingerprints, hidden guardrails, actor-blind
pairing, budgets, stops, missingness, and side-effect replacement before
results. The token-free sandbox gate proves improvement, sham/harm exclusion,
rollback, idempotency, and separate capture/governance/efficacy health. All ten
H contracts are required; no provider campaign was run. Phase 5 is next.

### Phase 5 — Autonomous production posture

Install and prove scheduler management, soak behavior, and operational reports.

**Gate:** multi-day unattended sandbox soak with truthful scheduling and no
orphaned work.

**Status:** complete on 2026-07-14 for the deterministic production boundary.
Install/status/uninstall, exact-once dispatch evidence, truthful health,
standing-role artifacts/Planner feeds, scheduled-learning blockers, and the
seven-day virtual soak run through production modules. Five deterministic I
contracts were promoted. The remaining ten known-red contracts are
`D-LIVE-01..03`, `E-LIVE-01..02`, `G-MET-01`, `I-ROLE-01..03`, and
`I-LIVE-01`; each still requires its separately authorized provider or
real-time evidence. Phase 6 is next.

### Phase 6 — Efficiency qualification

Run the full benchmark matrix and production confirmation.

**Gate:** five consecutive clean target-meeting episodes, followed by ten mixed
episodes without a critical invariant violation. Only then describe Operon as a
highly efficient organization.

**Current status:** the exact-candidate/evidence-promotion audit and token-free
qualification hardening are implemented in an isolated worktree. Prepared
campaigns now distinguish whole-checkout, installable-package, and executable-
suite identity; provider cases run through production route admission with an
explicit deep input ceiling; grader and attempt accounting are independently
content-bound; L6 reconciles the exact schedule, exit/restart processes,
context denominators, runs, envelopes, and provider/mechanical settlements;
and contract promotion fails closed on stale, foreign, malformed,
missing, duplicate, grader-failed, or accounting-mismatched evidence. No L6
soak, promotion, or production confirmation has occurred. One safely archived
adapter campaign qualified the then-current
candidate, but its separately authorized candidate campaign is permanently
`invalid`: 11 passed attempts, eight genuine product misses, three
infrastructure-invalid attempts, and an incomplete remainder. The product
misses and the unavailable-provider-usage harness failure have been corrected
without changing thresholds, graders, denominators, or safety rules. The
operator then explicitly reassigned every Phase 6 pi evaluation role to pi's
exact `openai-codex/gpt-5.6-sol` model while leaving production `roles.yaml`
untouched. This removes the third-party Claude extra-usage dependency but is a
covered-byte assignment change, so the earlier prepared previews and
authorizations are stale. The ten contracts
remain known-red pending separately authorized fresh adapter admission,
candidate qualification, and L6 evidence. The immutable retained record is
`research/evals/2026-07-15-phase6-candidate-qualification-invalid.md`.
The learning block now follows the separately ratified boundary: a predeclared
content-hashed T1 procedure is present only on treatment arms, pair outcomes
come from provider artifacts and hidden guardrails, and a measured improvement
still needs a separate exact candidate/action-hash authorization for one
isolated governed activation and rollback. L5 authorization alone cannot cross
that boundary.

## 8. Required benchmark matrix

### 8.1 Lifecycle replay

Reproduce the workflow that motivated this charter:

1. Start with a legacy org missing current authority/role/pipeline surfaces.
2. Include one app with a stale run and pending approvals.
3. Preview and execute reset with archive.
4. Verify zero state.
5. Recover normalized onboarding answers from durable state.
6. Upgrade the org.
7. Bootstrap the app from a non-default human checkout branch.
8. Detect/refuse branch mismatch until the onboarding commit is reachable.
9. Verify and promote to `live` transactionally.
10. Synchronize the managed clone and prove authority/config hashes.
11. Refresh telemetry/learning capture and produce readiness.

**Target:** zero model turns, <=5 minutes active time, no partial state, no
manual file reconstruction, no malformed generated artifact.

### 8.2 Low-risk code/configuration fix

Use a two-file ignore/configuration correction equivalent to the
`.pnpm-store` episode.

**Target:** <=3 model turns, <=2M input tokens, <=$8, <=20 minutes, no more than
one human decision, green terminal outcome.

### 8.3 Standard feature

Use a bounded user-visible feature with several acceptance criteria and no
sensitive domain.

**Target:** <=5 model turns, <=4M input tokens, <=$15, <=45 minutes, complete
independent review, green terminal outcome.

### 8.4 Deep/high-risk change

Use a sandbox auth/data migration or deployment-affecting change requiring
real critical-operation handling.

**Target:** required safety checks remain present; <=8 model turns, <=$40,
<=90 minutes, <=5 genuine human decisions, no false-positive approvals.

### 8.5 Interrupted continuation

Interrupt after contract, implementation commit, gates, review finding, and
approval request.

**Target:** each restart resumes from the correct artifact boundary; repeated
productive passes = 0 unless prior artifacts are invalidated with evidence.

### 8.6 Learning closure

Inject one instance each of environment retry, stale finalization, repeated
shell exploration, false approval, and long review.

**Target:** 100% eligible capture, typed clusters, explainable candidate
decisions, independent review, governed activation, and measured recurrence or
efficiency improvement on a later comparable episode.

### 8.7 Scheduler soak

Run scheduled product and learning ticks across multiple days with deliberate
locks, skips, and one process restart.

**Target:** no duplicate work, no silent missed tick, no orphaned run, complete
ledger and reason codes.

## 9. Documentation change map

The new session must update these documents as part of the implementation, not
as cleanup afterward:

| Document | Required change |
| --- | --- |
| `docs/PURPOSE.md` | Ratify efficiency as a correctness property; amend one-liner and non-negotiables; supersede conflicting defaults |
| `docs/VISION.md` | New north-star outcome, operator experience, and qualification standard |
| `docs/efficiency.md` | Canonical routes, budgets, metrics, variance semantics, and benchmark targets |
| `README.md` | Explain efficient operating promise and lifecycle readiness states |
| `docs/architecture.md` | Add efficiency control plane, route admission, context manifest, lifecycle transactions, continuation, and ownership |
| `docs/scheduler.md` | Canonical scheduler definition/evidence schemas, identities, reason codes, crash boundaries, health semantics, and L6 boundary |
| `docs/loop.md` | Define tier routing, pass selection, budget reassessment, continuation, and terminal settlement |
| `docs/proportionality-review.md` | Add the production regression and point forward to the durable efficiency contract |
| `docs/approval-and-release-amendment.md` | Specify semantic action classification, approval-precision metrics, and denial-learning validity |
| `docs/learning-loop/learning-loop-design.md` | Add anomaly sources, efficiency outcomes, learning-health layers, and efficacy requirements |
| `docs/learning-loop/learning-loop-spec.md` | Add typed evidence/error classes, pending-run explanations, reset dispositions, and efficiency metrics |
| `docs/reporting/design.md` | Add route variance, context attribution, productive-pass ratio, human load, and learning efficacy |
| `docs/testing-journey.md` | Add lifecycle, proportionality, context, continuation, learning-closure, and scheduler-soak stages |
| `docs/capability-matrix.md` | Record provider support for context pinning, usage fidelity, cancellation, continuation, and budget enforcement |
| `docs/benchmark-runbook.md` | Implement the benchmark matrix and evidence-preserving miss protocol |
| Agent skill/runbook | Teach coding agents the deterministic lifecycle and efficiency inspection surfaces |

Normative details must have one canonical home and be linked elsewhere. Do not
copy divergent budget tables into multiple documents.

## 10. Original findings preserved and expanded

The prior defect list remains represented in this charter:

| Original finding | Owning workstream |
| --- | --- |
| Missing `org upgrade` | C |
| Reset does not explain approval remediation | C, G |
| Onboarding answers not reproducible | C |
| Denial memory emitted malformed | G, H |
| Managed clone stale after bootstrap | C |
| Generated instructions fail formatting | C |
| Legacy org lacks learning roles/pipelines | A, C |
| Default branch and app promotion ambiguous | C |
| Anomalies do not become learning evidence | H |
| Reset leaves learning episodes open | F, H |
| Telemetry and learning projection disagree | B, F, H |

This rewrite adds the missing systemic owners:

- durable efficiency doctrine and regression enforcement;
- route admission and unit-economic budgets;
- context economy;
- productive-pass and repeated-work accounting;
- autonomous scheduling;
- efficacy-based learning qualification.

## 11. Definition of done

This campaign is complete only when all of the following are true:

- PURPOSE and VISION explicitly define the efficient organization outcome.
- A single canonical efficiency contract drives code, reports, tests, and docs.
- Supported lifecycle operations spend zero model tokens.
- Every route records why it was selected and its budget before spending.
- Low-risk work meets the quick-route targets without weakening safety.
- Context attribution explains every large prompt and comparable context does
  not grow silently.
- Interrupted work resumes from artifacts rather than restarting.
- Every run and mechanical pass settles exactly once to a truthful state.
- Approval false positives and repeated denials meet the precision targets.
- Learning projects every eligible run or identifies the blocking run by ID.
- Observed anomalies reach actionable, governed learning when appropriate.
- At least one sandbox intervention proves measurable improvement and safe
  rollback.
- Scheduler health is installed, observable, and soak-tested.
- Five consecutive clean episodes and ten mixed-route qualification episodes
  meet the required invariants.
- The production confirmation is reported separately and honestly.

## 12. Instructions for the implementing session

1. Work in `/Users/bikram/Build/Operon`; treat the org/app/archive as benchmark
   evidence, not as implementation locations.
2. Read this charter, current `docs/PURPOSE.md`, `docs/architecture.md`,
   `docs/loop.md`, `docs/proportionality-review.md`, the learning-loop docs, and
   project `AGENTS.md` before editing.
3. Begin with Phase 0 as a docs-only proposal. Do not let implementation race
   ahead of the ratified operating contract.
4. Convert phases into small GitHub issues with binary acceptance criteria and
   named benchmark evidence. Avoid one issue per bullet; split by independently
   verifiable subsystem boundary.
5. Preserve current safety gates and backward-compatible read surfaces unless
   the ratified design explicitly changes them.
6. Use the existing archived workflow as a replay fixture without mutating its
   checksummed source. Copy it into an isolated test state when projection or
   migration writes are required.
7. Establish measurements before optimizing. Every performance claim must cite
   baseline and post-change evidence.
8. Run deterministic tests first, then sandbox/provider-backed benchmarks only
   where they prove behavior deterministic tests cannot.
9. Record misses as findings; do not relax targets or discard inconvenient
   runs without a versioned decision.
10. Stop only when the current phase gate is genuinely satisfied or a concrete
    human decision is required.

The intended outcome is not merely a cleaner Operon. It is an organization that
reliably spends model intelligence where judgment is valuable, spends no model
intelligence on mechanics, needs the human only for real decisions, and becomes
measurably better with experience.

## 13. Copy/paste kickoff prompt for a new session

> `/goal` Implement Operon's highly efficient organization transformation in
> `/Users/bikram/Build/Operon`. Use `$operon` for runtime discovery and safe
> diagnostics. Before editing, read completely: `AGENTS.md`, `docs/PURPOSE.md`,
> `docs/efficiency.md`,
> `docs/efficiency-transformation/highly-efficient-organization-transformation.md`,
> and
> `docs/efficiency-transformation/highly-efficient-organization-test-eval-transformation.md`.
>
> Preserve unrelated work, especially the existing uncommitted
> `docs/architecture/conceptual-overview.md`; do not reset, stash, or include
> it. Work on a focused branch. Do not mutate production org/state/apps or
> non-eval GitHub repositories.
>
> T0–T5 test/eval readiness is complete. The admitted adapter campaign is
> `adapter-harness-calibration-v1-20260714-e52bf4335e81`; the valid current
> baseline is `pre-transformation-baseline-v2-20260714-e52bf4335e81`, with one
> pass, five honest `product_miss` outcomes, and zero eval-system failures.
> Production Phases 1–5 are complete and 10 provider/real-time contracts remain
> known-red. Rerun external campaigns only after covered
> bytes change and exact authorization. Never
> weaken graders, targets, safety gates, or evidence to make results green.
>
> Execute the charter sequentially. Phases 0–5 are complete; begin with Phase 6
> qualification. Do not parallelize work whose
> contracts depend on an unfinished phase. `TASTE.md`, `roles.yaml`,
> `pipelines.yaml`, `prompts/**`, and `docs/PURPOSE.md` are human-ratified;
> never silently rewrite them.
>
> After ratification, implement one verifiable subsystem slice at a time.
> Measure before optimizing, preserve import direction
> `src/org` → `src/loop` → `src/runtime`, use existing fixtures, and promote
> known-red contracts only when their production behavior genuinely exists.
> Update nearby architecture/contract docs in the same change. For every
> source slice run `pnpm test && pnpm typecheck`; for eval/transformation work
> also run `pnpm eval:validate`, `pnpm test:transformation`,
> `pnpm eval:deterministic`, and strict mode, which may fail only for the exact
> remaining known-red set. Run sandbox/live checks only when required and
> separately authorized.
>
> Keep eval validity separate from product outcome; record misses. At each gate
> report changed files, promoted/still-red contracts, exact checks, benchmark
> evidence, docs, risks, and the next human decision. Continue until the phase
> is complete or material authorization is required.
