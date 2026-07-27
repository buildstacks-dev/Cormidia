# LLM Eval Patterns — templates for Phase 5

## The two-layer split, restated precisely

| | Contract layer | Quality layer |
|---|---|---|
| Question | Is the output structurally valid? | Is the output *good*? |
| Verdict | Binary pass/fail | Pass rate vs threshold over a golden set |
| Determinism | Deterministic (schema, enums, budgets) | Statistical (N≥3 runs per case) |
| Runs | Every commit | Prompt change, model change, nightly |
| Provider | Mocked for surrounding-code tests; real (or sandbox) for schema conformance smoke | Real |
| Belongs to | Classic integration harness — the LLM provider is an external boundary like Stripe | The eval program |

Never blend the layers: a schema failure is a bug ticket; a quality-threshold failure is an eval investigation. They have different owners, costs, and response playbooks.

## Golden set format (per call site)

Commit as data, one directory per call site:

```
golden-sets/
  planner/
    manifest.yaml        # rubric, threshold, N runs, owner, created-before-tuning attestation
    cases/
      001-simple-crud-feature.yaml
      002-ambiguous-requirements.yaml
      ...
```

`manifest.yaml`:

```yaml
call_site: planner
rubric: |
  Acceptable iff: (a) decomposition covers all stated requirements,
  (b) no step depends on an artifact produced by a later step,
  (c) each step has a checkable done-condition.
threshold: 0.90          # pass rate over cases
runs_per_case: 3
authored_before_prompt_tuning: true   # rule 5 attestation; a set authored after tuning validates nothing
owner: <human>
sources: [acceptance-criteria, adversarial, production-incident]
```

Each case: input (or fixture pointer), context needed to reproduce, and either programmatic checks or the rubric reference for a grader. Start small (10–20 cases per site); the sourcing channels grow it. A scaffold with rubric + threshold and zero cases is a valid Phase-6 deliverable — the commitment precedes the content.

## Judge meta-eval (for any LLM-judging-LLM site)

The judge is measured on two seeded sets, never on live traffic first:

- **Must-catch set:** inputs with planted defects (bugs, spec violations, policy breaches). Metric: catch rate.
- **Must-pass set:** clean inputs of comparable difficulty. Metric: false-positive rate.

Report both — a judge that flags everything has a perfect catch rate and is useless. Thresholds per criticality tier; re-run the meta-eval on any judge prompt/model change before its verdicts count. Until calibrated, judge verdicts are advisory. This is the same trust-boundary principle as agent self-reports: an unvalidated evaluator must not feed promotion, canary, or quality metrics.

## Trajectory assertions (agentic loops)

Cheap, deterministic assertions over run telemetry/transcripts — write these before considering an LLM-as-judge over trajectories:

- Every tool call is in the allowed set for this role; arguments schema-valid.
- Step count ≤ budget; token spend ≤ budget; wall-clock ≤ budget.
- No cycle: the same (tool, normalized-args) pair does not repeat ≥K times.
- Terminal state is one of the legal terminals (done, escalated, failed-closed) — never silent expiry.
- Escalation fired on every condition that requires it (missing permission, ambiguous requirement, guardrail trip).

Escalate to judge-over-trajectory only for qualities assertions can't express (e.g., "was the plan revision sensible"), and then that judge needs its own meta-eval.

## Guardrails vs evals — placement rule

For each invariant an LLM could violate at runtime: the enforcement is code (validator, budget cutoff, gate, fail-closed halt), the *test* verifies the guardrail trips (feed it a violating output via mock), and the eval merely tracks how often the model attempts the violation (a quality signal, not a defense). If removing the model's goodwill breaks the invariant, the design is wrong.

## Model-swap regression procedure

1. Freeze golden sets and thresholds (no edits in the same change as the swap).
2. Run full quality evals on old and new model; N≥3 per case.
3. Acceptance: per-site pass-rate delta within policy threshold; no contract-layer regressions; judge sites re-pass their meta-evals.
4. Record the deltas in the policy file's change log. A swap without this procedure is a config change with no acceptance criteria — vibes.

## CI cost tiering (record in validation-policy.yaml)

| Trigger | What runs |
|---|---|
| Every commit | Contract layer; guardrail tests (mocked provider); trajectory assertions on recorded fixtures |
| Prompt or model change | Quality evals for affected call sites |
| Judge prompt/model change | Meta-evals for that judge |
| Nightly | Full quality evals, all sites |
| Provider/model swap | Full swap regression procedure |

The tiering exists so eval cost is a planned budget line, not something skipped silently until a swap burns the team.

## Module scope — inherited eval obligations

When designing evals for a module inside a larger product:

- **Inherited call sites are referenced, not re-planned.** If the parent already has a golden set and rubric for a shared call site, the module points at it. Two golden sets for one call site means two definitions of "good" and a swap decision nobody can make.
- **A module may tighten a threshold, never loosen it** (policy rule 9). A stricter module threshold on an inherited site is recorded in the module policy with justification.
- **Judge calibration is inherited whole.** If the parent's review gate judges this module's output too, the module contributes seeded defects to the parent's meta-eval corpus rather than standing up a second one.
- **New call sites introduced by the module get a full plan** — contract layer, golden set, threshold, CI tier — in the module's own `llm-eval-plan.md`.

## Tooling

Framework selection for both layers happens in Phase 7 — see `tooling-menu.md`. Whatever is selected, golden sets live as plain files in Git, not inside a vendor's dataset store: the set is the model-swap regression suite and must outlive any tool choice.
