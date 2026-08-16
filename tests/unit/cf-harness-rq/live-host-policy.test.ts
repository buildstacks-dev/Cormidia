// Traceability: CF-HARNESS-RQ · HB-113 · #465 Cormidia host-policy composition.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RELEASE_L3_REQUIRED_CASES } from "../../../src/org/release-evidence.js";
import {
  QUALIFICATION_HOST_POLICY_PATH,
  parseQualificationHostPolicy,
} from "../../../src/org/qualification-host-policy.js";
import { liveCampaignRequiredCaseIds, liveCampaignSpend } from "../../live/host-policy.js";

describe("live campaign host policy", () => {
  it("derives exact RQ-1 cases and spend while refusing drift below compiled safety floors", async () => {
    const host = parseQualificationHostPolicy(
      await readFile(join(process.cwd(), QUALIFICATION_HOST_POLICY_PATH), "utf8"),
    );
    const release: Parameters<typeof liveCampaignRequiredCaseIds>[0] = {
      campaign_kind: "release",
      adapters: [],
      github: { enabled: false },
      launchd: { enabled: false },
      unattended: { enabled: false },
    };
    expect(liveCampaignRequiredCaseIds(release, host)).toEqual(RELEASE_L3_REQUIRED_CASES);
    expect(liveCampaignSpend(release, host)).toEqual({ turns: 24, usd: 100 });
    expect(liveCampaignSpend({ campaign_kind: "github_smoke" }, host)).toEqual({ turns: 2, usd: 5 });
    expect(liveCampaignSpend({ campaign_kind: "launchd_proof" }, host)).toEqual({ turns: 2, usd: 5 });

    const driftedCases = structuredClone(host);
    driftedCases.release_qualification.required_l3_case_ids.reverse();
    expect(() => liveCampaignRequiredCaseIds(release, driftedCases)).toThrow(/compiled RQ-1 case floor/);
    const driftedSpend = structuredClone(host);
    driftedSpend.release_qualification.campaign_spend.release.max_provider_turns = 25;
    expect(() => liveCampaignSpend(release, driftedSpend)).toThrow(/compiled campaign-spend floor/);
    const driftedStandalone = structuredClone(host);
    driftedStandalone.release_qualification.campaign_spend.github_smoke.max_provider_turns = 24;
    expect(() => liveCampaignSpend({ campaign_kind: "github_smoke" }, driftedStandalone)).toThrow(
      /compiled campaign-spend floor/,
    );
  });
});
