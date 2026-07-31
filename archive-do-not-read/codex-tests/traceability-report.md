# Operon validation traceability report

Status: **complete as a traceability record; product qualification blocked**

Snapshot date: 2026-07-30

Authoritative run evidence:
`./.artifacts/local-validation/manifest.json`

This report maps every ratified product-level invariant, boundary, journey,
and logical LLM call site to its current detector/evidence and remaining
limitation. `Passing slice` never means product-wide qualification.

## Verdict legend

| Verdict | Meaning |
| --- | --- |
| Passing slice | The named deterministic or bounded campaign evidence passes |
| Partial | Some controlled proof exists, but a required live, expansion, or product-truth obligation remains |
| Blocked defect | A falsifiable production-conformance detector is red |
| Blocking-absent | The required detector/evidence has not been authorized or implemented |
| Unqualified | A real repeated provider campaign ran but did not meet all conjunctive gates |

## Ratified invariant traceability

| Claim | Primary detector/evidence | Layer | Verdict | Remaining limitation |
| --- | --- | --- | --- | --- |
| OPERON-INV-001 Work identity and lineage | controlled-world isolation, recovery composition, accelerated-soak evidence | L1–L2, L5 | Partial | full multi-org concurrency/version-skew expansion remains AF-001 |
| OPERON-INV-002 Authority and tenant confinement | `security-boundaries.test.ts`, platform/learning isolation | L2 | **Blocked defect** | TM-002 / issue #198: Pi follows a repository-controlled `.pi` symlink |
| OPERON-INV-003 Capability-truthful execution | provider-admission and turn-result contracts; qualification runner | L1–L4 | Partial | native live adapter/target proof remains absent |
| OPERON-INV-004 One workflow authority | production EpisodePlan validation, repair regression deposits, L4 campaigns | L1–L4 | Partial / unqualified | no Episode Planner candidate qualified; comprehensive transition expansion is gated |
| OPERON-INV-005 Bounded and exact resource use | campaign-budget, resource-runaway, L4 ledgers, accelerated soak | L1–L2, L4–L5 | Passing slice | full contention and production-shaped evidence remain |
| OPERON-INV-006 Specific human authorization | effect reconciliation and approval contention | L2 | **Blocked defect** | TM-011 / issue #199 leaves approval outcomes contradictory under contention |
| OPERON-INV-007 Informed escalation | approval/effect binding and fail-closed policy checks | L1–L2 | Partial | packet clarity and backlog/backpressure floors remain PTF-009–010/AF-011 |
| OPERON-INV-008 Truthful external effects | effect-reconciliation crash/ambiguity/idempotency detector | L2 | Partial | real service acknowledgement semantics require a named Layer-3 target |
| OPERON-INV-009 Evidence-backed claims | turn-result, gate, qualification, observer, and manifest non-claim checks | L1–L5 | Passing slice | final-artifact quality and external publication evidence remain absent |
| OPERON-INV-010 Truth-preserving recovery | recovery composition, retention recovery, accelerated soak | L2, L5 | Partial | cross-store fact precedence and full DR matrix remain AF-006 |
| OPERON-INV-011 Governed learning activation | platform-learning-isolation detector | L2 | Partial | activation/replay/rollback adversarial expansion remains |
| OPERON-INV-012 Critical-risk quarantine | policy fail-closed checks, resource-runaway/no-progress and accelerated blocked-work paths | L1–L2, L5 | Partial | full critical-incident classifier/quarantine state machine remains AF-014 |

## Ratified boundary traceability

Each boundary has a five-part contract under `contracts/`. The table records
the current executable proof, not merely the existence of the contract.

| Boundary | Current executable evidence | Verdict | Remaining limitation |
| --- | --- | --- | --- |
| OPERON-BND-001 Installed implementation ↔ schema estate | package/control-plane isolation and recovery seeds | Partial | npm update/rollback PTF-005; schema compatibility AF-004 |
| OPERON-BND-002 Shared selector ↔ isolated org | controlled-world isolation and security boundaries | **Blocked defect** | TM-002 plus multi-org expansion AF-001 |
| OPERON-BND-003 Org governance ↔ app state | controlled seams and recovery composition | Partial | app/work-scope representation AF-005 |
| OPERON-BND-004 Process ↔ durable state/worktrees/sessions | recovery composition, ambiguity preservation, accelerated restart evidence | Passing slice | full crash-point/fact-precedence matrix absent |
| OPERON-BND-005 Host scheduler/process manager ↔ dispatcher | accelerated fake-clock production composition | Partial | real-time 72-hour production-shaped host run absent |
| OPERON-BND-006 Autonomous work ↔ human decision | approval contention and blocked-work progress | **Blocked defect** | TM-011; packet/backpressure semantics open |
| OPERON-BND-007 Runtime envelope ↔ provider/auth/quota | admission, turn contract, spend enforcement, real L4 transport | Partial / unqualified | no passing candidate; failover policy PTF-011/AF-007–008 |
| OPERON-BND-008 Runtime envelope ↔ host tools | security boundaries and child-timeout/no-progress detectors | Passing slice | native adapter live proof absent |
| OPERON-BND-009 Local state ↔ GitHub | stateful GitHub controlled seam and live-driver refusal | Partial | no named disposable GitHub target or principal-separation proof |
| OPERON-BND-010 Artifact workflow ↔ CI/lab/verification | gate/evidence controlled seams | Blocking-absent | additive CI and real lab/verification target not authorized |
| OPERON-BND-011 Effect executor ↔ external target | effect-reconciliation detector | Partial | named real target and acknowledgement semantics absent |
| OPERON-BND-012 Learning publisher ↔ active context | raw-candidate isolation | Partial | governed publish/activation/replay matrix absent |
| OPERON-BND-013 State owners ↔ read-only projections | observer-loss rebuild/no-mutation detector | Passing slice | supervisor ownership PTF-012 remains |
| OPERON-BND-014 Demand collectors ↔ intake | untrusted-input/quarantine seed | Partial | external collector ownership AF-003 and live proof absent |
| OPERON-BND-015 Registry/distribution ↔ installed package | package allowlist/control-plane isolation | Partial | real registry publication/update/rollback absent |
| OPERON-BND-016 Platform release plane ↔ operated org | platform-validation authority exclusion | Partial | release currency/rollback PTF-014 and packed-artifact live proof absent |

## Ratified journey traceability

| Journey | Current evidence | Verdict | Remaining limitation |
| --- | --- | --- | --- |
| J-01 Install and discover | package/control-plane isolation seed | Partial | real registry install/update/rollback absent |
| J-02 Create/select/upgrade org | controlled org isolation/recovery | Partial | multi-org concurrency/schema skew expansion absent |
| J-03 Onboard/promote product | evidence-backed claim and gate seeds | Partial | live promotion/CI evidence absent |
| J-04 Capture/prioritize demand | stateful intake/quarantine seed | Partial | priority window/backpressure semantics open |
| J-05 Decompose work | accepted-plan/ticket contract records | Blocking-absent | comprehensive decomposition and publication cases await skeleton gate |
| J-06 Plan an episode | production Episode Planner campaigns and deterministic validators | Unqualified | all versioned candidates failed a critical gate |
| J-07 Execute an episode | turn-result, budget, gate, timeout, recovery composition | Partial | comprehensive adapter and live execution matrix absent |
| J-08 Consequential effect | approval/effect reconciliation | **Blocked defect** | TM-011 and named live effect target absent |
| J-09 Recover | recovery composition, retention recovery, accelerated restart | Partial | AF-006–008 and full crash matrix remain |
| J-10 Observe without mutation | observer-loss deterministic rebuild | Passing slice | automatic supervisor ownership remains open |
| J-11 Capture/activate learning | raw candidate excluded from active context | Partial | governed activation/rollback expansion absent |
| J-12 Periodic organizational review | no-authority learning/policy controls | Blocking-absent | cadence, scope, authority, and success semantics PTF-004 |
| J-13 Non-software product work | ratified acceptance contract only | Blocking-absent | real role/lab/artifact/publication composition AF-002 |

## Logical LLM call-site traceability

Every call site has a ratified contract/quality question in
`llm-eval-plan.md`. Only OPERON-LLM-001 has a frozen statistical corpus and
real repeated campaign evidence.

| Call site | Current evidence | Verdict / limitation |
| --- | --- | --- |
| OPERON-LLM-001 Episode Planner | frozen 10-case corpus; L4-001 through L4-005 reports/audits | **Unqualified**: each full candidate failed a critical contract or quality gate |
| OPERON-LLM-002 Bootstrap Planner | logical inventory and deterministic-envelope design | Blocking-absent: no frozen quality set/floor |
| OPERON-LLM-003 Visionary | logical inventory and deterministic-envelope design | Blocking-absent: no frozen quality set/floor |
| OPERON-LLM-004 PM-A | logical inventory and deterministic-envelope design | Blocking-absent: no frozen quality set/floor |
| OPERON-LLM-005 PM-B | logical inventory and deterministic-envelope design | Blocking-absent: no diversity set/floor |
| OPERON-LLM-006 Planning Arbitrator | judge architecture only | Blocking-absent: no must-catch/must-pass calibration |
| OPERON-LLM-007 Ticket Decomposer | logical inventory and ticket contract | Blocking-absent: no frozen quality set/floor |
| OPERON-LLM-008 Groom Planner | logical inventory and intake contract | Blocking-absent: no frozen quality set/floor |
| OPERON-LLM-009 Triage Planner | logical inventory and classification contract | Blocking-absent: no confusion-matrix floor |
| OPERON-LLM-010 Builder Contract | deterministic artifact contract design | Blocking-absent: no frozen quality set/floor |
| OPERON-LLM-011 Builder Implement | deterministic result/authority seams | Blocking-absent: no end-artifact or trajectory floor |
| OPERON-LLM-012 Builder Fix | deterministic result/authority seams | Blocking-absent: no recurrence/review-cycle floor |
| OPERON-LLM-013 Reviewer Verify | judge architecture only | Blocking-absent: no calibrated must-catch/must-pass set |
| OPERON-LLM-014 Reviewer Security | judge architecture and threat seeds | Blocking-absent: no calibrated must-catch/must-pass set |
| OPERON-LLM-015 Reviewer Performance | judge architecture only | Blocking-absent: no calibrated must-catch/must-pass set |
| OPERON-LLM-016 Ship Check | judge architecture only | Blocking-absent: no calibrated must-catch/must-pass set |
| OPERON-LLM-017 SRE Incident | incident/quarantine deterministic seeds | Blocking-absent: no classification floor |
| OPERON-LLM-018 SRE Health | observer truthfulness seed | Blocking-absent: no false-healthy floor |
| OPERON-LLM-019 Support Digest | logical inventory only | Blocking-absent: no factuality/edit-distance floor |
| OPERON-LLM-020 Marketing Release | logical inventory only | Blocking-absent: no release-grounded quality floor |
| OPERON-LLM-021 Marketing CI/Adoption Sweep | logical inventory only | Blocking-absent: no factuality/usefulness floor |
| OPERON-LLM-022 Learning Distiller | raw-candidate authority isolation | Blocking-absent: no candidate-quality/efficacy floor |
| OPERON-LLM-023 Learning Reviewer | learning authority and judge architecture | Blocking-absent: no calibrated must-catch/must-pass set |

## Operational and evidence traceability

| Obligation | Evidence | Verdict / limitation |
| --- | --- | --- |
| Stateful controlled seams | `controlled-seams.test.ts` and production-composition specs | Passing local slice |
| Negative controls / seeded mutations | policy mutations, turn-result negatives, L4 failure deposits | Passing |
| Provider reservation and settlement | campaign-budget tests and every L4 ledger | Passing bounded slices |
| No progress / child timeout / runaway | no-progress and resource-runaway specs | Passing local slice |
| Crash/ambiguity/duplicate effect | recovery and effect-reconciliation specs | Passing local slice |
| Retention and accelerated operations | retention-recovery plus 90-day accelerated artifact | Passing accelerated slice; not real-time proof |
| Real Layer-3 target | live-driver fail-closed preflight only | Blocking-absent |
| 72-hour production-shaped soak | no authorized host/owner/window | Blocking-absent |
| Additive CI | policy explicitly says `not_authorized` | Blocking-absent |
| Threat review | first-pass agent STRIDE register | Blocking-absent owner review and residual-risk disposition |
| Output confinement | generated-output-confinement lane | Passing |
| Incumbent/production preservation | repository status plus protected-root policy | Passing for this campaign |

## Terminal conclusion

The trace is complete enough to show why the product is not qualified:
72/74 local assertions pass, but TM-002 and TM-011 are red; Layer 3, real-time
Layer 5, additive CI, comprehensive expansion, owner threat review, and most
LLM quality/judge floors remain absent; and the only repeated real LLM call
site remains unqualified. No waiver or accepted residual risk exists.

