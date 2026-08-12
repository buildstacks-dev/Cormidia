// Traceability: CF-J09-I · HB-142 · contracts/B-08-tick-turn.md §2 (asymmetric
// crash outcomes) · boundary-map.md B-08 failure modes · CORMIDIA-INV-014.
//
// CF-J09-I — the two asymmetric nightmares across TICKS: spawn_failure
// (decision without child) settles the due window so the next tick refuses by
// settlement identity; post_spawn_bookkeeping_failure (child without
// bookkeeping) keeps the child's own durable claim/lock evidence so the next
// tick refuses by spawn evidence — and NEITHER path ever spawns a duplicate.
// Same-tick distinctness of the two reasons is credited to
// tests/hermetic/cf-inv-014/ (HB-149); this file owes the next-tick legs.

import { afterEach, describe, expect, it } from "vitest";
import { readLock } from "../../../src/org/locks.js";
import type { DispatchTickResult, DueTurn } from "../../../src/org/dispatch.js";
import {
  DuplicateSpawnViolation,
  FIXED_NOW,
  assertNoDuplicateSpawnAcrossTicks,
  decisionProjections,
  makeSchedulerWorld,
  mustFind,
  type SchedulerWorld,
} from "./support.js";

const SRE_HOURLY = {
  apps: [{ name: "app-a" }],
  roles: [{ name: "sre", triggers: [{ schedule: "hourly" }] }],
} as const;

describe("CF-J09-I — asymmetric failures without duplicate spawn (L2, HB-142)", () => {
  const worlds: SchedulerWorld[] = [];

  async function world(): Promise<SchedulerWorld> {
    const made = await makeSchedulerWorld(SRE_HOURLY);
    worlds.push(made);
    return made;
  }

  afterEach(async () => {
    await Promise.all(worlds.splice(0).map((entry) => entry.cleanup()));
  });

  it("spawn failure: decision-without-child settles the window; the next tick refuses by settlement identity", async () => {
    const w = await world();
    const first = await w.tick({
      spawn: async () => {
        throw new Error("seeded spawn ENOENT");
      },
    });
    expect(first.spawned).toEqual([]);
    const failed = mustFind(
      await decisionProjections(w),
      (row) => row.reason_code === "spawn_failure",
      "the spawn_failure decision",
    );
    expect(failed).toMatchObject({ stage: "terminal", outcome: "failed", classification: "blocked_error" });
    // The child never started, so the lock is released — the slot is not wedged.
    await expect(readLock(w.home.stateHome, "app-a", "sre")).rejects.toThrow();

    // The next tick in the same due window derives the same slot but refuses
    // under the settled identity: no duplicate spawn, a named reason instead.
    const second = await w.tick({ at: new Date(FIXED_NOW.getTime() + 60_000) });
    expect(second.spawned).toEqual([]);
    mustFind(
      await decisionProjections(w),
      (row) => row.reason_code === "already_settled",
      "the next tick's already_settled decision",
    );
    expect(() => assertNoDuplicateSpawnAcrossTicks([first, second])).not.toThrow();
    expect(w.spawns).toHaveLength(0);
  });

  it("bookkeeping failure: child-without-bookkeeping keeps its evidence; the next tick refuses by spawn evidence", async () => {
    const w = await world();
    const first = await w.tick({
      schedulerFault: async (boundary) => {
        if (boundary === "post_spawn_bookkeeping") throw new Error("seeded schedule-state EIO");
      },
    });
    expect(first.spawned).toHaveLength(1);
    expect(first.errors).toContain("app-a/sre: post-spawn bookkeeping failed: seeded schedule-state EIO");
    const pending = mustFind(
      await decisionProjections(w),
      (row) => row.reason_code === "post_spawn_bookkeeping_failure",
      "the bookkeeping-failure decision",
    );
    // The child is REAL: the decision stays pending and the lock is NOT
    // released — releasing it would invite the duplicate this leg exists for.
    expect(pending).toMatchObject({ stage: "spawned", outcome: null, classification: "pending" });
    const lock = await readLock(w.home.stateHome, "app-a", "sre");
    expect(lock.turnId).toBe(mustFind(w.spawns, () => true, "the spawned turn").turnId);

    const second = await w.tick({ at: new Date(FIXED_NOW.getTime() + 60_000) });
    expect(second.spawned).toEqual([]);
    expect(second.skipped).toContain("app-a/sre: not_due (hourly)");
    // The next tick's not_due observation must NOT terminalize (falsify) the
    // live child's pending decision — "a spawned decision remains pending
    // until the child journal is terminal" (docs/scheduler/design.md).
    const preserved = mustFind(
      await decisionProjections(w),
      (row) => row.reason_code === "post_spawn_bookkeeping_failure",
      "the still-pending bookkeeping-failure decision",
    );
    expect(preserved).toMatchObject({ stage: "spawned", outcome: null, classification: "pending" });
    expect(() => assertNoDuplicateSpawnAcrossTicks([first, second])).not.toThrow();
    expect(w.spawns).toHaveLength(1);
  });

  it("negative control: a seeded duplicate spawn makes the detector FIRE", () => {
    const turn: DueTurn = {
      app: "app-a",
      role: "sre",
      turnId: "dup-1",
      triggerKind: "schedule",
      trigger: "hourly",
      decisionId: "d-1",
      cadenceWindow: FIXED_NOW.toISOString(),
    };
    const forged = [
      { spawned: [turn], skipped: [], errors: [] },
      { spawned: [{ ...turn, turnId: "dup-2", decisionId: "d-2" }], skipped: [], errors: [] },
    ] satisfies DispatchTickResult[];
    expect(() => assertNoDuplicateSpawnAcrossTicks(forged)).toThrow(DuplicateSpawnViolation);
  });
});
