# Contract — B-25 Grok Build adapter (ACP over stdio)
Canonical ID: **CORMIDIA-C-B25-001 (alias: B-25)**

Status: IMPLEMENTED + CERTIFIED (adapter landed #339, 2026-08-07; live certification
recorded in `research/adapters/2026-08-07_grok-build-adapter-certification.md`). **Adoption
remains blocked on #339's OPEN human risk review — certification proves the adapter,
never the vendor; sandbox repos only, and no role may be assigned to this harness.**
Extends `provider-adapter-core.md`; deltas only. Sources:
`[doc: research/adapters/2026-08-06_adapter-upstream-references.md]` and
`[cert: research/adapters/2026-08-07_grok-build-adapter-certification.md]` unless marked
`[stated]` (owner text in #339) or `[PROPOSED]`.

- Surface: user-installed official `grok` binary (xai-org/grok-build). The community
  `superagent-ai/grok-cli` is unaffiliated and **never targeted** `[doc]`. Adapter
  speaks **ACP** (`grok agent stdio`, JSON-RPC over stdio) — shape-wise a cousin of
  the B-03 App Server client; `grok -p --output-format streaming-json` is the recorded
  fallback surface. **`grok agent stdio` REJECTS `--no-auto-update`** `[cert]`, so the
  #224 posture (a self-mutating binary mid-campaign is config drift, not an update) is
  carried by `GROK_DISABLE_AUTOUPDATER=1` in the child environment instead.
  Never installed by Cormidia; readiness = usable request authentication
  (`XAI_API_KEY` or the vendor's stored login — whichever a real probe proves usable;
  account presence is never readiness), version bands recorded (#331).
- Subprocess failure shapes inherit B-03's set: death mid-RPC preserves journal/
  checkpoint; ACP protocol-version negotiation failure or skew with the recorded
  binary version is a typed, terminal config error.
- Gate integration — **F-PT-027 RESOLVED 2026-08-07 `[cert]`**. ACP's
  `session/request_permission` is coverage-incomplete by design: read-only tools
  (`read_file`, `list_dir`, `grep`, and a fixed read-only shell list) never reach it in
  any mode, and a persisted `[ui] permission_mode = "always-approve"` — or
  `--always-approve`, or `_meta.yoloMode` on `session/new` — suppresses the whole
  request path with no client-visible difference (`session/new` exposes no modes).
  **The gate is therefore the `PreToolUse` hook**, which grok evaluates FIRST, ahead of
  permission rules, remembered grants, read-only auto-approvals and the prompt policy,
  in every permission mode; always-approve short-circuits only *after* hooks. Cormidia
  bridges it over a per-turn Unix socket into the in-process gate, with the ACP request
  retained as a backstop through the same gate.
  **Fail-closed proof is part of the mechanism, not an extra:** grok's hook runner FAILS
  OPEN on every handler failure, so a silent hook is indistinguishable from a quiet
  turn. Each turn must prove its gate through a `SessionStart` handshake on the same
  socket before the prompt is sent; an unproven handshake, a session id the handshake
  contradicts, or a bypass-shaped permission mode reported by it are all typed
  `error_gate_unproven` / `error_resume_session_mismatch` refusals with zero tokens
  spent. "No permission request observed" is never approval. A tool action executed
  without traversing the gate remains an INV-002 hole, not a degradation.
- Provider isolation is part of the gate `[cert]`: grok merges hooks, permission rules
  and instruction files from `~/.grok`, `~/.claude` and `~/.cursor`. Every turn runs
  with an isolated `GROK_HOME` **and** `HOME` plus the `[compat.*]` cells and their
  `GROK_CLAUDE_*` / `GROK_CODEX_*` env equivalents. Two recorded tradeoffs: `auth.json`
  is the single operator byte carried across (full isolation would break request
  authentication), and the isolated home is stable per workdir rather than per turn
  (grok stores session transcripts inside it, and a per-turn home breaks exact resume).
- Intra-turn fan-out is `unsupported` and **enforced**, not merely declared `[cert]`:
  grok exposes `spawn_subagent`, and no probe has proven a subagent's tool calls
  traverse the hook, so the bridge refuses to classify the route and grok receives a
  deny. A degradation artifact lands when `delegation.allow` is configured.
- Usage and budget `[cert]`: ACP `_meta.usage` carries provider-reported
  `costUsdTicks` (1 USD = 10^10 ticks), so `costUsd` is measured, not estimated; grok
  omits every cost figure when the server's cost was partial, and Cormidia keeps that
  unknown rather than reading absence as free. There is no mid-turn cost signal, so the
  per-turn cap is enforced **terminally** — a documented degradation, recorded in the
  capability matrix, never patched over with an invented price table. `maxTurns` has no
  native knob on this surface (`grok agent` rejects `--max-turns`).
- Exact model discipline: default model `grok-4.5` and operator `~/.grok/config.toml`
  exist; the assigned tuple's model id is supplied explicitly and remains exact —
  operator config never substitutes for an org assignment (core §1).
- Effort: no knob — honest absence; unmappable values throw (`xhigh`/`max`);
  assignment `efforts:` lists constrain candidates instead. **Known conservative
  `[cert]`:** grok 1.0.0 advertises `supportsReasoningEffort: true` with
  `reasoningEfforts: [high, medium, low]` for `grok-4.5`, accepts
  `--reasoning-effort` on `grok agent`, and returns an `x.ai/sessionConfig` mode list
  ACP `session/set_mode` could select. Wiring effort natively is a **`[PROPOSED]`
  amendment for a follow-up**, deliberately not made as a side effect of the first
  implementation.
- **Risk posture (live use):** the recorded pre-adoption flags — an unverified
  single-source report of a 2026-07 incident uploading user repos including secrets
  to vendor cloud storage; a closed-contribution upstream; vendor consolidation with
  Cursor under SpaceX `[doc]` — make live certification **conditional on a recorded
  human risk-review decision (#339)**, and until that review clears real-repo use,
  every live turn targets throwaway sandbox repos only `[stated]`. Secret containment
  (INV-011) treats the vendor transport as untrusted: nothing beyond the redacted
  brief/worktree content the turn legitimately carries may be staged where the binary
  can exfiltrate it.
- Shared ACP transport core `[PROPOSED — decision requested in this pass, #339]`:
  ACP is a standard (Kimi CLI also speaks it). A shared transport core is acceptable
  **only** as an implementation detail behind per-harness boundaries: each ACP harness
  keeps its own B-NN boundary, capability profile, readiness, version bands, and
  certification evidence — transport reuse never shares or transfers certification
  evidence across harnesses. If adopted, the shared core's own conformance gets its
  own L1/L2 family; it never collapses B-25 and a future ACP boundary into one.
- L3 (certification lane) — **EXECUTED 2026-08-07 `[cert]`**: the §5 certification walk
  over ACP in throwaway sandbox repos. CF-B25-L3, 2 provider turns / $0.058, violations
  empty; real auth; real shell and read attempts denied pre-execution through the
  ratified hook bridge; exact session resume from the hook-witnessed id; fan-out proven
  at its declared `unsupported` tier by the enforced `spawn_subagent` denial; isolation
  sentinel (operator `always-approve` vs `default` inside the turn). Spend well inside
  the policy bound. The human risk-review record remains a precondition for adoption,
  not evidence — it is still OPEN.
