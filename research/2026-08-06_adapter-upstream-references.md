# Adapter upstream source-of-truth references

*2026-08-06. Fetch-verified survey of the programmatic integration surfaces for
the three shipped harnesses and the four expansion targets (OpenCode, Cursor,
Grok Build, Muse Code). Every claim below traces to a page fetched on this
date; unverified items are flagged inline. Supports the adapter-expansion
initiative; supersedes the vendor facts (not the decisions) in
`research/2026-07-03_runtime-layer.md`.*

## Shipped harnesses — deltas against our pins

### Claude Agent SDK (`claude`)
- Canonical: <https://github.com/anthropics/claude-agent-sdk-typescript> ·
  docs <https://code.claude.com/docs/en/agent-sdk/overview> · headless
  <https://code.claude.com/docs/en/headless> · model/effort
  <https://code.claude.com/docs/en/model-config> · machine index
  <https://code.claude.com/docs/llms.txt>
- npm `@anthropic-ai/claude-agent-sdk` latest **0.3.224**; we pin **0.3.201**.
- Surface check: TS Agent SDK remains the recommended embedding path. New
  since our pin: `--bare` mode — skips auto-discovery of hooks, skills,
  plugins, MCP, CLAUDE.md; docs call it "the recommended mode for scripted and
  SDK calls". Our `settingSources: []` hermeticity should be re-expressed on
  `--bare` when we bump the pin. `thinking: ThinkingConfig` supersedes
  `maxThinkingTokens` (deprecated). Effort `low..max` unchanged.
- Auth: API key only for SDK products (Anthropic policy: no third-party
  claude.ai subscription login without prior approval).

### Codex (`codex`)
- Canonical: <https://github.com/openai/codex> · docs moved to
  <https://learn.chatgpt.com/docs> (developers.openai.com/codex 308-redirects
  there) — App Server <https://learn.chatgpt.com/codex/app-server> · config
  <https://learn.chatgpt.com/codex/config-file/config-reference>
- CLI/SDK latest **0.147.0**; we pin **0.144.4**.
- Surface check: our App Server choice still conforms. OpenAI's split
  recommendation: `codex exec`/GitHub Action for shell CI, `@openai/codex-sdk`
  for batch automation, **App Server "for deep integration inside your own
  product: authentication, conversation history, approvals, and streamed agent
  events"** — Cormidia's exact consumption. Also exists: `codex mcp-server`.
- Since our pin: granular `approval_policy` object (may simplify our gate
  bridge), `--approve-for-me` on exec, `--full-auto` removed, MCP 2026-07-28
  protocol opt-in. The 0.144.4-specific workarounds (trust-flag dispatch drop,
  model-catalog `tool_mode` clone) must be re-verified on any bump.
- Reasoning effort: `minimal|low|medium|high|xhigh` — no `max` (our
  throw-on-`max` stays correct). No default model documented; never hardcode
  one. Auth: ChatGPT sign-in primary; `CODEX_API_KEY` for CI.

### pi (`pi`)
- Canonical: repo migrated → <https://github.com/earendil-works/pi>
  (badlogic/pi-mono redirects) · docs <https://pi.dev/docs/latest> · in-repo
  `packages/coding-agent/docs/` (sdk.md, rpc.md, extensions.md, models.md)
- npm `@earendil-works/pi-coding-agent` latest **0.84.1** (2026-08-07); we pin
  **0.80.7**. Old `@mariozechner/*` scope is deprecated — we are already on
  the right scope.
- Surface check: in-process SDK (`createAgentSession()`) remains the
  documented recommendation for TS orchestrators; `--mode rpc` (JSONL) is the
  subprocess alternative. New `@earendil-works/pi-client`/`pi-protocol`
  (framed-CBOR remote sessions) are landing — watch as a future seam.
- Churn warning: ~19 releases in 7 weeks with breaking-change batches; the
  author's release note explicitly told SDK/RPC/extension users to re-read the
  docs. Bump deliberately, re-run the conformance walk, re-check capability
  tiers on every bump — specifically: thinking levels are now
  `off|minimal|low|medium|high|xhigh|max` per-model via `thinkingLevelMap`
  (holes allowed), so our unconditional throw-on-`max` needs re-evaluation.

## Expansion targets

### OpenCode (target: generic multi-model backbone)
- Canonical: repo migrated → <https://github.com/anomalyco/opencode> (ex
  sst/opencode) · docs <https://opencode.ai/docs/> (cli · server · sdk ·
  plugins · config · models · agents · permissions)
- npm `opencode-ai` (CLI) and `@opencode-ai/sdk`, both **1.18.14**; post-1.0,
  near-daily releases.
- Designed embedding surface: `opencode serve` (HTTP, self-published OpenAPI
  3.1 spec at `/doc`, SSE events) + `@opencode-ai/sdk` generated from that
  spec (`createOpencode()` spawns server+client; `createOpencodeClient()`
  attaches). Lighter alternative: `opencode run --format json`.
- Native seams we care about: plugin hooks `tool.execute.before` (gate) and
  `permission.asked`; per-tool/agent `allow|ask|deny` permission config with
  parsed-bash wildcards; subagents (fan-out); JSON-schema structured output;
  per-model `reasoningEffort` + Anthropic `thinking` variants; providers via
  models.dev catalog (75+ providers), model ids `provider/model`.
- Auth: `opencode auth login` → `~/.local/share/opencode/auth.json`, plus env
  vars. Open empirical question: how permission `ask` behaves in pure headless
  server mode (mitigations: `--auto`, `permission.asked` hook, config deny).

### Cursor CLI (target: vendor-native harness)
- Canonical docs: <https://cursor.com/docs/cli/overview> · headless
  <https://cursor.com/docs/cli/headless> · permissions
  <https://cursor.com/docs/cli/reference/permissions> · SDK
  <https://cursor.com/docs/sdk/typescript>
- Binary renamed `cursor-agent` → **`agent`** (2026-01; alias kept). Headless:
  `agent -p` with `--output-format text|json|stream-json`; **`--force`
  required to actually apply file edits**; threads via `--resume`/`agent ls`.
- `@cursor/sdk` (TS) is official but **public beta** (since 2026-04-29);
  CLI-headless is the stable surface today. Adapter plan: CLI first, SDK when
  it exits beta.
- Native permissions config (`~/.cursor/cli-config.json`, `.cursor/cli.json`):
  `permissions.allow/deny` with `Shell()/Read()/Write()/WebFetch()/Mcp()`
  patterns, deny-wins — a real role-shaping surface (stronger than Codex's).
  `--sandbox enabled|disabled`. Reads `AGENTS.md`/`CLAUDE.md` natively.
- No documented effort knob. Auth: `agent login` or `CURSOR_API_KEY`.
- Corporate flag: SpaceX acquiring Anysphere (announced 2026-06-16, closing
  ~Q3 2026) — see Grok note; provider-diversity accounting may need updating.

### Grok Build (target: vendor-native harness for Grok models)
- The official product (xAI → SpaceXAI after the 2026-02 SpaceX merger):
  <https://github.com/xai-org/grok-build> (Rust, Apache 2.0, binary `grok`,
  "external contributions are not accepted") · docs
  <https://docs.x.ai/build/overview> · headless
  <https://docs.x.ai/build/cli/headless-scripting> · changelog
  <https://x.ai/build/changelog>. The community `superagent-ai/grok-cli` is
  explicitly unaffiliated — do not build against it.
- Surfaces: headless `grok -p` (`--output-format plain|json|streaming-json`,
  `--always-approve`, `--no-auto-update` recommended in CI) and **ACP**
  (`grok agent stdio` — Agent Client Protocol, JSON-RPC over stdio). No SDK
  library; ACP is the adapter seam. Note Kimi CLI also speaks ACP — a shared
  ACP transport core could serve multiple harnesses behind per-harness
  capability profiles.
- Default model `grok-4.5`; custom via `~/.grok/config.toml`. No effort knob
  documented. Auth: browser OAuth or `XAI_API_KEY`.
- Risk flags (pre-adoption review required): (1) unverified single-source
  report (Wikipedia) of a 2026-07 incident where Grok Build uploaded user
  repos including secrets to cloud storage; (2) closed-contribution repo;
  (3) vendor consolidation with Cursor under SpaceX.

### Muse Code / Muse Spark (target: vendor-native harness; user-confirmed priority)
- Meta Superintelligence Labs: Muse Spark 1.2 models + **Muse Code** terminal
  agent, **beta since 2026-08-05** (binary `muse`). Announcement
  <https://research.meta.ai/blog/introducing-muse-code-and-muse-spark-1-2> ·
  quickstart <https://dev.meta.ai/docs/quickstart>.
- Why it is a target despite day-old beta (product owner, 2026-08-06): its
  agent-swarm coordination is a genuine harness advantage — exactly the
  harness+model leverage Cormidia exists to arbitrage. If an SDK emerges use
  it; otherwise the CLI headless surface is enough.
- Models `muse-spark-1.2` / `muse-spark-1.1`; the Meta Model API is
  OpenAI-SDK-compatible at `https://api.meta.ai/v1` and Anthropic-Messages-
  compatible at `https://api.meta.ai` (so the models are also reachable
  through pi/OpenCode as generic backbones). Auth `MODEL_API_KEY`. Pricing
  (blog): $1.25/M in, $4.25/M out, $0.15/M cached.
- Expect churn: certify against a pinned version, re-certify on bumps; swarm
  fan-out makes the subagent-gate probe the load-bearing certification case.

## Cross-cutting notes
- Cursor and Grok Build ship via curl installers, not npm: their adapters must
  require a preinstalled binary and prove readiness (usable auth), never
  install providers (#224).
- Effort uniformity is confirmed impossible: Cursor and Grok Build expose no
  effort knob. The existing design already absorbs this (generic `Effort`
  axis, per-adapter honest mapping that throws on unmappable values,
  per-candidate `efforts:` lists in adaptive assignments).
- "Publish the roster, qualify the assignment": generic backbones (pi,
  OpenCode) expose large model catalogs (`models.json`, models.dev). The
  harness roster is what `cormidia` publishes as reachable; certification
  smokes representative models per provider family; per-role assignment
  remains ratified + qualification-gated as today. Certification ≠
  qualification.
