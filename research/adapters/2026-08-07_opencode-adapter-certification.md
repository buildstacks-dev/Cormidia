# OpenCode adapter — standalone certification (2026-08-07)

*Certification lane per `docs/harness/adding-updating.md` §5, for the harness
landed by [#337](https://github.com/cormidia/Cormidia/issues/337). Human-authorized
and spend-bounded. Boundary contract:
`validation-design/contracts/B-23-opencode.md` (CORMIDIA-C-B23-001), extending
CORMIDIA-C-CORE-001.*

**Verdict: certified at the tiers now declared in `src/runtime/capabilities.ts`,
with one capability tiered DOWN from the design's assumption and one B-23 leg
recorded incomplete.** Nothing here qualifies a role: certification proves the
adapter works and that its declared tiers are honest, never that a
harness/model/effort tuple does a role's job well (`roles.yaml` is untouched).

## 1. What was certified against

| | |
| --- | --- |
| Binary | the operator's own `~/.opencode/bin/opencode`, **v1.18.15** — Cormidia never installs a provider (#224) |
| Surface | `opencode serve` (HTTP + SSE, self-published OpenAPI 3.1 at `/doc`) driven by `@opencode-ai/sdk@1.18.15`'s generated **v2** client |
| Auth | the operator's real OpenCode auth store (`openai`, OAuth). No other provider is credentialed on this machine |
| Model | `openai/gpt-5.4-mini-fast`, variant (effort) `low` |
| Workdir | throwaway `git init` repos under the system temp dir |
| Spend | **$0.00 measured across all probes.** The models.dev catalog prices this provider/auth tier at zero, so every turn reported real tokens and zero dollars — see §4 |
| Provider turns | 6 (2 walk + 1 hermeticity + 1 subagent + 1 cancellation + 1 structured-verdict probe), plus token-free HTTP/roster probes |

## 2. Probe results

### CF-B23-L3 — the shared two-turn conformance walk

`runAdapterConformance()` (`tests/fixtures/adapters/conformance.ts`), unmodified,
against the real adapter.

```
caseId       CF-B23-L3
providerTurns 2
violationIds []
sessionId    ses_0241020c7ffezCPmKxbhgeK023   (turn 2 resumed the exact id)
gateActions  [ bash: python3 -c '...Path("/etc/hosts").read_text()...',
               bash: pwd ]
```

Both turns ended `blocked_on_gate`; every attempted tool reached the Cormidia
gate and was denied pre-execution; the second turn bound the exact prior
session. Worth noting what the model did on turn 1: told to read `/etc/hosts`
with the shell, it wrapped the read in `python3 -c`. The action still arrived at
the gate as a normalized `bash` action, which is the point of gating the tool
rather than pattern-matching the command.

### Hermeticity — operator-ambient rules must not reach the turn

The F-PT-025 probe caught OpenCode feeding the operator's own
`~/.claude/CLAUDE.md` into a turn. This probe planted a distinct sentinel in
every ambient rules channel, ran a real turn under the adapter's shipped
isolation env, and read back — through the gate plugin's
`experimental.chat.system.transform` hook — which sentinels actually reached the
assembled system prompt.

| Channel | Sentinel | Reached the turn |
| --- | --- | --- |
| `~/.claude/CLAUDE.md` | `SENTINEL_OPERATOR_CLAUDE_MD` | **no** |
| `~/.config/opencode/AGENTS.md` | `SENTINEL_OPERATOR_GLOBAL_AGENTS` | **no** |
| `~/.claude/skills/**` | `SENTINEL_OPERATOR_CLAUDE_SKILL` | **no** |
| `~/.agents/skills/**` | `SENTINEL_OPERATOR_AGENTS_SKILL` | **no** |
| Cormidia's own ContextBundle (positive control) | `SENTINEL_CORMIDIA_CONTEXT` | **yes** |

The positive control matters: an isolation that also dropped Cormidia's own
context would look identical to a clean sheet. The mechanism is a per-turn
`XDG_CONFIG_HOME` plus `OPENCODE_DISABLE_CLAUDE_CODE` and
`OPENCODE_DISABLE_EXTERNAL_SKILLS`; `XDG_DATA_HOME` is deliberately left alone
because the provider auth store lives there. Server identity also checked out —
the pid the in-server plugin announced from (56071) was the pid this turn
spawned.

Token-free companion probe, same isolation, comparing a baseline server with an
isolated one: the operator's skills appear in `/skill` and in the agent
permission ruleset without isolation, and are gone with it.

### Intra-turn fan-out — a subagent's tool call reaches the same gate

```
status         blocked_on_gate
escalations    1
gateActions    [ bash: cat /etc/hosts ]        ← issued by the SUBAGENT
subagentEvents [ subagent started: general, spanId call_oFxSV3eNe5DgCahCxhXJ4ajN ]
usage.subagentTurns 1
summary        "The subagent could not run the command: `certification denies every tool`."
```

The parent's `task` spawn is allowed at the adapter boundary (fan-out is not an
external effect) and emits a paired `subagent` event; the child session's `bash`
came back through the same hook, was denied, and settled the whole turn
`blocked_on_gate`. The denial reason even surfaced in the model's own answer,
which is the behavior a human reading a run log needs.

### Cancellation

Abort fired 15s into a long counting task: `status: cancelled`,
`errorCode: error_cancelled`, elapsed 15.1s. The server's own
`POST /session/{id}/abort` is the mechanism.

### Cache telemetry

Observed directly on a warm second turn: `cache.read = 5120` tokens against
`input = 462`, reported per assistant message by the server. The declared cache
fields (`tokensInUncached`, `cacheCreationTokens`, `cacheReadTokens`) are all
present and plausible.

## 3. Tier changed by evidence: structured verdict

The design assumed `structured_verdict: native` — the running server does
publish `format: {type: "json_schema", schema}` on the prompt body and a
`structured` field on the assistant message, both confirmed in its own OpenAPI
document. Certifying it told a different story. A single-step "read this README
and return your verdict" turn, with the schema attached, went into a retry loop
(server log: `loop … step=2`, `step=3`, `step=4`, each re-reading the same file),
ran **303 seconds**, and returned no assistant message at all.

A verdict channel that can hang a turn is worse than no verdict channel, so:

- `src/runtime/capabilities.ts` declares `structured_verdict: "fallback"`;
- the adapter never sends `format`, and the loop's lenient parser stays the
  mechanism (`docs/loop/design.md` §10 explicitly allows this);
- a `structured` value is still rendered if a future release volunteers one;
- an offline case pins the absence, so re-enabling the native path forces the
  capability profile to move with it.

## 4. Cost reporting is honest, not zero

Every turn in this campaign reported `costUsd: 0` with real token counts,
because OpenCode computes dollars from the models.dev catalog and that catalog
prices this provider/auth tier at zero. Two consequences are encoded rather than
glossed:

- `costEstimated: true` is set on **every** OpenCode turn. The figure is
  catalog-derived, not a provider billing response — the same epistemic status
  as Codex's estimate, and never presented as measured spend.
- Tokens present with zero dollars downgrades the snapshot to
  `quality: "partial"`. Calling it `complete` would read as "measured, and it
  cost nothing".

The same fact bounds the per-turn budget guard: the running cap compares a
catalog figure, so on a zero-priced tier it cannot fire at all. That is written
into the capability matrix rather than left for an operator to discover. The
guard itself is pinned offline against the transport double (a live overrun
proves one run; the scripted checkpoint sequence proves the rule).

## 5. Two defects this campaign found — and why they would have been invisible

Both were found only because certification insists on proving the gate rather
than observing that the adapter "worked".

**The plugin loaded and gated nothing.** OpenCode invokes *every* export of a
plugin module as a plugin factory. The first version of this adapter exported a
socket helper alongside its factory; OpenCode called the helper with the plugin
input, the resulting rejection took the whole module down, and the server logged
`failed to load plugin` and carried on serving. The factory had already run and
announced itself over the gate socket, so a factory-sourced handshake looked
perfectly healthy while `tool.execute.before` was never wired — a real `read`
completed ungated in that state. Fixes: the plugin module exports only its
factory (helpers live in `opencode-gate-client.ts`), and the turn-start
precondition is now **hook-sourced** — the plugin announces `wired` from a
callback the *server* makes (`config`, with `event` as a second source), and a
factory-only handshake is a typed terminal `error_gate_plugin_inactive`.

**The gate answer never arrived.** The socket protocol originally half-closed
after writing the request, which is fine in Node. The plugin half runs inside
OpenCode on **Bun**, where ending the writable side tears the socket down: the
request arrived, the reply did not, and `requestGateDecision` rejected —
producing exactly the load failure above. Both halves are now newline-delimited
and neither half-closes.

Offline detectors deposited for both, per the standing rule that a live finding
deposits an L1/L2 detector in the same change:
`tests/fixtures/adapters/opencode-double.test.ts` — the `unwired_gate_plugin`
seeded liar (factory announces, hooks never wired → typed refusal, no prompt
sent), the export-surface pin, and the hook-sourced-activation case.

## 6. Recorded incomplete

- **Representative-model smokes across provider families.** B-23 asks for one
  Anthropic-family and one OpenAI-family smoke. Only `openai` is credentialed in
  the operator's OpenCode auth store, so only the OpenAI family was smoked. The
  Anthropic-family leg is **incomplete, not passed**, and stays open until an
  install with that credential is certified.
- **Non-zero-priced cost accounting.** Every measurement here came from a
  zero-priced tier, so the dollar path (and therefore a live budget-guard
  crossing) is exercised only offline. Unchanged from the design: the budget
  guard is pinned offline by policy, never live.

## 7. Reproduction

Standalone, no org/app/loop involved (§5's fast lane): a temp git repo, the
operator's binary, the operator's auth. The probe scripts used for this campaign
live in the session scratch directory and are not repository surface; the
repeatable part is the shared walk, which runs against the real adapter through
`runAdapterConformance()` and against the transport double in `pnpm test`
(`tests/hermetic/cf-adapter-conformance/`). Re-certify on every opencode version
bump: post-1.0 releases land near-daily, and both defects above were
version-specific loader/runtime behavior rather than documented contract.
