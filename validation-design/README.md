# validation-design/ — START HERE

<!-- changelog: added 2026-07-31 after Phase 8 reader test (operator findings 1,2,3,4,5,6,7,9) -->

## What this corpus is — and is not

This is the ratified **design and implementation index** for Cormidia's replacement
validation harness (campaign cormidia-2026-07-31, validation-harness-design skill,
Phases 0–8). The executable implementation lives under `../tests/`; current
machine-vs-evidence status is recorded in `harness-design-state.md`. It is **not**:

- **A statement of deployed reality.** Nothing here tells you whether the scheduler is
  installed or an app is live *right now* (finding F-PT-002 — resolved 2026-07-31 with
  a dated snapshot, see ratification-package.md §9; live state still comes from the
  product). For live state, use
  the product: `cormidia scheduler status`, `cormidia status`, `cormidia doctor` — documented
  in the product's `docs/`, not here.
- **A substitute for the operator runbook.** HB-080 is complete: use
  `operator-triage-runbook.md`, which points to the packaged canonical mapping at
  `../docs/qualification/validation-triage.md`. This corpus still supplies severity
  (system-map.md §5.2, T-1…T-12), invariants, and expected contract behavior.
- **Self-contained product truth.** `[doc]`-tagged claims are *derived from* the
  product's `./docs/` corpus, which remains authoritative for command syntax, schemas,
  and paths. This working map makes the derivation surface explicit; it does not
  replace the docs.

## Read in this order

1. `scope-and-module-map.md` — what's in scope, module map M1–M17.
2. `system-map.md` — journeys J-01…J-20, state ownership, criticality tier (§5).
3. `invariants.md` — CORMIDIA-INV-001…016 (what must never break).
4. `boundary-map.md` — B-01…B-26, failure modes, honest-fake verdicts.
5. `contracts/` — per-boundary + operation contracts, journey acceptance criteria.
6. `risk-allocation.md` — E-1/E-2/E-3 exhaustive families, thin lanes, spend/soak.
7. `llm-eval-plan.md` + `golden-sets/` — the statistical lane.
8. `case-catalog.md` — every derived case family, matrix-closed.
9. `validation-policy.yaml` — the machine-readable contract (audit diff surface).
10. `harness-backlog.md` — ticket-shaped build plan (walking skeleton first).
11. `operator-triage-runbook.md` — reportable alert classes → operator actions.
12. `threat-model-status.yaml` / `threat-model-template.md` — intentionally blocked
    human-authoring gate for HB-072/HB-073.
13. `agents-md-contribution.md` — repo routing (ratified 2026-07-31; binding once
    landed in AGENTS.md).
14. `elicitation-log.md` / `harness-design-state.md` — provenance and gate history.
15. `ratification-package.md` — what a human must decide to make this binding
    (baseline **ratified 2026-07-31** in §9; the 2026-08-03 revision's pending final
    acceptance packet and reader review are in §10).

## Warnings a tired reader needs up front

- **Ratified 2026-07-31** (`validation-policy.yaml` `design_status: ratified`). The
  stakeholder seat this campaign was an AI grounded in docs + the owner's notes; the
  product owner ratified the package in session on 2026-07-31 — explicit decisions
  vs ratified-by-adoption are distinguished in ratification-package.md §9.
  <!-- ratification 2026-07-31: was "Everything here is DRAFT pending human
  ratification" -->
- **Comparative execution is a proposed 2026-08-01 extension, not implemented or
  included in the 2026-07-31 green evidence.** Its direction is owner-confirmed;
  M16/J-19/B-18/B-19/S-8 and HB-090…094 make the implementation obligations visible.
  `docs/comparative-execution/design.md` is the product-facing contract.
- **Roadmap/validation/delivery-unit/batching is an accepted 2026-08-03 implementation
  contract, not included in prior green evidence.** Phase 8 is closed; HB-100's local
  provider-free walking skeleton, HB-101's whole-backlog authority, HB-102's
  validation-contract/readiness guard, and HB-103…107's production delivery-unit,
  execution-batch, strict zero-turn, direct-campaign, shared-façade and role-safe
  session/cache slices are executable. HB-108 closes the deterministic catalog and
  integrates the now-human-validated pre-tuning corpora; HB-109 closes contention and soak-
  collector machinery without running the campaign; HB-110 closes shared operator
  explanations. HB-111 and all separately named human/external evidence remain.
  M17/J-20/INV-016/B-20…22/S-10 and the two new operation contracts are only as
  evidenced as their named landed cases; no live evidence is implied.
- **RQ-1 release gating is active** (PURPOSE v2.17). It is deterministic-first and
  requires exact-candidate L1/L2 plus separately authorized L3/L4 evidence. **B-17's
  generic non-GitHub live-target cell remains future assurance**, not an npm-release
  RQ-1 obligation; it stays visible and may never be called pass.
- **Implemented does not mean evidenced.** L3 live machinery and the extended L5 soak collector
  exist, but no external campaign or seven-day window was run in this implementation
  change. Reviewer, Planner, and Validation Designer golden references were validated
  by `bikramgupta` on 2026-08-04 without replacing agent authorship. Unrun required
  per-candidate L3/L4 evidence is reported incomplete/inconclusive, never green; future
  L5 absence is visible but outside the RQ-1 denominator.
- **Twenty-eight product-truth findings are tracked; thirteen still park exact cells**
  (F-PT-006/008/012…018, and F-PT-025…028 parking the four design-only adapter
  boundaries' gate-seam mechanism cells — B-23…B-26, added 2026-08-07 #336).
  <!-- changelog 2026-08-07 (#336): was "Twenty … nine". -->
  If an incident touches one of those seams, the named cell
  deliberately encodes **no expected behavior**. That is honesty, not coverage:
  escalate to the human, don't infer. F-PT-009/010/011 do not prevent data collection
  but keep quality thresholds inconclusive. F-PT-003/004/007 were ratified 2026-07-31
  (budget-pause convergence:
  pause holds, exactly one item; ambiguous worktree bytes: preserve-and-inspect;
  bootstrap concurrent edit: compare-and-refuse preserving human bytes) — their
  contracts are now encoded. <!-- ratification 2026-07-31: was "five block cases" -->
- **`inconclusive` is currently the only possible verdict for every quality
  threshold** (F-PT-009/010/011; eval-plan §9). Reading `inconclusive` as "probably
  fine" is wrong: it means *no gate exists here yet, by design*.
- **The outcome-acceptance lane (L-ACC) is designed and NOT built** (registered
  2026-08-07). No runner exists, no campaign has run, and no L-ACC evidence exists — do
  not cite it in a release claim or represent it as an existing gate. Its rubric
  (`../acceptance/rubric.md`) **is** human-ratified and tighten-only, and it deliberately
  declares **no thresholds**; a ratified rubric measures nothing until something runs
  against it. Its two open questions are F-PT-029 (can a scored lane ever be release
  evidence) and F-PT-030 (may an unattended campaign auto-continue past a scored plan
  gate); both carry a fail-closed interim that is an interim, not an answer.
- **Jobs (M18) are offline-provable and not outcome-validated.** The B-30/J-22/J-23
  families clear the `docs/jobs/design.md` §14 structural debt, but they prove the
  machinery — ordering, resume, refusal, settlement, handoff — and nothing about whether
  a job's output was any good. Job step quality has **no** statistical lane by design.

## ID glossary (one page, all namespaces)

| Prefix | Meaning | Defined in |
|---|---|---|
| `M1…M18` | modules (M18 Jobs, 2026-08-07) | scope-and-module-map.md §2 |
| `J-01…J-23` | journeys (J-21 outcome-acceptance campaign; J-22/J-23 jobs, aliases J-JOB-1/2) | system-map.md §1.3 |
| `T-1…T-12` | C3 control points (function-scoped risk) | system-map.md §5.2 |
| `CORMIDIA-INV-001…016` (alias INV-NNN) | **product** invariants | invariants.md |
| `CORMIDIA-INV-ACC-1…7b` (alias INV-ACC-n) | **campaign** invariants — harness-scoped, deliberately fenced from the product set | invariants.md, final section |
| `B-01…B-30` (B-09a/b split; B-23…B-26 adapter, 2026-08-07; B-27/28/29 L-ACC and B-30 jobs — alias `B-JOB` — 2026-08-07) | boundaries | boundary-map.md |
| `CORMIDIA-C-…-001` (aliases B-NN, C-OP-*) | contracts | contracts/ headers + journey-acceptance.md alias table |
| `S-1…S-11` | LLM call sites (S-8 comparative selection; S-10 validation design; S-11 acceptance grader) | llm-eval-plan.md §1 |
| `E-1/E-2/E-3, STD, THIN, FLOOR, L4Q` | risk allocation vocabulary | risk-allocation.md §2, case-catalog.md header |
| `L-ACC` | the outcome-acceptance lane (layer key on case-catalog §8b rows) | validation-policy.yaml `l_acc_lane` |
| `S-ACC-1…3` | acceptance scenarios | ../acceptance/scenarios/ |
| `CF-*` | case families | case-catalog.md |
| `HB-*` | backlog tickets (HB-P* = finding-parked ids; HB-P1/P2/P4 unparked 2026-07-31, HB-P3/P5 still parked; HB-130 parked on human authorization + F-PT-029/030) | harness-backlog.md |
| `F-PT-001…031` | product-truth findings | harness-design-state.md + validation-policy.yaml `open_findings` |
