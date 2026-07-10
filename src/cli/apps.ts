// `operon apps [path]` — validate apps.yaml and print the app registry.

import { loadApps } from "../org/apps.js";
import { resolveOperonHomes } from "../org/home.js";
import { join, resolve } from "node:path";
import { extractHomeFlags } from "./home-flags.js";

export async function cmdApps(args: string[] = []): Promise<number> {
  const common = extractHomeFlags(args, "apps");
  if (common.rest.length > 1) throw new Error("apps: expected at most one apps.yaml path");
  const path = common.rest[0]
    ? resolve(common.rest[0])
    : join((await resolveOperonHomes(common)).orgHome, "apps.yaml");
  const { org, defaults, apps } = await loadApps(path);
  console.log(
    `${path}: OK — ${apps.length} app${apps.length === 1 ? "" : "s"}, ` +
      `org "${org.name}", WIP limit ${org.maxConcurrentTurns}, ` +
      `default budget $${defaults.budgetUsdMonth}/mo\n`,
  );
  const appWidth = Math.max("APP".length, ...apps.map((a) => a.name.length)) + 2;
  const repoWidth = Math.max("REPO".length, ...apps.map((a) => a.repo.length)) + 2;
  const statusWidth = Math.max("STATUS".length, ...apps.map((a) => a.status.length)) + 2;
  const pad = (s: string, n: number) => s.padEnd(n);
  console.log(pad("APP", appWidth) + pad("REPO", repoWidth) + pad("STATUS", statusWidth) + "BUDGET");
  for (const a of apps) {
    const cadence = Object.keys(a.cadence).length
      ? `  (cadence overrides: ${Object.keys(a.cadence).join(", ")})`
      : "";
    console.log(
      pad(a.name, appWidth) +
        pad(a.repo, repoWidth) +
        pad(a.status, statusWidth) +
        `$${a.budgetUsdMonth}/mo` +
        cadence,
    );
  }
  return 0;
}
