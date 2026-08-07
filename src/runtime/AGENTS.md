# AGENTS.md

## Scope
`src/runtime/**` — the runtime contract layer and provider adapters. Root
AGENTS.md rules still apply; this file adds the local ones.

## Purpose
`Runtime` interface, critical-ops gate, telemetry, L1–L3 runlog writers, and
the adapters (Claude Agent SDK, Codex App Server, pi SDK, OpenCode server+SDK).

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
  payload pin — #334) and live through the campaign runner (CF-B02/03/04-L3).
  Extend cases; never weaken one to make an adapter pass.
- Capability flow is one-way (#116). Follow
  `docs/harness/adding-updating.md` for the adapter contract, registration
  checklist, three test tiers, and update obligations.

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
