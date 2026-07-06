# M10 Sandbox Verification

Date: 2026-07-06

## Operon Runtime Checks

- `pnpm test` — passed: 63 files, 454 tests.
- `pnpm typecheck` — passed.
- `pnpm build` — passed.
- `pnpm dev roles` — passed; Builder is `codex/gpt-5.5`, Reviewer is
  `claude/claude-opus-4-8`.
- `pnpm dev apps` — passed; alpha, beta, and gamma listed.
- `pnpm dev pipelines` — passed; 12 pipelines.
- `pnpm dev doctor` — passed; Claude, Codex App Server, and pi SDK adapters
  construct.
- `pnpm test:live` — passed Claude live conformance; Codex/pi opt-in smokes
  skipped because `OPERON_CODEX_LIVE=1` / `OPERON_PI_LIVE=1` were not set.

## Sandbox Apps

### operon-sandbox-alpha

- `npm test && npm run lint` — passed: 5 node tests, syntax checks clean.
- `pnpm dev bootstrap --scan-only /Users/bikram/Build/operon-sandbox-alpha`
  — passed.
- `pnpm dev plan operon-sandbox-alpha --topic "M10 adapter smoke" --dry-run --workdir /Users/bikram/Build/operon-sandbox-alpha`
  — passed; context bytes 5121.
- `pnpm dev loop --app operon-sandbox-alpha --once --dry-run` — passed; no
  ready tickets.

### operon-sandbox-beta

- `npm test` — passed: 4 node tests.
- `pnpm dev bootstrap --scan-only /Users/bikram/Build/operon-sandbox-beta`
  — passed.
- `pnpm dev plan operon-sandbox-beta --topic "M10 adapter smoke" --dry-run --workdir /Users/bikram/Build/operon-sandbox-beta`
  — passed; context bytes 5189.
- `pnpm dev loop --app operon-sandbox-beta --once --dry-run` — passed; no
  ready tickets.

### operon-sandbox-gamma

- `npm test && npm run lint && npm run smoke:sre && npm run smoke:support && npm run smoke:marketing`
  — passed: 3 node tests, syntax checks clean, SRE/Support/Marketing artifacts
  present.
- `npm start` then `npm run health` — passed; `/health` returned HTTP 200
  with `{"service":"operon-sandbox-gamma","status":"ok",...}`.
- `pnpm dev bootstrap --scan-only /Users/bikram/Build/operon-sandbox-gamma`
  — passed.
- `pnpm dev plan operon-sandbox-gamma --topic "M10 adapter smoke" --dry-run --workdir /Users/bikram/Build/operon-sandbox-gamma`
  — passed; context bytes 5325.
- `pnpm dev loop --app operon-sandbox-gamma --once --dry-run` — passed; no
  ready tickets.

All three sandbox repos were clean after verification.
