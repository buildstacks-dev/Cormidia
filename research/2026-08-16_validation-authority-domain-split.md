# Validation authority domain split

Date: 2026-08-16
Status: **ratified**
Human ratifier: `bikramgupta`
Issues: [#465](https://github.com/cormidia/Cormidia/issues/465),
[#451](https://github.com/cormidia/Cormidia/issues/451)

## Ratification

During the Validation Architect redesign implementation session, executable
consumer review found that the planned deletion of the legacy
`validation-design/validation-policy.yaml` would break Cormidia release,
campaign, revision-catalog, L-ACC, policy-pin, and drift checks. Validation
Architect 0.4.2 intentionally has no fields for several Cormidia-specific
operational facts those consumers read. Parsing prose from the checked model,
reading the migration archive at runtime, or keeping the legacy mixed policy as
a second authority would each invent or duplicate a contract.

The owner supplied the following attributable standing direction on
2026-08-16:

> I give you standing authorization to move forward on any authorization you
> need from me/human in this session. Hope it unblocks you and you can focus on
> completing the whole original task.

That direction ratifies this domain split, the corresponding protected-surface
updates including `docs/PURPOSE.md`, and the broadened transition-consumer PR.
It does not authorize a live, eval, soak, or L-ACC campaign; provider spend;
package publication; tags or releases; deployment; repository visibility
changes; or agent self-merge.

## Decision

1. The complete eight-file graph under `validation-design/model/` is the sole
   Validation Architect machine authority once any one of those exact files is
   present. A partial graph fails closed. No checked-model consumer may fall
   back to legacy or migration-archive input.
2. Until cutover, zero model files selects the incumbent
   `validation-design/validation-policy.yaml` and catalog as the temporary sole
   Validation Architect authority. The final cutover deletes those root legacy
   inputs and retains their bytes only under `validation-design/migration/legacy/`
   as historical migration evidence.
3. `docs/qualification/host-policy.yaml`, schema
   `cormidia/qualification-host-policy/v1`, is the sole Cormidia source-app
   editable qualification and operational policy. It owns only facts that upstream
   0.4.2 deliberately does not model: the exact RQ-1 L3 denominator and
   conditional set, admitted skipped-test finding identities, Cormidia campaign
   spend bounds, L-ACC axis-score semantics and release relationship, the
   active revision-catalog registry/content pin, and canonical campaign-binding
   paths.
4. The final checked graph uses one dedicated active, blocking L3 test lane for
   the host policy's exact required-plus-conditional RQ-1 denominator. Its
   release-qualification trigger does not sit on a broader L3 lane: every
   non-pruned family assigned to the dedicated lane is in that denominator,
   and every denominator family is assigned to it. Other live and blocked L3
   families remain on a non-release lane. This makes the host selection and
   the model's lane semantics agree instead of interpreting a broad lane trigger
   as an implicit subset.
5. The two authorities compose tighten-only and neither overrides the other.
   A disagreement is a refusal. Existing compiled exact-case and spend safety
   floors remain defense-in-depth: they may reject host-policy drift but may
   never substitute different policy or silently override it. The host policy
   is unrelated to the per-app build-gate `.cormidia/policy.yaml`. The
   standalone GitHub-smoke and launchd-proof campaign kinds retain their prior
   effective 2-turn/$5 ceilings but now have separate exact scopes; they never
   borrow the changed-adapter scope. The release scope explicitly includes
   launchd alongside all adapters, GitHub, and the unattended profile.
6. Release and triggered-campaign evidence bind the candidate commit, the exact
   selected Validation Architect authority bytes, and the host-policy bytes.
   Checked-model binding hashes the ordered exact eight-file path/digest set;
   legacy binding hashes the one temporary legacy policy. The migration archive
   is never a runtime input.
7. The formerly planned two-PR bootstrap is six reviewed squash PRs:
   dependency preparation (#466, merged), transition consumers (#468, merged),
   the exact 0.4.4 corrective preparation ratified through
   [#465 comment 5308571011](https://github.com/cormidia/Cormidia/issues/465#issuecomment-5308571011)
   and its upstream-first compiler-report correction in
   [#465 comment 5308602145](https://github.com/cormidia/Cormidia/issues/465#issuecomment-5308602145)
   (#469, merged), the exact 0.4.5 fresh-reader/migration-fidelity preparation
   after upstream [#51](https://github.com/cormidia/validation-architect/pull/51)
   (merged as Cormidia #470 at
   `3624f47e282e4dc9e5d32d5992cf5cef5c142e43`), a narrow final-consumer
   preparation, then the `validation-design/`-only authority cutover. Full
   cutover staging proved three release-authority transition controls still
   loaded the root legacy policy instead of self-contained fixture bytes, and
   revision closure still treated canonical host-registry IDs as identical to
   their checked-model structure dispositions. The final PR cannot repair
   tests outside `validation-design/`, restore the retired root authority, or
   conflate those two ID domains. The final model names the final-consumer preparation squash SHA as `product.revision`.

The crosswalk is a representation disposition, never an override: `M17` maps
to the exact `SM-ROADMAP` and `SM-VALIDATION` lifecycle pair;
`CORMIDIA-C-B20-001`, `CORMIDIA-C-B21-001`, and `CORMIDIA-C-B22-001` map to
`CONTRACT-B-20`, `CONTRACT-B-21`, and `CONTRACT-B-22` respectively;
`CORMIDIA-C-OPBATCH-001` maps to `CONTRACT-OP-BATCHING`; and
`CORMIDIA-C-OPVALIDATION-001` maps to
`CONTRACT-OP-VALIDATION-LIFECYCLE`. The other six registry IDs map exactly to
themselves. An absent or partial target refuses under the canonical host ID.

The 0.4.3 correction changed neither the authority domains nor any host-policy
ownership above. It only permitted exact archived prose to migrate without a
credential false positive and made the upstream-generated owner briefing show
the already-reviewed lane authorization. The 0.4.4 correction was likewise
domain-neutral: it made the established canonical compiler report available
through public `compile()` and `compile --write`, removing the need for a
Cormidia facsimile or private import. The final 0.4.5 correction is also
domain-neutral: it exposes already-reviewed source and structure facts to
fresh readers, preserves explicit dependency and split-status facts, and
rejects invalid dependency graphs. All compose-tightly, no-fallback,
exact-byte binding, and external-action prohibitions remain unchanged.

## Legacy top-level field disposition

No legacy top-level field is silently dropped or copied wholesale. `Model`
means a fact represented in the upstream checked graph; `host` means the
separate Cormidia policy above; `retired` means an authored registry or
transition device replaced by a named checked detector or source of truth.

| Legacy field | Disposition after cutover |
| --- | --- |
| `schema_version` | Retired; every model file and the host policy carry their own namespaced schema. |
| `scope`, `product` | Model: `model/project.yaml`. |
| `campaign` | Model/source provenance plus this dated decision record; it is not runtime policy. |
| `design_status`, `ratified_on`, `ratified_by` | Model/source provenance and attributable decision records. |
| `active_revision` | Split: graph identities are model structures/sources; the executable revision registry and catalog content pin are host policy. |
| `default_tier`, `tier_model` | Model project criticality and reasoned structure overrides. |
| `artifacts` | Retired registry; the compiler's exact model/view inventory and drift detector replace it. |
| `implementation_root` | Model family planned-test paths plus the observed test-inventory walk. |
| `protected_paths` | Retired transition registry; repository instructions and deterministic path/authority checks enforce current protection. |
| `coexistence` | Retired at cutover; retained only in migration evidence and this rollback record. |
| `invariants` | Model structures. |
| `campaign_invariants` | Model structures, controls, and families; authored acceptance rationale remains non-machine provenance. |
| `layers` | Model policy lanes/layers and model families; Cormidia-only spend bounds are host policy. |
| `verdict_semantics` | Upstream public result contract for completeness/verdict; only the Cormidia L-ACC axis-score table remains in host policy. |
| `l_acc_lane` | Model structures/policy/families/controls plus authored `acceptance/` rationale; axis scoring and its outside-RQ-1 relationship are host policy. |
| `unattended_test_mode_profile` | Model structures/contracts/families plus runtime configuration and guardrail tests. |
| `release_gating` | Model release lane/families plus the exact Cormidia RQ-1 denominator, skipped-test admission, and campaign bounds in host policy. |
| `ci` | Model execution lanes plus `.github/workflows/core-checks.yml` and its fail-closed workflow detector. |
| `tooling` | Model lane commands, repository test configuration, and dated selection provenance; no runtime policy copy. |
| `proposed_register` | Model family/backlog status and source provenance; unresolved human choices remain named findings, not executable defaults. |
| `open_findings` | Model family/backlog blockers and authored design state; host policy retains only the currently executable skipped-test admission for `F-PT-012`. |
| `case_sourcing` | Model provenance links and `validation-design/routing.md`. |
| `harness_self_tests` | Model controls and each family's negative-control links. |
| `modules` | Model structures. |

## Rollback

Before cutover, reverting the transition-consumer squash restores all legacy
consumers. After cutover, reverting only the authority-cutover squash removes
all model sentinels and deterministically selects the still-present legacy
authority on the parent commit. No rollback reads the migration archive or
rewrites an artifact in place.
