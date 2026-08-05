# LLM eval plan — Cormidia (product scope)

Status: CONFIRMED at the Phase 5 gate (2026-07-31, round 4); human-ratified 2026-07-31 (F-PT-009/010/011 thresholds remain open — the inconclusive-only rule stands; ratification-package.md §9). <!-- AUD-105 -->
Provenance: `[elicited]` = stakeholder Phase 5 ramble; `[doc]`; `[rambling]` cited;
`[PROPOSED]` provisional (owner: human; expiry: first eval-campaign design review).
Grounding rule: the archived qualification machinery is prohibited design input; where
0–8 artifact scoring or campaign semantics are cited, the citation is the **live
contract** `docs/qualification/design.md` (canonical record; machinery archived,
gating suspended) `[doc]`.

Harness revision 2026-08-01: comparative execution adds S-8, the operation-specific
selection judge. It is a judge site and therefore inherits the calibration rule. Its
threshold/sample design stays under F-PT-011; all scores are advisory/inconclusive
until ratified.

Harness revision 2026-08-03: S-1a becomes roadmap/portfolio planning over bounded large
backlogs; S-1b remains per-delivery-unit Episode workflow planning; new S-10 is the
validation-design pass required before readiness. Complete creator scopes/templates are
deterministic normalization paths, not LLM sites. Batch construction is likewise
deterministic; model-generated affinity is advisory Planner output, never admission.

## 0. Standing rules (apply to every site)

1. **Two layers, never collapsed.** Contract layer: deterministic, mocked provider,
   layers 1–2, every commit, always green — tests our code. Quality layer: committed
   golden set + rubric + threshold over N runs, layer 4 — prompt/model change, rotating
   nightly shards, release qualification.
2. **Guardrails enforce; evals measure** (INV-012, skill rule 5). Anything serious
   enough to demand literal perfection becomes a deterministic gate where possible —
   "the Reviewer usually notices secret leakage" is never security architecture
   `[elicited]`; secret containment is INV-011's guardrail.
3. **Stochastic claims get statistical designs** — a sample size and threshold, or
   explicit human judgment; never a one-shot pass/fail coin flip that can block a
   release `[rambling: Phase-6 coin-flip gate]`. Campaign verdicts are
   `pass | fail | inconclusive`.
4. **Qualification attaches to the complete assignment tuple** (harness, model,
   effort — and for review, the builder/reviewer pairing), never to a provider logo;
   pairs are never pooled into one comforting average `[elicited]`.
5. **Golden sets are authored and committed before prompt tuning** (skill rule 6) and
   double as the model-swap regression suite.
6. **Economics:** offline/hermetic first; every token-spending campaign declares a
   token ceiling and preserves partial evidence when the ceiling stops it; nightly work
   rotates committed shards rather than re-running everything `[elicited]`
   `[rambling: "trust AND afford"]`.
7. **Trust boundary:** agent self-reported success is advisory; it never feeds
   promotion, canary, or quality metrics (INV-012).

## 1. Call-site inventory (families → sub-sites)

Family map corrected per elicitation: same role ≠ same output contract or rubric.

| Site | Sub-site | Type |
|---|---|---|
| S-1 Planning | S-1a roadmap planning (large-backlog workstreams, delivery units, priority, ready frontier, advisory affinity) · S-1b EpisodePlanner workflow design (one admitted code or direct operational execution unit) | planner |
| S-2 Builder | S-2a contract pass · S-2b implement pass · S-2c fix/remediation pass | agentic worker |
| S-3 Reviewer | S-3a ordinary review · S-3b ship-check review | judge |
| S-4 SRE | S-4a scheduled health analysis · S-4b event-driven incident analysis | analyzer |
| S-5 Audience | S-5a Support drafts · S-5b Marketing launch/changelog content · S-5c Marketing adoption/competitive analysis | drafter/analyzer |
| S-6 Distiller | (single) | synthesizer |
| S-7 Learning Reviewer | (single) | judge |
| S-8 Selection Judge | S-8a Builder change · later operation-specific policies for Planner/Reviewer/SRE/Audience | judge |
| S-9 Format-repair retry | (single; same-session structure repair) | **contract-only** — valid structure is the whole job; no elegance rubric `[elicited]` |
| S-10 Validation Designer | validation obligations for one or more compatible delivery units before readiness; capability/pass, not a free-running org role | planner or separately configured validation-design assignment |

**Not a call site — conditioning surface:** brief/context assembly. Broken = wrong app,
wrong authority, missing required source, undisclosed truncation, runtime constructed
after required-source failure — all deterministic (INV-001/004, C-OP-PLAN §5, layers
1–2). "Not great" = bloated/badly selected/technically-complete-but-unhelpful —
evaluated **separately** as a conditioning-quality study correlated with downstream
site performance, never pretended to be another model `[elicited]`.

## 2. Per-site plans

Format per llm-eval-patterns: contract layer (deterministic, every commit) · quality
layer (golden set, rubric axes, threshold, cadence) · calibration/trajectory
obligations. Broken/not-great lines are the stakeholder's `[elicited]`.

### S-3 Reviewer — **first-funded golden set** `[elicited: "where plausible green
becomes merged reality"; PR #182 the emotional center]`
- **Contract (L1/2):** exactly one structured `VERDICT: APPROVE|REJECT` marker; parser
  refuses zero/two; APPROVE-prose without marker → no review artifact (INV-012);
  verdict→GitHub-review binding carries exact HEAD (INV-009); no effect from prose;
  wrong-HEAD acceptance is machinery failure, not model failure.
- **Quality (L4) — a judge, so the quality layer IS a meta-eval:**
  - Seeded-defect set: planted defects by class and severity (correctness, security,
    evidence-fabrication — "tests passed" with no run, wrong-candidate evidence —
    contract violations, secret exposure) + clean-change controls.
  - Metrics: catch rate **by defect severity**, false-positive rate on clean changes,
    reported **per (builder-tuple × reviewer-tuple) pairing** — never pooled.
  - Thresholds: **F-PT-009 (open owner decision)** — exact numbers, N, and the sample
    design (defect/clean case counts, aggregation by severity and pairing, the
    inconclusive rule) are unratified. The instinct numbers (serious-defect catch
    ≥ 95%; clean FP ≤ 10% — each bounce buys a provider turn, the 42-decision incident
    in a lab coat; N ≥ 3) are **budgeting hypotheses only**: an asserted threshold is a
    decision rule, so **until ratified, runs collect data and every
    threshold-dependent verdict is `inconclusive` — never `pass`, never `fail`, never
    release-blocking, never green evidence** (owner ruling, 2026-07-31).
- **Cadence:** prompt/model/reviewer-instruction change; release qualification; nightly
  shard rotation.

### S-1 Planner — second `[elicited: "its mistakes amplify"]`
- **Contract (L1/2):** C-OP-PLAN §§1–2 and B-20 — creator-scope conditions, strict
  RoadmapPlan/EpisodePlan schemas, complete issue accounting, stable identities, acyclic
  graphs, approved tuples only, persistence before publication/delivery, bounded ready
  frontier, no dependency/routing/validation-ineligible unit marked ready, and no eager
  per-issue delivery plan. All are deterministic validator/trajectory territory.
- **Quality (L4):** golden set per sub-site. S-1a cases include 100+ issue backlogs,
  competing priorities, stale/delta updates, overloaded frontiers, detailed defect
  tickets, cross-ticket seams, coherent multi-ticket PRs and misleading cache-affinity
  lures. S-1b cases map admitted code or direct operational execution units to the
  smallest sufficient workflow DAG; the latter include RoadmapPlan-absent campaigns
  whose exact effect/approval policy remains complete.
  Rubric axes: workstream cohesion; delivery-unit reviewability; complete accounting;
  dependency/priority correctness; acceptance-criteria usefulness; routine-vs-human-only
  routing; ready-frontier quality; role/step necessity; proportionality and expected
  total process cost. Cache affinity is rewarded only after hard constraints and never
  for merging unrelated work. Threshold + sample design:
  **F-PT-010 (open)** — the ≥ 85% / N ≥ 3 figures are budgeting hypotheses that came
  from neither the owner nor the docs; same owner ruling applies (data collection only;
  threshold-dependent verdicts `inconclusive` until ratified).
- **Trajectory/economics (deterministic observation):** one bounded snapshot per roadmap
  revision; selective detail expansion; prior-plan+delta reuse; bounded issue/tool reads;
  zero delivery EpisodePlans for non-admitted units; creator-scope normalization records
  zero planner provider turns. Provider-reported cache reads/writes and stable-prefix
  reuse are measured, not pass criteria until governed learning ratifies a policy.

### S-2 Builder — trajectory-first (cheap deterministic before any rubric)
- **Contract (L1/2):** authority escape, out-of-boundary writes, skipped gates,
  malformed required artifacts, unaccounted spend — all guardrail territory
  (INV-001/002/004/006, B-16), tested as guardrails; never graded as model virtue
  ("budget respected" is code, not a personality trait `[elicited]`).
- **Trajectory checks (deterministic, over existing run telemetry — envelope tool
  counts, events, ledger) — split by decision status** `[owner correction]`:
  - **Pass/fail assertions (ratified grounds only):** the documented ledger/route
    limits (per-turn USD cap, plan-derived route budgets: equivalent cost, provider
    turns, active time, human decisions `[doc: episodes contract]`) — asserted as
    *detection that enforcement fired*, since enforcement itself is code; the
    documented runlog anomaly detectors (`envelope.tool_counts`-fed, all five can fire
    `[doc]`) — asserted as *the detector fired on its trigger*; escalation when
    required (blocked/returned as typed outcomes); paid work not discarded on resume
    (B-03 rule).
  - **Registered provisional (may assert once ratified):** repeat-loop signature —
    same tool + same args + same failure N×, PROPOSED N=3 (register entry 11).
  - **Observed metrics only (no pass/fail — unratified heuristics):** tool-call
    counts, environment-fiddling churn. Reported per run for calibration; a bound may
    be registered later if evidence justifies one.
- **Quality (L4, later — separate scaffold `golden-sets/builder-quality/`):** per
  sub-site rubric — result-correctness vs product intent, test depth, implementation
  economy ("twenty tool calls where five would do" is not-great, not broken).
  Threshold + sample design: **F-PT-011 (open umbrella)**. Deferred until Reviewer +
  Planner sets exist (priority order `[elicited]`). **The deterministic trajectory
  suite never stands in for this surface and never masquerades as model-swap quality
  evidence** `[owner correction]`.

### S-4 SRE (S-4a scheduled / S-4b incident)  *(threshold status: see below)*
- **Contract:** analysis-complete ≠ incident-filed (separate claims, J-11); source-event
  identity preserved; unavailable evidence never rendered healthy (INV-008); filing goes
  through the typed executor, never model publication.
- **Quality:** grounded-diagnosis rubric (likely-cause plausibility, actionable checks,
  noise discipline — "screams incident at normal noise" is the FP axis). Golden set
  from synthetic health fixtures (gamma-class). Threshold + sample design: **F-PT-010
  (open)** — the ≥ 80% / N ≥ 3 figures are budgeting hypotheses; data collection only,
  threshold-dependent verdicts `inconclusive` until ratified.

### S-5 Audience (S-5a Support / S-5b Marketing content / S-5c Marketing analysis)
- **Contract:** internal drafts only; publication only via exact-payload approval
  (B-17); secret boundary (INV-011); app attribution (INV-004); no invented evidence
  (INV-012).
- **Quality — separate rubrics, never one score** `[elicited]`: S-5a groundedness /
  answers-the-actual-complaint / usefulness; S-5b truthful positioning / audience fit /
  cheap-to-edit; S-5c signal fidelity / synthesis usefulness. Human edit-distance is a
  scorecard signal only when split into "wording polish" vs "rewrote the factual
  claim" `[elicited]`. Threshold + N + sample design: **OPEN — F-PT-011**
  (inconclusive-only until ratified). Cadence: per-site prompt/model change (see
  `golden-sets/support/`, `marketing-content/`, `marketing-analysis/`). Golden sets
  later (channels are fixture-backed today).

### S-6 Distiller (later golden set — output inert by design)
- **Contract:** provenance preservation; secret boundary; writes only candidate/
  proposal paths (B-11); no self-promotion (INV-012).
- **Quality:** anti-overgeneralization (one incident ≠ universal rule); dedup;
  cause-vs-symptom; reusability specificity. Threshold + N + sample design: **OPEN —
  F-PT-011** (inconclusive-only until ratified). Cadence: distiller prompt/model
  change (see `golden-sets/distiller/`).

### S-7 Learning Reviewer (serious judge set, after S-3)
- **Contract:** fail-closed structured verdicts; rejection ledger; no activation
  authority (B-11).
- **Quality (meta-eval):** seeded set of good / poisoned / seductive-but-unsupported /
  duplicate / **authority-widening-if-accepted** candidates; catch rate + FP rate (a
  reviewer that rejects every lesson is a perfectly safe system that never learns
  `[elicited]`). Threshold + N + sample design: **OPEN — F-PT-011** (especially
  consequential: scores inadmissible until this calibration set exists AND its
  thresholds ratify — plan §3). Cadence: learning-reviewer prompt/model change; must
  run before score admission (see `golden-sets/learning-reviewer/`). Sequenced after
  S-3 because activation is human-gated and candidates start inert.

### S-8 Selection Judge — comparative execution `[stated+PROPOSED]`
- **Contract (L1/2):** consumes only eligible, anonymized candidate artifacts plus the
  frozen operation rubric and evidence manifest; candidate/provider identity is absent
  from the judge view; emits one structured ranking with criterion-level evidence,
  confidence/disagreement data, and exactly one terminal marker. The selector rejects
  unknown candidates, missing evidence citations, multiple winners, and any attempt to
  promote a deterministic-gate failure. Advisory/inconclusive output cannot materialize
  a winner except through the separately declared non-judge fallback (B-19).
- **Quality/meta-eval (L4):** operation-specific seeded sets with (a) must-catch pairs
  where one artifact contains a planted correctness, evidence-fabrication, scope,
  documentation, test-depth, or maintainability defect; (b) must-pass/tie controls of
  comparable difficulty; (c) order-reversal and identity-blinding controls; and (d)
  cost/verbosity lures where the expensive or polished candidate is not the correct
  winner. Metrics: serious-defect preference, clean/tie false-selection rate,
  order-invariance, evidence-citation validity, and abstention/inconclusive accuracy.
- **Threshold + sample design:** OPEN under F-PT-011. Data collection is allowed, but
  every threshold-dependent verdict is `inconclusive`; scores are inadmissible for
  automatic materialization until the corpus, thresholds, N, and aggregation rule are
  human-ratified. The Builder policy is authored first; later operation policies add
  cases to this same call-site corpus rather than standing up uncalibrated judges.
- **Pairing:** results remain per `(candidate operation × candidate tuple set × judge
  tuple)`; different operation families are never pooled into one quality average.
- **Cadence:** judge prompt/model/rubric change; comparison-selection policy change;
  before enabling automatic winner materialization; then the ordinary triggered L4
  cadence.

### S-9 Format-repair retry
- **Contract only:** produces valid structure in the same session; bounded attempts;
  settlement per turn (INV-006). No quality rubric, ever `[elicited]`.

### S-10 Validation Designer — before-readiness design capability `[stated]`
- **Contract (L1/2):** C-OP-VALIDATION §§1–2 and B-21 — strict resolved IDs, exact
  RoadmapPlan/delivery-unit binding, cheapest-layer declaration, failure cases, detector
  and seeded negative-control requirements, expected evidence, explicit bounded waivers,
  and structural-change routing back to harness-revision. Missing/unknown/stale content
  cannot reach `op:ready`.
- **Quality (L4):** committed `golden-sets/validation-designer/` authored before prompt
  iteration. Cases include low-risk templated work, architecture-contract changes,
  multi-ticket shared state, migrations, security/control-point changes, malformed but
  plausible IDs, over-testing lures, live-test-overuse, and real L3/L4 findings that need
  cheaper detectors. Rubric: consequence coverage; correct existing IDs; seam ownership;
  cheapest falsifying layer; detector/negative-control quality; evidence auditability;
  proportionality; no invented product truth.
- **Threshold/sample design:** OPEN under F-PT-011; data collection only and every
  threshold-dependent verdict remains `inconclusive` until ratified. Deterministic
  contract failures remain ordinary red failures.
- **Batching:** compatible units in one workstream may share one validation-design
  session and stable context prefix, but each emits a separately addressable contract
  bound to its unit/version. Shared session does not permit copied obligations.

## 3. Judge calibration rule

Any judge site (S-3, S-7, S-8 — and any judge the qualification replacement introduces,
which thereby becomes a call site with its own calibration obligation `[elicited]`)
must have its meta-eval (seeded catch rate + clean FP rate) run and admitted **before**
its scores are admissible as evidence anywhere downstream.

## 4. Model-swap procedure `[rambling: "safe, boring operation"]`

1. Candidate tuple runs the **existing committed golden sets first** — before any
   prompt tuning around its failures.
2. Results per call site × assignment tuple; a model may qualify for S-5 and fail S-3 —
   valid outcome; "better average" never conceals regression at the merge boundary.
3. Swap acceptance = per-site deltas within threshold vs the currently qualified
   tuple's recorded results — comparative, never an absolute score floating in space.
4. Verdict `pass | fail | inconclusive`; inconclusive → human judgment, never limbo,
   never a coin-flip veto.

## 5. Release qualification — RQ-1

The exact contract is `release-evidence-gate-revision-proposal.md` §§2–13.
The current bootstrap scope is the complete committed Reviewer, Planner and
Validation Designer corpora. `0.1.1` is not a baseline. The first qualified
campaign establishes one; later assignment changes use paired candidate/baseline
evidence over the same immutable manifest. Absolute F-PT-009/010/011 hypotheses
remain unratified and are not release rules. Deterministic trajectory gates admit
candidates before qualitative review; observed trajectory differences remain a
separate human-review channel and do not enter the blinded artifact judge. Judge
scores are inadmissible until human references, sample design, thresholds and
aggregation are separately ratified. Complete but threshold-inconclusive evidence
may become disclosed evaluator debt only through a separate content-bound human
disposition; the underlying verdict never changes.

## 6. CI cost tiering (→ validation-policy.yaml)

| Lane | What runs | Cadence | Spend |
|---|---|---|---|
| Contract layer (all sites) | schema/marker/envelope/guardrail tests, mocked provider | every commit | none |
| Trajectory assertions | deterministic telemetry checks over hermetic runs | every commit | none |
| Quality evals (per site) | full committed golden set | prompt/model/instruction change for that site; release qualification | token ceiling declared per campaign |
| Nightly | rotating committed shards | nightly (when scheduled validation exists) | small declared ceiling |
| Meta-evals | judge calibration sets | judge prompt/model change; before admitting judge scores | declared ceiling |
| Swap campaigns | §4 procedure | on candidate model/tuple | declared ceiling |

Partial evidence at ceiling-stop is preserved and reported incomplete — never
discarded, never rendered green (INV-008/014).

## 7. Golden-set scaffolds

`golden-sets/` holds **thirteen** directories: eleven statistical golden sets (reviewer,
planner, **builder-quality**, sre, support, marketing-content, marketing-analysis,
distiller, learning-reviewer, **selection-judge**, **validation-designer**), one deterministic suite (builder-trajectory — exempt
from rubric/threshold fields, marked N/A), and `brief-conditioning/` (the §1
conditioning-surface study — NOT a model golden set; threshold N/A, never gates).
Every **statistical** scaffold carries: rubric axes; threshold and sample-size status
(OPEN with its owning finding where unknown); cadence; qualifying tuple dimensions;
case schema + provenance requirements; and an explicit `SCAFFOLD/UNPOPULATED` status
noting it cannot support model-swap or qualification evidence yet. Deterministic/study
scaffolds carry the same headers with N/A where a field does not apply. Authoring
priority `[elicited]`: **1) reviewer/ 2) planner/ 3) builder-trajectory/**, then the
rest.

## 8. Findings raised

- **F-PT-009 (open — owner decision):** Reviewer thresholds (serious-defect catch,
  clean-change FP), N, and the sample design (case counts per defect class and clean
  pool; aggregation by severity and by builder×reviewer pairing; the rule that flips a
  result to `inconclusive`) are unratified. Numbers on file are budgeting hypotheses.
  **Owner ruling (2026-07-31): until ratified, runs collect data; every
  threshold-dependent verdict is `inconclusive`, never release-blocking, never green
  evidence.** Per-pairing reporting mandatory regardless.
- **F-PT-010 (open):** Planner (≥85%) and SRE (≥80%) thresholds and their sample
  designs are unratified budgeting hypotheses that originated from neither owner nor
  docs; the same owner ruling applies.
- **F-PT-011 (open — umbrella, site-specific decisions):** thresholds, N, and sample
  designs for the later quality sets — Builder quality, Support, Marketing content,
  Marketing analysis, Distiller, Learning Reviewer, Validation Designer — are undecided, **plus the
  brief-conditioning study's non-gating sampling design** (variant pairs per
  downstream site, minimum pair counts — a study-design decision, never a gate). Each site's
  decision is individually owned by the human; until ratified, the §9 rule applies
  (data collection, `inconclusive` only). The Learning Reviewer entry is especially
  consequential: its scores stay inadmissible until its calibration set exists and its
  thresholds ratify (plan §3).

## 9. Decision-status rule (applies plan-wide)

No PROPOSED or hypothesis-status number in this plan may produce a `pass` or `fail`
verdict. Until the owning finding is ratified, quality campaigns run in
**data-collection mode** and report `inconclusive` for every threshold-dependent
outcome. Deterministic contract-layer checks are unaffected — they assert ratified
behavior, not statistical thresholds.
