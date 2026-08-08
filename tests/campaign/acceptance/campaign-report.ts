// campaign/acceptance/campaign-report.ts — the durable L-ACC report
// (CORMIDIA-C-B27-001 §2, §4).
//
// The report has two answerability obligations, and failing either makes it
// MALFORMED rather than merely thin:
//
//   * "which bytes did this campaign exercise" — answerable from the installed
//     version and tarball identity plus the commit pin, alone;
//   * "which model produced this score" — answerable per axis, from the exact
//     matrix and the per-axis grader tuple, alone.
//
// And one prohibition, F-PT-029 resolved 2026-08-07: **the campaign never
// emits a release signal.** No L-ACC result enters RQ-1 completeness, verdict
// or qualification. A bad result is information the human acts on; it is not a
// mechanical block, and no surface may present it as one. The report therefore
// carries an explicit `release_signal: null` rather than omitting the field —
// an absent field reads as "not implemented yet", a null one reads as a
// decision.

import type { TurnAssignment } from "../../../src/runtime/types.js";
import type { PackagedProvenanceRecord } from "./packaged-provenance.js";
import type { CampaignSpendSnapshot } from "./campaign-spend.js";
import type { PlanGateResolution } from "./campaign-lifecycle.js";
import type { AxisScoreValue, UngradedReason } from "./verdict-algebra.js";

export interface AxisReportRow {
  axis: string;
  /** v0 has no ratified thresholds; every row is data collection. */
  verdict: "inconclusive";
  score: AxisScoreValue;
  /** Mandatory alongside a numeric score. */
  justification: string | null;
  citations: string[];
  ungradedReason: UngradedReason | null;
  /** Which model produced this score. `null` only for mechanical axes. */
  grader: TurnAssignment | null;
  mechanical: boolean;
  /** The disjointness set ACTUALLY applied, and the turns it was computed over. */
  appliedDisjointnessFamilies: string[];
  appliedReadTurnIds: string[];
}

export interface AcceptanceScenarioReport {
  scenarioId: string;
  scenarioKind: "app" | "job";
  /** The exact matrix used, role → tuple. */
  matrix: Record<string, TurnAssignment>;
  axes: AxisReportRow[];
  completeness: "complete" | "incomplete";
  completenessReasons: string[];
  planGate: PlanGateResolution | null;
  /** Present and false when the supervisor reconciliation did not close. */
  supervisorReconciliationClosed: boolean;
  previewCommand: string | null;
}

export interface AcceptanceGap {
  scenarioId: string;
  axis: string;
  reason: string;
}

export interface AcceptanceCampaignReport {
  schema_version: 1;
  campaign_id: string;
  lane: "L-ACC";
  /** The authorized commit pin. */
  commit: string;
  provenance: PackagedProvenanceRecord;
  /** Every scenario that was ATTEMPTED, including the ones that failed. */
  scenarios: AcceptanceScenarioReport[];
  /** Data-collection run: never pass, never fail (rubric §5, B-27 §4). */
  verdict: "inconclusive";
  /** F-PT-029: L-ACC gates nothing. Explicitly null, never omitted. */
  release_signal: null;
  rq1_relationship: "outside RQ-1; produces no release evidence";
  /** Scenarios that were authorized. Used to catch a dropped scenario. */
  authorized_scenario_ids: string[];
  spend: CampaignSpendSnapshot;
  gaps: AcceptanceGap[];
}

export { assertReportWellFormed, CampaignReportError, reportDefects } from "./campaign-report-validation.js";
export type { ReportDefect, ReportDefectCode } from "./campaign-report-validation.js";
