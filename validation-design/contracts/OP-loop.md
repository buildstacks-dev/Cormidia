# Operation contract — C-OP-LOOP (ticket delivery state machine)
Canonical ID: **CORMIDIA-C-OPLOOP-001 (alias: C-OP-LOOP)**

Status: DRAFT (Phase 4). Added on stakeholder trace audit. Covers the loop's internal
operation promises not owned by a single Phase 3 boundary. Defends INV-005/008/009.
Journey J-04. Interfaces with B-01/B-15/B-16 and the provider adapters.

## §1 State vocabulary
- `ready → building → gates → reviewing → shipping → merged`, plus
  `returned | blocked | incident` and `p1–p3` priorities; every state derives from
  GitHub artifacts so any tick can advance any item `[doc]`.
- A label flips only after the artifact it announces exists (INV-008).

## §2 Claims
- Atomic label-flip claims; provisional until the first provider turn; crash before
  that boundary auto-repairs without consuming allowance; post-provider ambiguity
  requires the content-bound `loop rearm` transaction `[doc]` (INV-005).

## §3 Cycle bounds
- Remediation and review cycles are each bounded at **3** `[doc]`. Cycles 1–3 bounce
  within the loop; when a **fourth** cycle would be required, the ticket exits as
  `returned` — bounded remediation, never an unbounded loop.

## §4 Review and merge
- Review dimensions risk-selected, security always-on `[doc]`; a structured verdict
  becomes an authorized GitHub review bound to the exact HEAD (INV-012/009); merge
  preconditions per INV-009; the orchestrator squash-merges, deletes the branch, and
  closes via `Closes #N` `[doc]`.

## §5 Parallelism
- Ticket-level parallelism is dependency/scope-aware: `Depends-on: #N` becomes due only
  when #N is merged; overlapping file scopes never run concurrently `[doc]`.
