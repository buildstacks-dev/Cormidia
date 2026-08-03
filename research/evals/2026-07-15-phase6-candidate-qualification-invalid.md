# Phase 6 candidate qualification — retained invalid campaign (2026-07-15)

## Disposition

Campaign `candidate-qualification-v1-20260715-ac31a40c7d61`, SHA-256
`b4e18a288a897cab16292bdb92618d3c2af538944c8655ef37554c08d316a098`,
is permanently retained with outcome `invalid`. It evaluated candidate commit
`f288e9f4d9cd4b8f329d4107189aedd9dee01c53`; its package, executable-suite,
org, and system identities remain those in the immutable campaign manifest.
It must not be retried, overwritten, relabelled, discarded, or used to promote
a contract.

The campaign admitted 22 attempts before the live executor stopped fail
closed: 11 passed, eight were genuine `product_miss` results, and three were
`infra_invalid`. All later continuation, approval, learning, virtual-soak, and
standing-role repetitions remained incomplete. The read-only qualifier
preserves every missing attempt and denominator rather than treating the
unfinished tail as a skip or pass.

## Prerequisite adapter admission

The exact candidate first passed fresh adapter admission under
`adapter-harness-calibration-v1-20260715-ac31a40c7d61`, SHA-256
`b72ef578cd98bda30acc6e84923a3f36fcab563d85038ac9c10a51831efbe7df`.
Claude, Codex, and pi passed three of three adapter results without a retry:
20 provider turns equal 20 ordinary settlements, mechanical settlements are
zero, terminal integrity is exact, and equivalent cost was $2.36184225. The
portable report SHA-256 is
`105e603c772f3dde28bf65584f3087e074f97a4257616d079cf498023b8dd66c`.

Its private GitHub exercise used issue 1 and pull request 2 in
`buildstacks-dev/cormidia-eval-adapter-harness-calibration-v1-20260715-ac31a40c7d61`.
The identical second execution reused the content-bound evidence, with source
evidence SHA-256
`9d41c82727281b83866b9b811dd9201545a4f69022fa39cf3e439e1825298232`.
The verified `sanitized-evidence/v3` archive is retained at
`/Users/bikram/Build/cormidia-eval-archives/adapter-harness-calibration-v1-20260715-ac31a40c7d61/adapter-harness-calibration-v1-20260715-ac31a40c7d61-b72ef578-evidence-v2`;
its archive-manifest SHA-256 is
`d5cc38fadf0a7fa8c9115ef362fc13b71d20db806f23a86de9013d0eafc0d3d7`.
Cleanup was previewed only.

## GitHub exercise and accounting

The candidate GitHub exercise used issue 1 and pull request 2 in
`buildstacks-dev/cormidia-eval-candidate-qualification-v1-20260715-ac31a40c7d61`.
It exercised the declared private-repository lifecycle, squash-merged the
temporary pull request, closed the issue, deleted only the temporary branch,
and retained the repository. The identical rerun was idempotent and reused
source evidence SHA-256
`f66a0fd451381229879fd14a1ced269c950e24252e42dab4f451817015b97f3b`.

The provider evidence reconciles 42 provider turns to 42 ordinary
settlements. Mechanical steps and mechanical settlements are both zero.
Product equivalent cost is $35.684715 and evaluator equivalent cost is
$1.711014, reported separately. No attempt reports an outward effect or
production-path overlap.

## Retained product misses

The eight product misses are not retried:

- three quick episodes wrote a root-anchored `/.pnpm-store/` rule instead of
  the exact repository-local `.pnpm-store/` ignore entry;
- all three standard episodes preserved repeated underscores instead of
  collapsing them while `preserveUnderscores` was enabled;
- both deep episodes removed or renamed the existing `normalizeApiKey`
  export while implementing the migration.

The corrected candidate makes these compatibility constraints explicit in
the actor-visible task without exposing hidden answers. Independent
adversarial tests reject the root-anchored rule, repeated-underscore output,
and renamed-export near misses. Hidden graders, thresholds, routes, model
assignments, denominators, and safety rules are unchanged.

## Retained infrastructure and harness evidence

The first quick planning probe stopped at its tool-call cap and retained
partial usage of 5,968,624 input tokens, above the quick-route ceiling. Its
one declared infrastructure retry is separately linked and passed with
814,618 input tokens. Both the invalid original, the successful retry, and the
original route-bound miss remain in the qualifier.

Both pi context-delta repetitions are infrastructure-invalid because the
external Claude account rejected third-party usage until the account has
additional “extra usage.” This is an external account blocker. The model and
assignment are not substituted, and these attempts are not converted into
product results.

The first continuation repetition exposed a harness defect after its provider
artifacts were durable: unavailable provider token totals caused result
validation to throw before an attempt result could be committed. The campaign
therefore remains incomplete from that point onward. The corrected harness
persists unavailable usage as an invalid measurement, records the exact
missing cost/input/output quality fields, reconciles any observed turns, and
does not manufacture zero-valued denominators. An already-invalid account or
transport result retains its original typed cause while also retaining the
missing-usage denominator. Focused adversarial tests cover both paths and the
qualifier rejects unavailable usage as an invalid population.

## Qualifier and archive

The immutable qualification JSON has SHA-256
`bc7cb85e90ba7ffa1ef70b0c45351b3732b974142156864be21b210d5f69aaae`.
The byte-stable portable report has SHA-256
`449ab765d0c65b9e9d758f7370552ef2f21cc438bc71f82e03eb28c7b28df580`.

The verified 370-file `sanitized-evidence/v3` archive is permanently retained
at
`/Users/bikram/Build/cormidia-eval-archives/candidate-qualification-v1-20260715-ac31a40c7d61/candidate-qualification-v1-20260715-ac31a40c7d61-b4e18a28-evidence-v2`.
Its archive-manifest SHA-256 is
`dbffcf11d88af5913cc84f76bc48ffa505348985f0fd38657c1e8cd8435f6521`.
The manifest excludes `provider-scratch/**` and raw L3 `state/runs/**` and has
no extra, missing, forbidden, source-mismatched, or archive-mismatched file.
Cleanup was previewed only and was not executed.

## Continuation boundary

Covered evaluator, task, grader-manifest, and test bytes change in the
corrected candidate, so the valid adapter admission above cannot be reused for
the next candidate. A fresh adapter campaign and a fresh candidate campaign
must each be prepared and separately authorized. Until a new terminal
candidate campaign qualifies, none of `D-LIVE-01..03`, `E-LIVE-01..02`,
`G-MET-01`, or `I-ROLE-01..03` may be promoted. `I-LIVE-01` additionally
requires the separately authorized 48-hour real-time soak and remains
known-red regardless of candidate qualification.

No production confirmation, scheduler installation, real-time soak, learning
activation, deployment, publication, message, or production mutation was
performed. Production evidence cannot repair or rewrite this sandbox outcome.

## Retained token-free validation misses

The first fresh-root focused wrapper completed all 182 tests successfully but
then exited non-zero because it assigned zsh's reserved `status` variable. The
corrected wrapper changed only that local variable name; a new fresh-root run
passed the same 31 files and 182 tests with exit zero.

The first complete offline-suite run retained one timeout in the
invalid-calibration accounting integration test. The full filesystem-backed
calibration and settlement exercise completed in 5.219 seconds under
full-suite contention, just beyond Vitest's inherited five-second default. The
test now declares the same bounded 15-second integration timeout already used
by the larger provider-workflow integration case. Its provider construction,
unavailable-usage result, exact-cost reconciliation, attempts, and assertions
are unchanged; this is not a campaign retry or a loosened qualification cap.

The corrected gate passed evaluation validation (84 requirements, 14 cases,
12 benchmark families, 60 fault boundaries, 13 graders, three capabilities),
32 transformation files and 257 tests, 53 deterministic files and 400 tests
under the ordinary and both shuffled orders, 181 full-suite files and 1,548
tests, typecheck, build, neutral-cwd onboarding, and the 208-file package
dry-run. Strict transformation execution passed all 257 tests and exited
non-zero only for the exact ten retained provider/L6 contracts. No sandbox was
rerun because no production source, packaged runtime behavior, onboarding, or
CLI surface changed.
