// Explicit live composition for the one human-authorized L-ACC run-1 campaign.
// This process may inspect the harness checkout; every scenario action still
// traverses the installed packaged binaries through CliDriver.

import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { runCampaign } from "./campaign-main.js";
import { readCampaignFile } from "./campaign-cli.js";
import { CampaignSpendGuard } from "./campaign-spend.js";
import { createCliDriver } from "./cli-driver.js";
import type { PackagedInstallProof } from "./packaged-provenance.js";
import { scenarioRamble } from "./sealed-key.js";

interface LiveArguments {
  config: string;
  installProof: string;
  campaignRoot: string;
  orgHome: string;
  stateHome: string;
  repoRoot: string;
  cormidia: string;
  cormidiaJob: string;
}

function argumentsOf(argv: string[]): LiveArguments {
  const names = [
    "config",
    "install-proof",
    "campaign-root",
    "org-home",
    "state-home",
    "repo-root",
    "cormidia",
    "cormidia-job",
  ] as const;
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === undefined || value === undefined || !flag.startsWith("--"))
      throw new Error("live run arguments must be --name value pairs");
    values.set(flag.slice(2), value);
  }
  for (const name of names) if (!values.has(name)) throw new Error(`live run requires --${name}`);
  return {
    config: resolve(values.get("config")!),
    installProof: resolve(values.get("install-proof")!),
    campaignRoot: resolve(values.get("campaign-root")!),
    orgHome: resolve(values.get("org-home")!),
    stateHome: resolve(values.get("state-home")!),
    repoRoot: resolve(values.get("repo-root")!),
    cormidia: resolve(values.get("cormidia")!),
    cormidiaJob: resolve(values.get("cormidia-job")!),
  };
}

function repositorySlug(repoRoot: string): string {
  const remote = execFileSync("git", ["remote", "get-url", "origin"], { cwd: repoRoot, encoding: "utf8" }).trim();
  const match = /github\.com[/:]([^/]+\/[^/.]+)(?:\.git)?$/.exec(remote);
  if (match?.[1] === undefined) throw new Error(`cannot derive Cormidia slug from ${remote}`);
  return match[1];
}

async function proofOf(path: string): Promise<PackagedInstallProof> {
  const value = JSON.parse(await readFile(path, "utf8")) as Omit<PackagedInstallProof, "ranAt"> & { ranAt: string };
  return { ...value, ranAt: new Date(value.ranAt) };
}

async function main(argv: string[]): Promise<void> {
  const args = argumentsOf(argv);
  const file = await readCampaignFile(args.config);
  const scenarioFiles: Record<string, string> = {
    "S-ACC-1": join(args.repoRoot, "acceptance", "scenarios", "S-ACC-1-greenfield-web.md"),
    "S-ACC-2": join(args.repoRoot, "acceptance", "scenarios", "S-ACC-2-corpus-refresh.md"),
    "S-ACC-3": join(args.repoRoot, "acceptance", "scenarios", "S-ACC-3-research-viz-job.md"),
  };
  const scenarioMarkdown = Object.fromEntries(
    await Promise.all(
      Object.entries(scenarioFiles).map(async ([id, path]) => [id, await readFile(path, "utf8")] as const),
    ),
  );
  const spendGuard = new CampaignSpendGuard({ stateHome: args.stateHome, config: file.campaign });
  const driver = await createCliDriver({
    cormidiaPath: args.cormidia,
    cormidiaJobPath: args.cormidiaJob,
    checkoutRoot: args.repoRoot,
    env: { CORMIDIA_ORG_HOME: args.orgHome, CORMIDIA_STATE_HOME: args.stateHome },
    timeoutMs: 90 * 60 * 1000,
    admission: spendGuard,
  });
  const rubric = await readFile(join(args.repoRoot, "acceptance", "rubric.md"), "utf8");
  const axes = [...new Set(file.campaign.graderPlan.map((entry) => entry.axis))];
  const commitPinAt = new Date(
    execFileSync("git", ["show", "-s", "--format=%cI", file.campaign.commit], {
      cwd: args.repoRoot,
      encoding: "utf8",
    }).trim(),
  );
  const outcome = await runCampaign(
    file,
    {
      driver,
      campaignRoot: args.campaignRoot,
      stateHome: args.stateHome,
      orgHome: args.orgHome,
      repoRoot: args.repoRoot,
      cormidia: { slug: repositorySlug(args.repoRoot), root: args.repoRoot },
      commitPinAt,
      scenarioMarkdown,
      rambles: Object.fromEntries(
        Object.entries(scenarioMarkdown).map(([id, markdown]) => [id, scenarioRamble(markdown)]),
      ),
      seedManifests: {
        "S-ACC-2": join(args.repoRoot, "acceptance", "seeds", "s-acc-2-tutorials.json"),
        "S-ACC-3": join(args.repoRoot, "acceptance", "seeds", "s-acc-3-notes.json"),
      },
      maxBuildPasses: 8,
      rubricExcerpts: Object.fromEntries(axes.map((axis) => [axis, rubric])),
      spendGuard,
    },
    await proofOf(args.installProof),
  );
  process.stdout.write(`${JSON.stringify(outcome, null, 2)}\n`);
}

main(process.argv.slice(2)).catch((error) => {
  process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  process.exitCode = 1;
});
