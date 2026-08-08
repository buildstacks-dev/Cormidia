# Phase 0 — Scope declaration and module map (Cormidia)

Status: ratified 2026-07-31 baseline plus surgical harness revisions: comparative
execution direction confirmed by the owner 2026-08-01, and roadmap/validation/delivery-
batching confirmed through Phase 7 on 2026-08-03. Existing module judgments stay
unchanged; M16 and M17 are the additions. The 2026-08-03 revision passed Phase 8
acceptance and is not an implementation claim.

Harness revision 2026-08-07 (outcome acceptance + jobs): **M18 — Jobs** is the only
module addition; it clears the structural debt `docs/jobs/design.md` §14 recorded when
`cormidia-job` shipped (#359). The outcome-acceptance lane (L-ACC) adds **no module**
by mapping judgment 1 below. Design input: `acceptance/` (rubric human-ratified
2026-08-07, tighten-only) and the superseded `jobs-harness-revision-proposal.md`,
whose internal ID choices (M18 kept; B-23/J-21/J-22/F-PT-025 **collided** with the
2026-08-07 #336 adapter revision and are renumbered here — see that file's header).
Provenance labels: `[doc]` = derivable from ./docs/ · `[rambling]` = ./rambling.txt (cited) ·
`[simulated]` = stakeholder judgment beyond docs/rambling · `[PROPOSED]` = designer-originated.
`[stated]` = direct live owner input; absent from the closed 2026-07-31 campaign and
used only on the owner-confirmed 2026-08-01 comparative-execution direction.

## 1. Scope declaration

- **Mode:** `product` — whole-system harness design for production Cormidia. No parent
  harness; nothing to inherit. `[doc]`
- **Posture:** clean-slate greenfield. The incumbent suite is archived under
  `archive-do-not-read/**` (PURPOSE v2.9) — frozen, never read, cited, run, or used as a
  design cue. There is no coexistence posture; instead `archive-do-not-read/**` is a
  **protected no-read path**, ratified in `validation-policy.yaml`. `[doc]`
- **Artifact roots:** design artifacts in `./validation-design/` (this campaign);
  eventual implementation root `tests/` (PURPOSE v2.9) — specified in
  `harness-backlog.md`, not built here. `[doc]`
- **ID namespace:** `CORMIDIA-` (`CORMIDIA-INV-NNN`, `CORMIDIA-B-NNN`, `CORMIDIA-C-<boundary>-NNN`).
  A later module-scope deep pass mints its own prefix and inherits by reference. `[PROPOSED, accepted by stakeholder]`
- **Release-gating replacement** is a **campaign/policy obligation, not a product module**:
  RQ-1 is active under PURPOSE v2.17; the archived qualification machinery is not an
  active module; the replacement harness policy carries the qualification obligation,
  proportionately (`[rambling: "I do not want the 83-contract apparatus back"; "something I
  trust AND afford"]`). Active release-*handoff* behavior remains under the build-loop and
  approvals boundaries. `[doc]` + stakeholder correction.
- **Unattended runnability** of the live-sandbox layer — zero human approval decisions,
  sandbox orgs only, external publishing and non-sandbox repos still hard-gated, via a
  designed and ratified test-mode policy profile — is a first-class layer-3 requirement.
  `[doc: PURPOSE v2.9]` `[rambling: "hard requirement ... ZERO human approval decisions"]`
- **Fast mode:** declined by stakeholder. Every concept (invariants, boundaries, contracts,
  eval layers, risk tiers) gets full teach-first treatment.
  The surgical 2026-08-03 harness revision separately uses owner-confirmed fast mode;
  it preserves the baseline and revisits only affected artifacts.
- **Criticality:** deliberately **not declared here**. Rev 1 carried a provisional
  criticality column; the stakeholder struck it as pre-empting the Phase 1 teach-first tier
  discussion. Tiering happens in Phase 1 (teach, then elicit) and risk weighting in Phase 6.
  Nothing in this file is a risk anchor.

## 2. Module map (ratifiable)

Product scope on a system this size is broad-and-shallow: this campaign owns cross-cutting
invariants and inter-module boundaries. "Deep pass" = warrants its own later module-scope
campaign with this skill. All rows `[doc]` unless noted.

| # | Module | What it owns (source) | Later deep pass? |
|---|---|---|---|
| M1 | **Critical-ops gate** | `GateFn`; action-aware effect classifier; the **never-broadly-scopeable list** (production deploys, external publication, protocol-surface writes, outside-worktree actions — each may still receive a fresh, content-bound, one-off approval, e.g. the A4 release executor and per-payload publication acknowledgement, but never a widened rule/path grant); **self-merge / self-approval separately forbidden and unrepresentable at any scope**; CLI-as-effect-surface classification (`src/runtime`, `docs/approvals/design.md`) | Yes |
| M2 | **Approvals & grants** | CLI queue; content-bound decisions; approve ≠ execute; grant scoping/TTL/use-count; typed orchestrator-owned execution allowlist; `approved → executing → executed\|failed\|ambiguous`; budget-exceeded items (`src/org/approvals`) | Yes |
| M3 | **Budget & ledger** | exactly-once provider-turn settlement; monthly caps + overlay; 80%/100% behavior; `budget --reconcile`; equivalent-cost estimates flagged as such | Yes |
| M4 | **Build loop & merge integrity** | ticket state machine; passes/briefs/verdicts; mechanical quality gates; **orchestrator-only squash-merge**; **HMAC-verified exact-commit single-account review authorization** (placed here per stakeholder: a merge-integrity mechanism, not the approval queue); GitHub conventions — labels flip only after artifacts exist (`src/loop`) | Yes |
| M5 | **EpisodePlanner boundary** | bounded intent; creator-scope-only planner bypass; plan validation/persistence; DAG execution order; forward-only revisions; no-network planner boot | Yes |
| M6 | **Dispatcher & scheduler** | stateless tick; due arithmetic; locks + org WIP; event polling + file-drop inbox (closed kind registry); exactly-once event consumption; scheduler install/status/uninstall evidence; daily retention sweep; execution-batch admission over an already-valid ready frontier (grouping is optimization, never workflow authority) | Yes |
| M7 | **Runtime adapters** | claude/codex/pi behind one Runtime interface; atomic harness/model/effort assignment; adapter-level gate conformance; session resume; tool events; capability matrix; documented degradations | Yes |
| M8 | **Secret boundary** | the shared secret-pattern list governing scanning, scrubbing, bounded previews, exports, and capture-time redaction. **Scope corrected by stakeholder:** L3 evidence (`brief.md`, `prompt.md`, `output.md`, `session.log`) is intentionally verbatim local evidence and may contain sensitive material; "everything redacts through it" is NOT the ratified claim — see finding F-PT-001 | Folded into product-level invariants (small surface) |
| M9 | **Turn lifecycle & durable state** | turn journals (crash-recovery source of truth); org-managed clones + worktrees; recovery at artifact boundaries; four idempotency rules; uncommitted-work preservation (`[rambling: "the next turn must not eat it"]`) | Yes |
| M10 | **Org/app lifecycle** | org init/upgrade/use atomicity + rollback; bootstrap/new-app; **app reset** (archive-backed destruction across local state and GitHub artifacts); verify/promote evidence ladder; invocation journal/audit | **Yes** (stakeholder: reset is destruction; init/upgrade/promote make atomicity + evidence-ladder claims) |
| M11 | **Authority & governed configuration** (added on stakeholder objection) | `AUTHORITY.md` (versioned grant, profiles, legacy fail-closed); app-only narrowing; role permissions in `roles.yaml`; ratified surfaces `TASTE.md`, `pipelines.yaml`, `prompts/**`, `apps.yaml`; gate composition of grants; the central prohibition: **agents never rewrite their own authority/protocol surfaces** — proposal-only | Yes |
| M12 | **Context assembly & memory** | fixed-order concatenation; narrower-layers-specialize-never-override (guarantee enforced by gate, M1/M11); pinned excerpts / prompt-prefix stability; OKF bundles; orchestrator-written scorecards | Maybe |
| M13 | **Learning loop** | capture → episodes/capsules → distillation → cross-provider review → deterministic publisher → offline paired replay → human-started canary | Yes (own later pass; large). **In this campaign, broad-and-shallow but not dismissed as low-stakes — it is a persistent prompt-injection surface.** Product-level coverage must preserve at minimum: candidates never resolve; agents never write gate-protected surfaces; the deterministic publisher is the sole protected writer; authorization never masquerades as validation; agent self-reports never drive promotion metrics; T3 has no live canary. (Stakeholder-directed floor.) |
| M14 | **Observe / report / narrative** | read-only presentation leaves; ledger-first reports. **Explicit confidentiality slice (stakeholder-directed):** loopback-only bind; per-process capability enforcement; no mutation routes; traversal/symlink confinement; no raw L3 in snapshots or SSE (explicit local fetch only); capture-time redaction for long-lived narratives | No — product-level coverage with the confidentiality slice |
| M15 | **CLI surface** | subcommand dispatch; `--json` error contract (`ok:false`, stable `error.code`); dry-run token-free/write-free claims (audit row sole exception); exit codes | No — adapter-conformance coverage at product level |
| M16 | **Comparative execution** `[stated+PROPOSED]` | Per-provider-turn candidate-set planning; frozen-input identity; isolated candidate workspaces; operation-specific evidence; blinded selection; durable winner materialization; the shared core behind EpisodePlan comparison and standalone `cormidia compare` (`docs/comparative-execution/design.md`) | Yes — new state machine, selection judge, workspace and continuation seams |
| M17 | **Roadmap and validation planning** `[stated]` | bounded whole-backlog snapshot; stable workstreams; delivery-unit membership; dependencies/priority/WIP; bounded ready frontier; validation-contract authoring and explicit waivers; deterministic label/trailer projections; incremental replanning without full-backlog rediscovery | Yes — new durable planning state and the admission seam for M5/M6 |
| M18 | **Jobs** `[doc: docs/jobs/design.md]` (added 2026-08-07) | ad-hoc dependency-ordered step graphs behind the second binary `cormidia-job`; job config authority and the run journal; per-step assignment under the `operator` role ceiling; declared output checks; human checkpoints; app-scoped and unscoped modes; the separate job budget envelope. Deliberately **outside** the governed build loop: no Reviewer, no typed verdicts, no ticket machine, no GitHub (`docs/jobs/design.md` §3) | No — product-level coverage; small surface, one new durable store (the journal), no new state machine beyond it |

Mapping judgments (ratified with this map):

1. **The harness itself is a system-under-design, not a Cormidia module.** Its self-tests,
   negative controls, and unattended-runnability requirement come from the skill's rules and
   land in the backlog and policy file. **The 2026-08-07 outcome-acceptance lane (L-ACC)
   is therefore not a module row either** — it is harness machinery that drives the
   product through its shipped binaries. Its journey (J-21), boundaries (B-27/B-28/B-29)
   and campaign invariants (`CORMIDIA-INV-ACC-*`) exist so the lane is designed rather
   than improvised, not because Cormidia grew a subsystem.
2. **GitHub is substrate, not a module** — an external boundary in Phase 3, alongside the
   three model providers and the OS timer.
3. **Release-gating replacement** — campaign/policy obligation (see §1), not a module row.
4. **Standalone comparison is an adapter, not a second module.** `cormidia compare` enters
   M16 directly with an operator-declared one-step intent; EpisodePlan-backed comparison
   enters the same coordinator from M5/M4. Their parsing and authority sources differ,
   but candidate execution, evidence, selection, accounting, and materialization do not.

## 3. Findings opened at Phase 0

- **F-PT-001 (product truth, resolved-by-docs, recorded per protocol):** rambling asserts
  "there's one secret-pattern list and everything redacts through it. If a token ever lands
  in a provider prompt or a run log we have failed" `[rambling]`. The docs say L3
  `brief.md`/`prompt.md`/`output.md`/`session.log` are intentionally **verbatim** local evidence; the
  shared secret-pattern list governs scanning, scrubbing, bounded previews, exports, and
  capture-time redaction — not blanket redaction of every brief `[doc: architecture §1
  runs/ layout; live-ui/reporting contracts]`. Docs win; the invariant work in Phase 2 must
  target the *documented* redaction surfaces, and the broader aspiration stays visible here
  as an unratified value signal.
- **F-PT-002 (product truth — resolved 2026-07-31):** the current active org's registry and scheduler state
  were **unknown from this corpus**. The packaged `apps.yaml` is a template (it lists
  alpha + marketplace-demo `live`; beta/gamma/delta/buildstacks.dev `onboarding`), not proof
  of the active org. "Always-on" is too strong: autonomous scheduling requires installed,
  healthy scheduler evidence. The harness design must not assume a live scheduled
  deployment as a current fact; deployment shape for design purposes is: laptop-first,
  OS-timer-driven **when installed**, one runtime over N apps, later droplet migration.
  **Resolved at ratification (verified read-only 2026-07-31):** the active org selector
  `~/.cormidia/config` points org_home=/Users/bikram/Build/sonnet1-org,
  state_home=~/.cormidia/Buildstacks (recorded 2026-07-24); that org has exactly one
  registered app, sonnet8-buildstack-dev (repo buildstacks-dev/sonnet8-buildstack-dev),
  status live; the scheduler is NOT installed (no scheduler state dir, no cormidia
  launchd jobs) — all turns are human-invoked; two residual partial state homes
  (~/.cormidia/cormidia — dogfood-era residue; ~/.cormidia/questionnaire — partial
  onboarding residue) are not active orgs.
  <!-- ratification 2026-07-31: F-PT-002 resolved with these facts. -->
