# Harness revision proposal — jobs subsystem

> **SUPERSEDED 2026-08-07 — historical record, not a live proposal.** This package was
> never accepted, and its ID choices collided with the #336 adapter-expansion revision
> that landed the same day: **B-23 is OpenCode**, **J-21 is the outcome-acceptance
> campaign**, and **F-PT-025 is the OpenCode gate-seam finding**. Its substance was
> carried into the ratified artifacts by the 2026-08-07 outcome-acceptance + jobs
> revision, renumbered:
>
> | This file said | Landed as |
> | --- | --- |
> | B-23 (job config ↔ journal) | **B-30** (alias `B-JOB`), `contracts/B-30-job-config-journal.md` |
> | J-21 / J-22 (jobs journeys) | **J-22 / J-23** (aliases J-JOB-1 / J-JOB-2) |
> | `CORMIDIA-C-B23-*` / `C-OP-JOB` | `CORMIDIA-C-B30-001…003` / `CORMIDIA-C-OPJOB-001` |
> | F-PT-025 (INV-016 domain) | **F-PT-031**, status `resolved-delegated`, flagged for owner confirmation |
> | M18 — Jobs | **M18** (unchanged) |
>
> Two of its own open items are also closed: §0.7 (no statistical quality lane for job
> steps) is now recorded in `llm-eval-plan.md` §1 as a deliberate exclusion, and §0.9's
> import-direction enforcement gap was **fixed independently** — `check-import-direction.mjs`
> now fails closed on an unranked `src/` layer (verified 2026-08-07).
>
> Read this file for its reasoning, especially the F-PT-025→031 argument at §0.8. Do not
> read its IDs as current.

*Status: **Phases 0–8 complete.** Authorized by the owner 2026-08-07
(`validation-harness-design`, `harness-revision` mode), who additionally directed that the
revision run through every phase without per-phase review; each gate below therefore
records the decision taken and its basis. This file is a
**proposal**: `validation-policy.yaml`, `case-catalog.md`, `boundary-map.md`,
`system-map.md`, `invariants.md`, and `risk-allocation.md` are ratified artifacts and are
**not** edited until this package is accepted. Follows the house pattern of
`hb-111-protected-surface-proposal.md` and `release-evidence-gate-revision-proposal.md`.*

*Revision driver: `docs/jobs/design.md` (itself PROPOSED, unratified). Anything depending
on that document's unratified choices is parked `BLOCKED`, never assumed.*

---

## Phase 0 — Scope declaration and baseline ingestion

### 0.1 Mode

**`harness-revision` over the existing `product`-scope baseline.** Not a module-scope
campaign, and therefore no new ID prefix.

Precedent is exact and I am following it rather than inventing a shape: the 2026-08-01
comparative-execution revision added M16 / J-19 / B-18–B-19 / S-8, and the 2026-08-03
roadmap-planning revision added M17 / J-20 / B-20–B-22, both as additions to the
product-scope corpus under the existing `CORMIDIA-` namespace
(`scope-and-module-map.md` §1, §2). Jobs follow that pattern.

### 0.2 Fast mode

The 2026-07-31 baseline declined fast mode; the 2026-08-03 surgical revision used
owner-confirmed fast mode, "preserv[ing] the baseline and revisit[ing] only affected
artifacts" (`scope-and-module-map.md` §1).

**Proposed: fast mode, on the 2026-08-03 precedent.** The owner authored the baseline
corpus and does not need invariants, boundaries, or risk tiers re-taught. Beats 1–2
collapse to a two-sentence recap per concept; beats 3–4 (elicit, synthesize) run in full,
because the substance of this revision is genuinely undecided.

*Confirmed by the owner 2026-08-07.*

### 0.3 Proposed additions

| Artifact | Addition |
| --- | --- |
| `scope-and-module-map.md` §2 | **M18 — Jobs.** Ad-hoc dependency-ordered step graphs; config/journal contract; per-step assignment; declared output checks; checkpoints; app-scoped and unscoped modes. Deep pass: **no** — product-level coverage, small surface, no new state machine beyond the journal. |
| `system-map.md` §1.3 | **J-21** recurring app-scoped job · **J-22** one-off unscoped job in the default org. (Design input: `docs/jobs/design.md` §14 J-JOB-1/J-JOB-2 — input, not settled rows.) |
| `boundary-map.md` §1 | **B-23 — Job config authority ↔ journal-bound execution.** Draft entry in §0.6 below. |
| `contracts/` | `CORMIDIA-C-B23-*`; possibly `CORMIDIA-C-OP-JOB` for the operation contract. |
| `invariants.md` | No new invariant proposed yet — see §0.5. Jobs are constrained almost entirely by inheritance. |
| `risk-allocation.md` §2 | Jobs slices added to **E-1** (gate/authority) and **E-2** (durability + money). No new exhaustive family. |
| `llm-eval-plan.md` | **Open question** — see §0.7. Possibly no new S-site. |
| `case-catalog.md` | `CF-J21-*`, `CF-J22-*`, `CF-B23-*` families. |
| `harness-backlog.md` | New HB wave, walking skeleton first. |

### 0.4 Criticality placement

**Proposed: C2 base with T-3 / T-5 / T-6 / T-9 slices, and no new C3 control point** —
the same disposition comparative execution received (`system-map.md` §5.3: "No new C3
control point is introduced").

| Existing control point | New surface jobs create |
| --- | --- |
| **T-3** authority & protocol-surface protection | The `operator` role's ceiling. A step selecting an assignment must never widen the role; an unapproved tuple must be refused, not substituted. |
| **T-5** settlement & budget, under-accounting direction | Exactly-once ledger settlement for job turns; the separate budget envelope; and the nested-invocation refusal — without it a Builder turn spawns provider turns that escape its episode budget entirely. This is the highest-consequence new surface in the subsystem. |
| **T-6** app isolation | An app-scoped job must not touch another app's state; an unscoped job must not touch app state at all. |
| **T-9** evidence truthfulness | "Completed step" must mean provider-returned **and** declared checks passed. A journal claiming completion for a step whose output check failed is the false-green amplifier operating inside a new subsystem. |

T-1 (gate classification) is **inherited unchanged**, not a new surface: jobs pass the
existing `defaultGate`, and `cormidia-job` joins the existing CLI-as-effect-surface
classification rather than sitting outside it.

### 0.5 Inheritance set — the invariants that constrain jobs

Referenced, never restated (skill rule 10):

| Invariant | How it binds jobs |
| --- | --- |
| INV-001 authority never grows by accident | `operator` ceiling; per-step assignment never widens it |
| INV-002 gate is total over critical effects | every job step's tool actions are gated |
| INV-004 one turn, one app, coherently | app-scoped jobs; unscoped jobs touch no app |
| INV-006 settlement conservation | exactly-once per job provider turn, failed/cancelled included |
| INV-008 evidence never outruns reality | journal and `observe` rendering of job state |
| INV-011 secrets are confined, one policy governs | job `brief.md`/`output.md` are L3 evidence on the existing terms |
| INV-013 durable writes have an integrity story | journal + config-hash binding; torn-write recovery |
| INV-015 uncertainty narrows capability | failed check ⇒ failed step; drifted config ⇒ refuse, never resume |
| **INV-016 validation obligation lineage** | **conflict — see §0.8** |

### 0.6 B-23 draft — Job config authority ↔ journal-bound execution

*Draft for beat-4 confirmation, in the established boundary-map format.*

- **Why it is a boundary:** the job config is authored and owned outside Cormidia (a file
  in the user's own repo, editable at any moment); the journal is Cormidia's durable
  account of what has actually executed. Ownership of state and failure domain both
  change at that line.
- **Boundary test:** a valid config can exist with no journal and nothing running; a
  journal must survive and refuse a config that changed underneath it. **PASS.**
- **Journeys / tier:** J-21 / J-22; C2 with T-5 settlement, T-6 isolation, T-9 evidence,
  T-3 assignment-authority slices.
- **Failure modes:** dependency cycle; unknown `dependsOn` id; duplicate step id; config
  edited between runs while the journal claims completed steps; journal present but
  config absent; torn journal write; a completed step's declared output deleted or
  emptied after completion; a step marked completed whose check never ran; resume
  re-executing a completed step (double spend); resume skipping an *interrupted* step
  whose provider turn was already paid; unapproved assignment tuple accepted; step
  inferring completion from an output file's existence rather than the journal; app-scoped
  and unscoped records both written for one job; nested `cormidia-job` inside a Cormidia
  turn; checkpoint resumed without a decision.
- **Honest fake:** **YES** — real config loader, journal, check evaluator and brief
  assembly against B-15 temp state, the B-02/03/04 scripted adapter doubles, an injected
  clock, and the B-07 kill-point harness. No provider is needed to falsify any failure
  mode above.
- **Unproven real:** nothing new. Provider behavior stays B-02/03/04; job step *output
  quality* is out of scope by design (§0.7).
- **Layer:** 1/2 dominant. **No new L3 seam** — this is the strongest argument for the
  subsystem being cheap to validate.

### 0.7 Open question — is a job step an LLM call site?

`llm-eval-plan.md` owns S-1…S-10, each a call site with a golden set and a rubric. A job
step is a provider turn, so mechanically it looks like an eleventh.

But the *prompt is authored by the user*, per job, and its quality rubric is whatever that
user's exercise needs. Cormidia cannot own a golden set for a prompt it never wrote.

**Proposed: no new S-site.** Job steps get contract-layer coverage only (schema/limits/
retry/budget accounting against a mocked provider), and explicitly no quality lane. The
handoff-assembly logic — that a dependency's declared outputs actually reach the
downstream brief verbatim — is a **deterministic** assertion over the persisted
`brief.md`, not an eval.

*Confirmation needed: does the owner accept that jobs have no statistical quality lane?
If yes, `llm-eval-plan.md` gains one paragraph recording the deliberate exclusion, so a
later reader does not mistake it for an omission.*

### 0.8 F-PT-025 — the conflict I cannot resolve

**Opened per skill Phase 0 ("If the module's design conflicts with a parent invariant or
contract, record it as a finding and escalate. Never resolve it silently in either
direction") and per AGENTS.md's finding protocol. Status: `open`. Next available id
confirmed as 025 (highest existing is F-PT-024).**

> **F-PT-025 — INV-016's domain: does "every autonomously executed unit" include a job
> step?** CORMIDIA-INV-016 states that *every autonomously executed unit* has one durable
> validation/evidence contract before it becomes ready, identifying affected journeys,
> boundaries, contracts and invariants, cheapest falsifying layers, detectors and negative
> controls, and expected evidence — and that no single actor may "silently waive, rewrite,
> satisfy, and approve the obligation alone." `docs/jobs/design.md` §3 deliberately
> withholds independent review, typed merit verdicts, and any independent closure. A job
> step is unattended provider execution. On the invariant's plain text, jobs violate it.

Two honest readings, and the answer changes the design materially:

**Reading A — INV-016 is delivery-scoped.** Its entire vocabulary is delivery-unit
vocabulary: "becomes ready", "EpisodePlan admission", "Builder artifacts", "exact-HEAD
gate evidence", "independent Reviewer verdict", "operational effects bind their exact
payload". Jobs produce files in a user's working directory and never reach a PR or an
external effect, so they are outside the invariant's domain. *Consequence:* no conflict,
but INV-016's statement needs an explicit scope clause, because today it reads
universally — and leaving it universal while shipping a subsystem that ignores it is
exactly the kind of drift the corpus exists to prevent.

**Reading B — INV-016 is universal.** Then jobs need either (i) independent closure per
step, which contradicts the subsystem's whole point, or (ii) an **explicit
policy-bounded waiver** — a mechanism INV-016 itself already contemplates ("any explicit
policy-bounded waiver", with its adversarial seed (b) being a waiver *outside* its policy
class). *Consequence:* add a `jobs` waiver class to `validation-policy.yaml` with
provenance, and the declared output checks of `design.md` §7 become its minimum floor:
a durable, deterministic, pre-declared obligation per step. Not independent closure, but
not model goodwill either.

### F-PT-025 — RESOLVED: Reading A (owner delegated the decision 2026-08-07)

The owner delegated this decision explicitly, asking for a call on implementation cost
and UX impact. **Resolution: Reading A — INV-016 is delivery-scoped, and its statement
gains an explicit scope clause.** I had leaned B; on close reading of the invariant's own
text, B is wrong.

**The decisive argument is INV-016's own precondition.** It reads "every autonomously
executed unit has one durable validation/evidence contract *before it becomes ready*."
"Ready" is not a general English word here — it is a delivery-unit state owned by the
roadmap ready-frontier machinery (B-20; INV-008's ready-frontier clause enumerates exactly
what a ready entry must bind: RoadmapPlan version, delivery-unit membership, routing
eligibility, dependency state, validation contract). A job step has no readiness
transition at all: no frontier, no admission, no membership, no plan version. The
invariant's precondition is **unsatisfiable** for a job step.

So this is not an exemption being carved. It is the invariant's actual domain, which was
always delivery, being written down. That is why A costs one clause.

**Why Reading B is worse, concretely:**

| | Reading A (scope clause) | Reading B (waiver class) |
| --- | --- | --- |
| Implementation | One sentence in INV-016's statement | New waiver class in `validation-policy.yaml`; provenance fields; every job case family references it |
| New detector obligation | None | Yes — INV-016's own adversarial seed (b) is "a waiver outside its policy class," so the waiver machinery itself needs a negative control |
| Mechanism fit | States the domain | **Misuses the mechanism.** INV-016's waivers are per-unit and policy-bounded; a standing subsystem-wide waiver is a different construct wearing the same name |
| Reads at a future audit | "This rule is about delivery" | "There is a permanent waiver on an entire subsystem" — invites the question every time |
| UX impact | None | None |

B's apparent virtue was that it writes the exemption down. But a scope clause is also
written down, and it is the more honest sentence: B says "this rule applies and we are
ignoring it," A says "this rule was never about this."

**Proposed INV-016 scope clause** (surgical, tighten-only — it narrows nothing that was
enforceable before, because the universal reading was never checkable for work with no
readiness transition):

> *Scope.* This invariant governs **delivery units** — autonomously executed work that
> reaches readiness through a RoadmapPlan/EpisodePlan admission path and lands in a
> product or performs an operational effect. Work with no readiness transition, no
> delivery-unit membership, and no external effect is outside its domain; such work is
> governed instead by its own boundary contract and by the standing no-green-by-absence
> rule. (Scope made explicit 2026-08-07 on the M18/jobs revision, F-PT-025.)

**Reading A is not a free pass, and this must not be misread as one.** "No green by
absence" is a standing harness rule independent of INV-016 (`AGENTS.md` → Validation
harness, standing rule 7). Jobs therefore still carry a pre-declared, durable,
deterministic obligation per step: the declared output checks of `docs/jobs/design.md`
§7 are **mandatory**, a step with no declared outputs is reported as unverified, and a
step whose check fails is `failed` regardless of what the provider said. Those become
`CF-B23-*` case families, not waived cells.

Cases previously parked `BLOCKED:F-PT-025` are unblocked and derive against B-23.

### 0.9 Disposition question — the import-direction enforcement gap

`scripts/check-import-direction.mjs` skips any `src/` directory absent from its rank map
(`if (sourceRank === undefined) continue;`). Today that silently exempts `src/cli`,
`src/observe`, `src/report`, and `src/narrative` — four of seven source directories — from
the one-way import rule AGENTS.md calls binding. `tests/policy/enforcement-gate.test.ts`
pins only the three ranked layers, so the fail-open path has never fired. Verified
2026-08-07: no upward import exists today, so the invariant holds by luck, not by
enforcement.

This predates jobs and is independent of them. Two dispositions:

- **(a) In scope for this revision** — it is an *enforcement* gap in a documented
  architectural invariant, and jobs would be the fifth exempt directory. Folding it in
  means this revision lands the fail-closed guard and its negative control.
- **(b) Its own finding/ticket** — keeps this revision surgical, which the 2026-08-03
  precedent favors.

**Proposed: (b), with a cross-reference.** A repo-wide enforcement gate is not
jobs-shaped, and bundling it would make this revision's diff need a tour guide
(TASTE.md §5). A background task is already open for it.

*Owner confirmation requested — this is the one place where "surgical" and "fix the real
hole" pull in different directions.*

---

## HARD STOP — Phase 0 gate

Nothing below Phase 0 is written until these are confirmed. Per skill operating rule 11,
I do not proceed on silence.

1. **Mode and no new ID prefix** (§0.1) — `harness-revision` over product scope,
   continuing `CORMIDIA-`, on the M16/M17 precedent.
2. **Fast mode** (§0.2) — collapse teaching beats, keep elicitation in full.
3. **M18 + J-21/J-22 + B-23 as the addition set** (§0.3), and **no deep pass**.
4. **Criticality: C2 with T-3/T-5/T-6/T-9 slices, no new C3 point** (§0.4).
5. **The inheritance set** (§0.5) — additions or removals.
6. **F-PT-025** (§0.8) — Reading A or Reading B. **This is the blocking one.** It decides
   whether jobs need a written waiver class, and every case family touching step
   completion depends on it.
7. **§0.7** — jobs have no statistical quality lane.
8. **§0.9** — disposition of the import-direction gap.

Item 6 is the one I most need answered and the one I am least willing to guess.

---

## Phases 1–8 (fast mode, owner-authorized 2026-08-07)

Beats 1–2 collapsed per §0.2; elicitation and synthesis run in full. The owner
authorized proceeding through all phases without per-phase review, so each gate below
records the decision taken and its basis rather than waiting.

### Phase 1 — Tier

Jobs **inherit the product base tier C2** with the T-3/T-5/T-6/T-9 slices established in
§0.4. No override. Deployment shape is unchanged (laptop-first, one runtime over N apps);
jobs add a long-running human-invoked mode, which is why resume is a first-class
requirement rather than a nicety.

### Phase 2 — Invariants

**No new invariant.** Jobs are constrained entirely by the §0.5 inheritance set. This is
the correct outcome and worth stating explicitly rather than inventing an INV-017 for
symmetry: every falsifiable claim jobs make is already a claim one of INV-001/002/004/
006/008/011/013/015 makes. INV-016 is out of domain per F-PT-025.

Two inherited invariants **tighten** for jobs, which is permitted (never loosen):

- **INV-008 tightens.** "Completed" for a job step means provider-returned **and** every
  declared output check passed. A step whose check failed may not be rendered completed by
  any surface, and a step with no declared outputs renders `completed (unverified)` — not
  bare `completed`. Absence of a check is a visible property, never silence.
- **INV-015 tightens.** A config that changed under a live journal refuses rather than
  resuming, and a step's completion is read from the journal only — never inferred from an
  output file's presence, because a half-written file is indistinguishable from a complete
  one.

### Phase 3 — Boundaries

**B-23** as drafted in §0.6, accepted. One boundary, not two: the config→journal seam and
the journal→execution seam share a failure domain (the journal is the only thing that
survives), so splitting them would create two contracts with one truth.

`cormidia-job` as a **process** is not a new boundary — it joins B-15 (local persistence
and git substrate) and the existing CLI-as-effect-surface classification. Recorded here so
nobody re-litigates it (boundary-map.md §2 pattern).

### Phase 4 — Contracts

**`CORMIDIA-C-B23-001` — job config authority.** Valid input: a YAML mapping with a
path-safe `job` id, optional `app`, and ≥1 step; each step has a unique path-safe `id`,
`dependsOn` resolving to declared ids, an acyclic graph, and either
(`objective` [+ optional `assignment`, `outputs`]) or (`checkpoint`) but never both.
Guaranteed output: a validated plan, or a typed refusal naming the exact defect, **before
any runtime is constructed**. Error behavior: fail closed, exit non-zero, no state
written. Idempotency: loading is pure.

**`CORMIDIA-C-B23-002` — journal authority.** The journal is the sole completion
authority. Guarantees: a completed step is never re-executed; an interrupted step is
retried at most once under its recorded attempt identity; every write is atomic
(`writeLoopFileAtomic` semantics); the config hash is bound at first write and a mismatch
is a typed refusal, never a resume. Ordering: steps are selected by
`selectReadyEpisodeSteps` and executed one at a time, id-ordered.

**`CORMIDIA-C-B23-003` — declared output checks.** Each check kind (`exists`,
`non_empty`, `json`, `schema`, `command`) is deterministic and fail-closed. A failed check
makes the step `failed` regardless of provider status. A step with no declared outputs
completes as explicitly unverified.

**`CORMIDIA-C-OP-JOB` — operation contract.** `cormidia-job run <config>` refuses when
invoked inside a Cormidia provider turn; settles exactly one ledger row per provider turn
including failed/cancelled; writes run records to exactly one canonical location per job;
raises gated items through the existing gate without special-casing.

### Phase 5 — LLM call sites

**No new S-site**, per §0.7. Job steps get contract-layer coverage only. The
handoff assertion (a dependency's declared outputs reach the downstream `brief.md`
verbatim) is deterministic, not statistical. `llm-eval-plan.md` gains one paragraph
recording the deliberate exclusion so a later reader does not read it as an omission.

### Phase 6 — Risk allocation

Jobs join **E-1** (the gate/authority slice: `operator` ceiling, assignment never widens
the role, nested-invocation refusal) and **E-2** (durability and money together: journal
resume, no double spend, exactly-once settlement, preserved paid work on an interrupted
step). No new exhaustive family — the compound worst case for jobs is a subset of the
existing one in `system-map.md` §5.5.

Everything else is **STD**. Job step output *quality* is explicitly **THIN** (no lane).

### Phase 7 — Tooling

Parent stack, no divergence: vitest, the existing fixture kit (`fixtures/state-home.ts`,
`fixtures/clock.ts`, `fixtures/kill-point.ts`, `fixtures/adapters/`, `fixtures/walk.ts`).
Burden of proof for divergence not met, and not attempted.

### Phase 8 — Case families

Nine families, every one falsifiable at L1 or L2. `runs`/`layer`/`oracle`/`risk` keys per
`case-catalog.md` conventions.

| Family | Layer | Oracle | Risk | Covers |
| --- | --- | --- | --- | --- |
| `CF-B23-CFG` | 1 | refusal | E1 | cycle, unknown/duplicate id, both-or-neither objective/checkpoint, refusal precedes any runtime construction |
| `CF-B23-JRN` | 2 | state | E2 | resume skips completed steps at zero cost; interrupted step retried once under its attempt identity; atomic write under kill-point; completion never inferred from output files |
| `CF-B23-DRIFT` | 1 | refusal | E2 | config edited under a live journal refuses and names the drift; no step executes |
| `CF-B23-CHK` | 1 | det | E1 | each check kind fires; failed check ⇒ step `failed` despite provider `completed`; no declared outputs ⇒ `completed (unverified)` |
| `CF-B23-HND` | 2 | evid | STD | dependency outputs appear verbatim in the downstream persisted `brief.md`; missing required input refuses |
| `CF-B23-NEST` | 1 | refusal | E1 | invocation inside a Cormidia provider turn refused |
| `CF-B23-SET` | 2 | state | E2 | exactly one ledger row per provider turn incl. failed/cancelled; job envelope debited, app envelope untouched |
| `CF-J21-APP` | 2 | evid | E2 | app-scoped records land under `runs/<app>/` and nowhere else; `observe` surfaces them unchanged |
| `CF-J22-ADHOC` | 2 | evid | STD | runs with no app registered; records under `runs/adhoc/`; refusal messages use no ticket/episode/app vocabulary |

**Negative controls** (policy `harness_self_tests`, skill rule 4 — each seeds the
violation and asserts the detector FIRES): cyclic config; drifted config hash; a declared
output that exists but is empty; a lying fake provider reporting `completed` for a step
whose check fails; nested invocation; a seeded double-settle.

**Closure.** No `PRUNE-na` cells. Job step output quality is `PRUNE-thin` with its reason
recorded in Phase 5. Nothing is `BLOCKED` — F-PT-025 resolved, and no other finding gates
these families.

### Phase 8 — Adversarial reader test

Simulated a new engineer holding only these artifacts plus `docs/jobs/design.md`:

- *What must never break?* §0.5 inheritance table plus the two Phase-2 tightenings. **Pass.**
- *Where are the boundaries?* B-23, with an explicit "not a boundary" note for the process. **Pass.**
- *What is inherited vs new?* §0.5 marks every invariant; Phase 2 states no new invariant and says why. **Pass.**
- *What do I do when a check fails?* `CORMIDIA-C-B23-003`: step `failed`, job stops, downstream does not run. **Pass.**
- *Gap found and fixed:* the reader could not tell whether a job step with no declared outputs was a defect or a choice. Resolved by making `completed (unverified)` a distinct rendered state in the INV-008 tightening rather than leaving it as bare `completed`.

### Artifact edits this proposal requests on acceptance

`scope-and-module-map.md` §2 (M18) · `system-map.md` §1.3 (J-21/J-22) and §5.3 (jobs
sentence) · `invariants.md` (INV-016 scope clause + the two tightenings) ·
`boundary-map.md` §1 (B-23) and §2 (process note) · `contracts/B-23.md` +
`contracts/OP-JOB.md` · `risk-allocation.md` §2 (E-1/E-2 job slices) ·
`llm-eval-plan.md` (exclusion paragraph) · `case-catalog.md` (nine families) ·
`validation-policy.yaml` (F-PT-025 resolved; nine families; no new gate class) ·
`harness-backlog.md` (HB wave, walking skeleton first).
