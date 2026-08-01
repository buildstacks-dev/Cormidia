// CF-J09-RC — simultaneous dispatch ticks may derive the same due turn, but
// exactly one may spawn it and the losing tick is explicitly named (HB-021).

import { afterEach, describe, expect, it } from "vitest";
import { dispatchTick, type DispatchTickResult, type DueTurn } from "../../../src/org/dispatch.js";
import { SchedulerEvidenceStore } from "../../../src/org/scheduler/evidence.js";
import { schedulerIdentity } from "../../../src/org/scheduler/model.js";
import { makeTestClock } from "../../fixtures/clock.js";
import {
  APP,
  FIXED_NOW,
  NO_EVENTS,
  ROLE,
  makeBudgetOrg,
  type BudgetOrg,
} from "../cf-j07/support.js";

class DuplicateDispatchViolation extends Error {
  constructor(app: string, role: string, count: number) {
    super(`${app}/${role} spawned ${count} times in one cadence window`);
    this.name = "DuplicateDispatchViolation";
  }
}

function assertAtMostOneSpawn(results: readonly DispatchTickResult[], app: string, role: string): void {
  const count = results.flatMap((result) => result.spawned)
    .filter((turn) => turn.app === app && turn.role === role).length;
  if (count > 1) throw new DuplicateDispatchViolation(app, role, count);
}

describe("CF-J09-RC — double-fire tick race (L2, HB-021)", () => {
  let rig: BudgetOrg | undefined;

  afterEach(async () => {
    await rig?.org.cleanup();
    rig = undefined;
  });

  it("one tick wins the shared scheduler claim; the loser is named and cannot falsify winner evidence", async () => {
    rig = await makeBudgetOrg();
    const clock = makeTestClock(FIXED_NOW);
    let releaseWinner!: () => void;
    let winnerLocked!: () => void;
    const locked = new Promise<void>((resolve) => { winnerLocked = resolve; });
    const release = new Promise<void>((resolve) => { releaseWinner = resolve; });
    let held = false;
    const spawns: string[] = [];

    const first = dispatchTick({
      orgRoot: rig.org.orgHome,
      runtimeHome: rig.org.stateHome,
      now: clock.nowDate,
      eventSource: NO_EVENTS,
      spawn: async (turn) => { spawns.push(turn.turnId); },
      schedulerFault: async (boundary) => {
        if (boundary === "after_scheduler_lock" && !held) {
          held = true;
          winnerLocked();
          await release;
        }
      },
    });
    await locked;

    const loser = await dispatchTick({
      orgRoot: rig.org.orgHome,
      runtimeHome: rig.org.stateHome,
      now: clock.nowDate,
      eventSource: NO_EVENTS,
      spawn: async (turn) => { spawns.push(turn.turnId); },
    });
    releaseWinner();
    const winner = await first;

    expect(spawns).toHaveLength(1);
    expect(() => assertAtMostOneSpawn([winner, loser], APP, ROLE)).not.toThrow();
    expect(loser.skipped).toContain(`${APP}/${ROLE}: concurrent tick lost scheduler claim`);

    const evidence = new SchedulerEvidenceStore({
      stateHome: rig.org.stateHome,
      orgName: rig.appsFile.org.name,
      orgHome: rig.org.orgHome,
      schedulerId: schedulerIdentity(rig.appsFile.org.name, rig.org.orgHome),
    });
    const decisions = await evidence.listDecisions();
    const turnDecisions = decisions.filter((decision) => decision.app === APP && decision.role === ROLE);
    expect(turnDecisions).toHaveLength(1);
    expect(turnDecisions[0]).toMatchObject({ stage: "terminal", outcome: "executed", reason_code: "executed" });
    const summary = await evidence.summarize(clock.nowDate());
    expect(summary.duplicate_decisions).toBe(0);
    expect(summary.duplicate_episodes).toBe(0);
  });

  it("negative control: two forged spawns in the same window make the race detector FIRE", () => {
    const turn: DueTurn = { app: APP, role: ROLE, turnId: "dup", triggerKind: "schedule", trigger: "hourly", decisionId: "d", cadenceWindow: FIXED_NOW };
    const forged = [
      { spawned: [turn], skipped: [], errors: [] },
      { spawned: [{ ...turn, turnId: "dup-2" }], skipped: [], errors: [] },
    ] satisfies DispatchTickResult[];
    expect(() => assertAtMostOneSpawn(forged, APP, ROLE)).toThrow(DuplicateDispatchViolation);
  });
});
