# HB-111 — exact protected-surface proposal

Status: **PROPOSED — NOT APPLIED** (2026-08-04)

This document is the review boundary required by HB-111. The diff below is the
complete proposed change to human-ratified or binding surfaces. None of these
changes is present in the working tree. Applying any part requires a separate,
explicit human approval of this exact proposal and a protected-surface PR that
retains human merge.

## Determination

| Surface | Change? | Determination |
|---|---|---|
| `roles.yaml` | No | C-OP-VALIDATION §1 and S-10 define Validation Designer as a capability/call site, not a free-running employee. The existing Planner assignment is the ratified default named by `llm-eval-plan.md`; adding an employee or second model assignment would contradict that contract. |
| `pipelines.yaml` | Yes | A paid validation-design turn must resolve through a governed pass and protected prompt. It is a separate one-pass pipeline invoked after RoadmapPlan acceptance and before readiness; the existing `plan` pass order remains unchanged. |
| `prompts/validation/design.md` | Yes, new | S-10 has a committed pre-tuning corpus but no production prompt. A strict prompt is required before the capability can be invoked. |
| `prompts/build/contract.md` | Yes | The Builder contract pass must map both ticket acceptance criteria and accepted validation obligations to named detectors/evidence. |
| `prompts/build/implement.md` | Yes | The implementation pass must execute the accepted validation obligations and their seeded negative controls, not infer them from prose. |
| `prompts/review/verify.md` | Yes | The Reviewer must independently verify the exact validation-contract version and evidence, not only the ticket criteria. |
| `TASTE.md` | No | Existing simplicity, testing, and ratified-contract doctrine already governs this capability; no product preference changes. |
| `docs/PURPOSE.md` | No | The accepted 2026-08-03 architecture already distinguishes Planner intent, validation authority, and independent review. No new product decision is proposed. |
| standing `AGENTS.md` instructions | No | Root instructions already require affected validation contracts/catalog rows, cheapest-layer placement, detector deposits, negative controls, and harness-revision routing. Nested instructions do not own this org-level flow. |

The file order in `pipelines.yaml` is descriptive, not execution authority. The
ordinary companion implementation must enforce this state transition:

`accepted RoadmapPlan/unit → accepted validation contract → readiness publication`

It must never run Validation Designer after `op:ready`, and it must stop a unit
with missing, stale, malformed, unknown, or structural output before readiness.

## Exact proposed diff

```diff
diff --git a/pipelines.yaml b/pipelines.yaml
--- a/pipelines.yaml
+++ b/pipelines.yaml
@@
 plan:
   passes:
@@
     - id: decomposer
       role: planner
       template: plan/decomposer.md
+
+# Governed S-10 capability. The orchestrator invokes this only after the
+# RoadmapPlan and delivery-unit versions are durable and before readiness.
+# It is not a standing employee and is not appended to the plan pipeline.
+validation-design:
+  passes:
+    - id: design
+      role: planner
+      template: validation/design.md
+      effort: high

 groom:
   passes:
diff --git a/prompts/validation/design.md b/prompts/validation/design.md
new file mode 100644
--- /dev/null
+++ b/prompts/validation/design.md
@@
+# Pass: design (validation-design pipeline)
+
+Design the validation obligations for the exact accepted RoadmapPlan and
+delivery-unit versions in the brief. This is the governed S-10 capability,
+not product planning and not implementation. Planner-owned intent, priority,
+membership, dependencies, and acceptance criteria are immutable inputs.
+
+## Protocol
+
+1. Use only IDs and templates from the supplied accepted validation catalog.
+   Resolve the affected journeys, boundaries, operation contracts, invariants,
+   interfaces, state owners, control points, and existing case families. Never
+   invent an ID or silently reinterpret product truth.
+2. Place every obligation at the cheapest layer that can falsify it. A live or
+   eval run is evidence for a seam, not a substitute for a deterministic L1/L2
+   detector when an honest fixture can reproduce the failure.
+3. Every detector family names a seeded negative control that proves the
+   detector fires. A defect found at L3/L4 also names the L1/L2 detector to
+   deposit in the same change.
+4. Cover cross-ticket joins and shared state-owner/boundary seams once at unit
+   scope while preserving traceability to every member criterion. Bind expected
+   evidence to the exact contract version, delivery-unit membership, and PR HEAD.
+5. Routine templates are allowed only when the supplied catalog marks the work
+   eligible. Never use them for invariant floors, C3 control points, security,
+   auth, secrets, privacy, payments, migrations, data-loss risk, or an
+   architecture-contract change.
+6. Waivers are never inferred. Use only a supplied, exact, unexpired human
+   authority that the catalog permits; otherwise emit no waiver.
+7. If the work needs a new journey, boundary, invariant, state owner, or other
+   structural truth absent from the accepted catalog, choose
+   `requires_harness_revision`. Do not fabricate a replacement contract.
+8. Do not edit files, GitHub state, prompts, policy, catalog, or the RoadmapPlan.
+
+## Output
+
+Return only JSON matching the runtime-supplied closed schema. Choose exactly
+one disposition: `contract` with one complete proposed validation contract, or
+`requires_harness_revision` with a precise missing-structure reason and no
+contract. Copy all orchestrator-owned app, catalog, roadmap, unit, membership,
+version, predecessor, and timestamp fields from the supplied envelope exactly.
+No prose may appear outside the JSON value.
diff --git a/prompts/build/contract.md b/prompts/build/contract.md
--- a/prompts/build/contract.md
+++ b/prompts/build/contract.md
@@
 3. **Map every acceptance criterion to named tests.** For each criterion,
    name the test (existing or to be written) that proves it. The
    completeness gate fails — not warns — on any criterion without a covering
    test. A criterion you cannot map to a mechanical check is a spec bug:
    flag it under risks; do not silently reinterpret it.
+   When the brief carries an accepted validation contract, also map every
+   non-waived obligation to its exact case ID, detector, seeded negative
+   control, cheapest falsifying layer, and expected evidence. Do not weaken,
+   replace, or silently waive an accepted obligation.
diff --git a/prompts/build/implement.md b/prompts/build/implement.md
--- a/prompts/build/implement.md
+++ b/prompts/build/implement.md
@@
 5. **Plan-adherence self-check** before declaring done:
    - every acceptance criterion is addressed, each by the test named in the
      contract's mapping;
+   - every non-waived accepted validation obligation has its named detector,
+     seeded negative control, and expected evidence at the declared cheapest
+     layer; the exact IDs appear in the gate evidence;
    - only in-scope files are touched — revert strays now, whatever they
      cost you;
diff --git a/prompts/review/verify.md b/prompts/review/verify.md
--- a/prompts/review/verify.md
+++ b/prompts/review/verify.md
@@
 1. **Check every acceptance criterion against evidence.** Read the diff, the
    code around it, and the test results. A criterion is satisfied when its
    named test proves it — not when the diff looks like it should. Run the
    tests if the brief's results leave any doubt.
+   When the brief carries an accepted validation contract, independently
+   verify every non-waived obligation, detector, seeded negative control,
+   required gate, shared-boundary reference, and expected-evidence claim
+   against that exact contract version and candidate HEAD. Missing, stale,
+   or mismatched evidence is a finding, never an inferred pass.
```

## Ordinary companion implementation dependency

The protected diff is necessary but not sufficient to activate S-10. A separate
ordinary implementation must add a code-owned `validation-design/design`
operation binding, a closed output schema/parser, exact accepted-catalog and
RoadmapPlan/unit input manifests, persistence-before-readiness, and the complete
contract in Builder/Reviewer briefs. It must also add L1/L2 detectors with seeded
negative controls for malformed output, unknown IDs, stale bindings, structural
dispositions, missing brief authority, and accidental post-readiness invocation.

Until both changes merge, existing governed routine-template normalization stays
available. Any unit that needs missing custom validation-design decisions remains
unready at the existing deterministic authority boundary; it must not fall back
to an ungoverned Planner turn.

## Migration

- No persisted-state rewrite and no role migration.
- Existing accepted validation contracts and routine-template units retain their
  exact refs/hashes and continue to resolve.
- Deployment is additive: merge the ordinary code-owned binding and the approved
  protected surfaces together at the activation boundary. The loader must refuse
  a missing/mismatched pipeline or prompt before provider construction.
- The existing Planner tuple supplies the initial S-10 assignment. A separately
  configured validation-design tuple would be a later, separately ratified change.

## Rollback

- Disable the code-owned S-10 invocation, then revert the protected commit.
- Leave accepted validation artifacts immutable; units depending on a custom
  contract become unready rather than being rewritten or silently downgraded to a
  routine template.
- No `roles.yaml`, catalog, policy, or state schema rollback is needed.

## Golden-set and gate impact

- `validation-design/golden-sets/validation-designer/cases.json` already predates
  this prompt and remains byte-for-byte unchanged. Its human references remain
  `pending`; F-PT-011 keeps threshold-dependent results inconclusive.
- The prompt addition triggers S-10 L4 cadence, but no provider-backed/eval run is
  authorized by HB-111. A later exact human authorization may collect data; it
  cannot create a pass/qualification claim before reference review and threshold
  ratification.
- Builder deterministic trajectory checks and the Reviewer golden set are not
  weakened or edited. The Builder/Reviewer prompt additions tighten their input
  obligations; their existing cadence applies after approval, with unresolved
  threshold-dependent outcomes still reported as inconclusive.
- No gate, golden case, threshold, or negative-control requirement is removed.
