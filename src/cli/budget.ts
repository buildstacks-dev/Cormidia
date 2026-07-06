import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { enforceBudgetOverlay } from "../org/budget.js";
import { loadApps } from "../org/apps.js";

export async function cmdBudget(args: string[]): Promise<number> {
  let home: string | undefined;
  let appsPath = "apps.yaml";
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--home") home = needValue(args, ++i, "--home");
    else if (arg === "--apps") appsPath = needValue(args, ++i, "--apps");
    else throw new Error(`budget: unknown argument "${arg}"`);
  }

  const apps = await loadApps(appsPath);
  const orgHome = resolve(home ?? process.env.OPERON_HOME ?? join(homedir(), ".operon", apps.org.name));
  const rows = await enforceBudgetOverlay(orgHome, apps);
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
