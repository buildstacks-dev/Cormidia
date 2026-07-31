# Contract — B-12 Observer/report readers ↔ local durable state
Canonical ID: **OPERON-C-B12-001 (alias: B-12)**

Status: DRAFT (Phase 4). Defends INV-008/011/013, T-4/T-9. Journey J-15. GitHub source: B-01.

## 1. Valid inputs
- Read-only by construction: no configuration, approval, retry, merge, label, deploy,
  or other mutation routes exist `[doc]`.
- Every HTTP request requires the per-process capability token; bind loopback only.
- Path resolution confined to the resolved state home — traversal/symlink escapes are
  typed refusals (T-4).

## 2. Output guarantees
- Versioned snapshot + cursor-based SSE; **per-source freshness and health**: each
  source (local stores, GitHub) reports its own age, availability, and disagreement —
  never one blended status; degraded states name the affected source and claims
  `[elicited]` (INV-008).
- Absence semantics: GitHub unavailable ≠ empty queue; usage unknown ≠ $0; definition
  file ≠ scheduler health; approved ≠ executed (INV-008).
- L3 confinement: exact prompts/briefs/outputs/session.log never preloaded or streamed;
  deliberate local fetch only; `session.log` labeled "activity log—not transcript";
  portable HTML carries no L3, no external requests, hash-restricted CSP (INV-011).
- Reports are as-of snapshots with a disclosure panel (incomplete/estimated/duplicate/
  unsettled/legacy/retention-limited) before any totals `[doc]`.

## 3. Error behavior
- Torn local reads: the observer **rejects the record, reports the owning source as
  invalid, and renders the affected claims unknown** — never stale-presented-as-current.
  Quarantine/repair belongs to the owning store's recovery path, not to a read-only
  surface (INV-013 reader side).
- Report generation never reconciles or mutates state `[doc]`; `budget --reconcile` is
  the only repair actor (M3).

## 4. Idempotency
- All reads idempotent; SSE cursor gap → client resync via snapshot, no fabricated
  continuity.

## 5. Timing
- Snapshot freshness labeling in UI; **observed GitHub poll age** surfaced (B-01 makes
  no staleness-bound promise — the observer reports what was actually observed, when);
  narrative capture applies the shared secret policy at capture time (INV-011 —
  years-durable records).
