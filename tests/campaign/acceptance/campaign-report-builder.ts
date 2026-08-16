import type { AcceptanceCampaignConfig, ValidatedCampaignConfig } from "./campaign-config.js";
import type { CampaignLifecycle } from "./campaign-lifecycle.js";
import type { AcceptanceCampaignReport, AcceptanceScenarioReport, AxisReportRow } from "./campaign-report.js";
import type { PackagedProvenanceRecord } from "./packaged-provenance.js";
import type { CampaignSpendSnapshot } from "./campaign-spend.js";
import type { ValidationCampaignPolicyBinding } from "../../../src/org/validation-campaign-policy.js";
import { campaignVerdict, type AxisScorePolicy, scenarioCompleteness } from "./verdict-algebra.js";

export const APP_AXES = ["P-1", "P-2", "P-3", "P-4", "P-5", "P-6", "O-1", "O-2", "O-3", "O-4", "O-5", "O-6", "O-7"];
export const JOB_AXES = ["J-1", "J-2", "J-3", "O-4", "O-5", "O-6", "O-7"];

function missingAxis(axis: string): AxisReportRow {
  return {
    axis,
    verdict: "inconclusive",
    score: "ungraded",
    justification: null,
    citations: [],
    ungradedReason: "evidence-missing",
    grader: null,
    mechanical: false,
    appliedDisjointnessFamilies: [],
    appliedReadTurnIds: [],
  };
}

export interface BuildCampaignReportInput {
  config: AcceptanceCampaignConfig;
  validated: ValidatedCampaignConfig;
  provenance: PackagedProvenanceRecord;
  policyBinding: ValidationCampaignPolicyBinding;
  axisScorePolicy: AxisScorePolicy;
  planRows: ReadonlyMap<string, AxisReportRow[]>;
  buildRows: ReadonlyMap<string, AxisReportRow[]>;
  lifecycles: ReadonlyMap<string, CampaignLifecycle>;
  gateDecision?: "continue" | "stop";
  spend: CampaignSpendSnapshot;
}

export function buildCampaignReport(input: BuildCampaignReportInput): AcceptanceCampaignReport {
  const scenarios: AcceptanceScenarioReport[] = input.config.scenarios.map((scenario) => {
    const observed = [...(input.planRows.get(scenario.id) ?? []), ...(input.buildRows.get(scenario.id) ?? [])];
    const byAxis = new Map(observed.map((axis) => [axis.axis, axis]));
    const axes = (scenario.kind === "job" ? JOB_AXES : APP_AXES).map((axis) => byAxis.get(axis) ?? missingAxis(axis));
    const missingGraderRuns =
      input.gateDecision === "continue"
        ? input.buildRows.has(scenario.id)
          ? []
          : [scenario.kind === "job" ? "job-arm" : "build-arm"]
        : [
            input.gateDecision === "stop"
              ? scenario.kind === "job"
                ? "job-arm"
                : "build-arm"
              : "campaign-in-progress",
          ];
    const completeness = scenarioCompleteness({
      results: axes,
      missingGraderRuns,
      ...(input.spend.ceilingExhausted ? { ceilingExhausted: true } : {}),
    });
    return {
      scenarioId: scenario.id,
      scenarioKind: scenario.kind,
      matrix: input.validated.matrices[scenario.id] ?? {},
      axes,
      completeness: completeness.completeness,
      completenessReasons: completeness.reasons,
      planGate: input.lifecycles.get(scenario.id)?.resolution() ?? null,
      supervisorReconciliationClosed: false,
      previewCommand: scenario.previewCommand ?? null,
    };
  });
  return {
    schema_version: 2,
    campaign_id: input.validated.campaignId,
    lane: "L-ACC",
    commit: input.config.commit,
    policy_binding: structuredClone(input.policyBinding),
    provenance: input.provenance,
    scenarios,
    verdict: campaignVerdict(input.axisScorePolicy),
    release_signal: null,
    rq1_relationship: "outside RQ-1; produces no release evidence",
    authorized_scenario_ids: input.validated.scenarioIds,
    spend: input.spend,
    gaps: scenarios.flatMap((scenario) =>
      scenario.axes
        .filter((axis) => axis.score === "ungraded")
        .map((axis) => ({
          scenarioId: scenario.scenarioId,
          axis: axis.axis,
          reason: axis.ungradedReason ?? "unknown",
        })),
    ),
  };
}
