// CF-REG-369 (L1) — disposition-specific TicketPlan ordering. Seeded plans
// prove the detector fires; corrected controls prove the intended graph passes.

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type { PlanTicket, TicketPlan } from "../../../src/loop/plan-tickets.js";
import { type ProductDocPlanningState, productDocPlanProblems } from "../../../src/org/product-doc-planning.js";

const DOCS = ["docs/VISION.md", "docs/REQUIREMENTS.md", "docs/ARCHITECTURE.md"];

describe("CF-REG-369 — product-doc planning policy", () => {
  it("wires the disposition guard before both provider construction and publication", async () => {
    const source = await readFile(new URL("../../../src/org/plan-auto.ts", import.meta.url), "utf8");
    const policy = await readFile(new URL("../../../src/org/product-doc-planning.ts", import.meta.url), "utf8");
    const publication = await readFile(
      new URL("../../../src/org/planning-coverage-publication.ts", import.meta.url),
      "utf8",
    );
    expect(publicationGuardProblems(source, policy, publication)).toEqual([]);

    const seededBypass = source.replace(
      "const productDocs = await prepareProductDocPlanning(productDocPlanningInput);",
      "const productDocs = await Promise.resolve({ kind: 'unscaffolded' as const }); // removed guard",
    );
    expect(publicationGuardProblems(seededBypass, policy, publication)).toEqual(["product-doc guard missing"]);

    const seededStaleResume = source.replace(
      "await assertCurrentProductDocTicketPlan(productDocPlanningInput, productDocs, plan);",
      "await Promise.resolve(); // removed publication disposition and plan reread",
    );
    expect(publicationGuardProblems(seededStaleResume, policy, publication)).toEqual(["publication recheck missing"]);

    const seededCentralBypass = publication.replace(
      "await input.beforePublish?.(coverage.plan);",
      "await Promise.resolve(); // removed centralized pre-publication callback",
    );
    expect(publicationGuardProblems(source, policy, seededCentralBypass)).toEqual([
      "publication guard callback missing",
    ]);

    const seededInMemoryOnly = policy.replace(
      "const current = await prepareProductDocPlanning(input);",
      "const current = expected; // removed persisted disposition reread",
    );
    expect(publicationGuardProblems(source, seededInMemoryOnly, publication)).toEqual([
      "publication disposition reread missing",
    ]);
  });

  it("reconcile orders TypeScript implementation after exactly one documentation unit", () => {
    const state = planningState("typescript-node", "reconcile");
    const passing = plan([
      ticket("product-doc-reconciliation-v1", [], DOCS),
      ticket("implementation", [0], ["src/index.ts"]),
    ]);
    expect(productDocPlanProblems(passing, state)).toEqual([]);

    const seededUnordered = plan([
      ticket("product-doc-reconciliation-v1", [], DOCS.slice(0, 2)),
      ticket("implementation", [], ["src/index.ts"]),
    ]);
    expect(productDocPlanProblems(seededUnordered, state)).toEqual([
      "product-doc reconciliation ticket does not cover docs/ARCHITECTURE.md",
      "ticket 1 does not depend on product-doc reconciliation ticket 0",
    ]);
  });

  it("bare reconcile orders stack, documentation, then implementation within the bootstrap budget", () => {
    const state = planningState("bare", "reconcile");
    const passing = plan([
      ticket("bare-stack-and-gates-v1", [], ["package.json"]),
      ticket("product-doc-reconciliation-v1", [0], DOCS),
      ticket("implementation", [1], ["src/main.ts"]),
    ]);
    expect(productDocPlanProblems(passing, state)).toEqual([]);

    const seededBypass = plan([
      ticket("bare-stack-and-gates-v1", [], ["package.json"]),
      ticket("product-doc-reconciliation-v1", [], DOCS),
      ticket("implementation", [0], ["src/main.ts"]),
    ]);
    expect(productDocPlanProblems(seededBypass, state)).toEqual([
      "bare product-doc reconciliation ticket must depend on stack-and-gates work",
      "ticket 2 does not depend on product-doc reconciliation ticket 1",
    ]);
  });

  it("keep/remove add no documentation unit and bare work still follows stack establishment", () => {
    const keep = planningState("typescript-node", "keep");
    expect(productDocPlanProblems(plan([ticket("implementation", [], ["src/index.ts"])]), keep)).toEqual([]);
    expect(productDocPlanProblems(plan([ticket("product-doc-reconciliation-v1", [], DOCS)]), keep)).toContain(
      "product-doc reconciliation work is unnecessary",
    );

    const remove = planningState("bare", "remove");
    expect(
      productDocPlanProblems(
        plan([ticket("bare-stack-and-gates-v1", [], ["package.json"]), ticket("implementation", [0], ["src/main.ts"])]),
        remove,
      ),
    ).toEqual([]);
    const seededRegeneration = productDocPlanProblems(
      plan([ticket("bare-stack-and-gates-v1", [], ["package.json"]), ticket("implementation", [], ["docs/VISION.md"])]),
      remove,
    );
    expect(seededRegeneration).toContain("ticket 1 does not depend on bare stack-and-gates ticket 0");
    expect(seededRegeneration).toContain("remove disposition forbids planned regeneration of docs/VISION.md");
  });
});

function planningState(
  template: "typescript-node" | "bare",
  disposition: "keep" | "reconcile" | "remove",
): ProductDocPlanningState {
  return { kind: "scaffolded", template, disposition, decisionHash: "d".repeat(64), documentPaths: DOCS };
}

function plan(tickets: PlanTicket[]): TicketPlan {
  return {
    stage: "bootstrap",
    ticketCountRationale: "smallest independently reviewable units",
    releaseDisposition: "human merge after required checks",
    releaseKind: "merge-only",
    tickets,
  };
}

function ticket(executionGroup: string, dependsOn: number[], fileScope: string[]): PlanTicket {
  return {
    title: executionGroup,
    tier: "op:tier-standard",
    priority: "p2",
    dependsOn,
    executionGroup,
    fileScope,
    goal: "bounded outcome",
    context: "test fixture",
    acceptanceCriteria: ["outcome is observable"],
    outOfScope: "release",
    notesForBuilder: "follow the contract",
  };
}

function publicationGuardProblems(source: string, policy: string, publicationSource: string): string[] {
  const guard = source.indexOf("const productDocs = await prepareProductDocPlanning({");
  const boundGuard = source.indexOf("const productDocs = await prepareProductDocPlanning(productDocPlanningInput);");
  const provider = source.indexOf("const orchestrated = await orchestrateEpisode({");
  const publicationRecheck = source.indexOf("await assertCurrentProductDocTicketPlan(");
  const publicationCall = source.indexOf("const publication = await publishAutoPlanningCoverage(");
  const callback = publicationSource.indexOf("await input.beforePublish?.(coverage.plan);");
  const publication = publicationSource.indexOf("await publishPlanProjection(");
  if (guard < 0 && boundGuard < 0) return ["product-doc guard missing"];
  return [
    ...(provider < 0 || Math.max(guard, boundGuard) > provider
      ? ["product-doc guard follows provider construction"]
      : []),
    ...(publicationRecheck < 0 ? ["publication recheck missing"] : []),
    ...(callback < 0 ? ["publication guard callback missing"] : []),
    ...(!policy.includes("const current = await prepareProductDocPlanning(input);")
      ? ["publication disposition reread missing"]
      : []),
    ...(publicationCall < 0 || Math.max(guard, boundGuard) > publicationCall
      ? ["product-doc guard follows issue publication"]
      : []),
    ...(callback > publication ? ["publication recheck follows issue publication"] : []),
  ];
}
