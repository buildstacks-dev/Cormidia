# Operation contract — C-OP-PLAN (episode planning operations)
Canonical ID: **CORMIDIA-C-OPPLAN-001 (alias: C-OP-PLAN)**

Status: DRAFT (Phase 4). Added on stakeholder trace audit. Covers the EpisodePlanner
boundary operations: `previewEpisode` / `orchestrateEpisode` / `explainEpisode`,
`plan --auto`, `plan --creator-scope --execution-ready`, plan validation/persistence,
TicketPlan publication. Defends INV-008/012, M5. Journey J-03. Interfaces with
B-01/B-02..04/B-10.

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

## §2 Plan production
- Output: schema-validated, versioned EpisodePlan persisted **before** the first
  delivery turn; DAG order deterministic; each provider step carries one indivisible
  assignment tuple; revisions bounded, versioned, forward-only `[doc]`.
- `plan --auto` terminal operation emits a schema-valid TicketPlan; the deterministic
  publisher (not the model) creates issues; published tickets carry `Planned-by`
  lineage + `published-tickets.json` mirror; dependencies + acceptance criteria per
  ticket; only dependency-free tickets `op:ready` `[doc]`.
- Fluent prose with no durable plan = episode failure, not partial success (INV-012).

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

## §5 Sources
- Required `--source` inputs: bounded resolution, content-hash, shared secret boundary,
  recorded refs/bytes/trust/selection/truncation before runtime construction; a
  missing/unreadable/rejected/over-budget required source fails closed; emitted tickets
  carry refs + hashes, never source bytes `[doc]`.
