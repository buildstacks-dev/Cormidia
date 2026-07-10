// `operon bootstrap [path] [--scan-only] [--answers <file>]` — scan the
// target repo (docs/architecture.md §9 step 1), walk the alignment
// questionnaire (step 2: interactive in a terminal, or injected via
// `--answers answers.json` for tests/scripting), and emit the `.operon/`
// tree (step 3): app charter/config/policy/onboarding report + seeded memory
// bundles, then register the app with the active org.
// `--scan-only` prints the scan profile and the would-create list without
// writing anything. An explicit active org is now a prerequisite: package source, committed org
// configuration, runtime state, and target app are separate homes.

import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import {
  bootstrapRun,
  scanRepo,
  type CommandDetection,
  type RepoScan,
} from "../org/bootstrap.js";
import { findExistingOrg } from "../org/apps.js";
import { loadRoles } from "../org/roles.js";
import {
  ORG_HOME_DEFINITION,
  resolveOperonHomes,
  STATE_HOME_DEFINITION,
  validateOrgHome,
} from "../org/home.js";

export async function cmdBootstrap(args: string[]): Promise<number> {
  let root = ".";
  let scanOnly = false;
  let answersPath: string | undefined;
  let orgHome: string | undefined;
  let stateHome: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--scan-only") {
      scanOnly = true;
    } else if (arg === "--answers") {
      const next = args[i + 1];
      if (!next || next.startsWith("--")) {
        throw new Error("bootstrap: --answers requires a path to an answers.json file");
      }
      answersPath = next;
      i++;
    } else if (arg === "--org-home") {
      const next = args[i + 1];
      if (!next || next.startsWith("--")) {
        throw new Error("bootstrap: --org-home requires a path to an existing org home");
      }
      orgHome = next;
      i++;
    } else if (arg === "--state-home") {
      const next = args[i + 1];
      if (!next || next.startsWith("--")) {
        throw new Error("bootstrap: --state-home requires a local path");
      }
      stateHome = next;
      i++;
    } else if (!arg.startsWith("--")) {
      root = arg;
    } else {
      throw new Error(`bootstrap: unknown flag "${arg}"`);
    }
  }

  validateLocalTarget(root);
  const existingOrgHome = await findExistingOrg(orgHome ? { orgHome } : {});
  if (existingOrgHome !== undefined) await validateOrgHome(existingOrgHome);
  const homes = existingOrgHome
    ? await resolveOperonHomes({
        orgHome: existingOrgHome,
        ...(stateHome !== undefined ? { stateHome } : {}),
      })
    : undefined;

  if (scanOnly) {
    const scan = await scanRepo(root);
    printHomes(scan.root, homes?.orgHome, homes?.stateHome);
    printScan(scan);
    console.log("\nwould create:");
    if (existingOrgHome) console.log(`  ${existingOrgHome}/apps.yaml entry (join existing org)`);
    else console.log("  no files — initialize an org first with `operon org init <path> --name <name>`");
    console.log(
      "  .operon/TASTE.md, .operon/config.yaml, .operon/policy.yaml, " +
        ".operon/onboarding-report.md, " +
        ".operon/memory/<role>/INDEX.md (with answers)",
    );
    console.log("(nothing written — --scan-only)");
    return 0;
  }

  if (existingOrgHome === undefined) {
    throw new Error(
      "bootstrap: no active org home — create one first with `operon org init <path> --name <name>`",
    );
  }
  if (homes === undefined) throw new Error("bootstrap: active org resolution failed");
  printHomes(resolve(root), homes.orgHome, homes.stateHome);

  // Step 2 — the answers object: injected file, or interactive when a
  // human is present. One validation path either way (parseAnswers, inside
  // bootstrapRun).
  let answersRaw: unknown;
  if (answersPath) {
    answersRaw = await readAnswersFile(answersPath);
  } else if (process.stdin.isTTY && process.stdout.isTTY) {
    const orgRoles = await loadRoles(join(homes.orgHome, "roles.yaml"));
    answersRaw = await collectAnswers(
      process.stdin,
      process.stdout,
      orgRoles.roles.map((role) => role.name),
    );
  }

  if (answersRaw !== undefined) {
    const { scan, created, joinedOrgHome } = await bootstrapRun(root, answersRaw, {
      orgHome: homes.orgHome,
    });
    printScan(scan);
    console.log(`\njoined existing org at ${joinedOrgHome}`);
    console.log("\ncreated:");
    for (const rel of created) console.log(`  ${rel}`);
    console.log(
      "\nnext: review + commit app artifacts under .operon/ in the app repo:\n" +
        "charter (.operon/TASTE.md), registry entry (.operon/config.yaml),\n" +
        "policy (.operon/policy.yaml), onboarding report (.operon/onboarding-report.md),\n" +
        "and seeded memory bundles.",
    );
    return 0;
  }

  throw new Error(
    "bootstrap: questionnaire answers are required outside an interactive terminal — " +
      "pass --answers <answers.json>; no files or registry entries were written",
  );
}

function validateLocalTarget(rootIn: string): void {
  if (/^(?:https?:\/\/|git@|ssh:\/\/)/i.test(rootIn)) {
    throw new Error(
      "bootstrap expects a local repository path, not a GitHub URL. Clone the repo first, " +
        "then run bootstrap against the local checkout.",
    );
  }
  const root = resolve(rootIn);
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new Error(`bootstrap: local repository path does not exist or is not a directory: ${root}`);
  }
}

function printHomes(appRoot: string, orgHome?: string, stateHome?: string): void {
  console.log(`App repo:   ${appRoot} — the product checkout being onboarded.`);
  console.log(`Org home:   ${orgHome ?? "not configured"} — ${ORG_HOME_DEFINITION}.`);
  console.log(`State home: ${stateHome ?? "not configured (initialize an org first)"} — ${STATE_HOME_DEFINITION}.`);
}

async function readAnswersFile(path: string): Promise<unknown> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (e) {
    throw new Error(
      `bootstrap: cannot read --answers file ${path}: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (e) {
    throw new Error(
      `bootstrap: --answers ${path} is not valid JSON: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

/** Interactive §9 step-2 questionnaire — one prompt per answers field,
 * producing the same raw shape `--answers answers.json` supplies (validated
 * once, in parseAnswers). Streams are injected so tests can drive it.
 * Cadence overrides are deliberately not prompted — the default (empty =
 * roles.yaml triggers) is right for onboarding; edit .operon/config.yaml
 * to tune later. */
export async function collectAnswers(
  input: NodeJS.ReadableStream,
  output: NodeJS.WritableStream,
  knownRoles: string[],
): Promise<Record<string, unknown>> {
  const rl = createInterface({ input, output });
  try {
    const ask = async (q: string) => (await rl.question(`${q}\n> `)).trim();
    const askList = async (q: string) =>
      (await ask(`${q} (comma-separated, empty = none)`))
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

    const product = await ask("What is this product? (one paragraph — the app charter's identity)");
    const good = await ask('What does "good" mean for this product?');

    const rolesText = await ask(
      `Roles to enable [${knownRoles.join(", ")}] (comma-separated, empty = all)`,
    );
    const rolesAnswered = rolesText
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const roles = rolesAnswered.length > 0 ? rolesAnswered : [...knownRoles];

    const budgetText = await ask("Monthly budget in USD [1000]");

    const answers: Record<string, unknown> = { product, good, roles };
    if (budgetText.length > 0) answers["budgetUsdMonth"] = Number(budgetText);

    answers["criticalOps"] = {
      deployCommands: await askList("App-specific critical ops — deploy commands"),
      publishTargets: await askList("App-specific critical ops — publish targets"),
      secretLocations: await askList("App-specific critical ops — secret locations"),
    };

    const channels: Record<string, string[]> = {};
    if (roles.includes("support")) {
      channels["support"] = await askList("Support channels to watch");
    }
    if (roles.includes("marketing")) {
      channels["marketing"] = await askList("Marketing channels to publish to");
    }
    if (Object.keys(channels).length > 0) answers["channels"] = channels;

    return answers;
  } finally {
    rl.close();
  }
}

function printScan(scan: RepoScan): void {
  const cmd = (d: CommandDetection | undefined) =>
    d ? `${d.command}  (${d.source})` : "none detected";
  const list = (items: string[]) => (items.length > 0 ? items.join(", ") : "none detected");
  const docSummary = scan.docInventory
    .map((category) => `${category.label}: ${list(category.paths)}`)
    .join("; ");
  const missing = scan.docInventory
    .filter((category) => category.paths.length === 0)
    .map((category) => category.label);

  console.log(`bootstrap scan: ${scan.root}`);
  console.log(
    `  language:     ${scan.language ? `${scan.language} (${scan.languageSource})` : "none detected"}`,
  );
  console.log(`  package mgr:  ${scan.packageManager ?? "none detected"}`);
  console.log(`  build:        ${cmd(scan.build)}`);
  console.log(`  test:         ${cmd(scan.test)}`);
  console.log(`  lint:         ${cmd(scan.lint)}`);
  console.log(`  agent docs:   ${list(scan.agentDocs)}`);
  console.log(`  ci:           ${list(scan.ciConfigs)}`);
  console.log(`  deploy hints: ${list(scan.deployHints)}`);
  console.log(`  docs:         ${docSummary}`);
  console.log(`  doc gaps:     ${missing.length > 0 ? missing.join(", ") : "none detected"}`);
  console.log(`  git remote:   ${scan.repoSlug ?? "none detected"}`);
  console.log(
    "profile: bootstrap writes app-owned .operon/ artifacts and registers the app in the active org; " +
      "full bootstrap creates .operon/onboarding-report.md",
  );
}
