# Invariants — Operon (product scope)

Status: CONFIRMED at the Phase 2 gate (2026-07-31, round 3); human-ratified 2026-07-31 (ratification-package.md §9). <!-- AUD-105 -->
Namespace: `OPERON-INV-NNN`. Product scope — no parent, nothing inherited.

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

---

## OPERON-INV-001 — Authority never grows by accident
`[elicited+doc: architecture §5, org/context, TASTE "never do"]`
**Statement.** The effective authority of any turn is never broader than the ratified org
grant as narrowed by app configuration. Narrower layers only narrow. No agent-writable
content — memory, prompts, plans, model output, cached context, GitHub labels, prior
approvals — can manufacture or widen permission. Where two authority sources disagree, the
most restrictive valid source governs, or the turn stops. The surfaces that define agent
authority (`AUTHORITY.md`, `TASTE.md`, `roles.yaml`, `pipelines.yaml`, `prompts/**`,
protected learning surfaces) are structurally unwritable by agents — proposal-only.
**Enforcement.** Both — the gate + context assembler enforce at runtime; tests attack the
enforcement. **Falsifying test shape.** A turn whose app config claims a wider grant than
the org; a memory bundle containing permission-granting text; an agent write landing on a
protocol surface and a subsequent turn honoring it.
**Adversarial seeds.** (a) app-config widening attempt honored; (b) injected memory/prompt
text asserting new permissions changes gate outcome; (c) label or prior approval treated
as standing authority; (d) learning publish path used to alter a role's toolset.

## OPERON-INV-002 — The gate is total over critical effects
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

## OPERON-INV-003 — Approval is never execution; grants stay inside their ratified shape
`[elicited+doc: approvals design, PURPOSE 2026-07-18]`
**Statement.** At every moment, an approved item and an executed operation are distinct
durable facts. Grants have exactly two ratified shapes, and neither drifts beyond its
declared scope: **(a) default — fresh, exact-content, single-use**: bound to one exact
actor, app, operation/payload, and content version; the never-broadly-scopeable actions
(production deploys, external publication, protocol-surface writes, outside-worktree
actions) only ever take this shape; **(b) human-widened scoped grants (A1)**: bound to a
human-chosen app/ticket plus rule+path scope, with TTL, use-count cap, revocation, and a
per-use audit row — widening is a human act at decision time, never an agent's, and
scoped grants are *intentionally multi-use within those bounds*. Neither shape becomes
unbounded or agent-widenable permission. Self-approval and self-merge are unrepresentable
at any scope. Once execution
of an approved irreversible effect starts, durable evidence always exists that it is
`executing`, `executed`, `failed`, or `ambiguous`; ambiguity is terminal-until-reconciled
and is never resolved by re-performing the effect.
**Enforcement.** Both. **Falsifying test shape.** An executed critical op with no prior
persisted decision. For **once** grants: consumed twice; changed bytes executing under
the old approval. For **scoped** grants: a use outside the rule/path or app/ticket scope;
a use after TTL expiry or revocation; a use beyond the use cap; a use with no per-use
audit row. Either shape: a crashed acknowledgement followed by automatic re-execution.
**Adversarial seeds.** (a) approve → mutate payload → execute (once grant); (b) replay a
consumed **once** grant on the next tick; (b′) scoped grant exercised out-of-scope /
post-revocation / at cap+1 — each must be refused with the grant intact in audit;
(c) kill between remote effect and acknowledgement, observe next tick's behavior;
(d) attempt to represent a self-approval via the CLI effect surface.

## OPERON-INV-004 — One turn, one app, coherently
`[elicited+doc: PURPOSE "one turn one app", architecture §7]`
**Statement.** Every turn binds exactly one app, and all its facets agree on that
identity: plan, authority, context, memory bundles, repository, worktree, approval scope,
triggering event, run evidence, and settlement. Any mismatch stops the turn; nothing
infers which field was intended. No state, context, approval scope, or worktree content
bleeds across apps.
**Enforcement.** Both. **Falsifying test shape.** A turn whose context contains another
app's memory; a settlement row attributed to a different app than the worktree mutated.
**Adversarial seeds.** (a) event for app A routed to a turn holding app B's worktree;
(b) memory selection pulling sibling-app bundle; (c) approval scoped to app A consumed by
app B's turn; (d) reset of app A observed from app B's clone (ties to INV-010).

## OPERON-INV-005 — Ticket claims are unique, durable, and stable
`[elicited+doc: PURPOSE 2026-07-18 sagas, loop design §7]`
**Statement.** At every moment a ticket has at most one active claim. A claim never
silently disappears while its work continues; a crash before the first provider turn
repairs without consuming allowance; after provider work may have happened, only the
explicit re-arm transaction changes the claim. An approval pause preserves the same claim
number — a pause is never a fresh claim.
**Enforcement.** Both. **Falsifying test shape.** Two turns holding one ticket; a claim
record vanishing while a worktree still advances; claim number incrementing across an
approval wait.
**Adversarial seeds.** (a) two ticks racing one `op:ready` ticket; (b) kill after label
flip, before claim persist (and the reverse); (c) approval pause → resume → assert claim
identity; (d) re-arm without the transaction (must be refused).

## OPERON-INV-006 — Settlement conservation
`[elicited+doc: episodes contract, README observability]`
**Statement.** Every provider turn creates exactly one settlement obligation and settles
exactly once — succeeded, failed, cancelled, malformed, or gate-stopped alike. Mechanical
steps never settle as provider turns. Unknown or unavailable usage is never rendered as
zero. The ledger is the sole durable spend fact; overlays and reports derive from it and
never replace it.
**Enforcement.** Both (settlement machinery + reconcile; readers guarded by tests).
**Falsifying test shape.** A provider turn with zero or two ledger rows; a mechanical step
settling; an unavailable-usage turn shown as $0 headroom.
**Adversarial seeds.** (a) kill between provider return and ledger append, then
`budget --reconcile`; (b) same providerTurnId settled twice; (c) provider returns no
usage — assert "unknown", not 0; (d) blocked-on-gate turn still settles.

## OPERON-INV-007 — Paused means no new spend, decided once
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

## OPERON-INV-008 — Evidence never outruns reality
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
**Enforcement.** Both (readers/writers guarded; presentation tested). **Falsifying test
shape.** Any surface rendering a claim whose backing artifact is absent, stale, or
contradicted.
**Adversarial seeds.** (a) flip label with no artifact, observe every reader; (b) GitHub
unavailable → queue must not render empty; (c) usage unavailable → spend must not render
$0; (d) scheduler definition present but no tick evidence → not "healthy"; (e) contradictory
claim file vs GitHub state → reader must surface contradiction, not pick the greener.

## OPERON-INV-009 — No merge escapes the reviewed boundary
`[elicited+doc: loop design §7, github-conventions]` `[rambling: default-branch scar]`
**Statement.** Every merge Operon performs satisfies, at merge time: the authorized
review's `commit_id` **equals the current candidate/branch HEAD at merge time** — any
commit pushed after the review invalidates the approval (ancestry alone is not freshness);
required checks are fresh for that exact candidate; the remote default branch was
resolved, never guessed; and the merge actor is the orchestrator alone. Git's ability to
recover from a bad merge never excuses a violation.
**Enforcement.** Both. **Falsifying test shape.** A merge where the review `commit_id`
differs from the merged HEAD (including a reviewed ancestor with an unreviewed later
push); a merge onto a guessed base; a merge performed by an agent identity.
**Adversarial seeds.** (a) push new commit after APPROVE → merge must refuse (stale
review); (b) repoint/guess default branch → diff/merge must resolve remote truth;
(c) HMAC review-authorization bytes bound to different commit; (d) agent attempts merge
directly.

## OPERON-INV-010 — Destruction stays inside its named scope
`[elicited+doc: PURPOSE app-reset, README reset]`
**Statement.** No operation destroys state outside its explicitly named scope. App reset
touches only the named app's Operon-managed state and identifiable `op:*` GitHub work —
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

## OPERON-INV-011 — Secrets are confined, one policy governs
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

## OPERON-INV-012 — Model claims never authenticate or promote themselves
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

## OPERON-INV-013 — Durable writes have an integrity story
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

## OPERON-INV-014 — Considered work never vanishes
`[elicited+doc: scheduler reason codes, event retirement, settlement]`
**Statement.** Everything the system considered leaves a durable account: every dispatch
candidate terminates in a named reason from the ratified vocabulary; an event retires
only with per-subscriber consumption evidence; a failed provider turn still settles; an
executed critical effect never disappears between execution and acknowledgement. The
machine never forgets the thing the human still needs to know.
**Enforcement.** Both. **Falsifying test shape.** A considered (app, role, trigger,
window) with no durable outcome; an inbox file gone without consumption marks; a
crashed-effect gap with neither acknowledgement nor ambiguity record.
**Adversarial seeds.** (a) WIP-limited candidate → named reason recorded; (b) event file
deleted by sweep without full marks; (c) spawn failure after decision commit; (d) tick
dies between spawn and bookkeeping (`post_spawn_bookkeeping_failure` must appear).

## OPERON-INV-015 — Uncertainty narrows capability, never widens permission or claims
`[elicited]` (apex invariant; `[simulated]` in its generality — the direction is doc-
consistent everywhere but stated as a universal rule only here)
**Statement.** Under any uncertainty — missing state, unreadable config, ambiguous
outcome, unavailable dependency, unknown usage, torn write — Operon may do less, but
never becomes permitted to do more, and never claims more has happened than the evidence
supports. Fail-closed accepts availability damage to protect authority, containment,
money, and irreversible effects; it does not mean every error blocks everything forever.
**Enforcement.** Both — this is the design direction every guardrail's failure branch is
tested against. **Falsifying test shape.** Any code path where an error/absence branch
grants a wider outcome than the success branch would have (e.g., missing AUTHORITY.md →
newer delegated default; classifier error → allow; unknown usage → headroom).
**Adversarial seeds.** (a) corrupt/linked self-approval key → must fail closed; (b) org
with no charter → legacy-conservative, never delegated; (c) classifier throws → deny +
escalate; (d) budget state unreadable → no admission.

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
INV-012 (learning states), + per-boundary contracts. Resource conservation: INV-006/014.
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
