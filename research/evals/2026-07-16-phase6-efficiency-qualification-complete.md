# Phase 6 efficiency qualification — complete current scope

Date: 2026-07-16

## Frozen evidence identity

- Candidate commit: `c6834cf0c545e2610cbaf1de52a928ddc6c58c68`
- Campaign: `candidate-qualification-v1-20260716-9ccc03a2c582`
- Campaign SHA-256: `sha256:28c8bd9cc71c8c6f260a2504fac05731ae98966a62ab3b8e5f1331599d31427a`
- Release-package SHA-256: `sha256:6e45e2be665af2158e0b99736f36812feed473386513a9de9a120ad168545e9d`
- Executable-suite SHA-256: `sha256:6a057dd4aca41a74e3071b212faf2e0f7136a25c853d43feb3382dd02d417857`
- Retained admission basis: `adapter-harness-calibration-v1-20260716-7ff53bd8273c`
  and `focused-provider-admission-v1-20260716-7ff53bd8273c`, bound by the
  ratified proportionate-release grant. No fresh adapter or focused provider
  campaign was launched for this evaluator-only repair.

The one decisive full campaign ran serially, fail-fast, with the frozen
Claude, Codex, and pi assignments; pi Support and Marketing remained on
`openai-codex/gpt-5.6-sol`. It used no infrastructure retry and no merit retry.

## Qualification result

- Qualifier outcome: `qualified`, reproduced twice from immutable evidence.
- Attempts: 34 passed; zero product misses, safety stops, budget stops,
  infrastructure-invalid attempts, harness errors, or not-run attempts.
- Routes: 4 deep, 21 standard, 8 quick, and 1 mechanical attempt, all passed.
- Accounting: 73 provider turns = 73 provider settlements; 2,016 mechanical
  steps; zero mechanical settlements.
- Cost: `$62.295667` product plus `$8.0654455` evaluator equivalent cost.
- Conservative lineage total after this campaign: `$1167.45303525` against
  the `$2000` hard ceiling. This retains `$79.550785` of unavailable-usage
  reservation and does not coerce unavailable usage to zero.
- Safety: zero outward effects, no hidden-answer leakage, and no production-
  path overlap in every attempt.
- Disposable GitHub boundary:
  `buildstacks-dev/operon-eval-candidate-qualification-v1-20260716-9ccc03a2c582`;
  its private issue/PR lifecycle and idempotent rerun passed, with the
  campaign-owned repository retained.

The exact formerly failing `quick/ignore-config/v1::clean-q5` provider command
passed. The neighboring mixed cases also passed, so the literal `/dev/null`
diagnostic-sink repair is covered by both deterministic adversarial tests and
fresh provider evidence.

## Learning governance

All three predeclared AB/BA/AB pairs were valid and improved: `+1`, `+2`, and
`+1`; every hidden guardrail passed.

- Learning candidate SHA-256:
  `sha256:b4c739b4facfcf23f9c48a1cfa6c7f1461309b7e5e07b6b5b22c9b63b09445a0`
- Pair-evidence SHA-256:
  `sha256:800e5f5d559d7c8556fe73b6c1416a1f58192e45891bd45970d6bc1eab9eae8b`
- Action SHA-256:
  `sha256:adbedaca0dac04c9a9378682188df9ba8ae80e3e982c22bd20fdd7bba67fb464`

The exact campaign-local T1 was governed-published, started in one isolated
canary, and rolled back exactly once. The receipt records zero provider turns,
zero GitHub mutations, zero production mutations, zero outward effects, a
cleared canary, and a terminal `rolled_back` intervention.

## Archives, promotion, and retained debt

- Audit archive: 671-file `sanitized-evidence/v3` at
  `/Users/bikram/Build/operon-eval-archives/candidate-qualification-v1-20260716-9ccc03a2c582-28c8bd9c-evidence-v2`.
- Promotion-ready archive: 673-file `sanitized-evidence/v3` at
  `/Users/bikram/Build/operon-eval-archives/qualified/candidate-qualification-v1-20260716-9ccc03a2c582-28c8bd9c-evidence-v2`.
- Both structurally exclude `provider-scratch/**` and raw
  `state/runs/**`. The promotion slice was reverified during import.
- Cleanup was previewed only. Generated worlds, provider scratch, durable
  results, and the private campaign repository remain retained.

Bounded evaluator-only debt is disclosed rather than hidden: the frozen
archiver's top-level evidence allowlist does not recognize the isolated
`learning-governance/` root, and its original receipt name permits only one
archive per campaign hash. A narrow local allowlist/multi-receipt regression
was used to produce and independently import the immutable promotion archive,
then removed so the shipped executable suite remains byte-identical to the
qualified candidate. This does not change product behavior, graders, safety,
accounting, learning conclusions, or the imported archive hashes. It remains
follow-up eval-tooling debt; no provider campaign was restarted for it.

The frozen `eval:attest-release` CLI also passes Node's variadic `resolve`
directly to `Array.map`, which supplies an array index and collection and
therefore throws before attestation. The unchanged release-attestation module
was invoked directly instead; it verified the exact qualified release-package
and executable-suite hashes before the nine projections were written. The CLI
wrapper defect remains disclosed eval-only debt and did not bypass an
attestation check.

The pre-promotion scope test also hard-coded that current strict mode must be
red. Its final-state assertion and the release-attestation verifier are the
only shipped post-qualification executable-suite changes. They are bound by
`research/evals/phase6-evaluator-repair-authorization.json`, which pins both
file hashes, the qualified and release suite hashes, the unchanged release-
package hash, and this campaign identity. Any additional suite drift still
fails closed.

The failed campaign `candidate-qualification-v1-20260716-7ff53bd8273c` remains
permanently retained, reconciled, archived, and not qualified. It was not
rerun, rescored, relabelled, overwritten, or used for promotion.

The nine evidence-supported current contracts are `D-LIVE-01..03`,
`E-LIVE-01..02`, `G-MET-01`, and `I-ROLE-01..03`. `I-LIVE-01` is not promoted;
its separately authorized real-time soak remains future-pending and was not
executed.

The post-promotion current strict gate passed all 288 transformation/eval
tests and reported 83 evaluated current contracts, no known-red contracts, and
no failures. The independent future-soak strict view passed the same 288 tests
and remained non-zero for exactly `I-LIVE-01`, as required.
