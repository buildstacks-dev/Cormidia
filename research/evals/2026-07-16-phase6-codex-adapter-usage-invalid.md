# Phase 6 Codex adapter usage-invalid campaign (2026-07-16)

## Permanent disposition

`adapter-harness-calibration-v1-20260716-9b1f4ac4dc90`, campaign SHA-256
`dbfc6043c61ae418ec3cb47b4daca8760dd077a0a75e10473f84df50bedf0e7d`,
is permanently invalid and cannot admit its dependent candidate. The original
Codex attempt and its linked retry are both retained; neither is overwritten,
relabeled, or omitted from any denominator.

The campaign binds candidate commit
`9cecdc1f2f9bfe3e721525657159f0c65cb6e63f`, package SHA-256
`79dd6f9c260a2d4056ea22b0f292efd4235cc46604611c08899c258a366a9c6f`,
suite SHA-256
`501c4180e75a0e13f61596ddb545f417ef36fe6074cf7902248741ee56f92005`,
release-package SHA-256
`113e7adbbe714bd35fa5239c7b5db7a7baf4c08dcaf6ce649c3eb59668c3ad1b`,
executable-suite SHA-256
`2d2af7f0dd9c5a9cf4a8e6d584b2fa1e2abd1c01f7d0d93d6748b80e39b52665`,
org fingerprint
`062b1374b8bb878f8dec1b13decfb2019ce1ef2cfae66f9191dd4de59160e3d3`,
and system fingerprint
`8ad7aee67129d4647302f7cdda143958f1070548142c513ef5daf5d950362afc`.

## Outcome

Claude and pi passed directly. The primary Codex attempt completed all seven
provider turns and seven settlements but returned unusable aggregate token
totals. The harness retained it as `infra_invalid` with
`adapter_result_invalid: metrics provider attempts require input/output token
totals and usable quality`. The one declared typed infrastructure retry linked
to that exact attempt and passed, but it cannot repair the original missing
measurement denominator. Read-only qualification therefore correctly returned
`invalid`, not qualified.

The immutable campaign contains four attempts, 27 provider turns = 27
settlements, four mechanical permission-boundary steps, zero mechanical
settlements, and $3.7296045 equivalent product cost. It contains no product,
safety, or budget miss. Its qualification SHA-256 is
`ed9ff5464db9ebff86404daa0015a1c74dce387f177c37375030d1e52dd73939`;
report SHA-256 is
`1698a1860b7d20c9fcc96bcf5d50c8f483ba7bbe94d0ca3d0fc56fda9a49a59f`.

The disposable private GitHub exercise and identical idempotency rerun passed
in
`buildstacks-dev/cormidia-eval-adapter-harness-calibration-v1-20260716-9b1f4ac4dc90`.
The verified sanitized archive is
`/Users/bikram/Build/cormidia-eval-archives/adapter-harness-calibration-v1-20260716-9b1f4ac4dc90-dbfc6043-evidence-v2`;
its archive-manifest SHA-256 is
`14bfac28ae7c460ecf223a9c6d9d51f3ade0f849f4d200b84cd3585fd793cc3f`.
Cleanup was preview-only.

This is a provider-measurement failure, not a threshold or product defect, so
no implementation, model, grader, safety, retry, or accounting rule changes.
The retained handoff commit creates a fresh exact candidate identity for a new
adapter campaign under the same standing objective. Focused provider admission
and final candidate qualification were not started. `I-LIVE-01` remains
future-pending.
