import { join, resolve } from "node:path";
import { dispatchTick } from "../org/dispatch.js";
import { loadApps } from "../org/apps.js";
import { resolveOperonHomes } from "../org/home.js";
import { extractHomeFlags } from "./home-flags.js";

export async function cmdDispatch(args: string[]): Promise<number> {
  const common = extractHomeFlags(args, "dispatch");
  let appsPath: string | undefined;
  let rolesPath: string | undefined;
  let dryRun = false;

  for (let i = 0; i < common.rest.length; i++) {
    const arg = common.rest[i]!;
    if (arg === "--apps") appsPath = needValue(common.rest, ++i, "--apps");
    else if (arg === "--roles") rolesPath = needValue(common.rest, ++i, "--roles");
    else if (arg === "--dry-run") dryRun = true;
    else throw new Error(`dispatch: unknown argument "${arg}"`);
  }

  const homes = await resolveOperonHomes(common);
  const effectiveApps = appsPath ? resolve(appsPath) : join(homes.orgHome, "apps.yaml");
  const effectiveRoles = rolesPath ? resolve(rolesPath) : join(homes.orgHome, "roles.yaml");
  const appsFile = await loadApps(effectiveApps);
  const result = await dispatchTick({
    orgRoot: homes.orgHome,
    runtimeHome: homes.stateHome,
    appsPath: effectiveApps,
    rolesPath: effectiveRoles,
    dryRun,
  });
  console.log(
    `dispatch: spawned=${result.spawned.length} skipped=${result.skipped.length} errors=${result.errors.length}`,
  );
  for (const turn of result.spawned) {
    console.log(`spawned ${turn.turnId} ${turn.app}/${turn.role} ${turn.triggerKind}:${turn.trigger}`);
  }
  for (const line of result.skipped) console.log(`skip ${line}`);
  for (const line of result.errors) console.log(`error ${line}`);
  return result.errors.length > 0 ? 1 : 0;
}

function needValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value || value.startsWith("--")) throw new Error(`dispatch: ${flag} requires a value`);
  return value;
}
