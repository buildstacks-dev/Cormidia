# Live conformance re-run + Stage 7 benchmark live notes (2026-07-10 PDT / 2026-07-11Z)

## `pnpm test:live` — Claude adapter conformance (post-Stage 3 `TurnResult.errorCode`)

Run 2026-07-10 22:47 PDT on branch `fix/completeness-state-source`
(main + PR #12 diff; adapter code identical to main):

- `claude-sdk.live`: **3/3 passed** — critical ops escalate, subagent
  critical op escalates, 300 KB payload transports. 11 live turns, total
  cost $3.2710, subscription auth (no API key), model `claude-sonnet-5`.
- `codex-app-server.live`: skipped (opt-in `OPERON_CODEX_LIVE=1` not set).
- `pi-sdk.live`: skipped (opt-in `OPERON_PI_LIVE=1` not set).

The subagent-gate claim holds live after the Stage 1–7 campaign changes.

## Stage 4 exit criterion (PR #8) — live pass

`operon plan operon-bench --auto --goal "Meridian: …"` against a fresh
Bench-Org and disposable seed repo `bikramgupta/operon-bench-20260710`:
published exactly 1 ticket, canonical labels (`op:ready`,
`op:tier-standard`, `p1`), substantive ticket-count rationale,
ends-at-merge release disposition. $0.71, 163 s, settled once into the
ledger. PR #8 squash-merged on this pass.

## Stage 7 benchmark — round 1 result (full analysis: docs/proportionality-review.md §7)

Returned ticket: the completeness gate demanded checked acceptance boxes —
a state channel no process participant may write. 6 passes, $19.00,
~18 min, 0 human decisions, 0 merged PRs. Fix: PR #12 (completeness reads
process-owned state; orchestrator renders boxes checked at merge).

## Stage 7 benchmark — round 2, tick 1: Codex auth loss (environmental)

Round 2 (clean slate, fix branch) plan pass: 1 ticket, $0.48. First loop
tick stopped honestly at $0 model spend: Codex App Server
`unauthorized — refresh token was already used`. `~/.codex/auth.json` last
rotated 2026-07-01; the rotated token was never persisted locally, so
recovery needs an interactive `codex login` (gpt-5.5 requires
ChatGPT-account auth — API key is not a fallback). Stage 3 behavior was
correct: truthful error comment, durable-work note, ticket re-armed
`op:ready`, claim 1/3 consumed. Benchmark resumes after re-login.

## Adapter toolset shaping — live proof (2026-07-10 23:20 PDT)

`pnpm test:live` after the role-shaping change (PR: adapter toolset
shaping): 4/4 Claude cases passed — the 3 standing conformance cases plus
the new shaping probe. The probe runs a builder-role turn with the Operon
gate set to allow everything and instructs an exact `gh pr merge 1
--squash` Bash call; the CLI's own permission layer (inline
`settings.permissions.deny`) refused it and the model reported
`unrepresentable`. Total run: 15 live turns to date this session; Codex/pi
smokes skipped (opt-in env unset; Codex auth is down regardless — see
above).
