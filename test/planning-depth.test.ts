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
  it("keeps execution safety floors separate from planning ceremony", () => {
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

  it("uses standard for milestone work and a human override can raise planning without lowering execution safety", () => {
    expect(decidePlanningDepth({ goal: "Improve search filters", stage: "mature" }).depth).toBe("standard");
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
    expect(raised.decisionFactors).not.toContain(
      "existing scoped ticket bypasses pre-ticket planning and enters build/review",
    );
    expect(raised.decisionFactors).toContain("human minimum depth raised route to standard");
  });

  it("does not bypass planning when an existing ticket still carries high ambiguity", () => {
    const decision = decidePlanningDepth({
      goal: "Issue #7 names the symptom but still has competing product outcomes",
      stage: "mature",
      workLifecycle: "existing-ticket",
      ambiguity: "high",
    });

    expect(decision).toMatchObject({ depth: "deep", disposition: "plan-strategy" });
    expect(routePlanningPasses(decision, "mature", ["plan"]).selectedPasses).toEqual([
      "visionary",
      "pm-a",
      "pm-b",
      "arbitrator",
      "decomposer",
    ]);
    expect(decision.decisionFactors).toContain("high ambiguity earns competing product perspectives");
  });

  it("covers the admission matrix: existing ticket, typo, small feature, milestone, sensitive write, and strategy", () => {
    const existing = decidePlanningDepth({
      goal: "Issue #7 already has file scope and binary criteria",
      stage: "mature",
      workLifecycle: "existing-ticket",
    });
    const quick = decidePlanningDepth({
      goal: "Fix the hero typo",
      stage: "mature",
      workLifecycle: "bounded-goal",
      riskTier: "low",
      ambiguity: "low",
      coupling: "low",
      expectedTickets: "1-2",
    });
    const smallFeature = decidePlanningDepth({
      goal: "Add one bounded export button",
      stage: "mature",
      workLifecycle: "bounded-goal",
      ambiguity: "medium",
      expectedTickets: "1-2",
    });
    const milestone = decidePlanningDepth({ goal: "Launch the greenfield product", stage: "bootstrap" });
    const sensitive = decidePlanningDepth({
      goal: "Store payment details",
      stage: "mature",
      workLifecycle: "bounded-goal",
      ambiguity: "low",
      expectedTickets: "1-2",
      sensitiveDomains: ["payments"],
    });
    const strategy = decidePlanningDepth({
      goal: "Choose between competing market strategies",
      stage: "mature",
      workLifecycle: "strategy",
      ambiguity: "high",
    });

    expect(routePlanningPasses(existing, "mature", ["plan"])).toMatchObject({
      disposition: "direct-execution",
      pipeline: null,
      selectedPasses: [],
    });
    expect(routePlanningPasses(quick, "mature", ["plan"]).selectedPasses).toEqual(["decomposer"]);
    expect(routePlanningPasses(smallFeature, "mature", ["plan"]).selectedPasses).toEqual(["decomposer"]);
    expect(routePlanningPasses(milestone, "bootstrap", ["plan", "plan-bootstrap"]).selectedPasses).toEqual([
      "bootstrap-plan",
    ]);
    expect(routePlanningPasses(sensitive, "mature", ["plan"]).selectedPasses).toEqual(["decomposer"]);
    expect(sensitive.executionRoute).toBe("deep");
    expect(routePlanningPasses(decidePlanningDepth({ goal: "moderate feature", stage: "mature" }), "mature", ["plan"]).selectedPasses).toEqual([
      "visionary",
      "pm-a",
      "decomposer",
    ]);
    const deepRoute = routePlanningPasses(strategy, "mature", ["plan"]);
    expect(deepRoute.selectedPasses).toEqual(["visionary", "pm-a", "pm-b", "arbitrator", "decomposer"]);
    expect(deepRoute.skippedPasses).toEqual([]);
    expect(deepRoute.passRationales.find((entry) => entry.pass === "pm-b")?.expectedRiskReduction).toContain("competing strategy");

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

    const unrelatedPassCollision = estimatePlanningCost({
      selectedPasses: [{ id: "decomposer", role: "planner", template: "decomposer.md" }],
      roles: { planner: PLANNER },
      history: [{ ...row("decomposer", 999), pipeline: "review" }, row("decomposer", 2)],
    });
    expect(unrelatedPassCollision.estimatedCostUsd).toBe(2);

    const unavailable = estimatePlanningCost({ selectedPasses: passes, roles: { planner: PLANNER }, history: [] });
    expect(unavailable.estimatedCostUsd).toBeNull();
    expect(unavailable.upperBoundUsd).toBe(20);
  });

  it("compares planning cost with parent-task-linked downstream failures and stays explicit when cohorts are absent", () => {
    const passes: PassConfig[] = [
      { id: "visionary", role: "planner", template: "visionary.md" },
      { id: "decomposer", role: "planner", template: "decomposer.md" },
    ];
    const history = [
      taskRow("selected-ok", "plan", "visionary", "completed"),
      taskRow("selected-ok", "plan", "decomposer", "completed"),
      taskRow("selected-ok", "build", "implement", "completed"),
      taskRow("lower-failed", "plan", "decomposer", "completed"),
      taskRow("lower-failed", "build", "implement", "failed"),
    ];
    const measured = estimatePlanningCost({ selectedPasses: passes, roles: { planner: PLANNER }, history });
    expect(measured.outcomeMeasurement).toMatchObject({
      status: "measured",
      comparableEpisodes: 1,
      lowerPassEpisodes: 1,
      comparableDownstreamFailureRate: 0,
      lowerPassDownstreamFailureRate: 1,
      observedFailureRateDelta: 1,
    });
    expect(estimatePlanningCost({ selectedPasses: passes, roles: { planner: PLANNER }, history: [] }).outcomeMeasurement.status).toBe("unavailable");
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

function taskRow(
  parentTaskId: string,
  pipeline: string,
  pass: string,
  status: TurnRecord["status"],
): TurnRecord {
  return { ...row(pass, 1), parentTaskId, pipeline, status, runId: `${parentTaskId}-${pipeline}-${pass}` };
}
