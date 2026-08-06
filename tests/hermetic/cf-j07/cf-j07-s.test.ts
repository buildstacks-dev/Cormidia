// CF-J07-S — per-turn cap stop at the adapter observation point; 80% warning;
// 100% pause + item on the documented path (L2; HB-022; case-catalog §CF-J07;
// contracts/provider-adapter-core.md §5; CORMIDIA-INV-006/007;
// docs: architecture §7 budget overlay).
//
// The adapter observation point is asserted per the capability-matrix
// semantics (core §5): Claude's finest truthful point is the CLI's NATIVE
// running guard, which the adapter arms by threading the role's per-turn cap
// into provider construction as `maxBudgetUsd`. The scripted double records
// exactly what reached provider construction, and the REAL ClaudeRuntime maps
// the resulting `error_max_budget_usd` stop to a typed failed result with an
// incident-note artifact — never silent spend.

import { afterEach, describe, expect, it } from "vitest";
import { enforceBudgetOverlay, rollupBudgets } from "../../../src/org/budget.js";
import { ApprovalStore } from "../../../src/org/approvals.js";
import { claudeDouble, doubleRole, doubleTurnRequest } from "../../fixtures/adapters/claude-double.js";
import { script } from "../../fixtures/adapters/scenario.js";
import { makeTestClock } from "../../fixtures/clock.js";
import {
  APP,
  FIXED_NOW,
  MONTH,
  SilentOverspendViolation,
  assertExactlyOneBudgetItem,
  assertOverrunSurfaced,
  budgetItemKey,
  budgetItemsFor,
  makeBudgetOrg,
  readOverlayFile,
  seedSpend,
  type BudgetOrg,
} from "./support.js";

const CAP_USD = 5; // role.maxTurnBudgetUsd in the double's default role

describe("CF-J07-S — per-turn cap stop at the adapter observation point; 80% warning; 100% pause + item (L2, HB-022)", () => {
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

  it("the adapter arms the native running guard with the role's exact per-turn cap (core §5 observation point)", async () => {
    const rig = await freshOrg();
    const dbl = claudeDouble([
      script.turn({
        sessionId: "sess-j07-s-1",
        outcome: script.success("under-cap turn", {
          usage: { inputTokens: 900, outputTokens: 80 },
          costUsd: 0.4,
        }),
      }),
    ]);
    const result = await dbl.runtime.runTurn(
      doubleTurnRequest({
        workdir: rig.org.root,
        role: doubleRole({ name: "sre", maxTurnBudgetUsd: CAP_USD }),
        task: "scheduled sweep",
      }),
      { gate: () => ({ allow: true }) },
    );

    // The cap reached provider construction unchanged — the finest truthful
    // observation point Claude exposes (capability matrix; core §5).
    expect(dbl.recorder.turns).toHaveLength(1);
    expect(dbl.recorder.turns[0]!.options.maxBudgetUsd).toBe(CAP_USD);

    // An under-cap turn carries no budget stop and no incident note.
    expect(result.status).toBe("completed");
    expect(result.errorCode).toBeUndefined();
    expect(result.artifacts.filter((a) => a.ref.startsWith("budget-overrun/"))).toHaveLength(0);
    expect(() => assertOverrunSurfaced(result, CAP_USD)).not.toThrow();
  });

  it("crossing the cap stops the turn typed (error_max_budget_usd) with an incident note, and the overshoot stays in the envelope", async () => {
    const rig = await freshOrg();
    const dbl = claudeDouble([
      script.turn({
        sessionId: "sess-j07-s-2",
        outcome: script.failure("error_max_budget_usd", ["max budget exceeded"], {
          usage: { inputTokens: 40_000, outputTokens: 9_000 },
          costUsd: 5.4, // provider-reported spend past the $5 cap
        }),
      }),
    ]);
    const result = await dbl.runtime.runTurn(
      doubleTurnRequest({
        workdir: rig.org.root,
        role: doubleRole({ name: "sre", maxTurnBudgetUsd: CAP_USD }),
        task: "expensive sweep",
      }),
      { gate: () => ({ allow: true }) },
    );

    expect(result.status).toBe("failed");
    expect(result.errorCode).toBe("error_max_budget_usd");
    // Incident note, not silent spend (roles.yaml; adapter contract).
    const note = result.artifacts.find((a) => a.ref.startsWith("budget-overrun/"));
    expect(note).toBeDefined();
    expect(note!.kind).toBe("note");
    expect(note!.summary).toContain(`maxTurnBudgetUsd $${CAP_USD}`);
    expect(note!.summary).toContain("$5.4000");
    // Overshoot retained, never clamped to the cap (settlement is CF-J07-RC).
    expect(result.usage.costUsd).toBe(5.4);
    expect(() => assertOverrunSurfaced(result, CAP_USD)).not.toThrow();
  });

  it("negative control: a provider that crosses the cap and keeps going as a 'success' makes the silent-overspend detector FIRE", async () => {
    const rig = await freshOrg();
    // Seeded violation: the scripted provider ignored its running guard and
    // finished successfully at nearly 2x the cap.
    const dbl = claudeDouble([
      script.turn({
        sessionId: "sess-j07-s-neg",
        outcome: script.success("kept spending", {
          usage: { inputTokens: 90_000, outputTokens: 12_000 },
          costUsd: 9.99,
        }),
      }),
    ]);
    const result = await dbl.runtime.runTurn(
      doubleTurnRequest({
        workdir: rig.org.root,
        role: doubleRole({ name: "sre", maxTurnBudgetUsd: CAP_USD }),
        task: "runaway sweep",
      }),
      { gate: () => ({ allow: true }) },
    );
    expect(result.status).toBe("completed"); // the lie the detector exists for
    expect(() => assertOverrunSurfaced(result, CAP_USD)).toThrow(SilentOverspendViolation);
  });

  it("80%/100% thresholds: ok below 80, warning at exactly 80, exceeded at exactly 100 (monthly rollup boundaries)", async () => {
    const rig = await freshOrg([
      { name: "app-ok", budgetUsd: 100 },
      { name: "app-warn", budgetUsd: 100 },
      { name: "app-over", budgetUsd: 100 },
    ]);
    const clock = makeTestClock(FIXED_NOW);
    await seedSpend(rig.org.stateHome, { app: "app-ok", costUsd: 79.99 });
    await seedSpend(rig.org.stateHome, { app: "app-warn", costUsd: 80 });
    await seedSpend(rig.org.stateHome, { app: "app-over", costUsd: 100 });

    const rows = await rollupBudgets(rig.org.stateHome, rig.appsFile, clock.nowDate());
    const byApp = new Map(rows.map((row) => [row.app, row]));
    expect(byApp.get("app-ok")).toMatchObject({ status: "ok", spentUsd: 79.99 });
    expect(byApp.get("app-warn")).toMatchObject({ status: "warning", spentUsd: 80, percent: 80 });
    expect(byApp.get("app-over")).toMatchObject({ status: "exceeded", spentUsd: 100, percent: 100 });
  });

  it("100% pause + item, the documented path: overlay pauses the app and exactly one month-keyed approval item is raised", async () => {
    const rig = await freshOrg();
    const clock = makeTestClock(FIXED_NOW);
    await seedSpend(rig.org.stateHome, { costUsd: 120 }); // budget 100 → 120%

    const rows = await enforceBudgetOverlay(rig.org.stateHome, rig.appsFile, clock.nowDate());
    expect(rows.find((row) => row.app === APP)).toMatchObject({ status: "exceeded" });

    // Overlay written at the product path, pausing exactly this app.
    expect(await readOverlayFile(rig.org.stateHome)).toEqual({ pausedApps: [APP] });

    // Exactly one budget-exceeded item, month-keyed, on the approval queue.
    const item = await assertExactlyOneBudgetItem(rig.org.stateHome);
    expect(item).toMatchObject({
      app: APP,
      role: "orchestrator",
      rule: "budget-exceeded",
      status: "pending",
      justification: budgetItemKey(APP, MONTH),
    });
    expect(item.action.input).toMatchObject({ app: APP, spentUsd: 120, budgetUsd: 100 });
  });

  it("re-enforcement within the month is idempotent, and a DECIDED item is never re-raised", async () => {
    const rig = await freshOrg();
    const clock = makeTestClock(FIXED_NOW);
    await seedSpend(rig.org.stateHome, { costUsd: 150 });

    await enforceBudgetOverlay(rig.org.stateHome, rig.appsFile, clock.nowDate());
    clock.advance(5 * 60_000);
    await enforceBudgetOverlay(rig.org.stateHome, rig.appsFile, clock.nowDate());
    const item = await assertExactlyOneBudgetItem(rig.org.stateHome); // still exactly one

    // The human acknowledges (denies the raise-the-cap action); the pause is
    // month-scoped state, so enforcement must not spam a fresh item.
    await new ApprovalStore(rig.org.stateHome).decide(item.id, {
      decision: "denied",
      reason: "cap stands; wait for the month to reset",
      now: clock.nowDate(),
    });
    clock.advance(5 * 60_000);
    await enforceBudgetOverlay(rig.org.stateHome, rig.appsFile, clock.nowDate());

    const { pending, decided } = await budgetItemsFor(rig.org.stateHome);
    expect(pending).toHaveLength(0);
    expect(decided).toHaveLength(1);
    await assertExactlyOneBudgetItem(rig.org.stateHome); // one across both stores
    // The app STAYS paused after the decision — deciding the item is not an
    // un-pause; only the monthly rollup dropping under cap is.
    expect(await readOverlayFile(rig.org.stateHome)).toEqual({ pausedApps: [APP] });
  });
});
