// Tests monthly budget rollups and pause overlays in src/org/budget.ts.
// Covers current-month spend aggregation, warning thresholds, automatic app
// pauses, one approval item per overrun, denial acknowledgement, and new-month
// unpausing.
// Uses temp telemetry files and a temp approval store; no network, auth, real
// org state, or live clock is involved.

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

describe("A-004: fail closed when the month total cannot be computed", () => {
  const CAP_100: AppsFile = {
    org: { name: "test", maxConcurrentTurns: 2 },
    defaults: { budgetUsdMonth: 100 },
    apps: [{ name: "demo", repo: "owner/demo", status: "live", budgetUsdMonth: 100, cadence: {} }],
  };

  it("a row with an absent/non-finite costUsd yields status 'unknown', never 'ok'", async () => {
    const home = makeOrgHome({ approvals: true });
    try {
      // $150 of honest spend, then one parseable-but-malformed row (no costUsd)
      // — the exact Track A probe. NaN must never read as 'ok'.
      writeTelemetry(home.root, "2026-07-10", { app: "demo", costUsd: 100 });
      writeTelemetry(home.root, "2026-07-11", { app: "demo", costUsd: 50 });
      writeTelemetryRaw(home.root, "2026-07-12", { app: "demo" });
      const rows = await rollupBudgets(home.root, CAP_100, new Date("2026-07-14T00:00:00Z"));
      const demo = rows.find((row) => row.app === "demo");
      expect(demo?.status).toBe("unknown");
      // The partial finite sum is still surfaced, but it never reads as 'ok'.
      expect(demo?.status).not.toBe("ok");
    } finally {
      home.cleanup();
    }
  });

  it("a string costUsd is not concatenated into a fabricated total; the app is 'unknown'", async () => {
    const home = makeOrgHome({ approvals: true });
    try {
      writeTelemetry(home.root, "2026-07-10", { app: "demo", costUsd: 50 });
      writeTelemetryRaw(home.root, "2026-07-11", { app: "demo", costUsd: "1500" });
      const rows = await rollupBudgets(home.root, CAP_100, new Date("2026-07-14T00:00:00Z"));
      expect(rows.find((row) => row.app === "demo")?.status).toBe("unknown");
    } finally {
      home.cleanup();
    }
  });

  it("a malformed row must not un-pause an already-paused app", async () => {
    const home = makeOrgHome({ approvals: true });
    try {
      // A legitimate overage pauses demo.
      writeTelemetry(home.root, "2026-07-10", { app: "demo", costUsd: 150 });
      await enforceBudgetOverlay(home.root, CAP_100, new Date("2026-07-14T00:00:00Z"));
      expect(await isOverlayPaused(home.root, "demo")).toBe(true);

      // A later malformed append makes the total unverifiable. The old code
      // computed NaN → 'ok' → filtered demo OUT of the pause overlay. It must
      // now stay paused (fail closed), and the budget item stays raised.
      writeTelemetryRaw(home.root, "2026-07-15", { app: "demo" });
      await enforceBudgetOverlay(home.root, CAP_100, new Date("2026-07-16T00:00:00Z"));
      expect(await isOverlayPaused(home.root, "demo")).toBe(true);

      const { ApprovalStore } = await import("../src/org/approvals.js");
      const pending = await new ApprovalStore(home.root).listPending();
      expect(pending.some((item) => item.rule === "budget-exceeded" && item.app === "demo")).toBe(true);
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

/** Write a telemetry row verbatim — used to inject a parseable-but-malformed
 *  ledger line (an absent/non-numeric costUsd) for the A-004 fail-closed
 *  tests. A distinct day file so it does not overwrite the honest rows. */
function writeTelemetryRaw(root: string, day: string, record: Record<string, unknown>): void {
  mkdirSync(join(root, "telemetry"), { recursive: true });
  writeFileSync(
    join(root, "telemetry", `${day}.jsonl`),
    JSON.stringify({ at: `${day}T00:00:00.000Z`, role: "builder", status: "completed", ...record }) + "\n",
    "utf8",
  );
}
