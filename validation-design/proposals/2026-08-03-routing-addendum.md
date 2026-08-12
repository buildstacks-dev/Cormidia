# Proposed 2026-08-03 routing addendum — parked, NOT yet binding

<!-- Parked verbatim by the #402 restructure (2026-08-11) from AGENTS.md lines
643-685 at commit fa86238. Design accepted 2026-08-03; the exact edit approval
the owner retained is still pending. Never represent this as landed policy.
verbatim-below -->

## Proposed 2026-08-03 routing addendum — design accepted; exact edit approval pending

The text below is the proposed standing-rule addition for the
roadmap/validation/delivery/batching harness revision. The design was accepted on
2026-08-03, but the owner's acceptance expressly retained separate approval for
protocol-surface changes. It is **not yet part of the ratified verbatim section above**
and must not be represented as landed policy until its exact diff is approved.

> **Roadmap, validation and execution-batch changes** start at J-03/J-20,
> C-OP-PLAN/C-OP-VALIDATION/C-OP-BATCH, B-20/B-21/B-22 and INV-016. Code work is
> always RoadmapPlan-accounted and delivered as one independently reviewed PR per
> delivery unit, even when complete structured input makes the roadmap or
> EpisodePlanner provider turn unnecessary. Complete non-code operational work may
> omit RoadmapPlan only through the direct `ExecutionUnit` contract; it still requires
> EpisodeIntent/EpisodePlan, validation/evidence policy, and separately exact approval
> plus acknowledgement for every external payload/effect.
>
> Labels and trailers—including `op:ready`, `op:tier-*` and any
> `planning:preplanned` projection—are discoverability/state projections, never plan,
> validation, routing or effect authority. Their referenced persisted artifact and hash
> must validate independently. Batch admission is deterministic and token-free;
> EpisodePlans are created lazily per admitted unit. Affinity/cache/session reuse may
> reorder compatible same-app units, but never changes membership, priority, routing,
> validation, one-PR atomicity, per-unit budget/evidence, effect grants, or Builder/
> Reviewer independence. Cache benefit is reported only from adapter evidence and has
> no correctness effect.
>
> Changes needing a new journey, boundary, invariant, or LLM call site — the
> exhaustive structural trigger list, one rule with the structural-additions
> section above — re-enter
> `validation-harness-design` in `harness-revision` mode. Changes to TASTE.md,
> roles.yaml, pipelines.yaml, prompts/** or PURPOSE.md remain proposal-only until a
> human explicitly ratifies the exact diff. **The MECHANIC when an ordinary
> ticket needs such an edit**: mirror the mid-change
> disposition — **draft the exact protocol-surface diff and park it in the
> change description as proposal-pending-ratification (never merge it); land
> the parts of the ticket that stand alone without it; escalate through the
> same solo-operator channel** (change description + F-PT finding if
> product-truth-shaped); the ratified diff lands in its own change once the
> human ratifies it verbatim.

---

