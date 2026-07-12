import { describe, expect, it } from "vitest";
import type { AppsFile } from "../../src/org/apps.js";
import { ReportService } from "../../src/report/service.js";
import { makeOrgHome } from "../fixtures/orgHome.js";

const apps: AppsFile = { org: { name: "service", maxConcurrentTurns: 2 }, defaults: { budgetUsdMonth: 1000 }, apps: [{ name: "alpha", repo: "o/a", status: "live", budgetUsdMonth: 1000, cadence: {}, channels: {} }] };

describe("report service", () => {
  it("is lazy and bounds its LRU cache", async () => {
    const home = makeOrgHome();
    try {
      const service = new ReportService({ orgName: "service", stateHome: home.root, appsFile: apps, cacheEntries: 2, clock: () => new Date("2026-07-12T12:00:00Z") });
      expect(service.projectionCount()).toBe(0);
      await service.report({ period: "7d" });
      await service.report({ period: "30d" });
      await service.report({ period: "90d" });
      expect(service.projectionCount()).toBe(3);
      expect(service.cacheSize()).toBe(2);
      await service.report({ period: "90d" });
      expect(service.projectionCount()).toBe(3);
    } finally { home.cleanup(); }
  });

  it("enforces page bounds and immutable app scope", async () => {
    const home = makeOrgHome();
    try {
      const service = new ReportService({ orgName: "service", stateHome: home.root, appsFile: apps, appScope: "alpha", maxPageSize: 5, clock: () => new Date("2026-07-12T12:00:00Z") });
      await expect(service.sessions({}, { limit: 6 })).rejects.toMatchObject({ code: "invalid_limit" });
      await expect(service.report({ app: "other" })).rejects.toMatchObject({ code: "unknown_report_app" });
      expect((await service.report({})).scope.app).toBe("alpha");
    } finally { home.cleanup(); }
  });
});
