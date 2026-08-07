# Contract — B-26 Muse Code adapter (muse exec headless, swarm harness)
Canonical ID: **CORMIDIA-C-B26-001 (alias: B-26)**

Status: DRAFT (harness revision 2026-08-07, #336; design-only until the adapter lands
— #340). Extends `provider-adapter-core.md`; deltas only. Sources: `[doc:
research/2026-08-06_adapter-upstream-references.md]` unless marked `[stated]`
(owner text in #340 incl. the 2026-08-07 field-verification comment) or `[PROPOSED]`.
Beta accepted deliberately: agent-swarm coordination is the harness advantage being
arbitraged `[stated]`.

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
  hole, never a degradation. **BLOCKED:F-PT-028** — whether the beta exposes any
  hook/permission seam covering swarm members is unknown; the owner-decided fallback
  is already contract truth: **if no seam exists, `tool_gate: unsupported` for swarm
  mode and the capability profile disables fan-out until a seam exists — never an
  ungated swarm** `[stated]`. Only the mechanism-level cases park on the finding; the
  fail-closed fallback cases are authorable now.
- Hermeticity `[stated]`: a default run ingests the operator's personal Claude/Codex
  rules and skills ("Including your Claude Code and Codex personal rules and 6
  skills") — ambient-config leakage into org turns. The adapter must find and pin the
  disable path (the claude `--bare` / `settingSources: []` equivalent) and prove it in
  certification; **if none exists in the beta, that is a documented degradation
  (capability-matrix caveat + README known limitation), never a silent default**.
- Workspace containment: `--workspace` is declared per turn as the app-bound workdir
  (INV-004); a tool effect outside the declared workspace root is a containment
  failure (T-6), not a vendor quirk.
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
- L3 (certification lane, design-only until #340): the §5 certification walk with the
  **swarm gate probe as the load-bearing case** — no role goes live before that probe
  passes live, or fan-out is disabled in the profile with the documented degradation
  `[stated]`; plus the hermeticity disable-path proof and exact session resume.
  Spend-bounded per policy. Muse Spark models also reachable through generic
  backbones (`api.meta.ai` is OpenAI/Anthropic-compatible) stay separate evidence
  lanes — an A/B against the native harness never substitutes for this boundary's
  certification `[stated]`.
