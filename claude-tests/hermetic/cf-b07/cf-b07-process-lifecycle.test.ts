// CF-C-B07 / HB-023 — process identity, stale-lock reclamation, and owned
// descendant-tree termination under the ratified PID+start+nonce contract.

import { afterEach, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { dispatchTick } from "../../../src/org/dispatch.js";
import { acquireLock } from "../../../src/org/locks.js";
import { writeJournalPatch } from "../../../src/org/journal.js";
import {
  acquireFileLock,
  releaseFileLock,
  type FileLockToken,
} from "../../../src/runtime/file-lock.js";
import { processStartIdentity } from "../../../src/runtime/process-identity.js";
import { makeTestClock } from "../../fixtures/clock.js";
import { makeTempStateHome, type TempStateHome } from "../../fixtures/state-home.js";
import { makeBudgetOrg, NO_EVENTS, type BudgetOrg } from "../cf-j07/support.js";

class BarePidIdentityViolation extends Error {}
function assertCompleteIdentity(token: Partial<FileLockToken>): void {
  if (
    !Number.isInteger(token.pid) ||
    typeof token.processStartIdentity !== "string" || token.processStartIdentity === "" ||
    typeof token.nonce !== "string" || token.nonce === ""
  ) {
    throw new BarePidIdentityViolation("durable owner is not PID + process-start identity + nonce");
  }
}

describe("CF-B07 — OS process lifecycle (L2, HB-023)", () => {
  let state: TempStateHome | undefined;
  let org: BudgetOrg | undefined;
  let processGroup: ChildProcess | undefined;

  afterEach(async () => {
    if (processGroup?.pid !== undefined) {
      try { process.kill(-processGroup.pid, "SIGKILL"); } catch { /* already dead */ }
    }
    await org?.org.cleanup();
    await state?.cleanup();
    processGroup = undefined;
    org = undefined;
    state = undefined;
  });

  it("new file locks carry the full ratified identity; a live reused PID with the wrong start identity is reclaimable", async () => {
    state = await makeTempStateHome({ name: "cf-b07-lock" });
    const lockPath = state.path("locks", "identity.lock");
    const clock = makeTestClock("2026-07-31T12:00:00.000Z");
    const first = await acquireFileLock(lockPath, { staleMs: 60_000, maxWaitMs: 1_000, clock });
    expect(() => assertCompleteIdentity(first)).not.toThrow();
    const payload = JSON.parse(await readFile(lockPath, "utf8")) as FileLockToken;
    expect(payload).toMatchObject(first);
    await releaseFileLock(lockPath, first);

    // Seed PID reuse: the pid is live (this test process), but the recorded
    // start identity belongs to a prior process. Reclamation must not confuse
    // that new process for the old holder.
    await mkdir(dirname(lockPath), { recursive: true });
    await writeFile(lockPath, `${JSON.stringify({
      pid: process.pid,
      processStartIdentity: "darwin-lstart:prior process",
      nonce: "prior-nonce",
      at: clock.nowDate().toISOString(),
    })}\n`);
    const successor = await acquireFileLock(lockPath, { staleMs: 60_000, maxWaitMs: 1_000, clock });
    expect(successor.nonce).not.toBe("prior-nonce");
    expect(successor.processStartIdentity).toBe(processStartIdentity(process.pid));
    await releaseFileLock(lockPath, successor);
  });

  it("negative control: a bare-pid owner record makes the identity detector FIRE", () => {
    expect(() => assertCompleteIdentity({ pid: process.pid })).toThrow(BarePidIdentityViolation);
  });

  it("hung-turn recovery TERM→bounded grace→KILL reaches the owned process group and leaves no descendant alive", async () => {
    org = await makeBudgetOrg([{ status: "paused" }]);
    const leaderSource = `
const { spawn } = require("node:child_process");
process.on("SIGTERM", () => {});
const child = spawn(process.execPath, ["-e", "process.on('SIGTERM',()=>{}); setInterval(()=>{},1000)"], { stdio: "ignore" });
process.stdout.write(String(child.pid) + "\\n");
setInterval(() => {}, 1000);
`;
    processGroup = spawn(process.execPath, ["-e", leaderSource], {
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const leaderPid = processGroup.pid!;
    const descendantPid = await firstPidLine(processGroup);
    const started = processStartIdentity(leaderPid);
    expect(started).toBeDefined();

    const at = new Date("2026-07-31T10:00:00.000Z");
    const lock = await acquireLock(org.org.stateHome, {
      app: "budget-app",
      role: "builder",
      turnId: "turn-b07-hung",
      now: at,
      pid: leaderPid,
    });
    expect(lock.acquired).toBe(true);
    await writeJournalPatch(org.org.stateHome, "turn-b07-hung", {
      app: "budget-app",
      role: "builder",
      phase: "assembling",
      attempt: 0,
    });
    await writeJournalPatch(org.org.stateHome, "turn-b07-hung", {
      app: "budget-app",
      role: "builder",
      phase: "running",
      attempt: 0,
      pid: leaderPid,
      processStartIdentity: started!,
      processNonce: lock.lock.nonce!,
      processGroupId: leaderPid,
      passStartedAt: at.toISOString(),
      wallClockCapMs: 1,
    }, at);

    const result = await dispatchTick({
      orgRoot: org.org.orgHome,
      runtimeHome: org.org.stateHome,
      now: () => new Date("2026-07-31T10:01:00.000Z"),
      eventSource: NO_EVENTS,
      spawn: async () => {},
      killGraceMs: 50,
      killPollMs: 10,
    });
    await waitForExit(processGroup, 2_000);
    expect(result.skipped.some((line) => line.includes("recovered preserve_inspect"))).toBe(true);
    expect(await waitUntilDead(leaderPid, 2_000)).toBe(true);
    expect(await waitUntilDead(descendantPid, 2_000)).toBe(true);
    expect(existsSync(join(org.org.stateHome, "locks", "budget-app--builder.lock"))).toBe(false);
    processGroup = undefined;
  });
});

async function firstPidLine(child: ChildProcess): Promise<number> {
  const stream = child.stdout;
  if (stream === null) throw new Error("fixture leader has no stdout");
  return new Promise<number>((resolve, reject) => {
    let text = "";
    const timer = setTimeout(() => reject(new Error("fixture descendant pid timeout")), 2_000);
    stream.setEncoding("utf8");
    stream.on("data", (chunk: string) => {
      text += chunk;
      const line = text.split("\n")[0];
      if (line !== undefined && /^\d+$/.test(line)) {
        clearTimeout(timer);
        resolve(Number(line));
      }
    });
  });
}

async function waitForExit(child: ChildProcess, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await Promise.race([
    new Promise<void>((resolve) => child.once("close", () => resolve())),
    new Promise<void>((_, reject) => setTimeout(() => reject(new Error("process group leader did not exit")), timeoutMs)),
  ]);
}

async function waitUntilDead(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { process.kill(pid, 0); }
    catch { return true; }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  try { process.kill(pid, 0); return false; }
  catch { return true; }
}
