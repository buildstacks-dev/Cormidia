# Harness Policy Conformance

Read this reference when the repository carries artifacts produced by the companion skill **validation-harness-design**: `validation-policy.yaml` (product and module files), `system-map.md`, `invariants.md`, `boundary-map.md`, `contracts/`, `llm-eval-plan.md`, golden-set directories, `case-catalog.md`, `harness-backlog.md`, or `agents-md-contribution.md`. The policy's `artifacts:` block names where they live.

These artifacts were confirmed by a human at design time. They are the declared harness — the baseline this audit diffs the built system against. The schema authority for the policy file is the design skill's `references/policy-and-inheritance.md`; this file describes the consuming side only. When both skills evolve, the design skill's layout wins and this file follows it.

## 1. The five-layer taxonomy

Every check the design skill places lands in one of five validation layers, defined by the question each answers — never by the technology inside it:

| # | Layer | Question it answers | Verdict | Spend / side effects | Cadence |
|---|---|---|---|---|---|
| 1 | Invariant / contract | Can the machinery lie? | Deterministic | None | Every commit |
| 2 | Hermetic system | Can composition lie? | Deterministic | None | Every commit |
| 3 | Live system (sandbox) | Can the real world break the seams? | Nondeterministic, binary | Real, bounded, disposable | Pre-merge / pre-release |
| 4 | Eval / qualification | Can the model be wrong while the machinery is right? | Statistical, threshold over N runs | Token cost, separately authorized | Prompt/model change · nightly · release qualification |
| 5 | Ops hardening | Can time, load, or an adversary hurt you? | Mixed | Production-shaped | Pre-GA, then recurring |

"Hermetic" means sealed against **all** nondeterminism — clock, randomness, network — not merely mocked externals; locally controlled real software (a containerized database) can be inside the seal, a vendor API never is. "Sandbox" means everything is real but disposable and spend-bounded.

The four layer rules the audit enforces:

1. **Prove it a layer down.** A check placed at an expensive layer that a cheaper layer could falsify is a placement finding.
2. **Lanes may be empty, never silently absent.** A declared-empty lane with a reason is a decision; an undeclared-absent lane is a finding.
3. **Evidence is not a regression suite.** A green live run or eval campaign proves that run. Every deterministic defect it surfaced must have deposited a layer-1/2 detector in the same change.
4. **Security is split.** Security invariants (tenancy, authorization, deny-by-default) are layer-1 content from day one; layer 5 holds the assurance half (threat model, secret handling, abuse surfaces).

## 2. What each artifact is

- `validation-policy.yaml` — machine-readable contract: criticality tier map (C0–C4, same scale as `criticality-model.md`), the five layer lanes with `status: active` or `status: empty` plus reason, gate requirements (blocking/advisory/waived) with declared frequencies, thresholds, golden-set locations, CI cost tiering, ops-hardening obligations, tooling selection with rejected alternatives, an `artifacts:` block naming companion-artifact locations, an optional `coexistence:` block (§3), and a `modules:` registry of child policies.
- `system-map.md` — the reconciled derivation surface: behavioral view (actor → stimulus → journey → state transition → effect → observation), structural view (state ownership, dependencies, consistency, failure domains), the reconciliation of the two, supported entry/observation surfaces, and open product-truth/architecture findings.
- `invariants.md` — falsifiable statements with namespaced IDs (`OPERON-INV-003`, `LL-INV-007`), enforcement classification (test, runtime guardrail, or both), adversarial seed cases, inherited-vs-new marking. Retired invariants keep their IDs with `retired: <date, reason>`.
- `boundary-map.md` — the architectural seams, each with journey intersections, an enumerated failure-mode list (timeout, partial success, retry, duplicate delivery, stale read, version skew, crash-mid-step), a per-boundary **honest-fake column** carrying the controlled-seam specification — the success and failure semantics the boundary double must reproduce as scriptable behavior, plus the unproven real semantics that each retain a named live-sandbox obligation — and a layer placement (hermetic vs live-sandbox by the honest-fake test).
- `contracts/` — one file per boundary: valid inputs, output guarantees, error behavior, idempotency, ordering/latency. Where several interfaces expose one behavior, the core contract is written once and each adapter carries a thin conformance contract plus one cross-surface agreement check.
- `llm-eval-plan.md` + golden sets — per-call-site split into a deterministic contract layer (schema, budgets, retry/fallback handling — layers 1–2) and a statistical quality layer (committed golden set, rubric, threshold over N runs — layer 4), plus judge meta-evals and trajectory assertions where applicable.
- `case-catalog.md` — traced case families derived from journeys, state machines, invariants, boundaries, contracts, interface adapters, model sites, and operational obligations, each with risk, layer, oracle, and source IDs. The design contract requires **matrix closure** at design time: every derivation-matrix cell (source artifact × derivation row) carries a traced case or a named risk-pruning reason.
- `harness-backlog.md` — the ticket-shaped build plan, starting from the walking skeleton (each skeleton test paired with its negative control, plus harness self-tests and — under coexistence — the isolated root's additive CI lane). Expansion gates are scoped per layer; every ticket names its executor.
- `agents-md-contribution.md` — the proposed section for the repository's agent-instructions file (`AGENTS.md`/`CLAUDE.md`) that routes future coding agents to these artifacts: consult contracts and acceptance criteria on feature changes, deposit cases per the derivation grammar, deposit each bug fix's detector, never weaken gates, re-enter `harness-revision` on structural mismatch.

## 3. Policy semantics the audit must honor

- **Inheritance.** Module policies `extends:` the parent. Resolution order: parent defaults → module overrides → per-component overrides.
- **Tighten-only.** A module may make an inherited requirement stricter; it may never loosen one. A loosening child policy is a conformance finding regardless of what CI does.
- **Waivers expire.** A waived gate is legitimate only as an explicit `waivers:` entry with owner, reason, and expiry. An expired or ownerless waiver is an active finding. Silence is never a waiver.
- **Provisional values expire like waivers.** A `PROPOSED` contract tolerance adopted to keep a contract testable lives as a `provisional_values:` entry with parameter, value, owner, and expiry; tests assert the provisional. An expired or ownerless provisional is an active finding. `OPEN` is legitimate only for parameters whose semantics are undecided — an `OPEN` that merely awaits tuning is a finding.
- **Lane inheritance.** A module may activate a lane the parent declared empty; it may never empty an active inherited lane except through an expiring waiver.
- **Fail-closed.** A gate class present in the parent but absent from a module resolves to the parent's requirement, not to "unspecified."
- **ID stability.** Claim IDs in the audit's traceability matrix reuse the design artifacts' namespaced IDs. Do not mint a parallel ID space for claims the design already names; new claims the design missed get new IDs in the audit's own namespace and are reported back as candidate design additions.
- **Coexistence (`parallel-greenfield`).** When the policy declares a `coexistence:` block, its `isolated_root` is the only writable harness location and the `protected_paths` plus incumbent gates are read-only — for this skill's `harden` mode too. `ci_integration: additive_opt_in` forbids redirecting existing required commands or gates; it constrains integration with the incumbent's pipelines only — the isolated root's own additive CI lane is walking-skeleton scope, and its absence is a finding. Cutover is a separate human-ratified change that must satisfy every declared `cutover_requires` item (equivalence evidence, rollback plan, ratification). Any weakening, deletion, or redirection of an incumbent gate before ratified cutover is a finding; so is an executed cutover missing its declared evidence.

## 4. Conformance checklist

Run these checks in Phase 4 whenever the artifacts exist; each failure is a finding with normal severity mapping:

1. **Lane presence.** Every one of the five lanes is either active with evidence or declared empty with a reason. Undeclared absence is a finding.
2. **Gate reality.** Every gate the policy marks blocking actually blocks in CI at the declared frequency, on the audited revision. Compare policy against actual CI configuration and recent runs, not against intention.
3. **Frequency drift.** Declared cadences (per-commit, prompt-change, nightly, pre-release) match what actually triggers. A nightly eval that has not run in a month is a finding even if its config exists.
4. **Invariant enforcement.** Each non-retired invariant has its classified enforcement in place: a test that would fail on violation, a fail-closed runtime guardrail, or both. An invariant enforceable only by model goodwill is a finding.
5. **Boundary coverage.** Each boundary's enumerated failure modes — including crash-mid-step — have layer-2 coverage; each unfakeable seam has its named disposable layer-3 target and spend bound.
6. **Evidence-deposit rule.** Sample defects surfaced by layer-3/4 runs and confirm a layer-1/2 detector landed in the same change.
7. **Eval discipline.** Golden sets committed before prompt tuning (check history), thresholds stated over N runs, judge meta-evals present for LLM-judging-LLM sites, model-swap deltas gated on the golden set.
8. **Tighten-only and waivers.** No module loosens an inherited requirement; all waivers are owned and unexpired.
9. **Tier map honesty.** The policy's declared tiers still match the system's actual deployment shape, data, and privileges. Challenge, don't inherit blindly.
10. **Staleness.** The system map, boundary map, and invariants still describe the current architecture. Drift here is a structural finding, not a documentation nit.
11. **Honest-fake integrity.** Each fakeable boundary's double reproduces its declared failure semantics as scriptable behavior — a fake that can only return success is a finding — and the fake↔real conformance drift suite exists and has actually run against the real dependency at its declared cadence. Every unproven real behavior in the controlled-seam specification retains its named live-sandbox obligation.
12. **Adapter conformance.** Where several interfaces expose one behavior: the core behavior is validated once at the cheapest falsifying layer, each adapter has focused conformance coverage (parsing, auth, serialization, error mapping, exit codes), and the cross-surface agreement check exists. A full behavioral suite cloned under multiple adapters is a placement finding.
13. **Case-catalog traceability.** Diff `case-catalog.md` against the implemented tests in both directions: cataloged cases that were never implemented are gaps; implemented tests absent from the catalog are reported as candidate catalog additions, never silently adopted.
14. **Agent routing.** The repository's standing agent instructions (`AGENTS.md`, `CLAUDE.md`, or equivalent) route coding agents to the harness artifacts as `agents-md-contribution.md` proposed. A routing section that was designed but never landed is a finding — the ongoing case-sourcing channels cannot fire if the agents doing the work never see the artifacts.
15. **Coexistence integrity.** Under a declared `parallel-greenfield` posture: protected paths are untouched, incumbent gates are unredirected and unweakened, CI integration with the incumbent stayed additive and opt-in, the isolated root's own additive CI lane exists and runs, and no cutover occurred without its declared `cutover_requires` evidence (§3).
16. **Derivation closure.** The case catalog reaches matrix closure: every derivation-matrix cell (source artifact × derivation row) carries a traced case or a named risk-pruning reason. A silent empty cell is a finding. An expansion gate that references conditions outside the layer it gates — a catalog or layer-1/2 implementation frozen behind a missing live target, an unpassed eval threshold, or unauthorized CI — is a **structural** finding: the harness has designed itself into a stall.
17. **Negative controls.** Sample detector families and confirm each proves it can fire: a seeded violation (mutated fixture, planted defect, misbehaving double script) that the detector catches, landed red-then-green. A detector with no negative control anywhere in its family is a finding; walking-skeleton tests are not exempt.
18. **Harness self-testing.** The harness's own machinery is under test: fixtures have self-tests, scanners and sweeps fail on an empty walk rather than passing, and policy loaders, CI configuration, and dispatch/registry surfaces are pinned by tests. A load-bearing guard with no test of its own is a finding.

## 5. Findings routing

Tag every finding **case-level** or **structural**; the distinction decides where remediation happens.

- **Case-level** — the harness shape is right but incomplete: a missing test, a weak oracle, an uncovered failure mode, a skipped gate, an expired waiver. Remediate in this skill's `harden` mode; traceability ties each fix to its claim ID.
- **Structural** — the declared shape no longer fits reality: the system map or boundary map contradicts the architecture, a lane is mis-placed or wrongly declared empty, invariants describe a system that no longer exists, behavioral suites are cloned under multiple interface adapters instead of validated once, the module policy tree does not match the module tree. Route to validation-harness-design's `harness-revision` mode, which reopens only the affected concepts and records why. Do not remediate structural findings by piling cases onto the wrong shape.

Two prohibitions bind both skills: never rewrite audit corpora or holdouts to match fixes, and never author golden sets after prompt tuning. Either act invalidates the evidence chain it touches.
