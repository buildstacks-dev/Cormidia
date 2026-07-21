// `operon apps [path]` — validate apps.yaml and print the app registry.

import { loadApps } from "../org/apps.js";
import { resolveOperonHomes } from "../org/home.js";
import { join, resolve } from "node:path";
import { extractHomeFlags } from "./home-flags.js";

export async function cmdApps(args: string[] = []): Promise<number> {
  const common = extractHomeFlags(args, "apps");
  let json = false;
  let pathArgument: string | undefined;
  for (const arg of common.rest) {
    if (arg === "--json") json = true;
    else if (arg.startsWith("-")) throw new Error(`apps: unknown argument "${arg}"`);
    else if (pathArgument === undefined) pathArgument = arg;
    else throw new Error("apps: expected at most one apps.yaml path");
  }
  const path = pathArgument
    ? resolve(pathArgument)
    : join((await resolveOperonHomes(common)).orgHome, "apps.yaml");
  const { org, defaults, apps } = await loadApps(path);
  const report = {
    schema_version: 1,
    kind: "apps",
    path,
    org,
    defaults,
    appCount: apps.length,
    apps,
  } as const;
  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return 0;
  }
  console.log(
    `${report.path}: OK — ${report.appCount} app${report.appCount === 1 ? "" : "s"}, ` +
      `org "${report.org.name}", WIP limit ${report.org.maxConcurrentTurns}, ` +
      `default budget $${report.defaults.budgetUsdMonth}/mo\n`,
  );
  const appWidth = Math.max("APP".length, ...report.apps.map((a) => a.name.length)) + 2;
  const repoWidth = Math.max("REPO".length, ...report.apps.map((a) => a.repo.length)) + 2;
  const statusWidth = Math.max("STATUS".length, ...report.apps.map((a) => a.status.length)) + 2;
  const pad = (s: string, n: number) => s.padEnd(n);
  console.log(
    pad("APP", appWidth) +
      pad("REPO", repoWidth) +
      pad("STATUS", statusWidth) +
      pad("ASSIGNMENT", 12) +
      "BUDGET",
  );
  for (const a of report.apps) {
    const cadence = Object.keys(a.cadence).length
      ? `  (cadence overrides: ${Object.keys(a.cadence).join(", ")})`
      : "";
    console.log(
      pad(a.name, appWidth) +
        pad(a.repo, repoWidth) +
        pad(a.status, statusWidth) +
        pad(a.execution?.assignmentMode ?? "fixed", 12) +
        `$${a.budgetUsdMonth}/mo` +
        cadence,
    );
  }
  return 0;
}
