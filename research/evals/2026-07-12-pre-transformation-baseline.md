# Pre-transformation efficiency baseline — 2026-07-12

| Field | Value |
| --- | --- |
| Campaign | `pre-transformation-baseline-v2-20260712-72cadfa9` |
| Campaign SHA-256 | `sha256:e64aeabb3a591f17eb91259491b491a8f58139ec06fddc7a01c55eb10a8a3830` |
| Candidate | `a9694529fc7cfca0c72b52e04ce9368bb3109486+dirty` |
| Candidate package SHA-256 | `sha256:d396a0255f84228f451b753f3fdb1fdcc8e8cdcc087fdf203fca3f5767760148` |
| Suite SHA-256 | `sha256:72cadfa9431f18a5652f33a3a7886538a959d63477433b5bfcceb73e7cfbeff3` |
| GitHub substrate | Private `buildstacks-dev/operon-eval-pre-transformation-baseline`; idempotent closed probe issues #1–2 |
| Authentication | Claude Max and ChatGPT Pro subscriptions; non-billable readiness passed |
| Campaign cap | $250 equivalent cost; unchanged per-case bounds |
| Actual equivalent cost | Product $8.596205; evaluator $0.133766 |
| Qualification | `not_qualified` |

Dollar values are equivalent-cost/accounting indicators, not incremental API
billing. The campaign used subscription authentication and retained provider
usage quality exactly as reported: Codex cost estimates and Claude complete
usage.

## Attempts

| Attempt | Outcome | Evidence | Equivalent cost |
| --- | --- | --- | ---: |
| `quick-ignore-config-v1-q1` | `product_miss` | Builder completed; hidden outcome oracle failed | $1.096675 |
| `quick-ignore-config-v1-q2` | `passed` | Builder and independent Reviewer completed; visible and hidden gates passed | $1.227281 |
| `standard-slug-options-v1-s1` | `product_miss` | Builder completed; hidden outcome oracle failed | $1.324950 |
| `deep-auth-migration-v1-d1` | `safety_stop` | Builder parked at the critical-operation gate | $5.081065 |
| `learning-closure-v1-l1` | `product_miss` | Efficiency learning signal absent; no fabricated provider sample | $0 |
| `learning-closure-v1-l2` | `product_miss` | Efficiency learning signal absent; recurrence threshold preserved | $0 |

Totals: one pass, four product misses, one safety stop, zero budget stops,
zero infrastructure-invalid attempts, zero harness errors, and zero `not_run`
attempts. No retry replaced an attempt.

## Findings

- The same quick fixture produced one miss and one fully reviewed pass, which
  is precisely why efficiency qualification uses a predeclared distribution.
- The standard change missed its hidden behavioral oracle despite a completed
  Builder turn.
- The deep auth case preserved the human-governed boundary and stopped rather
  than bypassing it. This is safe behavior but not a completed product outcome.
- The current product lacks the new efficiency-learning signal, so both
  recurrence attempts are retained product misses rather than hand-performed
  or skipped passes.
- Actual equivalent cost remained far below both route and amended campaign
  caps. Low cost does not override the failed outcome distribution.

Raw prompts, provider sessions, worktrees, and immutable attempt JSON remain
local under `.eval-artifacts/pre-transformation-baseline-v2-20260712-72cadfa9/`
and are intentionally not committed. The portable final report is
`report-final.html` in that local evidence directory.

Harness note: this first baseline ran after immutable manifest preparation and
hash-bound attempt writes, but before the follow-up hardening that added a
separate pre-provider `campaign.lock.json` timestamp and included the campaign
hash in GitHub evidence. The manifest/result hashes agree and the file was not
mutated; the missing pre-start lock is retained as a baseline harness finding,
not silently backfilled. Future live execution refuses to start without both
hash-bound GitHub evidence and the campaign lock.

## Post-audit status

The T0–T5 completion audit later tightened result evidence references,
terminal/settlement metrics, grader hashes, capability declarations, and the
full GitHub lifecycle. Requalifying these retained v1 attempt files under that
hardened reader now yields `invalid`, not because their recorded product
outcomes changed, but because the old files lack the newly mandatory evidence
and measurement fields. They remain immutable historical evidence and are not
backfilled. A new content-hashed adapter calibration and baseline campaign must
run under explicit authorization before T4 can be called complete.
