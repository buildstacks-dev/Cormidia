# Muse Code adapter — live certification record (B-26 / #340)

*Dated 2026-08-07. Operator machine (macOS, aarch64). Binary pinned at
**Muse Code 0.1.0 (0.1.0-R708.1)**. Scope: `docs/harness/adding-updating.md` §5
standalone certification of `src/runtime/adapters/muse*.ts`. Spend: ~25 bounded
`muse-spark-1.2 --reasoning-effort minimal` turns in scratch temp repos,
≈ $0.55 estimated (policy pre-merge changed-adapter bound is ≤2 turns/$5 for
the L3 conformance walk itself, which **did not run** — see §3). Every turn ran
in a `mktemp` git workdir; no app repo, no org home, no scheduler.*

## 1. Headline

**The certification did not find a gate seam.** On this build, `muse exec`
auto-approves tool calls headlessly and **no managed hook of any event fires**,
so no tool action can be classified before it executes. The adapter therefore
ships fail-closed: it proves the seam is live before every turn and refuses when
it is not. `tool_gate` and `intra_turn_fanout` are declared `unsupported`, and
the refusal is the degradation artifact those tiers owe.

This **contradicts the F-PT-028 probe recorded on #340 (2026-08-07)**, which
reported that hooks installed through `TBH_MANAGED_HOOKS_PATH` fire every event
and that a `PreToolUse` deny is fail-closed proven at the parent. That claim did
not reproduce here on the same advertised version. The disagreement is recorded,
not resolved: see §6.

## 2. What was proven

| Probe | Outcome | Evidence |
| --- | --- | --- |
| Version pin | recorded | `muse --version` → `Muse Code 0.1.0 (0.1.0-R708.1)`. The launcher at `~/.local/bin/muse` auto-updates hourly, so the adapter pins `MUSE_NO_AUTO_UPDATE=1` — Cormidia never installs or upgrades a provider (#224). |
| **Hermeticity (P1)** | **pass** | Certified by the **skills-count delta**, not the one-shot banner: `muse skills list --json` reports **23 skills (8 foreign-tagged)** by default and **17 (2 foreign-tagged)** under the adapter's isolated `XDG_CONFIG_HOME` with `context.foreign_personal_rules/foreign_personal_skills:false`. The adapter also always passes `--no-foreign-personal-context`. |
| **Gate seam (P2)** | **fail** | With the adapter's own managed hook root installed, a real turn produced **0 hook payloads at the per-turn socket** and **1 `tool.result`** — the tool executed ungated. |
| **Child deny (P3)** | **unprovable** | The load-bearing swarm probe cannot be run: no hook fires at parent level either, so there is no seam under which a child's deny could be tested. |
| **Fail-closed refusal (P4)** | **pass** | The real `MuseRuntime` against the real binary refuses with `MuseGateSeamUnavailableError` (`error_gate_seam_unavailable`) before provider construction. Zero tokens spent on the refusal. |
| Containment (P5) | inconclusive here | The model declined the out-of-workspace read in this run, so the caveat below is carried from the #340 probe rather than re-verified. |
| **Usage source (P6)** | **pass** | `parseMuseSessionUsage` on a real durable log read `in=28231 out=239 cached=13937` for the probe session. |
| **Stream carries no usage (P7)** | confirmed | The `--json` stdout stream contains no token or cost record at all. The durable session log is the only observation point, and Muse reports no dollar figure anywhere — hence `costEstimated: true`. |

### The twenty configurations that produced no hook

`TBH_MANAGED_HOOKS_PATH` pointed at a directory containing `hooks.json`; the
same as a direct file path; a directory containing `hooks/hooks.json`; the
`{"hooks": {...}}` wrapper at each of those; `settings.json` in the managed root
(bare and wrapped); snake_case event keys; `command` as an argv array; the
native `RuntimeCapabilityPayload` shape (`event`/`matcher`/`shell_command`/
`timeout_ms`) as a bare list and under a `hooks` key; the `managed_hooks_path`
settings key pointing at a directory and at a file; an isolated
`XDG_CONFIG_HOME` with inline `settings.hooks`; the workspace-scoped
`.muse/hooks.json` and `.muse/settings.json`; each of the above with
`--trust-workspace`; and with `--preset native-basic`. Events were tried in
PascalCase (`SessionStart`, `UserPromptSubmit`, `PreToolUse`) and snake_case.
Malformed manifests produced no diagnostic on stdout, stderr, or in the durable
session log, which is itself evidence that the loader never read them.

The binary does carry the machinery: `TBH_MANAGED_HOOKS_PATH`, the
`managed_hooks_path` settings key, the PascalCase `HookEventKind` set
(`SessionStart, UserPromptSubmit, PreToolUse, PermissionRequest, PostToolUse,
PreLLMCall, PostLLMCall, PreCompact, PostCompact, SubagentStart, SubagentStop,
Stop`), the Claude-compatible `hookSpecificOutput`/`permissionDecision` response
contract, and a `RuntimeCapabilityTrustStatus` state machine
(`review_needed | trusted_enabled | trusted_disabled | modified | invalid |
blocked`) keyed by `runtime_capabilities`. The most likely explanation is that a
discovered hook capability stays `review_needed` until it is trusted, and this
build exposes no non-interactive way to trust one (`muse plugins` answers
"plugins are not available in this build"). **That is a hypothesis, not a
finding.** The adapter encodes no guess: it asks for proof each turn.

## 3. What was NOT run, and why

The §5 **two-turn `runAdapterConformance` walk did not run live**. The walk
requires both turns to end `blocked_on_gate`, which presupposes a gate; the
adapter correctly refuses before the first provider turn. Reporting the walk as
anything other than *not attempted* would be green-by-absence. `CF-B26-L3` is
therefore **incomplete**, and no role may be assigned to this harness
(`roles.yaml` untouched).

The same walk **does** run offline against the scripted transport
(`tests/hermetic/cf-adapter-conformance/adapter-conformance-pair.test.ts`),
which proves the adapter honours the contract the day a seam exists.

## 4. Surface facts recorded for the adapter

- **Launch**: `muse exec --json --prompt-file <path> --api-key-stdin --provider
  meta --model <id> --reasoning-effort <effort> --workspace <workdir>
  --session-id <uuid> --no-foreign-personal-context --disable-web-tools
  --user-input-auto-resolve [--max-model-steps N]`.
- **Auth**: API key only (#333), resolved at turn time from
  `CORMIDIA_MUSE_API_KEY_FILE`, `CORMIDIA_MUSE_API_KEY`, `MUSE_API_KEY`, or
  `META_API_KEY`, delivered on stdin, and **stripped from the child
  environment** so an in-turn `env` dump cannot read it.
- **Event envelope**: `{schema_version, id, stream:{kind,id}, sequence,
  recorded_at, record_type, durability, causation_id, payload_type,
  payload_schema_version, payload}`. Consumed payload types:
  `runtime.command.accepted`, `session.run.linked`, `run.model.configured`,
  `turn.input.user`, `run.lifecycle.started`, `task.stream.linked`,
  `task.lifecycle.{proposed,accepted,scheduled,side_effect_intent,started,
  status,completed,failed,rejected,cancelled}`, `run.output.delta`,
  `tool.result`, `run.terminal.completed`. Session identity is
  `stream.id` where `stream.kind === "session"`.
- **`tool.result`** carries `call_id`, the tool's own JSON text, and
  `correlation_facts {tool_name, outcome}` — a post-execution outcome, not a
  gate decision.
- **Usage** lives only in
  `~/.local/share/muse/sessions/<YYYY>/<MM>/<DD>/<session>/session.jsonl`, as
  `runtime.session` records with `event.kind = "model_completed"` carrying
  `{input_tokens, output_tokens, cached_tokens, cache_write_tokens,
  cache_read_tokens, reasoning_tokens}`, plus `goal_usage_attribution` records
  whose `owner.session_id` distinguishes a swarm child from the parent. **Swarm
  attribution therefore comes from the durable session log and the bridge's
  `SubagentStart` join table — never from the assistant's prose.** The offline
  suite pins that with a seeded liar that narrates parallel subagents while no
  subagent record exists.
- **Cost**: no dollar figure anywhere in the product. `costUsd` is a Cormidia
  estimate from the documented list prices ($1.25/M in, $4.25/M out, $0.15/M
  cached — `research/2026-08-06_adapter-upstream-references.md`), flagged
  `costEstimated: true`, quality `estimated`. Absent usage renders
  `unavailable`, never zero.
- **Effort**: `--reasoning-effort none|minimal|low|medium|high|xhigh|ultra`
  (default `high`). Cormidia `low|medium|high|xhigh` map 1:1. **`max` is
  unmapped and throws** under the ratified cross-adapter no-alias rule. Whether
  Cormidia `max` should mean `ultra` is an **open question for the product
  owner**; the adapter does not decide it.
- **Containment caveat (carried from the #340 probe, not re-verified here)**:
  writes are workspace-confined, but **shell reads reach the whole filesystem**
  — `--workspace` mediates file *tools* only. With no gate seam, there is no
  Cormidia read boundary on this harness at all. This is the sharpest reason the
  `tool_gate: unsupported` tier is not a formality.
- **Nested-harness risk**: Cormidia owns the child environment, which is what
  carries the hook wiring. An agent with shell access could launch a second
  `muse` (or `claude`/`codex`/`grok`) without it. `invokesNestedHarness()`
  (`src/runtime/role-shaping.ts`) makes that command a bridge-level refusal, and
  the matrix records the residual risk.

## 5. Tier table as certified

| Capability | Declared | Basis |
| --- | --- | --- |
| `tool_gate` | **unsupported** | P2/P4. No seam observed; the adapter refuses rather than running ungated. |
| `intra_turn_fanout` | **unsupported** | P3. No seam covering swarm members can even be probed; `subagent_spawn` is denied at the bridge. |
| `session_resume` | native | `--session-id <uuid>` is the vendor's own session identity; the adapter reports the id the provider reported and fails closed on a mismatch. Not exercised end-to-end live, because the turn refuses. |
| `structured_verdict` | fallback | No JSON-schema output surface exists on `muse exec`; the loop's lenient parser is the path. |
| `cancellation` | adapter | Cormidia terminates the child process group; no native abort surface. |
| `cache_telemetry` | adapter | `cached_tokens`/`cache_read_tokens` are present in the durable log and mapped by the adapter; nothing is native on the stream. |

## 6. Obligations

1. **Re-certification is mandatory on every version bump** (#331 bands, #332
   freshness). This record binds to `0.1.0-R708.1` exactly.
2. **The disagreement with the #340 probe comment must be resolved by a human**
   before any role is assigned. If the seam does work under a configuration not
   tried here, re-run this record's §2 and re-tier `tool_gate`; the adapter code
   needs no change, because the handshake will simply pass.
3. The `max` → `ultra` effort mapping is **recorded as an open question**, not
   decided.
4. No `roles.yaml` change accompanies this record, and none may until
   `CF-B26-L3` reports complete.
