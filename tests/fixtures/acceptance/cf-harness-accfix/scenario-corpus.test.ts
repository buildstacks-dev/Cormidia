// CF-HARNESS-ACCFIX — HB-120; case-catalog.md §0 and validation-policy.yaml
// `harness_self_tests`: acceptance scenario-corpus fixture self-test. A fixture
// that lies would make downstream detectors prove the fixture, not the campaign.

import { describe, expect, it } from "vitest";
import {
  fixtureScenario,
  FIXTURE_SCENARIO_KINDS,
  plantCategoriesFor,
  scenarioKindOf,
  type PlantCategory,
} from "../scenario-corpus.js";

describe("fixtures/acceptance/scenario-corpus self-test", () => {
  it("walks a non-empty set of scenario kinds", () => {
    expect(FIXTURE_SCENARIO_KINDS.length).toBeGreaterThan(0);
    expect(new Set(FIXTURE_SCENARIO_KINDS).size).toBe(FIXTURE_SCENARIO_KINDS.length);
  });

  it("gives every kind all four of ITS plant categories, each with a unique token", () => {
    const seen = new Set<string>();
    for (const kind of FIXTURE_SCENARIO_KINDS) {
      const scenario = fixtureScenario(kind);
      const categories = plantCategoriesFor(scenarioKindOf(kind));
      expect(categories).toHaveLength(4);
      for (const category of categories) {
        expect(scenario.plants[category], `${kind} ${category}`).toHaveLength(1);
      }
      expect(scenario.tokens).toHaveLength(categories.length);
      for (const token of scenario.tokens) {
        expect(seen.has(token)).toBe(false);
        seen.add(token);
      }
    }
  });

  it("keeps every plant token out of the brief by default", () => {
    for (const kind of FIXTURE_SCENARIO_KINDS) {
      const scenario = fixtureScenario(kind);
      for (const token of scenario.tokens) {
        expect(scenario.brief).not.toContain(token);
        expect(scenario.markdown).toContain(token);
      }
    }
  });

  it("seeds an assembly leak on demand — the token enters the grader-visible brief", () => {
    const scenario = fixtureScenario("greenfield", { leakIntoBrief: ["contradiction"] });
    const leaked = scenario.plants.contradiction[0];
    expect(leaked).toBeDefined();
    expect(scenario.brief).toContain("PLANT-CONTRADICTION-GREENFIELD");
  });

  it("seeds a partial key on demand — the omitted category is empty and absent from the file", () => {
    const omitted: PlantCategory = "tangent";
    const scenario = fixtureScenario("greenfield", { omitCategories: [omitted] });
    expect(scenario.plants[omitted]).toEqual([]);
    expect(scenario.markdown).not.toContain("PLANT-TANGENT-GREENFIELD");
    expect(scenario.tokens).toHaveLength(plantCategoriesFor("app").length - 1);
  });

  it("gives job scenarios the JOB category list, not the plan-axis one (rubric §9)", () => {
    const job = fixtureScenario("job");
    expect(job.scenarioKind).toBe("job");
    expect(Object.keys(job.plants).sort()).toEqual([
      "deliverable-constraint",
      "input-conflict",
      "tangent",
      "undiscoverable-answer",
    ]);
    expect(job.markdown).toContain("handoff fidelity");
    expect(job.markdown).not.toContain("(P-4)");
  });

  it("seeds unmapped plant vocabulary on demand", () => {
    const scenario = fixtureScenario("job", { unmappedLeadIn: "Vibes probe (Q-9)" });
    expect(scenario.markdown).toContain("**Vibes probe (Q-9):**");
  });

  it("puts the plants section after the brief, never before it", () => {
    for (const kind of FIXTURE_SCENARIO_KINDS) {
      const scenario = fixtureScenario(kind);
      const briefIndex = scenario.markdown.indexOf("## The brief");
      const plantsIndex = scenario.markdown.indexOf("## Plants");
      expect(briefIndex).toBeGreaterThanOrEqual(0);
      expect(plantsIndex).toBeGreaterThan(briefIndex);
      expect(scenario.markdown.startsWith(scenario.brief)).toBe(true);
      expect(scenario.brief.length).toBeLessThanOrEqual(plantsIndex);
    }
  });
});
