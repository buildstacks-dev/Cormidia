# Regression and end-to-end acceptance criteria

## Lifecycle and cancellation

- A runtime receives one abort signal on SIGINT, SIGTERM, explicit cancel, and
  timeout; cancellation is idempotent.
- A fake provider with a grandchild process leaves no living descendant after
  CLI cancellation and the grace period.
- A cancelled parallel stage cancels every sibling and starts no next stage.
- Envelopes finalize once as `cancelled` or `timed_out`, with end time,
  duration, initiator, reason, last heartbeat, and last provider event.
- A provider that ignores abort is forcibly closed and still cannot keep the
  Node process alive.

## Usage and cost

- Token update → tool write → cancellation preserves the last cumulative
  checkpoint and settles it once as `partial`.
- Cancellation before observable usage reports `unavailable`, not `$0.00`.
- A completed provider-reported cost is `complete`; a completed locally priced
  Codex cost is `estimated`; totals expose coverage by quality.
- Reconciliation after a crash is idempotent and cannot double-count a
  checkpoint or terminal record.

## Checkout/worktree containment

- Auto-plan with `--workdir` uses that exact commit as input and never changes
  branch, HEAD, index, tracked modifications, or untracked files.
- Loop with `--repo-dir` preserves the supplied checkout and creates an
  isolated ticket worktree from the captured commit.
- Managed clones may fetch/reset only when explicitly identified as managed.
- Two planning traces receive distinct worktrees/artifact namespaces.
- Cancellation leaves evidence in the isolated worktree without touching the
  source checkout.

## Command semantics and readiness

- `plan --auto --dry-run` constructs no runtime/GitHub writer, spends no
  tokens, writes no envelope/ledger/learning data, and prints depth/cost/skips.
- Existing orgs without a compatible planning pipeline get an actionable
  preflight/migration result before any provider starts.
- Doctor readiness probes are bounded, non-billable, and distinguish missing
  binary, socket failure, auth failure, timeout, and ready.
- Adapter first-event timeout is separate from the total pass timeout.
- Default `learn report` changes no file hash; an explicit refresh recovers
  atomically from a crash between event and cursor writes.

## Telemetry and provenance

- Parent task preserves the exact redacted prompt artifact, native task URI,
  objective/completion criteria, repo state, authority hash, and fallback mode.
- Trace records show causal parent, selected depth, factor rationale, expected
  stages, skipped stages, heartbeat, terminal outcome, and artifacts.
- Pass rows show runtime/model/effort together, prompt/output/event/activity
  links, native session URI, workdir/branch/HEAD, usage quality, and terminal
  reason.
- The evidence bundle contains only redacted relative artifacts and every link
  resolves from the HTML report location.
- A tool-only session log is labeled activity log; transcript availability is
  explicit.

## Planning

- Quick: low-risk, reversible, low-ambiguity/coupling, one-to-two-ticket task
  selects the combined planner/decomposer only.
- Standard: moderate ambiguity/dependencies selects visionary plus one
  PM/decomposer; no competition without a recorded trigger.
- Deep: security, auth, migration, release, infrastructure/DNS, destructive or
  irreversible work selects the full competing-PM route even for a short prompt.
- A long but explicit low-risk task is not promoted solely due to length.
- Routing, skipped passes, policy version, and pre-execution cost estimate are
  durable before the first provider call.
- Intermediate artifacts without a validated/published plan yield
  `incomplete — no plan of record`.

## Authority charter

- Org init supports conservative, delegated-operator, and custom profiles and
  previews automatic versus human-gated actions.
- Existing AGENTS.md/CLAUDE.md content is preserved byte-for-byte outside one
  idempotent managed block.
- App policy/current instructions can narrow but cannot expand the org grant.
- Every runtime context, brief, parent task, and envelope carries the resolved
  source/version/hash.
- The broadest charter still queues/denies deploy, publication, secrets,
  cloud/DNS/infrastructure, destructive data loss, required-human merge, and
  protocol self-edit operations.

## Completion integrity end to end

- Planner publishes a plan of record; Builder produces the implementation;
  mechanical CI/gates are independently recorded; Operon Reviewer reviews the
  exact PR HEAD; human merge remains pending when required.
- CI green without an Operon review renders `awaiting Operon review`.
- Manual implementation or review sets parent execution mode to `mixed` and
  prevents `Operon end-to-end complete`.
- An open PR with `Closes #26/#27/#28` reports those issues as “will close on
  merge,” not closed.
- Merge updates PR/issues to merged/closed and only then satisfies the final
  lifecycle state.
