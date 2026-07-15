# Model-assignment refresh — 2026-07-15

## Decision and scope

The human operator ratified refreshing Operon's current model configuration
and the still-unexecuted Phase 6 campaigns to the latest generally available
models. This changes model/configuration bytes only; it does not change any
grader, threshold, route, denominator, effort, safety rule, provider-turn cap,
or equivalent-cost ceiling.

The exact assignments are:

- Planner and Reviewer remain Claude `claude-opus-4-8`; this is still the
  current Opus-tier assignment and preserves cross-provider review.
- Builder, SRE, and Learning Reviewer use Codex `gpt-5.6-sol`.
- Phase 6 Support and Marketing pi cases use pi with the exact
  `openai-codex/gpt-5.6-sol` provider/model.
- Fresh adapter calibration uses Claude `claude-opus-4-8`, Codex
  `gpt-5.6-sol`, and pi `openai-codex/gpt-5.6-sol`, so the inexpensive
  calibration must prove both direct Codex and pi-over-Codex paths before
  candidate execution.

Historical manifests, archives, results, and the pre-transformation baseline
retain their original model IDs. They are evidence, not migration targets.

## Current catalog evidence

OpenAI's current model guide identifies GPT-5.6 Sol as the exact flagship
snapshot and says the moving `gpt-5.6` alias routes to it. The exact ID is used
so campaign identity cannot drift. Standard API list pricing is $5 per million
input tokens and $30 per million output tokens. A prompt above 272K input
tokens costs 2× the input rate and 1.5× the output rate for that request.

Sources:

- https://developers.openai.com/api/docs/guides/latest-model
- https://developers.openai.com/api/docs/models/gpt-5.6-sol
- https://developers.openai.com/api/docs/pricing

Token-free installed-runtime discovery reported Claude Code 2.1.210, Codex
CLI 0.144.1, and pi 0.80.6. Pi's offline catalog advertises
`openai-codex/{gpt-5.6-sol,gpt-5.6-terra,gpt-5.6-luna}`. The embedded package
is pinned to current stable 0.80.7, and the eval declarations use the exact
`openai-codex/gpt-5.6-sol` ID rather than a moving alias.

## Account boundary

The retained invalid Phase 6 campaign proved that the account rejected pi's
Claude turns at the third-party extra-usage boundary. That evidence remains
invalid and is not relabelled. The operator subsequently ratified using pi
only with Codex for evals. This is an explicit assignment change, not a retry
or reinterpretation of the old evidence. Candidate execution is now gated on
a fresh adapter campaign whose pi probe uses the candidate's exact
`openai-codex/gpt-5.6-sol` assignment. No standalone test turn is manufactured
outside the campaign, and unavailable usage remains an invalid measurement
rather than zero cost.

That gate was exercised by
`adapter-harness-calibration-v1-20260715-7d36fc5f3d3f`. It confirmed that the
Claude extra-usage blocker remains active for pi. It also proved that the
repository-local `@openai/codex` 0.142.5 runtime was too old to admit
`gpt-5.6-sol`; the repository now pins stable 0.144.4. The campaign and its one
Codex retry remain invalid and archived, while the unexecuted matching
candidate manifest is stale. Full evidence is recorded in
`research/evals/2026-07-15-phase6-latest-model-adapter-invalid.md`.

The subsequently prepared `20260715-0794dd5378ed` identities and their exact
authorizations became stale before execution when the operator changed all pi
evaluation assignments to `openai-codex/gpt-5.6-sol` and the embedded pi SDK
was updated to 0.80.7. They must never execute. Fresh committed bytes,
manifests, previews, and authorizations are required.

The previously prepared `20260715-d18a3579b4a9` campaign identities and their
authorizations became stale before execution when these covered model,
price-catalog, runtime-accounting, and documentation bytes changed. Fresh
committed candidate bytes, manifests, hashes, repositories, previews, and
authorizations are required.
