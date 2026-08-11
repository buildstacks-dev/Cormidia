---
name: implement-harness-ticket
description: Vendor-neutral workflow for a product repo's coding agent to implement one harness-backlog ticket end to end. Resolve the HB ticket and its CF rows, expand each family's ratified enumeration from invariants, boundary failure modes, contracts, eval plans, or acceptance artifacts, land red-then-green specs with negative controls at the assigned layer, and update traceability in the same change. Use when routed to an HB-* ticket, landing specs against a ratified validation-design corpus, or asked to implement a catalog row. This is the builder's playbook for mechanical closure; validation-harness-design owns new families and validation-harness-audit judges fidelity.
---

# Implement Harness Ticket

**Stance: teach the workflow; the coding agent executes it.** This skill is the building code for harness implementation. It tells *you* — the product repo's coding agent — how to turn one backlog ticket into citing specs. The validation architect ships this skill, the design corpus, and the trace CLI; it **never** writes product or test code as the answer. If you are the architect running a design campaign, stop — use `validation-harness-design` instead. If you are auditing fidelity, stop — use `validation-harness-audit`. Your job here is implementation under ratified design.

## The four-level resolution chain

Every ticket implements **closure over ratified design**, not ad-hoc test ideas. Walk this chain in order; do not skip a level.

| Level | Source | What you resolve |
| --- | --- | --- |
| **1. Ticket** | `harness-backlog.md` | The `HB-*` entry: acceptance criteria, defended invariants/contracts, assigned validation layer(s), wave, executor. This is scope and done-ness — not the case list. |
| **2. Family** | `case-catalog.md` + `case-catalog.yaml` | Every `CF-*` ID the ticket owns. Read the markdown row for human intent; treat the manifest row as authoritative for tools (layer, oracle, risk, status, prune/blocked, owning ticket, wave). |
| **3. Enumeration** | Upstream artifact for that family type | The **ratified seeds** that define case count. Invariant families → seeds/clauses in `invariants.md`. Boundary families → failure modes / honest-fake obligations in `boundary-map.md` and `contracts/`. Journey families → matrix cells in `case-catalog.md` cross-linked to journeys in `system-map.md`. Eval families → scenarios/rubrics in `llm-eval-plan.md`. Outcome-acceptance (`L-ACC`) families → realistic scenario briefs, rubric axes, campaign invariants, intermediate-gate behavior, and incomplete/inconclusive terminals in `acceptance/`. **Never invent cases** — expand the enumeration; if the catalog says "4 ratified seeds", you land four (or fewer only when a seed is explicitly `BLOCKED:` / deferred with a catalog note). |
| **4. Tests** | Product repo test tree | Spec files at the ticket's assigned layer, each binding one or more enumeration items, each with a real negative control. Directory + header conventions below so `validation-trace` stays green. |

**Case-count rule:** the number of implementable checks is the closure of level 3. A ticket that "feels done" with two tests when the enumeration has seven seeds is not done — it is a fidelity gap waiting for audit.

## Standing rules (bind every ticket)

These apply regardless of product or repo. They are the same discipline the design skill ratified; repeat them here so no ticket bypasses them.

1. **Cheapest falsifying layer.** Land each check at the lowest validation layer that can honestly falsify it (invariant/contract → hermetic system → live sandbox → eval → ops → outcome acceptance). Do not jump to live, eval, or `L-ACC` because it is easier to write. Layer-6 campaign guardrails remain layer-1/2 detectors; only human-rubric axes are layer-6 work.
2. **Red-then-green negative controls.** Every new detector family proves it can fire before it proves the system passes: seed a violation (mutated fixture, planted defect, double scripted to misbehave), expect red, then fix forward to green. A spec that has only ever been green is an assumption.
3. **Non-empty walks.** Scanners, sweeps, and property-test generators must assert they found subjects. An empty walk fails — never passes silently.
4. **Tighten-only.** No ticket weakens a gate, golden set, or oracle to make CI green. Narrowing scope requires a design revision, not a local edit.
5. **No green by absence.** Passing because nothing was exercised, because a stub returned success, or because a lane is undeclared-empty is forbidden. Declared-empty lanes belong in `validation-policy.yaml` with a reason.
6. **Detector-deposit for defect fixes.** When implementation fixes a defect surfaced during this ticket, deposit the deterministic detector in the **same change** — the fix without a guard is incomplete.

Authoritative policy text may also live in `validation-policy.yaml` (`case_sourcing:` and gate blocks). On conflict, the ratified corpus wins; do not improvise softer rules.

## Traceability conventions (issue #4)

Follow these so the trace CLI closes by construction. They mirror the AGENTS.md contribution block the design campaign emitted.

1. **Test directories named by family ID.** Specs for `CF-INV-001` live under a directory whose name contains `cf-inv-001` (case-insensitive); likewise for every family. Shared helpers/fixtures that are not family-scoped may sit beside them.
2. **Spec file headers cite family + ticket + upstream section.** The first comment block of every `*.test.*` / `*.spec.*` file names the `CF-…` family it exercises, the `HB-…` ticket that owns it, and the invariant/contract/boundary clause it binds to. Unknown citations are orphans — backward closure turns red.
3. **Every implementable family owns ≥1 spec or a declared pending wave.** Non-pruned, non-blocked families without citing specs must remain on a backlog ticket whose status is **not** `LANDED`. Never mark a ticket `LANDED` while its families lack specs.
4. **Traceability updates in the same change as the tests.** Adding, moving, or deleting citing specs updates `case-catalog.yaml` (and `case-catalog.md`, which must agree), plus backlog status annotations, in the **same PR** — never a follow-up commit.

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
- Renaming or splitting case families without a manifest + catalog revision.
- Moving a check to a different validation layer for convenience rather than falsifiability.

That is a **structural change**, not a backlog ticket. Do **not** pile ad-hoc cases onto the wrong shape or silently extend the catalog. Instead:

1. **Re-enter `validation-harness-design` in `harness-revision` mode** (or ask the human to schedule that campaign), **or**
2. **Stop and escalate to the human** with the gap spelled out: what you needed, which artifact lacks it, and which `F-PT-*` / open finding it resembles.

Mechanical closure (`validation-trace` green) is not permission to invent design.

## Corpus layout (where to read)

Standard campaign deliverables live under `validation-design/` (path may differ if `validation-policy.yaml` declares another root — follow the policy):

| Artifact | Role in this workflow |
| --- | --- |
| `harness-backlog.md` | Ticket queue, waves, acceptance, `LANDED` / pending status |
| `case-catalog.md` | Human case-family register; enumeration summaries |
| `case-catalog.yaml` | Machine-readable manifest — layers, tickets, prune/blocked |
| `invariants.md` | Invariant IDs and falsifiable seeds |
| `boundary-map.md` | Boundaries, honest fakes, failure-mode matrix |
| `contracts/` | Per-boundary clauses and oracles |
| `system-map.md` | Journeys, components, state ownership |
| `llm-eval-plan.md` | Eval scenarios, rubrics, thresholds |
| `acceptance/` | `L-ACC` rubric, realistic scenario briefs, sealed-plant policy, campaign-invariant registry |
| `validation-policy.yaml` | Gates, layer declarations, tighten-only policy |
| `risk-allocation.md` | Risk tiers backing catalog rows |
| `agents-md-contribution.md` | Routing + traceability conventions for coding agents |

Owner-facing companions (`owner-briefing.md`, `owner-backlog.md`) are non-normative follow-alongs — on disagreement, the artifacts above win.

## Workflow (one ticket)

1. **Select the ticket.** Start from the `HB-*` entry routed to you. Read acceptance criteria, defended IDs, and layer assignment. If status is already `LANDED`, confirm the human intends rework; otherwise prefer pending tickets.
2. **Resolve families.** List every `CF-*` on the ticket. For each, read the catalog row and manifest entry. Respect `pruned`, `blocked`, and `BLOCKED:*` remainder legs — implement only implementable rows; do not "helpfully" cover pruned dupes.
3. **Expand enumerations.** For each family, open the upstream artifact and write down every seed/failure mode/clause you must bind. That list is your case checklist; its length is not negotiable.
4. **Place at layer.** Use the family's assigned layer(s) from the manifest. Build hermetic doubles per `boundary-map.md` / contracts when layer 2; reserve live/eval for seams the design marks non-fakeable. For `L-ACC`, implement the ratified realistic scenarios and scored axes without translating them into binary assertions; put sealed-answer, producer↔grader independence, preflight, spend cutoff, intermediate-gate persistence, and incomplete/inconclusive behavior in layers 1–2 with negative controls. Never run the live campaign without the ticket's explicit per-campaign human authorization.
5. **Land red-then-green.** For each detector family: failing seed → green fix. Include negative-control tests in the same spec file where the design expects them.
6. **Update traceability.** Same change: spec files, directory names, headers, manifest rows if counts/status changed, markdown catalog if human table changed, backlog ticket status (`LANDED` only when every owned implementable family has citing specs).
7. **Run closure.** Execute `validation-trace` against the repo root (see below). Fix every red before declaring the ticket done. Green closure does not replace fidelity audit — it proves the graph is wired, not that oracles match intent.

## Verify with `validation-trace`

The architect ships a deterministic, product-agnostic CLI in the `validation-architect` package. Install the version pinned by the delivered enablement bundle as a product-repo dev dependency, then run it from the **product repo** on every harness change; wire the included CI template into the repo's own CI per the campaign's lane config.

```bash
pnpm add --save-dev --save-exact validation-architect@<pinned-version>
pnpm exec validation-trace . \
  --manifest validation-design/case-catalog.yaml \
  --tests <tests_root>
```

It fail-closes on:

- **Forward** — implementable family with no citing spec and no declared pending wave
- **Backward** — spec cites an unknown family (orphan)
- **Status honesty** — ticket marked `LANDED` but families lack specs
- **Agreement** — `case-catalog.yaml` disagrees with `case-catalog.md`

Optional: `--out trace-report.md` for the human-facing trace report. Exit code `0` only when all checks pass.

**Boundary:** `validation-trace` proves **closure**, not **fidelity**. Whether your assertion actually falsifies the ratified seed is judgment work for the fidelity audit — still follow the enumeration here so you are not caught narrowing cases silently.

## What not to do

- Do not write tests that cite a `CF-*` ID without implementing its enumeration items.
- Do not mark `LANDED` before specs exist and trace is green.
- Do not add families, seeds, or clauses locally — that is design work.
- Do not weaken policy, delete negative controls, or skip red-then-green to save time.
- Do not treat this skill as permission for the architect persona to implement — the architect teaches and inspects; **you** implement.
