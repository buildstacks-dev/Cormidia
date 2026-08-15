# Runtime layer review — pi, Codex app-server, Claude Agent SDK

*2026-07-03. Supports the docs/PURPOSE.md decision: native SDKs for Anthropic +
OpenAI, pi as the harness for all other models.*

> **Addendum (same day):** orchestrator language flipped **Python →
> TypeScript** (PURPOSE v0.5). Claude uses the TS Agent SDK, pi uses its TS
> SDK (`createAgentSession()`), and Codex uses App Server JSON-RPC over stdio.
> The pi review, risks, and per-runtime facts below are unchanged except where
> the 2026-07-06 M10 addendum supersedes the original RPC/SDK assumptions.
>
> **M10 addendum (2026-07-06):** Codex App Server is the adapter surface,
> spawned from pinned `@openai/codex` (`codex app-server --listen stdio://`).
> `@openai/codex-sdk` wraps `codex exec` for batch jobs and is not used for
> Cormidia's interactive thread/resume/approval adapter. Pi is embedded
> in-process with `@earendil-works/pi-coding-agent` and a runtime-installed
> `tool_call` gating extension.

## The shape

```
agentic-org (TypeScript)
├── orchestrator            dispatcher, scheduler entrypoint, state in markdown/git
│                           (claude-loop patterns: roles.yaml, state-in-repo, worktrees)
└── runtime adapters        ONE interface, three native harnesses
    ├── ClaudeRuntime   →  Claude Agent SDK (TS)
    ├── CodexRuntime    →  @openai/codex App Server JSON-RPC over stdio
    └── PiRuntime       →  pi SDK createAgentSession()
```

`roles.yaml` maps each role → `{runtime, model, effort, protocol files, tool
policy}`. Swapping a role's model is a config change; swapping its *provider*
changes which adapter fires — still config.

## pi (badlogic/pi-mono) — reviewed 2026-07-03

**What it is.** An AI agent toolkit in TypeScript (MIT): `pi-ai` (unified
multi-provider LLM API — OpenAI, Anthropic, Google, plus any
OpenAI/Anthropic/Google-compatible endpoint via `models.json`), `pi-agent-core`
(agent loop, tool calling, state), `pi-coding-agent` (the CLI), `pi-tui`,
`pi-web-ui`. npm scope `@earendil-works`.

**Maturity.** 67.4k stars, 8.3k forks, 241 releases, v0.80.3 released
2026-06-30. Extremely active — which cuts both ways (see risks).

**Embedding — the part that matters for us.** Four run modes:
interactive TUI, `-p/--print` one-shot, `--mode json` (events as JSON lines),
and **`--mode rpc`** — strict LF-delimited JSONL over stdin/stdout, designed for
process integration. M10 chose the TypeScript SDK path instead:
`PiRuntime` calls `createAgentSession()` directly and installs the Cormidia gate
extension as a `DefaultResourceLoader` extension factory.

**Protocol enforcement (our non-negotiable #1).** Strong levers:

- `.pi/SYSTEM.md` replaces the system prompt entirely; `APPEND_SYSTEM.md` appends
- `AGENTS.md` / `CLAUDE.md` context files loaded from cwd/parents
- **Extensions** (TS modules in `.pi/extensions/`) can register custom tools,
  commands, and **event handlers** — the hook point for tool-call gating
- Skills (Agent Skills standard, `.pi/skills/`, `.agents/skills/`) and prompt
  templates
- `pi install npm:...|git:...` distributes all of the above as versioned packages

**Sessions & recovery.** Sessions persist as JSONL tree files
(`~/.pi/agent/sessions/`, organized by working dir) with `--session <id>` resume
and `--fork`. Gives us the same audit-trail + crash-recovery story the other two
runtimes have natively.

**Model routing.** `--provider` / `--model <pattern>:<thinking-level>`; OAuth
subscription logins (Anthropic, OpenAI, Copilot) or API keys; custom providers
via `~/.pi/agent/models.json` for any OpenAI/Anthropic/Google-compatible API —
which is how Grok, DeepSeek, Qwen, and local (llama.cpp/ollama) models come in.

**Risks / work on our side.**

1. **Permission gating is DIY.** Unlike Claude Agent SDK (permission modes +
   `can_use_tool` callback) and Codex (approval policies + sandbox modes), pi
   has no first-class approval flow — we write a pi extension that intercepts
   tool events and enforces our critical-ops policy. Budget for this.
2. **Fast-moving upstream.** 241 releases; pin the version, upgrade
   deliberately, keep our extensions in our repo not `~/.pi`.
3. **Fast-moving SDK surface.** In-process pi avoids the subprocess boundary,
   but SDK types and extension events are upstream-owned. Keep the package
   pinned and prove the gate extension through the shared conformance suite.
4. **Harness quality for non-frontier models is ours to tune** — pi gives the
   body, not per-model prompt tuning.

**Verdict: adopt.** It is the credible "one model-agnostic body" — mature,
MIT, actively maintained, with exactly the embedding surface
(`createAgentSession`) and customization depth (SYSTEM.md, extensions, skills)
we need. With decision #1
(native SDKs for Anthropic + OpenAI), pi's scope narrows to Google / xAI /
open-weights / local models, plus a fallback and experimentation harness — a
role it fits without contortion.

## Codex app-server (OpenAI roles)

Long-lived bidirectional JSON-RPC 2.0 process (`codex app-server`) — the same
interface behind the Codex VS Code extension and desktop app. Transports:
stdio (default), WebSocket, Unix socket. Threads (`thread/start|resume|fork`)
and turns; model selected per thread; approval policies and sandbox modes
(`readOnly` / `workspaceWrite` / `dangerFullAccess`) configurable per
thread/turn.

**M10 TypeScript path:** pinned **`@openai/codex`** CLI package. Cormidia spawns
`codex app-server --listen stdio://`, performs the generated-schema handshake
(`initialize` → `initialized`), then uses `thread/start|resume` and
`turn/start`. Approval requests (`item/commandExecution/requestApproval`,
`item/fileChange/requestApproval`, plus legacy exec/patch requests) are routed
through `hooks.gate`. Context goes through `developerInstructions`.

**Rejected path:** `@openai/codex-sdk` is useful for non-interactive
`codex exec` automation, but it is not the right surface for Cormidia's standing
role adapter because it does not expose the App Server thread/resume/approval
protocol directly.

## Claude Agent SDK (Anthropic roles)

**`claude-agent-sdk`** (`pip install claude-agent-sdk`) runs Claude Code
headlessly as a subprocess with a Python API on top: `query()` for one-shot
runs, `ClaudeSDKClient` for stateful sessions. Sessions resume/fork/list;
**hooks** on lifecycle events; MCP servers including in-process Python tools
(`@tool` + `create_sdk_mcp_server()`); programmatic subagents
(`AgentDefinition`); permission modes (`default`/`acceptEdits`/`plan`/
`dontAsk`/`bypassPermissions`) plus a `can_use_tool` callback — the natural
place to wire the critical-ops gate; `model` per options and per agent
definition, with `fallback_model`.

> **Superseded (2026-07-05):** the `can_use_tool` hypothesis above was
> disproven empirically — it never fires for auto-allowed read-only bash and
> does not reliably see subagent tool calls. The gate channel is a
> **PreToolUse hook**. See
> `research/2026-07-05_claude-runtime-live-conformance.md` (git history;
> record retired in the 2026-08-14 research cleanup).

## Adapter interface (sketch)

Every runtime must support this contract; anything a runtime lacks natively
(pi's approval gate) gets built at the adapter or extension level:

```
Runtime.run_turn(
    role,            # → protocol files, system prompt, tool policy
    workdir,         # target repo checkout / worktree
    task,            # ticket / prompt
    session=None,    # resume handle: Claude session id | Codex thread id | pi session path
) -> TurnResult      # events streamed; final artifacts + verdict; new session handle
```

Recovery story is uniform: all three runtimes persist sessions and resume by
ID, so a crashed run re-enters via its handle and the orchestrator's
state-in-markdown decides whether to resume or restart clean.

## Sources

- pi: https://github.com/badlogic/pi-mono (+ coding-agent README)
- Codex app-server: https://developers.openai.com/codex/app-server ·
  https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md
- Codex App Server / SDK docs: https://developers.openai.com/codex/sdk
- Claude Agent SDK Python: https://code.claude.com/docs/en/agent-sdk/python
