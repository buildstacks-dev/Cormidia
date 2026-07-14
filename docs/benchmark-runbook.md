# Stage 7 benchmark runbook — the buildstacks-class bootstrap replay

The comparable benchmark required by PURPOSE's sandbox-before-production
rule and `docs/proportionality-review.md` §5 Stage 7. Everything below is
measured by the Stage 1 telemetry; nothing is anecdotal.

**Status:** targets met 2026-07-11 by benchmark round 2 (results recorded
in `docs/proportionality-review.md` §7); this runbook remains the
procedure for re-runs.

This historical Stage 7 procedure is no longer the qualification contract by
itself. New comparable campaigns use `docs/efficiency.md` and `eval/README.md`:
predeclared ordered cases and repetitions, immutable attempts, hidden graders,
separate product/evaluator usage, explicit GitHub allowlists, and a read-only
qualifier. A Stage 7 replay remains useful evidence but cannot replace the
distribution or make a missing live case green.

Before any new comparable provider run, execute the token-free funnel
(`pnpm eval:validate`, `pnpm test:transformation`, and
`pnpm eval:deterministic`), prepare the exact campaign, and inspect the
`eval:github` and `eval:live` previews. Adapter calibration precedes product
episodes. L6 is not folded into an ordinary benchmark invocation:
`pnpm eval:soak -- --campaign <prepared-file>` previews the separately
authorized 48–72 hour runner, its useful-turn cap, and restart protocol.

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
  `docs/proportionality-review.md`.
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
  are recorded in `docs/proportionality-review.md` §7.
