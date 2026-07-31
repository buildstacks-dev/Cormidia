# Qualification and release gating

> **Status 2026-07-31:** the executable machinery this contract governs
> (`scripts/eval/**`, `eval/**`, the transformation suite, the
> release-currency CI lane) is frozen under `archive-do-not-read/` and
> qualification campaigns are **suspended** during the validation rebuild
> (docs/PURPOSE.md → Decided, v2.9). The contract below remains the canonical
> record the replacement harness must satisfy or consciously supersede.

*How Operon itself earns the right to ship. A release candidate is proved by
**campaigns** — predeclared, immutable batches of evaluation runs — and this
document defines the rules those campaigns obey: what must be pinned before
the first model call, what attempts and outcomes may claim, how development
iterates without a re-approval loop, the exact Phase 6 scope boundary, the
isolation rules, and the attestation that ties a qualified result to the
bytes actually released. Nothing here is narrative: every rule is enforced by
`scripts/eval/**` and the transformation test suite. Operating identities and
route budgets are [`docs/episodes/contract.md`](../episodes/contract.md);
developer lifecycle policy is [`docs/DEVELOPMENT.md`](../DEVELOPMENT.md); the
executable requirement inventory is `eval/contracts.yaml`. Ratification dates
live in [History](#history), details in `docs/PURPOSE.md` → Decided.*

## Campaign and result semantics

A campaign declares everything before its first model call: exact
code/package/suite hashes, org and system fingerprints, the ordered cases and
repetition counts, runtime/model/effort assignments, capability claims, the
price catalog, the randomization seed, side-effect allowlists,
retry/exclusion rules, evidence paths, spend caps, and stop rules. Mutating
the manifest after start invalidates the campaign. Campaigns are bounded by
equivalent cost, provider turns, active time, and human decisions — input
tokens are deliberately not a bound, because they are a byproduct of context
assembly and caching rather than a budget.

An attempt terminates as exactly one of `passed`, `product_miss`,
`safety_stop`, `budget_stop`, `infra_invalid`, `harness_error`, or `not_run`.
A campaign terminates as `qualified`, `not_qualified`, `invalid`, or
`incomplete`. A required case has no passing skip state. An infrastructure
retry links to and retains the original attempt; a merit failure is never
retried under the same attempt identity.

| Campaign | Hard cap |
| --- | ---: |
| Adapter and harness calibration | $15 |
| Pre-transformation provider baseline | $250 equivalent cost |
| Full candidate qualification | $375 |
| Real-time soak | Separately declared and ratified |

A template's cap is not authority to run. Live execution needs either an
exact campaign authorization or a content-bound standing development grant,
plus `OPERON_EVAL_LIVE=1`, a validated immutable campaign identity, an
explicit `--max-usd`, the exact `--confirm <campaign-id>`, non-billable
readiness, the applicable disposable-GitHub proof, and production-path
separation. Under a standing grant, the environment switch and exact
confirmation are accident guards the developer supplies; the grant's
cumulative lineage ceiling is the human authority. Subscription-backed
dollar values (Claude Max, ChatGPT Pro) are equivalent-cost indicators, not
incremental API billing.

## Development qualification execution

The platform-development lifecycle is separate from the org runtime;
[`docs/DEVELOPMENT.md`](../DEVELOPMENT.md) defines it. A standing objective
grant may cover repaired candidate descendants without repeated human
approval, but it can never cross into an operated org, production, outward
effects, governed learning activation, or the future real-time soak.

Long provider runs are release evidence, not the ordinary debugging loop.
When a campaign fails: preserve the failure, reproduce it deterministically,
and admit whatever model uncertainty remains in the smallest non-promotable
focused campaign. The same exact candidate must then pass adapter and
focused admission before final qualification begins. Focused and final
campaigns keep the same thresholds, graders, assignments, retry rules,
measurements, safety, and accounting, and stop at the first terminal
non-pass; promotion rejects focused evidence. Within an unchanged case
ceiling, unused budget from an earlier declared turn carries forward across
the remaining declared turns — fixed equal slices must not manufacture a
premature budget stop — while total case and campaign ceilings stay
fail-closed.

Equivalent-cost accounting includes the full historical lineage and every
immutable descendant attempt; it is a circuit breaker even when providers
are subscription-backed. The current grant and its exact cumulative ceiling
live under `eval/development-authorizations/`; this execution policy never
alters the qualification thresholds themselves.

## Phase 6 qualification scope

Phase 6 is the platform's current qualification generation, and this section
is its canonical boundary. The boundary decides scope only — it never alters
a threshold, grader, retry rule, measurement, denominator, model assignment,
safety boundary, learning-efficacy rule, or provider-accounting requirement.

The contract inventory holds exactly 84 records, each declaring one
`qualification_scope`:

- `current` contains exactly 83 contracts. Candidate campaign
  `candidate-qualification-v1-20260716-9ccc03a2c582` qualified all 34
  declared attempts with exact 73/73 provider settlement agreement and
  supported the nine provider-evidence promotions: `D-LIVE-01..03`,
  `E-LIVE-01..02`, `G-MET-01`, and `I-ROLE-01..03`. With those content-bound
  projections landed, the current scope has no known-red contract.
- `future_soak` contains exactly `I-LIVE-01`. It stays required and
  known-red until a genuine, separately authorized 48–72 hour real-time
  scheduler campaign satisfies its unchanged cadence, restart, safety,
  accounting, and evidence contract. It is neither passed nor current
  Phase 6 debt, and the token-free future-soak strict result must stay
  non-zero for exactly `I-LIVE-01` until that campaign is validly promoted.

The current strict command may exclude only the declared `future_soak`
contract; inventory validation fails on any missing, duplicate, unscoped,
foreign-scoped, or additionally future-scoped record. A preview, a local
passing marker, the deterministic seven-day virtual soak, or manufactured
evidence cannot promote `I-LIVE-01`; read-only production confirmation
reports production facts but cannot replace the future soak or repair
sandbox qualification. The token-free views are
`pnpm test:transformation:strict` for `current` and
`pnpm test:transformation:future-soak-strict` for `future_soak`.

Completing the current scope may be reported as **"Phase 6 efficiency
qualification complete; future real-time soak pending."** Operon must not be
described as a fully proven "highly efficient organization" until
`I-LIVE-01` passes the genuine future campaign. Phase 6 completion and that
broader organizational claim are deliberately distinct.

## Isolation and qualification

Eval actors run in fresh synthetic homes, an `Operon-Eval-<campaign-id>`
org, immutable content-addressed sparse/library/service templates, and
managed clones. Hidden graders, answer keys, reference patches, and mutants
stay outside actor context and tool-visible paths. GitHub writes are limited
to predeclared private `operon-eval-*` repositories. No eval publishes,
sends, changes DNS or cloud infrastructure, deploys to production, or
performs an irreversible data operation.

The exact candidate package qualifies only after deterministic contracts,
fixture/grader calibration, disposable GitHub behavior, required provider
conformance, five fresh quick episodes, and ten predeclared mixed-route
episodes satisfy all hard invariants and distribution thresholds. Production
is separately reported, read-only confirmation; it cannot rewrite
qualification.

Qualification stays attached to the prepared candidate commit. A later
release may descend from it only by adding evidence, and only through a
deterministic attestation. The attestation requires the qualified candidate
commit to be present — failing closed when it is absent, as in a shallow CI
checkout — and preserves the candidate's installable-package hash,
executable-eval-suite hash, org fingerprint, and every prepared campaign
hash. It rejects deletes and any unallowlisted change to the packaged
artifact or the sanitized-evidence namespace, and it content-binds each
sanitized promotion file. Non-packaged, non-evidence files — docs other than
the two packed docs, review notes, `.github/` other than the qualification
workflow, and install/build-environment config such as
`pnpm-workspace.yaml`, `pnpm-lock.yaml`, and `tsconfig.json` — are outside
qualification scope and do not invalidate it.

The executable-eval-suite hash deliberately covers more than the eval code:
beyond the `scripts/eval`, `test`, and `eval` trees and the workflow, it
includes the test-runner and grading configs (`vitest.config.ts`,
`vitest.live.config.ts`, `playwright.observe.config.ts`) that decide which
tests run — so a post-qualification edit cannot silently skip the red
contract tests. Contract projections then independently recompute the
qualifier and portable report and verify the archive receipt,
GitHub/idempotence evidence, exact cases and repetitions, hidden-grader
evidence, route admission, terminal integrity, and provider/settlement
agreement. The descendant never becomes a new qualified candidate: it cannot
change source, eval executable bytes, fixtures, graders, campaigns, package
inputs, lockfiles, roles, pipelines, or prompts.

The attestation separates two concerns. Evidence **integrity** — the
attestation is well-formed, bound to its committed campaign, pinned to that
campaign's qualified package/suite hashes, self-consistent, and lists only
allowlisted promotion paths — is deterministic and asserted by the offline
suite (`pnpm test`, `test:transformation`): it stays green whenever the
committed evidence is intact, and a legitimate source change cannot redden
it. Product **currency** — whether the live `npm pack`, executable suite,
org surfaces, on-disk promotion bytes, and git changed-path scope still
match the qualified pin — is recomputed from the working tree and enforced
fail-closed only at the release gate: `eval:attest-release` refuses to mint
for a moved product, `eval:promote` and `eval:release-verify` refuse to
verify one, and a dedicated `release-currency` CI job (release tags and
manual dispatch only) runs `eval:release-verify`. A moved product therefore
cannot be minted, promoted, or released without a new qualification
campaign, while per-commit CI stays honest-green.

## Phase 6 learning-efficacy measurement

The paired-learning proof asks one question: does a governed learning
intervention measurably improve a later comparable episode? For Phase 6 the
intervention is the predeclared T1 procedure at
`eval/treatments/learning-t1-v1.md`, pinned by the candidate campaign's
`learning_treatment.content_sha256`. Only treatment-arm builder context
receives those bytes; the six provider artifacts and their independent
hidden-grader records supply the three AB/BA/AB paired measurements.

The primary metric is an integer artifact-quality score from zero through
eight: grounded error classes, a causal hypothesis, a bounded/reversible
intervention, and measurable guardrails each contribute zero through two
points. Each arm's independent provider review must end in exactly one
`VERDICT: APPROVE` or `VERDICT: REJECT` marker, retained with the reviewer
artifact hash; a rejection is a valid guardrail failure and cannot be
normalized into an approval. A declared or copied verdict is not a
measurement.

The outcome is `improved` only when all three treatment scores strictly
exceed their paired controls and every hidden guardrail passes. Any negative
delta or guardrail failure is `regressed`; nonnegative pairs with any zero
delta are `inconclusive`; missing, mismatched, or infrastructure-corrupt
evidence is `invalid`.

**Candidate qualification and learning activation are decoupled.** A
candidate qualifies on any valid, guardrail-clean, non-regressing
measurement — `improved` and `inconclusive` both satisfy it, while
`regressed` and `invalid` fail it. Strict improvement (`improved`) is
required only for the separately-authorized *activation*: after all pairs
terminate, a token-free preview binds the exact candidate, pair-evidence
hash, reviewer-artifact hashes, and one isolated publish/activate/rollback
action, and executing that action requires its own exact candidate and
action-hash authorization — L5 provider-spend authorization does not cover
it. Learning *capture* (100% eligible capture) remains the operations SLO
for the loop.

## History

Evaluation semantics ratified 2026-07-12 (the baseline cap was amended the
same day from the initial $125 recommendation to $250); organization-wide
operating doctrine 2026-07-13; the Phase 6 scope boundary 2026-07-15; the
attestation integrity/currency split and the learning
qualification/activation decouple 2026-07-17; input tokens retired as an
admission dimension 2026-07-20. This file is the qualification half of what
was `docs/efficiency.md` until the 2026-07-26 topic-folder reorg. Full
decision history: `docs/PURPOSE.md` → Decided.
