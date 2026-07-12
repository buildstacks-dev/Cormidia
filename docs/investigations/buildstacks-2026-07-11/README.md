# buildstacks.dev Operon investigation — 2026-07-11

Status: evidence and design baseline complete; implementation pending.

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

The investigation has confirmed defects in auto-plan flag handling, supplied
checkout containment, cancellation ownership, terminal finalization, stale-run
analysis, usage durability, adapter readiness, and task/trace provenance. It
also identifies three product gaps: planning depth is not routed from task
risk/ambiguity/coupling, telemetry has no delegated parent-task or completion-
integrity model, and onboarding creates no durable authority charter.

No historical run envelope, event stream, worktree, or telemetry ledger has
been repaired. One caveat is recorded in [evidence.md](evidence.md): the
installed `operon learn report --json` command, although advertised as a read
operation, refreshed derived learning projections during reproduction. Those
derived writes are retained and timestamped rather than reverted.

The implementation order is intentionally bounded:

1. process ownership, cancellation, finalization, and checkout containment;
2. incremental usage checkpoints and stale-run analysis;
3. parent-task/pass provenance, artifact links, and completion integrity;
4. adaptive planning-depth routing;
5. delegated-operator charter onboarding and injection;
6. full Planner → Builder → Reviewer → human-merge-boundary acceptance.

Detailed evidence, finding records, designs, and acceptance criteria live in
the sibling documents in this folder.
