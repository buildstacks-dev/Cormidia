// HB-002 fixtures/clock self-test — the injected clock satisfies the
// product's real time seams (FileLockClock structurally; `now: Date`
// parameters in src/org/locks.ts; `at` timestamps in the telemetry ledger)
// and scripts the B-06 failure modes: staleness/TTL expiry, wall-clock
// rollback, and UTC day/month/year rollover.

import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { FileLockClock } from "../../src/runtime/file-lock.js";
import { acquireLock, DEFAULT_STALE_MS, heartbeatLock, isStale } from "../../src/org/locks.js";
import { recordTurn, type TurnRecord } from "../../src/runtime/telemetry.js";
import { makeTestClock } from "./clock.js";

const tempDirs: string[] = [];
afterEach(async () => {
  for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "hb002-clock-"));
  tempDirs.push(root);
  return root;
}

function turnRecord(at: string): TurnRecord {
  return {
    at,
    role: "builder",
    runtime: "claude",
    model: "fixture-model",
    status: "completed",
    tokensIn: 1,
    tokensOut: 1,
    costUsd: 0,
    usageQuality: "complete",
    subagentTurns: 0,
    wallClockMs: 1,
    escalations: 0,
  };
}

describe("HB-002 fixtures/clock (injected clock over real product seams)", () => {
  it("satisfies the product FileLockClock contract; sleep advances virtually and is recorded", async () => {
    // Compile-time proof: TestClock IS a FileLockClock (src/runtime/file-lock.ts).
    const clock: FileLockClock = makeTestClock(1_000);
    expect(clock.now()).toBe(1_000);
    const before = Date.now();
    await clock.sleep(60_000);
    expect(clock.now()).toBe(61_000);
    // The wall clock did not actually wait a minute.
    expect(Date.now() - before).toBeLessThan(5_000);

    const scripted = makeTestClock(0);
    await scripted.sleep(40);
    await scripted.sleep(80);
    expect([...scripted.sleeps]).toEqual([40, 80]);
  });

  it("scripts skew: advance, rollback, and absolute set", () => {
    const clock = makeTestClock("2026-07-31T00:00:00.000Z");
    clock.advance(1_500);
    expect(clock.nowIso()).toBe("2026-07-31T00:00:01.500Z");
    clock.rollback(500);
    expect(clock.nowIso()).toBe("2026-07-31T00:00:01.000Z");
    clock.set("2027-01-01T00:00:00.000Z");
    expect(clock.now()).toBe(Date.parse("2027-01-01T00:00:00.000Z"));
    expect(clock.nowDate().getTime()).toBe(clock.now());
    expect(clock.dateFn().getTime()).toBe(clock.now());
  });

  it("negative control: scripted heartbeat staleness FIRES the product isStale detector", async () => {
    const root = await tempRoot();
    const clock = makeTestClock("2026-07-31T12:00:00.000Z");
    const { acquired, lock } = await acquireLock(root, {
      app: "alpha",
      role: "builder",
      turnId: "turn-0001",
      now: clock.nowDate(),
    });
    expect(acquired).toBe(true);
    expect(lock.heartbeatAt).toBe(clock.nowIso());
    // Fresh under the injected clock…
    expect(isStale(lock, clock.nowDate())).toBe(false);
    // …then the seeded violation: the heartbeat window elapses with no beat.
    clock.advance(DEFAULT_STALE_MS + 1);
    expect(isStale(lock, clock.nowDate())).toBe(true);
    // A heartbeat under the same clock makes it fresh again (detector resets).
    const beaten = await heartbeatLock(root, "alpha", "builder", clock.nowDate());
    expect(isStale(beaten, clock.nowDate())).toBe(false);
  });

  it("documents wall-clock rollback at the staleness seam: negative elapsed reads fresh", async () => {
    const root = await tempRoot();
    const clock = makeTestClock("2026-07-31T12:00:00.000Z");
    await acquireLock(root, {
      app: "alpha",
      role: "builder",
      turnId: "turn-0001",
      now: clock.nowDate(),
    });
    const lock = await heartbeatLock(root, "alpha", "builder", clock.nowDate());
    // Rollback beyond the stale window: elapsed is negative, so the product
    // treats the future-stamped heartbeat as fresh. That IS today's behavior
    // at this seam — asserted so any change to it is a visible decision.
    clock.rollback(DEFAULT_STALE_MS * 2);
    expect(isStale(lock, clock.nowDate())).toBe(false);
  });

  it("scripts UTC day/year rollover against the real telemetry ledger", async () => {
    const root = await tempRoot();
    const clock = makeTestClock("2026-12-31T23:59:59.500Z");
    await recordTurn(root, turnRecord(clock.nowIso()));
    clock.advance(1_000); // crosses day, month, AND year in one step
    await recordTurn(root, turnRecord(clock.nowIso()));
    expect(existsSync(join(root, "telemetry", "2026-12-31.jsonl"))).toBe(true);
    expect(existsSync(join(root, "telemetry", "2027-01-01.jsonl"))).toBe(true);
  });
});
