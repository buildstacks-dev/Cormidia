// `operon bootstrap [path] [--scan-only]` — the non-interactive half (M3.3):
// scan the target repo (docs/architecture.md §9 step 1) and emit the
// single-app-profile `.operon/org/` skeleton (step 3). `--scan-only` prints
// the scan profile and the would-create list without writing anything.
// The questionnaire (step 2, app charter/config) arrives with M3.4;
// detect-and-join an existing org (step 4) with M3.5.

import {
  emitOrgTemplates,
  scanRepo,
  ORG_TEMPLATE_FILES,
  type CommandDetection,
  type RepoScan,
} from "../org/bootstrap.js";

export async function cmdBootstrap(args: string[]): Promise<number> {
  let root = ".";
  let scanOnly = false;

  for (const arg of args) {
    if (arg === "--scan-only") {
      scanOnly = true;
    } else if (!arg.startsWith("--")) {
      root = arg;
    } else {
      throw new Error(`bootstrap: unknown flag "${arg}"`);
    }
  }

  const scan = await scanRepo(root);
  printScan(scan);

  if (scanOnly) {
    console.log("\nwould create:");
    for (const rel of ORG_TEMPLATE_FILES) console.log(`  ${rel}`);
    console.log("(nothing written — --scan-only)");
    return 0;
  }

  const emitOptions = scan.repoSlug ? { repoSlug: scan.repoSlug } : {};
  const { created } = await emitOrgTemplates(scan.root, emitOptions);
  console.log("\ncreated:");
  for (const rel of created) console.log(`  ${rel}`);
  console.log(
    "\nnext: review + commit .operon/org/ in the app repo; the questionnaire\n" +
      "(app charter + config.yaml) arrives with M3.4.",
  );
  return 0;
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
  console.log(`profile: single-app (org detect/join arrives with M3.5)`);
}
