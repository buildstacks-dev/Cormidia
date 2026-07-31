import { describe, expect, it } from "vitest";
import { automaticBucket, bucketStart, normalizeReportRange } from "../../src/report/range.js";
import { nearestRank, share } from "../../src/report/statistics.js";

describe("report UTC range contract", () => {
  it("defaults to trailing 90 UTC days including today across a leap boundary", () => {
    const range = normalizeReportRange({}, new Date("2024-03-01T18:30:00.000Z"));
    expect(range).toMatchObject({
      preset: "90d",
      from_inclusive: "2023-12-03T00:00:00.000Z",
      to_exclusive: "2024-03-02T00:00:00.000Z",
      bucket: "week",
      display_timezone: "UTC",
      open_interval: true,
    });
  });

  it.each([
    ["7d", "2026-06-26T00:00:00.000Z"],
    ["30d", "2026-06-03T00:00:00.000Z"],
    ["90d", "2026-04-04T00:00:00.000Z"],
    ["1y", "2025-07-03T00:00:00.000Z"],
  ] as const)("normalizes %s as calendar days", (period, from) => {
    expect(normalizeReportRange({ period }, new Date("2026-07-02T12:00:00Z")).from_inclusive).toBe(from);
  });

  it("normalizes inclusive custom until and permits an open custom end", () => {
    expect(normalizeReportRange({ since: "2024-02-29", until: "2024-03-01" }, new Date("2024-03-02T12:00:00Z"))).toMatchObject({
      preset: "custom", from_inclusive: "2024-02-29T00:00:00.000Z", to_exclusive: "2024-03-02T00:00:00.000Z", bucket: "day",
    });
    expect(normalizeReportRange({ since: "2026-07-01" }, new Date("2026-07-02T12:34:56Z")).to_exclusive).toBe("2026-07-02T12:34:56.000Z");
  });

  it("rejects ambiguous and invalid custom bounds", () => {
    expect(() => normalizeReportRange({ until: "2026-07-01" })).toThrow("--until requires --since");
    expect(() => normalizeReportRange({ period: "7d", since: "2026-07-01" })).toThrow("mutually exclusive");
    expect(() => normalizeReportRange({ since: "2026-02-29" })).toThrow("valid UTC calendar date");
    expect(() => normalizeReportRange({ since: "2026-07-02", until: "2026-07-01" })).toThrow("range must end after");
  });

  it("pins auto bucket edges and Monday week boundaries", () => {
    expect([45, 46, 180, 181].map(automaticBucket)).toEqual(["day", "week", "week", "month"]);
    expect(bucketStart(new Date("2026-07-12T23:00:00Z"), "week").toISOString()).toBe("2026-07-06T00:00:00.000Z");
  });
});

describe("report statistics", () => {
  it("uses nearest-rank percentiles and honest empty denominators", () => {
    expect(nearestRank([], 0.9)).toBeNull();
    expect(nearestRank([7], 0.5)).toBe(7);
    expect(nearestRank([5, 1, 9, 3], 0.9)).toBe(9);
    expect(share(0, 0)).toBeNull();
    expect(share(2, 8)).toBe(0.25);
  });
});
