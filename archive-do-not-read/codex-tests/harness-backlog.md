# Operon greenfield validation-harness backlog

Status: **Phase-8 ratified; local non-spending controlled foundation
implemented and red on two production defects; full walking skeleton remains
blocked on those defects plus human/external gates**

Last updated: 2026-07-30

## 1. Execution boundary

The human authorized and the campaign implemented the local deterministic
foundation toward the walking skeleton. Its current red result is evidence,
not an implementation waiver: `OPERON-CASE-DET-001` proves a production
worktree-context symlink escape and `OPERON-CASE-DET-004` proves contradictory
approval decisions under contention. The human retained Pi and directed that
the defects be tracked as
[GitHub issue #198](https://github.com/buildstacks-dev/Operon/issues/198) and
[GitHub issue #199](https://github.com/buildstacks-dev/Operon/issues/199)
while the campaign continues; both detectors remain red. This backlog does not authorize a
production fix, external operations, or CI changes. Everything new remains beneath
`codex-tests/`. `test/`, `eval/`, product source, product package scripts,
existing gates, and CI are protected.

The walking skeleton is built before the comprehensive case catalog expands.
Token-spending provider campaigns, live GitHub mutations, real scheduler
installation, registry publication, deployment, and active CI integration
each require separate explicit authorization.

## 2. Proposed implementation layout

The walking skeleton implements this layout in part; later additions must
continue to follow it:

```text
codex-tests/
  package.json
  pnpm-lock.yaml
  tsconfig.json
  vitest.config.ts
  src/
    policy/
    fixtures/
    simulators/
    drivers/
    eval-runner/
    reporters/
  specs/
    layer-1/
    layer-2/
    layer-3/
    layer-4/
    layer-5/
  live-targets/
  ops/
  .artifacts/
```

`src/` contains harness implementation, never copied production logic.
`specs/` contains executable checks organized by validation question rather
than product interface. `live-targets/` contains target declarations, not
credentials. `ops/` contains threat, contention, soak, recovery, and
secret-scan configuration. `.artifacts/` is the only generated-output root.

## 3. Definition of the walking skeleton

The skeleton is complete only when:

- one Layer-1 invariant/contract detector passes and is proved capable of
  failing;
- one Layer-2 real-composition journey crosses a stateful controlled boundary
  failure and recovery;
- one Layer-3 real disposable-target smoke runs with identity, authorization,
  spend, cleanup, and evidence controls;
- one Layer-4 repeated-run qualification slice exercises a ratified threshold;
- one Layer-5 operational slice exercises an accelerated contention/recovery
  scenario;
- an additive CI lane runs those scoped commands without replacing or
  weakening an incumbent gate; and
- all configuration, fixtures, corpora, source, and output remain within
  `codex-tests/`.

Static Layer-3/4 driver self-tests are necessary plumbing, but they do not
substitute for the real sandbox and statistical questions.

## 4. Walking-skeleton tickets

### OPERON-HARNESS-WS-001 — Isolated package and fail-closed policy loader

- **Status:** Completed locally
- **Layer:** Cross-layer foundation
- **Defends:** policy-as-data, isolation, fail-closed gate discovery
- **Sources:** `validation-policy.yaml`; coexistence posture
- **Dependencies:** none

Acceptance criteria:

- `codex-tests/package.json`, `pnpm-lock.yaml`, strict `tsconfig`, Vitest
  configuration, source roots, and ignored runtime-output rules exist beneath
  `codex-tests/`.
- Exact dependency versions are locked independently; no root manifest,
  product package script, incumbent configuration, or CI file changes.
- Policy parsing rejects unknown keys, malformed values, missing active lanes,
  and missing blocking gates rather than ignoring them.
- Local commands emit only beneath `codex-tests/.artifacts/`.
- A seeded invalid-policy fixture proves the loader can fail.

### OPERON-HARNESS-WS-002 — Controlled-world fixture kernel

- **Status:** Controlled kernel completed for the walking-skeleton boundary
  set; broader risk-weighted contract matrices remain expansion work
- **Layer:** 2 foundation
- **Defends:** INV-001–005, INV-008–010
- **Sources:** BND-002, BND-004–009
- **Dependencies:** WS-001

Acceptance criteria:

- The fixture owns an isolated real filesystem root, Git repository/worktree,
  fake clock, seeded randomness, bounded environment, and subprocess outcomes.
- Stateful provider, GitHub, scheduler/event, and external-effect simulators
  record accepted requests, stable identities, state transitions, and injected
  failures.
- Simulators support success, refusal, timeout, partial success, duplicate,
  stale read, version skew, and ambiguity where the corresponding contract
  permits them.
- No simulator imports or reimplements production internals inside a boundary;
  it controls only confirmed seams.
- Every retained unproven real behavior links to a Layer-3 obligation.

### OPERON-HARNESS-WS-003 — Provider admission and normalized-result detector

- **Status:** Minimum local slice completed and hardened against contradictory
  success, unavailable usage, and non-integral counters; provider-native shape
  matrix and comprehensive malformed/over-budget expansion remain future work
- **Layer:** 1
- **Defends:** INV-003, INV-005, INV-009; BND-007
- **Case:** OPERON-CASE-WS-001

Acceptance criteria:

- A table spans at least two syntactically different scripted provider-native
  responses but one versioned Operon `TurnResult` contract.
- Missing/unqualified capability prevents runtime construction.
- Malformed, partial, contradictory, over-budget, and self-reported-success
  results fail with typed outcomes.
- fast-check varies assignment identity, scope, ordering, and usage fields
  while preserving a replayable seed.
- The ticket includes a deliberately bad implementation/fixture mutation that
  the detector catches.

### OPERON-HARNESS-WS-004 — Ambiguous provider timeout and restart journey

- **Status:** Completed local journey using real production composition and
  the repository's canonical `FakeRuntime`
- **Layer:** 2 hermetic journey
- **Defends:** INV-001, INV-003, INV-005, INV-008–010
- **Contracts:** BND-002, BND-004, BND-007
- **Cases:** OPERON-CASE-WS-002–003

Acceptance criteria:

- Real production composition receives a valid admitted provider turn through
  the controlled provider boundary.
- The provider records possible acceptance, then times out with unknown usage.
- Durable state preserves operation identity, reservation, ambiguity, and any
  accepted artifact without claiming success or zero usage.
- Recovery reconstruction does not create a fresh logical provider turn,
  cross org scope, duplicate cost, or invent terminal state. A later
  continuation may contact the same content-bound native session only after
  its identity and durable evidence are revalidated and separately accounted.
- The report shows the injected failure, relevant state transitions, oracle,
  and source IDs.
- Fact combinations whose expected outcome depends on AF-006 are identified
  and skipped as blocking-absent—not guessed.

### OPERON-HARNESS-WS-005 — Live-sandbox containment driver

- **Status:** Driver preflight and refusal self-test completed; real smoke
  remains blocked
- **Layer:** 3
- **Defends:** named-target, authorization, spend, cleanup, and evidence rules
- **Case:** OPERON-CASE-WS-004
- **Dependencies:** WS-001; real run also requires AF-010 resolution and
  separate explicit authorization

Acceptance criteria:

- Preflight fails before external contact unless target identity,
  disposability, credentials, exact allowed operations, enforced spend bound,
  cleanup policy, and evidence destination are present.
- Dry-run/self-tests prove refusal without network or mutation.
- The first real smoke uses exactly one named seam and the smallest operation
  that proves an unfakeable semantic.
- Cleanup never hides the evidence record or an ambiguous external outcome.
- Any deterministic defect found deposits a Layer-1/2 detector in the same
  change.

### OPERON-HARNESS-WS-006 — Qualification-runner feedback slice

- **Status:** Exact `OPERON-L4-001` policy, frozen 10-case corpus,
  production-call-site runner, aggregate/per-turn budget reservation, and
  static feedback tests completed. The host-authenticated campaign stopped
  fail-closed after 9/30 attempts on a bounded-repair contract failure. Spend
  settled at USD 4.219405 with no ceiling violation; no qualification issued.
  An append-only audit corrects one original attempt-count reporting defect
  from authoritative settled budget evidence. The separately authorized
  `OPERON-L4-002` diagnostic then passed 3/3 contract and quality trials at
  USD 1.224494 total. Its subsequently authorized full 10 × 3 qualification
  completed all 30 contract-valid attempts and scored 29/30 overall, but
  critical case `OPERON-EP-004` scored 2/3 against its 3/3 floor, so the
  result is `blocked_quality` and no qualification issued. Spend was USD
  12.881382 across 32 settled turns with no ceiling violation or external
  effect. The immutable ledger carries the wrong embedded campaign ID despite
  enforcing the correct limits; the audit records that attribution failure,
  and a required-identity regression detector now prevents recurrence.
  Three delegated, versioned follow-ups were then completed:
  `OPERON-L4-003` passed EP004 diagnostic 3/3 but stopped full qualification
  at EP003-r3 on a missing `gate`; `OPERON-L4-004` passed EP003 diagnostic
  3/3 but stopped at EP004-r1 on initial-plan self-supersession; and
  `OPERON-L4-005` passed EP004 diagnostic 3/3 but stopped at EP003-r1 after
  JavaScript `undefined` repaired into self-supersession. Their full-stage
  spends were USD 3.838934, USD 4.235953, and USD 3.183568; all ledgers
  settled, all evidence audits passed, no effects occurred, and no
  qualification issued. Further stochastic reruns are not planned without a
  materially different candidate or harness design.
- **Layer:** 4
- **Defends:** LLM contract/quality separation, conjunctive qualification,
  judge calibration, model-swap honesty
- **Case:** OPERON-CASE-WS-005
- **Dependencies:** WS-001; a passing qualification requires a new versioned
  candidate and separately authorized execution, not a rerun or evidence
  rewrite. `TM-002` and `TM-011` remain separately tracked deterministic
  qualification blockers, and C3 organizationally independent review is
  absent.

Acceptance criteria:

- Plain YAML/JSON manifests and attempts remain tool-independent and
  Git-controlled.
- Static fixtures prove that contract failures cannot be averaged into a
  quality pass, missing thresholds are blocking-absent, repeated trials are
  aggregated correctly, and lower-cost assignment comparisons begin only
  after safety and quality floors pass.
- Reports identify corpus version, prompt/model/harness assignment, attempt
  count, scorer versions, thresholds, failures, and uncertainty.
- A single attempt can never produce a qualification claim.
- Real provider execution is impossible without an explicit campaign
  authorization record and enforced budget.
- A failed live contract output deposits a Layer-1/2 regression detector, and
  a statistical quality miss deposits a frozen-oracle scorer detector without
  changing the golden case.

### OPERON-HARNESS-WS-007 — Accelerated operational slice

- **Status:** 90-day accelerated production scheduler/evidence/recovery
  composition slice completed; targeted retention contention, observer rebuild,
  no-progress/child-timeout, package/control-plane, and approval-contention
  detectors added. The approval detector is red; full threat, disaster
  recovery, and real-time obligations remain open
- **Layer:** 5
- **Defends:** INV-001, INV-005, INV-008–010, INV-012
- **Case:** OPERON-CASE-WS-006

Acceptance criteria:

- A short deterministic run advances a fake clock through representative
  portions of the ratified 90-day window.
- It injects missed ticks, duplicate delivery, approval waiting with
  independent work, provider partial usage, restart, and retention.
- Assertions cover bounded journal/state growth, exact settlements, no global
  approval stall, no duplicate effect, reconstruction, and truthful degraded
  observation.
- The evidence says explicitly that accelerated time does not satisfy the
  72-hour real-time obligation.
- The threat-model scaffold and gitleaks configuration are present, but no
  claim of a completed threat review or CI secret gate is made.

### OPERON-HARNESS-WS-008 — Local aggregate and evidence manifest

- **Status:** Completed locally with source/lock/toolchain identity and a
  before/after generated-output confinement detector; aggregate is red on
  `OPERON-CASE-DET-001` and `OPERON-CASE-DET-004`. Current traceability and
  residual-blocking reports are deposited.
- **Layer:** Cross-layer
- **Defends:** reproducibility, provenance, no silent absence
- **Dependencies:** WS-003–007

Acceptance criteria:

- `validate:local` runs every non-spending, non-mutating skeleton check.
- The aggregate fails when any required local lane is absent, skipped without
  an authorized waiver, or emits evidence outside `.artifacts/`.
- A manifest records policy hash, code revision, tool versions, seeds, case
  IDs, assertion totals and exact failures, timings, and per-lane verdicts.
- A separate structured-evidence lane fails if any Vitest JSON report is
  missing or malformed; failure diagnostics never overwrite structured data.
- Layer-3 real smoke, Layer-4 real qualification, 72-hour soak, and active CI
  remain visibly `blocking-absent` until authorized and satisfied.

### OPERON-HARNESS-WS-009 — Additive CI activation

- **Status:** Prohibited pending separate explicit decision
- **Layer:** Cross-layer CI
- **Defends:** durable enforcement and cost tiering
- **Dependencies:** WS-008; explicit authorization to create an additive
  workflow outside `codex-tests/`

Acceptance criteria:

- The new lane invokes only commands rooted in `codex-tests/`.
- Existing required commands, workflows, checks, names, and branch protection
  remain unchanged.
- Per-commit execution is non-spending Layers 1–2 plus LLM contract tests.
- Live, eval, judge, and operational triggers match
  `validation-policy.yaml`; absence fails closed.
- Disabling the additive lane restores the unchanged incumbent posture.

### OPERON-HARNESS-WS-010 — First bounded real Layer-3/4 slices

- **Status:** Prohibited pending separate explicit authorization and findings
- **Layers:** 3 and 4
- **Defends:** honest-fake limitations and statistical-quality feedback
- **Dependencies:** WS-005–006, WS-009, AF-010 resolution, PTF-015 threshold
  ratification, named spend owner

Acceptance criteria:

- One disposable live seam proves a behavior no controlled double can prove.
- One narrow golden set runs the ratified minimum attempts against a named
  assignment and threshold.
- Enforced budgets stop both campaigns before a cap breach.
- Evidence is attributable, retained, and cannot be confused with a
  regression suite.
- Every deterministic defect deposits its Layer-1/2 detector.

## 5. Post-skeleton case growth

### OPERON-HARNESS-EXP-001 — Expand the mechanically derived catalog

- **Status:** Blocked until WS-001–010 satisfy the walking-skeleton definition
- **Scope:** expand families in `case-catalog.md` using the derivation grammar
- **Rule:** risk prunes the matrix; unknown outcomes become findings

Acceptance criteria:

- Critical families receive exhaustive deterministic transition,
  guardrail-violation, crash, concurrency, replay, and adversarial coverage.
- High families receive complete contracts and deep representative
  composition.
- Moderate and low families receive only their ratified profiles.
- Every executable case traces to source IDs, risk, layer, oracle, and owner.
- Interfaces receive conformance obligations, not cloned journey suites.

### OPERON-HARNESS-MOD-001 — Run product-module deep passes

- **Status:** Future design work
- **Scope:** the thirteen deep-pass modules named in
  `harness-design-state.md`

Acceptance criteria:

- Each module extends the product policy, references inherited invariant IDs,
  enumerates its parent seam first, and only tightens gates.
- Product-level artifacts remain broad and cross-cutting.

## 6. Archived migration design — outside the current goal

### OPERON-HARNESS-MIG-001 — Inventory incumbent claims read-only

- **Status:** Outside the current persistent goal; no execution authority
- Inspect incumbent tests, evaluations, commands, and CI only to catalog the
  claims and compatibility obligations they currently enforce.
- Do not use them to rewrite product truth or weaken the greenfield policy.

### OPERON-HARNESS-MIG-002 — Produce equivalence and disagreement evidence

- **Status:** Outside the current persistent goal; no execution authority
- Map every incumbent required claim to an equal or stricter new claim and
  prove the detector with a seeded failure.
- Record every side-by-side disagreement; unexplained disagreement blocks
  cutover.

### OPERON-HARNESS-MIG-003 — Ratify observation window and rehearse rollback

- **Status:** Outside the current persistent goal; no execution authority
- The human ratifies the duration and consequence standard for parallel
  operation.
- Rehearsal proves that only the additive new gate can be disabled and the
  unchanged incumbent gate remains available.

### OPERON-HARNESS-MIG-004 — Deliberate cutover decision

- **Status:** Outside the current persistent goal; prohibited without a
  separate future campaign and explicit human ratification
- Requires the equivalence report, disagreement log, observation evidence,
  rollback rehearsal, named owner, and explicit rollback criteria.
- Replacement, redirection, deletion, or weakening of incumbent commands and
  gates is outside this design campaign.
