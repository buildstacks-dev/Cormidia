// HB-001 lane negative control — INTENTIONALLY RED. Never merge.
// Proves the per-commit CI lane actually fails on a failing spec
// (policy ci.per_commit_gate_class: blocking, fail-closed; skill rule 16:
// a gate that has never fired is an assumption). Opened as a draft PR,
// observed red, then closed — this file must never reach main.
import { describe, expect, it } from "vitest";

describe("HB-001 lane negative control (intentionally red)", () => {
  it("fails deliberately so the CI lane proves it can turn red", () => {
    expect("the lane can fire").toBe("green by absence");
  });
});
