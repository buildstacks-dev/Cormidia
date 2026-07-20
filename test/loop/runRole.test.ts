// Tests manual role turns in src/loop/runRole.ts and the run-role CLI.
// Covers dry-run brief construction, one-pass pipeline execution, runlog output,
// context passthrough, optional templates, default gating, and missing-runtime
// errors.
// Uses FakeRuntime, temp runlogs/templates, and local CLI subprocesses; no
// network, auth, real org state, or live wall clock is required.

import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, describe, expect, it } from "vitest";
import { runRole } from "../../src/loop/runRole.js";
import { runPaths } from "../../src/runtime/runlog/paths.js";
import { FakeRuntime } from "../../src/runtime/testing/fakeRuntime.js";
import { ApprovalStore } from "../../src/org/approvals.js";
import { initOrgHome } from "../../src/org/home.js";
import type { RoleConfig, TurnResult } from "../../src/runtime/types.js";
import { makeOrgHome } from "../fixtures/orgHome.js";

const execFileAsync = promisify(execFile);
const CLI_PATH = fileURLToPath(new URL("../../src/cli.ts", import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const TSX_LOADER = createRequire(import.meta.url).resolve("tsx");

const PLANNER: RoleConfig = {
  name: "planner",
  runtime: "claude",
  model: "claude-opus-4-8",
  effort: "high",
  delegation: { allow: [] },
  triggers: [],
  outputs: [],
  maxTurnBudgetUsd: 5,
};

function completed(summary: string): TurnResult {
  return {
    status: "completed",
    summary,
    artifacts: [],
    session: { runtime: "claude", id: "s1" },
    usage: { tokensIn: 10, tokensOut: 5, costUsd: 0.01, subagentTurns: 0, wallClockMs: 50 },
    escalations: [],
  };
}

const tempDirs: string[] = [];
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

describe("runRole", () => {
  it("dry-run returns the brief and never constructs a Runtime", async () => {
    const result = await runRole({
      role: PLANNER,
      dryRun: true,
      workdir: "/some/workdir",
      runtimeFor: () => {
        throw new Error("dry-run must not construct a Runtime");
      },
    });

    expect(result.executed).toBe(false);
    expect(result.brief).toContain("[ticket]");
    expect(result.brief).toContain("Manual role turn: planner");
    expect(result.brief).toContain("Working directory: /some/workdir");
    expect(result.brief).toContain("Network access: denied by default");
    expect(result.brief).not.toContain("not wired into manual turns");

    const networkPreview = await runRole({
      role: PLANNER,
      dryRun: true,
      networkAccess: true,
    });
    expect(networkPreview.brief).toContain("Network access: allowed by explicit --allow-network");
  });

  it("live run calls the runtime exactly once with the brief in task and leaves a run record", async () => {
    const home = makeOrgHome({ runs: { apps: ["civic"] } });
    const fake = new FakeRuntime([{ result: completed("planner output") }]);
    try {
      const result = await runRole({
        role: PLANNER,
        app: "civic",
        turnId: "turn-77",
        dryRun: false,
        workdir: "/some/workdir",
        runlogRoot: home.root,
        runtimeFor: () => fake,
        hooks: { gate: () => ({ allow: true }) },
        networkAccess: true,
        clock: () => new Date(Date.UTC(2026, 6, 5, 9, 30, 15)),
      });

      expect(result.executed).toBe(true);
      expect(fake.calls.length).toBe(1);
      expect(fake.calls[0]?.req.task).toBe(result.brief); // no template → brief-only task
      expect(fake.calls[0]?.req.session).toBeUndefined(); // fresh session
      expect(fake.calls[0]?.req.networkAccess).toBe(true);

      const runId = result.record?.runId as string;
      const paths = runPaths(home.root, "civic", runId);
      expect(existsSync(paths.envelope)).toBe(true);
      expect(existsSync(paths.brief)).toBe(true);
      expect(existsSync(paths.output)).toBe(true);
    } finally {
      home.cleanup();
    }
  });

  it("passes supplied org context through the one-pass pipeline", async () => {
    const home = makeOrgHome({ runs: { apps: ["civic"] } });
    const fake = new FakeRuntime([{ result: completed("planner output") }]);
    const context = {
      taste: ["# Org", "# Planner", "# App", "## Role turn protocol"],
      memoryExcerpts: ["remember acceptance criteria"],
    };
    try {
      const result = await runRole({
        role: PLANNER,
        app: "civic",
        turnId: "turn-context",
        dryRun: false,
        workdir: "/some/workdir",
        runlogRoot: home.root,
        runtimeFor: () => fake,
        hooks: { gate: () => ({ allow: true }) },
        context,
      });

      expect(result.brief).toContain(
        "Runtime context: 4 taste layers and 1 memory excerpt supplied",
      );
      expect(fake.calls[0]?.req.context).toMatchObject(context);
      expect(fake.calls[0]?.req.context.execution).toMatchObject({
        role: "planner",
        assignment: {
          harness: PLANNER.runtime,
          model: PLANNER.model,
          effort: PLANNER.effort,
        },
        resolvedCapabilities: expect.arrayContaining(["tool_gate", "cancellation"]),
        requiredCapabilities: ["cancellation", "session_resume", "tool_gate"],
        roleDelegation: { allow: [] },
      });
    } finally {
      home.cleanup();
    }
  });

  it("appends the template file content when --template is given", async () => {
    const home = makeOrgHome({ runs: { apps: ["civic"] } });
    const dir = mkdtempSync(join(tmpdir(), "runrole-tpl-"));
    tempDirs.push(dir);
    writeFileSync(join(dir, "custom.md"), "# Custom pass template\nDo the thing.\n");
    const fake = new FakeRuntime([{ result: completed("out") }]);
    try {
      await runRole({
        role: PLANNER,
        app: "civic",
        dryRun: false,
        runlogRoot: home.root,
        templatePath: join(dir, "custom.md"),
        runtimeFor: () => fake,
        hooks: { gate: () => ({ allow: true }) },
      });
      const task = fake.calls[0]?.req.task ?? "";
      expect(task).toContain("Manual role turn: planner");
      expect(task).toContain("\n\n---\n\n# Custom pass template\nDo the thing.\n");
    } finally {
      home.cleanup();
    }
  });

  it("manual turns are gated by default (defaultGate denies critical ops)", async () => {
    const home = makeOrgHome({ runs: { apps: ["civic"] } });
    const fake = new FakeRuntime([
      {
        toolActions: [{ action: { tool: "bash", input: { command: "rm -rf /data" } } }],
        result: completed("attempted"),
      },
    ]);
    try {
      const result = await runRole({
        role: PLANNER,
        dryRun: false,
        runlogRoot: home.root,
        runtimeFor: () => fake,
        // no hooks supplied — defaultGate must apply
      });
      expect(fake.calls[0]?.gateCalls[0]?.decision.allow).toBe(false);
      expect(result.record?.result.escalations.length).toBe(1);
    } finally {
      home.cleanup();
    }
  });

  it("live run without runtimeFor/runlogRoot fails loudly", async () => {
    await expect(runRole({ role: PLANNER, dryRun: false })).rejects.toThrow(
      /needs runtimeFor and runlogRoot/,
    );
  });
});

describe("run-role CLI", () => {
  it("run-role planner --dry-run prints the brief, exit 0", async () => {
    const { stdout } = await execFileAsync(
      process.execPath,
      ["--import", TSX_LOADER, CLI_PATH, "run-role", "planner", "--dry-run", "--org-home", REPO_ROOT],
      { cwd: REPO_ROOT },
    );
    expect(stdout).toContain("[ticket]");
    expect(stdout).toContain("Manual role turn: planner");
    expect(stdout).toContain("Network access: denied by default");
  });

  it("--allow-network is reflected faithfully in the token-free brief", async () => {
    const { stdout } = await execFileAsync(
      process.execPath,
      [
        "--import", TSX_LOADER, CLI_PATH, "run-role", "planner", "--dry-run",
        "--allow-network", "--org-home", REPO_ROOT,
      ],
      { cwd: REPO_ROOT },
    );
    expect(stdout).toContain("Network access: allowed by explicit --allow-network");
  });

  it("a live blocked_on_gate outcome exits nonzero before constructing a provider", async () => {
    const root = mkdtempSync(join(tmpdir(), "runrole-blocked-cli-"));
    tempDirs.push(root);
    const orgHome = join(root, "org");
    const stateHome = join(root, "state-home");
    await initOrgHome({
      target: orgHome,
      name: "runrole-blocked",
      stateHome,
      homeDir: join(root, "operator-home"),
    });
    writeFileSync(join(orgHome, "apps.yaml"), [
      "schema_version: 1",
      "org:",
      "  name: runrole-blocked",
      "  max_concurrent_turns: 1",
      "defaults:",
      "  budget_usd_month: 100",
      "apps:",
      "  alpha:",
      "    repo: /repo-must-not-be-opened",
      "    status: live",
      "    budget_usd_month: 100",
      "    cadence: {}",
      "",
    ].join("\n"), "utf8");
    const store = new ApprovalStore(stateHome, { idSource: () => "cli-stall" });
    const action = { tool: "bash", input: { command: "cat .env" } };
    await store.raise({ app: "alpha", role: "support", rule: "secrets-or-auth", action });
    await store.decide("cli-stall", { decision: "approved" });
    store.claimActorRetryGrantSync("grant-cli-stall", "actor-retry/support/old-turn");
    await store.settleActorRetryExecutions({
      actor: "actor-retry/support/old-turn",
      events: [{
        type: "tool_use",
        name: "bash",
        detail: "exact failure",
        args: action.input,
        success: false,
      }],
    });

    await expect(execFileAsync(
      process.execPath,
      [
        "--import", TSX_LOADER, CLI_PATH, "run-role", "support",
        "--app", "alpha", "--turn", "cli-blocked",
        "--org-home", orgHome, "--state-home", stateHome,
      ],
      { cwd: REPO_ROOT },
    )).rejects.toMatchObject({
      code: 1,
      stdout: expect.stringContaining("cli-blocked: blocked_on_gate"),
    });
  });

  it("unknown role exits non-zero with a clear message", async () => {
    await expect(
      execFileAsync(process.execPath, ["--import", TSX_LOADER, CLI_PATH, "run-role", "stranger", "--dry-run", "--org-home", REPO_ROOT], {
        cwd: REPO_ROOT,
      }),
    ).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining('unknown role "stranger"') as unknown as string,
    });
  });
});
