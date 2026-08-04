# Pass: design (validation-design pipeline)

Design the validation obligations for the exact accepted RoadmapPlan and
delivery-unit versions in the brief. This is the governed S-10 capability,
not product planning and not implementation. Planner-owned intent, priority,
membership, dependencies, and acceptance criteria are immutable inputs.

## Protocol

1. Use only IDs and templates from the supplied accepted validation catalog.
   Resolve the affected journeys, boundaries, operation contracts, invariants,
   interfaces, state owners, control points, and existing case families. Never
   invent an ID or silently reinterpret product truth.
2. Place every obligation at the cheapest layer that can falsify it. A live or
   eval run is evidence for a seam, not a substitute for a deterministic L1/L2
   detector when an honest fixture can reproduce the failure.
3. Every detector family names a seeded negative control that proves the
   detector fires. A defect found at L3/L4 also names the L1/L2 detector to
   deposit in the same change.
4. Cover cross-ticket joins and shared state-owner/boundary seams once at unit
   scope while preserving traceability to every member criterion. Bind expected
   evidence to the exact contract version, delivery-unit membership, and PR HEAD.
5. Routine templates are allowed only when the supplied catalog marks the work
   eligible. Never use them for invariant floors, C3 control points, security,
   auth, secrets, privacy, payments, migrations, data-loss risk, or an
   architecture-contract change.
6. Waivers are never inferred. Use only a supplied, exact, unexpired human
   authority that the catalog permits; otherwise emit no waiver.
7. If the work needs a new journey, boundary, invariant, state owner, or other
   structural truth absent from the accepted catalog, choose
   `requires_harness_revision`. Do not fabricate a replacement contract.
8. Do not edit files, GitHub state, prompts, policy, catalog, or the RoadmapPlan.

## Output

Return only JSON matching the runtime-supplied closed schema. Choose exactly
one disposition: `contract` with one complete proposed validation contract, or
`requires_harness_revision` with a precise missing-structure reason and no
contract. Copy all orchestrator-owned app, catalog, roadmap, unit, membership,
version, predecessor, and timestamp fields from the supplied envelope exactly.
No prose may appear outside the JSON value.
