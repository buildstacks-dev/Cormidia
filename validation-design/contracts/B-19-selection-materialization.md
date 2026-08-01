# Contract — B-19 Durable selection ↔ winner materialization/episode continuation
Canonical ID: **OPERON-C-B19-001 (alias: B-19)**

Status: PROPOSED harness revision (2026-08-01). Defends
INV-008/009/010/012/013/015 and T-6/T-7/T-9. Journey J-19.

## 1. Valid inputs

- Selection consumes the frozen comparison record, terminal candidate records,
  required evidence bundles, a versioned operation-specific selection policy, and any
  terminal judge record.
- Eligibility is evaluated before qualitative ranking. A deterministic failure cannot
  be outweighed by judge preference, cost, latency, or diff size.
- A judge-backed selection is admissible only when the exact judge assignment/prompt,
  rubric, meta-eval corpus, thresholds, and sampling design are admitted by policy.
  Otherwise the result is advisory/inconclusive and follows the explicit fallback.
- Materialization accepts exactly one content-bound selected candidate and the original
  destination/base identity. Missing, multiple, advisory-only, or changed selections
  are invalid inputs.

## 2. Output guarantees

- The selector writes one immutable record containing eligible/ineligible candidates,
  clause-level reasons, judge identity/output/admissibility, tie-break application,
  selected candidate or typed inconclusive/failure, and every evidence hash used.
- If exactly one candidate is eligible, policy may select it without a judge. If none
  are eligible, selection fails. Multiple eligible candidates require an admissible
  judge or the declared `on_inconclusive` behavior.
- Episode materialization produces exactly the wrapped step's expected output and then
  resumes ordinary downstream gates/review. It grants no new authority.
- Standalone materialization creates a new local
  `operon/compare/<comparison-id>/winner` branch without checking out or mutating the
  active branch, pushing, opening a PR, or contacting GitHub through Operon.
- `selected`, `materialized`, and `downstream_verified` remain distinct evidence claims.

## 3. Error behavior

- Missing/corrupt evidence, judge failure, judge disagreement below policy confidence,
  or unratified judge thresholds yields typed inconclusive behavior; no result is
  rendered green or qualified.
- Selected-artifact hash mismatch, moved/dirty destination, missing git object, or
  changed plan/output contract fails before mutation.
- Lost acknowledgement after materialization reconciles by exact branch/artifact hash.
  A matching effect records completion; disagreement stops ambiguous and never
  overwrites, force-resets, or chooses a different candidate.

## 4. Idempotency

- Replaying selection with identical inputs returns the existing byte-identical
  selection record. A changed policy/evidence/candidate set mints a new comparison.
- Materialization is idempotent by `(comparison_id, selected_candidate_hash,
  destination_identity)`. A matching winner is a no-op; a conflicting destination is a
  typed refusal.
- Cleanup never deletes a materialized winner branch or an episode artifact already
  consumed by downstream work.

## 5. Timing and ordering

- Selection follows terminal candidate evidence and precedes materialization.
- The selection record is durable before any winner bytes enter the episode output or
  standalone branch.
- Episode downstream work begins only after materialization acknowledgement. Ordinary
  review/ship freshness rules bind to the materialized candidate, not to a losing lane
  or the judge's prose.
