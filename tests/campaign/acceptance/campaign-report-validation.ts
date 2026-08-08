import type { AcceptanceCampaignReport } from "./campaign-report.js";

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
  | "verdict-not-inconclusive"
  | "axis-verdict-not-inconclusive"
  | "axis-missing"
  | "preview-command-missing"
  | "deployment-command-present"
  | "spend-missing"
  | "spend-ceiling-exceeded"
  | "gap-list-drift";

export interface ReportDefect {
  code: ReportDefectCode;
  detail: string;
}

export class CampaignReportError extends Error {
  constructor(readonly defects: ReportDefect[]) {
    super(`campaign report is malformed: ${defects.map((defect) => `${defect.code}: ${defect.detail}`).join("; ")}`);
    this.name = "CampaignReportError";
  }
}

const requiredAxes = (kind: "app" | "job"): string[] =>
  kind === "job"
    ? ["J-1", "J-2", "J-3", "O-4", "O-5", "O-6", "O-7"]
    : ["P-1", "P-2", "P-3", "P-4", "P-5", "P-6", "O-1", "O-2", "O-3", "O-4", "O-5", "O-6", "O-7"];

/** Every defect, so a caller sees the whole shape problem at once. */
export function reportDefects(report: AcceptanceCampaignReport): ReportDefect[] {
  const defects: ReportDefect[] = [];
  if (report.commit.trim().length === 0)
    defects.push({ code: "commit-pin-missing", detail: `${report.campaign_id} records no commit pin` });
  const provenance = report.provenance;
  if (
    provenance === undefined ||
    [provenance.installedVersion, provenance.tarballName, provenance.tarballSha256].some(
      (value) => value.trim().length === 0,
    )
  ) {
    defects.push({
      code: "installed-identity-missing",
      detail: '"which bytes ran" is unanswerable from the report alone',
    });
  }
  if (report.release_signal !== null)
    defects.push({ code: "release-signal-present", detail: "L-ACC gates nothing (F-PT-029)" });
  if (report.verdict !== "inconclusive")
    defects.push({
      code: "verdict-not-inconclusive",
      detail: `verdict is ${report.verdict}; v0 declares no thresholds`,
    });
  const spend = report.spend;
  if (
    spend === undefined ||
    [spend.maxOutputTokens, spend.maxEquivUsd, spend.observedOutputTokens, spend.observedEquivUsd].some(
      (value) => !Number.isFinite(value),
    )
  ) {
    defects.push({ code: "spend-missing", detail: "campaign spend against both authorized ceilings is absent" });
  } else if (
    spend.observedOutputTokens + spend.debitedUnknownOutputTokens > spend.maxOutputTokens ||
    spend.observedEquivUsd + spend.debitedUnknownEquivUsd > spend.maxEquivUsd
  ) {
    defects.push({ code: "spend-ceiling-exceeded", detail: "recorded campaign exposure exceeds its authorization" });
  }
  const present = new Set(report.scenarios.map((scenario) => scenario.scenarioId));
  for (const id of report.authorized_scenario_ids)
    if (!present.has(id)) defects.push({ code: "scenario-dropped", detail: `${id} is absent` });
  for (const scenario of report.scenarios) {
    const where = (axis: string): string => `${scenario.scenarioId}/${axis}`;
    if (Object.keys(scenario.matrix).length === 0)
      defects.push({ code: "matrix-missing", detail: `${scenario.scenarioId} records no matrix` });
    if (scenario.completeness !== "complete" && scenario.completeness !== "incomplete")
      defects.push({ code: "completeness-missing", detail: `${scenario.scenarioId} records no completeness` });
    if (scenario.previewCommand === null || scenario.previewCommand.trim().length === 0)
      defects.push({ code: "preview-command-missing", detail: `${scenario.scenarioId} records no preview command` });
    else if (/\b(?:deploy|vercel|netlify|flyctl|cloudflare)\b/i.test(scenario.previewCommand))
      defects.push({ code: "deployment-command-present", detail: `${scenario.scenarioId} preview reaches deployment` });
    const presentAxes = new Set(scenario.axes.map((axis) => axis.axis));
    for (const axis of requiredAxes(scenario.scenarioKind))
      if (!presentAxes.has(axis)) defects.push({ code: "axis-missing", detail: `${where(axis)} is absent` });
    for (const axis of scenario.axes) {
      if (axis.verdict !== "inconclusive")
        defects.push({ code: "axis-verdict-not-inconclusive", detail: `${where(axis.axis)} is not inconclusive` });
      if (typeof axis.score === "number" && (axis.justification === null || axis.citations.length === 0))
        defects.push({ code: "axis-citation-missing", detail: `${where(axis.axis)} has a score without evidence` });
      if (!axis.mechanical && axis.grader === null && typeof axis.score === "number")
        defects.push({ code: "axis-grader-missing", detail: `${where(axis.axis)} has no grader` });
      if (!axis.mechanical && axis.appliedDisjointnessFamilies.length === 0 && axis.appliedReadTurnIds.length > 0)
        defects.push({ code: "axis-disjointness-missing", detail: `${where(axis.axis)} records no disjointness set` });
    }
  }
  const expected = report.scenarios
    .flatMap((scenario) =>
      scenario.axes
        .filter((axis) => axis.score === "ungraded")
        .map((axis) => `${scenario.scenarioId}/${axis.axis}/${axis.ungradedReason ?? "unknown"}`),
    )
    .sort();
  const actual = (report.gaps ?? []).map((gap) => `${gap.scenarioId}/${gap.axis}/${gap.reason}`).sort();
  if (JSON.stringify(expected) !== JSON.stringify(actual))
    defects.push({ code: "gap-list-drift", detail: "gap list does not exactly name every ungraded scenario axis" });
  return defects;
}

export function assertReportWellFormed(report: AcceptanceCampaignReport): void {
  const defects = reportDefects(report);
  if (defects.length > 0) throw new CampaignReportError(defects);
}
