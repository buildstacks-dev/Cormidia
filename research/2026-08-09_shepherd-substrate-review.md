# Shepherd (shepherd-agents/shepherd) — relevance review

*2026-08-09. Reviewed at `d45074e`, package version 0.3.0 (alpha, MIT).
Assessment only — proposes no change to a human-ratified surface. Any decision
this argues for belongs in `docs/PURPOSE.md` by the ordinary route.*

## Verdict

Shepherd is the most directly relevant external system reviewed for Cormidia so
far, and it is **not a competitor** — it sits one layer *below* Cormidia. It is a
runtime substrate for supervising agent execution; Cormidia is a governed
organization that runs on top of such a substrate. The overlap is the safety and
evidence floor, and that is where Shepherd is ahead of us.

One finding is worth acting on:

> **Cormidia's containment is harness-dependent. Shepherd's is not.**
> Cormidia enforces the critical-ops gate *inside* each harness, through a
> per-vendor hook seam, and gets OS-level filesystem confinement on only two of
> seven adapters. Shepherd compiles the same kind of grant to writable roots and
> enforces it at the syscall (macOS Seatbelt / Linux Landlock) **outside** the
> agent process, so containment is identical no matter which CLI is inside.

Everything else here is either supporting evidence, a smaller idea worth
borrowing, or a reason not to take a dependency.

**Recommendation:** watch the project; do **not** take a dependency; open one
bounded design spike on a harness-independent containment floor (§5.1) and one
on brokered egress (§5.2). Both are safety-architecture changes and need
ratification, not a quiet implementation.

## 1. What Shepherd is

A Python (3.11+) substrate that records an agent run as a durable, inspectable,
reversible execution trace, and holds the run's world output to one side as a
**retained output** that a supervisor reviews before it is applied or discarded.

From the paper (arXiv:2605.10913 — Yu, Chong, Nandi, Soylu, Sun, Manning, Shi):
agent systems increasingly rely on **meta-agents** — higher-order agents that
create, operate on, and manage other agents. Meta-agent operations (coordinating
agents, halting risky actions *before* execution, repairing failed runs) require
runtime manipulation of agentic execution, and existing substrates expose only
transcripts and environment snapshots, so meta-agents build ad-hoc tooling to
reconstruct execution state. Shepherd makes execution a first-class object.

That is a precise description of what Cormidia had to build for itself.

**Scale and shape.** 1,967 tracked files (1,602 Python), ~1.8k stars, 150 forks,
5 open issues, 120 commits on `main`. Four workspaces:

| Component | What it is |
| --- | --- |
| `shepherd/packages/*` | The framework: core, runtime, dialect, providers, contexts, authoring, transform, export, sandboxes |
| `vcs-core/` | "Provenance-native version control for executable worlds" — the real substrate: containment, carriers, world store, operation journal, recovery |
| `shepherd2/` | Reference implementation of a frozen trace-microkernel ABI (`shepherd.kernel.abi.v0`) |
| `commons-vcs/` | Canonical VCS backend kernel |

**Five shipped concepts.** Tasks (a typed function used as a contract — the
docstring *is* the instruction, and editing it is a behavior change), Effects
(every boundary crossing is a named typed recorded event), Runs (one durable
record; four outcomes — finished / failed / exhausted / stopped — all values,
none a stack trace), Permissions (per-binding grants declared on the signature),
Placements (`jail` / `advisory` / `auto`, deciding whether grants are
OS-enforced or merely recorded).

**Providers:** claude, openai, opencode, litellm. **Remote sandboxes:** e2b,
modal, daytona, kubernetes, prime.

**What is explicitly not shipped** (their own roadmap page): ambient model
service for direct task calls, returned handles, typed value projection,
threading and durable children, and — pointedly — **task-as-value delegation,
the meta-agent shape that is the product's stated north star, "explicitly
deferred: no shipped 0.3.0 surface runs it."** Today you write it as plain
Python around retained runs.

Read that last line against Cormidia's status: the meta-agent shape Shepherd
defers is the thing Cormidia already runs against real repositories.

## 2. Where the two systems actually sit

They are solving adjacent halves of one problem and neither subsumes the other.

| | Shepherd | Cormidia |
| --- | --- | --- |
| Unit of work | A typed Python function (task) | A role turn against an app repo under org policy |
| System of record | The trace + world store (`vcs-core`) | Private GitHub repos (PURPOSE, non-negotiable) |
| Enforcement point | The OS syscall jail, outside the agent | The harness hook seam, inside the agent |
| Review | Retained output, settled once by a caller | Independent cross-provider Reviewer agent, PR, gates |
| Governance | None — no approval queue, no budget, no roles | The entire product |
| Economics | Usage recorded on the run | Ledger settlement, budgets, auth-mode billing semantics |
| Maturity | Alpha, 0.3.0, north star deferred | Build-complete, proven live, release gate active |
| Language | Python | TypeScript |

Shepherd has a stronger **floor** (containment, reversibility, trace). Cormidia
has the entire **building** (roles, approvals, budgets, review, learning,
release). Neither is a substitute.

## 3. Convergent evidence — the part that should reassure us

An independent group (Stanford / Northeastern) attacking the same problem
arrived at several of Cormidia's ratified positions without contact:

- **The check-time law.** Their egress-broker module states it directly:
  "Network egress is irreversible (no undo, no compensation), so per the
  check-time law it must be checked *before* it happens." That is Cormidia's
  approval boundary — approval is not execution, the action is content-bound,
  the check precedes the effect.
- **Fail-closed containment.** `jail` refuses rather than silently downgrading;
  `JailNotEstablished` is a typed refusal. This is exactly our
  `error_gate_unproven` / `error_gate_seam_unavailable` doctrine: an unproven
  gate is an ungated turn.
- **Deny by default, and authority declared up front.** "Not capabilities
  discovered in production."
- **The record is complete by construction, not by best-effort logging.**
  Their framing — "effects *are* the behavior: typed, refusable, and recorded
  whether or not anyone is watching" — is our "no side effect keys off agent
  prose."
- **No green by absence, enforced mechanically.** Their docs pipeline has a
  publication gate that *withholds* any page teaching an unshipped surface: 6 of
  35 pages public, 29 correctly refused, 58 errors when asked to promote them
  all. Every published page carries an "Applies to" version, and a published
  sentence that does not run on the installed package is filed as a bug.

That last one is worth stealing as-is (§5.5). Cormidia disclosure is currently
maintained by hand and by review discipline.

Where they are honest about being behind us: their `effects.md` declines to
teach the in-process interception surface because "answering a task that
declares world access with a handler that has none invites confidently
fabricated results." That is the same failure Cormidia caught in the Muse
adapter — a provider narrating subagents it never spawned — and solved with
`subagentTurns` from records, never from prose.

## 4. Evidence for the headline finding

### Cormidia's gate lives inside the harness

Every adapter installs a vendor-specific seam that calls `gate.ts`:
`codex-gate-hook.ts`, `cursor-gate-bridge.ts`, `grok-gate-hook.ts`,
`muse-gate-bridge.ts`, `opencode-gate-plugin.ts`, `pi-gate.ts`. The design is
sound and the conformance suite is demanding. But the seam is the vendor's, and
the vendors differ — as our own `src/runtime/AGENTS.md` records:

- **Muse Code** auto-approves tool calls headlessly and its managed-hook seam
  did not fire on the certified build ⇒ every turn must first prove the seam
  with a token-free handshake and otherwise refuse with
  `error_gate_seam_unavailable`. Capability profile: `tool_gate: unsupported`.
- **Grok Build**'s hook runner **fails open**, so `PreToolUse` silence is
  indistinguishable from an idle turn ⇒ a `SessionStart` handshake on a
  per-turn socket is required, else `error_gate_unproven`. Plus per-turn
  provider isolation, because the operator's `always-approve` mode and their
  `~/.claude/settings.json` would otherwise reach grok.
- **Cursor** cannot do real work without `--force` and its headless surface has
  no approval channel ⇒ a pre-spend handshake through the exact hook command,
  plus a post-turn executed-versus-allowed cross-check reporting
  `error_gate_not_observed`. Hook firing is a version-banded claim requiring
  re-certification on every `cursor-agent` bump.

Three of seven adapters needed bespoke machinery to establish merely that the
gate is *live*. That cost scales linearly with adapter count and re-accrues on
every vendor version bump.

### Only two adapters get OS-level filesystem confinement

`gitWorktreeWritableRoots()` computes the correct writable-root set — the
worktree plus the exact Git-owned external paths a linked worktree needs. It has
two consumers:

- `adapters/claude.ts:532` → the Claude SDK sandbox's `allowWrite`
- `adapters/codex.ts:658` → Codex's `sandboxPolicy.writableRoots`

`pi`, `opencode`, `cursor`, `grok`, and `muse` get none. For those five, "the
turn only writes inside its worktree" is a property of the harness behaving,
not a property the OS enforces. This is very likely a live contributor to why
Grok Build is confined to throwaway sandbox repos pending #339 — the vendor
risk review has no containment floor to fall back on.

### Egress is classified from argv, not brokered

`gate.ts` parses command lines for egress destinations against a fixed set:

```
EGRESS_EXECUTABLES = { curl, wget, nc, ncat, scp, sftp, telnet }
```

The classifier is careful — it handles nested shell strings, separates flag
values from destinations, and treats destination-indeterminable egress as
critical. But it can only see what it can parse. `python -c` opening a socket, a
`node -e` fetch, an npm `postinstall`, an MCP server dialing out, `git push` to
an arbitrary remote — none is in the set, and none has to be, because the
classifier is not the route out. The network is.

Shepherd names this exact limit and answers it structurally: a syscall jail is
*host-blind* — it can pin egress to a loopback port but cannot allowlist which
host. So `_egress_broker.py` is a loopback-bound HTTP `CONNECT` proxy, and the
jail confines the body to `loopback_only:broker_port` so the broker is "the only
route out — unbypassable by construction, not by the client's cooperation."
Per-connection `ALLOW` / `DENY` / `ESCALATE`, a pinned evaluation order
(within a grant, negation scopes the positives so deny wins; across grants,
union; absent any admitting grant, default-deny), and an `EgressDecision` record
appended per connection as irreversible-effect evidence.

Scope honesty, theirs: CONNECT only (covers ~all HTTPS clients and hands the
broker the hostname pre-DNS without TLS interception). SOCKS5, transparent
redirect and a DNS stub are increment 2.

## 5. What Cormidia could take

Ranked by value over cost. None is a small change; all are safety-architecture
changes requiring ratification.

### 5.1 A harness-independent containment floor — highest value

Adopt the *shape* of `ContainmentBackend`, not the code: a backend that lowers a
set of writable roots (plus a network axis) to an OS profile, probes it
fail-closed for liveness **and** conformance before the body runs, then launches
the harness confined by it. Seatbelt on macOS, Landlock on Linux, and the
existing vendor sandboxes remain as an inner layer where they exist.

Why it is worth the cost:

- **It is harness-count-invariant.** One containment layer instead of N gate
  bridges. Adding an eighth adapter stops meaning "and now prove its hook seam
  fires."
- **It changes a refusal into a containment.** Today an unproven in-harness gate
  means the turn refuses (Muse) or is confined to throwaway repos (Grok). With a
  containment floor, an unproven *in-harness* gate can become a *contained*
  turn — the vendor's cooperation stops being load-bearing for filesystem
  safety. That is a direct answer to #339's shape.
- **It is defence in depth, not a replacement.** The OS jail cannot classify a
  production deploy, evaluate an action hash, or route to the approval queue.
  `gate.ts` stays exactly as it is and keeps the semantic layer. The jail is the
  floor beneath it.
- **It composes with what we already computed.** `gitWorktreeWritableRoots()`
  already produces precisely the input such a backend takes.

Cost and risk, stated plainly: Linux Landlock in Shepherd's own CI runs in a
**privileged container**, and Windows is unsupported outright (advisory-only at
best; they say use WSL). Cormidia's host story is Bikram's laptop → a
DigitalOcean droplet, so macOS + Linux is the whole surface — but the droplet
path needs the privilege question answered before this is more than a spike.

### 5.2 Brokered egress with ESCALATE wired to the approval queue

The broker design is right and the argv classifier is structurally weaker.
The notable detail: Shepherd **enumerates** `ESCALATE` and then deny-louds it,
because they have no human-approval path — that is their increment 3. Cormidia
*has* one, ratified: expiring, single-use, action-hashed grants; scoped widening
at decision time; separate approval and execution acknowledgement; denial
reasons persisted as curated role memory.

So the natural Cormidia shape is the one Shepherd designed but cannot yet build:
per-connection host predicates, default-deny, and `ESCALATE` routed to the
existing CLI approval queue instead of denied. This would also make egress
decisions first-class ledger evidence rather than a classification recorded at
the gate.

Note one interaction: brokered egress necessarily sees provider API traffic.
The policy has to admit the configured provider endpoints as a matter of
construction, and that admission is itself a governed surface.

### 5.3 Retained-output settlement vocabulary

Cormidia's worktree → PR → squash-merge path already delivers the guarantee
("nothing lands unreviewed") and should stay — GitHub as system of record is
ratified and correct. What is worth borrowing is the *discipline*:

- **Consume-once settlement, re-settlement refused.** We already have this
  primitive for *claims* (`durable-claim.ts`); Shepherd applies the same rule to
  the *work product*.
- **`apply` is path-disjoint or refused, never content synthesis.** That is a
  sharper, mechanically checkable statement of the stale-base problem we handle
  by re-resolving `BaseRevision` per claim (#101, #203). Their `select` is
  fast-forward-only and fails closed if the workspace moved on; `apply`
  three-way-settles only when the change sets are disjoint. Worth comparing
  against our merge rules directly.

Do not treat it as proven: their roadmap documents a live bug where settling,
re-acquiring the handle, and running again in the same session can put earlier
settled files into the next changeset and make `apply` refuse when it shouldn't.

### 5.4 Replay and cache economics — a claim to test, not evidence

The repository advertises copy-on-write forking ~5× faster than `docker commit`
and ~95% KV-cache reuse on replay. If the second number holds it is directly on
Cormidia's "continuously improving unit economics," and it bears on the learning
loop, where `ReplayCapsule`s already do paired offline replay.

Two disqualifiers for now. The numbers come from the paper and are reproduced in
a **companion** repository against a frozen snapshot, not in this repo — so by
our own no-green-by-absence rule they are a hypothesis. And their own roadmap
says a public replay API is **not shipped**; the deterministic provider gives
the reproducibility half only. Idea confirmed, implementation unavailable.

### 5.5 Their docs publication gate

A build gate that refuses to publish any documentation page teaching a surface
that does not run on the installed package, with a machine-checked "Applies to"
version on every page. Cormidia maintains the same honesty by review discipline
and hand-written "Known limitations." A mechanical gate is cheaper and does not
decay. This is small, self-contained, and touches no safety surface — the
easiest thing on this list to try.

## 6. What Cormidia should not take

- **Not a dependency.** `shepherd-ai` is Python; Cormidia is a single TypeScript
  package with a ratified minimal-dependency rule (TASTE.md §3 — `yaml` plus
  provider SDKs, "adding one is a decision, not a convenience"). Introducing a
  Python runtime plus an alpha 1,900-file workspace fails that rule on its own
  terms. Reimplement the containment *shape* in TypeScript, or shell out to
  `sandbox-exec` / Landlock directly; do not vendor the stack.
- **Not the task-as-typed-function model.** Cormidia's unit is a role turn
  against an app repo under org policy. Adopting Shepherd's unit would break
  "one runtime, many apps" and GitHub-as-system-of-record.
- **Not the benchmark numbers, as evidence.** See §5.4.
- **Not on their maturity.** Alpha; APIs change between releases; the north-star
  meta-agent surface is deferred; their own first-run findings record that the
  promoted public examples run against a 96-line **simulation shim**, not the
  framework. Their engineering is careful and their disclosure is unusually
  honest — which is exactly why the disclosure should be read literally.

## 7. Could Cormidia improve Shepherd

Yes, and the contribution is mostly governance — the half they have not built:

1. **The human-approval path for `ESCALATE`.** Their egress broker enumerates
   the verdict and deny-louds it pending "increment 3." Cormidia's approval
   boundary is a more mature answer to that exact gap: expiring single-use
   action-hashed grants, scoped widening at decision time, approval separated
   from execution acknowledgement, idempotency reconciliation for a crash after
   a remote effect, and denials persisted so none is re-litigated.
2. **Multi-harness gate conformance.** Our adapter contract — a shared two-turn
   walk including a subagent gate-ordering probe, fan-out degradation paths, and
   a 300 KB payload pin, run hermetically and live — is a more demanding
   provider contract than their four providers currently carry. The Muse
   finding (a provider narrating subagents it never spawned) is a bug class
   their trace model should want a detector for.
3. **Honest spend accounting.** Their run record carries usage; it does not
   distinguish an authoritative zero (subscription — no marginal charge exists)
   from unknown cost. Ours does (INV-006), and the distinction matters the
   moment a meta-agent budgets its children.

**Governance note:** any outbound contribution — issue, PR, or published
comparison — is external-publication-shaped work and requires explicit human
approval under `.cormidia/AUTHORITY.md` and the uniform release rule. This
report proposes it; it does not authorize it.

## 8. Suggested next steps

| # | Step | Shape |
| --- | --- | --- |
| 1 | Design spike: harness-independent containment floor (§5.1) — Seatbelt/Landlock lowering of `gitWorktreeWritableRoots()`, fail-closed probe, `pi`/`cursor`/`opencode`/`grok`/`muse` as the target set | Bounded spike, then a PURPOSE decision proposal — this changes the safety architecture |
| 2 | Design spike: brokered egress with `ESCALATE` → approval queue (§5.2) | Same; sequence after 1, since the jail is what makes the broker unbypassable |
| 3 | Compare Shepherd's `select`/`apply` settlement rules against our merge and base-resolution rules (§5.3) | Cheap desk exercise; may sharpen #101/#203 guarantees |
| 4 | Docs publication gate (§5.5) | Small, self-contained, no safety surface |
| 5 | Re-review at their next minor release | Watch item — specifically whether task-as-value delegation ships |

Nothing here is urgent. Item 1 is the one with compounding value: it gets
cheaper relative to the alternative with every adapter we add.

## Sources

- Repository: <https://github.com/shepherd-agents/shepherd> — reviewed at `d45074e`, version 0.3.0, MIT
- Paper: [arXiv:2605.10913](https://arxiv.org/abs/2605.10913) — *Shepherd: Enabling Programmable Meta-Agents via Reversible Agentic Execution Traces* (Yu, Chong, Nandi, Soylu, Sun, Manning, Shi)
- Homepage <https://shepherd-agents.ai/> · Docs <https://docs.shepherd-agents.ai/>
- Companion experiments repository: <https://github.com/shepherd-agents/shepherd-experiments>
- In-repo primary sources read: `docs/shepherd/concepts/{tasks,runs,effects,permissions,placements,runtime-substrate}.md`, `docs/shepherd/roadmap.md`, `docs/_system/design/FIRST-RUN-FINDINGS.md`, `vcs-core/packages/core/src/vcs_core/{_containment,_egress_broker,_landlock_containment,_seatbelt_containment,_clonefile_carrier}.py`, `shepherd2/README.md`
- Cormidia sources compared: `src/runtime/AGENTS.md`, `src/runtime/gate.ts`, `src/runtime/git-worktree-sandbox.ts`, `src/runtime/adapters/{claude,codex,pi,cursor,opencode,grok,muse}.ts`, `docs/PURPOSE.md`, `docs/VISION.md`, `README.md`
