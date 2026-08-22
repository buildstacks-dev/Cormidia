# Contract — B-11 Learning capture ↔ governed substrate (publisher seam)
Canonical ID: **CORMIDIA-C-B11-001 (alias: B-11)**

Status: §1, §2, §5 retained; **§3 and §4 SUPERSEDED by CONTRACT-B-32 §3/§4** at the 2026-08-21
phase-B cutover (Cormidia #467) — the publish journal, forward-completion, and idempotency are
the kernel's (`@cormidia/learning-loop`), reached through the kernel's OKF destination. Defends
INV-001/012/013, T-3/T-10. Journey J-12 (kernel path: CF-J12-S/I/RC/A, CF-SM-LEARN-L/I/R/C;
refusal leg CF-J12-R). The forked publisher's journals, interventions, and bindings are read by
compatibility readers only (`src/org/learning-loop/legacy.ts`).

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
> **Superseded 2026-08-21 (phase B).** The kernel journal — plan-keyed authorization
> consumption → effects → receipt — forward-completes a failed plan and no-ops a completed
> one, never re-consulting authority (CONTRACT-B-32 §3/§4; CF-J12-I, CF-SM-LEARN-C on the
> kernel path). The forked sequence below is retained as history for the legacy readers.
- Crash mid-transaction: the journaled sequence (intent → artifacts → manifest bump →
  intervention record → done) **forward-completes or no-ops from the journal, keyed by
  approval ID** — rollback is not promised `[doc]`; readers never resolve a partially
  committed publication as active (INV-013).
- Review rejection: recorded in `learning/rejections.jsonl` (suppression ledger);
  rejected content never publishes under a later unrelated approval (content-hash
  binding).

## 4. Idempotency
> **Superseded 2026-08-21 (phase B).** Keyed by the kernel plan digest and idempotency key
> (`sha256({planDigest, effectId})`); the no-op-with-reference semantics are preserved by the
> kernel journal (CF-J12-RC, CF-SM-LEARN-R on the kernel path), and the candidate artifact hash
> is bound into the kernel candidate so a post-approval byte change voids the plan.
- Publish keyed by (approval, content hash): exactly once; re-run of a completed
  transaction is a no-op with reference.

## 5. Timing
- Distiller daily; Learning Reviewer weekly `[doc]`; activation into context/T2/T3
  requires its own content-bound approval — never time-triggered.

## Boundary note
Paired-replay/canary *evaluation design* (the coin-flip-gate scar) is Phase 5 material —
deliberately outside this contract `[elicited]`.
