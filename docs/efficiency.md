# Efficiency Contract

*Version: efficiency/v1 · Evaluation semantics ratified 2026-07-12 ·
Organization-wide operating doctrine ratified 2026-07-13 · Canonical normative
home*

This document defines Operon's route, budget, measurement, variance, and
qualification semantics. Other documents link here and must not carry a
divergent numeric budget table. The operating-doctrine ratification record is
`docs/efficiency-transformation/phase0-doctrine-ratification-proposal.md`; the
earlier evaluation-semantics record is
`docs/efficiency-transformation/t0-eval-ratification-proposal.md`.

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

Admission durably records `planned_route`, policy version, explicit risk and
uncertainty factors, pass set, model/effort selection, budgets, and lower/upper
cost before a runtime can be constructed. `planned_route` is immutable.
`current_route` changes only through a recorded reassessment; `final_route`
records the route under which the episode actually terminated.

Valid depth factors are blast radius, reversibility, sensitive domain,
uncertainty/ambiguity, component or external-system count, release consequence,
novelty relative to validated evidence, and evidence/test quality. Prompt
length, repeated keywords, and role availability are not factors.

A new finding may escalate a route. Escalation preserves valid artifacts and
records its factor, remaining budget, and newly authorized budget. A cap never
authorizes false completion: insufficient remaining budget parks or reassesses
before the next provider turn.

Equivalent-cost admission is pessimistic and pre-runtime. Under the episode
lock, Operon adds settled provider cost to every in-flight reservation, then
reserves either the caller's declared maximum exposure or the smaller of the
role's per-turn cap and the route's remaining cost. That reservation becomes
the adapter request's actual `maxTurnBudgetUsd`; it is not merely telemetry.
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

`route-policy/v1` is the executable classifier. It consumes structured risk
facts only, selects the smallest safe quick/standard/deep route, binds every
extra pass to a named factor, and records model/effort before runtime
construction. Mechanical-only completion is limited to the ratified allowlist;
prose, prompt length, and keyword repetition cannot select it or deepen a
route. Unexpected findings can only preserve or escalate the current route.

The route belongs to the episode. A planning-depth or selected-pass-set value
is evidence derived from admission, not a second route authority. Pipeline
shape, role availability, prompt length, and prose keywords cannot deepen an
episode by themselves.

## Context and continuation budgets

Context is admitted under the episode route just like turns and cost. Each
pass records source and rendered bytes, component hashes, cache identity,
prior-pass change state, duplicate relationships, category caps, transport,
and deterministic eviction. Unchanged material may travel as a stable
reference and changed material as a delta. Authority, safety, acceptance
criteria, contracts, and unresolved findings are required and never evicted;
if that required set exceeds the route cap, admission stops before runtime
construction and the route must be reassessed. Cache visibility reports the
adapter's actual capability—never a fabricated zero.

The episode execution journal advances through route, contract,
implementation, push, gates, PR, findings, approvals, merge, and release.
Restart selects the next legal boundary. Repeating accepted work requires a
durable invalidation reason and invalidates only the affected suffix. Route
bounds cover environment retries, tool calls, active wall time, claim
attempts, repair attempts, review cycles, provider turns, and cost. Cap stop,
cancellation, crash, and timeout are terminal execution outcomes with an
executable resume decision; they do not erase artifact, episode, or settlement
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

The autonomous claim is defined by [`docs/scheduler.md`](scheduler.md). It
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

Contract + implementation + independent review consumes the nominal quick
allowance. A required repair after those three turns is a route reassessment,
not a fourth quick turn. No required review is skipped to preserve a label.

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

For Phase 6, the paired-learning intervention is the predeclared T1 procedure
at `eval/treatments/learning-t1-v1.md`, pinned by the candidate campaign's
`learning_treatment.content_sha256`. Only treatment-arm builder context receives
those bytes. The six provider artifacts and their independent hidden-grader
records supply the three AB/BA/AB measurements. The primary metric is an
integer artifact-quality score from zero through eight: grounded error classes,
a causal hypothesis, a bounded/reversible intervention, and measurable
guardrails each contribute zero through two points. The outcome is `improved`
only when all three treatment scores strictly exceed their paired controls and
all hidden guardrails pass. Each arm's independent provider review must end in
exactly one `VERDICT: APPROVE` or `VERDICT: REJECT` marker, which is retained
with the reviewer artifact hash; a rejection is a valid guardrail failure and
cannot be normalized into an approval. Any negative delta or hidden-guardrail failure is
`regressed`; nonnegative pairs with any zero delta are `inconclusive`; and
missing, mismatched, or infrastructure-corrupt evidence is `invalid`. A
declared or copied verdict is not a measurement. **Candidate qualification
requires a valid, guardrail-clean, non-regressing measurement — `improved` and
`inconclusive` both satisfy it, while `regressed` and `invalid` fail it. Strict
improvement (`improved`) is required, and is the only outcome that may proceed,
for the separately-authorized activation, not for candidate qualification
(2026-07-17 decouple — see `docs/PURPOSE.md`). Learning *capture* (100% eligible
capture) remains the operations SLO for the loop.**
After all pairs terminate — and only when the measured outcome is `improved` —
a separate token-free preview binds the exact
candidate, pair-evidence hash, reviewer-artifact hashes, and one isolated
publish/activate/rollback action. Executing that action requires its own exact
candidate and action-hash authorization; L5 provider-spend authorization does
not authorize it.

`operon learn report --efficiency-health` is the canonical projection of these
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

## Campaign and result semantics

Every live campaign pins exact code/package/suite hashes, org/system
fingerprints, ordered cases/repetitions, runtime/model/effort assignments,
capability claims, price catalog, randomization seed, side-effect allowlists,
retry/exclusion rules, evidence paths, spend caps, and stop rules before its
first provider turn. Manifest mutation after start invalidates the campaign.
Provider-backed deep and approval qualification cases additionally pin a
positive input-token admission ceiling; the Phase 6 candidate template uses
4,000,000 tokens. This supplies authority where the ordinary deep route is
deliberately unset, and is a ceiling rather than a target or spend grant.

Attempt outcomes are `passed`, `product_miss`, `safety_stop`, `budget_stop`,
`infra_invalid`, `harness_error`, and `not_run`. Campaign outcomes are
`qualified`, `not_qualified`, `invalid`, and `incomplete`. Required cases do
not have a passing skip state. An infrastructure retry links to and retains the
original attempt; merit failures are never retried under one attempt identity.

| Campaign | Hard cap |
| --- | ---: |
| Adapter and harness calibration | $15 |
| Pre-transformation provider baseline | $250 equivalent cost (campaign-specific amendment dated 2026-07-12) |
| Full candidate qualification | $375 |
| Real-time soak | Separately declared and ratified |

A campaign template's cap is not authority by itself. Live execution requires
either an exact campaign authorization or a content-bound standing development
grant, plus `OPERON_EVAL_LIVE=1`, validated immutable campaign identity,
explicit `--max-usd`, exact `--confirm <campaign-id>`, non-billable readiness,
the applicable disposable-GitHub proof, and production-path separation. Under
a standing grant, the environment switch and exact confirmation are accident
guards supplied by the developer; the grant's cumulative lineage ceiling is
the human authority.

The baseline cap was amended from the initial $125 recommendation by the
ratified `docs/efficiency-transformation/t4-baseline-cap-amendment.md`. Its
Claude Max and ChatGPT Pro dollar values are equivalent-cost indicators rather
than incremental API billing; per-case route bounds did not change.

## Development qualification execution

The platform-development lifecycle is separate from the org runtime and is
defined canonically in [`docs/development.md`](development.md). A standing
objective grant may cover repaired candidate descendants without repeated
human approval, but it cannot cross into an operated org, production, outward
effects, governed learning activation, or the future real-time soak.

Long provider runs are release evidence, not the ordinary debugging loop. A
failure is preserved and reproduced deterministically; remaining model
uncertainty is admitted in the smallest non-promotable focused campaign. The
same exact candidate must then pass adapter and focused admission before final
qualification can begin. Focused and final campaigns retain thresholds,
graders, assignments, retry rules, measurements, safety, and accounting, and
stop at the first terminal non-pass. Promotion rejects focused evidence.
Within an unchanged case ceiling, unused capacity from an earlier declared
turn carries forward across the remaining declared turns; fixed equal slices
must not manufacture a premature budget stop. Total case and campaign ceilings
remain fail-closed.

Equivalent-cost accounting includes historical lineage cost and every
immutable descendant attempt. It is a circuit breaker even when providers are
subscription-backed. The current Phase 6 grant and its exact cumulative
ceiling live under `eval/development-authorizations/`; this execution policy
does not alter the qualification thresholds below.

## Phase 6 qualification scope

This section is the canonical Phase 6 boundary (ratified 2026-07-15). The
scope change does not alter a threshold, grader, retry rule, measurement,
denominator, model assignment, safety boundary, learning-efficacy rule, or
provider-accounting requirement.

The contract inventory remains exactly 84 records. Every record declares one
`qualification_scope`:

- `current` contains exactly 83 contracts. Candidate campaign
  `candidate-qualification-v1-20260716-9ccc03a2c582` qualified all 34 declared
  attempts with exact 73/73 provider settlement agreement and supported the
  nine provider-evidence promotions: `D-LIVE-01..03`, `E-LIVE-01..02`,
  `G-MET-01`, and `I-ROLE-01..03`. The current scope therefore has no
  known-red contract after those content-bound projections land.
- `future_soak` contains exactly `I-LIVE-01`. It remains required and known-red
  until a genuine separately authorized 48–72 hour real-time scheduler
  campaign satisfies its unchanged cadence, restart, safety, accounting, and
  evidence contract. It is neither passed nor current Phase 6 debt. The
  token-free future-soak strict result must therefore remain non-zero for
  exactly `I-LIVE-01` until that campaign is validly promoted.

The current strict command may exclude only the declared `future_soak`
contract; inventory validation fails for any missing, duplicate, unscoped,
foreign-scoped, or additionally future-scoped record. A preview, local passing
marker, deterministic seven-day virtual soak, or manufactured evidence cannot
promote `I-LIVE-01`. Read-only production confirmation reports production
facts but cannot replace the future soak or repair sandbox qualification.
The token-free views are `pnpm test:transformation:strict` for `current` and
`pnpm test:transformation:future-soak-strict` for `future_soak`.

Completing the current scope may be reported as **“Phase 6 efficiency
qualification complete; future real-time soak pending.”** Operon must not be
described as a fully proven “highly efficient organization” until
`I-LIVE-01` passes the genuine future campaign. Phase 6 completion and that
broader organizational claim are deliberately distinct.

## Isolation and qualification

Eval actors run in fresh synthetic homes, an `Operon-Eval-<campaign-id>` org,
immutable content-addressed sparse/library/service templates, and managed
clones. Hidden graders, answer keys, reference patches, and mutants stay
outside actor context and tool-visible paths. GitHub writes are limited to
predeclared private `operon-eval-*` repositories. No eval publishes, sends,
changes DNS/cloud infrastructure, deploys to production, or performs an
irreversible data operation.

The exact candidate package qualifies only after deterministic contracts,
fixture/grader calibration, disposable GitHub behavior, required provider
conformance, five fresh quick episodes, and ten predeclared mixed-route
episodes satisfy all hard invariants and distribution thresholds. Production
is separately reported read-only confirmation and cannot rewrite qualification.

Qualification remains attached to the prepared candidate commit. A later
evidence-only release descendant is admissible only through a deterministic
attestation that requires the qualified candidate commit to be present — failing
closed when it is absent, as in a shallow CI checkout — and preserves the
candidate's installable-package hash, executable-eval-suite hash, org
fingerprint, and every prepared campaign hash; rejects deletes and any
unallowlisted change to the packaged artifact or the sanitized-evidence
namespace, while non-packaged, non-evidence files (docs other than the two
packed docs, review notes, `.github/` other than the qualification workflow, and
install/build-environment config such as `pnpm-workspace.yaml`,
`pnpm-lock.yaml`, and `tsconfig.json`) are outside qualification scope and do not
invalidate it. The executable-eval-suite hash governs not only the
`scripts/eval`, `test`, and `eval` trees and the workflow but also the
test-runner/grading configs (`vitest.config.ts`, `vitest.live.config.ts`,
`playwright.observe.config.ts`) that decide which tests run, so a
post-qualification edit cannot silently skip the red contract tests. The
attestation content-binds each sanitized promotion file.
Contract projections then independently recompute the
qualifier and portable report and verify the schema-v2 archive receipt,
GitHub/idempotence evidence, exact case/repetitions, hidden-grader evidence,
route admission, terminal integrity, and provider/settlement agreement. The
descendant does not become a new qualified candidate and cannot change source,
eval executable bytes, fixtures, graders, campaigns, package inputs,
lockfiles, roles, pipelines, or prompts.

The attestation separates two concerns (P0-07 / ROOT-001 follow-up, ratified
2026-07-17). Evidence **integrity** — the attestation is well-formed, bound to
its committed campaign, pinned to that campaign's qualified package/suite hashes,
self-consistent, and lists only allowlisted promotion paths — is deterministic
and is what the offline suite (`pnpm test`, `test:transformation`) asserts, so it
is green whenever the committed evidence is intact and a legitimate source change
cannot redden it. Product **currency** — the live `npm pack`, executable suite,
org surfaces, on-disk promotion bytes, and git changed-path scope still match the
qualified pin — is recomputed from the working tree and enforced fail-closed only
at the release gate: `eval:attest-release` refuses to mint for a moved product,
and `eval:promote` and `eval:release-verify` refuse to verify one. A dedicated
`release-currency` CI job (gated to release tags and manual dispatch, off
ordinary push/PR) runs `eval:release-verify`. A moved product therefore cannot be
minted, promoted, or released without a new qualification campaign, while
per-commit CI stays honest-green.

<!-- efficiency-contract:end -->
