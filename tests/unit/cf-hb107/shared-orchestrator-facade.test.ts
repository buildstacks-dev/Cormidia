// HB-107 — planning and delivery share the org episode façade while
// RoadmapPlan and EpisodePlan remain separate authorities (C-OP-PLAN/LOOP/BATCH).

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("HB-107 — shared orchestrateEpisode façade wiring", () => {
  it("routes both product-roadmap planning and ticket delivery through the façade", async () => {
    const [roadmapPlanning, ticketDelivery] = await Promise.all([
      source("src/org/plan-auto.ts"),
      source("src/org/ticket-episode-runtime.ts"),
    ]);
    expect(facadeViolations(roadmapPlanning)).toEqual([]);
    expect(facadeViolations(ticketDelivery)).toEqual([]);
    expect(roadmapPlanning).toContain("await orchestrateEpisode({");
    expect(ticketDelivery.match(/await orchestrateEpisode\(\{/g)?.length).toBeGreaterThanOrEqual(2);
    expect(ticketDelivery).toContain("await prepareExecutionAffinityTurn({");
    expect(ticketDelivery).toContain("await settleExecutionAffinityTurn({");

    // Seeded negative control: reintroducing either split coordinator call is
    // detected even when the shared façade import remains nearby.
    expect(facadeViolations(`${roadmapPlanning}\nexecuteAcceptedEpisodePlan({});`)).toContain(
      "direct accepted-plan execution bypass",
    );
    expect(facadeViolations(`${ticketDelivery}\nprepareEpisodePlanWithRuntime({});`)).toContain(
      "direct episode-planner preparation bypass",
    );
  });

  it("retains separate RoadmapPlan and EpisodePlan schemas and authority persistence", async () => {
    // changelog 2026-08-12 (F-PT-039 / HB-155): the coverage modules this case
    // read were deleted with the pre-read. The property it defends is unchanged
    // and now reads the publication ledger that replaced them: RoadmapPlan and
    // EpisodePlan stay separate schemas, and prepared-publication recovery is
    // still decided BEFORE sources are resolved (recovering an outstanding
    // GitHub effect outranks new planning work).
    const [roadmapModel, episodePlan, roadmapPlanning, ledgerPublish] = await Promise.all([
      source("src/org/roadmap-delivery/roadmap-model.ts"),
      source("src/loop/episode-plan.ts"),
      source("src/org/plan-auto.ts"),
      source("src/org/planning-publication-publish.ts"),
    ]);
    expect(roadmapModel).toContain("export interface RoadmapPlan {");
    expect(episodePlan).toContain("export interface EpisodePlan {");
    expect(roadmapPlanning).toContain("persistPublishedRoadmap({");
    expect(ledgerPublish).toContain("await input.persistRoadmap({");
    expect(roadmapPlanning).toContain("await orchestrateEpisode({");
    expect(roadmapPlanning.indexOf("preparedPlanningRecoveryDecision({")).toBeLessThan(
      roadmapPlanning.indexOf("resolveAutoPlanSources(options"),
    );
  });
});

function facadeViolations(contents: string): string[] {
  const violations: string[] = [];
  if (/\bexecuteAcceptedEpisodePlan\s*\(/.test(contents)) {
    violations.push("direct accepted-plan execution bypass");
  }
  if (/\bprepareEpisodePlanWithRuntime\s*\(/.test(contents)) {
    violations.push("direct episode-planner preparation bypass");
  }
  return violations;
}

async function source(path: string): Promise<string> {
  return readFile(new URL(`../../../${path}`, import.meta.url), "utf8");
}
