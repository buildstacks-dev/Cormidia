# AGENTS.md

## Scope
`src/runtime/**` — the runtime contract layer and provider adapters. Root
AGENTS.md rules still apply; this file adds the local ones.

## Purpose
`Runtime` interface, critical-ops gate, telemetry, L1–L3 runlog writers, and
the adapters (Claude Agent SDK, Codex App Server, pi SDK, `cursor-agent` CLI,
Muse Code CLI).

## Local rules
- This layer imports nothing from `src/loop` or `src/org` — it is the bottom
  of the one-way import direction and what keeps the loop extractable.
- `secret-patterns.ts` is the ONE secret-regex list — redaction and qgates
  both import it. Never fork a second list.
- `file-lock.ts` is the shared O_EXCL + PID/process-start/nonce ownership-token
  + liveness/stale-reclamation lock primitive. The app git-clone lock is a
  configuration of it; the settlement and turn locks are the model but not
  yet re-expressed onto it.
- `durable-claim.ts` is the reusable single-claim/commit/settle primitive for
  content-bound work that must survive process death and allow only an explicit,
  bounded retry under the same settlement identity. Scheduler due windows use
  it through `src/org/scheduler/due-window-claims.ts`; a future approvals
  decision lock (#199) may adopt this seam, but runtime code must remain free of
  schedule, ticket, and approval vocabulary.
- Every `Runtime` must prove adapter-generic conformance before its role goes
  live — the shared two-turn walk in `tests/fixtures/adapters/conformance.ts`,
  run hermetically against the transport doubles
  (`tests/hermetic/cf-adapter-conformance/`, including the subagent
  gate-ordering probe, the pi fan-out degradation path, and the 300 KB
  payload pin — #334) and live through the campaign runner
  (CF-B02/03/04-L3, plus CF-B24-L3 for Cursor and CF-B26-L3 for Muse Code —
  the latter reporting `incomplete`, which is its certified final state).
  Extend cases; never weaken one to make an adapter pass.
- `harness-support.ts` is the ONE place version bands live: per kind, `floor`
  (below it readiness refuses before the provider is constructed), `testedWith`,
  and its dated `research/` evidence. The record is exhaustive over
  `RuntimeKind`, so a new harness is a compile error until its bands exist;
  drift above or below `testedWith` is a doctor note, never a block.
- Capability flow is one-way (#116). Follow
  `docs/harness/adding-updating.md` for the adapter contract, registration
  checklist, three test tiers, and update obligations.
- **A new `RuntimeKind` is more than the compiler tells you.** The exhaustive
  `Record<RuntimeKind, …>` maps (registry, capabilities, readiness,
  model-catalog) fail loudly, but the dangerous sites are the
  `if claude … else if codex … else <pi assumed>` branches that compile fine and
  answer for the wrong provider: `costEnforcementFor`, `permissionModeFor`,
  `configuredProviderFamily`, and the two `sessionEvidence` builders in
  `src/loop` / `src/org`. `RUNTIME_KINDS` is now derived from the registry and
  `TURN_ASSIGNMENT_HARNESSES` is the one enum every schema and validator reads —
  never restate either as a literal.
- **Cursor's `--force` is gated on a proven gate, per turn.** `cursor-agent`
  cannot do real work without `--force`, and its headless surface has no
  approval channel, so the adapter passes `--force` only after
  `startCursorGateBridge` has run its pre-spend handshake through the exact hook
  command Cursor will run. A bridge that cannot answer refuses the turn before
  provider construction, and a post-turn executed-versus-allowed cross-check
  reports `error_gate_not_observed` instead of `completed`. Hook firing is a
  version-banded claim (`research/2026-08-07_cursor-adapter-certification.md`) —
  re-certify on every `cursor-agent` bump, and never register
  `beforeShellExecution`/`beforeReadFile` alongside `preToolUse` (they fire for
  the same action and would consult the gate twice).
- **An adapter with no proven gate seam refuses; it does not degrade.**
  `adapters/muse*.ts` is the worked example: Muse Code auto-approves tool calls
  headlessly and its managed-hook seam did not fire on the certified build, so
  every turn proves the seam first (token-free `--provider echo` handshake) and
  refuses with `error_gate_seam_unavailable` when it cannot. The capability
  profile says `tool_gate: unsupported` and `intra_turn_fanout: unsupported` to
  match. Never soften this into "gate on a best-effort basis" — an unproven gate
  is an ungated turn (`research/2026-08-07_muse-code-adapter-certification.md`).
- **`subagentTurns` comes from records, never from prose.** Muse narrated
  parallel subagents it had not spawned; the offline suite carries a seeded liar
  for exactly that. Fan-out accounting reads the hook join table and the durable
  session log only.
- The Muse adapter is deliberately split by concern so each module stays inside
  the public-symbol budget: `muse.ts` (turn orchestration), `muse-exec.ts`
  (argv + subprocess + auth resolution), `muse-usage.ts` (durable-log spend),
  `muse-events.ts` (stream folding), `muse-gate-bridge.ts` +
  `muse-hook-router.ts` + `muse-managed-hooks.ts` + `muse-gate-hook.ts` (gate).

## Testing
Interim during the validation rebuild (root AGENTS.md → Testing expectations):
- Adapter changes (`adapters/**`) still require live proof against the real
  provider plus a dated `research/` record — the live conformance run is the
  only proof the gate claim holds outside a double. The replacement harness
  carries that walk: `runAdapterConformance()` under `pnpm test:live`
  (human-triggered, policy spend-bounded); certification is standalone and
  never requires an org/app run (docs/harness/adding-updating.md §5).
- `gate.ts` changes: deposit critical-side and routine-near-miss cases in the
  replacement harness (`tests/`) once it exists.

## References
`docs/harness/capability-matrix.md` · `docs/harness/adding-updating.md` ·
`research/2026-07-03_runtime-layer.md` ·
`research/2026-07-04_prompt-caching.md`
