# Contract — B-10 Org-home ratified surfaces ↔ runtime resolver (incl. B-10a identity)
Canonical ID: **CORMIDIA-C-B10-001 (alias: B-10, incl. B-10a)**

Status: RATIFIED 2026-07-31 (ratification-package.md §9 covers contracts/; header updated at Wave-1 implementation — was a stale "DRAFT (Phase 4)"). Defends INV-001/004/013/015, T-3/T-6. All journeys (turn construction).

## 1. Valid inputs
- Config artifacts carry `schema_version` from day one `[doc]`; loaders validate before
  adoption — invalid YAML/schema → typed error, **no partial adoption** (INV-013/015).
- Authority: missing `AUTHORITY.md` → built-in legacy-conservative profile, never the
  newer delegated default `[doc]` (INV-015).
- App narrowing may only narrow (INV-001); a widening app config is a typed refusal.
- App `execution` policy resolves shipped, observable defaults for Codex/Claude
  permission modes, per-turn soft caps, generic/ticket hard ceilings, and static-route
  execution bounds. Unsupported/bypass modes, unknown fields, non-positive values, a
  per-turn value above an explicit episode ceiling, or quick→standard→deep regression
  are typed pre-provider refusals. Omission is explicit default resolution, not a
  hidden adapter constant.

## 2. Output guarantees (B-10a — active-org identity)
- Resolution precedence: explicit per-process overrides (`CORMIDIA_ORG_HOME`,
  `CORMIDIA_STATE_HOME`) > active pointer (`~/.cormidia/config`). No command infers an org
  home from cwd `[doc]`.
- Before default-root resolution, a first Cormidia invocation atomically renames the
  retired `~/.operon` root to `~/.cormidia`, rewrites any active-pointer and lifecycle
  managed-clone paths rooted there, repairs active turn journals and registered git
  worktrees, and replaces any provably owned host-scheduler definition with the current
  identity and state path. If both roots
  exist, resolution is a typed pre-mutation stop; it never merges or chooses between two
  state authorities. Explicit state-home overrides are not relocated. [INV-004/013]
- The resolved (org home, state home, org id) triple is validated as a **coherent
  identity** before use; a pairing mismatch (state home from another org; pointer to
  moved/deleted org; symlinked org home) is a typed stop — "correct config from the
  wrong org" is an identity failure, not a parse failure `[elicited]` (INV-004).
- Every dispatched command with an explicit or safely resolved state home writes its
  invocation audit row with the resolved org/app `[doc]`.
- `cormidia apps --json` explains the full effective app policy. Paid run envelopes
  bind the effective per-turn dimensions and provider mode to the app config reference;
  EpisodeIntent/route evidence binds the hard ceiling and static execution bounds.

## 3. Error behavior
- Unreadable/torn config: reader rejects, recognized-intermediate rules apply (INV-013);
  the process does less, never more (INV-015).
- Package/org schema skew during upgrade: typed, directional (upgrade path exists;
  silent cross-version adoption does not).

## 4. Idempotency
- Resolution is pure per process invocation; re-resolution yields the same triple for
  unchanged inputs.
- First-run relocation is convergent after interruption: the directory move is atomic,
  and pointer/lifecycle/worktree repairs are idempotent when replayed after the move.
- **Preview→execute drift:** an execute step re-resolves and re-validates; if identity
  or ratified-surface content changed since preview, execution refuses and reports —
  **human-ratified at HB-007 review 2026-07-31:** exact-hash comparison on the
  surfaces the operation depends on. `[elicited: "config changing between preview
  and execution"]`

## 5. Timing
- Config is re-read per tick/process; there is no cross-process config cache to
  invalidate `[doc: stateless tick]`.
