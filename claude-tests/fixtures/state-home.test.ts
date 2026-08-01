// HB-002 fixtures/state-home self-test — the temp state home carries the
// standing ~/.operon/<org> shape (system-map §2.2) and REAL product write
// paths accept it unmodified: the turn lock store and the telemetry ledger
// write into it at their own paths.

import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import {
  acquireLock,
  lockPath,
  readLock,
  releaseLock,
} from "../../src/org/locks.js";
import { recordTurn, type TurnRecord } from "../../src/runtime/telemetry.js";
import {
  assertStateHomeShape,
  makeTempStateHome,
  STATE_HOME_DIRS,
  StateHomeShapeError,
  type TempStateHome,
} from "./state-home.js";
import { assertNonEmptyWalk } from "./walk.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function stateHomeFixture(): Promise<TempStateHome> {
  const fixture = await makeTempStateHome();
  cleanups.push(fixture.cleanup);
  return fixture;
}

function turnRecord(at: string): TurnRecord {
  return {
    at,
    role: "builder",
    runtime: "claude",
    model: "fixture-model",
    status: "completed",
    tokensIn: 100,
    tokensOut: 20,
    costUsd: 0.01,
    usageQuality: "complete",
    subagentTurns: 0,
    wallClockMs: 1234,
    escalations: 0,
  };
}

describe("HB-002 fixtures/state-home (standing shape + product write paths)", () => {
  it("creates every standing directory and passes its own shape detector", async () => {
    const t = await stateHomeFixture();
    await expect(assertStateHomeShape(t.stateHome)).resolves.toBeUndefined();
    for (const dir of STATE_HOME_DIRS) {
      expect(existsSync(t.path(dir)), dir).toBe(true);
    }
  });

  it("the REAL turn-lock store writes and reads locks in it unmodified", async () => {
    const t = await stateHomeFixture();
    const result = await acquireLock(t.stateHome, {
      app: "alpha",
      role: "builder",
      turnId: "turn-0001",
    });
    expect(result.acquired).toBe(true);
    // The lock landed at the product's own path under locks/.
    const path = lockPath(t.stateHome, "alpha", "builder");
    expect(path.startsWith(t.path("locks"))).toBe(true);
    expect(existsSync(path)).toBe(true);
    const held = await readLock(t.stateHome, "alpha", "builder");
    expect(held.turnId).toBe("turn-0001");
    await releaseLock(t.stateHome, "alpha", "builder", held);
    expect(existsSync(path)).toBe(false);
  });

  it("the REAL telemetry ledger appends daily JSONL in it unmodified", async () => {
    const t = await stateHomeFixture();
    await recordTurn(t.stateHome, turnRecord("2026-07-31T09:00:00.000Z"));
    const ledger = t.path("telemetry", "2026-07-31.jsonl");
    expect(existsSync(ledger)).toBe(true);
    const rows = (await readFile(ledger, "utf8")).trim().split("\n");
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0] as string)).toMatchObject({ role: "builder", costUsd: 0.01 });
    // Fixture rule: after product writes, the sweep surface is non-empty.
    await assertNonEmptyWalk(t.stateHome);
  });

  it("negative control: a seeded double-claim FIRES the product contention detector", async () => {
    const t = await stateHomeFixture();
    const first = await acquireLock(t.stateHome, {
      app: "alpha",
      role: "builder",
      turnId: "turn-0001",
    });
    expect(first.acquired).toBe(true);
    const second = await acquireLock(t.stateHome, {
      app: "alpha",
      role: "builder",
      turnId: "turn-0002",
    });
    expect(second.acquired).toBe(false);
    // The reported holder is the first claimant, not the intruder.
    expect(second.lock.turnId).toBe("turn-0001");
  });

  it("negative control: a missing standing directory FIRES the shape detector by name", async () => {
    const t = await stateHomeFixture();
    await rm(t.path("locks"), { recursive: true, force: true });
    const failure = await assertStateHomeShape(t.stateHome).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(StateHomeShapeError);
    expect((failure as StateHomeShapeError).missing).toEqual(["locks"]);
  });
});
