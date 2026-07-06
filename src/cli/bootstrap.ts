// `operon bootstrap [path] [--scan-only] [--answers <file>]` — scan the
// target repo (docs/architecture.md §9 step 1), walk the alignment
// questionnaire (step 2: interactive in a terminal, or injected via
// `--answers answers.json` for tests/scripting), and emit the `.operon/`
// tree (step 3): org skeleton + app charter/config/policy + seeded memory bundles.
// `--scan-only` prints the scan profile and the would-create list without
// writing anything. Without answers and without a terminal, only the
// non-interactive org half (M3.3) runs unless `--org-home`/OPERON_HOME points
// at an existing org, in which case bootstrap registers the app there.

import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import {
  bootstrapRun,
  emitOrgTemplates,
  registerAppWithExistingOrg,
  scanRepo,
  templateRoleNames,
  ORG_TEMPLATE_FILES,
  type CommandDetection,
  type RepoScan,
} from "../org/bootstrap.js";
import { findExistingOrg } from "../org/apps.js";

export async function cmdBootstrap(args: string[]): Promise<number> {
  let root = ".";
  let scanOnly = false;
  let answersPath: string | undefined;
  let orgHome: string | undefined;

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
    } else if (!arg.startsWith("--")) {
      root = arg;
    } else {
      throw new Error(`bootstrap: unknown flag "${arg}"`);
    }
  }

  const existingOrgHome = await findExistingOrg(orgHome ? { orgHome } : {});

  if (scanOnly) {
    printScan(await scanRepo(root));
    console.log("\nwould create:");
    if (existingOrgHome) console.log(`  ${existingOrgHome}/apps.yaml entry (join existing org)`);
    else for (const rel of ORG_TEMPLATE_FILES) console.log(`  ${rel}`);
    console.log(
      "  .operon/TASTE.md, .operon/config.yaml, .operon/policy.yaml, " +
        ".operon/memory/<role>/INDEX.md (with answers)",
    );
    console.log("(nothing written — --scan-only)");
    return 0;
  }

  // Step 2 — the answers object: injected file, or interactive when a
  // human is present. One validation path either way (parseAnswers, inside
  // bootstrapRun).
  let answersRaw: unknown;
  if (answersPath) {
    answersRaw = await readAnswersFile(answersPath);
  } else if (process.stdin.isTTY && process.stdout.isTTY) {
    answersRaw = await collectAnswers(process.stdin, process.stdout, await templateRoleNames());
  }

  if (answersRaw !== undefined) {
    const { scan, created, joinedOrgHome } = await bootstrapRun(root, answersRaw, {
      ...(existingOrgHome ? { orgHome: existingOrgHome } : {}),
    });
    printScan(scan);
    if (joinedOrgHome) console.log(`\njoined existing org at ${joinedOrgHome}`);
    console.log("\ncreated:");
    for (const rel of created) console.log(`  ${rel}`);
    const scope = joinedOrgHome ? "app artifacts" : "org skeleton plus app artifacts";
    console.log(
      `\nnext: review + commit .operon/ in the app repo — ${scope}:\n` +
        "charter (.operon/TASTE.md), registry entry (.operon/config.yaml),\n" +
        "policy (.operon/policy.yaml), and seeded memory bundles.",
    );
    return 0;
  }

  if (existingOrgHome) {
    const { scan, joinedOrgHome } = await registerAppWithExistingOrg(root, {
      orgHome: existingOrgHome,
    });
    printScan(scan);
    console.log(`\njoined existing org at ${joinedOrgHome}`);
    console.log(
      "\nnext: re-run with --answers answers.json (or interactively in a\n" +
        "terminal) to emit the app-owned .operon/ charter, config, policy,\n" +
        "and memory bundles.",
    );
    return 0;
  }

  // No answers and no terminal: the non-interactive half only (M3.3).
  const scan = await scanRepo(root);
  printScan(scan);
  const emitOptions = scan.repoSlug ? { repoSlug: scan.repoSlug } : {};
  const { created } = await emitOrgTemplates(scan.root, emitOptions);
  console.log("\ncreated:");
  for (const rel of created) console.log(`  ${rel}`);
  console.log(
    "\nnext: the app charter + config need questionnaire answers — re-run with\n" +
      "--answers answers.json (or interactively in a terminal) to emit\n" +
      ".operon/TASTE.md, .operon/config.yaml, .operon/policy.yaml, and\n" +
      ".operon/memory/.",
  );
  return 0;
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
  console.log(`  git remote:   ${scan.repoSlug ?? "none detected"}`);
  console.log(`profile: bootstrap can emit a single-app org or join an existing org`);
}
