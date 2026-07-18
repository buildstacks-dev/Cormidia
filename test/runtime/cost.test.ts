// The shared cost-aggregation primitive (#88, #89, #90).
//
// The near-miss cases matter as much as the positive ones: the whole point of
// the `none` classification is that it must NOT swallow a genuine provider turn
// whose usage could not be observed.

import { describe, expect, it } from "vitest";
import {
  aggregateCost,
  aggregateUsageQuality,
  formatCostAggregate,
  formatCostScope,
  mergeCostAggregates,
  normalizeUsageQuality,
  worstUsageQuality,
} from "../../src/runtime/cost.js";

describe("aggregateCost", () => {
  it("sums a fully observable set and reports complete coverage", () => {
    const result = aggregateCost([
      { costUsd: 10.5, quality: "complete", ref: "turn-a" },
      { costUsd: 4.16, quality: "complete", ref: "turn-b" },
    ]);
    expect(result).toMatchObject({
      known_cost_usd: 14.66,
      provider_turns: 2,
      known_turns: 2,
      unknown_turns: 0,
      mechanical_passes: 0,
      coverage: "complete",
      usage_quality: "complete",
    });
    expect(formatCostAggregate(result)).toBe("$14.66");
  });

  it("preserves known cost when some provider usage is incomplete (#90)", () => {
    const result = aggregateCost([
      { costUsd: 82.14, quality: "complete", ref: "turn-a" },
      { costUsd: null, quality: "unavailable", ref: "turn-b" },
      { costUsd: null, quality: "unavailable", ref: "turn-c" },
    ]);
    expect(result.known_cost_usd).toBe(82.14);
    expect(result.unknown_turns).toBe(2);
    expect(result.unknown_refs).toEqual(["turn-b", "turn-c"]);
    expect(result.coverage).toBe("partial");
    // The exact phrasing issue #90 asks for: a recorded subtotal plus an
    // explicit unknown component, never a bare "unavailable".
    expect(formatCostAggregate(result)).toBe("$82.14 recorded + 2 unknown");
  });

  it("never counts an unobservable turn as zero", () => {
    const withUnknown = aggregateCost([
      { costUsd: 5, quality: "complete" },
      { costUsd: null, quality: "unavailable" },
    ]);
    const withoutIt = aggregateCost([{ costUsd: 5, quality: "complete" }]);
    expect(withUnknown.known_cost_usd).toBe(withoutIt.known_cost_usd);
    // ...but the two aggregates must not be indistinguishable.
    expect(withUnknown.coverage).toBe("partial");
    expect(withoutIt.coverage).toBe("complete");
  });

  it("ignores a stored zero placeholder on an unavailable row", () => {
    // Ledger rows for unmeasured turns persist 0, which is not a known zero.
    const result = aggregateCost([
      { costUsd: 0, quality: "unavailable", ref: "placeholder" },
      { costUsd: 3, quality: "complete" },
    ]);
    expect(result.known_cost_usd).toBe(3);
    expect(result.unknown_turns).toBe(1);
  });

  it("classifies mechanical passes as an authoritative zero, not an unknown (#88)", () => {
    const result = aggregateCost([
      { costUsd: 0, quality: "none", ref: "provision/setup" },
      { costUsd: 0, quality: "none", ref: "gates/quality-gates" },
      { costUsd: 7.25, quality: "complete", ref: "turn-a" },
    ]);
    expect(result.mechanical_passes).toBe(2);
    expect(result.provider_turns).toBe(1);
    expect(result.unknown_turns).toBe(0);
    expect(result.coverage).toBe("complete");
    expect(result.usage_quality).toBe("complete");
    expect(result.unknown_refs).toEqual([]);
  });

  it("reports a mechanical-only scope as a known zero", () => {
    const result = aggregateCost([
      { costUsd: 0, quality: "none" },
      { costUsd: 0, quality: "none" },
    ]);
    expect(result.coverage).toBe("none");
    expect(result.usage_quality).toBe("none");
    expect(formatCostAggregate(result)).toBe("$0.00 (no provider turns)");
  });

  it("NEAR MISS: a genuine provider turn with unobservable usage stays unknown", () => {
    // The adversarial case for #88 — the fix must not launder real unknowns
    // into free mechanical passes.
    const result = aggregateCost([
      { costUsd: 0, quality: "none", ref: "gates/quality-gates" },
      { costUsd: null, quality: "unavailable", ref: "builder-turn" },
    ]);
    expect(result.mechanical_passes).toBe(1);
    expect(result.provider_turns).toBe(1);
    expect(result.unknown_turns).toBe(1);
    expect(result.unknown_refs).toEqual(["builder-turn"]);
    expect(result.coverage).toBe("unavailable");
    expect(formatCostAggregate(result)).toBe("unavailable (1 turn)");
  });

  it("reports unavailable when provider turns exist and none is observable", () => {
    const result = aggregateCost([
      { costUsd: null, quality: "unavailable", ref: "a" },
      { costUsd: null, quality: "unavailable", ref: "b" },
    ]);
    expect(result.coverage).toBe("unavailable");
    expect(result.known_cost_usd).toBe(0);
    expect(formatCostAggregate(result)).toBe("unavailable (2 turns)");
  });

  it("treats an empty scope as none, and a legacy row with no quality as unknown", () => {
    expect(aggregateCost([]).coverage).toBe("none");
    const legacy = aggregateCost([{ costUsd: 1.5, quality: undefined, ref: "legacy" }]);
    expect(legacy.coverage).toBe("unavailable");
    expect(legacy.unknown_turns).toBe(1);
  });

  it("excludes a non-finite cost from the known subtotal", () => {
    const result = aggregateCost([
      { costUsd: Number.NaN, quality: "complete", ref: "corrupt" },
      { costUsd: 2, quality: "complete" },
    ]);
    expect(result.known_cost_usd).toBe(2);
    expect(result.unknown_turns).toBe(1);
  });

  it("marks an estimated total with ~ and keeps it distinct from reported cost", () => {
    const result = aggregateCost([{ costUsd: 3.5, quality: "estimated" }]);
    expect(result.usage_quality).toBe("estimated");
    expect(formatCostAggregate(result)).toBe("~$3.50");
  });

  it("is order-independent so two surfaces summing the same rows agree (#89)", () => {
    const rows = [
      { costUsd: 0.1, quality: "complete" as const },
      { costUsd: 0.2, quality: "complete" as const },
      { costUsd: 0.3, quality: "complete" as const },
    ];
    const forward = aggregateCost(rows);
    const reverse = aggregateCost([...rows].reverse());
    expect(forward.known_cost_usd).toBe(reverse.known_cost_usd);
  });
});

describe("mergeCostAggregates", () => {
  it("merges without double-counting and preserves unknown references", () => {
    const left = aggregateCost([
      { costUsd: 1, quality: "complete" },
      { costUsd: null, quality: "unavailable", ref: "x" },
    ]);
    const right = aggregateCost([
      { costUsd: 2, quality: "complete" },
      { costUsd: 0, quality: "none" },
    ]);
    const merged = mergeCostAggregates([left, right]);
    expect(merged).toMatchObject({
      known_cost_usd: 3,
      provider_turns: 3,
      known_turns: 2,
      unknown_turns: 1,
      mechanical_passes: 1,
      coverage: "partial",
    });
    expect(merged.unknown_refs).toEqual(["x"]);
  });

  it("merging is equivalent to aggregating the flat set", () => {
    const rows = [
      { costUsd: 1.25, quality: "complete" as const, ref: "a" },
      { costUsd: null, quality: "unavailable" as const, ref: "b" },
      { costUsd: 0, quality: "none" as const, ref: "c" },
      { costUsd: 4, quality: "estimated" as const, ref: "d" },
    ];
    const flat = aggregateCost(rows);
    const merged = mergeCostAggregates([aggregateCost(rows.slice(0, 2)), aggregateCost(rows.slice(2))]);
    expect(merged.known_cost_usd).toBe(flat.known_cost_usd);
    expect(merged.unknown_turns).toBe(flat.unknown_turns);
    expect(merged.mechanical_passes).toBe(flat.mechanical_passes);
    expect(merged.coverage).toBe(flat.coverage);
    expect(merged.usage_quality).toBe(flat.usage_quality);
  });

  it("an empty merge is a known zero, not an unknown", () => {
    expect(mergeCostAggregates([]).coverage).toBe("none");
  });
});

describe("usage quality ranking", () => {
  it("ranks none with complete so a mechanical pass cannot degrade a total (#88)", () => {
    expect(worstUsageQuality("none", "complete")).toBe("complete");
    expect(aggregateUsageQuality(["none", "none", "complete"])).toBe("complete");
  });

  it("still degrades worst-wins for genuine provider qualities", () => {
    expect(aggregateUsageQuality(["complete", "estimated"])).toBe("estimated");
    expect(aggregateUsageQuality(["complete", "partial"])).toBe("partial");
    expect(aggregateUsageQuality(["estimated", "unavailable"])).toBe("unavailable");
  });

  it("treats an unrecognized or absent quality as unavailable, never complete", () => {
    expect(normalizeUsageQuality(undefined)).toBe("unavailable");
    expect(normalizeUsageQuality("bogus")).toBe("unavailable");
    // Absence of evidence is not evidence of completeness.
    expect(aggregateUsageQuality([])).toBe("unavailable");
  });
});

describe("formatCostScope", () => {
  it("discloses settlement coverage alongside the total (#89)", () => {
    expect(formatCostScope({ settled_provider_turns: 70, unsettled_provider_turns: 0 })).toBe(
      "70/70 provider turns settled",
    );
    expect(formatCostScope({ settled_provider_turns: 68, unsettled_provider_turns: 2 })).toBe(
      "68/70 provider turns settled",
    );
  });
});
