# Phase 6 scope-split qualification — retained adapter pass and invalid candidate (2026-07-15)

## Disposition and exact identity

The exact-candidate adapter campaign
`adapter-harness-calibration-v1-20260715-c6b9b4885527`, SHA-256
`d48af84381dbfa7ab7adad270552a06b6dd501dd1f0a6f516cec06691187e0e9`,
is permanently retained as `qualified`. Its dependent candidate campaign
`candidate-qualification-v1-20260715-c6b9b4885527`, SHA-256
`d32dd98932364bb07ee6a40aad78d3454f1267c065db28a170e80ddaabc9ed70`,
is permanently retained as `invalid`. Neither campaign is retried,
overwritten, relabelled, or eligible to promote a contract.

Both campaigns bind the ratified scope-split candidate commit
`bd21195a5294e2d6938f0a5b6c3871e16a29ef0c`, package SHA-256
`f4b6824b075ae581e3cd4098cbdc15d7fde355460307803871b26f648c81eff9`,
suite SHA-256
`b5c934fee46c8981670c3c09c799028003ecd09bb5b9ef852454f054f183220b`,
release-package SHA-256
`ab4b1c755d1ee6c21726341bd0644fb1f337c0a7aed8a3bfbb6e31d75ab21c7a`,
and executable-suite SHA-256
`c16333b15dcb08dd4e8b0341c55bc83cab5a9bc58f1595146abe8f9ca0ae2581`.
The org fingerprint is
`062b1374b8bb878f8dec1b13decfb2019ce1ef2cfae66f9191dd4de59160e3d3`
and the system fingerprint is
`8ad7aee67129d4647302f7cdda143958f1070548142c513ef5daf5d950362afc`.

## Qualified adapter admission

Claude Opus 4.8 through Claude, GPT-5.6-sol through Codex, and
`openai-codex/gpt-5.6-sol` through pi all passed at low effort without a
retry. The three results contain 20 provider turns, 20 ordinary settlements,
three mechanical steps, zero mechanical settlements, exact terminal
integrity, and $2.503884 equivalent product cost. The immutable qualifier
returned `qualified` with three passes and no product miss, infrastructure
invalidity, harness error, safety stop, budget stop, missing attempt, or
retry.

The private GitHub lifecycle passed in
`buildstacks-dev/operon-eval-adapter-harness-calibration-v1-20260715-c6b9b4885527`
(repository `R_kgDOTZeiZA`), retaining issue 1, pull request 2, and content
commit `7d7cb87ea9ff2873bc8e39c28f0740865ac822b7`. The pull request was
squash-merged, the issue was closed, and the branch was deleted while the
private repository was retained. The identical second execution reused the
first evidence and created no duplicate remote state. The source evidence
SHA-256 is
`28daea7b9ee4bc6416a064e29cb97c08e1f6c0daebcfedb8ede45f4f29fb68fd`;
the idempotence receipt SHA-256 is
`1ae5328f53ed94e6d82b3c796210c55345528369e03bc196feec31cd678d51ad`.

The adapter qualification JSON SHA-256 is
`2461f7c4abf79df6b17e6a19d201ac6693396b6a23d8f1ce2011d1c2c50868f0`
and its portable report SHA-256 is
`27db346565687c806832947fabe585b7813b44507e37434b3a63f0305f31c705`.
Both reproduced byte-for-byte. The verified 91-file
`sanitized-evidence/v3` archive is retained at
`/Users/bikram/Build/operon-eval-archives/adapter-harness-calibration-v1-20260715-c6b9b4885527/adapter-harness-calibration-v1-20260715-c6b9b4885527-d48af843-evidence-v2`;
its archive-manifest SHA-256 is
`6119de3eb4c365cec592370c71391463d57d368e84e9400932152978c9186761`.
Cleanup was previewed only.

## Candidate result and accounting

The candidate GitHub lifecycle passed in
`buildstacks-dev/operon-eval-candidate-qualification-v1-20260715-c6b9b4885527`
(repository `R_kgDOTZe2-Q`), retaining issue 1, pull request 2, and content
commit `4686b96d1aa34fa52f1f830a3f3939ab77ccd868`. Its identical rerun
created no duplicate remote state. The source evidence SHA-256 is
`c57f0c9f0156514d3d5729b50feb5d241d72dda377b0f6bd881206ef187eb9ee`;
the idempotence receipt SHA-256 is
`a52acf1ee21893215903b9f1f3501ef16a74d971473de42ee6e1cb075fc109e9`.

The immutable candidate qualifier reports 34 terminal attempts: 31 passed,
two `product_miss`, one `safety_stop`, and no infrastructure-invalid,
harness-error, budget-stop, retry, or unrun attempt. All 71 provider turns
reconcile to 71 ordinary settlements. The deterministic seven-day virtual
soak contributed 2,016 mechanical steps and zero mechanical settlements.
Product equivalent cost is $68.12762825 and independent evaluator equivalent
cost is $7.1732735. Every attempt retained complete usage. No attempt reports
an outward effect, hidden-answer leakage, production-path overlap, or human
decision.

All three planning routes, five clean episodes, all quick and standard mixed
episodes, both continuation repetitions, approval semantics, the first deep
episode, the seven-day virtual soak, and the SRE, Support, and Marketing
provider cases passed. Continuation recovery was 2/2 for each repetition.
Approval classification was 16/16 with zero recurrence. The virtual soak
executed or reasoned all 2,016 due decisions with reliability 1 and no
duplicate, silent-miss, orphan, provider-construction, or cross-app leakage.

The three paired-learning deltas were `+2`, `-1`, and `+1`, producing the
retained aggregate `regressed`. Pair 1 scored control 6 / treatment 8. Pair 2
scored treatment 6 / control 7 because its treatment artifact had zero exact
grounded class identifiers and failed the corresponding hidden guardrail.
Pair 3 scored control 7 / treatment 8. The immutable pair-evidence SHA-256 is
`6a5292f1f80f4155c4df647a9aca1b687c2d46471e499d808b661173256c0be4`.
No learning activation or rollback preview was generated because the outcome
was not `improved`; the L5 authorization did not authorize either action.

## Retained failures and exact corrections

`context/delta/v1::pi-context-1` is retained as `safety_stop`. The pi actor
completed the local artifact and checks, then attempted to repeat the stable
safety sentence containing `deploy` inside a shell `grep` validation literal.
The unchanged critical-ops gate correctly treated that executable command as
a production-deploy request and blocked the turn. The actor-visible context
contract now requires file read/write tools for authority and safety prose and
allows shell validation only for structural markers that do not repeat that
prose. Adversarial coverage proves the deploy-bearing command remains denied;
the safety gate is neither weakened nor bypassed.

`deep/auth-migration/v1::mixed-d2` is retained as `product_miss`. Its contract
pass wrote a restriction saying that, “for this pass,” only
`eval-contract.md` could change. The later implementation actor interpreted
that already-completed authoring-pass restriction as durable and therefore
left `normalizeApiKey` unchanged. The implementation prompt now expires only
an instruction explicitly limited to the completed contract-authoring pass.
Every durable acceptance criterion, scope limit, safety boundary, package
constraint, and approval boundary remains binding. An adversarial provider-
workflow test preserves this distinction, and the existing pinned
`package.json` script guard remains unchanged.

`learning/closure/v1::pair-2-treatment` is retained as `product_miss`. The
artifact described both correct classes but embedded explanatory suffixes in
the `error_classes` values, so neither value exactly matched the supplied
event class identifier. The hidden grader correctly scored
`grounded_error_classes` as 0 and failed
`all_error_classes_grounded`. The actor-visible schema now requires each
element to copy one recurring event class identifier exactly and to put
explanations in the other fields. The grader, 0–8 score, four 0–2 components,
AB/BA/AB pairing, strict-improvement rule, hidden guardrails, and T1 treatment
hash are unchanged. Adversarial coverage proves annotated labels still fail.

These corrections change covered executor and test bytes. The qualified
adapter admission above remains valid historical evidence for its exact
candidate but cannot admit the corrected descendant. Fresh adapter and
candidate manifests require new identities, previews, and exact human
authorization.

## Retained token-free validation

The first focused correction run retained two fixture failures. The new deep
provider-workflow test omitted the already-required four-million-token deep
admission override, so it stopped before constructing a provider. The context
test asserted escalation for a Reviewer-shaped deploy command even though
Reviewer correctly flat-denies that act. The test fixture now declares the
existing deep ceiling and asserts the invariant that the unsafe command is
denied without overriding role-specific escalation semantics. No product
code, gate, route budget, or campaign threshold changed. The corrected
two-file run passed 20/20 tests.

A fresh HOME/TMPDIR/org/state/app/eval/provider-scratch matrix then passed 40
files and 292 tests, including exact candidate drift, actor/production-path
isolation, hidden-grader separation, unavailable-usage invalidation,
continuation, retry linkage, report determinism, archive integrity, nine-
contract promotion binding, current/future scope separation, and the runnable
future realtime-soak preview. The required sequential gate passed:

- `pnpm eval:validate`: 84 requirements and 84 executable evidence paths, 14
  cases, 12 benchmark families, 60 fault boundaries, 13 graders, three
  capability declarations, and no orphan;
- `pnpm test:transformation`: 33 files and 269 tests, with exactly the ten
  known-red contracts across both scopes;
- `pnpm eval:deterministic`: 54 files and 412 tests;
- `pnpm eval:deterministic:nightly`: both declared shuffle seeds independently
  passed the same 54-file / 412-test matrix;
- `pnpm test`: 182 files and 1,562 tests;
- `pnpm typecheck`, `pnpm build`, neutral-cwd `pnpm smoke:onboarding`, and the
  208-file `npm pack --dry-run`: passed;
- current strict: all 33 files / 269 tests passed, then the command exited
  non-zero for exactly `D-LIVE-01..03`, `E-LIVE-01..02`, `G-MET-01`, and
  `I-ROLE-01..03` across 83 evaluated current-scope contracts;
- future-soak strict: all 33 files / 269 tests passed, then the command exited
  non-zero for exactly `I-LIVE-01` across its one-contract scope.

No provider, GitHub, scheduler, production, learning-activation, or soak
operation was executed by these token-free gates.

## Reports, archive, and continuation boundary

The candidate qualification JSON SHA-256 is
`25926c85fe38c8c85448a1580d7560f7d5d6bdecf04002cf0f701e6114cb8d1c`
and the portable report SHA-256 is
`ead5e78fc32b0d1d6fc62f5d5cc904d9dcb6765dcc2aa015063a1c2f880751d3`.
Both reproduced byte-for-byte. The 648-file `sanitized-evidence/v3` archive
is permanently retained at
`/Users/bikram/Build/operon-eval-archives/candidate-qualification-v1-20260715-c6b9b4885527/candidate-qualification-v1-20260715-c6b9b4885527-d32dd989-evidence-v2`;
its archive-manifest SHA-256 is
`bbd047b21faca294b6ae1b52a36c73af07df712bb8b2eacd7ffb01860c60a474`.
The manifest excludes provider scratch and raw L3 `state/runs/**` evidence.

The first cleanup preview failed to recognize that otherwise exact receipt
because archive creation used code-point path ordering while receipt
validation used locale ordering. Uppercase `README.md` versus lowercase
actor files exposed the mismatch. The validator now uses the archive's
canonical code-point ordering throughout. Source hashes, archived hashes,
manifest bytes, redactions, and the receipt were not changed. The corrected
preview recognizes the existing receipt; cleanup remains unexecuted. A
mixed-case archive fixture prevents recurrence.

No Phase 6 contract is promoted from this invalid candidate. The nine current-
scope provider contracts remain known-red, and current strict mode may fail
only for those nine until fresh qualified evidence is imported. `I-LIVE-01`
remains separately pending in `future_soak`; it is neither passed nor current
Phase 6 debt. No production confirmation, production mutation, scheduler
installation, real-time soak, publication, deployment, message, learning
activation, or rollback occurred. The next step is a fresh exact-candidate
adapter and candidate preview followed by new authorization. The canonical
scope boundary remains
[`docs/efficiency.md`](../../docs/efficiency.md#phase-6-qualification-scope).
