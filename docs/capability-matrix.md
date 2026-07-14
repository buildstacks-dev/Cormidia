# Runtime Capability Matrix

*M10, updated 2026-07-13 UTC. This table is the explicit contract for what an
org loses or keeps when roles move between runtime adapters.*

Capability quality and provider accounting use `docs/efficiency.md`: every
adapter invocation is a provider turn with exactly one settlement, missing or
estimated usage stays labeled by quality, and adapter readiness cannot be
inferred from configuration presence alone.

| Capability | ClaudeRuntime | CodexRuntime | PiRuntime |
| --- | --- | --- | --- |
| Gate enforcement | **Native + adapter-built.** Claude SDK `PreToolUse` is the primary gate, with `canUseTool` as a fail-closed backstop (`src/runtime/adapters/claude.ts`); fires for every tool call, including auto-allowed read-only bash. | **Native + adapter-built on a constrained tool surface.** Every real turn installs an automation-vetted `PreToolUse` hook that carries supported simple Bash, `apply_patch`, and MCP calls over a fail-closed per-turn Unix socket into Operon's in-process `hooks.gate`; a multi-file patch gates **every** file. App Server approval requests remain a backstop (`src/runtime/adapters/codex-gate-bridge.ts`, `src/runtime/adapters/codex-gate-hook.ts`, `src/runtime/adapters/codex.ts`). Operon supplies both the public trust-bypass flag and its explicit session-config equivalent because Codex CLI 0.142.5's `app-server` dispatch drops the global flag; a token-free `config/read` check pins the effective override to `sessionFlags`. Because OpenAI documents `PreToolUse` as a guardrail rather than a complete enforcement boundary, Operon disables the incompletely intercepted `unified_exec` path plus apps, plugins, in-app browser, web search, and image viewing for these turns. The claim is deliberately limited to that constrained surface and remains live-calibration-gated. | **Adapter-built.** pi has no first-class approval flow, so Operon installs a `tool_call` extension that blocks on gate denial (`src/runtime/adapters/pi.ts`, `src/runtime/adapters/pi-gate.ts`). |
| Context channel | **Native.** ContextBundle is rendered into SDK system-prompt append; no files written (`src/runtime/adapters/claude.ts:122`, `src/runtime/adapters/claude.ts:208`). | **Native.** ContextBundle is sent as App Server `developerInstructions` on thread start/resume (`src/runtime/adapters/codex.ts:229`, `src/runtime/adapters/codex.ts:431`). | **Adapter-built native file.** ContextBundle is written to `.pi/APPEND_SYSTEM.md` and masked via `.git/info/exclude` (`src/runtime/adapters/pi.ts:98`, `src/runtime/worktree-context.ts:19`). |
| Session resume | **Native.** Session id is passed through SDK `resume` and returned in `TurnResult.session` (`src/runtime/adapters/claude.ts:222`, `src/runtime/adapters/claude.ts:285`). | **Native.** Thread id drives `thread/resume` and returns as `TurnResult.session` (`src/runtime/adapters/codex.ts:230`, `src/runtime/adapters/codex.ts:262`). | **Native.** Session file path/id drives `SessionManager.open`; result stores the session file path when present (`src/runtime/adapters/pi.ts:108`, `src/runtime/adapters/pi.ts:177`). |
| Large-payload transport | **Native stream.** Task text is passed through SDK stdin/query stream, not argv (`src/runtime/adapters/claude.ts:238`). | **Native JSON-RPC.** Task text is sent in `turn/start` input over stdio JSONL (`src/runtime/adapters/codex.ts:236`, `src/runtime/adapters/codex.ts:437`). | **Native SDK call.** Task text is passed to `session.prompt()` in-process (`src/runtime/adapters/pi.ts:152`). |
| Token/cache telemetry | **Native.** Claude result usage includes uncached, cache write, cache read, output, cost, and duration (`src/runtime/adapters/claude.ts:286`). | **Adapter-built + estimated cost.** App Server token usage notifications map to `TurnUsage`; the App Server reports **no** dollar cost, so `costUsd` is an Operon estimate from documented per-token list prices (`gpt-5.5` $5/$30, `gpt-5.4` $2.50/$15, `gpt-5.4-mini` $0.75/$4.50 per MTok; source `research/2026-07-05_model-id-verification.md`) and is flagged `costEstimated: true`. Cached input tokens are conservatively priced at the full input rate and unrecognized models default to the flagship rate — the estimate over- but never silently under-counts (`src/runtime/adapters/codex.ts:667`, `src/runtime/adapters/codex.ts:692`, `src/runtime/adapters/codex.ts:731`). | **Adapter-built.** pi session stats map input/cache/output and **provider-reported** cost into `TurnUsage` (`src/runtime/adapters/pi.ts:159`, `src/runtime/adapters/pi.ts:184`). |
| Per-turn budget cap (`role.maxTurnBudgetUsd`) | **Native running guard.** The cap is passed to the SDK as `maxBudgetUsd`; the CLI stops the turn mid-run and returns `error_max_budget_usd`, which maps to `failed` + exactly one incident note (`src/runtime/adapters/claude.ts:221`, `src/runtime/adapters/claude.ts:265`). | **Adapter-built running guard on the estimate.** The App Server exposes no budget knob, so Operon compares the running **estimated** cost against the cap on each token-usage update and, on crossing, stops the turn (closing the client → terminating the App Server turn) → `failed` + exactly one incident note. What is capped is the *estimate*, not a provider-measured figure (`src/runtime/adapters/codex.ts:324`, `src/runtime/adapters/codex.ts:251`). | **Adapter-built running guard.** pi has no budget knob, so Operon polls the running (provider-reported) cost at each turn boundary and calls `session.abort()` on crossing, with a defensive final-cost check for a single jump past the cap → `failed` + exactly one incident note (`src/runtime/adapters/pi.ts:145`, `src/runtime/adapters/pi.ts:163`). |
| Role toolset shaping (forbidden acts unrepresentable) | **Native.** Builder/reviewer turns inject permission deny rules (`gh pr merge`/`gh pr review`, `kubectl`/`doctl`, `~/.claude` + `~/.codex` writes) via inline SDK `settings.permissions.deny`; the CLI's own permission layer refuses the call even when the Operon gate would allow it — live-proven by the shaping probe in `test/runtime/claude-sdk.live.test.ts` (`src/runtime/role-shaping.ts`, `src/runtime/adapters/claude.ts`). | **Degraded.** The App Server exposes sandbox modes but no per-command deny list. On the constrained surface above, the hook bridge and approval backstop enforce the composed gate's flat role deny (`src/org/gate-compose.ts`, `src/runtime/adapters/codex-gate-bridge.ts`). | **Degraded.** pi exposes only a coarse read/bash/edit/write toolset — dropping `bash` would cripple the role, so the composed gate's flat role deny is the enforcement. |
| Intra-turn fan-out | **Native.** Claude subagent starts emit `subagent` events and count `subagentTurns` (`src/runtime/adapters/claude.ts:241`). | **Native.** App Server `subAgentActivity` and `collabAgentToolCall` items emit `subagent` events and increment `subagentTurns` (`src/runtime/adapters/codex.ts:364`, `src/runtime/adapters/codex.ts:370`). | **Degraded.** pi has no native intra-turn subagent fan-out; Operon records a note artifact when `delegation.allow` is configured, and the gate extension only recognizes subagent-like metadata if a pi extension supplies it (`src/runtime/adapters/pi.ts:221`, `src/runtime/adapters/pi-gate.ts:69`). |
| Tool-event emission (`tool_use` turn events → L2 `tool.called` + envelope `tool_counts`) | **Adapter-built, pre-execution.** Every gate-allowed tool action emits one `tool_use` from the SDK `PreToolUse` gate closure *before* the tool runs, so success/duration are never set; denied attempts are escalations, not tool activity (`src/runtime/adapters/claude.ts:169`). All three adapters build the event through the ONE shared builder so the `environment_retry` classification cannot drift (`src/runtime/tool-events.ts`). | **Adapter-built, post-execution.** Completed App Server items carry the outcome: `commandExecution` emits with real exit-code success and duration when reported (`src/runtime/adapters/codex.ts:372`); `fileChange` emits **one `tool_use` per changed file** (a bare item still emits one, so a write is never invisible) with no outcome fields (`src/runtime/adapters/codex.ts:392`). Approval-declined commands never reach `item/completed`, so only executed tools are counted. | **Adapter-built, pre-execution.** The gate extension emits `tool_use` for each allowed action before pi runs it — no outcome fields, same as Claude (`src/runtime/adapters/pi-gate.ts:65`). |

The shared conformance suite covers gate verdicts, subagent-like gate ordering,
and 300 KB payload transport for mocked Codex and pi adapters; Claude also has
the established live conformance file. The per-turn budget guard is pinned per
adapter with a mocked SDK — `test/runtime/claude-budget.unit.test.ts`,
`test/runtime/codex-budget.unit.test.ts` (including the estimated-cost pricing
table), and `test/runtime/pi-budget.unit.test.ts` — each asserting the
under-budget / over-budget split, the single incident note, and that spend is
still attributed. Codex and pi live smokes are opt-in in `pnpm test:live`
because they spend provider quota and depend on local auth.

Terminal provider failures are evidence, not completions. Claude retains an
explicit non-success SDK result (and its usage) even if the SDK iterator then
rejects because the owned CLI exited non-zero. Pi maps terminal assistant
`stopReason: "error"` messages to `failed`, classifying authentication-like
messages as `error_auth`; it never fabricates successful zero-token work.

Non-billable readiness requires usable request authentication, not stale
account presence. First-party Claude combines SDK initialization with
`claude auth status --json` in the exact subprocess environment: a concrete
token/API-key source or an authoritative `loggedIn: true` is required, while
email/subscription metadata alone is insufficient. On macOS, Claude.ai
subscription credentials live in the encrypted Keychain rather than a
copyable credential file. Eval therefore gives only the Claude subprocess its
authenticated default HOME/config context; filesystem settings, personal
skills/plugins, and session persistence remain disabled, and a fail-closed tool
sandbox denies host-home reads while re-allowing the eval worktree and confines
writes to that cwd; the Operon gate independently denies every tool path outside
the worktree. External Claude providers retain their native credential chain.
Pi first performs its cheap configured-auth check, then resolves the file-backed
credential and requires the concrete non-empty API key that its SDK will send. An expired
OAuth record therefore fails before a model turn instead of being discovered
by one.

## Qualification evidence

Provider capability claims are campaign inputs, not inferred successes. An
efficiency campaign pins the runtime/model/effort and capability reference,
records cache and usage quality exactly as observed, and treats unsupported or
unobservable fields as unavailable rather than zero. Missing required auth or
usage makes the campaign incomplete/invalid.

The 2026-07-12 baseline non-billable probe confirmed Claude Max first-party
authentication and a ChatGPT Pro Codex account. Its dollar values are
equivalent-cost indicators because both turns used subscriptions. Codex usage
remained `estimated`; Claude usage remained provider-complete. The dated result
is `research/evals/2026-07-12-pre-transformation-baseline.md`.

The retained 2026-07-13 adapter campaigns
`adapter-harness-calibration-v1-20260713-524ab18c52d8` and
`adapter-harness-calibration-v1-20260713-dd84b826242c` are intentionally
invalid. The first preserved 20 ledger settlements and $5.118445 while its
attempt summaries were incomplete or misleading. The exactly authorized
post-repair run preserved six settlements and $1.55126, then exposed
metadata-only readiness, dropped Codex hook-trust activation, and an
undersized continuation cap. Both repair rounds are covered offline and
documented in `research/evals/2026-07-13-adapter-calibration-repair.md`; none of
the repaired claims was qualified at that stage. The final content-hashed
campaign below supplies that proof.

The later prepared and authorized campaigns
`adapter-harness-calibration-v1-20260713-0fdc5399d224` and
`adapter-harness-calibration-v1-20260713-d11efc466a7f` were invalidated before
any GitHub mutation or provider turn. Comparing the same Claude CLI inside and
outside the execution sandbox showed that the host was authenticated all
along; the restricted process could not access Keychain, and the original
provider scratch also replaced the HOME/config context that selects the
Keychain credential. Both manifests spent zero and are not calibration
evidence.

The auth-correct campaign
`adapter-harness-calibration-v1-20260713-473eb4f39381` proved that Claude could
authenticate and execute a tool under the repaired boundary, but remained
invalid overall. Its token-dense 300 KB transport filler caused Claude and
Codex budget stops; pi returned the same external third-party-extra-usage HTTP
400 on both its primary and declared retry. Seven settlements reconciled at
$5.47642. The transport probe now keeps the byte-size proof with whitespace
padding. For the fresh calibration, the operator switched pi to its existing
`openai-codex/gpt-5.5` OAuth route; the explicit provider prefix avoids an
ambiguous bare-model lookup in pi's multi-provider registry. The terminal
campaign is evidence, never a rerun target.

The fresh pi-over-Codex campaign
`adapter-harness-calibration-v1-20260713-d5992688efa1` passed pi's complete
applicable calibration surface, but was invalid overall. Claude continuation
exposed the harness contradiction between a resume claim and
`persistSession: false`; Codex exposed that a 1.5-second cancellation fallback
could precede its first usage checkpoint. The latter is now 20 seconds and an
executor double-count of invalid-attempt cost is repaired. The retained ledger
has 24 exactly-once settlements and $3.06913525 equivalent cost. A fresh
campaign still required an explicit safe storage choice for Claude's
Keychain-authenticated resumable transcript. The harness subsequently enabled
bounded persistence only for the declared calibration profile and exact SDK
session cleanup, without extracting a Keychain credential.

Campaign `adapter-harness-calibration-v1-20260713-72690b61e12b` then passed the
Codex and pi surfaces and proved Claude transport, gate, continuation, and
cancellation behavior, but an undersized Claude role-shaping allocation made
the overall result a validly recorded `budget_stop`, not a qualified campaign.
That allocation and the L4 idempotence receipt were repaired without rewriting
the terminal evidence.

The final content-hashed campaign
`adapter-harness-calibration-v1-20260713-9c3b336d6842` qualified all declared
adapter claims. Claude, Codex, and pi passed without retry; L4 passed twice with
a durable idempotence receipt; and L5 retained 20 provider turns, 20
exactly-once settlements, three real mechanical permission-boundary proofs,
and $2.26656275 total equivalent cost. Claude continuation and native role
shaping passed, and all six exact SDK sessions were deleted after grading. This
qualifies adapter admission for the content-hashed snapshot. It does not
qualify the broader product, the replacement baseline, candidate evaluation,
or L6 soak.
