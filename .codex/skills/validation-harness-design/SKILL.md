---
name: validation-harness-design
description: Teach-first workflow that designs a validation harness before code exists — it grounds the user in each concept, elicits their thinking, then produces falsifiable invariants, a boundary map, per-boundary contracts, LLM eval plans, tooling selection, and a validation-policy.yaml a later audit can diff against. Use whenever the user wants to plan tests or evals for a new product, feature, module, or agentic system; define invariants, contracts, or acceptance criteria upfront; decide unit vs integration boundaries; design evals for LLM calls or agent loops; prepare a safe model swap; extend an existing product's harness to cover a new module or subsystem; or asks things like "how should I test this", "what evals do I need", or "build a validation harness for module X of product Y". Complements validation-harness-audit — the audit measures an existing harness; this skill designs one that does not exist yet.
---

# Validation Harness Design

Design the validation surface for a product or module **before code exists**. The output is not an exhaustive test-case list — it is the set of durable artifacts from which cases are derived for the life of the product: falsifiable invariants, a boundary map, per-boundary contracts, LLM eval plans, a risk-weighted coverage allocation, a tooling decision, and a ticket-shaped harness-skeleton backlog.

**Stance: teach, then elicit, then synthesize.** The human is the domain expert, but domain expertise is not the same as fluency in validation vocabulary. Do not open a phase by presenting candidate invariants or boundaries for review — that turns a design session into a review task and silently hands you the framing power. Every concept is taught before it is applied, and the human's own unstructured thinking is the primary input to synthesis. Anything you originate is labeled and requires confirmation.

## Operating rules (apply to every phase)

1. **Teach before elicit; elicit before synthesize.** Never present a candidate list for a concept the human has not yet been given a frame for and a chance to think inside. The four-beat concept loop below is mandatory for invariants, boundaries, contracts, eval layers, and risk tiers.
2. **Socratic before generative.** Derive candidates from the architecture doc and the human's answers first. Anything you originate — including patterns imported from comparable systems — is labeled `PROPOSED` and requires explicit confirmation before entering a deliverable.
3. **Falsifiability gate.** An invariant is accepted only if stated as something a test could violate. "The system should handle payments reliably" is rejected; "no charge exists without exactly one order" passes. Rewrite or discard anything that fails.
4. **The boundary test.** Every proposed boundary must answer: *can side A be down while side B is up?* If the human can't answer, that is an architecture gap — record it as a finding rather than papering over it. External systems (payment APIs, LLM providers, third-party tools) are boundaries by definition.
5. **Guardrails enforce invariants; evals measure quality.** Never let an invariant depend on model goodwill or probabilistic behavior. Invariants get runtime enforcement (fail-closed) plus tests of the *guardrail*; evals measure quality statistically, offline.
6. **Evals before prompt iteration.** Golden sets are authored and committed before any prompt tuning, or validation is circular. Same discipline for classic code: adversarial cases are derived from invariants before implementation.
7. **Risk weighting is a human decision.** You propose probability × cost tiers; the human confirms them. Business consequence is not fully encoded in any doc.
8. **Harness before cases.** The skeleton (one real test per layer through real CI) is the upfront investment; cases accumulate through the three sourcing channels forever after.
9. **Policy-as-data, fail-closed, tighten-only.** Decisions land in `validation-policy.yaml`, not prose. Missing gates default to blocking-absent findings, never silence. A module policy may narrow an inherited requirement; a module policy that loosens one is a policy violation, not a merge.
10. **Inherit, never restate.** In module scope, parent invariants and contracts are referenced by ID. Duplicating them into the module's files creates two truths that drift.
11. **Hard stops are hard.** Scope confirmation (Phase 0), tier confirmation (Phase 1), risk-tier confirmation (Phase 6), tooling selection (Phase 7), and the adversarial review (Phase 8) require explicit human go-ahead. Do not proceed on silence.

## The concept loop

Apply these four beats to **each** concept in Phases 2–6. Read the concept's entry in `references/concept-primers.md` before beat 1.

**Beat 1 — Frame.** State what the concept is, why it exists, and what it is commonly confused with. Give 2–3 canonical examples drawn from domains *other* than the human's. Keep it to a few short paragraphs — this is orientation, not a lecture.

**Beat 2 — Ground.** Walk one worked example out of the human's own architecture doc, showing the derivation. Label it explicitly: *this is an illustration of the shape, not a proposal, and not a boundary on your thinking.* To limit anchoring, draw the example from a **different subsystem than the one under design** wherever the doc allows, and never give more than two.

**Beat 3 — Elicit.** Hand the floor over. Invite unstructured thinking — rambling, half-formed, out of order, in whatever register the human prefers. Do not supply a template, a numbered list to fill, or a candidate set. Ask at most one focusing question. Then stop and wait; do not answer your own prompt.

**Beat 4 — Synthesize.** Combine, in this order: (a) what the human said, (b) what the architecture doc supports, (c) patterns from comparable systems, labeled `PROPOSED`. Present the structured candidate set with provenance marked per item — `[stated]`, `[doc]`, or `[PROPOSED]`. Apply the concept's acceptance gate (falsifiability, boundary test, contract completeness). Confirm before moving on.

**Loop controls:**

- **Depth.** Teach-first is the default. If the human signals fluency ("skip the framing", "I know what an invariant is", "go fast"), collapse beats 1–2 into a two-sentence recap for that concept only — never silently across the whole session. Ask once at Phase 0 whether any concept should run in fast mode.
- **Backflow.** Concepts are not independent: boundaries routinely reveal invariants, and contracts reveal missing boundaries. When a later beat invalidates an earlier artifact, say so explicitly, reopen that concept, and note the revision — do not quietly patch it.
- **Elicitation log.** Capture the human's beat-3 input close to verbatim in `elicitation-log.md`. It is the provenance trail for every `[stated]` item and the record of what was considered and dropped.
- **Checkpoint.** After each concept completes beat 4, write current state to `harness-design-state.md` (scope, tier, concepts completed, open findings, pending confirmations) so an interrupted session resumes without re-interrogation.

## Phase 0 — Scope declaration and parent ingestion

Establish the scope before anything else. Three modes:

- **`product`** — whole system, no parent harness.
- **`module-of-built-parent`** — a subsystem of a product whose harness already exists in code and policy.
- **`module-of-designed-parent`** — a subsystem of a product whose harness has been designed but not yet built.

For module modes, ingest the parent before eliciting anything. Locate and read: the parent `validation-policy.yaml`, `invariants.md`, `boundary-map.md`, `contracts/`, existing test directories and CI config. If artifacts are missing, ask for paths; if the parent genuinely has none, say so plainly and offer either a shallow parent pass first or an explicit decision to design the module standalone and reconcile later. Do not invent the parent's invariants.

Then establish, and confirm:

- **ID namespacing.** Parent and module invariants/contracts carry distinct prefixes (`OPERON-INV-003`, `LL-INV-007`) so a later audit can trace which layer a conformance failure belongs to.
- **Inheritance set.** Which parent invariants constrain this module. These are referenced, not restated (rule 10). The module may add new ones or tighten inherited ones; it may never weaken one.
- **The parent seam is a mandatory boundary.** The interface between module and the rest of the product is enumerated in Phase 3 without exception, and is usually the single highest-value boundary in the map — it carries the module's contract to everything else.
- **Contradiction handling.** If the module's design conflicts with a parent invariant or contract, record it as a finding and escalate to the human. Never resolve it silently in either direction.

For **`product`** scope on a large system, go deliberately broad and shallow: produce a module map naming each subsystem, its criticality, and whether it warrants its own later deep pass with this skill. Product-level artifacts should cover cross-cutting invariants and inter-module boundaries — not attempt every module's internals in one sitting.

**HARD STOP.** Confirm scope, mode, parent artifact set, and (for product scope) the module map.

## Phase 1 — Inputs and criticality tier

Require an architecture document (or any written system description — design doc, spec, README-driven sketch). If none exists, build a one-page system brief through interview first: components, state each owns, external dependencies, user journeys, deployment shape (single-install two-user tool vs multi-tenant SaaS — this parameterizes scale testing later).

Propose a criticality tier using the same rubric as validation-harness-audit — **T0** throwaway, **T1** internal tooling, **T2** production service (money/customer data/reputation), **T3** safety-critical/irreversible — with per-component overrides (a `billing/` module inside a T1 tool is T2). Cite the evidence behind each. In module scope, the module **inherits the parent tier by default**; any override is stated with justification.

**HARD STOP.** Confirm tier. It decides which failure modes are in scope, coverage depth per risk tier, and how heavy the LLM eval program needs to be.

## Phase 2 — Invariants

Run the concept loop. Primer: `references/concept-primers.md#invariants`. Beat-3 prompts and beat-4 probes: `references/question-bank.md`.

Categories to cover in beat 4 if the human's own thinking didn't reach them: money and irreversible actions, state machines and legal transitions, resource conservation, uniqueness and mapping, ordering and idempotency, tenancy and authorization.

Per accepted invariant:

- Apply the falsifiability gate; rewrite until it passes or discard.
- Classify enforcement: **test-enforced**, **runtime-guardrail-enforced** (fail-closed), or both. Anything an LLM or external system could violate at runtime must have a guardrail (rule 5).
- Run one adversarial pass — "how could this be violated?" Each credible violation path becomes a seed test case, recorded now.
- In module scope, mark each as new, or as a tightening of a named parent invariant.

Target 5–15 invariants for a large product, 3–8 for a module. More usually means contracts are masquerading as invariants; push them down to Phase 4.

## Phase 3 — Boundary map

Run the concept loop. Primer: `references/concept-primers.md#boundaries`.

A boundary exists wherever **ownership of state, consistency guarantees, or failure domain changes** — boundaries fall out of architectural seams, they are not chosen for testing convenience. Apply the boundary test (rule 4) to each. In module scope, the parent seam is enumerated first.

For every confirmed boundary, enumerate failure modes explicitly: timeout, partial success, retry, duplicate delivery, stale read, version skew. Integration tests must cover these, not just the happy path — inside a boundary things fail together (unit-test as a block); across it they fail independently.

Output: `boundary-map.md` with a Mermaid diagram and the per-boundary failure-mode list. Unanswered boundary tests are recorded as architecture findings.

## Phase 4 — Contracts and acceptance criteria

Run the concept loop. Primer: `references/concept-primers.md#contracts`.

Per boundary, capture the contract: valid inputs, guaranteed outputs, error behavior, idempotency semantics, ordering/latency expectations. Unit scope = a component honoring its own contract; integration scope = two components' assumptions about each other's contracts actually matching, including the Phase-3 failure modes.

Per user journey, write acceptance criteria as given/when/then at the **behavior** level, not the UI level, each tracing to at least one invariant or contract. These are ticket-shaped: they travel with the feature spec and are written before implementation.

## Phase 5 — LLM call sites (skip if there are none)

Run the concept loop over the two-layer split. Primer: `references/concept-primers.md#llm-eval-layers`; details and templates in `references/llm-eval-patterns.md`.

Inventory every call site by role (planner, reviewer, summarizer, judge) — each gets its own plan, because "good output" differs per role. Per site:

- **Contract layer — deterministic, classic harness.** Schema/enum/field validity, token and latency budgets, and the surrounding code (retry on malformed output, fallback, budget accounting) tested with a mocked LLM — the provider is a boundary like any external API. Runs every commit, binary pass/fail.
- **Quality layer — statistical evals.** A committed golden set per call site with a rubric and threshold ("≥90% acceptable on the 40 golden tasks, N≥3 runs each"). Single-run green is meaningless under non-determinism.

Additional obligations:

- **Judge calibration.** Any LLM-judging-LLM site requires a meta-eval: seeded-defect sets measuring catch rate and false-positive rate. An uncalibrated judge silently corrupts every downstream metric.
- **Trajectory evals for agentic loops.** Score the path, not just the destination: tool calls legal and sensible, step/token budget respected, no loops, escalated when required. Cheap version first — deterministic assertions over run telemetry.
- **Trust boundary.** Agent self-reported success signals are advisory only; they never feed promotion, canary, or quality metrics.
- **Model-swap harness.** The golden set *is* the swap regression suite; a provider or model change is acceptable iff the eval-suite delta is within threshold. No golden set → no swappability.
- **CI cost tiering.** Contract layer per commit; quality evals on prompt change, model change, and nightly; meta-evals on judge change. Record the tiering in the policy file so nobody "saves money" by silently skipping evals.

## Phase 6 — Risk tiers and coverage allocation

Run the concept loop. Primer: `references/concept-primers.md#risk-tiers`.

Build a probability × cost matrix over journeys and modules. Money paths and irreversible actions get exhaustive coverage; low-stakes surfaces get smoke tests. Nobody tests everything equally — make the allocation explicit and intentional, including where scale testing applies (driven by the Phase-1 deployment shape: load-test the contention point, e.g. one hot SKU in a flash sale, not raw uniform throughput).

**HARD STOP.** The human confirms the weighting (rule 7).

## Phase 7 — Tooling selection

Present a tooling menu per layer — runner, integration/fixture strategy, journey/E2E, LLM eval framework, CI host — with the tradeoffs that actually differ, not a feature matrix. Menu and selection heuristics: `references/tooling-menu.md`.

In module scope, the parent's existing stack is the default and the burden of proof is on divergence: a module introducing a second runner or a second eval framework must justify it, because it doubles the CI surface a future audit has to reason about.

**HARD STOP.** The human selects. Record the selection and the rejected alternatives with reasons in the policy file — the reasons are what make a future revisit cheap.

## Phase 8 — Deliverables and adversarial review

Produce, as Git-trackable files:

1. `invariants.md` — falsifiable statements with namespaced IDs, enforcement classification, adversarial seed cases, inherited-vs-new marking.
2. `boundary-map.md` — Mermaid diagram + per-boundary failure modes + open architecture findings. Parent seam first in module scope.
3. `contracts/` — one file per boundary; acceptance criteria embedded in journey tickets.
4. `llm-eval-plan.md` + `golden-sets/` scaffolds (empty sets with rubric and threshold headers count — the commitment precedes the content).
5. `validation-policy.yaml` — tier map, per-class gate requirements (blocking/advisory/waived), thresholds, golden-set and corpus locations, CI cost tiering, tooling selection. Layout and inheritance semantics: `references/policy-and-inheritance.md`. **This file is the contract a future audit diffs conformance against.**
6. `harness-backlog.md` — ticket-shaped, starting with the walking skeleton: a trivial end-to-end flow through real CI carrying one unit test, one integration test (including one boundary failure mode), one journey test, and one contract-layer LLM test if applicable. Every ticket has acceptance criteria and the invariant/contract it defends.
7. `elicitation-log.md` — the human's raw thinking per concept, with what was dropped and why.

**Adversarial review (final hard stop).** Before acceptance, run a reader test: simulate a production operator and a new engineer who have *only* these artifacts. Can they tell what must never break, where the boundaries are, which obligations are inherited from the parent, and what to do when a golden-set threshold fails? Gaps become findings; revise and re-present. Surgical edits with inline changelogs on revision — never wholesale rewrites.

## Ongoing case sourcing (for the life of the product)

Three channels, recorded in the policy file as standing obligations:

1. **Acceptance criteria** as each feature lands.
2. **Adversarial derivation** from invariants ("how could I violate this?") as the system evolves.
3. **Production incidents** — every bug becomes a regression test; every bad LLM output in prod becomes a golden case. Non-negotiable.

## Relationship to validation-harness-audit

Design → build → audit is one loop. This skill produces the `validation-policy.yaml` and golden sets; the audit skill later measures whether the built harness conforms and whether the gates actually catch seeded defects. Never let the audit's corpus be rewritten to match fixes; never let this skill's golden sets be authored after prompt tuning.

## Reference files

- `references/concept-primers.md` — per-concept frame, canonical cross-domain examples, grounding heuristics, common confusions, acceptance gate. **Read the relevant entry before beat 1 of every concept.**
- `references/question-bank.md` — beat-3 elicitation openers and beat-4 gap-closing probes per phase, plus scope/inheritance questions.
- `references/llm-eval-patterns.md` — golden-set format, rubric template, judge meta-eval design, trajectory assertions, CI tiering table. Read during Phase 5.
- `references/policy-and-inheritance.md` — policy file layout, `extends:` semantics, resolution order, tighten-only rule. Read during Phase 0 (module scope) and Phase 8.
- `references/tooling-menu.md` — tooling options per layer with selection heuristics. Read during Phase 7.

Used without the bundled files (as a bare prompt), this document is self-sufficient: derive the primers, question patterns, and templates from the phase descriptions above, and state your derived formats explicitly in the deliverables.
