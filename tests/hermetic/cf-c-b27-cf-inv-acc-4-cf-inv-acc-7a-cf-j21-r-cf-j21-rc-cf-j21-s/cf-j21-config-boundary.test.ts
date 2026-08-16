// Traceability: CF-J21-R · HB-127 · journey-acceptance.md J-21 refusal criterion.

import { writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { stringify } from "yaml";
import { readCampaignFile } from "../../campaign/acceptance/campaign-cli.js";
import { makeTempStateHome, type TempStateHome } from "../../fixtures/state-home.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => Promise.all(cleanups.splice(0).map((cleanup) => cleanup())));

async function fixture(): Promise<TempStateHome> {
  const state = await makeTempStateHome({ name: "l-acc-config-boundary" });
  cleanups.push(state.cleanup);
  return state;
}

function campaign(): Record<string, unknown> {
  return {
    campaignId: "l-acc-boundary",
    commit: "a".repeat(40),
    policyPath: "/repo/docs/qualification/host-policy.yaml",
    campaignOrg: "cormidia-sandbox",
    scenarios: [
      {
        id: "S-ACC-1",
        kind: "app",
        setup: "bootstrap",
        appSlug: "cormidia-sandbox/example",
        worktree: "/sandbox/example",
        matrix: {
          planner: { harness: "claude", model: "claude-opus-4-8", effort: "xhigh" },
          builder: { harness: "claude", model: "claude-sonnet-5", effort: "xhigh" },
          reviewer: { harness: "codex", model: "gpt-5.6-sol", effort: "xhigh" },
        },
      },
    ],
    adaptiveAssignments: [],
    graderPlan: [],
    envelope: { maxOutputTokens: 1, maxEquivUsd: 1, authorization: "fixture" },
    planGate: { kind: "auto-continue", criteria: "rubric-6-attempted-on-P-1-and-P-5" },
  };
}

async function refuse(mutator: (value: Record<string, unknown>) => void): Promise<number> {
  const state = await fixture();
  const value = campaign();
  mutator(value);
  const path = state.path("campaign.yaml");
  await writeFile(path, stringify({ schema_version: 1, campaign: value }), "utf8");
  let callbacks = 0;
  await expect(readCampaignFile(path).then(() => (callbacks += 1))).rejects.toThrow(/campaign refused/);
  return callbacks;
}

describe("L-ACC campaign-file trust boundary", () => {
  it("refuses an unknown scenario kind before any arm callback", async () => {
    expect(
      await refuse((value) => {
        const scenarios = value["scenarios"];
        if (!Array.isArray(scenarios) || !isRecord(scenarios[0])) throw new Error("invalid fixture");
        scenarios[0]["kind"] = "appx";
      }),
    ).toBe(0);
  });

  it("refuses invalid setup, plan-gate, and unknown fields", async () => {
    expect(
      await refuse((value) => {
        const scenarios = value["scenarios"];
        if (!Array.isArray(scenarios) || !isRecord(scenarios[0])) throw new Error("invalid fixture");
        scenarios[0]["setup"] = "adopt-existing";
      }),
    ).toBe(0);
    expect(await refuse((value) => (value["planGate"] = { kind: "auto-continue", criteria: "anything" }))).toBe(0);
    expect(await refuse((value) => (value["unknownAuthority"] = true))).toBe(0);
  });
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
