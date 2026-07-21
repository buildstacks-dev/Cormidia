# ISSUE-017 live provider-sandbox environment verification

Date: 2026-07-21 UTC
Candidate base: `a6cc856` (`codex/run2-issue017` working candidate)

ISSUE-017 reported that provider turns were headless but did not set `CI=true`,
so pnpm selected an interactive path that no process could answer. Deterministic
adapter tests first proved the canonical environment overlay at each native
seam: Claude SDK `options.env`, Codex App Server launch environment, and pi's
embedded Bash spawn hook.

One live builder turn then verified that the real Codex App Server forwards the
overlay into a workspace-write shell. The temporary dependency-free pnpm
project had network disabled, touched no org or GitHub state, used low effort,
disabled test retries, and carried a `$0.50` hard turn cap.

```console
$ OPERON_CODEX_LIVE=1 pnpm exec vitest run --config vitest.live.config.ts test/runtime/codex-app-server.live.test.ts -t "runs a pnpm install with the canonical non-interactive sandbox environment" --retry=0

Tests  1 passed | 1 skipped
status: completed
successfulProbe: true
session: 019f8351-d302-71b2-83ab-227f42035af9
tokensIn: 31,964 (21,980 uncached; 9,984 cache read)
tokensOut: 215
estimated cost: $0.16627
wall clock: 10,006 ms
```

The single allowed Bash command asserted all four values inside the live
sandbox and then completed `pnpm install --offline --frozen-lockfile`:

```sh
test "$CI" = "true" &&
test "$NPM_CONFIG_YES" = "true" &&
test "$DEBIAN_FRONTEND" = "noninteractive" &&
test "$GIT_TERMINAL_PROMPT" = "0" &&
pnpm install --offline --frozen-lockfile
```

The adapter emitted the completed command with `success: true`; the provider
returned exactly `OK`. No retry or second provider turn ran.
