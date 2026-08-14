# Validation Architect core improvements

## Friendlier validation without weaker assurance

Status: **recommended implementation design**, not yet implemented.

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

The redesign should make **validation understanding** a first-class capability of
the `validation-architect` library. It should turn validation-design documents and
the existing test inventory into a checked internal model. From that model it
should:

- show which product rule each test protects;
- propose which tests a change affects and explain uncertainty;
- classify outcomes consistently across local runs and CI;
- group derivative failures under a declared root cause without losing any case;
- present the same facts clearly to authors, validation architects, Reviewers,
  and operators.

There are two distinct uses:

- **Direct repository use:** the standalone agent, CLI, or library designs or
  revises validation for any target repository. When used on Cormidia itself,
  Cormidia is the target, not the host.
- **Embedded Cormidia use:** Cormidia hosts the library as a capability for its
  users' applications. Cormidia owns provider turns, budgets, approvals, and
  durable execution; the user's application is the target.

The core library stays host-neutral. A standalone wrapper or an embedding platform
supplies repository access, test execution, prerequisite probes, fixture setup,
CI integration, artifact storage, and governed model turns.

The improvements belong inside the existing validation-architect lifecycle. They
do not create another agent or a parallel process. The designer/stakeholder loop
creates the model and its human views; fresh readers test whether those views are
usable; the design auditor checks their rigor; and the same model later powers
implementation trace, explanation, test planning, and result reporting.

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

Here, **L1** means fast in-process tests with controlled inputs. **L2** may use
real local processes, temporary directories, Git repositories, worktrees, or owned
service doubles, but it still avoids live GitHub, cloud services, network access,
and provider spend. Fixtures are the known data and environments those tests set
up. They may model an external failure without depending on the external service.

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
| Record a family | Catalog Markdown, generated YAML, backlog, spec path, header, negative control, and evidence references | Repeated transcription creates drift and ceremony. | Library checked model/compiler; authority migration requires ratification. |
| Select tests | Full `pnpm test`, manually chosen Vitest paths, or known CF/HB directories | A fast path is not necessarily a trustworthy coverage set. | Library impact planner; Cormidia changed-path and runner adapters. |
| Start locally | Isolated wrapper, process identity and package-store preflight | Strong checks, but not every bootstrap path reaches the typed report. | Library capability schema; Cormidia outer launcher and probes. |
| Execute | Offline Vitest L1/L2; separately authorized higher lanes | Full feedback is slow and default output can obscure the first cause. | Cormidia runner/reporter using the common result format. |
| Diagnose | Raw Vitest output plus stronger campaign triage guidance | Shared fixture or prerequisite failures can fan out into noisy derivatives. | Library root-cause grouping plus declared dependency data from adapters. |
| Review | Catalog, backlog, spec headers, reports, and status registers | Reviewers reconstruct product meaning, ownership, layer rationale, and evidence. | Library role projections generated from one manifest. |
| Operate CI | Core Checks, manual trace workflow, self-hosted/hosted routing | Results are split across workflows and environments. | Cormidia CI integration and parity fingerprint. |

The current validation-architect campaign already has the right human workflow:

1. a stakeholder is grounded in the product documents and `rambling.txt`;
2. a designer and the stakeholder iterate on the validation design and backlog;
3. three fresh readers test whether an operator, new engineer, and coding agent
   can use the artifacts without the campaign transcript;
4. an independent design auditor checks falsifiability, coverage derivation,
   negative controls, layer placement, policy behavior, and provenance;
5. the designer disposes findings, the stakeholder confirms or arbitrates them,
   and a fresh second audit verifies the repairs.

That auditor checks whether the proposed design is coherent and rigorous. It does
not prove that later test code faithfully implements the design. After tests are
built, deterministic trace checks prove that the planned families and actual
tests are connected, while a separate fidelity audit judges whether the test
meaning and negative controls still match the design. These are complementary
checks, not competing meanings of “audit.”

## 6. Experience by role

| Role | What the system should answer |
| --- | --- |
| Change author | “I changed these paths. What is the smallest trustworthy validation plan, and why?” |
| Validation architect | “What must be added or revised, at which layer, with which owner and negative control?” |
| Independent Reviewer | “What product meaning is protected, why is this detector sufficient, and is its evidence complete?” |
| CI/operator | “What is the first causal failure, what did it prevent, and what should I do next?” |

Today these facts exist, but each role reconstructs them from several artifacts.
The library should generate the four views from one checked model.

## 7. Principles for “friendlier without weaker”

1. **The product answer and evidence completeness stay independent.** Missing
   evidence cannot pass; an observed product violation still fails.
2. **Summarize without deleting.** One causal headline may represent many cases,
   but every affected case remains in machine-readable evidence.
3. **Group only from explicit causality.** Never infer a shared root merely from
   similar messages or stack traces.
4. **Unknown impact expands scope.** The safe fallback is the full required lane,
   not optimistic omission.
5. **Selection is initially advisory.** Full Core CI stays authoritative while
   the planner's misses and extra selections are measured.
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

## 8. Library boundary

The companion integration record defines a provider-neutral library with an
injected turn executor. The same core supports two uses:

| Use | Target repository | Host |
| --- | --- | --- |
| Direct | Any repository, including Cormidia itself | Standalone CLI or agent |
| Embedded | A Cormidia user's application | Cormidia |

| Core library owns | Host or repository adapter owns |
| --- | --- |
| Design method, prompts, schemas, resumability, and method version | Provider/model selection, budgets, approvals, and durable execution |
| Validation model, compiler, trace, explain, and impact reasoning | Reading the target, Git changes, and product-specific path mappings |
| Result meanings and causal grouping rules | Tests, fixtures, probes, stdout/stderr capture, and CI orchestration |
| Generated author, architect, Reviewer, and operator views | Rendering, artifact storage, and publication |

The core must not own provider credentials, publish Git state, infer authority, or
silently change an accepted design. Cormidia's adapter work comes after the core
library and interface work; it is intentionally outside this document's backlog.

## 9. Core design

Names below describe behavior, not final exported TypeScript names.

### 9.1 Supported starting points

| Starting point | Expected behavior |
| --- | --- |
| Greenfield | Derive the design from product intent and architecture. |
| Existing application and tests | Derive requirements first, then inspect the existing suite to reuse sound tests and find gaps. |
| Existing validation-architect design | Reopen only affected structures and improve the suite incrementally. |
| Older method or schema | Produce and validate an explicit migration; never upgrade silently. |

The existing test suite is an input, not the source of requirements: **derive
requirements from first principles; improve implementation incrementally.**

### 9.2 One authoritative model

Three things must stay distinct:

- the **design corpus**: product structures, validation policy, families,
  backlog, owners, negative controls, and trace links;
- the **test inventory**: actual test files, test identities, fixtures, and
  runners;
- the **evidence**: results from one exact revision and environment.

The redesign should make a versioned, schema-validated YAML model the sole
authority for machine facts. Split it into logical files rather than one large
manifest. Generate the catalog, backlog, owner brief, trace view, and other human
Markdown from that model. Narrative inputs such as product documents,
`rambling.txt`, and ratification rationale remain authored prose; duplicated
tables of machine facts do not.

This is a deliberate clean break. Validation Architect has no external users, so
preserving a fragile Markdown/YAML dual authority would add complexity without a
compatibility benefit. The compiler must reject duplicate IDs, broken links,
missing owners or negative controls, invalid statuses, and generated-view drift.
It must report the exact source location and plain-language correction.

The test inventory remains outside the design model because test code is real
repository state. A repository adapter reads it and the compiler joins it to the
design for trace and impact queries.

### 9.3 Built into the existing campaign

The checked model is not an extra workflow layer. It becomes the working state of
the current campaign:

1. the designer/stakeholder loop edits the structured model;
2. the compiler validates it and regenerates human views after each meaningful
   change;
3. campaign completion is blocked on a clean compile;
4. the fresh-reader pass reviews only the generated, self-contained artifacts;
5. the design auditor receives the model, compiler report, and generated views,
   then applies judgment that deterministic checks cannot provide;
6. the accepted bundle includes the model, readable views, and an initial trace
   report showing planned implementation links.

After tests are built, the same trace engine adds actual test and evidence links.
A deterministic trace check proves closure on every change. A fidelity audit then
judges whether the tests truly implement the intended oracle and negative
control. The audit need not spend model judgment rediscovering broken links that
the compiler can find exactly.

### 9.4 Trace, explain, and impact

The shared relationship is:

`changed path -> product structure -> validation family -> test -> evidence`

- **Trace** walks relationships that already exist: “Why does this test exist?”
  or “What protects this contract?”
- **Explain** renders that answer for a person, leading with product meaning and
  retaining exact IDs and source links.
- **Impact** starts with a proposed change and asks which structures, families,
  and tests may be affected.

These are three uses of the same model, not three new document sets. Product
adapters supply path and symbol mappings. If a mapping is missing or uncertain,
the plan expands to a wider set, up to the full applicable suite.

### 9.5 One result record people can understand

Adopt a stable `validation-result/v1` record. Every launcher, prerequisite check,
test runner, trace check, and higher-lane campaign maps into it.

Each result answers three separate questions:

| Question | Values | Meaning |
| --- | --- | --- |
| Does this rule apply? | `applicable`, `not_applicable` | `not_applicable` requires an accepted reason. |
| Was all required evidence collected? | `complete`, `incomplete` | Missing, blocked, stopped, or stale evidence is incomplete. |
| What did the evidence show? | `pass`, `fail`, `inconclusive` | A proven violation fails; insufficient evidence is inconclusive. |

This separation matters. A product violation may be `fail` even when unrelated
evidence is incomplete. Incomplete evidence can never produce `pass`. Only an
applicable, complete pass is green.

When an applicable result is not green, its reason uses one of five plain
meanings:

| Reason | Meaning |
| --- | --- |
| `product_failure` | Product behavior violated an accepted rule. |
| `prerequisite_unavailable` | The required host, tool, package store, credential, authorization, or process capability was unavailable. |
| `harness_failure` | A fixture, adapter, runner, reporter, or harness self-test failed. |
| `evidence_incomplete` | Required evidence was missing, stale, stopped, unauthorized, or not run. |
| `traceability_broken` | Design, ownership, test, status, or generated-view links disagreed. |

The stable record contains only the facts every consumer needs:

- applicability, completeness, verdict, and reason;
- a plain-language summary and next action;
- exact product revision, lane, environment, and library/method/model versions;
- the owning product structure and root identifier;
- every affected case with its status and any `blocked_by` root;
- selected scope, expansions, and unresolved mappings when planning was used;
- evidence references and integrity hashes.

Hosts may add namespaced details, but may not redefine these meanings. A skipped
required test is incomplete and inconclusive; it never passes.

### 9.6 One root cause, every affected case

A failed prerequisite or shared fixture can block hundreds of tests. Human output
should show that root once, then summarize its effects. The machine record must
still retain every affected case and the explicit `blocked_by` link.

Grouping is allowed only when the dependency is declared: a test requires a
failed capability, fixture, or runner stage. Similar error text or stack traces
are not enough. Independent product failures remain independent.

### 9.7 Startup checks

The library defines required capabilities and result meanings; the host implements
the probes. A minimal outer launcher must also classify failures that happen
before the library or test framework loads. Checks run from cheapest and most
foundational to most expensive. A failed prerequisite starts zero dependent tests
and produces a useful result without exposing secrets.

### 9.8 Role-specific views

The same model generates:

- an author view with affected meaning, trustworthy commands, fixtures, negative
  controls, expansions, and unknowns;
- an architect view with enumerations, ownership, layer/oracle rationale, and
  closure findings;
- a Reviewer view with protected meaning, trace chain, exclusions, negative
  controls, and evidence;
- an operator view with the first cause, affected cases, next action, run
  identity, and full evidence link.

Plain meaning comes first. CF/HB/contract IDs remain available as precise
secondary detail.

### 9.9 Changed-path planning

The planner returns an explained test plan, not merely test paths. It includes the
changed inputs, affected structures and families, always-run safety checks,
negative controls, expansions, unknowns, and exact commands.

This is initially a feedback optimization. Locally, it suggests the smallest
trustworthy set. In CI, it may run likely failures first. The full required suite
still runs exactly once. Unknown or structural changes expand to the full suite,
so advice can become broader but never silently narrower.

“Selection recall” simply asks: of all test families later confirmed as relevant,
how many did the planner recommend? Selecting 19 of 20 is 95% recall. Before the
tool calls its advice trustworthy, it must miss zero required families across:

- a generated example for every mapping and fallback rule;
- representative historical changes;
- deliberate negative controls that remove or corrupt mappings; and
- shadow runs compared with independent review and the full suite.

Extra selections are acceptable and measured separately. This evidence improves
advice; it does not authorize test omission from the required CI suite.

### 9.10 Versions and migration

Before version 1.0, use a clean current schema with no compatibility promise. Do
not carry the old dual-authority structure into the new design merely to preserve
it.

At 1.0, semantic-version rules apply. The library writes only the current schema
major and can read the current and immediately previous major only to perform an
explicit migration. Every accepted design records the package, method, model,
result, policy, and golden-set versions. A major meaning change requires a named
migration and review; it never happens while reading a corpus.

## 10. Target experience

### 10.1 Design or revise validation

`inputs -> designer/stakeholder loop -> compile -> reader test -> design audit -> accepted bundle`

The user experiences one campaign. Trace and explain artifacts appear because the
campaign compiles its model, not because the user starts another agent afterward.
In revision mode, the current design and test inventory are inputs, and only the
affected design is reopened.

### 10.2 Use the built validation

`change -> doctor -> explain/plan -> execute -> causal result -> diagnose -> review -> full CI`

1. `doctor` checks that the environment can run the plan.
2. `explain` and `plan --changed` show affected product meaning, tests, unknowns,
   and commands.
3. local execution uses the same isolation and fixtures as CI.
4. the first failure leads with one plain-language cause and next action.
5. the full artifact retains every case and exact identity.
6. a generated brief gives the Reviewer the trace, selection, negative controls,
   and evidence.
7. a separate required `Validation Trace` CI check proves model-to-test closure;
   Core Checks still runs the complete required suite.

Trace is not merely navigation. It detects missing implementations, orphan tests,
false “landed” status, missing owners, broken negative-control links, and generated
view drift. It should therefore be a separate named required check, not a manual
audit and not a detail buried inside a generic Core Checks job. The design
campaign runs the same deterministic gate before its auditor. The independent
auditor remains responsible for design quality and test fidelity.

## 11. Measurements

| Measure | Plain definition |
| --- | --- |
| Time to first actionable failure | Start to the first message that states what happened, why, who owns it, and what to do next. Include startup and preflight time. |
| Causal-to-derivative failure ratio | Number of displayed roots compared with affected case records. Also report ungrouped cases so grouping cannot hide failures. |
| Selection recall | Relevant families recommended divided by all families confirmed relevant through the benchmark and review. Track extra selections separately. |
| Local/CI parity | For the same revision and lane, agreement on the plan, outcome, reason, affected families, and evidence; disclose environment differences. |
| Time to owning contract | Time for an unfamiliar author to reach the exact owning contract, invariant, boundary, or journey from a failure. |
| Correctly traced detector effort | Time, commands, files, and repair iterations needed to add a detector whose trace and negative control pass. |
| Prerequisite classification accuracy | Share of environment failures stopped before dependent tests and correctly described as prerequisites. |
| Reviewer comprehension | Time and accuracy for a fresh Reviewer to identify meaning, owner, layer, negative control, exclusions, and evidence. |

Collect the baseline across feature changes, defect fixes, new detectors, trace
repairs, prerequisite failures, and fixture failures.

## 12. Source-module size

The purpose of a line limit is simple: keep a module small enough for a human or
agent to understand. For Validation Architect core, target 400 lines and set a
500-line ceiling for new source modules. Keep the existing public-export limit and
require a named exception when a cohesive module genuinely needs more room.

Line count is a guardrail, not a design verdict. Do not create a separate metrics
program for it in this redesign, and do not split cohesive code mechanically just
to satisfy the number.

## 13. Implementation backlog and dependency order

These are the core-library work items. Cormidia adapter implementation follows in
a separate effort after the library interfaces and this core redesign are built.

| Rank | Candidate | User problem | Responsible layer | Expected benefit | Assurance unchanged | Measurement | Work type |
| ---: | --- | --- | --- | --- | --- | --- | --- |
| 1 | VA-CORE-001: authoritative model and compiler | Repeated facts drift across Markdown, YAML, backlog, and owner views. | Core model, schema, compiler, generators | One source of truth and precise errors. | All structures, families, owners, layers, oracles, negative controls, statuses, and provenance remain required. | Compiler findings; duplicate edits per design change; generated-view drift. | Protocol surface; approve schema before implementation. |
| 2 | VA-CORE-002: campaign integration | Compilation, reader tests, and audit can otherwise become disconnected stages. | Campaign state machine and completion gates | One understandable design loop that always emits usable artifacts. | Fresh readers, independent audit, bounded dispositions, frozen audited corpus, and resumability remain. | Completion-gate defects; reader comprehension; audit findings caused by deterministic drift. | Harness revision and human ratification. |
| 3 | VA-CORE-003: trace and explain | Users must know internal identifiers and reconstruct relationships manually. | Core query engine and generated views | Fast answers from product meaning to test and evidence. | Exact IDs, provenance, unresolved gaps, and full relationship closure remain visible. | Time to owning contract; query coverage; Reviewer comprehension. | Ordinary work after the model schema is approved. |
| 4 | VA-CORE-004: stable result API | Different launch paths use different words and can obscure whether product behavior was assessed. | Result schema and adapter contracts | One portable, fail-closed meaning across local, CI, and higher lanes. | Only complete success is green; product-failure precedence and exact identity binding remain. | Schema conformance; classification accuracy; local/CI parity. | Protocol surface; approve `validation-result/v1`. |
| 5 | VA-CORE-005: causal reporting and startup contract | One prerequisite or fixture failure can create hundreds of noisy outcomes, including failures before the reporter starts. | Result reducer and host capability interfaces | One actionable cause with every affected case preserved. | Declared dependencies only; no case disappears or becomes pass; zero dependent tests on failed prerequisite. | Root coverage; misgrouping rate; time to actionable failure. | Harness revision; host adapters follow separately. |
| 6 | VA-CORE-006: changed-path planner | Authors cannot find a small trustworthy set without knowing the corpus topology. | Impact engine and adapter interfaces | Faster explained local feedback and earlier CI signal. | Unknowns expand; negative controls and safety checks stay paired; full required CI remains. | Zero benchmark misses; extra-selection rate; planning latency. | Ordinary advisory tooling; any future omission is a separate ratified proposal. |
| 7 | VA-CORE-007: versioning and migration | Method, model, and result meanings can drift across upgrades. | Version checks and migration API | Reproducible interpretation and deliberate upgrades. | No silent migration; accepted version and migration evidence remain exact. | Rejected mismatches; migration round-trip tests; reproducibility. | Protocol surface before 1.0. |

## 14. Decisions and rationale

| Decision | Recommendation | Why |
| --- | --- | --- |
| Stable results | Adopt the three result axes, five reasons, and required record contents in section 9.5 as `validation-result/v1`. | They answer the user's questions—what happened, why, what was affected, and what to do—without exposing runner-specific vocabulary. |
| Source of truth | Move machine facts to schema-validated YAML and generate Markdown views. | There are no external users to protect, and dual authority is the main source of parsing and synchronization complexity. |
| Trace in the workflow | Compile and trace during the design loop, require deterministic implementation trace in CI, and retain independent design/fidelity audit. | Deterministic closure, human comprehension, and judgment test different properties. |
| Impact-planning proof | Require zero missed required families in generated, historical, negative-control, and shadow benchmarks; still run full CI. | This makes the advice credible without using a metric to weaken assurance. |
| Result vocabulary | Keep three plain answers: applicability, completeness, and verdict. Treat blocked/not-run as reasons for incomplete evidence. | The same model works across deterministic tests and higher lanes without hiding a product failure behind missing evidence. |
| Compatibility | Clean break before 1.0; from 1.0, write current schema and read current plus previous major for explicit migration only. | It avoids premature legacy while providing a disciplined future upgrade path. |
| Module size | Target 400 lines and cap new core modules at 500, with named exceptions. | It protects human and agent comprehension without turning line count into an architectural theory. |

## 15. Acceptance conditions

The redesign is complete only when:

- the campaign cannot finish with an invalid model or stale generated view;
- an empty or unstarted required suite cannot be green;
- every summarized cause resolves to every affected case;
- negative controls remain paired with their detectors;
- unknown impact expands instead of omitting tests;
- trace detects missing, orphaned, dishonest, and semantically broken links;
- an unfamiliar author can find the owning rule without knowing a CF/HB ID;
- a fresh Reviewer can reconstruct scope, exclusions, and evidence from one view;
- accepted versions and migrations are exact and never silently changed; and
- provider calls, budgets, approvals, and storage remain under the active host's
  authority.

Core work should add its own focused detectors and negative controls. It should
not add product test families merely to increase a count. Where coverage is
already strong, improve classification, selection, reporting, portability, and
explanation first.

## 16. Final judgment

Validation Architect should become one coherent system that designs validation,
compiles its decisions, explains them, checks implementation closure, plans
feedback, and reports results. The compiler and generated views strengthen the
existing designer–stakeholder–reader–auditor loop; they do not sit beside it.

The standalone tool can apply this core directly to any repository, including
Cormidia. Later, Cormidia can embed the same core for its users' applications
through a separate adapter. In both modes, validation becomes easier to understand
without weakening what counts as evidence.
