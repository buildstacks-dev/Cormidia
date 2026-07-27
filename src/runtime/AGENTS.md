# AGENTS.md

## Scope
`src/runtime/**` — the runtime contract layer and provider adapters. Root
AGENTS.md rules still apply; this file adds the local ones.

## Purpose
`Runtime` interface, critical-ops gate, telemetry, L1–L3 runlog writers, and
the adapters (Claude Agent SDK, Codex App Server, pi SDK).

## Local rules
- This layer imports nothing from `src/loop` or `src/org` — it is the bottom
  of the one-way import direction and what keeps the loop extractable.
- `secret-patterns.ts` is the ONE secret-regex list — redaction and qgates
  both import it. Never fork a second list.
- `file-lock.ts` is the shared O_EXCL + pid/nonce ownership-token +
  liveness/stale-reclamation lock primitive. The app git-clone lock is a
  configuration of it; the settlement and turn locks are the model but not
  yet re-expressed onto it.
- Every `Runtime` must pass `runConformanceSuite(name, makeRuntime, opts)`
  (`test/conformance/`) before its role goes live — proven against
  `src/runtime/testing/fakeRuntime.ts`. Extend the cases; never weaken one to
  make an adapter pass. `test/gate.test.ts` is the seed, including the
  subagent tool-call cases.
- Capability flow is one-way (#116). Follow
  `docs/harness/adding-updating.md` for the adapter contract, registration
  checklist, three test tiers, and update obligations.

## Testing
- Adapter changes (`adapters/**`): also run `pnpm test:live` and record the
  dated result in `research/` — the live conformance run is the only proof
  the subagent-gate claim still holds. `pnpm test:live` spends real tokens,
  skips without usable auth, and is never run by `pnpm test`.
- `gate.ts` changes: add `test/gate.test.ts` cases for every new rule — both
  the critical side and a routine near-miss.

## References
`docs/harness/capability-matrix.md` · `docs/harness/adding-updating.md` ·
`research/2026-07-03_runtime-layer.md` ·
`research/2026-07-04_prompt-caching.md`
