import { describe, expect, it } from "vitest";
import { productivePasses, settlementIntegrity, unionDurationMs } from "../../scripts/eval/metrics.js";

describe("efficiency metric oracles", () => {
  it("separates provider settlement from mechanical terminal execution", () => {
    const steps = [{ id: "p", kind: "provider" as const, terminal_records: 1, status: "completed" }, { id: "m", kind: "mechanical" as const, terminal_records: 1, status: "completed" }];
    expect(settlementIntegrity(steps, [{ step_id: "p", settlement_id: "s" }])).toMatchObject({ terminal: { value: 1 }, ledger: { value: 1 }, mechanical_zero_settlement: { value: 1 } });
    expect(settlementIntegrity(steps, [{ step_id: "p", settlement_id: "s1" }, { step_id: "p", settlement_id: "s2" }, { step_id: "m", settlement_id: "bad" }])).toMatchObject({ ledger: { value: null, missing: ["p"] }, mechanical_zero_settlement: { value: null, missing: ["m"] } });
  });
  it("computes union time independent of interval order", () => {
    const intervals = [{ id: "a", start: 0, end: 10 }, { id: "b", start: 5, end: 15 }, { id: "c", start: 20, end: 25 }];
    expect(unionDurationMs(intervals).value).toBe(20);
    expect(unionDurationMs([...intervals].reverse())).toEqual(unionDurationMs(intervals));
    expect(unionDurationMs([{ id: "bad", start: 3, end: 2 }]).quality).toBe("invalid_measurement");
  });
  it("uses fingerprints, counts independent verification productive, and never maps unknown cost to zero", () => {
    const value = productivePasses([{ id: "new", intended_fingerprint: "a", prior_valid_fingerprints: [], cost_usd: 1 }, { id: "repeat", intended_fingerprint: "a", prior_valid_fingerprints: ["a"], cost_usd: null }, { id: "review", intended_fingerprint: "a", prior_valid_fingerprints: ["a"], creates_required_verification: true, cost_usd: 2 }]);
    expect(value.productive).toEqual(["new", "review"]); expect(value.repeated).toEqual(["repeat"]);
    expect(value.repeated_work_cost).toMatchObject({ value: null, quality: "invalid_measurement", missing: ["repeat"] });
  });
});
