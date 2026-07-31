# Operon validation-harness design state

Last updated: 2026-07-30

## Campaign

- Scope mode: `product`
- Intended target: production Operon
- System criticality: C3, with contained component overrides only when justified and ratified
- Working style: deliberate human-agent collaboration at the normal teach-first pace
- Coexistence posture: `parallel-greenfield`
- Isolated root: `codex-tests/`
- Parent harness: none

## Protected incumbent harness

- `test/` and `eval/` are incumbent, protected, and read-only.
- Their contents are not a source for independently reconstructing product intent.
- Existing test and evaluation commands, package scripts, gates, runner configuration, and CI integration must not be weakened, redirected, skipped, replaced, or modified.
- Incumbent equivalence, replacement, migration, and cutover are outside the
  current persistent goal. The greenfield harness makes no claim about them.

## Ratified Phase-0 module map

The product-level map is broad and shallow. Later deep passes are expected for:

1. Package, homes, and lifecycle
2. Authority and governed configuration
3. Portfolio isolation and budgets
4. Dispatch, scheduling, and intake
5. Episode planning and admission
6. Harness/runtime envelope
7. Model-mediated intelligence
8. Delivery and quality loop
9. Approvals and consequential effects
10. Operational truth and recovery
11. Context and task assembly
12. Governed learning and memory
13. Packaging and platform-release assurance

Read-only human projection and rendering is a proposed contained C2 component; artifact authorization, redaction, path confinement, and any consequential decision surface retain the C3 floor.

## Current position

- Phase 0: completed and explicitly confirmed by the human.
- Phase 1: completed and explicitly confirmed by the human on 2026-07-29.
- Phase-1 system map and tier: ratified in `system-map.md`.
- Phase 2: completed and explicitly confirmed by the human on 2026-07-29.
- Phase 3: completed and explicitly confirmed by the human on 2026-07-29.
- Phase 4: completed and explicitly confirmed by the human on 2026-07-29.
- Phase 5: completed and explicitly confirmed by the human on 2026-07-29.
- Phase 6: completed and explicitly confirmed by the human on 2026-07-29.
- Phase 7: completed and explicitly selected by the human on 2026-07-29.
- Phase 8: design package explicitly ratified by the human on 2026-07-29.
- Local implementation: the containment-aware, non-spending controlled
  foundation executes all five local lanes. The aggregate remains correctly
  red on two production-conformance detectors: `OPERON-CASE-DET-001` exposes
  the production Pi masked-context symlink escape, and
  `OPERON-CASE-DET-004` exposes contradictory concurrent approval decisions.
  No waiver or production change was applied. On 2026-07-30 the human decided
  to retain Pi, track both defects, and continue the campaign without treating
  either detector as green. The defects are
  [GitHub issue #198](https://github.com/buildstacks-dev/Operon/issues/198)
  and [GitHub issue #199](https://github.com/buildstacks-dev/Operon/issues/199).
- Structured report integrity and generated-output confinement are independent
  passing lanes. The manifest records the exact failed assertion, source and
  lock hashes, toolchain, case ID, non-claims, and blocking-absent work.
- The foundation includes stateful GitHub, event/scheduler, process, effect,
  randomness, and environment controls; real production approval/effect
  recovery composition; and a 90-day accelerated run through production
  scheduler evidence/recovery composition.
- Strict policy checks reject unknown or weakened nested lane/gate/invariant
  data. Turn-result checks reject contradictory success and missing usage.
  Layer-4 aggregation rejects duplicated repetitions and impossible scores.
- Additional local hardening now proves identical evidenced gate failures stop
  as no-progress, non-ending child gates time out, raw learning candidates do
  not resolve into active context, platform-validation authority stays outside
  packaged/runtime context, observer restart rebuilds without durable mutation,
  and accelerated scheduling continues independent work while approval-shaped
  work is blocked.
- The human authorized one content-bound Layer-4 slice on 2026-07-30:
  `OPERON-L4-001`, Episode Planner, 10 cases × 3 runs,
  `claude/claude-opus-5/xhigh`, 27/30 overall, at least 2/3 per case, 3/3 for
  authority/safety-critical cases, USD 5 per turn, and USD 60 aggregate.
  Failure preserves the current production assignment and evidence and
  produces no qualification.
- Real Layer 3, real-time Layer 5, additive CI, full threat/DR work, and
  comprehensive expansion beyond the frozen Episode Planner slice remain
  blocking-absent and unauthorized. The full walking skeleton is not complete.
- Cases: scaffold and walking-skeleton seeds plus the independently derived,
  post-prompt Episode Planner corpus authorized by `OPERON-L4-001`.
- The host-authenticated `OPERON-L4-001` campaign stopped fail-closed after
  9/30 attempts. `OPERON-EP-003` repetition 1 missed the critical-case quality
  oracle, and repetition 3 failed the deterministic EpisodePlan contract
  after its one bounded repair. Observed spend was USD 4.219405 with no
  outstanding reservation or ceiling violation. Qualification is
  `blocked_contract`; production assignment, prompt, corpus, and raw evidence
  were preserved.
- An append-only evidence audit corrects the original failed-attempt report's
  `planner_attempts: 0` to 2 from its two settled budget-turn records. The
  original evidence was not rewritten, and the runner now has a regression
  detector for failed-attempt count truthfulness.
- The human first authorized a separately versioned, non-spending follow-up
  preparation. `campaigns/OPERON-L4-002/` binds an evaluation-only
  candidate prompt overlay to the unchanged protected prompt and unchanged
  frozen `OPERON-L4-001` corpus. Deterministic deposits cover the observed
  `supersedes: null` and JavaScript `undefined` failures; the frozen scorer
  deposit covers `review/verify` versus `review/security`.
- The human then authorized only the `OPERON-L4-002` diagnostic:
  `OPERON-EP-003` × 3, `claude/claude-opus-5/xhigh`, USD 5 per turn and USD
  10 aggregate, with no qualification. It passed 3/3 deterministic contracts
  and 3/3 frozen quality oracles in one native turn each. Spend settled at USD
  1.224494 with no reservation, unknown usage, or violation. The I1
  role-separated evidence audit passed all 11 checks; stronger C3
  organizational independence remains absent.
- The human then authorized and the runner completed the unchanged candidate's
  full 10 × 3 qualification. All 30 deterministic contracts passed and 29/30
  attempts were quality-acceptable, but critical case `OPERON-EP-004` scored
  2/3 against its 3/3 floor after repetition 1 added a speculative release
  gate and exceeded the six-step ceiling. The result is `blocked_quality`;
  no qualification was issued.
- Full-stage spend settled at USD 12.881382 across 32 provider turns, below
  the authorized USD 60 aggregate and USD 5 per-turn ceilings, with no
  outstanding reservation, unknown usage, or external effect. The protected
  prompt, production assignment, frozen corpus, and incumbent harness remain
  unchanged.
- The independent audit found that the immutable full-stage ledger embedded
  `OPERON-L4-001` rather than `OPERON-L4-002`. Spend limits and turn bindings
  were correct, but campaign attribution is not clean. The evidence was not
  rewritten; `CampaignBudgetStore` now requires explicit campaign identity,
  and `OPERON-L4-002-DET-003` prevents recurrence.
- Under the human's delegated budget authority, three further versioned
  candidates used the same bounded USD 10 diagnostic / USD 60 full-stage
  envelopes. `OPERON-L4-003` passed its EP004 diagnostic but stopped its full
  stage on an EP003 missing-gate repair; `OPERON-L4-004` passed its EP003
  diagnostic but stopped on EP004 initial-plan self-supersession; and
  `OPERON-L4-005` passed its EP004 diagnostic but stopped on EP003
  JavaScript-undefined followed by self-supersession.
- All six follow-up stages have complete, settled, no-effect evidence.
  L4-003/004/005 full-stage spend was USD 3.838934, USD 4.235953, and USD
  3.183568 respectively; every independent full-stage audit passed all 12
  checks. No qualification was issued.
- Further stochastic prompt-chasing is stopped. The latest failure violated
  an already-explicit candidate rule and both failure classes already have
  deterministic deposits. Any new provider campaign should start only from a
  materially different candidate or harness design.
- `traceability-report.md` now maps all 12 invariants, 16 boundaries, 13
  journeys, and 23 LLM call sites to their current evidence and limitations.
  `residual-blocking-report.md` records the remaining non-budget decisions and
  explicit non-claims. These reports are complete records of the blocked
  state, not qualification claims.

## Open findings

Open findings carried forward after Phase-1 confirmation:

- PTF-004: cadence, authority, and outcome of periodic organizational review
- PTF-005: npm installation/update/rollback contract
- PTF-006: explicit exclusion or inclusion of C4 safety/mission-critical use
- PTF-007: planner optimization objective and acceptable quality/cost/time/risk tradeoffs
- PTF-008: prioritized backlog-window semantics, including `X`
- PTF-009: minimum human escalation decision packet and semantic clarity bar
- PTF-010: approval-backlog backpressure, fairness, priority, aging, and alerts
- PTF-011: provider/auth/quota route-around and cross-assignment failover policy
- PTF-012: observer automatic-restart ownership
- PTF-013: long-running provider-turn recovery promise
- PTF-014: platform release-evidence currency and rollback promise
- PTF-015: partially resolved for the Episode Planner slice; the
  L4-002 through L4-005 diagnostics/full stages were executed, but every full
  candidate failed a critical deterministic or quality gate and no
  qualification exists. All other
  LLM/final-artifact
  floors, regression deltas, dominance materiality, and proportional-effort
  bands remain open
- PTF-016: independent quality-oracle mechanism and possible Test Creator role
- PTF-017: distinct GitHub builder/reviewer principal requirement
- AF-001: multi-org concurrent operation, isolation, and version skew
- AF-002: implementation conformance for GitHub-mediated non-software role DAGs, lab evidence, artifact semantics, and configured publication
- AF-003: ownership of external channel collectors before the file-drop inbox
- AF-004: package/skill/org/state/app schema compatibility under update
- AF-005: durable representation of org-internal work scope
- AF-006: product-wide recovery fact-precedence table
- AF-007: portable cross-harness/model continuation semantics
- AF-008: unified subscription/API-key/quota failover contract
- AF-009: observer supervision owner
- AF-010: named disposable live targets for all unfakeable seams
- AF-011: approval backlog versus WIP/admission behavior
- AF-012: initial golden sets postdate the current prompts
- AF-013: product-profile final-artifact graders and owners
- AF-014: critical-incident classifier/quarantine ownership and state machine
- AF-015: production GitHub principal-separation topology

Resolved product truth:

- PTF-001: GitHub-mediated non-software artifact workflows are in product intent
- PTF-002: parent task → planning episode when needed → child episodes → one EpisodePlan per episode
- PTF-003: accepted artifact + product-specific verification/review + commit + configured ship + truthful publication acknowledgement
- PTF-018: deterministic critical-incident quarantine policy, safe-scope
  expansion, permitted forensic/harm-reduction activity, and attributable
  resume decision

## Ratified Phase-2 invariant set

The human ratified `OPERON-INV-001` through `OPERON-INV-011`, their enforcement
classification, and the proposed minimum human-escalation decision envelope.
`invariants.md` is now the product-level invariant source for later boundary,
contract, risk, and case derivation.

## Ratified Phase-3 boundary set

The human ratified `OPERON-BND-001` through `OPERON-BND-016`,
approval-independent progress, Layer-2 controlled-seam placement, retained
live obligations, and the rule that provider backup is a pre-authorized
alternative in the accepted plan rather than silent substitution.

`boundary-map.md` is now the product-level boundary source for contract, risk,
and case derivation.

## Phase-4 ratification checkpoint

The human completed the contract exploration beat. The resulting candidate
artifacts are:

- `contracts/operon-bnd-001-*.md` through
  `contracts/operon-bnd-016-*.md`: one five-part contract for each ratified
  boundary;
- `contracts/journey-acceptance.md`: Given/When/Then behavior acceptance for
  J-01 through J-13; and
- `contracts/interface-conformance.md`: focused obligations for CLI, Agent
  Skill, read-only UI/reports, timers/events, signals/restart, and future
  API/MCP adapters.

The synthesis explicitly incorporates the human's Phase-4 product truth:

- every admitted harness/model combination normalizes to one Operon result
  contract;
- planning publishes child tickets only in the required template and with
  causal provenance; and
- no provider or implementation claim can become a pass without the required
  evidence.

All unresolved choices remain `OPEN` and trace to the existing product-truth or
architecture findings. The human ratified this contract and
journey-acceptance set on 2026-07-29. Phase 5 may now inventory LLM call sites
and separate their deterministic contract surfaces from statistical quality
evaluation.

## Phase-5 candidate checkpoint

The human completed the LLM-evaluation exploration beat. Candidate artifacts:

- `llm-eval-plan.md`: three-surface architecture, 23 logical model call sites,
  uniform assignment conformance, judge calibration, deterministic trajectory,
  composite outcome evaluation, and model/harness change procedure;
- `golden-sets/README.md`: planned per-site and cross-call registry; and
- `golden-sets/manifest-template.yaml`: tool-independent candidate manifest
  with an honest initial-baseline limitation.

The synthesis treats a poor 24-hour homepage run as a product miss, separates
quality floors from proportional resource use, and permits lower-cost models
only through call-site-specific qualification. PTF-015 and AF-012–013 preserve
the unresolved thresholds, initial-baseline limitation, and product-profile
grader ownership.

The human ratified the Phase-5 inventory and evaluation architecture on
2026-07-29. Phase 6 may now build a human-confirmed probability × consequence
allocation across journeys/modules and specify the required C3 Layer-5
obligations.

## Phase-6 ratification checkpoint

The human completed the risk exploration beat. `validation-policy.yaml`
contains the ratified:

- probability × consequence scale and critical/high/moderate/low coverage
  profiles;
- J-01–J-13 and thirteen-module risk allocation with contained overrides;
- LLM quality-risk grouping while preserving critical deterministic guardrails
  at every call site;
- all five active validation lanes and their blocking cadence;
- critical-incident quarantine, human-attention, independent-quality-oracle,
  GitHub-identity, resource-runaway, and supply-chain assurance;
- C3 threat-model, contention-scale, 90-day accelerated soak, 72-hour
  production-shaped soak, and disaster-recovery obligations; and
- `parallel-greenfield` coexistence and future cutover constraints.

Phase-6 backflow added ratified `OPERON-INV-012`. PTF-018 is resolved at the
product-policy level; AF-014 retains the classifier/quarantine implementation
and ownership gap. PTF-016–017 and AF-015 remain open by design.

The human confirmed the complete Phase-6 synthesis on 2026-07-29:

> "Thanks. Confirming it looks good to me. Let us move to phase 7 tooling"

This ratifies the risk allocation, critical-incident quarantine rule, Layer-5
owners/triggers/windows, and the decision to retain Test Creator and distinct
GitHub-principal mechanisms as open findings. Phase 7 may now present tooling
options. No tool is selected until the Phase-7 human hard stop.

## Phase-7 ratification checkpoint

The human selected the complete recommended coherent stack on 2026-07-29:

> "Select the recommended stack"

The ratified selection is recorded as policy data in
`validation-policy.yaml`, including:

- an independently locked strict-TypeScript package beneath `codex-tests/`;
- Vitest plus fast-check for Layers 1–2;
- real local filesystem/worktree composition with stateful controlled seams;
- custom TypeScript live-sandbox and evaluation runners;
- structured threat modeling, bespoke contention/recovery/soak drivers, and
  pinned secret scanning for Layer 5; and
- GitHub Actions as a future additive host requiring separate authorization.

Rejected alternatives and the reasons for rejection are retained in the
policy. No dependency was installed, no command was connected, and no
incumbent path or gate changed. Phase 8 may now scaffold traced case families
and the walking-skeleton backlog, then run the final adversarial reader test.

## Phase-8 adversarial reader review

Status: **Ratified; local non-spending implementation completed after the hard
stop**

The reader test used only the artifacts beneath `codex-tests/`.

### Production-operator view

The operator can:

- distinguish authoritative behavior/state from CLI, Agent Skill, UI, event,
  timer, signal, and future API/MCP adapters;
- find the twelve properties that must never break and their fail-closed
  enforcement classification;
- identify all sixteen independently failing boundaries and distinguish
  controlled Layer-2 semantics from retained Layer-3 proof;
- see which current claims are design-only, blocking-absent, or prohibited
  pending authorization;
- locate every open product-truth and architecture finding;
- understand that approval wait, critical quarantine, ambiguous effects, and
  degraded observation have different consequences;
- determine what blocks when an LLM threshold is missing or fails; and
- see that incumbent gates remain authoritative and rollback disables only a
  future additive gate.

### New-engineer view

The engineer can:

- start from one machine-readable policy and trace to system, invariant,
  boundary, contract, journey, LLM, case, and backlog artifacts;
- implement the selected toolchain and proposed directory layout entirely
  beneath `codex-tests/`;
- build the controlled-world kernel without mocking inside production
  boundaries;
- implement six walking-skeleton cases with explicit source IDs, risk, layer,
  and oracle;
- refuse rather than invent behavior where AF-006, AF-010, AF-014, PTF-005,
  or PTF-015 blocks an expected outcome;
- keep real sandbox, provider, scheduler, publication, registry, and CI work
  behind their separate authorization gates; and
- know that comprehensive case expansion is later work and incumbent
  equivalence/replacement/cutover is outside the current campaign.

### Gaps found and repaired during the review

1. **Golden-threshold failure handling was implicit.** Repaired in
   `llm-eval-plan.md` §12, `golden-sets/README.md`, and policy gate responses.
2. **The machine policy named invariants without carrying their statements.**
   Repaired by adding the complete twelve-entry invariant registry.
3. **The greenfield implementation layout was underspecified.** Repaired with
   an isolated proposed layout and ownership rules in `harness-backlog.md`.
4. **One elicitation-log link was not relative to its artifact location.**
   Repaired without changing the quoted human wording.

### Review result

No silent lane, unprotected incumbent mutation, unknown expected outcome, or
unauthorized external operation was found in the candidate design.
Outstanding PTF/AF findings remain visible and intentionally block only the
claims that depend on them.

The human ratified this design package on 2026-07-29 and authorized local
non-spending implementation. The implementation now provides a strict
isolated package and nested fail-closed policy checks, controlled real
filesystem/Git plus stateful boundary simulators, production-composed provider
and consequential-effect recovery, fail-closed Layer-3/4 driver mechanics, a
90-day accelerated production scheduler/recovery composition slice, and a
containment-aware evidence-producing local aggregate.

No CI integration, live sandbox execution, provider campaign, real scheduler
installation, deployment, publication, or comprehensive case expansion was
authorized or performed. Incumbent equivalence, replacement, migration, and
cutover are outside the current persistent goal.
