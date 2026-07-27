# Role invocations: turn lifecycle, worktrees, crash recovery

*The execution machinery around one role invocation — the journaled turn
lifecycle, org-managed clones and worktrees, crash recovery at artifact
boundaries, watchdogs, and the idempotency rules that keep a dead turn from
leaving the repo half-done. The loop that runs inside a turn is
[`design.md`](design.md); GitHub label/branch/PR conventions are
[`github-conventions.md`](github-conventions.md); the system map is
[`../architecture.md`](../architecture.md) §3.*




### One role invocation

```
dispatch → journal(assembling) → unresolved actor-retry check (`../approvals/design.md`)
        → worktree acquire
        → context assembly (`../architecture.md` §5)
        → journal(running)    → adapter.runTurn(req, {gate, onEvent})
        → journal(collecting) → collect artifacts, escalations, usage
        → telemetry append · scorecard events · memory-write check
        → journal(done | blocked_on_gate | failed) → release lock
```

The journal `state/turns/<turnId>.json` is written synchronously at every
phase transition — it is the crash-recovery source of truth:
`{turnId, role, app, trigger, phase, attempt, session?, worktree?, worktreeBranch?, ticketRef?, escalationIds?, errorCode?, recovery?, startedAt, updatedAt}`.

**Legacy role-invocation budget.** The adapter tracks running cost from SDK usage events;
crossing `max_turn_budget_usd` aborts the turn gracefully → status `failed`
with the exact `error_max_budget_usd` code and an incident note artifact
(roles.yaml: "overrun = incident note, not silent spend"). A standalone turn's
recovery evidence names its isolated path and branch, reports whether the worktree
is dirty, and gives a read-only inspection command. Operon does not automatically
stage or commit arbitrary provider output at this boundary. Episode route
admission and remaining-budget enforcement (`docs/episodes/contract.md`) are the
canonical ceilings; this adapter cap is a safety backstop, not a second route
budget.

### Worktrees

- Operon maintains its **own clone** per app at `repos/<app>` (fetch-only
sync with GitHub) and cuts worktrees from it under
`worktrees/<app>/<branch>`. It never touches the human's personal checkouts
of the same repos — GitHub is the only sync point between human and org.
Mutating git operations on that shared clone (fetch, worktree add/remove) are
serialized by a per-app clone lock (`withAppGitLock` in
`src/org/turn-runner.ts`), so two concurrent turns for the same app never
contend on `.git/index.lock` and corrupt the tree. That lock is a configuration
of the shared `FileLock` primitive (`src/runtime/file-lock.ts`): the lock file
carries a `pid`+`nonce` ownership token, release verifies the token before
unlinking (a late holder never deletes a successor's lock), and a proven-live
holder is never force-broken — a stale holder is reclaimed only when its pid is
dead or it has aged past the window, and a live holder held past the max wait
fails the waiter (typed busy, next tick retries) rather than running a second
`git reset --hard` on the same checkout.
- Loop items get branch `op/<issue>-<slug>` and keep the same worktree across
build → review → fix cycles; it is removed after merge/return. Explicit
standalone `run-role` turns get a collision-resistant `op/turn-<slug>-<hash>`
branch and durable worktree. Reusing the same invocation identity rediscovers
that worktree without resetting or deleting uncommitted work. Governed
scheduled/event routes retain their existing protocol-specific checkout policy.
- Standalone provider turns never run in `repos/<app>` itself. The managed clone
remains on its resolved remote default and clean while the isolated worktree may
retain inspected WIP after a failed turn.



### Crash recovery: artifact boundary first

A stale lock or interrupted tick reopens the accepted plan pointer and
`plan-execution-journal.json` before choosing work. The authority order is
`intent → plan version → derived route → ready step → terminal evidence`.
Within a legacy ticket-delivery step, the finer artifact boundaries remain
`contract → implementation → push → gates → pr → findings → approvals → merge
→ release`. A boundary is reused only while its recorded artifact fingerprint
is still valid. Ticket, commit, or finding drift creates a typed material event
and invalidates only future work; any resulting plan revision is forward-only.
A cap stop, cancellation, crash, or timeout retains the last valid artifact
refs and a typed resume decision.


**Restart clean** currently resets worktree scratch to the branch tip with
`git reset --hard && git clean -fd`. It may discard only scratch that has not
been accepted as a valid episode artifact. Commits, pushed refs, contracts,
findings, approvals, gate evidence, usage checkpoints, execution records, and
any other accepted artifact survive interruption. Repeating a productive pass
requires a durable invalidation reason tied to the artifact or decision it
invalidates. Claim, repair, review, retry, tool-call, active-time, provider-turn,
and cost bounds are plan-derived and policy-clamped, and remain in force across
process restarts.

A role invocation whose running pass exceeds its wall-clock cap is killed by
the dispatcher — SIGTERM escalating to SIGKILL. The pass executor derives its
effective watchdog from the smaller of its configured ceiling and the
episode's remaining active-time allowance in `docs/episodes/contract.md`.
Recovery (restart-clean + respawn) is **deferred until the process is
confirmed dead** (`killHungTurns` in `src/org/dispatch.ts`): a still-alive
child that also holds the per-app clone lock would otherwise let two workers
mutate one clone. If the pid refuses to die this tick, recovery waits for a
later one.

Inside a pass, the executor also owns a shorter adapter-start deadline
(default 30 seconds). The first adapter progress checkpoint or streamed event
proves startup; silence until the deadline aborts the same owned provider tree
and finalizes `failed(error_adapter_start_timeout)`, distinct from the full
turn wall-clock timeout. `operon doctor` uses separate bounded, non-billable
initialize/account/auth probes to catch missing binaries, transports,
credentials, and model configuration before an operator starts live work.

### Idempotency rules

These four rules are why a dead turn never leaves the repo half-done:

1. **Durable progress is explicit.** Git/GitHub operations remain the durable
  product effects: commit, push, PR create, label flip, review, comment, merge.
  Episode contracts, findings, approvals, gate evidence, usage checkpoints,
  and terminal records are also durable orchestration artifacts. Only
  unaccepted worktree/session scratch is disposable.
2. **Artifact before label.** State labels flip only *after* the artifact
  they announce exists (push branch → then `op:building`; open PR → then
   `op:in-review`). A restarted turn re-derives state from artifacts (`gh pr  list --head <branch>`), never trusts the label alone, and skips
   already-done steps.
3. **Claims are label flips.** The Builder claims a ticket by atomically
  swapping `op:ready → op:building`; a dispatcher that polls mid-claim sees
   a consistent state either way.
4. **Non-git writes are append-only and keyed by turnId** (telemetry JSONL,
  scorecard events, journal) — re-running collection dedupes on turnId.
   Whole-file operational state (journal, lock, schedule, consumed-event set,
   approval items) is written atomically via a tmp-file-plus-`rename`
   (`writeFileAtomic` in `src/org/atomic.ts`), so a crash mid-write never
   leaves a torn file a later tick would choke on.
