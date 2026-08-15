# ACP bridge and adapter integration — relevance review

*2026-08-14. Reviewed: [`giuliastro/harness-remote`](https://github.com/giuliastro/harness-remote)
at `99b3b4c`, and the Agent Client Protocol specification
([`agentclientprotocol/agent-client-protocol`](https://github.com/agentclientprotocol/agent-client-protocol))
at `9927cf6` — schema v1 stable, v2 unstable draft. Assessment only. It proposes
no change to a human-ratified surface; anything it argues for belongs in
`docs/PURPOSE.md` or the issue tracker by the ordinary route.*

## Verdict

The question asked was: should Cormidia stop building adapters the hard way and
become a wrapper on top of the ACP bridge, so that supporting many harnesses gets
easier over time, and so that local and remote harnesses look the same?

**No — not as an adapter strategy, and not for the reason hoped.** Three findings
decide it, each verifiable against the specification rather than against opinion:

1. **ACP does not make execution location-independent.** ACP is JSON-RPC over
   **stdio to a child process**. Its own remote-transport RFD opens with "ACP only
   has stdio. There is no standard remote transport" and is still `Active`, not
   `Completed` (moved to Active 2026-07-02). What makes `harness-remote` remote is
   the HTTP daemon it wrote *above* the ACP client — machine identity, task store,
   auth, CORS — not ACP. The location-independence the review was hoping to buy is
   not in the protocol; it is in the layer someone builds over it.

2. **ACP's permission channel cannot carry Cormidia's gate.** The spec says the
   Agent **MAY** request permission before executing a tool call
   (`docs/protocol/v1/tool-calls.mdx`). MAY, not MUST — the decision of what to ask
   about belongs to the agent, and a client cannot tell "nothing needed approval"
   from "the agent stopped asking". Cormidia already proved this empirically on
   grok, from the client side, on 2026-08-07 (F-PT-027): read-only tools never
   reach the ACP request path, and a persisted `permission_mode = "always-approve"`
   suppresses every request with **no client-visible difference**. `harness-remote`
   confirms the same reading from the opposite direction — it auto-approves every
   request and documents why (§1.3).

3. **The transport is the cheap part of an adapter.** Cormidia's grok adapter is
   the worked example, because it *is* an ACP adapter already. Of its 1,422 lines,
   the ACP JSON-RPC client is **191 (13%)**; the gate bridge, hook, provider
   isolation and fail-closed session proof are **723 (51%)**. Adopting a shared ACP
   client removes the 13% and none of the 51%.

**But the second question is the right one, and it is under-served.** Running a
turn inside a sandbox or container — with the harness binary, tools, MCP, skills
and credentials provisioned inside it — is a real customer-shaped requirement, and
Cormidia has no seam for it. `Runtime.runTurn` takes a `workdir` and assumes the
provider process is a child of the Cormidia process on the same host. That
assumption is load-bearing in every adapter and is not written down anywhere as a
decision. The valuable idea in the source material sits at exactly that boundary
— one layer *above* ACP, which is precisely where `harness-remote` put it.

**Recommendation:** do not adopt ACP as the adapter contract. Open one bounded
design spike on the **execution-placement boundary** (§7), which is the durable
finding; keep ACP on the watch list as a candidate *transport tier inside* the
existing adapter contract, re-evaluated when its transport RFD completes and when
per-turn token usage stabilizes (§8.4). Take three specific mechanisms from
`harness-remote` regardless of that decision (§8).

## 1. What `harness-remote` actually is

A **local-first remote control plane**: run and supervise AI coding agents on the
machine where the code lives, from a phone, browser, or desktop app. 4,314 lines
in `bridge/src`, plus a web/Electron/Capacitor client. Its own README states the
boundary — "Execution stays on your machines. Repositories stay on your machines.
Agent credentials and model access stay on your machines."

```
phone · web · desktop          ← clients
        │  HTTP + Basic auth + CORS
   Machine Daemon               ← bridge/src (the actual remote seam)
        │  stdio JSON-RPC (ACP)          │  HTTP
  Claude · Codex · OMP · PI      OpenCode
```

### 1.1 It is a supervision plane, not an orchestration plane

There is no notion of a role, a ticket, a review, a verdict, a budget, an
approval, or a settlement. A task is a prompt plus a git worktree plus a session
id. `TaskLauncher.startPrompt` fires `session/prompt` and hands the promise two
callbacks. That is the whole execution model. Comparing it to Cormidia's loop is
a category error — it is comparable to `src/runtime` alone, and only to the
transport third of that.

### 1.2 ACP is not what makes it remote

This is the load-bearing observation, and it is easy to miss. `AcpClient` spawns a
child process and speaks newline-delimited JSON-RPC over its stdin/stdout
(`bridge/src/acp-client.js:83`). Every ACP hop in the project is local. Remoteness
is supplied by `MachineDaemon` + `createBridgeServer` + `http-policy.js` — an
HTTP surface with machine identity, Basic auth, timing-safe comparison, CORS and
Chromium Private Network Access handling. Swap ACP for anything else and the
product still works; remove the daemon and it is a local CLI.

The daemon models transport explicitly, and the abstraction is *two-branched*, not
uniform:

```js
registerAcpHost({ ..., transport: "acp" })          // machine-daemon.js
registerManagedHttpHost({ ..., transport: "http" })
```

…and every consumer switches on it (`if (entry.kind === "acp") … if (entry.kind === "http")`
in `task-launcher.js`, three times). Even the project built around ACP did not get
a uniform adapter surface out of ACP. It got a uniform surface out of **its own
port**, with ACP as one implementation behind it. That is the actual lesson.

### 1.3 Its permission posture is the opposite of Cormidia's

Every ACP profile in `harness-profiles.js` sets `permissionMode: "allow"`, and
`AcpClient.#respondPermission` auto-selects `allow_once`. The comment is candid
and worth quoting in full, because it explains *why* a supervision plane can make
this choice and a governance plane cannot:

> A tool call stalls without an answer, and answering with an error silently
> stops the agent from doing any work — PI reported success while touching no
> file. Granting matches OMP, whose agent approves its own tool calls and never
> asks, and there is no way to prompt the user mid-turn on a phone.

Three facts are packed in there. Denial through this channel is not a first-class
outcome (it manifests as an agent that quietly does nothing and reports success).
Some agents never ask at all. And the human is not present during the turn. All
three are true for Cormidia as well — the human is asleep, not holding a phone —
which is exactly why Cormidia routes denials into typed `GateEscalation` records
and an approval queue rather than a modal.

### 1.4 It loses run state that Cormidia cannot lose

`TaskLauncher.inspectRun` returns `"unknown"` for every ACP host, with this note:

> ACP gives us an authoritative completion signal while the prompt request is
> alive, but there is no backend-neutral post-restart session status primitive to
> query here.

Correct, and confirmed against the schema: ACP v1 has `session/new`,
`session/load`, `session/list`, `session/prompt`, `session/cancel` — and no
"what is the state of this session" query. Completion is observable **only** as
the resolution of the in-flight `session/prompt` promise. If the client process
dies mid-turn, the turn's outcome is unrecoverable over the protocol.

For a phone app that means a spinner that never resolves. For Cormidia it would
mean an unsettleable provider turn — spend that happened, with no authoritative
terminal status — which is the exact failure `durable-claim.ts`, `recordTurnOnce`
and the run-envelope machinery exist to make impossible. The OpenCode path in
`harness-remote` *can* answer the question (`GET /session/status`), which is why
that harness is wired over HTTP rather than ACP. Cormidia's own OpenCode adapter
chose the same surface for overlapping reasons.

## 2. What ACP standardizes, precisely

Read from the spec repo rather than from summaries, because the gap between the
marketing surface and the normative surface is where this decision lives.

| Surface | Status in v1 stable | Consequence for Cormidia |
| --- | --- | --- |
| stdio JSON-RPC framing, `initialize` version negotiation | Stable | Already implemented (`grok-acp-client.ts`) |
| `session/new`, `session/load`, `session/list` | Stable | Maps to `SessionHandle`; genuinely useful |
| `session/prompt` (payload, not argv), `session/cancel` | Stable | Matches the ARG_MAX rule and `AbortSignal` |
| `session/update` streaming (message chunks, tool calls, plans) | Stable | Maps to `TurnEvent` |
| `session/request_permission` | Stable but **MAY** | **Not a gate** — §3 |
| `usage_update` = `{used, size, cost?}` | Stable (2026-06-05) | Context occupancy + *cumulative session* cost |
| Per-turn token breakdown (in/out/reasoning/cache) | **Draft RFD**, deliberately held | Does not meet `TurnUsage` — §4 |
| Remote transport (Streamable HTTP / WebSocket) | **Active RFD, not completed** | Does not deliver location independence — §5 |
| `authenticate` + declared `authMethods` | Stable | Genuinely useful — §8.2 |
| v2 (extensible permission subjects, better tool-call updates) | **Unstable draft** | Watch |

The design philosophy section states the trust model outright:

> **Trusted**: ACP works when you're using a code editor to talk to a model you
> trust. You still have controls over the agent's tool calls, but the code editor
> gives the agent access to local files and MCP servers.

ACP is a **trusted-agent, human-in-the-loop, editor-integration** protocol. Its
job is to make an agent renderable and steerable inside an IDE. Cormidia's model
is an **untrusted agent under fail-closed enforcement with no human present**.
Every specific mismatch below is a consequence of that one difference. This is not
a defect in ACP; it is a statement of what it was built for.

## 3. The gate finding (decisive)

Cormidia's INV-002 is that every tool action traverses `hooks.gate`, and an
adapter with no proven gate seam **refuses** rather than degrading. Three
independent lines of evidence say ACP's permission channel cannot carry that:

**Normative.** `session/request_permission` is `MAY`. The agent decides what is
worth asking about. A protocol that does not oblige the agent to ask cannot be a
client-side chokepoint, however well-behaved a given agent happens to be.

**Empirical, from Cormidia's own certification.** `grok-gate-bridge.ts` records
the 2026-08-07 probe: read-only tools (`read_file`, `list_dir`, `grep`) never
reach the ACP path at all, and a persisted `[ui] permission_mode = "always-approve"`
suppresses every request with no client-visible difference. `PreToolUse` is
evaluated ahead of permission rules, remembered grants, built-in read-only
auto-approvals and the prompt policy — so it is the only surface that sees every
action. Cormidia kept the ACP request wired as a **backstop** routing through the
same gate, which is the right posture and should stay.

**Empirical, from the other side.** `harness-remote` — written by people whose
goal was to make ACP work well across four harnesses — concluded that the honest
thing to do with this channel is auto-approve it (§1.3).

Two corollaries worth stating plainly, because they close off the obvious retorts:

- *"Deny through ACP instead of auto-allowing."* `harness-remote` reports what
  happens: PI "reported success while touching no file". A denial delivered as
  `cancelled` is not a typed refusal — it is an agent that silently stops working
  and then narrates success. Cormidia's `subagentTurns`-from-records rule exists
  because a harness narrating work it did not do is a known failure mode.
- *"Absence of a permission request means nothing happened."* This is exactly
  F-PT-027, the failure the grok handshake was built to prevent. It must not be
  re-derived under a new protocol name.

The upshot: an ACP-based adapter still needs a per-harness, vendor-specific,
proven-per-turn gate seam. That is the expensive half of every adapter, and ACP
does not touch it.

## 4. Telemetry, budget and settlement

`TurnUsage` requires `tokensIn`, the uncached/cache-create/cache-read split,
`tokensOut`, `costUsd` with an honest `costEstimated` flag, an `AuthMode` billing
label whose `subscription` value is an *authoritative* zero, `subagentTurns` from
records, and a `quality` label distinguishing `none` from `unavailable`.

Stable ACP offers `UsageUpdate { used, size, cost? }` — how full the context
window is, and optionally what the session has cost so far. Cumulative, not
per-turn; no split; no billing model. The per-turn shape is an explicit **Draft**
RFD, held open on purpose:

> This RFD is intentionally kept in Draft while token accounting semantics are
> still being refined … Input, output, reasoning, and cache token categories do
> not map cleanly across all providers.

The ACP working group is holding open the exact question — how to normalize
per-provider token accounting — that Cormidia answered concretely in
`turn-usage.ts`, `harness-pricing.ts` and `auth-mode.ts`. Cormidia is ahead here,
and would be trading a solved problem for a draft.

Consequence for `maxTurnBudgetUsd`: the contract requires enforcement "at the
finest truthful observation point the provider exposes". A cumulative
session-cost update is coarser than what most adapters already extract natively,
and `costEnforcementFor` would have to degrade for every harness moved onto it.
That is a gate weakening, which the standing rules forbid.

## 5. Question 1 — can Cormidia support local and remote adapters uniformly?

**Yes, and it should — but that uniformity comes from a Cormidia port, not from
ACP.** The premise that ACP delivers it does not hold: ACP has no remote
transport today, by its own RFD's admission.

Three ways to get location independence, honestly compared:

| Approach | What it buys | Cost / risk |
| --- | --- | --- |
| **Wait for ACP remote transport** | Standard wire format for a remote harness | RFD `Active`, not `Completed`; v1 explicitly has no in-flight message replay on reconnect, and durability is deferred to v2. A turn is a long-running, expensive, exactly-once operation — "reconnect and hope" is not a settlement model. Adopting a moving spec also imports its churn into a certified surface. |
| **Cormidia placement port** (`harness-remote`'s actual shape) | Location becomes a property of *where the adapter runs*, not of the adapter | Real design work; but it is the work that would be needed under any transport, and it composes with #366/#367 |
| **Adopt ACP as adapter contract** | — | Loses the gate (§3), loses per-turn telemetry (§4), loses recoverable run state (§1.4), adds a vendor wrapper per harness (§6). Not viable. |

The middle row is what `harness-remote` built and what Cormidia lacks. The seam is
narrow, and it is visible in `types.ts` today: `TurnRequest.workdir` is a
host-local absolute path, and every adapter spawns a child process next to it.
Neither fact is a decision anyone recorded — they are assumptions that hardened.
Naming the boundary is what makes remote *and* sandboxed placement expressible;
see §7.

**The capability question the user raised — bubbling capability up so it can be
used — is already solved, and better than ACP solves it.** Two models:

- **ACP:** `initialize` returns `agentCapabilities` — self-declared, by the agent,
  at connect time. Useful for negotiation; it says what the vendor *claims*.
- **Cormidia:** `RuntimeCapabilityProfile` with `native | adapter | fallback |
  unsupported` tiers, certified against a dated `research/` record, consumed as a
  functional input by `preflight.ts` and `context-manifest.ts`. The
  `MEDIA_READ_TIERS` note states the rule: *capability follows evidence, never
  documentation.*

Those are complements, not substitutes. An ACP `initialize` handshake is a fine
*input* to a profile and a fine pre-spend contradiction check — if a vendor stops
advertising `loadSession`, refuse before spend rather than discovering it
mid-turn. It can never *be* the profile. Muse is the standing proof: its docs
described a hook seam that did not fire across twenty configurations.

## 6. What ACP would actually cost per adapter

The ecosystem argument is real — 39 agents in the ACP list, including Cursor and
Gemini CLI natively. But three of the four harnesses `harness-remote` drives over
ACP reach it through a **third-party wrapper**, not a vendor surface:

| Harness | ACP route | Nature |
| --- | --- | --- |
| Claude Code | `@agentclientprotocol/claude-agent-acp` | **Zed's** SDK adapter, third-party |
| Codex CLI | `@agentclientprotocol/codex-acp` | **Zed's** adapter, third-party |
| Pi | `@automatalabs/pi-acp` | third-party (of two competing forks) |
| Cursor, Gemini CLI, OpenCode, Grok Build | native `acp` subcommand | first-party |

For Claude and Codex — the two harnesses with the *best* current Cormidia
adapters, both `tool_gate: native`/`adapter` with proven seams — moving to ACP
means inserting a third-party process between Cormidia and a first-party SDK it
already drives directly. That trades a certified surface for a wrapper that must
itself be version-banded, certified, and re-certified on every bump, and whose
translation layer is a new place for gate and usage fidelity to be lost. It also
adds a second vendor to the risk surface for a harness that currently has one.

`harness-remote` fetches these at turn time:

```js
command: "npx", args: ["-y", "@agentclientprotocol/claude-agent-acp@0.63.0"]
```

That is directly incompatible with #224 (never install providers; required
preinstalled binaries) and with running a turn inside a network-restricted
sandbox. Its `resolveAcpLaunch()` already prefers a PATH-installed adapter and
documents why — "it is what the user installed, it starts without a network round
trip, and it sidesteps environments where `npx` cannot link a binary". Cormidia
would have to make the PATH path mandatory, which means an ACP adapter becomes a
*second* required preinstalled binary per harness. Support burden goes up, not
down.

**Where ACP does pay:** a harness that ships ACP first-party and has no SDK. That
is exactly the rule `research/adapters/2026-08-06_adapter-upstream-references.md` already
applied when choosing ACP for grok, and `grok.ts` says so in its header. The
existing policy is correct and needs no change. Cursor is the one adapter worth
re-examining opportunistically (§8.4) — it ships native ACP now and Cormidia
drives it through a headless CLI stream with a `--force` handshake.

## 7. Question 2 — sandboxed and containerized turns

This is the finding worth acting on, and it stands independently of ACP.

The requirement, stated as a customer would: *when a role invokes a harness for a
turn, run that turn inside a container or sandbox — with the harness binary,
tools, MCP servers, skills and credentials provisioned inside it — and give me the
same governance, evidence and settlement I get today.*

### 7.1 Why this is not covered by existing work

- **#366 (containment floor)** proposes lowering the *write boundary* to an OS
  syscall jail (Seatbelt/Landlock) around a process that is still Cormidia's own
  child, on Cormidia's own host. Its own scope section excludes "Remote/cloud
  sandbox placement (E2B, Modal, Kubernetes-style). Different decision, different
  risk." That exclusion is correct and it is precisely this gap.
- **#367 (brokered egress)** is the network axis of the same local model.
- **#453 (`TurnPort`)** is an *upstream campaign request → governed turn*
  translation port. Orthogonal; different boundary, same word. A placement seam
  must not be named `TurnPort`.

So: nobody owns the question of *where the provider process runs*.

### 7.2 What the assumption currently is, and where it is written

`TurnRequest.workdir: string` — a host-local absolute path — plus, in every
adapter, a `spawn`/in-process SDK call that assumes the provider is a child of the
Cormidia process on the same filesystem. Everything downstream inherits it:
`gitWorktreeWritableRoots()` computes host paths; the gate bridges are **per-turn
Unix domain sockets** (`grok-gate-bridge.ts`, `cursor-gate-bridge.ts`,
`opencode-gate-bridge.ts`, `muse-gate-bridge.ts`) — a same-host IPC primitive;
`grok-isolation.ts` copies `auth.json` into a per-turn provider home on the host;
`readiness.ts` probes credentials on the host.

**The gate bridge is the crux.** Cormidia's enforcement is a Unix socket the
harness's hook process connects back to. Put the harness in a container and that
socket must cross the boundary — and the moment it does, the boundary becomes part
of the gate's trust base. That is a safety-architecture change, not plumbing, and
it is why this needs ratification rather than an implementation ticket.

### 7.3 The shape a spike should evaluate

`harness-remote` shows the shape without solving the hard parts. A placement port
would need to answer, at minimum:

- **Provisioning contract.** What must exist inside the sandbox for a turn to be
  runnable: harness binary at a certified version, auth, MCP servers, skills,
  role-shaped deny config, the worktree. `readiness.ts` currently answers "is this
  host ready"; a placement port needs "is this *sandbox* ready", token-free, before
  spend. This is where "extensible and testable" is won or lost.
- **Where the gate lives.** Inside (the bridge socket moves in with the harness —
  then what stops the sandboxed agent from talking to it directly?) or outside
  (the socket crosses the boundary — then the boundary is in the trust base). This
  is the ratifiable question.
- **Credential blast radius.** Provisioning credentials *into* a sandbox is the
  opposite of the containment #366 seeks. A sandboxed turn with a live
  subscription credential inside it is a different threat model from a host turn,
  and it interacts with the HB-072 threat model (#423).
- **Fail-closed semantics.** A named error code for "placement could not be
  established", composing with the existing `error_gate_unproven` /
  `error_gate_seam_unavailable` / `error_gate_not_observed` family. Never a
  silent fall back to host execution.
- **Settlement across the boundary.** §1.4's failure is worse here: if the
  sandbox dies, spend happened somewhere Cormidia cannot query. `durable-claim.ts`
  is the right primitive; the spike must show it still closes.
- **Capability consequence.** Placement may *change* a harness's tier. That must
  be expressible — a profile is currently keyed by `RuntimeKind` alone.
- **Honest scope.** Two placements are worth defining and only one worth
  prototyping: `host` (today, the default, unchanged) and `container` (local OCI).
  A `remote` placement is a third case whose transport story is genuinely blocked
  on ACP's RFD or a Cormidia-owned protocol, and it should be named but deferred.

The payoff, if it lands, is the same compounding one #366 identified: a harness
whose in-process gate cannot be proven could become a *contained* turn instead of
a refused one. Muse and grok are both sitting in that state right now.

## 8. What to take from the source material regardless

Four things are worth borrowing on their own merits.

**8.1 Transport as a declared property of a registered host.** `MachineRegistry`
records `transport: "acp" | "http"` and `state: configured | available |
unavailable` per host, and `trackAgentHostLifecycle` wraps *every* start attempt —
"ACP starts lazily, so lifecycle tracking has to wrap every start attempt rather
than only initial daemon boot." Cormidia's `readiness.ts` is a point-in-time
probe; a per-turn liveness transition it could observe is a real gap for any
long-lived or remote host.

**8.2 Auth-method enumeration as a pre-spend fact.** ACP's `authenticate` returns
a declared list of `authMethods`, and `harness-remote` selects from it with an
explicit rule — prefer the method that reads existing on-disk credentials, avoid
`env_var` methods that would silently claim an unset API key "and fail later at
inference rather than here". That reasoning is exactly `auth-mode.ts`'s, arrived
at independently. Where a harness speaks ACP, the declared `authMethods` list is a
**token-free** input to `auth-mode-observers.ts` and a cheap contradiction check
against the declared `HARNESS_AUTH_SUPPORT` record. Small, safe, useful.

**8.3 Worktree hygiene details.** `WorktreeManager` refuses to remove a dirty
worktree, refuses a path outside its managed root, refuses a symlinked worktree
path, and preserves a branch whose deletion fails because it holds unmerged
commits. The symlink refusal is #198/TM-002 in another codebase; the
unmerged-branch preservation is a nice touch. Worth diffing against Cormidia's own
worktree lifecycle.

**8.4 A dated re-evaluation trigger for ACP, not a decision.** Three conditions
would change the §5 answer, and none has been met:
(a) the Streamable HTTP/WebSocket transport RFD reaches `Completed` **with** v2's
durability guarantees — message ids, stream resumability, defined reconnection —
because v1 explicitly defers those and a turn is an exactly-once operation;
(b) `end-turn-token-usage` stabilizes with a cache-aware per-turn split;
(c) a harness Cormidia wants ships ACP first-party *and* a provable pre-execution
gate seam. Cursor is the nearest candidate today: native ACP, and an already
certified `preToolUse` hook that would keep carrying the gate. That is a
bounded, opportunistic per-adapter question — not a strategy.

## 9. What not to do

- **Do not build a shared ACP client across harnesses.** `grok-acp-client.ts`
  already says why: "a shared client never shares certification evidence across
  harnesses." Transport reuse is an implementation detail behind per-harness
  boundaries. If a second ACP harness is certified, extracting a shared client is
  a mechanical refactor worth ~190 lines — do it then, on evidence, not now on
  anticipation.
- **Do not treat `session/request_permission` as a gate.** Keep it exactly where
  it is: a backstop routed through the same `hooks.gate`.
- **Do not take a dependency on a third-party ACP wrapper for a harness Cormidia
  already drives first-party.** It adds a vendor, a version band, a certification
  cycle and a fidelity-loss surface, and buys 13%.
- **Do not fetch adapters at turn time.** #224, and it breaks under sandboxing.
- **Do not name a placement seam `TurnPort`.** #453 owns that name for a different
  boundary.

## 10. Recommendation

1. **No change to adapter strategy.** The rule in
   `research/adapters/2026-08-06_adapter-upstream-references.md` — pick the vendor's
   canonical surface, prefer first-party SDK or server protocol, use ACP where it
   *is* the first-party surface — is correct and already produced the right answer
   for all seven adapters.
2. **Open one bounded design spike on the execution-placement boundary** (§7),
   scoped to `host` and `container`, deliverable a `docs/PURPOSE.md` decision
   proposal plus a throwaway PoC. Sequence it *after* #366: a containment floor
   changes what a placement boundary has to carry, and doing them in the other
   order would design the sandbox twice.
3. **Record §8.4 as a dated re-evaluation trigger** on the ACP question so it is
   revisited on evidence rather than on enthusiasm.
4. **Fold §8.2 (ACP `authMethods` as a token-free auth-mode input) into the grok
   adapter's next certification pass.** Cheap, and it tightens a fail-closed path.

## References

- `giuliastro/harness-remote` @ `99b3b4c` — `bridge/src/acp-client.js`,
  `acp-service.js`, `harness-profiles.js`, `machine-daemon.js`,
  `machine-registry.js`, `task-launcher.js`, `worktree-manager.js`,
  `http-policy.js`
- `agentclientprotocol/agent-client-protocol` @ `9927cf6` —
  `schema/v1/schema.json`, `docs/get-started/architecture.mdx`,
  `docs/protocol/v1/tool-calls.mdx`, `docs/rfds/streamable-http-websocket-transport.mdx`,
  `docs/rfds/end-turn-token-usage.mdx`, `docs/announcements/session-usage-stabilized.mdx`,
  `docs/announcements/transports-working-group.mdx`
- Cormidia — `src/runtime/types.ts`, `capabilities.ts`,
  `adapters/grok-acp-client.ts`, `adapters/grok-gate-bridge.ts`,
  `adapters/grok-session.ts`, `docs/harness/capability-matrix.md`,
  `docs/harness/adding-updating.md`
- `research/adapters/2026-08-06_adapter-upstream-references.md` ·
  `research/adapters/2026-08-07_grok-build-adapter-certification.md` (F-PT-027) ·
  `research/2026-08-09_shepherd-substrate-review.md` §4, §5.1
- Issues: #366 (containment floor) · #367 (brokered egress) · #224 (never install
  providers) · #339 (grok vendor risk review) · #358 (muse hook seam) ·
  #423 (HB-072 threat model) · #453 (`TurnPort`, different boundary)
