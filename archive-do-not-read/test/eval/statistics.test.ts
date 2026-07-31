import { describe, expect, it } from "vitest";
import { distribution, pairedArmOrder, pairedDeltas, percentile, seededOrder } from "../../scripts/eval/statistics.js";

describe("J-STAT deterministic campaign statistics", () => {
  it("J-STAT-01 pins median, p90, missingness, seeded order, and paired deltas", () => {
    expect(distribution([5, 1, null, 3, 9])).toEqual({ count: 4, missing: 1, values: [1, 3, 5, 9], median: 4, p90: 7.800000000000001 });
    expect(percentile([], 0.5)).toBeNull();
    expect(seededOrder(["a", "b", "c"], "fixed")).toEqual(seededOrder(["a", "b", "c"], "fixed"));
    expect([pairedArmOrder(0, "fixed"), pairedArmOrder(1, "fixed")]).toEqual([pairedArmOrder(0, "fixed"), pairedArmOrder(1, "fixed")]);
    expect(pairedDeltas([{ pair_id: "p1", arm: "candidate", value: 7 }, { pair_id: "p1", arm: "baseline", value: 10 }])).toEqual({ pairs: [{ pair_id: "p1", baseline: 10, candidate: 7, delta: -3 }], missing_pairs: [] });
  });
  it("J-STAT-01 near-miss preserves finite zero while excluding unknown values", () => {
    expect(distribution([0, undefined, Number.NaN])).toMatchObject({ count: 1, missing: 2, median: 0, p90: 0 });
  });
  it("J-STAT-01 honest failure rejects an impossible percentile", () => {
    expect(() => percentile([1, 2], 1.1)).toThrow("quantile_out_of_range");
  });
  it("J-STAT-02 retains missing pairs and rejects duplicate arm retries", () => {
    expect(pairedDeltas([{ pair_id: "p1", arm: "baseline", value: 10 }]).missing_pairs).toEqual(["p1"]);
    expect(() => pairedDeltas([{ pair_id: "p1", arm: "baseline", value: 10 }, { pair_id: "p1", arm: "baseline", value: 9 }])).toThrow("duplicate_pair_arm");
  });
  it("J-STAT-02 near-miss accepts the same value in opposite predeclared arms", () => {
    expect(pairedDeltas([{ pair_id: "p", arm: "baseline", value: 1 }, { pair_id: "p", arm: "candidate", value: 1 }]).pairs[0]?.delta).toBe(0);
  });
  it("J-STAT-02 honest failure never lets a replacement erase a duplicate arm", () => {
    expect(() => pairedDeltas([{ pair_id: "p", arm: "candidate", value: 2 }, { pair_id: "p", arm: "candidate", value: 1 }])).toThrow("duplicate_pair_arm");
  });
});
