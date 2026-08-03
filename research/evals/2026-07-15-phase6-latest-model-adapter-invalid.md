# Phase 6 latest-model adapter calibration — retained invalid campaign (2026-07-15)

## Disposition

Campaign `adapter-harness-calibration-v1-20260715-7d36fc5f3d3f`, SHA-256
`7184ed7001fc9cb7adbc678b72a945821a0e7b7d3891e4b9adec67c5916edf7a`,
is permanently retained with outcome `invalid`. It evaluated candidate commit
`091101057bd78ca9e4b10ccd7c5156559c94b643`, package SHA-256
`675e48fa88d37f7bf4826d786fa34ad9f8fecb79015b95239032b2ef05ecfe93`,
suite SHA-256
`0b686a4c66d4670b699b035eae1d7fec334655f87e17f30ac9570e6bee40fe66`,
org fingerprint
`062b1374b8bb878f8dec1b13decfb2019ce1ef2cfae66f9191dd4de59160e3d3`,
and system fingerprint
`59b4e306643c1ee90c2b2c00eaaa73034dead558bc3cc18963e19798f0a7357f`.
It must not be retried, overwritten, relabelled, discarded, or used as adapter
admission for a later candidate.

The immutable qualifier retained four attempts: Claude passed, the original
Codex attempt was infrastructure-invalid, its one declared infrastructure
retry was separately linked and infrastructure-invalid, and pi was
infrastructure-invalid. There were no product misses, safety stops, budget
stops, harness errors, or missing attempts. Ten provider turns reconcile to
ten ordinary settlements; four mechanical steps produced zero mechanical
settlements. Product equivalent cost was $0.9618915 and evaluator equivalent
cost was zero.

## GitHub evidence

The exact private GitHub lifecycle used issue 1 and pull request 2 in
`buildstacks-dev/cormidia-eval-adapter-harness-calibration-v1-20260715-7d36fc5f3d3f`.
It squash-merged the content-addressed temporary branch, closed the issue,
deleted only the temporary branch, and retained the repository. The identical
second execution reused the durable evidence and reported source-evidence
SHA-256
`d80396f314dac6710eddf96d6e6d14670b713f50213dcd1d0289223b557c2e81`.

## Exact infrastructure findings

Claude Opus 4.8 completed all seven calibration interactions and passed its
grader. Both Codex attempts were rejected before useful work because the
repository-local `@openai/codex` 0.142.5 runtime was too old for the exact
`gpt-5.6-sol` model. The repository now pins the current stable 0.144.4
runtime and an adversarial regression test binds that package and lockfile
identity. This is a covered-byte correction, not a retry of the retained
campaign.

The pi Claude Sonnet 5 attempt was rejected because third-party Claude clients
require funded account “extra usage.” This is an external account blocker,
not a product miss. The assignment is not substituted and the zero-cost
rejection remains an infrastructure-invalid attempt. Candidate qualification
must not start until a new exact adapter campaign proves this account path.

The prepared but unexecuted
`candidate-qualification-v1-20260715-7d36fc5f3d3f` manifest became stale when
the Codex dependency and lockfile changed. It was never authorized for the new
bytes and must never be executed.

## Qualifier and archive

The byte-stable portable report SHA-256 is
`91bb9f48a5d92baccc120f3fb2109967c489b21360504ee0f8d622eb03706c43`.
The verified 67-file `sanitized-evidence/v3` archive is retained at
`/Users/bikram/Build/cormidia-eval-archives/adapter-harness-calibration-v1-20260715-7d36fc5f3d3f/adapter-harness-calibration-v1-20260715-7d36fc5f3d3f-7184ed70-evidence-v2`.
Its archive-manifest SHA-256 is
`4e4890f59ce24f1b6c999c6a6fc08fcaf046787d642b7546456d78fa6f0869a6`,
and the local archive-receipt SHA-256 is
`49ceef6f555fc2eed44264d40e3ba09cff77cf311006d9a3b03a8094a5500995`.
The archive excludes `provider-scratch/**` and raw L3 `state/runs/**`.
Cleanup was not executed.

No candidate campaign, real-time soak, production confirmation, scheduler
installation, production mutation, deployment, publication, message, or
other outward effect was performed.
