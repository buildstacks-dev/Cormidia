import { describe, expect, it } from "vitest";
import { failedArmRows } from "../../campaign/acceptance/campaign-arms.js";
import type { AxisGraderResolution } from "../../campaign/acceptance/grader-independence.js";

const grader = {
  id: "sol",
  assignment: { harness: "codex", model: "gpt-5.6-sol", effort: "xhigh" } as const,
};

describe("CF-B27-ARM-FAIL — a failed product command is never graded", () => {
  it("turns every affected axis into an explicit nonnumeric gap", () => {
    const resolutions: AxisGraderResolution[] = [
      { axis: "P-1", status: "mechanical" },
      {
        axis: "P-5",
        status: "assigned",
        grader,
        graderFamily: "openai",
        appliedDisjointnessFamilies: ["anthropic"],
        appliedReadTurnIds: ["plan"],
      },
    ];

    const rows = failedArmRows(resolutions);
    expect(rows.map((row) => row.score)).toEqual(["ungraded", "ungraded"]);
    expect(rows.map((row) => row.ungradedReason)).toEqual(["arm-command-failed", "arm-command-failed"]);
    expect(rows[1]?.grader).toEqual(grader.assignment);
  });
});
