# AGENTS.md

## Scope
`eval/**`. These rules also govern `scripts/eval/**` and the transformation
eval fixtures under `test/`. Root AGENTS.md rules still apply.

## Purpose
Highly-efficient-organization qualification assets: exact contract inventory,
schemas, content-addressed app seeds, content-hashed hidden
graders/references/mutants, adapter capability and content-bound operator
declarations, corpora, cases, campaign templates, and price catalogs. Raw
attempts live under ignored `.eval-artifacts/`; standing development grants
live under `eval/development-authorizations/`.

## Required on any change here
- `pnpm eval:validate` · `pnpm test:transformation` · `pnpm eval:deterministic`
  · the complete `pnpm test` · `pnpm typecheck`.
- `pnpm test:transformation:strict` must pass the current scope;
  `pnpm test:transformation:future-soak-strict` must independently fail only
  for `I-LIVE-01` (by design, until the genuine soak campaign passes).
- After a full `pnpm test`, use the atomic gates (`pnpm eval:contracts`,
  `eval:contracts:strict`, `eval:contracts:future-soak-strict`) instead of
  re-entering vitest through the composites.

## Spend boundary — never run casually
- Never run `eval:github` or `eval:live` merely because these files changed.
  `eval:soak` is a separately authorized 48–72 h L6 campaign
  (`OPERON_EVAL_SOAK=1` + exact confirmation + explicit cap).
- `eval:learning-activation` has its own post-L5 human authorization,
  `OPERON_EVAL_LEARNING_ACTIVATION=1`, `--execute`, and exact campaign/
  candidate/action confirmations; L5 spend never authorizes activation.
- Evidence promotion is token-free after an authorized terminal run:
  `eval:archive` → `eval:import-evidence` → `eval:attest-release` →
  `eval:promote`. These never repair results. `eval:qualify` is read-only;
  `eval:release-verify` is the fail-closed release-currency gate.

## Invariants
- Provider usage quality marked unavailable stays an invalid missing
  denominator with its original typed infrastructure/account cause — never
  coerce to zero, retry as a merit miss, or substitute a model.
- Smallest evidence sequence that resolves material risk; at most one
  decisive full campaign per repaired candidate. Preserve every first failure
  and its cause; evaluator-only defects never restart adapter/focused/full
  cascades. Never resample an aggregate learning experiment for a favorable
  draw — replay deterministic verifier defects token-free.
- Standing development authorization and cumulative equivalent-cost
  accounting are defined only in `docs/development.md` and never apply to an
  operated org.

## References
`docs/qualification/design.md` → Phase 6 qualification scope (canonical boundary) ·
`docs/development.md` (authorization + lifecycle) · `docs/qualification/benchmark-runbook.md`
· `docs/testing.md` → Never run these by accident
