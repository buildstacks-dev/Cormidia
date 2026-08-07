# Contract — B-25 Grok Build adapter (ACP over stdio)
Canonical ID: **CORMIDIA-C-B25-001 (alias: B-25)**

Status: DRAFT (harness revision 2026-08-07, #336; design-only until the adapter lands
— #339, itself gated on a human risk review). Extends `provider-adapter-core.md`;
deltas only. Sources: `[doc: research/2026-08-06_adapter-upstream-references.md]`
unless marked `[stated]` (owner text in #339) or `[PROPOSED]`.

- Surface: user-installed official `grok` binary (xai-org/grok-build). The community
  `superagent-ai/grok-cli` is unaffiliated and **never targeted** `[doc]`. Adapter
  speaks **ACP** (`grok agent stdio`, JSON-RPC over stdio) — shape-wise a cousin of
  the B-03 App Server client; `grok -p --output-format streaming-json` is the recorded
  fallback surface. `--no-auto-update` always (upstream CI recommendation and the
  #224 posture: a self-mutating binary mid-campaign is config drift, not an update).
  Never installed by Cormidia; readiness = usable request authentication
  (`XAI_API_KEY` or the vendor's stored login — whichever a real probe proves usable;
  account presence is never readiness), version bands recorded (#331).
- Subprocess failure shapes inherit B-03's set: death mid-RPC preserves journal/
  checkpoint; ACP protocol-version negotiation failure or skew with the recorded
  binary version is a typed, terminal config error.
- Gate integration — **BLOCKED:F-PT-027**: ACP defines a permission-request
  round-trip, but whether `grok agent stdio` emits one for **every** tool-action
  class, what denial semantics apply, and whether any headless auto-approve analog
  (`--always-approve` exists on the `-p` surface) can bypass the request path are
  unspecified upstream. A tool action executed without traversing the Cormidia gate
  is an INV-002 gate hole, not a degradation; the gate-bridge mechanism cases park
  until the finding resolves. No case encodes guessed coverage.
- Exact model discipline: default model `grok-4.5` and operator `~/.grok/config.toml`
  exist; the assigned tuple's model id is supplied explicitly and remains exact —
  operator config never substitutes for an org assignment (core §1).
- Effort: no knob — honest absence; unmappable values throw; assignment `efforts:`
  lists constrain candidates instead.
- **Risk posture (live use):** the recorded pre-adoption flags — an unverified
  single-source report of a 2026-07 incident uploading user repos including secrets
  to vendor cloud storage; a closed-contribution upstream; vendor consolidation with
  Cursor under SpaceX `[doc]` — make live certification **conditional on a recorded
  human risk-review decision (#339)**, and until that review clears real-repo use,
  every live turn targets throwaway sandbox repos only `[stated]`. Secret containment
  (INV-011) treats the vendor transport as untrusted: nothing beyond the redacted
  brief/worktree content the turn legitimately carries may be staged where the binary
  can exfiltrate it.
- Shared ACP transport core `[PROPOSED — decision requested in this pass, #339]`:
  ACP is a standard (Kimi CLI also speaks it). A shared transport core is acceptable
  **only** as an implementation detail behind per-harness boundaries: each ACP harness
  keeps its own B-NN boundary, capability profile, readiness, version bands, and
  certification evidence — transport reuse never shares or transfers certification
  evidence across harnesses. If adopted, the shared core's own conformance gets its
  own L1/L2 family; it never collapses B-25 and a future ACP boundary into one.
- L3 (certification lane, design-only until #339's checklist and risk review): the §5
  certification walk over ACP in sandbox repos — real auth; a real forbidden attempt
  denied through the ratified request-path bridge (post-F-PT-027); exact session
  resume; fan-out probe at the declared tier. Spend-bounded per policy; the human
  risk-review record is a precondition, not evidence.
