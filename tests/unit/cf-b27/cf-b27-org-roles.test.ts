// CF-B27 — HB-127 — contracts/B-27-acceptance-campaign.md §1–§2.

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import { afterEach, describe, expect, it } from "vitest";
import type { AcceptanceCampaignConfig, ScenarioConfig } from "../../campaign/acceptance/campaign-config.js";
import {
  activateAcceptanceGrader,
  activateScenarioRoleMatrix,
  prepareCampaignOrgRoles,
} from "../../campaign/acceptance/campaign-org-roles.js";

const homes: string[] = [];
afterEach(async () => Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true }))));

const s1: ScenarioConfig = {
  id: "S-ACC-1",
  kind: "app",
  appSlug: "cormidia/s1",
  worktree: "/tmp/s1",
  matrix: {
    planner: { harness: "claude", model: "claude-opus-4-8", effort: "xhigh" },
    builder: { harness: "claude", model: "claude-sonnet-5", effort: "xhigh" },
    reviewer: { harness: "codex", model: "gpt-5.6-sol", effort: "xhigh" },
  },
};
const s2: ScenarioConfig = {
  id: "S-ACC-2",
  kind: "app",
  appSlug: "cormidia/s2",
  worktree: "/tmp/s2",
  matrix: {
    planner: { harness: "codex", model: "gpt-5.6-sol", effort: "xhigh" },
    builder: { harness: "codex", model: "gpt-5.6-luna", effort: "xhigh" },
    reviewer: { harness: "claude", model: "claude-opus-4-8", effort: "xhigh" },
  },
};

async function home(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "l-acc-roles-"));
  homes.push(path);
  await writeFile(
    join(path, "roles.yaml"),
    "defaults: {}\nroles:\n  planner: {}\n  builder: {}\n  reviewer: {}\n",
    "utf8",
  );
  return path;
}

function config(): AcceptanceCampaignConfig {
  const grader = { harness: "codex", model: "gpt-5.6-sol", effort: "xhigh" } as const;
  return {
    campaignId: "l-acc-run-1",
    commit: "a".repeat(40),
    policyPath: "/policy",
    campaignOrg: "cormidia",
    scenarios: [s1, s2],
    adaptiveAssignments: [],
    graderPlan: [{ axis: "P-5", grader, readTurnIds: ["plan"] }],
    envelope: { maxOutputTokens: 4_000_000, maxEquivUsd: 520, authorization: "exact" },
    planGate: { kind: "auto-continue", criteria: "rubric-6-attempted-on-P-1-and-P-5" },
  };
}

describe("CF-B27-ROLES — exact per-scenario assignment activation", () => {
  it("installs the isolated grader and swaps the fixed role tuples before each arm", async () => {
    const path = await home();
    await prepareCampaignOrgRoles(path, config());
    await activateScenarioRoleMatrix(path, s2);
    const roles = (
      parse(await readFile(join(path, "roles.yaml"), "utf8")) as { roles: Record<string, Record<string, unknown>> }
    ).roles;
    expect(roles["planner"]).toMatchObject({ runtime: "codex", model: "gpt-5.6-sol", effort: "xhigh" });
    expect(roles["builder"]).toMatchObject({ runtime: "codex", model: "gpt-5.6-luna", effort: "xhigh" });
    expect(roles["reviewer"]).toMatchObject({ runtime: "claude", model: "claude-opus-4-8", effort: "xhigh" });
    expect(roles["acceptance-grader"]).toMatchObject({ runtime: "codex", model: "gpt-5.6-sol", effort: "xhigh" });
  });

  it("activates the exact opposite-family grader for a mirror scenario", async () => {
    const path = await home();
    await prepareCampaignOrgRoles(path, config());
    await activateAcceptanceGrader(path, s1.matrix.planner!);
    const roles = (
      parse(await readFile(join(path, "roles.yaml"), "utf8")) as { roles: Record<string, Record<string, unknown>> }
    ).roles;
    expect(roles["acceptance-grader"]).toMatchObject({
      runtime: "claude",
      model: "claude-opus-4-8",
      effort: "xhigh",
    });
  });
});
