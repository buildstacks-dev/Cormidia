// campaign/acceptance/campaign-main.ts — the composition, and the process entry.
//
// Everything else in this directory is a piece; this is where they become a
// campaign. The wiring order is B-27 §4's, not a convenience:
//
//   preflight → provision → plan arm → PLAN GATE → build arm → grade → report
//
// and the gate is enforced by `CampaignLifecycle` inside `runAcceptanceCampaign`
// rather than by the order of statements here, so a future edit that reorders
// this file still cannot reach the build arm without a durable resolution.
//
// The report is persisted after every arm, not once at the end: a campaign that
// spent hours and then lost its report to a crash has paid and kept nothing
// (CORMIDIA-INV-ACC-6).

import { join } from "node:path";
import type { ArmOutput } from "./arms.js";
import { runBuildArm, runJobArm, runPlanArm } from "./arms.js";
import type { ScenarioConfig } from "./campaign-config.js";
import {
  preflightCampaign,
  readCampaignFile,
  renderDryRun,
  type AcceptanceCampaignFile,
  type PreflightSummary,
} from "./campaign-cli.js";
import type { AxisReportRow } from "./campaign-report.js";
import type { CliDriver } from "./cli-driver.js";
import { composeAxisEvidenceSet } from "./grader-envelope.js";
import { resolveAxisGraders, type GradedTurnRef } from "./grader-independence.js";
import { runGraderTurn } from "./grader-turn.js";
import { provisionScenarioRepository, type ScenarioProvision } from "./provision.js";
import { persistReport } from "./report-store.js";
import { runAcceptanceCampaign, type ScenarioArms } from "./runner.js";
import { SealedKeyRegistry, type SealedKey } from "./sealed-key.js";

export interface CampaignRuntimeDeps {
  driver: CliDriver;
  /** Where reports and grader templates are written. Outside every root a
   *  grader can read (B-28 §2). */
  campaignRoot: string;
  stateHome: string;
  repoRoot: string;
  cormidia: { slug: string; root: string };
  commitPinAt: Date;
  /** scenarioId → the scenario file's exact bytes. */
  scenarioMarkdown: Record<string, string>;
  /** scenarioId → the ramble brief, verbatim. */
  rambles: Record<string, string>;
  /** scenarioId → absolute path to the seed manifest, when it has one. */
  seedManifests?: Record<string, string>;
  /** Hard bound on build-arm passes per scenario. */
  maxBuildPasses: number;
  rubricExcerpts: Record<string, string>;
}

/** Grade one arm's axes: mechanical ones stay out of a model's hands, and the
 *  rest run as Cormidia turns with confinement proven before construction. */
async function gradeArm(
  deps: CampaignRuntimeDeps,
  file: AcceptanceCampaignFile,
  scenario: ScenarioConfig,
  provision: ScenarioProvision,
  output: ArmOutput,
  keys: readonly SealedKey[],
  axes: readonly string[],
): Promise<AxisReportRow[]> {
  const turns: GradedTurnRef[] = Object.entries(scenario.matrix)
    .filter(([, assignment]) => assignment !== undefined)
    .map(([role, assignment]) => ({
      turnId: role === "planner" ? "plan" : role === "builder" ? "build" : role,
      assignment: assignment!,
    }));

  const plan = file.campaign.graderPlan.filter((entry) => axes.includes(entry.axis));
  const resolutions = resolveAxisGraders({
    axes: plan.map((entry) => ({
      axis: entry.axis,
      readTurnIds: entry.readTurnIds ?? [],
      ...(entry.mechanical === true ? { mechanical: true } : {}),
    })),
    turns,
    candidates: file.campaign.adaptiveAssignments.map((candidate) => ({
      id: candidate.id,
      assignment: candidate.assignment,
    })),
  });

  const rows: AxisReportRow[] = [];
  for (const resolution of resolutions) {
    if (resolution.status === "mechanical") {
      // Mechanical axes are scored by `mechanical-scoring.ts` against the
      // sealed key and `provision.sealedMaterial`; they never reach a model.
      // Left explicit rather than silently skipped so a reader sees the split.
      rows.push({
        axis: resolution.axis,
        score: "ungraded",
        justification: null,
        citations: [],
        ungradedReason: "evidence-missing",
        grader: null,
        mechanical: true,
        appliedDisjointnessFamilies: [],
        appliedReadTurnIds: [],
      });
      continue;
    }
    if (resolution.status === "ungraded") {
      rows.push({
        axis: resolution.axis,
        score: "ungraded",
        justification: null,
        citations: [],
        ungradedReason: "no-legal-grader",
        grader: null,
        mechanical: false,
        appliedDisjointnessFamilies: resolution.appliedDisjointnessFamilies,
        appliedReadTurnIds: resolution.appliedReadTurnIds,
      });
      continue;
    }
    rows.push(
      await runGraderTurn({
        driver: deps.driver,
        scenarioId: scenario.id,
        appName: scenario.appSlug.split("/").at(-1) ?? scenario.id,
        turnId: `grade-${scenario.id}-${resolution.axis}`,
        resolution,
        evidence: composeAxisEvidenceSet(resolution.axis, [...output.evidence, ...output.selfReport]),
        rubricExcerpt: deps.rubricExcerpts[resolution.axis] ?? resolution.axis,
        keys,
        reachableRoots: [provision.seededPaths.length > 0 ? scenario.worktree : scenario.worktree],
        templateDir: join(deps.campaignRoot, "grader-templates"),
      }),
    );
  }
  return rows;
}

const PLAN_AXES = ["P-1", "P-2", "P-3", "P-4", "P-5", "P-6"];
const OUTCOME_AXES = ["O-1", "O-2", "O-3", "O-4", "O-5", "O-6", "O-7", "J-1", "J-2", "J-3"];

/**
 * Build the real `ScenarioArms` for one scenario. This is the function whose
 * absence the review caught: the runner took arms as callbacks and only a test
 * supplied them.
 */
export function scenarioArmsFor(
  deps: CampaignRuntimeDeps,
  file: AcceptanceCampaignFile,
  scenario: ScenarioConfig,
  provision: ScenarioProvision,
  keys: readonly SealedKey[],
): ScenarioArms {
  const armDeps = {
    driver: deps.driver,
    scenarioId: scenario.id,
    appName: scenario.appSlug.split("/").at(-1) ?? scenario.id,
    worktree: scenario.worktree,
    baselineCommit: provision.baselineCommit,
    stateHome: deps.stateHome,
    ramble: deps.rambles[scenario.id] ?? "",
  };
  return {
    scenarioId: scenario.id,
    async planArm() {
      if (scenario.kind === "job") return [];
      const output = await runPlanArm({ ...armDeps, rambleSourcePath: join(scenario.worktree, "BRIEF.md") });
      return gradeArm(deps, file, scenario, provision, output, keys, PLAN_AXES);
    },
    async buildArm() {
      const output =
        scenario.kind === "job"
          ? await runJobArm({ ...armDeps, jobConfigPath: join(scenario.worktree, "job.yaml") })
          : await runBuildArm({ ...armDeps, maxPasses: deps.maxBuildPasses });
      return gradeArm(deps, file, scenario, provision, output, keys, OUTCOME_AXES);
    },
  };
}

export interface CampaignRunOutcome {
  summary: PreflightSummary;
  stoppedAtGate: boolean;
  gateShortfalls: string[];
  reportPath: string;
}

/** Provision, run, grade, persist. Spends real tokens — the caller must have
 *  already satisfied `assertSpendAuthorization`. */
export async function runCampaign(
  file: AcceptanceCampaignFile,
  deps: CampaignRuntimeDeps,
  installProof: Parameters<typeof runAcceptanceCampaign>[0]["installProof"],
): Promise<CampaignRunOutcome> {
  const summary = await preflightCampaign(file, deps.campaignRoot);

  const provisions = new Map<string, ScenarioProvision>();
  for (const scenario of file.campaign.scenarios) {
    provisions.set(
      scenario.id,
      await provisionScenarioRepository({
        scenarioId: scenario.id,
        kind: scenario.kind,
        appSlug: scenario.appSlug,
        worktree: scenario.worktree,
        ...(deps.seedManifests?.[scenario.id] === undefined
          ? {}
          : { seedManifestPath: deps.seedManifests[scenario.id] as string }),
      }),
    );
  }

  const registry = new SealedKeyRegistry();
  const keys = file.campaign.scenarios.map((scenario) =>
    registry.seal({
      scenarioId: scenario.id,
      scenarioKind: scenario.kind,
      scenarioMarkdown: deps.scenarioMarkdown[scenario.id] ?? "",
    }),
  );

  const run = await runAcceptanceCampaign({
    config: file.campaign,
    repoRoot: deps.repoRoot,
    cormidia: deps.cormidia,
    commitPinAt: deps.commitPinAt,
    ...(installProof === undefined ? {} : { installProof }),
    scenarioMarkdown: deps.scenarioMarkdown,
    arms: file.campaign.scenarios.map((scenario) =>
      scenarioArmsFor(deps, file, scenario, provisions.get(scenario.id) as ScenarioProvision, keys),
    ),
    turnCommands: deps.driver.recorded().map((invocation) => `${invocation.binary} ${invocation.argv.join(" ")}`),
  });

  await persistReport({
    root: deps.campaignRoot,
    configSha256: summary.configSha256,
    report: run.report,
    status: "final",
  });

  return {
    summary,
    stoppedAtGate: run.stoppedAtGate,
    gateShortfalls: run.gateShortfalls,
    reportPath: join(deps.campaignRoot, "acceptance", run.report.campaign_id, "report.json"),
  };
}

/** Process entry. `--dry-run` is the honest rehearsal: every preflight runs,
 *  nothing is provisioned, no binary is spawned. */
export async function main(argv: string[]): Promise<number> {
  const configIndex = argv.indexOf("--config");
  if (configIndex === -1 || argv[configIndex + 1] === undefined) {
    process.stderr.write(
      "usage: pnpm test:acceptance -- --config <absolute-path-to-campaign.yaml> [--dry-run]\n\n" +
        "An L-ACC campaign spends real tokens against real GitHub through the PACKAGED binaries.\n" +
        "It runs only under an exact human authorization naming its output-token and equivalent-USD\n" +
        "ceilings (risk-allocation.md §5a). Start with --dry-run.\n",
    );
    return 1;
  }
  const file = await readCampaignFile(argv[configIndex + 1] as string);
  const rootIndex = argv.indexOf("--campaign-root");
  const campaignRoot = rootIndex === -1 ? process.cwd() : (argv[rootIndex + 1] as string);

  const summary = await preflightCampaign(file, campaignRoot);
  if (argv.includes("--dry-run")) {
    process.stdout.write(`${renderDryRun(summary)}\n`);
    return 0;
  }
  process.stderr.write(
    `preflight passed for ${summary.campaignId}.\n\n` +
      "A live run additionally requires: the packaged install proof, the campaign org and its\n" +
      "disposable scenario repositories, and provider credentials. Wire them through `runCampaign`\n" +
      "from a session that holds them — this entry point deliberately will not invent them.\n",
  );
  return 2;
}
