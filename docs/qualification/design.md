# Qualification and release gating

*The qualification half of the ratified efficiency doctrine (efficiency/v1;
formerly `docs/efficiency.md`): campaign and result semantics, development
qualification execution, the Phase 6 qualification scope (ratified
2026-07-15), the paired-learning measurement procedure, isolation, and the
attestation integrity/currency split (ratified 2026-07-17). Operating
identities, route admission, budgets, thresholds, and measurement definitions
are [`docs/episodes/contract.md`](../episodes/contract.md);
platform-development lifecycle authority is
[`docs/DEVELOPMENT.md`](../DEVELOPMENT.md); the executable requirement
inventory is `eval/contracts.yaml`.*

## Campaign and result semantics

Every live campaign pins exact code/package/suite hashes, org/system
fingerprints, ordered cases/repetitions, runtime/model/effort assignments,
capability claims, price catalog, randomization seed, side-effect allowlists,
retry/exclusion rules, evidence paths, spend caps, and stop rules before its
first provider turn. Manifest mutation after start invalidates the campaign.
Input tokens are not among the pinned bounds: they are a byproduct of context
assembly and caching rather than a budget, and were retired as an admission
dimension on 2026-07-20 (docs/PURPOSE.md → Decided). Campaigns are bounded by
equivalent cost, provider turns, active time, and human decisions.

Attempt outcomes are `passed`, `product_miss`, `safety_stop`, `budget_stop`,
`infra_invalid`, `harness_error`, and `not_run`. Campaign outcomes are
`qualified`, `not_qualified`, `invalid`, and `incomplete`. Required cases do
not have a passing skip state. An infrastructure retry links to and retains the
original attempt; merit failures are never retried under one attempt identity.

| Campaign | Hard cap |
| --- | ---: |
| Adapter and harness calibration | $15 |
| Pre-transformation provider baseline | $250 equivalent cost (campaign-specific amendment dated 2026-07-12) |
| Full candidate qualification | $375 |
| Real-time soak | Separately declared and ratified |

A campaign template's cap is not authority by itself. Live execution requires
either an exact campaign authorization or a content-bound standing development
grant, plus `OPERON_EVAL_LIVE=1`, validated immutable campaign identity,
explicit `--max-usd`, exact `--confirm <campaign-id>`, non-billable readiness,
the applicable disposable-GitHub proof, and production-path separation. Under
a standing grant, the environment switch and exact confirmation are accident
guards supplied by the developer; the grant's cumulative lineage ceiling is
the human authority.

The baseline cap was amended from the initial $125 recommendation (ratified
2026-07-12). Claude Max and ChatGPT Pro dollar values are equivalent-cost
indicators rather than incremental API billing; per-case route bounds did not
change.

## Development qualification execution

The platform-development lifecycle is separate from the org runtime and is
defined canonically in [`docs/DEVELOPMENT.md`](../DEVELOPMENT.md). A standing
objective grant may cover repaired candidate descendants without repeated
human approval, but it cannot cross into an operated org, production, outward
effects, governed learning activation, or the future real-time soak.

Long provider runs are release evidence, not the ordinary debugging loop. A
failure is preserved and reproduced deterministically; remaining model
uncertainty is admitted in the smallest non-promotable focused campaign. The
same exact candidate must then pass adapter and focused admission before final
qualification can begin. Focused and final campaigns retain thresholds,
graders, assignments, retry rules, measurements, safety, and accounting, and
stop at the first terminal non-pass. Promotion rejects focused evidence.
Within an unchanged case ceiling, unused capacity from an earlier declared
turn carries forward across the remaining declared turns; fixed equal slices
must not manufacture a premature budget stop. Total case and campaign ceilings
remain fail-closed.

Equivalent-cost accounting includes historical lineage cost and every
immutable descendant attempt. It is a circuit breaker even when providers are
subscription-backed. The current Phase 6 grant and its exact cumulative
ceiling live under `eval/development-authorizations/`; this execution policy
does not alter the qualification thresholds below.

## Phase 6 qualification scope

This section is the canonical Phase 6 boundary (ratified 2026-07-15). The
scope change does not alter a threshold, grader, retry rule, measurement,
denominator, model assignment, safety boundary, learning-efficacy rule, or
provider-accounting requirement.

The contract inventory remains exactly 84 records. Every record declares one
`qualification_scope`:

- `current` contains exactly 83 contracts. Candidate campaign
  `candidate-qualification-v1-20260716-9ccc03a2c582` qualified all 34 declared
  attempts with exact 73/73 provider settlement agreement and supported the
  nine provider-evidence promotions: `D-LIVE-01..03`, `E-LIVE-01..02`,
  `G-MET-01`, and `I-ROLE-01..03`. The current scope therefore has no
  known-red contract after those content-bound projections land.
- `future_soak` contains exactly `I-LIVE-01`. It remains required and known-red
  until a genuine separately authorized 48–72 hour real-time scheduler
  campaign satisfies its unchanged cadence, restart, safety, accounting, and
  evidence contract. It is neither passed nor current Phase 6 debt. The
  token-free future-soak strict result must therefore remain non-zero for
  exactly `I-LIVE-01` until that campaign is validly promoted.

The current strict command may exclude only the declared `future_soak`
contract; inventory validation fails for any missing, duplicate, unscoped,
foreign-scoped, or additionally future-scoped record. A preview, local passing
marker, deterministic seven-day virtual soak, or manufactured evidence cannot
promote `I-LIVE-01`. Read-only production confirmation reports production
facts but cannot replace the future soak or repair sandbox qualification.
The token-free views are `pnpm test:transformation:strict` for `current` and
`pnpm test:transformation:future-soak-strict` for `future_soak`.

Completing the current scope may be reported as **“Phase 6 efficiency
qualification complete; future real-time soak pending.”** Operon must not be
described as a fully proven “highly efficient organization” until
`I-LIVE-01` passes the genuine future campaign. Phase 6 completion and that
broader organizational claim are deliberately distinct.

## Isolation and qualification

Eval actors run in fresh synthetic homes, an `Operon-Eval-<campaign-id>` org,
immutable content-addressed sparse/library/service templates, and managed
clones. Hidden graders, answer keys, reference patches, and mutants stay
outside actor context and tool-visible paths. GitHub writes are limited to
predeclared private `operon-eval-*` repositories. No eval publishes, sends,
changes DNS/cloud infrastructure, deploys to production, or performs an
irreversible data operation.

The exact candidate package qualifies only after deterministic contracts,
fixture/grader calibration, disposable GitHub behavior, required provider
conformance, five fresh quick episodes, and ten predeclared mixed-route
episodes satisfy all hard invariants and distribution thresholds. Production
is separately reported read-only confirmation and cannot rewrite qualification.

Qualification remains attached to the prepared candidate commit. A later
evidence-only release descendant is admissible only through a deterministic
attestation that requires the qualified candidate commit to be present — failing
closed when it is absent, as in a shallow CI checkout — and preserves the
candidate's installable-package hash, executable-eval-suite hash, org
fingerprint, and every prepared campaign hash; rejects deletes and any
unallowlisted change to the packaged artifact or the sanitized-evidence
namespace, while non-packaged, non-evidence files (docs other than the two
packed docs, review notes, `.github/` other than the qualification workflow, and
install/build-environment config such as `pnpm-workspace.yaml`,
`pnpm-lock.yaml`, and `tsconfig.json`) are outside qualification scope and do not
invalidate it. The executable-eval-suite hash governs not only the
`scripts/eval`, `test`, and `eval` trees and the workflow but also the
test-runner/grading configs (`vitest.config.ts`, `vitest.live.config.ts`,
`playwright.observe.config.ts`) that decide which tests run, so a
post-qualification edit cannot silently skip the red contract tests. The
attestation content-binds each sanitized promotion file.
Contract projections then independently recompute the
qualifier and portable report and verify the schema-v2 archive receipt,
GitHub/idempotence evidence, exact case/repetitions, hidden-grader evidence,
route admission, terminal integrity, and provider/settlement agreement. The
descendant does not become a new qualified candidate and cannot change source,
eval executable bytes, fixtures, graders, campaigns, package inputs,
lockfiles, roles, pipelines, or prompts.

The attestation separates two concerns (P0-07 / ROOT-001 follow-up, ratified
2026-07-17). Evidence **integrity** — the attestation is well-formed, bound to
its committed campaign, pinned to that campaign's qualified package/suite hashes,
self-consistent, and lists only allowlisted promotion paths — is deterministic
and is what the offline suite (`pnpm test`, `test:transformation`) asserts, so it
is green whenever the committed evidence is intact and a legitimate source change
cannot redden it. Product **currency** — the live `npm pack`, executable suite,
org surfaces, on-disk promotion bytes, and git changed-path scope still match the
qualified pin — is recomputed from the working tree and enforced fail-closed only
at the release gate: `eval:attest-release` refuses to mint for a moved product,
and `eval:promote` and `eval:release-verify` refuse to verify one. A dedicated
`release-currency` CI job (gated to release tags and manual dispatch, off
ordinary push/PR) runs `eval:release-verify`. A moved product therefore cannot be
minted, promoted, or released without a new qualification campaign, while
per-commit CI stays honest-green.

## Phase 6 learning-efficacy measurement

For Phase 6, the paired-learning intervention is the predeclared T1 procedure
at `eval/treatments/learning-t1-v1.md`, pinned by the candidate campaign's
`learning_treatment.content_sha256`. Only treatment-arm builder context receives
those bytes. The six provider artifacts and their independent hidden-grader
records supply the three AB/BA/AB measurements. The primary metric is an
integer artifact-quality score from zero through eight: grounded error classes,
a causal hypothesis, a bounded/reversible intervention, and measurable
guardrails each contribute zero through two points. The outcome is `improved`
only when all three treatment scores strictly exceed their paired controls and
all hidden guardrails pass. Each arm's independent provider review must end in
exactly one `VERDICT: APPROVE` or `VERDICT: REJECT` marker, which is retained
with the reviewer artifact hash; a rejection is a valid guardrail failure and
cannot be normalized into an approval. Any negative delta or hidden-guardrail failure is
`regressed`; nonnegative pairs with any zero delta are `inconclusive`; and
missing, mismatched, or infrastructure-corrupt evidence is `invalid`. A
declared or copied verdict is not a measurement. **Candidate qualification
requires a valid, guardrail-clean, non-regressing measurement — `improved` and
`inconclusive` both satisfy it, while `regressed` and `invalid` fail it. Strict
improvement (`improved`) is required, and is the only outcome that may proceed,
for the separately-authorized activation, not for candidate qualification
(2026-07-17 decouple — see `docs/PURPOSE.md`). Learning *capture* (100% eligible
capture) remains the operations SLO for the loop.**
After all pairs terminate — and only when the measured outcome is `improved` —
a separate token-free preview binds the exact
candidate, pair-evidence hash, reviewer-artifact hashes, and one isolated
publish/activate/rollback action. Executing that action requires its own exact
candidate and action-hash authorization; L5 provider-spend authorization does
not authorize it.
