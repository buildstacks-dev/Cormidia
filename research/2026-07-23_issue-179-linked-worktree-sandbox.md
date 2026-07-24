# Issue #179 linked-worktree sandbox verification

Date: 2026-07-23 (America/Los_Angeles)

## Change under test

Issue #35 was never closed by a source fix: both production adapters still
declared only the visible worktree as writable. The apparent intermittency came
from provider-side command approval/escalation outcomes, not from a different
Git layout; every linked worktree kept its index outside that declared root.
Resolving and granting the required Git paths in the adapter policy makes that
approval variance irrelevant.

Codex and Claude runtime sandboxes now resolve a linked checkout with Git
rather than assuming the source worktree contains all mutable state. The
writable set contains the source checkout, its real per-worktree
administrative directory, the shared object directory, and only the parent
directories for the checked-out branch ref and reflog. It does not grant the
managed clone or the whole common Git directory.

Ticket provision probes creation of the exact per-worktree `index.lock`.
Failure returns the ticket before setup or provider execution with
`error_git_index_unwritable` and preserves the checkout.

## Offline verification

Focused command:

```text
env PATH=/opt/homebrew/bin:/Users/bikram/.nvm/versions/node/v26.4.0/bin:/usr/bin:/bin:/usr/sbin:/sbin \
  pnpm exec vitest run \
  test/runtime/git-worktree-sandbox.test.ts \
  test/adapters/codex.test.ts \
  test/runtime/claude-sdk.unit.test.ts \
  test/loop/setup-artifacts.test.ts \
  test/loop/setup-gate-provision.test.ts \
  test/turn-runner-gitlock.test.ts \
  test/turn-runner-standalone-worktree.test.ts
```

Result: 7 files and 75 tests passed. The regression test creates a real linked
worktree and completes edit → `git add` → `git commit`; the adapter test proves
the resolved paths reach the production Codex `workspaceWrite.writableRoots`
policy; the provision test proves an index-lock failure returns before setup
and preserves the worktree.

TypeScript strict check:

```text
node_modules/.bin/tsc --noEmit
```

Result: passed.

## Required live conformance sample

The repository's pinned pnpm 11.10.0 initially rejected the config-only
`pnpm-workspace.yaml` before script dispatch (`packages field missing or
empty`). The candidate now selects only the root package (`packages: ['.']`),
preserving the single-package boundary and allowing the campaign's exact final
pnpm commands. The live sample itself used the equivalent explicit
non-workspace invocation:

```text
pnpm --ignore-workspace test:live
```

Result: failed at the live-auth gate without executing a provider conformance
case. Claude reported `Not logged in`; Codex and pi live tests were disabled by
their explicit opt-in environment variables. Vitest reported 1 failed and 8
skipped tests. This was the one required live sample; it was not repeated with
skip flags or rerun for a favorable result.

This is environment/auth qualification debt, not a passing live adapter claim.
The offline policy and real-Git regression proofs above are green. The campaign
still requires its separately authorized full Buildstacks onboarding run to
exercise ordinary linked-worktree staging through the source-backed candidate.
