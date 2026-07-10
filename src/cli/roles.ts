// `operon roles [path]` — validate roles.yaml and print the org chart.

import { loadRoles } from "../org/roles.js";
import { resolveOperonHomes } from "../org/home.js";
import { join, resolve } from "node:path";
import { extractHomeFlags } from "./home-flags.js";

export async function cmdRoles(args: string[] = []): Promise<number> {
  const common = extractHomeFlags(args, "roles");
  if (common.rest.length > 1) throw new Error("roles: expected at most one roles.yaml path");
  const path = common.rest[0]
    ? resolve(common.rest[0])
    : join((await resolveOperonHomes(common)).orgHome, "roles.yaml");
  const { roles, defaults } = await loadRoles(path);
  console.log(`${path}: OK — ${roles.length} roles, default turn budget $${defaults.maxTurnBudgetUsd}\n`);
  const pad = (s: string, n: number) => s.padEnd(n);
  console.log(pad("ROLE", 12) + pad("RUNTIME", 9) + pad("MODEL", 22) + pad("EFFORT", 8) + "TRIGGERS");
  for (const r of roles) {
    const triggers = r.triggers.map((t) => t.schedule ?? `on:${t.event}`).join(", ") || "-";
    console.log(pad(r.name, 12) + pad(r.runtime, 9) + pad(r.model, 22) + pad(r.effort, 8) + triggers);
  }
  return 0;
}
