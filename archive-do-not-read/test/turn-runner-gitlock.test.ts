// Concurrency tests for the app git-clone lock in src/org/turn-runner.ts (F-001).
//
// The git-clone lock serializes `git fetch/checkout/reset --hard` on the shared
// managed clone repos/<app>. Two roles on one app can be due in the same
// dispatch tick, so genuine contention is the expected steady state — modeled
// here with Promise.all over concurrent holders (the F-SET-01 pattern in
// test/settlement/property.test.ts), plus a fake clock for the >max-wait timing.
//
// The pre-fix bugs these pin (confirmed RED against the prior implementation):
//   * a waiter force-broke a LIVE holder's lock at the wall-clock deadline, then
//     ran a second `git reset --hard` on the same checkout;
//   * release unlinked by path with no ownership check, so a holder finishing
//     late deleted a *successor's* lock.
// No network, auth, real org state, or live wall clock is required.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import {
  AppGitLockBusyError,
  acquireGitCloneLock,
  releaseGitCloneLock,
  withAppGitLock,
  type GitCloneLockClock,
} from "../src/org/turn-runner.js";
import { FakeClock } from "./fixtures/fakeClock.js";
import { makeOrgHome, type OrgHomeFixture } from "./fixtures/orgHome.js";

function gitLockPath(root: string, app: string): string {
  return join(root, "repos", `${app}.gitlock`);
}

function ensureReposDir(root: string): void {
  mkdirSync(join(root, "repos"), { recursive: true });
}

// Fast, real-clock back-off so the O_EXCL spin serializes in milliseconds.
const FAST_CLOCK: GitCloneLockClock = {
  now: () => Date.now(),
  sleep: () => new Promise((resolve) => setTimeout(resolve, 0)),
};

describe("app git clone lock (F-001)", () => {
  let home: OrgHomeFixture;
  afterEach(() => home?.cleanup());

  it("serializes concurrent holders — never two `git reset --hard` at once", async () => {
    home = makeOrgHome();
    const app = "alpha";
    let active = 0;
    let maxActive = 0;
    const results = await Promise.all(
      Array.from({ length: 12 }, (_unused, ordinal) =>
        withAppGitLock(
          home.root,
          app,
          async () => {
            active += 1;
            maxActive = Math.max(maxActive, active);
            // Hold across an event-loop turn so overlap would be observable.
            await new Promise((resolve) => setTimeout(resolve, 1));
            active -= 1;
            return ordinal;
          },
          FAST_CLOCK,
        ),
      ),
    );
    // Mutual exclusion: at no instant did two holders run the critical section.
    expect(maxActive).toBe(1);
    // Every contender eventually acquired and ran (no lost waiter).
    expect([...results].sort((a, b) => a - b)).toEqual(Array.from({ length: 12 }, (_u, i) => i));
    // Released cleanly — no lock file left behind.
    expect(existsSync(gitLockPath(home.root, app))).toBe(false);
  });

  it("never force-breaks a LIVE holder — the waiter gives up (typed busy) instead", async () => {
    home = makeOrgHome();
    const app = "alpha";
    const lockPath = gitLockPath(home.root, app);
    ensureReposDir(home.root);

    // A holds: acquire and keep the lock. Its pid is this (live) process.
    const tokenA = await acquireGitCloneLock(lockPath);
    const held = readFileSync(lockPath, "utf8");

    // B contends with a fake clock we fast-forward well past the max wait. A's
    // pid is alive the whole time, so B must WAIT and then give up — it must
    // never break A's lock and run concurrently.
    const clock = new FakeClock("2026-07-10T00:00:00.000Z");
    const bClock: GitCloneLockClock = {
      now: () => clock.now().getTime(),
      sleep: async (ms) => clock.advance(Math.max(ms, 30_000)),
    };
    await expect(acquireGitCloneLock(lockPath, bClock)).rejects.toBeInstanceOf(AppGitLockBusyError);

    // A's lock is untouched: B neither removed nor overwrote it.
    expect(existsSync(lockPath)).toBe(true);
    expect(readFileSync(lockPath, "utf8")).toBe(held);

    // A releases its own lock cleanly.
    await releaseGitCloneLock(lockPath, tokenA);
    expect(existsSync(lockPath)).toBe(false);
  });

  it("release verifies the ownership token — a late holder never deletes a successor's lock", async () => {
    home = makeOrgHome();
    const app = "alpha";
    const lockPath = gitLockPath(home.root, app);

    let successorContent = "";
    await withAppGitLock(home.root, app, async () => {
      // While A "holds", simulate its lock having been reclaimed and re-acquired
      // by successor B (a different nonce). A's release must leave this in place.
      successorContent =
        JSON.stringify({ pid: process.pid, nonce: "successor-nonce", at: new Date().toISOString() }) + "\n";
      writeFileSync(lockPath, successorContent);
    });

    // A finished, ran its release, and left B's lock untouched.
    expect(existsSync(lockPath)).toBe(true);
    expect(readFileSync(lockPath, "utf8")).toBe(successorContent);
  });

  it("reclaims an aged lock whose owner pid is missing (age-based, fake clock)", async () => {
    home = makeOrgHome();
    const app = "alpha";
    const lockPath = gitLockPath(home.root, app);
    ensureReposDir(home.root);
    // A lock with no trustworthy pid, timestamped inside the payload.
    writeFileSync(lockPath, JSON.stringify({ at: "2026-07-10T00:00:00.000Z" }) + "\n");

    // Five minutes later (> the 120s stale window) a waiter reclaims and acquires.
    const clock: GitCloneLockClock = {
      now: () => new Date("2026-07-10T00:05:00.000Z").getTime(),
      sleep: async () => {},
    };
    const token = await acquireGitCloneLock(lockPath, clock);
    expect(token.nonce).toBeTruthy();
    // The reacquired lock is now ours.
    expect(JSON.parse(readFileSync(lockPath, "utf8")).nonce).toBe(token.nonce);
  });

  it("reclaims a lock whose holder pid is provably dead", async () => {
    home = makeOrgHome();
    const app = "alpha";
    const lockPath = gitLockPath(home.root, app);
    ensureReposDir(home.root);
    // A pid that has certainly exited (spawnSync returns after the child dies).
    const deadPid = spawnSync(process.execPath, ["-e", ""]).pid;
    expect(typeof deadPid).toBe("number");
    writeFileSync(
      lockPath,
      JSON.stringify({ pid: deadPid, nonce: "dead", at: new Date().toISOString() }) + "\n",
    );

    let ran = false;
    await withAppGitLock(
      home.root,
      app,
      async () => {
        ran = true;
      },
      FAST_CLOCK,
    );
    expect(ran).toBe(true);
    // Released after the reclaim-and-run.
    expect(existsSync(lockPath)).toBe(false);
  });
});
