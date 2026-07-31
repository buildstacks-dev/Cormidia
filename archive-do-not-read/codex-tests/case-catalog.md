# Operon validation case catalog

Status: **Phase-8 ratified; local controlled-foundation cases implemented;
two production defects detected;
one Layer-4 corpus frozen; full walking-skeleton and general expansion gates
remain closed**

Last updated: 2026-07-30

## 1. Purpose and expansion gate

This catalog is derived from the ratified system map, invariants, boundaries,
contracts, LLM plan, and risk policy. The six local walking-skeleton cases are
implemented, but this is intentionally not a comprehensive catalog.

The catalog may expand only after the walking skeleton proves the complete
feedback path:

1. the isolated policy and test package load fail-closed;
2. at least one Layer-1 detector is observed both passing and failing;
3. a real Layer-2 composition journey covers a controlled boundary failure;
4. one separately authorized Layer-3 disposable-target smoke deposits bounded
   evidence;
5. the Layer-4 runner correctly aggregates repeated attempts and blocks on a
   missing or failed threshold;
6. one Layer-5 accelerated operational scenario produces bounded telemetry;
7. the same commands run through a separately authorized additive CI lane; and
8. every generated file remains beneath `codex-tests/.artifacts/`.

Until then, additions are limited to defects discovered while building the
skeleton, product-truth findings that must be returned to the human, and an
exact separately ratified content-bound slice such as `OPERON-L4-001`.

## 2. Case-family record

Every expanded family must record:

- stable ID and lifecycle status;
- source journey, invariant, boundary, contract, interface, LLM site, or
  operational-obligation IDs;
- risk rating and cheapest trustworthy primary layer;
- exact oracle, including what cannot count as proof;
- controlled variables and any retained live obligation;
- expected refusal, interruption, recovery, and replay behavior;
- product-truth or architecture findings that block an expected outcome; and
- the detector deposited when a higher-layer run exposes a deterministic
  defect.

An interface adapter may add conformance cases, but it does not receive a
duplicate copy of the underlying behavioral family.

## 3. Seeded family registry

| Family | Concern | Risk | Primary layer | Oracle | Source IDs | State |
| --- | --- | --- | --- | --- | --- | --- |
| OPERON-CF-001 | Org/app identity, authority, and path confinement | Critical | L1–L2 | No read, write, approval, secret, cost, or effect can bind outside the immutable admitted org/work scope; invalid scope fails before execution | J-02, J-07, J-09; INV-001–002; BND-002–003, BND-008 | Seeded |
| OPERON-CF-002 | Uniform provider contract and capability-truthful admission | Critical | L1–L2 | Every admitted harness/model/effort assignment normalizes to the same versioned result contract; known missing, incompatible, unavailable, unqualified, or over-budget capability cannot start | J-03, J-06–09; INV-003, INV-005, INV-009; BND-007; LLM-001–023 | Walking-skeleton seed |
| OPERON-CF-003 | Budget conservation and runaway termination | Critical | L1–L2, L5 | Provider work is reserved before use, settles exactly once, and stops or quarantines on ceilings, unknown usage, hangs, or no-progress loops without requiring real token burn | J-06–09; INV-005, INV-010, INV-012; BND-004, BND-007–008 | Walking-skeleton seed |
| OPERON-CF-004 | Accepted-plan authority and legal DAG transitions | Critical | L1–L2 | No delivery step precedes a durable accepted plan, bypasses dependencies/gates, mutates completed history, or silently substitutes an assignment | J-05–07, J-09; INV-004; BND-003–007 | Seeded |
| OPERON-CF-005 | Human decision binding and consequential-effect lifecycle | Critical | L1–L3 | Approval is bound to the exact action but is never execution evidence; replay is idempotent or remains explicitly ambiguous and never retries blindly | J-08–09; INV-006–008, INV-012; BND-006, BND-011 | Seeded; live target pending AF-010 |
| OPERON-CF-006 | Crash, restart, and source-of-truth reconciliation | Critical | L2–L3, L5 | Accepted artifacts survive; recovery resumes only a legal next action and does not invent terminal state, cross scope, repeat valid work, cost, or effects | J-09; INV-008–010; BND-004–005, BND-009–011 | Walking-skeleton seed; full precedence matrix pending AF-006 |
| OPERON-CF-007 | Untrusted intake, prompt injection, and incident quarantine | Critical | L1–L2, L4–L5 | Untrusted content cannot widen tool authority or become executable instructions; a deterministically detected critical incident quarantines the smallest safe scope | J-04, J-06–07, J-11; INV-002–004, INV-011–012; BND-008, BND-012, BND-014; LLM-008–009, LLM-014, LLM-023 | Seeded; classifier lifecycle pending AF-014 |
| OPERON-CF-008 | Evidence-backed quality and independent oracle | Critical/High | L1–L2, L4 | Agent self-report cannot satisfy acceptance; contract-valid output must also meet call-site and final-artifact quality floors, with judge calibration where applicable | J-03, J-05–07, J-13; INV-009; BND-007, BND-010; LLM-001–023 | Episode Planner slice ratified; all other thresholds pending PTF-015 |
| OPERON-CF-009 | Governed learning activation and rollback | Critical | L1–L2, L4 | Raw or injected observations never enter active context; activation has provenance, independent review, exact content binding, authorization, versioned lineage, and rollback | J-11–12; INV-011; BND-012; LLM-022–023 | Seeded |
| OPERON-CF-010 | Read-only, truthful, recoverable observation | High with critical overrides | L1–L2 | Rendering cannot mutate workflow state and exposes freshness, missing evidence, conflicts, degradation, scope, and redaction truthfully | J-10; INV-001–003, INV-009–010; BND-013 | Seeded |
| OPERON-CF-011 | Package and platform supply-chain separation | Critical | L1–L3, L5 | Installed binary/skill identity is verifiable and compatible; platform release authority/eval state never enters an operated org | J-01, J-09; INV-001–003, INV-009–011; BND-001, BND-015–016 | Seeded; update/rollback outcome pending PTF-005 |
| OPERON-CF-012 | Autonomous contention, soak, and disaster recovery | Critical | L5 | Leases, budgets, approvals, fanout, scheduler decisions, journals, retention, and recovery remain bounded and truthful across 90 accelerated days and 72 production-shaped hours | J-04, J-07–12; INV-001–012; BND-002, BND-004–013 | Walking-skeleton operational seed |

`INV-*`, `BND-*`, and `LLM-*` above abbreviate the corresponding
`OPERON-INV-*`, `OPERON-BND-*`, and `OPERON-LLM-*` namespaces.

## 4. Walking-skeleton case records

These are the implemented local controlled-foundation cases. Their passing
result does not satisfy the separately authorized Layer-3, threshold-bearing
statistical Layer-4, real-time Layer-5, or additive-CI obligations.

### OPERON-CASE-WS-001 — Reject an unavailable provider assignment

- **Implementation:** passing local detector
- **Family:** OPERON-CF-002
- **Layer:** 1
- **Risk:** Critical
- **Given:** a structurally valid turn request whose atomic assignment is
  known unavailable or unqualified by the controlled capability probe
- **When:** provider admission is evaluated
- **Then:** runtime construction is not invoked; the result is a typed
  blocked/refused outcome with the exact assignment and reason
- **Oracle:** provider simulator invocation count is zero and no reservation
  or success evidence exists
- **Sources:** INV-003, INV-005, BND-007

### OPERON-CASE-WS-002 — Preserve ambiguity after possible provider acceptance

- **Implementation:** passing local composition detector
- **Family:** OPERON-CF-002, OPERON-CF-003
- **Layer:** 2
- **Risk:** Critical
- **Given:** a valid admitted provider turn with a stable operation identity
  and reserved budget
- **When:** the stateful provider simulator records possible acceptance and
  then returns a transport timeout with unknown usage
- **Then:** Operon records an ambiguous/interrupted result, does not report
  success, does not treat usage as zero, and admits no blind fresh turn
- **Oracle:** durable state, operation identity, simulator history, and
  reservation/settlement records agree
- **Sources:** INV-003, INV-005, INV-008–010; BND-004, BND-007

### OPERON-CASE-WS-003 — Restart without repeating uncertain work

- **Implementation:** passing local recovery-decision detector
- **Family:** OPERON-CF-006
- **Layer:** 2 journey
- **Risk:** Critical
- **Given:** the durable state produced by OPERON-CASE-WS-002
- **When:** a new orchestrator process reconstructs J-09
- **Then:** it preserves the original scope, assignment, operation identity,
  artifacts, and ambiguity; it selects only a contractually legal
  reconciliation action. A resumable turn retains the same content-bound
  native session rather than becoming a clean logical retry.
- **Oracle:** the recovery decision itself makes no provider call and creates
  no second logical turn, reservation, or settlement; any later continuation
  must use the same validated session and remain separately accounted. There
  is no active-org rebinding or invented terminal claim.
- **Sources:** J-09; INV-001, INV-005, INV-008–010; BND-002, BND-004,
  BND-007
- **Limit:** cases requiring a complete cross-store fact-precedence answer
  remain blocked by AF-006

### OPERON-CASE-WS-004 — Sandbox preflight refuses an unnamed or unbounded target

- **Implementation:** passing driver self-test; no live target contacted
- **Family:** OPERON-CF-005, OPERON-CF-011
- **Layer:** 3 driver contract
- **Risk:** Critical
- **Given:** a live-sandbox invocation without a named disposable target,
  target-identity proof, explicit authorization, or enforced spend bound
- **When:** the sandbox driver preflights
- **Then:** it exits before any network, GitHub, scheduler, package, provider,
  or publication mutation
- **Oracle:** typed refusal plus zero external-operation records
- **Sources:** BND-005, BND-007, BND-009–011, BND-015; AF-010
- **Limit:** the first real sandbox smoke remains separately authorized

### OPERON-CASE-WS-005 — Eval aggregation fails closed

- **Implementation:** passing static runner and budget tests; exact Episode
  Planner campaign executed through the production call site and stopped on a
  deterministic contract failure after 9 attempts
- **Family:** OPERON-CF-008
- **Layer:** 4 runner contract
- **Risk:** Critical
- **Given:** a small committed scorer fixture containing repeated attempt
  records with one contract failure, one quality failure, and one missing
  threshold
- **When:** the qualification runner aggregates results
- **Then:** contract failure cannot be averaged away, the missing threshold is
  `blocking-absent`, and no qualification claim is emitted
- **Oracle:** deterministic aggregate JSON and non-zero blocking verdict
- **Sources:** LLM evaluation plan §§3–4, 8, 11–12; PTF-015
- **Limit:** `OPERON-L4-001` contacted the provider, failed, and issued no
  qualification. It cannot be silently rerun or edited into a pass.

### OPERON-L4-001 — Frozen Episode Planner quality campaign

- **Implementation:** exact policy, corpus, scorer, production-call-site
  driver, evidence schema, and spend enforcement implemented; non-spending
  preflight completed
- **Family:** OPERON-CF-003, OPERON-CF-004, OPERON-CF-008
- **Layer:** 4
- **Risk:** Critical/high
- **Cases:** `OPERON-EP-001` through `OPERON-EP-010`, with
  `OPERON-EP-003/004/005/007/008/010` critical
- **Assignment:** `claude/claude-opus-5/xhigh`
- **Threshold:** 27/30 overall, 2/3 per case, 3/3 per critical case
- **Spend:** USD 5 per native turn; USD 60 aggregate
- **Oracle:** production EpisodePlan contract plus the frozen case-specific
  smallest/sufficient/safe/executable scorer
- **Failure:** no qualification; preserve current production assignment and
  evidence; no prompt/corpus edits merely to green
- **Current state:** stopped after 9/30 attempts. Six initial attempts passed;
  critical case `OPERON-EP-003` had one quality failure, one acceptable
  bounded repair, and one terminal contract failure after repair. Observed
  spend is USD 4.219405 with no ceiling violation.
- **Qualification limit:** the existing `TM-002` deterministic gate remains
  red, and this campaign independently failed its contract gate.

### OPERON-L4-002 — Episode Planner diagnostic and full qualification follow-up

- **Implementation:** campaign plan, hash-bound candidate overlay,
  original-evidence preflight, deterministic contract deposits, frozen-oracle
  quality deposit, exact diagnostic, full qualification, and independent
  evidence audits completed
- **Family:** OPERON-CF-003, OPERON-CF-004, OPERON-CF-008
- **Layer:** 1 contract deposits plus Layer 4 diagnostic proposal
- **Risk:** Critical/high
- **Parent evidence:** `OPERON-L4-001`, `OPERON-EP-003` repetitions 1 and 3
- **Candidate:** evaluation-only overlay on the unchanged protected prompt;
  `claude/claude-opus-5/xhigh`
- **Diagnostic result:** passed `OPERON-EP-003` × 3 with 3/3 deterministic
  contracts and 3/3 quality, one native turn each, USD 1.224494 total, no
  qualification
- **Qualification result:** completed 30/30 contract-valid attempts and scored
  29/30 overall, but critical case `OPERON-EP-004` scored 2/3 against its 3/3
  floor; USD 12.881382 observed across 32 settled provider turns; result
  `blocked_quality`, no qualification
- **Evidence finding:** the immutable ledger embedded `OPERON-L4-001` while
  enforcing the correct `OPERON-L4-002` USD 60/USD 5 limits. The audit fails
  clean attribution; `OPERON-L4-002-DET-003` makes campaign identity explicit
  and regression-protected.
- **Authorization state:** diagnostic and full-qualification executions
  consumed. Protected-prompt adoption, production assignment changes, rerun,
  and any new candidate remain unauthorized.
- **Failure:** preserve evidence and current assignment; any candidate change
  after diagnostic creates another campaign version.
- **Independence limit:** audit is I1 role-separated same-agent verification,
  not C3 organizational independence.

### OPERON-L4-003 — Minimal-gate Episode Planner follow-up

- **Implementation:** versioned evaluation-only overlay, exact delegated
  diagnostic authorization, hash-bound preflight, and runner guard prepared
- **Family:** OPERON-CF-003, OPERON-CF-004, OPERON-CF-008
- **Layer:** Layer 4 diagnostic with a frozen-oracle detector
- **Risk:** Critical/high
- **Parent evidence:** `OPERON-L4-002`, `OPERON-EP-004` repetition 1
- **Candidate:** preserves all `OPERON-L4-002` strict-JSON and
  security-specific rules, and states that lifecycle names do not authorize
  unrequested mechanical gates
- **Diagnostic:** `OPERON-EP-004` × 3, 3/3 contracts and 3/3 quality required,
  USD 10 aggregate and USD 5 per native turn
- **Diagnostic result:** model attempts passed 3/3; an append-only audit
  corrected the original aggregator's stale L4-002/EP003 identity assumption
- **Full-stage result:** stopped after 9/30 on an EP003-r3 deterministic
  contract failure; bounded repair omitted the required `gate` discriminator;
  USD 3.838934 across 10 settled turns, audit passed, no qualification
- **Authorization state:** diagnostic and full-stage authorizations consumed;
  rerun prohibited
- **Failure:** no qualification, preserve evidence and production assignment,
  and never edit the frozen corpus or same candidate to green

### OPERON-L4-004 — Repair field-preservation follow-up

- **Implementation:** versioned evaluation-only overlay, hash-bound parent
  failure evidence, delegated diagnostic/full-stage authorization, fail-closed
  preparation guard, execution, and independent audits completed
- **Family:** OPERON-CF-003, OPERON-CF-004, OPERON-CF-008
- **Layer:** Layer 1 failure deposit plus Layer 4 diagnostic
- **Risk:** Critical/high
- **Parent evidence:** `OPERON-L4-003`, `OPERON-EP-003-r3`
- **Candidate:** preserves the prior strict-JSON, operation-specific, and
  minimal-gate rules while explicitly requiring every mechanical gate to
  retain its `gate` discriminator during repair
- **Diagnostic result:** `OPERON-EP-003` × 3 passed 3/3 contracts and 3/3
  quality for USD 1.398425 across four settled turns; audit passed
- **Full-stage result:** stopped after 10/30 on an EP004-r1 deterministic
  contract failure; bounded repair changed `supersedes: null` into illegal
  initial-plan self-supersession; USD 4.235953 across 11 settled turns, audit
  passed, no qualification
- **Detector:** `OPERON-L4-004-DET-001` rejects any initial-plan supersession
  at the production semantic seam
- **Authorization state:** diagnostic and full-stage authorizations consumed;
  no production prompt or assignment authority

### OPERON-L4-005 — Optional-member deletion follow-up

- **Implementation:** versioned evaluation-only overlay, hash-bound L4-004
  terminal evidence, delegated EP004 diagnostic/full stage, and independent
  audits completed
- **Family:** OPERON-CF-003, OPERON-CF-004, OPERON-CF-008
- **Layer:** Layer 1 existing failure deposits plus Layer 4 diagnostic and
  qualification
- **Risk:** Critical/high
- **Parent evidence:** `OPERON-L4-004`, `OPERON-EP-004-r1`
- **Candidate:** preserves all prior rules and explicitly requires repair to
  delete invalid optional `assignment`/`supersedes` members instead of
  fabricating values or step history
- **Diagnostic result:** `OPERON-EP-004` × 3 passed 3/3 contracts and 3/3
  quality in three settled turns for USD 1.316712; audit passed
- **Full-stage result:** stopped after 7/30 on EP003-r1. The initial output
  emitted JavaScript `undefined`; repair replaced it with illegal
  self-supersession despite the explicit deletion rule. USD 3.183568 settled
  across nine turns; audit passed; no qualification
- **Detector disposition:** no duplicate detector added.
  `OPERON-L4-002-DET-001B` already rejects JavaScript `undefined`, and
  `OPERON-L4-004-DET-001` already rejects initial-plan self-supersession
- **Decision:** treat the repeated critical-case regression as legitimate
  candidate instability, preserve evidence, and do not spend on another
  prompt-chasing campaign without a materially different candidate/design

### OPERON-CASE-WS-006 — Accelerated autonomous recovery stays bounded

- **Implementation:** passing 90-day accelerated production
  scheduler/evidence/recovery composition plus a separate harness-only seam
  model; not real-time or external production evidence
- **Family:** OPERON-CF-003, OPERON-CF-012
- **Layer:** 5 accelerated skeleton
- **Risk:** Critical
- **Given:** one isolated org/home, production virtual scheduler/evidence
  stores, controlled provider execution, a fake clock, blocked approval
  branches, and independent ready work
- **When:** the driver advances across sleep/wake, missed ticks, duplicate
  delivery, provider partial usage, and retention boundaries
- **Then:** no global approval stall, duplicate effect, unbounded journal
  growth, lost settlement, or false health claim occurs
- **Oracle:** 2,160 due windows, exact provider settlement, four reconstructed
  process restarts, zero duplicate episodes/orphans/leakage/unapproved outward
  effects, terminal integrity, and attributable evidence hash
- **Sources:** INV-001, INV-005, INV-008–010, INV-012; BND-004–007,
  BND-013; Layer-5 autonomous-soak policy
- **Limit:** this proves accelerated behavior only; it does not replace the
  ratified 72-hour production-shaped obligation

### OPERON-CASE-DET-001 — Masked runtime context cannot follow a repository symlink

- **Implementation:** blocking production-conformance detector; currently red
- **Family:** OPERON-CF-001, OPERON-CF-007
- **Layer:** 2 production composition
- **Risk:** Critical
- **Given:** an otherwise isolated worktree containing a repository-controlled
  `.pi` symlink to a directory outside that worktree
- **When:** the production Pi context writer materializes
  `.pi/APPEND_SYSTEM.md` before a turn
- **Then:** the operation must refuse before writing authority-bearing context
  outside the worktree
- **Oracle:** refusal is observed and the symlink destination contains no
  `APPEND_SYSTEM.md`
- **Sources:** INV-002–003; BND-002, BND-007; threat surface
  `tool_authority_and_filesystem_path_escape`
- **Finding:** current production composition follows the symlink and writes
  outside the worktree. The harness remains red; production was not modified.
  Tracked by [GitHub issue #198](https://github.com/buildstacks-dev/Operon/issues/198);
  the human retained Pi.

### OPERON-CASE-DET-002 — Raw learning candidates carry no active-context authority

- **Implementation:** passing production-composition detector
- **Family:** OPERON-CF-007, OPERON-CF-009
- **Layer:** 2
- **Risk:** Critical
- **Given:** agent-writable candidate content that claims active status and
  attempts to widen tool authority
- **When:** the production learning resolver assembles context
- **Then:** candidate-tree bytes do not appear in active context
- **Oracle:** zero resolved candidate IDs, sections, and bytes
- **Sources:** INV-002, INV-011; BND-012; TM-009
- **Limit:** the full governed publish/activation/replay matrix remains
  post-skeleton expansion work

### OPERON-CASE-DET-003 — Platform validation authority stays outside org runtime context

- **Implementation:** passing package/context detector
- **Family:** OPERON-CF-011
- **Layer:** 1–2
- **Risk:** Critical
- **Given:** the root package allowlist and packaged runtime prompt/config
  surfaces
- **When:** platform/org control-plane separation is inspected
- **Then:** `codex-tests`, incumbent `test`/`eval`, developer instructions, and
  campaign authorization markers are absent from the installable authority
  surface
- **Oracle:** package allowlist exclusions plus recursive runtime-context marker
  scan
- **Sources:** INV-002, INV-006, INV-011; BND-016; TM-010
- **Limit:** exact release currency/rollback remains PTF-014 and real package
  publication remains separately authorized

### OPERON-CASE-DET-004 — One approval identity has one authoritative decision under contention

- **Implementation:** blocking production-conformance detector; currently red
- **Family:** OPERON-CF-005, OPERON-CF-012
- **Layer:** 2
- **Risk:** Critical
- **Given:** concurrent approved and denied decisions for the same pending,
  content-bound approval item
- **When:** the production approval store persists both attempts
- **Then:** exactly one caller succeeds, exactly one decision event exists,
  and grant bytes agree with the one authoritative item
- **Oracle:** caller results, decided record, decision log, and grant directory
  agree on the same decision
- **Sources:** INV-006–008; BND-006; TM-011
- **Finding:** the losing path can still append a second decision and its side
  effects; observed authoritative state disagrees with the fulfilled caller.
  Production was not modified. Tracked by
  [GitHub issue #199](https://github.com/buildstacks-dev/Operon/issues/199).

### OPERON-CASE-OPS-001 — No-progress and non-ending subprocess work terminate

- **Implementation:** passing production-composition detector with a changed-
  failure near-miss
- **Family:** OPERON-CF-003, OPERON-CF-012
- **Layer:** 2 and accelerated Layer 5
- **Risk:** Critical
- **Oracle:** an identical evidenced gate failure becomes blocked before the
  retry cap, a materially changed failure remains retryable, and a non-ending
  child is killed with typed timeout evidence
- **Sources:** INV-003, INV-005, INV-009–010; BND-008

### OPERON-CASE-OPS-002 — Observer loss rebuilds without durable mutation

- **Implementation:** passing production-composition detector
- **Family:** OPERON-CF-010, OPERON-CF-012
- **Layer:** 2 and accelerated Layer 5
- **Risk:** High with critical truthfulness override
- **Oracle:** a stopped and newly constructed production observer emits the
  same fixed-time snapshot and leaves the state-home fingerprint unchanged
- **Sources:** J-10; INV-009–010; BND-013
- **Limit:** automatic supervisor ownership remains PTF-012/AF-009

## 5. Mechanical expansion queues

After the expansion gate passes, derive in this order:

1. every legal and illegal transition, replay, and crash point for critical
   state machines;
2. every credible violation path from INV-001–012;
3. timeout, partial success, retry, duplicate, stale-read, and version-skew
   families for BND-001–016, pruned by risk;
4. success, refusal, interruption, recovery, and alternate adapters for
   J-01–13;
5. valid/invalid input, typed-error, idempotency, ordering, freshness, and
   latency families from each contract;
6. the 23 deterministic LLM envelopes, then call-site golden sets and six
   judge meta-evals; and
7. threat, contention, soak, secret, and disaster-recovery obligations.

Unknown expected outcomes remain findings; they are not filled with framework
defaults.
