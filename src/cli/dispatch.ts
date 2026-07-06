import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { dispatchTick } from "../org/dispatch.js";
import { loadApps } from "../org/apps.js";

export async function cmdDispatch(args: string[]): Promise<number> {
  let home: string | undefined;
  let appsPath: string | undefined;
  let rolesPath = "roles.yaml";
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--home") home = needValue(args, ++i, "--home");
    else if (arg === "--apps") appsPath = needValue(args, ++i, "--apps");
    else if (arg === "--roles") rolesPath = needValue(args, ++i, "--roles");
    else if (arg === "--dry-run") dryRun = true;
    else throw new Error(`dispatch: unknown argument "${arg}"`);
  }

  const effectiveApps = appsPath ?? "apps.yaml";
  const appsFile = await loadApps(effectiveApps);
  const runtimeHome = resolve(home ?? process.env.OPERON_HOME ?? join(homedir(), ".operon", appsFile.org.name));
  const result = await dispatchTick({
    runtimeHome,
    appsPath: effectiveApps,
    rolesPath,
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
