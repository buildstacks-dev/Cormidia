// Tests process quality gates in src/loop/qgates.ts.
// Covers tests/lint/e2e/setup pass/fail/timeout behavior, output tail capture,
// whole-process-tree killing, unconfigured-command handling, and default limits.
// Uses real subprocesses inside temporary git worktrees; no network, auth, real
// org state, or live clock assumptions are required.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, describe, expect, it } from "vitest";
import { makeWorkingRepo, type WorkingRepoFixture } from "./fixtures/gitRepo.js";
import {
  DEFAULT_TAIL_LINES,
  DEFAULT_TIMEOUTS_MS,
  runE2eGate,
  runLintGate,
  runSetupGate,
  runTestsGate,
} from "../src/loop/qgates.js";

// One real worktree for the whole suite — the gates only need a cwd; each
// case passes its own command.
const repos: WorkingRepoFixture[] = [];
function worktree(): string {
  const repo = makeWorkingRepo();
  repos.push(repo);
  return repo.root;
}
const repoRoot = worktree();
afterAll(() => {
  for (const repo of repos) repo.cleanup();
});

const node = (script: string) => `${shellQuote(process.execPath)} -e ${shellQuote(script)}`;
const shellQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

describe("runTestsGate", () => {
  it("passes on exit 0", async () => {
    const result = await runTestsGate(repoRoot, { testCommand: node("process.exit(0)") });

    expect(result).toMatchObject({ gate: "tests", status: "pass", exitCode: 0 });
    expect(result.timedOut).toBeUndefined();
    expect(result.detail).toContain("passed");
  });

  it("retains bounded successful output for delivery evidence", async () => {
    const result = await runTestsGate(
      repoRoot,
      { testCommand: node("console.log('37 tests passed')") },
      { tailLines: 5 },
    );

    expect(result).toMatchObject({
      gate: "tests",
      status: "pass",
      exitCode: 0,
      outputTail: "37 tests passed",
    });
  });

  it("runs gate commands with CI=1 so installs never wait on a TTY (Stage 3)", async () => {
    const result = await runTestsGate(repoRoot, {
      testCommand: node('process.exit(process.env.CI === "1" ? 0 : 1)'),
    });
    expect(result).toMatchObject({ status: "pass", exitCode: 0 });
  });

  it("runs the command in the worktree (cwd), not the orchestrator's cwd", async () => {
    const repo = makeWorkingRepo();
    repos.push(repo);
    repo.writeFiles({ "marker.txt": "here\n" });

    const result = await runTestsGate(repo.root, {
      testCommand: node("require('fs').accessSync('marker.txt')"),
    });

    expect(result.status).toBe("pass");
  });

  it("fail captures the exit code and a bounded output tail", async () => {
    const script =
      "for (let i = 1; i <= 12; i++) console.log('L' + String(i).padStart(2, '0'));" +
      "console.error('boom: assertion failed');" +
      "process.exit(3)";
    const result = await runTestsGate(
      repoRoot,
      { testCommand: node(script) },
      { tailLines: 5 },
    );

    expect(result.status).toBe("fail");
    expect(result.exitCode).toBe(3);
    expect(result.detail).toContain("exit 3");
    // The tail is verbatim and bounded: newest lines kept, oldest dropped.
    expect(result.outputTail).toContain("boom: assertion failed");
    expect(result.outputTail).toContain("L12");
    expect(result.outputTail).not.toContain("L01");
    expect(result.outputTail!.split("\n").length).toBeLessThanOrEqual(5);
  });

  it("timeout is a distinct failure message, not an exit-code failure", async () => {
    const result = await runTestsGate(
      repoRoot,
      { testCommand: node("console.log('started'); setTimeout(() => {}, 60000)") },
      { timeoutMs: 500 },
    );

    expect(result.status).toBe("fail");
    expect(result.timedOut).toBe(true);
    expect(result.detail).toContain("timed out after 0.5s");
    expect(result.detail).not.toContain("exit"); // never dressed up as one
    expect(result.exitCode).toBeUndefined();
    // Output produced before the kill still reaches the brief.
    expect(result.outputTail).toContain("started");
  });

  it("timeout kills the whole process tree, not only the shell", async () => {
    const repo = makeWorkingRepo();
    repos.push(repo);
    const sentinel = "timeout-survivor.txt";
    const childScript =
      `setTimeout(() => require('fs').writeFileSync(${JSON.stringify(sentinel)}, 'alive'), 900);` +
      "setTimeout(() => {}, 60000)";
    const parentScript =
      `require('child_process').spawn(process.execPath, ['-e', ${JSON.stringify(childScript)}], { stdio: 'ignore' });` +
      "setTimeout(() => {}, 60000)";

    const result = await runTestsGate(
      repo.root,
      { testCommand: node(parentScript) },
      { timeoutMs: 250 },
    );
    await delay(1_200);

    expect(result.timedOut).toBe(true);
    expect(existsSync(join(repo.root, sentinel))).toBe(false);
  });

  it("unconfigured test command FAILS loudly (predecessor's silent pass is dropped)", async () => {
    const result = await runTestsGate(repoRoot, {});

    expect(result.status).toBe("fail");
    expect(result.detail).toContain("no test_command configured");
    expect(result.detail).toContain(".operon/config.yaml");
  });
});

describe("runLintGate (analogous mechanics)", () => {
  it("passes on exit 0", async () => {
    const result = await runLintGate(repoRoot, { lintCommand: node("process.exit(0)") });
    expect(result).toMatchObject({ gate: "lint", status: "pass", exitCode: 0 });
  });

  it("fail captures exit code and tail", async () => {
    const result = await runLintGate(repoRoot, {
      lintCommand: node("console.error('src/a.ts:1 no-unused-vars'); process.exit(1)"),
    });

    expect(result.status).toBe("fail");
    expect(result.exitCode).toBe(1);
    expect(result.detail).toContain("lint failed (exit 1)");
    expect(result.outputTail).toContain("no-unused-vars");
  });

  it("timeout message is lint-specific and distinct", async () => {
    const result = await runLintGate(
      repoRoot,
      { lintCommand: node("setTimeout(() => {}, 60000)") },
      { timeoutMs: 500 },
    );

    expect(result.status).toBe("fail");
    expect(result.timedOut).toBe(true);
    expect(result.detail).toContain("lint timed out");
  });

  it("unconfigured lint command fails loudly, like tests", async () => {
    const result = await runLintGate(repoRoot, {});
    expect(result.status).toBe("fail");
    expect(result.detail).toContain("no lint_command configured");
  });
});

describe("runE2eGate", () => {
  it("SKIPPED (not failed) when unconfigured — the one optional process gate", async () => {
    const result = await runE2eGate(repoRoot, {});

    expect(result.status).toBe("skip");
    expect(result.gate).toBe("e2e");
    expect(result.detail).toContain("no e2e_test_command configured");
    expect(result.durationMs).toBe(0);
  });

  it("runs like the others when configured: pass on exit 0", async () => {
    const result = await runE2eGate(repoRoot, { e2eTestCommand: node("process.exit(0)") });
    expect(result).toMatchObject({ gate: "e2e", status: "pass", exitCode: 0 });
  });

  it("fail when configured and failing — configured e2e is never a skip", async () => {
    const result = await runE2eGate(repoRoot, {
      e2eTestCommand: node("console.log('flow broke'); process.exit(2)"),
    });

    expect(result.status).toBe("fail");
    expect(result.exitCode).toBe(2);
    expect(result.outputTail).toContain("flow broke");
  });
});

describe("runSetupGate (dependency install before gates)", () => {
  it("returns undefined when no setup_command is configured — absent, not a failure", async () => {
    const result = await runSetupGate(repoRoot, {});
    expect(result).toBeUndefined();
  });

  it("passes on exit 0 and runs in the worktree", async () => {
    const repo = makeWorkingRepo();
    repos.push(repo);
    repo.writeFiles({ "package.json": "{}\n" });

    const result = await runSetupGate(repo.root, {
      setupCommand: node("require('fs').accessSync('package.json')"),
    });

    expect(result).toMatchObject({ gate: "setup", status: "pass", exitCode: 0 });
  });

  it("fail captures exit code and output tail (e.g. npm ci failing)", async () => {
    const result = await runSetupGate(repoRoot, {
      setupCommand: node("console.error('npm ERR! missing lockfile'); process.exit(1)"),
    });

    expect(result!.status).toBe("fail");
    expect(result!.exitCode).toBe(1);
    expect(result!.outputTail).toContain("npm ERR! missing lockfile");
  });
});

describe("defaults (predecessor parity)", () => {
  it("per-gate timeouts keep the predecessor's numbers plus the setup budget", () => {
    expect(DEFAULT_TIMEOUTS_MS).toEqual({
      setup: 300_000,
      tests: 300_000,
      lint: 120_000,
      e2e: 600_000,
    });
  });

  it("tail default is documented and bounded", () => {
    expect(DEFAULT_TAIL_LINES).toBe(50);
  });
});
