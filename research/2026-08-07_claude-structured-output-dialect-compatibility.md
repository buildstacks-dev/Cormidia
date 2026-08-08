# Claude structured-output dialect compatibility — live run-1 finding

Date: 2026-08-07 (America/Los_Angeles)

## Observation

The first real L-ACC run-1 S-ACC-1 Planner invocation used packaged
`cormidia@0.1.1` with Claude Agent SDK `0.3.224` and Claude Code through the
subscription connection. The process failed before provider construction:

```text
Error: --json-schema is not a valid JSON Schema: no schema with key or ref
"https://json-schema.org/draft/2020-12/schema"
```

Durable evidence is the isolated campaign run
`20260808-063136-episode-planner-plan-f8a9edf1`. Its telemetry row records
`usageQuality: unavailable`, zero observed tokens, and no provider session.

## Repair

Cormidia retains the canonical 2020-12 proposal schema and all local validation.
At the Claude adapter boundary only, it removes the top-level `$schema` dialect
metadata before supplying the SDK's `outputFormat.schema`. No constraint is
removed or translated. The adapter double pins the exact transformed object.

## Resumed-run outcome

The same authorized run resumed against packaged commit
`e52b304ac8f6a00be973e265b84af8533c59dd72`. The repaired Claude EpisodePlanner
completed at 2026-08-08T06:46:36Z with 7,640 output tokens, and its ticket-plan
step completed with 20,489 output tokens. That confirms the specific dialect
rejection no longer blocks this proposal schema.

The campaign later stopped at its plan gate and remains inconclusive; this
record does not certify a new adapter version or alter the existing capability
claim. See `acceptance/run-1-result.md` for the terminal evidence index.
