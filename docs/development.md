# Building and maintaining Operon

This is the canonical developer-lifecycle policy for the Operon platform.
It applies to humans and coding agents changing this repository. It does not
grant authority to, configure, or become context for an Operon-operated org.

## Two independent control planes

| | Build and maintain Operon | Operate an org with Operon |
| --- | --- | --- |
| Subject | The `operon` package, source, tests, evals, and release | One configured org and its target applications |
| Authority | A human-approved development objective and repository policy | The org's ratified constitution, roles, pipelines, app policy, and scoped approvals |
| Durable state | Git commits, PRs, CI, isolated eval artifacts, external archives | `~/.operon/<org>/`, app repositories, tickets, runs, ledger, scheduler and learning state |
| Agents | Independent development agents selected by the human | Planner, Builder, Reviewer, SRE, Support, Marketing, and learning roles instantiated by Operon |
| External boundary | Disposable private eval repositories and isolated provider campaigns | The org's approved GitHub, production, publication, deployment, and communication surfaces |

The relationship is one-way: developers build a package; a separately
configured org consumes that package. Operon must not operate an org whose job
is to build or maintain Operon itself. Org prompts, approvals, memories,
learning, budgets, scheduler state, and production evidence cannot authorize or
train platform-development work. Development campaign results cannot authorize
an org operation.

Root `AGENTS.md`, this guide, `docs/PURPOSE.md`, `docs/efficiency.md`, `eval/**`,
`scripts/eval/**`, and `test/**` are developer-only surfaces and are excluded
from the npm package. The packaged `agent-skills/operon/` skill is deliberately
an org-operation guide. `TASTE.md`, `roles.yaml`, `pipelines.yaml`, and
`prompts/**` remain org-runtime surfaces; do not put developer authority in
them. `test/development-boundary.test.ts` pins this packaging separation.

## One objective, bounded autonomy

A human may authorize a development objective once. That authorization covers
ordinary isolated descendants needed to reach it: investigation, code and doc
changes, token-free tests, focused provider admission, repaired candidates,
disposable eval GitHub exercises, final qualification, evidence handling, PR,
CI repair, and shipping. A changed commit invalidates prior evidence identity;
it does not by itself invalidate the objective authority.

Provider campaigns bind the standing grant into each immutable manifest. The
grant declares the objective, repair lineage, allowed campaign types, private
GitHub namespace, billing mode, cumulative equivalent-cost ceiling, and zero-
effect boundary. The command-line environment switch and exact campaign
confirmation remain two-key accident guards that the developer supplies; they
are not repeated requests for human approval.

Equivalent USD is an accounting and loop-detection measurement. For a declared
subscription-backed grant it is not a claim of incremental token billing. The
circuit breaker counts historical spend plus every immutable descendant
attempt, including failed attempts and typed retries, and stops before the
cumulative ceiling. Never overwrite or omit an attempt to recover capacity.

Fresh human direction is required only for a genuinely new decision:

- expanding the objective, repository namespace, production path, or outward
  effects;
- metered or unknown billing, or raising the cumulative ceiling;
- weakening a contract, threshold, grader, denominator, retry rule, safety
  boundary, provider accounting rule, or ratified runtime surface;
- governed learning activation or rollback when its policy requires an exact
  candidate/action authorization;
- production mutation, deployment, publication, messages, or destructive data
  work;
- a real-time soak or other campaign explicitly reserved for later; or
- the repair lineage's declared repeated-full-qualification stop condition.

## Incremental development ladder

Use the cheapest evidence that can disprove the change, in this order:

1. Preserve the first failure and classify its genuine cause: product, test,
   harness, provider/account, GitHub, safety, measurement, or environment.
2. Reproduce it with the smallest deterministic test. Add an adversarial
   near-miss so the boundary cannot regress.
3. Run the relevant focused token-free suites. Do not start a broad provider
   campaign to discover a failure a local test can expose.
4. If model behavior is the remaining uncertainty, run a non-promotable
   focused provider-admission campaign for only the repaired cases and any
   downstream provider cases a prior fail-fast run deliberately did not reach.
   It must use the same exact candidate, assignments, thresholds, graders, and
   safety boundaries as final qualification.
5. Admit adapters for that exact candidate where the release contract requires
   it.
6. Run one final full qualification only after focused and adapter admission
   are green. Stop immediately after the first terminal failure because the
   campaign can no longer qualify; retain later cases as deliberately unrun.
7. Qualify and reconcile read-only, archive before cleanup, import only the
   sanitized projection, prove release equivalence, and then run the complete
   final suite and CI.

A rerun-to-green is not a diagnosis. Record the initial failure, its cause, the
specific repair, and the focused proof before a full rerun. Merit failures are
never retried. Only the declared typed infrastructure retry is eligible, and
both attempts remain evidence.

Do not create a favorable-sample loop for an aggregate statistical gate. Phase
6 paired learning is one predeclared six-arm experiment inside final
qualification. Its deterministic verifier and retained provider artifacts may
be replayed locally as regression fixtures, but an additional provider
experiment would change the declared sampling procedure. If its aggregate
result is inconclusive, regressed, or invalid, retain it and distinguish a
genuine treatment miss from a deterministic verifier defect before seeking a
new treatment or experiment decision. Never rerun for a better draw.

## Phase 6 implementation of this policy

The current human-ratified grant is
`eval/development-authorizations/phase6-efficiency-qualification-20260716.yaml`.
It binds the Phase 6 repair lineage to subscription billing, a cumulative
`$1000` equivalent-cost circuit breaker, `buildstacks-dev/operon-eval-*`, and
zero production or outward effects. Its historical amount includes every
retained Phase 6 adapter and candidate attempt before this policy was adopted.

The sequence is:

```bash
AUTH=eval/development-authorizations/phase6-efficiency-qualification-20260716.yaml

pnpm eval:prepare -- --campaign adapter-harness-calibration --github-owner buildstacks-dev --authorization "$AUTH"
# preview, execute, and identically rerun its disposable GitHub exercise
# preview and execute its provider calibration

pnpm eval:prepare -- --campaign focused-provider-admission --github-owner buildstacks-dev --authorization "$AUTH"
# focused admission has no GitHub mutation and cannot promote a contract
# preview and execute its repaired delivery plus downstream standing-role cases

pnpm eval:prepare -- --campaign candidate-qualification --github-owner buildstacks-dev --authorization "$AUTH"
# candidate GitHub and provider entrypoints refuse execution unless the same
# exact candidate has passed both admissions above
```

Pass `--authorization "$AUTH"` to the GitHub and live entrypoints as well.
Focused admission is fixed to quick `mixed-q1`, migration `mixed-d1`, approval
`mixed-da`, and standing-role `sre-1`, `support-1`, and `marketing-1`. It uses
the exact Phase 6 Builder, Reviewer, SRE, Support, and Marketing assignments,
the four-million-token deep ceiling, one typed infrastructure retry, the
unchanged `$8`, `$40`, `$40`, and `$30` per-case thresholds, and a `$118`
campaign ceiling. Promotion rejects all non-qualification campaigns even if
local files claim success.

The final candidate stops and writes `campaign-stop.json` on its first
terminal non-pass. Two failed full qualification descendants trip the lineage
loop breaker; do not begin a third without a new human decision. Learning
activation and the future 48-hour real-time soak remain separately authorized.

## Shipping discipline

Work in an isolated clean worktree. Review the entire diff and staged set;
exclude credentials, provider scratch, raw prompts/outputs/session logs, and
unrelated user changes. Run checks sequentially when they are resource-heavy,
and bound worker concurrency for subprocess/disk-heavy umbrella suites so the
test harness does not manufacture timeout flakes through self-contention.
A qualified release must match the frozen installable-package and executable-
suite hashes, or a tested evidence-only descendant attestation must prove the
equivalence. Push a focused branch, open a ready PR, wait for every required CI
check, repair causes without weakening gates, squash-merge, and synchronize the
primary checkout without disturbing protected local edits.

Phase 6 working-version completion is defined only by
[`docs/efficiency.md`](efficiency.md#phase-6-qualification-scope). The future
real-time soak is a distinct later campaign and broader organizational proof.
