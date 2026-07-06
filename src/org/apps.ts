// apps.yaml loader + validation — the app registry (docs/architecture.md §7).
// Mirrors the roles.ts patterns: parse YAML, validate strictly, return plain
// typed data. Multi-app exists only at this org layer and in human surfaces —
// never inside a turn (PURPOSE.md → One turn, one app).

import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import type { RoleConfig, Trigger } from "../runtime/types.js";

export type AppStatus = "live" | "paused" | "onboarding";

const STATUSES: AppStatus[] = ["live", "paused", "onboarding"];

export interface AppEntry {
  name: string;
  /** GitHub slug (`owner/repo`) — the app's identity. */
  repo: string;
  /** Operational policy, not code: "one live app at a time" is expressed
   *  here; the org-level WIP limit is what code enforces. */
  status: AppStatus;
  budgetUsdMonth: number;
  /** Per-role trigger overrides. When a role has an entry here it REPLACES
   *  (never merges with) that role's roles.yaml triggers; an empty list
   *  disables the role for this app. See resolveTriggers(). */
  cadence: Record<string, Trigger[]>;
}

export interface AppsFile {
  /** Present when the file carries the public-contract version field
   *  (architecture.md §1 — `.operon/config.yaml` shares this schema). */
  schemaVersion?: number;
  org: { name: string; maxConcurrentTurns: number };
  defaults: { budgetUsdMonth: number };
  apps: AppEntry[];
}

export async function loadApps(path: string): Promise<AppsFile> {
  const raw = parse(await readFile(path, "utf8")) as Record<string, unknown>;
  if (!raw || typeof raw !== "object") throw new Error(`${path}: not a YAML mapping`);

  const orgRaw = raw["org"];
  if (!orgRaw || typeof orgRaw !== "object") {
    throw new Error(`${path}: missing top-level "org" mapping`);
  }
  const orgSpec = orgRaw as Record<string, unknown>;
  const orgName = orgSpec["name"];
  if (typeof orgName !== "string" || orgName.length === 0) {
    throw new Error(`${path}: org.name is required`);
  }
  const org = {
    name: orgName,
    maxConcurrentTurns: numberOr(orgSpec["max_concurrent_turns"], 2),
  };

  const defaultsRaw = (raw["defaults"] ?? {}) as Record<string, unknown>;
  const defaults = {
    budgetUsdMonth: numberOr(defaultsRaw["budget_usd_month"], 1000),
  };

  const appsRaw = raw["apps"];
  if (!appsRaw || typeof appsRaw !== "object" || Array.isArray(appsRaw)) {
    throw new Error(`${path}: missing top-level "apps" mapping`);
  }

  const apps: AppEntry[] = [];
  for (const [name, specUnknown] of Object.entries(appsRaw as Record<string, unknown>)) {
    apps.push(parseApp(name, specUnknown, defaults.budgetUsdMonth, path));
  }
  if (apps.length === 0) throw new Error(`${path}: no apps defined`);

  const file: AppsFile = { org, defaults, apps };
  if (typeof raw["schema_version"] === "number") file.schemaVersion = raw["schema_version"];
  return file;
}

function parseApp(
  name: string,
  specUnknown: unknown,
  defaultBudget: number,
  path: string,
): AppEntry {
  const err = (msg: string) => new Error(`${path}: app "${name}": ${msg}`);
  if (!specUnknown || typeof specUnknown !== "object") throw err("not a mapping");
  const spec = specUnknown as Record<string, unknown>;

  const repo = spec["repo"];
  if (typeof repo !== "string" || repo.length === 0) {
    throw err("repo is required (GitHub owner/repo slug)");
  }

  const status = spec["status"];
  if (typeof status !== "string" || !STATUSES.includes(status as AppStatus)) {
    throw err(`status must be one of ${STATUSES.join(" | ")}`);
  }

  const cadence: Record<string, Trigger[]> = {};
  if (spec["cadence"] !== undefined && spec["cadence"] !== null) {
    const cadenceRaw = spec["cadence"];
    if (typeof cadenceRaw !== "object" || Array.isArray(cadenceRaw)) {
      throw err("cadence must be a mapping of role -> trigger list");
    }
    for (const [role, listUnknown] of Object.entries(cadenceRaw as Record<string, unknown>)) {
      if (!Array.isArray(listUnknown)) {
        throw err(`cadence.${role} must be a list (empty list disables the role)`);
      }
      const triggers: Trigger[] = [];
      for (const t of listUnknown as Record<string, unknown>[]) {
        const trigger: Trigger = {};
        if (t && typeof t === "object") {
          if (typeof t["schedule"] === "string") trigger.schedule = t["schedule"];
          if (typeof t["event"] === "string") trigger.event = t["event"];
        }
        if (!trigger.schedule && !trigger.event) {
          throw err(`cadence.${role}: trigger needs schedule or event`);
        }
        triggers.push(trigger);
      }
      cadence[role] = triggers;
    }
  }

  return {
    name,
    repo,
    status: status as AppStatus,
    budgetUsdMonth: numberOr(spec["budget_usd_month"], defaultBudget),
    cadence,
  };
}

/** Effective triggers for a role on one app (docs/architecture.md §2, §7):
 *  a cadence override REPLACES the role's roles.yaml triggers when present
 *  (never merges); an empty override list disables the role for that app;
 *  no override falls back to the role's own triggers. */
export function resolveTriggers(role: RoleConfig, app: AppEntry): Trigger[] {
  return app.cadence[role.name] ?? role.triggers;
}

function numberOr(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}
