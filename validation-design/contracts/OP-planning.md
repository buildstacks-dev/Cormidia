# Operation contract — C-OP-PLAN (episode planning operations)
Canonical ID: **CORMIDIA-C-OPPLAN-001 (alias: C-OP-PLAN)**

Status: RATIFIED 2026-07-31 baseline with an ACCEPTED 2026-08-03 implementation
contract revision. Covers the EpisodePlanner boundary
operations: `previewEpisode` / `orchestrateEpisode` / `explainEpisode`,
`plan --auto`, `plan --creator-scope --execution-ready`, plan validation/persistence,
RoadmapPlan/TicketPlan publication. Defends INV-008/012/014/015/016, M5/M17. Journey
J-03. Interfaces with B-01/B-02..04/B-10/B-20/B-21.

## §1 Creator-scope bypass conditions
- `--creator-scope` and `--execution-ready` required together; readiness is **never
  inferred** from a detailed-looking goal, file, title, labels, lifecycle, tier, or
  existing-ticket status `[doc]`.
- A complete scope carries: bounded objective + exclusions, acceptance criteria,
  expected artifacts, governed steps or unambiguous workflow-template reference,
  constraints + safety facts, provenance, and every non-deterministic assignment
  decision `[doc]`.
- Mismatched disposition, incomplete scope, unknown operation/role, or unapproved
  adaptive assignment **fails before provider construction** — never silent
  EpisodePlanner fallback `[doc]`.
- Incomplete creator scope *without* `--execution-ready` remains authoritative input;
  the EpisodePlanner completes the missing decisions `[doc]`.
- A detailed ticket moves quickly only when its information is structured and complete:
  prose volume is not a bypass. A valid execution-ready scope or governed workflow
  template normalizes into an EpisodePlan with zero provider turns; otherwise one
  bounded EpisodePlanner turn fills only the missing workflow decisions `[stated]`.
- `op:ready`, `op:tier-*`, priority/domain labels, and any future
  `planning:preplanned` projection never establish creator scope. The label may exist
  only as a discoverability projection of a persisted scope ref+hash that independently
  passes this section's validator `[stated]`.

## §2 Plan production
- Output: schema-validated, versioned EpisodePlan persisted **before** the first
  delivery turn; DAG order deterministic; each provider step carries one indivisible
  assignment tuple; revisions bounded, versioned, forward-only `[doc]`.
- `plan --auto` terminal operation evolves from the current TicketPlan into a
  schema-valid RoadmapPlan. For new-work planning, the deterministic publisher (not the
  model) creates issues; published tickets carry `Planned-by` lineage and a local
  mirror. For existing-backlog grooming, it versions the roadmap and applies only
  validated projections/deltas — it never recreates issues `[doc+stated]`.
- For a `new-app` scaffold, `plan --auto` requires a current content-bound
  keep/reconcile/remove decision before provider construction or publication. Keep adds
  no disposition-only work; remove forbids regeneration of the optional documents;
  reconcile creates exactly one ordinary Builder/Reviewer documentation unit covering
  all three product documents and makes every implementation unit depend on it. A bare
  template first creates one dependency-free stack-and-gates unit `[doc]`.
- A RoadmapPlan accounts for every considered issue exactly once: one stable workstream
  and delivery unit, or a typed unassigned disposition. Workstreams carry outcome,
  priority, dependencies, blockers, sequencing and WIP. Delivery units carry one-or-
  more ticket membership, one-PR review scope, dependencies, validation-contract ref,
  routing eligibility, and context/cache-affinity facts. Replanning records moves from
  prior stable identities rather than rewriting history `[stated]`.
- Roadmap versions move forward-only `draft → validated → accepted → superseded`.
  A draft/validated version is never scheduling authority; accepting a version is one
  atomic content-hash-bound transition, and an interrupted successor leaves the prior
  accepted version authoritative until recovery either accepts or refuses it.
- One bounded backlog-planning episode consumes one content-hashed snapshot (including
  at least 100 issues in the required fixture), performs selective detail expansion in
  the same planning session, and emits a bounded ready frontier. It does **not** invoke
  one planning episode per issue and does not create delivery EpisodePlans merely to
  rank the backlog `[stated]`.
- Unchanged snapshot regions reuse the prior RoadmapPlan; a later planning run consumes
  a bounded delta plus referenced stable context. Missing, truncated, unavailable, or
  pagination-incomplete input is typed incomplete, never an empty backlog. Cache-hit
  evidence is measured from the adapter; correctness never assumes a hit `[stated]`.
- Delivery EpisodePlans are materialized lazily after readiness and batch admission,
  exactly one per admitted delivery unit. A RoadmapPlan may provide governed workflow-
  template refs and complete creator scopes so that those plans normalize token-free;
  otherwise EpisodePlanner runs only for the admitted unit `[stated]`.
- A complete code ticket may bypass the roadmap-planning provider turn through strict
  deterministic ingestion, but never disappears from the RoadmapPlan: it receives
  stable workstream/delivery-unit membership, priority/dependency accounting and a
  readiness decision. Direct operational units outside the product backlog are governed
  by C-OP-BATCH and may omit RoadmapPlan entirely `[stated]`.
- Fluent prose with no durable plan = episode failure, not partial success (INV-012).
- Scheduled grooming receives a bounded, content-hashed snapshot of open issues without
  an `op:ready` filter. Builder remains `op:ready`-only. Every issue without an active
  lifecycle label receives an explicit readiness disposition; the deterministic
  application admits only fully specified, validation-complete, routing-eligible work
  and leaves risky, blocked, truncated, human-only, or incomplete work unready with a
  typed reason. If any member of a delivery unit is ineligible, the unit is ineligible.
  GitHub routing labels are re-read immediately before readiness publication; an
  unreadable routing state refuses rather than becoming eligible.

## §2a Defects discovered inside delivery
- Builder/Reviewer/SRE-discovered defects may deposit a high-information backlog item
  with exact episode/PR/HEAD, reproduction, evidence, affected contract IDs and a
  creator-scope draft. That is paid-work continuation, not automatic readiness.
- A deterministic orchestrator may mark the item `planning:preplanned` only when it
  also persists a complete validated creator scope or governed template ref. Planner or
  a human still owns priority, workstream/delivery-unit membership, and `op:ready`.
- If the deposited scope is incomplete, the next roadmap-planning session treats it as
  a delta and fills only missing decisions; it never buys a fresh isolated rediscovery
  of the same defect.
- A small Support/event-discovered webpage bug (including input normalized by a future
  Jira adapter) can take a deterministic quick-fix path when it proves: bounded code
  scope, no sensitive/C3/boundary/schema/migration
  change, reproducible expected behavior, explicit acceptance, a governed validation
  template, and normal independent code review. This skips portfolio debate and contract
  re-authoring; it does not skip roadmap accounting, EpisodePlan, gates, or Reviewer.
  This contract does not claim that a Jira adapter currently exists.

## §3 Previews and explanation
- `--dry-run` forms spend zero tokens, construct no runtime, and return
  `exactProviderAuthoredPlan: null` — the preview never impersonates a live plan
  `[doc]` (INV-008).
- `episode explain` is read-only, degrades instead of failing (prints what it read,
  annotates unresolved, exits non-zero when incomplete) `[doc]`.

## §4 Planner boot boundary
- The planner boot turn receives no network or tool authority; deterministic intent
  gathering completes before it runs `[doc]`. Its provider turn settles like any other
  (INV-006).
- Product planning and delivery use one `orchestrateEpisode` entry façade and shared
  plan/admission/execution primitives. Their operation catalogs, validators, prompts,
  handlers and terminal artifacts remain domain-specific; convergence cannot turn a
  RoadmapPlan into a delivery EpisodePlan or vice versa `[stated]`.

## §5 Sources
- Required `--source` inputs: bounded resolution, content-hash, shared secret boundary,
  recorded refs/bytes/trust/selection/truncation before runtime construction; a
  missing/unreadable/rejected/over-budget required source fails closed; emitted tickets
  carry refs + hashes, never source bytes `[doc]`.
- Reconcile requires at least one selected, consumed authoritative `--source` outside
  `docs/VISION.md`, `docs/REQUIREMENTS.md`, and `docs/ARCHITECTURE.md`; the generated
  placeholders cannot authorize their own reconciliation `[doc]`.
- Scheduled GitHub intake distinguishes empty repository, unavailable GitHub, missing
  required executable, and accidental ready-only filtering before provider construction.
