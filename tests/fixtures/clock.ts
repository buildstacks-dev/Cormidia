// fixtures/clock.ts — the injected clock for B-06 (clock & calendar time).
//
// What the product actually lets us inject today (discovered, not assumed):
//   - `FileLockClock` (src/runtime/file-lock.ts): `{ now(): number; sleep(ms) }`
//     — the lock primitive's wait deadline and back-off. TestClock implements
//     it structurally, so it drops straight into `FileLockOptions.clock`.
//   - `now?: Date` parameters: src/org/locks.ts (acquireLock/heartbeatLock/
//     isStale), src/org/schedule.ts (isDue), src/org/app-reset.ts,
//     src/org/standing-roles.ts.
//   - `now?: () => Date` options: src/org/turn-runner.ts (`dateFn` matches).
// Everything else — roughly 195 direct `new Date()` / `Date.now()` call sites
// across src/ — reads the wall clock and CANNOT be steered by this fixture
// yet; suites needing those sites deterministic must wait for (or propose) a
// product seam, never fake vitest timers around real subprocesses.
//
// Scripting: advance/rollback/set cover the B-06 failure modes that are
// scriptable at the seams above (TTL expiry, heartbeat staleness, wall-clock
// rollback, NTP jump, UTC day/month rollover via set+advance). `sleep()`
// advances the virtual clock and resolves immediately, recording the request
// so back-off behavior is assertable.

import type { FileLockClock } from "../../src/runtime/file-lock.js";

export interface TestClock extends FileLockClock {
  /** Epoch milliseconds — the FileLockClock contract. */
  now(): number;
  /** Same instant as a fresh Date (product `now?: Date` parameters). */
  nowDate(): Date;
  /** Same instant as ISO-8601 (product record `at` fields). */
  nowIso(): string;
  /** `() => Date` shape for `now` options (e.g. turn-runner). Bound — safe to
   *  pass detached. */
  dateFn: () => Date;
  /** Move time forward (NTP jump, TTL expiry, staleness windows). */
  advance(ms: number): void;
  /** Move time backward (wall-clock rollback). */
  rollback(ms: number): void;
  /** Jump to an absolute instant (day/month/year rollover scripting). */
  set(to: number | Date | string): void;
  /** Resolves immediately after advancing the clock by `ms`; every request is
   *  recorded in `sleeps` so retry/back-off schedules are assertable. */
  sleep(ms: number): Promise<void>;
  /** Every ms value passed to sleep(), in call order. */
  readonly sleeps: readonly number[];
}

function toEpochMs(to: number | Date | string): number {
  const ms = typeof to === "number" ? to : new Date(to).getTime();
  if (!Number.isFinite(ms)) throw new Error(`fixtures/clock: not a valid instant: ${String(to)}`);
  return ms;
}

export function makeTestClock(start: number | Date | string = "2026-07-31T12:00:00.000Z"): TestClock {
  let current = toEpochMs(start);
  const sleeps: number[] = [];
  const clock: TestClock = {
    now: () => current,
    nowDate: () => new Date(current),
    nowIso: () => new Date(current).toISOString(),
    dateFn: () => new Date(current),
    advance(ms: number) {
      if (!Number.isFinite(ms) || ms < 0) throw new Error(`fixtures/clock: advance(${ms})`);
      current += ms;
    },
    rollback(ms: number) {
      if (!Number.isFinite(ms) || ms < 0) throw new Error(`fixtures/clock: rollback(${ms})`);
      current -= ms;
    },
    set(to) {
      current = toEpochMs(to);
    },
    sleep(ms: number) {
      sleeps.push(ms);
      current += Math.max(0, ms);
      return Promise.resolve();
    },
    sleeps,
  };
  return clock;
}
