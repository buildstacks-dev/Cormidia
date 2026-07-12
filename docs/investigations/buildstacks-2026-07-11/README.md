# buildstacks.dev Operon investigation — 2026-07-11

Status: investigation complete; bounded fixes implemented and verified.

The July 11 run produced a working buildstacks.dev v1, but it did not complete
through Operon end to end. Operon completed five of nine persisted passes. Four
passes remained permanently `running`; two planning traces stopped before a
plan of record; the Builder implement pass continued after its parent command
was stopped and wrote 31 untracked files in an Operon-managed worktree based on
stale `origin/main`; no Operon Reviewer pass ran. The outer Codex task then
implemented all three manually created tickets in its operator-owned checkout,
opened PR #29, and performed a manual review.

The telemetry total of `$10.1437515` is the sum of finalized pass records, not
a complete-spend assertion. It excludes every interrupted turn whose usage
never reached a terminal provider result. The report labels those records as
`$0.00`, which is materially misleading because their session logs and
worktree effects prove model/tool activity.

The investigation confirmed defects in auto-plan flag handling, supplied
checkout containment, cancellation ownership, terminal finalization, stale-run
analysis, usage durability, adapter readiness, learning projection/report
semantics, and task/trace provenance. It also confirmed three product gaps:
planning depth was ceremony-driven, telemetry had no delegated parent-task or
completion-integrity model, and onboarding created no durable authority
charter. All are implemented in the commits recorded below.

No historical run envelope, event stream, worktree, or telemetry ledger has
been repaired. One caveat is recorded in [evidence.md](evidence.md): the
installed `operon learn report --json` command, although advertised as a read
operation, refreshed derived learning projections during reproduction. Those
derived writes are retained and timestamped rather than reverted.

The implementation landed in bounded commits:

1. `0625c32` — process ownership, cancellation, terminal finalization,
   incremental usage checkpoints, and checkout containment;
2. `421e7cc` — stale-run/missing-finalization analysis;
3. `8c237a2`, `20fafc5`, `4fa4ac5` — pass/parent provenance, evidence links,
   completion integrity, fallback lineage, and pre-ticket presentation;
4. `3c631cb` — adaptive quick/standard/deep planning and legacy route support;
5. `c27523e` — durable delegated-operator charter onboarding and injection;
6. `0cf17e0`, `9f0e945` — missing learning-projection recovery and read-only
   default reports;
7. `b7385db` — non-billable adapter readiness probes and a separate adapter-
   start deadline;
8. `a4a6559` — composed Planner → Builder → Reviewer → human-merge-boundary
   acceptance.

## Final conclusions

- The incident was not one isolated adapter failure. It was a compound control-
  plane failure: caller/process ownership was ambiguous, operator checkouts
  were not distinguished from managed clones, usage was terminal-only, and
  pass-centric telemetry could not express that the outer task fell back to
  manual work and skipped Reviewer.
- The historical `$10.1437515` remains **finalized recorded cost**, not actual
  spend. The four interrupted turns have unknowable historical cost because no
  checkpoint existed at the time. New turns checkpoint cumulative usage and
  mark cancellation as partial or unavailable rather than exact zero.
- Historical envelopes remain `running` by preservation policy. The installed
  `operon analyze` now flags all four as both `stale_running` and
  `missing_finalization`; future owned cancellation/timeout paths finalize
  terminally.
- Supplied planning and loop checkouts are immutable inputs. Operon snapshots
  their captured commit into its own trace/ticket worktrees and never silently
  changes the source branch or HEAD.
- A product outcome and Operon integrity are now separate statements. Manual
  fallback, missing selected passes, or Reviewer bypass prevents an Operon
  end-to-end-complete claim. A fully recorded Operon flow may truthfully stop
  at an open, approved PR awaiting the configured human merge boundary.
- Planning is now routed from risk, ambiguity, coupling, reversibility,
  outward consequence, and decomposition size. Prompt length is not a factor;
  short auth/migration/deploy work is forced deep.
- New orgs receive a versioned delegated-operator charter by default;
  conservative/custom profiles and app narrowing fail closed, while critical-
  operation approvals remain mechanically unchanged.

## Verification summary

`pnpm test` passes 1,034 tests in 108 files; typecheck, build, neutral onboarding
smoke, and `npm pack --dry-run` pass. All four sandbox app suites and their
required lint/role smokes pass. Installed token-free bootstrap/plan/loop smokes
preserved every sandbox checkout. Real configured-runtime Doctor probes report
Claude and Codex ready without a model prompt. The disposable live GitHub E2E
was not run because `GH_SANDBOX_REPO` is unset; the offline real-git/fake-
provider acceptance covers the full lifecycle to the human merge boundary.

The regenerated report is
`/private/tmp/buildstacks-operon-telemetry-2026-07-11-improved.html` with an
adjacent 41-file evidence bundle. It truthfully reports the historical run as
incomplete/unknown where legacy evidence cannot prove more: four interrupted
runs, unavailable cost completeness, missing Reviewer, no recorded parent task,
and unverified PR state.

Detailed evidence, finding records, designs, and acceptance criteria live in
the sibling documents in this folder.
