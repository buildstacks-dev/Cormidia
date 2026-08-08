// CF-B27-SPEND (L1) — the exact outer authorization is a pre-admission bound.

import { afterEach, describe, expect, it } from "vitest";
import type { AcceptanceCampaignConfig } from "../../campaign/acceptance/campaign-config.js";
import { CampaignSpendGuard, CampaignSpendRefusal } from "../../campaign/acceptance/campaign-spend.js";
import type { InvocationRequest } from "../../campaign/acceptance/cli-admission.js";
import type { RecordedInvocation } from "../../campaign/acceptance/cli-driver.js";
import { makeTempStateHome } from "../../fixtures/state-home.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

const planner = { harness: "claude", model: "claude-opus-4-8", effort: "xhigh" } as const;
const builder = { harness: "claude", model: "claude-sonnet-5", effort: "xhigh" } as const;
const reviewer = { harness: "codex", model: "gpt-5.6-sol", effort: "xhigh" } as const;

function config(maxOutputTokens = 4_000_000): AcceptanceCampaignConfig {
  return {
    campaignId: "l-acc-run-1",
    commit: "a".repeat(40),
    policyPath: "/repo/validation-design/validation-policy.yaml",
    campaignOrg: "cormidia",
    scenarios: [
      {
        id: "S-ACC-1",
        kind: "app",
        appSlug: "cormidia/acc-1",
        worktree: "/tmp/acc-1",
        matrix: { planner, builder, reviewer },
      },
    ],
    adaptiveAssignments: [
      {
        id: "opus",
        assignment: planner,
        providerFamily: "anthropic",
        capabilityRef: "claude",
        conservativeEstimate: 25,
        uncertified: "fixture",
      },
    ],
    envelope: { maxOutputTokens, maxEquivUsd: 520, authorization: "exact" },
    planGate: { kind: "auto-continue", criteria: "rubric-6-attempted-on-P-1-and-P-5" },
    graderPlan: [],
  };
}

async function guard(maxOutputTokens?: number): Promise<CampaignSpendGuard> {
  const state = await makeTempStateHome({ name: "acceptance-spend" });
  cleanups.push(state.cleanup);
  return new CampaignSpendGuard({ stateHome: state.stateHome, config: config(maxOutputTokens) });
}

function request(): InvocationRequest {
  return { id: "turn-1", binary: "cormidia", argv: ["plan", "acc-1", "--auto"] };
}

function failure(): RecordedInvocation {
  return {
    binary: "cormidia",
    argv: ["plan", "acc-1", "--auto"],
    exitCode: 1,
    stdout: "",
    stderr: "provider failed",
    startedAt: "2026-08-08T00:00:00.000Z",
    finishedAt: "2026-08-08T00:00:01.000Z",
  };
}

describe("CF-B27-SPEND", () => {
  it("admits a conservative reservation that fits the exact envelope", async () => {
    const spend = await guard();
    await expect(spend.before(request())).resolves.toBeUndefined();
  });

  it("negative control: refuses before a turn whose reservation does not fit", async () => {
    const spend = await guard(119_999);
    await expect(spend.before(request())).rejects.toBeInstanceOf(CampaignSpendRefusal);
    expect((await spend.snapshot()).reservationRefusals).toHaveLength(1);
  });

  it("debits the full reservation when a failed command produced no settlement", async () => {
    const spend = await guard();
    const turn = request();
    await spend.before(turn);
    await spend.after(turn, failure());
    const snapshot = await spend.snapshot();
    expect(snapshot.debitedUnknownOutputTokens).toBe(120_000);
    expect(snapshot.debitedUnknownEquivUsd).toBe(25);
  });
});
