// apps.yaml loader + validation — the app registry (docs/architecture.md §7).
// Mirrors the roles.ts patterns: parse YAML, validate strictly, return plain
// typed data. Multi-app exists only at this org layer and in human surfaces —
// never inside a turn (docs/PURPOSE.md → One turn, one app).

import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parse, stringify } from "yaml";
import type { RoleConfig, Trigger } from "../runtime/types.js";

export type AppStatus = "live" | "paused" | "onboarding";

const STATUSES: AppStatus[] = ["live", "paused", "onboarding"];

/** Feedback/publishing channels an app exposes (docs/PURPOSE.md → "Support
 *  and Marketing are disabled per app until that app has real feedback or
 *  adoption channels"). Shared apps.yaml / `.operon/config.yaml` schema:
 *  `channels.support` gates Support turns, `channels.marketing` gates
 *  Marketing turns. Absent or empty list = that role stays disabled for the
 *  app regardless of its schedule/event triggers (see resolveTriggerRoute). */
export interface AppChannels {
  support?: string[];
  marketing?: string[];
}

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
  /** Channel-presence gate source. `loadApps` always populates it (`{}` when
   *  the app declares none); optional here so hand-built entries (tests,
   *  registration) may omit it — the dispatcher treats absent as `{}`, i.e.
   *  Support/Marketing gated off. Read by resolveTriggerRoute. */
  channels?: AppChannels;
}

export interface AppsFile {
  /** Present when the file carries the public-contract version field
   *  (architecture.md §1 — `.operon/config.yaml` shares this schema). */
  schemaVersion?: number;
  org: { name: string; maxConcurrentTurns: number };
  defaults: { budgetUsdMonth: number };
  apps: AppEntry[];
}

export interface FindExistingOrgOptions {
  /** Explicit org home, e.g. CLI `--org-home`. */
  orgHome?: string;
  /** Environment source; defaults to process.env. */
  env?: Pick<NodeJS.ProcessEnv, "OPERON_HOME">;
  /** Home dir for the pointer-file lookup; defaults to the current user. */
  homeDir?: string;
  /** Override for tests; defaults to `${homeDir}/.operon/config`. */
  pointerPath?: string;
}

export interface AppRegistration {
  name: string;
  repo: string;
  status?: AppStatus;
  budgetUsdMonth?: number;
  cadence?: Record<string, Trigger[]>;
  channels?: AppChannels;
}

export interface JoinExistingOrgResult {
  orgHome: string;
  appsPath: string;
  app: AppEntry;
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
          if (t["manual"] === true) trigger.manual = true;
        }
        if (!trigger.schedule && !trigger.event && !trigger.manual) {
          throw err(`cadence.${role}: trigger needs schedule, event, or manual`);
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
    channels: parseChannels(spec["channels"], err),
  };
}

/** Parse the optional `channels` block. Absent → `{}` (role stays gated off).
 *  Only the `support`/`marketing` keys are recognised; each must be a list of
 *  channel identifiers. Mirrors the bootstrap emitter (src/org/bootstrap.ts). */
function parseChannels(raw: unknown, err: (msg: string) => Error): AppChannels {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw err("channels must be a mapping of support/marketing -> channel list");
  }
  const spec = raw as Record<string, unknown>;
  const channels: AppChannels = {};
  for (const key of ["support", "marketing"] as const) {
    if (spec[key] === undefined) continue;
    if (!Array.isArray(spec[key]) || (spec[key] as unknown[]).some((v) => typeof v !== "string")) {
      throw err(`channels.${key} must be a list of channel identifiers (strings)`);
    }
    channels[key] = spec[key] as string[];
  }
  return channels;
}

/** Effective triggers for a role on one app (docs/architecture.md §2, §7):
 *  a cadence override REPLACES the role's roles.yaml triggers when present
 *  (never merges); an empty override list disables the role for that app;
 *  no override falls back to the role's own triggers. */
export function resolveTriggers(role: RoleConfig, app: AppEntry): Trigger[] {
  return app.cadence[role.name] ?? role.triggers;
}

/** Detect an existing org home (architecture §9 step 4): explicit
 * `--org-home` wins, then OPERON_HOME, then a pointer file at
 * `~/.operon/config`. The pointer file accepts YAML/JSON with `org_home`
 * or `orgHome`, or a plain path. */
export async function findExistingOrg(
  options: FindExistingOrgOptions = {},
): Promise<string | undefined> {
  if (options.orgHome !== undefined) return resolve(options.orgHome);

  const env = options.env ?? process.env;
  if (env.OPERON_HOME && env.OPERON_HOME.length > 0) return resolve(env.OPERON_HOME);

  const pointerPath = options.pointerPath ?? join(options.homeDir ?? homedir(), ".operon", "config");
  if (!existsSync(pointerPath)) return undefined;

  const text = (await readFile(pointerPath, "utf8")).trim();
  if (text.length === 0) return undefined;

  const parsed = parsePointer(text);
  return parsed ? resolve(parsed) : undefined;
}

function parsePointer(text: string): string | undefined {
  try {
    const raw = parse(text) as unknown;
    if (typeof raw === "string") return raw;
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      const spec = raw as Record<string, unknown>;
      for (const key of ["org_home", "orgHome", "home", "path"]) {
        if (typeof spec[key] === "string" && spec[key].length > 0) return spec[key];
      }
    }
  } catch {
    // Fall through to plain-path handling.
  }
  return text.includes("\n") || text.includes(":") ? undefined : text;
}

/** Register a new app in an existing org home by appending one YAML block to
 * `apps.yaml`. Existing bytes are preserved exactly; duplicates fail before
 * any write, so second-app bootstrap joins the org instead of forking it. */
export async function joinExistingOrg(
  orgHomeIn: string,
  registration: AppRegistration,
): Promise<JoinExistingOrgResult> {
  const orgHome = resolve(orgHomeIn);
  const appsPath = join(orgHome, "apps.yaml");
  const before = await readFile(appsPath, "utf8");
  const file = await loadApps(appsPath);

  if (file.apps.some((a) => a.repo === registration.repo)) {
    throw new Error(
      `bootstrap: repo ${registration.repo} is already registered in ${appsPath} ` +
        `(duplicate repo slugs are not allowed)`,
    );
  }
  if (file.apps.some((a) => a.name === registration.name)) {
    throw new Error(`bootstrap: app "${registration.name}" is already registered in ${appsPath}`);
  }

  const status = registration.status ?? "onboarding";
  const cadence = registration.cadence ?? {};
  const entry: AppEntry = {
    name: registration.name,
    repo: registration.repo,
    status,
    budgetUsdMonth: registration.budgetUsdMonth ?? file.defaults.budgetUsdMonth,
    cadence,
    channels: registration.channels ?? {},
  };

  const blockSpec: Record<string, unknown> = {
    repo: registration.repo,
    status,
  };
  if (registration.budgetUsdMonth !== undefined) {
    blockSpec["budget_usd_month"] = registration.budgetUsdMonth;
  }
  blockSpec["cadence"] = cadence;
  if (registration.channels !== undefined && Object.keys(registration.channels).length > 0) {
    blockSpec["channels"] = registration.channels;
  }

  const block = stringify({ [registration.name]: blockSpec })
    .trimEnd()
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
  const next = `${before.endsWith("\n") ? before : `${before}\n`}${block}\n`;
  await writeFile(appsPath, next, "utf8");

  // The 2-space EOF append assumes `apps:` is the last top-level key at 2-space
  // indent. apps.yaml is a human-ratified surface, so a reorder/reindent can
  // make the new block nest under the wrong mapping (app silently dropped) or
  // produce invalid YAML (loadApps throws on the next tick, org offline).
  // Re-parse and confirm the new app landed; on any failure, roll the file back
  // to its exact prior bytes so a bad append never corrupts the registry.
  try {
    const reloaded = await loadApps(appsPath);
    const landed = reloaded.apps.some((a) => a.name === entry.name && a.repo === entry.repo);
    if (!landed) {
      throw new Error(`app "${entry.name}" is not present after append (non-canonical apps.yaml layout?)`);
    }
  } catch (error) {
    await writeFile(appsPath, before, "utf8");
    throw new Error(
      `bootstrap: appending "${entry.name}" to ${appsPath} produced an invalid registry; ` +
        `rolled back. ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return { orgHome, appsPath, app: entry };
}

function numberOr(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}
