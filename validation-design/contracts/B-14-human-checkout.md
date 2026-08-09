# Contract — B-14 Human checkout ↔ managed workspace
Canonical ID: **CORMIDIA-C-B14-001 (alias: B-14)**

Status: DRAFT (Phase 4). Defends INV-004/010, T-6/T-8. Journeys J-02/J-14.

## 1. Valid inputs
- Bootstrap accepts a local checkout path, never a URL `[doc]`. **Ordinary bootstrap
  may accept a dirty checkout.** The refusals for unrelated staged changes, merge in
  progress, and detached HEAD belong specifically to `bootstrap publish --execute`
  `[doc]` — they are not general bootstrap preconditions.
- Reset targets the registered app; the human checkout is **never** in its destructive
  set (INV-010).

## 2. Output guarantees
- Bootstrap writes only `.cormidia/**` plus one marked, idempotent authority pointer
  block in root `AGENTS.md`/`CLAUDE.md`; existing content preserved byte-for-byte
  outside the marker `[doc]` (containment invariant).
- The build loop and recovery operate exclusively in org-managed clones/worktrees; the
  human checkout is read only where a command explicitly takes it as input (bootstrap
  scan, run-role preview) `[doc]`.
- Link/artifact ownership: source and packaged install/link operations enumerate the
  complete shared binary/skill table before mutation. Ownership evidence binds the
  exact directory entry or symlink target to a Cormidia `package.json`
  name/version/bin identity or to the invoking checkout's exact declared source.
  Same-version reinstall is idempotent; packaged upgrade and explicit source-link
  replacement change only Cormidia-owned artifacts. Foreign-owned files, directories,
  and links are all reported with their evidence and exact move-aside remediation,
  then refused untouched before any install target changes `[doc]`.
- Source ownership is not transferable between checkouts. `--replace-source-links`
  consents only to dismantling links into the checkout invoking the command. A link
  into another identity-verified Cormidia checkout may be another active dev loop, so
  it remains foreign: report its checkout/version evidence and exact remediation, but
  do not mutate it even when the flag is present `[doc]`.
- Package, declared binaries, and packaged skills replace as one rollback-safe
  generation. An ordinary failure restores the prior complete source/package
  generation; it never returns with a mixed visible install. User configuration and
  unresolved paths are outside the replacement set.

## 3. Error behavior
- Symlinked paths, wrong remote, path overlap with generated artifacts: typed refusals
  before mutation.
- Install ownership drift after preflight is a refusal before promotion. Rollback
  removes a promoted artifact only while its exact transaction observation still
  matches; a concurrently replaced/unresolved path is preserved and reported rather
  than overwritten to force a clean-looking rollback.
- Bootstrap refuses before mutation when the retired app-artifact directory still
  exists. The operator moves it to `.cormidia/` in one reviewed repository commit;
  Cormidia never creates or adopts parallel app-policy roots.
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
  `.cormidia/` regenerated deterministically with preserved user-owned edits refused or
  reported, never silently overwritten (INV-008/010).
- Packaged same-version reinstall converges to the same package/bin/skill generation;
  upgrades preserve every path outside the declared Cormidia install targets.

## 5. Timing
- No freshness assumption about the human checkout: it is untrusted, possibly stale
  input at every use.
