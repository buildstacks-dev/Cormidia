// `cormidia doctor` — verify the installed package, active org configuration,
// state home, adapters, and scheduler surface without assuming cwd is special.

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { RuntimeKind } from "../runtime/types.js";
import { RUNTIME_KINDS } from "../runtime/registry.js";
import {
  probeRuntimeReadiness,
  type RuntimeReadinessProbe,
  type RuntimeReadinessRequest,
} from "../runtime/readiness.js";
import { loadRoles } from "../org/roles.js";
import { loadApps } from "../org/apps.js";
import { loadPipelines } from "../loop/pipelines.js";
import {
  ORG_HOME_DEFINITION,
  resolveCormidiaHomes,
  STATE_HOME_DEFINITION,
  type CormidiaHomeOptions,
} from "../org/home.js";
import { extractHomeFlags } from "./home-flags.js";
import { resolveAuthority } from "../org/authority.js";
import { PlatformSchedulerManager, type SchedulerManager } from "../org/scheduler/manager.js";
import { schedulerOperationalStatus, type SchedulerOperationalStatus } from "../org/scheduler/status.js";
import {
  describeManagedClone,
  inspectManagedClones,
  type ManagedCloneHealth,
} from "../org/managed-clone-health.js";
import { listOrgs } from "../org/org-archive.js";

export interface DoctorOptions extends CormidiaHomeOptions {
  launchAgentsDir?: string;
  json?: boolean;
  /** Validate files without starting non-billable adapter probes. Intended
   * for isolated packaging/offline fixtures; it never claims readiness. */
  configOnly?: boolean;
  readinessTimeoutMs?: number;
  /** Test/embedding injection point. */
  readinessProbe?: RuntimeReadinessProbe;
  schedulerManager?: SchedulerManager;
  platform?: NodeJS.Platform;
  now?: () => Date;
}

interface CheckRow {
  name: string;
  status: "OK" | "WARN" | "FAIL";
  detail: string;
}

export async function cmdDoctorArgs(args: string[]): Promise<number> {
  const common = extractHomeFlags(args, "doctor");
  let json = false;
  let configOnly = false;
  for (const arg of common.rest) {
    if (arg === "--json") json = true;
    else if (arg === "--config-only") configOnly = true;
    else throw new Error(`doctor: unknown argument "${arg}"`);
  }
  return cmdDoctor({ ...common, json, configOnly });
}

export async function cmdDoctor(options: DoctorOptions = {}): Promise<number> {
  const config: CheckRow[] = [];
  let homes: Awaited<ReturnType<typeof resolveCormidiaHomes>> | undefined;
  let roles: Awaited<ReturnType<typeof loadRoles>> | undefined;
  try {
    homes = await resolveCormidiaHomes(options);
    const rolesPath = join(homes.orgHome, "roles.yaml");
    const appsPath = join(homes.orgHome, "apps.yaml");
    const pipelinesPath = join(homes.orgHome, "pipelines.yaml");
    roles = await checked(config, "roles.yaml", () => loadRoles(rolesPath));
    await checked(config, "apps.yaml", () => loadApps(appsPath));
    const authority = await resolveAuthority({ orgHome: homes.orgHome });
    config.push({
      name: "AUTHORITY.md",
      status: authority.version === "legacy-conservative/v1" ? "WARN" : "OK",
      detail:
        authority.version === "legacy-conservative/v1"
          ? "missing; effective authority fails closed to legacy-conservative/v1"
          : `${authority.version} sha256:${authority.sha256}`,
    });
    if (roles !== undefined) {
      const loadedRoles = roles;
      await checked(config, "pipelines.yaml", () =>
        loadPipelines(pipelinesPath, {
          roleNames: loadedRoles.roles.map((role) => role.name),
          promptsDir: join(homes!.orgHome, "prompts"),
        }),
      );
    }
  } catch (error) {
    config.push({ name: "active org", status: "FAIL", detail: errorMessage(error) });
  }

  const adapters = await adapterChecks(roles?.roles, options);

  const platform = options.platform ?? process.platform;
  const backend = platform === "darwin" ? "launchd" : "systemd";
  const manager = options.schedulerManager ?? new PlatformSchedulerManager({
    backend,
    platform,
    ...(options.launchAgentsDir !== undefined ? { definitionDir: options.launchAgentsDir } : {}),
  });
  let schedulerStatus: SchedulerOperationalStatus | null = null;
  let scheduler: CheckRow;
  if (homes === undefined) {
    scheduler = { name: backend, status: "FAIL", detail: "scheduler identity cannot resolve until the org and state homes resolve" };
  } else {
    schedulerStatus = await schedulerOperationalStatus({
      backend: manager.backend,
      orgName: homes.appsFile.org.name,
      orgHome: homes.orgHome,
      stateHome: homes.stateHome,
      packageEntryPath: existsSync(join(homes.packageRoot, "dist", "cli.js"))
        ? join(homes.packageRoot, "dist", "cli.js")
        : join(homes.packageRoot, "src", "cli.ts"),
      executablePath: process.execPath,
      manager,
      runtime: options.configOnly !== true,
      now: options.now?.() ?? new Date(),
    });
    scheduler = schedulerCheck(schedulerStatus, options.configOnly === true);
  }

  const state: CheckRow = homes
    ? existsSync(homes.stateHome)
      ? { name: "state home", status: "OK", detail: homes.stateHome }
      : { name: "state home", status: "WARN", detail: `${homes.stateHome} (created on first write)` }
    : { name: "state home", status: "FAIL", detail: "unresolved until an active org is selected" };

  // ISSUE-010: a budget-stopped or crashed turn can leave uncommitted work in
  // the org-managed clone, and the next turn silently inherits it. This is a
  // local read of state doctor already owns; it never fetches or mutates.
  const managedClones: ManagedCloneHealth[] = homes === undefined
    ? []
    : inspectManagedClones(homes.stateHome, homes.appsFile.apps.map((entry) => entry.name));
  const clones: CheckRow[] = managedClones.map((health) => ({
    name: `repos/${health.app}`,
    ...describeManagedClone(health),
  }));

  // ENH-001: a state home whose org home cannot be resolved is invisible to
  // every other surface. `org list` enumerates them; doctor names them so the
  // condition is noticed without being looked for.
  //
  // Enumerated from the pointer's own directory, not from a resolved active
  // org: retiring the active org is precisely when no active org resolves, and
  // that is the moment an operator most needs to be told what state homes are
  // still on this machine.
  const orgsPointerPath = homes?.pointerPath
    ?? options.pointerPath
    ?? join(options.homeDir ?? homedir(), ".cormidia", "config");
  const discoveredOrgs = await listOrgs({
    pointerPath: orgsPointerPath,
    includeUsage: false,
  }).catch(() => []);
  const orphans: CheckRow[] = discoveredOrgs
    .filter((org) => org.orphan || org.orgHomeMissing)
    .map((org) => ({
      name: `orgs/${org.name}`,
      status: "WARN" as const,
      detail: org.orphan
        ? `${org.stateHome} has no recorded org home; retire it with "cormidia org archive ${org.name}"`
        : `${org.stateHome} points at a missing org home ${org.orgHome}; re-select it with ` +
          `"cormidia org use <path>" or retire it with "cormidia org archive ${org.name}"`,
    }));

  const ok = ![...adapters, ...config, state, scheduler, ...clones, ...orphans].some(
    (row) => row.status === "FAIL",
  );
  if (options.json === true) {
    console.log(
      JSON.stringify(
        {
          ok,
          homes: homes
            ? {
                packageRoot: homes.packageRoot,
                orgHome: homes.orgHome,
                orgHomeMeaning: ORG_HOME_DEFINITION,
                stateHome: homes.stateHome,
                stateHomeMeaning: STATE_HOME_DEFINITION,
                pointerPath: homes.pointerPath,
              }
            : null,
          adapters,
          readinessMode: options.configOnly === true ? "config_only" : "live_nonbillable",
          config,
          state,
          managedClones,
          orgs: discoveredOrgs,
          scheduler,
          schedulerStatus,
        },
        null,
        2,
      ),
    );
    return ok ? 0 : 1;
  }

  printRows("runtime adapters", adapters);
  if (homes) {
    console.log("homes:");
    console.log(`  org     ${homes.orgHome} — ${ORG_HOME_DEFINITION}`);
    console.log(`  state   ${homes.stateHome} — ${STATE_HOME_DEFINITION}`);
    console.log(`  package ${homes.packageRoot}`);
  }
  printRows("config", config);
  printRows("state", [state]);
  if (clones.length > 0) printRows("managed clones", clones);
  if (orphans.length > 0) printRows("orgs", orphans);
  printRows("scheduler", [scheduler]);
  if (schedulerStatus?.definition.installed === true) console.log(`  ${manager.backend} installed; inspect/repair with: cormidia scheduler status`);
  else if (homes) console.log(`  ${manager.backend} not installed; preview with: cormidia scheduler install --backend ${manager.backend}`);
  return ok ? 0 : 1;
}

function schedulerCheck(status: SchedulerOperationalStatus, configOnly: boolean): CheckRow {
  if (!status.definition.installed) {
    return { name: status.definition.backend, status: "WARN", detail: "not installed; autonomous dispatch is not scheduled" };
  }
  const definitionFailure = status.definition.reason_codes.some((reason) => [
    "malformed_definition",
    "ownership_mismatch",
    "wrong_org",
    "wrong_state_home",
    "wrong_executable",
    "missing_required_executable",
    "cadence_drift",
    "stale_definition",
    "scheduler_state_missing",
    "scheduler_state_corrupt",
  ].includes(reason));
  if (definitionFailure) return { name: status.definition.backend, status: "FAIL", detail: status.blocking_reasons.join(", ") };
  if (configOnly) {
    return { name: status.definition.backend, status: "WARN", detail: "definition valid; execution health not inspected (--config-only)" };
  }
  return status.healthy
    ? { name: status.definition.backend, status: "OK", detail: `healthy; last tick ${status.evidence.last_completed_tick}` }
    : { name: status.definition.backend, status: "FAIL", detail: status.blocking_reasons.join(", ") || "health cannot be measured" };
}

async function adapterChecks(
  roles: Array<{ runtime: RuntimeKind; model: string }> | undefined,
  options: DoctorOptions,
): Promise<CheckRow[]> {
  const probe = options.readinessProbe ?? probeRuntimeReadiness;
  return Promise.all(
    RUNTIME_KINDS.map(async (kind): Promise<CheckRow> => {
      if (roles === undefined) {
        return {
          name: kind,
          status: "WARN",
          detail: "not probed because roles.yaml is unavailable",
        };
      }
      const models = [
        ...new Set(roles.filter((role) => role.runtime === kind).map((role) => role.model)),
      ].sort();
      if (models.length === 0) {
        return {
          name: kind,
          status: "WARN",
          detail: "not configured by any role; probe skipped",
        };
      }
      if (options.configOnly === true) {
        return {
          name: kind,
          status: "WARN",
          detail:
            `configured for ${models.join(", ")}; readiness probe skipped (--config-only); ` +
            "configuration validity is not runtime readiness",
        };
      }
      try {
        const request: RuntimeReadinessRequest = {
          runtime: kind,
          models,
          ...(options.readinessTimeoutMs !== undefined
            ? { timeoutMs: options.readinessTimeoutMs }
            : {}),
        };
        const result = await probe(request);
        return {
          name: kind,
          status: result.status === "ready" ? "OK" : "FAIL",
          detail:
            `${result.status}` +
            (result.errorCode !== undefined ? ` (${result.errorCode})` : "") +
            ` — ${result.detail} [${result.durationMs}ms, non-billable]`,
        };
      } catch (error) {
        return {
          name: kind,
          status: "FAIL",
          detail: `readiness probe crashed: ${errorMessage(error)}`,
        };
      }
    }),
  );
}

async function checked<T>(rows: CheckRow[], name: string, load: () => Promise<T>): Promise<T | undefined> {
  try {
    const value = await load();
    rows.push({ name, status: "OK", detail: "valid" });
    return value;
  } catch (error) {
    rows.push({ name, status: "FAIL", detail: errorMessage(error) });
    return undefined;
  }
}

function printRows(title: string, rows: readonly CheckRow[]): void {
  console.log(`${title}:`);
  for (const row of rows) console.log(`  ${row.name.padEnd(15)} ${row.status.padEnd(4)} — ${row.detail}`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
