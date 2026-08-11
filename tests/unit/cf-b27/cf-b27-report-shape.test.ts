// CF-B27 — HB-127 — contracts/B-27-acceptance-campaign.md §2 and §4.

// CF-B27-* (L1) — the durable report's shape (CORMIDIA-C-B27-001 §2, §4).
//
// A report that cannot answer "which bytes did this exercise" or "which model
// produced this score" is MALFORMED, not merely thin — that distinction is the
// whole clause, because a thin report invites a reader to fill the gap.

import { describe, expect, it } from "vitest";
import type { TurnAssignment } from "../../../src/runtime/types.js";
import {
  assertReportWellFormed,
  CampaignReportError,
  reportDefects,
  type AcceptanceCampaignReport,
  type AcceptanceScenarioReport,
  type AxisReportRow,
  type ReportDefectCode,
} from "../../campaign/acceptance/campaign-report.js";

const codexSol: TurnAssignment = { harness: "codex", model: "gpt-5.6-sol", effort: "xhigh" };
const claudeSonnet: TurnAssignment = { harness: "claude", model: "claude-sonnet-5", effort: "xhigh" };
const APP_AXES = ["P-1", "P-2", "P-3", "P-4", "P-5", "P-6", "O-1", "O-2", "O-3", "O-4", "O-5", "O-6", "O-7"];

function axis(overrides: Partial<AxisReportRow> = {}): AxisReportRow {
  return {
    axis: "O-1",
    verdict: "inconclusive",
    score: 3,
    justification: "the app builds and starts from a clean clone",
    citations: ["clean-clone-build.log"],
    ungradedReason: null,
    grader: codexSol,
    mechanical: false,
    appliedDisjointnessFamilies: ["anthropic"],
    appliedReadTurnIds: ["build"],
    ...overrides,
  };
}

function report(overrides: Partial<AcceptanceCampaignReport> = {}): AcceptanceCampaignReport {
  return {
    schema_version: 1,
    campaign_id: "l-acc-run-1",
    lane: "L-ACC",
    commit: "a".repeat(40),
    provenance: {
      installedVersion: "1.4.0",
      tarballName: "cormidia-1.4.0.tgz",
      tarballSha256: "c".repeat(64),
      preflightRanAt: "2026-08-08T10:00:00.000Z",
      preflightArgv: ["--replace-source-links"],
      displacedSourceLinks: true,
      restoreCommand: "pnpm link:local",
    },
    scenarios: [
      {
        scenarioId: "S-ACC-1",
        scenarioKind: "app",
        matrix: { builder: claudeSonnet, reviewer: codexSol },
        axes: APP_AXES.map((axisId) => axis({ axis: axisId })),
        completeness: "complete",
        completenessReasons: [],
        planGate: null,
        supervisorReconciliationClosed: true,
        previewCommand: "pnpm dev",
      },
    ],
    verdict: "inconclusive",
    release_signal: null,
    rq1_relationship: "outside RQ-1; produces no release evidence",
    authorized_scenario_ids: ["S-ACC-1"],
    spend: {
      maxOutputTokens: 4_000_000,
      maxEquivUsd: 520,
      observedOutputTokens: 0,
      observedEquivUsd: 0,
      debitedUnknownOutputTokens: 0,
      debitedUnknownEquivUsd: 0,
      ceilingExhausted: false,
      reservationRefusals: [],
    },
    gaps: [],
    ...overrides,
  };
}

function defectCodes(overrides: Partial<AcceptanceCampaignReport>): ReportDefectCode[] {
  return reportDefects(report(overrides)).map((defect) => defect.code);
}

/** The one scenario in the baseline report, as a non-optional value. */
function baseScenario(): AcceptanceScenarioReport {
  const scenario = report().scenarios[0];
  if (scenario === undefined) throw new Error("the baseline report has no scenario");
  return scenario;
}

describe("CF-B27-* (L1) a well-formed report answers both questions", () => {
  it("accepts a report carrying matrix, installed identity, citations and disjointness", () => {
    expect(() => assertReportWellFormed(report())).not.toThrow();
    expect(reportDefects(report())).toEqual([]);
  });

  it("records the displaced dev loop and how to restore it", () => {
    expect(report().provenance.displacedSourceLinks).toBe(true);
    expect(report().provenance.restoreCommand).toBe("pnpm link:local");
  });
});

describe("CF-B27-* (L1) malformed, not thin", () => {
  it("negative control: a report with no installed identity cannot say which bytes ran", () => {
    expect(
      defectCodes({
        provenance: { ...report().provenance, installedVersion: "", tarballName: "", tarballSha256: "" },
      }),
    ).toContain("installed-identity-missing");
  });

  it("negative control: a report with no commit pin", () => {
    expect(defectCodes({ commit: "" })).toContain("commit-pin-missing");
  });

  it("negative control: a scenario with no matrix", () => {
    const base = baseScenario();
    expect(defectCodes({ scenarios: [{ ...base, matrix: {} }] })).toContain("matrix-missing");
  });

  it("negative control: a scored axis with no citation", () => {
    const base = baseScenario();
    expect(
      defectCodes({
        scenarios: [{ ...base, axes: [axis({ justification: null, citations: [] })] }],
      }),
    ).toContain("axis-citation-missing");
  });

  it("negative control: a scored axis that does not say which model produced it", () => {
    const base = baseScenario();
    expect(defectCodes({ scenarios: [{ ...base, axes: [axis({ grader: null })] }] })).toContain("axis-grader-missing");
  });

  it("negative control: a model-graded axis with no recorded disjointness set", () => {
    const base = baseScenario();
    expect(defectCodes({ scenarios: [{ ...base, axes: [axis({ appliedDisjointnessFamilies: [] })] }] })).toContain(
      "axis-disjointness-missing",
    );
  });

  it("lets a mechanical axis carry no grader and no disjointness set", () => {
    const base = baseScenario();
    expect(
      defectCodes({
        scenarios: [
          {
            ...base,
            axes: APP_AXES.map((axisId) =>
              axisId === "O-1"
                ? axis({
                    axis: axisId,
                    mechanical: true,
                    grader: null,
                    appliedDisjointnessFamilies: [],
                    appliedReadTurnIds: [],
                  })
                : axis({ axis: axisId }),
            ),
          },
        ],
      }),
    ).toEqual([]);
  });

  it("negative control: an authorized scenario dropped from the report", () => {
    expect(defectCodes({ authorized_scenario_ids: ["S-ACC-1", "S-ACC-2"] })).toContain("scenario-dropped");
  });
});

describe("CF-B27-* (L1) the lane gates nothing (F-PT-029)", () => {
  it("negative control: a report carrying a release signal is malformed", () => {
    const defects = defectCodes({ release_signal: "pass" as unknown as null });
    expect(defects).toContain("release-signal-present");
  });

  it("negative control: a pass/fail campaign verdict while every threshold is unratified", () => {
    for (const verdict of ["pass", "fail"] as const) {
      expect(defectCodes({ verdict: verdict as unknown as "inconclusive" })).toContain("verdict-not-inconclusive");
    }
  });

  it("reports every defect at once rather than stopping at the first", () => {
    const error = (() => {
      try {
        assertReportWellFormed(report({ commit: "", release_signal: "pass" as unknown as null }));
      } catch (caught) {
        return caught as CampaignReportError;
      }
      throw new Error("expected a CampaignReportError");
    })();
    expect(error.defects.map((defect) => defect.code).sort()).toEqual(["commit-pin-missing", "release-signal-present"]);
  });
});
