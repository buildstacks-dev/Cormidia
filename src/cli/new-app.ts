// `cormidia new-app` — greenfield product bootstrap. This creates the target app
// repo skeleton first, then hands off to the normal bootstrap/register path.

import { ORG_HOME_DEFINITION, resolveCormidiaHomes, STATE_HOME_DEFINITION } from "../org/home.js";
import { stableJson } from "../org/lifecycle.js";
import { NewAppBlockedError } from "../org/new-app-blocked.js";
import { createNewApp, DEFAULT_NEW_APP_TEMPLATE, NEW_APP_TEMPLATES, type NewAppTemplate } from "../org/new-app.js";
import { reportCliInvocation } from "./invocation-audit.js";

export async function cmdNewApp(args: string[]): Promise<number> {
  const parsed = parseArgs(args);
  const homes = await resolveCormidiaHomes(parsed.orgHome !== undefined ? { orgHome: parsed.orgHome } : {});
  const result = await createNewApp({
    appName: parsed.appName,
    targetDir: parsed.targetDir,
    repoSlug: parsed.repoSlug,
    goal: parsed.goal,
    template: parsed.template,
    orgHome: homes.orgHome,
    stateHome: homes.stateHome,
    supportChannels: parsed.supportChannels,
    marketingChannels: parsed.marketingChannels,
    dryRun: parsed.dryRun,
  }).catch((error: unknown) => {
    // Preview and execution refuse identically; the operator sees the exact
    // refused target rather than a generated guide bound to it (#385).
    if (error instanceof NewAppBlockedError) reportNewAppRefusal(error, parsed.json);
    throw error;
  });
  reportCliInvocation({
    org: homes.appsFile.org.name,
    app: result.appName,
    dryRun: result.dryRun,
    outcome: result.dryRun ? "new-app-preview-ready" : "app-created-and-registered",
    provenance: { template: result.template },
  });

  if (parsed.json) {
    console.log(JSON.stringify(result, null, 2));
    return 0;
  }

  console.log(`${result.dryRun ? "would create" : "created"} greenfield app: ${result.appName}`);
  console.log(`target: ${result.targetDir} (${result.target})`);
  console.log(`repo: ${result.repoSlug}`);
  console.log(`template: ${result.template}`);
  console.log(`quality gates: ${result.qualityGates.status} — ${result.qualityGates.detail}`);
  if (result.qualityGates.status === "configured") {
    console.log(`  setup_command: ${result.qualityGates.setupCommand}`);
    console.log(`  test_command: ${result.qualityGates.testCommand}`);
    console.log(`  lint_command: ${result.qualityGates.lintCommand}`);
  }
  if (result.joinedOrgHome) console.log(`org home: ${result.joinedOrgHome}`);
  console.log(`org home means: ${ORG_HOME_DEFINITION}`);
  console.log(`state home: ${homes.stateHome} — ${STATE_HOME_DEFINITION}`);
  console.log("\ncreated:");
  for (const rel of result.created) console.log(`  ${rel}`);
  console.log("\nupdated:");
  for (const rel of result.updated) console.log(`  ${rel}`);
  if (result.preserved.length > 0) {
    console.log("\npreserved (existing target entries, left byte-identical):");
    for (const rel of result.preserved) console.log(`  ${rel}`);
  }
  if (result.stateCreated.length > 0) {
    console.log("\nstate records:");
    for (const path of result.stateCreated) console.log(`  ${path}`);
  }
  if (result.dryRun) {
    console.log("\n(dry-run: no app/org artifacts written; invocation audit only)");
  } else {
    console.log("\nnext: follow .cormidia/bootstrap/next-commands.md; record keep/reconcile/remove before planning.");
  }
  return 0;
}

function reportNewAppRefusal(error: NewAppBlockedError, json: boolean): void {
  const refusal = error.refusal;
  if (json) {
    console.log(stableJson(refusal).trimEnd());
    return;
  }
  console.log(`new-app: blocked (${refusal.dry_run ? "preview" : "execution"}) — no app/org/state artifact written`);
  console.log(`app: ${refusal.app}`);
  console.log(`target: ${refusal.target_dir}`);
  console.log(`repo: ${refusal.repository}`);
  console.log("\nblockers:");
  for (const blocker of refusal.blockers) {
    console.log(`  ${blocker.code}: ${blocker.detail}`);
    console.log(`    subject: ${blocker.subject}`);
    console.log(`    remediation: ${blocker.remediation}`);
  }
}

interface ParsedNewAppArgs {
  appName: string;
  targetDir: string;
  repoSlug: string;
  goal: string;
  template: NewAppTemplate;
  orgHome?: string;
  supportChannels: string[];
  marketingChannels: string[];
  dryRun: boolean;
  json: boolean;
}

function parseArgs(args: string[]): ParsedNewAppArgs {
  const first = args[0];
  if (!first || first.startsWith("--")) {
    throw new Error(
      "new-app: usage: cormidia new-app <name-or-goal> --target-dir <path> --repo <owner/repo> " +
        "[--goal <string>] [--name <app>] [--template typescript-node|bare] [--org-home <path>] " +
        "[--support-channel <id>] [--marketing-channel <id>] [--dry-run] [--json]",
    );
  }

  let appName: string | undefined;
  let targetDir: string | undefined;
  let repoSlug: string | undefined;
  let goal: string | undefined;
  let template = DEFAULT_NEW_APP_TEMPLATE;
  let orgHome: string | undefined;
  const supportChannels: string[] = [];
  const marketingChannels: string[] = [];
  let dryRun = false;
  let json = false;

  for (let i = 1; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--json") {
      json = true;
    } else if (arg === "--name") {
      appName = readValue(args, ++i, "--name");
    } else if (arg === "--target-dir") {
      targetDir = readValue(args, ++i, "--target-dir");
    } else if (arg === "--repo") {
      repoSlug = readValue(args, ++i, "--repo");
    } else if (arg === "--goal") {
      goal = readValue(args, ++i, "--goal");
    } else if (arg === "--template") {
      template = parseTemplate(readValue(args, ++i, "--template"));
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
  // Slug validity is NOT re-implemented here: src/runtime/repo-identity.ts is
  // the single rule, and createNewApp turns its rejection into the typed
  // blocked result both preview and execution report (#385).

  return {
    appName: appName ?? first,
    targetDir,
    repoSlug,
    goal: goal ?? first,
    template,
    ...(orgHome ? { orgHome } : {}),
    supportChannels,
    marketingChannels,
    dryRun,
    json,
  };
}

function parseTemplate(value: string): NewAppTemplate {
  const template = NEW_APP_TEMPLATES.find((candidate) => candidate === value);
  if (template === undefined) {
    throw new Error(`new-app: --template must be one of ${NEW_APP_TEMPLATES.join("|")} (got "${value}")`);
  }
  return template;
}

function readValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value || value.startsWith("--")) throw new Error(`new-app: ${flag} requires a value`);
  return value;
}
