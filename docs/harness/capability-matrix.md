# Runtime Capability Matrix

*M10, updated 2026-07-19 UTC. This table is the explicit contract for what an
org loses or keeps when roles move between runtime adapters.*

`src/runtime/capabilities.ts` is the matching machine contract. Its
`native | adapter | fallback | unsupported` tiers render inside each selected
turn as `native | adapter-built | fallback (degraded) | unsupported` guidance.
That profile-derived note is descriptive: role tools, permissions, and
approval boundaries remain unchanged.

Capability quality and provider accounting use `docs/efficiency.md`: every
adapter invocation is a provider turn with exactly one settlement, missing or
estimated usage stays labeled by quality, and adapter readiness cannot be
inferred from configuration presence alone.

Host scheduling is provider-independent. Phase 5 supports org-scoped launchd
installation and bounded status inspection on macOS; systemd user-timer output
shares the definition/manager boundary but is representation-only until it is
exercised on a supported host. Scheduler lifecycle, empty windows, missed-tick
reconciliation, and status aggregation construct no adapter. Scheduled
provider work enters the ordinary adapter path and must retain one settlement
per provider turn. The canonical platform contract is
[`docs/scheduler/design.md`](../scheduler/design.md).

| Capability | ClaudeRuntime | CodexRuntime | PiRuntime |
| --- | --- | --- | --- |
| Gate enforcement | **Native + adapter-built.** Claude SDK `PreToolUse` is the primary gate, with `canUseTool` as a fail-closed backstop (`src/runtime/adapters/claude.ts`); fires for every tool call, including auto-allowed read-only bash. | **Native + adapter-built on a constrained tool surface.** Every real turn installs an automation-vetted `PreToolUse` hook that carries supported simple Bash, `apply_patch`, and MCP calls over a fail-closed per-turn Unix socket into Operon's in-process `hooks.gate`; a multi-file patch gates **every** file. App Server approval requests remain a backstop (`src/runtime/adapters/codex-gate-bridge.ts`, `src/runtime/adapters/codex-gate-hook.ts`, `src/runtime/adapters/codex.ts`). Operon supplies both the public trust-bypass flag and its explicit session-config equivalent because Codex CLI 0.142.5's `app-server` dispatch drops the global flag; a token-free `config/read` check pins the effective override to `sessionFlags`. Because OpenAI documents `PreToolUse` as a guardrail rather than a complete enforcement boundary, Operon disables the incompletely intercepted `unified_exec` path plus apps, plugins, in-app browser, web search, and image viewing for these turns. The claim is deliberately limited to that constrained surface and remains live-calibration-gated. | **Adapter-built.** pi has no first-class approval flow, so Operon installs a `tool_call` extension that blocks on gate denial (`src/runtime/adapters/pi.ts`, `src/runtime/adapters/pi-gate.ts`). |
| Context channel | **Native.** ContextBundle, including the profile-derived execution note, is rendered into SDK system-prompt append; no files written (`src/runtime/adapters/claude.ts`, `src/runtime/worktree-context.ts`). | **Native.** ContextBundle, including the same note, is sent as App Server `developerInstructions` on thread start/resume (`src/runtime/adapters/codex.ts`, `src/runtime/worktree-context.ts`). | **Adapter-built native file.** ContextBundle, including the same note, is written to `.pi/APPEND_SYSTEM.md` and masked via `.git/info/exclude` (`src/runtime/adapters/pi.ts`, `src/runtime/worktree-context.ts`). |
| Structured verdict | **Native.** A requested verdict schema is passed through the SDK's JSON-schema output format (`src/runtime/adapters/claude.ts`). | **Adapter-built.** Operon converts the portable verdict schema to the App Server's strict `outputSchema` shape (`src/runtime/adapters/codex.ts`). | **Fallback (degraded).** pi receives the runtime-agnostic protocol text, while the loop's lenient parser validates the returned verdict; there is no native schema constraint. |
| Cancellation | **Native.** Operon's signal is forwarded into the SDK query abort controller (`src/runtime/adapters/claude.ts`). | **Adapter-built.** Operon closes and terminates the App Server client/process for the active turn (`src/runtime/adapters/codex.ts`). | **Adapter-built.** Operon forwards cancellation to `session.abort()` and preserves the stopped result (`src/runtime/adapters/pi.ts`). |
| Session resume | **Native.** Session id is passed through SDK `resume` and returned in `TurnResult.session` (`src/runtime/adapters/claude.ts:222`, `src/runtime/adapters/claude.ts:285`). | **Native.** Thread id drives `thread/resume` and returns as `TurnResult.session` (`src/runtime/adapters/codex.ts:230`, `src/runtime/adapters/codex.ts:262`). | **Native.** Session file path/id drives `SessionManager.open`; result stores the session file path when present (`src/runtime/adapters/pi.ts:108`, `src/runtime/adapters/pi.ts:177`). |
| Large-payload transport | **Native stream.** Task text is passed through SDK stdin/query stream, not argv (`src/runtime/adapters/claude.ts:238`). | **Native JSON-RPC.** Task text is sent in `turn/start` input over stdio JSONL (`src/runtime/adapters/codex.ts:236`, `src/runtime/adapters/codex.ts:437`). | **Native SDK call.** Task text is passed to `session.prompt()` in-process (`src/runtime/adapters/pi.ts:152`). |
| Token/cache telemetry | **Native.** Claude result usage includes uncached, cache write, cache read, output, cost, and duration (`src/runtime/adapters/claude.ts`). | **Adapter-built + estimated cost.** App Server token usage notifications map to `TurnUsage`; the App Server reports **no** dollar cost, so `costUsd` is an Operon estimate from documented per-token list prices (`gpt-5.6-sol` and `gpt-5.5` $5/$30, `gpt-5.4` $2.50/$15, `gpt-5.4-mini` $0.75/$4.50 per MTok; sources `research/2026-07-15_model-assignment-refresh.md` and `research/2026-07-05_model-id-verification.md`) and is flagged `costEstimated: true`. GPT-5.6 prompts above 272K input tokens apply the documented 2× input and 1.5× output multipliers. Cached input tokens are conservatively priced at the full input rate and unrecognized models default to the flagship rate — the estimate never silently counts unknown spend as zero (`src/runtime/adapters/codex.ts`). | **Adapter-built.** pi session stats map input/cache/output and **provider-reported** cost into `TurnUsage` (`src/runtime/adapters/pi.ts`). |
| Per-turn budget cap (`role.maxTurnBudgetUsd`) | **Native running guard.** The cap is passed to the SDK as `maxBudgetUsd`; the CLI stops the turn mid-run and returns `error_max_budget_usd`, which maps to `failed` + exactly one incident note (`src/runtime/adapters/claude.ts:221`, `src/runtime/adapters/claude.ts:265`). | **Adapter-built running guard on the estimate.** The App Server exposes no budget knob, so Operon compares the running **estimated** cost against the cap on each token-usage update and, on crossing, stops the turn (closing the client → terminating the App Server turn) → `failed` + exactly one incident note. What is capped is the *estimate*, not a provider-measured figure (`src/runtime/adapters/codex.ts:324`, `src/runtime/adapters/codex.ts:251`). | **Adapter-built running guard.** pi has no budget knob, so Operon polls the running (provider-reported) cost at each turn boundary and calls `session.abort()` on crossing, with a defensive final-cost check for a single jump past the cap → `failed` + exactly one incident note (`src/runtime/adapters/pi.ts:145`, `src/runtime/adapters/pi.ts:163`). |
| Role toolset shaping (forbidden acts unrepresentable) | **Native.** Builder/reviewer turns inject permission deny rules (`gh pr merge`/`gh pr review`, `kubectl`/`doctl`, `~/.claude` + `~/.codex` writes) via inline SDK `settings.permissions.deny`; the CLI's own permission layer refuses the call even when the Operon gate would allow it — live-proven by the shaping probe in `test/runtime/claude-sdk.live.test.ts` (`src/runtime/role-shaping.ts`, `src/runtime/adapters/claude.ts`). | **Degraded.** The App Server exposes sandbox modes but no per-command deny list. On the constrained surface above, the hook bridge and approval backstop enforce the composed gate's flat role deny (`src/org/gate-compose.ts`, `src/runtime/adapters/codex-gate-bridge.ts`). | **Degraded.** pi exposes only a coarse read/bash/edit/write toolset — dropping `bash` would cripple the role, so the composed gate's flat role deny is the enforcement. |
| Intra-turn fan-out | **Native.** Claude subagent starts emit `subagent` events and count `subagentTurns`; the turn note advertises only the role-approved subagent types (`src/runtime/adapters/claude.ts`, `src/runtime/capabilities.ts`). | **Native.** App Server `subAgentActivity` and `collabAgentToolCall` items emit `subagent` events and increment `subagentTurns`; the turn note advertises only the role-approved types (`src/runtime/adapters/codex.ts`, `src/runtime/capabilities.ts`). | **Unsupported (serial degradation).** pi has no intra-turn fan-out surface. Operon tells the agent to work serially and records a degradation artifact when `delegation.allow` is configured; recognizing subagent-like extension metadata for gating does not turn that into a supported spawn surface (`src/runtime/adapters/pi.ts`, `src/runtime/adapters/pi-gate.ts`, `src/runtime/capabilities.ts`). |
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

Dated campaign evidence for these claims — which calibrations qualified,
which are intentionally invalid, and why — is
[`qualification-evidence.md`](qualification-evidence.md); the live matrix
above never restates it.
