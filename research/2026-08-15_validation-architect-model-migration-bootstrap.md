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

## Exact bootstrap dependency

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

This 0.4.2 pin supersedes the unpublished 0.3.0 migration bootstrap and the
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
product revision that the checked model must name.

The authority-cutover PR starts from that exact transition-consumer squash
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
reverts the transition-consumer squash and then dependency preparation #466.
No source artifact is rewritten in place by the upstream migration API.

This decision authorizes no RepositoryPort, TurnPort, campaign, live test,
provider spend, corpus publication, package publication, release, deployment,
or change to `TASTE.md`, `roles.yaml`, `pipelines.yaml`, or `prompts/**`.
The 2026-08-16 domain-split record supersedes only this record's former
`docs/PURPOSE.md` exclusion for the exact authority-boundary correction.
