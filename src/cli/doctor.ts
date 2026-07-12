// `operon doctor` — verify the installed package, active org configuration,
// state home, adapters, and scheduler surface without assuming cwd is special.

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { RuntimeKind } from "../runtime/types.js";
import { getRuntime, RUNTIME_KINDS } from "../runtime/registry.js";
import { loadRoles } from "../org/roles.js";
import { loadApps } from "../org/apps.js";
import { loadPipelines } from "../loop/pipelines.js";
import {
  ORG_HOME_DEFINITION,
  resolveOperonHomes,
  STATE_HOME_DEFINITION,
  type OperonHomeOptions,
} from "../org/home.js";
import { extractHomeFlags } from "./home-flags.js";
import { resolveAuthority } from "../org/authority.js";

const ADAPTER_NOTE: Record<RuntimeKind, string> = {
  claude: "claude-agent-sdk; auth not verified here",
  codex: "app-server; auth not verified here",
  pi: "pi SDK; auth not verified here",
};

export interface DoctorOptions extends OperonHomeOptions {
  launchAgentsDir?: string;
  json?: boolean;
}

interface CheckRow {
  name: string;
  status: "OK" | "WARN" | "FAIL";
  detail: string;
}

export async function cmdDoctorArgs(args: string[]): Promise<number> {
  const common = extractHomeFlags(args, "doctor");
  let json = false;
  for (const arg of common.rest) {
    if (arg === "--json") json = true;
    else throw new Error(`doctor: unknown argument "${arg}"`);
  }
  return cmdDoctor({ ...common, json });
}

export async function cmdDoctor(options: DoctorOptions = {}): Promise<number> {
  const adapters: CheckRow[] = [];
  for (const kind of RUNTIME_KINDS) {
    try {
      const rt = getRuntime(kind);
      adapters.push({ name: rt.kind, status: "OK", detail: ADAPTER_NOTE[rt.kind] });
    } catch (error) {
      adapters.push({ name: kind, status: "FAIL", detail: errorMessage(error) });
    }
  }

  const config: CheckRow[] = [];
  let homes: Awaited<ReturnType<typeof resolveOperonHomes>> | undefined;
  try {
    homes = await resolveOperonHomes(options);
    const rolesPath = join(homes.orgHome, "roles.yaml");
    const appsPath = join(homes.orgHome, "apps.yaml");
    const pipelinesPath = join(homes.orgHome, "pipelines.yaml");
    const roles = await checked(config, "roles.yaml", () => loadRoles(rolesPath));
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
      await checked(config, "pipelines.yaml", () =>
        loadPipelines(pipelinesPath, {
          roleNames: roles.roles.map((role) => role.name),
          promptsDir: join(homes!.orgHome, "prompts"),
        }),
      );
    }
  } catch (error) {
    config.push({ name: "active org", status: "FAIL", detail: errorMessage(error) });
  }

  const launchAgentsDir = options.launchAgentsDir ?? join(homedir(), "Library", "LaunchAgents");
  const plist = join(launchAgentsDir, "dev.operon.dispatch.plist");
  const scheduler: CheckRow = existsSync(plist)
    ? { name: "launchd", status: "OK", detail: `installed: ${plist}` }
    : { name: "launchd", status: "WARN", detail: "not installed; autonomous dispatch is not scheduled" };

  const state: CheckRow = homes
    ? existsSync(homes.stateHome)
      ? { name: "state home", status: "OK", detail: homes.stateHome }
      : { name: "state home", status: "WARN", detail: `${homes.stateHome} (created on first write)` }
    : { name: "state home", status: "FAIL", detail: "unresolved until an active org is selected" };

  const ok = ![...adapters, ...config, state].some((row) => row.status === "FAIL");
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
          config,
          state,
          scheduler,
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
  printRows("scheduler", [scheduler]);
  if (existsSync(plist)) {
    console.log("  launchd installed");
    console.log(`  unload: launchctl unload ${plist}`);
  } else if (homes) {
    console.log("  launchd not installed");
    const template = join(homes.packageRoot, "config", "launchd", "operon-dispatch.plist.template");
    console.log(`  install template: ${template}`);
    console.log(`  load after install: launchctl load ${plist}`);
  }
  return ok ? 0 : 1;
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
