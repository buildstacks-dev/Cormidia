// `cormidia roles [path]` — validate roles.yaml and print the org chart.
// `cormidia roles set <role> ...` — the journaled write path (ENH-004).

import { loadRoles } from "../org/roles.js";
import { resolveCormidiaHomes } from "../org/home.js";
import { join, resolve } from "node:path";
import { extractHomeFlags } from "./home-flags.js";
import {
  applyRoleAssignmentChange,
  formatRoleAssignmentPlan,
  isUnverifiedModelIdChange,
  type RoleAssignmentEdit,
} from "../org/role-assignment.js";
import { TURN_ASSIGNMENT_EFFORTS, TURN_ASSIGNMENT_HARNESSES } from "../runtime/assignment.js";
import type { Effort, RuntimeKind } from "../runtime/types.js";

export async function cmdRoles(args: string[] = []): Promise<number> {
  if (args[0] === "set") return cmdRolesSet(args.slice(1));
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
    : join((await resolveCormidiaHomes(common)).orgHome, "roles.yaml");
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

/**
 * `cormidia roles set <role> [--runtime r] [--model m] [--effort e]
 *  [--turn-budget usd] [--reason text] [--by identity] [--execute] [--json]`
 *
 * Preview by default. Execution is deliberately two-key: an explicit
 * `--execute` plus an attributable `--by`, matching the ratified-surface rule
 * in `.cormidia/config.yaml`. Without `--by` the command still validates and
 * prints the exact diff, which is the proposal an agent hands to its operator.
 */
export async function cmdRolesSet(args: string[] = []): Promise<number> {
  const common = extractHomeFlags(args, "roles set");
  const rest = common.rest;
  let role: string | undefined;
  let json = false;
  let execute = false;
  let reason: string | undefined;
  let by: string | undefined;
  const edit: RoleAssignmentEdit = {};

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!;
    if (arg === "--json") json = true;
    else if (arg === "--execute") execute = true;
    else if (arg === "--runtime") edit.runtime = needRuntime(needValue(rest, ++i, "--runtime"));
    else if (arg === "--model") edit.model = needValue(rest, ++i, "--model");
    else if (arg === "--effort") edit.effort = needEffort(needValue(rest, ++i, "--effort"));
    else if (arg === "--turn-budget") edit.turnBudgetUsd = needNumber(needValue(rest, ++i, "--turn-budget"));
    else if (arg === "--reason") reason = needValue(rest, ++i, "--reason");
    else if (arg === "--by") by = needValue(rest, ++i, "--by");
    else if (arg.startsWith("--")) throw new Error(`roles set: unknown argument "${arg}"`);
    else if (role === undefined) role = arg;
    else throw new Error("roles set: expected exactly one role name");
  }
  if (role === undefined) {
    throw new Error("roles set: role name required — cormidia roles set <role> [--model ...]");
  }

  const homes = await resolveCormidiaHomes(common);
  const plan = await applyRoleAssignmentChange({
    orgHome: homes.orgHome,
    stateHome: homes.stateHome,
    role,
    edit,
    execute,
    ...(reason === undefined ? {} : { reason }),
    ...(by === undefined ? {} : { by }),
  });
  if (json) console.log(JSON.stringify(plan, null, 2));
  else console.log(formatRoleAssignmentPlan(plan));
  // A harness with a token-free roster refuses an id it will not serve before
  // anything is written. A harness without one cannot, so the operator is told
  // on stderr as well — the --json consumer would otherwise have to know to go
  // looking for modelCatalog.verified to learn that nothing checked this id.
  if (plan.executed && isUnverifiedModelIdChange(plan) && plan.modelCatalog !== undefined) {
    console.error(
      `cormidia roles set: WARNING — ${plan.role} now runs ` +
        `${plan.modelCatalog.runtime}/${plan.modelCatalog.model}, an id no token-free roster ` +
        `could verify (${plan.modelCatalog.reason}). Run \`cormidia doctor\` to probe the adapter ` +
        "before the next turn spends on it.",
    );
  }
  return plan.blockers.length === 0 ? 0 : 1;
}

function needValue(args: readonly string[], index: number, flag: string): string {
  const value = args[index];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`roles set: ${flag} requires a value`);
  }
  return value;
}

function needRuntime(value: string): RuntimeKind {
  if (!(TURN_ASSIGNMENT_HARNESSES as readonly string[]).includes(value)) {
    throw new Error(`roles set: --runtime must be one of ${TURN_ASSIGNMENT_HARNESSES.join(" | ")}`);
  }
  return value as RuntimeKind;
}

function needEffort(value: string): Effort {
  if (!(TURN_ASSIGNMENT_EFFORTS as readonly string[]).includes(value)) {
    throw new Error(`roles set: --effort must be one of ${TURN_ASSIGNMENT_EFFORTS.join(" | ")}`);
  }
  return value as Effort;
}

function needNumber(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error("roles set: --turn-budget must be a number");
  return parsed;
}
