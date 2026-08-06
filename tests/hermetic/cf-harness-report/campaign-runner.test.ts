// HB-050 — live/eval/ops campaign runner self-tests, including interruption
// recovery and spend-refusal negative controls.

import { afterEach, describe, expect, it, vi } from "vitest";
import { writeFile } from "node:fs/promises";
import { assertCompletedCampaignPass, DurableCampaignRunner } from "../../campaign/campaign-runner.js";
import { readValidationCampaignReports } from "../../../src/org/validation-campaign.js";
import { makeTempStateHome, type TempStateHome } from "../../fixtures/state-home.js";

let state: TempStateHome | undefined;
afterEach(async () => state?.cleanup());

async function runner(requiredCaseIds = ["CASE-1", "CASE-2"], decisionStatus: "ratified" | "proposed" = "ratified") {
  state = await makeTempStateHome({ name: "campaign-runner" });
  const policyPath = state.path("policy.yaml");
  await writeFile(policyPath, "schema_version: 1\n", "utf8");
  const times = [new Date("2026-07-31T18:00:00.000Z"), new Date("2026-07-31T18:05:00.000Z")];
  return new DurableCampaignRunner({
    stateHome: state.stateHome,
    campaignId: "campaign-runner-test",
    lane: "L3",
    campaignKind: "release",
    trigger: "human_initiated_test",
    policyPath,
    commit: "b".repeat(40),
    apps: ["sandbox-alpha"],
    scopes: ["adapter"],
    tuples: ["claude/model/medium"],
    requiredCaseIds,
    maxProviderTurns: 2,
    maxEquivUsd: 5,
    decisionStatus,
    clock: () => times.shift() ?? new Date("2026-07-31T18:05:00.000Z"),
  });
}

describe("durable campaign runner", () => {
  it("persists partial evidence before and after an interrupted case", async () => {
    const campaign = await runner();
    await campaign.start();
    await campaign.runCase("CASE-1", { providerTurns: 1, maxEquivUsd: 1 }, async () => ({
      providerTurns: 1,
      equivUsd: 0.25,
      evidenceRefs: ["evidence/case-1.json"],
    }));
    await expect(
      campaign.runCase("CASE-2", { providerTurns: 1, maxEquivUsd: 1 }, async () => {
        throw new Error("transport interrupted");
      }),
    ).rejects.toThrow(/transport interrupted/);
    const durable = await readValidationCampaignReports(state!.stateHome);
    expect(durable.reports[0]).toMatchObject({
      status: "running",
      spend: {
        observed_provider_turns: 2,
        observed_equiv_usd: 1.25,
        ceiling_exhausted: true,
      },
      coverage: { collected_case_ids: ["CASE-1"], missing_case_ids: ["CASE-2"] },
      outcome: {
        completeness: "incomplete",
        verdict: "inconclusive",
        reason_codes: [
          "case_execution_error:CASE-2",
          "spend_reservation_debited_on_error:CASE-2",
          "spend_ceiling_exhausted",
        ],
      },
    });
    expect(durable.reports[0]?.evidence_refs.join(" ")).not.toContain("transport interrupted");
  });

  it("negative control: refuses a case before callback invocation when its reservation cannot fit", async () => {
    const campaign = await runner(["CASE-1"]);
    await campaign.start();
    const execute = vi.fn(async () => ({ providerTurns: 1, equivUsd: 1, evidenceRefs: [] }));
    expect(await campaign.runCase("CASE-1", { providerTurns: 3, maxEquivUsd: 1 }, execute)).toBeUndefined();
    expect(execute).not.toHaveBeenCalled();
    const report = await campaign.finish();
    expect(report.outcome).toMatchObject({ completeness: "incomplete", verdict: "inconclusive" });
    expect(report.outcome.reason_codes).toContain("spend_reservation_refused");
  });

  it("keeps a full proposed-threshold campaign inconclusive", async () => {
    const campaign = await runner(["CASE-1"], "proposed");
    await campaign.start();
    await campaign.runCase("CASE-1", { providerTurns: 1, maxEquivUsd: 1 }, async () => ({
      providerTurns: 1,
      equivUsd: 0.1,
      evidenceRefs: ["evidence/case-1.json"],
    }));
    expect(await campaign.finish()).toMatchObject({
      status: "completed",
      outcome: { completeness: "complete", verdict: "inconclusive", decision_status: "proposed" },
    });
  });

  it("reports a proven violation as fail even with missing cases", async () => {
    const campaign = await runner();
    await campaign.start();
    await campaign.runCase("CASE-1", { providerTurns: 1, maxEquivUsd: 1 }, async () => ({
      providerTurns: 1,
      equivUsd: 0.1,
      violationIds: ["CORMIDIA-INV-002"],
      evidenceRefs: ["evidence/denial.json"],
    }));
    expect(await campaign.finish()).toMatchObject({
      outcome: { completeness: "incomplete", verdict: "fail", violation_ids: ["CORMIDIA-INV-002"] },
    });
  });

  it("keeps exact-ceiling full coverage incomplete rather than manufacturing green", async () => {
    const campaign = await runner(["CASE-1"]);
    await campaign.start();
    await campaign.runCase("CASE-1", { providerTurns: 2, maxEquivUsd: 1 }, async () => ({
      providerTurns: 2,
      equivUsd: 0.5,
      evidenceRefs: ["evidence/case-1.json"],
    }));
    expect(await campaign.finish()).toMatchObject({
      spend: { ceiling_exhausted: true },
      outcome: { completeness: "incomplete", verdict: "inconclusive" },
    });
  });

  it("negative control: a known observation gap preserves evidence, stays uncollected, and cannot become green", async () => {
    const campaign = await runner(["OBSERVATION-GAP", "INDEPENDENT-CASE"]);
    await campaign.start();
    await campaign.runCase("OBSERVATION-GAP", { providerTurns: 0, maxEquivUsd: 0 }, async () => ({
      caseComplete: false,
      providerTurns: 0,
      equivUsd: 0,
      reasonCodes: ["github_clause_inconclusive:B01-CF-02"],
      evidenceRefs: ["github:sandbox:clause:B01-CF-02:observation_inconclusive"],
    }));
    await campaign.runCase("INDEPENDENT-CASE", { providerTurns: 1, maxEquivUsd: 1 }, async () => ({
      providerTurns: 1,
      equivUsd: 0.1,
      evidenceRefs: ["evidence/independent-case.json"],
    }));

    const report = await campaign.finish();
    expect(report.coverage).toEqual({
      required_case_ids: ["OBSERVATION-GAP", "INDEPENDENT-CASE"],
      collected_case_ids: ["INDEPENDENT-CASE"],
      missing_case_ids: ["OBSERVATION-GAP"],
    });
    expect(report.outcome).toMatchObject({
      completeness: "incomplete",
      verdict: "inconclusive",
      violation_ids: [],
      reason_codes: ["case_incomplete:OBSERVATION-GAP", "github_clause_inconclusive:B01-CF-02"],
    });
    expect(() => assertCompletedCampaignPass(report)).toThrow(/completeness=incomplete.*verdict=inconclusive/);
  });
});
