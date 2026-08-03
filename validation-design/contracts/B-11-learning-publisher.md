# Contract — B-11 Learning capture ↔ governed substrate (publisher seam)
Canonical ID: **CORMIDIA-C-B11-001 (alias: B-11)**

Status: DRAFT (Phase 4). Defends INV-001/012/013, T-3/T-10. Journey J-12.

## 1. Valid inputs
- Publisher input: a human-approved, fail-closed review verdict bound to exact content
  hashes; one content-hash-bound transaction per approval `[doc]`.
- Agents write only `learning/candidates/` and `learning/proposals/**` — no other
  substrate path accepts agent writes (gate rule `learning-surface-tamper`).

## 2. Output guarantees
- Writes land only on the allowlisted destinations for the verdict's type; the
  transaction journal (`learning/publish-journal/`) is crash-resumable `[doc]`.
- State distinctness preserved in artifacts: candidate / published / authorized /
  active / validated are separate recorded facts; none implies the next (INV-012), and
  they remain separate even when evaluation is unavailable or inconclusive `[elicited]`.
- Candidate files are structurally non-resolvable (never enter context resolution).

## 3. Error behavior
- Crash mid-transaction: the journaled sequence (intent → artifacts → manifest bump →
  intervention record → done) **forward-completes or no-ops from the journal, keyed by
  approval ID** — rollback is not promised `[doc]`; readers never resolve a partially
  committed publication as active (INV-013).
- Review rejection: recorded in `learning/rejections.jsonl` (suppression ledger);
  rejected content never publishes under a later unrelated approval (content-hash
  binding).

## 4. Idempotency
- Publish keyed by (approval, content hash): exactly once; re-run of a completed
  transaction is a no-op with reference.

## 5. Timing
- Distiller daily; Learning Reviewer weekly `[doc]`; activation into context/T2/T3
  requires its own content-bound approval — never time-triggered.

## Boundary note
Paired-replay/canary *evaluation design* (the coin-flip-gate scar) is Phase 5 material —
deliberately outside this contract `[elicited]`.
