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
  `returned | blocked | incident` and `p1–p3` priorities; every state derives from
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
- If one member obligation fails, the delivery unit returns/replans as one reviewable
  change. Cormidia does not partially merge, split the PR after review, or claim that a
  subset delivered.

## §5 Parallelism
- Delivery-unit parallelism is dependency/scope-aware: a unit becomes due only when all
  external dependencies are merged; overlapping or conflicting scopes never run
  concurrently. Units grouped into one execution batch remain independently claimed and
  reviewed under C-OP-BATCH.
