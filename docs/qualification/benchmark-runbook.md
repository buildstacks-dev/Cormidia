# Stage 7 benchmark runbook — the buildstacks-class bootstrap replay

The comparable benchmark required by PURPOSE's sandbox-before-production
rule (historical Stage 7 of the 2026-07-10 proportionality campaign).
Everything below is measured by Stage 1 telemetry; nothing is anecdotal.

**Status:** targets met 2026-07-11 by benchmark round 2; this runbook remains
the procedure for re-runs.

This historical Stage 7 procedure is no longer the qualification contract by
itself. New comparable campaigns use `docs/qualification/design.md` and `eval/README.md`:
predeclared ordered cases and repetitions, immutable attempts, hidden graders,
separate product/evaluator usage, explicit GitHub allowlists, and a read-only
qualifier. A Stage 7 replay remains useful evidence but cannot replace the
distribution or make a missing live case green.

Before any new comparable provider run, execute the token-free funnel
(`pnpm eval:validate`, `pnpm test:transformation`, and
`pnpm eval:deterministic`), prepare the exact campaign, and inspect the
`eval:github` and `eval:live` previews. When material adapter uncertainty
remains, calibration precedes product episodes. Platform-development authority
is defined separately in
[`docs/development.md`](../development.md): a matching standing objective grant may
cover repaired campaign descendants, but each manifest, attempt, cumulative
equivalent-cost ceiling, and zero-effect sandbox remains content-bound. A
repaired candidate receives at most one decisive fail-fast full qualification
campaign unless a genuine product defect materially changes it. Retained
adapter and focused-admission evidence may bound an evaluator-only repair
without exact-candidate repetition; such debt is disclosed, never converted
into a pass or promotion. This policy never becomes authority for an operated
org. L6 is not folded into an ordinary benchmark invocation:
`pnpm eval:soak -- --campaign <prepared-file>` previews the separately
authorized 48–72 hour runner, its useful-turn cap, and restart protocol.

## Proportionate release evidence

Evaluation reduces material release risk; it is not an obligation to generate
an infinite proof cascade. A genuine product defect, safety-boundary failure,
provider-settlement or accounting mismatch, learning-integrity failure, build,
typecheck, core-test or required-CI failure, or campaign budget-ceiling breach
blocks release. Do not weaken a product contract, grader, hidden threshold,
provider assignment, safety rule, accounting invariant, or CI check to pass.

Evaluator-only false positives, redundant exact-candidate admission demands,
report or metadata defects, transient eval infrastructure failures with
preserved evidence, and missing repetition whose risk is already bounded by
deterministic tests and retained live evidence are non-blocking release debt.
Retain the original result exactly, add a focused deterministic regression when
inexpensive, and disclose the debt. Do not rescore, overwrite, relabel, conceal,
or promote from unsupported evidence, and do not recursively restart adapter,
focused-admission, and full-candidate campaigns for evaluator-only defects.
Real pre-V1 products may ship with bounded, disclosed eval debt.

Each repaired candidate gets at most one decisive full qualification campaign.
If it qualifies, use that evidence. If it exposes a genuine material defect,
repair the product and treat the materially changed candidate as a new release
decision. If it stops only on an evaluator defect, preserve the non-qualified
campaign, record the bounded debt, and continue release validation without a
merit retry or another provider campaign. Every release report and PR names the
residual debt explicitly.

Phase 5 adds a separate token-free release gate before any L6 authorization:
the production-backed seven-day virtual soak under temporary homes and an
injected scheduler manager. It must report complete due/reason counts, zero
duplicate decisions/episodes and orphaned state, zero mechanical provider
construction, exact provider-turn/settlement agreement, at least one durable
restart, and byte-stable replay. This evidence promotes only deterministic
`I-INSTALL`/`I-SOAK` contracts. It cannot promote provider standing-role or
real-time-soak contracts. See [`docs/scheduler/design.md`](../scheduler/design.md).

Phase 6 promotion is also a separate token-free gate after execution. Archive
the immutable campaign externally, import only its sanitized promotion slice,
attest that package and executable-suite bytes still match the exact candidate,
and generate contract-specific projections. The harness rejects foreign or
stale campaigns, missing/duplicate repetitions, malformed or missing
measurements, failed graders, archive/GitHub receipt drift, and settlement or
route-admission mismatch. Candidate qualification may promote only the nine
current Phase 6 provider contracts. The separately authorized future L6
archive remains the only route to `I-LIVE-01`; candidate qualification,
virtual-soak evidence, and production confirmation cannot promote it. It is
outside the current Phase 6 strict gate, not passed. See the canonical scope
boundary in [`design.md`](design.md#phase-6-qualification-scope).

Candidate qualification has a third, independent boundary after L5. The
learning block applies its content-hashed T1 procedure only to treatment arms
and computes the AB/BA/AB outcome from retained provider artifacts plus hidden
guardrails. If and only if the measured outcome is improved, preview
`pnpm eval:learning-activation -- --campaign <prepared-file>`. The preview
reports the exact learning-candidate and action hashes. Execution requires a
separate human authorization for both hashes and uses
`OPERON_EVAL_LEARNING_ACTIVATION=1` with `--execute`, `--confirm-campaign`,
`--confirm-candidate`, and `--confirm-action`. It spends no provider tokens,
touches no production path, and performs exactly one isolated governed
activation followed by rollback. Never infer this authorization from L5.

The first Phase 6 candidate campaign is retained as `invalid`, not as a trial
run to erase: 11 attempts passed, eight were product misses, three were
infrastructure-invalid, and the remainder was incomplete after unavailable
provider token totals exposed a fail-closed harness defect. Its immutable
qualifier and archive are recorded in
`research/evals/2026-07-15-phase6-candidate-qualification-invalid.md`. A fresh
campaign must use a fresh content identity; the old results cannot be retried,
relabelled, or copied into promotion evidence.

The later pi-on-Codex adapter campaign qualified, but its dependent candidate
is also permanently `invalid`: 24 passes, two deep product misses, two
continuation infrastructure-invalid attempts, and six learning harness
errors. The deep actors changed pinned package scripts, continuation cancelled
before Codex emitted usage, and the fully network-dark learning case selected
a loopback-bearing broad test. The retained evidence, exact accounting,
archives, and fail-closed corrections are recorded in
`research/evals/2026-07-15-phase6-pi-codex-candidate-invalid.md`. Those
corrections change covered bytes and therefore require fresh adapter and
candidate identities; the old campaign is never resumed.

The next scope-split adapter campaign qualified all three adapters, but its
dependent candidate is retained as a third `invalid` proof: 31 passes, one
context safety stop, one deep product miss, and one learning product miss.
All 71 provider turns equal 71 settlements, the virtual soak contributed
2,016 mechanical steps and zero settlements, and product/evaluator equivalent
costs were $68.12762825/$7.1732735. The gate correctly stopped deploy-bearing
safety prose embedded in a shell check; a pass-scoped contract-authoring ban
was incorrectly carried into implementation; and one learning artifact
annotated otherwise-correct class identifiers. The exact retained evidence,
archive, and corrections are recorded in
`research/evals/2026-07-15-phase6-scope-split-candidate-invalid.md`. Covered
bytes changed again, so both fresh campaign identities require new previews
and authorization.

The latest retained candidate is the 2026-07-16 review-boundary campaign: 32
of 34 attempts passed. Migration `mixed-d1` and approval `mixed-da` each passed
the visible and hidden product checks, but independent reviewer shell probes
correctly crossed unchanged auth/protocol gates. Paired learning was complete
but inconclusive at `+1,+2,0`. The correction restricts reviewers to file-read
inspection plus path-free structural Git commands, focuses live admission on
the two failed cases, and stops final execution immediately after any terminal
miss or non-improved learning aggregate. Its exact accounting and archive
hashes are in
`research/evals/2026-07-16-phase6-review-boundary-candidate-invalid.md`.

The next fail-fast candidate passed 14 attempts—planning, context delta, and
all five clean deliveries—before quick `mixed-q1` exposed fixed per-turn budget
slices that did not carry unused capacity forward under the unchanged $8 case
ceiling. Only that episode was terminal; 19 later repetitions did not run. The
repair allocates remaining case capacity across remaining declared turns and
adds quick `mixed-q1` to focused admission ahead of the two review-boundary
cases. Exact accounting and archive identity are in
`research/evals/2026-07-16-phase6-budget-carry-candidate-not-qualified.md`.

The next candidate passed every one of its 30 executed attempts and stopped
after the paired-learning block, before the virtual soak and standing roles,
because the third treatment was reported as a tie. The artifact was explicitly
causal and independently approved, but the deterministic lexical verifier
recognized `cause` and not the ordinary inflection `causing`, assigning 1/2 to
that component. The original campaign remains invalid. The repair recognizes
ordinary causal morphology, pins the exact artifact as a token-free regression,
and adds the three previously unrun standing roles to focused provider
admission without adding another six-arm learning sample. Exact evidence is in
`research/evals/2026-07-16-phase6-learning-scorer-candidate-invalid.md`.

The corrected-scorer candidate then passed 19 cases before deep migration
`mixed-d1` stopped fail-fast. Codex attempted every declared executable check,
but App Server's approval callback wrapped each one as `/bin/zsh -lc ...` and
eval actor isolation mistook the transport launcher for an actor-selected
outside-worktree path. The harness-owned visible command later exposed one
provider-authored failing test; the merit miss remains immutable. The repair
normalizes only the exact shell launcher while retaining and adversarially
checking the full inner command. Exact accounting, archive identity, and the
retained rejection text are in
`research/evals/2026-07-16-phase6-codex-shell-wrapper-candidate-not-qualified.md`.

## Targets (vs the 2026-07-10 episode)

| Metric | Episode | Target | Measured by |
| --- | --- | --- | --- |
| Passes for the milestone | 55 | ≤ 8 | `operon telemetry --app <bench>` |
| Estimated spend | $266 | ≤ $40 | `operon budget` / telemetry totals |
| Human decisions | 42+ | ≤ 5 | `operon approvals` log + park digests |
| Wall clock (active) | ~7.5 h | ≤ 90 min | telemetry trace timings |
| Merged to `main` | 0 | 1 PR, gates green, declared release disposition executed | GitHub + ship gate |

The seed's product doc declares the first milestone's release disposition
as *intentionally ends at merge*, so disposition execution = the merge
itself (the A4 release handoff — `release:` block, ship-gate P7, deploy
trigger behind the approval queue — landed as PR #13; a merge-only
milestone exercises none of it by design).

## Procedure (one clean run)

```bash
# 0. Fresh, fully isolated org — "clean" means no existing branch, PR,
#    dependency cache, worktree, ledger, or approval state.
operon org init ~/Build/bench-org --name Bench-Org

# 1. Disposable seeded repo (idempotent; force-resets to the pinned seed).
GH_BENCH_REPO=<owner>/operon-bench-$(date +%Y%m%d) \
  bash scripts/seed-benchmark-repo.sh

# 2. Clone locally and onboard (answers file keeps it non-interactive).
git clone https://github.com/<owner>/operon-bench-<date>.git ~/Build/operon-bench
operon bootstrap ~/Build/operon-bench --answers <answers.json>
#    Register the app in ~/Build/bench-org/apps.yaml (status: onboarding,
#    budget_usd_month: 50) — proposal etiquette applies to the org repo.

# 3. Stage 4 exit criterion + benchmark first half: one non-interactive
#    planning turn; the orchestrator publishes a validated 1-3 ticket plan.
operon plan operon-bench --auto --goal "Meridian: the founder's personal site (see docs/product.md)"
#    Expect: exit 0, 1-3 tickets, at least one op:ready, canonical labels.

# 4. The loop, to merge. --allow-network because the scaffold installs deps.
operon loop --app operon-bench --once --allow-network
#    Repeat --once ticks until the ticket merges (or use --follow. Stage 2
#    continuation means interrupted ticks resume from artifacts; Stage 3
#    preflight/honest-stop means environment problems cost $0 and stopped
#    turns re-arm themselves, bounded by the claim cap).

# 5. Measure.
operon telemetry --app operon-bench --html bench-report.html
operon budget
operon approvals   # decision count; expect ≤ 5, ideally 0-1
```

## Rules

- No manual label surgery, no manual requeues, no editing agent output: the
  human's only allowed touches are approval decisions (counted) and the
  commands above.
- A missed target is not massaged — it becomes the next round of
  efficiency work under `docs/episodes/contract.md`.
- No attempt is deleted or replaced. A typed infrastructure retry links to the
  original; merit failures are never rerun under the same attempt id.
- Production is read-only confirmation and never threshold/prompt calibration.
- Only after the sandbox meets the targets does buildstacks.dev re-enter as
  the production confirmation (its frozen state gets its disposition then:
  merge or close PR #23, re-plan tickets #3–#20, prune the worktree).
  Report that separately — it inherits existing artifacts.

## Live checks that ride along with the first run

- `pnpm test:live` — adapter conformance re-run (Stage 3 added
  `TurnResult.errorCode`; the suite must stay green on live turns), with a
  dated note in `research/`.
- PR #8 (Stage 4) merged 2026-07-10 on exactly this step-3 live pass —
  the plan run IS its exit criterion. Benchmark rounds and their analyses
  remain in git history from the 2026-07-10 proportionality campaign.
