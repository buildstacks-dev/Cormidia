# Operation contract — C-OP-LOOP (delivery-unit state machine)
Canonical ID: **CORMIDIA-C-OPLOOP-001 (alias: C-OP-LOOP)**

Status: RATIFIED 2026-07-31 baseline with an ACCEPTED 2026-08-03 implementation
contract revision. Covers the loop's internal operation
promises not owned by a single Phase 3 boundary. Defends INV-005/008/009.
Journey J-04. Interfaces with B-01/B-15/B-16/B-20/B-21/B-22 and the provider adapters.

## §1 State vocabulary
- One stable delivery unit contains one or more member tickets and owns exactly one
  delivery EpisodePlan, branch/worktree, PR and terminal review/merge outcome.
- `ready → building → gates → reviewing → shipping → merged`, plus
  `returned | blocked | incident` and `p1–p3` priorities (ordinal urgency: p1
  highest, scheduled ahead of p2/p3 at equal readiness — a projection of
  RoadmapPlan priority, per INV-008 never routing/effect authority in itself
  <!-- changelog 2026-08-10 (reader test 7, operator finding 3): the labels were
  used corpus-wide but glossed nowhere -->); every state derives from
  durable unit/member records plus GitHub artifacts so any tick can advance any unit.
- A label flips only after the artifact it announces exists (INV-008).
- Member issue labels are projections. A unit cannot be represented as merged while any
  member, accepted validation contract, or exact-HEAD outcome disagrees.

## §2 Claims
- Claim admission rereads every member's routing/state plus the RoadmapPlan/frontier and
  validation-contract hashes. Any mismatch refuses before mutation.
- The local claim transaction is all-or-none across the delivery unit. GitHub label
  projections follow artifact-before-label and reconcile through B-01; partial remote
  success cannot make an unclaimed member independently eligible.
- Claims are provisional until the first provider turn; crash before that boundary
  repairs the whole unit without consuming allowance; post-provider ambiguity requires
  the content-bound `loop rearm` transaction `[doc]` (INV-005).
- `routing:human-only` is orthogonal to lifecycle state and refuses autonomous claim
  even when `op:ready` is present. Builder re-reads current label state immediately
  before claim; unreadable state refuses. Phase swaps never remove the routing label.

## §3 Cycle bounds
- Remediation and review cycles are each bounded at **3** `[doc]`. Cycles 1–3 bounce
  within the loop; when a **fourth** cycle would be required, the delivery unit exits as
  `returned` — bounded remediation, never an unbounded loop. In a multi-ticket unit the
  count and terminal return apply to the unit; no member silently starts a fresh cycle.

## §4 Review and merge
- Review dimensions risk-selected, security always-on `[doc]`; a structured verdict
  becomes an authorized GitHub review bound to the exact HEAD (INV-012/009); merge
  preconditions per INV-009 and C-OP-VALIDATION; the orchestrator squash-merges, deletes
  the branch, and closes every member through the one PR only after merge evidence.
- **Verdict-marker grammar** (reproduced here so the positive-parse case is
  buildable from this corpus <!-- changelog 2026-08-10 (reader test 21,
  new-engineer finding 3); corrected same day (final-gate follow-up 10): the
  first reproduction over-attributed the fourth form to design.md §6 and stated
  a conflict-strictness the parser does not have — the discrepancy is now
  finding F-PT-033, not a silently rewritten clause -->): **three** status
  forms are `[doc]` (design.md §6's "three status formats"): `## Status` with
  the value on the next line (blank lines tolerated), `## Status: <value>`
  inline, `**Status:** <value>` bold. A **fourth** bare-line form —
  `Status: <value>` / `Verdict: <value>`, backticks tolerated — is a
  code+template addition (src/loop/verdicts.ts port note: "our ratified
  templates phrase the output exactly that way"), NOT design.md §6. Review
  verdict values: `approve` | `findings`; build status: `done` | `blocked`
  (`[doc]` design.md §6). Finding lines:
  `- category/severity file:line -- description -> action` with unicode (`—`/`→`)
  or ASCII (`--`/`->`) delimiters, category/severity case-normalized `[doc]`.
  **Refusal semantics are OPEN — F-PT-033**: the corpus clause said "refuses
  zero/two"; the running parser refuses zero markers and DISTINCT conflicting
  values but deliberately parses duplicate identical markers, with keyword
  precedence (Verdict consulted before Status). The landed tests
  (tests/unit/s3-verdict-marker.test.ts) **record current implementation
  behavior — duplicate-identical parses, Verdict-before-Status precedence — as
  pinned regression facts, but confer NO ratification** <!-- changelog
  2026-08-10 (final-gate follow-up 11): the first wording claimed tests assert
  only both-readings-valid refusals, which the landed test literally
  contradicts -->; no NEW test may encode either answer as contract truth, and
  choosing the strict reading would require changing the parser AND those tests
  (red-then-green whichever way the owner decides).
  Parse failure triggers exactly one session-resuming reformat turn, then fails
  loud as infra `[doc]`.
- If one member obligation fails, the delivery unit returns/replans as one reviewable
  change. Cormidia does not partially merge, split the PR after review, or claim that a
  subset delivered.

## §5 Parallelism
- Delivery-unit parallelism is dependency/scope-aware: a unit becomes due only when all
  external dependencies are merged; overlapping or conflicting scopes never run
  concurrently. Units grouped into one execution batch remain independently claimed and
  reviewed under C-OP-BATCH.
