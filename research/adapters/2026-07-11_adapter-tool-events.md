# Adapter tool_use emission — live verification (2026-07-11)

**Change:** issue #27 (learning-loop Preflight): all three runtime adapters now
emit named `tool_use` TurnEvents so the existing L2 bridge
(`src/loop/pipeline.ts` `flushBridgedEvents`) produces `tool.called` rows and
envelope `tool_counts`, and the anomaly detectors
(`src/runtime/runlog/anomalies.ts`) can fire from real adapter activity:
`bash_heavy` on `tool_counts["bash"] >= 20`, `environment_retry` on >= 3
events tagged by the shared classifier.

## Emission channels (one per adapter, chosen from its native stream)

| Adapter | Channel | Timing | Outcome fields |
| --- | --- | --- | --- |
| Claude (`claude.ts`) | The same `PreToolUse` hook the gate rides — fires for main-thread AND subagent calls | Pre-execution, gate-ALLOWED only | none (unknown pre-execution) |
| Codex (`codex.ts`) | `item/completed` items: `commandExecution` (→ `bash`), `fileChange` (→ one `write` per changed file) | Post-execution | `success` from `exitCode`, `durationMs` when reported |
| pi (`pi-gate.ts`) | The `tool_call` gate extension, on allow | Pre-execution, gate-ALLOWED only | none |

Denied attempts emit nothing — they are gate escalations, not tool activity.
The event builder and the ONE environment-command list live in
`src/runtime/tool-events.ts` (same pattern as `secret-patterns.ts`:
classification can never drift between adapters). `args` ride the event and
are hashed at the L2 boundary, never persisted raw.

## Live conformance run (2026-07-11, this checkout)

`CORMIDIA_CODEX_LIVE=1 CORMIDIA_PI_LIVE=1 pnpm test:live` — **6/6 passed**:

- **Claude live conformance** (real SDK, `claude-sonnet-5`, subscription
  auth `apiKeySource=none`): 12 live turns, **$3.3554** total.
  - critical ops escalate ✓
  - **subagent critical op escalates ✓** (the subagent-gate claim holds with
    tool_use emission active in the same PreToolUse channel)
  - 300KB payload transports ✓
  - role toolset shaping: builder `gh pr merge` unrepresentable ✓
- **Codex App Server live smoke** ✓ (ChatGPT auth, post `codex login`)
- **pi SDK live smoke** ✓

The live suite asserts gate interleaving; emission is additive and did not
disturb any conformance expectation. Offline, the emission itself is pinned
per adapter (`test/runtime/claude-sdk.unit.test.ts`,
`test/adapters/codex.test.ts`, `test/adapters/pi-gate.test.ts`), the
classifier in `test/runtime/tool-events.unit.test.ts`, and the bridge +
detectors end-to-end in `test/loop/pipeline.test.ts` ("bash_heavy and
environment_retry detectors fire on real executor output").

## Notes

- Claude/pi emit pre-execution (their native intercept points), so their
  events carry no success/duration; Codex emits post-execution with both.
  The bridge defaults `success: true`, `durationMs: 0` — acceptable until an
  adapter gains a reliable post-execution channel (Claude `PostToolUse`
  pairing is the known upgrade path if outcome fidelity is ever needed).
- `environment_retry` tags each environment-setup/wait command
  (docker/compose, apt/brew/pip/npm/pnpm/yarn/corepack install-ish verbs,
  sleep/wait-for); the >= 3 threshold lives in the detector, so a single
  legitimate `pnpm install` never flags a run.
