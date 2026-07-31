# Operation contract — C-OP-LIFE (org/app lifecycle operations)
Canonical ID: **OPERON-C-OPLIFE-001 (alias: C-OP-LIFE)**

Status: DRAFT (Phase 4). Added on stakeholder trace audit: journeys need stable
operation-contract IDs where no Phase 3 boundary owns the promise. Covers `org init`,
`org upgrade`, `org use`, `app verify`, `app promote`, `app reset`. Defends
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
