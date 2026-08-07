# Harness revision proposal — jobs subsystem

*Status: **Phase 0 complete, awaiting the Phase 0 hard stop.** Authorized by the owner
2026-08-07 (`validation-harness-design`, `harness-revision` mode). This file is a
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

*Owner confirmation required — this is a Phase 0 gate item, not a designer choice.*

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
