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
import type { PlanGateResolution } from "./campaign-lifecycle.js";
import type { AxisScoreValue, UngradedReason } from "./verdict-algebra.js";

export type ReportDefectCode =
  | "matrix-missing"
  | "installed-identity-missing"
  | "commit-pin-missing"
  | "axis-citation-missing"
  | "axis-disjointness-missing"
  | "axis-grader-missing"
  | "completeness-missing"
  | "scenario-dropped"
  | "release-signal-present"
  | "verdict-not-inconclusive";

export class CampaignReportError extends Error {
  constructor(readonly defects: ReportDefect[]) {
    super(`campaign report is malformed: ${defects.map((defect) => `${defect.code}: ${defect.detail}`).join("; ")}`);
    this.name = "CampaignReportError";
  }
}

export interface ReportDefect {
  code: ReportDefectCode;
  detail: string;
}

export interface AxisReportRow {
  axis: string;
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
  /** The exact matrix used, role → tuple. */
  matrix: Record<string, TurnAssignment>;
  axes: AxisReportRow[];
  completeness: "complete" | "incomplete";
  completenessReasons: string[];
  planGate: PlanGateResolution | null;
  /** Present and false when the supervisor reconciliation did not close. */
  supervisorReconciliationClosed: boolean;
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
}

/** Every defect, so a caller sees the whole shape problem at once. */
export function reportDefects(report: AcceptanceCampaignReport): ReportDefect[] {
  const defects: ReportDefect[] = [];
  if (report.commit.trim().length === 0) {
    defects.push({ code: "commit-pin-missing", detail: `${report.campaign_id} records no commit pin` });
  }
  const provenance = report.provenance;
  if (
    provenance === undefined ||
    provenance.installedVersion.trim().length === 0 ||
    provenance.tarballName.trim().length === 0 ||
    provenance.tarballSha256.trim().length === 0
  ) {
    defects.push({
      code: "installed-identity-missing",
      detail: '"which bytes did this campaign exercise" is unanswerable from the report alone',
    });
  }
  if (report.release_signal !== null) {
    defects.push({
      code: "release-signal-present",
      detail: "L-ACC gates nothing (F-PT-029); a report carrying a release signal misrepresents the lane",
    });
  }
  if (report.verdict !== "inconclusive") {
    defects.push({
      code: "verdict-not-inconclusive",
      detail: `verdict is ${report.verdict}; every threshold is unratified, so the campaign is data collection`,
    });
  }

  const present = new Set(report.scenarios.map((scenario) => scenario.scenarioId));
  for (const id of report.authorized_scenario_ids) {
    if (!present.has(id)) {
      defects.push({
        code: "scenario-dropped",
        detail: `scenario ${id} was authorized but is absent from the report; an attempted-then-dropped scenario is a violation`,
      });
    }
  }

  for (const scenario of report.scenarios) {
    if (Object.keys(scenario.matrix).length === 0) {
      defects.push({ code: "matrix-missing", detail: `scenario ${scenario.scenarioId} records no matrix` });
    }
    if (scenario.completeness !== "complete" && scenario.completeness !== "incomplete") {
      defects.push({ code: "completeness-missing", detail: `scenario ${scenario.scenarioId} records no completeness` });
    }
    for (const axis of scenario.axes) {
      const where = `${scenario.scenarioId}/${axis.axis}`;
      if (typeof axis.score === "number" && (axis.justification === null || axis.citations.length === 0)) {
        defects.push({
          code: "axis-citation-missing",
          detail: `${where} carries a score without its evidence citation`,
        });
      }
      if (!axis.mechanical && axis.grader === null && typeof axis.score === "number") {
        defects.push({
          code: "axis-grader-missing",
          detail: `${where} does not say which model produced the score`,
        });
      }
      if (!axis.mechanical && axis.appliedDisjointnessFamilies.length === 0 && axis.appliedReadTurnIds.length > 0) {
        defects.push({
          code: "axis-disjointness-missing",
          detail: `${where} records no applied disjointness set, so its scoping is assumed rather than auditable`,
        });
      }
    }
  }
  return defects;
}

export function assertReportWellFormed(report: AcceptanceCampaignReport): void {
  const defects = reportDefects(report);
  if (defects.length > 0) throw new CampaignReportError(defects);
}
