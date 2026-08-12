// Traceability: CF-J09-A · HB-142 · contracts/journey-acceptance.md J-09 ·
// docs/scheduler/design.md → "Dispatch model" (the installed scheduler invokes
// the ordinary `cormidia dispatch`; src/org/scheduler/definition.ts builds
// exactly that command, so manual and timer dispatch share one boundary).
//
// CF-J09-A — manual `dispatch` = timer-fired dispatch: identical worlds ticked
// by the "timer" (window-start arrival) and by an "operator" (mid-window
// arrival) must produce byte-identical decision evidence once world-specific
// ids are normalized against their EXPECTED identity derivation — proving
// work identity is a pure function of (org, window, app, role, trigger) and
// never of the initiator or arrival instant. The manual-only retry verb's
// identity preservation is credited to tests/hermetic/cf-reg-231/.

import { afterEach, describe, expect, it } from "vitest";
import { scheduleDueWindow } from "../../../src/org/schedule.js";
import { schedulerDecisionId } from "../../../src/org/scheduler/model.js";
import {
  FIXED_NOW,
  InitiatorDivergenceViolation,
  assertInitiatorParity,
  decisionProjections,
  makeSchedulerWorld,
  type DecisionProjection,
  type SchedulerWorld,
} from "./support.js";

const SPEC = {
  apps: [{ name: "app-a" }],
  roles: [{ name: "sre", triggers: [{ schedule: "hourly" }] }],
} as const;

/** Replace this world's expected identity values with stable placeholders. A
 * tick that minted ANY other id keeps the raw value and the parity detector
 * fires on the divergence. */
function normalized(world: SchedulerWorld, rows: readonly DecisionProjection[]): DecisionProjection[] {
  const dueWindow = scheduleDueWindow("hourly", FIXED_NOW).toISOString();
  const payload = { org_id: world.orgId, app: "app-a", role: "sre", trigger: "hourly", due_window: dueWindow };
  const claimId = world.dueClaims.settlementId(payload);
  const expected = {
    decisionId: schedulerDecisionId({
      orgId: world.orgId,
      cadenceWindow: dueWindow,
      app: "app-a",
      role: "sre",
      triggerKind: "schedule",
      trigger: "hourly",
    }),
    episodeId: world.dueClaims.turnId(claimId, 1),
    claimId,
  };
  return rows.map((row) => ({
    ...row,
    decision_id: row.decision_id === expected.decisionId ? "«expected-decision»" : row.decision_id,
    episode_id: row.episode_id === expected.episodeId ? "«expected-episode»" : row.episode_id,
    schedule_claim_id: row.schedule_claim_id === expected.claimId ? "«expected-claim»" : row.schedule_claim_id,
    cadence_window: row.cadence_window === dueWindow ? "«due-window»" : row.cadence_window,
  }));
}

describe("CF-J09-A — manual dispatch equals timer dispatch (L2, HB-142)", () => {
  const worlds: SchedulerWorld[] = [];

  async function world(): Promise<SchedulerWorld> {
    const made = await makeSchedulerWorld(SPEC);
    worlds.push(made);
    return made;
  }

  afterEach(async () => {
    await Promise.all(worlds.splice(0).map((entry) => entry.cleanup()));
  });

  it("window-start (timer) and mid-window (manual) arrival yield identical normalized evidence", async () => {
    const timer = await world();
    const manual = await world();
    const timerTick = await timer.tick({ at: FIXED_NOW });
    const manualTick = await manual.tick({ at: new Date(FIXED_NOW.getTime() + 150_000) });
    expect(timerTick.spawned).toHaveLength(1);
    expect(manualTick.spawned).toHaveLength(1);

    const timerRows = normalized(timer, await decisionProjections(timer));
    const manualRows = normalized(manual, await decisionProjections(manual));
    expect(() => assertInitiatorParity(timerRows, manualRows)).not.toThrow();
    // The normalization actually bit: identity fields all matched expectation.
    expect(timerRows).toEqual([
      expect.objectContaining({
        decision_id: "«expected-decision»",
        episode_id: "«expected-episode»",
        schedule_claim_id: "«expected-claim»",
        cadence_window: "«due-window»",
        stage: "spawned",
      }),
    ]);
  });

  it("re-arrival inside the window is the same named observation for both initiators, with no evidence rewrite", async () => {
    const timer = await world();
    const manual = await world();
    await timer.tick({ at: FIXED_NOW });
    await manual.tick({ at: new Date(FIXED_NOW.getTime() + 150_000) });
    const timerBefore = normalized(timer, await decisionProjections(timer));
    const manualBefore = normalized(manual, await decisionProjections(manual));

    const timerAgain = await timer.tick({ at: new Date(FIXED_NOW.getTime() + 240_000) });
    const manualAgain = await manual.tick({ at: new Date(FIXED_NOW.getTime() + 180_000) });
    expect(timerAgain.spawned).toEqual([]);
    expect(manualAgain.spawned).toEqual([]);
    expect(timerAgain.skipped).toContain("app-a/sre: not_due (hourly)");
    expect(manualAgain.skipped).toContain("app-a/sre: not_due (hourly)");
    // Neither initiator's re-arrival rewrote the durable evidence, and the
    // two initiators still agree row for row.
    const timerAfter = normalized(timer, await decisionProjections(timer));
    const manualAfter = normalized(manual, await decisionProjections(manual));
    expect(timerAfter).toEqual(timerBefore);
    expect(manualAfter).toEqual(manualBefore);
    expect(() => assertInitiatorParity(timerAfter, manualAfter)).not.toThrow();
  });

  it("negative control: a seeded initiator divergence makes the parity detector FIRE", async () => {
    const w = await world();
    await w.tick({ at: FIXED_NOW });
    const rows = normalized(w, await decisionProjections(w));
    const diverged = rows.map((row) => ({ ...row, episode_id: `${row.episode_id ?? ""}-manual-initiator` }));
    expect(() => assertInitiatorParity(rows, diverged)).toThrow(InitiatorDivergenceViolation);
    expect(() => assertInitiatorParity(rows, [])).toThrow(InitiatorDivergenceViolation);
  });
});
