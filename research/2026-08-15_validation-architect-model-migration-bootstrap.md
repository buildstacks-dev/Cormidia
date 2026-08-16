# Validation Architect checked-model migration bootstrap

Date: 2026-08-15
Status: **ratified**
Human ratifier: `bikramgupta`
Ratification source: direct human instructions in the Cormidia implementation
session on 2026-08-15, with transition-consumer sequencing amendments
explicitly ratified in the same session on 2026-08-16

This record authorizes the isolated prerequisite tracked by
[#465](https://github.com/cormidia/Cormidia/issues/465): migrate Cormidia's
existing validation corpus into the checked
`validation-design/model/*.yaml` authority before RepositoryPort adoption in
[#451](https://github.com/cormidia/Cormidia/issues/451).

The migration is a product-wide `harness-revision` and a clean-break import
through the public `migrate({ kind: "legacy-catalog", ... },
"validation-architect/corpus/v1")` API. It preserves the current ratified
module map, product meaning, family and ticket identities, blockers,
implementation references, and protected-surface decisions. It does not
silently infer ownership, provenance, structures, controls, or planned tests.
Those mappings must be explicit, compiler-clean, and reviewable.

## Exact bootstrap dependency history

The earlier publication-block decision is narrowed for this migration only.
Cormidia vendors the upstream core package as a development dependency from:

- package: `validation-architect` `0.4.2`;
- upstream revision: `40a275038b81d624166ffcfa963453237173c8cd`;
- artifact: `vendor/validation-architect-0.4.2.tgz`;
- SHA-256:
  `7629b84fbd061dba78a420239eedd3a651718bf4d2b3f2a244fd2382f4b8c56d`;
- npm integrity:
  `sha512-4KiIU2Ol3N7ERvQqbTqg3yGxxUATwf6sDKyeoiGZ92l+wF2ni5l41qSjxMwDHch4gYZwzImJjXfWMi8LYJ9UKw==`;
- license: `LicenseRef-FSL-1.1-MIT`.

The tarball was produced twice, byte-identically, from that exact clean,
reviewed upstream merge with `pnpm pack`. No registry lookup, package
publication, tag, release, repository visibility change, or provider turn was
authorized or performed. Cormidia continues to consume only the core package.
The registry-source replacement in #431 Part C remains blocked on a separately
approved publication and exact published pin.

That 0.4.2 artifact was the exact dependency for preparation #466 and
transition-consumer #468. Exact cutover rehearsal then found two upstream
defects: ordinary reviewed prose containing `risk-review-gated` was
misclassified as credential-shaped, and the generated owner briefing omitted
lane title, kind, and authorization. A pre-normalized migration input or a
Cormidia-patched projection would each violate #465's public-contract boundary.

### Superseded corrective 0.4.3 candidate

The first owner-authorized correction selected:

- package: `validation-architect` `0.4.3`;
- upstream revision: `3c55a2ff1e357654002d10bd8168ee692d74bb42`;
- upstream PR: [validation-architect#47](https://github.com/cormidia/validation-architect/pull/47);
- artifact: `vendor/validation-architect-0.4.3.tgz`;
- SHA-256:
  `462e1fbaad83963eab778c40860347d2070fd619af64bc7c9da05370467e7e79`;
- npm integrity:
  `sha512-bErXwxC4NOlUMVwv+Ehi3Ol58fXUyhKKC7mIWSfFH0solQSHe+6O+yDoGaB3FohbTXdqwR5BbPBEb00oLdgJPg==`;
- license: `LicenseRef-FSL-1.1-MIT`.

Two independent candidate builds from the exact clean squash revision produced
byte-identical tarballs. Version 0.4.3 changes no method, model, policy,
compiler, result, or golden-set version and exposes no new Cormidia runtime
dependency. It corrects only the secret-token boundary and generated lane
projection required for byte-exact migration and fresh-reader review.

Before Cormidia committed that candidate, exact public-surface rehearsal found
one further upstream contract gap: 0.4.3 exposed the five Markdown projections
through public `compile()` but kept the canonical `compiler-report.json`
behind a private workspace compiler. Cormidia could not both obey #465's
public-API-only rule and persist that report without inventing a facsimile.
The owner therefore paused the 0.4.3 preparation in
[#465 comment 5308602145](https://github.com/cormidia/Cormidia/issues/465#issuecomment-5308602145),
and upstream issue
[#48](https://github.com/cormidia/validation-architect/issues/48) corrected the
public contract before any Cormidia 0.4.3 artifact was committed.

### Final corrective 0.4.4 cutover dependency

The final migration and cutover dependency is:

- package: `validation-architect` `0.4.4`;
- upstream revision: `28c6229bee1e1bfe63fffe8ca25dec3f81c0a6e9`;
- upstream PR: [validation-architect#49](https://github.com/cormidia/validation-architect/pull/49);
- artifact: `vendor/validation-architect-0.4.4.tgz`;
- SHA-256:
  `21694df668b5ec5620d9941a971bb91c6c9def0db2ec710cd83bcf8761e8dffb`;
- npm integrity:
  `sha512-gKAMgR64NIgUssybrr+Ut0ksot+2+2aeMOqlvkz1pD7ekKZsAU95RckJqKIFpWDoF5oFDdmM/D1o5JDk2oBsvQ==`;
- license: `LicenseRef-FSL-1.1-MIT`.

Two independent clean detached builds from the exact squash revision produced
byte-identical 266,684-byte core tarballs with 124 entries. Version 0.4.4
retains 0.4.3's secret-token and lane-projection corrections and additively
exposes the established canonical compiler report as public `compile()` data
and exact persistable bytes. The CLI `compile --write` generates exactly five
Markdown projections plus that report: six generated artifacts total. It
changes no method, model, policy, compiler, result, golden-set, campaign, or
provider contract and introduces no Cormidia runtime dependency.

The two qualifying builds used only existing local dependency bytes and made
no registry lookup or request. A discarded preliminary `pnpm install
--offline` process nevertheless attempted DNS for missing optional packages;
the sandbox denied every lookup, the process was aborted, and no bytes from
that checkout entered either qualifying artifact. No registry request
succeeded. No publication, tag, release, visibility change, provider turn, or
live campaign was authorized or performed. Cormidia still consumes only the
upstream core package as an exact development dependency.

The 0.4.2 pin superseded the unpublished 0.3.0 migration bootstrap and the
provisional 0.4.0 and 0.4.1 artifacts. Version 0.4.2 supplies the reviewed
legacy-to-logical migration ledger, complete policy mapping,
backlog-status-aware pending implementation closure, checked-model-derived
repository facts, and bounded legacy alias bridge required by #465. It does
not broaden Cormidia's production dependency authority.

## Authority and cutover

The owner first ratified the two-PR self-reference exception recorded in #465
and upstream issue #44. The dependency preparation PR pinned this exact
artifact and installed the upstream transition-aware alias; it was
squash-merged as Cormidia #466 at
`2b7d0bbb180b80dc37b3768f9182be5893f23ef2`.

Pre-cutover verification then proved that Cormidia's own catalog-drift,
release-evidence, campaign-binding, revision-closure, policy-pin, and legacy
fixture consumers still selected the root legacy policy or manifest. Those
consumers could not change in the final `validation-design/`-only PR because
any non-design commit makes its future squash SHA the required but unknowable
`product.revision`. On 2026-08-16 the owner explicitly ratified replacing the
two-PR assumption with exactly three independently reviewed squash PRs and
broadening the added preparation PR from the first catalog detector to every
executable legacy-authority consumer. The binding issue addenda are
[#465 comment 5306753202](https://github.com/cormidia/Cormidia/issues/465#issuecomment-5306753202)
and
[#465 comment 5306817736](https://github.com/cormidia/Cormidia/issues/465#issuecomment-5306817736).

The same review exposed Cormidia-specific operational fields which upstream
0.4.2 intentionally does not model. The owner then supplied standing human
authorization for the remaining decisions needed to complete the original
series. The resulting ratified authority-domain split, exact host-policy scope,
field-disposition ledger, protected-surface authority, and preserved external
prohibitions are recorded in
[`2026-08-16_validation-authority-domain-split.md`](2026-08-16_validation-authority-domain-split.md).

The transition-consumer preparation PR keeps the root legacy corpus as sole
authority while no checked-model file exists. Once any checked-model file
exists, each migrated consumer selects canonical model facts or fails closed;
partial/corrupt model state, stale projections, dual root authority, and
archive fallback are all non-green. Its human squash merge fixes the final
product revision that the checked model originally would have named.

Exact 0.4.2 rehearsal after #468 exposed the two upstream defects above and a
stale root routing instruction that the final design-only PR cannot edit. The
owner ratified a fourth, corrective preparation PR in
[#465 comment 5308571011](https://github.com/cormidia/Cormidia/issues/465#issuecomment-5308571011).
The 0.4.3 public-surface rehearsal then exposed the private-only compiler-report
gap and the owner ratified the 0.4.4 upstream-first correction in
[#465 comment 5308602145](https://github.com/cormidia/Cormidia/issues/465#issuecomment-5308602145).
The same fourth Cormidia preparation PR now pins exact 0.4.4, preserves the
transition consumers, and corrects the root instruction. Its future human
squash merge, not #468, fixes the final `product.revision`.

The authority-cutover PR starts from that exact corrective-preparation squash
revision, uses it as `product.revision`, and changes only `validation-design/`
authority, projections, migration evidence, and design-local maintained instructions.
Its human squash merge is the cutover: complete model-file presence makes the
deprecated alias execute checked-model closure without legacy fallback. The
legacy policy, catalog, YAML manifest, and authored backlog then survive only
as compiler-generated views or historical migration inputs, never parallel
authority.

Rollback of authority is one ordinary Git revert of the authority-cutover
squash merge; model absence restores every incumbent legacy consumer through
the transition bridge. Full bootstrap rollback, if separately desired,
reverts the corrective preparation squash, the transition-consumer squash, and
then dependency preparation #466.
No source artifact is rewritten in place by the upstream migration API.

This decision authorizes no RepositoryPort, TurnPort, campaign, live test,
provider spend, corpus publication, package publication, release, deployment,
or change to `TASTE.md`, `roles.yaml`, `pipelines.yaml`, or `prompts/**`.
The 2026-08-16 domain-split record supersedes only this record's former
`docs/PURPOSE.md` exclusion for the exact authority-boundary correction.
