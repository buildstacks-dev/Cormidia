# Contract — B-24 Cursor adapter (cursor-agent CLI headless)
Canonical ID: **CORMIDIA-C-B24-001 (alias: B-24)**

Status: ACTIVE (harness revision 2026-08-07 #336; adapter landed and certified
2026-08-07, #338). Extends `provider-adapter-core.md`; deltas only. Sources: `[doc:
research/adapters/2026-08-06_adapter-upstream-references.md]` unless marked `[stated]`
(owner text in #338 incl. the 2026-08-07 field-verification comment),
`[certified: research/adapters/2026-08-07_cursor-adapter-certification.md]` (observed
against cursor-agent 2026.08.04-aaa8809), or `[PROPOSED]`.

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
  (INV-008). `--force` is unconditional in the adapter's argv precisely so this state
  is unreachable; what is conditional is whether the turn runs at all
  `[certified]`.
- Gate integration — **F-PT-026 RESOLVED-by-certification 2026-08-07**: the finding's
  premise was falsified in the field. A per-turn project `.cursor/hooks.json`
  registering `preToolUse` IS loaded and executed under `-p --force`, covering
  Shell/Read/Write/Grep/Task, and a `{"permission":"deny"}` reply stops the action
  **before it executes** — proven by side-effect absence, never by the model's own
  report `[certified]`. The ratified rung: `preToolUse` is the SOLE registered gate
  channel (Cursor also fires `beforeShellExecution`/`beforeReadFile` for the same
  action, which would consult the gate twice), bridged to the in-process `GateFn`
  over a per-turn Unix socket with `failClosed: true` because Cursor's documented
  default is fail-OPEN. Tiers: `tool_gate: adapter`, `intra_turn_fanout: native`.
  The static deny surface below is defense in depth, not the enforcement.
- `--force` is unreachable until the bridge PROVES itself: a pre-spend handshake runs
  the exact hook command Cursor will run, from the project root, and requires both a
  deny and an allow probe to round-trip. A bridge that cannot answer is a typed
  refusal before provider construction — never an ungated turn. The handshake cannot
  prove a future build still calls the hook (`beforeSubmitPrompt` does not fire
  headless), so the claim is version-banded and a post-turn executed-versus-allowed
  cross-check reports `error_gate_not_observed` rather than `completed` when anything
  ran the gate never classified `[certified]`.
  Hook-process launch, timeout, early stdin closure, and output failures are all typed
  pre-spend refusals; none may escape as a process-level error. <!-- changelog
  2026-08-11 (#403): added the early-stdin-close transport shape observed in CI. -->
- Permission-config integrity: an app-authored `.cursor/hooks.json` or `.cursor/cli.json`
  in the workdir, or an operator-global `~/.cursor/cli-config.json` that is malformed
  or allows an act the role denies, is a typed refusal before provider construction —
  Cormidia narrows onto Cursor's config, never widens through it, and never replaces
  or merges an app's own (a merged app hook could answer `allow` on the gate channel)
  (INV-001/INV-015). `permissions.allow` is always the empty array: the CLI's schema
  requires the key — omitting it exits 1 before any turn — and empty cannot widen
  `[certified]`.
- Hermeticity: Cursor reads `AGENTS.md`/`CLAUDE.md` natively. Repo-checked files in
  the org-managed worktree are legitimate app context, and the turn's own
  ContextBundle rides a masked per-turn always-apply project rule
  (`.cursor/rules/cormidia-turn-context.mdc`, certified loaded headless) so the app's
  `AGENTS.md` is never clobbered to inject it. **Operator-personal global config does
  leak, partially**: certification observed the agent reading
  `~/.cursor/skills-cursor/**`, and the CLI exposes no `settingSources: []`
  equivalent. Those reads are ordinary `Read` tool calls and therefore gate-visible
  and deniable, and the role deny list forbids writes under `~/.cursor/**`, but the
  ingestion itself cannot be switched off — a recorded known limitation, not a
  claimed-narrow posture `[certified]`.
- Effort: no knob exists — the Effort mapping documents the honest absence and throws
  on unmappable values; assignment `efforts:` lists constrain candidates instead
  `[stated]`. Concretely: effort lives only in the model id
  (`…-low|-medium|-high|-xhigh`), so an assignment whose effort contradicts the id is
  a typed refusal rather than a silent choice in either direction `[certified]`.
- Usage and budget: `stream-json` reports usage exactly once, in the terminal `result`
  event, with `inputTokens` as the UNCACHED count plus `cacheReadTokens`/
  `cacheWriteTokens`/`outputTokens`. No dollar cost is reported, so `costUsd` is a
  Cormidia estimate from the vendor's published rate table, flagged
  `costEstimated: true`, with a documented upper bound (never zero) for unpriced ids.
  Because there is no mid-turn usage signal, the per-turn cap is a **turn-boundary
  check, not a running guard**, and no surface may imply a hard mid-run ceiling
  (INV-008) `[certified]`.
- Protocol drift: stream-json shape changes on the fast-moving CLI are typed failures,
  never silent re-parse; pins are tested-with declarations (#331); re-certification
  on bump. Corporate note (not a failure mode): the pending SpaceX/Anysphere
  acquisition may require a provider-diversity accounting note for the
  builder ≠ reviewer pairing once closed `[stated]`.
- L3 (certification lane) — **certified 2026-08-07**: the §5 certification walk ran
  with real auth in an org-managed worktree; the two-turn walk returned
  `violationIds: []` with exact chat resume at $0.080423; a real forbidden shell
  attempt and a real forbidden **subagent** shell attempt were both denied through the
  `preToolUse` bridge with no side effect; version band `cursor-agent
  2026.08.04-aaa8809` recorded. Spend-bounded per policy (~$0.245 total across four
  provider turns). Evidence: `research/adapters/2026-08-07_cursor-adapter-certification.md`.
