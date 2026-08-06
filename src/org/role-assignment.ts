// `cormidia roles set` — the only write path for a role's model, effort, and
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
import { isDocument, isMap, isScalar, parseDocument, stringify, type Document, type Pair, type YAMLMap } from "yaml";
import { TURN_ASSIGNMENT_EFFORTS, validateTurnAssignment } from "../runtime/assignment.js";
import { resolvedRuntimeCapabilities, runtimeCapabilityProfile } from "../runtime/capabilities.js";
import {
  describeModelCatalogCheck,
  modelServedByCatalog,
  readRuntimeModelCatalog,
  type RuntimeModelCatalogReader,
} from "../runtime/model-catalog.js";
import type { Effort, RuntimeKind } from "../runtime/types.js";
import { sha256, writeLifecycleFileAtomic } from "./lifecycle.js";
import { parseRolesText, type RolesFile } from "./roles.js";

const ROLE_ASSIGNMENT_JOURNAL_VERSION = 1 as const;

/** `<state-home>/lifecycle/role-assignments.jsonl` — append-only. */
function roleAssignmentJournalPath(stateHome: string): string {
  return join(stateHome, "lifecycle", "role-assignments.jsonl");
}

export interface RoleAssignmentEdit {
  runtime?: RuntimeKind;
  model?: string;
  effort?: Effort;
  turnBudgetUsd?: number;
}

interface RoleAssignmentSnapshot {
  runtime: RuntimeKind;
  model: string;
  effort: Effort;
  maxTurnBudgetUsd: number;
  /** True when the budget comes from `defaults.max_turn_budget_usd`. */
  turnBudgetInherited: boolean;
}

interface RoleAssignmentFieldChange {
  field: "runtime" | "model" | "effort" | "max_turn_budget_usd";
  from: string | number;
  to: string | number;
}

interface RoleAssignmentBlocker {
  code:
    | "unknown_role"
    | "no_change_requested"
    | "no_effective_change"
    | "invalid_assignment"
    | "invalid_turn_budget"
    | "model_not_served"
    | "unratified_execution"
    | "missing_reason"
    | "roles_file_missing"
    | "role_entry_not_a_mapping"
    | "role_field_not_a_scalar";
  detail: string;
}

/** The recorded outcome of the harness-roster check, without the roster
 *  itself: a pi registry lists thousands of ids and the journal wants the
 *  decision, not the catalog. */
interface RoleAssignmentModelCatalogCheck {
  runtime: RuntimeKind;
  model: string;
  /** True only when a roster existed AND it lists this id. */
  verified: boolean;
  /** Where the roster came from, when there was one. */
  source?: string;
  modelCount?: number;
  /** Why the harness publishes no token-free roster, when it does not. */
  reason?: string;
}

interface RoleAssignmentChangePlan {
  schema_version: typeof ROLE_ASSIGNMENT_JOURNAL_VERSION;
  kind: "role-assignment-change";
  rolesPath: string;
  role: string;
  before?: RoleAssignmentSnapshot;
  after?: RoleAssignmentSnapshot;
  changes: RoleAssignmentFieldChange[];
  /** Adapter facts the new tuple was checked against, for the operator. */
  capabilityNote?: string;
  /** Whether the resulting model id was proven against the harness roster. */
  modelCatalog?: RoleAssignmentModelCatalogCheck;
  /** Operator-facing rendering of `modelCatalog`, proven or explicitly not. */
  modelCatalogNote?: string;
  blockers: RoleAssignmentBlocker[];
  executed: boolean;
  reason: string | null;
  by: string | null;
  journalPath: string | null;
  /** Content identity of roles.yaml before and (when executed) after. */
  rolesSha256Before?: string;
  rolesSha256After?: string;
}

interface ApplyRoleAssignmentOptions {
  orgHome: string;
  stateHome: string;
  role: string;
  edit: RoleAssignmentEdit;
  reason?: string;
  by?: string;
  execute?: boolean;
  now?: () => Date;
  /** Override the harness roster lookup. Tests inject a deterministic one. */
  readModelCatalog?: RuntimeModelCatalogReader;
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
      detail: `${rolesPath} does not exist; select an org with "cormidia org use" first`,
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
    edit.runtime === undefined &&
    edit.model === undefined &&
    edit.effort === undefined &&
    edit.turnBudgetUsd === undefined
  ) {
    return blocked(base, {
      code: "no_change_requested",
      detail: "supply at least one of --runtime, --model, --effort, --turn-budget",
    });
  }
  if (edit.turnBudgetUsd !== undefined && (!Number.isFinite(edit.turnBudgetUsd) || edit.turnBudgetUsd <= 0)) {
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

  // ENH-004: "a model string the adapter does not serve" must not be deferred
  // to dispatch inside a paid turn. Where the harness publishes a token-free
  // roster this refuses before the ratified file is touched; where it does not,
  // the plan says so out loud instead of implying the id was checked.
  const catalog = await (options.readModelCatalog ?? readRuntimeModelCatalog)(after.runtime);
  const served = modelServedByCatalog(catalog, after.model);
  base.modelCatalog = {
    runtime: after.runtime,
    model: after.model,
    verified: catalog.available && served,
    ...(catalog.available ? { source: catalog.source, modelCount: catalog.models.length } : { reason: catalog.reason }),
  };
  base.modelCatalogNote = describeModelCatalogCheck(catalog, after.model);
  if (!served && catalog.available) {
    return blocked(base, {
      code: "model_not_served",
      detail:
        `${after.runtime} does not serve model ${JSON.stringify(after.model)}; ` +
        `its roster (${catalog.source}, ${catalog.models.length} models) has no such id`,
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

  const rendered = renderRolesWithRole(text, rolesPath, options.role, base.changes);
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
    ...(base.modelCatalog === undefined ? {} : { model_catalog: base.modelCatalog }),
    roles_sha256_before: base.rolesSha256Before,
    roles_sha256_after: base.rolesSha256After,
  });
  return base;
}

interface RoleAssignmentJournalEntry {
  schema_version: typeof ROLE_ASSIGNMENT_JOURNAL_VERSION;
  at: string;
  roles_path: string;
  role: string;
  by: string;
  reason: string;
  before: RoleAssignmentSnapshot;
  after: RoleAssignmentSnapshot;
  changes: RoleAssignmentFieldChange[];
  /** What the harness roster proved, or why it could prove nothing. An
   *  applied-but-unproven model id has to be as durable as the change it
   *  describes; reading it back off the terminal was not evidence. */
  model_catalog?: RoleAssignmentModelCatalogCheck;
  roles_sha256_before?: string;
  roles_sha256_after?: string;
}

async function appendRoleAssignmentJournal(path: string, entry: RoleAssignmentJournalEntry): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(entry)}\n`, "utf8");
}

/**
 * True when this change is what puts a model id nothing could verify into the
 * ratified file: the harness publishes no token-free roster AND this command
 * is the one setting the harness/model pair.
 *
 * ENH-004 catches "a model string the adapter does not serve" wherever a
 * roster exists, and pi is currently the only harness that publishes one. The
 * asymmetry is real and cannot be closed from a config edit — so it is said
 * out loud, in one predicate both the text and the CLI surface read, at the
 * moment the unprovable id is actually introduced. Restating it on every
 * effort-only edit of a long-settled role would train the operator to skip it.
 */
export function isUnverifiedModelIdChange(plan: RoleAssignmentChangePlan): boolean {
  if (plan.modelCatalog === undefined || plan.modelCatalog.verified || plan.modelCatalog.reason === undefined) {
    return false;
  }
  return plan.changes.some((change) => change.field === "model" || change.field === "runtime");
}

/** Human-readable before/after, for the text surface. */
export function formatRoleAssignmentPlan(plan: RoleAssignmentChangePlan): string {
  const lines = [`${plan.executed ? "APPLIED" : "PREVIEW"} roles set ${plan.role} — ${plan.rolesPath}`];
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
  if (plan.modelCatalogNote !== undefined) lines.push(`  ${plan.modelCatalogNote}`);
  if (isUnverifiedModelIdChange(plan) && plan.modelCatalog !== undefined) {
    lines.push(
      plan.executed
        ? `  WARNING: applied an UNVERIFIED model id — nothing has proven ${plan.modelCatalog.runtime} ` +
            `serves ${plan.modelCatalog.model}; prove it with \`cormidia doctor\` before the next turn ` +
            "spends on it"
        : `  WARNING: ${plan.modelCatalog.model} cannot be checked before it is applied; ` +
            `\`cormidia doctor\` probes the ${plan.modelCatalog.runtime} adapter and is what proves it`,
    );
  }
  for (const blocker of plan.blockers) lines.push(`  BLOCKED ${blocker.code}: ${blocker.detail}`);
  if (plan.blockers.length === 0 && !plan.executed) {
    lines.push("  Nothing was written. Apply with: --execute --by <identity> --reason <text>");
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

function fieldChanges(before: RoleAssignmentSnapshot, after: RoleAssignmentSnapshot): RoleAssignmentFieldChange[] {
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

/** The scalar keys this command owns, in the order roles.yaml declares them.
 *  Used only to anchor a key that has to be inserted. */
const ROLE_SCALAR_KEYS = ["runtime", "model", "effort", "max_turn_budget_usd"] as const;

interface TextSplice {
  start: number;
  end: number;
  text: string;
}

/**
 * Rewrite exactly the scalars that changed, as byte splices over the original
 * file — never by re-emitting the YAML document.
 *
 * roles.yaml is a human-ratified org-runtime surface whose comments carry the
 * org's actual reasoning. Re-emitting it from the document model rewrites the
 * whole file: flow sequences in untouched roles are respaced, and a multi-line
 * trailing comment block is re-anchored underneath the key it documented. Both
 * make every later human diff unreadable and detach rationale from what it
 * explains. Splicing leaves every byte outside the named scalars untouched, so
 * a two-scalar edit is a two-line diff.
 */
function renderRolesWithRole(
  text: string,
  rolesPath: string,
  role: string,
  changes: readonly RoleAssignmentFieldChange[],
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

  const splices: TextSplice[] = [];
  for (const change of changes) {
    const value = renderScalarValue(change.to);
    if (value === undefined) {
      return {
        code: "role_field_not_a_scalar",
        detail:
          `${rolesPath}: roles.${role}.${change.field} value ${JSON.stringify(String(change.to))} ` +
          "does not render as a single-line YAML scalar",
      };
    }
    const node = entry.get(change.field, true);
    if (node === undefined || node === null) {
      const insertion = insertScalarLine(text, entry, change.field, value);
      if (insertion === undefined) {
        return {
          code: "role_field_not_a_scalar",
          detail:
            `${rolesPath}: cannot add roles.${role}.${change.field} without rewriting the file; ` +
            "add the key by hand so the surrounding comments stay where you put them",
        };
      }
      splices.push(insertion);
      continue;
    }
    const range = scalarRange(node);
    if (range === undefined) {
      return {
        code: "role_field_not_a_scalar",
        detail: `${rolesPath}: roles.${role}.${change.field} is not a plain scalar`,
      };
    }
    splices.push(alignedSplice(text, range[0], range[1], value));
  }

  const applied = applySplices(text, splices);
  if (applied === undefined) {
    return {
      code: "role_field_not_a_scalar",
      detail: `${rolesPath}: roles.${role} edits overlap; nothing was rewritten`,
    };
  }
  return applied.endsWith("\n") ? applied : `${applied}\n`;
}

/** The new value, exactly as YAML would emit it on one line. */
function renderScalarValue(value: string | number): string | undefined {
  const rendered = stringify(value, { lineWidth: 0 }).replace(/\n$/, "");
  return rendered.length === 0 || rendered.includes("\n") ? undefined : rendered;
}

/**
 * Replace a scalar in place, keeping any trailing comment in its original
 * column. The packaged chart aligns comment blocks under their first line;
 * shifting the `#` by one character would visually detach every continuation
 * line below it.
 */
function alignedSplice(text: string, start: number, end: number, value: string): TextSplice {
  const rest = text.slice(end, lineEndFrom(text, end));
  const gap = /^( +)#/.exec(rest);
  if (gap === null) return { start, end, text: value };
  const column = end - start + gap[1]!.length;
  return { start, end: end + gap[1]!.length, text: value + " ".repeat(Math.max(1, column - value.length)) };
}

/**
 * Place a key the role does not declare yet on its own line, directly after
 * the nearest preceding sibling this command owns (and after that sibling's
 * own trailing comment block, so nothing is split apart).
 */
function insertScalarLine(text: string, entry: YAMLMap, key: string, value: string): TextSplice | undefined {
  const position = ROLE_SCALAR_KEYS.indexOf(key as (typeof ROLE_SCALAR_KEYS)[number]);
  if (position < 0) return undefined;
  for (let index = position - 1; index >= 0; index--) {
    const pair = findPair(entry, ROLE_SCALAR_KEYS[index]!);
    const keyStart = pair === undefined ? undefined : scalarRange(pair.key)?.[0];
    const at = pair === undefined ? undefined : pairEnd(pair);
    if (keyStart === undefined || at === undefined) continue;
    const indent = indentOf(text, keyStart);
    if (indent === undefined) continue;
    const prefix = at === 0 || text[at - 1] === "\n" ? "" : "\n";
    return { start: at, end: at, text: `${prefix}${indent}${key}: ${value}\n` };
  }
  return undefined;
}

function findPair(entry: YAMLMap, key: string): Pair | undefined {
  return (entry.items as Pair[]).find((item) => isScalar(item.key) && item.key.value === key);
}

function scalarRange(node: unknown): readonly [number, number, number] | undefined {
  if (!isScalar(node)) return undefined;
  return node.range ?? undefined;
}

/** End of a key/value pair, past any comment block bound to its value. */
function pairEnd(pair: Pair): number | undefined {
  return scalarRange(pair.value)?.[2] ?? scalarRange(pair.key)?.[2];
}

/** The pure-space indentation of the line `index` sits on. */
function indentOf(text: string, index: number): string | undefined {
  const lineStart = text.lastIndexOf("\n", Math.max(0, index - 1)) + 1;
  const prefix = text.slice(lineStart, index);
  return /^ *$/.test(prefix) ? prefix : undefined;
}

function lineEndFrom(text: string, index: number): number {
  const newline = text.indexOf("\n", index);
  return newline === -1 ? text.length : newline;
}

function applySplices(text: string, splices: readonly TextSplice[]): string | undefined {
  const ordered = [...splices].sort((a, b) => a.start - b.start);
  for (let index = 1; index < ordered.length; index++) {
    if (ordered[index]!.start < ordered[index - 1]!.end) return undefined;
  }
  let result = text;
  for (const splice of [...ordered].reverse()) {
    result = result.slice(0, splice.start) + splice.text + result.slice(splice.end);
  }
  return result;
}

function assertRenderedRole(parsed: RolesFile, role: string, after: RoleAssignmentSnapshot, rolesPath: string): void {
  const written = parsed.roles.find((entry) => entry.name === role);
  const budget = parsed.roleTurnBudgets.find((entry) => entry.name === role);
  if (
    written === undefined ||
    budget === undefined ||
    written.runtime !== after.runtime ||
    written.model !== after.model ||
    written.effort !== after.effort ||
    budget.effectiveTurnBudgetUsd !== after.maxTurnBudgetUsd
  ) {
    throw new Error(
      `roles set: the rewritten ${rolesPath} does not read back as the planned ` +
        `${role} assignment; nothing was applied`,
    );
  }
}

function blocked(plan: RoleAssignmentChangePlan, blocker: RoleAssignmentBlocker): RoleAssignmentChangePlan {
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
