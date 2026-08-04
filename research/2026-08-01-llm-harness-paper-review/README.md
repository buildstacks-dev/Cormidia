# LLM harness surveys compared with Cormidia

> **Status:** derivative, non-normative research review  
> **Date:** 2026-08-01  
> **Question:** What do two 2026 surveys of agent-harness engineering confirm, challenge, or newly suggest for Cormidia?

## Bottom line

Both papers support Cormidia's central architectural bet: an agent is not usefully evaluated as a model alone. Their **model–harness pair** is the right first correction to model-only attribution, but Cormidia's more precise experimental unit is the **complete assignment tuple: harness/runtime × model × effort**. Effort is not background metadata: it can change behavior, cost, latency, and the amount of search or reasoning performed. Cormidia already embodies this more concretely than either survey's general taxonomy. Its provider-turn identity binds the exact assignment; plans and progress are durable; risky effects are gated; approval is distinct from execution; and evidence is tied to exact artifacts.

The important gap is therefore not a missing harness concept. It is the distance between Cormidia's unusually strong design and the proof currently implemented for it. The replacement validation harness has a ratified contract and a working deterministic foundation, but release gating remains suspended, later validation layers are incomplete, several product-truth findings remain open, and some explanatory documents have drifted from the current policy. Cormidia should finish that proof floor before adding broad new mechanisms.

After that floor is restored, the papers suggest four high-leverage improvements:

1. evaluate exact harness/runtime–model–effort assignments, including controlled one-variable ablations, instead of treating model identity as the independent variable;
2. turn traces into structured failure attribution that feeds deterministic regression cases;
3. make cross-boundary handoffs more explicit and portable without duplicating Cormidia's existing plan, grant, and evidence identities;
4. report success, cost, latency, reliability, risk, and process quality as a Pareto profile rather than collapsing them into one score.

The strongest strategic learning is that Cormidia's moat is not the number of agents. It is the fidelity with which intent, authority, state, action, evidence, and accountability survive across a long-running episode.

## The two papers

| Short name | Paper | Contribution | Evidence and limits |
| --- | --- | --- | --- |
| **ETCLOVG survey** | Junjie Li et al., *Agent Harness Engineering: A Survey*, 71 pages | Defines a harness as a distinct systems-engineering object and organizes it into seven layers: Execution, Tooling, Context, Lifecycle, Observability, Verification, and Governance. It maps more than 170 public projects and develops cross-layer design problems. | Broad, practice-oriented systematic mapping with a corpus frozen on 2026-05-08. Coverage is biased toward English-language, public, open-source, GitHub-visible evidence. Coding used one primary coder with author audit rather than formal inter-rater measurement. It is descriptive, not a causal or normative comparison. |
| **Model–harness survey** | Jianyuan Guo et al., *From Question Answering to Task Completion: A Survey on Agent System and Harness Design*, arXiv:2606.20683v1, 29 pages | Represents an implementation agent as a model plus six coupled harness responsibilities: observation, context, control, action, state, and verification/governance. It connects task pressures to harness choices and reviews public benchmark variation. | Its benchmark examples are observational. Public submissions often differ in model version, reasoning effort, tools, retries, timeouts, and resource budgets, so the reported spreads demonstrate configuration sensitivity but do not isolate causal effects. |

The papers overlap substantially but answer different questions. The ETCLOVG survey is the better systems inventory: it names the infrastructure and control-plane layers around an agent. The model–harness survey is the better experimental argument: it asks what should be held fixed, varied, and measured when attributing performance.

Searchable text extractions are committed in [`paper-text/`](paper-text/). The source PDFs are not committed — see the integrity table at the end for their URLs and SHA-256 digests.

## Minimal vocabulary

The ETCLOVG survey's seven layers are:

- **Execution environment:** the operating-system, container, virtual-machine, network, and resource boundary in which actions run.
- **Tool interface:** tool descriptions, discovery, invocation protocols, and session handling.
- **Context management:** selection and assembly of active context, cross-run state, and longer-lived memory.
- **Lifecycle/orchestration:** the loop, state machine, routing, delegation, recovery, and end-to-end workflow.
- **Observability:** traces, events, costs, reliability signals, and operational views.
- **Verification/evaluation:** readiness checks, controlled execution, outcome and trajectory judgment, failure attribution, and regression feedback.
- **Governance/security:** identity, permissions, policy hooks, hardening, audit, and human control.

The second paper's six responsibilities describe roughly the same system from the dataflow perspective:

- **Observation interface:** converts environment state into model-consumable observations.
- **Context manager:** decides what enters the model's working context.
- **Control loop:** decides what runs next, when to retry, and when to stop or escalate.
- **Action interface:** converts model intent into bounded environment actions.
- **State and artifact store:** preserves durable progress and outputs across steps or runs.
- **Verification and governance:** checks outcomes, enforces policy, and controls high-risk actions.

In Cormidia, an **episode** is a durable unit of goal-directed work. An `EpisodePlan` is its schema-valid directed acyclic graph of provider, mechanical, and approval steps. A **provider turn** is an atomic execution assignment, not merely a prompt. Its assignment tuple is harness/runtime, model, and reasoning effort; the wider turn identity also binds the role and operation. The **total gate** classifies every proposed tool action as allowed, approval-required, or denied. These identities matter because they tie a decision, effect, cost, and piece of evidence to the exact configuration that produced it.

## What the papers jointly establish

### 1. The experimental unit is the complete assignment tuple

The second paper writes an implementation agent as a foundation model coupled to a harness. Public benchmark results reinforce the point. On its strict matched subset of Terminal-Bench 2.0 submissions, the median within-model range across harnesses was 13.6 percentage points; 14 of 20 models varied by at least 10 points. Examples included ranges of 13.7 points for GPT-5.3 Codex, 18.4 for Claude Opus 4.6, and 20.8 for Gemini 3.1 Pro. Its WebArena compilation contains still larger model-to-harnessed-system spreads. These are not controlled treatment effects, but they make model-only attribution untenable (model–harness survey, §§7.3–7.4).

For Cormidia, “model plus harness” is still underspecified. The proposed comparative-execution contract makes every candidate one exact atomic assignment tuple and explicitly rejects implicit Cartesian generation across harness, model, and effort. Its examples encode assignments such as `codex:gpt-5.6-sol:high`; candidate identity is `(comparison_id, assignment_tuple, sample_index)`. The `sample_index` distinguishes independent draws of the same tuple and is not a retry or a hidden change to the assignment. Fair comparisons freeze the repository base, input/context manifest, objective, authority, tools, gate policy, and budgets; only the declared tuple and sample index may differ.

The resulting experimental unit is therefore **harness/runtime + model + effort**, not merely a pair. A role label such as “Reviewer” is insufficient evidence unless the complete tuple, harness version, tools, environment, budgets, and sample identity are recoverable. When estimating the effect of one component, the other tuple components and frozen comparison inputs must remain fixed.

### 2. Long-horizon reliability comes from externalized state and closed-loop control

Both papers distinguish a useful agent from a single model call. It observes, acts, stores state, verifies, and adapts. The ETCLOVG survey further divides context into active, session/cross-run, and persistent memory, and warns that adding more text does not solve context drift. Reliable state needs durable artifacts, provenance, and explicit freshness semantics (ETCLOVG survey, §§5–6 and §12.2).

Cormidia strongly agrees. Git repositories, worktrees, issues, plan journals, run logs, approvals, the telemetry ledger, and learning artifacts are authoritative state; model context is a projection assembled from governed sources. Stateless scheduler ticks can resume work because progress is externalized. This is a deeper implementation of the papers' principle than “conversation memory.”

### 3. Verification is a lifecycle, not a final score

The ETCLOVG survey's five stages are task grounding, pre-execution readiness, controlled execution and trace capture, outcome/trajectory judgment with failure attribution, and regression/deployment feedback (pp. 32–39). It recommends layered evaluators: deterministic checks first, semantic or model-based judging where required, and human judgment where automation is not trustworthy. The evaluator itself must be tested.

Cormidia's replacement validation design is closely aligned but more explicit about proof economics. It places each case at the cheapest layer that can falsify the claim:

- **Layer 1:** deterministic unit and contract tests;
- **Layer 2:** hermetic composition across real internal components and honest boundary fakes;
- **Layer 3:** bounded live seam checks against real external services;
- **Layer 4:** model-quality evaluation using committed golden cases;
- **Layer 5:** soak, contention, and threat-model evidence.

Its “no green by absence” rule is a particularly strong answer to the surveys' warnings about incomplete or confounded evidence: missing, skipped, blocked, or budget-exhausted work cannot become a pass.

### 4. Governance and observability are part of correctness

The ETCLOVG survey treats observability, verification, and governance as cross-cutting control concerns rather than optional production polish. It calls for audit records that connect trace identity, actor identity, tool call, policy decision and version, result, cost, and integrity evidence (§§7–9).

Cormidia is strongest in this area. Its authority ordering, role permissions, total tool gate, content-bound grants, approval queue, exact-content continuation, typed at-most-once effects, and human control over critical operations make policy part of execution semantics. Its three observability levels preserve summaries, structured events, and verbatim artifacts, while an exactly-once ledger tracks provider settlement. Approval and execution acknowledgement are deliberately separate facts.

The remaining challenge is unification: policy decisions, tool trajectories, exact artifacts, costs, and validation verdicts exist, but do not yet form one complete trace-native attribution and evaluation surface.

### 5. More harness is not necessarily better

Both papers reject a monotonic “more scaffolding equals more capability” assumption. The model–harness survey highlights simple systems that approach much larger frameworks on coding benchmarks. The ETCLOVG survey argues that stronger models can make old scaffolding redundant or harmful and cites a production case where simplifying the harness for a stronger model reduced cost while retaining quality (§12.5).

Cormidia's learning loop already has the right safety shape for adaptation: candidate creation, review, human approval, offline replay, sticky canary assignment, publication, activation, and measurement. What it lacks is an explicit **subtractive** experiment: identify a harness intervention, remove or simplify it under a controlled exact-tuple comparison, and retain it only if it improves the multi-objective result. Harness components should earn their continued complexity.

## Cormidia mapped to the two taxonomies

| Survey concern | Cormidia mechanism | Assessment as of 2026-08-01 | Learning |
| --- | --- | --- | --- |
| Execution / observation | Managed clones and worktrees, provider adapters, environment observations, sandbox-app profiles | Strong isolation intent and useful app boundaries; live environments are still a distinct seam, and the human-authored threat model required for full release evidence is pending. | Treat environment fidelity and observation fidelity as separate adapter-calibration dimensions. |
| Tool interface / action | Native provider tools routed through the total gate; typed effect executor for later delivery | Strong action governance. Provider tool-event fidelity is uneven: Claude and pi outcomes remain less complete than Codex, and an untrusted Codex read can bypass the gate by design. | Calibrate what each adapter can observe and prove, not just whether it can invoke a tool. |
| Context | Fixed authority/taste/role/app/protocol/memory assembly, governed concepts, cache-stable prefix | Strong provenance ordering and prompt-cache discipline. Freshness and confidence are implicit in source identity more often than explicit in each projected fact. | Add state-fidelity checks for staleness, conflicting evidence, and confidence where projections cross runs. |
| Lifecycle / control | `EpisodePlan` graph, build-loop ticket state machine, stateless dispatch, durable plan journal, standing roles | Strong. It supports exact resumption and separates provider, mechanical, and approval work. One ratified policy snapshot records an active app without an installed scheduler, so current work is human-invoked rather than autonomous. | Report current operational posture separately from architecture and historical live proof. |
| State and artifacts | Repositories, worktrees, GitHub issues and pull requests, plan journals, run logs, approvals, telemetry, learning bundles | Strong and unusually concrete. Artifact-before-label and exact-revision review guard against narrative-only success. | A portable handoff envelope could expose the relevant subset without creating a second source of truth. |
| Observability | Three evidence levels, read-only observe/report/narrative leaves, exactly-once settlement ledger | Broad coverage. Tool-outcome completeness varies by adapter, and traces are not yet the common substrate for automated failure attribution. | Join traces to policy, cost, artifact, and verdict identity at the same granularity. |
| Verification | Deterministic gates, structured review verdicts, ratified five-layer replacement design, growing `claude-tests` suite | Directionally excellent but incomplete. The deterministic foundation and substantial first-wave coverage exist; live, model-quality, soak, and threat-model proof are not complete. Release gating is suspended. | Finish the proof floor before claiming qualification or adding an expansive evaluation platform. |
| Governance | Authority, taste, role separation, content-bound grants, approval ≠ execution, typed at-most-once effect, protected learning surfaces | Cormidia's clearest advantage over the surveyed ecosystem. It treats authority uncertainty as a reason to narrow capability. | Preserve these semantics when standardizing tools or handoffs; portability must not flatten policy identity. |

## Where Cormidia is stronger than the surveys' generic guidance

### Durable identity rather than informal configuration

The papers say to report the harness. Cormidia supplies several concrete identities worth preserving: the exact provider/model/effort assignment; a plan and step identity; content-bound approval grants; an exact repository revision for review; and an execution acknowledgement separate from the decision that authorized it. These make retries, continuation, cost settlement, and blame assignment tractable.

### Evidence before status

Cormidia does not allow a narrative label such as “shipped” to create the artifact it claims. GitHub state, exact commit identity, deterministic gates, and explicit terminal states come first. The replacement validation design extends that logic with negative controls and the requirement that deterministic defects discovered live deposit cheaper regression detectors.

### Governance is fail-closed and typed

The papers survey permission systems and human-in-the-loop controls. Cormidia defines a total decision for every tool action and scopes reusable grants by rule, path, and content identity. Unknowns do not silently widen capability. The executor owns at-most-once external effects, so an agent's approved intent is not confused with proof that the effect occurred.

### Learning changes the harness under control

The model–harness survey anticipates co-evolution and warns about unsafe runtime self-modification. Cormidia's answer is not online self-editing. It records candidates, distinguishes authorization from validation, replays offline, canaries at episode granularity, publishes deterministically, and keeps protected policy surfaces under human control. That is the appropriate safety posture for harness learning.

### Validation begins from journeys and boundaries

The ETCLOVG layers are useful coverage prompts, but a layer checklist alone can produce green-by-presence. Cormidia's ratified design derives cases from user journeys, invariants, boundaries, contracts, interfaces, model call sites, and operational risks. Its permission/effect, durability/money, and merge/evidence risk classes focus assurance on what can actually harm the product or corrupt truth.

## Material gaps and inconsistencies

These are findings from the comparison, not changes to Cormidia's ratified surfaces.

### The validation implementation is not release-complete

The policy and backlog describe a strong replacement harness, and the repository now contains a non-trivial deterministic suite rather than a green-by-absence placeholder. However:

- release gating remains explicitly suspended until an equivalent fail-closed lane is rebuilt;
- bounded live profiles and several real-service seam proofs remain pending;
- the non-GitHub deployment/publication live cell is blocked for lack of a disposable target;
- model-quality golden-set scaffolds and their runner are not complete;
- score thresholds owned by open findings are hypotheses, so threshold-dependent results must remain inconclusive;
- soak, contention, and the human-authored governance threat model are pending.

This is the largest gap relative to both papers because every other claim—reliability, cost control, governance, learning safety—depends on a trusted measurement system.

### Trace capture is richer than trace diagnosis

Cormidia preserves several evidence forms, but the papers call for structured attribution across observation, context, reasoning/control, action, environment, verification, and policy. Today, a human can often reconstruct a failure; the system does not yet consistently produce a typed explanation such as “stale observation caused an invalid plan,” “action interface omitted tool failure,” or “policy correctly blocked an unsafe effect.”

The next step is not more logging. It is a failure-attribution schema bound to existing run, step, tool, policy, artifact, and revision identities, with an explicit path from a deterministic live failure to a Layer 1 or Layer 2 detector.

### Cross-boundary handoffs are distributed across several good artifacts

The ETCLOVG survey identifies standard handoffs among agents, tools, and humans as an open problem. It proposes carrying intent, constraints, permissions, artifacts, provenance, budget, risk, traces, and open decisions (§12.4). Cormidia represents most of these, but across `EpisodePlan`, provider envelopes, plan journals, tool decisions, approvals, run logs, and GitHub artifacts.

A typed handoff view could reduce coupling between roles and adapters. It should be a projection over existing sources of truth, not a parallel mutable record. Because adding a new boundary or invariant would structurally change the ratified validation design, implementation would require a formal harness-revision pass rather than an ad hoc schema addition.

### Controlled assignment-tuple experiments are not yet a first-class campaign

Cormidia qualifies exact provider/model/effort assignments and has designed golden-set evaluation. Its proposed comparative-execution contract now defines the identity, isolation, accounting, and selection semantics for bounded comparisons, but no command or runtime behavior described by that proposal exists yet. The implemented validation program also does not yet provide completed matched campaigns that isolate one harness/runtime, model, or effort intervention while holding the other tuple components, task set, environment, sample policy, retries, timeout, and budget constant.

This matters for two reasons. First, it prevents over-crediting model upgrades for harness improvements. Second, it prevents keeping obsolete scaffolding merely because removing it has never been tested. Such experiments should begin only after golden cases are committed and relevant thresholds are ratified; otherwise the experiment tunes its own judge.

### Value-aware measurements exist, but not yet as a coherent decision surface

Cormidia's episode contract already names provider turns, cost, latency, active versus human-wait time, productive ratio, repeated-work cost, continuation, approval precision, terminal integrity, ledger coverage, scheduler reliability, and learning efficacy. This is unusually close to the second paper's value-aware objective.

The missing piece is a shared Pareto report that compares configurations across success, cost, tail latency, retry/timeout rate, policy violations, recovery, and evidence quality. A single weighted score would conceal important tradeoffs and would be premature while several thresholds remain unratified.

### Current explanatory surfaces have drifted from the policy

The validation policy is the single source of truth for open product-truth findings. It now lists implementation-discovered findings numbered 12 through 16, covering reset atomicity, direct default-branch pushes, outside-worktree classification, bootstrap reruns, and publish-origin identity. Some higher-level explanatory surfaces still describe only the earlier blocked findings. That mismatch can cause a reader to overstate current coverage.

There is also a budget-contract conflict: the higher-authority purpose decision withdrew input-token ceilings as an admission dimension, while the episode contract still displays input-token columns in its canonical route budget table. The higher-authority decision wins, but the stale table remains a maintenance hazard.

These inconsistencies should be reconciled in the normal ratified-surface workflow. This review does not silently change them.

## Recommended sequence

| Priority | Recommendation | Concrete outcome | Why now |
| --- | --- | --- | --- |
| **P0** | Restore the proof floor | Complete the required deterministic and hermetic validation waves; resolve or explicitly park current product-truth findings; reconcile policy-facing documentation; author the governance threat model; keep release gating suspended until equivalent fail-closed evidence exists. | Without a trustworthy harness for the harness, every broader claim is provisional. |
| **P1** | Make traces diagnostic | Define typed failure attribution over existing episode, step, tool, policy, artifact, revision, cost, and verdict identities. Route deterministic live/evaluation failures into cheaper regression detectors. | Cormidia already captures much of the data; joining it creates more value than collecting another trace stream. |
| **P1** | Add matched assignment-tuple ablations | On frozen golden cases, vary one harness/runtime, model, or effort component at a time while holding the remaining tuple, inputs, tools, environment, sample policy, retries, timeout, and budget fixed. Include subtractive harness trials and report confidence and raw traces. | The papers' strongest empirical learning is configuration sensitivity; Cormidia's comparative-execution design supplies the stricter identity needed to avoid both model-only and effort-blind attribution. |
| **P1** | Publish a Pareto scorecard | Compare success, evidence quality, total cost, tail latency, retries/timeouts, recovery, and policy outcomes without reducing them to one scalar. | Cormidia already measures many inputs; making tradeoffs visible will guide model and harness choices. |
| **P2** | Project a typed handoff envelope | Expose intent, constraints, authority, budget, risk, artifact references, provenance, trace linkage, and open decisions as a read-only projection over existing durable identities. | It improves portability and failure localization while avoiding a duplicate state store. Structural validation changes require the ratified revision workflow. |
| **P2** | Add state-fidelity checks | Mark freshness, provenance, conflict, and confidence for cross-run facts; test stale and contradictory observations at the cheapest boundary. | Long-horizon failure is often incorrect state estimation rather than insufficient context length. |
| **P2** | Calibrate adapter observations and actions | For each provider adapter, document and test what tool intent, outcome, duration, error, and policy path are actually observable and trustworthy. | “Tool support” is too coarse; verification quality is bounded by interface fidelity. |

## Learnings for Cormidia

1. **The model is a component, not the product.** Cormidia's exact assignment tuple is strategically correct. Qualification and incident analysis should always name the full runtime configuration.
2. **State is the product; context is a projection.** Durable repositories, plans, journals, grants, ledgers, and artifacts are more reliable than a growing transcript. Context assembly should expose provenance and freshness from those sources.
3. **Verification is a measurement system.** A large test count is not enough. Coverage derivation, negative controls, evaluator tests, failure attribution, and evidence completeness determine whether green means anything.
4. **Governance and observability must share identity.** A trace that cannot identify the governing policy decision is incomplete; a policy decision that cannot link to the resulting action and artifact is unauditable.
5. **Minimal harnesses can beat elaborate ones.** Complexity should be retained by matched evidence, including evidence that a component remains useful after a model upgrade.
6. **Process quality is part of agent quality.** Success obtained through uncontrolled retries, excessive cost, policy bypass, or irreproducible state is not equivalent to bounded, auditable success.
7. **No green by absence is the right response to uncertainty.** Both surveys expose confounding and measurement gaps. Cormidia's incomplete/inconclusive semantics are more honest than forcing a pass/fail label.
8. **Cormidia's differentiation is control fidelity.** Multiple roles are useful, but durable authority, exact continuation, typed effects, artifact identity, and proof-preserving handoffs are what make the organization trustworthy.

## Evidence and provenance

This review was built from both complete papers and the current Cormidia design, status, learning, approval, episode, and replacement-validation artifacts. All 100 PDF pages were rendered and visually checked; the text extractions were used for search and cross-reference. The original paper corpus and Cormidia sources were inventoried as an explicit 25-file local set totaling approximately 124,000 words. This revision also incorporates the proposed [comparative-execution contract at commit `5561833`](https://github.com/buildstacks-dev/Cormidia/blob/5561833c8ab553c9b801aae153b04a2df5c39a35/docs/comparative-execution/design.md), inspected from `main` on 2026-08-01. That document records owner-confirmed product direction but explicitly states that its command and runtime behavior do not yet exist. The frozen `archive-do-not-read/**` tree was excluded and was not used.

Key Cormidia truth rules used in the comparison were:

- `docs/PURPOSE.md` is authoritative when another explanation conflicts with a ratified decision;
- `validation-design/validation-policy.yaml` is the tighten-only validation contract and single source for open product-truth findings;
- `validation-design/harness-backlog.md` and `claude-tests/README.md` describe implementation progress but do not themselves create release evidence;
- repository status and known limitations are descriptive and were kept distinct from historical live-verification evidence.

Source metadata and integrity:

| Artifact | Original location | Committed text | SHA-256 of source PDF |
| --- | --- | --- | --- |
| Li et al., *Agent Harness Engineering: A Survey* | <https://picrew.github.io/LLM-Harness/main.pdf> | `paper-text/llm-harness-main.txt` | `878bb6b6384117e66cf0052593e267b76cb1434e45e1e91965ebc87b258f0df5` |
| Guo et al., *From Question Answering to Task Completion: A Survey on Agent System and Harness Design* | <https://arxiv.org/pdf/2606.20683> | `paper-text/arxiv-2606.20683.txt` | `5d21e1f25dd55857e7d17452be1bc74d14026e0bc7843d84f73f55c17856fdda` |

The source PDFs are **not committed** — they are third-party binaries totalling
4.5 MB, and blobs are expensive to remove from history later. Re-fetch them from
the URLs above and verify against the SHA-256 column; the searchable text
extractions in `paper-text/` carry everything cited in this review.

This document is an analytical synthesis, not a product decision, validation attestation, or release recommendation.
