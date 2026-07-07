// Monthly budget rollup and auto-pause overlay (architecture.md §7).

import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AppsFile } from "./apps.js";
import { ApprovalStore } from "./approvals.js";
import type { TurnRecord } from "../runtime/telemetry.js";

export interface BudgetRow {
  app: string;
  budgetUsd: number;
  spentUsd: number;
  percent: number;
  status: "ok" | "warning" | "exceeded";
}

export interface BudgetOverlay {
  pausedApps: string[];
}

export async function rollupBudgets(
  orgHome: string,
  apps: AppsFile,
  now: Date = new Date(),
): Promise<BudgetRow[]> {
  const month = now.toISOString().slice(0, 7);
  const spent = await readMonthSpend(orgHome, month);
  return apps.apps.map((app) => {
    const spentUsd = spent.get(app.name) ?? 0;
    const percent = app.budgetUsdMonth === 0 ? 0 : (spentUsd / app.budgetUsdMonth) * 100;
    return {
      app: app.name,
      budgetUsd: app.budgetUsdMonth,
      spentUsd,
      percent,
      status: percent >= 100 ? "exceeded" : percent >= 80 ? "warning" : "ok",
    };
  });
}

export async function enforceBudgetOverlay(
  orgHome: string,
  apps: AppsFile,
  now: Date = new Date(),
): Promise<BudgetRow[]> {
  const rows = await rollupBudgets(orgHome, apps, now);
  const overlay = await readOverlay(orgHome);
  const store = new ApprovalStore(orgHome);

  const knownApps = new Set(apps.apps.map((app) => app.name));
  const exceeded = new Set(rows.filter((r) => r.status === "exceeded").map((r) => r.app));
  // Recompute the paused set from the current rollup rather than only ever
  // adding to it: an app drops out of the overlay once its month-to-date spend
  // is back under 100% (e.g. after a month reset), so a single month's overage
  // no longer pauses a healthy live app forever. Entries for apps no longer in
  // apps.yaml are preserved so an unrelated overlay is never silently dropped.
  overlay.pausedApps = overlay.pausedApps.filter((app) => !knownApps.has(app) || exceeded.has(app));

  for (const row of rows.filter((r) => r.status === "exceeded")) {
    if (!overlay.pausedApps.includes(row.app)) overlay.pausedApps.push(row.app);
    const hashKey = `budget-exceeded:${row.app}:${now.toISOString().slice(0, 7)}`;
    const existing = (await store.listPending()).some(
      (item) => item.rule === "budget-exceeded" && item.app === row.app && item.justification === hashKey,
    );
    const decidedExisting = (await store.listDecided()).some(
      (item) => item.rule === "budget-exceeded" && item.app === row.app && item.justification === hashKey,
    );
    if (!existing && !decidedExisting) {
      await store.raise({
        app: row.app,
        role: "orchestrator",
        rule: "budget-exceeded",
        action: {
          tool: "budget",
          input: { app: row.app, spentUsd: row.spentUsd, budgetUsd: row.budgetUsd },
        },
        justification: hashKey,
        now,
      });
    }
  }

  overlay.pausedApps.sort();
  await writeOverlay(orgHome, overlay);
  return rows;
}

export async function isOverlayPaused(orgHome: string, app: string): Promise<boolean> {
  return (await readOverlay(orgHome)).pausedApps.includes(app);
}

async function readMonthSpend(orgHome: string, month: string): Promise<Map<string, number>> {
  const dir = join(orgHome, "telemetry");
  const spent = new Map<string, number>();
  if (!existsSync(dir)) return spent;
  for (const file of await readdir(dir)) {
    if (!file.startsWith(month) || !file.endsWith(".jsonl")) continue;
    const text = await readFile(join(dir, file), "utf8");
    for (const line of text.split("\n")) {
      if (line.trim().length === 0) continue;
      const record = JSON.parse(line) as TurnRecord;
      if (record.app === undefined) continue;
      spent.set(record.app, (spent.get(record.app) ?? 0) + record.costUsd);
    }
  }
  return spent;
}

async function readOverlay(orgHome: string): Promise<BudgetOverlay> {
  const path = overlayPath(orgHome);
  if (!existsSync(path)) return { pausedApps: [] };
  const raw = JSON.parse(await readFile(path, "utf8")) as Partial<BudgetOverlay>;
  return { pausedApps: Array.isArray(raw.pausedApps) ? raw.pausedApps.map(String) : [] };
}

async function writeOverlay(orgHome: string, overlay: BudgetOverlay): Promise<void> {
  const path = overlayPath(orgHome);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(overlay, null, 2)}\n`, "utf8");
}

function overlayPath(orgHome: string): string {
  return join(orgHome, "state", "budget-overlay.json");
}
