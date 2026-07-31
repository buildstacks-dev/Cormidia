# Contract — B-01 GitHub API
Canonical ID: **OPERON-C-B01-001 (alias: B-01)**

Status: DRAFT (Phase 4). Defends INV-008/009/014, T-7/T-9. Journeys J-02/03/04/05/10/11/14/15/18.

## 1. Valid inputs
- Repo identity always from the registry entry (`owner/repo` slug), never inferred from
  a local remote (INV-004, B-10a).
- Refs: base/default branch **resolved from the remote at use time**, never guessed or
  cached across operations (INV-009); branch names `op/<issue>-<slug>`; labels from the
  canonical `op:*`/priority set.
- Invalid classes: unknown repo/permission → typed terminal error; malformed ref →
  refusal before any write.

## 2. Output guarantees
- Writes return the created artifact identity (issue #, PR #, review id, merge SHA);
  Operon persists that identity before flipping any announcing label
  (artifact-before-label, INV-008).
- Reads (polling): polling is **attempted on successful ticks** for live apps — there is
  no promised staleness maximum (the configured cadence is not a delivery guarantee:
  launchd may not fire, the laptop may sleep, GitHub may fail, the app may not be live).
  Poll age and poll failure are always exposed to readers (INV-008; B-12).
- No cross-entity ordering guarantee; per-entity read-after-write is NOT assumed —
  Operon re-reads before relying on a just-written state.

## 3. Error behavior
- Typed: rate-limit (retry with backoff, bounded); 5xx (retryable, bounded); 4xx
  (terminal, surfaced); **lost response after possible effect** → ambiguity path:
  reconcile via idempotency marker or stop `ambiguous` — never blind re-perform
  (INV-003 branch, T-12 for executor ops).
- Retry budget: **PROPOSED** 3 attempts, exponential backoff, per operation; owner:
  human; expiry: first harness build review.

## 4. Idempotency
- Creates carry detectable markers (Planned-by trailer + published-tickets mirror for
  issues; `op/` branch naming; marker-comment keys for executor comments) so a retry can
  detect a prior effect instead of duplicating.
- Label flips are idempotent; squash-merge is **never** blindly retried — merge
  preconditions (INV-009: review commit_id == HEAD, fresh checks, resolved default) are
  re-verified at each attempt.
- Reset's GitHub cleanup closes only identifiable `op:*` work; re-running reset cleanup
  is idempotent (INV-010).

## 5. Timing / ordering
- Poll attempts follow the configured tick cadence (`StartInterval: 300` is a setting,
  not a firing guarantee — B-05); event consumption exactly-once per (event, role).
- Merge-time freshness: preconditions verified within the same operation that merges —
  no TOCTOU window is accepted as correct behavior; the check-then-merge gap is a named
  race case for the catalog.

## Unknowns
- None open at this boundary (F-PT-005 resolved; PR-#182-class evidence rules live in
  INV-008/012 and the qualification-replacement policy obligation).
