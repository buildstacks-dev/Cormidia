// CF-J07-RC — a cap-crossed turn retains and settles the full provider
// overshoot; the resulting monthly pause refuses the next claim (HB-022).

import { afterEach, describe, expect, it } from "vitest";
import { rollupBudgets } from "../../../src/org/budget.js";
import { readTurnRecords, recordTurnOnce, toRecord } from "../../../src/runtime/telemetry.js";
import { claudeDouble, doubleRole, doubleTurnRequest } from "../../fixtures/adapters/claude-double.js";
import { script } from "../../fixtures/adapters/scenario.js";
import { makeTestClock } from "../../fixtures/clock.js";
import {
  APP,
  FIXED_NOW,
  OvershootClampViolation,
  assertNoSpawnsForApp,
  assertOvershootRetained,
  makeBudgetOrg,
  runTick,
  type BudgetOrg,
} from "./support.js";

const CAP_USD = 5;
const REPORTED_USD = 5.4;

describe("CF-J07-RC — overshoot settles and next claim refuses (L2, HB-022)", () => {
  let rig: BudgetOrg | undefined;

  afterEach(async () => {
    await rig?.org.cleanup();
    rig = undefined;
  });

  it("settles the provider's full overshoot, then the next scheduled tick refuses before spawn", async () => {
    rig = await makeBudgetOrg([{ budgetUsd: CAP_USD }]);
    const clock = makeTestClock(FIXED_NOW);
    const role = doubleRole({ name: "sre", maxTurnBudgetUsd: CAP_USD });
    const dbl = claudeDouble([
      script.turn({
        sessionId: "sess-j07-rc",
        outcome: script.failure("error_max_budget_usd", ["max budget exceeded"], {
          usage: { inputTokens: 40_000, outputTokens: 9_000 },
          costUsd: REPORTED_USD,
        }),
      }),
    ]);
    const result = await dbl.runtime.runTurn(
      doubleTurnRequest({ workdir: rig.org.root, role, task: "cap crossing turn" }),
      { gate: () => ({ allow: true }) },
    );

    assertOvershootRetained(dbl.recorder.turns[0]!, result);
    expect(
      await recordTurnOnce(
        rig.org.stateHome,
        toRecord(role, result, clock.nowDate(), {
          app: APP,
          trigger: "schedule",
          runId: "20260731-120000-build-implement",
          providerTurnId: "provider-j07-rc",
        }),
      ),
    ).toBe(true);

    const ledger = await readTurnRecords(rig.org.stateHome);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]!.costUsd).toBe(REPORTED_USD);
    expect((await rollupBudgets(rig.org.stateHome, rig.appsFile, clock.nowDate()))[0]).toMatchObject({
      spentUsd: REPORTED_USD,
      status: "exceeded",
    });

    const next = await runTick(rig.org, clock.nowDate);
    expect(next.spawned).toHaveLength(0);
    expect(next.tick.skipped).toContain(`${APP}: budget overlay paused`);
    expect(() => assertNoSpawnsForApp(next.tick, APP)).not.toThrow();
  });

  it("negative control: clamping the envelope to the configured cap makes the retention detector FIRE", async () => {
    rig = await makeBudgetOrg([{ budgetUsd: CAP_USD }]);
    const role = doubleRole({ name: "sre", maxTurnBudgetUsd: CAP_USD });
    const dbl = claudeDouble([
      script.turn({
        sessionId: "sess-j07-rc-neg",
        outcome: script.failure("error_max_budget_usd", ["max budget exceeded"], {
          usage: { inputTokens: 40_000, outputTokens: 9_000 },
          costUsd: REPORTED_USD,
        }),
      }),
    ]);
    const honest = await dbl.runtime.runTurn(
      doubleTurnRequest({ workdir: rig.org.root, role, task: "cap crossing turn" }),
      { gate: () => ({ allow: true }) },
    );
    const clamped = { ...honest, usage: { ...honest.usage, costUsd: CAP_USD } };

    expect(() => assertOvershootRetained(dbl.recorder.turns[0]!, clamped)).toThrow(OvershootClampViolation);
  });
});
