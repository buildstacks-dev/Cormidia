---
name: validation-harness-design
description: Teach-first workflow that designs — and redesigns — a validation harness at design time, before code exists on first entry and again whenever the architecture moves. Reconciles user journeys, CLI/API/UI/MCP and event-driven behavior with state ownership and failure domains, then produces a system map, falsifiable invariants, a boundary map, per-boundary contracts, LLM eval plans, five-layer risk allocation, tooling selection, a traced case catalog, and a validation-policy.yaml a later audit can diff against. Use when planning tests or evals for a product, feature, module, or agentic system; defining invariants, boundaries, contracts, or acceptance criteria upfront; deciding which validation layer (invariant/contract, hermetic system, live sandbox, eval, ops hardening) a check belongs to; designing evals for LLM calls or agent loops; preparing a safe model swap; building an isolated replacement harness beside an incumbent suite; extending a module harness; revising a harness that no longer fits the architecture; or when the user asks things like "how should I test this", "what evals do I need", or "build a validation harness for module X of product Y". Complements validation-harness-audit — the audit measures an existing harness; this skill designs one that does not exist yet, or redesigns one that no longer fits.
---

# Validation Harness Design

Design — and redesign — the validation surface for a product or module **at design time**: before code exists on first entry, and re-entered whenever the architecture moves or the harness itself proves wrongly shaped. The output is not an exhaustive test-case list — it is the set of durable artifacts from which cases are derived for the life of the product: a reconciled system map, falsifiable invariants, a boundary map, per-boundary contracts, LLM eval plans, a risk-weighted coverage allocation across the five validation layers, a tooling decision, a traced case catalog, and a ticket-shaped harness-skeleton backlog. Case-level evolution happens continuously through the sourcing channels; structural revision happens by re-entering this skill in `harness-revision` mode — a harness that can only grow, never be reshaped, calcifies around its first mistake.

**Stance: teach, then elicit, then synthesize.** The human is the domain expert, but domain expertise is not the same as fluency in validation vocabulary. Do not open a phase by presenting candidate invariants or boundaries for review — that turns a design session into a review task and silently hands you the framing power. Every concept is taught before it is applied, and the human's own unstructured thinking is the primary input to synthesis. Anything you originate is labeled and requires confirmation. The human owns product truth, consequence, and risk acceptance; the agent owns disciplined derivation and must return every unknown expected behavior to the human rather than silently inventing it.

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
12. **Every check lands at the cheapest layer that can falsify it.** The five-layer taxonomy below governs placement; its four layer rules (prove it a layer down, no silent absence, evidence deposits a detector, security is split) carry the same rank as the rules above.
13. **Map behavior and structure before deriving claims.** Reconcile the behavioral view (actor → stimulus → journey → state transition → effect → observation) with the structural view (components → state ownership → dependencies → consistency and failure domains). Interfaces are entry and observation adapters, not duplicated behaviors; journeys alone do not define boundaries.
14. **Completeness is not quantity.** Seek a complete scoped map and a compact durable invariant set, not the largest list. Boundaries must be complete for the declared scope; contracts and cases become progressively more numerous beneath them.
15. **Design controlled seams early; implement them after contracts.** A hermetic system is real composition with nondeterminism controlled, not a "fake layer." Specify what each boundary double must simulate during boundary design, finalize it with the contract, and build it in the walking skeleton. Preserve a named live obligation for every real behavior the double cannot prove.
16. **Every detector ships its negative control.** A check proves it can fire before it proves the system passes: each detector family lands red-then-green against a seeded violation — a mutated fixture, a planted defect, a double scripted to misbehave. The walking skeleton's per-layer tests carry theirs from day one. A detector that has never seen the defect it exists to catch is an assumption, not a guard.
17. **The harness is itself a tested artifact.** Fixtures get self-tests; scanners and sweeps assert their walk found subjects (an empty walk fails, never passes); policy loaders, CI configuration, and dispatch/registry surfaces are pinned by tests of their own. A guard nobody guards is a silent absence — treat it exactly like an undeclared-empty lane.

## The layer taxonomy

Every check this skill designs lands in one of five validation layers. A layer is defined by **the question it answers** — "what can be false?" — never by the technology inside it, so the same five names serve a CRUD app and an autonomous agentic system. Two axes generate the taxonomy: *is the verdict deterministic?* and *does the test touch the real world?* Teach it in Phase 1 (frame and ground beats only — it is a fixed frame, not an elicited concept); primer: `references/concept-primers.md#layer-taxonomy`.

| # | Layer | Question it answers | Verdict | Spend / side effects | Cadence |
|---|---|---|---|---|---|
| 1 | **Invariant / contract** | Can the machinery lie? | Deterministic | None | Every commit |
| 2 | **Hermetic system** | Can composition lie? | Deterministic | None | Every commit |
| 3 | **Live system (sandbox)** | Can the real world break the seams? | Nondeterministic, binary | Real, bounded, disposable | Pre-merge / pre-release |
| 4 | **Eval / qualification** | Can the model be wrong while the machinery is right? | Statistical, threshold over N runs | Token cost, separately authorized | Prompt/model change · nightly · release qualification |
| 5 | **Ops hardening** | Can time, load, or an adversary hurt you? | Mixed | Production-shaped | Pre-GA, then recurring |

The economic thesis is simple: rapid iteration comes from the **cheapest trustworthy answer**, not the largest suite. If every composition question requires a live environment, the harness is slow regardless of case count.

The four layer rules:

- **Prove it a layer down.** Each layer exists to cover the blind spot of the one below; before a check lands at an expensive layer, ask whether a cheaper layer could falsify it. Layer 2 is where most composition risk dies — the only place composition meets determinism, which is what makes iteration cheap. Layer 3 is reserved for seams that cannot be faked honestly (vendor auth handshakes, CI, OS schedulers, vendor behavior that has burned you before).
- **Layers may be empty, never silently absent.** A product with no model call sites declares layer 4 empty with a reason in `validation-policy.yaml`. A future audit treats a declared-empty lane as a decision and an undeclared-absent lane as a finding. This rule is what lets one taxonomy scale from a throwaway tool to an autonomous system.
- **Evidence is not a regression suite.** Layers 3–4 produce evidence; every deterministic defect they surface deposits a layer-1/2 detector in the same change. A green live run proves that run, nothing more.
- **Security is split, not a layer.** Security invariants (tenancy, authorization, deny-by-default, no silent overwrite) enter layer 1 from day one via Phase 2; layer 5 holds only the assurance half (threat model, secret handling, abuse surfaces).

## The concept loop

Apply these four beats to **each** concept in Phases 2–6. Read the concept's entry in `references/concept-primers.md` before beat 1.

**Beat 1 — Frame.** State what the concept is, why it exists, and what it is commonly confused with. Give 2–3 canonical examples drawn from domains *other* than the human's. Keep it to a few short paragraphs — this is orientation, not a lecture.

**Beat 2 — Ground.** Walk one worked example out of the human's own architecture doc, showing the derivation. Label it explicitly: *this is an illustration of the shape, not a proposal, and not a boundary on your thinking.* To limit anchoring, draw the example from a **different subsystem than the one under design** wherever the doc allows, and never give more than two — unless the human says examples are what unlocks their thinking for this concept (most common with invariants). Then expand the grounding set to 3–5 worked derivations spanning the concept's categories, each showing *why* it passes the acceptance gate, plus one near-miss that fails it (e.g. a contract masquerading as an invariant). Expanded grounding stays teaching material: draw from subsystems away from the human's current focus, label every item an illustration, and after the human's beat-3 ramble ask what the examples made them think of that the examples themselves don't cover — the example set must never quietly become the candidate list.

**Beat 3 — Elicit.** Hand the floor over. Invite unstructured thinking — rambling, half-formed, out of order, in whatever register the human prefers. Do not supply a template, a numbered list to fill, or a candidate set. Ask at most one focusing question. Then stop and wait; do not answer your own prompt.

**Beat 4 — Synthesize.** Combine, in this order: (a) what the human said, (b) what the architecture doc supports, (c) patterns from comparable systems, labeled `PROPOSED`. Present the structured candidate set with provenance marked per item — `[stated]`, `[doc]`, or `[PROPOSED]`. Apply the concept's acceptance gate (falsifiability, boundary test, contract completeness). Treat an unknown expected outcome as a product-truth finding, not an invitation to choose for the human. Confirm before moving on.

**Loop controls:**

- **Depth.** Teach-first is the default. If the human signals fluency ("skip the framing", "I know what an invariant is", "go fast"), collapse beats 1–2 into a two-sentence recap for that concept only — never silently across the whole session. Ask once at Phase 0 whether any concept should run in fast mode.
- **Differentiated elicitation.** Beat 3 is strictly human-first for the concepts that encode business consequence — **invariants and risk tiers**: never open them with a candidate list; the human rambles, you structure. For concepts derivable from the architecture doc — **boundaries and contracts** — a propose-then-correct variant is acceptable after beats 1–2: present a doc-derived draft (every item marked `[doc]` or `[PROPOSED]`) and elicit corrections. The reason for the split: a plausible-looking invariant list gets approved while the one thing only the human knows never surfaces; a boundary list is checkable against written architecture.
- **Backflow.** Concepts are not independent: boundaries routinely reveal invariants, and contracts reveal missing boundaries. When a later beat invalidates an earlier artifact, say so explicitly, reopen that concept, and note the revision — do not quietly patch it.
- **Elicitation log.** Capture the human's beat-3 input close to verbatim in `elicitation-log.md`. It is the provenance trail for every `[stated]` item and the record of what was considered and dropped.
- **Checkpoint.** After each concept completes beat 4, write current state to `harness-design-state.md` (scope, tier, concepts completed, open findings, pending confirmations) so an interrupted session resumes without re-interrogation.

## Division of labor

The phases below run inside a standing human↔agent protocol. Its premise: alignment produces artifacts that are checkable without the human — **the artifacts are the compression of human judgment; case derivation is decompression.** Where an artifact encodes business consequence, the human thinks first; where it is derivable from the docs, the agent drafts first.

1. **Human + agent align the picture** — the reconciled system map: architecture, interface surfaces, flows, and events (Phases 0–1).
2. **Agent proposes, human corrects:** boundary map with its honest-fake column, and per-boundary contracts (Phases 3–4).
3. **Human rambles, agent structures:** invariants and risk weighting (Phases 2 and 6) — the inverted step; see Differentiated elicitation.
4. **Human confirms the assembled artifact set** — the last heavyweight alignment point.
5. **Agent alone: walking skeleton** — the honest fakes plus one real test per layer through real CI, *before* mass case implementation (catalog derivation is never deferred — Phase 6).
6. **Agent alone: exhaustive derivation** — the case derivation grammar (Phase 6) applied over the ratified artifacts to matrix closure (every cell traced or risk-pruned by name), each case landing at the cheapest layer that can falsify it (rule 12), every unknown expected outcome returned to the human.
7. **Human spot-reviews by risk tier** — audit the top-tier paths, smoke-check the rest; never line-by-line.

Two structural rules the protocol depends on:

- **Stimulus taxonomy.** Enumerate stimuli in two families of matrix rows — *user events* (each interface operation) and *time events* (each scheduled tick). *Adversity events* (crash, kill, restart, partition) are never rows: they are modifiers applied at every flow step via the failure-mode checklist. Treating "process restart" as one event yields one test; treating it as a modifier yields the mid-flow cases intuition misses.
- **Interfaces are adapters, not surfaces to re-test.** When a product exposes several interfaces (CLI, API, MCP, UI) over one core, core behavior is validated once at the cheapest layer that can falsify it; each interface gets thin adapter coverage only — parsing, auth, serialization, error mapping, exit codes — plus one cross-surface agreement check that all adapters expose the same operations with the same semantics (rule 13). A behavioral re-run per interface is a framework failure, not thoroughness.

## Phase 0 — Scope declaration and parent ingestion

Establish the scope before anything else. Four modes:

- **`product`** — whole system, no parent harness.
- **`module-of-built-parent`** — a subsystem of a product whose harness already exists in code and policy.
- **`module-of-designed-parent`** — a subsystem of a product whose harness has been designed but not yet built.
- **`harness-revision`** — re-entry into an existing harness design (this skill's own artifacts) because the architecture moved, a layer was mis-designed, or an audit surfaced structural findings. Ingest the existing artifacts as the baseline, diff them against the current architecture doc, and reopen **only** the affected concepts — surgical edits with inline changelogs (Phase 8 revision style), never a wholesale redesign. Unaffected invariants, boundaries, and policy entries stay untouched; every reopened artifact records why it was reopened. Retired invariants keep their IDs (`retired: <date, reason>`) so historical audit findings stay traceable.

For module modes, ingest the parent before eliciting anything. Locate and read: the parent `validation-policy.yaml`, `invariants.md`, `boundary-map.md`, `contracts/`, existing test directories and CI config. If artifacts are missing, ask for paths; if the parent genuinely has none, say so plainly and offer either a shallow parent pass first or an explicit decision to design the module standalone and reconcile later. Do not invent the parent's invariants.

Then establish, and confirm:

- **ID namespacing.** Parent and module invariants/contracts carry distinct prefixes (`OPERON-INV-003`, `LL-INV-007`) so a later audit can trace which layer a conformance failure belongs to.
- **Inheritance set.** Which parent invariants constrain this module. These are referenced, not restated (rule 10). The module may add new ones or tighten inherited ones; it may never weaken one.
- **The parent seam is a mandatory boundary.** The interface between module and the rest of the product is enumerated in Phase 3 without exception, and is usually the single highest-value boundary in the map — it carries the module's contract to everything else.
- **Contradiction handling.** If the module's design conflicts with a parent invariant or contract, record it as a finding and escalate to the human. Never resolve it silently in either direction.

For **`product`** scope on a large system, go deliberately broad and shallow: produce a module map naming each subsystem, its criticality, and whether it warrants its own later deep pass with this skill. Product-level artifacts should cover cross-cutting invariants and inter-module boundaries — not attempt every module's internals in one sitting.

**Existing-harness coexistence posture.** Scope mode and implementation posture are separate decisions. When the user wants a clean-room or replacement harness beside an incumbent suite, declare `parallel-greenfield`, name one isolated harness root, and mark the incumbent tests, evaluation assets, gates, and CI as read-only. Inspect them only to understand claims and compatibility unless the user narrows that further. Do not weaken, delete, redirect, or replace incumbent gates until a later explicit migration decision with equivalence criteria, rollback, and ownership. New checks and artifacts stay under the isolated root. CI has two halves under this posture: an additive lane running only the isolated root is walking-skeleton scope — required from the first skeleton ticket, because an unenforced harness enforces nothing — while any integration with the incumbent's pipelines (shared commands, required checks, gate redirection) stays opt-in until ratified cutover.

**HARD STOP.** Confirm scope, mode, parent artifact set, coexistence posture and protected paths when applicable, and (for product scope) the module map.

## Phase 1 — Inputs, system map, and criticality tier

Require an architecture document (or any written system description — design doc, spec, README-driven sketch). If none exists, build a one-page system brief through interview first: components, state each owns, external dependencies, user journeys, deployment shape (single-install two-user tool vs multi-tenant SaaS — this parameterizes scale testing later).

Before proposing invariants, build and reconcile two views. Read `references/concept-primers.md#system-mapping`, frame the distinction, invite the human to walk the product in their own words, then synthesize:

- **Behavioral view:** actors and initiating systems; commands, requests, events, signals, time and recovery stimuli; journeys and outcomes; state transitions; durable or external effects; observations; and every supported entry/observation surface. Treat CLI, API, UI, MCP, webhooks, timers, and OS signals as adapters or stimuli around behavior, not as separate copies of the behavior. Enumerate stimuli per the stimulus taxonomy (Division of labor): user events and time events are the rows; adversity is a modifier, not a row.
- **Structural view:** components, deployment units, exact state owners and writers, external dependencies, consistency changes, version-skew possibilities, and independent failure domains.
- **Reconciliation view:** for each journey, identify which components and state owners it crosses, which effects are irreversible, and where observed behavior or ownership is unknown. Record unknowns as architecture or product-truth findings.

Write the result to `system-map.md`. This working map does not replace the architecture document; it makes the derivation surface explicit. Do not proceed from a list of interfaces alone, and do not wait for perfect documentation — validation design is allowed to expose gaps.

Teach the layer taxonomy here — frame and ground beats only, since it is a fixed frame rather than an elicited concept. The tier and deployment shape decide how heavy layers 3–5 must be; the taxonomy gives every later phase its placement vocabulary.

Propose a criticality tier on the C0–C4 scale shared with validation-harness-audit, whose `references/criticality-model.md` is the canonical rubric for both skills — **C0** experimental/throwaway, **C1** limited (local or bounded internal use, reversible consequences), **C2** production (customer-facing or persistent production data — money, customer data, reputation), **C3** high-consequence (serious financial, privacy, regulatory, or broad operational harm), **C4** safety/mission-critical — with per-component overrides (a `billing/` module inside a C1 tool is C2 or higher). Cite the evidence behind each. In module scope, the module **inherits the parent tier by default**; any override is stated with justification.

**HARD STOP.** Confirm the reconciled system map and tier. They decide which behaviors and failure modes are in scope, coverage depth per risk tier, how heavy the LLM eval program needs to be, and which layer-5 obligations apply (Phase 6).

## Phase 2 — Invariants

Run the concept loop. Primer: `references/concept-primers.md#invariants`. Beat-3 prompts and beat-4 probes: `references/question-bank.md`.

Categories to cover in beat 4 if the human's own thinking didn't reach them: money and irreversible actions, state machines and legal transitions, resource conservation, uniqueness and mapping, ordering and idempotency, tenancy and authorization.

Per accepted invariant:

- Apply the falsifiability gate; rewrite until it passes or discard.
- Classify enforcement: **test-enforced**, **runtime-guardrail-enforced** (fail-closed), or both. Anything an LLM or external system could violate at runtime must have a guardrail (rule 5).
- Run one adversarial pass — "how could this be violated?" Each credible violation path becomes a seed test case, recorded now.
- In module scope, mark each as new, or as a tightening of a named parent invariant.

Target 5–15 invariants for a large product, 3–8 for a module. Completeness means covering the credible consequence classes exposed by the system map, not maximizing the count. More usually means contracts are masquerading as invariants; push them down to Phase 4. The sorting test: a statement that names a specific operation is that operation's *contract*; a property that must survive *every* operation is an invariant. Smallness is not a style choice — the invariant list is the compression the human can hold in their head and the agent re-checks after every change; completeness lives in the contracts.

## Phase 3 — Boundary map

Run the concept loop. Primer: `references/concept-primers.md#boundaries`.

A boundary exists wherever **ownership of state, consistency guarantees, or failure domain changes** — boundaries fall out of the structural view, not interface names or testing convenience. Overlay the behavioral view afterward to show which journeys cross each seam. Apply the boundary test (rule 4) to each. In module scope, enumerate the parent seam first.

For every confirmed boundary, enumerate failure modes explicitly: timeout, partial success, retry, duplicate delivery, stale read, version skew, crash-mid-step. This checklist is also the mechanical complement to intuition during flow walks — applied at every boundary crossing of every flow, it yields the mid-flow cases (crashed after the write, before the acknowledgment) that journey intuition reliably skips. Layer-2 tests must cover these, not just the happy path — inside a boundary things fail together (test as a block); across it they fail independently.

Then apply the **honest-fake test** to each boundary: can it be controlled without lying about its failure modes? Fakeable boundaries anchor layer-2 hermetic coverage — including everything nondeterministic, so clock, randomness, network, environment, and process outcomes are sealed with test doubles too. The verdict is recorded as a per-boundary **honest-fake column** in `boundary-map.md` — the fake decision is an attribute of each boundary, never a separate phase. Specify the success and failure semantics each double must reproduce as first-class scriptable behavior ("this call 500s twice, then succeeds") plus the real behaviors it cannot prove — a fake that only returns success proves the system works against a world that doesn't exist, and every unproven real behavior retains a named live-sandbox obligation (rule 15). Guard against drift: one conformance suite runs against both the fake and the real dependency — routinely against the fake, periodically against the real thing — so the fake cannot silently diverge from the vendor. Unfakeable seams (vendor auth handshakes, CI, OS schedulers, vendor behavior that has burned you before) become layer-3 obligations, each with a named disposable target and a spend bound; a layer-3 seam with no disposable target is an architecture finding, not a smaller test.

Output: `boundary-map.md` with a Mermaid diagram, journey intersections, the per-boundary failure-mode list, the honest-fake column carrying each controlled-seam specification and its unproven real semantics, and each boundary's layer placement (hermetic vs live-sandbox). Record unanswered boundary tests as architecture findings.

## Phase 4 — Contracts and acceptance criteria

Run the concept loop. Primer: `references/concept-primers.md#contracts`.

Per boundary, capture the contract: valid inputs, guaranteed outputs, error behavior, idempotency semantics, ordering/latency expectations. Layer-1 scope = a component honoring its own contract; layer-2 scope = two components' assumptions about each other's contracts actually matching, including the Phase-3 failure modes.

Per user journey, write acceptance criteria as given/when/then at the **behavior** level, not the UI level, each tracing to at least one invariant or contract. These are ticket-shaped: they travel with the feature spec and are written before implementation.

Where several entry surfaces expose one behavior, write the core operation's contract once and validate it at the lowest sufficient layer; each CLI/API/UI/MCP or event adapter gets a focused conformance obligation — parsing, auth, serialization, error mapping, exit codes — plus one cross-surface agreement check that all adapters expose the same operations with the same semantics (Division of labor). Do not clone the full behavioral suite under every interface.

Contracts need numbers — timeouts, freshness windows, retry budgets, latency bounds. Where no ratified value exists, do not park the parameter as `OPEN`: an `OPEN` tolerance makes the contract untestable and stalls every case derived from it. Reserve `OPEN` for parameters whose *semantics* are undecided; for values merely awaiting tuning, propose a provisional default, label it `PROPOSED`, and record it in the policy file with an owner and an expiry (the waiver shape — `references/policy-and-inheritance.md`). Tests assert the provisional value; an expired provisional is an active finding, so the number cannot silently fossilize.

## Phase 5 — LLM call sites (skip if there are none)

Run the concept loop over the two-layer split. Primer: `references/concept-primers.md#llm-eval-layers`; details and templates in `references/llm-eval-patterns.md`.

Inventory every call site by role (planner, reviewer, summarizer, judge) — each gets its own plan, because "good output" differs per role. Per site:

- **Contract layer — deterministic, classic harness (lands in layers 1–2).** Schema/enum/field validity, token and latency budgets, and the surrounding code (retry on malformed output, fallback, budget accounting) tested with a mocked LLM — the provider is a boundary like any external API. Runs every commit, binary pass/fail.
- **Quality layer — statistical evals (the layer-4 lane).** A committed golden set per call site with a rubric and threshold ("≥90% acceptable on the 40 golden tasks, N≥3 runs each"). Single-run green is meaningless under non-determinism. Layer 4 sits beside layers 1–3 for every model-touching surface — it never substitutes for them; the envelope is tested deterministically even when the judgment inside it is evaluated statistically.

Additional obligations:

- **Judge calibration.** Any LLM-judging-LLM site requires a meta-eval: seeded-defect sets measuring catch rate and false-positive rate. An uncalibrated judge silently corrupts every downstream metric.
- **Trajectory evals for agentic loops.** Score the path, not just the destination: tool calls legal and sensible, step/token budget respected, no loops, escalated when required. Cheap version first — deterministic assertions over run telemetry.
- **Trust boundary.** Agent self-reported success signals are advisory only; they never feed promotion, canary, or quality metrics.
- **Model-swap harness.** The golden set *is* the swap regression suite; a provider or model change is acceptable iff the eval-suite delta is within threshold. No golden set → no swappability.
- **CI cost tiering.** Contract layer per commit; quality evals on prompt change, model change, and nightly; meta-evals on judge change. Record the tiering in the policy file so nobody "saves money" by silently skipping evals.

## Phase 6 — Risk tiers and coverage allocation

Run the concept loop. Primer: `references/concept-primers.md#risk-tiers`.

Build a probability × cost matrix over journeys and modules. Money paths and irreversible actions get exhaustive coverage; low-stakes surfaces get smoke tests. Nobody tests everything equally — make the allocation explicit and intentional, and state it **per layer**: which journeys get layer-2 depth, which seams get layer-3 runs, where scale testing applies (driven by the Phase-1 deployment shape: load-test the contention point, e.g. one hot SKU in a flash sale, not raw uniform throughput).

This phase also fixes the **layer-5 obligations**, gated by the Phase-1 tier and deployment shape:

- **C2 and above:** a threat model and a scale test at the contention point.
- **Any always-on or autonomous deployment shape:** soak — state growth under retention, missed-tick/clock-skew reconciliation after sleep, cost integrity under retries and provider partials. Multi-day where the failure mode is cumulative; microbenchmarks prove nothing here.
- Each obligation lands in the policy file as a scheduled, owned entry — an aspiration without an owner and a trigger is a silent absence.

**HARD STOP.** The human confirms the weighting and the layer-5 obligations (rule 7).

### Case derivation grammar

After risk confirmation, derive case families mechanically rather than brainstorming from a blank page:

| Source artifact | Derive |
|---|---|
| Journey | success, refusal, interruption, recovery, alternative initiators and observations |
| State machine | every legal transition, every illegal transition, replay, and crash point |
| Invariant | every credible violation path and the guardrail response |
| Boundary | success, timeout, partial success, retry, duplicate, stale read, and version skew |
| Contract | valid and invalid inputs, outputs, typed errors, idempotency, ordering, freshness, and latency |
| Interface adapter | conformance to the shared underlying behavior, including error translation |
| LLM call site | deterministic envelope, statistical quality, trajectory, and judge calibration as applicable |
| Operational obligation | load at the contention point, soak, resource growth, clock skew, abuse, and recovery |

Rows come from the stimulus taxonomy (Division of labor): user events and time events enumerate the journeys; adversity is applied at every flow step through the Phase-3 failure-mode checklist, never enumerated as rows of its own. Risk prunes this matrix; do not exercise the full Cartesian product. Once the source artifacts and expected outcomes are ratified, let the agent generate and maintain traced cases with high autonomy (Division of labor steps 5–6). Return any unknown expected outcome to the human.

**Derivation and implementation are separate acts with separate gates.** Deriving the catalog — enumerating traced case entries from the ratified artifacts — is design work: it needs no fixtures, no code, and no external authorization, and it completes *inside this campaign*. Derivation is done at **matrix closure**: every cell (source artifact × derivation row) carries at least one traced case in `case-catalog.md` or a named risk-pruning reason — a silent empty cell is a finding, exactly like an undeclared-absent lane. *Implementing* cases as executable checks is build work, gated per layer by the walking skeleton (Phase 8). Freezing catalog derivation behind implementation conditions — a live target that doesn't exist yet, an unpassed eval threshold, unauthorized CI — is how a harness designs itself into a stall: a few dozen skeleton tests standing in for a derivation surface of hundreds.

**Machine-readable companion.** Emit `case-catalog.yaml` in the same step as `case-catalog.md` — one entry per family (id, layers, oracle, risk, prune/blocked status + reason, owning backlog ticket, wave). Schema id: `validation-architect/case-catalog/v1`. The markdown catalog remains the human artifact; the YAML is what the `validation-trace` CLI (and the product repo's CI) consumes. The two MUST agree on family ids, prune tokens, and blocked-by — disagreement is a corpus bug. Regenerate the YAML whenever the markdown catalog or the backlog's family claims change.

## Phase 7 — Tooling selection

Present a tooling menu per layer — invariant/contract runner, hermetic fixture strategy, live-sandbox targets, eval framework, ops-hardening tools, CI host — with the tradeoffs that actually differ, not a feature matrix. Menu and selection heuristics: `references/tooling-menu.md`.

In module scope, the parent's existing stack is the default and the burden of proof is on divergence: a module introducing a second runner or a second eval framework must justify it, because it doubles the CI surface a future audit has to reason about.

Under `parallel-greenfield`, select tooling and commands that stay inside the isolated root. Define migration equivalence and rollback criteria now, but do not switch incumbent commands or required gates.

**HARD STOP.** The human selects. Record the selection and the rejected alternatives with reasons in the policy file — the reasons are what make a future revisit cheap.

## Phase 8 — Deliverables and adversarial review

Produce, as Git-trackable files:

1. `system-map.md` — behavioral view, structural view, reconciliation table, supported entry/observation surfaces, intended use, deployment shape, criticality, and open product-truth/architecture findings.
2. `invariants.md` — falsifiable statements with namespaced IDs, enforcement classification, adversarial seed cases, inherited-vs-new marking.
3. `boundary-map.md` — Mermaid diagram + journey intersections + per-boundary failure modes + honest-fake column with controlled-seam specification + unproven real semantics + layer placement + open architecture findings. Parent seam first in module scope.
4. `contracts/` — one file per boundary; acceptance criteria embedded in journey tickets.
5. `llm-eval-plan.md` + `golden-sets/` scaffolds (empty sets with rubric and threshold headers count — the commitment precedes the content).
6. `validation-policy.yaml` — tier map, the five layer lanes with any empty lane declared and reasoned, per-class gate requirements (blocking/advisory/waived), thresholds, golden-set and corpus locations, CI cost tiering, layer-5 obligations, tooling selection, and any coexistence/migration constraints. Layout and inheritance semantics: `references/policy-and-inheritance.md`. **This file is the contract a future audit diffs conformance against.**
7. `case-catalog.md` + `case-catalog.yaml` — traced case families derived from journeys, states, invariants, boundaries, contracts, interfaces, model sites, and operational obligations; include risk, layer, oracle, and source IDs. Derive both to matrix closure now (Phase 6): every cell traced or risk-pruned by name; the YAML is the machine-readable companion (schema `validation-architect/case-catalog/v1`) and MUST agree with the markdown. Only the *executable authoring* of cases waits for the walking skeleton's fixtures — catalog derivation never does.
8. `harness-backlog.md` — ticket-shaped, starting with the walking skeleton: a trivial end-to-end flow through real CI carrying one layer-1 invariant/contract test, one layer-2 hermetic composition test (including one boundary failure mode), one journey test (layer 2 by default; a layer-3 sandbox smoke where an unfakeable seam exists), and one LLM contract test if applicable — each skeleton test paired with its negative control (rule 16), plus the harness's own self-tests (rule 17) and, under `parallel-greenfield`, the additive CI lane over the isolated root. The skeleton — including the honest fakes it exercises — lands *before* mass case implementation (Division of labor step 5): cases *implemented* before the fixtures exist get written to what is convenient to test rather than what the contracts require; catalog *derivation* is never deferred (Phase 6). **Expansion gates are scoped per layer:** a layer's implementation tickets are gated only on that layer's own skeleton and fixtures — a missing live target, an unpassed eval threshold, or unauthorized CI parks only its own layer's tickets, never layer-1/2 implementation. A gate that references conditions outside the layer it gates is a design defect. Every ticket has acceptance criteria, the invariant/contract it defends, its layer, and a named executor (human, standing coding agent, or scheduled build campaign) — a backlog without owners is a designed stall. Under `parallel-greenfield`, include migration equivalence, rollback, and explicit cutover tickets; none execute implicitly.
9. `elicitation-log.md` — the human's raw thinking per concept, with what was dropped and why.
10. `agents-md-contribution.md` — a proposed section for the repo's agent-instructions file (`AGENTS.md`, `AGENTS.md`, or equivalent), ready to land verbatim. The harness is operated by whatever coding agent works in the repo next, and that agent reads the standing instructions — not this skill's artifacts — unless the instructions route it there. The section states: where the design artifacts live (mirror the policy `artifacts:` block); that a feature change starts from the journey's acceptance criteria and the affected boundary's contract, and deposits its cases per the case derivation grammar at the cheapest layer that can falsify them, updating `case-catalog.md` *and* `case-catalog.yaml` traceability; that every bug fix deposits its detector in the same change; that gates and golden sets are never weakened to make a change pass, and the policy is tighten-only; that the normative **traceability conventions** the product repo's CI enforces via `validation-trace` are listed (test directories named by family ID; spec headers cite `CF-…` + owning `HB-…`; every implementable family owns ≥1 citing spec or a declared pending wave; implement tickets via the `implement-harness-ticket` skill; regenerate `owner-backlog.md` when the backlog changes); and that a structural mismatch (boundary map contradicts the architecture, mis-placed lane) means re-entering this skill in `harness-revision` mode, not piling cases onto a wrong shape. Under `parallel-greenfield`, it also names the isolated root and the protected incumbent paths. If the repo's agent-instructions file is human-ratified, present the section as a proposal with rationale — never silently rewrite it.
11. `owner-briefing.md` — the ratification-moment briefing for the human owner. Non-normative by construction (generated from the ratified artifacts; on disagreement the artifact wins). Narrative, 2–4 pages, consequence language, no unexplained ID on first use. Fixed section shape: (1) what this product can break (the tier, told as stakes); (2) the promises (each invariant as one plain sentence); (3) the seams (boundaries as places where two systems can disagree about what happened); (4) what we deliberately will NOT test, and why; (5) the decisions on the owner's desk — one entry per ratification item, each with what saying yes commits them to; (6) what is still unknown (open findings, in terms of the incident they'd face); (7) what gets built, in what order — one paragraph per backlog wave in consequence language. Per-ticket depth does NOT belong here.
12. `owner-backlog.md` — the living follow-along companion. Non-normative; one consequence-language paragraph per wave and per backlog ticket: which promise the ticket defends, the plain story of the failure it exists to catch, and what "done" buys the owner. State the backlog revision it was generated from; regenerate whenever `harness-backlog.md` changes (the AGENTS.md contribution carries that staleness contract).

**Adversarial review (final hard stop).** Before acceptance, run a reader test: simulate a production operator and a new engineer who have *only* these artifacts. Can they distinguish behavior from interface adapters, tell what must never break, locate every boundary, identify unknown product truth, understand controlled versus live seams, see inherited and coexistence obligations, tell which derivation-matrix cells are covered, pruned, or still open, and know what to do when a golden-set threshold fails? Add a third reader: a coding agent landing a feature with *only* the repo's standing instructions — do those instructions route it to the contracts it must honor and the catalog it must extend? Gaps become findings; revise and re-present. Surgical edits with inline changelogs on revision — never wholesale rewrites. The owner documents (items 11–12) are part of the reader-test surface: an exhausted owner who has only `owner-briefing.md` must be able to ratify; an owner tracking progress who has only `owner-backlog.md` must be able to follow along without the ID-dense backlog.

## Ongoing case sourcing (for the life of the product)

Three channels, recorded in the policy file as standing obligations:

1. **Acceptance criteria** as each feature lands.
2. **Adversarial derivation** from invariants ("how could I violate this?") as the system evolves.
3. **Production incidents** — every bug becomes a regression test; every bad LLM output in prod becomes a golden case. Non-negotiable.

The three channels only fire if the coding agents working in the repo are routed to these artifacts — that routing is the `agents-md-contribution.md` deliverable (Phase 8), and it must be kept current as artifact locations move. Apply the case derivation grammar whenever a journey, state machine, interface, boundary, or contract changes. The evidence-deposit layer rule applies across all three channels: any deterministic defect surfaced by a layer-3 run or a layer-4 campaign deposits its layer-1/2 detector in the same change. Case sourcing handles growth; when the *structure* no longer fits — the system map or boundary map contradicts the architecture, a lane is mis-placed — re-enter this skill in `harness-revision` mode rather than piling cases onto a wrong shape.

## Relationship to validation-harness-audit

Design → build → audit → revise is one loop. This skill produces the durable spec — `validation-policy.yaml`, invariants, boundary map, contracts, golden sets. validation-harness-audit later measures whether the built system conforms and whether the gates actually catch defects (its `assess` and `verify` modes), remediates approved gaps (`harden` mode), and issues a scoped, evidence-backed release verdict against a stated assurance target. The two skills share the C0–C4 criticality scale — the audit's `references/criticality-model.md` is the canonical rubric — and the layer lanes in the policy file are the audit's diff surface: an undeclared-absent lane is a finding, a declared-empty lane is a decision. The audit routes findings by kind: **case-level** gaps (a missing test, a weak oracle, a skipped gate) land in its harden backlog with traceability to the claim they defend; **structural** findings (the boundary map contradicts the architecture, a mis-placed lane, invariants that no longer describe the system) re-enter this skill in `harness-revision` mode. Never let the audit's corpus or holdouts be rewritten to match fixes; never let this skill's golden sets be authored after prompt tuning.

## Reference files

- `references/concept-primers.md` — layer taxonomy, system mapping, and per-concept frames, canonical cross-domain examples, grounding heuristics, common confusions, acceptance gates. **Read the system-mapping and layer-taxonomy entries before Phase 1, and the relevant entry before beat 1 of every later concept.**
- `references/question-bank.md` — beat-3 elicitation openers and beat-4 gap-closing probes per phase, plus scope/inheritance questions.
- `references/llm-eval-patterns.md` — golden-set format, rubric template, judge meta-eval design, trajectory assertions, CI tiering table. Read during Phase 5.
- `references/policy-and-inheritance.md` — policy file layout, `extends:` semantics, resolution order, tighten-only rule. Read during Phase 0 (module scope) and Phase 8.
- `references/tooling-menu.md` — tooling options per layer with selection heuristics. Read during Phase 7.

Used without the bundled files (as a bare prompt), this document is self-sufficient: derive the primers, question patterns, and templates from the phase descriptions above, and state your derived formats explicitly in the deliverables.
