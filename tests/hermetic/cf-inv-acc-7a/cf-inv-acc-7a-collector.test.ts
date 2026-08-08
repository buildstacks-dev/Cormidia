import { afterEach, describe, expect, it } from "vitest";
import { recordInvocation } from "../../../src/runtime/invocation-ledger.js";
import type { AcceptanceCampaignConfig } from "../../campaign/acceptance/campaign-config.js";
import { reconcileCampaignScenarios } from "../../campaign/acceptance/campaign-reconciliation.js";
import { CliDriver } from "../../campaign/acceptance/cli-driver.js";
import type { ScenarioProvision } from "../../campaign/acceptance/provision.js";
import { makeTempStateHome } from "../../fixtures/state-home.js";
import { makeTempGitRepo } from "../../fixtures/git-repo.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function rig(writeAudit: boolean) {
  const repo = await makeTempGitRepo();
  const state = await makeTempStateHome({ name: "acceptance-reconcile" });
  cleanups.push(repo.cleanup, state.cleanup);
  const driver = new CliDriver({
    cormidiaPath: "/usr/bin/true",
    cormidiaJobPath: "/usr/bin/true",
    checkoutRoot: repo.dir,
  });
  const invocation = await driver.run("cormidia-job", ["run", `${repo.dir}/job.yaml`, "--json"], {
    scenarioId: "S-ACC-3",
  });
  if (writeAudit) {
    await recordInvocation(state.stateHome, {
      schema_version: 2,
      at: invocation.startedAt,
      finishedAt: invocation.finishedAt,
      kind: "cli",
      invocationId: "cli-campaign-job",
      command: "cormidia-job",
      subcommand: "run",
      argv: invocation.argv,
      dryRun: false,
      outcome: "completed",
      exitCode: 0,
      wallClockMs: 1,
    });
  }
  const assignment = { harness: "claude", model: "claude-sonnet-5", effort: "xhigh" } as const;
  const config: AcceptanceCampaignConfig = {
    campaignId: "l-acc-run-1",
    commit: "a".repeat(40),
    policyPath: "/policy",
    campaignOrg: "cormidia",
    scenarios: [
      { id: "S-ACC-3", kind: "job", appSlug: "cormidia/s3", worktree: repo.dir, matrix: { research: assignment } },
    ],
    adaptiveAssignments: [],
    graderPlan: [],
    envelope: { maxOutputTokens: 1, maxEquivUsd: 1, authorization: "fixture" },
    planGate: { kind: "auto-continue", criteria: "rubric-6-attempted-on-P-1-and-P-5" },
  };
  const baseline = repo.git(["rev-parse", "HEAD"]);
  const provision: ScenarioProvision = {
    scenarioId: "S-ACC-3",
    appSlug: "cormidia/s3",
    baselineCommit: baseline,
    seededPaths: [],
    provisionedShas: [baseline],
    sealedMaterial: {},
  };
  return { config, driver, stateHome: state.stateHome, provisions: new Map([["S-ACC-3", provision]]) };
}

describe("CF-INV-ACC-7a collector", () => {
  it("closes when the packaged job invocation and provisioning boundary reconcile", async () => {
    const result = await reconcileCampaignScenarios(await rig(true));
    expect(result.get("S-ACC-3")).toMatchObject({ closed: true, forcedOutcome: "score-permitted" });
  });

  it("negative control: a campaign invocation absent from the product audit forces ungraded", async () => {
    const result = await reconcileCampaignScenarios(await rig(false));
    expect(result.get("S-ACC-3")?.closed).toBe(false);
    expect(result.get("S-ACC-3")?.violations).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "action-without-invocation-row" })]),
    );
  });
});
