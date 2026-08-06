// `cormidia bootstrap [path] [--scan-only] [--answers <file>]` — scan the
// target repo (docs/architecture.md §9 step 1), walk the alignment
// questionnaire (step 2: interactive in a terminal, or injected via
// `--answers answers.json` for tests/scripting), and emit the `.cormidia/`
// tree (step 3): app charter/config/policy/onboarding report + seeded memory
// bundles, then register the app with the active org.
// `--scan-only` prints the scan profile and the would-create list without
// writing anything. An explicit active org is now a prerequisite: package source, committed org
// configuration, runtime state, and target app are separate homes.

import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { bootstrapFromRecoveredAnswers, type RecoveredBootstrapResult } from "../org/app-lifecycle.js";
import { findExistingOrg } from "../org/apps.js";
import { authorityPreview, resolveAuthority } from "../org/authority.js";
import { bootstrapRun, scanRepo, type CommandDetection, type RepoScan } from "../org/bootstrap.js";
import { ORG_HOME_DEFINITION, resolveCormidiaHomes, STATE_HOME_DEFINITION, validateOrgHome } from "../org/home.js";
import { stableJson } from "../org/lifecycle.js";
import { readOnboardingRecoverySource } from "../org/onboarding-answers.js";
import { loadRoles } from "../org/roles.js";
import { definedProps } from "../runtime/optional-properties.js";

export async function cmdBootstrap(args: string[]): Promise<number> {
  let root = ".";
  let scanOnly = false;
  let answersPath: string | undefined;
  let answersFrom: string | undefined;
  let orgHome: string | undefined;
  let stateHome: string | undefined;
  let json = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--scan-only") {
      scanOnly = true;
    } else if (arg === "--json") {
      json = true;
    } else if (arg === "--answers") {
      const next = args[i + 1];
      if (!next || next.startsWith("--")) {
        throw new Error("bootstrap: --answers requires a path to an answers.json file");
      }
      answersPath = next;
      i++;
    } else if (arg === "--answers-from") {
      const next = args[i + 1];
      if (!next || next.startsWith("--")) {
        throw new Error("bootstrap: --answers-from requires a reset archive path or app name");
      }
      answersFrom = next;
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

  if (answersPath !== undefined && answersFrom !== undefined) {
    throw new Error("bootstrap: choose either --answers or --answers-from, not both");
  }

  validateLocalTarget(root);
  const existingOrgHome = await findExistingOrg(orgHome ? { orgHome } : {});
  if (existingOrgHome !== undefined) await validateOrgHome(existingOrgHome);
  const homes = existingOrgHome
    ? await resolveCormidiaHomes({
        orgHome: existingOrgHome,
        ...definedProps({ stateHome }),
      })
    : undefined;

  if (scanOnly) {
    const scan = await scanRepo(root);
    if (json) {
      console.log(
        stableJson({
          schema_version: 1,
          kind: "bootstrap-scan",
          app_root: scan.root,
          org_home: homes?.orgHome ?? null,
          state_home: homes?.stateHome ?? null,
          scan,
          mutating: false,
          provider: { factories: 0, processes: 0, turns: 0, settlements: 0 },
        }).trimEnd(),
      );
      return 0;
    }
    printHomes(scan.root, homes?.orgHome, homes?.stateHome);
    printScan(scan);
    console.log("\nwould create:");
    if (existingOrgHome) console.log(`  ${existingOrgHome}/apps.yaml entry (join existing org)`);
    else console.log("  no files — initialize an org first with `cormidia org init <path> --name <name>`");
    console.log(
      "  .cormidia/TASTE.md, .cormidia/config.yaml, .cormidia/policy.yaml, " +
        ".cormidia/AUTHORITY.md, .cormidia/onboarding-report.md, " +
        "safe AGENTS.md/CLAUDE.md authority blocks, " +
        ".cormidia/memory/<role>/INDEX.md (with answers)",
    );
    console.log("(nothing written to bootstrap artifacts — --scan-only; dispatched CLI invocation audit only)");
    return 0;
  }

  if (existingOrgHome === undefined) {
    throw new Error("bootstrap: no active org home — create one first with `cormidia org init <path> --name <name>`");
  }
  if (homes === undefined) throw new Error("bootstrap: active org resolution failed");
  if (!json) printHomes(resolve(root), homes.orgHome, homes.stateHome);

  // Step 2 — the answers object: injected file, or interactive when a
  // human is present. One validation path either way (parseAnswers, inside
  // bootstrapRun).
  let answersRaw: unknown;
  let recoveredAppName: string | undefined;
  if (answersPath) {
    answersRaw = await readAnswersFile(answersPath);
  } else if (answersFrom !== undefined) {
    const recovery = await readOnboardingRecoverySource(answersFrom, homes.stateHome, {
      archiveRoot: join(dirname(homes.stateHome), "archives", safeSegment(homes.appsFile.org.name)),
    });
    answersRaw = recovery.answers;
    recoveredAppName = recovery.app;
  } else if (process.stdin.isTTY && process.stdout.isTTY) {
    const orgRoles = await loadRoles(join(homes.orgHome, "roles.yaml"));
    answersRaw = await collectAnswers(
      process.stdin,
      process.stdout,
      orgRoles.roles.map((role) => role.name),
    );
  }

  if (answersRaw !== undefined) {
    const result =
      answersFrom !== undefined
        ? await bootstrapFromRecoveredAnswers(root, answersRaw, {
            orgHome: homes.orgHome,
            stateHome: homes.stateHome,
            ...definedProps({ appName: recoveredAppName }),
          })
        : await bootstrapRun(root, answersRaw, {
            orgHome: homes.orgHome,
            stateHome: homes.stateHome,
          });
    const { scan, created, updated, joinedOrgHome } = result;
    const recovered =
      "immutableSource" in result && result.immutableSource === true ? (result as RecoveredBootstrapResult) : undefined;
    const authority = await resolveAuthority({ orgHome: homes.orgHome, appWorkdir: recovered?.managedClone ?? root });
    if (json) {
      console.log(
        stableJson({
          schema_version: 1,
          kind: "bootstrap-result",
          status: "registered",
          app_root: scan.root,
          org_home: joinedOrgHome,
          state_home: homes.stateHome,
          created,
          updated,
          immutable_source: recovered !== undefined,
          managed_clone: recovered?.managedClone ?? null,
          onboarding_commit: recovered?.onboardingCommit ?? null,
          default_branch: recovered?.defaultBranch ?? null,
          authority: { profile: authority.profile, version: authority.version, sha256: authority.sha256 },
          provider: { factories: 0, processes: 0, turns: 0, settlements: 0 },
        }).trimEnd(),
      );
      return 0;
    }
    printScan(scan);
    console.log(`\njoined existing org at ${joinedOrgHome}`);
    console.log("\ncreated:");
    for (const rel of created) console.log(`  ${rel}`);
    if (updated.length > 0) {
      console.log("\nupdated (Cormidia marked block only):");
      for (const rel of updated) console.log(`  ${rel}`);
    }
    if (recovered !== undefined) {
      console.log(`\nmanaged onboarding commit: ${recovered.onboardingCommit}`);
      console.log(`default branch: ${recovered.defaultBranch}`);
      console.log(`source checkout unchanged: ${root}`);
      console.log(
        "next: make the onboarding commit reachable from the remote default branch, then run `cormidia app verify <app>`.",
      );
    }
    const preview = authorityPreview(
      authority.profile === "conservative"
        ? "conservative"
        : authority.profile === "custom"
          ? "custom"
          : "delegated-operator",
    );
    console.log(`\nauthority: ${authority.version} (sha256:${authority.sha256})`);
    console.log(`  automatic: ${preview.automatic.join("; ")}`);
    console.log(`  human-gated: ${preview.humanGated.join("; ")}`);
    if (recovered === undefined) {
      console.log(
        "\nnext: review + commit app artifacts under .cormidia/ in the app repo:\n" +
          "charter (.cormidia/TASTE.md), authority (.cormidia/AUTHORITY.md), registry entry (.cormidia/config.yaml),\n" +
          "policy (.cormidia/policy.yaml), onboarding report (.cormidia/onboarding-report.md),\n" +
          "and seeded memory bundles.",
      );
    }
    return 0;
  }

  throw new Error(
    "bootstrap: questionnaire answers are required outside an interactive terminal — " +
      "pass --answers <answers.json> or --answers-from <archive|app>; no files or registry entries were written",
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

function safeSegment(value: string): string {
  return (
    value
      .trim()
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "org"
  );
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
    throw new Error(`bootstrap: cannot read --answers file ${path}: ${e instanceof Error ? e.message : String(e)}`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (e) {
    throw new Error(`bootstrap: --answers ${path} is not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Interactive §9 step-2 questionnaire — one prompt per answers field,
 * producing the same raw shape `--answers answers.json` supplies (validated
 * once, in parseAnswers). Streams are injected so tests can drive it.
 * Cadence overrides are deliberately not prompted — the default (empty =
 * roles.yaml triggers) is right for onboarding; edit .cormidia/config.yaml
 * to tune later. */
async function collectAnswers(
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

    const rolesText = await ask(`Roles to enable [${knownRoles.join(", ")}] (comma-separated, empty = all)`);
    const rolesAnswered = rolesText
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const roles = rolesAnswered.length > 0 ? rolesAnswered : [...knownRoles];

    const budgetText = await ask("Monthly budget in USD [1000]");

    const answers: Record<string, unknown> = { product, good, roles };
    if (budgetText.length > 0) answers["budgetUsdMonth"] = Number(budgetText);

    const authorityMode = (await ask("App authority [inherit | conservative | custom] [inherit]")) || "inherit";
    if (authorityMode === "custom") {
      answers["authority"] = {
        mode: "custom",
        restrictions: await ask(
          "App-specific authority restriction (start with Ask before, Do not, Never, Require human approval before, or Limit)",
        ),
      };
    } else {
      answers["authority"] = { mode: authorityMode };
    }

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
  const cmd = (d: CommandDetection | undefined) => (d ? `${d.command}  (${d.source})` : "none detected");
  const list = (items: string[]) => (items.length > 0 ? items.join(", ") : "none detected");
  const docSummary = scan.docInventory.map((category) => `${category.label}: ${list(category.paths)}`).join("; ");
  const missing = scan.docInventory.filter((category) => category.paths.length === 0).map((category) => category.label);

  console.log(`bootstrap scan: ${scan.root}`);
  console.log(`  language:     ${scan.language ? `${scan.language} (${scan.languageSource})` : "none detected"}`);
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
    "profile: bootstrap writes app-owned .cormidia/ artifacts and registers the app in the active org; " +
      "full bootstrap creates .cormidia/onboarding-report.md and .cormidia/AUTHORITY.md and composes marked AGENTS/CLAUDE blocks",
  );
}
