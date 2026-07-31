# OPERON-BND-012 — Learning governance/publisher ↔ active context resolver

Status: **Ratified — 2026-07-29**

Traces: J-06–07, J-09, J-11–12; OPERON-INV-001–002, OPERON-INV-004–007,
OPERON-INV-009–011.

## Contract

### 1. Valid input domain

- Activation input contains provenance-bearing evidence, candidate identity,
  scope/tier/destination, independent review, required experiment/evaluation,
  exact content hashes, human approval where required, base bundle/manifest
  version, and final diff hash.
- The resolver accepts only published active bundle versions valid for the
  org/app/role/episode scope.
- Agent notes/self-report, unreviewed candidates, changed approved bytes,
  expired provisional content, protected-domain memory, or missing lineage are
  invalid active inputs.

### 2. Output guarantees

- Publication produces one versioned, reversible active change with complete
  evidence-to-activation lineage.
- Resolution returns one pinned bundle/version set for a turn and consistent
  episode-level treatment lineage where required.
- No-learning and no-actionable-candidate are valid outcomes and do not
  fabricate activation or healthy efficacy.

### 3. Error and recovery behavior

- Reviewer unavailable/unparseable fails closed. Conflict, injection risk,
  insufficient evidence, or destination mismatch rejects/escalates without
  active mutation.
- Interrupted publication resumes or no-ops by approval identity; partially
  written artifacts cannot become active through a manifest lie.
- Missing/corrupt lineage is degraded/invalid, never green.

### 4. Idempotency and retry

- One content-bound approval drives one atomic publish transaction.
- Re-running publication completes/no-ops by approval id and never
  double-publishes.
- Capture/projector identities prevent duplicate learning events while
  preserving legitimate backfill.

### 5. Timing, ordering, and freshness

- Evidence → candidate → review/evaluation → approval → publication →
  activation → outcome is forward-only.
- Bundle resolution is pinned for the turn; running work does not re-resolve
  mid-turn.
- Provisional TTL is enforced by the resolver at load time; expiry cannot wait
  for a later report.

## Controlled-seam obligations

Use real temporary learning stores and inject failure around candidate review,
approval binding, artifact writes, manifest bump, resolve, TTL, rollback, and
duplicate/backfill capture.
