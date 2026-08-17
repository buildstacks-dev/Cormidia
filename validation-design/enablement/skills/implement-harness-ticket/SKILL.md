---
name: implement-harness-ticket
description: Vendor-neutral workflow for a product repo's coding agent to implement one checked-model backlog ticket end to end. Resolve the HB ticket and its CF families, expand each family's ratified enumeration from invariants, boundary failure modes, contracts, eval plans, or acceptance artifacts, land red-then-green specs with negative controls at the assigned layer, and update traceability in the same change. Use when routed to an HB-* ticket, landing specs against a ratified validation-design corpus, or asked to implement a model family. This is the builder's playbook for mechanical closure; validation-harness-design owns new families and validation-harness-audit judges fidelity.
---

# Implement Harness Ticket

**Stance: teach the workflow; the coding agent executes it.** This skill is the building code for harness implementation. It tells *you* — the product repo's coding agent — how to turn one backlog ticket into citing specs. The validation architect ships this skill, the design corpus, and the trace CLI; it **never** writes product or test code as the answer. If you are the architect running a design campaign, stop — use `validation-harness-design` instead. If you are auditing fidelity, stop — use `validation-harness-audit`. Your job here is implementation under ratified design.

## The four-level resolution chain

Every ticket implements **closure over ratified design**, not ad-hoc test ideas. Walk this chain in order; do not skip a level.

| Level | Source | What you resolve |
| --- | --- | --- |
| **1. Ticket** | `model/backlog.yaml` | The `HB-*` entry: acceptance criteria, defended families, assigned lane/layer, wave, executor, and status. Generated `harness-backlog.md` is navigation only. |
| **2. Family** | `model/families.yaml` + `model/controls.yaml` | Every `CF-*` ID the ticket owns, including layer, lane, oracle, risk, status, blockers, exact planned paths, and red-capable controls. Generated `case-catalog.md` is navigation only. |
| **3. Enumeration** | Checked family plus its cited authored rationale | The **ratified seeds** that define case count. Invariant families → `model/families.yaml` plus seeds/clauses in `invariants.md`. Boundary families → the checked family plus failure modes / honest-fake obligations in `boundary-map.md` and `contracts/`. Journey families → checked structures/families cross-linked to journeys in `system-map.md`. Eval families → checked families plus scenarios/rubrics in `llm-eval-plan.md`. Outcome-acceptance (`L-ACC`) families → checked families plus realistic scenario briefs, rubric axes, campaign invariants, intermediate-gate behavior, and incomplete/inconclusive terminals in `acceptance/`. **Never invent cases** — expand the enumeration; if the checked family and its cited source define four ratified seeds, land four (or fewer only when the model explicitly records a blocker or honest deferral). |
| **4. Tests** | Product repo test tree | Spec files at the ticket's assigned layer, each binding one or more enumeration items, each with a real negative control. Directory + header conventions below so `validation-trace` stays green. |

**Case-count rule:** the number of implementable checks is the closure of level 3. A ticket that "feels done" with two tests when the enumeration has seven seeds is not done — it is a fidelity gap waiting for audit.

## Standing rules (bind every ticket)

These apply regardless of product or repo. They are the same discipline the design skill ratified; repeat them here so no ticket bypasses them.

1. **Cheapest falsifying layer.** Land each check at the lowest validation layer that can honestly falsify it (invariant/contract → hermetic system → live sandbox → eval → ops → outcome acceptance). Do not jump to live, eval, or `L-ACC` because it is easier to write. Layer-6 campaign guardrails remain layer-1/2 detectors; only human-rubric axes are layer-6 work.
2. **Red-then-green negative controls.** Every new detector family proves it can fire before it proves the system passes: seed a violation (mutated fixture, planted defect, double scripted to misbehave), expect red, then fix forward to green. A spec that has only ever been green is an assumption.
3. **Non-empty walks.** Scanners, sweeps, and property-test generators must assert they found subjects. An empty walk fails — never passes silently.
4. **Tighten-only.** No ticket weakens a gate, golden set, or oracle to make CI green. Narrowing scope requires a design revision, not a local edit.
5. **No green by absence.** Passing because nothing was exercised, because a stub returned success, or because a lane is undeclared-empty is forbidden. Lane and unfinished-work posture must be explicit in the checked model.
6. **Detector-deposit for defect fixes.** When implementation fixes a defect surfaced during this ticket, deposit the deterministic detector in the **same change** — the fix without a guard is incomplete.

The complete eight-file `model/` graph is the sole Validation Architect
machine authority. `docs/qualification/host-policy.yaml` separately owns only
Cormidia's exact qualification/campaign facts; the two compose tighten-only.
The migration archive is history-only. Do not improvise softer rules.

## Traceability conventions (issue #4)

Follow these so the trace CLI closes by construction. They mirror the current
`routing.md` and `enablement/traceability-conventions.md`.

1. **Test directories named by family ID.** Specs for `CF-INV-001` live under a directory whose name contains `cf-inv-001` (case-insensitive); likewise for every family. Shared helpers/fixtures that are not family-scoped may sit beside them.
2. **Spec headers remain human annotations.** Keep family + ticket + clause citations useful to readers, but header text cannot create, reject, or reassign current model facts.
3. **Every implementable family declares exact planned paths or honest unfinished work.** Missing implementation under a pending, blocked, or parked ticket is partial/inconclusive; under a landed or unknown owner it is red.
4. **Traceability updates in the same change as the tests.** Adding, moving, or deleting specs updates the matching `model/families.yaml` paths and controls plus `model/backlog.yaml` status in the **same PR** — never a follow-up commit.

Example header shape (adapt suffix/path to the repo's test runner):

```typescript
// CF-W01-R — duplicate widget id refuses pre-mutation (HB-001; INV-003 §2.1).
describe("CF-W01-R", () => {
  it("refuses a duplicate widget id", () => { /* … */ });
  it("negative control: seeded duplicate slips past store and detector fires", () => { /* … */ });
});
```

## Structural-change escalation

Stop implementation and escalate when the ticket **requires a shape the ratified corpus does not have**:

- A **new journey**, boundary, invariant, contract clause, or eval scenario that is not already enumerated (or explicitly marked `PROPOSED` / open finding) in the design artifacts.
- Renaming or splitting case families without a reviewed checked-model revision.
- Moving a check to a different validation layer for convenience rather than falsifiability.

That is a **structural change**, not a backlog ticket. Do **not** pile ad-hoc cases onto the wrong shape or silently extend the checked family graph. Instead:

1. **Re-enter `validation-harness-design` in `harness-revision` mode** (or ask the human to schedule that campaign), **or**
2. **Stop and escalate to the human** with the gap spelled out: what you needed, which artifact lacks it, and which `F-PT-*` / open finding it resembles.

Mechanical closure (`validation-trace` green) is not permission to invent design.

## Corpus layout (where to read)

Standard campaign deliverables live under `validation-design/`:

| Artifact | Role in this workflow |
| --- | --- |
| `model/backlog.yaml` | Authoritative ticket queue, waves, acceptance, status |
| `model/families.yaml` | Authoritative family placement, status, ownership, exact planned paths |
| `model/controls.yaml` | Authoritative red-capable negative controls |
| `model/policy.yaml` | Validation layers, lanes, triggers, authorization posture |
| Generated five Markdown views + `compiler-report.json` | Non-authoritative reader views and canonical compiler report; regenerate together |
| `invariants.md` | Invariant IDs and falsifiable seeds |
| `boundary-map.md` | Boundaries, honest fakes, failure-mode matrix |
| `contracts/` | Per-boundary clauses and oracles |
| `system-map.md` | Journeys, components, state ownership |
| `llm-eval-plan.md` | Eval scenarios, rubrics, thresholds |
| `acceptance/` | `L-ACC` rubric, realistic scenario briefs, sealed-plant policy, campaign-invariant registry |
| `docs/qualification/host-policy.yaml` | Separate Cormidia RQ/spend/L-ACC/campaign-binding facts |
| `risk-allocation.md` | Authored risk-tier rationale backing model family facts |
| `routing.md` | Current binding routing + traceability procedure |

Owner-facing companions (`owner-briefing.md`, `owner-backlog.md`) are
non-normative generated views. On machine-fact disagreement the checked model
wins; on a host-only operational fact the host policy wins; authored sources
remain rationale, not a second machine graph.

## Workflow (one ticket)

1. **Select the ticket.** Start from its `model/backlog.yaml` entry. Read acceptance criteria, family IDs, lane/layer, and status. If status is already `landed`, confirm rework is intended; otherwise prefer pending work.
2. **Resolve families.** List every owned `CF-*`. Read each `model/families.yaml` entry and linked control. Respect `pruned`, `blocked`, and `BLOCKED:*` legs — implement only implementable work; do not cover pruned duplicates.
3. **Expand enumerations.** For each family, open the upstream artifact and write down every seed/failure mode/clause you must bind. That list is your case checklist; its length is not negotiable.
4. **Place at layer.** Use the family's assigned model layer/lane. Build hermetic doubles per `boundary-map.md` / contracts when layer 2; reserve live/eval for seams the design marks non-fakeable. For `L-ACC`, implement the ratified realistic scenarios and scored axes without translating them into binary assertions; put sealed-answer, producer↔grader independence, preflight, spend cutoff, intermediate-gate persistence, and incomplete/inconclusive behavior in layers 1–2 with negative controls. Never run the live campaign without explicit per-campaign human authorization.
5. **Land red-then-green.** For each detector family: failing seed → green fix. Include negative-control tests in the same spec file where the design expects them.
6. **Update traceability.** Same change: spec files, exact model planned paths, linked controls, and ticket status (`landed` only when every owned implementable family has its planned implementation/evidence).
7. **Run closure.** Execute `validation-trace` against the repo root (see below). Fix every red before declaring the ticket done. Green closure does not replace fidelity audit — it proves the graph is wired, not that oracles match intent.

## Verify with `validation-trace`

The architect ships a deterministic, product-agnostic CLI in the
`validation-architect` package. Use the exact version already pinned by the
repository, then run it from the **product repo** on every harness change.

```bash
pnpm exec validation-architect compile . --write
pnpm validation:trace
```

It fail-closes on:

- **Forward** — a landed family lacks an exact planned implementation/evidence path
- **Backward** — an observed spec is absent from the model (orphan)
- **Status honesty** — landed ownership lacks its planned artifacts
- **Generated drift** — any of five Markdown views or `compiler-report.json` is stale
- **Authority integrity** — the model is partial/corrupt or a retired root authority reappears

**Boundary:** `validation-trace` proves **closure**, not **fidelity**. Whether your assertion actually falsifies the ratified seed is judgment work for the fidelity audit — still follow the enumeration here so you are not caught narrowing cases silently.

## What not to do

- Do not write tests that cite a `CF-*` ID without implementing its enumeration items.
- Do not mark `landed` before planned artifacts exist and closure is green.
- Do not add families, seeds, or clauses locally — that is design work.
- Do not weaken policy, delete negative controls, or skip red-then-green to save time.
- Do not treat this skill as permission for the architect persona to implement — the architect teaches and inspects; **you** implement.
