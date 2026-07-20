# EpisodePlanner and Adaptive Turn Execution

Status: implementation plan / proposed design

Date: 2026-07-19

Scope: efficiency routing, app configuration, episode planning, turn execution,
tests/evals, documentation, migration, and related GitHub issue cleanup

This document is an execution plan. It does not itself ratify changes to
`docs/PURPOSE.md`, `TASTE.md`, `roles.yaml`, `pipelines.yaml`, or `prompts/**`.
Before changing those human-ratified surfaces, prepare the exact diff and its
rationale for human approval, as required by `AGENTS.md`.

## 1. Outcome

At the beginning of an episode, Operon should understand the work the way a
competent human lead would, design the smallest sufficient workflow, and then
derive the budget and safety route needed to execute it.

Unless the episode creator has already supplied an explicit, execution-ready
scope, the EpisodePlanner runs at the beginning of **every** episode. This is
true for both fixed and adaptive turn assignment. In both modes it decides:

1. which provider turns are needed;
2. which organizational role owns each turn;
3. dependencies, required inputs, and expected outputs;
4. deterministic gates and approval boundaries;
5. the shortest sufficient workflow for the episode;
6. the episode budget implied by that plan, within hard org/app limits.

Assignment mode changes only how each planned provider turn receives its atomic
**harness + exact model + effort** tuple:

- in `fixed` mode, it is resolved from explicit configuration;
- in `adaptive` mode, the EpisodePlanner selects it from approved candidates.

When an agent or human creates an episode with a complete scope, that creator is
performing the episode-planning work. Operon may skip the extra EpisodePlanner
provider turn, normalize the supplied scope into the same durable plan, and run
the same deterministic validation. A task merely looking simple is never
enough to infer this bypass.

The result should make simple work visibly simple and complex work
proportionally capable. Quick/standard/deep may remain as a derived reporting or
safety label, but it must no longer be the mechanism pretending to design the
workflow.

## 2. Agreed design decisions

These decisions are the center of the implementation. Do not reopen them merely
because the current implementation is shaped differently.

### 2.1 Two user-visible assignment modes

- `fixed`: the EpisodePlanner designs the workflow; each turn's assignment is
  resolved from explicit configuration.
- `adaptive`: the EpisodePlanner designs the workflow and chooses each turn's
  assignment from its approved candidates.

The assignment mode belongs in app configuration. Omission must preserve
today's configured harness/model/effort resolution by defaulting to `fixed`
during migration. It does not disable episode planning.

### 2.2 Planning is the default; creator scope is the only bypass

Every episode must have one validated, durable EpisodePlan. Normally the
dedicated EpisodePlanner creates it, regardless of assignment mode.

The dedicated planner turn may be skipped only when the episode envelope
explicitly carries a creator-authored scope that is complete enough to
normalize into an executable plan. The bypass must be deliberate and
auditable, with creator identity and provenance. It must never be inferred from
a title, label, short prompt, issue size, or quick/standard/deep tier.

At minimum, a creator-scoped episode must provide or deterministically resolve:

- the bounded objective, in-scope and out-of-scope work;
- acceptance criteria and expected artifacts;
- the necessary provider/mechanical steps and their dependencies, either
  directly or through an unambiguous governed workflow template;
- known constraints and safety-relevant facts;
- for fixed assignment, roles whose configured assignments resolve exactly;
- for adaptive assignment, valid atomic assignments supplied by the creator.

If any required planning decision is missing, the EpisodePlanner still runs,
using the supplied scope as authoritative input rather than rediscovering it.
A parent EpisodePlanner can therefore create execution-ready child episodes and
avoid paying for redundant child-planning turns.

### 2.3 Harness, model, and effort are one assignment

Every provider turn must resolve and persist one indivisible value. Adaptive
planning selects it; fixed assignment resolves it from configuration:

```ts
interface TurnAssignment {
  harness: RuntimeKind;
  model: string;
  effort: Effort;
}
```

The current code usually calls a harness a `runtime`. Keep `RuntimeKind`
internally if that avoids churn, but make the boundary vocabulary explicit and
do not select a model independently and infer its harness later. No fallback may
silently change one member of the tuple.

### 2.4 Role and execution assignment are separate concepts

- A role defines responsibility, instructions, tools, permissions, and expected
  outputs.
- A turn assignment defines which harness/model/effort executes that role for
  this turn.

Permissions remain role-bound. Choosing a more capable model or a different
harness must never broaden the role's authority.

### 2.5 The planner designs the workflow; policy validates it

The EpisodePlanner proposes the smallest sufficient plan. Deterministic code
then validates it against:

- allowed harness/model combinations and supported effort levels;
- harness capabilities required by the role and turn;
- hard app/org budget ceilings;
- approval and critical-operation policy;
- mandatory independent or cross-provider review;
- required quality gates and release constraints;
- availability and qualification evidence.

Policy may reject or require a revision. It must not quietly replace the plan
with the old static workflow.

Creator-scoped plans pass the identical deterministic validation; creator
authority cannot bypass policy.

### 2.6 The planner cannot select itself recursively

The initial EpisodePlanner turn uses an explicitly configured, fixed
harness/model/effort assignment. That boot assignment can be changed by a human
configuration edit, but is not chosen by the plan it is producing.

### 2.7 Plans are durable and revisions are forward-only

Persist the accepted plan before its first provider turn. If new evidence makes
the plan insufficient, create a new version that changes only future work.
Completed turns, artifacts, accounting, and approvals remain immutable and
linked to the plan version that authorized them.

### 2.8 Reuse the trustworthy substrate

Keep the parts that already serve the goal:

- deterministic preflight and lifecycle checks;
- durable continuation and exactly-once settlement;
- role tool shaping and action-aware approvals;
- context manifests/deltas and bounded inputs;
- independent review and quality gates;
- provider/mechanical execution journals;
- reporting, narrative, and learning evidence derived from durable execution.

Simplification means removing duplicate control logic, not discarding safety or
evidence.

## 3. Current gap

The current design has useful pieces but reverses the desired order of
reasoning:

1. `src/org/planning-depth.ts` classifies structured inputs into
   quick/standard/deep and intentionally excludes the goal text.
2. `src/loop/route-policy.ts` converts that tier into a pass allowance and a
   maximum effort.
3. `pipelines.yaml` supplies a mostly static pass graph.
4. `roles.yaml` supplies a fixed runtime/model/effort per role.
5. `src/loop/pipeline.ts` permits model/effort overrides but explicitly refuses
   a runtime override.
6. In parts of the loop, an existing item tier helps derive the route, making
   the decision partly circular.
7. A test described as model/effort selection mainly proves that quick maps to
   low effort; it does not prove task-specific turn design or model choice.

That mechanism can scale a predetermined workflow up or down. It cannot decide
that a simple prototype, a production product build, a subtle bug, and a cloud
deployment need fundamentally different teams and sequences.

## 4. Target architecture

### 4.1 Minimal configuration model

Add one app-level assignment mode with a backward-compatible default. Name it
so the config cannot be mistaken for a switch that disables planning:

```yaml
execution:
  assignment_mode: fixed # fixed | adaptive
```

In both modes, an unscoped episode runs the EpisodePlanner. Fixed mode resolves
the planned turns against existing configured assignments. Adaptive mode needs
an org-approved candidate set for each role.

Prefer the smallest candidate representation that keeps unsafe or unavailable
combinations unrepresentable. The expected shape is conceptually:

```yaml
roles:
  Builder:
    runtime: codex       # fixed/default assignment, retained
    model: gpt-5.6-sol
    effort: high
    adaptive_assignments:
      - harness: codex
        model: gpt-5.6-sol
        efforts: [medium, high, xhigh]
      - harness: claude
        model: <qualified-exact-model-id>
        efforts: [medium, high]
```

The exact YAML spelling is a specification decision in Phase 1. Do not add a
second configuration file unless extending the existing role/app configuration
would make validation or ownership materially worse. Whatever representation
is chosen must guarantee:

- harness and model are declared together;
- supported efforts are explicit;
- candidates are exact, qualified identifiers rather than free-form planner
  output;
- app-level restrictions can narrow, but not widen, org-approved candidates;
- the existing fixed fields remain valid;
- config shown in the committed org home and `.operon/config.yaml` remains
  schema-consistent.

### 4.2 Episode intent

Build a bounded, deterministic input object before calling the planner. It
should contain facts rather than a preselected answer:

```ts
interface CreatorEpisodeScope {
  source: "human" | "agent";
  creatorId: string;
  createdAt: string;
  workKind?: ScopedWorkKind;
  objective: string;
  inScope: string[];
  outOfScope: string[];
  acceptanceCriteria: string[];
  declaredConstraints: RequestedConstraints;
  steps?: CreatorScopedStep[];
  workflowTemplate?: string;
  evidenceRefs: string[];
}

interface EpisodeIntent {
  episodeId: string;
  app: string;
  trigger: TriggerDescriptor;
  goal: string;
  lifecycle: WorkLifecycle;
  appStage: AppStage;
  repositoryFacts: RepositoryFacts;
  changeFacts?: ChangeFacts;
  requestedConstraints: RequestedConstraints;
  hardBudget: BudgetCeiling;
  availableRoles: RolePlanningView[];
  allowedAssignments: AllowedTurnAssignment[];
  requiredSafetyFacts: SafetyFacts;
  creatorScope?: CreatorEpisodeScope;
}
```

Repository inspection and trigger parsing should be token-free where possible.
Do not make prose keyword matching a safety control. Validate creator scope
before deciding whether a dedicated planner turn is needed.

### 4.3 Episode plan

Use one versioned, schema-validated plan with typed step kinds:

```ts
interface EpisodePlan {
  schemaVersion: 1;
  episodeId: string;
  version: number;
  intentHash: string;
  summary: string;
  workflowClass: string; // descriptive, not authoritative
  planningSource: "episode_planner" | "creator_scope";
  creatorProvenance?: CreatorScopeProvenance;
  steps: EpisodeStep[];
  estimatedBudget: EpisodeBudgetEstimate;
  derivedSafetyRoute: DerivedSafetyRoute;
  createdAt: string;
}

type EpisodeStep =
  | ProviderTurnStep
  | MechanicalGateStep
  | ApprovalStep;

interface ProviderTurnStep {
  kind: "provider_turn";
  id: string;
  role: string;
  objective: string;
  dependsOn: string[];
  requiredCapabilities: string[];
  assignment: TurnAssignment;
  assignmentSource: "configured" | "episode_planner" | "creator";
  inputRefs: PlannedInputRef[];
  expectedOutputs: PlannedOutput[];
  maxTurnBudgetUsd: number;
  selectionReason: string;
}
```

`selectionReason` is a concise audit explanation, not hidden chain of thought.
Validate step IDs, dependency acyclicity, reachability, budget arithmetic,
supported assignments, and required terminal outcomes before accepting a plan.

Persist plans and revisions within the existing
`efficiency/episodes/<episode-id>/` namespace, alongside the execution journal,
rather than introducing a second episode store.

### 4.4 Planning flow

For every episode:

1. Create the episode envelope and gather deterministic facts.
2. Validate any explicit creator scope for completeness and provenance.
3. If the creator scope is execution-ready, normalize it into an EpisodePlan
   and mark `planningSource: creator_scope`.
4. Otherwise resolve the fixed EpisodePlanner boot assignment, give it the
   bounded intent and any partial creator scope, and require schema-constrained
   EpisodePlan output.
5. In fixed assignment mode, deterministically populate each provider step from
   configured assignments. The planner chooses the role/turn, not a different
   tuple.
6. In adaptive assignment mode, require the planner—or an execution-ready
   creator scope—to select each exact tuple from approved candidates.
7. Validate either kind of plan identically.
8. For planner-authored structural errors, allow one bounded repair using
   validation diagnostics; then fail closed with an actionable explanation.
   Creator-authored invalid scope falls back to the planner when the missing
   information is non-authoritative; otherwise reject the contradictory scope.
9. Derive the final budget route, approvals, and reporting labels from the
   accepted plan.
10. Persist the plan atomically.
11. Execute ready steps in dependency order, recording the exact assignment on
    every provider turn.
12. Replan only on a typed material event: failed assumption, new scope,
    unavailable assignment, failed gate, approval constraint, or exhausted
    estimate. Revisions are bounded and forward-only.

For a product or milestone request, the first episode may plan product-level
discovery and ticket decomposition. When the parent supplies a complete child
scope, the child skips redundant EpisodePlanner work; otherwise the child runs
its own planner. Do not pretend the parent can accurately select every future
implementation turn before the work is decomposed.

### 4.5 Derived budget and safety route

The plan proposes cost; it does not grant itself spend or authority.

- Sum per-turn estimates using the exact harness/model/effort price facts plus
  bounded mechanical overhead.
- Clamp or reject against org, app, invocation, learning, and standing-grant
  ceilings already enforced by the ledger/approval layers.
- Treat quick/standard/deep, if retained, as a projection from accepted plan
  complexity and risk for display, compatibility, or a safety floor.
- A safety floor may add a mandatory gate or reject a plan, but it must explain
  the conflict. It must not silently add a generic collection of provider
  turns.
- If no valid plan fits the hard ceiling, stop with the smallest useful
  diagnostic: what cannot be done safely, the minimum estimated budget, and
  what scope/config change would make it feasible.

### 4.6 Execution boundary

Refactor pass execution so it consumes a validated `TurnAssignment` rather
than copying a base role and overriding only model/effort.

Required properties:

- instantiate the runtime adapter from `assignment.harness`;
- pass the exact model and effort together;
- intersect adapter capabilities with the role's allowed toolset;
- preserve the role's prompt, outputs, permissions, and budget policy;
- record assignment, plan version, role, parent task, provider turn ID, and
  capability resolution in run envelopes and ledger evidence;
- continue to enforce builder/reviewer independence;
- fail closed if the selected adapter is unavailable or no longer qualifies;
- never substitute another harness/model tuple without a persisted plan
  revision.

## 5. Representative intended behavior

These are behavioral examples, not hard-coded templates. They should become
scenario tests with assertions on why turns are present or absent.

| Episode | Expected proportional behavior |
| --- | --- |
| Typo or mechanical docs edit | A minimal implementation turn or a deterministic change if safely representable; no speculative planning team. |
| Simple, well-localized bug | If its creator supplied an execution-ready scope, skip the redundant planning turn. Otherwise plan normally. Execute one appropriately economical Builder turn, focused tests, then only the review required by risk policy. |
| Complex or ambiguous bug | Diagnostic/reproduction turn before implementation; capable model/effort; independent review; targeted security/performance only when facts warrant it. |
| Simple prototype | Product/Builder coverage sufficient to create the bounded prototype; avoid production deployment/reliability work unless requested. |
| Full product build | Product planning and decomposition first; child delivery episodes; review/release gates proportional to each deliverable. |
| Complex cloud deployment | SRE-led plan with infrastructure inspection, deployment safety, approval, rollout, and smoke/rollback steps; do not add a Builder turn unless code/config actually changes. |
| Authentication, secrets, or data migration | Security and rollback/data-integrity requirements become deterministic floors; the planner still chooses the smallest workflow above that floor. |
| Incident response | SRE owns diagnosis/mitigation, typed approvals govern critical actions, and follow-up work is separated from immediate recovery. |

## 6. Implementation phases

Each phase should leave the repository green. Avoid a parallel second
orchestrator: introduce the new path behind config, migrate callers, then
delete superseded control logic.

### Phase 0 — Baseline and decision proposal

Work:

1. Re-read `AGENTS.md`, `docs/PURPOSE.md`, `docs/development.md`, this plan, and
   the authoritative efficiency design/eval documents.
2. Capture the current compatibility and safety invariants with focused
   characterization tests: app config parsing, fixed assignment resolution,
   route persistence, pipeline authorization, runtime construction,
   continuation, ledger settlement, and cross-provider review. Do not freeze
   today's static pass count as required behavior.
3. Produce a short exact proposal diff for the human-ratified surfaces. It
   should state that the EpisodePlanner normally runs in both assignment modes,
   creator scope is its only explicit bypass, the assignment is
   harness+model+effort, and planning precedes budget/safety routing.
4. Obtain human ratification before applying those exact changes.

Acceptance:

- Existing fixed-assignment, safety, persistence, and accounting behavior has
  executable coverage without canonizing the static workflow.
- There is one agreed vocabulary: EpisodePlanner, role, harness,
  `TurnAssignment`, creator scope, plan, execution journal, derived safety
  route.
- No production behavior has changed.

### Phase 1 — Contracts and configuration

Likely files:

- `src/runtime/types.ts`
- `src/org/apps.ts`
- role/config loaders and schemas under `src/org/`
- config fixtures and loader tests
- `roles.yaml` only after ratification
- relevant sections of `docs/architecture.md` and `docs/PURPOSE.md` after
  ratification

Work:

1. Add `TurnAssignment` and allowed-assignment types with one canonical
   validator.
2. Add app `execution.assignment_mode`, defaulting absent values to `fixed`.
3. Define the minimal approved-assignment representation and app narrowing.
4. Validate exact harness/model compatibility, supported effort, duplicate
   assignments, unknown harnesses, empty adaptive catalogs, and planner boot
   assignment.
5. Expose capability and price/qualification summaries to planning without
   exposing secrets or adapter internals.
6. Define one explicit creator-scope envelope and provenance contract. Permit
   either explicit steps or an unambiguous governed workflow template; make
   planner bypass impossible when neither yields a complete plan.
7. Ensure org-home and app-repo config mirrors resolve identically.

Acceptance:

- Existing org/app fixtures load unchanged as fixed assignment mode.
- Invalid tuples fail at configuration load or plan validation, never during an
  unrelated later turn.
- A model cannot be configured without its harness.
- Adaptive config cannot widen org authority.
- Assignment mode cannot disable planning.

### Phase 2 — EpisodePlanner and deterministic validation

Likely files:

- a small new `src/org/episode-planner/` module, or equivalently scoped modules
  if the existing planning boundary is a better fit
- existing episode persistence under `src/loop/` / `src/org/`
- planning CLI and dry-run/explain surfaces
- schema and unit tests

Work:

1. Build `EpisodeIntent` from existing trigger, app, repository, budget,
   capability, safety facts, and any explicit creator scope.
2. Implement the fixed boot assignment for the planner.
3. Implement creator-scope completeness/provenance checks and deterministic
   normalization into the same EpisodePlan schema.
4. Define the schema-constrained EpisodePlan prompt and parser.
5. Implement pure validation: tuple membership, capabilities, role existence,
   DAG integrity, outputs, budget arithmetic, safety floors, review separation,
   and terminal coverage.
6. In fixed mode, resolve assignments after workflow design. In adaptive mode,
   require assignments in the planner or creator output.
7. Implement one bounded repair pass for a structurally invalid proposal.
8. Persist accepted plan V1 atomically with hashes and provenance.
9. Add a token-free preview of the resolved intent/candidates/safety facts, and
   an explain surface for a completed plan. Do not claim to preview the exact
   provider-authored plan without running the planner.

Acceptance:

- Unscoped fixed and adaptive dry runs both invoke the EpisodePlanner and
  persist a valid plan without executing delivery steps.
- A valid creator-scoped episode skips the dedicated planner turn, while an
  absent, implicit, or incomplete scope does not.
- Invalid or over-budget plans fail closed with stable reason codes.
- The planner cannot invent a role, harness, model, effort, capability, or
  budget.
- Planning consumes only bounded context and settles like any other provider
  turn.

### Phase 3 — Assignment-aware execution

Likely files:

- `src/loop/pipeline.ts`
- pass executor / driver modules under `src/loop/`
- runtime registry/factory under `src/runtime/`
- context, run-envelope, telemetry, and execution-step writers
- adapter conformance and loop tests

Work:

1. Decouple `RoleConfig` from runtime construction.
2. Make provider-step execution require a validated `TurnAssignment`.
3. Resolve the adapter using the assignment harness, then pass the exact model
   and effort.
4. Apply role permissions/tool shaping after adapter selection.
5. Thread plan and step identity through envelopes, session handles,
   continuation, telemetry, approval analysis, evidence projection, reporting,
   and narrative joins.
6. Make selected capabilities visible inside the turn where needed, absorbing
   the intent of GitHub issue #116.
7. Preserve exactly-once settlement and content-bound authorization.
8. Add typed failure paths for unavailable/invalid assignments that request a
   plan revision rather than substituting silently.

Acceptance:

- A single adaptive episode can intentionally use different harnesses across
  turns.
- Harness/model/effort recorded before execution matches the adapter request and
  terminal evidence exactly.
- A role has identical authority regardless of selected assignment.
- Resume executes the persisted assignment, not current defaults.
- Cross-provider review remains enforced.

### Phase 4 — Workflow execution and bounded replanning

Work:

1. Execute ready steps from the plan DAG rather than assuming the static
   pipeline sequence.
2. Integrate all episode-producing entry points: explicit planning, ticket
   delivery, company events, incident/SRE work, release handoff, and relevant
   standing-role flows.
3. Route every entry point through either a dedicated EpisodePlanner turn or an
   explicit, validated creator scope. There is no third implicit bypass.
4. Migrate both assignment modes to the same plan-DAG execution path. In fixed
   mode the workflow is still planned, while assignments resolve from config.
5. Let parent planning episodes create fully scoped child episodes so child
   planning turns are omitted when genuinely redundant.
6. Implement typed replan triggers and a small revision allowance.
7. Ensure revisions consume existing artifacts by reference and only replace
   future steps.
8. Define parent-plan/child-episode and human/agent creator provenance.
9. Make interruption and restart choose the same ready step deterministically.

Acceptance:

- No caller bypasses plan validation; only a complete creator scope bypasses
  the dedicated planner provider turn.
- Fixed and adaptive episodes use the same approval, accounting, and artifact
  substrate.
- A failed gate can cause a bounded corrective revision without replaying
  completed work.
- A crash between plan persistence and execution resumes without another
  planning charge.

### Phase 5 — Migration and simplification

Only remove old logic after compatibility characterization and fixed/adaptive
scenario tests are green.

Work:

1. Move quick/standard/deep to a derived compatibility/reporting projection, or
   delete it if no real consumer remains.
2. Remove `ROUTE_MAX_EFFORT` as a turn-selection mechanism.
3. Remove circular tier derivation from existing ticket state.
4. Retire redundant planning-depth flags and classifiers whose only purpose was
   to approximate workflow design.
5. Do not retain `pipelines.yaml` as a second primary workflow engine merely
   because assignment mode is fixed. Either reduce it to governed step/gate
   vocabulary used by planned workflows or propose its retirement through the
   ratified-surface process.
6. Replace tests that encode tier-to-effort lookup with tests of actual
   task-to-workflow and task-to-assignment behavior.
7. Consolidate duplicate episode route/plan records into the one plan plus one
   execution journal. Preserve readers/migrations for historical evidence.
8. Separate product runtime efficiency from developer-only transformation and
   release-qualification machinery in documentation. Do not delete qualification
   evidence or weaken release gates.
9. Delete dead code, stale flags, obsolete fixtures, and superseded design prose
   only after `rg` confirms no live producer, consumer, CLI, report, migration,
   or retained-artifact reader depends on them.

Acceptance:

- Both assignment modes have one workflow source of truth: the accepted plan.
- Existing fixed assignment, authority, safety, and accounting semantics remain
  compatible; static pass count is intentionally not preserved.
- No historical episode becomes unreadable.
- The net control flow is simpler: intent -> plan -> validation -> execution ->
  evidence.

### Phase 6 — Tests and evaluation

Add tests at the behavior boundary, not just implementation-detail snapshots.

Unit/property coverage:

- app assignment-mode parsing and fixed default;
- creator-scope completeness, provenance, and non-inferred bypass;
- assignment atomicity and candidate membership;
- effort support and capability validation;
- DAG integrity and deterministic ready-step selection;
- budget arithmetic and hard-cap rejection;
- safety-floor and approval derivation;
- immutable completed steps across revisions;
- stable plan hashing and persistence;
- classification/report projection, if retained.

Integration/fault coverage:

- unscoped fixed mode runs the planner, then resolves configured assignments;
- unscoped adaptive mode runs the planner and selects approved assignments;
- execution-ready creator scope skips the planner in fixed and adaptive modes;
- incomplete creator scope invokes the planner without losing creator-set
  boundaries;
- adaptive planner -> validated plan -> multiple harnesses -> journal/ledger;
- resume after planning, mid-turn, and after terminal write;
- unavailable harness causes revision/failure, never silent substitution;
- exactly-once provider settlement across retry;
- approval denial and later scoped approval;
- context manifests remain route/plan bounded;
- evidence projection distinguishes episode namespace from learning namespace;
- builder/reviewer provider independence;
- old episode artifacts remain readable.

Scenario coverage:

- mechanical/docs change;
- simple localized bug;
- complex ambiguous bug;
- simple prototype;
- full product/milestone decomposition;
- cloud deployment;
- authentication or data migration;
- incident response.

For scenario tests, assert the important absences as well as presences: for
example, a cloud deployment should not receive an irrelevant Builder turn, and
a typo should not receive a five-agent ceremony.

Required local verification depends on changed paths, with `AGENTS.md` as the
authority. At minimum for source/config changes:

```bash
pnpm test
pnpm typecheck
pnpm build
```

If `eval/**`, `scripts/eval/**`, or transformation fixtures change, also run the
full efficiency commands required by `AGENTS.md`, including validation,
transformation, deterministic eval, and the current/future-soak contract gates.
Do not run live provider, GitHub sandbox, learning activation, or soak campaigns
without their separate explicit authorization.

### Phase 7 — GitHub issue review and cleanup

The GitHub issue tracker is part of the design cleanup. Do not mass-close by
number or delete history. Use the GitHub connector when available and
authenticated `gh` as the documented fallback.

Create a disposition table for every open issue immediately before mutation:

- `keep`: independent, still valuable work;
- `absorb`: explicitly delivered by this plan;
- `supersede`: the old requested mechanism is replaced by this design;
- `duplicate`: another surviving issue owns the exact work;
- `close-completed`: verified in the repository's published/merged state;
- `close-not-planned`: deliberately rejected by the simplified product
  direction;
- `blocked-upstream`: valid but not actionable locally.

Rules:

1. Closing an unwanted issue is authorized by this plan only after reading its
   body/comments and recording a specific rationale.
2. Close rather than delete. Add a final comment linking the implementing
   commit/PR or the design decision that makes it not planned.
3. Do not close an independent bug because it is outside this implementation.
4. Do not call locally modified but unpublished code "completed". Leave such an
   issue open with a prepared close note until the change is merged/published.
5. Do not create a new umbrella issue merely to replace several well-scoped
   issues; this plan is the umbrella.

Provisional review of the open tracker on 2026-07-19:

| Issue | Relationship to this plan | Provisional action after verification |
| --- | --- | --- |
| #116 — advertise adapter capabilities inside turn | Direct dependency of assignment-aware execution | Absorb; close only after capability shaping is implemented and published. |
| #153 — config architecture umbrella | Overlaps the app assignment mode and approved-assignment contract, but is broader | Reconcile/narrow; keep any independent policy work. |
| #154 — route budgets/execution bounds frozen in source | Partly replaced by plan-derived estimates; hard ceilings still need config | Absorb the relevant part; retain or narrow any unresolved hard-policy work. |
| #155 — tier-selection thresholds frozen | Old mechanism is superseded by EpisodePlanner | Close as superseded after adaptive planning is the accepted path and compatibility behavior is documented. |
| #156 — inefficiency classification thresholds frozen | Learning/evidence policy, not necessarily planning | Keep unless implementation proves the classifier is deleted or the product decision rejects it. |
| #157 — retention windows frozen | Independent compliance policy | Keep. |
| #145 — governed taste compilation | Separate product bet | Reassess against the simplified north star; close-not-planned only with an explicit product decision. |
| #149–#152 — learning funnel/ticket destination and promotion | Separate learning-loop simplification | Review as a group, but do not close merely because EpisodePlanner does not implement them. |
| #20 | Security/upstream constraint | Keep blocked-upstream unless upstream facts changed. |
| #124, #133, #134 | Concrete defects | Keep or fix; never classify as unwanted architecture work without evidence. |
| #136, #143, #146, #148 | Independent narrative/learning defects or lifecycle work | Keep unless individually fixed or explicitly rejected. |

Refresh the list before acting; issue numbers and states may have changed.

### Phase 8 — Documentation and handoff

Work:

1. Update the ratified decision log after exact human approval.
2. Make `docs/architecture.md` explain the role/assignment split and planning
   flow.
3. Rewrite `docs/efficiency.md` around the user-visible behavior and evidence,
   moving obsolete transformation history to an archive if it remains useful.
4. Update configuration, onboarding, CLI, capability-matrix, testing, and
   development docs where behavior changed.
5. Document fixed/adaptive examples and failure diagnostics.
6. Update the standalone wiki only if its routing explanation would otherwise
   be false.
7. Run link/config/example validation and the full path-required test set.
8. Report what was removed, what compatibility remains, the final issue
   dispositions, and any live/provider evidence still outstanding.

Acceptance:

- A new user can choose fixed or adaptive turn assignment from app
  configuration without disabling EpisodePlanner.
- An episode creator can deliberately provide an execution-ready scope and see
  that the redundant planner turn was skipped.
- An operator can explain why every turn used its harness/model/effort.
- The docs describe one current architecture, not the chronology of several
  abandoned ones.

## 7. Definition of done

The effort is complete only when all of the following are true:

- App configuration supports fixed and adaptive assignment; existing apps
  default to their configured fixed assignments.
- Unscoped episodes run EpisodePlanner in both assignment modes.
- The only planner-turn bypass is an explicit, execution-ready scope supplied
  by the episode's human or agent creator; it is never inferred from apparent
  simplicity.
- Every episode starts execution with the same schema-validated, durable plan,
  whether authored by EpisodePlanner or normalized from creator scope.
- Every provider turn has one persisted atomic harness/model/effort assignment.
- The planner chooses the shortest sufficient role/turn graph in both modes;
  adaptive mode additionally chooses assignments from approved candidates.
- Deterministic validation enforces capabilities, budgets, approvals, safety
  floors, and independent review.
- The executor can honor different harnesses on different turns without
  changing role authority.
- Budget and safety route are derived from the plan and constrained by hard
  policy.
- Resume/retry/replan behavior is durable, bounded, and exactly accounted.
- Fixed and adaptive tests, fault tests, and representative scenarios pass.
- Old tier/classifier logic is either a clearly derived compatibility view or
  removed; no duplicate primary router remains.
- Documentation and ratified surfaces accurately describe the shipped behavior.
- Every open GitHub issue has been reviewed, unwanted issues were closed with
  specific comments, and independent work was preserved.
- No live campaign or external publication is represented as complete unless it
  actually occurred under the required authorization.

## 8. New-session execution prompt

Copy the prompt below into a new Codex session opened at the Operon repository:

```text
Execute the implementation plan in
docs/episode-planner-adaptive-execution-plan.md end to end.

The core product decision is settled: EpisodePlanner normally runs at the start
of every episode, in both fixed and adaptive assignment modes, and designs the
shortest sufficient workflow. Fixed mode resolves each planned turn's atomic
harness + exact model + effort assignment from configuration. Adaptive mode has
EpisodePlanner choose that atomic assignment from approved candidates.
Role/permissions remain separate from the assignment. Budget and the safety
route are derived from the accepted plan, within hard policy ceilings.

The only time the dedicated EpisodePlanner turn may be skipped is when the
human or agent that created the episode explicitly supplied an execution-ready
scope. Validate its completeness and provenance, normalize it into the same
durable EpisodePlan, and apply the same budget/safety validation. Never infer a
bypass merely because a title, label, or prompt looks simple. If creator scope
is incomplete, preserve its authoritative boundaries and run EpisodePlanner to
complete the plan. In adaptive mode, a planner-skipping creator scope must also
provide valid approved turn assignments; in fixed mode those assignments are
resolved from config.

Begin by reading the root AGENTS.md, docs/PURPOSE.md, docs/development.md, and
the complete plan. Inspect the current code and tests before editing; treat file
names in the plan as guidance if the repository has evolved. Use a tracked work
plan and execute in phases, keeping the tree green and sending concise progress
updates. Prefer the smallest coherent architecture and remove superseded logic
only after replacement coverage is green.

The human-ratified surfaces named in AGENTS.md require special handling. Prepare
the exact proposed diffs and rationale, show them to me, and obtain explicit
ratification before applying those exact edits. This prompt authorizes normal
implementation changes, tests, docs, and the issue cleanup described below; it
does not pre-ratify unseen changes to those protected surfaces.

Preserve all pre-existing user changes and untracked files. Do not overwrite or
clean unrelated work. Use apply_patch for file edits. Follow the repository's
import-direction, default-branch, dependency, and testing rules.

Implement contracts/config and the explicit creator-scope bypass first, then the
bounded EpisodePlanner and validator, assignment-aware execution, entry-point
integration/replanning, migration and simplification, tests/evals,
documentation, and issue cleanup. Route every episode through either
EpisodePlanner or a validated creator scope; there is no third implicit bypass.
Do not build a second permanent orchestrator beside the existing one. Reuse
durable episode, approval, context, ledger, reporting, narrative, and
learning-evidence substrates.

Test the four planning/assignment combinations explicitly: unscoped fixed,
unscoped adaptive, creator-scoped fixed, and creator-scoped adaptive. Also test
that incomplete or merely inferred scope cannot skip planning. Cover simple
bug, complex bug, prototype, full product decomposition, cloud deployment,
sensitive migration/auth, incident, and mechanical/docs scenarios. Assert
unnecessary turns are absent. Run every command required by AGENTS.md for the
paths changed, including at least pnpm test, pnpm typecheck, and pnpm build for
source/config changes. Do not run live provider, GitHub sandbox,
learning-activation, or soak campaigns without their separate explicit
authorization.

Review the current GitHub tracker using the github skill/connector, with
authenticated gh only as fallback. Build the plan's full disposition table
before mutations. You are authorized to close genuinely unwanted,
duplicate, or superseded issues after reading each issue and leaving a precise
closing comment. Keep independent bugs and blocked-upstream work. Do not call
local unpublished code completed, do not delete issue history, and do not push,
publish, merge, or open a PR unless I separately request it.

Do not stop at analysis or a partial scaffold. Continue through all safe,
authorized phases. If protected-surface ratification or a separate external/live
authorization is the only blocker, stop at that exact boundary with the diff or
command ready and a concise account of completed work, tests, remaining work,
and the decision needed.
```
