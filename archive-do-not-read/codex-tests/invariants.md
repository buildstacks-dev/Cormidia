# Operon product invariants

Status: **Phase 2 plus Phase-6 backflow ratified — 2026-07-29**

Last updated: 2026-07-29

## Scope and acceptance rule

These are product-level, cross-cutting invariants for production Operon at C3.
They deliberately avoid restating the internal contracts of every module.
Later module passes may tighten them but may not weaken them.

Each invariant:

- is phrased as a property a deterministic check can falsify;
- names whether runtime enforcement is required;
- records adversarial seed cases rather than a full case catalog; and
- marks its provenance as `[stated]`, `[doc]`, or `[PROPOSED]`.

`Both` means a fail-closed runtime guardrail plus deterministic tests of that
guardrail. Model or provider goodwill is never the enforcement mechanism.

The human ratified this set on 2026-07-29.

## Ratified summary

| ID | Short name | Invariant | Provenance | Enforcement |
| --- | --- | --- | --- | --- |
| OPERON-INV-001 | Work identity and lineage | Admitted organizational work always has one immutable org, one declared work scope, and durable causal lineage. | `[stated][doc][PROPOSED]` | Both |
| OPERON-INV-002 | Authority and tenant confinement | Work can observe or affect only resources authorized by its recorded org/app scope; cross-org is never implicit. | `[doc][PROPOSED]` | Both |
| OPERON-INV-003 | Capability-truthful execution | A dependency-requiring step never starts or resumes on a known-missing, incompatible, or unqualified capability, and dependency failure never becomes success. | `[stated][doc]` | Both |
| OPERON-INV-004 | One workflow authority | Every delivery action is authorized by one accepted EpisodePlan version whose completed history cannot be silently rewritten. | `[stated][doc]` | Both |
| OPERON-INV-005 | Bounded and exact resource use | Provider work is reserved before execution, settled exactly once, and cannot silently continue past a hard ceiling or unknown usage. | `[stated][doc]` | Both |
| OPERON-INV-006 | Specific human authorization | No consequential action executes without valid content-bound authority for that exact action, payload, scope, and context. | `[stated][doc]` | Both |
| OPERON-INV-007 | Informed escalation | No escalation can mint or widen authority unless its decision packet exposes the material decision in human-usable terms and is bound to the action. | `[stated][PROPOSED]` | Both |
| OPERON-INV-008 | Truthful external effects | Every consequential effect has one authoritative lifecycle and stable identity; ambiguity is never guessed or blindly retried. | `[doc][PROPOSED]` | Both |
| OPERON-INV-009 | Evidence-backed claims | Operon never claims ready, complete, shipped, or successful without the authoritative evidence required by the accepted plan and product profile. | `[stated][doc]` | Both |
| OPERON-INV-010 | Truth-preserving recovery | Restart preserves accepted truth, resumes only a legal next action, and neither repeats still-valid work nor invents terminal outcomes. | `[stated][doc]` | Both |
| OPERON-INV-011 | Governed learning activation | Raw observations and candidates cannot affect active future context without the required provenance and governance; no-learning is a valid episode outcome. | `[stated][doc]` | Both |
| OPERON-INV-012 | Critical-risk quarantine | A deterministically detected unresolved critical safety incident blocks new provider, tool, and effect actions in the smallest safe scope until attributable resolution. | `[stated][PROPOSED]` | Both |

## Invariant details and adversarial seeds

### OPERON-INV-001 — Work identity and lineage

**Invariant.** Once work is admitted as organizational work, every
persisted task, episode, plan, execution step, effect, settlement, and learning
artifact is attributable to exactly one organization and one declared work
scope—one product app or an explicit org-internal scope—and its causal lineage
cannot silently change.

**Derivation.** `[stated]` Every executing task must be traceable to an app and
an org, with a representation for organizational work. `[doc]` Episodes, child
steps, settlements, and learning evidence already rely on joined identities.
`[PROPOSED]` An explicit `org-internal` scope is the neutral invariant shape;
whether it is represented by a synthetic app such as `org-learning` is not
decided here.

**Adversarial seed cases.**

- Persist or admit a task with an org but neither app nor org-internal scope.
- Create a child episode whose parent-task identity is missing or belongs to a
  different org.
- Resume an episode after the active-org pointer changes and observe any
  identity being rebound to the newly active org.
- Attach a settlement or learning event to a different episode/app than the
  execution that produced it.

### OPERON-INV-002 — Authority and tenant confinement

**Invariant.** An admitted operation may read, mutate, authorize,
charge, publish, or activate learning only within its recorded effective
org/app authority. Cross-org access is never implicit; cross-app access
requires explicit org-level authority and retains source and destination
provenance. Missing or mismatched authority fails closed.

**Derivation.** `[doc]` Operon separates installed package, committed org home,
per-org state home, app repository, and app authority. `[PROPOSED]` The
cross-cutting invariant makes that separation a product property rather than a
filesystem convention.

**Adversarial seed cases.**

- Run two org-scoped schedulers while changing the interactive active-org
  pointer; neither may consume or write the other's work.
- Supply an app path, approval, lock, or secret belonging to another org.
- Attempt cross-app learning activation without recorded org-level authority
  and source/destination lineage.
- Reuse an identifier from org A inside org B and verify that lookup does not
  alias the first record.

### OPERON-INV-003 — Capability-truthful execution

**Invariant.** Operon must not construct, start, or resume a step
that depends on a harness, model, tool, GitHub, authentication, or other
declared capability while current bounded evidence says the requirement is
missing, incompatible, unavailable, or unqualified. Loss or uncertainty
detected after start produces a truthful failed, blocked, interrupted, or
ambiguous outcome with a recovery action—never fallback or success.

**Derivation.** `[stated]` Operon must understand the actual environment during
onboarding and operation and adapt defaults to what is usable. `[doc]`
readiness probes, atomic harness/model/effort assignment, capability
qualification, and fail-closed admission already define much of this shape.
The `doctor` command is one observation adapter, not the invariant itself.

**Adversarial seed cases.**

- Configure an installed harness with missing authentication or an unavailable
  model and attempt onboarding, admission, and resume.
- Feed a stale successful health observation after the selected capability has
  become unavailable.
- Let GitHub time out after accepting or possibly accepting an operation;
  verify that Operon does not report success or blindly repeat it.
- Make an adaptive assignment select a locally available but unqualified or
  app-disallowed candidate.

### OPERON-INV-004 — One workflow authority

**Invariant.** Before the first delivery action, an episode has one
validated, durable, accepted EpisodePlan version. Every execution step,
assignment, dependency, gate, approval requirement, ceiling, and revision is
authorized by exactly one plan version; execution follows legal dependency
transitions, and completed history cannot be mutated or silently bypassed.

**Derivation.** `[stated]` decomposition and EpisodePlanner choose the directed
graph. `[doc]` the accepted EpisodePlan is the sole workflow authority, with
forward-only revisions and atomic assignments.

**Adversarial seed cases.**

- Start delivery before the accepted plan is durably recorded.
- Execute a step whose dependencies are incomplete or that is unreachable in
  the accepted DAG.
- Change only the harness, model, or effort member of a persisted assignment
  during fallback or resume.
- Revise a completed step, erase its evidence, or skip a mandatory review to
  fit a smaller route.

### OPERON-INV-005 — Bounded and exact resource use

**Invariant.** Every provider turn is admitted against an available
hard ceiling and reserved before runtime construction, then joins to exactly
one settlement; deterministic mechanical steps join to zero settlements.
Unknown, partial, invalid, over-ceiling, or unreconciled usage cannot be
treated as zero and blocks further provider work until an explicit,
policy-valid reassessment.

**Derivation.** `[stated]` a small outcome must not consume unbounded time and
model work. `[doc]` episode budgets, pessimistic reservations, exact
settlement, and honest cap stops provide the binary safety property. Planner
efficiency beyond these hard bounds remains a statistical quality objective.

**Adversarial seed cases.**

- Race two provider-turn reservations against the same remaining episode
  budget.
- Crash after provider use but before final settlement, then retry recovery.
- Return unavailable usage and attempt to admit another provider turn.
- Attribute provider cost to a mechanical step or settle one provider turn
  twice.

### OPERON-INV-006 — Specific human authorization

**Invariant.** No consequential or authority-widening action
executes without a valid, unexpired, unrevoked approval or standing grant
bound to the exact action, content/payload, org/app scope, actor, and execution
context. Approval is not evidence that execution happened. Any binding
mismatch or uncertainty fails closed.

**Derivation.** `[stated]` human escalation must make the actual override
decision safe and easy to decide. `[doc]` approvals bind immutable content and
remain separate from later execution.

**Adversarial seed cases.**

- Change the payload, destination, base revision, role, or app after approval.
- Attempt self-approval or use an expired, revoked, consumed, or broader grant.
- Mark an item executed merely because its decision state is approved.
- Reuse an approval for a materially different action that shares the same
  coarse classification.

### OPERON-INV-007 — Informed escalation

**Invariant.** Operon cannot mint or widen authority from a human
escalation unless the presented decision packet is deterministically bound to
the proposed action and contains the affected org/work scope, concrete operation,
reason, current governing practice, requested deviation, material
consequences, and the effect of approval or denial. Missing material context
makes the request undecidable and cannot produce a grant.

**Derivation.** `[stated]` a request such as “Do you agree with section C3 of
ticket XYZ?” is unacceptable; the human should be able to understand the
specific challenge, current practice, and proposed override without
reconstructing the task. `[PROPOSED]` The listed material fields are a first
deterministic envelope and require human confirmation. Semantic clarity inside
that envelope will require a later quality rubric; field presence alone is
not enough.

**Adversarial seed cases.**

- Present only a policy/ticket reference or opaque identifier and attempt to
  approve it.
- Omit the current practice, requested deviation, or consequence while keeping
  every field syntactically non-empty.
- Present one action to the human but bind the resulting grant to another.
- Generate fluent explanatory prose whose deterministic action facts conflict
  with the executable payload.

### OPERON-INV-008 — Truthful external effects

**Invariant.** Every consequential external effect has one stable
operation identity and one authoritative lifecycle record. `executed` requires
authoritative acknowledgement of that exact effect; `failed` and `ambiguous`
remain distinct. An ambiguous attempt is never guessed successful, guessed
failed, or blindly retried, and replay either completes/no-ops by identity or
requires explicit reconciliation.

**Derivation.** `[doc]` approval execution distinguishes decision from effect,
uses typed terminal states, and refuses blind retries. `[PROPOSED]` This is
generalized from releases and learning publication to every product-specific
deployment/publication effect.

**Adversarial seed cases.**

- Crash after a remote publish succeeds but before the local acknowledgement
  is durable, then restart.
- Return a transport timeout with unknown remote outcome and automatically
  retry using a new identity.
- Record `executed` without the configured publication/deployment
  acknowledgement.
- Apply an illegal lifecycle transition such as `approved → executed` without
  a recorded attempt.

### OPERON-INV-009 — Evidence-backed claims

**Invariant.** Operon cannot claim an app, task, episode, step, or
effect is ready, complete, shipped, successful, or autonomously healthy unless
the authoritative evidence required by its accepted plan and product profile
exists, is current, and agrees. Model or agent self-report is advisory and
cannot satisfy a mechanical gate or terminal claim.

**Derivation.** `[stated]` GitHub and local durable evidence support truthful
operation and recovery, including non-software verification and publication.
`[doc]` readiness is an evidence ladder; missing evidence cannot produce
`ready`; terminal work and learning metrics exclude agent prose as authority.

**Adversarial seed cases.**

- Let an agent say “done” while a mandatory reviewer, gate, lab result, or
  publication acknowledgement is missing.
- Supply contradictory GitHub and local terminal states and request a success
  projection.
- Treat missing or corrupt evidence as zero failures or as a healthy empty
  window.
- Claim autonomous scheduling from configuration presence without attributable
  tick evidence.

### OPERON-INV-010 — Truth-preserving recovery

**Invariant.** After interruption, crash, timeout, stale lock, or
restart, Operon reconstructs accepted facts from their named authorities,
preserves plan versions, assignments, artifacts, decisions, and settlements,
and resumes only the deterministic next legal action. It never repeats
still-valid productive work without durable invalidation, silently moves work
to another org/app, or invents a terminal outcome while liveness or an
external effect remains uncertain.

**Derivation.** `[stated]` restart must recover from GitHub and local folders.
`[doc]` accepted artifacts survive terminal interruptions, journals reconcile
without guessing live work terminal, and plan revision is forward-only.

**Adversarial seed cases.**

- Interrupt at every durable-write boundary around planning, provider
  execution, settlement, approval, and publication.
- Restart while the original process is still alive and verify that its
  journal is not guessed terminal.
- Recover with GitHub ahead of local state, and then with local state ahead of
  GitHub.
- Switch the active org before recovery and verify that explicit episode scope
  wins.

### OPERON-INV-011 — Governed learning activation

**Invariant.** Raw observations, agent notes, self-reports, and
candidate learnings have no authority over active future context. Activation
requires the applicable provenance, independent review, experiment or
evidence, human approval, content-bound deterministic publication, versioned
lineage, and rollback path. An episode may legitimately produce no learning;
the system must not fabricate a candidate or a healthy-learning claim from an
empty or ineligible episode.

**Derivation.** `[stated]` learning is important but not mandatory per episode,
and the macro view matters more than forced micro-learnings. `[doc]`
candidates are separated from active bundles, self-report is advisory,
activation is governed, and missing learning evidence is not silently green.

**Adversarial seed cases.**

- Write an agent note or candidate and make it resolvable as active context
  without publication.
- Promote based only on agent self-report or without independent review and
  required experiment evidence.
- Change approved candidate bytes, destination, or base version before
  publishing.
- Feed an eligible episode with no actionable learning and verify that no
  fabricated candidate or false healthy-governance claim appears.

## Human statements retained outside the invariant set

These concerns are not discarded; they need a different validation artifact:

| Human concern | Why it is not itself an invariant | Later home |
| --- | --- | --- |
| Operon should issue `doctor` or otherwise remain aware of its environment. | A command and a monitoring behavior are interfaces/capabilities. The invariant is truthful admission and recovery from capability loss. | Boundary contracts, capability checks, journey acceptance criteria |
| Decomposition and EpisodePlanner should solve small tasks proportionally rather than spending 24 hours. | “Efficient” is a distributional quality judgment. Hard ceilings are invariant; plan quality and proportionality are statistical. | LLM call-site trajectory eval, risk allocation, SLOs |
| The backlog should always be prioritized for `X` tasks. | `X`, eligibility, tie-breaking, refresh cadence, and behavior when fewer tasks exist are not yet defined. | Product-truth finding, scheduler/planning contract |
| There should always be a macro view. | This is a periodic synthesis/review capability until its required inputs, outputs, cadence, and authority are defined. | PTF-004, journey acceptance criteria, learning eval |
| Human escalation should be effortless and understandable. | Material decision facts and binding can be deterministic; actual comprehensibility is a quality property. | OPERON-INV-006/007 plus escalation-quality golden set and rubric |

## Phase-2 ratification record

The human reviewed the complete artifact and confirmed on 2026-07-29 that the
validation-design campaign is ready to proceed to boundaries. This ratifies:

1. all eleven product-level invariants;
2. their fail-closed runtime-guardrail plus deterministic-test enforcement;
3. the minimum material envelope proposed for human escalation; and
4. retention of unresolved policy choices as explicit findings rather than
   fabricated invariant semantics.

If boundary or contract work later contradicts an invariant, Phase 2 must be
explicitly reopened and the revision recorded rather than patched silently.

## Phase-6 ratified backflow amendment

Risk elicitation exposed a containment property not fully represented by
OPERON-INV-003/004/006. It was returned to the human through explicit
backflow and ratified on 2026-07-29.

### OPERON-INV-012 — Critical-risk quarantine

**Status:** Ratified on 2026-07-29.

**Invariant.** Once an unresolved critical safety incident is
deterministically detected, Operon starts no new provider, tool, or effect
action in the smallest safely containable scope. If the affected scope or
shared authority cannot be trusted, containment expands to the organization.
Read-only forensics, evidence preservation, deterministic reconciliation, and
explicitly authorized harm-reduction actions may continue. Resume requires an
attributable resolution decision.

**Derivation.** `[stated]` A critical risk should pause the affected project
and make the human decision clear. `[PROPOSED]` Smallest-safe-scope containment
reconciles this with the ratified rule that an ordinary pending approval blocks
only dependent work.

**Enforcement:** Both.

**Adversarial seed cases.**

- Detect an authorized-root escape attempt and allow another mutating turn in
  the same affected app.
- Detect a compromised shared authority/configuration source but quarantine
  only one episode.
- While quarantined, block read-only forensics or allow an ordinary builder
  turn disguised as remediation.
- Resume because the alert disappeared without an attributable resolution
  decision.
