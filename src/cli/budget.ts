import { join, resolve } from "node:path";
import { enforceBudgetOverlay } from "../org/budget.js";
import { loadApps } from "../org/apps.js";
import { resolveOperonHomes } from "../org/home.js";
import { extractHomeFlags } from "./home-flags.js";

export async function cmdBudget(args: string[]): Promise<number> {
  const common = extractHomeFlags(args, "budget");
  let appsPath: string | undefined;
  for (let i = 0; i < common.rest.length; i++) {
    const arg = common.rest[i]!;
    if (arg === "--apps") appsPath = needValue(common.rest, ++i, "--apps");
    else throw new Error(`budget: unknown argument "${arg}"`);
  }

  const homes = await resolveOperonHomes(common);
  const effectiveAppsPath = appsPath ? resolve(appsPath) : join(homes.orgHome, "apps.yaml");
  const apps = await loadApps(effectiveAppsPath);
  const rows = await enforceBudgetOverlay(homes.stateHome, apps);
  console.log("APP                  SPENT      BUDGET     STATUS");
  for (const row of rows) {
    console.log(
      `${row.app.padEnd(20)} ${money(row.spentUsd).padStart(10)} ${money(row.budgetUsd).padStart(10)} ${row.status.toUpperCase()}`,
    );
  }
  return 0;
}

function money(value: number): string {
  return `$${value.toFixed(2)}`;
}

function needValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value || value.startsWith("--")) throw new Error(`budget: ${flag} requires a value`);
  return value;
}
