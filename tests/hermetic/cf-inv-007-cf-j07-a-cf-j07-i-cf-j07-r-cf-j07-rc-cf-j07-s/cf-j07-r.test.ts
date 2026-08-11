// Traceability: CF-J07-R · HB-022; CF-INV-007 · HB-022 · contracts/journey-acceptance.md J-07 refusal criterion; invariants.md CORMIDIA-INV-007.

// CF-J07-R — a paused app (either source: registry status or budget overlay)
// cannot claim spend; manual `loop --once` is refused too (L2; HB-022;
// case-catalog §CF-J07; CORMIDIA-INV-007 seeds (a)/(b); architecture §7).

import { afterEach, describe, expect, it } from "vitest";
import { join } from "node:path";
import { baseRevisionForBranch } from "../../../src/loop/default-branch.js";
import { DEFAULT_LOOP_POLICY, runLoopOnce, type LoopDriverOptions } from "../../../src/loop/driver.js";
import { loopDriverExitCode } from "../../../src/cli/loop.js";
import { enforceBudgetOverlay, isBudgetBlocking, type BudgetRow } from "../../../src/org/budget.js";
import type { DispatchTickResult } from "../../../src/org/dispatch.js";
import { makeTestClock } from "../../fixtures/clock.js";
import {
  APP,
  FIXED_NOW,
  PausedAppSpawnViolation,
  assertNoSpawnsForApp,
  makeBudgetOrg,
  recordingEventSource,
  runTick,
  seedMalformedSpendRow,
  seedSpend,
  type BudgetOrg,
} from "./support.js";

describe("CF-J07-R — paused app cannot claim spend; manual loop --once refuses (L2, HB-022)", () => {
  let cleanups: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    for (const cleanup of cleanups.reverse()) await cleanup();
    cleanups = [];
  });

  async function freshOrg(apps?: Parameters<typeof makeBudgetOrg>[0]): Promise<BudgetOrg> {
    const rig = await makeBudgetOrg(apps);
    cleanups.push(() => rig.org.cleanup());
    return rig;
  }

  async function manualBudgetPreflight(rig: BudgetOrg, row: BudgetRow) {
    const engine = {
      runlogRoot: rig.org.stateHome,
      budgetGuard: async () =>
        isBudgetBlocking(row.status)
          ? {
              allowed: false,
              reason:
                row.status === "unknown"
                  ? `${row.app} budget total could not be computed this month`
                  : `${row.app} spent $${row.spentUsd.toFixed(2)} of its $${row.budgetUsd.toFixed(2)} monthly cap`,
            }
          : { allowed: true },
    } as NonNullable<LoopDriverOptions["engine"]>;

    return runLoopOnce({
      app: APP,
      repo: `fixture/${APP}`,
      // Budget refusal occurs before the first GitHub read. A throwing stub
      // therefore proves the preflight really is pre-claim.
      gh: new Proxy(
        {},
        {
          get: () => {
            throw new Error("GitHub must not be touched after budget refusal");
          },
        },
      ) as LoopDriverOptions["gh"],
      localRepo: rig.org.root,
      worktreeRoot: join(rig.org.root, "worktrees"),
      policy: DEFAULT_LOOP_POLICY,
      commands: { testCommand: "true" },
      base: baseRevisionForBranch("trunk"),
      engine,
    });
  }

  it("registry pause refuses before event polling or spawn", async () => {
    const rig = await freshOrg([{ status: "paused" }]);
    const clock = makeTestClock(FIXED_NOW);
    const events = recordingEventSource();

    const run = await runTick(rig.org, clock.nowDate, events.source);

    expect(events.polledApps).not.toContain(APP);
    expect(run.spawned).toHaveLength(0);
    expect(() => assertNoSpawnsForApp(run.tick, APP)).not.toThrow();
  });

  it("budget-overlay pause refuses the same scheduled path before spawn", async () => {
    const rig = await freshOrg();
    const clock = makeTestClock(FIXED_NOW);
    await seedSpend(rig.org.stateHome, { costUsd: 101 });

    const run = await runTick(rig.org, clock.nowDate);

    expect(run.spawned).toHaveLength(0);
    expect(() => assertNoSpawnsForApp(run.tick, APP)).not.toThrow();
    expect(run.tick.skipped).toContain(`${APP}: budget overlay paused`);
  });

  it("manual loop --once uses the same exceeded truth and exits non-zero before GitHub", async () => {
    const rig = await freshOrg();
    const clock = makeTestClock(FIXED_NOW);
    await seedSpend(rig.org.stateHome, { costUsd: 100 });
    const rows = await enforceBudgetOverlay(rig.org.stateHome, rig.appsFile, clock.nowDate());
    const row = rows.find((candidate) => candidate.app === APP)!;

    const result = await manualBudgetPreflight(rig, row);

    expect(result.items).toEqual([]);
    expect(result.budgetRefusal).toContain("spent $100.00");
    expect(loopDriverExitCode(result)).toBe(1);
  });

  it("unknown monthly spend fails closed on the manual path, never as remaining headroom", async () => {
    const rig = await freshOrg();
    const clock = makeTestClock(FIXED_NOW);
    await seedMalformedSpendRow(rig.org.stateHome, APP);
    const rows = await enforceBudgetOverlay(rig.org.stateHome, rig.appsFile, clock.nowDate());
    const row = rows.find((candidate) => candidate.app === APP)!;

    expect(row.status).toBe("unknown");
    expect(isBudgetBlocking(row.status)).toBe(true);
    const result = await manualBudgetPreflight(rig, row);
    expect(result.budgetRefusal).toContain("could not be computed");
    expect(loopDriverExitCode(result)).toBe(1);
  });

  it("negative control: a forged paused-app spawn makes the refusal detector FIRE", () => {
    const forged = {
      spawned: [{ app: APP, role: "sre", turnId: "forged-spawn" }],
      skipped: [],
    } as unknown as DispatchTickResult;

    expect(() => assertNoSpawnsForApp(forged, APP)).toThrow(PausedAppSpawnViolation);
  });
});
