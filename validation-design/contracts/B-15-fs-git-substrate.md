# Contract — B-15 Local persistence & git substrate
Canonical ID: **OPERON-C-B15-001 (alias: B-15)**

Status: DRAFT (Phase 4). Defends INV-009/010/013, T-7. Journeys J-04/J-13/J-14.

## 1. Valid inputs
- Store writes follow their ratified shape (append-only / atomic replace / journal —
  system-map §2.5); every reader validates before trusting (INV-013).
- Git operations always name their repo, ref, and remote explicitly; the remote default
  branch is resolved at use time (INV-009).

## 2. Output guarantees
- Managed clones/worktrees live only under the state home; worktree metadata is
  Operon-owned; human checkouts never touched (B-14).
- A git command's success is judged by post-state verification where the operation
  feeds a consequential claim (merge, reset, ancestry) — exit code alone does not
  certify a partially-succeeded compound operation `[elicited]`.

## 3. Error behavior
- FS classes typed: disk full / ENOSPC mid-append (fail closed, journal preserved);
  read-only remount; permission change; symlinked path (refuse where identity matters —
  B-10a/B-14).
- Git classes typed: `index.lock` held → bounded wait then typed failure
  (**human-ratified at HB-007 review 2026-07-31:** wait ≤ 30 s; never delete or
  steal a foreign lock); corrupt refs /
  missing worktree metadata → typed, recovery via re-clone path, never guess; remote
  URL changed → identity stop (INV-004); hooks in cloned repos: **human-ratified at
  HB-007 review 2026-07-31:** managed clones run git with hooks disabled
  (`core.hooksPath` to empty) so app-repo hooks cannot execute in Operon's context.
- Git version skew: **doctor checks required git capabilities and reports the observed
  version** — no version floor is invented; a floor may be derived later if
  implementation evidence proves one necessary `[elicited]`.

## 4. Idempotency
- Worktree acquisition/release idempotent per (app, branch); re-clone converges.

## 5. Timing
- No cross-process FS cache assumptions; every tick re-reads durable state (stateless
  tick `[doc]`).
