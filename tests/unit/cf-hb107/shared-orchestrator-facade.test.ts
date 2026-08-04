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
    expect(facadeViolations(`${roadmapPlanning}\nexecuteAcceptedEpisodePlan({});`))
      .toContain("direct accepted-plan execution bypass");
    expect(facadeViolations(`${ticketDelivery}\nprepareEpisodePlanWithRuntime({});`))
      .toContain("direct episode-planner preparation bypass");
  });

  it("retains separate RoadmapPlan and EpisodePlan schemas and authority persistence", async () => {
    const [roadmapDelivery, episodePlan, roadmapPlanning] = await Promise.all([
      source("src/org/roadmap-delivery.ts"),
      source("src/loop/episode-plan.ts"),
      source("src/org/plan-auto.ts"),
    ]);
    expect(roadmapDelivery).toContain("export interface RoadmapPlan {");
    expect(episodePlan).toContain("export interface EpisodePlan {");
    expect(roadmapPlanning).toContain("await persistPublishedRoadmap({");
    expect(roadmapPlanning).toContain("await orchestrateEpisode({");
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
