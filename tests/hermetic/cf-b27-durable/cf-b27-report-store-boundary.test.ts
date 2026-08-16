// Traceability: CF-B27 · HB-127 · contracts/B-27-outcome-campaign.md §3.

import { readFile, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import type { AcceptanceCampaignReport } from "../../campaign/acceptance/campaign-report.js";
import {
  campaignReportPath,
  claimCampaignIdentity,
  configHash,
  persistReport,
  readStoredReport,
} from "../../campaign/acceptance/report-store.js";
import { fixtureCampaignPolicyBinding } from "../../fixtures/campaign-policy-binding.js";
import { makeTempStateHome, type TempStateHome } from "../../fixtures/state-home.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => Promise.all(cleanups.splice(0).map((cleanup) => cleanup())));

async function state(name: string): Promise<TempStateHome> {
  const fixture = await makeTempStateHome({ name });
  cleanups.push(fixture.cleanup);
  return fixture;
}

function report(): AcceptanceCampaignReport {
  return {
    schema_version: 2,
    campaign_id: "l-acc-boundary",
    lane: "L-ACC",
    commit: "a".repeat(40),
    policy_binding: fixtureCampaignPolicyBinding(),
    provenance: {
      installedVersion: "1.4.0",
      tarballName: "cormidia-1.4.0.tgz",
      tarballSha256: "c".repeat(64),
      preflightRanAt: "2026-08-08T10:00:00.000Z",
      preflightArgv: ["--replace-source-links"],
      displacedSourceLinks: true,
      restoreCommand: "pnpm link:local",
    },
    scenarios: [],
    verdict: "inconclusive",
    release_signal: null,
    rq1_relationship: "outside RQ-1; produces no release evidence",
    authorized_scenario_ids: [],
    spend: {
      maxOutputTokens: 1,
      maxEquivUsd: 1,
      observedOutputTokens: 0,
      observedEquivUsd: 0,
      debitedUnknownOutputTokens: 0,
      debitedUnknownEquivUsd: 0,
      ceilingExhausted: false,
      reservationRefusals: [],
    },
    gaps: [],
  };
}

describe("CF-B27 report-store trust boundary", () => {
  it("refuses a tampered final status before any resume callback", async () => {
    const fixture = await state("report-runningx");
    const hash = configHash({ campaign: "boundary" });
    await persistReport({ root: fixture.stateHome, configSha256: hash, report: report(), status: "final" });
    const path = campaignReportPath(fixture.stateHome, report().campaign_id);
    const stored: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!isRecord(stored)) throw new Error("fixture report is not an object");
    stored["status"] = "runningx";
    await writeFile(path, JSON.stringify(stored), "utf8");
    let callbacks = 0;
    await expect(
      claimCampaignIdentity({ root: fixture.stateHome, campaignId: report().campaign_id, configSha256: hash }).then(
        () => {
          callbacks += 1;
        },
      ),
    ).rejects.toThrow(/status is invalid/);
    expect(callbacks).toBe(0);
  });

  it("refuses shape-preserving spend and identity lies", async () => {
    const fixture = await state("report-semantic-tamper");
    const hash = configHash({ campaign: "semantic" });
    await persistReport({ root: fixture.stateHome, configSha256: hash, report: report(), status: "running" });
    const path = campaignReportPath(fixture.stateHome, report().campaign_id);
    const original: unknown = JSON.parse(await readFile(path, "utf8"));
    for (const mutate of [
      (nested: Record<string, unknown>) => {
        const spend = nested["spend"];
        if (!isRecord(spend)) throw new Error("fixture spend is absent");
        spend["observedOutputTokens"] = -1;
      },
      (nested: Record<string, unknown>) => {
        const spend = nested["spend"];
        if (!isRecord(spend)) throw new Error("fixture spend is absent");
        spend["ceilingExhausted"] = true;
      },
      (nested: Record<string, unknown>) => {
        nested["authorized_scenario_ids"] = ["duplicate", "duplicate"];
      },
    ]) {
      const candidate = structuredClone(original);
      if (!isRecord(candidate) || !isRecord(candidate["report"])) throw new Error("fixture report is absent");
      mutate(candidate["report"]);
      await writeFile(path, JSON.stringify(candidate), "utf8");
      await expect(readStoredReport(fixture.stateHome, report().campaign_id)).rejects.toThrow();
    }
  });

  it("refuses traversal before any outside report read or write", async () => {
    const fixture = await state("report-traversal");
    expect(() => campaignReportPath(fixture.stateHome, "../outside")).toThrow(/invalid acceptance campaign id/);
    await expect(readStoredReport(fixture.stateHome, "../outside")).rejects.toThrow(/invalid acceptance campaign id/);
  });
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
