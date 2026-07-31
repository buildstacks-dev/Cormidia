// Direct coverage for the shared FileLock primitive (src/runtime/file-lock.ts),
// the unification point for the codebase's hand-rolled locks (F-008). The app
// git-clone lock is re-expressed as a configuration of this primitive; these
// tests exercise it standalone with a different stale window to show it is
// genuinely reusable, not just the git lock in disguise.
//
// Concurrency is modeled on test/settlement/property.test.ts (F-SET-01):
// Promise.all over concurrent holders, plus a fake clock for the >max-wait path.
// No network, auth, real org state, or live wall clock is required.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  FileLockBusyError,
  acquireFileLock,
  acquireFileLockSync,
  releaseFileLock,
  releaseFileLockSync,
  withFileLock,
  withFileLockSync,
  type FileLockClock,
  type FileLockOptions,
} from "../src/runtime/file-lock.js";
import { FakeClock } from "./fixtures/fakeClock.js";

const OPTIONS: FileLockOptions = { staleMs: 30_000, maxWaitMs: 90_000, retryMinMs: 0, retryMaxMs: 0 };

describe("FileLock primitive (F-008)", () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function lockPath(): string {
    dir ??= mkdtempSync(join(tmpdir(), "operon-filelock-"));
    return join(dir, "sub", "resource.lock");
  }

  it("serializes concurrent holders — never two in the critical section at once", async () => {
    const path = lockPath();
    let active = 0;
    let maxActive = 0;
    const results = await Promise.all(
      Array.from({ length: 12 }, (_unused, ordinal) =>
        withFileLock(path, OPTIONS, async () => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          await new Promise((resolve) => setTimeout(resolve, 1));
          active -= 1;
          return ordinal;
        }),
      ),
    );
    expect(maxActive).toBe(1);
    expect([...results].sort((a, b) => a - b)).toEqual(Array.from({ length: 12 }, (_u, i) => i));
    expect(existsSync(path)).toBe(false);
  });

  it("never force-breaks a LIVE holder — the waiter yields FileLockBusyError", async () => {
    const path = lockPath();
    const tokenA = await acquireFileLock(path, OPTIONS);
    const held = readFileSync(path, "utf8");

    const clock = new FakeClock("2026-07-10T00:00:00.000Z");
    const bClock: FileLockClock = {
      now: () => clock.now().getTime(),
      sleep: async (ms) => clock.advance(Math.max(ms, 20_000)),
    };
    await expect(acquireFileLock(path, { ...OPTIONS, clock: bClock })).rejects.toBeInstanceOf(FileLockBusyError);

    // A's lock was neither removed nor overwritten by the contender.
    expect(readFileSync(path, "utf8")).toBe(held);
    await releaseFileLock(path, tokenA);
    expect(existsSync(path)).toBe(false);
  });

  it("release verifies the ownership token — a stale token never deletes a successor's lock", async () => {
    const path = lockPath();
    mkdirSync(join(dir, "sub"), { recursive: true });
    // A held once (its token), but the file now belongs to successor B.
    const staleToken = { pid: process.pid, nonce: "A-old-nonce" };
    const successor = JSON.stringify({ pid: process.pid, nonce: "B", at: new Date().toISOString() }) + "\n";
    writeFileSync(path, successor);

    await releaseFileLock(path, staleToken);
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path, "utf8")).toBe(successor);
  });

  it("reclaims a holder whose pid is provably dead", async () => {
    const path = lockPath();
    mkdirSync(join(dir, "sub"), { recursive: true });
    const deadPid = spawnSync(process.execPath, ["-e", ""]).pid;
    writeFileSync(path, JSON.stringify({ pid: deadPid, nonce: "dead", at: new Date().toISOString() }) + "\n");
    const token = await acquireFileLock(path, { ...OPTIONS, retryMinMs: 0, retryMaxMs: 0 });
    expect(JSON.parse(readFileSync(path, "utf8")).nonce).toBe(token.nonce);
  });

  it("reclaims an aged lock with no trustworthy pid (age-based, fake clock)", async () => {
    const path = lockPath();
    mkdirSync(join(dir, "sub"), { recursive: true });
    writeFileSync(path, JSON.stringify({ at: "2026-07-10T00:00:00.000Z" }) + "\n"); // no pid
    const clock: FileLockClock = {
      now: () => new Date("2026-07-10T00:01:00.000Z").getTime(), // 60s > 30s stale window
      sleep: async () => {},
    };
    const token = await acquireFileLock(path, { ...OPTIONS, clock });
    expect(JSON.parse(readFileSync(path, "utf8")).nonce).toBe(token.nonce);
  });

  it("offers the same never-break-live and nonce-release guarantees synchronously", () => {
    const path = lockPath();
    const token = acquireFileLockSync(path, { staleMs: 30_000 });
    const held = readFileSync(path, "utf8");

    expect(() => acquireFileLockSync(path, { staleMs: 30_000 })).toThrow(FileLockBusyError);
    expect(readFileSync(path, "utf8")).toBe(held);

    releaseFileLockSync(path, { pid: process.pid, nonce: "stale-owner" });
    expect(readFileSync(path, "utf8")).toBe(held);
    releaseFileLockSync(path, token);
    expect(existsSync(path)).toBe(false);
  });

  it("reclaims a provably dead synchronous holder and releases through RAII", () => {
    const path = lockPath();
    mkdirSync(join(dir, "sub"), { recursive: true });
    const deadPid = spawnSync(process.execPath, ["-e", ""]).pid;
    writeFileSync(path, JSON.stringify({ pid: deadPid, nonce: "dead", at: new Date().toISOString() }) + "\n");

    const value = withFileLockSync(path, { staleMs: 30_000 }, () => {
      expect(JSON.parse(readFileSync(path, "utf8")).nonce).not.toBe("dead");
      return 42;
    });
    expect(value).toBe(42);
    expect(existsSync(path)).toBe(false);
  });

  it("reclaims an aged synchronous lock whose holder identity is inconclusive", () => {
    const path = lockPath();
    mkdirSync(join(dir, "sub"), { recursive: true });
    writeFileSync(path, JSON.stringify({ at: "2026-07-10T00:00:00.000Z" }) + "\n");

    const token = acquireFileLockSync(path, {
      staleMs: 30_000,
      now: () => new Date("2026-07-10T00:01:00.000Z").getTime(),
    });
    expect(JSON.parse(readFileSync(path, "utf8")).nonce).toBe(token.nonce);
    releaseFileLockSync(path, token);
  });
});
