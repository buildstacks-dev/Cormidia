// HB-002 fixtures/kill-point self-test — the harness runs a real node
// subprocess, the handshake makes kill points deterministic, and SIGKILL at a
// named point provably leaves torn mid-write state behind (B-07 "we cannot
// prove how far it got"; B-15 torn durable state).

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runKillPointScenario, type KillPointResult } from "./kill-point.js";

// Writes journal.txt in two phases with a kill point between them, then a
// completion marker file. Torn state = phase-1 without phase-2.
const JOURNAL_SCENARIO = `
import { writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
const dir = process.env.KP_SCRATCH as string;
await kp("start");
writeFileSync(join(dir, "journal.txt"), "phase-1\\n");
await kp("mid-write");
appendFileSync(join(dir, "journal.txt"), "phase-2\\n");
writeFileSync(join(dir, "done.txt"), "done\\n");
await kp("end");
`;

const results: KillPointResult[] = [];
afterEach(async () => {
  for (const result of results.splice(0)) await result.cleanup();
});

async function run(scenario: Parameters<typeof runKillPointScenario>[0]): Promise<KillPointResult> {
  const result = await runKillPointScenario(scenario);
  results.push(result);
  return result;
}

describe("HB-002 fixtures/kill-point (subprocess kill-point harness)", () => {
  it("runs a scenario to completion through every marker in order", async () => {
    const result = await run({ source: JOURNAL_SCENARIO });
    expect(result.timedOut).toBe(false);
    expect(result.signal).toBeNull();
    expect(result.exitCode).toBe(0);
    expect(result.markers).toEqual(["start", "mid-write", "end"]);
    expect(readFileSync(join(result.stateDir, "journal.txt"), "utf8")).toBe("phase-1\nphase-2\n");
    expect(existsSync(join(result.stateDir, "done.txt"))).toBe(true);
  });

  it("propagates a scenario's own exit code", async () => {
    const result = await run({
      source: `await kp("about-to-fail");\nprocess.exit(7);\n`,
    });
    expect(result.exitCode).toBe(7);
    expect(result.signal).toBeNull();
    expect(result.markers).toEqual(["about-to-fail"]);
  });

  it("negative control: SIGKILL at the named point actually kills mid-write and leaves torn state", async () => {
    const result = await run({ source: JOURNAL_SCENARIO, killAt: "mid-write" });
    // The kill really happened, at the named point.
    expect(result.killedAt).toBe("mid-write");
    expect(result.signal).toBe("SIGKILL");
    expect(result.exitCode).toBeNull();
    expect(result.markers).toEqual(["start", "mid-write"]);
    // The child is genuinely dead — signalling it now must fail.
    expect(() => process.kill(result.pid, 0)).toThrow();
    // Surviving state is torn: phase-1 landed, phase-2 and done.txt never did.
    expect(readFileSync(join(result.stateDir, "journal.txt"), "utf8")).toBe("phase-1\n");
    expect(existsSync(join(result.stateDir, "done.txt"))).toBe(false);
  });

  it("negative control: a hung child FIRES the timeout, never a silent pass", async () => {
    const result = await run({
      // The interval keeps the child's event loop alive: a bare unsettled
      // top-level await would let node exit instead of hanging.
      source: `await kp("hang");\nsetInterval(() => {}, 1_000);\nawait new Promise(() => {});\n`,
      timeoutMs: 2_000,
    });
    expect(result.timedOut).toBe(true);
    expect(result.signal).toBe("SIGKILL");
    expect(result.markers).toEqual(["hang"]);
  });
});
