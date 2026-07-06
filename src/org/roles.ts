// roles.yaml loader + validation. The file is the org chart made executable —
// "the agent is the code" (docs/PURPOSE.md non-negotiable #3).

import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import type { Effort, RoleConfig, RuntimeKind, Trigger } from "../runtime/types.js";

const RUNTIMES: RuntimeKind[] = ["claude", "codex", "pi"];
const EFFORTS: Effort[] = ["low", "medium", "high", "xhigh", "max"];

export interface RolesFile {
  defaults: { maxTurnBudgetUsd: number };
  roles: RoleConfig[];
}

export async function loadRoles(path: string): Promise<RolesFile> {
  const raw = parse(await readFile(path, "utf8")) as Record<string, unknown>;
  if (!raw || typeof raw !== "object") throw new Error(`${path}: not a YAML mapping`);

  const defaultsRaw = (raw["defaults"] ?? {}) as Record<string, unknown>;
  const defaults = {
    maxTurnBudgetUsd: numberOr(defaultsRaw["max_turn_budget_usd"], 5),
  };

  const rolesRaw = raw["roles"];
  if (!rolesRaw || typeof rolesRaw !== "object") {
    throw new Error(`${path}: missing top-level "roles" mapping`);
  }

  const roles: RoleConfig[] = [];
  for (const [name, specUnknown] of Object.entries(rolesRaw as Record<string, unknown>)) {
    roles.push(parseRole(name, specUnknown, defaults.maxTurnBudgetUsd, path));
  }
  if (roles.length === 0) throw new Error(`${path}: no roles defined`);
  return { defaults, roles };
}

function parseRole(
  name: string,
  specUnknown: unknown,
  defaultBudget: number,
  path: string,
): RoleConfig {
  const err = (msg: string) => new Error(`${path}: role "${name}": ${msg}`);
  if (!specUnknown || typeof specUnknown !== "object") throw err("not a mapping");
  const spec = specUnknown as Record<string, unknown>;

  const runtime = spec["runtime"];
  if (typeof runtime !== "string" || !RUNTIMES.includes(runtime as RuntimeKind)) {
    throw err(`runtime must be one of ${RUNTIMES.join(" | ")}`);
  }
  const model = spec["model"];
  if (typeof model !== "string" || model.length === 0) throw err("model is required");

  const effort = spec["effort"];
  if (typeof effort !== "string" || !EFFORTS.includes(effort as Effort)) {
    throw err(`effort must be one of ${EFFORTS.join(" | ")}`);
  }

  const delegationRaw = (spec["delegation"] ?? {}) as Record<string, unknown>;
  const allow = Array.isArray(delegationRaw["allow"])
    ? (delegationRaw["allow"] as unknown[]).map(String)
    : [];

  const triggers: Trigger[] = [];
  if (Array.isArray(spec["triggers"])) {
    for (const t of spec["triggers"] as Record<string, unknown>[]) {
      const trigger: Trigger = {};
      if (typeof t["schedule"] === "string") trigger.schedule = t["schedule"];
      if (typeof t["event"] === "string") trigger.event = t["event"];
      if (t["manual"] === true) trigger.manual = true;
      if (!trigger.schedule && !trigger.event && !trigger.manual) {
        throw err("trigger needs schedule, event, or manual");
      }
      triggers.push(trigger);
    }
  }

  const outputs = Array.isArray(spec["outputs"])
    ? (spec["outputs"] as unknown[]).map(String)
    : [];

  return {
    name,
    runtime: runtime as RuntimeKind,
    model,
    effort: effort as Effort,
    delegation: { allow },
    triggers,
    outputs,
    maxTurnBudgetUsd: numberOr(spec["max_turn_budget_usd"], defaultBudget),
  };
}

function numberOr(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}
