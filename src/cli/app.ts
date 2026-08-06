// Explicit app lifecycle commands. `reset` is deliberately plan-first: it
// reads the current GitHub work surface and changes nothing until the operator
// repeats the app name in --confirm alongside --execute.

import { GhCliOps } from "../loop/github.js";
import { executeAppReset, finalizeInterruptedAppReset, planAppReset, type AppResetPlan } from "../org/app-reset.js";
import { resolveCormidiaHomes } from "../org/home.js";
import { executeAppPromotion, planAppPromotion, verifyApp } from "../org/app-lifecycle.js";
import { latestResetArchiveForApp } from "../org/onboarding-answers.js";
import { stableJson } from "../org/lifecycle.js";
import { extractHomeFlags } from "./home-flags.js";
import { dirname, join, resolve } from "node:path";
import type { GhOps } from "../loop/github.js";
import type { RuntimeReadinessProbe } from "../runtime/readiness.js";

export interface AppCommandOptions {
  ghFactory?: (repo: string) => GhOps;
  /** Test seam for the non-billable runtime-readiness probe used by `verify`
   * and `promote`. Unset in production so verify runs the real
   * `probeRuntimeReadiness` (agreeing with `cormidia doctor`); tests inject a
   * deterministic fake so they never contact a real adapter. */
  readinessProbe?: RuntimeReadinessProbe;
}

export async function cmdApp(args: string[], options: AppCommandOptions = {}): Promise<number> {
  const common = extractHomeFlags(args, "app");
  const [verb, appName, ...rest] = common.rest;
  if (verb !== "reset" && verb !== "verify" && verb !== "promote") {
    throw new Error(`app: unknown subcommand "${verb ?? ""}" (expected reset, verify, or promote)`);
  }
  if (appName === undefined || appName.startsWith("--")) {
    throw new Error(`app ${verb}: <app-name> is required`);
  }

  if (verb === "verify") return verify(appName, rest, common, options);
  if (verb === "promote") return promote(appName, rest, common, options);

  let execute = false;
  let force = false;
  let dryRun = false;
  let confirm: string | undefined;
  let archiveRoot: string | undefined;
  let json = false;
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!;
    if (arg === "--execute") execute = true;
    else if (arg === "--force") force = true;
    else if (arg === "--dry-run") dryRun = true;
    else if (arg === "--json") json = true;
    else if (arg === "--confirm") {
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
  if (execute && dryRun) throw new Error("app reset: choose either --dry-run or --execute, not both");

  const homes = await resolveCormidiaHomes(common);
  const app = homes.appsFile.apps.find((entry) => entry.name === appName);
  if (app === undefined) {
    const root = resolve(
      archiveRoot ?? join(dirname(homes.stateHome), "archives", safeSegment(homes.appsFile.org.name)),
    );
    const archive = await latestResetArchiveForApp(root, appName);
    if (archive !== undefined) {
      await finalizeInterruptedAppReset(homes.stateHome, appName, archive);
      const result = {
        schema_version: 1,
        kind: "app-reset-result",
        status: "already_reset",
        app: appName,
        archive_path: archive,
      };
      if (json) console.log(stableJson(result).trimEnd());
      else console.log(`App already reset: ${appName}\nArchive: ${archive}`);
      return 0;
    }
    throw new Error(`app reset: unknown app "${appName}" in apps.yaml`);
  }
  const input = {
    orgHome: homes.orgHome,
    stateHome: homes.stateHome,
    appsFile: homes.appsFile,
    appName,
    gh: options.ghFactory?.(app.repo) ?? new GhCliOps(app.repo),
    ...(force ? { force: true } : {}),
    ...(archiveRoot !== undefined ? { archiveRoot } : {}),
  };
  const plan = await planAppReset(input);
  if (json && !execute) console.log(stableJson(plan).trimEnd());
  else if (!json) printPlan(plan, execute, force);
  if (!execute) return 0;
  if (plan.blockers.length > 0) {
    if (json)
      console.log(
        stableJson({ schema_version: 1, kind: "app-reset-refusal", app: appName, blockers: plan.blockers }).trimEnd(),
      );
    throw new Error(`app reset: execution blocked — ${plan.blockers.map((blocker) => blocker.code).join("; ")}`);
  }

  const result = await executeAppReset(input, plan);
  if (json)
    console.log(
      stableJson({
        schema_version: 1,
        kind: "app-reset-result",
        status: "reset",
        app: appName,
        archive_path: result.archivePath,
        plan: result.plan,
      }).trimEnd(),
    );
  else {
    console.log(`app reset complete: ${appName}`);
    console.log(`archive: ${result.archivePath}`);
  }
  return 0;
}

async function verify(
  appName: string,
  args: string[],
  homesFlags: { orgHome?: string; stateHome?: string },
  options: AppCommandOptions,
): Promise<number> {
  const parsed = parseAppVerifyArgs([appName, ...args]);
  appName = parsed.appName;
  const { json } = parsed;
  const homes = await resolveCormidiaHomes(homesFlags);
  const app = homes.appsFile.apps.find((entry) => entry.name === appName);
  if (app === undefined) throw new Error(`app verify: unknown app "${appName}"`);
  const report = await verifyApp({
    orgHome: homes.orgHome,
    stateHome: homes.stateHome,
    appName,
    synchronize: true,
    writeReadiness: true,
    githubFactory: options.ghFactory ?? ((repo) => new GhCliOps(repo)),
    ...(options.readinessProbe !== undefined ? { readinessProbe: options.readinessProbe } : {}),
  });
  if (json) console.log(stableJson(report).trimEnd());
  else printVerification(report);
  return report.status === "ready" ? 0 : 2;
}

export interface ParsedAppVerifyArgs {
  appName: string;
  json: boolean;
}

/** Pure parser shared by the executable verify command and generated-guidance
 * conformance tests. It performs no GitHub or runtime-readiness probe. */
export function parseAppVerifyArgs(args: string[]): ParsedAppVerifyArgs {
  const [appName, ...rest] = args;
  if (appName === undefined || appName.startsWith("--")) {
    throw new Error("app verify: <app-name> is required");
  }
  let json = false;
  for (const arg of rest) {
    if (arg === "--json") json = true;
    else throw new Error(`app verify: unknown flag "${arg}"`);
  }
  return { appName, json };
}

async function promote(
  appName: string,
  args: string[],
  homesFlags: { orgHome?: string; stateHome?: string },
  options: AppCommandOptions,
): Promise<number> {
  let execute = false;
  let json = false;
  let to: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--to") to = needValue(args, ++i, "--to");
    else if (arg === "--execute") execute = true;
    else if (arg === "--dry-run") execute = false;
    else if (arg === "--json") json = true;
    else throw new Error(`app promote: unknown flag "${arg}"`);
  }
  if (to !== "live") throw new Error("app promote: --to live is required");
  const homes = await resolveCormidiaHomes(homesFlags);
  const app = homes.appsFile.apps.find((entry) => entry.name === appName);
  if (app === undefined) throw new Error(`app promote: unknown app "${appName}"`);
  const input = {
    orgHome: homes.orgHome,
    stateHome: homes.stateHome,
    appName,
    to: "live" as const,
    githubFactory: options.ghFactory ?? ((repo) => new GhCliOps(repo)),
    ...(options.readinessProbe !== undefined ? { readinessProbe: options.readinessProbe } : {}),
  };
  const plan = await planAppPromotion(input);
  if (!execute) {
    if (json) console.log(stableJson(plan).trimEnd());
    else {
      console.log(`App promotion plan: ${appName} ${plan.from} -> live`);
      console.log(`Verification: ${plan.verification.status}`);
      for (const change of plan.changes) console.log(`  - ${change}`);
      console.log(
        "No changes made to app lifecycle (dispatched CLI: invocation audit only). Add --execute after reviewing this plan.",
      );
    }
    return plan.executable ? 0 : 2;
  }
  const result = await executeAppPromotion(input, plan);
  if (json) console.log(stableJson(result).trimEnd());
  else console.log(`App promotion ${result.status}: ${appName} -> live`);
  return 0;
}

function printVerification(report: Awaited<ReturnType<typeof verifyApp>>): void {
  console.log(`App verification: ${report.app} — ${report.status} (${report.evidence_state})`);
  for (const check of report.checks) {
    console.log(`  ${check.status.padEnd(7)} ${check.id}: ${check.detail}`);
    if (check.remediation) console.log(`           remediation: ${check.remediation}`);
  }
}

function printPlan(plan: AppResetPlan, execute: boolean, force: boolean): void {
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
  if (plan.staleRuns.length > 0) {
    console.log(`${force ? "Forced stale" : "Stale"} run(s): ${plan.staleRuns.join(", ")}`);
  }
  if (plan.blockers.length > 0) {
    console.log("Blocked:");
    for (const blocker of plan.blockers) {
      console.log(`  - ${blocker.code}: ${blocker.ids.join(", ")}`);
      console.log(`    remediation: ${blocker.remediation}`);
    }
  }
  if (!execute) {
    console.log(
      `No changes made to app state (dispatched CLI: invocation audit only). To execute: cormidia app reset ${plan.app.name} --execute --confirm ${plan.app.name}` +
        (plan.staleRuns.length > 0 ? " --force" : ""),
    );
  }
}

function safeSegment(value: string): string {
  return (
    value
      .trim()
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "org"
  );
}

function needValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value || value.startsWith("--")) throw new Error(`app: ${flag} requires a value`);
  return value;
}
