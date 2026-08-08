// campaign/acceptance/runner.ts — the L-ACC campaign runner (HB-130).
//
// THE RUNNER EXISTS; NO CAMPAIGN HAS RUN. It spends nothing on its own: both
// arms and every grader turn arrive as injected callbacks, exactly as
// `DurableCampaignRunner` takes an authorized case callback. Run 1 needs a
// separate exact human authorization naming its output-token and
// equivalent-USD ceilings (risk-allocation.md §5a), and this module cannot
// manufacture one.
//
// Two resolved findings shape it:
//
//   * F-PT-029 — the runner NEVER emits a release signal. L-ACC gates nothing,
//     sits permanently outside RQ-1, and a bad result is information for the
//     human rather than a mechanical block. The report type carries
//     `release_signal: null` explicitly, and `assertReportWellFormed` refuses
//     any report that filled it in.
//   * F-PT-030 — a declared `plan_gate` policy may resolve the gate unattended
//     so a campaign runs end to end, applying rubric §6's criteria and
//     recording the resolution with the scores it acted on. A config with no
//     declared policy refuses at preflight.
//
// Ordering is enforced by `CampaignLifecycle` rather than by the sequence of
// statements below, so a future edit that reorders this function still cannot
// reach the build arm without a durable gate resolution.

import { assertCampaignRepositoryBinding } from "../repository-binding.js";
import { validateCampaignConfig, type AcceptanceCampaignConfig } from "./campaign-config.js";
import { CampaignLifecycle } from "./campaign-lifecycle.js";
import {
  assertReportWellFormed,
  type AcceptanceCampaignReport,
  type AcceptanceScenarioReport,
  type AxisReportRow,
} from "./campaign-report.js";
import { assertPackagedProvenance, type PackagedInstallProof } from "./packaged-provenance.js";
import { resolvePlanGate, type ScenarioPlanScores } from "./plan-gate.js";
import { assertScenarioNotThisRepository, type CormidiaIdentity } from "./scenario-binding.js";
import { SealedKeyRegistry } from "./sealed-key.js";
import { campaignVerdict, loadAxisScorePolicy, scenarioCompleteness, type AxisScoreValue } from "./verdict-algebra.js";

/** One scenario's two arms, supplied by the caller. The runner never invokes a
 *  provider itself — grading is a Cormidia-invoked turn like any other. */
export interface ScenarioArms {
  scenarioId: string;
  /** Plan-arm axis rows. Called once, before the gate. */
  planArm(): Promise<AxisReportRow[]>;
  /** Build-arm axis rows. Called ONLY after a `continue` resolution. */
  buildArm(): Promise<AxisReportRow[]>;
}

export interface RunAcceptanceCampaignInput {
  config: AcceptanceCampaignConfig;
  /** Repo root the ratified policy is read from. */
  repoRoot: string;
  cormidia: CormidiaIdentity;
  commitPinAt: Date;
  installProof?: PackagedInstallProof;
  /** scenarioId → the scenario file's exact bytes, for sealing. */
  scenarioMarkdown: Record<string, string>;
  arms: readonly ScenarioArms[];
  /** Required only when the declared policy is `human`. */
  humanGateDecision?: "continue" | "stop";
  /** Commands campaign turns invoked, checked for source-backed slips. */
  turnCommands?: readonly string[];
  /** Injected so the binding check is testable against a fixture checkout. */
  bindingCwd?: string;
}

/** The gate's outcome alongside the report, so a caller can see WHY a campaign
 *  stopped without re-deriving it. A stop is not a failure. */
export interface AcceptanceCampaignRun {
  report: AcceptanceCampaignReport;
  stoppedAtGate: boolean;
  gateShortfalls: string[];
}

function planScoresOf(rows: readonly AxisReportRow[]): Record<string, AxisScoreValue> {
  return Object.fromEntries(rows.map((row) => [row.axis, row.score] as const));
}

export async function runAcceptanceCampaign(input: RunAcceptanceCampaignInput): Promise<AcceptanceCampaignRun> {
  // ---- Preflight: every refusal here is pre-mutation and pre-spend (B-27 §1).
  const validated = validateCampaignConfig(input.config);
  const provenance = assertPackagedProvenance({
    ...(input.installProof === undefined ? {} : { proof: input.installProof }),
    commitPinAt: input.commitPinAt,
    ...(input.turnCommands === undefined ? {} : { turnCommands: input.turnCommands }),
  });
  await assertCampaignRepositoryBinding({
    commit: input.config.commit,
    policyPath: input.config.policyPath,
    ...(input.bindingCwd === undefined ? {} : { cwd: input.bindingCwd }),
  });
  for (const scenario of input.config.scenarios) {
    await assertScenarioNotThisRepository({
      scenarioId: scenario.id,
      appSlug: scenario.appSlug,
      campaignOrg: validated.campaignOrg,
      worktree: scenario.worktree,
      ...(scenario.jobWorkdir === undefined ? {} : { jobWorkdir: scenario.jobWorkdir }),
      cormidia: input.cormidia,
    });
  }

  // ---- Seal every key before the first grader turn can exist (B-28 §1).
  const keys = new SealedKeyRegistry();
  for (const scenario of input.config.scenarios) {
    const markdown = input.scenarioMarkdown[scenario.id];
    if (markdown === undefined) throw new Error(`campaign refused: no scenario file recorded for ${scenario.id}`);
    keys.seal({ scenarioId: scenario.id, scenarioKind: scenario.kind, scenarioMarkdown: markdown });
  }

  const configHash = validated.campaignId;
  const lifecycles = new Map<string, CampaignLifecycle>();
  for (const scenario of input.config.scenarios) {
    const lifecycle = new CampaignLifecycle({ configHash, scenarioId: scenario.id });
    lifecycle.transition("provisioned");
    lifecycle.transition("plan-arm");
    lifecycles.set(scenario.id, lifecycle);
  }

  // ---- Plan arm.
  const planRows = new Map<string, AxisReportRow[]>();
  for (const arms of input.arms) {
    planRows.set(arms.scenarioId, await arms.planArm());
    lifecycles.get(arms.scenarioId)?.transition("plan-gated");
  }

  // ---- The gate. Rubric §6 decides eligibility; the declared policy (or the
  // human) authorizes continuation. The resolution is recorded BEFORE any
  // build-arm spend, and the lifecycle refuses build-arm entry without it.
  const planScores: ScenarioPlanScores[] = input.arms.map((arms) => ({
    scenarioId: arms.scenarioId,
    scores: planScoresOf(planRows.get(arms.scenarioId) ?? []),
  }));
  const gate = resolvePlanGate(validated.planGate, planScores, input.humanGateDecision);
  for (const resolution of gate.resolutions) lifecycles.get(resolution.scenarioId)?.recordGateResolution(resolution);

  // ---- Build arm, only past a `continue`.
  const buildRows = new Map<string, AxisReportRow[]>();
  if (gate.decision === "continue") {
    for (const arms of input.arms) {
      const lifecycle = lifecycles.get(arms.scenarioId);
      lifecycle?.transition("build-arm");
      lifecycle?.noteBuildArmSpend();
      buildRows.set(arms.scenarioId, await arms.buildArm());
      lifecycle?.transition("graded");
    }
  } else {
    for (const arms of input.arms) lifecycles.get(arms.scenarioId)?.transition("stopped-at-gate");
  }

  // ---- Report. Every attempted scenario is present, whatever happened to it.
  const policy = loadAxisScorePolicy(input.repoRoot);
  const scenarios: AcceptanceScenarioReport[] = input.config.scenarios.map((scenario) => {
    const axes = [...(planRows.get(scenario.id) ?? []), ...(buildRows.get(scenario.id) ?? [])];
    const lifecycle = lifecycles.get(scenario.id);
    const completeness = scenarioCompleteness({
      results: axes.map((row) => ({
        axis: row.axis,
        score: row.score,
        justification: row.justification,
        citations: row.citations,
        ungradedReason: row.ungradedReason,
        verdict: "inconclusive" as const,
      })),
      // A campaign that stopped at the gate never ran its build arm, so its
      // outcome axes are missing rather than absent — incomplete, never green.
      ...(gate.decision === "continue" ? {} : { missingGraderRuns: ["build-arm"] }),
    });
    return {
      scenarioId: scenario.id,
      matrix: validated.matrices[scenario.id] ?? {},
      axes,
      completeness: completeness.completeness,
      completenessReasons: completeness.reasons,
      planGate: lifecycle?.resolution() ?? null,
      supervisorReconciliationClosed: true,
    };
  });

  const report: AcceptanceCampaignReport = {
    schema_version: 1,
    campaign_id: validated.campaignId,
    lane: "L-ACC",
    commit: input.config.commit,
    provenance,
    scenarios,
    verdict: campaignVerdict(policy),
    // F-PT-029: explicitly null. Not omitted — an absent field reads as "not
    // implemented yet", a null one reads as a decision.
    release_signal: null,
    rq1_relationship: "outside RQ-1; produces no release evidence",
    authorized_scenario_ids: validated.scenarioIds,
  };
  assertReportWellFormed(report);

  for (const scenario of input.config.scenarios) lifecycles.get(scenario.id)?.transition("reported");

  return { report, stoppedAtGate: gate.decision === "stop", gateShortfalls: gate.shortfalls };
}
