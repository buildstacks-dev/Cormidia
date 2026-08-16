// Traceability: CF-HARNESS-REPORT · HB-050; CF-REG-291 · HB-052 · validation-policy.yaml harness_self_tests; case-catalog.md §10.3.

// HB-050 — live/eval/ops campaign runner self-tests, including interruption
// recovery and spend-refusal negative controls.

import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { assertCompletedCampaignPass, DurableCampaignRunner } from "../../campaign/campaign-runner.js";
import { readValidationCampaignReports } from "../../../src/org/validation-campaign.js";
import type { ValidationCampaignPolicyBinding } from "../../../src/org/validation-campaign-policy.js";
import { makeTempStateHome, type TempStateHome } from "../../fixtures/state-home.js";
import { assertCampaignPolicyBindingBytes } from "../../campaign/policy-binding.js";

let state: TempStateHome | undefined;
afterEach(async () => state?.cleanup());

async function runner(
  requiredCaseIds = ["CASE-1", "CASE-2"],
  decisionStatus: "ratified" | "proposed" = "ratified",
  extraRevalidation?: () => Promise<void>,
  sharedState?: TempStateHome,
) {
  const fixture = sharedState ?? (await makeTempStateHome({ name: "campaign-runner" }));
  state = fixture;
  const policyPath = fixture.path("docs/qualification/host-policy.yaml");
  const authorityPath = fixture.path("validation-design/validation-policy.yaml");
  await mkdir(dirname(policyPath), { recursive: true });
  await mkdir(dirname(authorityPath), { recursive: true });
  await writeFile(policyPath, "schema: cormidia/qualification-host-policy/v1\n", "utf8");
  await writeFile(authorityPath, "schema_version: 1\n", "utf8");
  const times = [new Date("2026-07-31T18:00:00.000Z"), new Date("2026-07-31T18:05:00.000Z")];
  const policyBinding: ValidationCampaignPolicyBinding = {
    path: "docs/qualification/host-policy.yaml",
    sha256: digest("schema: cormidia/qualification-host-policy/v1\n"),
    validation_authority: {
      kind: "legacy",
      sources: [{ path: "validation-design/validation-policy.yaml", sha256: digest("schema_version: 1\n") }],
    },
  };
  return new DurableCampaignRunner({
    stateHome: fixture.stateHome,
    campaignId: "campaign-runner-test",
    lane: "L3",
    campaignKind: "release",
    trigger: "human_initiated_test",
    policyBinding,
    revalidateAdmission: async () => {
      await assertCampaignPolicyBindingBytes(policyBinding, fixture.stateHome);
      await extraRevalidation?.();
    },
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

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

describe("durable campaign runner", () => {
  it("atomically admits only one runner for a shared campaign id", async () => {
    const shared = await makeTempStateHome({ name: "campaign-runner-race" });
    const left = await runner(["CASE-1"], "ratified", undefined, shared);
    const right = await runner(["CASE-1"], "ratified", undefined, shared);
    const starts = await Promise.allSettled([left.start(), right.start()]);
    expect(starts.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(starts.filter((result) => result.status === "rejected")).toHaveLength(1);
    const winner = starts[0]?.status === "fulfilled" ? left : right;
    let callbacks = 0;
    await winner.runCase("CASE-1", { providerTurns: 1, maxEquivUsd: 1 }, async () => {
      callbacks += 1;
      return { providerTurns: 1, equivUsd: 1, evidenceRefs: ["winner"] };
    });
    expect(callbacks).toBe(1);
  });

  it("refuses a completed campaign id before any repeated callback", async () => {
    const shared = await makeTempStateHome({ name: "campaign-runner-completed" });
    const first = await runner(["CASE-1"], "ratified", undefined, shared);
    await first.start();
    await first.runCase("CASE-1", { providerTurns: 1, maxEquivUsd: 1 }, async () => ({
      providerTurns: 1,
      equivUsd: 1,
      evidenceRefs: ["first"],
    }));
    await first.finish();
    const repeat = await runner(["CASE-1"], "ratified", undefined, shared);
    let callbacks = 0;
    await expect(repeat.start()).rejects.toThrow(/already has durable state/);
    expect(callbacks).toBe(0);
  });

  it("negative control: refuses authority-byte drift before the first durable write", async () => {
    const campaign = await runner(["CASE-1"]);
    const activeState = state;
    if (activeState === undefined) throw new Error("test fixture did not create state");
    await writeFile(activeState.path("validation-design/validation-policy.yaml"), "changed: true\n", "utf8");
    await expect(campaign.start()).rejects.toThrow(/policy binding changed after authorization/);
    expect((await readValidationCampaignReports(activeState.stateHome)).reports).toEqual([]);
  });

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
    const activeState = state;
    if (activeState === undefined) throw new Error("test fixture did not create state");
    const durable = await readValidationCampaignReports(activeState.stateHome);
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

  it("negative control: repository drift between cases refuses before the next callback", async () => {
    let dirty = false;
    const campaign = await runner(["CASE-1", "CASE-2"], "ratified", async () => {
      if (dirty) throw new Error("campaign refused: product paths differ from the authorized commit: src/dirty.ts");
    });
    await campaign.start();
    await campaign.runCase("CASE-1", { providerTurns: 1, maxEquivUsd: 1 }, async () => ({
      providerTurns: 0,
      equivUsd: 0,
      evidenceRefs: [],
    }));
    dirty = true;
    const execute = vi.fn(async () => ({ providerTurns: 0, equivUsd: 0, evidenceRefs: [] }));
    await expect(campaign.runCase("CASE-2", { providerTurns: 1, maxEquivUsd: 1 }, execute)).rejects.toThrow(
      /product paths differ.*src\/dirty.ts/,
    );
    expect(execute).not.toHaveBeenCalled();
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
