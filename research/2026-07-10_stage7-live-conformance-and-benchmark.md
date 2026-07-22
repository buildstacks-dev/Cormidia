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

## Stage 7 benchmark — round 1 result (full analysis: the 2026-07-10 proportionality campaign §7)

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

## Stage 7 benchmark — round 2 result (2026-07-11, after `codex login`)

Resumed after interactive `codex login` restored ChatGPT-account auth. One
loop tick took ticket #1 claim → contract → implement → gates → verify →
security-deep → HMAC-authorized squash-merge (bench PR #2, merge commit
`4d062ee`, 10:11:40Z) in 9 m 04 s of tick wall clock. Round total: $6.83
($0.48 plan + $6.35 loop), 6 ledger passes (the first contract pass being
tick 1's $0 environmental stop), 0 human decisions. Four false-positive
escalations pending (planner `releaseDisposition` prose + both reviewer
`gh pr review --approve` bodies matched pattern rules); none blocked — the
typed verdict channel (PR #13) carried both review outcomes. All five
targets met: 6 passes vs ≤ 8, $6.83 vs ≤ $40, 0 decisions vs ≤ 5, ~11 min
active vs ≤ 90, 1 merged PR vs 1. PR #12 (completeness reads process-owned
state) squash-merged on this proof. Full table:
`the 2026-07-10 proportionality campaign` §7, round 2.

## Codex adapter: `error_auth` classification — live re-run (2026-07-11)

Follow-up to the round-2 telemetry review: tick 1's dead-refresh-token
failure rendered as `failed(error_unknown)`. `CodexRuntime` now classifies
auth-loss failures (refresh/access token, unauthorized, not logged in,
authentication — in App Server `error` notifications and failed
`turn/completed` payloads) as `errorCode: "error_auth"`, the same Stage 3
carve-out budget exhaustion got: operator-actionable failures must not
masquerade as generic ones. `errorSummary` also unwraps nested
`{error:{message}}` payloads so the envelope carries the message, not JSON.
Offline: 699 tests green (3 new: the exact tick-1 payload shape, a
non-auth near-miss staying unclassified, an unauthorized turn/completed)
+ typecheck. Live: `OPERON_CODEX_LIVE=1 pnpm test:live` — Claude 4/4
(subagent-gate + shaping probe hold, 12 turns, $3.35, claude-sonnet-5),
Codex App Server smoke 1/1 on the changed adapter; pi skipped (opt-in
unset). Capability-matrix `codex.ts` line references re-anchored.
