# 2026-07-06 — M6 sandbox loop v1 live proof

Target: `bikramgupta/operon-sandbox-alpha`

Result: **merged**. Operon took issue
https://github.com/bikramgupta/operon-sandbox-alpha/issues/1 through real
Claude Builder/Reviewer passes and merged PR
https://github.com/bikramgupta/operon-sandbox-alpha/pull/2 as squash commit
`d71f965aa4aeddc1142e8e65f55bae5fe67c471c`.

Ticket: add one regression test named `median handles duplicate values` in
`test/index.test.js`. Builder produced commit `beede7c` on
`op/1-add-duplicate-value-median-regression-test`; the final squash commit
on `main` is `d71f965`.

Evidence:

- Issue #1 is closed; PR #2 is merged.
- Alpha post-merge: `npm test && npm run lint` passed. `npm test` reported
  5/5 passing tests, including `median handles duplicate values`.
- Beta regression check: `npm test` passed, 4/4 tests.
- Gamma was not present locally at `/Users/bikram/Build/operon-sandbox-gamma`.
- Final loop dry runs: alpha and beta both printed no ready tickets.

Live-run findings fixed during M6:

1. `loadGateCommands()` returned early when `.operon/config.yaml` existed
   without explicit `test_command` / `lint_command`, so alpha gates could not
   see package scripts. Fixed by merging config overrides with `package.json`
   fallback commands; covered in `test/driver.test.ts`.
2. GitHub rejects same-account `APPROVE` reviews. During the laptop pilot the
   same authenticated user creates the PR and records the review, so
   `GhCliOps` now falls back only for that exact GitHub error to a real
   COMMENTED PR review carrying `<!-- operon:self-approval-fallback -->`.
   The loop accepts only that marked structured `Verdict: approve` review as
   approval and still requires freshness. Covered in `test/github.test.ts` and
   `test/loop.test.ts`. Replace this with a real bot/GitHub App reviewer
   identity when M7/M10 harden operations.

Run log artifacts live under:
`~/.operon/operon/runs/operon-sandbox-alpha/`.
