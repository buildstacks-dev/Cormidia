# Contract — B-09a Turn ↔ approval store (continuation seam)
Canonical ID: **CORMIDIA-C-B09A-001 (alias: B-09a)**

Status: DRAFT (Phase 4). Defends INV-003/005, T-2. Journeys J-05/J-06.

## 1. Valid inputs
- A pause persists the complete continuation set: pipeline/pass, native session
  identity, completed-pass set, context fingerprint, worktree fingerprint, run id,
  accumulated cost, and exact decision history `[doc: PURPOSE 2026-07-18]`.

## 2. Output guarantees
- Resume runs iff every fingerprint matches: same role, runtime/assignment, context,
  worktree, work content. Any mismatch → fail closed **before any spend** `[doc]`.
- Approved and denied decisions both continue the **same native session** as distinct
  guidance — a denial is contextual input to the same pass, not a restart (denial
  matters, J-06).
- Claim number stable across any number of pauses (INV-005); lifecycle telemetry
  separates pause cost from repeated cost `[doc]`.

## 3. Error behavior
- Grant TTL (24 h `[doc]`) expiry before resume: typed outcome; never silent execution
  under an expired grant (INV-003). **What expiry does to the item is unratified —
  F-PT-008**: whether it creates a fresh item, reopens the old one, or requires another
  explicit operation is not defined by the approvals contract (and decision records are
  immutable, B-09b); this contract takes no position.
- Crash between decision and continuation: decision durable, continuation retried by a
  later tick; the decision is never re-asked.
- **Decision-store reconciliation:** the documented write order (grant, then decision
  log, then atomic item move) deliberately creates a physical intermediate in which an
  orphan grant exists without its decided item. The contract is NOT that this never
  appears — plain files are not a database. It is: the intermediate is **recognizable**;
  **no reader treats the orphan grant as usable authorization**; reconciliation
  completes or repairs the decision state (INV-013) `[elicited]`.

## 4. Idempotency
- Continuation is keyed by (item, claim, session); a duplicate continuation attempt is
  detected and refused with the original outcome preserved.

## 5. Timing
- **There is no product deadline on human decision latency.** But continuation
  viability is not promised indefinitely: provider sessions, authentication,
  fingerprints, configuration, and worktree state may all become unusable while the
  human is away. **Continuation revalidates grant TTL, exact session availability,
  auth, and every fingerprint before any spend; failure of any revalidation is a typed
  outcome that preserves evidence — never a silent restart.**
