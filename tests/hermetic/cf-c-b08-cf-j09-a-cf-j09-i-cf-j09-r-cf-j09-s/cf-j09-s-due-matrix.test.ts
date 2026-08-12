// Traceability: CF-J09-S · HB-142 · contracts/B-08-tick-turn.md §1/§2 ·
// contracts/journey-acceptance.md J-09 · docs/scheduler/design.md → "Schedule
// triggers" (grammar) and "Trigger resolution" (cadence overrides).
//
// CF-J09-S — due arithmetic across the schedule/event/cadence-override matrix,
// and the durable pre-spawn decision: the scheduler decision and due-window
// claim are committed durably BEFORE the detached child starts.
// Window-normalization and settlement identity remain credited to
// tests/hermetic/cf-reg-231/ + tests/unit/cf-sched-claim/ (HB-139/#231).

import { afterEach, describe, expect, it } from "vitest";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { isDue, parseSchedule, scheduleDueWindow } from "../../../src/org/schedule.js";
import { FIXED_NOW, decisionProjections, makeSchedulerWorld, mustFind, type SchedulerWorld } from "./support.js";

/** Local-time instants (the grammar is local host time by design). */
function local(year: number, month1: number, day: number, hour: number, minute: number): Date {
  return new Date(year, month1 - 1, day, hour, minute, 0, 0);
}

describe("CF-J09-S — due arithmetic and the durable pre-spawn decision (L2, HB-142)", () => {
  const worlds: SchedulerWorld[] = [];

  async function world(spec: Parameters<typeof makeSchedulerWorld>[0]): Promise<SchedulerWorld> {
    const made = await makeSchedulerWorld(spec);
    worlds.push(made);
    return made;
  }

  afterEach(async () => {
    await Promise.all(worlds.splice(0).map((entry) => entry.cleanup()));
  });

  it("interval specs: due exactly at lastFired + interval, never before", () => {
    const noon = new Date("2026-08-12T12:00:00.000Z");
    expect(isDue("hourly", undefined, noon)).toBe(true);
    expect(isDue("hourly", new Date("2026-08-12T11:00:00.000Z"), noon)).toBe(true);
    expect(isDue("hourly", new Date("2026-08-12T11:30:00.000Z"), noon)).toBe(false);
    expect(isDue("every 30m", new Date("2026-08-12T11:30:00.000Z"), noon)).toBe(true);
    expect(isDue("every 30m", new Date("2026-08-12T11:45:00.000Z"), noon)).toBe(false);
    expect(isDue("every 2h", new Date("2026-08-12T10:00:00.000Z"), noon)).toBe(true);
    expect(isDue("every 2h", new Date("2026-08-12T10:00:00.001Z"), noon)).toBe(false);
  });

  it("daily and weekly specs: local-time slots with the weekly 09:00 default", () => {
    // 2026-08-12 is a Wednesday.
    expect(isDue("daily 07:00", local(2026, 8, 11, 7, 0), local(2026, 8, 12, 7, 0))).toBe(true);
    expect(isDue("daily 07:00", local(2026, 8, 12, 7, 0), local(2026, 8, 12, 23, 59))).toBe(false);
    expect(isDue("weekly wed 09:00", local(2026, 8, 5, 9, 0), local(2026, 8, 12, 8, 59))).toBe(false);
    expect(isDue("weekly wed 09:00", local(2026, 8, 5, 9, 0), local(2026, 8, 12, 9, 0))).toBe(true);
    expect(parseSchedule("weekly wed")).toEqual({ kind: "weekly", day: 3, hour: 9, minute: 0 });
    expect(scheduleDueWindow("daily 07:00", local(2026, 8, 12, 6, 0))).toEqual(local(2026, 8, 11, 7, 0));
    expect(scheduleDueWindow("daily 07:00", local(2026, 8, 12, 8, 0))).toEqual(local(2026, 8, 12, 7, 0));
    expect(scheduleDueWindow("weekly wed 09:00", local(2026, 8, 12, 10, 0))).toEqual(local(2026, 8, 12, 9, 0));
    expect(scheduleDueWindow("weekly wed 09:00", local(2026, 8, 11, 10, 0))).toEqual(local(2026, 8, 5, 9, 0));
  });

  it("the grammar is closed: malformed specs refuse to parse", () => {
    expect(() => parseSchedule("every 3 fortnights")).toThrow(/unsupported schedule trigger/);
    expect(() => parseSchedule("daily 25:00")).toThrow(/invalid schedule time/);
    expect(() => parseSchedule("weekly funday")).toThrow(/invalid weekly schedule day/);
  });

  it("schedule and event triggers derive their own due turns with distinct kinds", async () => {
    const w = await world({
      apps: [{ name: "app-a", channels: { support: ["email"] } }],
      roles: [
        { name: "sre", triggers: [{ schedule: "hourly" }] },
        { name: "support", triggers: [{ event: "support-feedback" }] },
      ],
    });
    const eventKey = await w.seedInboxEvent({ kind: "support-feedback", id: "feedback-s1", app: "app-a" });
    const tick = await w.tick();
    expect(tick.spawned).toHaveLength(2);
    const eventTurn = mustFind(tick.spawned, (turn) => turn.triggerKind === "event", "the event turn");
    expect(eventTurn).toMatchObject({ role: "support", eventKey, trigger: "support-feedback" });
    const scheduleTurn = mustFind(tick.spawned, (turn) => turn.triggerKind === "schedule", "the schedule turn");
    expect(scheduleTurn).toMatchObject({ role: "sre", trigger: "hourly" });
    expect(scheduleTurn.cadenceWindow).toBe(scheduleDueWindow("hourly", FIXED_NOW).toISOString());
    expect(scheduleTurn.scheduleClaimId).toBeDefined();
  });

  it("a cadence override REPLACES the role's own triggers (never merges)", async () => {
    const w = await world({
      apps: [
        {
          name: "app-a",
          channels: { support: ["email"] },
          cadence: { support: [{ schedule: "daily 07:00" }] },
        },
      ],
      roles: [{ name: "support", triggers: [{ schedule: "hourly" }] }],
    });
    const tick = await w.tick({ openIssues: [{ number: 7, title: "support backlog", labels: ["op:support"] }] });
    expect(tick.spawned).toHaveLength(1);
    expect(mustFind(tick.spawned, () => true, "the override turn")).toMatchObject({
      role: "support",
      trigger: "daily 07:00",
    });
    const rows = await decisionProjections(w);
    expect(rows.filter((row) => row.trigger === "hourly")).toEqual([]);
  });

  it("an empty cadence override disables the role for that app", async () => {
    const w = await world({
      apps: [{ name: "app-a", cadence: { sre: [] } }],
      roles: [{ name: "sre", triggers: [{ schedule: "hourly" }] }],
    });
    const tick = await w.tick();
    expect(tick.spawned).toEqual([]);
    expect(await decisionProjections(w)).toEqual([]);
  });

  it("due arithmetic reads the LATER of schedule state and spawn evidence", async () => {
    const w = await world({
      apps: [{ name: "app-a" }],
      roles: [{ name: "sre", triggers: [{ schedule: "hourly" }] }],
    });
    const first = await w.tick();
    expect(first.spawned).toHaveLength(1);
    // Lose the file-store bookkeeping (the #231 shape): spawn evidence alone
    // must still prove the window fired — the same slot is NOT due again.
    await rm(join(w.home.stateHome, "state", "schedule.json"), { force: true });
    const second = await w.tick({ at: new Date(FIXED_NOW.getTime() + 5 * 60_000) });
    expect(second.spawned).toEqual([]);
    mustFind(
      await decisionProjections(w),
      (row) => row.reason_code === "not_due",
      "the evidence-backed not_due decision",
    );
  });

  it("the spawn decision and due-window claim are durable BEFORE the child starts", async () => {
    const w = await world({
      apps: [{ name: "app-a" }],
      roles: [{ name: "sre", triggers: [{ schedule: "hourly" }] }],
    });
    const seenAtSpawn: Array<{ stage: string; claimStatus: string | undefined }> = [];
    const tick = await w.tick({
      spawn: async (input) => {
        // The child observes the world exactly as a detached process would:
        // the durable decision must already be at spawn_committed and the
        // due-window claim committed to this run id.
        const decisions = await w.evidence.listDecisions();
        const decision = mustFind(
          decisions,
          (row) => row.episode_id === input.turnId,
          "the pre-spawn durable decision",
        );
        const claimId = decision.schedule_claim_id;
        const claim = claimId === undefined ? undefined : await w.dueClaims.read(claimId);
        seenAtSpawn.push({ stage: decision.stage, claimStatus: claim?.status });
      },
    });
    expect(tick.spawned).toHaveLength(1);
    expect(seenAtSpawn).toEqual([{ stage: "spawn_committed", claimStatus: "committed" }]);
  });
});
