import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { validateTurnAssignment } from "../../../src/runtime/assignment.js";
import type { TurnResult } from "../../../src/runtime/types.js";
import { assertTurnResultContract } from "../../src/contracts/turn-result.js";

const validResult: TurnResult = {
  status: "completed",
  summary: "fixture completed",
  artifacts: [],
  session: { runtime: "pi", id: "session-1" },
  usage: {
    tokensIn: 10,
    tokensOut: 2,
    costUsd: 0.01,
    subagentTurns: 0,
    wallClockMs: 100,
    quality: "complete",
  },
  escalations: [],
};

describe("normalized provider contracts", () => {
  it("accepts one strict normalized turn-result envelope", () => {
    expect(() => assertTurnResultContract(validResult)).not.toThrow();
  });

  it("rejects malformed or economically impossible evidence", () => {
    expect(() =>
      assertTurnResultContract({ ...validResult, status: "success" }),
    ).toThrow(/status/);
    expect(() =>
      assertTurnResultContract({
        ...validResult,
        usage: { ...validResult.usage, costUsd: -1 },
      }),
    ).toThrow(/costUsd/);
    expect(() =>
      assertTurnResultContract({ ...validResult, claimedPass: true }),
    ).toThrow(/unknown key/);
    expect(() =>
      assertTurnResultContract({
        ...validResult,
        usage: { ...validResult.usage, tokensOut: 1.5 },
      }),
    ).toThrow(/tokensOut/);
    expect(() =>
      assertTurnResultContract({
        ...validResult,
        usage: { ...validResult.usage, quality: "unavailable" },
      }),
    ).toThrow(/missing usage/);
    expect(() =>
      assertTurnResultContract({ ...validResult, errorCode: "contradictory_success" }),
    ).toThrow(/errorCode/);
  });

  it("round-trips every supported atomic harness/model/effort assignment", () => {
    const harness = fc.constantFrom("claude", "codex", "pi");
    const model = fc
      .stringMatching(/^[a-z0-9][a-z0-9._-]{0,30}$/)
      .filter((value) => value.trim() === value);
    const effort = fc.constantFrom("low", "medium", "high", "xhigh");

    fc.assert(
      fc.property(harness, model, effort, (generatedHarness, generatedModel, generatedEffort) => {
        const assignment = {
          harness: generatedHarness,
          model: generatedModel,
          effort: generatedEffort,
        };
        expect(validateTurnAssignment(assignment)).toEqual(assignment);
      }),
      { numRuns: 200, seed: 20260729 },
    );
  });
});
