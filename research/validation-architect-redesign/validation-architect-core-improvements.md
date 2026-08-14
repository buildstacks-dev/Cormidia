# Validation Architect core improvements

## Friendlier validation without weaker assurance

Status: **proposed redesign and assessment**, not ratified policy.

Date: 2026-08-13

Companion decision record:
[2026-08-12 — Validation Architect packaging and Cormidia integration](./2026-08-12_validation-architect-integration.md).

No harness, test, ratified surface, ticket, live campaign, or eval campaign was
changed as part of this assessment. The command names, schemas, interfaces, and
backlog items below are proposals until separately accepted.

## 1. Executive summary

Cormidia's validation system is already strong where assurance matters. It fails
closed when required evidence is incomplete, does not pass by finding no tests,
uses deterministic L1/L2 fixtures, requires meaningful negative controls, and
preserves traceability from product structures to executable evidence. Its main
problem is not an obvious shortage of tests. Its main problem is that authors and
operators must understand too much of the harness's internal vocabulary before
they can select, run, or diagnose those tests confidently.

The redesign should therefore make **validation understanding** a first-class
capability of the `validation-architect` library. The library should compile a
validation corpus into a typed intermediate representation, answer trace and
impact questions, normalize result semantics, reduce explicit causal dependency
graphs, and project the same facts for change authors, validation architects,
Reviewers, and operators.

Cormidia should remain the host integration. It should own repository inspection,
Vitest execution, prerequisite probes, fixture setup, CI orchestration, artifact
persistence, and all provider-turn authority. This preserves the boundary already
chosen in the companion integration record: the library owns the method and pure
validation reasoning; Cormidia owns governed execution.

The recommended sequence is:

1. compile and validate the existing corpus without changing its authority;
2. introduce one typed result envelope and explicit failure taxonomy;
3. add causal reporting that retains every leaf case;
4. expose `explain` and role-specific projections;
5. add changed-path planning as an advisory, fail-open optimization;
6. measure recall and local/CI parity before considering any canonical targeted
   gate;
7. make structural policy changes only through harness revision and human
   ratification.

The guiding rule is:

> Make the path to understanding shorter while keeping the path to evidence
> exact.

## 2. Scope and evidence labels

This document uses three labels deliberately:

- **Measured fact** — observed in the Cormidia checkout or by a read-only/local
  validation command during the assessment.
- **Interpretation** — a conclusion drawn from one or more facts; it may be
  disproved by better evidence.
- **Proposal** — a possible intervention; it is not current Cormidia law or a
  ratified `validation-architect` API.

The assessment considered the experience of:

- an ordinary change author;
- the `validation-architect` method and its maintainer;
- an independent Reviewer;
- a CI/operator diagnosing a failed run.

It reviewed the repository authority and purpose, validation routing and policy,
the case catalog and backlog, the offline test launcher and preflight, relevant
gate scripts, Vitest configuration, Core Checks and trace workflows, and
representative unit, hermetic, fixture, policy, registry, and CI tests.

## 3. Current evidence snapshot

Unless otherwise noted, measurements below were taken on 2026-08-13 against
Cormidia revision `d6302c8f7b47`.

| Observation | Label | Meaning |
| --- | --- | --- |
| The offline suite executed 310 Vitest files and 2,553 tests: 2,552 passed and one was skipped. The run completed in 496.60 seconds. | Measured fact | The required local lane is populated and broad; the usability problem is not green by absence. |
| A representative six-test preflight family completed through the test wrapper in 5.12 seconds, with 159 ms inside Vitest. | Measured fact | Targeting can make feedback dramatically faster, but a file path alone is not proof that the selected coverage is complete. |
| The trace audit observed 409 families, 311 spec files, and 2,213 statically parsed test declarations, then reported 65 findings: 7 agreement, 7 forward-closure, 5 backward-closure, 7 status-honesty, and 39 spec-structure findings. | Measured fact | Coverage breadth and trace usability are different qualities. A deep corpus can still be hard to keep closed. |
| Validation trace is a manually dispatched workflow while Core Checks runs check, build, test, and secret scanning. | Measured fact | The normal CI result does not currently present trace closure in the same place. |
| The test wrapper isolates home, temporary directories, Git/package configuration, credentials, network behavior, process identity, and the offline package store before Vitest. | Measured fact | The underlying local harness design is strong and should be reused, not bypassed. |
| In a restricted execution environment, the TypeScript launcher failed on an IPC `EPERM` before the preflight could emit its own typed result; the same test entrypoint completed on the host. | Measured fact | A universal prerequisite contract must include bootstrap failures outside the current preflight process. |
| One catalog row containing inline `org\|app` text was split incorrectly by the Markdown-to-YAML AWK path; byte regeneration still agreed with the malformed generated output, while the semantic trace audit detected the shifted fields. | Measured fact | Byte agreement is insufficient when a lossy parser can corrupt both expected and actual generated artifacts. |
| `tests/README.md` still described several findings as blocked after policy tests had pinned them as resolved and ratified. | Measured fact | Human guidance can drift even when executable policy is strong. |
| Twenty-one of the last fifty assessed commits touched the size-ratchet baseline, including one baseline-only commit. | Measured fact | The exact ratchet creates material maintenance traffic; this is evidence to measure its effects, not proof that it should be weakened. |

Two cautions matter when reading these figures:

- the trace parser's declaration count and Vitest's runtime test count measure
  different things and should not be treated as interchangeable;
- one passing run establishes a useful snapshot, not permanent closure.

## 4. Coverage quality and usability quality are separate

### 4.1 Coverage and assurance quality

The following properties are non-negotiable strengths:

- no green by absence (`passWithNoTests` remains false);
- incomplete prerequisite or evidence states never become product passes;
- a proven product violation can fail even when other evidence is incomplete;
- runtime trust boundaries fail closed;
- negative controls prove that detectors can turn red before they turn green;
- the complete required CI lane remains complete;
- journeys, boundaries, contracts, invariants, interfaces, LLM sites, and
  operations remain traceable;
- fixtures remain deterministic and evidence retains exact commit, policy,
  authorization, environment, and artifact identities;
- L3/L4/L5 evidence cannot be casually substituted for deterministic L1/L2
  evidence;
- no test or gate is weakened merely to improve ergonomics.

The trace findings and incomplete external campaign rows must remain visible.
They are limitations to close or classify, not reasons to discount the coverage
that has landed.

### 4.2 Usability quality

The principal usability gaps are:

- no supported changed-path-to-family explanation for ordinary authors;
- no shared taxonomy spanning prerequisite, harness, product, evidence, and
  traceability failures;
- no causal-root presentation for hundreds of derivative case outcomes;
- trace status is not integrated consistently into ordinary CI feedback;
- family, ticket, layer, oracle, risk, ownership, source, and negative-control
  metadata are transcribed across several surfaces;
- routine output is noisier and less product-oriented than the campaign triage
  model;
- startup failures can occur before the current preflight reporter exists;
- status terms such as `LANDED`, `BLOCKED`, and `PARKED` require corpus-specific
  knowledge to interpret correctly.

Improving these gaps does not require weakening a single detector.

## 5. Current workflow and friction map

| Stage | Current Cormidia mechanism | Main friction | Best ownership for improvement |
| --- | --- | --- | --- |
| Understand a change | Purpose, architecture docs, routing rules, catalog, and backlog | Authors must manually map code to validation structures. | Library trace query plus Cormidia repository adapter. |
| Derive obligations | Eight-row routing grammar and cheapest-falsifying-layer rule | Rigorous but identifier-heavy and reconstruction-intensive. | Library corpus compiler and method API. |
| Record a family | Catalog Markdown, generated YAML, backlog, spec path, header, negative control, and evidence references | Repeated transcription creates drift and ceremony. | Library typed IR/compiler; authority migration requires ratification. |
| Select tests | Full `pnpm test`, manually chosen Vitest paths, or known CF/HB directories | A fast path is not necessarily a trustworthy coverage set. | Library impact planner; Cormidia changed-path and runner adapters. |
| Start locally | Isolated wrapper, process identity and package-store preflight | Strong checks, but not every bootstrap path reaches the typed report. | Library capability schema; Cormidia outer launcher and probes. |
| Execute | Offline Vitest L1/L2; separately authorized higher lanes | Full feedback is slow and default output can obscure the first cause. | Cormidia runner/reporter using library result semantics. |
| Diagnose | Raw Vitest output plus stronger campaign triage guidance | Shared fixture or prerequisite failures can fan out into noisy derivatives. | Library causal reducer plus explicit dependency data from adapters. |
| Review | Catalog, backlog, spec headers, reports, and status registers | Reviewers reconstruct product meaning, ownership, layer rationale, and evidence. | Library role projections generated from one manifest. |
| Operate CI | Core Checks, manual trace workflow, self-hosted/hosted routing | Results are split across workflows and environments. | Cormidia CI integration and parity fingerprint. |

## 6. Experience by role

### 6.1 Ordinary change author

The current system answers “what does this family prove?” after the author finds
the family. It does not reliably answer the author's first question:

> I changed these paths. What is the smallest trustworthy validation plan, and
> why is it trustworthy?

The safe default remains the full offline suite. Direct file selection is useful
for diagnosis but cannot, by itself, prove that every affected contract, neighbor,
boundary, invariant, and negative control is present.

### 6.2 Validation architect

The method has a rigorous derivation model but pays for it through synchronized
catalog, backlog, spec, status, ownership, and evidence surfaces. The current
structure findings are evidence of authoring friction. They are not evidence that
trace fields or negative controls should be removed.

As a packaged library, `validation-architect` should make correct structure the
easy output of the method rather than requiring callers to reassemble it from
prose.

### 6.3 Independent Reviewer

A Reviewer needs one auditable explanation containing:

- the protected product meaning;
- the owning contract, invariant, boundary, or journey;
- why the selected layer is the cheapest sufficient falsifier;
- the detector and its negative control;
- what was selected, omitted, blocked, or not assessed;
- the exact evidence and version identities.

Today those facts exist, but the Reviewer must reconstruct them from multiple
artifacts.

### 6.4 CI/operator

Campaign triage already distinguishes severity, action, and preserved evidence
better than routine test output. The operator needs the same causal vocabulary for
Core Checks and local runs, plus a stable fingerprint to compare local,
self-hosted, and hosted execution of the same commit and lane.

## 7. Principles for “friendlier without weaker”

1. **Verdict and completeness stay independent.** Missing evidence cannot pass;
   an observed product violation still fails.
2. **Summarize without deleting.** One causal headline may represent many leaves,
   but every affected case remains in machine-readable evidence.
3. **Group only from explicit causality.** Never infer a shared root merely from
   similar messages or stack traces.
4. **Unknown impact expands scope.** The safe fallback is the full required lane,
   not optimistic omission.
5. **Selection is initially advisory.** Full Core CI stays authoritative while
   targeted-suite recall is measured.
6. **One fact model, several views.** Builder, Reviewer, architect, and operator
   outputs are projections, not separately maintained truth.
7. **Plain meaning leads; exact identity follows.** Human output starts with the
   product or prerequisite meaning and retains CF/HB/contract IDs as precise
   secondary detail.
8. **Bootstrap is part of validation.** Failures before the test framework starts
   must be typed and preserved too.
9. **Authoritative changes are explicit.** A new schema or generated view does not
   silently replace a ratified corpus source.
10. **Ergonomics are measured.** Time, recall, parity, and reviewer comprehension
    are evaluated alongside assurance.

## 8. Proposed library boundary

The companion integration record establishes a provider-neutral library with an
injected governed turn executor. The same boundary should govern validation
friendliness.

| `validation-architect` library owns | Cormidia integration owns |
| --- | --- |
| Method profiles, phase state machine, prompts, schemas, resumability, and method version | Provider/model/effort selection, budgets, run envelopes, settlement, and approval gates |
| Typed validation corpus IR and semantic compiler | Reading Cormidia's current Markdown/YAML corpus and resolving repository paths |
| Trace graph and query semantics | Git changed-path discovery and Cormidia architecture mappings |
| Pure impact-plan construction | Process execution, Vitest selection, safety-floor commands, and CI ordering |
| Failure taxonomy and result-envelope schemas | Host probes, package-store checks, fixture creation, credentials, and authorizations |
| Pure causal reduction from explicit dependency edges | Capturing runner/fixture dependencies and raw stdout/stderr |
| Builder, Reviewer, architect, and operator projections | Console rendering, GitHub summaries, artifact upload, and durable storage |
| Schema/method compatibility and migration contracts | Pinning the exact package version and accepting a corpus migration |

The library should not acquire provider SDK ownership, spawn opaque token-spending
subprocesses, publish Git state, infer authorization, or silently modify a
consumer's corpus. Core functions should be deterministic and side-effect-free;
host effects should enter through narrow injected interfaces.

## 9. Proposed core capabilities

Names in this section are illustrative API concepts, not accepted package exports.

### 9.1 Typed corpus intermediate representation

The library should normalize source material into one `ValidationCorpus` model
containing:

- structures: journeys, states, invariants, boundaries, contracts, interfaces,
  LLM sites, and operations;
- families: stable ID, plain meaning, owner, layer, risk, oracle, negative
  controls, detected structures, evidence obligations, and lifecycle status;
- implementations: spec paths, concrete test identities, fixture dependencies,
  and evidence references;
- provenance: source file, location, source revision, schema version, method
  version, and content hash.

The compiler should reject duplicate IDs, dangling references, invalid status
transitions, lossy column parsing, ownership gaps, and catalog/generated-artifact
disagreement. Diagnostics should identify the field and source location in plain
language while retaining the exact identifier.

Initially, this compiler should consume Cormidia's ratified sources without
changing which source is authoritative. Moving authority from Markdown to a
structured manifest is a separate protocol decision requiring migration evidence
and human ratification.

### 9.2 Semantic compilation, not byte agreement alone

Generation should have two independent checks:

1. deterministic rendering from the normalized IR;
2. semantic reparse and equality against that IR.

This catches cases where the same lossy parser corrupts both a generated artifact
and its byte-level regeneration. Delimited prose must use a parser that honors the
actual syntax or, preferably, move machine fields out of delimiter-sensitive prose
after ratification.

### 9.3 Trace graph and query API

The normalized corpus should compile into a graph with typed nodes and edges such
as:

`changed path -> subsystem -> structure -> family -> detector -> evidence`

The graph should support queries by path, symbol, contract, family, backlog item,
owner, risk, layer, and status. Each result should explain how it was reached and
where uncertainty forced expansion.

This capability powers both strict trace audits and approachable questions such
as:

- What protects this contract?
- Why does this test exist?
- Which negative control proves this detector?
- What remains blocked or unassessed?
- Which families could this changed path affect?

### 9.4 Unified result envelope and failure taxonomy

The library should define a versioned result envelope while leaving probes and
execution to the host. A proposed taxonomy is:

| Cause class | Meaning | Required semantic treatment |
| --- | --- | --- |
| `PREREQUISITE` | A required host, tool, process, package-store, credential, or authorization capability is unavailable. | Incomplete; do not start affected tests; never report product pass. |
| `HARNESS` | A fixture, adapter, runner, reporter, or harness self-test is defective. | Validation-integrity failure or inconclusive result; fail closed. |
| `PRODUCT` | Product behavior violates a ratified contract, invariant, journey, boundary, or equivalent expectation. | Fail, even if unrelated evidence is incomplete. |
| `EVIDENCE` | Required evidence is missing, stale, ceiling-stopped, uncalibrated, unauthorized, or not run. | Incomplete/inconclusive unless a separate product failure is proven. |
| `TRACEABILITY` | Catalog, ownership, implementation, status, or generated-artifact closure is inconsistent. | Validation-integrity failure; never silently pass. |

Cause class must not replace the existing distinction between completeness and
verdict. The envelope should carry both. At minimum it should retain:

- schema, method, corpus, policy, product revision, and requested-lane identity;
- environment fingerprint and prerequisite results;
- first failing phase;
- root cause ID, class, plain meaning, trace owner, and remediation;
- every leaf case ID and its status;
- explicit root-to-leaf dependency edges;
- selection plan, safety floor, expansions, and uncertainties;
- raw evidence references with integrity hashes.

### 9.5 Causal reducer with a complete leaf ledger

The reducer should be a pure function over explicit events and dependencies. It may
group:

- a failed prerequisite and every test that declares that capability;
- a shared fixture setup failure and its dependent cases;
- a runner or reporter failure and the records it prevented from completing.

It must not group independent product assertions because their messages or stacks
look alike. Each leaf remains one of `failed`, `blocked_by_root`, `not_assessed`,
`incomplete`, `passed`, or another ratified status. A derivative leaf never becomes
pass merely because its root is shown once.

Human output can then lead with:

> The host could not prove stable process identity, so Vitest did not start and
> product behavior is unassessed.

The exact prerequisite ID, affected CF families, leaf statuses, remediation, and
raw evidence remain directly available underneath.

### 9.6 Capability and preflight contract

The library should describe required capabilities and normalize probe results. The
host should implement the probes. This permits Cormidia to reuse its strong
process-identity and offline-store checks without making the library OS-specific.

The outer launcher also needs a minimal bootstrap envelope so failures before the
library or Vitest loads can still produce a typed `PREREQUISITE` or `HARNESS`
record. Preflights should run cheapest and most foundational checks first, stop
affected execution, and disclose no secrets.

### 9.7 Explain and role-projection API

One normalized manifest should generate four views:

- **Change author:** affected product meaning, trustworthy commands, fixtures,
  negative controls, safety-floor expansion, and unknowns.
- **Validation architect:** enumerations, ownership, layer/oracle rationale,
  closure findings, and migration diagnostics.
- **Reviewer:** protected meaning, trace chain, negative-control evidence,
  selected/omitted scope, unresolved findings, and exact artifacts.
- **Operator/human:** causal outcome, completeness, remediation, approvals, run
  identity, and links to full evidence.

Plain language leads every view. Exact CF/HB/contract identifiers remain visible
for audit and linking.

### 9.8 Advisory impact planner

The planner should return an explanation, not merely a list of test paths. Its
output should include:

- changed inputs and resolved structures;
- selected families and detector paths;
- always-run safety-floor checks;
- neighboring or boundary expansions;
- unresolved mappings;
- the fallback decision and reason;
- the full set that CI will still execute.

Unknown, structural, corpus, gate, fixture, or policy changes should expand to the
full applicable lane. The first useful deployment is local advisory selection and
CI ordering: run the likely causal slice early, then run the complete required
suite exactly once. Test omission must not become canonical until recall is
demonstrated and the harness change is ratified.

### 9.9 Compatibility and migration manifest

Every accepted corpus should bind:

- library package version;
- method version;
- corpus schema version;
- result schema version;
- policy and golden-set identity;
- migration history and compatibility range.

The library should validate these identities before design, planning, or result
interpretation. It should never silently upgrade an accepted corpus.

## 10. Alternative designs

| Alternative | Benefits | Risks | Tradeoff |
| --- | --- | --- | --- |
| Full suite plus causal reporting | Lowest assurance risk; immediate diagnostic improvement; no selection-recall problem. | Local feedback remains slow; causal edges must be instrumented. | Safest first delivery, but does not solve discovery. |
| Changed-path impact manifest | Directly answers the author's question and can accelerate feedback. | Stale mappings can create false confidence. | High value only with fail-open fallback, visible explanation, and measured recall. |
| Contract-first `explain` and run plans | Useful before automatic selection; serves authors and Reviewers. | A human still confirms scope; depends on reliable corpus compilation. | Strong near-term interface and a prerequisite for trustworthy automation. |
| Generated manifest and role briefs | Reduces repeated transcription and gives each role an appropriate view. | Can become another drifting artifact if hand-maintained. | Excellent when generated from one authoritative IR. |
| Structured corpus compiler | Removes delimiter fragility and centralizes semantic validation. | A canonical-source migration is a protocol change with meaningful conversion risk. | Best long-term foundation; begin as a read-only compiler before changing authority. |

### Recommendation

Adopt a hybrid of all five in risk order:

- build the compiler and explanation layer first;
- add causal reporting to the unchanged full suite;
- expose impact plans as advisory and fail-open;
- generate role views from the same IR;
- ratify any authority migration or canonical selection only after measured
  evidence.

## 11. Recommended target experience

The target flow is:

`change -> doctor -> explain/plan -> execute -> causal result -> diagnose -> review -> full CI`

1. **Doctor.** A proposed `validate doctor` entrypoint emits concise human text and
   a versioned JSON result. The outer launcher captures bootstrap failure too.
2. **Explain and plan.** A proposed `validate explain <path|symbol|contract|CF|HB>`
   or `validate plan --changed` returns the product structures, families, safety
   floor, expansions, unknowns, and exact commands.
3. **Execute.** The local slice uses the same isolated home, temp, Git, network,
   credential, process, and package-store rules as the full lane. Negative controls
   stay selected with their detectors.
4. **Fail usefully.** The first screen shows one plain-language causal root, its
   class, remediation, and owner. It does not stream hundreds of derivative
   failures first.
5. **Retain evidence.** A compact table and machine artifact preserve every case,
   exact ID, status, edge, stdout/stderr reference, and identity hash.
6. **Review.** A generated brief shows changed paths, selected and expanded
   families, omissions and reasons, contract/invariant trace, negative controls,
   unresolved findings, and evidence completeness.
7. **Run full CI.** Core CI retains all required checks. An impact slice may order
   likely failures earlier but cannot replace the full lane without ratification.

## 12. Local/CI parity and time to first actionable failure

Parity requires more than running the same test names. Local and CI results should
bind the same:

- product revision and requested lane;
- library, method, corpus, result-schema, policy, and golden-set versions;
- Node, package manager, architecture, runner class, and package-store evidence;
- selected family set, safety-floor set, and negative controls;
- cause classification, verdict, completeness, and leaf ledger.

Environment-specific values may differ, but differences must be explicit. Hosted
fallback must never silently change the SHA, lane, gates, or evidence obligation.

Time to first actionable failure should include startup, package-store checks,
fixture setup, and reporter initialization—not just Vitest duration. The first
actionable message must contain plain meaning, cause class, owning structure, and a
remediation or next diagnostic step.

## 13. Structural gates and the line-count ratchet

The exact line-count ratchet can provide useful architecture pressure: it makes
growth visible and encourages decomposition. It can also create incentives for
mechanical splitting, line shaving, baseline churn, or moving complexity without
reducing it.

The current commit sample establishes maintenance frequency, not harm. Therefore:

- do not weaken or remove the ratchet now;
- measure baseline overrides, split-only changes, review time, churn, export-count
  workarounds, and post-change defects;
- compare physical size with responsibility count, coupling, public symbols, and
  change frequency;
- require human ratification for any threshold or enforcement change.

This is primarily a Cormidia design-policy question, not a generic
`validation-architect` core responsibility. The library may represent and report a
consumer's structural findings, but it should not impose one universal line limit.

## 14. Improvements by horizon

### Quick wins

- Compile the current corpus read-only and emit field-level semantic diagnostics.
- Repair Cormidia's 65 trace findings and delimiter-sensitive catalog generation
  without weakening trace checks.
- Define the versioned result envelope and five-class cause taxonomy as a proposal.
- Add a bootstrap-aware JSON preflight artifact alongside concise human output.
- Add `explain` queries backed by the current generated corpus.
- Make routine failures link to the owning contract and routing source.
- Document that direct Vitest invocation is a diagnostic shortcut, not a complete
  validation entrypoint.

### Medium-term improvements

- Add the pure causal reducer and a Cormidia Vitest/fixture adapter.
- Generate Builder, Reviewer, architect, and operator views from one manifest.
- Publish a secret-safe local/CI environment fingerprint.
- Add the advisory changed-path graph with full-suite fallback.
- Run likely impacted cases first in CI while retaining the complete required run.
- Record root-to-leaf metrics and upload the complete machine artifact.

### Structural proposals

These require protocol review and, when they alter corpus or gate semantics,
harness revision and human ratification:

- ratify the cross-lane result schema and cause taxonomy;
- decide whether a structured corpus becomes authoritative;
- ratify impact-selection recall and fallback requirements;
- decide whether trace closure joins Core Checks as a required status;
- change any size-ratchet threshold or enforcement semantics;
- allow targeted selection to omit tests from an authoritative lane.

## 15. Measurements

| Measure | Definition | Guard against gaming |
| --- | --- | --- |
| Time to first actionable failure | Start of command/job to the first message containing meaning, class, owner, and remediation. | Include bootstrap and preflight time, not only test-framework time. |
| Causal-to-derivative ratio | Displayed causal roots divided by affected leaf records. | Report root-assignment coverage and ungrouped leaves beside it. |
| Targeted-suite recall | Families reached by the selector divided by families established as affected by a trustworthy full run/review. | Required-lane recall must be 100% before omission; measure false-positive expansion separately. |
| Local/CI parity | Same commit/lane yielding the same selected families, cause class, completeness, and verdict where environment permits. | Publish environment differences rather than excluding mismatches. |
| Time to owning contract | Time from first failure to the exact owning contract, invariant, boundary, or journey. | Test with authors unfamiliar with CF/HB IDs. |
| Correctly traced detector effort | Median author time, commands, files touched, and trace-fix iterations for one valid detector. | A detector counts only when its negative control and trace closure pass. |
| Prerequisite classification accuracy | Share of environment failures stopped before affected tests and correctly typed. | Sample false `PRODUCT` and false `PREREQUISITE` classifications. |
| Preflight overhead | Time added by prerequisite checks on clean and cold hosts. | Never trade away required checks solely to lower the number. |
| Reviewer comprehension | Time and accuracy for an independent Reviewer to identify meaning, owner, layer rationale, negative control, and evidence state. | Use blind tasks, not corpus experts only. |
| Mechanical-churn indicators | Baseline-only changes, split-only commits, overrides, line shaving, and review time around structural gates. | Pair with coupling and defect outcomes; frequency alone does not prove harm. |

Collect the first baseline across ordinary feature changes, bug fixes, detector
deposits, trace repairs, prerequisite failures, and fixture failures before changing
policy.

## 16. Ranked candidate backlog

These are candidate work items, not created tickets.

| Rank | Candidate | User problem | Responsible layer | Expected benefit | Assurance that must remain unchanged | Measurement | Classification |
| ---: | --- | --- | --- | --- | --- | --- | --- |
| 1 | VA-CORE-001: typed corpus IR and semantic compiler | Corpus fields and generated artifacts can drift or be parsed lossily. | `validation-architect` core plus a read-only Cormidia source adapter | One validated fact model, precise diagnostics, and safer generation. | Every family, structure, status, owner, negative control, and evidence reference remains represented; no silent repair. | Semantic findings, parser defects, files/iterations per detector. | Ordinary library work while read-only; changing corpus authority requires harness revision and human ratification. |
| 2 | VA-CORE-002: versioned result envelope and cause taxonomy | Launch paths describe prerequisite, harness, product, evidence, and trace failures inconsistently. | `validation-architect` results core; Cormidia emitters | Uniform fail-closed semantics and portable reports. | Verdict/completeness independence, exact identity binding, and product-failure precedence. | Classification accuracy, schema conformance, local/CI parity. | Protocol-surface proposal; human ratification before stable adoption. |
| 3 | VA-CORE-003: trace graph and `explain` API | Authors and Reviewers must already know CF/HB identifiers and document topology. | `validation-architect` trace/query core | Faster path-to-contract and product-oriented explanations. | Exact IDs, full trace edges, unresolved findings, and source provenance stay visible. | Time to owning contract, reviewer comprehension, query coverage. | Ordinary work against accepted metadata; new mandatory metadata is a protocol proposal. |
| 4 | VA-CORE-004: causal reducer and complete leaf ledger | One shared failure can produce hundreds of noisy derivatives. | `validation-architect` results core plus Cormidia dependency instrumentation | One actionable root with complete audit evidence. | Every affected case remains recorded; no heuristic grouping; no leaf becomes pass. | Causal-to-derivative ratio, root coverage, misgrouping rate. | Protocol-surface proposal; display adapter is ordinary after ratification. |
| 5 | CORM-VAL-001: universal bootstrap and preflight adapter | Failures can occur before the current preflight can classify them. | Cormidia launcher/probes using the library capability schema | Earlier environment diagnosis and zero derivative test starts. | Fail closed, exact offline canary, credential isolation, zero affected tests on incomplete prerequisites. | Classification rate, time to actionable failure, preflight overhead. | Ordinary Cormidia work if verdict semantics stay unchanged; shared schema follows VA-CORE-002 ratification. |
| 6 | CORM-VAL-002: repair and surface trace closure | The assessed trace report is RED and separate from Core Checks. | Cormidia corpus, trace adapter, and CI summary | Restores closure and makes drift visible in normal review. | No weakening of agreement, closure, status, or structure checks. | Findings from 65 to zero, recurrence rate, time to repair. | Corpus repair is ordinary work; required-CI promotion is a protocol proposal. |
| 7 | VA-CORE-005: advisory impact planner | Authors cannot discover a smallest trustworthy suite from changed paths. | Library planner plus Cormidia Git/architecture adapter | Faster feedback with explainable expansions and fallback. | Unknowns expand to the full lane; safety floor and negative controls remain; full CI remains. | Recall, false-positive expansion, planning latency. | Advisory mode is ordinary; canonical omission requires harness revision and human ratification. |
| 8 | VA-CORE-006: role-specific validation briefs | Builders, Reviewers, architects, and operators reconstruct the same facts differently. | Library projection core plus Cormidia renderers | Lower comprehension burden without duplicate truth. | All views derive from the same versioned manifest and retain exact evidence links. | Reviewer comprehension, authoring effort, view/manifest agreement. | Ordinary tooling; making a new field mandatory is a protocol proposal. |
| 9 | CORM-VAL-003: local/CI parity fingerprint and causal reporter | Runner and environment differences are hard to compare; default output is noisy. | Cormidia Vitest reporter, wrapper, and CI artifact integration | Faster “works locally” diagnosis and consistent first-screen output. | Same SHA/lane/gates, no silent hosted fallback, full raw evidence retained. | Parity rate, time to classify drift, root coverage. | Ordinary integration after result-schema ratification. |
| 10 | VA-CORE-007: compatibility and migration manifest | Library, method, corpus, policy, and result versions can otherwise drift independently. | `validation-architect` core and Cormidia pinning/acceptance | Reproducible design and interpretation across upgrades. | No silent upgrade; exact accepted versions and migration evidence remain binding. | Rejected mismatch rate, migration defects, reproducibility checks. | Protocol-surface proposal; accepted-corpus migration requires human ratification. |
| 11 | CORM-VAL-004: impact-first CI ordering | Full-suite feedback is slow even when likely affected tests are known. | Cormidia Core Checks orchestration | Earlier causal signal without executing less assurance. | Complete required suite still runs exactly once with unchanged gates. | Time to actionable failure, total CI time, duplicate execution. | Ordinary workflow work if it only orders and never omits. |
| 12 | CORM-DESIGN-001: measure the size ratchet | Exact line thresholds may encourage mechanical churn, but harm is unproven. | Cormidia design policy and size gate | Evidence for retaining, refining, or replacing the signal. | No immediate weakening; type, export, import-direction, and test gates remain. | Baseline churn, overrides, coupling, review time, post-change defects. | Measurement is ordinary work; policy change requires human ratification. |

## 17. Acceptance conditions for the redesign

The redesign is not successful merely because its output is shorter. It should be
accepted only when it demonstrates that:

- an empty or unstarted suite cannot be reported green;
- every summarized root resolves to a complete leaf ledger;
- negative controls remain paired with selected detectors;
- unknown mappings expand rather than omit;
- local and CI artifacts bind exact identities and explain differences;
- trace compilation detects semantic corruption, not just byte drift;
- an unfamiliar author can find the owning product contract without knowing an ID;
- an independent Reviewer can reconstruct selection, exclusions, and evidence from
  one generated brief;
- provider calls, budgets, approvals, and settlement remain entirely under the
  injected Cormidia authority boundary;
- no accepted corpus or stable schema is migrated silently.

Core functionality should deposit its own focused detectors and negative controls,
but the program should resist adding product test families merely to increase a
count. Where coverage is already strong, the priority is classification,
selection, causal reporting, portability, and explanation.

## 18. Open decisions requiring explicit ratification

- Which result fields and cause classes become stable public API?
- Does Cormidia keep Markdown as the ratified source with a compiled IR, or migrate
  to a structured authoritative manifest?
- What evidence establishes 100% required-lane recall for impact selection?
- Does trace closure join Core Checks, become a separate required check, or remain
  manually enforced until a defined closure milestone?
- Which status vocabulary is shared across deterministic tests and higher-lane
  evidence?
- What compatibility window will the packaged library support across method,
  corpus, and result-schema versions?
- Which structural metrics should complement physical line count before any
  ratchet change is considered?

Until those decisions are made, the proposed APIs and workflows remain
experimental projections around Cormidia's existing assurance rules.

## 19. Final judgment

Cormidia does not primarily need more tests. It needs a clearer interface to the
substantial validation system it already has.

Packaging `validation-architect` as a library is the right point to separate the
generic capability from the first product integration:

- the library compiles, explains, plans, classifies, reduces, and projects;
- Cormidia probes, executes, authorizes, persists, and enforces;
- the accepted corpus and all assurance semantics remain exact;
- any change to canonical authority or test omission returns through harness
  revision and human ratification.

That boundary makes validation easier to understand, author, select, run, and
diagnose without buying convenience by spending assurance.
