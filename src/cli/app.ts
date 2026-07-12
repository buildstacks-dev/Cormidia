// Explicit app lifecycle commands. `reset` is deliberately plan-first: it
// reads the current GitHub work surface and changes nothing until the operator
// repeats the app name in --confirm alongside --execute.

import { GhCliOps } from "../loop/github.js";
import { executeAppReset, planAppReset, type AppResetPlan } from "../org/app-reset.js";
import { resolveOperonHomes } from "../org/home.js";
import { extractHomeFlags } from "./home-flags.js";

export async function cmdApp(args: string[]): Promise<number> {
  const common = extractHomeFlags(args, "app");
  const [verb, appName, ...rest] = common.rest;
  if (verb !== "reset") throw new Error(`app: unknown subcommand "${verb ?? ""}" (expected reset)`);
  if (appName === undefined || appName.startsWith("--")) {
    throw new Error("app reset: <app-name> is required");
  }

  let execute = false;
  let confirm: string | undefined;
  let archiveRoot: string | undefined;
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!;
    if (arg === "--execute") execute = true;
    else if (arg === "--dry-run") {
      if (execute) throw new Error("app reset: choose either --dry-run or --execute, not both");
    } else if (arg === "--confirm") {
      confirm = needValue(rest, ++i, "--confirm");
    } else if (arg === "--archive-root") {
      archiveRoot = needValue(rest, ++i, "--archive-root");
    } else {
      throw new Error(`app reset: unknown flag "${arg}"`);
    }
  }
  if (execute && confirm !== appName) {
    throw new Error(`app reset: --execute requires --confirm ${appName}`);
  }

  const homes = await resolveOperonHomes(common);
  const app = homes.appsFile.apps.find((entry) => entry.name === appName);
  if (app === undefined) throw new Error(`app reset: unknown app "${appName}" in apps.yaml`);
  const input = {
    orgHome: homes.orgHome,
    stateHome: homes.stateHome,
    appsFile: homes.appsFile,
    appName,
    gh: new GhCliOps(app.repo),
    ...(archiveRoot !== undefined ? { archiveRoot } : {}),
  };
  const plan = await planAppReset(input);
  printPlan(plan, execute);
  if (!execute) return 0;
  if (plan.blockers.length > 0) {
    throw new Error(`app reset: execution blocked — ${plan.blockers.join("; ")}`);
  }

  const result = await executeAppReset(input);
  console.log(`app reset complete: ${appName}`);
  console.log(`archive: ${result.archivePath}`);
  return 0;
}

function printPlan(plan: AppResetPlan, execute: boolean): void {
  console.log(`App reset ${execute ? "execution plan" : "plan"}: ${plan.app.name} (${plan.app.repo})`);
  console.log(`Archive: ${plan.archiveRoot}/${plan.archiveId}`);
  console.log("Local managed paths:");
  for (const path of plan.managedPaths) console.log(`  - ${path}`);
  console.log(
    `GitHub: close ${plan.github.pullRequests.length} PR(s), ${plan.github.issues.length} issue(s), ` +
      `delete ${plan.github.branches.length} branch(es)`,
  );
  for (const pr of plan.github.pullRequests) console.log(`  PR #${pr.number}: ${pr.title} (${pr.headRefName})`);
  for (const issue of plan.github.issues) console.log(`  issue #${issue.number}: ${issue.title}`);
  for (const branch of plan.github.branches) console.log(`  branch: ${branch}`);
  if (plan.blockers.length > 0) {
    console.log("Blocked:");
    for (const blocker of plan.blockers) console.log(`  - ${blocker}`);
  }
  if (!execute) {
    console.log(`No changes made. To execute: operon app reset ${plan.app.name} --execute --confirm ${plan.app.name}`);
  }
}

function needValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value || value.startsWith("--")) throw new Error(`app reset: ${flag} requires a value`);
  return value;
}
