// CF-INV-ACC-4 — HB-130 — invariants.md INV-ACC-4; rubric.md §6 plan-gate criteria.

// Who may resolve the plan gate, and on what (L1).
//
// F-PT-030 resolved 2026-08-07: a declared `plan_gate` policy may resolve the
// gate unattended. What it did NOT change is the criteria — rubric §6 still
// decides eligibility, and an auto-continue that waved through a scenario below
// the bar would be the finding this whole lane exists to produce, produced by
// the harness against itself.

import { describe, expect, it } from "vitest";
import type { PlanGatePolicy } from "../../campaign/acceptance/campaign-config.js";
import { PLAN_GATE_AXES, resolvePlanGate } from "../../campaign/acceptance/plan-gate.js";
import type { AxisScoreValue } from "../../campaign/acceptance/verdict-algebra.js";

const AUTO: PlanGatePolicy = { kind: "auto-continue", criteria: "rubric-6-attempted-on-P-1-and-P-5" };
const HUMAN: PlanGatePolicy = { kind: "human" };

function scores(overrides: Record<string, AxisScoreValue> = {}): Record<string, AxisScoreValue> {
  return { "P-1": 2, "P-2": 3, "P-3": 1, "P-4": 2, "P-5": 2, "P-6": 3, ...overrides };
}

describe("CF-INV-ACC-4 (L1) rubric §6 decides eligibility", () => {
  it("names exactly the two axes the ratified rubric names", () => {
    expect([...PLAN_GATE_AXES]).toEqual(["P-1", "P-5"]);
  });

  it("continues under a declared auto-continue policy when every scenario cleared P-1 and P-5", () => {
    const outcome = resolvePlanGate(AUTO, [
      { scenarioId: "S-ACC-1", scores: scores() },
      { scenarioId: "S-ACC-2", scores: scores({ "P-1": 1, "P-5": 1 }) },
    ]);
    expect(outcome.decision).toBe("continue");
    expect(outcome.shortfalls).toEqual([]);
    expect(outcome.resolutions).toHaveLength(2);
    expect(outcome.resolutions.every((resolution) => resolution.resolvedBy === "declared-policy")).toBe(true);
  });

  it("records the resolution WITH the scores it acted on", () => {
    const outcome = resolvePlanGate(AUTO, [{ scenarioId: "S-ACC-1", scores: scores({ "P-3": "ungraded" }) }]);
    expect(outcome.resolutions[0]?.scores).toEqual({
      "P-1": 2,
      "P-2": 3,
      "P-3": "ungraded",
      "P-4": 2,
      "P-5": 2,
      "P-6": 3,
    });
    expect(outcome.resolutions[0]?.reason).toContain("auto-continue");
  });

  it("negative control: an auto-continue must NOT proceed with a scenario below rubric §6", () => {
    const outcome = resolvePlanGate(AUTO, [
      { scenarioId: "S-ACC-1", scores: scores() },
      { scenarioId: "S-ACC-2", scores: scores({ "P-1": 0 }) },
    ]);
    expect(outcome.decision).toBe("stop");
    expect(outcome.shortfalls).toEqual(["S-ACC-2/P-1"]);
    expect(outcome.resolutions.every((resolution) => resolution.decision === "stop")).toBe(true);
  });

  it("negative control: `ungraded` on P-1 or P-5 is not `attempted`", () => {
    for (const axis of PLAN_GATE_AXES) {
      const outcome = resolvePlanGate(AUTO, [{ scenarioId: "S-ACC-1", scores: scores({ [axis]: "ungraded" }) }]);
      expect(outcome.decision).toBe("stop");
      expect(outcome.shortfalls).toEqual([`S-ACC-1/${axis}`]);
    }
  });

  it("negative control: a missing P-1 or P-5 entirely is a shortfall, not a pass by absence", () => {
    const partial: Record<string, AxisScoreValue> = { "P-2": 3, "P-5": 2 };
    expect(resolvePlanGate(AUTO, [{ scenarioId: "S-ACC-1", scores: partial }]).shortfalls).toEqual(["S-ACC-1/P-1"]);
  });

  it("one app scenario below the bar stops every paid arm for the campaign", () => {
    const outcome = resolvePlanGate(AUTO, [
      { scenarioId: "S-ACC-1", scores: scores() },
      { scenarioId: "S-ACC-2", scores: scores() },
      { scenarioId: "S-ACC-4", scores: scores({ "P-5": 0 }) },
    ]);
    expect(outcome.decision).toBe("stop");
    expect(outcome.resolutions.map((resolution) => resolution.decision)).toEqual(["stop", "stop", "stop"]);
  });

  it("the job scenario is omitted from plan scores because rubric §9 gives it no Planner", () => {
    const outcome = resolvePlanGate(AUTO, [
      { scenarioId: "S-ACC-1", scores: scores() },
      { scenarioId: "S-ACC-2", scores: scores() },
    ]);
    expect(outcome.decision).toBe("continue");
    expect(outcome.resolutions.map((resolution) => resolution.scenarioId)).not.toContain("S-ACC-3");
  });

  it("a stop names the shortfall as the actionable finding it is, never as a failure", () => {
    const outcome = resolvePlanGate(AUTO, [{ scenarioId: "S-ACC-1", scores: scores({ "P-1": 0 }) }]);
    expect(outcome.resolutions[0]?.reason).toContain("successful campaign");
  });
});

describe("CF-INV-ACC-4 (L1) the human policy", () => {
  it("waits for a human decision rather than defaulting to continue", () => {
    const outcome = resolvePlanGate(HUMAN, [{ scenarioId: "S-ACC-1", scores: scores() }]);
    expect(outcome.awaitingHuman).toBe(true);
    expect(outcome.decision).toBe("stop");
  });

  it("continues once the human authorizes it", () => {
    const outcome = resolvePlanGate(HUMAN, [{ scenarioId: "S-ACC-1", scores: scores() }], "continue");
    expect(outcome.decision).toBe("continue");
    expect(outcome.awaitingHuman).toBe(false);
    expect(outcome.resolutions[0]?.resolvedBy).toBe("human");
  });

  it("negative control: a human cannot wave through a scenario the rubric §6 criteria failed", () => {
    const outcome = resolvePlanGate(HUMAN, [{ scenarioId: "S-ACC-1", scores: scores({ "P-5": 0 }) }], "continue");
    expect(outcome.decision).toBe("stop");
    expect(outcome.shortfalls).toEqual(["S-ACC-1/P-5"]);
  });

  it("a human `stop` is honored even when the criteria are met", () => {
    expect(resolvePlanGate(HUMAN, [{ scenarioId: "S-ACC-1", scores: scores() }], "stop").decision).toBe("stop");
  });
});
