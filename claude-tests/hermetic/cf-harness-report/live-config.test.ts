// HB-050 authorization-envelope self-tests. The live lane must fail closed
// before target or provider construction when the human trigger is absent.

import { afterEach, describe, expect, it } from "vitest";
import { writeFile } from "node:fs/promises";
import { loadLiveCampaignConfig } from "../../live/config.js";
import { makeTempStateHome, type TempStateHome } from "../../fixtures/state-home.js";

let state: TempStateHome | undefined;
afterEach(async () => state?.cleanup());

function config(stateHome: string, policyPath: string) {
  return {
    schema_version: 1,
    campaign_id: "live-release-20260731",
    campaign_kind: "release",
    human_authorization: {
      human_initiated: true,
      authorized_by: "product-owner",
      authorized_at: "2026-07-31T18:00:00.000Z",
      purpose: "release qualification",
    },
    state_home: stateHome,
    policy_path: policyPath,
    commit: "a".repeat(40),
    sandbox: { org: "validation-org", app: "sandbox-alpha", repo: "owner/sandbox-alpha" },
    adapters: [
      { runtime: "claude", model: "claude-model", effort: "medium", max_turn_budget_usd: 2 },
      { runtime: "codex", model: "codex-model", effort: "medium", max_turn_budget_usd: 2 },
      { runtime: "pi", model: "pi-model", effort: "medium", max_turn_budget_usd: 2 },
    ],
    github: { enabled: true, repo: "owner/sandbox-alpha" },
    launchd: { enabled: false, label: "com.operon.validation.unique" },
    unattended: { enabled: true, permitted_auto_grant_categories: ["campaign_budget"] },
  };
}

describe("live campaign config", () => {
  it("refuses absent opt-in and absent reviewed config", async () => {
    await expect(loadLiveCampaignConfig({})).rejects.toThrow(/OPERON_LIVE=1/);
    await expect(loadLiveCampaignConfig({ OPERON_LIVE: "1" })).rejects.toThrow(/OPERON_LIVE_CONFIG/);
  });

  it("loads a strict human-initiated authorization envelope", async () => {
    state = await makeTempStateHome({ name: "live-config" });
    const path = state.path("live.json");
    const policyPath = state.path("policy.yaml");
    await writeFile(policyPath, "schema_version: 1\n", "utf8");
    await writeFile(path, JSON.stringify(config(state.stateHome, policyPath)), "utf8");
    expect((await loadLiveCampaignConfig({ OPERON_LIVE: "1", OPERON_LIVE_CONFIG: path })).config.campaign_id).toBe("live-release-20260731");
  });

  it("negative control: refuses a non-sandbox GitHub target and unknown widening fields", async () => {
    state = await makeTempStateHome({ name: "live-config-negative" });
    const path = state.path("live.json");
    const policyPath = state.path("policy.yaml");
    const seeded = { ...config(state.stateHome, policyPath), github: { enabled: true, repo: "owner/production" }, allow_production: true };
    await writeFile(path, JSON.stringify(seeded), "utf8");
    await expect(loadLiveCampaignConfig({ OPERON_LIVE: "1", OPERON_LIVE_CONFIG: path })).rejects.toThrow(/unknown live config field/);
  });

  it("negative control: a partial release cannot manufacture complete evidence", async () => {
    state = await makeTempStateHome({ name: "live-config-partial-release" });
    const path = state.path("live.json");
    const policyPath = state.path("policy.yaml");
    const seeded = config(state.stateHome, policyPath);
    seeded.adapters = seeded.adapters.slice(0, 1);
    await writeFile(path, JSON.stringify(seeded), "utf8");
    await expect(loadLiveCampaignConfig({ OPERON_LIVE: "1", OPERON_LIVE_CONFIG: path })).rejects.toThrow(/release campaign requires all three adapters/);
  });

  it("admits exact single-obligation GitHub and launchd campaigns", async () => {
    state = await makeTempStateHome({ name: "live-config-single-obligation" });
    const policyPath = state.path("policy.yaml");
    for (const campaignKind of ["github_smoke", "launchd_proof"] as const) {
      const path = state.path(`${campaignKind}.json`);
      const seeded = config(state.stateHome, policyPath);
      seeded.campaign_kind = campaignKind;
      seeded.adapters = [];
      seeded.github.enabled = campaignKind === "github_smoke";
      seeded.launchd.enabled = campaignKind === "launchd_proof";
      seeded.unattended.enabled = false;
      await writeFile(path, JSON.stringify(seeded), "utf8");
      await expect(loadLiveCampaignConfig({ OPERON_LIVE: "1", OPERON_LIVE_CONFIG: path })).resolves.toMatchObject({ config: { campaign_kind: campaignKind } });
    }
  });
});
