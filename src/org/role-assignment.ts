// `operon roles set` — the only write path for a role's model, effort, and
// per-turn budget (ENH-004).
//
// roles.yaml is a human-ratified surface. This does not bypass that boundary,
// it makes the boundary usable: preview by default, an explicit --execute, and
// a refusal to execute without an attributable human identity. What a caller
// without one gets is a validated proposal diff to hand to its operator, which
// is exactly what hand-editing YAML never produced.
//
// The change is validated before it lands. A role's tuple determines what
// every future turn costs and how good it is, and a bad tuple otherwise
// surfaces at dispatch — inside a live, paid turn.

import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { isDocument, isMap, parseDocument, type Document } from "yaml";
import {
  TURN_ASSIGNMENT_EFFORTS,
  validateTurnAssignment,
} from "../runtime/assignment.js";
import {
  resolvedRuntimeCapabilities,
  runtimeCapabilityProfile,
} from "../runtime/capabilities.js";
import type { Effort, RuntimeKind } from "../runtime/types.js";
import { parseRolesText, type RolesFile } from "./roles.js";
import { sha256, writeLifecycleFileAtomic } from "./lifecycle.js";

export const ROLE_ASSIGNMENT_JOURNAL_VERSION = 1 as const;

/** `<state-home>/lifecycle/role-assignments.jsonl` — append-only. */
export function roleAssignmentJournalPath(stateHome: string): string {
  return join(stateHome, "lifecycle", "role-assignments.jsonl");
}

export interface RoleAssignmentEdit {
  runtime?: RuntimeKind;
  model?: string;
  effort?: Effort;
  turnBudgetUsd?: number;
}

export interface RoleAssignmentSnapshot {
  runtime: RuntimeKind;
  model: string;
  effort: Effort;
  maxTurnBudgetUsd: number;
  /** True when the budget comes from `defaults.max_turn_budget_usd`. */
  turnBudgetInherited: boolean;
}

export interface RoleAssignmentFieldChange {
  field: "runtime" | "model" | "effort" | "max_turn_budget_usd";
  from: string | number;
  to: string | number;
}

export interface RoleAssignmentBlocker {
  code:
    | "unknown_role"
    | "no_change_requested"
    | "no_effective_change"
    | "invalid_assignment"
    | "invalid_turn_budget"
    | "unratified_execution"
    | "missing_reason"
    | "roles_file_missing"
    | "role_entry_not_a_mapping";
  detail: string;
}

export interface RoleAssignmentChangePlan {
  schema_version: typeof ROLE_ASSIGNMENT_JOURNAL_VERSION;
  kind: "role-assignment-change";
  rolesPath: string;
  role: string;
  before?: RoleAssignmentSnapshot;
  after?: RoleAssignmentSnapshot;
  changes: RoleAssignmentFieldChange[];
  /** Adapter facts the new tuple was checked against, for the operator. */
  capabilityNote?: string;
  blockers: RoleAssignmentBlocker[];
  executed: boolean;
  reason: string | null;
  by: string | null;
  journalPath: string | null;
  /** Content identity of roles.yaml before and (when executed) after. */
  rolesSha256Before?: string;
  rolesSha256After?: string;
}

export interface ApplyRoleAssignmentOptions {
  orgHome: string;
  stateHome: string;
  role: string;
  edit: RoleAssignmentEdit;
  reason?: string;
  by?: string;
  execute?: boolean;
  now?: () => Date;
}

/**
 * Plan (and optionally apply) one role assignment change. Without
 * `execute: true` nothing on disk changes — the returned plan is the proposal
 * an operator or a PR reviews.
 */
export async function applyRoleAssignmentChange(
  options: ApplyRoleAssignmentOptions,
): Promise<RoleAssignmentChangePlan> {
  const rolesPath = join(options.orgHome, "roles.yaml");
  const journalPath = roleAssignmentJournalPath(options.stateHome);
  const base: RoleAssignmentChangePlan = {
    schema_version: ROLE_ASSIGNMENT_JOURNAL_VERSION,
    kind: "role-assignment-change",
    rolesPath,
    role: options.role,
    changes: [],
    blockers: [],
    executed: false,
    reason: options.reason ?? null,
    by: options.by ?? null,
    journalPath: options.execute === true ? journalPath : null,
  };

  if (!existsSync(rolesPath)) {
    return blocked(base, {
      code: "roles_file_missing",
      detail: `${rolesPath} does not exist; select an org with "operon org use" first`,
    });
  }
  const text = await readFile(rolesPath, "utf8");
  base.rolesSha256Before = sha256(text);
  const current = parseRolesText(text, rolesPath);
  const role = current.roles.find((entry) => entry.name === options.role);
  if (role === undefined) {
    return blocked(base, {
      code: "unknown_role",
      detail:
        `unknown role ${JSON.stringify(options.role)}; roles.yaml defines: ` +
        current.roles.map((entry) => entry.name).join(", "),
    });
  }
  const budget = current.roleTurnBudgets.find((entry) => entry.name === options.role)!;
  const before: RoleAssignmentSnapshot = {
    runtime: role.runtime,
    model: role.model,
    effort: role.effort,
    maxTurnBudgetUsd: budget.effectiveTurnBudgetUsd,
    turnBudgetInherited: budget.turnBudgetInherited,
  };
  base.before = before;

  const edit = options.edit;
  if (
    edit.runtime === undefined && edit.model === undefined &&
    edit.effort === undefined && edit.turnBudgetUsd === undefined
  ) {
    return blocked(base, {
      code: "no_change_requested",
      detail: "supply at least one of --runtime, --model, --effort, --turn-budget",
    });
  }
  if (
    edit.turnBudgetUsd !== undefined &&
    (!Number.isFinite(edit.turnBudgetUsd) || edit.turnBudgetUsd <= 0)
  ) {
    return blocked(base, {
      code: "invalid_turn_budget",
      detail: "--turn-budget must be a positive number of US dollars",
    });
  }

  // Validate the RESULTING tuple, not the supplied field. Changing only the
  // effort can still produce a combination the harness cannot execute.
  let after: RoleAssignmentSnapshot;
  try {
    const assignment = validateTurnAssignment(
      {
        harness: edit.runtime ?? before.runtime,
        model: edit.model ?? before.model,
        effort: edit.effort ?? before.effort,
      },
      `roles set ${JSON.stringify(options.role)}: resulting assignment`,
    );
    after = {
      runtime: assignment.harness,
      model: assignment.model,
      effort: assignment.effort,
      maxTurnBudgetUsd: edit.turnBudgetUsd ?? before.maxTurnBudgetUsd,
      turnBudgetInherited: edit.turnBudgetUsd === undefined && before.turnBudgetInherited,
    };
  } catch (error) {
    return blocked(base, {
      code: "invalid_assignment",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
  base.after = after;
  base.changes = fieldChanges(before, after);
  const profile = runtimeCapabilityProfile(after.runtime);
  base.capabilityNote =
    `${after.runtime} adapter ${profile.ref}: accepts ` +
    `${supportedEffortsFor(after.runtime).join(" | ")}; resolved capabilities ` +
    `${resolvedRuntimeCapabilities(after.runtime).join(", ") || "none"}`;

  if (base.changes.length === 0) {
    return blocked(base, {
      code: "no_effective_change",
      detail: "the requested values already match the configured role",
    });
  }
  if (options.execute !== true) return base;

  // The ratification boundary. An unattributable caller gets the proposal
  // above and nothing else; it cannot quietly re-tier a role onto a more
  // expensive model.
  if (options.by === undefined || options.by.trim() === "") {
    return blocked(base, {
      code: "unratified_execution",
      detail:
        "--execute requires an attributable --by <identity>; without it this is a " +
        "proposal to hand to a human, not a ratified change",
    });
  }
  if (options.reason === undefined || options.reason.trim() === "") {
    return blocked(base, {
      code: "missing_reason",
      detail: "--execute requires --reason <text>; the journal records why, not only what",
    });
  }

  const rendered = renderRolesWithRole(text, rolesPath, options.role, after);
  if (typeof rendered !== "string") return blocked(base, rendered);
  // Prove the candidate parses to a valid org chart with exactly the intended
  // role before it replaces the ratified file.
  assertRenderedRole(parseRolesText(rendered, rolesPath), options.role, after, rolesPath);

  await writeLifecycleFileAtomic(rolesPath, rendered);
  base.rolesSha256After = sha256(rendered);
  base.executed = true;
  base.journalPath = journalPath;
  await appendRoleAssignmentJournal(journalPath, {
    schema_version: ROLE_ASSIGNMENT_JOURNAL_VERSION,
    at: (options.now?.() ?? new Date()).toISOString(),
    roles_path: rolesPath,
    role: options.role,
    by: options.by.trim(),
    reason: options.reason.trim(),
    before,
    after,
    changes: base.changes,
    roles_sha256_before: base.rolesSha256Before,
    roles_sha256_after: base.rolesSha256After,
  });
  return base;
}

export interface RoleAssignmentJournalEntry {
  schema_version: typeof ROLE_ASSIGNMENT_JOURNAL_VERSION;
  at: string;
  roles_path: string;
  role: string;
  by: string;
  reason: string;
  before: RoleAssignmentSnapshot;
  after: RoleAssignmentSnapshot;
  changes: RoleAssignmentFieldChange[];
  roles_sha256_before?: string;
  roles_sha256_after?: string;
}

async function appendRoleAssignmentJournal(
  path: string,
  entry: RoleAssignmentJournalEntry,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(entry)}\n`, "utf8");
}

/** Human-readable before/after, for the text surface. */
export function formatRoleAssignmentPlan(plan: RoleAssignmentChangePlan): string {
  const lines = [
    `${plan.executed ? "APPLIED" : "PREVIEW"} roles set ${plan.role} — ${plan.rolesPath}`,
  ];
  if (plan.before !== undefined) {
    lines.push(`  before: ${describeSnapshot(plan.before)}`);
  }
  if (plan.after !== undefined) {
    lines.push(`  after:  ${describeSnapshot(plan.after)}`);
  }
  for (const change of plan.changes) {
    lines.push(`  ${change.field}: ${change.from} -> ${change.to}`);
  }
  if (plan.capabilityNote !== undefined) lines.push(`  ${plan.capabilityNote}`);
  for (const blocker of plan.blockers) lines.push(`  BLOCKED ${blocker.code}: ${blocker.detail}`);
  if (plan.blockers.length === 0 && !plan.executed) {
    lines.push(
      "  Nothing was written. Apply with: --execute --by <identity> --reason <text>",
    );
  }
  if (plan.executed) lines.push(`  journaled: ${plan.journalPath}`);
  return lines.join("\n");
}

function describeSnapshot(snapshot: RoleAssignmentSnapshot): string {
  return (
    `${snapshot.runtime}/${snapshot.model}@${snapshot.effort} ` +
    `turn budget $${snapshot.maxTurnBudgetUsd}${snapshot.turnBudgetInherited ? " (inherited)" : ""}`
  );
}

function fieldChanges(
  before: RoleAssignmentSnapshot,
  after: RoleAssignmentSnapshot,
): RoleAssignmentFieldChange[] {
  const changes: RoleAssignmentFieldChange[] = [];
  if (before.runtime !== after.runtime) {
    changes.push({ field: "runtime", from: before.runtime, to: after.runtime });
  }
  if (before.model !== after.model) {
    changes.push({ field: "model", from: before.model, to: after.model });
  }
  if (before.effort !== after.effort) {
    changes.push({ field: "effort", from: before.effort, to: after.effort });
  }
  // An inherited budget made explicit at the same amount is a real change to
  // the file, but not to what any turn may spend. Report only the amount.
  if (before.maxTurnBudgetUsd !== after.maxTurnBudgetUsd) {
    changes.push({
      field: "max_turn_budget_usd",
      from: before.maxTurnBudgetUsd,
      to: after.maxTurnBudgetUsd,
    });
  }
  return changes;
}

/**
 * Rewrite exactly the touched scalars through the YAML document model, so
 * every surrounding comment, key order, and unrelated value survives.
 */
function renderRolesWithRole(
  text: string,
  rolesPath: string,
  role: string,
  after: RoleAssignmentSnapshot,
): string | RoleAssignmentBlocker {
  const doc: Document = parseDocument(text);
  if (!isDocument(doc) || doc.errors.length > 0) {
    return {
      code: "role_entry_not_a_mapping",
      detail: `${rolesPath}: ${doc.errors[0]?.message ?? "cannot be parsed as a YAML document"}`,
    };
  }
  const entry = doc.getIn(["roles", role]);
  if (!isMap(entry)) {
    return {
      code: "role_entry_not_a_mapping",
      detail: `${rolesPath}: roles.${role} is not a mapping`,
    };
  }
  doc.setIn(["roles", role, "runtime"], after.runtime);
  doc.setIn(["roles", role, "model"], after.model);
  doc.setIn(["roles", role, "effort"], after.effort);
  if (after.turnBudgetInherited) doc.deleteIn(["roles", role, "max_turn_budget_usd"]);
  else doc.setIn(["roles", role, "max_turn_budget_usd"], after.maxTurnBudgetUsd);
  const rendered = String(doc);
  return rendered.endsWith("\n") ? rendered : `${rendered}\n`;
}

function assertRenderedRole(
  parsed: RolesFile,
  role: string,
  after: RoleAssignmentSnapshot,
  rolesPath: string,
): void {
  const written = parsed.roles.find((entry) => entry.name === role);
  const budget = parsed.roleTurnBudgets.find((entry) => entry.name === role);
  if (
    written === undefined || budget === undefined ||
    written.runtime !== after.runtime || written.model !== after.model ||
    written.effort !== after.effort ||
    budget.effectiveTurnBudgetUsd !== after.maxTurnBudgetUsd
  ) {
    throw new Error(
      `roles set: the rewritten ${rolesPath} does not read back as the planned ` +
        `${role} assignment; nothing was applied`,
    );
  }
}

function blocked(
  plan: RoleAssignmentChangePlan,
  blocker: RoleAssignmentBlocker,
): RoleAssignmentChangePlan {
  return { ...plan, blockers: [...plan.blockers, blocker], executed: false };
}

/** The effort levels the harness actually accepts, derived from the one
 *  validator that owns the rule rather than restated here. */
function supportedEffortsFor(runtime: RuntimeKind): Effort[] {
  return TURN_ASSIGNMENT_EFFORTS.filter((effort) => {
    try {
      validateTurnAssignment({ harness: runtime, model: "probe", effort });
      return true;
    } catch {
      return false;
    }
  });
}
