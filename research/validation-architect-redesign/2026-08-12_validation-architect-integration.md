# 2026-08-12 — Validation Architect packaging and Cormidia integration

Planning decision record. No implementation, npm publication, live validation
campaign, provider turn, or release-shaped action was performed in this session.

Companion redesign proposal:
[validation-architect-core-improvements.md](./validation-architect-core-improvements.md).

## Context

Cormidia needs two honest validation modes per application:

- `agent-standard`: no validation catalog, contract, or derived obligations;
  ordinary Builder tests, independent Reviewer evidence, and the application's
  configured gates remain.
- `harness`: validation design is part of product planning, the owner reviews the
  RoadmapPlan and validation consequences together, and product-behavior delivery
  units receive obligations derived from that application's accepted corpus.

Greenfield applications default to `harness`; existing applications default to
`agent-standard`. The owner can decline or change the mode. Onboarding records the
criticality answer in owner language and maps it to C0–C4 internally. A failed,
timed-out, over-budget, or truth-starved design run completes onboarding in
`agent-standard` with a typed, visible degradation reason.

The integration must preserve Cormidia's provider-turn ownership: exact atomic
harness/model/effort assignment, per-turn and per-app ceilings, critical-operation
gates, run envelopes, exactly-once settlement, and cross-provider independence.
An opaque provider-spending subprocess cannot satisfy that boundary.

## Decisions

### D1 — Use a library with an injected governed turn executor

**Decision: option B.** `validation-architect` becomes an exact-pinned Cormidia
runtime dependency and exposes a provider-neutral headless design API. The API owns
the phase state machine, tier profiles, prompts/skill content, output schemas,
artifact validation, resumability, and method version. It requests each logical turn
through an injected callback equivalent to:

```ts
runTurn(assignment, prompt, outputSchema, limits, metadata): Promise<TurnResult>
```

`assignment` is a logical seat and independence/capability requirement, not a
provider credential or an authority grant. Cormidia resolves it to one approved
atomic harness/model/effort tuple, invokes its own Runtime, gates every tool action,
writes the run envelope, settles the provider turn, and returns only the typed result
to the architect. The headless import constructs no provider SDK, subprocess,
network client, Git operation, or publication effect.

Before execution, the architect exposes the selected method profile, finite required
turn sequence or bounded state machine, maximum provider-turn count, required seat
independence, schemas, and exact method versions. Cormidia admits and persists that
envelope under its ordinary EpisodePlan and budget rules. A refusal or exhausted
bound remains a typed incomplete/failure result; the library never silently adds a
turn.

This is one implementation of the validation method without surrendering
Cormidia's execution authority. The dependency adds no new transitive runtime
package beyond `yaml`, which Cormidia already uses.

**Rejected: option A, contract only.** It preserves turn ownership but makes
Cormidia maintain derived prompts and phase behavior beside the canonical skill.
Schema validation cannot detect semantic prompt drift, so the two implementations
would diverge precisely where the method changes.

**Rejected: option C, subprocess CLI.** The current autonomous CLI owns provider
turns internally. Calling it from Cormidia would bypass per-turn admission, gating,
runlog attribution, settlement, and role-pairing guarantees.

**Delivery boundary.** `pnpm vda deliver <runId>` remains the correct standalone
campaign handoff: it writes only `validation-design/` on a pinned branch from a
temporary worktree. Cormidia does not call it. Cormidia receives an artifact bundle
from the library and uses its own crash-resumable planning/publication transaction,
resolved remote default branch, managed checkout, branch, and PR authority. Reusing
the VDA branch writer would create a second publisher and split publication evidence.

### D2 — The package is the complete method contract, not a trace-only CLI

The public `validation-architect` package contains:

1. the deterministic `validation-trace` CLI;
2. the provider-neutral headless library and its public TypeScript declarations;
3. complete `validation-harness-design`, `validation-harness-audit`, and
   `implement-harness-ticket` skill directories, including their `VERSION`,
   `CHANGELOG`, and referenced files;
4. machine-readable schemas for every headless input, turn result, artifact,
   corpus manifest, backlog item, and provenance record; and
5. a machine-readable contract manifest mapping the package version to the exact
   headless API, schema, design-skill, and audit-skill versions.

The first public package does not need to install or bundle provider runtimes for
Cormidia. The existing source-operated `pnpm vda` campaign remains the C3/C4 direct
campaign surface unless and until its provider-backed CLI earns a separately
packaged dependency boundary. This keeps the headless and trace consumption path at
the current single `yaml` runtime dependency.

Publishing only `validation-trace`, or only `SKILL.md` without its references, is
rejected because neither is a usable definition of the design method.

### D3 — License the public package under MIT

The distributed npm package will use SPDX `MIT` and include the standard license
notice. `UNLICENSED` is rejected because Cormidia-managed application repositories
and their CI systems must have legal permission to install and execute the package.
A custom proprietary or source-available license is rejected as needless adoption
friction for this interoperability layer.

MIT permits recipients to use, copy, modify, and distribute the software while
retaining the copyright and permission notice, and includes the standard warranty
disclaimer. It does not require publishing the private source repository. Source:
<https://opensource.org/license/mit>.

This decision licenses the software and documentation furnished in the npm
distribution; it does not make the private GitHub repository public. The release
change must name the copyright holder in the bundled notice before publication.

### D4 — Add finite tier profiles; keep the full relay only at C3/C4

Every profile runs deterministic schema, required-file, identifier, provenance, and
cross-artifact closure checks after artifact-producing turns. These checks are not
provider turns.

| Tier | Provider-turn profile | Owner-facing result |
| --- | --- | --- |
| C0 | One Designer turn. No model audit; that declared omission appears in the briefing. | Skeleton-first corpus and one joint plan/design review. |
| C1 | Designer, then one fresh independent cross-provider Auditor. No feedback relay. | Audit findings and reservations appear in the same joint review. |
| C2 | Designer draft, Stakeholder challenge, one Designer revision, then one fresh independent Auditor: exactly four turns. No feedback relay. | One joint review containing the plan, design, audit reservations, and decisions. |
| C3/C4 | The existing bounded Designer↔Stakeholder Phase 0–8 relay, separate method hard stops, three fresh-context readers, and the two-iteration audit/disposition protocol. | The final owner ratification can still be joint with the product plan, but the high-criticality method is not compressed. |

For C0–C2, substantive audit findings do not trigger an unbounded repair loop. They
produce `clean`, `clean-with-reservations`, or `reservations` and remain visible to
the owner. Missing required artifacts, invalid schemas/IDs, a failed required turn,
or budget/time exhaustion is a typed design failure and activates the agreed
`agent-standard` degradation instead of manufacturing a corpus.

For C3/C4, the current relay defaults remain explicit outer bounds rather than an
implicit loop: 60 relay exchanges, 300 wall minutes, three reader turns, at most two
audit iterations, and at most 12 Stakeholder exchanges per audit feedback window.
Cormidia may tighten a run's budget but may not interpret ceiling exhaustion as
completion. Every provider invocation still goes through the injected executor.

### D5 — Exact provenance plus SemVer and schema-major compatibility

Package SemVer and skill versions are independent but linked by the published
contract manifest:

- changing a skill requires its own `VERSION` and `CHANGELOG` update;
- every package release records the exact bundled design and audit skill versions;
- patch releases are backward-compatible fixes, minor releases may add compatible
  API/schema fields or method profiles, and a breaking headless API or schema change
  requires a package major change;
- schema IDs carry their own major, such as
  `validation-architect/design-run/v1`; and
- package versions are exact-pinned. Upgrades are reviewed dependency changes, not
  ranges or automatic drift.

Every produced corpus records at least the package version, design-skill version,
audit-skill version when used, headless API version, every schema ID/version, method
profile, tier, source revision, and run identity. Resume requires the exact package
and method manifest that began the run unless an explicit migration exists.

Cormidia declares the headless API and schema majors it supports and refuses an
unsupported manifest before any provider turn. A corpus remains readable only while
its schema major is supported. Under option B there are no Cormidia-derived method
prompts to compare for staleness; the exact package pin and manifest are the drift
boundary.

### D6 — The accepted corpus lives in the application repository; state holds drafts and evidence

The canonical accepted corpus lives at `validation-design/` in the application
repository. That location survives a fresh clone, participates in ordinary review,
and is available to Cormidia's managed checkout after the ratification PR merges to
the resolved remote default branch.

Cormidia's state home holds the in-progress artifact bundle, run state, exact input
manifest, provider/runlog evidence, publication journal, and a pointer/hash to the
accepted repository corpus. State is operational evidence, not a second ratified
corpus. Planning reads the accepted corpus from the freshly synchronized managed
checkout at the resolved remote default branch; it never treats an arbitrary human
working tree or an unmerged draft branch as current authority.

### D7 — Delete the unused org-home `skills/` placeholder

Do not add a generic role-turn skill loader for this integration. Option B supplies
the canonical method through the exact-pinned library and injected turn executor;
loading another copy from org home would add a second version and prompt authority.

`org init` will stop generating `skills/.gitkeep`, and documentation will stop
claiming that root as an active role-consumed surface. This does not remove:

- user-global packaged operator skills under provider skill homes;
- the validation-architect skills shipped as versioned package data; or
- governed learning-loop `skill_draft` proposals under
  `learning/proposals/skills/`, which remain proposals rather than active role
  context.

A future generic role-skill mechanism requires its own design for selection,
hash/version binding, native-harness loading, authority, context manifests,
resumption, and cross-provider equivalence. An empty directory is not that design.

## Consequences for Cormidia's ratified surfaces

No human-ratified surface was edited in this planning record. Implementing D1/D4 in
Cormidia requires an exact, separately ratified proposal for `pipelines.yaml` and
`prompts/**`: the current unreachable S-10 prompt must become a thin governed
transport or retire, not remain a second locally authored validation method beside
the library. Removing the org-home skill implication requires the corresponding
`docs/PURPOSE.md` proposal; it may not be silently rewritten.

No decision here authorizes an L3, L4, L5, or L-ACC campaign, a model-quality claim,
an npm publication, a version tag, or a release handoff.

## Ticket allocation and sequencing

- `buildstacks-dev/validation-architect#16`: headless library, injected executor,
  finite tier profiles, schemas, importable backlog, provenance, and incremental
  mode.
- `buildstacks-dev/validation-architect#17`: MIT license, package metadata,
  complete published file set, contract manifest, release workflow, package smoke,
  and the first public `0.2.0` publication. The release workflow/license/metadata can
  land before #16; the first publish waits for #16 so the public contract is not born
  incomplete. Publication still requires its own explicit human release approval.
- `cormidia/Cormidia#381`: Phases 0–1 remain independent; Phases 2–4 exact-pin the
  library, adapt the injected executor to governed turns, publish the accepted corpus
  through Cormidia, remove the unused org-home `skills/` placeholder, and integrate
  joint review/steady state.
- `cormidia/Cormidia#431`: make deterministic trace closure green and enforced,
  then replace the vendored tarball with the exact public package. The trace work can
  proceed before publication; the dependency swap cannot.
- `cormidia/Cormidia#432`: read as the binding clarification of structural
  escalation mechanics. It is not changed by this decision record.

## Owner-decision batch

None. The current human request explicitly delegated D1–D7 for this planning
session. Every outward release action and every later exact edit to Cormidia's
human-ratified surfaces retains its existing separate approval boundary.
