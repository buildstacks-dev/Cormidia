# validation-design/ — START HERE

> **Paged mid-incident? Skip everything below and open
> `operator-triage-runbook.md` now.** <!-- changelog 2026-08-10 (reader test 13,
> operator finding 2): the redirect existed at item 11 and in the warnings; it now
> leads the file. -->

<!-- changelog: added 2026-07-31 after Phase 8 reader test (operator findings 1,2,3,4,5,6,7,9) -->

## What this corpus is — and is not

This is the ratified **design and implementation index** for Cormidia's replacement
validation harness (campaign cormidia-2026-07-31, validation-harness-design skill,
Phases 0–8). The executable implementation lives under `../tests/`; current
machine facts live in the checked `model/*.yaml` graph; authored finding and
decision rationale remain in `harness-design-state.md`. It is **not**:

- **A statement of deployed reality.** Nothing here tells you whether the scheduler is
  installed or an app is live *right now* (finding F-PT-002 — resolved 2026-07-31 with
  a dated snapshot, see ratification-package.md §9; live state still comes from the
  product). For live state, use
  the product: `cormidia scheduler status`, `cormidia status`, `cormidia doctor` — documented
  in the product's `docs/`, not here.
- **A substitute for the operator runbook.** HB-080 is complete: the packaged
  canonical mapping is `../docs/qualification/validation-triage.md`. In-corpus,
  `operator-triage-runbook.md` now carries a self-contained symptom-indexed
  fallback triage map (added 2026-08-10 after the Phase 8 reader test) — the
  canonical product mapping wins on conflict. This corpus still supplies the
  consequence vocabulary (system-map.md §5.2's T-1…T-12 control points — C3-equal
  concentration points, NOT a graded severity ladder; the ladder is C1/C2/C3,
  §5.1/§5.4), invariants, and expected contract behavior. <!-- changelog
  2026-08-10 (reader test 12, operator finding 2): was "severity (…T-1…T-12)". -->
- **Self-contained product truth.** `[doc]`-tagged claims are *derived from* the
  product's `./docs/` corpus, which remains authoritative for command syntax, schemas,
  and paths. This working map makes the derivation surface explicit; it does not
  replace the docs.

## Current authority and generated artifacts

The complete checked graph under `model/` is the sole Validation Architect
machine authority:
`project.yaml`, `owners.yaml`, `sources.yaml`, `structures.yaml`,
`policy.yaml`, `controls.yaml`, `families.yaml`, and `backlog.yaml`.
Any one of those files selects checked-model mode; all eight must then exist and
compile. A partial, corrupt, or mixed graph fails closed and never falls back to
the pre-cutover corpus.

The public compiler generates exactly five Markdown views —
`case-catalog.md`, `harness-backlog.md`, `owner-briefing.md`,
`owner-backlog.md`, and `planned-trace.md` — plus the canonical
`compiler-report.json`. These six files are projections, not authorities.
Never hand-edit them. Edit the checked YAML graph and run:

```bash
pnpm exec validation-architect compile . --write
pnpm validation:trace
```

`../docs/qualification/host-policy.yaml` is a separate Cormidia authority.
It owns only the exact RQ-1 L3 required and conditional family sets and admitted
skipped-test finding identities; Cormidia campaign spend bounds; L-ACC
axis-score semantics and outside-RQ-1 release relationship; the active
revision-catalog registry/content pin; and canonical campaign-binding paths.
It composes tighten-only with the checked graph; neither overrides the other,
and disagreement is refusal.

`migration/` is replay evidence for the one-time cutover. Its legacy inputs,
mapping, ledger, verifier, and retired generator are history-only: no ordinary
ticket, CI gate, campaign, runtime consumer, or rollback reads them in place.
Rollback means reverting the cutover commit so the parent revision's intact
legacy authority is restored.

**History reading rule.** Dated audit reports, trace captures, revision
proposals, elicitation and ratification records, archived operator notes,
golden-case provenance fields, `source-provenance.json`, the frozen
`harness-state.yaml`, and explicitly dated pre-cutover sections retain the
authority paths and commands that were true when captured. Read those
references as historical evidence only; do not rewrite them to pretend the
checked model existed earlier, and do not follow them for current work. The
current section here and `routing.md` govern. If a historical passage is not
clearly separable from a current instruction, treat that ambiguity as a corpus
defect and refuse rather than consulting an archive as a tiebreak.

## Read in this order

1. `scope-and-module-map.md` — what's in scope, module map M1–M18 (M18 Jobs, 2026-08-07). <!-- changelog 2026-08-10 (reader test 30, operator finding 1): stale M1–M17 count -->
2. `system-map.md` — journeys J-01…J-23, state ownership, criticality tier (§5). <!--
   changelog 2026-08-10 (final-gate follow-up 32): read-order entry said J-20,
   disagreeing with the glossary and the map (J-21 L-ACC; J-22/J-23 jobs). -->
3. `invariants.md` — CORMIDIA-INV-001…017 (what must never break).
4. `boundary-map.md` — B-01…B-31, failure modes, honest-fake verdicts. <!--
   changelog 2026-08-10 (reader test 37, operator finding 2): read-order entry
   said B-26, disagreeing with this file's own glossary and the map itself. -->
5. `contracts/` — per-boundary + operation contracts, journey acceptance criteria.
6. `risk-allocation.md` — E-1/E-2/E-3 exhaustive families, thin lanes, spend/soak.
7. `llm-eval-plan.md` + `golden-sets/` — the statistical lane.
8. `model/*.yaml` — the sole machine authority: structures, policy, controls,
   families, tickets, ownership, provenance, and product/version identity.
9. `case-catalog.md` / `harness-backlog.md` / `planned-trace.md` — generated
   reader views. Use them to navigate; edit the corresponding model YAML.
10. `compiler-report.json` — generated compiler identity, exact versions,
    source fingerprint, view inventory, and diagnostics.
11. `operator-triage-runbook.md` — reportable alert classes → operator actions.
    **If you were paged, start HERE, not at item 1** (same rule as the first
    warning below). <!-- changelog 2026-08-10 (reader test 10, operator
    finding 1): the jump instruction lived only in the prose warnings; now also
    inside the numbered list a reader might stop at. -->
12. `threat-model-status.yaml` / `threat-model-template.md` — intentionally blocked
    human-authoring gate for HB-072/HB-073.
13. `routing.md` — current binding repository procedure.
    `agents-md-contribution.md` is the preserved pre-cutover landing proposal,
    not a second instruction source.
14. `harness-design-state.md` — current authored finding/decision register plus
    prior campaign history; `elicitation-log.md` is elicitation/gate history.
14b. `rambling-archive.md` — scope record for the `[rambling]` provenance class:
    every tag minted before 2026-08-10 cites a **superseded** operator ramble that
    the 2026-08-10 evidence sync replaced; those tags resolve there, not against
    the current `./rambling.txt`. <!-- added 2026-08-10, audit rev-2026-08-10,
    AUD-101 -->
15. `ratification-package.md` — what a human must decide to make this binding
    (baseline **ratified 2026-07-31** in §9; the 2026-08-03 revision's pending final
    acceptance packet and reader review are in §10; the rev-2026-08-10 steady-state
    revision record is §12).
16. `harness-state.yaml` — the preserved 2026-08-10 campaign snapshot. It is
    history-only and never an authority or current run-state oracle.
17. `owner-briefing.md` / `owner-backlog.md` — generated, non-normative views.

## Warnings a tired reader needs up front

- **If you were just paged: skip the read order and start at
  `operator-triage-runbook.md`** — its §0 establishes live reality and its §1 is the
  symptom index; come back here only for vocabulary. <!-- changelog 2026-08-10
  (reader test 8, operator finding 5): the runbook sat at position 11 of 17 with
  nothing telling a paged reader to jump. -->

- **Ratified 2026-07-31.** The attributable record is
  `ratification-package.md` §9; the current machine representation is the
  checked model and does not turn old file headers into authority. The
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
- **RQ-1 release gating is active** (PURPOSE v2.16, 2026-08-04). It is deterministic-first and
  <!-- changelog 2026-08-10 (consistency sweep): citation corrected — the current
  PURPOSE header is v2.16; there is no v2.17. -->
  requires exact-candidate L1/L2 plus separately authorized L3/L4 evidence. **B-17's
  generic non-GitHub live-target cell remains future assurance**, not an npm-release
  RQ-1 obligation; it stays visible and may never be called pass.
- **Implemented does not mean evidenced.** L3 live machinery and the extended L5 soak collector
  exist, but no external campaign or seven-day window was run in this implementation
  change. Reviewer, Planner, and Validation Designer golden references were validated
  by `bikramgupta` on 2026-08-04 without replacing agent authorship. Unrun required
  per-candidate L3/L4 evidence is reported incomplete/inconclusive, never green; future
  L5 absence is visible but outside the RQ-1 denominator.
- **Finding posture is model-owned; never trust a prose count over the checked
  graph.** The authored register currently reaches F-PT-039. Five open
  findings park exact family remainders: F-PT-012, F-PT-013, F-PT-014,
  F-PT-015, and F-PT-016. F-PT-018 bounds a known limitation (its CF-HARNESS-CI /
  CF-HARNESS-RELEASE cells DO encode the bounded expected behavior — protected
  human merge plus release-blocking exact-tag rerun; the marker is
  `KNOWN-LIMITATION:F-PT-018`, carried by the matching model
  family/exclusion, not as a blocker). F-PT-033 is an open blocked-contract
  question whose landed parser tests record implementation behavior without
  ratifying it. F-PT-006, F-PT-008, and F-PT-017 were resolved and implemented
  on 2026-08-12; they are not parked work. Current
  blocker/parking status lives in `model/families.yaml` and
  `model/backlog.yaml`; authored finding rationale and decisions live in
  `harness-design-state.md`.
  <!-- changelog 2026-08-10 (audit rev-2026-08-10, AUD-102): was "nine park
  exact cells … the named cell deliberately encodes no expected behavior" —
  false for F-PT-018 specifically, whose cell encodes bounded behavior and
  whose KNOWN-LIMITATION marker the YAML generator did not extract. The nine
  split into 8 parked + 1 known-limitation; generator and YAML now carry it. -->
  <!-- changelog 2026-08-10 (reader test 8, new-engineer finding 5): the compressed
  range notation "006/008/012…018" made the nine un-skimmable; now enumerated. -->
  <!-- changelog 2026-08-10 (consistency sweep): was "Twenty-eight … thirteen …
  F-PT-025…028 parking the four design-only adapter boundaries" — stale: F-PT-025…028
  all resolved 2026-08-07 (ratified/certification/evidence) and the B-23…B-26
  adapters are implemented and certified (#337–#340); their mechanism cells are
  unparked. F-PT-019's rule-level leg is PENDING:HB-135 (resolved-ratified,
  implementation owed), not a parked cell. -->
  <!-- changelog 2026-08-07 (#336): was "Twenty … nine". -->
  If an incident touches one of the five parked seams, the named family
  deliberately encodes **no expected behavior**. That is honesty, not coverage:
  escalate to the human, don't infer. (F-PT-018 differs: its bounded behavior IS
  encoded — apply it, and escalate only a suspected breach of the protected-merge
  bound itself. <!-- AUD-102, audit rev-2026-08-10 -->) F-PT-009/010/011 do not prevent data collection
  but keep quality thresholds inconclusive. F-PT-003/004/007 were ratified 2026-07-31
  (budget-pause convergence:
  pause holds, exactly one item; ambiguous worktree bytes: preserve-and-inspect;
  bootstrap concurrent edit: compare-and-refuse preserving human bytes) — their
  contracts are now encoded. <!-- ratification 2026-07-31: was "five block cases" -->
- **18 of the 38 contract files still read `Status: DRAFT (Phase 4)` in their
  headers — those are BINDING anyway.** The wording is retained deliberately as
  gate-history trace
  (AUD-105 disposition): ratification lives in attributable decision records
  and `ratification-package.md` §9, not in per-file
  headers. Do not down-weight a contract because its header says the Phase-4
  DRAFT label. **The other 20 files declare their real posture
  (RATIFIED/ACCEPTED/PROPOSED/ACTIVE/IMPLEMENTED/design-only/none), and that
  declared posture governs — proposed/design-only surfaces (e.g. B-18/B-19)
  are not upgraded by this warning.** <!-- scoped 2026-08-10 (final-gate
  follow-up 21): the warning previously read as a universal over all contract
  files. -->
  <!-- changelog 2026-08-10 (reader test 6, new-engineer finding 2): cold-opening
  a contract gave no signal; the warning now lives at the corpus entry point. -->
- **One stated top-tier promise currently lacks its mechanical enforcement:**
  INV-003's "outside-worktree actions are never broadly scopeable" has no rule
  mapping in `NEVER_SCOPEABLE_RULES` (**F-PT-014, open**) — the nearest live
  classes are human-widenable today. The promise is real, the guardrail leg is
  parked; details in operator-triage-runbook.md §1.5.
  <!-- changelog 2026-08-10 (reader test 3, operator finding 3): surfaced here —
  was findable only through case-catalog blocked-cell footnotes. -->
- **`inconclusive` is currently the only possible verdict for every quality
  threshold** (F-PT-009/010/011; eval-plan §9). Reading `inconclusive` as "probably
  fine" is wrong: it means *no gate exists here yet, by design*.
- **The outcome-acceptance lane (L-ACC) is built and has run once** (registered
  2026-08-07; run 1 terminal 2026-08-08). Run 1 stopped at the unchanged rubric §6
  plan gate with an entirely ungraded/inconclusive official distribution and incomplete
  scenarios (`../acceptance/run-1-result.md`). Do not cite it in a release claim or
  represent it as a release gate. Its rubric (`../acceptance/rubric.md`) is
  human-ratified, tighten-only and still declares **no thresholds**. F-PT-029 keeps
  L-ACC permanently outside RQ-1; F-PT-030 permits unattended gate resolution only
  through a declared policy under the unchanged criteria and envelope.
- **Jobs (M18) are offline-provable and not outcome-validated.** The B-30/J-22/J-23
  families clear the `docs/jobs/design.md` §14 structural debt, but they prove the
  machinery — ordering, resume, refusal, settlement, handoff — and nothing about whether
  a job's output was any good. Job step quality has **no** statistical lane by design.

## ID glossary (one page, all namespaces)

| Prefix | Meaning | Defined in |
|---|---|---|
| `[doc]` `[elicited]` `[walk]` `[rambling]` `[simulated]` `[stated]` `[PROPOSED]` | provenance tags on clauses/values — `[doc]` derived from the product's ratified `./docs/` (strongest); `[elicited]`/`[walk]` the AI stakeholder's campaign input (elicitation sessions / recorded walkthroughs), mostly doc-grounded — not necessarily owner answers; `[rambling]` traceable to the owner's own notes (real human input, unratified; pre-2026-08-10 tags cite the **superseded** 2026-07-31 ramble — resolve via `rambling-archive.md`, not the current `./rambling.txt` <!-- AUD-101, audit rev-2026-08-10 -->); `[simulated]` the AI stakeholder's own judgment beyond docs/rambling, pending real-human ratification — every one needs human eyes; `[stated]` direct live owner input (present in earlier ratified rows; rev-2026-08-10 minted none — no live human sat); `[PROPOSED]` designer-originated provisional values or structures (e.g. B-06/B-07) — provisional numbers never produce pass/fail until ratified <!-- glossary row added 2026-08-10 (reader test 17, operator finding 4); corrected same day (final-gate follow-up 6): first version drifted from canonical §2 on [elicited]/[walk], [PROPOSED] scope, and [stated] --> | ratification-package.md §2 (canonical); llm-eval-plan.md §9 for `[PROPOSED]` number semantics |
| `M1…M18` | modules (M18 Jobs, 2026-08-07) | scope-and-module-map.md §2 |
| `J-01…J-23` | journeys (J-21 outcome-acceptance campaign; J-22/J-23 jobs, aliases J-JOB-1/2) | system-map.md §1.3 |
| `T-1…T-12` | C3 control points (function-scoped risk) | system-map.md §5.2 |
| `CORMIDIA-INV-001…017` (alias INV-NNN) | **product** invariants | invariants.md |
| `CORMIDIA-INV-ACC-1…7b` (alias INV-ACC-n) | **campaign** invariants — harness-scoped, deliberately fenced from the product set | invariants.md, final section |
| `B-01…B-31` (B-09a/b split; B-23…B-26 adapter; B-27/28/29 L-ACC; B-30 jobs — alias `B-JOB`; B-31 governed planning-source scope) | boundaries | boundary-map.md |
| "adapter" (the word, two senses) | *interface adapters* (CLI/JSON/UI — NOT boundaries) vs *provider adapters* (B-02…04, B-23…26 — real boundaries); the word never decides the category, the state-ownership test does <!-- glossary row added 2026-08-10 (reader test 31, operator finding 4): the disambiguation lived only in boundary-map's preamble --> | boundary-map.md terminology note |
| `CORMIDIA-C-…-001` (aliases B-NN, C-OP-*) | contracts | contracts/ headers + journey-acceptance.md alias table |
| `S-1…S-11` | LLM call sites (S-8 comparative selection; S-10 validation design; S-11 acceptance grader) | llm-eval-plan.md §1 |
| `E-1/E-2/E-3, STD, THIN, FLOOR, L4Q` | risk allocation vocabulary | `risk-allocation.md` §2 (authored rationale) + checked model family/policy fields |
| `L-ACC` | the outcome-acceptance lane | `model/policy.yaml` + matching structures/families; axis scoring and outside-RQ-1 relationship in `../docs/qualification/host-policy.yaml` |
| `S-ACC-1…3` | acceptance scenarios | ../acceptance/scenarios/ |
| `CF-*` | case families | `model/families.yaml` (authority); generated `case-catalog.md` (view) |
| `L1…L5`, `L-ACC` | validation layers — L1 invariant/contract (deterministic, no IO), L2 hermetic composition (sealed nondeterminism), L3 live sandbox (real seams), L4 eval/qualification (statistical), L5 ops hardening (soak/contention/rotation/abuse), L-ACC outcome acceptance (scored vs human-ratified rubric, triggered-only) <!-- glossary row added 2026-08-10, reader test 2 (new-engineer finding 4, coding-agent finding 4): the taxonomy was used everywhere but defined nowhere in one place --> | `model/policy.yaml`; Cormidia spend bounds in `../docs/qualification/host-policy.yaml` |
| `HB-*` | backlog tickets (including split outputs and finding-parked work) | `model/backlog.yaml` (authority); generated `harness-backlog.md` (view) |
| `F-PT-001…` | product-truth findings | `harness-design-state.md` (authored rationale/decision history) + affected model family/backlog blockers |
<!-- changelog 2026-08-10 (consistency sweep): HB row was "HB-130 parked on human
authorization + F-PT-029/030" — stale: both findings resolved 2026-08-07 and
HB-120…132 completed 2026-08-08; F-PT range extended at the sweep to …032, then
to …033 later the same day when F-PT-033 was minted at final-gate follow-up 10 —
the row above is the current truth. Corrected per AUD-104 (audit
rev-2026-08-10): this comment's bare "…032" sat three lines under the …033 row,
two same-dated contradictory range statements at the corpus entry point. -->

## Resolved-finding mirror

Thirty-nine product-truth findings are tracked; five park exact cells. If an
incident touches one of the five parked seams, preserve the named blocker and
escalate rather than inventing behavior. HB-P3/P5/P6 unparked and LANDED
2026-08-12; HB-P7 remains parked. The 2026-08-16 owner clarification excludes
transport filename and producer id while every other raw validated field stays
identity-bearing. The complete authored finding range is `F-PT-001…039`.
