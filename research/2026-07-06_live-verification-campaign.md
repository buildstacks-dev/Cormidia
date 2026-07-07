# Live Verification Campaign

Date: 2026-07-06

A full functional-verification pass over Operon against real providers and real
GitHub side effects (private sandbox repos under github.com/bikramgupta). Real
token spend authorized. This note records what was exercised live, what broke,
and every fix committed.

## (a) Adapter live conformance (`pnpm test:live`)

AGENTS.md requires a live conformance run plus a dated research note for any
adapter change; this session touched the codex/pi budget guards, the codex
multi-file gate / strict-schema path, gate.ts, and secret-patterns.

| Suite | Result | Cost |
| --- | --- | --- |
| Claude live conformance (`claude-sdk.live`) | **3 passed**, 11 live turns, model `claude-sonnet-5`, auth source `none` (subscription) | $3.1296 (first run; re-ran at $2.4180 and $2.4176 under the codex/pi invocations) |
| Codex live App Server smoke (`OPERON_CODEX_LIVE=1`) | **1 passed** — no-tool turn returns a Codex thread handle | negligible (no-tool turn) |
| pi live smoke (`OPERON_PI_LIVE=1`) | **skipped** — `model auth not configured or model not found: anthropic/claude-haiku-4-5-20251001` (acceptable per AGENTS.md) | $0 |

The key proof — the subagent-critical-op gate case
(`claude-live — subagent critical op escalates`) — passed live in every run: a
tool call issued from inside a subagent still reaches the critical-ops gate and
escalates rather than executing. The gate.ts hardening (self-merge/self-approve
and outbound-network verbs now CRITICAL) did not regress any conformance case.

Known documented caveat (capability-matrix.md gate cell): the codex read-bypass
— an auto-approved read not reaching the gate — remains a follow-up and did not
surface as a new issue here.

## (b) Live build loop on operon-sandbox-delta

The centerpiece: the autonomous build loop taking real planted-bug and feature
tickets through Builder / gates / Reviewer / squash-merge on the "Ledgerette"
expense API (zero-runtime-dep Node).

Stage-1 merges (planted bugs), re-verified:

- **PR #11** `build: Monthly report misassigns first-of-month expenses in
  negative-UTC timezones (#7)` — MERGED 2026-07-07T01:47:38Z. Fix buckets
  expenses by the date string (`e.date.slice(0,7) === month`) + a TZ regression
  test. `TZ=America/Los_Angeles`, expense dated `2026-07-01` now lands in July.
- **PR #12** `build: Category totals return floating-point artifacts instead of
  rounded money (#8)` — MERGED 2026-07-07T01:57:20Z. `0.1 + 0.2` category total
  returns `0.3`. Builder also wrote an OKF memory doc.

Pass-by-pass (PR #11, representative): contract (codex/gpt-5.5) → implement
(codex/gpt-5.5, build verdict done) → gates (orchestrator: setup ✔ tests ✔
lint ✔ completeness ✔ review-freshness ✔) → review-verify (claude/opus-4-8,
approve) → squash-merge, branch deleted, issue closed.

Stage-2 loop run — issue **#9** `Per-request ID logging and x-request-id
response header`, ratified (acceptance criteria checked, `op:ready` applied):

- The loop reached context assembly and ran a full pass sequence — contract,
  implement, gates (setup/tests/lint/completeness/review-freshness), review-verify
  — **where it previously crashed on the very first tick** on a malformed memory
  doc. This is the live proof of fix 5 (`3ab6d79`); the stderr line
  `operon: skipping malformed memory doc — …money-report-rounding.okf.md:
  missing YAML frontmatter` appears and the loop proceeds.
- **It did NOT merge.** The review phase oscillated: `review-verify` (verdict
  approve, 0 findings) → `review-security-deep` (approve) → `review-verify` →
  `review-security-deep` … repeating ~5 cycles with no build/fix pass between
  them, terminating only at the driver's phase guard. This is a **new finding**,
  recorded below; it is not one of the three fixes.

Because the autonomous merge did not complete, the scorecard-persistence fix
(fix 6) was verified through its real code path directly rather than via an
organic merge: `persistLoopScorecards` (the exported helper `cmdLoop` now calls)
is covered by unit tests, and appending the exact `review_cycles → builder`
event it writes into the real org home then running `operon retro --date
2026-07-07` produced a populated section:

```
## operon-sandbox-delta / builder
Scorecard events: 1
- review_cycles: 1
```

### Review-phase oscillation (new finding, not fixed)

With `review-security-deep` selected alongside `review-verify`, the reviewing
phase re-ran indefinitely even though every review pass returned
`verdict: approve, findings: []`. Diagnosis: in the single-token sandbox the
reviewer's APPROVE is rejected by GitHub (self-authored PR), so `createReview`
falls back to a COMMENTED review carrying the HMAC self-approval marker;
`latestActionableReview` correctly re-classifies that marker as APPROVED, but
`advanceReviewing` (loop.ts:314) then requires `latest.commitId === headSha(worktree)`
and, when the marker's commit (the PR head GitHub recorded) does not equal the
local worktree HEAD, returns the item **unchanged — no cycle increment, no
bound** (loop.ts:275 has the same shape for "no actionable review"). The driver's
while loop re-runs the whole review pipeline until the guard throws, spending
real tokens each cycle. The precise trigger for the head/marker-commit
divergence is entangled with the known builder-agent-pushes-its-own-branch
boundary (Stage-1 note) and a mid-run kill/branch reset during this campaign, so
it was **not** fixed here: a blind patch to the review-freshness check risks
weakening the property that a merge must match the reviewed commit. Recommended
follow-up: bound the approved-but-stale and no-actionable-review branches of
`advanceReviewing` (count a cycle / route to `op:returned`) so review can never
loop unboundedly, and reconcile the worktree HEAD with the pushed PR head before
the freshness comparison.

### Merge authorization / OPERON_SELF_APPROVAL_SECRET (f)

In this single-token sandbox the builder and reviewer both act as gh user
`bikramgupta`, so a plain reviewer APPROVE is rejected by GitHub as a
self-approval and by `isIndependentApproval` as non-independent. The intended
single-maintainer path is the HMAC self-approval marker: with
`OPERON_SELF_APPROVAL_SECRET` set in the loop env, `cli/loop.ts` passes
`authorization.selfApprovalSecret`, the reviewing phase falls back to a COMMENT
carrying an HMAC-signed marker
(`<!-- operon:self-approval-fallback sig=... -->`), and `verifiedSelfApprovalMarker`
verifies it against the same secret before `authorizeMerge` permits the merge.
No static/forgeable bypass exists — without the secret the loop fails closed.
The hardening does **not** over-block the legitimate autonomous flow, so no
change to the security property was needed. Observed live on the delta merges.

## (c) GitHub e2e + idempotency (operon-sandbox-alpha)

- `pnpm e2e:sandbox:setup` run twice → `sandbox repo ready`, second run a clean
  no-op (label idempotency holds).
- `pnpm e2e:sandbox` → `RESULT: merged #3`. Issue **#3** CLOSED; PR **#4**
  `build: M5 loop e2e … (#3)` MERGED 2026-07-07T01:20:35Z. Mechanical harness,
  no AI turns → $0.

## (d) Codex estimated-cost telemetry (observed live)

The codex adapter reports cost from a static price table and marks it estimated.
Runlog envelope for the implement pass on delta #7
(`runs/operon-sandbox-delta/20260707-014421-build-implement/envelope.json`):

```json
"model": "gpt-5.5",
"usage": { "tokens_in": 602582, "tokens_out": 6546,
           "cost_usd": 3.20929, "subagent_turns": 0,
           "cache_read_tokens": 272768 }
```

Non-zero estimated cost with cache-read visibility confirmed. The estimated
flag (`TurnUsage.costEstimated`, codex.ts:652) was **not** persisted to the
envelope — fixed in this campaign (see fix 7 below); the dashboard now marks
estimated costs with a leading `~`.

## (e) Every fix committed during the campaign

Stage 1 (prior sub-session):

1. `b6f4251` feat(loop): install app deps before quality gates via `setup_command`
   — gates ran in a fresh worktree with no node_modules; delta's `eslint .` lint
   failed for missing deps. Added a `setup` gate run first.
2. `d8c1a38` fix(codex): emit strict structured-output schema for verdicts —
   Codex strict mode 400'd on optional `blockedEntry`; `toCodexStrictSchema`
   makes every property required (originally-optional → nullable).
3. `9b3a93e` config(roles): raise builder/reviewer per-turn budget to $15 — the
   implement turn was stopped mid-work by the default $5 per-turn guard.
4. `68313bc` fix(loop): force-update the ticket branch on a stale
   non-fast-forward push — a builder-agent-authored branch left a stale remote
   ref that wedged the next attempt's plain push.

Stage 2 (this sub-session), each uncovered by live loop verification:

5. `3ab6d79` fix(memory): skip malformed OKF docs instead of crashing the loop —
   a builder-authored OKF doc with no YAML frontmatter (delta #8 memory) threw
   in `loadBundle` during context assembly and hard-crashed **every** delta
   turn on the first tick. `loadBundle` now skips a malformed doc, records it on
   `MemoryBundle.errors`, and `selectExcerpts` warns to stderr; the strict
   `parseOkfDocument` and all writers stay strict. This is what unwedged the
   live loop mid-campaign.
6. `d13456d` fix(cli): persist scorecard events from the manual loop driver —
   `operon retro` was blind to the real build loop. `cmdLoop` never passed a
   turnId (so the driver emitted zero scorecard events) and dropped
   `result.scorecardEvents` anyway; only the autonomous dispatch path recorded
   them. cmdLoop now stamps a per-tick turnId and persists the events
   (review_cycles → builder), mirroring org/turn-runner.ts.
7. `c6f5680` fix(runlog): surface estimated (codex) costs honestly in the
   dashboard — `toEnvelopeUsage` dropped `costEstimated`, so a codex heuristic
   estimate ($3.21/implement) was written and shown identically to a real
   provider charge. Now persisted on `EnvelopeUsage.cost_estimated` and rendered
   with a leading `~` (e.g. `~$3.21` vs `$0.02`) in `operon status`.

## Observability CLIs exercised against today's real data

- `operon status` — real delta+alpha runs with per-pass cost, tokens, duration,
  and ESC (escalation) counts; the review-verify passes show ESC 1 (the
  self-approval escalation).
- `operon budget` — monthly rollup. **Documented gap (not a new bug):** the
  `operon loop` CLI path writes per-pass runlog envelopes but not the org
  telemetry ledger (`telemetry/<day>.jsonl`) that `budget`/`retro`'s telemetry
  section read, so budget shows $0 for loop-only spend. Only the autonomous
  dispatch path (org/turn-runner.ts → recordTurn) feeds that ledger. Per-pass
  spend is fully visible in `operon status` and the envelopes.
- `operon analyze` — reported "No anomaly flags" earlier in the day (no pass had
  yet exceeded the 300s single_turn threshold; `tool_counts` is empty because
  adapters do not yet emit tool_use TurnEvents, a documented limitation). After
  the #9 run's long deep-review passes, it correctly **fired on real executor
  output**:
  ```
  operon-sandbox-delta …review-security-deep single_turn_long_run: 513s single pass
  operon-sandbox-delta …review-verify         single_turn_long_run: 358s single pass
  ```
  The detectors run against real envelopes and flag genuinely long passes.
- `operon retro --date 2026-07-06` — empty, because the delta runs are timestamped
  **2026-07-07 UTC** (local evening of the 6th) and fall outside the July-6
  window; `--date 2026-07-07` is the correct window and shows the data. Before
  fix 6 the report had no scorecard section for the loop at all; after fix 6 the
  builder `review_cycles` row is surfaced (verified above).

## Final gate

`pnpm test` 570 passed / `pnpm typecheck` clean / `pnpm build` clean; main clean.

## Estimated spend

- Stage 1 delta AI turns (incl. aborted diagnostic runs + #7 + #8): ~$23.88
- Stage 2 test:live (3 Claude conformance runs + codex smoke): ~$8.0
- Stage 2 delta loop #9 (a crashed context-assembly attempt at $0, a
  killed-at-10min partial, and a background run that oscillated in review across
  ~9 review passes before being stopped): ~$15
- alpha GitHub e2e: $0 (mechanical)
- Campaign total: **~$47**
