# Changelog

## 0.5.0

Enablement promotions from the validation-architect re-scope (2026-08-01).

- New `fidelity` mode: per-wave / per-ticket judgment pass over a product repo whose deterministic closure (`validation-trace`) is already green. Four axes (seed coverage, negative-control reality, oracle match, no quiet narrowing); findings only — never propose a patch. Distinct from campaign-scale design-conformance audit and from `verify`/`harden`.
- Design-time artifact list updated to include `case-catalog.yaml` and the owner documents (`owner-briefing.md`, `owner-backlog.md`).

## 0.4.0

Aligned with validation-harness-design 0.4.0 (the rightsizing revision derived from the first full brownfield campaign).

- New conformance checks (harness-policy-conformance.md §4 items 16–18): **derivation closure** — the case catalog reaches matrix closure (every source-artifact × derivation-row cell traced or risk-pruned by name; silent empty cells are findings) and no expansion gate references conditions outside the layer it gates (an out-of-layer freeze is a structural finding: the harness designed itself into a stall); **negative controls** — sampled detector families each prove they can fire against a seeded violation, landed red-then-green, walking-skeleton tests included; **harness self-testing** — fixtures have self-tests, scanners fail on an empty walk, policy loaders and CI configuration are pinned by tests.
- Provisional-value semantics (§3): a `PROPOSED` contract tolerance lives as a `provisional_values:` entry with owner and expiry, asserted by tests; an expired or ownerless provisional is an active finding, and an `OPEN` that merely awaits tuning is a finding.
- Coexistence semantics sharpened (§3, checklist item 15): `additive_opt_in` constrains integration with the incumbent's pipelines only — the isolated root's own additive CI lane is walking-skeleton scope and its absence is a finding.
- Artifact descriptions updated (§2): the case catalog carries the matrix-closure obligation; the harness backlog pairs each skeleton test with its negative control, includes harness self-tests and the additive CI lane, scopes expansion gates per layer, and names an executor per ticket.
- Mirrored in SKILL.md's lane-conformance bullets and the standalone reviewer prompt's Phase-4 paragraph.

## 0.3.0

Aligned with validation-harness-design 0.3.0 — the audit now consumes the full expanded design contract.

- Ingests the new design artifacts: `system-map.md` (seeds the Phase-1 system map, which is then challenged against observed reality; drift is a structural finding), `case-catalog.md` (traced case families with risk/layer/oracle/source IDs), `agents-md-contribution.md`, and the policy's `artifacts:` locations block.
- New conformance checks (harness-policy-conformance.md §4 items 11–15): **honest-fake integrity** — boundary doubles reproduce their declared failure semantics as scriptable behavior (a success-only fake is a finding) and the fake↔real conformance drift suite has actually run against the real dependency; **adapter conformance** — shared behavior validated once, per-adapter conformance coverage, cross-surface agreement check present, cloned behavioral suites are placement findings; **case-catalog traceability** — catalog and implemented tests diffed in both directions; **agent routing** — the repo's standing agent instructions route coding agents to the harness artifacts, a designed-but-never-landed routing section is a finding; **coexistence integrity** — protected paths untouched, gates unredirected, CI additive, no implicit cutover.
- Honors the `coexistence:` (`parallel-greenfield`) policy block as binding on the audit itself: protected incumbent paths and gates are read-only in `harden` mode, remediation lands under the isolated root, and cutover is never a side effect of hardening. The charter now pins which harness is under audit when a coexistence posture exists.
- Boundary failure-mode vocabulary gains `crash-mid-step`; the boundary-map description carries the honest-fake column, controlled-seam specification, unproven real semantics, and journey intersections; structural-finding examples add cloned adapter suites and system-map drift.
- Mirrored in the standalone reviewer prompt (principle 16, Phase-3 sources, Phase-4 lane conformance); eval rubric item 14c and coexistence trigger prompt added.
- Untracked an accidentally committed Python bytecode cache and added a `.gitignore`.

## 0.2.1

Vocabulary calibration.

- New governing rule 12: terms of art (claim, oracle, sensitivity evidence, holdout, independence level, validation lane, assurance target, criticality tier) are defined in one plain-language clause on first use in conversation and in the charter, with depth calibrated to the user's displayed fluency.
- The start-of-run charter is stated in plain language so the user can correct it without first learning assurance vocabulary.
- Release assessments gain a required "Plain-language restatements" section (evidence-and-verdicts.md §8): the verdict, each blocker/condition, and each residual risk restated jargon-free for the acceptance authority — acceptance is only meaningful when the accepter understands what they are accepting.
- Mirrored in the standalone reviewer prompt (principle 17, charter item 12); eval rubric item 25a pins the behavior.

## 0.2.0

Renamed from `criticality-validation-gauntlet` to `validation-harness-audit` and aligned with the companion skill `validation-harness-design`.

- Renamed the skill; retired the "gauntlet" term throughout (Phase 5 now designs the "criticality-calibrated validation plan").
- Added the lifecycle pairing: design → build → audit → revise, with findings tagged case-level (remediated here in `harden` mode) vs structural (routed to validation-harness-design's `harness-revision` mode).
- Added ingestion of ratified harness-design artifacts (`validation-policy.yaml`, `invariants.md`, `boundary-map.md`, `contracts/`, `llm-eval-plan.md`, golden sets) as an authoritative claims source with preserved namespaced IDs.
- Added five-layer lane conformance auditing (new `references/harness-policy-conformance.md`): undeclared-absent lanes are findings, declared-empty lanes are decisions; gate reality, tighten-only, waiver expiry, evidence-deposit, and eval-discipline checks.
- Declared the C0–C4 criticality scale as shared with validation-harness-design; `references/criticality-model.md` is the canonical rubric for both skills.
- Clarified that `design` mode targets existing systems; greenfield harness design belongs to validation-harness-design.
- Extended evals: new conformance/routing rubric items (14a, 14b) and a policy-diff trigger prompt.

## 0.1.0

Initial release.

- Added criticality-first system, component, and change classification.
- Added assess, design, harden, verify, and full lifecycle modes.
- Added claim-to-evidence assurance workflow.
- Added test-quality and evidence-verdict rubrics.
- Added AI-agent-system validation guidance.
- Added local tool, cloud service, and space mission calibration examples.
- Added reusable artifact templates.
- Added standard-library evidence helper scripts and script tests.
- Added standalone reviewer prompt.
- Added initial skill evaluation prompts and rubric.
