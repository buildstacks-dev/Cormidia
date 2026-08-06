// HB-081 — every product surface that renders campaign verdicts distinguishes
// inconclusive from pass and refuses release-evidence language.

import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppsFile } from "../../../src/org/apps.js";
import { writeValidationCampaignReport, type ValidationCampaignReportV1 } from "../../../src/org/validation-campaign.js";
import { buildReport } from "../../../src/report/project.js";
import { renderReportHtml } from "../../../src/report/render-html.js";
import { renderReportTerminal } from "../../../src/report/render-terminal.js";
import { indexLocalSources } from "../../../src/observe/file-index.js";
import { projectObserveSnapshot } from "../../../src/observe/project.js";
import { OBSERVE_JS } from "../../../src/observe/assets.js";
import { cmdStatus } from "../../../src/cli/status.js";
import { makeTempStateHome, type TempStateHome } from "../../fixtures/state-home.js";

let state: TempStateHome | undefined;
afterEach(async () => {
  vi.restoreAllMocks();
  await state?.cleanup();
});

const apps: AppsFile = {
  org: { name: "validation-org", maxConcurrentTurns: 2 },
  defaults: { budgetUsdMonth: 100, objectiveBudgetUsd: 1000 },
  apps: [{ name: "sandbox-alpha", repo: "owner/sandbox-alpha", status: "live", budgetUsdMonth: 100, objectiveBudgetUsd: 1000, cadence: {} }],
};

function inconclusive(): ValidationCampaignReportV1 {
  return {
    schema_version: 1,
    campaign_id: "eval-20260731-001",
    lane: "L4",
    campaign_kind: "reviewer-eval",
    trigger: "prompt_change",
    status: "completed",
    started_at: "2026-07-31T18:00:00.000Z",
    finished_at: "2026-07-31T18:02:00.000Z",
    policy: { path: "validation-design/validation-policy.yaml", sha256: "a".repeat(64) },
    target: { commit: "b".repeat(40), apps: ["sandbox-alpha"], scopes: ["S-3"], tuples: ["reviewer/claude/model"] },
    spend: { max_provider_turns: 24, max_equiv_usd: 100, observed_provider_turns: 1, observed_equiv_usd: 0.5, ceiling_exhausted: false },
    coverage: { required_case_ids: ["GS-REV-001"], collected_case_ids: ["GS-REV-001"], missing_case_ids: [] },
    outcome: { completeness: "complete", verdict: "inconclusive", decision_status: "proposed", violation_ids: [], reason_codes: ["F-PT-009-open"] },
    evidence_refs: ["validation/eval/GS-REV-001.json"],
  };
}

describe("campaign verdict presentation", () => {
  it("renders inconclusive as NOT A PASS in Reports, Observe, and status", async () => {
    state = await makeTempStateHome({ name: "campaign-surfaces" });
    await writeValidationCampaignReport(state.stateHome, inconclusive());

    const report = await buildReport({
      orgName: apps.org.name,
      stateHome: state.stateHome,
      appsFile: apps,
      query: { period: "30d" },
      now: new Date("2026-08-01T00:00:00.000Z"),
    });
    expect(report.validation_campaigns.reports).toHaveLength(1);
    expect(renderReportTerminal(report)).toContain("INCONCLUSIVE (NOT A PASS; NOT RELEASE EVIDENCE)");
    expect(renderReportHtml(report)).toContain("INCONCLUSIVE — NOT A PASS; NOT RELEASE EVIDENCE");
    expect(renderReportTerminal(report)).toContain("docs/qualification/validation-triage.md");
    expect(renderReportHtml(report)).toContain("docs/qualification/validation-triage.md");

    const local = await indexLocalSources({
      orgName: apps.org.name,
      stateHome: state.stateHome,
      appsFile: apps,
      filters: {},
      now: new Date("2026-08-01T00:00:00.000Z"),
    });
    const snapshot = projectObserveSnapshot({ ...local, cursor: "0", github: [] });
    expect(snapshot.validation_campaigns.reports[0]?.outcome.verdict).toBe("inconclusive");
    expect(OBSERVE_JS).toContain("INCONCLUSIVE — NOT A PASS; NOT RELEASE EVIDENCE");
    expect(OBSERVE_JS).toContain("docs/qualification/validation-triage.md");

    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((value?: unknown) => lines.push(String(value ?? "")));
    expect(await cmdStatus(["--state-home", state.stateHome])).toBe(0);
    expect(lines.join("\n")).toContain("INCONCLUSIVE (NOT A PASS; NOT RELEASE EVIDENCE)");
    expect(lines.join("\n")).toContain("docs/qualification/validation-triage.md");
  });
});
