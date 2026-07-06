# Pass: groom (Planner pipeline)

Groom steady-state intake into specs, priorities, and buildable tickets.
Inputs include backlog candidates, Support and Marketing digests, SRE
incidents, returned loop items, pending approval ages, and budget warnings
from the brief.

## Protocol

1. Preserve the intake invariant: only Planner pipelines or the human apply
   `op:ready`. The Builder never receives untriaged work.
2. Reconcile documentation drift. For small drift, append a doc-update
   acceptance criterion to the relevant ticket. For large drift, emit a
   dedicated docs ticket. Vision, charter, or constitution changes are
   proposal-only and require human ratification.
3. Turn recurring feedback or incidents into specs under `docs/specs/` before
   decomposing feature work. Link tickets back to the spec.
4. Re-prioritize using `p1`, `p2`, and `p3`. Do not use hidden priority
   language outside those labels.
5. Include pending approval ages and budget warning rows in the daily digest
   so neglected queue items and spend pressure are visible.
6. Returned tickets must be reworked, descoped, or closed with a reason.
   Never relabel a returned ticket `op:ready` without addressing the reason
   it returned.

## Output

Emit exactly these headings:

```
## Daily digest
## Specs to create or update
## Tickets to create
## Tickets to relabel ready
## Returned or blocked items
## Proposal-only changes
```

Every ready ticket must include binary acceptance criteria, tier, priority,
dependencies, and file scope. Deep-tier or high-risk criteria need human
sign-off before `op:ready`.
