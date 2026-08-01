// CF-HARNESS-REPORT / HB-050 / HB-081 — the durable campaign report enforces
// completeness/verdict semantics and corrupt evidence is visible, never absent.

import { afterEach, describe, expect, it } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  readValidationCampaignReports,
  validateValidationCampaignReport,
  writeValidationCampaignReport,
  type ValidationCampaignReportV1,
} from "../../../src/org/validation-campaign.js";
import { makeTempStateHome, type TempStateHome } from "../../fixtures/state-home.js";

let state: TempStateHome | undefined;
afterEach(async () => state?.cleanup());

function report(): ValidationCampaignReportV1 {
  return {
    schema_version: 1,
    campaign_id: "release-20260731-001",
    lane: "L3",
    campaign_kind: "release",
    trigger: "human_initiated_release_qualification",
    status: "completed",
    started_at: "2026-07-31T18:00:00.000Z",
    finished_at: "2026-07-31T18:05:00.000Z",
    policy: { path: "validation-design/validation-policy.yaml", sha256: "a".repeat(64) },
    target: { commit: "b".repeat(40), apps: ["sandbox-alpha"], scopes: ["all-adapters"], tuples: ["claude/model/medium"] },
    spend: {
      max_provider_turns: 24, max_equiv_usd: 100,
      observed_provider_turns: 1, observed_equiv_usd: 0.5, ceiling_exhausted: false,
    },
    coverage: { required_case_ids: ["CF-B02-L3"], collected_case_ids: ["CF-B02-L3"], missing_case_ids: [] },
    outcome: {
      completeness: "complete", verdict: "pass", decision_status: "ratified",
      violation_ids: [], reason_codes: [],
    },
    evidence_refs: ["runs/live/claude.json"],
  };
}

describe("validation campaign report contract", () => {
  it("round-trips an admissible report atomically", async () => {
    state = await makeTempStateHome({ name: "campaign-report" });
    await writeValidationCampaignReport(state.stateHome, report());
    expect(await readValidationCampaignReports(state.stateHome)).toEqual({ reports: [report()], corrupt: [] });
  });

  it("negative control: rejects a forged incomplete pass", () => {
    const seeded = report();
    seeded.coverage.collected_case_ids = [];
    seeded.coverage.missing_case_ids = ["CF-B02-L3"];
    seeded.outcome.completeness = "incomplete";
    expect(() => validateValidationCampaignReport(seeded)).toThrow(/incomplete campaign.*inconclusive/);
  });

  it("negative control: rejects a lookalike unattended profile and reversed time", () => {
    const profile = report();
    profile.profile = { identity: "operon/unattended-sandbox/lookalike", sandbox_target: "org/app@owner/repo", permitted_auto_grant_categories: ["campaign_budget"], human_decision_rows: 0 };
    expect(() => validateValidationCampaignReport(profile)).toThrow(/ratified unattended profile/);
    const reversed = report();
    reversed.finished_at = "2026-07-31T17:59:00.000Z";
    expect(() => validateValidationCampaignReport(reversed)).toThrow(/cannot precede/);
  });

  it("preserves a proven failure even when coverage is incomplete", () => {
    const seeded = report();
    seeded.coverage.collected_case_ids = [];
    seeded.coverage.missing_case_ids = ["CF-B02-L3"];
    seeded.outcome = {
      completeness: "incomplete", verdict: "fail", decision_status: "ratified",
      violation_ids: ["OPERON-INV-002"], reason_codes: ["guardrail_bypass"],
    };
    expect(() => validateValidationCampaignReport(seeded)).not.toThrow();
  });

  it("negative control: full coverage exactly at the spend ceiling remains incomplete and inconclusive", () => {
    const seeded = report();
    seeded.spend.observed_provider_turns = seeded.spend.max_provider_turns;
    seeded.spend.ceiling_exhausted = true;
    seeded.outcome.completeness = "incomplete";
    seeded.outcome.verdict = "inconclusive";
    seeded.outcome.reason_codes = ["spend_ceiling_exhausted"];
    expect(() => validateValidationCampaignReport(seeded)).not.toThrow();
    seeded.outcome.completeness = "complete";
    seeded.outcome.verdict = "pass";
    expect(() => validateValidationCampaignReport(seeded)).toThrow(/ceiling exhaustion requires incomplete/);
  });

  it("surfaces a corrupt report as corrupt evidence", async () => {
    state = await makeTempStateHome({ name: "campaign-corrupt" });
    const dir = join(state.stateHome, "validation", "campaigns", "broken");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "report.json"), "{not-json", "utf8");
    const result = await readValidationCampaignReports(state.stateHome);
    expect(result.reports).toEqual([]);
    expect(result.corrupt).toEqual([expect.objectContaining({ campaign_id: "broken" })]);
  });
});
