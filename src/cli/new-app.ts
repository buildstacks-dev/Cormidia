// `operon new-app` — greenfield product bootstrap. This creates the target app
// repo skeleton first, then hands off to the normal bootstrap/register path.

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { findExistingOrg } from "../org/apps.js";
import { createNewApp } from "../org/new-app.js";

export async function cmdNewApp(args: string[]): Promise<number> {
  const parsed = parseArgs(args);
  const orgHome = await resolveOrgHome(parsed.orgHome);
  const result = await createNewApp({
    appName: parsed.appName,
    targetDir: parsed.targetDir,
    repoSlug: parsed.repoSlug,
    goal: parsed.goal,
    ...(orgHome ? { orgHome } : {}),
    supportChannels: parsed.supportChannels,
    marketingChannels: parsed.marketingChannels,
    dryRun: parsed.dryRun,
  });

  console.log(`${result.dryRun ? "would create" : "created"} greenfield app: ${result.appName}`);
  console.log(`target: ${result.targetDir}`);
  console.log(`repo: ${result.repoSlug}`);
  if (result.joinedOrgHome) console.log(`org home: ${result.joinedOrgHome}`);
  console.log("\ncreated:");
  for (const rel of result.created) console.log(`  ${rel}`);
  console.log("\nupdated:");
  for (const rel of result.updated) console.log(`  ${rel}`);
  if (result.dryRun) {
    console.log("\n(dry-run: nothing written)");
  } else {
    console.log(
      "\nnext: review the scaffold, create/push the private GitHub repo, then " +
        "create the initial op:ready issue from .operon/bootstrap/initial-issue.md.",
    );
  }
  return 0;
}

interface ParsedNewAppArgs {
  appName: string;
  targetDir: string;
  repoSlug: string;
  goal: string;
  orgHome?: string;
  supportChannels: string[];
  marketingChannels: string[];
  dryRun: boolean;
}

function parseArgs(args: string[]): ParsedNewAppArgs {
  const first = args[0];
  if (!first || first.startsWith("--")) {
    throw new Error(
      "new-app: usage: operon new-app <name-or-goal> --target-dir <path> --repo <owner/repo> " +
        '[--goal <string>] [--name <app>] [--org-home <path>] [--support-channel <id>] ' +
        "[--marketing-channel <id>] [--dry-run]",
    );
  }

  let appName: string | undefined;
  let targetDir: string | undefined;
  let repoSlug: string | undefined;
  let goal: string | undefined;
  let orgHome: string | undefined;
  const supportChannels: string[] = [];
  const marketingChannels: string[] = [];
  let dryRun = false;

  for (let i = 1; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--name") {
      appName = readValue(args, ++i, "--name");
    } else if (arg === "--target-dir") {
      targetDir = readValue(args, ++i, "--target-dir");
    } else if (arg === "--repo") {
      repoSlug = readValue(args, ++i, "--repo");
    } else if (arg === "--goal") {
      goal = readValue(args, ++i, "--goal");
    } else if (arg === "--org-home") {
      orgHome = readValue(args, ++i, "--org-home");
    } else if (arg === "--support-channel") {
      supportChannels.push(readValue(args, ++i, "--support-channel"));
    } else if (arg === "--marketing-channel") {
      marketingChannels.push(readValue(args, ++i, "--marketing-channel"));
    } else {
      throw new Error(`new-app: unknown flag "${arg}"`);
    }
  }

  if (!targetDir) throw new Error("new-app: --target-dir <path> is required");
  if (!repoSlug) throw new Error("new-app: --repo <owner/repo> is required");

  return {
    appName: appName ?? first,
    targetDir,
    repoSlug,
    goal: goal ?? first,
    ...(orgHome ? { orgHome } : {}),
    supportChannels,
    marketingChannels,
    dryRun,
  };
}

function readValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value || value.startsWith("--")) throw new Error(`new-app: ${flag} requires a value`);
  return value;
}

async function resolveOrgHome(explicit: string | undefined): Promise<string | undefined> {
  if (explicit) return resolve(explicit);
  const configured = await findExistingOrg();
  if (configured) return configured;
  return existsSync(join(process.cwd(), "apps.yaml")) ? process.cwd() : undefined;
}
