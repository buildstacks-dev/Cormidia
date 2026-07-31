# Contract — B-02 Anthropic adapter (Claude Agent SDK)
Canonical ID: **OPERON-C-B02-001 (alias: B-02)**

Status: DRAFT (Phase 4). Extends `provider-adapter-core.md`; deltas only.

- Gate integration: SDK hooks + `canUseTool` — the gate must see **every** tool path
  the SDK can execute (INV-002; adversarial: new tool types fail closed).
- Tool events surface **pre-execution**: no `success`/`durationMs` outcome fields —
  consumers must not synthesize outcomes `[doc: known limitation]`.
- Auth: subscription-first (any usable Agent SDK auth), `ANTHROPIC_API_KEY` fallback;
  auth classes distinguished in doctor probes (no model prompt sent).
- Session resume: native; resume validates it restored the *exact* session (core §4).
- Streaming: partial stream then drop is a typed failure with whatever usage is known,
  else `unknown` — never zero.
- L3 obligations: real auth; real streaming/hook behavior across SDK versions; real
  session resume. Spend-bounded per policy.
