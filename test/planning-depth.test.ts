// Adaptive planning policy: deterministic depth floors, pass routing, and
// pre-execution cost estimation. Prompt length is intentionally not an input.

import { describe, expect, it } from "vitest";
import {
  decidePlanningDepth,
  estimatePlanningCost,
  routePlanningPasses,
} from "../src/org/planning-depth.js";
import type { PassConfig } from "../src/loop/pipelines.js";
import type { RoleConfig } from "../src/runtime/types.js";
import type { TurnRecord } from "../src/runtime/telemetry.js";

const PLANNER: RoleConfig = {
  name: "planner",
  runtime: "claude",
  model: "planner-model",
  effort: "high",
  delegation: { allow: [] },
  triggers: [],
  outputs: ["tickets"],
  maxTurnBudgetUsd: 10,
};

describe("adaptive planning depth", () => {
  it("routes a short security task deep and a long bounded reversible task quick", () => {
    const short = decidePlanningDepth({
      goal: "Rotate auth keys",
      stage: "mature",
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

    expect(short.depth).toBe("deep");
    expect(short.factors.sensitiveDomains).toContain("security/auth/secrets");
    expect(long.depth).toBe("quick");
  });

  it("uses standard for moderate work and a human quick request cannot lower a hard floor", () => {
    expect(decidePlanningDepth({ goal: "Improve search filters", stage: "mature" }).depth).toBe("standard");
    const floored = decidePlanningDepth({
      goal: "Deploy a database schema migration",
      stage: "mature",
      minimumDepth: "quick",
      sensitiveDomains: ["data/schema"],
    });
    expect(floored.depth).toBe("deep");
    expect(floored.decisionFactors.some((factor) => factor.includes("could not lower"))).toBe(true);
  });

  it("selects one, three, or five passes and does not require plan-bootstrap in a legacy org", () => {
    const quick = decidePlanningDepth({
      goal: "bounded fix",
      stage: "mature",
      riskTier: "low",
      ambiguity: "low",
      coupling: "low",
      expectedTickets: "1-2",
    });
    const standard = decidePlanningDepth({ goal: "moderate feature", stage: "mature" });
    const deep = decidePlanningDepth({
      goal: "payment migration",
      stage: "mature",
      sensitiveDomains: ["payments"],
    });

    expect(routePlanningPasses(quick, "mature", ["plan"]).selectedPasses).toEqual(["decomposer"]);
    expect(routePlanningPasses(standard, "mature", ["plan"]).selectedPasses).toEqual([
      "visionary",
      "pm-a",
      "decomposer",
    ]);
    const deepRoute = routePlanningPasses(deep, "mature", ["plan"]);
    expect(deepRoute.selectedPasses).toEqual(["visionary", "pm-a", "pm-b", "arbitrator", "decomposer"]);
    expect(deepRoute.skippedPasses).toEqual([]);

    // Legacy org from the incident: bootstrap pipeline absent. Quick planning
    // falls back to the plan/decomposer route instead of "unknown pipeline".
    expect(routePlanningPasses(quick, "bootstrap", ["plan"])).toMatchObject({
      pipeline: "plan",
      selectedPasses: ["decomposer"],
    });
  });

  it("estimates from historical medians and reports caps only as an upper bound", () => {
    const passes: PassConfig[] = [
      { id: "visionary", role: "planner", template: "visionary.md" },
      { id: "decomposer", role: "planner", template: "decomposer.md" },
    ];
    const estimate = estimatePlanningCost({
      selectedPasses: passes,
      roles: { planner: PLANNER },
      history: [row("visionary", 1), row("visionary", 3), row("decomposer", 2)],
    });
    expect(estimate).toMatchObject({ estimatedCostUsd: 4, upperBoundUsd: 20 });
    expect(estimate.basis).toContain("median");
    expect(estimate.basis).toContain("upper bound, not expected cost");

    const unavailable = estimatePlanningCost({ selectedPasses: passes, roles: { planner: PLANNER }, history: [] });
    expect(unavailable.estimatedCostUsd).toBeNull();
    expect(unavailable.upperBoundUsd).toBe(20);
  });
});

function row(pass: string, costUsd: number): TurnRecord {
  return {
    at: "2026-07-11T00:00:00Z",
    role: "planner",
    runtime: "claude",
    model: "planner-model",
    status: "completed",
    tokensIn: 1,
    tokensOut: 1,
    costUsd,
    usageQuality: "complete",
    subagentTurns: 0,
    wallClockMs: 1,
    escalations: 0,
    app: "alpha",
    runId: `run-${pass}-${costUsd}`,
    traceId: "trace",
    pipeline: "plan",
    pass,
  };
}
