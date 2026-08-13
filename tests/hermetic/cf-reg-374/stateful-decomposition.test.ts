// Traceability: CF-REG-374 · HB-139 · case-catalog.md §10.3.
//
// SCOPE CHANGE 2026-08-12 (F-PT-039 / HB-155). This suite used to cover two
// things: the publication transaction, and source-section coverage. The second
// was only constructible because Cormidia pre-read the operator's files, and the
// owner ruled that pre-read out of the product — so the section/coverage/
// revision legs (`--resume`/`--revise` cumulative counts, heading identity and
// supersession, remaining-only deltas, the revision chain and its orphan
// promotion) are PRUNED WITH THE MECHANISM THEY TESTED, not silently dropped.
// The prune is recorded on this family's own §10.3 row.
//
// What remains here is what survived the prune and is not already asserted by
// the CF-J03 publication suite: decomposition-intent parsing, evidence-bounded
// publication admission, the immutable admission of a prepared batch versus a
// later tightened cap, prepared-recovery obligation and its binding to the
// REQUESTED stage, and the cap-bypass negative control.

import { rm } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  finalizePlanForPublication,
  type PlanProvenance,
  type PublishedTicket,
  type TicketPlan,
} from "../../../src/loop/plan-tickets.js";
import {
  parsePlanningDecompositionRequest,
  PlanningDecompositionRefusal,
  validatePlanningDecomposition,
} from "../../../src/org/planning-decomposition.js";
import {
  planningRecoveryIntentHash,
  preparedPlanningRecoveryDecision,
} from "../../../src/org/planning-publication-ledger.js";
import {
  completePlanningPublication,
  preparePlanningPublication,
  recordPlanningLedger,
} from "../../../src/org/planning-publication-operations.js";
import { resolvePlanningPublicationLimit } from "../../../src/org/planning-publication.js";
import { resolvePlanningStage } from "../../../src/org/planning-stage.js";

const roots: string[] = [];
const APP = "large-corpus";
const SCOPE = "scope-reg-374";
const provenance: PlanProvenance = { episodeId: "episode-374", runId: "run-374", traceId: "trace-374" };

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("CF-REG-374 — bounded publication admission (post-F-PT-039 remainder)", () => {
  it("accepts exact/range/complete intent and reports typed syntax remediation", () => {
    expect(parsePlanningDecompositionRequest("10")).toEqual({ kind: "range", syntax: "10", min: 10, max: 10 });
    expect(parsePlanningDecompositionRequest("4-12")).toEqual({ kind: "range", syntax: "4-12", min: 4, max: 12 });
    expect(parsePlanningDecompositionRequest("7+")).toEqual({ kind: "range", syntax: "7+", min: 7, max: null });
    expect(parsePlanningDecompositionRequest("complete")).toEqual({ kind: "complete", syntax: "complete" });
    try {
      parsePlanningDecompositionRequest("large");
      throw new Error("negative control did not fire");
    } catch (error) {
      expect(error).toBeInstanceOf(PlanningDecompositionRefusal);
      expect(error).toMatchObject({ code: "plan_decomposition_syntax_invalid" });
      expect((error as Error).message).toContain("bootstrap=3, growth=5, mature=7");
      expect((error as PlanningDecompositionRefusal).remediation).toContain("exact count (10)");
    }
  });

  it("holds a produced plan to the operator's declared count intent", () => {
    const plan = planFor(4);
    expect(validatePlanningDecomposition(plan, parsePlanningDecompositionRequest("4"))).toEqual([]);
    expect(validatePlanningDecomposition(plan, parsePlanningDecompositionRequest("2+"))).toEqual([]);
    expect(validatePlanningDecomposition(plan, parsePlanningDecompositionRequest("complete"))).toEqual([]);
    // Negative control: the count check must actually fire.
    expect(validatePlanningDecomposition(plan, parsePlanningDecompositionRequest("9-12"))).toEqual([
      expect.stringContaining("outside requested 9-12"),
    ]);
  });

  it("keeps an asserted mature stage from widening evidence-bounded admission", () => {
    const stageResolution = resolvePlanningStage({
      requestedStage: "mature",
      checkout: "/missing-explicit-checkout",
      checkoutSource: "explicit",
    });
    const publication = resolvePlanningPublicationLimit({
      stageResolution,
      checkout: "/missing-explicit-checkout",
      checkoutSource: "explicit",
    });
    expect(publication).toMatchObject({ cap: 3, requestedStage: "mature", evidenceStage: "bootstrap" });
    const plan = planFor(8);
    expect(
      finalizePlanForPublication(plan, undefined, { indexes: [0, 1, 2], publicationCap: publication.cap }).tickets.map(
        (ticket) => ticket.index,
      ),
    ).toEqual([0, 1, 2]);
    // Cap-bypass negative control: a selection above the preserved cap refuses.
    expect(() =>
      finalizePlanForPublication(plan, undefined, { indexes: [0, 1, 2, 3], publicationCap: publication.cap }),
    ).toThrow(/invalid bounded selection/);
  });

  it("completes a prepared batch under its own admission before a later batch uses a tightened cap", async () => {
    const root = await tempRoot();
    await recordPlanningLedger({
      root,
      app: APP,
      scopeId: SCOPE,
      planningIntentHash: "prepared-cap-freshness",
      plan: planFor(8),
      provenance,
      now: at(1),
    });
    const admitted = await preparePlanningPublication({ root, app: APP, scopeId: SCOPE, cap: 7, now: at(2) });
    expect(admitted.indexes).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(admitted.ledger.publication_batches[0]?.admission_cap).toBe(7);

    // A tightened cap cannot re-cut an already-prepared batch: the outstanding
    // GitHub-effect transaction keeps the admission it was prepared under.
    const reprepared = await preparePlanningPublication({ root, app: APP, scopeId: SCOPE, cap: 3, now: at(3) });
    expect(reprepared.indexes).toEqual(admitted.indexes);
    expect(reprepared.ledger.publication_batches[0]?.admission_cap).toBe(7);

    await completePlanningPublication({
      root,
      app: APP,
      scopeId: SCOPE,
      published: published(admitted.indexes),
      now: at(4),
    });
    const next = await preparePlanningPublication({ root, app: APP, scopeId: SCOPE, cap: 3, now: at(5) });
    expect(next.indexes).toEqual([7]);
    expect(next.ledger.publication_batches.at(-1)?.admission_cap).toBe(3);
  });

  it("makes a prepared publication the first recovery obligation", async () => {
    const root = await tempRoot();
    const intent = "prepared-recovery";
    const recorded = await recordPlanningLedger({
      root,
      app: APP,
      scopeId: SCOPE,
      planningIntentHash: intent,
      plan: planFor(4),
      provenance,
      now: at(1),
    });
    expect(
      preparedPlanningRecoveryDecision({ ledger: recorded, currentIntentHash: intent, resume: false, publish: true }),
    ).toEqual({ action: "none" });

    const prepared = await preparePlanningPublication({ root, app: APP, scopeId: SCOPE, cap: 3, now: at(2) });
    // Changing planning intent while a batch is outstanding must refuse.
    expect(
      preparedPlanningRecoveryDecision({
        ledger: prepared.ledger,
        currentIntentHash: "a-different-intent",
        resume: true,
        publish: true,
      }),
    ).toMatchObject({ action: "refuse" });
    // So must proceeding without recovering it.
    expect(
      preparedPlanningRecoveryDecision({
        ledger: prepared.ledger,
        currentIntentHash: intent,
        resume: false,
        publish: true,
      }),
    ).toMatchObject({ action: "refuse" });
    // Recording a new plan over an outstanding batch is refused at the store.
    await expect(
      recordPlanningLedger({
        root,
        app: APP,
        scopeId: SCOPE,
        planningIntentHash: intent,
        plan: planFor(2),
        provenance,
        now: at(3),
      }),
    ).rejects.toThrow(/prepared batch/);
    expect(
      preparedPlanningRecoveryDecision({
        ledger: prepared.ledger,
        currentIntentHash: intent,
        resume: true,
        publish: true,
      }),
    ).toEqual({ action: "recover" });
  });

  it("binds prepared recovery to requested stage rather than mutable inferred stage", () => {
    const requested = planningRecoveryIntentHash({
      goal: "corpus goal",
      requestedStage: "mature",
      planning: { expectedTickets: "complete" },
      creatorScope: null,
    });
    const sameRequestDifferentEvidence = planningRecoveryIntentHash({
      goal: "corpus goal",
      requestedStage: "mature",
      planning: { expectedTickets: "complete" },
      creatorScope: null,
    });
    const differentRequest = planningRecoveryIntentHash({
      goal: "corpus goal",
      requestedStage: "bootstrap",
      planning: { expectedTickets: "complete" },
      creatorScope: null,
    });
    expect(requested).toBe(sameRequestDifferentEvidence);
    expect(requested).not.toBe(differentRequest);
  });
});

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "cf-reg-374-"));
  roots.push(root);
  return root;
}

function at(step: number): Date {
  return new Date(Date.UTC(2026, 7, 12, 12, 0, step));
}

function planFor(count: number): TicketPlan {
  return {
    stage: "mature",
    ticketCountRationale: `${count} independent slices exercise bounded publication admission.`,
    releaseDisposition: "no-release",
    releaseKind: "merge-only",
    tickets: Array.from({ length: count }, (_, index) => ({
      title: `Corpus ticket ${index + 1}`,
      goal: `Deliver corpus slice ${index + 1}`,
      context: "bounded corpus slice",
      acceptanceCriteria: ["slice lands"],
      fileScope: [`src/slice-${index + 1}.ts`],
      outOfScope: "everything else",
      notesForBuilder: "none",
      dependsOn: [],
      executionGroup: `slice-${index + 1}`,
    })),
  } as unknown as TicketPlan;
}

function published(indexes: readonly number[]): PublishedTicket[] {
  return indexes.map((index) => ({
    index,
    issueNumber: 1000 + index,
    title: `Corpus ticket ${index + 1}`,
    ready: true,
    labels: [],
  }));
}
