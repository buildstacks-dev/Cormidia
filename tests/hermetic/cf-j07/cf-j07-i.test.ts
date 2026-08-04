// CF-J07-I / HB-P1 — the ratified budget-pause crash boundary.
// The pause is durable before the human-visible item is raised; recovery
// converges to exactly one month-keyed item without ever admitting spend.

import { afterEach, describe, expect, it } from "vitest";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { ApprovalStore } from "../../../src/org/approvals.js";
import { enforceBudgetOverlay, isOverlayPaused } from "../../../src/org/budget.js";
import { runKillPointScenario, type KillPointResult } from "../../fixtures/kill-point.js";
import { makeTestClock } from "../../fixtures/clock.js";
import {
  APP,
  BudgetItemConvergenceViolation,
  FIXED_NOW,
  assertExactlyOneBudgetItem,
  budgetItemKey,
  budgetItemsFor,
  makeBudgetOrg,
  seedSpend,
  type BudgetOrg,
} from "./support.js";

describe("CF-J07-I — crash between durable pause and approval item converges (L2, HB-P1)", () => {
  let rig: BudgetOrg | undefined;
  let killed: KillPointResult | undefined;

  afterEach(async () => {
    await killed?.cleanup();
    await rig?.org.cleanup();
    killed = undefined;
    rig = undefined;
  });

  it("SIGKILL after overlay persistence leaves the pause held; the next pass raises exactly one item", async () => {
    rig = await makeBudgetOrg();
    const clock = makeTestClock(FIXED_NOW);
    await seedSpend(rig.org.stateHome, { costUsd: 125 });

    const moduleUrl = pathToFileURL(resolve("src/org/budget.ts")).href;
    killed = await runKillPointScenario({
      source: `
const { enforceBudgetOverlay } = await import(process.env.BUDGET_MODULE);
const apps = JSON.parse(process.env.APPS_JSON);
await enforceBudgetOverlay(
  process.env.STATE_HOME,
  apps,
  new Date(process.env.FIXED_NOW),
  { afterOverlayWrite: async () => kp("after-overlay") },
);
`,
      env: {
        BUDGET_MODULE: moduleUrl,
        STATE_HOME: rig.org.stateHome,
        APPS_JSON: JSON.stringify(rig.appsFile),
        FIXED_NOW,
      },
      killAt: "after-overlay",
    });

    expect(killed.killedAt).toBe("after-overlay");
    expect(killed.markers).toEqual(["after-overlay"]); // non-empty sweep proof
    expect(await isOverlayPaused(rig.org.stateHome, APP)).toBe(true);
    expect(await budgetItemsFor(rig.org.stateHome)).toEqual({ pending: [], decided: [] });

    // The killed process left the ownership lock behind. A dead-holder reclaim
    // plus the idempotent enforcement pass must fill the missing adjacency.
    await enforceBudgetOverlay(rig.org.stateHome, rig.appsFile, clock.nowDate());
    expect(await isOverlayPaused(rig.org.stateHome, APP)).toBe(true);
    await assertExactlyOneBudgetItem(rig.org.stateHome);

    // Repeating recovery never creates another item.
    await enforceBudgetOverlay(rig.org.stateHome, rig.appsFile, clock.nowDate());
    await assertExactlyOneBudgetItem(rig.org.stateHome);
  });

  it("negative control: two raw month-keyed items make the convergence detector FIRE", async () => {
    rig = await makeBudgetOrg();
    const store = new ApprovalStore(rig.org.stateHome);
    const common = {
      app: APP,
      role: "orchestrator",
      rule: "budget-exceeded",
      justification: budgetItemKey(APP),
      now: new Date(FIXED_NOW),
    } as const;
    await store.raise({ ...common, action: { tool: "budget", input: { sequence: 1 } } });
    await store.raise({ ...common, action: { tool: "budget", input: { sequence: 2 } } });

    await expect(assertExactlyOneBudgetItem(rig.org.stateHome)).rejects.toBeInstanceOf(
      BudgetItemConvergenceViolation,
    );
  });
});
