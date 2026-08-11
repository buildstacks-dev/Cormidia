// Traceability: CF-J02-A · HB-042; CF-SM-LADDER-L · HB-042; CF-SM-LADDER-I · HB-042 · contracts/journey-acceptance.md J-02 alternative-surface criterion; case-catalog.md §2 evidence-ladder machine.

// CF-J02-A — evidence-ladder claims stay monotone across lifecycle JSON and
// Observe: generated != registered != runtime-ready != live != scheduled.

import { afterEach, describe, expect, it } from "vitest";
import { planAppPromotion, verifyApp } from "../../../src/org/app-lifecycle.js";
import { stableJson } from "../../../src/org/lifecycle.js";
import { projectObserveSnapshot } from "../../../src/observe/project.js";
import {
  makeResetWorld,
  TARGET_APP,
  type ResetWorld,
} from "../cf-inv-010-cf-j14-a-cf-j14-i-cf-j14-r-cf-j14-rc-cf-j14-s/support.js";

function assertHighestClaim(serialized: string, expected: string, forbidden: string[]): void {
  if (!serialized.includes(expected) || forbidden.some((claim) => serialized.includes(claim))) {
    throw new Error(`evidence ladder overclaim: expected ${expected}; got ${serialized}`);
  }
}

describe("CF-J02-A — lifecycle evidence ladder claims per surface", () => {
  let world: ResetWorld | undefined;
  afterEach(async () => {
    await world?.cleanup();
    world = undefined;
  });

  it("a registered onboarding app with no lifecycle evidence remains registered in verify/promotion JSON and onboarding in Observe", async () => {
    world = await makeResetWorld();
    const verification = await verifyApp({
      orgHome: world.orgHome,
      stateHome: world.stateHome,
      appName: TARGET_APP,
      synchronize: false,
      writeReadiness: false,
      recordEvidence: false,
    });
    expect(verification).toMatchObject({
      status: "blocked",
      evidence_state: "registered",
      registry_status: "onboarding",
      provider: { factories: 0, processes: 0, turns: 0, settlements: 0 },
    });
    assertHighestClaim(stableJson(verification), '"evidence_state": "registered"', [
      '"evidence_state": "runtime-ready"',
      '"evidence_state": "live"',
      "autonomously scheduled",
    ]);

    const promotion = await planAppPromotion({
      orgHome: world.orgHome,
      stateHome: world.stateHome,
      appName: TARGET_APP,
      to: "live",
    });
    expect(promotion.executable).toBe(false);
    expect(promotion.verification.evidence_state).toBe("registered");

    const snapshot = projectObserveSnapshot({
      now: new Date("2026-07-31T18:00:00.000Z"),
      cursor: "0",
      filters: {},
      org_name: world.appsFile.org.name,
      state_home: world.stateHome,
      max_concurrent_turns: world.appsFile.org.maxConcurrentTurns,
      apps: world.appsFile.apps,
      passes: [],
      corrupt_runs: [],
      parent_tasks: [],
      parent_task_prompts: {},
      corrupt_tasks: [],
      approvals: [],
      ledger: [],
      invocations: [],
      schedule: {},
      locks: [],
      inbox: [],
      github: [],
      source_health: [],
    });
    expect(snapshot.apps.find((app) => app.name === TARGET_APP)?.lifecycle).toBe("onboarding");
    expect(snapshot.pending_intake.rows).toEqual(
      expect.arrayContaining([expect.objectContaining({ app: TARGET_APP, state: "awaiting_promotion" })]),
    );
    expect(JSON.stringify(snapshot)).not.toContain("autonomously scheduled");
  });

  it("negative control: the ladder detector fires when registered is seeded as live", () => {
    expect(() => assertHighestClaim('{"evidence_state":"live"}', "registered", ["live"])).toThrow(
      /evidence ladder overclaim/,
    );
  });
});
