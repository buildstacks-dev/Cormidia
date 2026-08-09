# Operation contract — C-OP-LIFE (org/app lifecycle operations)
Canonical ID: **CORMIDIA-C-OPLIFE-001 (alias: C-OP-LIFE)**

Status: DRAFT (Phase 4). Added on stakeholder trace audit: journeys need stable
operation-contract IDs where no Phase 3 boundary owns the promise. Covers `org init`,
`org upgrade`, `org use`, `new-app`, `app product-docs`, `app verify`, `app promote`, `app reset`. Defends
INV-008/010/013/015, T-8. Journeys J-01/J-02/J-14. Interfaces with B-10/B-14/B-15.

## §1 org init
- Dry-run: token-free, zero-domain-write preflight (paths, destinations, authority
  summary, role chart) `[doc]`.
- Execute: absent target staged atomically (build → validate → rename); existing real
  directory populated with exclusive file creation and **exact rollback**; any
  collision (existing org, generated-path collision, nested org, non-directory,
  symlink) blocks before mutation `[doc]`.
- Success: complete org home + state home + active pointer.

## §2 org use / authority profiles
- `org use` requires a complete org; pointer update atomic.
- Missing/legacy authority fails closed to legacy-conservative (INV-015, B-10).

## §3 org upgrade
- Preview: byte-stable plan. Execute: additive only (missing packaged surfaces);
  ratified surfaces never replaced; checksummed archive outside the state home before
  changes; validation after; interrupted migration safe to rerun (dead-process-aware
  lock + deterministic staging); thrown failure restores exact archived bytes `[doc]`.

## §3a new-app / app product-docs
- `new-app` emits deterministic template-specific app artifacts, a product-document
  record containing exact generated hashes, and an app-specific checkpointed
  `next-commands.md`; it creates no remote, issue, provider turn, promotion, release,
  or scheduler effect `[doc]`.
- `app product-docs` previews `keep | reconcile | remove` by default. Execution requires
  exact `<app>:<disposition>` confirmation and records current document hashes. Exact
  scaffold bytes are placeholders, any other bytes are replacements, and absence is
  intentional state. Remove uses recoverable staging, rechecks each moved byte stream,
  deletes placeholders only, preserves a concurrent replacement, and rolls back on a
  pre-commit failure; committed removal with leftover staging recovers as cleanup
  rather than changing the disposition `[doc]`.
- A checkout generated before the v1 scaffold record is recognized from the exact
  legacy planning seed, previewed as a migration, and gets a manifest only when the
  operator confirms a disposition. Ambiguous legacy evidence refuses fail-closed
  rather than passing as an ordinary unscaffolded checkout `[doc]`.
- A recorded decision remains valid only while its bound document hashes remain exact.
  Keep requires all three documents present; remove requires all three absent;
  reconcile requires an authoritative planning source outside them `[doc]`.

## §4 app verify
- Deterministic; proves refs/ancestry, canonical labels (N/A for local/file remotes),
  managed clone, authority/config hashes, app checks, locks/approvals, static adapter
  readiness — **without starting a runtime**; its only lifecycle **domain-state** write
  is the lifecycle record (system-map §2.2), never the registry — the universal
  invocation journal/audit rows still occur, as on every dispatched command `[doc]`.
- A changed config is accepted only from the fetched remote default branch, exact hash
  + commit recorded in the crash-resumable lifecycle journal `[doc]`.

## §5 app promote
- Preview non-mutating with actionable remediation; execute mutates app/registry
  status only after verification; resumes exactly once across config, commit, push,
  and registry boundaries; lifecycle JSON canonically key-sorted `[doc]`.

## §6 app reset
- Default non-mutating plan (inventory + typed blockers with force-eligibility and
  remediation); execute = archive-first, then closes planned PRs/issues, deletes their
  head branches, removes registry entry, clears managed state — inside the authorized
  destructive set only (INV-010); durable intent + checksummed archive make a killed
  execution resumable `[doc]`.

## Error behavior (all operations)
- **Precondition and identity failures refuse before domain mutation.** Mid-execution
  failures (upgrade, promote, reset can fail after their journaled transaction begins)
  leave the operation-specific recoverable intermediate — journaled, resumable, per
  each operation's section above (INV-013). Previews write nothing but the invocation
  audit row (the sole preview write `[doc]`); `--execute --confirm <identity>` required
  for destructive/host-mutating forms; wrong identity refuses.
