# OPERON-BND-014 — External demand collectors ↔ Operon intake

Status: **Ratified — 2026-07-29**

Traces: J-04, J-12–13; OPERON-INV-001–005, OPERON-INV-009–011.

## Contract

### 1. Valid input domain

- An intake item has a supported versioned envelope, stable source/event
  identity, provenance and trust classification, source and receipt times,
  intended org/app scope, content reference, and subscriber or routing
  identity.
- Current file-drop intake and any future channel connector normalize into the
  same behavior-level envelope before prioritization or execution.
- Malformed, unsupported, untrusted, scope-ambiguous, or unauthorized input is
  invalid and cannot become executable work.

### 2. Output guarantees

- Every received item has one explicit disposition: accepted, duplicate,
  rejected, quarantined, or deferred.
- Accepted demand preserves source provenance and obtains a durable identity
  before it can become a proposal, planning input, or ticket.
- Acceptance into intake does not itself mean the demand is true, prioritized,
  planned, approved, or executable.
- A collector outage cannot erase already accepted work or stop unrelated
  admitted episodes.

### 3. Error and recovery behavior

- Invalid or untrusted input is rejected or quarantined with a typed reason and
  without execution.
- Partial delivery is recoverable from the stable event and subscriber
  identities; ambiguous delivery remains visible and is not acknowledged as
  complete.
- Channel unavailability is reported as source-specific degradation.
- `OPEN — AF-003:` ownership, authentication, authorization, and rate-limit
  behavior for direct external connectors remain architecture findings.

### 4. Idempotency and retry

- Delivery is treated as at-least-once. A stable event/subscriber identity
  deduplicates replay without losing legitimate delivery to another subscriber.
- Replaying an accepted event returns its prior disposition and intake identity
  rather than creating duplicate executable work.
- A corrected event uses a new revision identity and retains lineage to the
  superseded input.

### 5. Timing, ordering, and freshness

- Receipt order is authoritative only within a collector stream that promises
  it; no global order is inferred across channels.
- Late or clock-skewed source timestamps do not overwrite receipt time and are
  preserved as distinct facts.
- Prioritization age begins from a declared accepted-at fact, not an
  untrustworthy source timestamp.
- Connector-specific polling, acknowledgement, retention, and freshness
  objectives remain `OPEN` until each connector is admitted.

## Controlled-seam obligations

Use a deterministic collector simulator with duplicates, gaps, retries,
out-of-order delivery, late timestamps, malformed and adversarial content,
scope ambiguity, outage/recovery, and per-subscriber acknowledgement.
