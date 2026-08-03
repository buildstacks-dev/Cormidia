# Episode operating contract

*Version: efficiency/v1 · Evaluation semantics ratified 2026-07-12 ·
Organization-wide operating doctrine ratified 2026-07-13 · Canonical normative
home (formerly `docs/efficiency.md`)*

This document defines Cormidia's route, budget, measurement, and variance
semantics — the operating half of the ratified efficiency doctrine. Other
documents link here and must not carry a divergent numeric budget table.
Platform qualification, campaign, and release-gating semantics are
[`docs/qualification/design.md`](../qualification/design.md). Ratification
lives in `docs/PURPOSE.md` (Decided → Efficiency doctrine and evaluation
semantics); the executable requirement inventory is `eval/contracts.yaml`.

<!-- efficiency-contract:start -->

## Normative identities

- A **campaign** is a predeclared ordered set of cases, repetitions,
  fingerprints, budgets, exclusions, retry allowances, and stop rules.
- A **case** is a versioned starting state, task, side-effect policy, oracle,
  and route expectation.
- An **episode** is the end-to-end unit responsible for one outcome and one
  route.
- A **role invocation** is one scheduled, event-driven, or manual invocation
  of an organizational role; it may execute a pipeline.
- A **pass** is one configured protocol stage. It is an orchestration identity,
  not a provider-accounting identity.
- An **execution step** is one terminal provider or deterministic operation
  record within an episode. Every started step has one truthful terminal
  execution record.
- A **provider turn** is one adapter invocation capable of consuming tokens.
  It joins to exactly one provider settlement.
- A **mechanical step** is deterministic and constructs no adapter. It joins
  to zero provider settlements and cannot increase turn, token, or cost totals.
- An **attempt** is one immutable case repetition, including safety, budget,
  infrastructure, product, and harness failures.

Readiness states are `ready`, `blocked`, `invalid`, and `incomplete`. A missing
required live case, authentication, usage observation, or evidence can never
produce `ready`.

Avoid bare “turn” in normative text when the intended identity is ambiguous.
If one configured pass invokes a provider again for reformatting, recovery, or
another substep, each adapter invocation is a distinct provider turn and must
settle exactly once. A pass-level summary cannot hide those turns.

## Route admission

Every episode begins with a bounded, deterministic EpisodeIntent containing
facts, constraints, hard ceilings, available roles and assignments, safety
facts, and any explicit creator scope. A complete provenance-bearing creator
scope is normalized token-free into the same EpisodePlan schema. Otherwise a
dedicated EpisodePlanner runs using an explicitly configured fixed assignment.
Its boot turn is admitted against its own turn cap and the hard org/app/
invocation ceilings before its runtime is constructed, settles exactly once,
counts in the episode's totals, and cannot select itself.

The accepted EpisodePlan is the episode's workflow authority. Before the first
delivery runtime is constructed it durably records its intent hash, version,
planning source and provenance, typed dependency graph, required inputs and
outputs, deterministic gates and approval boundaries, exact atomic assignments,
per-turn ceilings and estimates, total estimated budget, and derived safety
route. Fixed mode resolves assignments from configuration after workflow
design; adaptive mode accepts only exact candidates approved by the org and
narrowed by the app. No fallback may silently change one tuple member.

Deterministic validation checks role and candidate membership, harness/model/
effort compatibility, required capabilities, declared qualification provenance
and current non-billable availability,
DAG integrity and reachability, budget arithmetic, terminal coverage, approval
and critical-operation policy, mandatory gates, release constraints, and
independent or cross-provider review. Policy may reject a plan or require one
bounded repair; any mandatory floor must be visible in the accepted plan. It
must not quietly substitute a generic static workflow.

Mechanical gates and approval checkpoints currently construct no provider
runtime, so their equivalent-provider monetary overhead is deterministically
`$0`; a planner cannot invent a non-zero overhead allowance. Their count,
active time, approvals, and external consequences remain bounded separately.

Admission then durably records the accepted plan version, derived
`planned_route`, policy version, explicit risk and uncertainty factors,
assignments, budgets, and lower/upper cost. `planned_route` is an immutable
projection of plan V1. `current_route` changes only through a recorded
forward-only plan revision or safety reassessment; `final_route` records the
projection under which the episode actually terminated.

Valid safety and reporting factors remain blast radius, reversibility,
sensitive domain, uncertainty/ambiguity, component or external-system count,
release consequence, novelty relative to validated evidence, and evidence/test
quality. Prompt length, repeated keywords, role availability, title, labels,
and apparent simplicity cannot authorize a planner bypass or select a route.

A new finding may escalate a route. Escalation preserves valid artifacts and
records its factor, remaining budget, and newly authorized budget. A cap never
authorizes false completion: insufficient remaining budget parks or reassesses
before the next provider turn.

Equivalent-cost admission remains pessimistic and pre-runtime for every
provider turn, including the EpisodePlanner boot turn. Under the episode lock,
Cormidia adds settled provider cost to every in-flight reservation, then reserves
the applicable planning cap or the smaller of the planned step ceiling, the
role's per-turn cap, and the episode's remaining hard cost. That reservation
becomes the adapter request's actual `maxTurnBudgetUsd`; it is not merely
telemetry.
Finalization atomically replaces the reservation with observed usage, so a
retry or concurrent settlement cannot count both. Mechanical steps create no
provider reservation and consume no equivalent-cost budget.

There is no positive estimation-variance allowance. The implementation uses a
`1e-9` USD epsilon only to make floating-point comparisons stable. Any larger
observed overrun stops and returns the episode with cap, settled cost, other
reservations, the turn's reserved exposure, and the denied step recorded.
Partial, unavailable, invalid, or legacy-unreserved usage fails closed before
another provider runtime can be constructed. A human may preserve the durable
work and explicitly reassess the route; estimation variance never silently
makes the route cap advisory.

The executable plan validator consumes structured facts and the proposed plan;
it validates rather than authors the workflow. Quick/standard/deep is derived
from accepted plan complexity and safety factors for compatibility, reporting,
hard-ceiling selection, or a safety floor. It never chooses the pass set, model,
effort, or planner bypass. Mechanical-only completion remains limited to the
ratified allowlist. Unexpected findings can preserve valid artifacts and cause
a bounded forward-only plan revision; they cannot mutate a completed step or
silently substitute an assignment.

The EpisodePlan belongs to the episode. A route, planning-depth value, selected
pass set, or pipeline name is evidence derived from the accepted plan, not a
second workflow authority. Static pipelines may provide governed step/gate
vocabulary or complete creator-selected workflow templates, but cannot replace
the accepted plan as the primary workflow.

## Context and continuation budgets

Context is admitted under the accepted plan and derived route just like turns
and cost. Each
pass records source and rendered bytes, component hashes, cache identity,
prior-pass change state, duplicate relationships, category caps, transport,
and deterministic eviction. Unchanged material may travel as a stable
reference and changed material as a delta. Authority, safety, acceptance
criteria, contracts, and unresolved findings are required and never evicted;
if that required set exceeds the route cap, admission stops before runtime
construction and the route must be reassessed. Cache visibility reports the
adapter's actual capability—never a fabricated zero.

The episode execution journal advances through ready steps in the accepted plan
DAG and records the plan version that authorized each step. Restart selects the
same next ready step deterministically. Repeating accepted work requires a
durable invalidation reason and a forward-only plan revision that replaces only
the affected future suffix. Plan and route bounds cover planning revisions,
environment retries, tool calls, active wall time, claim attempts, repair
attempts, review cycles, provider turns, and cost. Cap stop, cancellation,
crash, and timeout are terminal execution outcomes with an executable resume
decision; they do not erase artifact, episode, plan, assignment, or settlement
evidence.

## Lifecycle evidence vocabulary

These evidence states do not replace the persisted app registry states
`onboarding | live | paused`:

| Evidence state | Claim permitted |
| --- | --- |
| Generated | Local app/org artifacts were created; no registry, remote, runtime, or schedule claim follows. |
| Registered | The org registry and app-owned config agree; the app remains onboarding. |
| Runtime-ready | Deterministic verification proves refs, ancestry, managed clone, authority/config hashes, app checks, locks/approvals, and required adapters. |
| Live | Human-selected registry policy permits ordinary manual/dispatch work; scheduler installation is not implied. |
| Autonomously scheduled | The correct org-scoped scheduler is installed, healthy, and emits attributable due/executed/skipped/blocked evidence. |

The ladder is a claim vocabulary projected from real evidence, not a second
database or lifecycle state machine.

The autonomous claim is defined by [`docs/scheduler/design.md`](../scheduler/design.md). It
requires an owned/current org-scoped definition, observed loaded/active manager
state, a recent completed tick, valid due-decision and orphan denominators, and
provider-turn/settlement agreement. Missing/corrupt evidence is
`invalid_measurement`; definition-file presence, CLI preview, or configuration
inspection cannot satisfy the claim. Scheduler lifecycle, aggregation,
empty-window learning, and missed-window reconciliation are mechanical and
must construct zero provider runtimes.

## Canonical route budgets

<!-- efficiency-budgets:start -->

| Route or case | Provider turns | Input tokens | Equivalent cost | Active time | Human decisions |
| --- | ---: | ---: | ---: | ---: | ---: |
| Deterministic lifecycle | 0 | 0 | $0 | <=5 minutes | Policy-required only |
| Quick | <=3 | <=2M | <=$8 | <=20 minutes | <=1 |
| Standard | <=5 | <=4M | <=$15 | <=45 minutes | Declared by policy |
| Deep | <=8 | Declared per case | <=$40 | <=90 minutes | <=5 genuine decisions |

<!-- efficiency-budgets:end -->

The provider-turn cap includes the EpisodePlanner boot turn when it runs. A
plan that cannot fit the applicable hard ceiling must derive a higher permitted
route, reduce scope through an explicit revision, or fail with the minimum
safe budget and required scope/config change. No provider turn is hidden and no
required review is skipped to preserve a label.

## Measurements

Each metric exposes its numerator, denominator, excluded record identities,
and missing inputs. Required missing input yields `invalid_measurement`; it is
never represented as zero or pass. Orchestrator-owned artifacts and state are
authoritative; agent prose is not.

- **Model turns:** unique provider-turn settlements attributed to the episode.
  Grader and replay-orchestration provider turns are reported separately.
- **Input/output tokens:** sum adapter settlements by quality. Cache read/write
  are components of input and are never added to input twice.
- **Context by source:** rendered bytes by context-manifest category. Adapter
  token totals stay separate unless authoritative token attribution exists.
- **Equivalent cost:** provider-reported cost when native, otherwise an
  estimate from the campaign's versioned conservative catalog. Quality is
  `reported`, `estimated`, `partial`, or `unavailable`; unknown is not `$0`.
- **Elapsed time:** terminal timestamp minus admission timestamp, including
  waits.
- **Active wall time:** union of process, mechanical-step, and provider-turn
  execution intervals. Parallel overlap counts once. Provider latency is
  included; human wait is excluded and reported separately.
- **Human decisions:** authority/state-changing operator actions: approve or
  deny, criteria sign-off, route/budget override, or material clarification.
  Campaign start and passive observation do not count.
- **Productive model pass:** a provider turn whose artifact/state hash proves a new
  required decision, durable transition, code artifact, evidence-backed
  finding resolution/rebuttal, or required independent verification.
- **Productive-pass ratio:** productive model passes divided by all episode
  provider turns. Adapter-start failures and unchanged reasoning remain in the
  denominator.
- **Repeated-work cost:** cost of a pass whose intended valid fingerprint
  already existed, including downstream repetition it caused.
- **Artifact continuation:** eligible interruptions resumed without rerunning
  a still-valid productive pass divided by all eligible interruptions.
- **Approval precision:** unique semantically critical approval requests
  divided by all unique approval requests. Flat role-forbidden denials are not
  approval requests.
- **Approval recurrence:** materially identical requests after an unchanged
  prior denial, keyed by normalized semantic action and scope.
- **Terminal integrity:** admitted episodes and started execution steps with
  one truthful terminal record divided by all admitted/started identities.
- **Ledger coverage:** provider execution steps with exactly one settlement
  divided by all provider execution steps; mechanical steps separately require
  zero settlements.
- **Scheduler reliability:** due ticks executed or given one durable typed
  skipped/blocked reason divided by all due ticks; duplicates are a separate
  zero-tolerance failure.
- **Learning capture:** eligible finalized provider runs projected exactly once
  divided by all eligible finalized provider runs. Reserved replay runs are
  explicitly ineligible.
- **Learning governance:** every comparable evidence event has one durable
  disposition, and every activated intervention has complete evidence,
  cluster, candidate, independent-review, experiment, approval, publication,
  activation, and outcome lineage. Missing lineage is degraded, never green.
- **Learning efficacy:** valid comparable control/treatment outcomes whose
  declared primary metric improves without a hidden guardrail regression.
  Missing denominators, fixtures, fingerprints, guardrails, or post-activation
  coverage are `invalid_measurement`; event and candidate counts are not an
  efficacy numerator.

`cormidia learn report --efficiency-health` is the canonical projection of these
three independent dimensions. It is read-only unless `--refresh` is supplied;
the refresh writes only rebuildable evidence/health projections and cannot
write protected active learning state.

Health reports **yield**, not just receipts (#141). `projected_exactly_once`
says the projector ran over a run; it says nothing about whether anything came
out, so a projector emitting nothing for every run once read as perfectly
healthy while the Phase 4 loop was dead. Alongside the receipt counters,
`capture` now carries `runs_without_events`,
`runs_without_efficiency_evidence`, and `evidence_gaps` — the eligible runs
that finalized `failed` or `cancelled` and yet produced no efficiency evidence
at all. A non-empty `evidence_gaps` degrades `capture.status`.

The bar is deliberately narrow so the check cannot cry wolf. Only statuses the
projector is *guaranteed* to classify count, so a gap always means the
projector failed rather than that the status has no class yet. `blocked` and
`timed_out` are excluded: `blocked` is a merit outcome (an approval-gated
pass — healthy operation), and counting either would pin an approval-gating
org to `degraded` permanently with gaps no fix could clear. A healthy run
simply has nothing to classify, and that is not a gap.

Back-fill is likewise not a fault: re-projecting a run whose receipt predates a
projector fix legitimately re-derives events already on disk alongside new
ones, and that overlap does not count as a duplicate projection. Otherwise the
refresh that repairs an org would degrade its health.

`governance.status` distinguishes "clusters evaluated, none actionable" from
"no input at all": with `evidence_events: 0` it reports `invalid_measurement`,
never `healthy`. Absence of evidence is not absence of problems. Genuine
governance faults still outrank the missing denominator — lineage gaps and
overdue reviews report `degraded` even with no evidence, so an actionable
problem is never masked by "no input".

## Threshold semantics

1. **Hard invariants** gate every attempt: outcome oracle, safety, terminal
   integrity, exact settlement, hidden-answer isolation, deterministic token
   leakage, and no unapproved outward effect.
2. **Admission bounds** apply to each episode. Crossing one creates an honest
   variance, escalation, park, or stop; it never creates a hidden pass.
3. **Distribution SLOs** evaluate productive ratio, median/p90 context/cost,
   approval precision, continuation, and scheduler reliability over a
   predeclared campaign and rolling windows—not one favorable run.

Deterministic injected continuation points require 100% correct continuation.
Known action corpora require 100% approval precision and recall. Initial
operations targets are >=95% productive passes, >=95% artifact continuation,
>=90% live approval precision, >=99% terminal integrity, >=99% scheduler
reliability, and 100% eligible learning capture. Recalibration requires a new
versioned human decision.

<!-- efficiency-contract:end -->
