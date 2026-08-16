# Validation Architect checked-model migration bootstrap

Date: 2026-08-15
Status: **ratified**
Human ratifier: `bikramgupta`
Ratification source: direct human instruction in the Cormidia implementation
session on 2026-08-15

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

The owner ratified the self-reference exception recorded in #465 and upstream
issue #44: this migration lands as exactly two independently reviewed squash
PRs. The preparation PR pins this exact artifact and installs
transition-aware package/check tooling while the legacy corpus remains sole
authority. Its squash merge fixes the product revision that the checked model
must name.

The authority-cutover PR starts from that exact preparation squash revision,
uses it as `product.revision`, and changes only `validation-design/` authority,
projections, migration evidence, and design-local maintained instructions.
Its human squash merge is the cutover: complete model-file presence makes the
deprecated alias execute checked-model closure without legacy fallback. The
legacy policy, catalog, YAML manifest, and authored backlog then survive only
as compiler-generated views or historical migration inputs, never parallel
authority.

Rollback of authority is one ordinary Git revert of the authority-cutover
squash merge; model absence restores the incumbent legacy bridge. Full
dependency rollback, if separately desired, is a second ordinary revert of the
preparation squash. No source artifact is rewritten in place by the upstream
migration API.

This decision authorizes no RepositoryPort, TurnPort, campaign, live test,
provider spend, corpus publication, package publication, release, deployment,
or change to `TASTE.md`, `roles.yaml`, `pipelines.yaml`, `prompts/**`, or
`docs/PURPOSE.md`.
