import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { enforceBudgetOverlay, isOverlayPaused, rollupBudgets } from "../src/org/budget.js";
import type { AppsFile } from "../src/org/apps.js";
import { makeOrgHome } from "./fixtures/orgHome.js";

const APPS: AppsFile = {
  org: { name: "test", maxConcurrentTurns: 2 },
  defaults: { budgetUsdMonth: 1000 },
  apps: [
    { name: "alpha", repo: "owner/alpha", status: "live", budgetUsdMonth: 1000, cadence: {} },
    { name: "beta", repo: "owner/beta", status: "live", budgetUsdMonth: 1000, cadence: {} },
  ],
};

describe("budget rollup", () => {
  it("sums current month only and warns at 80 percent", async () => {
    const home = makeOrgHome({ approvals: true });
    try {
      writeTelemetry(home.root, "2026-07-01", { app: "alpha", costUsd: 850 });
      writeTelemetry(home.root, "2026-06-30", { app: "alpha", costUsd: 900 });
      const rows = await rollupBudgets(home.root, APPS, new Date("2026-07-06T00:00:00Z"));
      expect(rows.find((row) => row.app === "alpha")).toMatchObject({
        spentUsd: 850,
        status: "warning",
      });
    } finally {
      home.cleanup();
    }
  });

  it("auto-pauses exceeded apps and creates exactly one queue item", async () => {
    const home = makeOrgHome({ approvals: true });
    try {
      writeTelemetry(home.root, "2026-07-02", { app: "beta", costUsd: 1100 });
      await enforceBudgetOverlay(home.root, APPS, new Date("2026-07-06T00:00:00Z"));
      await enforceBudgetOverlay(home.root, APPS, new Date("2026-07-06T00:00:00Z"));
      expect(await isOverlayPaused(home.root, "beta")).toBe(true);
      const { ApprovalStore } = await import("../src/org/approvals.js");
      const store = new ApprovalStore(home.root);
      const pending = await store.listPending();
      expect(pending.filter((item) => item.rule === "budget-exceeded" && item.app === "beta")).toHaveLength(1);
      await store.decide(pending[0]!.id, { decision: "denied", reason: "pause acknowledged" });
      await enforceBudgetOverlay(home.root, APPS, new Date("2026-07-06T00:00:00Z"));
      expect(await store.listPending()).toEqual([]);
    } finally {
      home.cleanup();
    }
  });

  it("un-pauses an app once a new month's spend is back under cap", async () => {
    const home = makeOrgHome({ approvals: true });
    try {
      // July: beta blows the cap and gets paused.
      writeTelemetry(home.root, "2026-07-02", { app: "beta", costUsd: 1100 });
      await enforceBudgetOverlay(home.root, APPS, new Date("2026-07-06T00:00:00Z"));
      expect(await isOverlayPaused(home.root, "beta")).toBe(true);

      // August: readMonthSpend returns 0 for beta, so it is no longer
      // exceeded and must drop out of the pause overlay automatically.
      await enforceBudgetOverlay(home.root, APPS, new Date("2026-08-01T00:00:00Z"));
      expect(await isOverlayPaused(home.root, "beta")).toBe(false);
    } finally {
      home.cleanup();
    }
  });
});

function writeTelemetry(root: string, day: string, fields: { app: string; costUsd: number }): void {
  mkdirSync(join(root, "telemetry"), { recursive: true });
  writeFileSync(
    join(root, "telemetry", `${day}.jsonl`),
    JSON.stringify({
      at: `${day}T00:00:00.000Z`,
      role: "builder",
      runtime: "claude",
      model: "m",
      status: "completed",
      tokensIn: 0,
      tokensOut: 0,
      costUsd: fields.costUsd,
      subagentTurns: 0,
      wallClockMs: 0,
      escalations: 0,
      app: fields.app,
    }) + "\n",
    "utf8",
  );
}
