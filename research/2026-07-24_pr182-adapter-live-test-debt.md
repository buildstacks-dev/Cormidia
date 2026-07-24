# PR #182 — adapter live-conformance debt at merge

Date: 2026-07-24 (America/Los_Angeles)
Decision owner: human operator. Recorded by the reviewing agent at merge time.

## What was waived

`AGENTS.md` → Testing expectations requires, for any change under
`src/runtime/adapters/**`:

> + `pnpm test:live` + dated `research/` record

PR #182 changes both production adapters:

- `src/runtime/adapters/codex.ts` — `sandboxPolicy.writableRoots` now resolves a
  linked worktree's Git paths instead of `[req.workdir]`.
- `src/runtime/adapters/claude.ts` — `sandbox.filesystem.allowWrite` likewise.

`pnpm test:live` was **not** satisfied. It was run once and stopped at its
authentication/opt-in gate before executing any provider conformance case:
Claude reported `Not logged in`; Codex and pi live tests were disabled by their
explicit opt-in environment variables. That result is recorded in
`research/2026-07-23_issue-179-linked-worktree-sandbox.md`, which states
plainly: "This is environment/auth qualification debt, not a passing live
adapter claim."

The human operator elected to merge as a unit on offline evidence and carry the
debt rather than block on interactive re-authentication.

## What offline evidence does and does not prove

Proven:

- `test/adapters/codex.test.ts` → "declares a linked worktree's actual and
  common Git directories writable" builds a **real** linked worktree, runs a
  turn, and asserts the production `sandboxPolicy.writableRoots` equals the five
  resolved paths. This is red on `main` (which returns `[req.workdir]`).
- `test/runtime/git-worktree-sandbox.test.ts` performs a real edit → `git add`
  → `git commit` in a real linked worktree, and pins the resolved root set.
- The admitted set was verified sufficient by direct observation: `add` +
  `commit` in a linked worktree writes only the per-worktree administrative
  directory (`index`, `HEAD`, `ORIG_HEAD`, `COMMIT_EDITMSG`, `logs/HEAD`),
  `objects/**`, `refs/heads/<branch>`, and `logs/refs/heads/<branch>`.

Not proven:

- That an actual OS sandbox (macOS Seatbelt for Codex, the Claude SDK sandbox)
  **honors** those declared roots at runtime. No offline test can establish
  this; it is exactly what `pnpm test:live` exists to sample.
- The Claude adapter's linked-worktree wiring has no adapter-level test at all.
  `test/runtime/claude-sdk.unit.test.ts` asserts `allowWrite: ["/wd"]`, and
  `/wd` is not a Git worktree, so `gitWorktreeWritableRoots` returns its
  catch-fallback. That assertion passes identically before and after the fix.

## Consequence if the waiver is wrong

ISSUE-046 (GitHub #179) recurs: the builder implements a ticket, passes its
gates, and is denied at the atomic commit — after the paid pass. The
provision-time preflight added by this PR does **not** cover that case: it runs
in the Operon host process, where the lock was always writable (ISSUE-035
established the host filesystem permissions are ordinary and the denial is a
sandbox-policy boundary). The preflight guards stale locks and real filesystem
damage, not a sandbox misconfiguration.

## Debt owed before the next release

1. Run `pnpm test:live` against both adapters once authentication is available,
   and append the result here.
2. Add a Claude-side adapter test mirroring the Codex linked-worktree case, so
   reverting `claude.ts` `allowWrite` breaks a test. Today it breaks none.
3. Exercise ordinary linked-worktree staging through a live sandbox app run,
   which the campaign already owes separately.

Tracking: GitHub #179 remains the anchor for (1) and (2).
