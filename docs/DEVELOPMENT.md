# Building and maintaining Operon

This is the canonical developer-lifecycle policy for the Operon platform.
It applies to humans and coding agents changing this repository. It does not
grant authority to, configure, or become context for an Operon-operated org.

Three terms carry this document. A **campaign** is one predeclared batch of
evaluation runs against a pinned build: the cases, repetition counts,
budgets, and stop rules are all declared before the first model call, and
the results are immutable once recorded. An **episode** is one end-to-end
unit of org work — one outcome, one route. A **provider turn** is a single
call into a model adapter, settled into the cost ledger exactly once. The
normative definitions live in `docs/episodes/contract.md` → Normative
identities and `docs/qualification/design.md` → Campaign and result
semantics.

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

Root `AGENTS.md`, this guide, `docs/PURPOSE.md`, `docs/episodes/contract.md`,
`docs/qualification/design.md`, `eval/**`,
`scripts/eval/**`, and `test/**` are developer-only surfaces and are excluded
from the npm package. The packaged `agent-skills/operon/` skill is deliberately
an org-operation guide. `TASTE.md`, `roles.yaml`, `pipelines.yaml`, and
`prompts/**` remain org-runtime surfaces; do not put developer authority in
them. `test/development-boundary.test.ts` pins this packaging separation.

## One objective, bounded autonomy

A human authorizes a development objective **once**, and that one
authorization covers the ordinary work of reaching it: investigation, code
and doc changes, token-free tests, small focused campaigns, repaired
candidates, disposable eval repos on GitHub, final qualification, evidence
handling, the PR, CI repair, and shipping. There is no re-approval loop for
each step. When the candidate commit changes, the *evidence* tied to the old
commit expires — the objective's authority does not.

The authorization is written down as a standing grant, and every campaign
binds that grant into its immutable manifest. The grant names the objective,
the repair lineage it covers, which campaign types it allows, the private
GitHub namespace, the billing mode, a cumulative spend ceiling, and the
promise of zero outward effects. The `OPERON_EVAL_LIVE=1` switch and the
exact `--confirm <campaign-id>` are accident guards the developer supplies —
two keys against running the wrong thing — not repeated requests for human
approval.

Spend is counted in **equivalent USD** even when billing is
subscription-backed. It is a loop detector, not an invoice: the circuit
breaker adds up the grant's whole history — including failed attempts and
typed retries — and stops before the ceiling. Never drop or overwrite an
attempt to win back headroom.

## Proportionate release evidence

Evaluation exists to reduce real product risk, not to prove things forever.
Failures split into two categories. **Release blockers** are defects in the
thing being shipped: product behavior, safety boundaries, provider
settlement and accounting errors, learning-integrity failures, broken
builds, typechecks, core tests, required CI, and blown campaign budget
ceilings. **Release debt** is a failure of the *evaluator* rather than the
product: a grader's false positive, a demand to re-prove a candidate whose
risk existing evidence already bounds, defects in reports or metadata, a
transient infrastructure failure that was properly preserved, and plain
unnecessary repetition. Blockers stop the release; debt ships — bounded,
disclosed, and on the record.

Debt stays immutable and visible. Never rescore, overwrite, relabel,
conceal, or promote a failed campaign — and never make a red result green by
weakening the product, graders, thresholds, assignments, accounting, safety,
learning rules, or CI. When deterministic regression tests and earlier live
evidence already bound the risk, an evaluator-only failure does not restart
the whole adapter → focused → full campaign cascade: one repaired candidate
gets at most one decisive full qualification campaign, unless a genuine
product defect materially changes it. A pre-V1 release may ship with
bounded, disclosed evaluator debt.

Go back to the human only for a genuinely new decision:

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
- a second full campaign for the same repaired candidate without a genuine
  product defect that materially changes it.

## Incremental development ladder

Use the cheapest evidence that can disprove the change, in this order:

1. Preserve the first failure and classify its genuine cause: product, test,
   harness, provider/account, GitHub, safety, measurement, or environment.
2. Reproduce it with the smallest deterministic test. Add an adversarial
   near-miss so the boundary cannot regress.
3. Run the relevant focused token-free suites. Do not start a broad provider
   campaign to discover a failure a local test can expose.
4. If model behavior is the remaining uncertainty and retained evidence does
   not already bound it, run a non-promotable focused provider-admission
   campaign for only the repaired cases and any
   downstream provider cases a prior fail-fast run deliberately did not reach.
   It must use the same exact candidate, assignments, thresholds, graders, and
   safety boundaries as final qualification.
5. Admit adapters for that exact candidate only where a material adapter risk
   remains. An evaluator-only repair does not invalidate otherwise applicable
   retained adapter evidence merely because the commit identity changed.
6. Run at most one decisive full qualification for the repaired candidate.
   Stop immediately after the first terminal failure because the campaign can
   no longer qualify; retain later cases as deliberately unrun. A terminal
   evaluator-only defect becomes disclosed release debt, not authority for a
   recursive admission/full rerun cascade.
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

## The active development grant

Standing development authorizations live under
`eval/development-authorizations/`; the YAML for the current objective is the
single authority for its repair lineage, billing mode, cumulative
equivalent-cost ceiling, GitHub namespace, and zero-effect boundary. This
policy deliberately embeds no grant's dated path, dollar ceiling, candidate
hash, or command sequence — when a campaign ends, the grant file is retired
in place and this file does not change. Execution semantics for campaigns
under a standing grant (accident guards, readiness, confirmation, and the
thresholds they cannot alter) are
[`docs/qualification/design.md`](qualification/design.md) → Development
qualification execution; entrypoint usage is `eval/README.md`.

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
[`docs/qualification/design.md`](qualification/design.md#phase-6-qualification-scope). The future
real-time soak is a distinct later campaign and broader organizational proof.
