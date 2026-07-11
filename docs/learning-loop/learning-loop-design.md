# Learning Loop - Design Document

**Status:** v0.8 - ratified 2026-07-11 (`docs/PURPOSE.md` → Decided → Learning
loop design); revised per the consolidated design feedback of 2026-07-10
(`archive/2026-07-10_feedback.md`)  
**Build status:** built through M5 (PR #52, 2026-07-11); where this document and the code diverge, the code and `AGENTS.md` are authoritative  
**Date:** 2026-07-11  
**Companions:** `learning-loop-spec.md` (schemas), `learning-loop-milestones.md` (release plan)

v0.8 changes: the **episode** replaces the turn as the unit of treatment
assignment and outcome measurement (§8); **executable experiment contracts**,
required conditionally by claim and tier (§9.1); intervention lineage across
every destination, not only OKF (§9.2); a **three-layer evaluation system**
with `ReplayCapsule` as the reproduction substrate (§9.3–9.4); a
deterministic, content-bound **publisher** (§11.1); **proportional approval
routing** (§6.1); candidate storage separated from active bundles (spec §3);
the org-home claim corrected to the ratified package/org/state separation;
protected learning paths expanded; provisional TTL enforced by the resolver.
v0.7's scope model, migration plan, and cache-stability rules carry forward.

## 1. Overview

Learning Loop is Operon's governed self-improvement system. It observes what
actually happens during agent work, turns repeated failures and corrections into
reviewable improvement candidates, publishes accepted improvements to the right
durable artifact, and measures whether those improvements help.

The central correction from the current v0 memory design is this:

> Not every improvement is memory, and not every memory note should become an
> active instruction.

Some learnings belong in high-authority protocol surfaces such as `TASTE.md`,
`roles.yaml`, `pipelines.yaml`, `prompts/**`, or app `AGENTS.md`-style guidance.
Some belong in reusable Agent Skills. Some are scoped OKF knowledge. Some should
be tests or gates. Some are just tickets. The learning loop's job is to route
evidence to the narrowest, lowest-authority artifact that remains useful, then
promote upward only when repeated evidence proves it belongs there.

The second correction, new in v0.8, is honesty about what the loop can claim.
Two assertions must never be conflated:

- **Authorized.** A human approved this change; it may activate. This is a
  governance claim.
- **Validated.** A declared experiment measured this change against a baseline
  and the declared outcome improved. This is an empirical claim.

A governed change-management loop can safely introduce plausible improvements:

```text
evidence -> candidate -> review -> approval -> publication -> exposure -> report/rollback
```

A defensible empirical learning loop can prove a specific change caused
improvement:

```text
baseline -> isolated intervention -> comparable outcomes -> measured effect -> promote or reject
```

V1 ships the first loop and builds the substrate for the second (§8–§9).
Every activation records which claim it holds; `authorized` never silently
upgrades to `validated`.

The implementation target is **inside Operon first**. The interface boundaries
should stay clean enough that this can later become a standalone library, but V1
should optimize for a solid Operon integration, not for an abstract npm package.

## 2. Goals and Non-Goals

**Goals.**

- Provide a governed write path into durable agent context and operating rules.
- Route learnings to the right destination: OKF, skill, protocol proposal,
  eval/gate proposal, ticket, or rejection ledger.
- Make accepted learnings evidence-linked, reviewable, versioned, reversible,
  and measurable.
- Make the **episode** — the complete task the org is responsible for — the
  unit of treatment assignment and outcome measurement.
- Distinguish human-authorized changes from efficacy-validated changes, and
  make validation executable via declared experiment contracts.
- Treat active context as a prompt-injection persistence surface.
- Preserve Operon's app-aware model: one turn, one app; cross-app craft memory
  stays separate from app-domain knowledge.
- Keep autonomy earned by measured agreement and outcomes, never granted by
  release.

**Non-goals.**

- This is not online model training, vector RAG, or a new orchestrator.
- This is not a general experimentation platform. Experiment contracts serve
  the learning loop's own promotion decisions; V1 replay covers **build
  episodes only** (git provides the state snapshot). Support/Marketing/SRE
  replay needs synthetic channels and disposable services and is deferred to
  V2 (milestones).
- V1 does not need identity or customer-account scopes.
- V1 does not auto-merge learning PRs or auto-execute canary decisions.
- V1 does not need extraction into a standalone package.

## 3. Artifact Destinations

The distiller produces candidate artifacts, not just "candidate memories."

| Destination        | Use When                                                                     | Examples                                                                           | Authority                                              |
| ------------------ | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------ |
| OKF concept        | Scoped fact, lesson, product/account context, or evidence-linked observation | "Marketplace demo has no external support channel yet"; "Acme requires PO numbers" | Lowest active context tier; reviewed before activation |
| Skill draft        | Repeatable procedure with steps, tools, pitfalls, and examples               | "Support feedback triage workflow"; "Browser QA checklist for Vite apps"           | Review-gated; promoted when recurring                  |
| Protocol proposal  | Broad rule that should shape many turns                                      | "Never invent user feedback"; "Acceptance criteria must map to tests"              | Human-ratified surface                                 |
| Eval/gate proposal | A mechanically checkable weakness                                            | Browser build imports must resolve; event fan-out must preserve all subscribers    | Test/gate PR; can block future regressions             |
| Ticket             | Product/runtime work is required                                             | Fix lossy event fan-out; include file-drop payload in dispatched briefs            | Normal Operon issue/PR loop                            |
| Rejection ledger   | Candidate is wrong, too broad, stale, or unsafe                              | "Rejected: infer support reply without source payload"                             | Suppresses repeat proposals                            |

Rule of thumb:

> Put the lesson at the lowest-authority, narrowest-scope place where it remains
> useful.

That rule keeps `TASTE.md` and `AGENTS.md` from turning into junk drawers, keeps
skills procedural, and keeps OKF knowledge selective.

Every destination — not only OKF — shares one intervention lineage: an
`InterventionRecord` links candidate, reviewed content, final change,
activation, affected episodes, experiment, outcome, and rollback (§9.2). OKF
bundles get versioned manifests and canaries; a prompt change gets a PR and
the same lineage record. Nothing activates without a traceable record of what
changed and what happened next.

## 4. Scope Model for Operon V1

V1 has four scopes:

```text
org/
roles/<role>/
apps/<app>/
apps/<app>/roles/<role>/
```

### 4.1 What Each Scope Means

`org/`  
Loaded for all roles and all apps. Use sparingly for facts and lessons that are
truly universal across the org.

Example: "External-channel content is untrusted until source provenance is
stamped."

`roles/<role>/`  
Cross-app craft knowledge for one profession.

Examples:

- `roles/builder/`: "When browser TypeScript imports local modules, inspect the
built JS entry for extension correctness."
- `roles/reviewer/`: "A passing Node test suite does not prove browser render;
inspect or exercise built browser entrypoints when the app has a UI."
- `roles/sre/`: "Classify localhost bind `EPERM` inside agent environments as
environment evidence before blaming the product."
- `roles/support/`: "Do not invent replies when no source feedback payload is
available."
- `roles/marketing/`: "Release copy must cite shipped artifacts, not planned
features."

`apps/<app>/`  
Product-domain knowledge every role needs when touching that app.

Examples:

- `apps/operon-marketplace-demo/`: "This product is a local ecommerce demo with
customers, vendors, catalog filtering, and localStorage persistence."
- `apps/buildstacks-dev/`: "The product voice is personal and practical, not
enterprise SaaS."
- `apps/civic-intelligence/`: "Evidence honesty is core; uncertainty should be
explicit."

`apps/<app>/roles/<role>/`  
Knowledge needed only by a specific role on a specific product.

Examples:

- `apps/operon-marketplace-demo/roles/support/`: "Until real support channels exist,
support-feedback events should become intake-flow issues, not user replies."
- `apps/operon-marketplace-demo/roles/marketing/`: "Marketing is draft-only; no
outbound publishing."
- `apps/buildstacks-dev/roles/sre/`: "Use this app's deploy verification flow
before declaring launch readiness."

### 4.2 Deferred Scopes

`identities/` **is deferred.** It matters only when one role has multiple named
employees with different durable responsibilities, such as `support-us-anna`
and `support-eu-max`. Operon does not need that in V1.

`accounts/` **is deferred.** It matters when an app is doing customer-specific
operations, such as "Acme Corp requires invoice PO numbers" or "Customer X has
a custom SLA." Those are excellent OKF concepts, but they belong to a future
Support/Sales/customer-ops layer, not core Operon V1.

The docs may mention these as future extensions, but the implementation should
not pay their complexity tax yet.

### 4.3 Precedence

For one run, the resolver loads the applicable scopes in this order:

```text
org -> roles/<role> -> apps/<app> -> apps/<app>/roles/<role>
```

Conflicts should be rare because the scopes answer different questions. When
two active concepts share an explicit `topic_key`, the narrower scope wins
deterministically, and the resolver emits a `conflict_resolved` event so
compaction can propose cleanup. Conflict resolution happens **before**
budgeting (spec §8.1), so a broad-scope loser can never starve out the
narrow-scope winner. A real semantic conflict without a shared `topic_key` is
escalated to review, not silently resolved.

## 5. Architecture

The Operon-first loop has nine components.

**Capture.** The orchestrator records learning events from runlogs, quality
gates, approvals, scorecards, telemetry, file-drop payloads, and explicit human
corrections. Agent self-reports are allowed as advisory input, but they never
drive promotion metrics. Capture is a projection, not a new write path: an
idempotent projector walks `runs/<app>/<runId>/{envelope.json, events.jsonl}`
with a persistent cursor and emits learning events. Gate outcomes come from L1
`gate_results` and L2 `gate.*` events; pass verdicts come from L2
`verdict.recorded` events (verdicts are not persisted anywhere else on disk).
Capture also maintains the **episode projection** (§8.3): every learning event
carries an `episode_id`, and episode open/close/outcome events are derived
from the same process-owned sources.

**Classify.** A lightweight router decides which destination a cluster appears
to want: OKF, skill, protocol proposal, eval/gate proposal, ticket, or reject.
This can begin as deterministic rules plus reviewer prompts; it does not need
to be clever on day one.

**Distill.** A scheduled pass clusters events by stable `error_class` and
`cause_hypothesis`, checks the live bundle and rejection ledger for duplicates,
and drafts candidate artifacts with proposed destination, scope, tier, evidence,
and review requirements. The distiller runs only after **deterministic
prechecks** find actionable evidence (§9.5); no model turn is spent on an
empty window.

**Review.** A reviewer agent scores correctness, generality, scope fit,
destination fit, provenance trust, conflict, and injection risk. Reviewer
verdicts are structured JSON and fail closed when unavailable.

The distiller and reviewer are **org roles, not a side system**. They get
`roles.yaml` entries with runtime/model/effort and schedule triggers, and they
run through the normal turn runner — which means they inherit budget caps,
telemetry, the critical-ops gate, runlogs, and adapter conformance for free.
The reviewer runs on a **different provider** than the distiller, for the same
uncorrelated-blind-spots rationale already ratified for builder ≠ reviewer in
`test/roles.test.ts`. Adding these roles and their pipelines is a proposal PR
against `roles.yaml`/`pipelines.yaml` — human-ratified surfaces — which is the
correct amount of ceremony for standing up new standing agents.

**Publish.** A deterministic publisher — not the distiller and not the
reviewer — turns an approval into artifacts (§11.1). One approval authorizes
one content-hashed publish transaction:

- OKF concepts land in the appropriate active bundle after approval.
- Skill drafts land as proposal artifacts until reviewed.
- Protocol changes become proposal PRs against human-ratified surfaces.
- Eval/gate proposals become normal test/gate PRs.
- Tickets enter the normal Operon issue loop (deduplicated and rate-capped;
  routine, no human gate — §6.1).

**Resolve.** At turn start, Operon resolves knowledge once for
`(app, role, turnId, episodeId)` and pins the resulting bundle versions for
the whole turn/pipeline. Already-running turns never re-resolve. Canary lineage is
chosen per **episode**, not per turn (§8.4), so every turn in one episode sees
the same bundle lineage.

Selection rule for V1: resolve conflicts first, then **load every active
concept in the four applicable scopes within per-scope budget shares** (spec
§8.1). The scopes are narrow by construction (`apps/<app>/roles/<role>` is
inherently small), so relevance ranking is premature; keyword matching against
the task text is only a tie-breaker *within* a scope that overflows its share.
Ordering within a scope is deterministic (sorted by concept id) — required for
cache stability (§12.1). The resolver also enforces provisional TTLs: an
expired provisional concept is never loaded, and its expiry is emitted as an
event rather than left to a report-only compaction pass. This replaces the
current keyword-substring selector in `src/org/memory.ts` (`selectExcerpts`).

**Evaluate.** The evaluation subsystem runs declared experiments (§9): fast
deterministic checks on every implementation PR, offline behavioral replay
from `ReplayCapsule`s before activation of efficacy-claiming candidates, and
human-started sticky episode canaries when live verification is safe. Results
land as `EvalResult` records with one of four verdicts:
`improved | regressed | inconclusive | not_evaluatable`.

**Measure.** Metrics track concept loads, recurrence of trusted failure events,
episode outcomes by bundle lineage, experiment verdicts, context budget,
reviewer-human agreement, human decision agreement with canary
recommendations, and cost per experiment / per accepted improvement.

**Compact.** A scheduled report proposes deprecation, merge, promotion, and
supersession work. In V1, compaction is human-executed. Automation is earned
later.

## 6. Risk Tiers

Tiers are based on authority and blast radius, not on which role observed the
lesson.

| Tier | Contents                                                             | Default V1 Approval                        | Allowed trials                                     |
| ---- | -------------------------------------------------------------------- | ------------------------------------------ | -------------------------------------------------- |
| T0   | Low-risk scoped facts                                                | Human in V1; reviewer-only later if earned | None required; `not_evaluatable` is acceptable     |
| T1   | Procedures, skills, repeatable workflow lessons                      | Human                                      | Replay and/or episode canary, report-recommended    |
| T2   | Behavior/protocol changes that steer agent decisions                 | Human                                      | Mandatory eval gate: replay before any canary       |
| T3   | Tools, permissions, config, deployment, publishing, security posture | Human, forever                             | **Sandbox, replay, shadow, or bounded manual trials only — live canary exposure is forbidden** |

Two overrides always apply:

- Untrusted external provenance escalates to human review.
- Conflict with an active concept escalates at least one tier.

T0 auto-merge can exist as code, but it ships off. It turns on only after V1 has
reviewer-human agreement evidence.

### 6.1 Proportional Approvals

The learning loop must not recreate the human-attention failure that
proportionality removed. Human approval gates exactly three things:

1. **Activation into future context** — any concept entering an active bundle,
   including provisional quarantine authored by anyone but a human.
2. **High-authority changes** — merges to human-ratified surfaces, and
   anything T2/T3.
3. **Promotion and live experimentation** — stable-pointer bumps, canary
   starts, and canary promotions.

Everything below that bar is routine and ships without a human gate:

- Opening a **deduplicated, rate-capped** internal ticket (`GhOps.createIssue`
  with a candidate fingerprint; policy caps open learning-issues per app per
  period). Tickets are outward writes, so dedupe and caps are mandatory, but
  they enter the same issue loop humans already triage.
- Publishing an **unmerged proposal draft** (skill draft, protocol proposal
  PR, eval/gate proposal PR). The merge is where the authority lives, and
  merges of ratified surfaces stay human-gated as they always were.
- Recording a rejection in the ledger.

One human decision authorizes **one content-hashed publish transaction**
(§11.1), never a fan of per-file approvals.

### 6.2 OKF Content Bounds

OKF holds bounded facts and procedures. It is not a memory-shaped bypass
around human-ratified surfaces: **permissions, security posture, deployment
behavior, tool grants, gate semantics, and constitutional behavior must not be
expressed as OKF concepts at any tier.** Evidence in those domains routes to
`protocol_proposal`, `eval_or_gate_proposal`, or `ticket` — proposal, code, or
config changes on the surfaces that already govern them. The classifier
enforces this as a deterministic deny-list on candidate content domains; a
concept candidate that trips it is re-routed or escalated, never published as
memory.

## 7. Two Lanes: Run Repair vs. Durable Learning

Run remediation and durable learning are different trust regimes.

When a run fails, Operon's existing gates, retries, tickets, and review cycles
fix the run. That path should stay fast and operational.

When a lesson should change future context, it enters the learning loop. If a
fact is urgently needed before the review cycle completes, a human may author a
provisional OKF concept in quarantine with a short TTL and an explicit
UNVERIFIED label. Quarantine is a labeled temporary lane, not a bypass; the
resolver enforces the TTL (an expired provisional never loads), and
provisionals never silently promote.

Agents may emit learning notes or draft candidates freely. They should not write
active future instructions directly.

### 7.1 Migration off Agent-Direct Memory Writes

Today, **all** OKF memory is written by agents directly: the end-of-turn
protocol injected into every context bundle (`src/org/context.ts`) instructs
agents to author docs straight into `memory/roles/<role>/` and
`.operon/memory/<role>/`, and the critical-ops gate allows it — `memory/**` is
not a protocol surface. `writeMemoryDoc` and `runRetroCuration` exist as
library code but have no callers in any runtime path. The real migration is
therefore *agents-write-active-memory → agents-emit-candidates*, and it is the
single largest behavioral change in this design. If the learning loop ships
while the direct write path stays open, there are two write paths into agent
context — one governed, one not — and the ungoverned one wins on latency.

The migration has three parts, all landing in M1 (capture-only):

1. **Redirect the end-of-turn protocol.** The injected instruction changes
   from "write OKF docs into memory trees" to "emit learning notes as
   candidate input" (a quarantine-style notes path or `operon learn emit`).
   Agents keep the habit of recording lessons; the lessons stop being
   instantly active.
2. **Gate the learning surfaces mechanically.** New gate rules make writes to
   `learning/bundle/**`, `learning/manifest.yaml`, `learning/policy.yaml`,
   `learning/evals/**`, `learning/reviews/**`, and `learning/rejections.jsonl`
   (and their `.operon/learning/**` app-repo counterparts) critical ops — same
   shape as the existing `scorecard-tamper` rule in `src/runtime/gate.ts`.
   Every governance surface of the loop becomes orchestrator/human-only by
   enforcement, not etiquette: protecting only the bundle would leave the
   policy that governs it, the evals that validate it, and the ledger that
   suppresses bad candidates all writable by the agents being governed. Per
   the working rules, each gate rule ships with test cases for both the
   critical side and a routine near-miss.
3. **Retire `runRetroCuration`.** Its destructive dedupe/delete is ungated and
   it was never wired in. Its one good idea — skill drafts from recurring
   keywords — ports into the distiller's `skill_draft` destination.

**Legacy memory trees are read-only seed context.** Existing
`memory/roles/**` and `.operon/memory/**` docs keep resolving, at lowest
precedence, stamped `trust: legacy`. Individual docs get promoted into the
governed bundle through the normal candidate path when evidence warrants; no
bulk migration.

## 8. Episodes: the Learning and Experimental Unit

A **turn** is one role-agent's contribution. An **episode** is the complete
end-to-end task whose outcome the organization is responsible for.

```text
Episode: deliver ticket #42
├── Planner turn
├── Builder contract turn
├── Builder implementation turn
├── Reviewer turn
├── Builder fix turn
├── quality gates
└── merge and release disposition
```

Turn-level records remain essential for diagnosis: they show which role made a
decision, repeated work, missed context, raised an escalation, or produced a
finding. The episode supplies the meaningful outcome: whether the task
completed, shipped, stayed within budget, required rework or human attention,
and later produced an escaped defect or incident.

The governing rule:

> Learning evidence may originate at the turn level, but treatment assignment
> and outcome measurement happen at the episode level.

### 8.1 Episode Boundaries

| Work kind | Episode boundary                | Durable anchor                                  |
| --------- | ------------------------------- | ----------------------------------------------- |
| Build     | Ticket (or bootstrap milestone) | The M5 ticket state machine's process-owned state |
| SRE       | Incident                        | Incident event chain from dispatch              |
| Support   | Feedback thread                 | File-drop feedback event(s) sharing a thread key |
| Marketing | Campaign or release             | Release/campaign event                          |

Episode ids derive deterministically from the durable anchor
(`ep_<app>_<kind>_<source-key>`, spec §5), so every turn in the episode —
across roles, retries, passes, and interruptions — computes the same id with
no coordination.

### 8.2 What an Episode Contains

Every episode durably contains or references:

- The original task, ticket, incident, feedback thread, campaign, or event.
- Stage, risk tier, app, participating roles, and release disposition.
- The `SystemFingerprint` under which it ran (spec §6).
- All turns, retries, gates, approvals, artifacts, and side effects.
- Immediate outcome metrics and later-maturing outcomes (escaped defects,
  incidents attributed back to the episode).
- Human observations and their eventual dispositions (§10.1).

### 8.3 Projection, Not a Second Store

`EpisodeRecord` is a **projection** over sources that already own their state —
the ticket state machine's process-owned state, `runs/<app>/<runId>/` runlogs,
the telemetry ledger, and the approvals store. It is rebuildable from those
sources with a cursor, exactly like the capture projector. It is never an
independently writable second source of truth: the completeness-gate incident
(two stores for ticket state drifting apart) is precisely the failure mode
this rule prevents. Late-maturing outcomes are the one append-only exception —
they are recorded against the episode after its sources have closed.

### 8.4 Sticky Assignment

Canary/treatment assignment is a deterministic function of `episode_id` (never
`Math.random`, never `turnId`). Every eligible turn in the episode therefore
resolves the same bundle lineage — Builder, Reviewer, fix, and gate turns all
see the same world, keeping both the work and the measurement uncontaminated.
The assignment is recorded at first governed resolve as a sticky record at
`learning/canary/assignments/<episodeId>.json` (first write wins;
`src/org/learning/canary.ts`); the `EpisodeRecord` carries the derived
`bundle_lineage` field (`stable | canary | mixed | null`,
`src/org/learning/episode.ts`) for auditability. Turn-hash assignment (v0.7)
is retired.

## 9. Experiments and Evaluation

### 9.1 When an Experiment Contract Is Required

An `ExperimentRecord` (spec §10) is a machine-readable, declared-before-results
answer to:

> What change is being tested, on which episodes, compared with what baseline,
> how will success and harm be measured, and which result causes promotion,
> extension, rejection, or rollback?

Requiring one for every candidate would tax trivial facts with apparatus they
cannot use — at Operon's episode volume, most T0 facts will never justify a
paired replay. The requirement is therefore conditional:

| Candidate                                                  | Experiment contract |
| ---------------------------------------------------------- | ------------------- |
| Claims efficacy (its promotion argument is "this improves X") | **Required**        |
| T2/T3 activation                                            | **Required** (or explicit human waiver recorded on the approval) |
| T0/T1 fact or procedure not claiming measured improvement   | Not required; activation is recorded as `authorized`, its `EvalResult` verdict is `not_evaluatable`, and reports display it as unproven |

`authorized` and `validated` are distinct, permanent markings. A human may
authorize an unproven change; nothing but a completed experiment produces
`validated`.

### 9.2 Intervention Lineage Across Every Destination

Versioning, canaries, measurement, disable, and rollback must not be
OKF-only. Every destination shares one lineage contract:

```text
candidate
-> reviewed content (hash)
-> final PR / commit / bundle version / config change
-> activation time
-> affected episodes
-> experiment (when required)
-> outcome
-> rollback (if any)
```

That chain is the `InterventionRecord` (spec §11). OKF bundles satisfy it via
manifests; a prompt or pipeline change satisfies it via the merged PR plus the
same record. Not every change gets a live canary — T3 changes never do (§6) —
but every destination gets activation and outcome lineage, so "what changed
and what happened next" is always answerable.

### 9.3 Three Evaluation Layers

Replay does not mean reproducing the old transcript or forcing a model to emit
identical responses. It means recreating equivalent starting conditions and
asking the current and candidate systems to attempt the task again. Model
nondeterminism may require multiple paired trials.

| Layer | Purpose | Real model turns | Typical trigger |
| --- | --- | --- | --- |
| Fast deterministic tests | Prove schemas, projection, resolution, pinning, approval binding, gates, disable, and rollback | No | Every implementation PR |
| Offline behavioral replay | Compare stable and candidate behavior in isolated episode fixtures | Yes | Before activation of an efficacy-claiming candidate, or on an explicit scheduled/manual eval |
| Live episode canary | Verify that an offline improvement survives genuine new work | Yes, but performs useful work | Only after replay succeeds, the trial is safe, and a human starts it |

The intended asynchronous flow:

```text
Live episodes continue operating
        v
Evidence and human observations accumulate
        v
Candidate intervention is proposed
        v
Deterministic checks and targeted behavioral eval
        v
Paired offline episode replay: stable versus candidate
        v
Human-started sticky episode canary when safe
        v
Promote, extend, reject, or rollback
```

True held-out behavioral cases remain **verifier-only**. Visible tests in the
app or org repository are valuable regression tests, but they are not held out
if the acting agent can read and optimize directly against their expected
answers. The post-proportionality bootstrap benchmark
(`docs/benchmark-runbook.md`) is the first global eval; it is not sufficient
as the general learning suite.

### 9.4 ReplayCapsule and the Ownership Boundary

The system designs for replay **while an episode is running** rather than
reconstructing everything from logs afterward. Logs describe what happened; a
replay capsule contains what is necessary to safely attempt the task again:

```text
episode record
+ original inputs
+ repository/data snapshot
+ system fingerprint
+ sandbox and side-effect policy
+ expected outcome and grader
= ReplayCapsule
```

The responsibility boundary:

```text
Operon records and reproduces what ran.
The learning loop decides what to test and whether it helped.
```

**Operon core** provides the deterministic recording and reproduction
substrate: durable `EpisodeRecord` lifecycle, immutable inputs and evidence
references, seed commits and fixtures, `SystemFingerprint`, turn/run lineage
with gates/approvals/costs/release disposition, an external side-effect ledger
with a replacement policy (fakes, sandboxes, staging, shadow execution),
capsule completeness validation, sandbox creation, artifact restoration, run
orchestration, and deterministic grading.

**The learning loop** selects episodes worth evaluating, converts them into
sanitized eval fixtures, defines hypotheses/metrics/guardrails/graders,
constructs control and treatment fingerprints, executes targeted evals and
paired replays, produces verdicts, and recommends promotion, extension,
rejection, disable, or rollback.

Capsules classify as `replayable`, `partially_replayable`, or
`non_replayable`. **V1 builds capsules for build episodes only** — Git
provides a strong state snapshot, so the capsule is mostly free. Support and
Marketing need synthetic channels or fake publishing destinations; SRE and
deployment work need disposable services, staging, simulated incidents, or
shadow execution — all V2 (milestones). Replay must never repeat an
irreversible production side effect, regardless of layer.

Most capsule fields assemble automatically. An eval-builder agent may draft
missing fixtures, expected outcomes, rubrics, or graders, but an independent
reviewer — and a human for important or ambiguous cases — must validate them
before the capsule becomes a trusted eval.

### 9.5 Cost Control: Deterministic Capture, Selective Spend

The `ReplayCapsule` itself is overwhelmingly deterministic software. The
expensive operation is executing behavioral replays with real agents, not
recording the episode.

> Capture everything necessary for replay deterministically at the episode
> boundary, but spend model tokens only after deterministic filtering
> identifies a candidate worth evaluating. The ReplayCapsule is cheap; replay
> execution is the metered resource.

The progressive spending funnel:

```text
every live episode
    v  zero-token deterministic capture
completeness, deduplication, recurrence, and eligibility checks
    v
candidate generation and independent review
    v  small model spend
targeted role-level behavioral eval
    v
full paired episode replay
    v  larger model spend
small live episode canary
```

A simplified cost model:

```text
learning cost ≈ distillation
             + independent review
             + repetitions x (control episode cost + treatment episode cost)
             + qualitative grading
```

Required cost controls (policy-encoded, spec §13):

- A separate learning/evaluation budget, implemented as an **overlay in the
  existing budget system** — the org ledger already settles every provider
  turn, and distiller/reviewer/replay turns are ordinary turns in it.
- Per-candidate replay and repetition caps.
- Maximum model-powered distillations and experiments per period.
- No model turn when deterministic prechecks find no actionable evidence.
- Targeted behavioral evals before full episode replay; early stopping when
  the held-in case fails or a safety guardrail trips.
- Full replay only after policy or human authorization.
- Cost per experiment and cost per accepted improvement in reports, with the
  standing requirement that expected benefit justify evaluation cost.

The system must not replay every completed episode.

## 10. Measurement and Low-Volume Canary

Operon will begin with low run volume. A hard "200 canary runs" rule would stall
learning before it starts.

V1 therefore uses a three-part decision rule:

1. **Held-in eval:** the specific weakness the concept claims to fix must pass
   when such an eval exists.
2. **Held-out baseline:** role/app baseline checks must show no regression.
3. **Human decision:** canary and metric reports recommend promote, extend, or
   revert; the human executes in V1.

Run-count thresholds remain useful as confidence signals, but insufficient
sample size should usually produce "extend or human judgment" — recorded as
`inconclusive` — not permanent limbo.

Promotion metrics are computed only from events emitted by the orchestrator,
verifiers/gates, resolver, publisher, or human. Agent-emitted events are
distillation input only. This prevents a Goodhart loop where agents improve
their scores by under-reporting failures.

### 10.1 Human Review and Correction Workflow

Humans are a first-class evidence source, and their input must be traceable to
a durable episode end-to-end. A human reviewing a completed ticket, incident,
support thread, or campaign can:

- Inspect the complete episode: turns, runs, artifacts, gates, decisions,
  configuration fingerprint, and outcome (`operon learn inspect <episode-id>`).
- Record one or more observations against that episode
  (`operon learn emit --episode <episode-id>`), interactively or from a
  structured Markdown/JSON artifact.
- Trace each observation through classification, candidate creation,
  evaluation, activation, rejection, or deferral
  (`operon learn show <event-or-candidate-id>`).

The input contract keeps three fields separate:

1. **Observation:** what the human directly saw. Trusted human-origin
   evidence.
2. **Cause hypothesis:** why the human thinks it happened. A hypothesis even
   when supplied by a human.
3. **Suggested intervention:** what the human thinks might improve it. Still
   requires review and — when it claims efficacy — evaluation.

Human provenance increases trust in the observation; it does not make the
proposed cause or intervention automatically correct. Human-originated
suggestions pass through the same experiment and outcome-measurement contract.

Two manual lanes exist:

- **Normal correction:** enters the standard capture → distill → review →
  evaluate → activate/reject workflow.
- **Urgent provisional instruction:** `operon learn provisional` adds
  explicitly unverified, quarantined context with a hard TTL; it never
  silently promotes (§7).

## 11. Security Model

Active knowledge is a prompt-injection persistence layer. A poisoned concept can
be loaded into many future turns.

Defenses, in priority order:

- provenance stamped at capture time;
- untrusted-channel escalation;
- human approval for activation, high-authority changes, and promotion (§6.1);
- content-bound approval and a deterministic publisher (§11.1);
- cross-provider review: the learning reviewer runs on a different provider
  than the distiller (the ratified builder ≠ reviewer principle);
- fail-closed review;
- candidates stored outside active bundles; the resolver loads only
  `loop.status: active` concepts (spec §3);
- quarantine labeling with resolver-enforced TTLs;
- gate-protected learning surfaces: bundles, manifests, `policy.yaml`, evals,
  reviews, and the rejection ledger (§7.1);
- resolver pinning and context-budget rules;
- rejection ledger;
- `disable <concept-id>` and version rollback;
- OKF content bounds keeping permissions/security/deployment out of memory
  (§6.2);
- metric trust boundary excluding agent self-reports from promotion metrics.

### 11.1 Content-Bound Approval and the Deterministic Publisher

Human approval binds **immutable bytes, not intentions**. An approval record
carries: the candidate content hash, the reviewer verdict hash, the
destination, tier, and scope, the base manifest version (or base commit), and
the final diff hash. If any of those change after approval, the approval is
void and the publish refuses.

A deterministic **publisher** — not the distiller, not the reviewer — performs
one atomic, idempotent publish transaction per approval: journal the intent,
write the artifacts, bump the manifest, mark done. Re-running after a crash
completes or no-ops by approval id; it never double-publishes. The publisher
is orchestrator code with no model in the loop, and it is the only component
allowed to write inside the gate-protected learning surfaces.

## 12. Operon Integration

V1 integrates with existing Operon surfaces:

- **Homes:** committed learning artifacts live in the **committed org home**
  created by `operon org init` (the ratified package/org/state/app separation
  in `docs/PURPOSE.md`; resolution in `src/org/home.ts`). High-churn runtime
  state (events, metrics, episodes, capsules, reports) lives in the state home
  `~/.operon/<org>/`. App-scoped bundles live in the app repo under
  `.operon/learning/`. The Operon source checkout holds none of it.
- **Episodes:** the build-episode projection reads the M5 ticket state
  machine's process-owned state plus `runs/<app>/<runId>/` and the telemetry
  ledger (§8.3) — it does not introduce a second ticket-state store.
- `src/org/context.ts`: replace unversioned memory selection with the resolver
  (pins concept versions, emits `concept_loaded`); change the injected
  end-of-turn memory instruction per §7.1.
- `src/org/retro.ts`: `runRetro` (reporting) keeps running and gains learning
  metrics; `runRetroCuration` — implemented but never wired to any runtime
  path — is retired, with its skill-draft logic ported into the distiller.
- `src/org/scorecards.ts`: feed trusted metrics (already orchestrator-only,
  enforced by the `scorecard-tamper` gate rule).
- `src/runtime/runlog/*`: feed learning events from L1 envelopes
  (`gate_results`, `usage`, `tool_counts`) and L2 events (`gate.*`,
  `verdict.recorded`, `tool.called`) via the capture projector — never from L3
  transcripts.
- **Budget:** the learning budget is an overlay in the existing budget system;
  distiller, reviewer, and replay turns settle into the org ledger like every
  other provider turn, so caps enforce themselves.
- `src/org/events.ts` and `src/org/dispatch.ts`: company-event payloads must
  reach role briefs, and multi-role fan-out must not consume shared events
  early (both landed: per-`(eventKey, role)` consumption via `roleConsumedKey`
  in `src/org/events.ts` / `src/org/dispatch.ts`, and the verbatim payload
  with provenance stamp in `src/org/turn-runner.ts` — see milestones
  Preflight for anchors).
- `src/loop/qgates.ts`: provide trusted verifier events and host eval/gate
  proposals.
- `src/loop/github.ts`: add `createIssue` to `GhOps`/`GhCliOps` — the `ticket`
  destination needs it (landed: `createIssue` on `GhOps`/`GhCliOps` in
  `src/loop/github.ts`).
- `src/loop/verdicts.ts`: reviewer verdict parsing reuses `parseWithRetry` and
  the native structured-output path rather than fresh JSON parsing.
- `src/org/approvals.ts`: the human gate is the existing approvals store
  (pending/decided/grants + `operon approvals`), not a second inbox. Candidate
  approvals are a new item kind carrying the §11.1 binding; the reviewer's
  verdict JSON is stored as evidence, but the human decision lives in the one
  queue. Fail-closed comes free: no grant, no publish. The SLA report reads
  pending-item age.
- `src/org/memory.ts`: the OKF frontmatter validator is **deliberately
  extended** to parse, validate, and preserve the `loop` block (spec §3). The
  current validator reconstructs only known fields, so an unextended
  round-trip would silently strip the loop governance metadata.

The CLI is `operon learn ...`, not `loop-learn`, until extraction earns
itself.

### 12.1 Cache Stability

The resolver sits directly on Operon's most expensive surface. The rules in
`research/2026-07-04_prompt-caching.md` bind it:

1. **Deterministic serialization.** The resolved bundle renders byte-identically
   for the same (bundle versions, role, app): concepts sorted by id within
   scope, scopes in precedence order, no timestamps or turn ids in rendered
   bytes. The resolved-context record (turn id, episode id, concept ids) lives
   in the runlog, never in prompt bytes.
2. **Version churn is the cache cost, concept churn is free.** A version cut
   means one guaranteed cold cache per (role, app). This is an argument *for*
   daily batched cuts: many concept changes, one invalidation.
3. **Canary splits fork the cache.** A canary bundle is a second cache lineage
   per (role, app) — acceptable, but a stated cost. Canary assignment is
   deterministic (hash of **episode id**, §8.4), never `Math.random`.
4. **Conformance check.** Two back-to-back passes under the same pinned bundle
   must show `cacheReadTokens > 0` on the second — same shape as the existing
   cache conformance case.

## 13. Bootstrap

Cold start is phased along the milestones (`learning-loop-milestones.md`):

**M1 - Capture and human review.** Event and episode capture, the human
correction workflow, gate-protected learning surfaces, and closure of the
agent-direct memory path. No automated activation.

**M2 - Episode and replay substrate.** `EpisodeRecord`, `SystemFingerprint`,
`ReplayCapsule` for build episodes, replayability classification,
deterministic finalization.

**M3 - Experiment substrate.** `InterventionRecord`, `ExperimentRecord`, eval
fixtures, trusted graders, control/treatment comparison — offline only.

**M4 - Governed activation.** Candidate review, content-bound approval, the
deterministic publisher, resolver integration, disable, and rollback. Every
activation human-approved.

**M5 - Offline evaluation and human-started canary.** Deterministic and
targeted checks, paired replay, sticky episode canary when safe.

**M6 - Scheduled distillation.** The distiller and reviewer roles on
schedules, behind deterministic prechecks and learning-budget caps.

**Earned autonomy** comes after: narrow automations turn on only with measured
reviewer-human agreement, demonstrated outcome improvement, and no guardrail
regressions. Agreement alone is insufficient.

## 14. Open Questions

- Should app-specific learning manifests live in app repos only, or should the
  org home keep a read-only index of app bundle versions?
- What is the smallest useful baseline eval suite per role/app?
- Which learning event taxonomy is stable enough for V1, and which event types
  should remain advisory?
- What are the right outcome-maturity windows per episode kind — how long
  after a build episode closes can an escaped defect still attribute back to
  it?
- Which qualitative graders are trustworthy enough for guardrail metrics, and
  when must a human grade instead?

## 15. Extraction Later

If a second orchestrator wants this system, the interfaces can be extracted:
EventSink, EpisodeProjector, Distiller, Reviewer, Publisher, Store, Resolver,
ExperimentRunner, Metrics. Until then, the implementation stays inside Operon
so it can reuse runlogs, approvals, scorecards, app registries, GitHub
operations, and quality gates directly.
