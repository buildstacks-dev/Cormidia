# Invariants — Cormidia (product scope)

Status: CONFIRMED at the Phase 2 gate (2026-07-31, round 3); human-ratified 2026-07-31 (ratification-package.md §9). <!-- AUD-105 -->
Namespace: `CORMIDIA-INV-NNN`. Product scope — no parent, nothing inherited.

Provenance per item: `[elicited]` = stakeholder's Phase 2 ramble (elicitation-log.md);
`[doc]` = derivable from ./docs/; `[rambling]` = ./rambling.txt (cited); `[simulated]` =
stakeholder judgment beyond docs; `[PROPOSED]` = designer-originated. Most items are
`[elicited+doc]`: spoken by the stakeholder and anchored in ratified text.

Enforcement classes: **test** (harness detects violation), **guardrail** (runtime
fail-closed enforcement; the harness then tests the *guardrail*), or **both**. Anything a
model or external system could violate at runtime carries a guardrail (skill rule 5).

Acceptance gate applied to every item: stated as something a test could violate; the
adversarial pass lists seed violation paths (each becomes catalog material in Phase 6).

Harness revision 2026-08-01: comparative execution adds no global invariant. Candidate
authority/effects are governed by INV-001/002/003; one-app and workspace coherence by
INV-004/010; candidate and judge accounting by INV-006; selection/report truth by
INV-008/012/015; durable recovery by INV-013/014. Operation-specific promises remain
contracts B-18/B-19 and J-19 acceptance criteria rather than masquerading as INV-016.

Harness revision 2026-08-07 (outcome acceptance + jobs), Phase 2:
**Jobs add no product invariant** — every falsifiable claim jobs make is already made by
INV-001/002/004/006/008/011/013/015, and two of those *tighten* for jobs (recorded at
their entries). INV-016's domain gains an explicit scope clause (F-PT-031). The
outcome-acceptance lane adds a separate, clearly-fenced family —
`CORMIDIA-INV-ACC-1…7b` at the end of this file — which constrains **the campaign**,
not the product. They are stated as invariants because a campaign that violates one
still emits a plausible score, which is the same failure class INV-008 exists for;
they are fenced because a future audit must never read a harness promise as a product
promise.

Harness revision 2026-08-03 (#184/#233/#234/#240), owner-confirmed through Phase 2:
roadmap, delivery-unit, and execution-batch identities extend INV-001/004/005/006/008/
009/014/015. New INV-016 is the one genuinely global addition: validation obligation
lineage must predate autonomous delivery and remain bound through independent review.
Cache/session optimization may reorder or co-schedule units but can never alter the
correctness or authority identities those invariants protect.

---

## CORMIDIA-INV-001 — Authority never grows by accident
`[elicited+doc: architecture §5, org/context, TASTE "never do"]`
**Statement.** The effective authority of any turn is never broader than the ratified org
grant as narrowed by app configuration. Narrower layers only narrow. No agent-writable
content — memory, prompts, plans, model output, cached context, GitHub labels, prior
approvals — can manufacture or widen permission. Where two authority sources disagree, the
most restrictive valid source governs, or the turn stops. The surfaces that define agent
authority (`AUTHORITY.md`, `TASTE.md`, `roles.yaml`, `pipelines.yaml`, `prompts/**`,
protected learning surfaces) are structurally unwritable by agents — proposal-only.
Roadmap membership, delivery-unit grouping, and execution batching cannot dilute a
member ticket's routing restriction: if any member is `routing:human-only`, the entire
unit is autonomously ineligible, and no cache-affinity or priority score can override it.
**Enforcement.** Both — the gate + context assembler enforce at runtime; tests attack the
enforcement. **Falsifying test shape.** A turn whose app config claims a wider grant than
the org; a memory bundle containing permission-granting text; an agent write landing on a
protocol surface and a subsequent turn honoring it.
**Adversarial seeds.** (a) app-config widening attempt honored; (b) injected memory/prompt
text asserting new permissions changes gate outcome; (c) label or prior approval treated
as standing authority; (d) learning publish path used to alter a role's toolset.

## CORMIDIA-INV-002 — The gate is total over critical effects
`[elicited+doc: architecture §0/§4, approvals design]`
**Statement.** Every action whose effect is critical meets the same classifier and
approval boundary before execution, regardless of route: shell nesting, encoded or
obfuscated commands, adapter-native tool formats, newly introduced provider tools, or
direct API calls. No route around the gate is an implementation detail; all three
adapters give identical guarantees.
**Enforcement.** Both — gate + adapter conformance; tests attack routes. **Falsifying
test shape.** A critical effect that executes with no gate classification event recorded.
**Adversarial seeds.** (a) deploy hidden in heredoc/base64/nested shell; (b) provider adds
a new tool type the classifier has never seen (must fail closed, not default-allow);
(c) direct GitHub mutation from a turn bypassing the tool channel; (d) the known Codex
untrusted-read bypass class (issue #20) generalized to a write.

## CORMIDIA-INV-003 — Approval is never execution; grants stay inside their ratified shape
`[elicited+doc: approvals design, PURPOSE 2026-07-18; revised 2026-08-06
harness-revision, F-PT-023 ratified on #296]`
<!-- changelog 2026-08-06 (harness-revision, F-PT-023 ratified #296): the authorization
boundary is restated from the fixed rule-name list ("critical operations require human
approval") to the ratified disposition form ("operations require the disposition their
consequence class specifies" — RULE_DISPOSITION_TIERS, src/runtime/gate.ts), and the
grant-shape enumeration gains the third ratified shape (c) objective grants (#310).
Every previously never-scopeable action keeps its strictness through the tier table:
each is human-only or un-grantable there. F-PT-014 ("outside-worktree actions" has no
rule mapping) remains OPEN and is deliberately unaffected by this revision. -->
**Statement.** At every moment, an approved item and an executed operation are distinct
durable facts. Every operation requires the disposition its consequence class specifies
(the ratified per-rule tier table `routine | budgeted | grantable | human-only |
un-grantable`, where `human-only ∪ un-grantable` is exactly the never-widenable,
never-agent-decidable boundary, and `un-grantable` — the machinery of consent:
protocol surfaces, scorecards, the approval store, the learning governance surfaces,
and the gate's own implementation — additionally admits no standing grant of any
kind). Grants have exactly three ratified shapes, and none drifts beyond its declared
scope: **(a) default — fresh, exact-content, single-use**: bound to one exact actor,
app, operation/payload, and content version; `human-only` and `un-grantable` classes
take only this shape at decision time, and for `un-grantable` classes it is the sole
covering shape that can ever exist; **(b) human-widened scoped grants (A1)**: bound to
a human-chosen app/ticket plus rule+path scope, with TTL, use-count cap, revocation,
and a per-use audit row — widening is a human act at decision time, never an agent's,
is refused for `human-only`/`un-grantable` classes, and scoped grants are
*intentionally multi-use within those bounds*; **(c) objective grants (#296 Stage 3)**:
human-created-only standing authority bound to an objective, naming `grantable`-tier
classes explicitly (never a wildcard) or one `human-only` class solely through the
§4.1 ceremony (distinct CLI verb, bounded per-class scope, optional precondition,
TTL/use caps strictly shorter than the ordinary defaults), with a cumulative spend
ceiling whose crossing refuses-and-escalates exactly once, use caps, immediate
revocation, and per-use audit rows — `un-grantable` classes are rejected at creation
and refused at use. No shape becomes unbounded or agent-widenable permission.
Self-approval and self-merge are unrepresentable at any scope. Once execution
of an approved irreversible effect starts, durable evidence always exists that it is
`executing`, `executed`, `failed`, or `ambiguous`; ambiguity is terminal-until-reconciled
and is never resolved by re-performing the effect.
**Enforcement.** Both. **Falsifying test shape.** An executed critical op with no prior
persisted decision. For **once** grants: consumed twice; changed bytes executing under
the old approval. For **scoped** grants: a use outside the rule/path or app/ticket scope;
a use after TTL expiry or revocation; a use beyond the use cap; a use with no per-use
audit row; a match honored for a `human-only`/`un-grantable` rule. For **objective**
grants: creation naming an `un-grantable` class or by an agent identity; a §4.1 grant
without a bounded scope or with TTL/cap at-or-above the ordinary defaults; a covering
use for a class the grant does not name, another app, or past
revocation/expiry/use-cap/ceiling; a debit landing after execution or crossing the
ceiling without the single escalation. Any shape: a crashed acknowledgement followed
by automatic re-execution; a tier looser than the ratified table for any rule.
**Adversarial seeds.** (a) approve → mutate payload → execute (once grant); (b) replay a
consumed **once** grant on the next tick; (b′) scoped grant exercised out-of-scope /
post-revocation / at cap+1 — each must be refused with the grant intact in audit;
(c) kill between remote effect and acknowledgement, observe next tick's behavior;
(d) attempt to represent a self-approval via the CLI effect surface; (e) forged
objective-grant file naming an un-grantable class planted in the store — refused at
use; (f) concurrent ledger debits racing the ceiling — serialized, never a lost
update, at most one escalation.

## CORMIDIA-INV-004 — One turn, one app, coherently
`[elicited+doc: PURPOSE "one turn one app", architecture §7]`
**Statement.** Every turn binds exactly one app, and all its facets agree on that
identity: plan, authority, context, memory bundles, repository, worktree, approval scope,
triggering event, run evidence, and settlement. Any mismatch stops the turn; nothing
infers which field was intended. No state, context, approval scope, or worktree content
bleeds across apps.
An execution batch is therefore app-local. Builder and Reviewer sessions remain
role/assignment-isolated, and every provider step is attributed to exactly one execution
unit even when immutable shared inputs are cached across compatible units.
**Enforcement.** Both. **Falsifying test shape.** A turn whose context contains another
app's memory; a settlement row attributed to a different app than the worktree mutated.
**Adversarial seeds.** (a) event for app A routed to a turn holding app B's worktree;
(b) memory selection pulling sibling-app bundle; (c) approval scoped to app A consumed by
app B's turn; (d) reset of app A observed from app B's clone (ties to INV-010).

## CORMIDIA-INV-005 — Execution ownership is unique, durable, stable, and membership-atomic
`[elicited+doc: PURPOSE 2026-07-18 sagas, loop design §7]`
**Statement.** Every execution unit has at most one active claim. For code work, a ticket
belongs to at most one active delivery-unit claim and claiming a multi-ticket unit is
all-or-none: no member may advance while another remains claimable elsewhere. For direct
operational work, the claim binds the exact source event/task and effect set so batching
cannot duplicate it. A claim never silently disappears while its work continues; a
crash before the first provider turn repairs the whole unit without consuming allowance;
after provider work may have happened, only the explicit re-arm/reconciliation
transaction changes it. An approval pause preserves the same unit/member/effect
identities — a pause is never a fresh claim.
**Enforcement.** Both. **Falsifying test shape.** Two turns holding one member ticket; a
partial multi-ticket claim; a unit claim record vanishing while its worktree still
advances; claim number incrementing across an approval wait.
**Adversarial seeds.** (a) two ticks racing one `op:ready` ticket; (b) kill after label
flip, before claim persist (and the reverse); (c) approval pause → resume → assert claim
identity; (d) re-arm without the transaction (must be refused).

## CORMIDIA-INV-006 — Settlement conservation
`[elicited+doc: episodes contract, README observability]`
**Statement.** Every provider turn creates exactly one settlement obligation and settles
exactly once — succeeded, failed, cancelled, malformed, or gate-stopped alike. Mechanical
steps never settle as provider turns. Unknown or unavailable usage is never rendered as
zero. The ledger is the sole durable spend fact; overlays and reports derive from it and
never replace it.
Execution-unit and batch totals are projections over those per-turn settlements:
an aggregate reservation or cache discount can never hide, duplicate, or reassign a
member unit's spend.
**Enforcement.** Both (settlement machinery + reconcile; readers guarded by tests).
**Falsifying test shape.** A provider turn with zero or two ledger rows; a mechanical step
settling; an unavailable-usage turn shown as $0 headroom.
**Adversarial seeds.** (a) kill between provider return and ledger append, then
`budget --reconcile`; (b) same providerTurnId settled twice; (c) provider returns no
usage — assert "unknown", not 0; (d) blocked-on-gate turn still settles.

## CORMIDIA-INV-007 — Paused means no new spend, decided once
`[elicited+doc: architecture §7]`
**Statement.** If either the human registry policy or the dispatcher's budget overlay
says an app is paused, no new provider work claims spend for that app. The two facts stay
separate, but exactly one authoritative admission computation joins them — callers never
reimplement "effective pause."
**Scope note.** The crash seam between overlay write and approval-item creation is
deliberately outside this invariant — F-PT-003, ratified 2026-07-31 (pause holds;
exactly one budget-exceeded item eventually), asserted by its own case family
(HB-P1), not by this invariant.
**Enforcement.** Both. **Falsifying test shape.** A provider turn claiming spend for an
app that either source marks paused; two call sites disagreeing on effective pause for
the same state.
**Adversarial seeds.** (a) registry `paused` + overlay fresh → dispatch tick; (b) overlay
pause + manual `loop --once`; (c) cap crossed mid-turn (per-turn stop) vs next-claim
admission; (d) divergent duplicated admission logic detected structurally.

## CORMIDIA-INV-008 — Evidence never outruns reality
`[elicited+doc: loop conventions, scheduler health, reporting design]` `[rambling: PR #182]`
**Statement.** No observable state claims more than its evidence: no label without its
artifact; "reviewed" only via an authorized review bound to the exact HEAD; "merged" only
for the exact candidate, base, and repository; "healthy" never from a definition file
alone; "zero" never from unavailable data; "approved" never implying executed; "live"
never implying autonomously scheduled. When sources disagree or are unavailable, the
observable state is unknown/degraded/ambiguous/needs-attention — never green by absence.
Reconciliation never erases contradictions or compresses multi-source state into a more
advanced claim than the evidence supports (there is deliberately no single ticket-status
field — see system-map §2.3).
**Jobs tightening (2026-08-07, M18).** For a job step, "completed" means the provider
returned **and** every declared output check passed. No surface may render a step
`completed` when its check failed, and a step with **no** declared outputs renders
`completed (unverified)` — never bare `completed`. The absence of a check is a visible
property, never silence. `[doc: docs/jobs/design.md §7]`
A ready-frontier entry requires the exact RoadmapPlan version, delivery-unit membership,
routing eligibility, dependency state, and validation contract it claims. Any
`planning:preplanned`-style label is only a projection of a valid creator-scope artifact;
the label, rich prose, `op:ready`, and `op:tier-*` never prove that artifact exists.
**Enforcement.** Both (readers/writers guarded; presentation tested). **Falsifying test
shape.** Any surface rendering a claim whose backing artifact is absent, stale, or
contradicted.
**Adversarial seeds.** (a) flip label with no artifact, observe every reader; (b) GitHub
unavailable → queue must not render empty; (c) usage unavailable → spend must not render
$0; (d) scheduler definition present but no tick evidence → not "healthy"; (e) contradictory
claim file vs GitHub state → reader must surface contradiction, not pick the greener.

## CORMIDIA-INV-009 — No merge escapes the reviewed boundary
`[elicited+doc: loop design §7, github-conventions]` `[rambling: default-branch scar]`
**Statement.** Every merge Cormidia performs satisfies, at merge time: the authorized
review's `commit_id` **equals the current candidate/branch HEAD at merge time** — any
commit pushed after the review invalidates the approval (ancestry alone is not freshness);
required checks are fresh for that exact candidate; the remote default branch was
resolved, never guessed; and the merge actor is the orchestrator alone. Git's ability to
recover from a bad merge never excuses a violation.
For a multi-ticket delivery unit, that one reviewed candidate is the unit's only merge
boundary: every member and every required validation obligation binds the same PR and
HEAD, and no member is closed or represented as delivered independently.
**Enforcement.** Both. **Falsifying test shape.** A merge where the review `commit_id`
differs from the merged HEAD (including a reviewed ancestor with an unreviewed later
push); a merge onto a guessed base; a merge performed by an agent identity.
**Adversarial seeds.** (a) push new commit after APPROVE → merge must refuse (stale
review); (b) repoint/guess default branch → diff/merge must resolve remote truth;
(c) HMAC review-authorization bytes bound to different commit; (d) agent attempts merge
directly.

## CORMIDIA-INV-010 — Destruction stays inside its named scope
`[elicited+doc: PURPOSE app-reset, README reset]`
**Statement.** No operation destroys state outside its explicitly named scope. App reset
touches only the named app's Cormidia-managed state and identifiable `op:*` GitHub work —
never a sibling app, a human checkout, the repository, its default branch, or closed
history. Archive creation precedes destructive local mutation. `--force` crosses only the
narrow stale-heartbeat condition it was designed for, never identity or scope checks.
**Enforcement.** Both. **Falsifying test shape.** Any **destructive mutation outside the
authorized destructive set** (the operation's legitimate non-destructive writes — the
external archive, command audit rows, journals — are expected and excluded from the
check); destruction proceeding with the archive write failed.
**Adversarial seeds.** (a) reset app A with app B active — full-state diff of B; (b) fail
the archive write → destruction must not begin; (c) `--force` against a fresh heartbeat /
pending approval; (d) reset targeting a repo whose remote moved (wrong-remote guard).

## CORMIDIA-INV-011 — Secrets are confined, one policy governs
`[elicited+doc: F-PT-001 resolution; live-ui/reporting contracts]`
**Statement.** Verbatim L3 evidence (`brief.md`, `prompt.md`, `output.md`, `session.log`)
stays inside its permitted local evidence boundary; secret-bearing content never crosses
into lower-sensitivity surfaces — snapshots, SSE, portable exports, reports, narratives,
bounded previews, published tickets, commits. Every surface that scans, scrubs, previews,
exports, or captures does so through the one shared secret-pattern policy; no local,
weaker scrubber exists.
**Enforcement.** Both (guardrail at each egress; tests seed synthetic secrets).
**Falsifying test shape.** A seeded synthetic secret appearing in any lower-sensitivity
surface; an egress path importing its own pattern list.
**Adversarial seeds.** (a) secret in ticket body → published issue; (b) secret in output →
portable HTML report; (c) secret in run log → narrative capture (years-durable); (d) SSE
stream carrying L3 content; (e) structural check: exactly one pattern-policy source.

## CORMIDIA-INV-012 — Model claims never authenticate or promote themselves
`[elicited+doc: TASTE evidence-over-claims, learning-loop design]` `[rambling: PR #182,
"evidence over assertion"]`
**Statement.** No model output becomes a mechanical fact by assertion: a model cannot
prove its plan valid, its tests green, its review independent, its learning effective, or
its action safe by saying so — deterministic claims are decided by deterministic
evidence; genuinely model-dependent quality remains an eval result carrying provenance
and uncertainty. Learned content states — candidate, published, authorized, active,
validated — are distinct, and none silently implies the next; agents only propose; an
agent's self-reported improvement never promotes its own lesson.
**Enforcement.** Both. **Falsifying test shape.** A gate, promotion, or status change
whose only input is model prose; a candidate resolving into context without publisher +
authorization; "authorized" surfaced as "validated".
**Adversarial seeds.** (a) APPROVE-shaped prose without structured verdict → no review
artifact; (b) "tests passed" text with no check run → ship gate must refuse; (c) candidate
file placed to be directly resolvable; (d) self-report feeding promotion/canary metrics.

## CORMIDIA-INV-013 — Durable writes have an integrity story
`[elicited+doc: system-map §2.5, loop/turns]`
**Statement.** For every durable store, readers expose only the old valid state, the new
valid state, or a *recognized* intermediate logical state with an unambiguous recovery
rule. Physical bytes may tear — a crash can leave a torn append — but torn bytes are
rejected or quarantined by every reader, never accepted as terminal truth. (Mechanism
varies by store — append-only, atomic replace, or journal — per the ratified §2.5 shapes;
the logical-integrity property holds for all.)
**Enforcement.** Both — reader-side validation is the runtime guardrail; crash-injection
tests attack it. **Falsifying test shape.** A reader accepting a torn file as terminal
truth; a recognized intermediate with no recovery rule; recovery treating quarantined
bytes as valid state.
**Adversarial seeds.** (a) kill mid-append / mid-rename / mid-journal for each store
class; (b) truncated JSON accepted by a reader; (c) journal present + dead process →
reconciled, not ignored.

## CORMIDIA-INV-014 — Considered work never vanishes
`[elicited+doc: scheduler reason codes, event retirement, settlement]`
**Statement.** Everything the system considered leaves a durable account: every dispatch
candidate terminates in a named reason from the ratified vocabulary; an event retires
only with per-subscriber consumption evidence; a failed provider turn still settles; an
executed critical effect never disappears between execution and acknowledgement. The
machine never forgets the thing the human still needs to know.
Every issue in a Planner-considered backlog snapshot is likewise accounted for exactly
once by stable workstream/delivery-unit membership or a typed unassigned disposition;
replanning records deliberate moves instead of silently dropping or renaming the work.
**Enforcement.** Both. **Falsifying test shape.** A considered (app, role, trigger,
window) with no durable outcome; an inbox file gone without consumption marks; a
crashed-effect gap with neither acknowledgement nor ambiguity record.
**Adversarial seeds.** (a) WIP-limited candidate → named reason recorded; (b) event file
deleted by sweep without full marks; (c) spawn failure after decision commit; (d) tick
dies between spawn and bookkeeping (`post_spawn_bookkeeping_failure` must appear).

## CORMIDIA-INV-015 — Uncertainty narrows capability, never widens permission or claims
`[elicited]` (apex invariant; `[simulated]` in its generality — the direction is doc-
consistent everywhere but stated as a universal rule only here)
**Statement.** Under any uncertainty — missing state, unreadable config, ambiguous
outcome, unavailable dependency, unknown usage, torn write — Cormidia may do less, but
never becomes permitted to do more, and never claims more has happened than the evidence
supports. Fail-closed accepts availability damage to protect authority, containment,
money, and irreversible effects; it does not mean every error blocks everything forever.
**Jobs tightening (2026-08-07, M18).** A job config that changed under a live journal
**refuses rather than resuming**, and a step's completion is read from the journal
only — never inferred from an output file's presence, because a half-written file and a
complete one are indistinguishable on disk. `[doc: docs/jobs/design.md §6]`
**Enforcement.** Both — this is the design direction every guardrail's failure branch is
tested against. **Falsifying test shape.** Any code path where an error/absence branch
grants a wider outcome than the success branch would have (e.g., missing AUTHORITY.md →
newer delegated default; classifier error → allow; unknown usage → headroom).
**Adversarial seeds.** (a) corrupt/linked self-approval key → must fail closed; (b) org
with no charter → legacy-conservative, never delegated; (c) classifier throws → deny +
escalate; (d) budget state unreadable → no admission.

## CORMIDIA-INV-016 — Validation obligation lineage is continuous and independently closed
`[stated+elicited: #184/#234 lifecycle confirmation, 2026-08-03]`
**Statement.** Every autonomously executed unit has one durable validation/evidence
contract before it becomes ready. That contract identifies the affected journeys, boundaries,
contracts and invariants; cheapest falsifying layers; failure cases, detectors and
negative controls; expected evidence; and any explicit policy-bounded waiver. The same
contract version and execution-unit identity remain bound through EpisodePlan admission
and terminal evidence. Code delivery additionally binds Builder artifacts, exact-HEAD
gate evidence, and an independent Reviewer verdict; operational effects bind their exact
payload/action, required approval and acknowledgement evidence.
**Scope (made explicit 2026-08-07 on the M18/jobs revision; F-PT-031).** This invariant
governs **delivery units** — autonomously executed work that reaches readiness through a
RoadmapPlan/EpisodePlan admission path and lands in a product or performs an operational
effect. Work with no readiness transition, no delivery-unit membership, and no external
effect is outside its domain; such work is governed instead by its own boundary contract
and by the standing no-green-by-absence rule. The clause **narrows nothing that was ever
enforceable**: the invariant's own precondition is "before it becomes ready", and
"ready" is the delivery-unit state B-20 owns (INV-008's ready-frontier clause enumerates
exactly what a ready entry binds). A job step has no frontier, no admission, no
membership and no plan version, so the precondition is unsatisfiable for it and the
universal reading was never checkable. Jobs are **not** thereby unverified: the declared
output checks of `docs/jobs/design.md` §7 are a mandatory, pre-declared, durable,
deterministic obligation per step, carried by `CORMIDIA-C-B30-001`/`-003` and the
INV-008/INV-015 tightenings above.

Neither Planner, Validation Designer, Builder, Reviewer, a label, nor model prose can
silently waive, rewrite, satisfy, and approve the obligation alone.
**Enforcement.** Both — deterministic readiness/admission/review guardrails plus tests
that attack every handoff. **Falsifying test shape.** A unit becomes ready with a missing
or malformed contract; Builder omits required evidence but Reviewer passes; a waiver has
no policy/provenance; a contract or member changes after review without invalidation.
**Adversarial seeds.** (a) structurally valid but unknown contract ID; (b) explicit
low-risk waiver outside its policy class; (c) evidence copied from another unit/HEAD;
(d) cross-ticket boundary touched without its shared contract detector; (e) Reviewer
resumed from Builder's private session and self-confirms the same unsupported claim.

---

# Campaign invariants — the L-ACC outcome-acceptance lane (added 2026-08-07)

**Read the fence first.** `CORMIDIA-INV-ACC-1…7b` (alias `INV-ACC-n`) constrain the
**acceptance campaign**, not Cormidia. Violating one does not break the product; it
breaks the *measurement*, which is worse in exactly one way — the campaign still emits
a tidy score, and a human reads it. That is the INV-008 failure class pointed at the
harness, which is why five of the eight are E-3 in `risk-allocation.md`.

They are invariants rather than contract clauses by the standard sorting test: each must
hold over **every** scenario, arm, axis and turn of a campaign, not over one named
operation. Operation-specific promises stayed in `CORMIDIA-C-B27/28/29-001`.

Provenance: `[stated]` = the product owner's `acceptance/` corpus (rubric human-ratified
2026-08-07, tighten-only) and the task instruction opening this revision;
`[PROPOSED]` = designer-originated sharpening, marked per item. Enforcement classes are
as above; where the campaign cannot *prove* a property it must refuse or report
`incomplete`, never proceed and score.

## CORMIDIA-INV-ACC-1 — the sealed answer key never reaches a grader
`[stated: rubric §7 rule 3]` `[PROPOSED: the reachability half]`
**Statement.** No grader turn may reach the sealed content — the scenario's `## Plants`
section and anything derived from it. "Reach" covers **both** the turn's assembled input
(brief, prompt, context bundle, tool results, prior transcript) **and** any surface the
turn can read with its own tools: the scenario repository tree, the campaign root, the
report under construction. The key is extracted exactly once, before the first grader
turn is constructed, and its plaintext lives outside every path a grader may read. If
confinement cannot be proven, no grader turn is constructed.
<!-- tightening 2026-08-07: `acceptance/revision-input.md` §4 states this as "no
grader turn's assembled input contains any byte". That is too narrow to be true: the
grader is an agentic turn holding file-read tools pointed at a repository that also
contains the scenario markdown. Narrowed-to-stronger per the tighten-only rule; the
assembled-input clause is retained as its first half. -->
**Enforcement.** Both — a fail-closed pre-construction guardrail (assembly scan +
reachable-surface check) plus tests that attack it.
**Falsifying test shape.** A grader turn constructed while any plants byte is present in
its assembled input or in a tree it can read; a grader transcript reproducing a planted
item before the key was mechanically applied.
**Adversarial seeds.** (a) plants left in the committed scenario file inside the
scenario repo the grader is handed; (b) plants echoed into the report before scoring and
the report then handed back as grader context; (c) a paraphrased plant in a step
objective; (d) the key file placed under the campaign root while the grader's workdir is
the campaign root. **Negative control (mandatory):** a plant deliberately leaked into
grader input — the detector must fire red before it is trusted.

## CORMIDIA-INV-ACC-2 — the grader is never correlated with what it grades
`[stated: rubric §7 rule 1]`
**Statement.** For **every graded axis**, the grading turn's provider family is disjoint
from the provider families of every turn whose output that axis reads. Disjointness is
**per axis**, against the turns that axis actually reads — not against every turn in the
scenario — and the campaign records the disjointness set it actually applied for each
axis, so the scoping is auditable rather than assumed. The check runs **before provider
construction** and fails closed. If no legal grader exists for an axis, that axis reports
`ungraded` (INV-ACC-5); it is never graded by a correlated provider and never silently
dropped.
**Enforcement.** Both. **Falsifying test shape.** A grader constructed whose provider
family intersects the read set; a report whose recorded disjointness set does not match
the turns the axis actually read; an axis silently graded after the disjointness check
found no legal grader.
**Adversarial seeds.** (a) a scenario whose fan-out spans both families (S-ACC-3), where
a whole-scenario rule leaves no legal grader — must resolve per axis or report
`ungraded`, never widen; (b) an axis whose read set grows after the check;
(c) two harnesses sharing one upstream provider family (the pi/Anthropic correlation
noted at B-04) treated as disjoint — family, not vendor product, is the unit.
**Negative control:** a grader provider deliberately set equal to the graded turn's.

## CORMIDIA-INV-ACC-3 — a campaign never points an app at this repository
`[stated: acceptance/README.md boundary 2]`
**Statement.** No L-ACC campaign resolves a sandbox app to the Cormidia repository, and
no scenario repository is any repository other than the campaign's own disposable ones.
Cormidia feature work is a campaign **output** — filed issues feeding a normal
development cycle — never a step inside it.
**Enforcement.** Both — the campaign asserts `assertCampaignRepositoryBinding`
(`tests/campaign/repository-binding.ts`), which already pins checked-out HEAD and the
canonical tracked policy blob to the authorized commit; an app that edits this repo
mid-campaign voids the campaign's own identity.
**Falsifying test shape.** A campaign app whose configured repository, or whose worktree
git origin, resolves to this repository; a campaign that completes while HEAD moved.
**Adversarial seeds.** (a) app config naming the Cormidia slug; (b) a scenario repo
whose origin is re-pointed mid-campaign; (c) a job scenario given a `--workdir` inside
this checkout. **Negative control:** a scenario deliberately bound to this repository.

## CORMIDIA-INV-ACC-4 — no build arm precedes its plan gate
`[stated: rubric §6]`
**Statement.** A scenario's build arm does not begin until that scenario's plan gate has
resolved. The gate resolves on a **score**, not on an approval row — it is not an alias
of the J-06 approval-wait. **Who may author that resolution was decided 2026-08-07
(F-PT-030): a campaign config's declared `plan_gate` policy may resolve it unattended,
so a campaign runs end to end.** What did *not* change is this invariant: a durable
resolution must exist before any build-arm spend, it must apply the ratified rubric §6
criteria (at least `attempted` on P-1 and P-5 for every scenario), and a campaign with
no declared policy still refuses at preflight — silence is not consent.
**Enforcement.** Both. **Falsifying test shape.** Build-arm provider spend recorded for
a scenario whose gate has no resolution record; a gate resolution written after the
first build turn.
**Adversarial seeds.** (a) resume after interruption re-entering at the build arm;
(b) a scenario whose plan arm failed treated as "gate passed by absence"; (c) an
auto-continue that skips recording its resolution, or that proceeds with a scenario
below the rubric §6 criteria; (d) a campaign with no declared `plan_gate` policy
continuing anyway.

## CORMIDIA-INV-ACC-5 — unratified thresholds cannot produce a grade, and `ungraded` is not zero
`[stated: rubric §5, ratified]`
**Statement.** While a threshold is unratified, no L-ACC verdict is `pass` or `fail`;
every threshold-dependent axis reports `inconclusive`. An axis whose evidence is missing
— or whose score arrived without the mandatory one-sentence evidence citation — reports
`ungraded`. **`ungraded` is never coerced to `0`**, never enters an aggregate as a
numeric value, and any aggregate names its graded denominator explicitly. Conflating "we
did not measure it" with "it was absent" is how a suite starts lying.
**Enforcement.** Both — expressed in `validation-policy.yaml` →
`verdict_semantics.axis_score` so it is policy, not runner discretion.
**Falsifying test shape.** Any surface rendering a threshold-dependent axis as pass/fail
while its threshold is unratified; any mean, total or percentage into which an
`ungraded` axis entered as `0`; a citation-less score retained as a number.
**Adversarial seeds.** (a) a scenario where every axis is `ungraded` rendering as a
0-score "failure"; (b) a report averaging axes across scenarios with different graded
denominators; (c) a threshold introduced by a runner constant rather than a ratified
rubric edit. **Negative control:** a seeded citation-less score.

## CORMIDIA-INV-ACC-6 — an unfinished campaign is never complete
`[stated: rubric §5; standing rule 7]`
**Statement.** Ceiling exhaustion, a killed scenario, or a missing grader run yields
`completeness: incomplete` for that scenario, with partial evidence preserved. Never
green, never silently dropped from the report.
**Enforcement.** Both. **Falsifying test shape.** A scenario reported complete while any
authorized-envelope ceiling stopped it, a scenario was killed, or a grader run is absent;
a report omitting a scenario that was attempted.
**Adversarial seeds.** (a) envelope exhausted between the plan and build arms;
(b) a grader turn that failed transport and was retried into silence; (c) a scenario
whose repo provisioning failed being dropped rather than reported.

## CORMIDIA-INV-ACC-7a — the org does the work, not the supervisor
`[stated: acceptance/README.md boundary 6; revision-input §4]`
**Statement.** Every product-affecting action in a campaign is performed by the
`cormidia` or `cormidia-job` binary. No commit, branch, pull request, issue or file
write inside a scenario repository traces to the supervising agent's identity, and no
provider SDK is called outside a Cormidia turn. An agent that runs `git`/`gh` itself,
edits a scenario repo directly, or calls a provider SDK is *simulating* the org, and
every score then measures the supervisor.
**Enforcement.** Test + a **report-time fail-closed guardrail**: the campaign
reconciles three independent records — the campaign org's invocation audit
(`src/cli/invocation-audit.ts` and `src/jobs/invocation-audit.ts`, one row per CLI
dispatch), per-commit authorship in each
scenario repository, and the run journal's turn records — and a scenario whose
reconciliation does not close reports `ungraded`/`incomplete` rather than a score.
(There is deliberately no runtime guardrail that could *prevent* a supervisor from
running `git`: the honest mechanism is detection plus refusal to score.)
**Falsifying test shape.** A scenario-repo commit whose author is not a Cormidia turn
identity; a product-affecting action with no corresponding invocation-audit row; a
provider call in the campaign's own process.
**Adversarial seeds.** (a) a hand-authored commit pushed to a scenario repo "to fix the
build"; (b) `gh issue create` run by the supervisor to seed a backlog; (c) a supervisor
patching a generated file between turns; (d) a provider SDK imported by the campaign
runner for "just the grading" — grading is itself a Cormidia-invoked turn.
**Negative control:** a hand-authored commit deliberately pushed to a scenario repo.

## CORMIDIA-INV-ACC-7b — the binaries are the packaged ones
`[stated: acceptance/README.md boundary 6]`
**Statement.** The `cormidia` and `cormidia-job` the campaign invokes are the **packaged**
binaries. Neither resolves through `PATH` into this checkout, no campaign turn runs
`pnpm dev`, `tsx src/…`, or a `link:local` symlink, and every packaged skill link
resolves into the installed package root. `pnpm link:local` produces a *source-backed*
install — symlinks into `src/`, run through tsx
([`scripts/install-packaged.mjs`](../scripts/install-packaged.mjs)) — which executes
TypeScript `npm install -g cormidia` never ships; a campaign run against it measures the
working tree, not the product.
**Enforcement.** Both — and **the guardrail already exists; do not rebuild it.**
`pnpm install:packaged --replace-source-links` performs build → `npm pack` → real npm
global install in a disposable prefix → ownership-checked transaction of the package,
declared bins, and skills. It verifies the staged and promoted binaries and refuses
source/foreign or mixed-generation evidence
([`install-packaged.mjs`](../scripts/install-packaged.mjs)). **The campaign's B-27
preflight asserts that script's exit status** and records the installed version and
tarball identity in the report; it does not reimplement the check.
**Falsifying test shape.** A campaign that proceeds while the preflight exited non-zero,
was skipped, or was run before the campaign's own commit pin; a report that cannot
answer "which bytes did this exercise".
**Adversarial seeds.** (a) a campaign started while `link:local` symlinks are still in
place; (b) a shadowing binary earlier on `PATH`; (c) an install under a different npm
prefix so the resolved binary is not the one on `PATH`; (d) a preflight run with
`--dry-run` alone and its non-zero exit read as "nothing to do".
**Negative control:** a campaign started with `link:local` links present — the preflight
must be red.

---

## Explicitly excluded / pushed down

- **F-PT-003** (budget-pause crash convergence) and **F-PT-004** (scratch-vs-protected
  bytes): ratified 2026-07-31 (pause holds + exactly one item; preserve-and-inspect,
  never reset) — now contract truth carried by their own case families (HB-P1/HB-P2),
  still deliberately absent from INV-007/INV-010/INV-013's statements.
- **"There is one ticket-status field":** rejected as an invariant by the owner — the
  multi-source design is deliberate; the invariant content lives in INV-008's
  no-compression clause.
- **"Secrets are never written":** rejected — false given verbatim L3 (F-PT-001);
  replaced by confinement (INV-011).
- **"All uncommitted bytes are preserved":** still rejected as a blanket invariant;
  F-PT-004's ratified contract (2026-07-31) is preserve-and-inspect for *ambiguous*
  bytes, never a promise about all bytes. (Provenance: the preference was recorded
  `[simulated]` in the finding; human-ratified 2026-07-31.)
- Contract-shaped near-misses pushed to Phase 4: dispatch's `malformed_company_event`
  reporting; `--json` error document shape; retention windows; polling cadences;
  per-command dry-run semantics; scheduler reason-code vocabulary (the *existence* of a
  named outcome is INV-014; the vocabulary itself is contract).

## Beat-4 category check (skill checklist vs the elicited set)

Money/irreversible: INV-003/006/007/009/010. State machines & legal transitions: INV-005,
INV-012 (learning states), INV-016 (validation lifecycle), + per-boundary contracts.
Resource conservation: INV-006/014.
Uniqueness/mapping: INV-004/005/007 (one admission computation). Ordering/idempotency:
INV-003 (never re-perform), INV-013. Tenancy/authorization: INV-001/002/004. No category
required a `[PROPOSED]` addition — the stakeholder's ramble covered all six.

## New finding raised during synthesis

- **F-PT-005 — RESOLVED by owner ratification (2026-07-31), derivation retained as
  provenance.** "Current subscriber" cutoff when the subscriber set changes while an
  event is pending. Docs mechanism: `roles.yaml` is reevaluated each tick; retirement
  requires marks for every current subscriber; a newly added subscriber lacks a mark.
  Owner's ratified call: **added subscribers inherit events that are still pending;
  removed subscribers cease blocking retirement.** Provenance: `[doc]` (mechanism,
  removal case explicit) + owner ratification of the derived addition case
  (`[simulated]` seat; human-ratified by adoption 2026-07-31). This
  is now usable contract truth for Phase 4/6 derivation.
