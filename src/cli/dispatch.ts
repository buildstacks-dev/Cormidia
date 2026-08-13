import { join, resolve } from "node:path";
import { loadApps } from "../org/apps.js";
import { resolveCormidiaHomes } from "../org/home.js";
import { createCliProgressReporter, extractProgressArgs } from "../runtime/cli-progress.js";
import { runDispatch } from "./dispatch-run.js";
import { extractHomeFlags } from "./home-flags.js";

export async function cmdDispatch(args: string[]): Promise<number> {
  const common = extractHomeFlags(args, "dispatch");
  const progressArgs = extractProgressArgs(common.rest, "dispatch");
  let appsPath: string | undefined;
  let rolesPath: string | undefined;
  let dryRun = false;
  const explicitScheduleRetries: string[] = [];

  for (let i = 0; i < progressArgs.rest.length; i++) {
    const arg = progressArgs.rest[i];
    if (arg === "--apps") appsPath = needValue(progressArgs.rest, ++i, "--apps");
    else if (arg === "--roles") rolesPath = needValue(progressArgs.rest, ++i, "--roles");
    else if (arg === "--dry-run") dryRun = true;
    else if (arg === "--retry-schedule") {
      explicitScheduleRetries.push(needValue(progressArgs.rest, ++i, "--retry-schedule"));
    } else throw new Error(`dispatch: unknown argument "${arg}"`);
  }

  const homes = await resolveCormidiaHomes(common);
  const effectiveApps = appsPath ? resolve(appsPath) : join(homes.orgHome, "apps.yaml");
  const effectiveRoles = rolesPath ? resolve(rolesPath) : join(homes.orgHome, "roles.yaml");
  const appsFile = await loadApps(effectiveApps);
  const reporter = dryRun
    ? undefined
    : createCliProgressReporter({
        stateHome: homes.stateHome,
        command: "dispatch",
        scope: appsFile.org.name,
        mode: progressArgs.mode,
      });
  reporter?.phase("preflight", "started");
  try {
    return await runDispatch({
      orgHome: homes.orgHome,
      stateHome: homes.stateHome,
      appsFile,
      appsPath: effectiveApps,
      rolesPath: effectiveRoles,
      dryRun,
      explicitScheduleRetries,
      ...(reporter === undefined ? {} : { reporter }),
    });
  } catch (error) {
    reporter?.terminal("failed", {
      ...(reporter === undefined ? {} : { nextAction: `inspect ${reporter.relativeLogRef}` }),
    });
    throw error;
  } finally {
    reporter?.dispose();
  }
}

function needValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value || value.startsWith("--")) throw new Error(`dispatch: ${flag} requires a value`);
  return value;
}
