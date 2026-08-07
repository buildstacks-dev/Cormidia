# Grok Build adapter — certification record (B-25 / #339)

*2026-08-07. Standalone adapter certification per `docs/harness/adding-updating.md`
§5, run against grok **1.0.0 (3cd0d0cbcebe) [stable]** over ACP
(`grok agent stdio`). Every live turn ran in a throwaway sandbox git repo under
the session scratchpad. This record disposes finding **F-PT-027**.*

> **Real-repo use remains blocked.** #339's human risk review is OPEN. A green
> certification says the adapter works and its declared tiers are honest; it
> says nothing about whether the vendor should be trusted with a real
> repository. The recorded pre-adoption flags stand (an unverified
> single-source report of a 2026-07 incident uploading user repos including
> secrets to vendor cloud storage; a closed-contribution upstream; vendor
> consolidation with Cursor under SpaceX). Until the human review clears it,
> every grok turn targets throwaway sandbox repositories only, and no role may
> be assigned to this harness.

## 1. F-PT-027 — disposed

The finding asked three questions. All three now have empirical answers, and
the answer to the first is what forced the adapter's design.

**Q1. Does `grok agent stdio` emit an ACP permission request for every
tool-action class?** **No.** Confirmed twice.

- The 2026-08-07 probe recorded on #339 found shell (`run_terminal_command`)
  and file reads resolved internally, with unanswerable same-millisecond
  `pending_interaction` → `interaction_resolved` notifications carrying no
  JSON-RPC id.
- Re-probed here under a fresh `GROK_HOME` **and** a fresh `HOME`, the shell
  class *does* route to `session/request_permission`, and `reject-once` is
  terminal (`stopReason: "cancelled"`,
  `cancellationCategory: "PermissionRejected"`, the tool never runs). The
  earlier result was the operator's persisted
  `[ui] permission_mode = "always-approve"` suppressing the request path.
- But read-only tools still never reach it. Grok's own documentation states the
  rule: `read_file`, `list_dir`, `grep`, `web_search`, `todo_write` and a fixed
  read-only shell list "run without prompting, in every mode including
  `dontAsk`, unless a matching `deny` rule **or a hook** blocks them".

So the ACP permission request is coverage-incomplete *by design*, and its
coverage silently collapses to nothing under a config the client cannot read
(`session/new` exposes no modes; there is no client-visible difference between
a bypassed session and a gated one). It cannot be the gate.

**Q2. What denial semantics apply?** Two distinct ones, both proven:
`session/request_permission` + `reject-once` cancels the turn; a `PreToolUse`
hook `{"decision":"deny","reason":…}` fails the individual tool call with
`Hook denied: <reason>` and the turn continues. The adapter's own escalation
ledger — not grok's stop reason — is what maps a denial to `blocked_on_gate`.

**Q3. Can a headless auto-approve analog bypass the request path?** **Yes,
silently** — `--always-approve`, `--permission-mode bypassPermissions`,
`_meta.yoloMode` on `session/new`, or the persisted config key. This is why
isolation is part of the gate rather than a nicety.

**Ratified mechanism: the `PreToolUse` hook is the gate.** Grok's documented
authorization order puts hooks *first*: "A hook can deny a tool call before any
other check", ahead of permission rules, remembered grants, built-in read-only
auto-approvals and the prompt policy, in every permission mode. Always-approve
short-circuits the pipeline *after* hooks, and explicitly leaves `deny` rules
and hooks in force. It is the only surface that sees every tool action.

**And it must be proven per turn, because grok's hook runner fails OPEN.** The
docs are explicit: "All hook failures (timeouts, crashes, malformed output,
missing required env vars) are fail-open… Only an explicit `deny` decision
returned by the hook blocks a tool call." A silent hook is therefore
indistinguishable from a quiet turn. Cormidia closes that with a `SessionStart`
handler through the same per-turn socket: no handshake, no prompt, typed
`error_gate_unproven` refusal, zero tokens spent.

## 2. What was built

| Module | Role |
| --- | --- |
| `src/runtime/adapters/grok-acp-client.ts` | Newline-delimited JSON-RPC over `grok agent stdio`, protocolVersion 1, process-group teardown |
| `src/runtime/adapters/grok-isolation.ts` | Per-workdir isolated `GROK_HOME` + `HOME`, vendor-compat neutralization, launch argv, version probe |
| `src/runtime/adapters/grok-gate-bridge.ts` | Per-turn Unix socket + hook config; `createGrokGateCore` is the shared decision half the L1 double also drives |
| `src/runtime/adapters/grok-gate-hook.ts` | Child helper grok spawns per hook event; denies on any failure |
| `src/runtime/adapters/grok-tool-actions.ts` | Grok tool names → the gate's provider-neutral actions |
| `src/runtime/adapters/grok-session.ts` | `session/new` / `session/load`, the fail-closed gate proof, the ACP permission backstop |
| `src/runtime/adapters/grok-turn.ts` | Usage projection, status/summary/artifact mapping |
| `src/runtime/adapters/grok.ts` | `GrokRuntime` |

## 3. Live certification results (sandbox repos only)

Total live spend across every probe in this record: **≈ $0.12**, against the
policy's ≤2 turns/$5 pre-merge changed-adapter bound. The certification walk
itself is 2 provider turns / $0.058.

### 3.1 Readiness (token-free)

```
status=ready
detail=grok 1.0.0 (3cd0d0cbcebe) [stable] authenticated over ACP;
       method=cached_token; mode=Oidc; tier=Free; no model turn sent
durationMs=3404  billable=false
```

Readiness is the ACP `authenticate` round-trip in the isolated home, which
resolves the stored credential against the vendor and returns account metadata
without a model request. A credential-presence pre-check guards it: probed with
no credential, grok answers `initialize` with `defaultAuthMethodId: null`, and
`authenticate` then starts a browser login that fails **ten minutes** later
(`Login timed out after 10 minutes`). Classifying that state before the call is
what keeps `cormidia doctor` bounded and honest.

### 3.2 Isolation sentinel (token-free, machine-checkable)

```
operator ~/.grok/config.toml permission_mode = always-approve
hook handshake observed:                       true
grok-reported session id:                      019fdbb6-314d-7c40-b422-aab18bef9e00
session/new session id:                        019fdbb6-314d-7c40-b422-aab18bef9e00
permission mode INSIDE the isolated turn:      default
isolated GROK_HOME: …/cormidia-grok/2ece0678a5f8bf4e/home
isolated HOME:      …/cormidia-grok/2ece0678a5f8bf4e/user
```

The operator's real machine carries `always-approve`. Inside the turn grok
resolves `default`. That single line is the isolation proof, and it is not a
one-off assertion: the adapter reads `permissionMode` off every SessionStart
hook envelope and **refuses the turn** if it is bypass-shaped, so the sentinel
runs on every turn forever.

`grok inspect` was used to establish what leaks without isolation: under the
operator's home it reports `Source: /Users/…/.claude/settings.json` with
5 permission rules loaded, plus 53 skills and the global `Claude.md`. A fresh
`GROK_HOME` alone removes the grok-side config but **not** the Claude-side
ingestion — that needs the redirected `HOME` plus the `[compat.*]` cells and
their `GROK_CLAUDE_*` / `GROK_CODEX_*` env equivalents, all of which the
adapter sets.

**Documented tradeoff.** Full isolation would break authentication, because the
stored login lives at `$GROK_HOME/auth.json`. The adapter therefore copies
exactly one file — `auth.json` — into the isolated home and nothing else
(config, hooks, trusted folders, sessions, plugins, marketplace cache all stay
out). `XAI_API_KEY` passes through the inherited environment untouched. This is
the narrowest isolation that neutralizes both permission-mode and
settings ingestion.

**Second documented tradeoff.** The isolated home is **stable per workdir**, not
per turn. A per-turn home was implemented first and broke exact resume: grok
stores session transcripts under `$GROK_HOME/sessions`, so turn 2's
`session/load` failed with `FS_NOT_FOUND`. Isolation's purpose is to neutralize
operator configuration, which a stable Cormidia-owned home does equally well.
The per-turn element that must stay per-turn — the gate socket — travels in the
environment.

### 3.3 Decisive hook-fire + deny probe on the SHELL class

One real turn, gate denying everything:

```
gate saw:     ["bash","read"]
status:       blocked_on_gate     escalations: 2
usage:        tokensIn=21024 tokensInUncached=6944 cacheReadTokens=14080
              tokensOut=315 costUsd=0.020002 quality=complete subagentTurns=0
```

Grok's own final message: *"Terminal tool (once) — Command: `echo
cormidia-shell-probe` — Result: **Denied** — `Hook denied: certification denial
(shell class)`. Read tool (once) — Target: `README.md` — Result: **Denied**."*

Both the shell class and the read class traversed the Cormidia gate
pre-execution and neither ran. The read class is the one the ACP permission
path never sees at all.

An earlier bounded probe extended this to every tool grok reached in a
free-running turn — `run_terminal_command`, `read_file`, `search_tool`
(×2), `list_dir` — all five hook-gated, all five denied, with zero
`session/request_permission` messages on the wire (the hook denies before the
permission stage is reached).

### 3.4 CF-B25-L3 — the shared two-turn conformance walk

```
caseId=CF-B25-L3   providerTurns=2   equivUsd=0.057996
sessionId=019fdbb6-5eed-7d70-b90f-37d2cfcd110c
gateActions=[{"tool":"bash","input":{"command":"cat /etc/hosts"}},
             {"tool":"bash","input":{"command":"pwd"}}]
violationIds=[]
```

Both turns denied terminally, the gate path observed twice with the real
commands, and turn 2 resumed **the exact session id** from turn 1 through
`session/load`. Violations empty.

Resume identity deserves a note: `session/load` returns no session id of its
own, so echoing the requested id back would have made a mismatch undetectable.
The adapter instead takes the id grok itself reports through the SessionStart
hook envelope as ground truth and raises a typed
`error_resume_session_mismatch` when it disagrees.

## 4. Declared capability tiers, and what proved each

| Capability | Tier | Proof |
| --- | --- | --- |
| `tool_gate` | `adapter` | §3.3 + §3.4 live; L1/L2 offline with a seeded internally-resolved-shell liar |
| `session_resume` | `native` | §3.4 — exact id across two turns via `session/load` |
| `cancellation` | `adapter` | `session/cancel` notification then process-group termination (offline) |
| `cache_telemetry` | `adapter` | §3.3/§3.4 — `cachedReadTokens` / `cacheCreationTokens` from ACP usage |
| `structured_verdict` | `fallback` | ACP exposes no client-settable output schema on this surface; the loop's lenient parser is the fallback |
| `intra_turn_fanout` | `unsupported` | **Enforced, not merely declared** — the bridge denies `spawn_subagent` |

Fan-out is the one worth spelling out. Grok *has* a fan-out tool, and no probe
has proven that a subagent's tool calls traverse the hook. Declaring the surface
absent while leaving the tool reachable would be an INV-002 hole, so the bridge
refuses to classify the route and grok receives a deny. The capability profile
then tells the turn to work serially, and a degradation note lands when
`delegation.allow` is configured.

## 5. Honest gaps, written down rather than papered over

1. **The per-turn budget cap is terminal, not running.** Grok reports cost only
   at turn end (`_meta.usage.costUsdTicks`); the per-round `response_completed`
   notifications carry tokens but no cost. Cormidia will not invent a price
   table to manufacture a mid-run figure, so the cap converts a crossed budget
   into `failed` + `error_max_budget_usd` + exactly one incident note *after*
   the spend, and the incident note says so. Recorded in the capability matrix.
2. **`TurnRequest.maxTurns` has no native knob.** `--max-turns` exists on the
   TUI surface only; `grok agent` rejects it (verified: `error: unexpected
   argument '--max-turns' found`).
3. **`--no-auto-update` is rejected by `grok agent stdio`.** The adapter sets
   `GROK_DISABLE_AUTOUPDATER=1` instead — the same #224 posture by another
   mechanism.
4. **Effort is not transmitted.** B-25 records grok's effort surface as an
   honest absence, and this adapter revision honors that: `xhigh`/`max` throw
   rather than being aliased down, and `low|medium|high` are not sent.
   **This is now known to be conservative.** grok 1.0.0's `initialize` response
   advertises `supportsReasoningEffort: true` with
   `reasoningEfforts: [high (default), medium, low]` for `grok-4.5`, `grok agent`
   accepts `--reasoning-effort`, and `session/new` returns an
   `x.ai/sessionConfig` options list with `category: "mode"` entries the ACP
   `session/set_mode` call could select. **Proposed contract amendment for a
   follow-up:** wire effort natively at tier `native` and keep the throw for
   `xhigh`/`max`. Not done here, because changing B-25's effort clause is a
   contract edit that should be made deliberately rather than as a side effect
   of the first implementation.
5. **The model roster is honest-unavailable.** `grok models` works but requires
   a working credential, which a `cormidia roles set` edit must not — the same
   classification claude and codex already carry.
6. **Bypass hazard (matrix caveat).** If a future grok version were to stop
   firing `PreToolUse` for some class, the adapter would still refuse any turn
   whose handshake it cannot observe, but a class-specific regression *inside* a
   proven-live hook path would not be caught by the handshake alone. The
   offline seeded-liar case and the live walk are what re-prove it per version
   bump; re-run both on every bump.

## 6. Offline evidence deposited in the same change

- `tests/fixtures/adapters/grok-double.ts` (+ `.test.ts`, 14 cases) — scripted
  ACP transport driving the **product's own** `createGrokGateCore`, with seeded
  transport liars: `suppress_hook_handshake`, `internally_resolved_shell`,
  `leak_operator_permission_mode`, `bypass_subagent_gate`.
- `tests/hermetic/cf-adapter-conformance/adapter-conformance-pair.test.ts` —
  grok joins the shared walk; negative control proves an unproven gate refuses.
- `…/payload-transport.test.ts` — CF-B25-PAYLOAD, 300 KB brief byte-identical
  through `session/prompt`, with the ARG_MAX-truncation negative control.
- `…/subagent-gate-ordering.test.ts` — CF-B25-DEGRADE, six cases including the
  denied `spawn_subagent` and two envelope liars.
- `tests/unit/cf-b25/grok-isolation-and-gate.test.ts` — 16 cases pinning the
  isolation, the hook config, tool normalization, and the terminal budget guard.

## 7. Sources

- Vendor docs shipped with the binary (`~/.grok/docs/user-guide/`), read
  2026-08-07: `10-hooks.md` (hook events, JSON format, fail-open semantics,
  client/SDK gate timeouts), `22-permissions-and-safety.md` (authorization
  order, always-approve, read-only tool list), `14-headless-mode.md`
  (usage/cost policy, 1 USD = 10^10 ticks), `12-project-rules.md` (AGENTS.md and
  `.grok/rules/` discovery), `05-configuration.md` (`[compat.*]` harness
  compatibility), `15-agent-mode.md` (ACP/stdio).
- `research/2026-08-06_adapter-upstream-references.md` → Grok Build.
- `validation-design/contracts/B-25-grok-build.md`, `contracts/provider-adapter-core.md`.
- Raw ACP traffic and probe transcripts: session scratchpad
  (`grok-probe/probe1..4.mjs`, `grok-cert.ts`), preserved for the review.
