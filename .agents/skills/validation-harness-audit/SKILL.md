---
name: validation-harness-audit
description: Audit, harden, and independently verify the validation of an existing codebase using criticality-calibrated assurance — measuring conformance against a ratified harness design (validation-policy.yaml and companion artifacts) when one exists. Use for validation audits, test/CI hardening, release-readiness evidence, production or cloud-service verification, high-consequence systems, AI-agent systems, and assurance cases. Complements validation-harness-design — that skill designs a harness that does not exist yet or reshapes one that no longer fits; this skill measures what was actually built and what the evidence actually supports. Do not use for routine style review, a single narrow unit test, or ordinary feature work unless broader validation assurance is explicitly requested.
---

# Validation Harness Audit

## Purpose

Move an existing codebase from uncertain validation to an evidence-backed assurance position appropriate to its intended use and consequences of failure.

Do not answer only, “Do the tests pass?” Establish:

1. What the system is intended and permitted to do.
2. What can credibly go wrong.
3. How consequential those failures are.
4. What claims must be true for the intended use to be acceptable.
5. What independent evidence supports each claim.
6. What remains unverified, uncertain, or outside the repository.

The assurance conclusion must always be scoped to a defined system, revision, environment, use case, and criticality level.

## Position in the lifecycle

validation-harness-design and this skill form one loop over the life of a product: **design → build → audit → revise**.

- **Design time.** validation-harness-design produces the durable harness spec: a reconciled system map (`system-map.md`), falsifiable invariants (`invariants.md`), a boundary map with per-boundary honest-fake specifications, per-boundary contracts, LLM eval plans with committed golden sets, a traced case catalog (`case-catalog.md` + machine-readable `case-catalog.yaml`), owner-facing documents (`owner-briefing.md`, `owner-backlog.md`), a proposed agent-instructions section (`agents-md-contribution.md`) that routes future coding agents to these artifacts and the traceability conventions, and `validation-policy.yaml` — the machine-readable declaration of the five validation layers (invariant/contract, hermetic system, live sandbox, eval/qualification, ops hardening), gates, thresholds, obligations, artifact locations, and any harness-coexistence constraints.
- **Audit time (this skill).** Measure what was actually built against what was declared, and against the criticality the system actually carries. The policy file is the diff surface: a validation lane the policy declares empty with a reason is a decision; a lane that is simply absent is a finding.
- **Findings routing.** Case-level gaps — a missing test, a weak oracle, an unexercised failure mode — are remediated here in `harden` mode. Structural findings — a boundary map that contradicts the architecture, a mis-placed lane, invariants that no longer describe the system — are routed to validation-harness-design's `harness-revision` mode; do not pile case fixes onto a wrongly shaped harness.
- **Shared discipline.** Golden sets are authored before prompt tuning, never after; audit corpora and holdouts are never rewritten to match fixes; every deterministic defect surfaced by a live run or eval campaign deposits a deterministic detector in the same change.

When no design artifacts exist, reconstruct the validation contract from repository evidence (Phase 3) — and a standing recommendation of any such audit is to adopt validation-harness-design so the next audit has a declared baseline to measure against.

## Governing rules

1. **Criticality governs validation.** Classify system, component, and change criticality before selecting the validation plan.
2. **No confidence claim may exceed the evidence.** Passing tests are evidence for specific claims, not proof of total correctness.
3. **The implementation is not automatically the specification.** Distinguish authoritative requirements from behavior inferred from current code.
4. **One catastrophic dimension cannot be averaged away.** Use the highest credible consequence that is not effectively contained.
5. **Code evidence is not automatically system evidence.** Cloud operations, infrastructure, hardware, people, procedures, and external services may be part of the assurance boundary.
6. **Validation depth must be proportionate, not maximal by ritual.** Run checks because they address identified claims or risks, not because they appear on a universal checklist.
7. **Self-authored tests are not sufficient for high-risk claims.** Seek independent or holdout evidence.
8. **Unknowns remain unknown.** Never turn missing evidence into a favorable assumption.
9. **Time or budget does not lower criticality.** It may leave the assurance target unmet.
10. **Do not silently alter intended behavior.** Separate validation hardening, testability refactors, defect corrections, and behavioral changes.
11. **Audit the declared harness before re-deriving one.** When ratified design artifacts exist (`validation-policy.yaml`, `invariants.md`, boundary map, contracts, eval plans), they are the authoritative claims baseline: challenge them, diff conformance against them, and reuse their namespaced IDs. Do not silently reconstruct a parallel contract beside them.
12. **Vocabulary is calibrated, never assumed.** Define each term of art — claim, oracle, sensitivity evidence, holdout, independence level, validation lane, assurance target, criticality tier — in one plain-language clause on first use in conversation and in the charter, then calibrate depth to the user's displayed fluency: brief for practitioners, fuller for users new to assurance vocabulary. The human is the acceptance authority, and a person cannot meaningfully accept risk stated in vocabulary they do not understand — so the release assessment restates the verdict, every blocker, and every residual risk in plain language.

## Modes

Resolve the mode from the user’s request. Explicit mode wins.

- `profile`: Establish system boundary, criticality, and assurance target only.
- `assess`: Read-only discovery, contract reconstruction, existing-validation review, and gap analysis.
- `design`: Produce the assurance strategy and validation plan without modifying production or test code.
- `harden`: Implement approved validation improvements and limited testability changes.
- `verify`: Independently evaluate a defined revision and evidence package without implementing fixes.
- `fidelity`: Per-wave / per-ticket judgment pass over a product repo that already carries a ratified design corpus and an implemented (or partially implemented) test tree. Answers the one question deterministic closure cannot: do the citing specs actually falsify their ratified seeds, or has the case been quietly weakened? Findings only — never propose a patch, never edit a file. See [Fidelity mode](#fidelity-mode) below.
- `full`: Profile, assess, design, harden, independently verify, and report.

Default to `assess` when the user asks to review or audit. Use `full` when the user asks to improve, harden, reach production-grade validation, or execute the complete lifecycle. Use `fidelity` when the user (or the validation-architect CLI) asks for a per-wave / per-PR fidelity audit. Do not make repository changes unless the selected mode permits them — `fidelity` never does.

`design` mode plans remediation for a system that already exists. For a harness that does not exist yet — a new product, feature, or module with no code — use validation-harness-design instead.

## Start-of-run charter

Before substantial work, state a compact charter containing:

- Selected mode.
- Target repository and revision.
- Intended use and operating environment.
- Provisional system criticality.
- In-scope and out-of-scope boundaries.
- Whether repository modification is authorized.
- Whether external systems, network access, credentials, or production-like environments are authorized.
- When the policy declares a `coexistence:` posture: which harness is under audit (incumbent, replacement, or both) and the protected read-only paths.
- Output directory.
- Blocking unknowns.

Infer what is reasonably discoverable from the repository. Ask only questions whose answers materially change criticality, safe execution, scope, or acceptance authority. When proceeding under uncertainty, use a conservative provisional classification and label it as provisional.

State the charter in plain language (rule 12): define any term of art it uses — including the criticality tier and the assurance target — in one clause on first use, so the user can correct the charter without first learning the field's vocabulary.

## Required supporting material

Read these files as needed rather than loading everything at once:

- Always read [references/criticality-model.md](references/criticality-model.md) before finalizing the assurance profile.
- Always read [references/evidence-and-verdicts.md](references/evidence-and-verdicts.md) before issuing a verdict.
- Read [references/harness-policy-conformance.md](references/harness-policy-conformance.md) when the repository carries a `validation-policy.yaml` or other validation-harness-design artifacts.
- Read [references/test-quality-rubric.md](references/test-quality-rubric.md) when evaluating or adding tests.
- Read [references/validation-techniques.md](references/validation-techniques.md) when designing the validation plan.
- Read [references/independent-verification.md](references/independent-verification.md) before the verification phase.
- Read [references/ai-agent-systems.md](references/ai-agent-systems.md) when the system contains models, prompts, agents, tools, memory, retrieval, or autonomous actions.
- Read the examples under [references/examples/](references/examples/) when calibrating local, cloud, or mission-critical systems.
- Use templates under [assets/templates/](assets/templates/) for persistent artifacts.

## Safety and repository discipline

Before running project scripts:

1. Read repository instructions such as `AGENTS.md`, `AGENTS.md`, `CONTRIBUTING`, `README`, build manifests, and CI configuration.
2. Inspect the working tree and preserve user changes. Prefer an isolated worktree or branch for `harden` and `full` modes.
3. Record the target commit and whether the tree is dirty.
4. Inspect scripts before executing them, especially install, migration, deployment, cleanup, and test-fixture scripts.
5. Start with the least invasive commands.
6. Do not connect to production, mutate shared environments, use real customer data, expose secrets, install global software, or run destructive commands without explicit authorization.
7. Use disposable databases, temporary directories, sandbox accounts, and synthetic data where possible.
8. Record exact commands, versions, exit codes, and relevant outputs. Do not claim a check was run when it was only inspected or recommended.

Optional helpers are available under `scripts/`. Their use is not mandatory when the repository already has a superior evidence workflow.

## Phase 1 — Discover the system

Build an evidence-grounded system map. Inspect at least:

- Repository purpose and documented users.
- Languages, frameworks, entry points, packages, and services.
- Build, test, lint, type-check, packaging, release, and deployment paths.
- Public and internal interfaces: APIs, CLIs, events, schemas, files, protocols, UI flows.
- Persistent data, migrations, backups, caches, queues, and state machines.
- Authentication, authorization, tenancy, secrets, privilege, and trust boundaries.
- Infrastructure-as-code, runtime configuration, feature flags, and environment assumptions.
- External dependencies and failure behavior.
- Observability, alerting, runbooks, rollback, and recovery mechanisms.
- Existing tests, fixtures, mocks, test environments, CI gates, skipped tests, flakes, and coverage reports.
- Harness-design artifacts when present: `validation-policy.yaml` (product and module files), `system-map.md`, `invariants.md`, `boundary-map.md`, `contracts/`, `llm-eval-plan.md`, golden-set directories, `case-catalog.md`, `harness-backlog.md`, and `agents-md-contribution.md` — the policy's `artifacts:` block names their locations.
- Prior incidents, defect notes, changelogs, deprecations, or compatibility commitments when present.

Produce a system map that distinguishes:

- In-repository components.
- External operational components.
- Human procedures and approvals.
- Assumed services or hardware.
- Items unavailable for inspection.

For large repositories, first create a bounded inventory, then inspect high-criticality paths deeply. Do not equate scanning every file with understanding the system.

When the design skill's `system-map.md` exists, seed this map from it and challenge it against observed reality rather than re-deriving from scratch; drift between the declared map and the actual architecture is a structural finding.

## Phase 2 — Establish the assurance profile

Create `project-assurance-profile.yaml` using the template.

Classify:

- **System criticality:** the assurance floor for the intended deployment.
- **Component criticality:** the consequence of failure in each sensitive subsystem, considering containment.
- **Change criticality:** the risk introduced by the current change or validation effort.

Use levels:

- `C0 Experimental`: disposable or exploratory use with negligible consequence.
- `C1 Limited`: local or internal use with bounded, reversible consequences.
- `C2 Production`: customer-facing or persistent production use with material security, reliability, or data consequences.
- `C3 High-consequence`: serious financial, privacy, regulatory, infrastructure, health, or broad operational harm.
- `C4 Safety/Mission-critical`: credible risk of injury, loss of life, environmental harm, catastrophic physical damage, or loss of mission.

The label is not determined by deployment location alone. A local root-level deletion tool may exceed a low-impact hosted service. A space project can contain C1 tooling, C3 ground systems, and C4 flight-control components.

This C0–C4 scale is shared with validation-harness-design; [references/criticality-model.md](references/criticality-model.md) is the canonical rubric for both skills. When a `validation-policy.yaml` declares a tier map, seed the classification from it and challenge it rather than re-deriving from scratch; record disagreements as findings.

Record dominant criticality drivers, failure containment assumptions, and evidence required to justify any downward classification.

Define the assurance target as a scoped claim, for example:

> Sufficient evidence for single-user local use on disposable repositories under the stated safeguards.

or:

> Sufficient evidence for a multi-tenant production service processing persistent customer data under the documented deployment and recovery controls.

Never use an unscoped target such as “production ready.”

## Phase 3 — Reconstruct the validation contract

Create a catalog of claims that must hold. Gather sources in this order, while checking freshness and contradictions:

1. Explicit approved requirements, safety/security policies, and contractual obligations.
2. Ratified harness-design artifacts when present — `validation-policy.yaml`, `system-map.md`, `invariants.md`, `boundary-map.md`, `contracts/`, `llm-eval-plan.md`, `case-catalog.md` (see [references/harness-policy-conformance.md](references/harness-policy-conformance.md)). These were human-confirmed at design time: classify their claims `authoritative`, keep their namespaced IDs (for example `OPERON-INV-003`) as claim IDs in the traceability matrix, and record any contradiction with observed behavior as a finding rather than silently preferring either side.
3. Public interfaces, schemas, protocols, compatibility commitments, and user documentation.
4. Data constraints, architectural invariants, operational controls, and threat or hazard analyses.
5. Existing tests and prior incident-derived requirements.
6. Current implementation behavior, used as evidence of present behavior but not automatic intent.

Classify every important claim as:

- `authoritative`: directly supported by an approved source of truth.
- `derived`: logically required by authoritative constraints or architecture.
- `inferred`: reconstructed from behavior, tests, or implementation.
- `unknown`: no trustworthy oracle is available.

For contradictions, do not choose silently. Record the conflict, identify the affected claims, and seek an authority or mark the claim unresolved.

Include:

- Critical user and operator journeys.
- Safety, security, privacy, financial, data-integrity, availability, compatibility, and recovery invariants.
- Negative requirements: actions that must never occur.
- Boundary, degraded-mode, interruption, retry, concurrency, timeout, and dependency-failure behavior.
- Abuse cases and privilege escalation paths.
- Deployment, migration, rollback, observability, and incident-response expectations.
- Assumptions about users, operators, environment, hardware, and external services.

Store the result in `validation-contract.yaml`.

## Phase 4 — Assess existing validation

Map each critical claim to current evidence. Evaluate evidence quality, not just existence.

For tests, determine:

- Whether the test targets a meaningful claim.
- Whether the oracle is independent of the implementation.
- Whether a realistic defect would cause failure.
- Whether boundaries and negative cases are covered.
- Whether mocks remove the behavior being claimed.
- Whether the test is deterministic, isolated where appropriate, and reproducible.
- Whether it runs in CI and is release blocking.
- Whether skips, retries, snapshots, broad fixtures, or weak assertions conceal failure.
- Whether mutation testing, defect seeding, pre-fix failure, or another method demonstrates sensitivity.

Also assess non-test evidence such as static analysis, formal models, reviews, recovery drills, deployment checks, observability, operational controls, simulations, and hardware tests.

When a `validation-policy.yaml` exists, additionally audit lane conformance ([references/harness-policy-conformance.md](references/harness-policy-conformance.md)):

- Map the evidence inventory onto the five declared layers. An undeclared-absent lane is a finding; a declared-empty lane with a reason is a decision.
- Check gate reality: every gate the policy marks blocking actually blocks in CI at the declared frequency. A gate silently skipped to save CI minutes is a finding.
- Check the tighten-only rule across module policies, and that every waiver is explicit, owned, and unexpired.
- Check the evidence-deposit rule: deterministic defects surfaced by live-sandbox runs or eval campaigns deposited layer-1/2 detectors in the same change.
- Check eval discipline: golden sets committed before prompt tuning, thresholds stated over N runs, judge calibration present for any LLM-judging-LLM site.
- Check honest-fake integrity: boundary doubles reproduce their declared failure semantics as scriptable behavior (a fake that can only return success is a finding), and the fake↔real conformance drift suite has actually run against the real dependency at its declared cadence.
- Check adapter conformance: where several interfaces expose one behavior, the core is validated once, each adapter has focused conformance coverage, and the cross-surface agreement check exists; a behavioral suite cloned under multiple adapters is a placement finding.
- Diff `case-catalog.md` against implemented tests in both directions, and check that the repository's standing agent instructions route coding agents to the harness artifacts as `agents-md-contribution.md` proposed.
- Check derivation closure: the catalog reaches matrix closure (every source-artifact × derivation-row cell traced or risk-pruned by name; a silent empty cell is a finding), and no expansion gate references conditions outside the layer it gates — a catalog or layer-1/2 implementation frozen behind a missing live target, eval threshold, or CI authorization is a structural finding.
- Check negative controls and harness self-testing: sampled detector families each prove they can fire against a seeded violation, and the harness's own machinery (fixtures, scanners, policy loaders, CI config) is under test — a scanner that passes on an empty walk is a finding.
- Under a declared `coexistence:` posture, confirm protected incumbent paths and gates are untouched, CI integration with the incumbent stayed additive, the isolated root's own additive CI lane exists and runs, and no cutover occurred without its declared evidence.

Coverage is a navigation signal. It is not a release claim and must not be used as the primary assurance metric.

Create:

- A claim-to-evidence traceability matrix.
- A validation gap register.
- A risk register prioritized by consequence, exposure, likelihood, detectability, recoverability, and evidence weakness.

Do not collapse these into one opaque numerical score.

## Phase 5 — Design the criticality-calibrated validation plan

Select techniques because they address identified claims and failure modes. Use [references/validation-techniques.md](references/validation-techniques.md).

At minimum, define:

- Mandatory release-blocking gates.
- Conditional checks triggered by component or change risk.
- Advisory checks.
- Required environments and test data.
- Required independence.
- Evidence retention and reproducibility rules.
- Entry, exit, and stopping criteria.
- Handling of flakes, skips, unavailable environments, and tool failures.
- Holdout or adversarial validation for high-risk claims.
- Residual risks that require operational controls or acceptance authority.

Calibration examples:

- C0 may need build, focused tests, and smoke validation.
- C1 commonly adds real filesystem/process behavior, safe failure, interruption, packaging, and destructive-operation guardrails.
- C2 commonly adds authorization, tenancy, contracts, migrations, concurrency, recovery, deployment, rollback, observability, security, load, and dependency-failure validation.
- C3 commonly requires formal risk analysis, stronger independence, disaster exercises, reconciliation, auditability, adversarial security, strict configuration control, and explicit risk acceptance.
- C4 requires a system assurance case beyond repository testing, such as hazard analysis, simulation, fault injection, timing/resource analysis, hardware-in-the-loop, formal methods where justified, independent verification and validation, and controlled acceptance authority.

A repository-only review must not certify C4 system readiness.

Classify every planned remediation as **case-level** (implementable in Phase 6) or **structural** (route to validation-harness-design's `harness-revision` mode). A structural gap "fixed" by adding cases onto the wrong shape is itself a finding and will recur.

## Phase 6 — Harden the repository

In `harden` or `full` mode, implement the approved plan in risk order.

Permitted categories:

- Validation-only changes: tests, fixtures, harnesses, analysis configuration, CI gates, evidence scripts.
- Testability refactors that preserve externally observable behavior.
- Defect corrections supported by a failing claim-based test and documented rationale.
- Behavioral changes only with explicit approval or as a separately proposed change.

For every added or strengthened critical test, obtain sensitivity evidence when practical:

- Demonstrate failure against the pre-fix revision.
- Demonstrate failure with a narrowly seeded defect.
- Use mutation testing.
- Use an independent reference model or oracle.

Never gain a passing result by:

- Weakening an assertion or requirement.
- Deleting or broadly skipping a failing test.
- Lowering a threshold without a documented assurance decision.
- Mocking away the behavior under validation.
- Adding test-only production bypasses.
- Updating a snapshot without explaining and reviewing the semantic change.
- Catching and ignoring failures.
- Reclassifying a blocker as advisory solely because it is difficult to fix.

Keep validation changes reviewable. Separate unrelated refactors and preserve traceability from each change to a claim or risk.

When the policy declares a `parallel-greenfield` coexistence posture, its constraints bind this skill too: protected incumbent paths and gates are read-only, remediation lands under the declared isolated root, and cutover is never executed as a side effect of hardening — it is a separate human-ratified change with its own declared evidence.

## Phase 7 — Independently verify

Use a separate agent, fresh context, isolated worktree, or independent reviewer when available. The verifier must not rely solely on the implementer’s summary.

The verifier should:

1. Reconstruct the assurance target from artifacts and source evidence.
2. Challenge the criticality classification and system boundary.
3. Inspect changes for test weakening, hidden behavior changes, and metric gaming.
4. Run mandatory gates from a clean environment.
5. Create or run protected holdout scenarios for high-risk claims.
6. Attempt realistic adversarial, boundary, failure, concurrency, and recovery cases.
7. Confirm that evidence is tied to the tested revision and environment.
8. Distinguish organizational independence from mere role separation.
9. Report contradictions, unverifiable claims, and missing system-level evidence.

For C3 and C4, same-session role switching is not strong independence. State this limitation explicitly and require appropriate human or organizational acceptance.

## Phase 8 — Issue the evidence package

Produce persistent artifacts under a run-specific directory, defaulting to:

```text
.validation/<timestamp>-<short-revision>/
```

Required artifacts:

- `run-manifest.json`
- `project-assurance-profile.yaml`
- `system-map.md`
- `validation-contract.yaml`
- `traceability-matrix.md`
- `risk-register.yaml`
- `validation-plan.md`
- `findings.md`
- `evidence-report.md`
- `release-assessment.md`
- Command logs or links to retained CI/system evidence

In `findings.md`, tag each finding **case-level** or **structural**. Structural findings name the design artifact they invalidate, and the release assessment's required actions route them to validation-harness-design's `harness-revision` mode rather than to local test additions.

Use these evidence states per claim:

- `verified`
- `partially_verified`
- `not_verified`
- `blocked`
- `not_applicable`
- `unknown`

Use these scoped overall verdicts:

- `SUFFICIENT_FOR_STATED_TARGET`
- `CONDITIONALLY_SUFFICIENT_FOR_STATED_TARGET`
- `INSUFFICIENT_FOR_STATED_TARGET`
- `BLOCKED_FROM_ASSESSMENT`

A conditional verdict must name every condition, owner, and deadline or trigger. A favorable verdict must identify the exact target, revision, environment, and residual risks.

Do not say “safe,” “correct,” “fully validated,” or “production ready” without scope and evidence. Prefer:

> Evidence is sufficient for the stated target, subject to the listed assumptions and residual risks.

or:

> Evidence is insufficient for the stated target because the following critical claims remain unverified.

## Blocking and escalation conditions

Stop or narrow the claim when:

- The intended use or worst credible consequence is unknown and materially changes safe execution.
- Required authoritative behavior is contradictory or unavailable.
- Tests require production credentials, real customer data, destructive operations, or uncontrolled external effects.
- The target revision cannot be identified.
- The build or test environment cannot be reproduced.
- Critical evidence is inaccessible or stale.
- A high-criticality system lacks required independent or system-level evidence.
- The reviewer lacks authority to accept residual risk.

Continue with non-destructive discovery where useful, but issue `BLOCKED_FROM_ASSESSMENT` or a narrower code-level conclusion rather than fabricating assurance.

## Completion criteria

The work is complete only when:

1. Intended use, system boundary, and criticality are explicit.
2. Critical claims and failure modes are explicit.
3. Existing and new evidence is mapped to those claims.
4. Mandatory checks were executed reproducibly or clearly marked unavailable.
5. New critical tests have sensitivity evidence where practical.
6. CI or another controlled process enforces release-blocking gates appropriate to the target.
7. Skips, flakes, manual checks, and unavailable environments are visible.
8. Independent verification has occurred at the level required by criticality, or its absence is a stated blocker or limitation.
9. Residual risks, unknowns, assumptions, and acceptance authority are explicit.
10. Another reviewer can reproduce the conclusion from the retained artifacts.

## Fidelity mode

A scoped, findings-only judgment pass. Distinct from campaign-scale design-conformance audit and from `verify`/`harden`: the product repo already has a ratified corpus and citing specs; a deterministic closure check (`validation-trace`) has already passed; this mode asks whether those specs are faithful to the ratified seeds.

**Preconditions.** Refuse (do not invent findings about missing files) when closure is red — fix closure before asking for judgment. Scope is exhaustive within a wave or an explicit ticket set; do not audit families outside the scope.

**Rubric — four axes.** For each scoped implementable family with citing specs:

1. **Seed coverage.** Every enumeration item the catalog row (or its cited contract clause) names has a real assertion in some citing spec.
2. **Negative-control reality.** The detector can actually fire: a seeded violation would fail the test. A constant-pass, assert-on-setup-only, tautology, or a "negative control" that never plants the violation is a finding — **blocking** tier by rule, because closure now overstates the harness.
3. **Oracle match.** The assertion kind matches the row's declared oracle.
4. **No quiet narrowing.** The implemented case has not been weakened relative to the ratified seed text (narrowed input domain, loosened tolerance, dropped failure mode, a skipped/`it.todo` carrying the citation while the catalog counts the family covered).

**Hard rules.** Read-only; **findings only — never propose a patch**, never emit a diff, never rewrite a test body. Never relitigate ratified prunes, blocked cells, or recorded decisions. Never audit taste. Evidence quotes the ratified text AND the spec text, with file paths. Output uses the same `AUD-xxx (tier) — <path> — <claim>` headers as other modes (the `AUD-9xx` range is reserved for fidelity passes when an orchestrator assigns iteration numbers). End with a "What I checked" coverage section listing every scoped family — mandatory even at zero findings. Remediation belongs to the product repo's coding agents (via `implement-harness-ticket`); structural findings re-enter validation-harness-design's `harness-revision` mode.

## Invocation examples

- `Use $validation-harness-audit in assess mode. Determine whether this CLI has sufficient validation for local use on real repositories.`
- `Use $validation-harness-audit in full mode. Harden this multi-tenant service for the stated production target.`
- `Use $validation-harness-audit in verify mode against commit <sha> and the existing .validation evidence package.`
- `Use $validation-harness-audit in assess mode. Diff the built harness against validation-policy.yaml and report lane conformance.`
- `Use $validation-harness-audit in fidelity mode scoped to Wave 1. Findings only — do not edit any file.`
- `Profile this flight-control repository, but do not edit or run hardware-facing commands.`

For environments without skill support, use [STANDALONE_REVIEWER_PROMPT.md](STANDALONE_REVIEWER_PROMPT.md).
