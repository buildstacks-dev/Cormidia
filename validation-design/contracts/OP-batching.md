# Operation contract — C-OP-BATCH (execution-unit batching and session affinity)
Canonical ID: **CORMIDIA-C-OPBATCH-001 (alias: C-OP-BATCH)**

Status: ACCEPTED implementation contract (2026-08-03); HB-104's execution-unit
authority, deterministic bounded admission, lazy plans, and isolated journals/budgets/
outcomes are implemented. HB-106/HB-107 add the local direct-effect continuation and
shared context/session/cache slices. HB-108 closes the deterministic catalog family,
HB-109 closes the contention and soak-collector machinery, and HB-110 implements the
shared Status/Report/Observe explanation. The seven-day campaign, HB-111 protected-
surface proposal and live B-17 round trip remain pending/BLOCKED:B-17-L3.
Defends INV-001/004/005/006/008/014/015/016, M5/M6/M17. Journeys J-20/J-04/J-18.
Interfaces with B-20/B-21/B-22.

## §1 Inputs and authority
- An **execution unit** has two admitted shapes: (a) a roadmap-backed code-delivery unit
  containing one-or-more tickets and exactly one PR outcome; or (b) a direct operational
  unit carrying complete provenance, objective/scope, expected artifacts/effects,
  validation/evidence contract, source dedupe identity and creator scope. The direct
  shape may bypass RoadmapPlan because it is not product-backlog planning; neither shape
  bypasses EpisodePlan.
- Batch admission consumes one exact RoadmapPlan/ready-frontier hash or direct-unit
  authority plus current dependency, routing, validation, app-pause, WIP, budget,
  effect-policy and assignment-readiness facts.
  The scheduler groups; it does not reprioritize product work, change delivery-unit
  membership, author validation, or choose workflow steps.
- Only already-ready, same-app execution units are candidates. If any code member is
  `routing:human-only`, changed since the frontier hash, dependency-blocked, validation-
  incomplete, already claimed, or over a hard bound, the unit is excluded with a typed
  durable reason.
- A complete code ticket may bypass the roadmap **provider turn**, but it still receives
  deterministic RoadmapPlan membership so prioritization/accounting remain total. A
  Support/event-derived quick fix (including input from a future Jira adapter) is never
  direct operational work merely because it is small; if it changes code, it takes this
  code-unit path. This contract does not claim a Jira integration exists.

## §2 Batch construction
- A batch is a bounded ordered list of stable execution-unit IDs plus reasons and a
  context-affinity manifest. Priority/dependency/WIP/routing/validation are hard
  constraints; affinity and expected cache savings are subordinate optimization scores.
- Affinity derives from deterministic facts where possible: repository/base, workstream,
  affected boundaries/components/files, required context hashes, role/assignment tuple,
  validation template and compatible tool/runtime needs. Model-estimated affinity is
  advisory and visibly attributed.
- A cache hit is never presumed. Actual provider cache read/write/usage evidence is
  recorded after execution and may inform later planner/scheduler policy through the
  governed learning path.

## §3 Lazy EpisodePlanner boundary
- Batch creation constructs zero provider runtimes and zero delivery EpisodePlans.
  Immediately before claim, each admitted unit is revalidated and receives exactly one
  delivery EpisodeIntent/EpisodePlan.
- Complete provenance-bearing creator scope or a governed workflow-template reference
  normalizes token-free. Otherwise one bounded EpisodePlanner turn plans the delivery
  unit—not each member ticket and not every unit in the frontier.
- A batch is not an EpisodePlan and never authorizes a provider/mechanical/approval step.

## §3a Direct operational work
- A complete operational unit can enter without RoadmapPlan or a roadmap-planning LLM
  turn. Deterministic intake still validates provenance, dedupe identity, routing,
  scope, expected outputs/effects, budget, safety and validation/evidence obligations.
- Routine release promotion may use one shallow EpisodePlan: one Marketing/Reddit-agent
  content turn can draft a coherent set of channel-specific exact payloads; deterministic
  secret/link/required-field gates follow; an optional independent content review is
  selected by policy/risk rather than ceremony.
- Posting to five Reddit destinations, LinkedIn and Twitter is seven outward effects,
  not one broad permission. Each exact payload/destination receives its own content-
  bound approval and execution acknowledgement, although the human interface may review
  the seven items as one batch with per-item audit.
- “Follow them” schedules future observation as deterministic time events. A future
  reply/action whose content is not yet known becomes a new execution unit/EpisodePlan;
  the initial campaign cannot pre-authorize unknown replies.

## §4 Session and context reuse
- Shared immutable inputs use stable ordered prefixes/references and content hashes;
  unit-specific context is appended as a delta. Required authority, validation and
  unresolved findings are never evicted merely to improve cache shape.
- Session reuse is exact-role, exact-assignment, exact-app and exact-operation only.
  Builder and Reviewer never share or resume each other's private session. Reviewer may
  reuse its own immutable context across units while producing independent per-unit
  verdicts.
- Every provider turn remains attributable and settled under exactly one execution
  EpisodePlan. Per-unit ceilings remain enforceable; batch aggregates cannot create
  hidden headroom or transfer spend after a failure.

## §5 Failure, recovery and completion
- A batch moves `admitted → running → complete`; every admitted unit carries an
  independent typed disposition. `complete` means that the disposition set is total,
  not that every unit succeeded or produced an external effect.
- Batch and unit journals are distinct. A crash resumes each unit from its durable plan
  and evidence; completed turns are not repeated to recreate batch order or cache state.
- One unit's return/replan/review/effect failure does not partially merge/complete it,
  close its members, acknowledge unperformed effects, or contaminate sibling evidence.
  Independent sibling units may continue when hard
  bounds and ordering still permit; every skipped/stopped unit receives a typed outcome.
- Batch completion means every admitted unit has a terminal batch disposition—not that
  every unit merged. Reports expose per-unit outcomes, provider usage quality and actual
  cache evidence; missing measurements are unknown, never zero savings.

## Implementation evidence (HB-106…HB-110, 2026-08-04)

- `src/org/direct-operational-campaign.ts` implements the complete local direct-campaign
  authority, seven content-bound approval joins, acknowledgement/evidence projection,
  deterministic follow-up intent and new-unit continuation for unknown interactions.
- `src/org/execution-affinity.ts` implements ordered immutable-prefix/unit-delta
  manifests, crash-safe per-turn settlement, exact session compatibility and
  hit/miss/unknown cache telemetry. Ticket provider turns persist that evidence through
  `src/org/ticket-episode-runtime.ts`.
- `tests/hermetic/cf-hb106/`, `tests/hermetic/cf-hb107/`, and
  `tests/unit/cf-hb107/` contain the seeded broadened-grant, crash, incompatible-session,
  Builder→Reviewer, cache-lure and façade-bypass negative controls. No external effect,
  connector mutation, L3 adapter proof, live/eval/soak campaign or scheduler install is
  claimed by this evidence.
- `tests/ops/contention-rig.ts` covers overlapping batches, duplicate stimuli,
  all-or-none multi-ticket claims, per-unit terminal settlement, sibling isolation and
  stale frontiers with seeded violations. `tests/ops/soak-protocol.ts` records the same
  dimensions without starting or simulating elapsed seven-day evidence.
- `src/org/roadmap-explanation.ts` is the shared read-only Status/JSON/Report/Observe
  projection. It distinguishes batch disposition completeness from every-unit success,
  artifact authority from label projections, and unknown cache evidence from zero.
