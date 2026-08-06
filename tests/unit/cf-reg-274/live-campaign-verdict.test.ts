// CF-REG-274 — live Vitest wrappers could all pass while the durable campaign
// correctly recorded a failing verdict. The persisted terminal report now
// drives the process-level gate result too.

import { describe, expect, it } from "vitest";
import { assertCompletedCampaignPass } from "../../campaign/campaign-runner.js";

function report(
  completeness: "complete" | "incomplete",
  verdict: "pass" | "fail" | "inconclusive",
  violationIds: string[] = [],
) {
  return {
    campaign_id: "cf-reg-274-fixture",
    status: "completed" as const,
    outcome: {
      completeness,
      verdict,
      decision_status: "ratified" as const,
      violation_ids: violationIds,
      reason_codes: verdict === "pass" ? [] : ["seeded_non_pass"],
    },
  };
}

describe("CF-REG-274 — terminal campaign verdict controls test-process success", () => {
  it("accepts only a completed, complete, passing report", () => {
    expect(() => assertCompletedCampaignPass(report("complete", "pass"))).not.toThrow();
  });

  it("negative control: catches a seeded complete report with a violation", () => {
    expect(() => assertCompletedCampaignPass(report("complete", "fail", ["CORMIDIA-INV-002:seeded-bypass"]))).toThrow(
      /verdict=fail.*seeded-bypass/,
    );
  });

  it("fails closed on incomplete or inconclusive terminal evidence", () => {
    expect(() => assertCompletedCampaignPass(report("incomplete", "inconclusive"))).toThrow(
      /completeness=incomplete.*verdict=inconclusive/,
    );
  });
});
