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

### Intermediate corrective 0.4.4 preparation dependency

The fourth preparation PR used:

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

Cormidia squash-merged that fourth preparation as
[#469](https://github.com/cormidia/Cormidia/pull/469) at
`c6be27f8262fecbeaf87800b1feeca3f4cc63794`. Exact fresh-reader rehearsal then
found two remaining upstream contract gaps which Cormidia could not repair in
the design-only cutover without inventing data: `planned-trace.md` omitted the
complete source registry and protected structure fields, while reviewed legacy
ticket dependencies and per-output split status were not preserved in the
canonical backlog.

### Superseded corrective 0.4.5 cutover dependency

The previous migration and cutover dependency was:

- package: `validation-architect` `0.4.5`;
- upstream revision: `5949f6b1be3f3b22c47c3cf532e33d529a468291`;
- upstream issue: [validation-architect#50](https://github.com/cormidia/validation-architect/issues/50);
- upstream PR: [validation-architect#51](https://github.com/cormidia/validation-architect/pull/51);
- artifact: `vendor/validation-architect-0.4.5.tgz`;
- SHA-256:
  `2a2e59324272aeb5d3ba1aed9da4a42fb0682f391fa82ee9dfa1c8cbff8294eb`;
- npm integrity:
  `sha512-3sHA9XQ80l+05yt5lQTv6RoXNahoY1LOv0edAwPza8oCQ02kpurkFlT7hzLXwQrQHC9F841R3ZJDnHENQp1E/Q==`;
- license: `LicenseRef-FSL-1.1-MIT`.

Two independent clean detached builds from the exact squash revision produced
byte-identical 267,873-byte core tarballs with 124 entries. Version 0.4.5 adds
the deterministic source registry and complete product-structure routing to
the public planned trace, preserves explicit reviewed ticket dependencies and
per-output split status during migration, and rejects malformed, duplicate,
missing, self-referential, or cyclic dependencies. Method, model, policy,
compiler, result, golden-set, campaign, provider, and Cormidia host-policy
version identities remain unchanged; the public generated projection and
legacy-migration review behavior change additively. It introduces no Cormidia
runtime dependency.

Both qualifying 0.4.5 builds used only existing local dependency bytes and made
no registry lookup or request. Later Cormidia `pnpm install --offline
--frozen-lockfile` attempts nevertheless attempted registry DNS while checking
missing optional packages; the sandbox denied every lookup with `ENOTFOUND`,
the retries were aborted, and no fetched byte entered either qualifying
artifact. No registry request succeeded. No publication, tag, release,
visibility change, provider turn, or live campaign was authorized or performed.
Cormidia continues to consume only the upstream core package as an exact
vendored development dependency.

### Superseded corrective 0.4.6 cutover dependency

Fresh reader review of the staged cutover found one last loss in the public
legacy-migration review surface: split family outputs could not carry distinct
reviewed oracle and risk semantics. The cutover-era dependency was:

- package: `validation-architect` `0.4.6`;
- upstream revision: `52a7b26b5b4de934612640c3d47ba7c738596ece`;
- upstream PR: [validation-architect#52](https://github.com/cormidia/validation-architect/pull/52);
- artifact: `vendor/validation-architect-0.4.6.tgz`;
- SHA-256:
  `1e396fdb7fe2e6ea2e479628e344c6283a5ae7f4cb95a86dfba8601a7cfd66c5`;
- npm integrity:
  `sha512-6wRhOH8+80Knr1H7FTYYjAZcpGpG4ZiveCXSv6ddk1eaab11Rd5tiFr0l3CSR1TcTw/lSVEjXtV2pRVOYpcFHA==`;
- license: `LicenseRef-FSL-1.1-MIT`.

Two independent clean detached builds from the exact human squash produced
byte-identical 268,051-byte core tarballs with 124 entries. Version 0.4.6 adds
optional non-empty per-output `oracle` and `risk` review fields, preserves
those distinct semantics in migrated family outputs, and retains the exact
legacy value whenever an override is omitted. Empty, whitespace, or malformed
values refuse. Package method `0.8.0` and the model, policy, compiler, result,
golden-set, campaign, provider, and Cormidia host-policy version identities are
unchanged; no Cormidia runtime dependency is introduced.

The accompanying Cormidia preparation also closes the already-ratified
F-PT-008 production seam: every TTL-sensitive org-aware store construction
receives the parsed `org.approval_policy` from its validated `AppsFile`.
An actual `cormidia approvals` detector proves non-default 2-hour grant and
1-hour pending lifetimes, while a seeded default-only construction proves the
old decorative-configuration failure is observable. The ratified defaults
remain approval grants 48 hours, pending approval items 24 hours, and ordinary
objective grants independently 24 hours.

The same preparation records the owner's 2026-08-16 clarification of the
already-ratified F-PT-006 content-identity rule. Canonical inbox identity now
removes both transport `filename` and producer `id` before hashing; every
other payload field remains identity-bearing. A retry that mints a fresh id
therefore collapses, while a non-`id` content change remains a distinct event.
Upgrade handling binds legacy filename marks and pre-clarification
id-inclusive bare/per-role content marks to the clarified group independent of
file order, so the correction cannot replay work already consumed. This is a
Cormidia product correction with its own red-capable B-13 controls; it does not
change the Validation Architect package contract or the authority-domain split.

Both qualifying builds used only the exact installed dependency closure with
network access disabled. They made no registry lookup or request. No
publication, tag, release, visibility change, provider turn, or live campaign
was authorized or performed. Cormidia continues to consume only the upstream
core package as an exact vendored development dependency.

### Current 0.4.16 upgrade dependency

The [#483](https://github.com/cormidia/Cormidia/issues/483) upgrade replaced
the 0.4.6 cutover artifact with upstream 0.4.16, adopting the ten
pre-publication corrections 0.4.7–0.4.16 that tighten the compiler and extend
the corpus schema. The exact current dependency is:

- package: `validation-architect` `0.4.16`;
- upstream revision: `e9c4b61b1e5326e9a6830e2741a81c294b24c2f1`;
- upstream issues/PRs: validation-architect#53–#62 and #75–#92
  (VA-ENF-001…008, VA-MTH-001/002, campaign consolidation);
- artifact: `vendor/validation-architect-0.4.16.tgz`;
- SHA-256:
  `924cf308712b89bd8df61a77f088be773a6a6399c77ee605285f3261d1baea3e`;
- npm integrity:
  `sha512-AojU+hAgHjwgJnoPQmgjjNE6mG/+iB9pWRFUrzln5yXWrtzljkOP90/NthKMbRxCJugmmIEBCvWYjGaN8dWdqA==`;
- license: `LicenseRef-FSL-1.1-MIT`.

Two independent clean detached builds from the exact human squash produced
byte-identical 284,673-byte core tarballs with 127 entries. Version 0.4.16
raises the method contract to `0.8.9` and makes the following checked-model
obligations fail-closed: declared negative controls of landed test-lane
families must be implemented by an inventory test (`CONTROL_UNIMPLEMENTED`);
every declared boundary failure mode must be covered by a named family or
pruned by name (`MODEL_FAILURE_MODE_UNCOVERED`); contract structures must
declare typed `error_criteria`; the policy must designate at least one
per-commit-covered smoke journey, declare all four case-sourcing channels,
and give every active test lane a wall-clock budget. It additively models
finding-to-claim linkage (`kind: finding` sources plus ticket `finding_ref`),
family `purpose` marks, per-repo spec-detection conventions (absent block =
exact jest-vitest behavior, byte-identical identity), the opt-in recurring
negative-control falsifiability sweep template, and consolidates the campaign
host into the design package — Cormidia imports none of the removed campaign
surfaces. No 0.4.7–0.4.16 change alters `MODEL_REVISION_STALE` or
`INVENTORY_REVISION_MISMATCH` semantics: recorded-revision staleness remains a
red `traceability_broken` finding, so F-PT-040's post-squash-merge re-bind
posture is unchanged (recorded on the finding). No Cormidia runtime dependency
is introduced.

Both qualifying builds used only existing local dependency bytes and made no
registry lookup or request; `validation-architect` remained unpublished at
npm on 2026-08-19 (registry 404), so the exact vendored development
dependency continues. No publication, tag, release, visibility change,
provider turn, or live campaign was authorized or performed.

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
The same fourth Cormidia preparation PR pinned exact 0.4.4, preserved the
transition consumers, and corrected the root instruction; it was squash-merged
as #469 at `c6be27f8262fecbeaf87800b1feeca3f4cc63794`.

Fresh-reader review after #469 exposed the source-registry, full-structure,
ticket-dependency, and split-status gaps described above. The owner's standing
session authorization covered the upstream-first correction, and the owner
explicitly reviewed, marked ready, and squash-merged upstream #51. Cormidia
then pinned exact 0.4.5 without adding any model sentinel and squash-merged
that preparation as #470 at
`3624f47e282e4dc9e5d32d5992cf5cef5c142e43`.

Full offline testing of the final cutover staging then exposed two transition-
consumer defects. Three release-authority controls still loaded the root
legacy policy as fixture input, and revision closure treated canonical
host-registry IDs as if they were identical to their checked-model structure
dispositions. Restoring the root file would violate the cutover; changing host
policy or inventing duplicate model structures would conflate the two
authority domains; repairing tests in the final PR would violate its
`validation-design/`-only boundary. A narrow final-consumer preparation made
the legacy controls self-contained and recorded one total, source-backed
host-to-model ID crosswalk without changing either authority. It squash-merged
as #471 at `7d68ded4813c665ce10379539f741f062dba3572`.

The reader protocol on that staging exposed the remaining per-output family
semantic loss. Upstream #52 added the narrow 0.4.6 review surface; this
preparation pins its exact squash and artifact, reconciles the already-ratified
F-PT-008 48-hour approval-grant default (pending approvals and objective grants
remain independently 24 hours), and corrects the simulated provider-family
interpretation's false owner attribution. It also implements the owner's
2026-08-16 F-PT-006 identity-field clarification with upgrade-safe legacy
consumption migration. Its future human squash merge, not
#471 or any predecessor, fixes the final `product.revision`.

The authority-cutover PR starts from that exact 0.4.6 preparation
squash revision, uses it as `product.revision`, and changes only
`validation-design/` authority, projections, migration evidence, and
design-local maintained instructions. It is the seventh reviewed squash PR in
the complete bootstrap sequence.
Its human squash merge is the cutover: complete model-file presence makes the
deprecated alias execute checked-model closure without legacy fallback. The
legacy policy, catalog, YAML manifest, and authored backlog then survive only
as compiler-generated views or historical migration inputs, never parallel
authority.

Rollback of authority is one ordinary Git revert of the authority-cutover
squash merge; model absence restores every incumbent legacy consumer through
the transition bridge. Full bootstrap rollback, if separately desired, first
reverts the authority cutover and then, newest-first, the 0.4.6 preparation,
#471, #470, #469, #468, and #466. A predecessor is never reverted while a
dependent descendant remains.
No source artifact is rewritten in place by the upstream migration API.

This decision authorizes no RepositoryPort, TurnPort, campaign, live test,
provider spend, corpus publication, package publication, release, deployment,
or change to `TASTE.md`, `roles.yaml`, `pipelines.yaml`, or `prompts/**`.
The 2026-08-16 domain-split record supersedes only this record's former
`docs/PURPOSE.md` exclusion for the exact authority-boundary correction.
