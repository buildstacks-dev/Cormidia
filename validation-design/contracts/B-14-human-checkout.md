# Contract — B-14 Human checkout ↔ managed workspace
Canonical ID: **OPERON-C-B14-001 (alias: B-14)**

Status: DRAFT (Phase 4). Defends INV-004/010, T-6/T-8. Journeys J-02/J-14.

## 1. Valid inputs
- Bootstrap accepts a local checkout path, never a URL `[doc]`. **Ordinary bootstrap
  may accept a dirty checkout.** The refusals for unrelated staged changes, merge in
  progress, and detached HEAD belong specifically to `bootstrap publish --execute`
  `[doc]` — they are not general bootstrap preconditions.
- Reset targets the registered app; the human checkout is **never** in its destructive
  set (INV-010).

## 2. Output guarantees
- Bootstrap writes only `.operon/**` plus one marked, idempotent authority pointer
  block in root `AGENTS.md`/`CLAUDE.md`; existing content preserved byte-for-byte
  outside the marker `[doc]` (containment invariant).
- The build loop and recovery operate exclusively in org-managed clones/worktrees; the
  human checkout is read only where a command explicitly takes it as input (bootstrap
  scan, run-role preview) `[doc]`.
- Link/artifact ownership: `pnpm link:local`-class operations upgrade only artifacts
  owned by the same checkout; foreign-owned files/links are refused untouched `[doc]`.

## 3. Error behavior
- Symlinked paths, wrong remote, path overlap with generated artifacts: typed refusals
  before mutation.
- Concurrent human edits during a lifecycle command: **exclusive-creation + exact
  rollback is documented for `org init` only** — it is not generalized to every
  lifecycle command by analogy. For bootstrap-owned markers/generated paths edited by
  a human between validation and write, the ratified outcome (**F-PT-007, ratified
  2026-07-31**) is **compare-and-refuse on drift, preserving human bytes** — contract
  truth; cases via HB-P4. (Provenance: the owner's leaning was recorded `[simulated]`
  during the campaign; human-ratified 2026-07-31.)
  <!-- ratification 2026-07-31: F-PT-007 resolved; clause encoded; simulated-seat
  provenance tag retained for package §2 count reproducibility. -->

## 4. Idempotency
- Bootstrap re-run: idempotent; marked block replaced in place, never duplicated;
  `.operon/` regenerated deterministically with preserved user-owned edits refused or
  reported, never silently overwritten (INV-008/010).

## 5. Timing
- No freshness assumption about the human checkout: it is untrusted, possibly stale
  input at every use.
