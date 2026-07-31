# OPERON-BND-013 — Workflow state owners ↔ read-only projections

Status: **Ratified — 2026-07-29**

Traces: J-03–13; OPERON-INV-001–005, OPERON-INV-009–011.

## Contract

### 1. Valid input domain

- A projection request names an authorized org/app scope, a supported view and
  output format, and any requested time or pagination bounds.
- Projection inputs are versioned facts from their owning stores, including
  local state, journals, ledgers, plans, approvals, learning artifacts, and
  bounded GitHub observations.
- An unresolved scope, path escape, malformed source record, unsupported schema,
  or request for unauthorized sensitive material is invalid.

### 2. Output guarantees

- A projection is read-only: rendering it cannot advance, approve, retry,
  repair, cancel, or otherwise mutate work.
- Every material value preserves source identity and reports applicable
  freshness, incompleteness, conflict, and degradation.
- Missing or unavailable evidence is represented as unknown/degraded, never as
  an empty-but-healthy system or an inferred success.
- Sensitive values are redacted while preserving enough provenance for a human
  to identify the source and next action.

### 3. Error and recovery behavior

- Failure of one source degrades only the dependent fields where a useful
  partial projection remains possible; the unavailable source is named.
- Corrupt, contradictory, or unsupported source data produces a typed
  projection error or explicit conflict. It is not silently discarded.
- Failure or absence of the observer cannot stop the operational runtime.
- `OPEN — PTF-012 / AF-009:` automatic observer restart, supervision ownership,
  and the user-visible promise during a prolonged observer outage remain to be
  ratified.

### 4. Idempotency and retry

- Repeating the same request against the same source snapshot produces the same
  semantic projection, apart from explicitly non-semantic render metadata.
- Projection caches and generated views are disposable and can be rebuilt from
  authoritative sources without changing those sources.
- Retrying a failed read does not create workflow events or external effects.

### 5. Timing, ordering, and freshness

- Each source reports its own observation time or revision; a projection does
  not manufacture one global ordering across independent stores.
- Events within an ordered journal preserve journal order. Cross-source events
  are correlated by stable identity and causal lineage where available.
- Stale data remains visible only with an explicit stale marker and last-known
  observation time. Source-specific freshness windows are selected during the
  deeper module pass.

## Controlled-seam obligations

Compose the real projection logic with temporary state homes, fake clocks,
scripted GitHub observations, corrupt and version-skewed records, missing
sources, path-escape probes, redaction probes, and observer restart/rebuild.
