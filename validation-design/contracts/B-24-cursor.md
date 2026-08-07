# Contract — B-24 Cursor adapter (cursor-agent CLI headless)
Canonical ID: **CORMIDIA-C-B24-001 (alias: B-24)**

Status: DRAFT (harness revision 2026-08-07, #336; design-only until the adapter lands
— #338). Extends `provider-adapter-core.md`; deltas only. Sources: `[doc:
research/2026-08-06_adapter-upstream-references.md]` unless marked `[stated]`
(owner text in #338 incl. the 2026-08-07 field-verification comment) or `[PROPOSED]`.

- Surface: user-installed binary, resolved as **`cursor-agent` — never `agent`**: the
  short name is collision-prone (on the verification host `agent` resolves to Grok
  Build) `[stated]`. Headless `-p` with `--output-format stream-json`; threads via
  `--resume`. `@cursor/sdk` (public beta) is deliberately NOT the day-one surface;
  revisit on beta exit (#332). Never installed by Cormidia (#224); readiness = usable
  request authentication (`CURSOR_API_KEY` or the vendor's stored login state —
  account presence is never readiness), version bands from
  `cursor-agent --version` (#331).
- Trust and force are a deliberate, gated pair `[stated]`: headless from an untrusted
  directory refuses with a directory-trust prompt — a typed, pre-spend refusal class,
  never a hang; the adapter passes an explicit trust flag for the org-managed worktree
  and `--force` for edits to apply, **recorded as a deliberate decision in the
  adapter, since trust + `--force` together are what let the agent act**. Broader
  bypass spellings (`--yolo`) are unrepresentable (B-02/B-03 bypass-mode analogy).
- Silent no-op edits are an evidence lie: with `--force` absent, a turn can "succeed"
  while zero file edits applied — conformance pins that the adapter's configuration
  cannot produce this state, and that a no-edit outcome is reported as what it is
  (INV-008).
- Gate integration — **BLOCKED:F-PT-026**: Cursor exposes a real static role-shaping
  surface (native `permissions.allow/deny` with `Shell()/Read()/Write()/WebFetch()/
  Mcp()` patterns, deny-wins — wired from `src/runtime/role-shaping.ts`) but no
  documented dynamic per-action hook/approval seam. Whether static native deny +
  adapter-side enforcement honors INV-002's pre-execution gate classification at an
  acceptable `tool_gate` tier, or the capability profile must record a degraded/
  unsupported tier with narrowed role eligibility, is an owner decision. Until it
  ratifies, no case encodes a guessed tier; the capability profile is honest about
  fan-out/verdict tiers as certified, not assumed `[stated]`.
- Permission-config integrity: missing, malformed, or role-wider-than-configured
  `~/.cursor/cli-config.json` / `.cursor/cli.json` state is a typed refusal before
  provider construction — Cormidia narrows onto Cursor's config, never widens through
  it (INV-001/INV-015).
- Hermeticity: Cursor reads `AGENTS.md`/`CLAUDE.md` natively. Repo-checked files in
  the org-managed worktree are legitimate app context; **operator-personal global
  config must not leak into org turns** — certification records what the binary
  ingests and the adapter pins the narrowest available ingestion posture
  `[PROPOSED, claude `settingSources: []` analogy]`.
- Effort: no knob exists — the Effort mapping documents the honest absence and throws
  on unmappable values; assignment `efforts:` lists constrain candidates instead
  `[stated]`.
- Protocol drift: stream-json shape changes on the fast-moving CLI are typed failures,
  never silent re-parse; pins are tested-with declarations (#331); re-certification
  on bump. Corporate note (not a failure mode): the pending SpaceX/Anysphere
  acquisition may require a provider-diversity accounting note for the
  builder ≠ reviewer pairing once closed `[stated]`.
- L3 (certification lane, design-only until #338): the §5 certification walk — real
  auth; real trust/force behavior in an org-managed worktree; a real forbidden attempt
  denied through whatever enforcement F-PT-026 ratifies; exact thread resume; version
  bands recorded. Spend-bounded per policy.
