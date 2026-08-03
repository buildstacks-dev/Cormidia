# Contract — B-03 Codex App Server adapter
Canonical ID: **CORMIDIA-C-B03-001 (alias: B-03)**

Status: DRAFT (Phase 4). Extends `provider-adapter-core.md`; deltas only.

- Transport: pinned `@openai/codex` CLI, JSON-RPC over stdio; per-thread model,
  approvals, sandbox modes. `@openai/codex-sdk` is not the adapter surface `[doc]`.
- Subprocess: death mid-RPC is a typed failure preserving the journal/checkpoint;
  protocol-version skew with the pinned CLI is a typed, terminal config error.
- Known upstream gap: the `untrusted` policy may auto-run trusted read-only commands
  without an App Server approval request (issue #20). **The documented hook bridge is
  the compensating enforcement boundary: the constrained Cormidia hook must still see and
  classify supported reads.** A forbidden **read** escaping that hook is an
  INV-002/INV-011 violation — reads can cross worktree and secret boundaries — not a
  degradation; a forbidden write escaping is likewise INV-002.
- Auth rotation: injected rotation events are L2-scripted (fake); auth loss follows the
  core preserve-checkpoint rule `[rambling: campaigns died mid-run when Codex
  refresh-token rotation raced and killed auth; multi-hour runs WILL be interrupted —
  checkpoint and resume, not restart]`; "refresh succeeded but retained session
  unusable" and "protocol-valid but semantically stale capabilities" are typed failure
  classes `[elicited]`.
  <!-- changelog 2026-07-31 (audit iteration 1, round 2): genuine rambling provenance
  restored — this clause traces to the owner's notes (rotation-race scar). -->
- Tool events carry outcome fields (`success`, `durationMs`) — the only adapter that
  does today; per-tool analytics claims are Codex-only (INV-008: other surfaces must
  not imply otherwise).
- Cost: estimated from cited prices (subscription-backed equivalent-cost), flagged as
  estimate on every ledger row (INV-006/008).
- L3: ordinary real auth/session behavior; **a real forbidden-read denial alongside the
  forbidden-write denial**. L5: natural multi-hour rotation under a long live run
  (time-hardening, Phase 6).
