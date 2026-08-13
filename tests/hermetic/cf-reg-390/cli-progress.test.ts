// Traceability: CF-REG-390 · HB-139 · case-catalog.md §10.3 · issue #390.

import { execFile, spawnSync } from "node:child_process";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cmdPlan } from "../../../src/cli/plan.js";
import { createCliProgressReporter, extractProgressArgs } from "../../../src/runtime/cli-progress.js";
import type { GovernedTurnProgressIdentity } from "../../../src/runtime/turn-observer.js";
import { makeTempOrgHome, type TempOrgHome } from "../../fixtures/org-home.js";
import { makeSyntheticSecret } from "../../fixtures/synthetic-secret.js";

const APP = "progress-app";
const REDACTION_FIXTURE = makeSyntheticSecret("sk-api-key").value;
const execFileAsync = promisify(execFile);
let org: TempOrgHome | undefined;

afterEach(async () => {
  vi.restoreAllMocks();
  await org?.cleanup();
  org = undefined;
});

describe("CF-REG-390 — durable foreground CLI progress", () => {
  it("streams start and heartbeat to stderr while JSON stdout remains one final document", async () => {
    org = await configuredOrg();
    const stderr: string[] = [];
    const stdout = vi.spyOn(console, "log").mockImplementation(() => undefined);
    let release: (() => void) | undefined;
    const providerPending = new Promise<void>((resolve) => {
      release = resolve;
    });

    const running = cmdPlan(
      [
        APP,
        "--auto",
        "--goal",
        "Exercise delayed progress",
        "--no-publish",
        "--json",
        "--org-home",
        org.orgHome,
        "--state-home",
        org.stateHome,
      ],
      {
        progressHeartbeatMs: 10,
        progressWriter: (line) => stderr.push(line),
        runAutoPlan: async (options) => {
          const identity: GovernedTurnProgressIdentity = {
            at: new Date().toISOString(),
            episodeId: "episode-cf-reg-390",
            runId: "run-cf-reg-390",
            pipeline: "planning",
            pass: "plan",
            role: "planner",
            assignment: { harness: "codex", model: "gpt-5.6-sol", effort: "high" },
            ordinal: 1,
            total: 2,
            resumed: true,
          };
          options.observer?.onTurnStarted?.(identity);
          options.observer?.onTurnStarted?.(identity);
          options.observer?.onEvent?.({
            type: "tool_use",
            name: "shell",
            detail: `raw prompt ${REDACTION_FIXTURE}`,
            args: { command: `curl -H Authorization:${REDACTION_FIXTURE}` },
          });
          await providerPending;
          options.observer?.onTurnTerminal?.({
            ...identity,
            at: new Date().toISOString(),
            status: "completed",
            usage: {
              tokensIn: 17,
              tokensOut: 9,
              costUsd: 0.04,
              subagentTurns: 0,
              wallClockMs: 35,
              quality: "complete",
            },
          });
          options.observer?.onTurnTerminal?.({
            ...identity,
            at: new Date().toISOString(),
            status: "completed",
            usage: {
              tokensIn: 17,
              tokensOut: 9,
              costUsd: 0.04,
              subagentTurns: 0,
              wallClockMs: 35,
              quality: "complete",
            },
          });
          return {
            status: "completed",
            summary: "final plan result",
            episodeId: identity.episodeId,
          };
        },
      },
    );

    await delay(35);
    expect(stdout).not.toHaveBeenCalled();
    expect(stderr.join("")).toContain("plan started: preflight");
    expect(stderr.join("")).toContain("plan still_active:");
    expect(stderr.join("")).toContain("1/2 planner codex/gpt-5.6-sol@high");
    expect(stderr.join("")).toContain("episode=episode-cf-reg-390 run=run-cf-reg-390");
    expect(stderr.join("")).toContain("log=cli-progress/plan/");

    release?.();
    await expect(running).resolves.toBe(0);
    expect(stdout).toHaveBeenCalledTimes(1);
    const finalDocument = JSON.parse(String(stdout.mock.calls[0]?.[0]));
    expect(finalDocument).toMatchObject({
      schema_version: 1,
      kind: "plan-result",
      app: APP,
      status: "completed",
      episodeId: "episode-cf-reg-390",
    });

    const log = await progressLog(org.stateHome, "plan");
    expect(log).toContain('"state":"started"');
    expect(log).toContain('"state":"still_active"');
    expect(log).toContain('"state":"completed"');
    expect(log).toContain('"artifact_ref":"episode:episode-cf-reg-390"');
    expect(log).toContain('"resumed":true');
    const turnRows = log
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
      .filter((row) => row.identity?.runId === "run-cf-reg-390");
    expect(turnRows.filter((row) => row.phase === "plan" && row.state === "started")).toHaveLength(1);
    expect(turnRows.filter((row) => row.phase === "plan" && row.state === "completed")).toHaveLength(1);
    expect(log).not.toContain(REDACTION_FIXTURE);
    expect(log).not.toContain("curl -H");
    expect(stderr.join("")).not.toContain(REDACTION_FIXTURE);
  });

  it("keeps logging when terminal progress is off and never lets a renderer failure fail work", async () => {
    org = await configuredOrg();
    const reporter = createCliProgressReporter({
      stateHome: org.stateHome,
      command: "run-role",
      scope: APP,
      mode: "off",
      writeStderr: () => {
        throw new Error("closed pipe");
      },
    });

    expect(() => reporter.phase("provider-start", "started")).not.toThrow();
    expect(() => reporter.terminal("failed", { nextAction: "resume safely" })).not.toThrow();
    reporter.dispose();

    const log = await progressLog(org.stateHome, "run-role");
    expect(log).toContain('"phase":"provider-start"');
    expect(log).toContain('"state":"failed"');
    expect(log).toContain('"next_action":"resume safely"');
    expect((await stat(await progressLogPath(org.stateHome, "run-role"))).mode & 0o777).toBe(0o600);
  });

  it("preserves governed failure, approval, cancellation, and interruption outcomes", async () => {
    org = await configuredOrg();
    const reporter = createCliProgressReporter({
      stateHome: org.stateHome,
      command: "loop",
      scope: APP,
      mode: "off",
    });
    const identity: GovernedTurnProgressIdentity = {
      at: new Date().toISOString(),
      episodeId: "episode-terminal-states",
      runId: "run-terminal-states",
      pipeline: "delivery",
      pass: "build",
      role: "builder",
      assignment: { harness: "claude", model: "claude-opus", effort: "high" },
      ordinal: 1,
      total: 1,
      resumed: false,
    };
    const usage = { tokensIn: 0, tokensOut: 0, costUsd: 0, subagentTurns: 0, wallClockMs: 1 };

    reporter.observer.onTurnTerminal?.({
      ...identity,
      status: "blocked_on_gate",
      errorCode: "approval_required",
      usage,
    });
    reporter.observer.onTurnTerminal?.({
      ...identity,
      runId: "run-terminal-failed",
      status: "failed",
      errorCode: "adapter_error",
      usage,
    });
    reporter.observer.onTurnTerminal?.({ ...identity, runId: "run-terminal-cancelled", status: "cancelled", usage });
    reporter.observer.onTurnTerminal?.({
      ...identity,
      runId: "run-terminal-interrupted",
      status: "interrupted",
      usage,
    });
    reporter.dispose();

    const log = await progressLog(org.stateHome, "loop");
    expect(log).toContain('"state":"awaiting_approval"');
    expect(log).toContain('"error_code":"approval_required"');
    expect(log).toContain('"state":"failed"');
    expect(log).toContain('"error_code":"adapter_error"');
    expect(log).toContain('"state":"cancelled"');
    expect(log).toContain('"state":"interrupted"');
  });

  it("throttles a chatty provider stream without hiding its first safe activity signal", async () => {
    org = await configuredOrg();
    const lines: string[] = [];
    const reporter = createCliProgressReporter({
      stateHome: org.stateHome,
      command: "plan",
      scope: APP,
      mode: "jsonl",
      writeStderr: (line) => lines.push(line),
    });

    for (let index = 0; index < 100; index++) {
      reporter.observer.onEvent?.({ type: "text", detail: `provider chunk ${index} ${REDACTION_FIXTURE}` });
    }
    reporter.dispose();

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('"phase":"provider-text"');
    expect(lines[0]).not.toContain(REDACTION_FIXTURE);
  });

  it("parses text, JSONL, quiet, and conflict modes without consuming command arguments", () => {
    expect(extractProgressArgs(["--json", "--progress=jsonl", "app"], "plan")).toEqual({
      rest: ["--json", "app"],
      mode: "jsonl",
    });
    expect(extractProgressArgs(["--quiet", "app"], "plan")).toEqual({ rest: ["app"], mode: "off" });
    expect(() => extractProgressArgs(["--quiet", "--progress=text"], "plan")).toThrow(/supplied more than once/u);
    expect(() => extractProgressArgs(["--progress", "verbose"], "plan")).toThrow(/text \| jsonl \| off/u);
  });

  it("documents the progress modes on both executable surfaces", async () => {
    const cormidia = join(import.meta.dirname, "../../../src/cormidia-local.cjs");
    const jobs = join(import.meta.dirname, "../../../src/cormidia-job-local.cjs");
    const [planHelp, jobHelp] = await Promise.all([
      execFileAsync(process.execPath, [cormidia, "plan", "--help"], { encoding: "utf8" }),
      execFileAsync(process.execPath, [jobs, "--help"], { encoding: "utf8" }),
    ]);

    expect(planHelp.stdout).toContain("--progress=jsonl");
    expect(planHelp.stdout).toContain("--quiet or --progress=off");
    expect(planHelp.stdout).toContain("<state-home>/cli-progress/");
    expect(jobHelp.stdout).toContain("--progress <mode>");
    expect(jobHelp.stdout).toContain("durable progress logging remains enabled");
  });

  it("keeps cormidia-job JSON stdout parseable while progress streams and persists", async () => {
    org = await configuredOrg();
    const config = join(org.root, "checkpoint-job.yaml");
    const launcher = join(import.meta.dirname, "../../../src/cormidia-job-local.cjs");
    await writeFile(
      config,
      "job: progress-json\nsteps:\n  - id: approve\n    checkpoint:\n      prompt: continue?\n",
      "utf8",
    );

    const result = spawnSync(process.execPath, [launcher, "run", config, "--json", "--progress=jsonl"], {
      cwd: org.root,
      env: { ...process.env, ...org.env, HOME: org.homeDir, NO_COLOR: "1" },
      encoding: "utf8",
    });

    expect(result.status, result.stderr).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      result: { status: "awaiting_checkpoint", job: "progress-json", providerTurns: 0 },
    });
    const progressRows = result.stderr
      .trim()
      .split("\n")
      .filter((line) => line.startsWith("{"))
      .map((line) => JSON.parse(line));
    expect(progressRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "cli-progress", state: "started" }),
        expect.objectContaining({ kind: "cli-progress", state: "suspended" }),
      ]),
    );
    expect(await progressLog(org.stateHome, "cormidia-job")).toContain('"state":"suspended"');
  });
});

async function configuredOrg(): Promise<TempOrgHome> {
  const fixture = await makeTempOrgHome({ name: "cf-reg-390-org" });
  await writeFile(
    join(fixture.orgHome, "apps.yaml"),
    [
      "schema_version: 1",
      "org:",
      "  name: cf-reg-390-org",
      "  max_concurrent_turns: 1",
      "defaults:",
      "  budget_usd_month: 1000",
      "apps:",
      `  ${APP}:`,
      "    repo: fixture/progress-app",
      "    status: live",
      "    cadence: {}",
      "",
    ].join("\n"),
    "utf8",
  );
  return fixture;
}

async function progressLog(stateHome: string, command: string): Promise<string> {
  return readFile(await progressLogPath(stateHome, command), "utf8");
}

async function progressLogPath(stateHome: string, command: string): Promise<string> {
  const directory = join(stateHome, "cli-progress", command);
  const entries = await readdir(directory);
  return join(directory, entries[0] ?? "missing");
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}
