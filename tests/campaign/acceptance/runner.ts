// campaign/acceptance/runner.ts — the L-ACC campaign runner (HB-130).
//
// The runner spends nothing on its own: both arms and every grader turn arrive
// as injected callbacks, exactly as `DurableCampaignRunner` takes an authorized
// case callback. Run 1 reached its terminal plan-gate stop on 2026-08-08 under
// a separate exact human authorization; this module still cannot manufacture
// authorization for any later campaign.
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

import type { AcceptanceCampaignConfig } from "./campaign-config.js";
import { executeBuildArms, executePlanArms, type ScenarioArms } from "./campaign-arm-execution.js";
import { CampaignLifecycle } from "./campaign-lifecycle.js";
import { buildCampaignReport } from "./campaign-report-builder.js";
import { assertReportWellFormed, type AcceptanceCampaignReport, type AxisReportRow } from "./campaign-report.js";
import type { PackagedInstallProof } from "./packaged-provenance.js";
import type { CampaignSpendSnapshot } from "./campaign-spend.js";
import { resolvePlanGate, type ScenarioPlanScores } from "./plan-gate.js";
import type { CormidiaIdentity } from "./scenario-binding.js";
import { SealedKeyRegistry } from "./sealed-key.js";
import type { AxisScoreValue } from "./verdict-algebra.js";
import { preflightAcceptanceCampaign } from "./campaign-world-preflight.js";
export { preflightAcceptanceCampaign } from "./campaign-world-preflight.js";

/** One scenario's two arms, supplied by the caller. The runner never invokes a
 *  provider itself — grading is a Cormidia-invoked turn like any other. */
export type { ScenarioArms } from "./campaign-arm-execution.js";

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
  spend?: CampaignSpendSnapshot;
  /** Durable checkpoint hook. Called after each paid arm and gate resolution. */
  onProgress?: (report: AcceptanceCampaignReport) => Promise<void>;
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
  const { validated, provenance, policyBinding, revalidateAdmission, axisScorePolicy } =
    await preflightAcceptanceCampaign(input);
  await revalidateAdmission();

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
    if (scenario.kind === "app") lifecycle.transition("plan-arm");
    lifecycles.set(scenario.id, lifecycle);
  }

  // ---- Plan arm.
  const planRows = new Map<string, AxisReportRow[]>();
  const buildRows = new Map<string, AxisReportRow[]>();
  const envelope = validated.envelope;
  const spend = input.spend ?? {
    maxOutputTokens: envelope.maxOutputTokens,
    maxEquivUsd: envelope.maxEquivUsd,
    observedOutputTokens: 0,
    observedEquivUsd: 0,
    debitedUnknownOutputTokens: 0,
    debitedUnknownEquivUsd: 0,
    ceilingExhausted: false,
    reservationRefusals: [],
  };
  const checkpoint = async (gateDecision?: "continue" | "stop"): Promise<void> => {
    if (input.onProgress === undefined) return;
    await revalidateAdmission();
    const report = buildCampaignReport({
      config: input.config,
      validated,
      provenance,
      policyBinding,
      axisScorePolicy,
      planRows,
      buildRows,
      lifecycles,
      spend,
      ...(gateDecision === undefined ? {} : { gateDecision }),
    });
    assertReportWellFormed(report);
    await input.onProgress(report);
  };
  let spendStopped = await executePlanArms(input.arms, lifecycles, planRows, () => checkpoint(), revalidateAdmission);

  // ---- The gate. Rubric §6 decides eligibility; the declared policy (or the
  // human) authorizes continuation. The resolution is recorded BEFORE any
  // build-arm spend, and the lifecycle refuses build-arm entry without it.
  const planScores: ScenarioPlanScores[] = input.arms
    .filter((arms) => arms.kind === "app")
    .map((arms) => ({
      scenarioId: arms.scenarioId,
      scores: planScoresOf(planRows.get(arms.scenarioId) ?? []),
    }));
  const gate = resolvePlanGate(validated.planGate, planScores, input.humanGateDecision);
  for (const resolution of gate.resolutions) lifecycles.get(resolution.scenarioId)?.recordGateResolution(resolution);
  for (const arms of input.arms.filter((candidate) => candidate.kind === "job")) {
    const lifecycle = lifecycles.get(arms.scenarioId);
    lifecycle?.recordGateResolution({
      scenarioId: arms.scenarioId,
      applicable: false,
      resolvedBy: validated.planGate.kind === "auto-continue" ? "declared-policy" : "human",
      decision: gate.decision,
      scores: {},
      reason: "not applicable: jobs have no Planner; this arm waited for the campaign-level app plan gate",
    });
    lifecycle?.transition("plan-gated");
  }
  await checkpoint(gate.decision);

  // ---- Build arm, only past a `continue`.
  if (gate.decision === "continue") {
    spendStopped =
      (await executeBuildArms(
        input.arms,
        lifecycles,
        buildRows,
        () => checkpoint(gate.decision),
        revalidateAdmission,
      )) || spendStopped;
  } else {
    for (const arms of input.arms) lifecycles.get(arms.scenarioId)?.transition("stopped-at-gate");
  }

  await revalidateAdmission();
  const report = buildCampaignReport({
    config: input.config,
    validated,
    provenance,
    policyBinding,
    axisScorePolicy,
    planRows,
    buildRows,
    lifecycles,
    gateDecision: gate.decision,
    spend,
  });
  assertReportWellFormed(report);

  for (const scenario of input.config.scenarios) lifecycles.get(scenario.id)?.transition("reported");

  return {
    report,
    stoppedAtGate: gate.decision === "stop",
    gateShortfalls: [...gate.shortfalls, ...(spendStopped ? ["campaign spend admission stopped further arms"] : [])],
  };
}
