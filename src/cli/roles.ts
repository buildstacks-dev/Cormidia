// `operon roles [path]` — validate roles.yaml and print the org chart.

import { loadRoles } from "../org/roles.js";
import { resolveOperonHomes } from "../org/home.js";
import { join, resolve } from "node:path";
import { extractHomeFlags } from "./home-flags.js";

export async function cmdRoles(args: string[] = []): Promise<number> {
  const common = extractHomeFlags(args, "roles");
  let json = false;
  let pathArgument: string | undefined;
  for (const arg of common.rest) {
    if (arg === "--json") json = true;
    else if (arg.startsWith("--")) throw new Error(`roles: unknown argument "${arg}"`);
    else if (pathArgument === undefined) pathArgument = arg;
    else throw new Error("roles: expected at most one roles.yaml path");
  }
  const path = pathArgument
    ? resolve(pathArgument)
    : join((await resolveOperonHomes(common)).orgHome, "roles.yaml");
  const { roles, defaults, roleTurnBudgets } = await loadRoles(path);
  const budgetsByRole = new Map(roleTurnBudgets.map((budget) => [budget.name, budget]));
  const rows = roles.map((role) => {
    const budget = budgetsByRole.get(role.name);
    if (budget === undefined) {
      throw new Error(`roles: missing turn budget metadata for "${role.name}"`);
    }
    return {
      name: role.name,
      runtime: role.runtime,
      model: role.model,
      effort: role.effort,
      effectiveTurnBudgetUsd: budget.effectiveTurnBudgetUsd,
      turnBudgetInherited: budget.turnBudgetInherited,
      adaptiveAssignmentCount: role.adaptiveAssignments?.length ?? 0,
      triggers: role.triggers,
    };
  });
  const roleTurnBudgetOverrideCount = rows.filter((row) => !row.turnBudgetInherited).length;
  const report = {
    path,
    roleCount: rows.length,
    defaultTurnBudgetUsd: defaults.maxTurnBudgetUsd,
    roleTurnBudgetOverrideCount,
    roles: rows,
  };
  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return 0;
  }

  console.log(
    `${path}: OK — ${rows.length} roles; default turn budget $${defaults.maxTurnBudgetUsd}; ` +
      `${roleTurnBudgetOverrideCount} role-specific ` +
      `override${roleTurnBudgetOverrideCount === 1 ? "" : "s"}\n`,
  );
  const pad = (s: string, n: number) => s.padEnd(n);
  const roleWidth = Math.max(12, ...rows.map((role) => role.name.length + 2));
  const budgetLabels = rows.map(
    (role) =>
      `$${role.effectiveTurnBudgetUsd}${role.turnBudgetInherited ? " (default)" : ""}`,
  );
  const budgetWidth = Math.max("BUDGET".length, ...budgetLabels.map((value) => value.length)) + 2;
  console.log(
    pad("ROLE", roleWidth) +
      pad("RUNTIME", 9) +
      pad("MODEL", 22) +
      pad("EFFORT", 8) +
      pad("BUDGET", budgetWidth) +
      pad("ADAPTIVE", 10) +
      "TRIGGERS",
  );
  for (const [index, r] of rows.entries()) {
    const triggers = r.triggers.map((t) => t.schedule ?? `on:${t.event}`).join(", ") || "-";
    console.log(
      pad(r.name, roleWidth) +
        pad(r.runtime, 9) +
        pad(r.model, 22) +
        pad(r.effort, 8) +
        pad(budgetLabels[index]!, budgetWidth) +
        pad(String(r.adaptiveAssignmentCount), 10) +
        triggers,
    );
  }
  return 0;
}
