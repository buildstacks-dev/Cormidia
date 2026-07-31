# Contract — B-04 pi SDK adapter
Canonical ID: **OPERON-C-B04-001 (alias: B-04)**

Status: DRAFT (Phase 4). Extends `provider-adapter-core.md`; deltas only.

- Embedding: `createAgentSession()`; SYSTEM.md + extensions for protocol enforcement.
- Gate: pi has no first-class approval flow — Operon installs the gating extension at
  runtime. **Turn-start precondition: the gating extension is verified active before
  any tool-capable execution; absence is a typed, terminal failure** (INV-002 fail
  closed) — "extension loaded" alone is insufficient; conformance proves a forbidden
  attempt is actually denied `[elicited]`.
- Tool events pre-execution (no outcome fields), as B-02.
- Delegation: no native intra-turn subagent fan-out — documented degradation in the
  capability matrix, never silently absorbed `[doc]`.
- Correlation: pi-Anthropic shares Anthropic's upstream outage domain with B-02 while
  failing independently at the adapter layer — status surfaces must not conflate the
  two (INV-008).
- L3: real extension installation in a real pi session with a real denied forbidden
  attempt; real Anthropic-native path.
