# Comparative execution

*Status: proposed implementation contract — product direction confirmed by the owner
2026-08-01; no command or runtime behavior described here exists yet. Ratified product
truth remains in `docs/PURPOSE.md`. Implementation is tracked by
[epic #219](https://github.com/cormidia/Cormidia/issues/219).*

Comparative execution lets one planned provider turn produce several independently
executed candidate artifacts from the same frozen input, evaluate them under one
operation-specific policy, and continue with exactly one selected artifact. It also
exposes the same engine as a standalone local-repository workflow so a person can use
Cormidia's native harness, accounting, isolation, and evaluation without creating an
Cormidia org.

The feature is deliberately not a Cartesian harness × model × effort runner. Every
candidate is one exact, explicit, atomic assignment tuple. Cormidia never invents a
combination, widens a role, or calls an unavailable or unapproved tuple "qualified."

## 1. Outcomes and non-goals

### Outcomes

- Improve a consequential turn by selecting among a bounded set of genuinely
  independent implementations, plans, reviews, diagnoses, or drafts.
- Preserve the episode as one outcome and one route: only the compared provider step
  fans out, and one selected artifact feeds the next step.
- Make assignment quality and unit economics observable per operation without hiding
  candidate, evaluator, or judge spend.
- Give non-Cormidia users a preview-first `cormidia compare` workflow over a local git
  repository, with no org, scheduler, or GitHub dependency.
- Produce governed evidence that may later inform adaptive assignment policy without
  allowing one favorable draw to rewrite that policy.

### Non-goals

- Exhaustively generate every syntactically possible harness/model/effort permutation.
- Treat one comparison as qualification, a model leaderboard, or proof that a tuple is
  globally better.
- Let an LLM judge compensate for a failed deterministic guardrail.
- Compare external-effect operations such as deploy, publication, approval execution,
  merge, or destructive lifecycle work.
- Let a candidate publish, push, comment, open a PR, merge, deploy, or change the
  canonical episode workspace before selection.
- Replace the ordinary independent review and ship gates applied to the selected work.

## 2. The unit is one provider turn

A `TurnComparison` wraps one planned `provider_turn`. All variants share the same:

- episode, step, role, operation, objective, and authority;
- base revision, input/context manifest, acceptance criteria, expected outputs, and
  safety facts;
- tool permissions, network/tool-egress policy, gate policy, and comparison policy;
- comparison-level cost, provider-turn, active-time, and candidate-count ceilings.

Only the exact assignment tuple and `sample_index` may differ. Repeating one tuple with
different sample indexes is allowed when the policy explicitly requests independent
samples. It is not a retry: every sample is a new provider turn with its own execution
record and settlement.

```text
frozen provider-step input
├─ candidate A: assignment tuple + sample index → artifact + evidence
├─ candidate B: assignment tuple + sample index → artifact + evidence
└─ candidate C: assignment tuple + sample index → artifact + evidence
                                     ↓
                   deterministic eligibility filter
                                     ↓
                  operation-specific qualitative judge
                                     ↓
                      durable selection record
                                     ↓
             one selected artifact → ordinary next plan step
```

An episode may contain several compared steps, but every comparison is a separate
bounded group. V1 executes variants sequentially. Parallel candidate execution is a
later optimization requiring its own contention and workspace-isolation evidence; it
is not implied by a fan-out shape in the durable plan.

## 3. Identities and durable records

### 3.1 Comparison identity

The comparison identity binds:

- repository identity and frozen base revision;
- episode and step identity, or standalone invocation identity;
- role, operation, objective, input/context manifest, and expected outputs;
- candidate tuples and sample indexes in canonical order;
- validation, judge, fallback, retention, and budget policy versions.

Changing any bound input creates a different comparison. Resuming reuses the original
bytes; it never re-reads a mutable task file, config file, prompt, candidate set, or
repository base and calls the result the same comparison.

### 3.2 Candidate identity

A candidate identity is `(comparison_id, assignment_tuple, sample_index)`. Candidate
states are:

```text
planned → running → terminal
terminal = valid | invalid | failed | blocked | ambiguous
```

`invalid` means the candidate completed but failed an eligibility contract or gate.
`failed`, `blocked`, and `ambiguous` retain their ordinary runtime meanings. No state is
silently converted to `valid` because another candidate succeeded.

### 3.3 Comparison state

```text
planned → executing → evaluating → selected → materializing → completed
                               ↘ inconclusive
                               ↘ failed
```

The journal records every candidate terminal, evidence-bundle hash, judge execution
and settlement, selection-policy result, and materialization acknowledgement. A crash
after selection never reruns candidates or changes the winner. A crash during
materialization resumes from the content-bound selection record or stops ambiguous;
it never silently selects a different artifact.

## 4. Candidate isolation and fairness

Every candidate begins from the same immutable repository and context fingerprint.
Code-producing candidates receive separate managed git worktrees outside the user's
active checkout. Non-code outputs receive separate artifact namespaces. Candidate
processes cannot read another candidate's worktree or evidence before they terminate.

The coordinator enforces:

1. identical base and required inputs;
2. identical authority, tool policy, acceptance criteria, and expected outputs;
3. no candidate-to-candidate context leakage;
4. no outward effects from a candidate lane;
5. one truthful terminal record and one settlement per provider turn;
6. candidate mutation detection over the candidate HEAD, tracked and
   decision-relevant diff, and governed generated paths;
7. an explicit candidate list — never an implicit Cartesian expansion.

Harness capabilities may legitimately produce different trajectories. Fairness means
the authorized problem and starting state are identical, not that harnesses are
artificially reduced to a lowest-common-denominator completion API.

## 5. Evaluation and selection

### 5.1 Operation-specific evidence

One generic "quality score" cannot compare every role. A versioned
`SelectionPolicy` belongs to an operation family and declares its required evidence,
hard eligibility clauses, qualitative rubric, judge assignment, tie-breakers, and
inconclusive behavior.

Examples:

| Operation family | Deterministic or externally grounded evidence | Qualitative axes |
| --- | --- | --- |
| Builder | required gates, tests, typecheck, criterion→test map, diff and documentation changes, scope and mutation checks | intent correctness, test depth, documentation adequacy, maintainability, implementation economy |
| Planner | schema, DAG, candidate membership, budget arithmetic, terminal coverage | decomposition, dependency sanity, useful acceptance criteria, role/step necessity, proportionality |
| Reviewer | verdict contract, exact-HEAD binding, cited evidence existence | serious-defect discovery, false-positive discipline, causal grounding |
| SRE | source identity, evidence availability, typed outcome contract | diagnosis plausibility, actionable next checks, noise discipline |
| Support/Marketing | provenance and publication guardrails, source-reference checks | groundedness, audience fit, factual fidelity, edit cost |

### 5.2 Lexicographic selection

Selection is ordered; correctness is never traded for style or price:

1. **Eligibility:** discard candidates failing a required deterministic or
   externally grounded clause.
2. **Qualitative ranking:** a calibrated, independent judge ranks only eligible,
   anonymized artifacts against the operation rubric.
3. **Tie-break:** apply declared deterministic tie-breakers such as lower equivalent
   cost, lower active time, or smaller in-scope diff only inside the policy's quality
   indifference condition.

If exactly one candidate is eligible, it may be selected without a judge. If none are
eligible, the comparison fails with all candidate evidence retained.

### 5.3 Judge trust boundary

The selection judge is a distinct LLM call site. Candidate identity and provider name
are hidden from its artifact view; ordering is deterministic but blinded. The judge
emits a structured ranking, criterion-level evidence, confidence/disagreement data,
and exactly one terminal verdict.

Judge scores are inadmissible for automatic winner promotion until the judge has a
committed seeded-defect and clean-control meta-eval, and its thresholds and sampling
design are human-ratified. Until then:

- judge output is advisory and reported as `inconclusive`;
- a unique mechanically eligible candidate may still be selected;
- multiple eligible candidates follow an explicit `on_inconclusive` policy;
- standalone mode retains every valid result and requires explicit local selection;
- no surface renders the advisory ranking as qualification or green evidence.

An org comparison policy must declare `on_inconclusive`. Allowed V1 behaviors are
`configured_valid_baseline` or `require_human_selection`; omission fails validation.
The configured baseline can win only if it was actually executed and is eligible.

## 6. EpisodePlan integration

Comparative execution is optional and off by omission. It requires adaptive assignment
mode because multiple exact assignments are being authorized for one step. An accepted
provider step may carry a comparison reference with:

```yaml
comparison:
  candidate_set_id: builder-quality-v1
  selection_policy_id: builder-change-v1
  samples_per_assignment: 1
  max_candidates: 3
  max_provider_turns: 4       # candidates plus any judge turns
  max_equivalent_usd: 30
  on_inconclusive: configured_valid_baseline
```

This is illustrative transport, not a ratified schema. The implementation issue owns
the exact field names.

The EpisodePlanner may propose a comparison only when app policy enables the operation,
candidate set, activation reason, and aggregate ceilings. Deterministic validation
must expand the comparison's worst-case candidate and judge turns into plan admission
before any runtime is constructed. A creator scope can request the same governed
comparison explicitly. Neither path may invent a tuple or use comparison to bypass a
mandatory independent Reviewer step.

The selected artifact continues under the original step's expected-output contract.
Every later gate, Reviewer turn, PR, and merge remains part of the ordinary episode.
Losing artifacts never become plan outputs.

## 7. Activation modes and Cormidia-owned sampling

An app policy may authorize one or more of:

- `explicit`: a human or execution-ready creator requests a named candidate set;
- `planner`: EpisodePlanner requests comparison because declared uncertainty,
  consequence, or expected value justifies the extra budget;
- `sampled`: Cormidia deterministically selects a small fraction of eligible planned
  steps for comparison under a predeclared exploration budget.

Sampled activation is sticky on `hash(episode_id, step_id, policy_version)`. Restart,
provider availability, or observed early results cannot move a step into or out of the
sample. The sampling fraction, eligible operations, candidate set, monthly exploration
budget, and stop rules are app-narrowing policy. Ceiling exhaustion preserves partial
evidence and yields incomplete/inconclusive, never a cheaper hidden rerun.

Per-comparison evidence can improve the current outcome. Cross-episode aggregation may
emit a governed learning candidate about assignment policy. It never directly edits
roles, candidates, qualification provenance, prompts, or routing policy. A single
episode is an observation, not a model-swap decision.

## 8. Standalone repository mode

`cormidia compare` is an adapter over the same comparison coordinator, journals,
candidate executor, evidence bundler, selector, and reports. It does not create a
shadow implementation.

### 8.1 Preconditions and authority

V1 requires:

- an installed Cormidia binary;
- a local git repository with a resolved, clean base commit;
- exact candidate assignment tuples supplied by the operator;
- provider credentials and harness availability for those tuples;
- an explicit task or task file and an operation-specific selection policy, supplied
  explicitly or resolved from a named operation default;
- a reviewed aggregate budget and execution confirmation.

No org home, app registry, scheduler, GitHub remote, or GitHub authentication is
required. Standalone candidates are recorded as `operator_declared`; availability and
capability may be verified, but the binary never labels them org-approved or qualified.

### 8.2 Preview-first CLI

Illustrative UX:

```bash
cormidia compare . \
  --task "Implement account deletion with tests and documentation" \
  --operation builder-change \
  --policy builder-change-v1 \
  --candidate codex:gpt-5.6-sol:high \
  --candidate claude:claude-opus-4-8:xhigh \
  --judge claude:claude-opus-4-8:xhigh
```

Without `--execute`, the command is token-free and prints the frozen base, candidate
tuples and verification status, selection policy, candidate/judge turn ceilings,
equivalent-cost ceiling, worktree destinations, tool-egress posture, and the fact that
no winner will touch the active branch.

Execution requires the preview's comparison identity:

```bash
cormidia compare . ... --execute --confirm cmp_a18f42
```

Durable state defaults outside the repository under
`~/.cormidia/standalone/<repo-fingerprint>/comparisons/<comparison-id>/`. Candidate
worktrees are likewise external. Provider transport is allowed; candidate tool egress
is denied unless the invocation explicitly narrows and records an allowance. Candidate
processes cannot push or contact GitHub through an orchestrator-owned path.

### 8.3 Result and materialization

The terminal command produces equivalent terminal, JSON, and portable HTML reports:

- every candidate assignment and sample identity;
- validation evidence and invalidation reasons;
- blinded judge result and admissibility status;
- candidate, judge, and total cost/turn/time accounting;
- selected or inconclusive outcome and exact rationale;
- local worktree/branch references and retention deadline.

Standalone mode never mutates the active branch automatically. Once selection is
admissible—or the human explicitly chooses among retained valid candidates—a separate
content-bound command materializes the artifact as a local
`cormidia/compare/<comparison-id>/winner` branch. It does not push, open a PR, or merge.
Dirty or moved-base destinations fail before mutation; no force option overrides that
identity check.

## 9. Failure and recovery rules

- Candidate infrastructure failures never cause silent tuple substitution.
- Merit failures are terminal for that candidate and are never retried for a better
  draw. Typed infrastructure retries, if policy permits them, remain separate provider
  turns and evidence.
- A candidate cannot observe a sibling's result, judge output, or selection state.
- A judge failure cannot invalidate mechanically valid candidate artifacts; it yields
  the declared inconclusive path.
- A missing or corrupt evidence bundle makes that candidate ineligible, never zero.
- A changed base, task, policy, candidate set, assignment, or input manifest requires a
  new comparison identity.
- Cleanup removes only comparison-owned worktrees after retention and never deletes a
  materialized winner branch or user checkout.
- Recovery preserves all paid work and settlements. It never regenerates a completed
  candidate merely because selection or materialization later failed.

## 10. Observability and learning

`episode explain`, status, Reports, and the standalone report should project the same
comparison record. They distinguish:

- candidate execution from judge execution;
- eligible, invalid, failed, blocked, and ambiguous candidates;
- advisory ranking from admissible selection;
- selected from materialized from downstream-verified;
- known cost from partial or unavailable usage;
- comparison uplift from eventual product outcome.

Useful metrics include valid-candidate rate, judge disagreement, configured-baseline
win rate, selected-candidate downstream review outcome, cost/latency uplift, and
quality-versus-cost by operation × complete assignment tuple. No aggregate pools
different operation families or hides builder/judge pairing.

## 11. Delivery sequence

1. **Contracts and hermetic skeleton:** durable identities/state machines, candidate
   isolation, no-effect guardrail, settlement/accounting, fake candidate executor,
   selection policy contract, and negative controls.
2. **Standalone Builder slice:** preview-first `cormidia compare`, sequential isolated
   worktrees, operation-specific evidence, JSON/HTML report, explicit local winner
   branch. Judge remains advisory until calibration.
3. **EpisodePlan integration:** adaptive candidate sets, admission arithmetic,
   selected-artifact continuation, explain/report projection, and recovery.
4. **Planner activation:** planner may propose a comparison inside app-narrowed policy.
5. **Cormidia-owned sampling and governed learning:** episode-step-sticky exploration,
   aggregate evidence, and learning candidates; no automatic assignment mutation.
6. **Optional parallel execution:** only after sequential semantics, workspace
   isolation, settlement, and contention have independent evidence.

## 12. Validation obligations

The corresponding harness revision lives in `validation-design/` as J-19, B-18/B-19,
contracts `CORMIDIA-C-B18-001`/`CORMIDIA-C-B19-001`, call site S-8, and traced `CF-*`
families. Existing invariants remain sufficient: authority, total gating, settlement,
evidence truth, merge integrity, containment, self-promotion prohibition, durable
writes, non-vanishing work, and uncertainty-narrows all apply. No new global invariant
is introduced.

Layer placement:

- L1: schemas, state transitions, identities, budget arithmetic, selection-policy
  ordering, effect-denial, report truth, CLI conformance.
- L2: real temp git/worktrees plus mocked adapters/judge; crash sweeps at every
  candidate/selection/materialization transition; no-leak and no-effect cases.
- L3: existing real-adapter seams only when comparison changes adapter invocation or
  conformance; no new live-world boundary is needed for standalone local operation.
- L4: S-8 selection-judge meta-eval and per-operation ranking quality; scores remain
  inadmissible under F-PT-011 until calibration thresholds and sample design ratify.
- L5: comparison contention, state growth/retention, cost integrity, and sampled-policy
  fairness once automatic sampling or parallel execution exists.

Implementation must not claim the feature complete while required cases are absent or
the S-8 judge is uncalibrated. An uncalibrated implementation may ship only as
explicit data collection with advisory ranking and non-judge promotion rules above.
