// ISSUE-013 regression: every read-oriented survey command emits one stable
// JSON document, apps/pipelines parse flags before their optional path, and
// capability/help discovery states the contract. The subprocesses receive
// only explicit temporary org/state homes; no active org, provider, network,
// or host runtime state is consulted.

import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const CLI_PATH = join(REPO_ROOT, "src", "cli.ts");
const TSX_LOADER = createRequire(import.meta.url).resolve("tsx");
const FIXTURE_ROOT = mkdtempSync(join(tmpdir(), "operon-json-read-commands-"));
const ORG_HOME = join(FIXTURE_ROOT, "org");
const STATE_HOME = join(FIXTURE_ROOT, "state");
const USER_HOME = join(FIXTURE_ROOT, "user-home");
const NEUTRAL_CWD = join(FIXTURE_ROOT, "neutral");

beforeAll(() => {
  mkdirSync(ORG_HOME, { recursive: true });
  mkdirSync(STATE_HOME, { recursive: true });
  mkdirSync(USER_HOME, { recursive: true });
  mkdirSync(NEUTRAL_CWD, { recursive: true });
  for (const file of ["TASTE.md", "roles.yaml", "apps.yaml", "pipelines.yaml"]) {
    cpSync(join(REPO_ROOT, file), join(ORG_HOME, file));
  }
  cpSync(join(REPO_ROOT, "prompts"), join(ORG_HOME, "prompts"), { recursive: true });
});

afterAll(() => rmSync(FIXTURE_ROOT, { recursive: true, force: true }));

async function runCli(args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: USER_HOME };
  delete env.OPERON_ORG_HOME;
  delete env.OPERON_STATE_HOME;
  delete env.OPERON_HOME;
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      ["--import", TSX_LOADER, CLI_PATH, ...args],
      { cwd: NEUTRAL_CWD, env },
    );
    return { stdout, stderr, code: 0 };
  } catch (error) {
    const failed = error as { stdout?: string; stderr?: string; code?: number };
    return { stdout: failed.stdout ?? "", stderr: failed.stderr ?? "", code: failed.code ?? 1 };
  }
}

const homes = ["--org-home", ORG_HOME, "--state-home", STATE_HOME];

describe("read-command JSON contract", () => {
  it.each([
    {
      command: "apps",
      args: ["apps", "--json", join(ORG_HOME, "apps.yaml")],
      expected: { kind: "apps" },
    },
    {
      command: "pipelines",
      args: ["pipelines", join(ORG_HOME, "pipelines.yaml"), "--json"],
      expected: { kind: "pipelines" },
    },
    {
      command: "status",
      args: ["status", ...homes, "--json", "--limit", "3"],
      expected: { kind: "status", runCount: 0 },
    },
    {
      command: "budget",
      args: ["budget", ...homes, "--json"],
      expected: { kind: "budget" },
    },
    {
      command: "analyze",
      args: ["analyze", ...homes, "--json"],
      expected: { kind: "analyze", anomalyCount: 0 },
    },
    {
      command: "approvals",
      args: ["approvals", ...homes, "--json"],
      expected: { kind: "approvals", view: "list", pendingCount: 0 },
    },
  ])("$command emits one parseable JSON document and exits zero", async ({ args, expected }) => {
    const result = await runCli(args);
    expect(result.code, result.stderr).toBe(0);
    expect(result.stderr).toBe("");
    const parsed = JSON.parse(result.stdout) as Record<string, unknown>;
    expect(parsed).toMatchObject({ schema_version: 1, ...expected });
    if (parsed["kind"] === "apps") {
      expect(parsed["appCount"]).toBe((parsed["apps"] as unknown[]).length);
    } else if (parsed["kind"] === "pipelines") {
      expect(parsed["pipelineCount"]).toBe((parsed["pipelines"] as unknown[]).length);
    } else if (parsed["kind"] === "status") {
      expect(parsed["runs"]).toEqual([]);
      expect(parsed["approvalDelivery"]).toEqual([]);
      expect(parsed["claimRecovery"]).toEqual([]);
    } else if (parsed["kind"] === "budget") {
      expect(Array.isArray(parsed["apps"])).toBe(true);
      expect(parsed).toHaveProperty("learning");
      expect(parsed).toHaveProperty("unmeasured");
    } else if (parsed["kind"] === "analyze") {
      expect(parsed["anomalies"]).toEqual([]);
    } else if (parsed["kind"] === "approvals") {
      expect(parsed["pending"]).toEqual([]);
      expect(parsed["outstanding"]).toEqual([]);
    }
  });

  it.each(["apps", "pipelines"])("%s never binds an unknown flag as its path", async (command) => {
    const result = await runCli([command, "--json", "--limit"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      schema_version: 1,
      ok: false,
      error: { message: `${command}: unknown argument "--limit"` },
    });
    expect(result.stdout).not.toContain("ENOENT");
    expect(result.stdout).not.toContain("not found");
  });

  it("documents JSON support in help and capability discovery", async () => {
    const commands = ["apps", "pipelines", "status", "budget", "analyze", "approvals"];
    const helpResults = await Promise.all(commands.map(async (command) => ({
      command,
      result: await runCli([command, "--help"]),
    })));
    for (const { result: help } of helpResults) {
      expect(help.code, help.stderr).toBe(0);
      expect(help.stdout).toContain("--json");
    }

    const result = await runCli(["capabilities", "--json"]);
    expect(result.code, result.stderr).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      commands: Array<{ command: string; supportsJson: boolean }>;
    };
    expect(parsed.commands.every((entry) => typeof entry.supportsJson === "boolean")).toBe(true);
    for (const command of commands) {
      expect(parsed.commands.find((entry) => entry.command === command)?.supportsJson).toBe(true);
    }
    expect(parsed.commands.find((entry) => entry.command === "loop")?.supportsJson).toBe(false);
  });

  it("keeps configuration immutable and all generated state inside the explicit fixture", () => {
    expect(readFileSync(join(ORG_HOME, "apps.yaml"), "utf8")).toBe(
      readFileSync(join(REPO_ROOT, "apps.yaml"), "utf8"),
    );
    expect(readFileSync(join(ORG_HOME, "pipelines.yaml"), "utf8")).toBe(
      readFileSync(join(REPO_ROOT, "pipelines.yaml"), "utf8"),
    );
    expect(readdirSync(USER_HOME)).toEqual([]);
    expect(existsSync(join(STATE_HOME, "runs"))).toBe(false);
    expect(existsSync(join(STATE_HOME, "telemetry"))).toBe(false);
    expect(existsSync(join(STATE_HOME, "clones"))).toBe(false);
    expect(existsSync(join(STATE_HOME, "worktrees"))).toBe(false);
  });
});
