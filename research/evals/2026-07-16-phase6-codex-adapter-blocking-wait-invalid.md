# Phase 6 Codex adapter blocking-wait invalid campaign (2026-07-16)

## Permanent disposition

`adapter-harness-calibration-v1-20260716-5421c437b604`, campaign SHA-256
`d5f680f84841362bf282ee12e63be46b67e0db36480ae39766e135192c5eda25`,
is permanently invalid and cannot admit focused or final candidate work. Its
original Codex attempt and linked retry remain separate and counted.

The campaign binds candidate commit
`5af8cf9fbdc1fd62a62ad89e179e931df485a89f`, package SHA-256
`8afe6607fa937aae1a0aba39e62f532ab9063e051f4ec0649cadbda36aef6c56`,
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

## Outcome and genuine cause

Claude and pi passed directly. The primary Codex attempt completed and settled
all seven declared turns, but its cancellation scenario reached the unchanged
20-second bounded fallback before any usage-bearing progress checkpoint. The
cancelled turn therefore retained unavailable usage and the attempt correctly
became `infra_invalid`. The one linked retry passed but cannot repair the
original invalid denominator.

The retained provider session shows why the checkpoint did not arrive: the
underspecified task told the model to wait for cancellation, and Codex selected
its long-running `wait_agent` facility. That tool did not return a token-usage
checkpoint before the fallback. The retry selected a short bounded tool,
emitted partial usage, and cancelled correctly. The same fallback pattern in
the immediately preceding invalid campaign makes this a harness-prompt defect,
not sufficient evidence for another unchanged retry.

The correction makes the cancellation task require one routine bounded read
before a short response and expressly forbids wait, sleep, polling, background,
delegated, subagent, or other long-running facilities. It does not change the
20-second fallback, fail-closed unavailable-usage rule, denominators, model,
turn count, retry rule, accounting, safety boundary, or qualification threshold.

## Retained evidence

The immutable campaign has four attempts, 27 provider turns = 27 settlements,
four mechanical permission-boundary steps, zero mechanical settlements, and
$3.973494 equivalent product cost. Its deterministic qualification SHA-256 is
`98c10c5d4eb4b40299d3d410a2f1efdb26422eda7cd139ac4bd61fcff2babd8a`;
its deterministic report SHA-256 is
`49bae93f593a23a23d5051808da9d076b84690d4d001b6e7a416f47e2da067c3`.

The private GitHub exercise and identical idempotency rerun passed in
`buildstacks-dev/cormidia-eval-adapter-harness-calibration-v1-20260716-5421c437b604`.
The verified sanitized archive is
`/Users/bikram/Build/cormidia-eval-archives/adapter-harness-calibration-v1-20260716-5421c437b604-d5f680f8-evidence-v2`;
its archive-manifest SHA-256 is
`f7f38973870ae4fbd328d639394ed74a5d89b02d4fb70fe49b29a895c0f9eecd`.
Cleanup was preview-only. Focused admission and final qualification were not
started. `I-LIVE-01` remains future-pending.
