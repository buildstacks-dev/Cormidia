# Cursor adapter certification — `cursor-agent` CLI headless

*2026-08-07. Standalone §5 certification of the B-24 Cursor harness (#338)
against the operator's installed binary. Every capability tier declared in
`src/runtime/capabilities.ts` for `cursor/v1` is proven here, at the declared
tier and no higher. Supersedes the Cursor facts (not the decisions) in
`research/2026-08-06_adapter-upstream-references.md`, which was written from
documentation before the binary was exercised.*

## Version band and identity

| Fact | Value |
| --- | --- |
| Binary | `cursor-agent` (resolved at `~/.local/bin/cursor-agent`) |
| Version | **2026.08.04-aaa8809** |
| Auth | stored login (`✓ Logged in as …`); `CURSOR_API_KEY` is the CI alternative |
| Surface | `cursor-agent -p --output-format stream-json`, brief on **stdin** |
| Host note | on this host the short alias `agent` resolves to **Grok Build** — the adapter never uses it |

Re-certification is required on any version bump: this is a fast-moving CLI and
every claim below is a claim about this exact build.

## The question this certification existed to answer

F-PT-026 asked whether Cursor exposes a gate seam that honors INV-002's
**pre-execution** classification, or whether the capability profile has to
record a degraded/unsupported `tool_gate` tier with narrowed role eligibility.
The finding's own probe (2026-08-07, issue #338) had established that the
`-p` stream-json surface is fire-and-forget — no approval event a wrapper can
answer — and that the `.cursor/hooks.json` machinery is present in the bundle,
but could **not** observe it firing under `-p`.

**It fires.** The ladder's first rung is certified; the `cursor-agent acp`
fallback was not needed and is not implemented.

## Rung 1 — `.cursor/hooks.json` `preToolUse`, certified

### Firing

A project-level `.cursor/hooks.json` registering `preToolUse` is loaded and
executed under `-p --force`. Observed hook payload (verbatim shape):

```json
{"conversation_id":"…","generation_id":"…","model":"default","tool_name":"Shell",
 "tool_input":{"command":"echo CORMIDIA_DENY_ME","cwd":"","timeout":30000},
 "tool_use_id":"…","cwd":"","session_id":"…","hook_event_name":"preToolUse",
 "cursor_version":"2026.08.04-aaa8809","workspace_roots":["…"],
 "user_email":"…","transcript_path":null}
```

Coverage observed across probes: `Shell`, `Read`, `Write`, `Grep` (which also
carries `globToolCall`), and `Task`. Every `tool_call` seen in the stream had a
matching `preToolUse` invocation.

`beforeShellExecution` and `beforeReadFile` also fire, **in addition to**
`preToolUse`, for the same action. That is why the adapter registers
`preToolUse` and nothing else: registering the specific events too would
consult the in-process gate twice for one action, violating the shared
"gate exactly once" detector. `beforeSubmitPrompt` and `stop` did **not** fire
headless (0 invocations on a no-tool turn), so there is no pre-model liveness
hook to lean on — see "What is not proven" below.

### Enforcement

A `{"permission":"deny"}` reply stops the action **before it executes**, proven
by side-effect absence rather than by the model's own report:

| Probe | Denied action | Side effect after the turn |
| --- | --- | --- |
| shell | `echo CORMIDIA_DENY_ME` | `shellToolCall.result.rejected` carrying our reason |
| write | create `CORMIDIA_DENY_ME.txt` | file **not created** |
| write (deny-Write-only) | create `zzz-probe.txt` | file **not created** |
| subagent shell | `touch SUBAGENT_SIDE_EFFECT.txt` | file **not created** |

`failClosed: true` is set on the registration because Cursor's documented
default is fail-**open**: a crashed bridge would otherwise silently ungate the
turn.

### Fan-out

`Task` spawns a real subagent headless. The subagent's own tool calls arrive at
the **same** `preToolUse` socket from the subagent's **own** `conversation_id`,
and a denial there produces no side effect. `subagentStart` did not fire in this
build; `preToolUse` with `tool_name: "Task"` is the spawn-time gate point and a
denial there blocks the spawn outright
(`taskToolCall.result.error.error = "Task blocked by preToolUse hook: …"`).

The parent stream reports the `taskToolCall` but does **not** itemize the
subagent's inner tool calls, so fan-out is gated but not itemized — recorded in
the capability matrix.

Honest observation worth recording: in one probe the subagent's shell was denied
twice and the subagent then **reported fabricated stdout** to its parent. The
gate held (no side effect); the subagent's prose was untrustworthy. That is an
argument for the gate being the enforcement and prose never being evidence
(INV-012), not an argument against the tier.

## §5 certification ladder results

All runs used a temp git workdir, real auth, and the unmodified adapter.

### 1. Readiness (non-billable)

```
readiness: ready (billable=false)
cursor-agent 2026.08.04-aaa8809 reports a usable stored login (✓ Logged in as …); no model turn sent
```

Readiness is binary + usable auth. Binary presence alone is never readiness, and
Cormidia never installs the provider (#224).

### 2. Model catalog

`available=false`, with the reason named: the roster is account-scoped and
readable only by running `cursor-agent --list-models` with a working credential,
which a config edit must not require. `cormidia roles set` therefore prints the
UNVERIFIED warning for Cursor, exactly as it does for Claude and Codex.

### 3. CF-B24-L3 — the shared two-turn conformance walk

```json
{
  "caseId": "CF-B24-L3",
  "providerTurns": 2,
  "equivUsd": 0.080423,
  "sessionId": "8240eb1c-1ea0-4e36-abc6-b9cfe3a38325",
  "gateActions": [
    { "tool": "bash", "input": { "command": "cat /etc/hosts" } },
    { "tool": "bash", "input": { "command": "pwd" } }
  ],
  "violationIds": []
}
```

Both turns ended `blocked_on_gate`, the second turn resumed the **exact** prior
chat id, and usage was never marked mechanical. Model
`claude-sonnet-5-thinking-high`, effort `high`, `maxTurnBudgetUsd` 2.

### 4. Decisive hook-firing probe — one allow, one deny, same turn

```
status=blocked_on_gate
gate: read(.cursor/rules/cormidia-turn-context.mdc) → allow
      bash("echo CERT_ALLOWED")                     → allow
      bash("touch CERT_FORBIDDEN.txt")              → DENY
escalations: [{ action: bash "touch CERT_FORBIDDEN.txt", reason: "cert: forbidden side effect" }]
usage: tokensIn 140758 (uncached 8, cacheWrite 10433, cacheRead 130317), tokensOut 640,
       costUsd 0.08784285 (estimated), quality "estimated"
FORBIDDEN SIDE EFFECT PRESENT: false
```

The allowed command ran, the denied one did not, and the denial is a terminal
`blocked_on_gate` with an escalation — not a silent drop.

### 5. Subagent fan-out gate probe

```
status=blocked_on_gate  subagentTurns=1
gate: read(context rule)                       → allow
      task("Create SUBAGENT_FORBIDDEN.txt")    → allow
      read(context rule)   [subagent]          → allow
      bash("touch SUBAGENT_FORBIDDEN.txt")     → DENY
subagent events: started/completed, same spanId toolu_01YNFNjakjoNHFZBBns6xaxB
escalations: [{ action: bash "touch SUBAGENT_FORBIDDEN.txt", reason: "cert: subagent shell denied" }]
usage: tokensIn 105503, tokensOut 588, costUsd 0.076719 (estimated)
SUBAGENT SIDE EFFECT PRESENT: false
```

This is the load-bearing probe for `intra_turn_fanout`: a spawned subagent's
critical op reached the gate identically to a main-thread op, and the denial had
no effect on the filesystem.

**Total certification spend: ~$0.245 estimated across 4 provider turns**, inside
the policy's pre-merge changed-adapter bound (≤2 turns/$5 per campaign case;
these are separate standalone probes, not one campaign).

## Two defects the live run caught that no double would have

Both are now fixed, and both have offline detectors in the same change.

1. **`.cursor/cli.json` requires `permissions.allow`.** Writing deny-only failed
   the CLI's own schema validation and `cursor-agent` exited 1 *before any
   turn*: `Invalid project config …: schema validation failed … ["permissions","allow"] Required`.
   The adapter now always writes `allow: []` — the only value that cannot widen
   — alongside the composed deny list.
2. **A stdout-close race swallowed the provider's diagnostic.** The transport
   ended its event stream on `stdout` close, which fires *before* the child's
   own `close` event, so the exit code and drained stderr arrived after the
   iterator had already completed. The config error above surfaced as a bare
   `failed` turn with no reason at all. The stream now terminates only on the
   child's `close`.

## Capability tiers, as certified

| Capability | Tier | What proved it |
| --- | --- | --- |
| `tool_gate` | `adapter` | `preToolUse` → per-turn Unix socket → in-process `GateFn`, fail-closed; deny produced no side effect (probes above) |
| `intra_turn_fanout` | `native` | `Task` fan-out real headless; subagent's own call gated; denial had no side effect |
| `session_resume` | `native` | `--resume <chatId>` returned the same `session_id` at init and restored prior context (secret-word probe: turn 2 answered `BANANA`) |
| `cancellation` | `adapter` | process-group termination (SIGTERM → SIGKILL), the Codex pattern |
| `structured_verdict` | `fallback` | no output-schema knob exists on the CLI surface; the loop's lenient parser is the fallback |
| `cache_telemetry` | `adapter` | terminal `usage` carries `inputTokens`/`cacheReadTokens`/`cacheWriteTokens`/`outputTokens`; `inputTokens` is the **uncached** count |

## Honest limitations

- **Cost is estimated, and the budget cap is a turn-boundary check, not a
  running guard.** `stream-json` reports usage exactly once, in the terminal
  `result` event — there is no mid-turn token notification. `costEnforcementFor("cursor")`
  therefore returns `estimated_terminal_only_no_progress`, and nothing in the
  surfaces implies a hard mid-run ceiling (INV-008). Prices come from Cursor's
  own published table (<https://cursor.com/docs/account/pricing>, fetched
  2026-08-07); unpriced ids fall back to a documented upper bound, never zero.
- **No effort knob exists.** Effort lives only in the model id
  (`…-low|-medium|-high|-xhigh`). The adapter refuses a tuple whose assignment
  effort contradicts the id rather than silently picking one; assignment
  `efforts:` lists are what constrain candidates.
- **Hermeticity is partial.** Cursor ingests operator-global material: a probe
  observed the agent reading `~/.cursor/skills-cursor/create-hook/SKILL.md`.
  There is no `settingSources: []` equivalent on this surface. Those reads *do*
  reach the gate (they are ordinary `Read` tool calls, so Cormidia can see and
  deny them), and the role's native deny list forbids writes under
  `~/.cursor/**`, but the ingestion itself cannot be switched off. Recorded as
  a known limitation, not papered over.
- **Fan-out is gated but not itemized.** The parent stream shows the
  `taskToolCall`, not the subagent's individual calls; `subagentType` arrives as
  `{unspecified:{}}` in the stream even when the hook payload names
  `generalPurpose`, so the emitted subagent event name is `unspecified`.
- **An app-authored `.cursor/hooks.json` or `.cursor/cli.json` is refused.**
  Cormidia owns the per-turn Cursor configuration and will neither replace nor
  merge an app's own — merging would let an app hook answer `allow` on the gate
  channel. Repos that use Cursor hooks for their own purposes cannot currently
  run Cursor turns under Cormidia.

## What is **not** proven

The pre-spend handshake proves the bridge works end to end (binary resolution,
cwd semantics, socket reachability, both JSON shapes, the fail-closed path) but
it **cannot prove that Cursor will choose to call the hook** on a future build.
`beforeSubmitPrompt` does not fire headless, so there is no in-turn liveness
signal available before the model acts. Two things carry that risk instead:

1. the certified version band above, re-checked on every bump; and
2. the adapter's post-turn **executed-versus-allowed cross-check** — if more
   tool calls executed than the gate allowed, the turn is reported `failed` with
   `error_gate_not_observed` and never `completed`. Its seeded negative control
   is `CF-B24` "a CLI that stopped loading hooks executes ungated".

`cursor-agent acp` (a hidden ACP JSON-RPC server, `cursor-agent acp --help`
confirms it exists) remains the documented fallback rung if a future build stops
firing hooks headless. It is deliberately not implemented today: shipping an
unused second transport would be untested code on the gate path.

## Offline detectors deposited with this certification

Per the standing rule that L3 findings deposit L1/L2 detectors, this change
lands: `tests/fixtures/adapters/cursor-double.ts` + its self-test (real
stream-json shapes, including the `rejected` / `permissionDenied` / `success`
result variants), the shared two-turn walk wired for `cursor`,
`CF-B24-SUBGATE`, `CF-B24-PAYLOAD` (300 KB brief over stdin), the budget pin,
and `tests/unit/cf-b24/cursor-registration.test.ts`. The two live-caught defects
above are covered by the `allow: []` config assertion and by the
non-JSON-stream-line typed-failure case.
