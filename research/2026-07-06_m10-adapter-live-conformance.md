# M10 Adapter Live Conformance

Date: 2026-07-06

Command:

```bash
pnpm test:live
```

Result:

- `test/runtime/claude-sdk.live.test.ts`: passed, 3 tests.
- Claude live conformance ran 11 live turns against `claude-sonnet-5`.
- Reported total cost: `$2.4374`.
- Auth source reported by the SDK init stream: `none`.
- `test/runtime/codex-app-server.live.test.ts`: skipped because
  `OPERON_CODEX_LIVE=1` was not set.
- `test/runtime/pi-sdk.live.test.ts`: skipped because `OPERON_PI_LIVE=1`
  was not set.

Notes:

- CodexRuntime and PiRuntime have offline mocked conformance in the fast suite.
- Codex/pi live files are present and intentionally opt-in because they depend
  on local provider auth and spend real quota.
