# Contract — B-26 Muse Code adapter (muse exec headless, swarm harness)
Canonical ID: **CORMIDIA-C-B26-001 (alias: B-26)**

Status: DRAFT (harness revision 2026-08-07, #336). **Adapter landed #340 (2026-08-07)
and certified against Muse Code 0.1.0-R708.1 —
`[doc: research/adapters/2026-08-07_muse-code-adapter-certification.md]`.** Extends
`provider-adapter-core.md`; deltas only. Sources: `[doc:
research/adapters/2026-08-06_adapter-upstream-references.md]` unless marked `[stated]`
(owner text in #340 incl. the 2026-08-07 field-verification comment), `[certified]`
(the 2026-08-07 certification record), or `[PROPOSED]`. Beta accepted deliberately:
agent-swarm coordination is the harness advantage being arbitraged `[stated]`.

**Certification headline `[certified]`: no gate seam exists on this build.** `muse
exec` auto-approves tool calls headlessly and no managed hook of any event fires, so
the owner-decided fallback below applies at its widest — `tool_gate` AND
`intra_turn_fanout` are `unsupported`, and the adapter refuses any turn whose seam is
not proven live rather than running one ungated. This CONTRADICTS the #340 probe
comment, which reported the `TBH_MANAGED_HOOKS_PATH` lane firing every event; the
disagreement is recorded and a human must resolve it before any role is assigned.

- Surface: user-installed `muse` binary (beta since 2026-08-05; field-verified 0.1.0),
  headless `muse exec` with `--json` JSONL events, **`--prompt-file`** (payload-safe
  task transport — the core §300 KB rule's natural carrier), **`--api-key-stdin`**
  (key never in argv/env), `--workspace <path>` (policy-gated tools root), `--model`
  `[stated]`. Never installed by Cormidia (#224); readiness = usable `MODEL_API_KEY`
  auth (API-key only, per #333), version bands recorded (#331).
- Swarm gating is the load-bearing clause `[stated]`: with native fan-out, **every
  spawned agent's tool action MUST reach the Cormidia gate identically to top-level
  (event → gate → escalation ordering), with paired subagent lifecycle events and
  attributable spanIds**. A swarm member's action escaping the gate is an INV-002 gate
  hole, never a degradation. **F-PT-028 resolved-by-evidence 2026-08-07** `[certified]`:
  no hook/permission seam fires at all — not for swarm members and not for the parent —
  so the owner-decided fallback is now the implemented behaviour: **`tool_gate:
  unsupported`, `intra_turn_fanout: unsupported`, `subagent_spawn` refused at the
  bridge, and every turn with an unproven seam refused pre-spend with
  `error_gate_seam_unavailable` — never an ungated swarm, never an ungated turn**
  `[stated]`. The mechanism-level cases stay scripted-only evidence: there is no live
  seam to prove them against. `subagentTurns` derives only from real records (the
  `SubagentStart` join table and the durable log's `goal_usage_attribution` owners) —
  narrated fan-out is a seeded liar in the offline suite, never an accounting source.
- Hermeticity `[stated]`: a default run ingests the operator's personal Claude/Codex
  rules and skills — ambient-config leakage into org turns. **Disable path found,
  pinned, and certified `[certified]`:** `--no-foreign-personal-context` on every run
  plus `context.foreign_personal_rules/foreign_personal_skills:false` in an isolated
  `XDG_CONFIG_HOME` the adapter owns per turn. Proof is the **skills-count delta**
  (23 → 17 skills, 8 → 2 foreign-tagged), never the one-shot banner.
- Workspace containment: `--workspace` is declared per turn as the app-bound workdir
  (INV-004); a tool effect outside the declared workspace root is a containment
  failure (T-6), not a vendor quirk. **Recorded caveat `[stated]`:** writes are
  workspace-confined but shell reads reach the whole filesystem — `--workspace`
  mediates file *tools* only, so the Cormidia gate is the read boundary, and with no
  seam on this build there is no read boundary at all. **Recorded residual risk
  `[certified]`:** Cormidia owns the child environment, which is what carries the hook
  wiring; an agent with shell access could launch a nested `muse`/`claude`/`codex`/
  `grok` without it, so nested-harness invocation is refused at the bridge.
- Effort: `--reasoning-effort none|minimal|low|medium|high|xhigh|ultra` (default
  high); `ultra` sits above xhigh `[stated]` — this supersedes the research record's
  no-effort-knob line. Whether Cormidia `max` maps to `ultra` is a deliberate open
  capability-work decision deferred to the adapter's capability profile `[stated]`;
  until a human ratifies that mapping, `max` is unmapped and throws per the ratified
  cross-adapter rule. No case encodes the mapping.
- Offline test provider: `--provider echo` is a free offline provider `[stated]` —
  usable as a real-binary hermetic transport lane for L1/L2 certification fixtures
  (zero spend). It is **transport evidence only**: echo-mode runs never count as
  gate-seam, swarm, or model-behavior evidence, and the owned scripted double remains
  the failure-mode substrate (an echo run cannot script provider failures).
- Churn: 0.1.x beta — JSONL event-schema drift is a typed failure, never silent
  re-parse; certification binds to a recorded version and re-runs on every bump
  (#331 bands, #332 freshness automation) `[stated]`.
- Usage `[certified]`: `--json` carries NO usage. Token counts exist only in the
  durable session log (`event.kind = model_completed`), which the adapter reads as the
  finest truthful observation point for both reported spend and the running budget
  guard. No dollar figure exists anywhere in the product, so `costUsd` is an estimate
  from documented list prices with `costEstimated: true`; absent usage renders
  `unavailable`, never zero.
- L3 (certification lane): the §5 certification walk with the **swarm gate probe as
  the load-bearing case** — no role goes live before that probe passes live, or
  fan-out is disabled in the profile with the documented degradation `[stated]`.
  **Outcome 2026-08-07 `[certified]`: the two-turn walk did not run and CF-B26-L3 is
  INCOMPLETE**, because the adapter correctly refuses before the first provider turn;
  reporting the walk as anything else would be green-by-absence. Certified live
  instead: the fail-closed refusal against the real binary, the hermeticity delta, and
  the durable-log usage path. Re-certification is mandatory on every version bump
  (#331 bands, #332 freshness). Muse Spark models also reachable through generic
  backbones (`api.meta.ai` is OpenAI/Anthropic-compatible) stay separate evidence
  lanes — an A/B against the native harness never substitutes for this boundary's
  certification `[stated]`.
