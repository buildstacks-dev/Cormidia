# Contract — B-10 Org-home ratified surfaces ↔ runtime resolver (incl. B-10a identity)
Canonical ID: **OPERON-C-B10-001 (alias: B-10, incl. B-10a)**

Status: RATIFIED 2026-07-31 (ratification-package.md §9 covers contracts/; header updated at Wave-1 implementation — was a stale "DRAFT (Phase 4)"). Defends INV-001/004/013/015, T-3/T-6. All journeys (turn construction).

## 1. Valid inputs
- Config artifacts carry `schema_version` from day one `[doc]`; loaders validate before
  adoption — invalid YAML/schema → typed error, **no partial adoption** (INV-013/015).
- Authority: missing `AUTHORITY.md` → built-in legacy-conservative profile, never the
  newer delegated default `[doc]` (INV-015).
- App narrowing may only narrow (INV-001); a widening app config is a typed refusal.

## 2. Output guarantees (B-10a — active-org identity)
- Resolution precedence: explicit per-process overrides (`OPERON_ORG_HOME`,
  `OPERON_STATE_HOME`) > active pointer (`~/.operon/config`). No command infers an org
  home from cwd `[doc]`.
- The resolved (org home, state home, org id) triple is validated as a **coherent
  identity** before use; a pairing mismatch (state home from another org; pointer to
  moved/deleted org; symlinked org home) is a typed stop — "correct config from the
  wrong org" is an identity failure, not a parse failure `[elicited]` (INV-004).
- Every dispatched command with an explicit or safely resolved state home writes its
  invocation audit row with the resolved org/app `[doc]`.

## 3. Error behavior
- Unreadable/torn config: reader rejects, recognized-intermediate rules apply (INV-013);
  the process does less, never more (INV-015).
- Package/org schema skew during upgrade: typed, directional (upgrade path exists;
  silent cross-version adoption does not).

## 4. Idempotency
- Resolution is pure per process invocation; re-resolution yields the same triple for
  unchanged inputs.
- **Preview→execute drift:** an execute step re-resolves and re-validates; if identity
  or ratified-surface content changed since preview, execution refuses and reports —
  **PROPOSED** exact-hash comparison on the surfaces the operation depends on; owner:
  human; expiry: first harness build review. `[elicited: "config changing between
  preview and execution"]`

## 5. Timing
- Config is re-read per tick/process; there is no cross-process config cache to
  invalidate `[doc: stateless tick]`.
