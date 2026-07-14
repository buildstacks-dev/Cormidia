# Phase 0 Organizational Doctrine Ratification Proposal

| Field | Value |
| --- | --- |
| Status | Ratified as written |
| Evidence date | 2026-07-13 |
| Ratified | 2026-07-13 |
| Decision owner | Bikram |
| Source charter | `highly-efficient-organization-transformation.md` |
| Verification mandate | `highly-efficient-organization-test-eval-transformation.md` |
| Canonical policy under review | `../efficiency.md` (`efficiency/v1`) |

## Decision requested

Ratify the existing `docs/PURPOSE.md` one-liner, `docs/VISION.md` operator
outcome, and `docs/efficiency.md` V1 contract as Operon's product operating
doctrine, subject to the clarifications and document-alignment work below.

This is the product Phase 0 decision. It is distinct from the already-ratified
T0 evaluation semantics: T0 made the measurement and eval harness unambiguous,
but explicitly did not authorize transformation production behavior. Phase 0
makes those semantics the organization-wide operating target and assigns the
architecture that must implement them.

Approval of this packet would authorize a follow-up docs/test alignment change
to record the decision and remove current drift. It would not authorize Phase 1
production code, provider spend, GitHub mutation, production org/state/app
mutation, a candidate qualification campaign, or an L6 soak.

## Why another ratification is required

This section records the pre-ratification 2026-07-13 drift that justified the
decision. The authorized alignment is applied in the same Phase 0 change and
verified by the acceptance evidence below.

The top-level documents already contain much of the desired doctrine:

- `docs/PURPOSE.md` uses the charter's efficient-organization one-liner and
  makes efficiency, deterministic mechanics, proportional process, durable
  progress, human/context budgets, and outcome-accountable learning
  non-negotiable.
- `docs/VISION.md` states the intended operator experience and forbids a cheap,
  unsafe, incomplete, or unmeasured result from counting as efficiency.
- `docs/efficiency.md` is already the single canonical home for identities,
  route budgets, measurements, missingness, campaign semantics, isolation, and
  qualification.
- T0–T5 provide a valid eval system, five required A contracts, seven required
  J contracts, and an honest retained baseline. The current provider baseline
  has one pass, five `product_miss` outcomes, zero eval-system failures, and 72
  known-red production contracts.

The detail layer still describes a different operating model in places:

1. `docs/architecture.md` and `docs/loop.md` still present 60 minutes as an
   active default pass cap even though `docs/PURPOSE.md` says that default is
   superseded by route admission.
2. `docs/loop.md` still says milestone planning uses the deep pipeline as a
   general default. The canonical doctrine requires explicit risk and
   uncertainty factors instead.
3. The existing `planning-depth/v1` selection is described as a route, but the
   transformation requires one episode-wide `planned_route`, `current_route`,
   and `final_route`. A planning pass-set decision must not become a competing
   route authority.
4. The architecture uses bare “turn” for a scheduled role invocation, a
   configured pass, and an adapter invocation. Those are different execution
   and accounting identities under `efficiency/v1`.
5. The architecture has no explicit owner for route admission, context
   manifests, execution-step terminal records, episode counters, or
   reassessment before spend.
6. The documented restart path discards worktree state without first expressing
   the new rule: preserve every still-valid decision and durable artifact, and
   record an invalidation before repeating productive work.
7. Installation/onboarding docs do not distinguish generated, registered,
   runtime-ready, live, and autonomously scheduled states. That lets a local
   artifact or registry row sound like an operating organization.
8. `A-DOC-03` is green because it checks the supersession statement in
   `PURPOSE.md`; it does not yet detect the contradictory active defaults in the
   detail documents.

The historical quick success therefore remains a benchmark, not a durable
contract. Ratification must resolve these contradictions before production code
implements one interpretation accidentally.

## Proposed decisions

### P0-01 — Product promise

Adopt the current PURPOSE one-liner and VISION operator outcome without
weakening either:

> Operon turns approved goals into verified software outcomes with process
> proportional to risk, minimal human attention, durable forward progress, and
> continuously improving unit economics.

“Verified” includes the required outcome, safety, evidence, independent review,
and truthful terminal state. Efficiency is part of correctness; it never
overrides those requirements.

### P0-02 — One canonical efficiency authority

Keep `docs/efficiency.md` (`efficiency/v1`) as the sole normative home for:

- route identities and valid risk/uncertainty factors;
- route turn, input, equivalent-cost, active-time, and human-decision bounds;
- measurement formulas, denominators, exclusions, quality, and missingness;
- admission, variance, escalation, parking, and terminal-integrity semantics;
- campaign outcomes, isolation, and qualification.

Ratify its current V1 route and campaign budgets unchanged. The five product
misses and 72 known-red contracts are not evidence for loosening a threshold;
they are evidence that the product behavior is not implemented. No other
document should become a second numeric budget authority.

### P0-03 — The episode owns the route

The route is an episode-level admission decision. Before any runtime is
constructed, Operon records immutable `planned_route`, policy version,
risk/uncertainty factors, selected pass set, model/effort choices, context and
human-attention allowances, and lower/upper cost.

`current_route` changes only through a recorded reassessment caused by a new
factor. `final_route` records the route under which the episode terminated.
Crossing the admitted route does not count as hitting the original route target,
even if an honest escalation later succeeds.

The existing `planning-depth/v1` value is an interim planning pass-selection
decision. It must become a derivation of episode admission (or be named
`planning_depth`), not a second independent quick/standard/deep route. Pipeline
passes, role availability, prompt length, and prose keywords cannot deepen the
episode by themselves.

### P0-04 — Execution and accounting terminology

Use these terms consistently in normative and architecture documents:

| Term | Meaning |
| --- | --- |
| Episode | End-to-end unit responsible for one outcome and one route. |
| Role invocation | One scheduled, event-driven, or manual invocation of an organizational role; it may execute a pipeline. |
| Pass | A configured protocol stage. It is not itself the provider-accounting identity. |
| Provider turn | One adapter invocation capable of consuming tokens. It has exactly one provider settlement. |
| Execution step | One terminal provider or deterministic operation record within an episode. |
| Mechanical step | A deterministic execution step that constructs no adapter and has zero provider settlements. |
| Attempt | One immutable eval case repetition, including invalid and failed outcomes. |

Avoid bare “turn” where the intended identity is ambiguous. If one configured
pass invokes a provider again for reformatting, recovery, or another substep,
each adapter invocation remains a distinct provider turn and settlement. The
pass may retain a parent summary, but it cannot hide extra provider turns.

`active time` means the union defined by `docs/efficiency.md`; it is not the sum
of overlapping processes and does not include human wait. `ready`, `blocked`,
`invalid`, and `incomplete` are readiness/measurement states, never synonyms
for successful product completion.

### P0-05 — Architecture ownership

Preserve the import direction `src/org` → `src/loop` → `src/runtime` and assign
responsibility as follows:

| Layer | Efficiency responsibility |
| --- | --- |
| `src/runtime` | Execute adapter calls; checkpoint usage/session identity; emit provider execution facts; settle every provider turn exactly once. It never chooses a route. |
| `src/loop` | Own provider-agnostic execution-economy primitives used by every pipeline: route policy/admission records, pass selection evidence, episode counters, context manifests, productive/repeated-work fingerprints, pre-turn budget checks, reassessment, and provider/mechanical execution-step terminal records. |
| `src/org` | Own organizational episodes and lifecycle transactions: app/org lifecycle, scheduler state, human decisions/wait, cross-pipeline orchestration, learning outcomes, and the final episode disposition. It consumes loop primitives rather than recreating them. |
| `src/report` | Project the durable records into deterministic metrics and reports. It performs no admission, reconciliation, workflow mutation, or provider call. |
| `src/observe` | Present report/live projections only. It owns no efficiency or workflow state. |
| `eval/**` | Qualify an exact candidate against the contract. Eval evidence never becomes production workflow authority. |

This assigns ownership, not a required class or file layout. The implementation
may choose small modules inside those boundaries, but it may not duplicate route
truth in reporting, org, and loop stores.

### P0-06 — Route budgets supersede legacy depth and time defaults

The 2026-07-06 deep-milestone and 60-minute defaults remain historical facts,
not active policy.

- Planning depth derives from admitted factors and the smallest sufficient pass
  set. Milestone ceremony is not a factor.
- Episode active-time bounds come from the canonical route. A per-pass watchdog
  is a safety mechanism derived from the episode's remaining allowance, not an
  entitlement to spend 60 minutes per pass.
- Until route-aware enforcement lands, the current 60-minute fallback is a
  named implementation gap and conservative kill ceiling. Documentation must
  not present it as conformance with `efficiency/v1`.
- Review and safety evidence are never dropped to fit a route. An oversized
  required set triggers reassessment or an evidence-backed stop.

### P0-07 — Durable progress and terminal outcomes

Resume from the last valid artifact boundary by default. A repeated productive
pass requires a durable invalidation reason tied to the artifact or decision it
invalidates.

Working-tree scratch may remain disposable only when it has not been accepted as
a valid episode artifact. Commits, pushed refs, contracts, findings, approvals,
gate evidence, usage checkpoints, and terminal records are never discarded by
a generic “restart clean” rule. A cap, cancellation, timeout, approval wait, or
process restart preserves those artifacts and records an executable next step.

Every admitted episode and started execution step reaches one truthful terminal
record. Provider turns settle exactly once; mechanical steps settle zero times.
Model outcome, durable artifact outcome, and episode outcome remain distinct.

### P0-08 — Lifecycle readiness is evidence, not implication

Document the following evidence ladder without adding five new `apps.yaml`
status values:

| Evidence state | Claim permitted |
| --- | --- |
| Generated | Local app/org artifacts were created. No registry, remote, runtime, or schedule claim follows. |
| Registered | The app has an org registry entry and matching app-owned config. It is still onboarding. |
| Runtime-ready | Deterministic verification proves refs, ancestry, managed clone, authority/config hashes, app checks, locks/approvals, and required adapters. |
| Live | The human-selected registry status permits ordinary manual/dispatch work. Live does not prove a scheduler is installed. |
| Autonomously scheduled | The correct org-scoped scheduler is installed, healthy, and producing attributable due/executed/skipped/blocked evidence. |

The persisted registry states remain `onboarding | live | paused`. The ladder is
an evidence vocabulary used by CLI/report/docs; it must not create a second app
state machine.

### P0-09 — Regression enforcement

Keep the A contracts required and green, but strengthen their coverage after
ratification:

- `A-DOC-01` checks the canonical terms and rejects conflicting normative
  definitions in active detail documents.
- `A-DOC-02` keeps exactly one canonical numeric route-budget table while
  permitting clearly historical benchmark actuals and case-specific caps.
- `A-DOC-03` scans active architecture/loop/default text, not only the
  supersession sentence in PURPOSE.
- `A-DOC-04` continues to compare command docs with machine capabilities.
- `A-DOC-05` continues link and requirement traceability.

This strengthening changes no grader target and promotes no contract. A future
failure is document drift to fix, not a reason to weaken the check.

## Post-ratification document changes

If P0-01 through P0-09 are ratified, the follow-up Phase 0 alignment change
should be docs-first and make these bounded edits:

| Document | Authorized alignment |
| --- | --- |
| `docs/PURPOSE.md` | Record Phase 0 ratification, link VISION/efficiency/this decision, and mark the former deep/60-minute defaults historical at their detailed references. Do not copy the numeric budget table. |
| `docs/VISION.md` | Retain the current north star and qualification bar; link the evidence ladder and clarify that “highly efficient” is a qualified state, not a launch adjective. |
| `docs/efficiency.md` | Keep V1 values unchanged; add only the episode applicability, terminology cross-links, and amendment provenance needed to make P0-03/P0-04 explicit. |
| `README.md` | Add the generated → registered → runtime-ready → live → autonomously scheduled evidence ladder and avoid claiming readiness from bootstrap alone. |
| `docs/architecture.md` | Add the P0-05 control-plane ownership map; distinguish role invocation/pass/provider turn; mark 60 minutes as a legacy implementation ceiling; describe route admission before runtime construction and lifecycle evidence ownership. |
| `docs/loop.md` | Make episode admission upstream of pass selection, define reassessment before extra spend, remove deep-milestone/60-minute text as active defaults, and preserve independent review/safety. |
| `docs/proportionality-review.md` | Keep historical targets and actuals, but point forward to `efficiency/v1` as the durable policy. |
| Approval, learning, reporting, testing, capability docs | Link to the canonical terms for approval precision, learning efficacy, route/context projections, scheduler reliability, and provider capability quality; do not duplicate numeric route tables. |
| `test/transformation/doctrine.test.ts` | Strengthen A-DOC-01/A-DOC-03 after the ratified docs land; retain all positive, near-miss, and honest-failure cases. |

The human-ratified `TASTE.md`, `roles.yaml`, `pipelines.yaml`, and `prompts/**`
are not changed by this Phase 0 decision. Any later edit to them remains a
separate content-specific proposal.

## Acceptance evidence for Phase 0

Phase 0 is complete only after the human ratifies or amends this packet and the
follow-up alignment diff proves all of the following:

1. PURPOSE, VISION, and `efficiency/v1` state one compatible product outcome.
2. The canonical route budgets are unchanged and have one normative home.
3. Architecture and loop documents no longer present deep milestone planning
   or 60 minutes as unconditional active defaults.
4. Episode route, planning depth, pass, provider turn, execution step,
   mechanical step, attempt, active time, and readiness terms are unambiguous.
5. Ownership respects `src/org` → `src/loop` → `src/runtime`, with report and
   observer remaining read-only projections.
6. The lifecycle evidence ladder does not create a second registry state
   machine or overstate bootstrap/promotion/scheduler readiness.
7. Required A contracts pass with the stronger detail-document coverage.
8. The 72 production contracts remain known-red; no production behavior is
   claimed or promoted by documentation alone.
9. No external campaign is rerun because docs changed.

## Risks and explicit non-decisions

- Assigning shared execution-economy primitives to `src/loop` must not pull org
  lifecycle or scheduler policy downward. The boundary is reusable execution
  evidence and admission, not organizational ownership.
- The evidence ladder must remain a projection over real registry, verification,
  runtime, and scheduler evidence. It is not a new database or lifecycle enum.
- Marking a legacy timeout as non-normative does not remove its current safety
  value. Production code changes only when a later verified slice replaces it.
- This packet does not decide model assignments, role prompts, pipeline contents,
  automated promotion, scheduler installation on the production host, or any
  production app status.
- The retained baseline remains valid eval-system evidence and an honest
  `not_qualified` product result. It is not recalibrated or rerun for this docs
  decision.

## Ratification record

On 2026-07-13, Bikram ratified **P0-01 through P0-09 as written**. This
authorizes the bounded Phase 0 document/test alignment above. Phase 1
production code remains gated on completion of the Phase 0 acceptance evidence;
the decision grants no provider spend, external campaign execution, production
org/state/app mutation, or non-eval GitHub mutation.
