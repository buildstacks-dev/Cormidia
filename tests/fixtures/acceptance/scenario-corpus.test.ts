// Self-test for the fixture scenario corpus (HB-120). A fixture that lies is
// worse than no fixture: every detector downstream would be proving a property
// of the fixture rather than of the campaign.

import { describe, expect, it } from "vitest";
import { fixtureScenario, FIXTURE_SCENARIO_KINDS, PLANT_CATEGORIES, type PlantCategory } from "./scenario-corpus.js";

describe("fixtures/acceptance/scenario-corpus self-test", () => {
  it("walks a non-empty set of scenario kinds", () => {
    expect(FIXTURE_SCENARIO_KINDS.length).toBeGreaterThan(0);
    expect(new Set(FIXTURE_SCENARIO_KINDS).size).toBe(FIXTURE_SCENARIO_KINDS.length);
  });

  it("gives every kind all four plant categories, each with a unique token", () => {
    const seen = new Set<string>();
    for (const kind of FIXTURE_SCENARIO_KINDS) {
      const scenario = fixtureScenario(kind);
      for (const category of PLANT_CATEGORIES) {
        expect(scenario.plants[category]).toHaveLength(1);
      }
      expect(scenario.tokens).toHaveLength(PLANT_CATEGORIES.length);
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
    expect(scenario.tokens).toHaveLength(PLANT_CATEGORIES.length - 1);
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
