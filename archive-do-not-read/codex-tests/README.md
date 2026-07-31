# Operon validation harness

This is the isolated `parallel-greenfield` validation package for the Operon
product. It is additive and local: it does not replace, redirect, inspect for
intent, or modify the incumbent `test/` or `eval/` harnesses.

## Local controlled foundation

```sh
pnpm -C codex-tests install --frozen-lockfile
pnpm -C codex-tests run validate:local
```

The aggregate runs strict type checking and the non-spending controlled
foundation across Layers 1–5. Machine evidence is written only to
`codex-tests/.artifacts/local-validation/`.

The current result is intentionally red: 72/74 assertions pass. The two
failures are the tracked product defects `TM-002` (a repository-controlled
`.pi` symlink can redirect authority-bearing masked context outside the
worktree) and `TM-011` (concurrent approve/deny calls can leave contradictory
decision and grant state). Production was not changed and neither failure was
waived. Structured-evidence integrity and generated-output confinement both
pass.

Even a future passing local result is deliberately not a
production-qualification claim.
The manifest keeps the real disposable-target smoke, a passing model/harness
qualification, judge meta-evaluation, 72-hour
real-time soak, additive CI, comprehensive catalog, threat review, and full
disaster-recovery work visibly blocking-absent. The full walking-skeleton gate
therefore remains closed.

Current claim-to-detector coverage is recorded in
[`traceability-report.md`](./traceability-report.md); exact remaining
human/external hard stops are recorded in
[`residual-blocking-report.md`](./residual-blocking-report.md).

The local aggregate command does not authorize a provider, GitHub mutation,
scheduler installation, deployment, publication, registry operation, or CI
change. The content-bound provider exception and its result are below.
Incumbent equivalence, replacement, migration, and cutover remain outside this
campaign.

## Episode Planner campaign result

The human authorized `OPERON-L4-001` on 2026-07-30:

- 10 frozen cases × 3 runs;
- `claude/claude-opus-5/xhigh`;
- 27/30 overall, at least 2/3 for every case, and 3/3 for critical cases;
- USD 5 per native provider turn and USD 60 aggregate; and
- no qualification on failure, with current production assignment and all
  evidence preserved.

The runner invokes the production Episode Planner path, confines its work and
evidence to `codex-tests/.artifacts/layer-4/OPERON-L4-001/`, reserves spend
before each native turn, and stops fail-closed on unknown usage or exhausted
authorization. The known `TM-002` deterministic defect means this campaign
cannot issue a qualification while that gate remains red, even if its
statistical score passes.

The host-authenticated campaign ran on 2026-07-30 and stopped as designed
after 9/30 attempts when `OPERON-EP-003` repetition 3 failed the production
EpisodePlan contract after its one bounded repair:

- attempts 1–6 were acceptable;
- `OPERON-EP-003` repetition 1 was contract-valid but selected
  `review/verify` instead of the required `review/security`;
- repetition 2 was acceptable after bounded repair;
- repetition 3 first emitted invalid `supersedes: null`, then repaired to
  non-JSON containing JavaScript `undefined`;
- observed spend was USD 4.219405, with zero outstanding reservation and no
  ceiling violation; and
- qualification is `blocked_contract`; the current production assignment,
  protected prompt, and frozen corpus were preserved.

The original failed-attempt report incorrectly recorded `planner_attempts: 0`.
Its two settled budget-turn records prove the correct count is 2. The original
evidence was not rewritten; `campaign-evidence-audit.json` contains the
append-only correction and integrity checks. The runner now derives failed
attempt counts from durable budget evidence, with a regression test.

Do not rerun this failed campaign as though it were a fresh qualification.
Any prompt, model, schema, harness, or rubric follow-up requires a separately
versioned campaign and authorization.

## `OPERON-L4-002` diagnostic and qualification results

The human separately authorized the prepared `OPERON-L4-002` diagnostic:
`OPERON-EP-003` × 3, `claude/claude-opus-5/xhigh`, USD 5 per turn, USD 10
aggregate, no qualification, and evidence preservation on failure. The
package in `campaigns/OPERON-L4-002/` contains:

- a hash-bound evaluation-only prompt overlay addressing strict JSON optional
  fields, bounded-repair output, and security-specific operation choice;
- Layer-1 deposits for the observed `supersedes: null` and JavaScript
  `undefined` contract failures;
- a Layer-4 scorer deposit proving that frozen case `OPERON-EP-003` rejects
  `review/verify` and accepts `review/security`; and
- a preparation-only preflight that verifies the protected prompt, frozen
  corpus, parent audit, and original evidence hashes.

The host-authenticated diagnostic ran on 2026-07-30 through the production
Episode Planner call path:

- all three outputs passed the deterministic EpisodePlan contract;
- all three passed the frozen `OPERON-EP-003` quality oracle;
- every run selected `build/implement` plus `review/security` and omitted
  inapplicable `assignment` and `supersedes` fields in raw provider JSON;
- every run completed in one native turn;
- observed spend was USD 1.224494, with zero outstanding reservation,
  unmeasured usage, or ceiling violation; and
- the evidence audit passed all 11 integrity checks.

The human then separately authorized the unchanged candidate's full 10 × 3
qualification at the existing floors, USD 5 per turn and USD 60 aggregate.
All 30 deterministic contracts passed and 29/30 attempts met the quality
oracle, but critical case `OPERON-EP-004` scored 2/3 against its 3/3 floor.
Repetition 1 added an unnecessary release gate and exceeded the six-step
ceiling. The terminal result is `blocked_quality`; no qualification issued.

Full-stage spend settled at USD 12.881382 across 32 provider turns with no
unknown usage, outstanding reservation, ceiling violation, tool call, or
external effect. The protected prompt, production assignment, frozen corpus,
and incumbent harness were unchanged.

The append-only audit also found that the immutable spend ledger embedded
parent ID `OPERON-L4-001` instead of `OPERON-L4-002`. The correct USD 60/USD 5
limits and all turn bindings were enforced, but clean campaign attribution
failed. Evidence was preserved unchanged; `CampaignBudgetStore` now requires
explicit identity and detector `OPERON-L4-002-DET-003` prevents recurrence.
Any rerun or changed candidate requires a new authorization.

## `OPERON-L4-003` through `OPERON-L4-005` results

The human delegated bounded provider-budget decisions. Codex retained the
existing USD 5 per-turn, USD 10 diagnostic, and USD 60 full-stage ceilings
and ran three new versioned candidates without changing the protected prompt,
production assignment, frozen corpus, or external state:

- `OPERON-L4-003`: EP004 diagnostic passed 3/3; full stage stopped at 9/30
  when EP003-r3 repair omitted the required `gate` discriminator. Diagnostic
  and full spend were USD 1.343245 and USD 3.838934.
- `OPERON-L4-004`: EP003 diagnostic passed 3/3; full stage stopped at 10/30
  when EP004-r1 repair fabricated initial-plan self-supersession. Diagnostic
  and full spend were USD 1.398425 and USD 4.235953.
- `OPERON-L4-005`: EP004 diagnostic passed 3/3; full stage stopped at 7/30
  when EP003-r1 emitted JavaScript `undefined` and repaired it into the same
  forbidden self-supersession class. Diagnostic and full spend were USD
  1.316712 and USD 3.183568.

Every stage retained raw outputs and fully settled ledgers. All independent
post-run audits passed their evidence checks; no tool/external-effect event or
protected-surface change occurred. No candidate qualified.

The missing-gate, campaign-identity, and initial-plan-supersession defects have
deterministic regression deposits. L4-005’s two failure classes were already
covered, so no duplicate detector was added. Further stochastic reruns are
not justified: a new campaign should begin only with a materially different
candidate or harness design.

This scoped provider authorization does not authorize tools, external effects,
GitHub mutation, scheduler installation, CI changes, production assignment
edits, deployment, publication, or incumbent cutover.
