import { describe, expect, it } from "vitest";
import { EXECUTION_BOUNDARIES } from "../../../src/loop/execution-journal.js";

describe("Workstream F promoted production surface", () => {
  it("keeps every ratified execution boundary in the durable journal", () => {
    expect(EXECUTION_BOUNDARIES).toEqual([
      "route", "contract", "implementation", "push", "gates", "pr",
      "findings", "approvals", "merge", "release",
    ]);
  });
});
