# Contract — B-23 OpenCode adapter (opencode serve + SDK)
Canonical ID: **CORMIDIA-C-B23-001 (alias: B-23)**

Status: DRAFT (harness revision 2026-08-07, #336). **Adapter landed #337 (2026-08-07);
no longer design-only.** Extends `provider-adapter-core.md`; deltas only. Sources:
`[doc: research/2026-08-06_adapter-upstream-references.md]` unless marked `[stated]`
(owner text in #330/#337), `[PROPOSED]`, or `[certified]`
(`research/2026-08-07_opencode-adapter-certification.md`, against the operator's
opencode 1.18.15).

- Surface: user-installed `opencode` binary — never installed by Cormidia (#224);
  driven through `opencode serve` (HTTP, self-published OpenAPI 3.1 at `/doc`, SSE
  events) + `@opencode-ai/sdk`; `opencode run --format json` is the recorded lighter
  fallback surface if serve proves heavy per turn `[stated]`. Readiness = usable
  request authentication via OpenCode's own auth store, plus preinstalled-binary
  presence with version-band recording (#331) — configuration presence is never
  readiness.
- Server identity: the adapter binds to the exact server instance it provisioned (or
  an explicitly attached one); a stale or foreign `opencode serve` instance on the
  expected port is an identity failure, typed and terminal — never "some server
  answered" `[PROPOSED, B-10a analogy]`.
- Gate integration (**F-PT-025 resolved-ratified 2026-08-07**): `tool.execute.before`
  in a Cormidia-authored per-turn plugin is the sole ENFORCING seam; config permissions
  are shaping only. A configured `ask` auto-REJECTS headlessly rather than blocking or
  hanging, so `ask` is never used, and `--auto` (which bypasses only that ask layer,
  never the hook) is never passed `[certified]`. The gate must carry **every** effectful
  tool, not bash alone: with bash blocked the model reached the same effect through
  `read` `[stated, owner probe]`. Like pi's extension (B-04), **turn-start precondition:
  the gating hook is verified active before any tool-capable execution; absence is a
  typed, terminal failure** (INV-002 fail closed) — and the proof must be
  HOOK-sourced, not factory-sourced: certification observed a loader shape where the
  plugin's factory ran and announced itself while its returned hooks were silently
  dropped, leaving every tool ungated `[certified]`. Conformance proves a forbidden
  attempt is actually denied, never merely that a plugin registered.
- Multi-model backbone: model ids are `provider/model` against the models.dev catalog;
  the assigned tuple's model id remains exact — catalog drift or a retired id is a
  typed refusal before provider construction, never substitution (core §1). Roster
  publication ("publish the roster, qualify the assignment") flows through the
  harness's own catalog; **certification smokes representative models per provider
  family and never implies per-model certification** (docs/harness/adding-updating.md
  §5; certification ≠ qualification) `[stated]`.
- Per-connection auth: one OpenCode install multiplexes many provider credentials;
  readiness and error classification are **per harness×provider connection** —
  provider X usable while provider Y's credential is expired must surface as exactly
  that, never as a harness-wide state (INV-008; auth-mode declaration per #333).
- Events: SSE stream gap or disconnect while the server-side turn continues is the
  lost-response class — execution ambiguity, typed, with whatever usage is known,
  never fabricated completion (core §2/§3).
- Version skew: post-1.0 near-daily releases; generated-SDK-vs-running-server OpenAPI
  skew is a typed, terminal config error (B-03 protocol-skew analogy). Pins are
  tested-with declarations, not floors (#331); re-certification on bump.
- Effort: per-model `reasoningEffort` + Anthropic `thinking` variants exist; the
  Effort mapping is per-adapter and honest — unmappable values throw, per the ratified
  cross-adapter rule.
- Ambient-context isolation (**new clause, #337**): OpenCode ingests operator-global
  rules — `~/.config/opencode/AGENTS.md`, `~/.claude/CLAUDE.md`, `~/.claude/skills`,
  `~/.agents/skills` — which the F-PT-025 probe caught reaching a turn. A Cormidia turn
  MUST close every one of those channels (per-turn `XDG_CONFIG_HOME`,
  `OPENCODE_DISABLE_CLAUDE_CODE`, `OPENCODE_DISABLE_EXTERNAL_SKILLS`) while leaving the
  provider auth store in place, and certification MUST prove it with sentinels rather
  than assert it `[certified]`. Project context inside the app checkout stays in scope:
  OpenCode's own AGENTS.md walk stops at the project root.
- L3 (certification lane): the shared certification walk per
  docs/harness/adding-updating.md §5 against the real server+SDK — real auth-store
  readiness; a real forbidden attempt denied through the ratified gate mechanism
  (post-F-PT-025); exact session resume; representative-model smokes (one
  Anthropic-family, one OpenAI-family) `[stated]`; subagent/fan-out probe at the
  declared tier. Spend-bounded per policy (pre-merge changed-adapter ≤2 turns/$5).
