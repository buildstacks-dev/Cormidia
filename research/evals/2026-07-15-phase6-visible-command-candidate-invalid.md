# Phase 6 visible-command qualification — retained adapter pass and invalid candidate (2026-07-15)

## Disposition

The exact-candidate adapter campaign
`adapter-harness-calibration-v1-20260715-0e41f4160bff`, SHA-256
`c54d52d2a5d0ca1acc7ed654819e32f53dae8001d68f00835e2af93083193cda`,
is permanently retained as `qualified`. The dependent candidate campaign
`candidate-qualification-v1-20260715-0e41f4160bff`, SHA-256
`3bf2bd6930647d5b3190e239db8081968139f86ab7a109c324e90b6ed9fab82a`,
is permanently retained as `invalid`. Neither campaign is retried,
overwritten, or relabelled.

Both campaigns bind candidate commit
`8d385bd6f19cc050d81a8f78b49b33039dd908c6`, package SHA-256
`3002efda552fbda4162b39425982adebbb859b2b6278059059b06d87c93b6b9d`,
suite SHA-256
`d066ae9b4d217ac61d980eb87817c5505ae2d282147981c89e688a555d5acd37`,
org fingerprint
`062b1374b8bb878f8dec1b13decfb2019ce1ef2cfae66f9191dd4de59160e3d3`,
and system fingerprint
`8ad7aee67129d4647302f7cdda143958f1070548142c513ef5daf5d950362afc`.
The installable release-package SHA-256 is
`3cc7050eba7deb14cbc5d4c2eb1c33e5d7a3b1b2f3732a0cf89483ad84a5758e`
and the executable-suite SHA-256 is
`08276f1c4dee5a48b5248639c3448ee0a5e1f3d55b605c518c8b5a89ab4768fe`.

## Qualified adapter admission

Claude Opus 4.8 through Claude, GPT-5.6-sol through Codex, and
`openai-codex/gpt-5.6-sol` through pi all passed at low effort without a
retry. The three results contain 20 provider turns, 20 ordinary settlements,
three mechanical steps, zero mechanical settlements, exact terminal
integrity, and $2.68603525 equivalent product cost. The read-only qualifier
returned `qualified` with three passes and no product, infrastructure,
harness, safety, budget, missing-attempt, or retry result.

The private GitHub exercise retained issue 1 and pull request 2 in
`buildstacks-dev/cormidia-eval-adapter-harness-calibration-v1-20260715-0e41f4160bff`.
Repository ID `R_kgDOTZwsKw` and content commit
`52327921d072b168b30bddee61045e8d80782587` are bound in the evidence. The
identical second execution created no duplicate remote state. Source evidence
SHA-256 is
`6fedadc363811b00db187655af4e7e9356b0d9e7ce09a9cda81c84b544106f8a`;
the idempotence evidence SHA-256 is
`18dcd2f8bbe5b8c1748f25e5975df34250a471cd8b2e50c5966e64330584a07e`.

The report SHA-256 is
`2e3fa3812e3c825d137493ad5352d9d63adae872ebe2f2e56ccd2fc98d1cef13`
and the immutable qualification JSON SHA-256 is
`a7e7717ee83044f3a408e5b04e93b84915ee8f6a8abeb43f8df85d2c27b008a2`.
Both reproduced byte-for-byte. The verified 91-file
`sanitized-evidence/v3` archive is retained at
`/Users/bikram/Build/cormidia-eval-archives/adapter-harness-calibration-v1-20260715-0e41f4160bff-c54d52d2-evidence-v2`;
its archive-manifest SHA-256 is
`94a04bb757bd9d6f37fa7f8a88de65166dff8064308f5b48f1b4721a82c49541`.
The separately retained local archive-receipt SHA-256 is
`83d3cb5a73c6a4e779cffd7474eaffef30bb09b2781ba82f45f92b22d56f4153`.
Cleanup was previewed only.

## Candidate result and accounting

The candidate GitHub exercise retained issue 1 and pull request 2 in
`buildstacks-dev/cormidia-eval-candidate-qualification-v1-20260715-0e41f4160bff`.
Repository ID `R_kgDOTZw2bQ` and content commit
`bc8f5b0451e6cde1add8674b992f4e20255aaf7f` are bound in the evidence. Its
identical rerun created no duplicate remote state. Source evidence SHA-256 is
`323e6530f166b10f8d73c351b92d6754856701b9a91a49ce53c0e7dca81286d7`;
the idempotence evidence SHA-256 is
`ac429c8837fe1d50e17169adab2b44120a5ac0eaf134a497f5e78ab18b8b8653`.

The immutable qualifier reports 34 terminal attempts: 33 passed and one
genuine `product_miss`. There were no infrastructure-invalid, harness-error,
safety-stop, budget-stop, retry, or unrun attempts. All 72 provider turns
reconcile to 72 ordinary settlements. The 2,016 mechanical steps created zero
mechanical settlements. Product equivalent cost is $74.0952675 and
independent evaluator equivalent cost is $7.53043375. No attempt reports an
outward effect, hidden-answer leakage, or production-path overlap.

All three proportional planning cases, all six Claude/Codex/pi context-delta
repetitions, five clean episodes, nine of ten mixed episodes, both
continuation episodes, approval semantics, the deterministic seven-day
virtual soak, and the SRE, Support, and Marketing provider cases passed. The
virtual soak reasoned all 2,016 due ticks, with reliability 1, zero duplicate
ticks, and no provider-runtime construction or settlement. The delivery
oracle correctly remained red at 14/15 because the second deep episode failed.

## Valid but inconclusive learning evidence

All six learning arms completed with valid provider artifacts, independent
reviewer approvals, passed hidden guardrails, and complete measurements. The
predeclared AB, BA, AB pairs scored 8→8, 7→8, and 6→7. Their deltas are
therefore 0, 1, and 1, and the exact unchanged efficacy rule classifies the
paired outcome as `inconclusive`. The content-bound pair-evidence SHA-256 is
`7d180db0a06a07d798d0af6bbcf66697c18903d23003b5d78bcd5c0496ef137e`.

No governed activation/rollback preview was generated because the rule
requires all three treatment scores to strictly exceed their controls. No
learning activation or rollback was authorized or executed. The maximum-score
control, its zero delta, and the inconclusive outcome remain permanent
evidence; no threshold, score, component, guardrail, treatment, pairing order,
or denominator is changed to make them green.

## Retained failure and genuine correction

`deep/auth-migration/v1::mixed-d2` completed its contract and implementation
provider turns with valid usage, exact settlement, no repeated work, and no
safety escalation. The implementation added a migration test whose regular
expression required `'UTF8'` to be immediately followed by `)`, while the SQL
it generated placed a newline between those tokens. The declared `npm test`
visible command consequently failed one of nine tests. The visible gate
correctly stopped there; the hidden grader did not run, no verifier evidence
was manufactured, no independent-review turn was charged, and the merit miss
was not retried. The attempt retains two provider turns, two settlements,
$11.070245 product equivalent cost, and no evaluator cost.

The corrected existing implementation brief now enumerates every declared
visible command for the case, requires all of them to be green before the
actor completes, requires a full declared-set rerun after a failure, and
forbids weakening, skipping, renaming, replacing, or removing a check. This
adds no provider turn, retry, answer, threshold, or oracle. An adversarial
regression test proves that an actor still completing with a red command
remains an unretried `product_miss` and that the hidden grader remains
unreachable after the visible failure.

No gate rule, hidden grader, retry rule, measurement, denominator, model
assignment, safety boundary, learning efficacy rule, provider accounting
rule, or delivery threshold changed. The learning tie has no legitimate local
repair; it must be independently measured again only under a fresh candidate
identity and separate exact authorization.

## Corrected-descendant token-free admission

The correction passed the focused provider-workflow regression (18 tests),
`pnpm eval:validate` (84/84 requirements), `pnpm test:transformation` (270
tests), `pnpm eval:deterministic` (413 tests), both shuffled nightly orders
(413 tests each), the complete `pnpm test` suite (1,563 tests), `pnpm
typecheck`, `pnpm build`, `pnpm smoke:onboarding`, and `npm pack --dry-run`.
A separate single-worker focused run under fresh HOME, TMPDIR, org, state,
app, eval, and Claude/Codex/pi provider-scratch roots passed 83 tests across
provider execution, separation, preparation, qualification, reporting,
archive/cleanup, promotion, GitHub, scope, release, and future-soak preview
boundaries.

Before new provider evidence, current strict executed all 270 transformation
and eval tests successfully and remained non-zero for exactly `D-LIVE-01`,
`D-LIVE-02`, `D-LIVE-03`, `E-LIVE-01`, `E-LIVE-02`, `G-MET-01`,
`I-ROLE-01`, `I-ROLE-02`, and `I-ROLE-03`. Future-soak strict likewise ran
all 270 tests successfully and remained non-zero for exactly `I-LIVE-01`.
There was no unexpected pass or failure.

## Qualifier, archive, and continuation boundary

The candidate report SHA-256 is
`0b3718e0b9e4018ddc82488d80aef935df924ed5222a0f2453eeefc1f72c94d2`
and the immutable qualification JSON SHA-256 is
`d0a29dc5fc4f6e9a684a14dd27a96c833a5bd0d22b49a5abd54fd67f54fc7019`.
Both reproduced byte-for-byte. The verified 659-file
`sanitized-evidence/v3` archive is permanently retained at
`/Users/bikram/Build/cormidia-eval-archives/candidate-qualification-v1-20260715-0e41f4160bff-3bf2bd69-evidence-v2`;
its archive-manifest SHA-256 is
`2a0783874480853c9c1084010b93481144b478ed57a9de9eee3ff41e3581c7e4`.
The separately retained local archive-receipt SHA-256 is
`57b742f0e85551d295d27e4ea92d0e7913a00f871f692106166d7a586b42adf7`.
The manifest excludes provider scratch and raw L3 run data. Cleanup was
previewed only and was not executed.

No contract is promoted from this invalid campaign. The nine non-soak
provider contracts remain the current Phase 6 known-red set, while
`I-LIVE-01` alone remains known-red in `future_soak` and still requires the
separate authorized 48-hour real-time campaign. No production confirmation,
scheduler installation, production mutation, deployment, publication,
message, learning activation, or real-time soak occurred. Production evidence
cannot repair or rewrite this sandbox outcome.

The corrected descendant must qualify fresh exact-candidate adapter and
candidate campaigns. A qualified candidate may promote only `D-LIVE-01..03`,
`E-LIVE-01..02`, `G-MET-01`, and `I-ROLE-01..03`; current strict must then be
green. `I-LIVE-01` is neither passed nor current Phase 6 debt, and future-soak
strict must remain red for exactly that contract. Preview, virtual-soak
evidence, manufactured evidence, or bounded read-only production confirmation
cannot promote it. The canonical boundary is
[`docs/efficiency.md`](../../docs/efficiency.md#phase-6-qualification-scope).
