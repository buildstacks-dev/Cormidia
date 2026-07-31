// Historical/reporting projection only. EpisodePlan tests own live workflow,
// assignment, budget, and planner-bypass behavior.

import { describe, expect, it } from "vitest";
import { decidePlanningDepth } from "../src/org/planning-depth.js";

describe("legacy planning-depth reporting projection", () => {
  it("keeps the display depth separate from deterministic safety projection", () => {
    const short = decidePlanningDepth({
      goal: "Rotate auth keys",
      stage: "mature",
      workLifecycle: "bounded-goal",
      ambiguity: "low",
      expectedTickets: "1-2",
      sensitiveDomains: ["security/auth/secrets"],
    });
    const long = decidePlanningDepth({
      goal: "Rewrite the wording in one local documentation page. ".repeat(100),
      stage: "mature",
      riskTier: "low",
      ambiguity: "low",
      coupling: "low",
      reversibility: "reversible",
      externalConsequence: "none",
      expectedTickets: "1-2",
    });

    expect(short.depth).toBe("quick");
    expect(short.executionRoute).toBe("deep");
    expect(short.factors.sensitiveDomains).toContain("security/auth/secrets");
    expect(long.depth).toBe("quick");
  });

  it("allows a human reporting floor without creating a planner bypass", () => {
    const floored = decidePlanningDepth({
      goal: "Deploy a database schema migration",
      stage: "mature",
      workLifecycle: "bounded-goal",
      ambiguity: "low",
      expectedTickets: "1-2",
      minimumDepth: "quick",
      sensitiveDomains: ["data/schema"],
    });
    expect(floored.depth).toBe("quick");
    expect(floored.executionRoute).toBe("deep");

    const raised = decidePlanningDepth({
      goal: "Existing bounded copy-edit ticket",
      stage: "mature",
      workLifecycle: "existing-ticket",
      ambiguity: "low",
      minimumDepth: "standard",
    });
    expect(raised.depth).toBe("standard");
    expect(raised.disposition).toBe("shape-ticket");
    expect(raised.decisionFactors).toContain("human minimum depth raised route to standard");
  });

  it("never represents an existing-ticket label as direct execution", () => {
    const decision = decidePlanningDepth({
      goal: "Issue #7 names the symptom but still has competing product outcomes",
      stage: "mature",
      workLifecycle: "existing-ticket",
      ambiguity: "high",
    });

    expect(decision).toMatchObject({ depth: "deep", disposition: "plan-strategy" });
    expect(decision.decisionFactors).toContain("high ambiguity earns competing product perspectives");
  });
});
