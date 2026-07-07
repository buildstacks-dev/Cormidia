// `operon doctor` — verify the install can actually run: adapters resolve,
// the human-ratified config surfaces parse, and the org home is reachable.
// It reports honestly (OK / WARN / FAIL) and exits non-zero when a hard
// precondition fails, so an operator debugging failed turns is not misdirected
// by an unconditional all-green banner. It does NOT claim auth works — proving
// a live turn is `pnpm test:live`.

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { RuntimeKind } from "../runtime/types.js";
import { getRuntime, RUNTIME_KINDS } from "../runtime/registry.js";
import { loadRoles } from "../org/roles.js";
import { loadApps } from "../org/apps.js";
import { loadPipelines } from "../loop/pipelines.js";

const ADAPTER_NOTE: Record<RuntimeKind, string> = {
  claude: "claude-agent-sdk (M1.2) — auth not verified here; prove with pnpm test:live",
  codex: "app-server (M10) — auth not verified here; OPERON_CODEX_LIVE=1 pnpm test:live",
  pi: "pi SDK (M10) — auth not verified here; OPERON_PI_LIVE=1 pnpm test:live",
};

export interface DoctorOptions {
  launchAgentsDir?: string;
}

export async function cmdDoctor(options: DoctorOptions = {}): Promise<number> {
  let ok = true;

  console.log("runtime adapters:");
  for (const kind of RUNTIME_KINDS) {
    try {
      const rt = getRuntime(kind); // constructing proves the adapter module loads
      console.log(`  ${rt.kind.padEnd(7)} OK   — ${ADAPTER_NOTE[rt.kind]}`);
    } catch (error) {
      ok = false;
      console.log(`  ${kind.padEnd(7)} FAIL — ${errorMessage(error)}`);
    }
  }

  console.log("config:");
  ok = (await checkConfig("roles.yaml", () => loadRoles("roles.yaml"))) && ok;
  const appsResult = await loadConfig("apps.yaml", () => loadApps("apps.yaml"));
  reportConfig("apps.yaml", appsResult);
  ok = appsResult.ok && ok;
  ok =
    (await checkConfig("pipelines.yaml", async () => {
      const roles = await loadRoles("roles.yaml");
      await loadPipelines("pipelines.yaml", {
        roleNames: roles.roles.map((role) => role.name),
        promptsDir: "prompts",
      });
    })) && ok;

  console.log("org home:");
  const orgName = appsResult.ok ? appsResult.value.org.name : undefined;
  if (orgName === undefined) {
    console.log("  unresolved — apps.yaml did not parse, cannot locate ~/.operon/<org>");
  } else {
    const orgHome = process.env.OPERON_HOME ?? join(homedir(), ".operon", orgName);
    if (existsSync(orgHome)) {
      console.log(`  reachable: ${orgHome}`);
    } else {
      // Not a hard failure — the home is created on first real run.
      console.log(`  WARN not yet created: ${orgHome} (created on first run)`);
    }
  }

  printScheduler(options.launchAgentsDir ?? join(homedir(), "Library", "LaunchAgents"));
  return ok ? 0 : 1;
}

interface ConfigResult<T> {
  ok: boolean;
  value: T;
  error?: unknown;
}

async function loadConfig<T>(_label: string, load: () => Promise<T>): Promise<ConfigResult<T>> {
  try {
    return { ok: true, value: await load() };
  } catch (error) {
    return { ok: false, value: undefined as T, error };
  }
}

function reportConfig(label: string, result: ConfigResult<unknown>): void {
  if (result.ok) console.log(`  ${label.padEnd(15)} OK`);
  else console.log(`  ${label.padEnd(15)} FAIL — ${errorMessage(result.error)}`);
}

async function checkConfig(label: string, load: () => Promise<unknown>): Promise<boolean> {
  const result = await loadConfig(label, load);
  reportConfig(label, result);
  return result.ok;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function printScheduler(launchAgentsDir: string): void {
  const plist = join(launchAgentsDir, "dev.operon.dispatch.plist");
  console.log("scheduler:");
  if (existsSync(plist)) {
    console.log(`  launchd installed: ${plist}`);
    console.log(`  unload: launchctl unload ${plist}`);
  } else {
    console.log("  launchd not installed");
    console.log(`  install: cp config/launchd/operon-dispatch.plist.template ${plist}`);
    console.log(`  load: launchctl load ${plist}`);
  }
  console.log("  systemd timer: use the same 300s cadence to run `operon dispatch`");
}
