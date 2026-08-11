// CF-IF-CLI — HB-033 — system-map.md §1.4 CLI interface-adapter contract.

// Progressive human help and stable machine discovery (#371).

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { renderTopLevelHelp } from "../../../../src/cli/help.js";

const execFileAsync = promisify(execFile);
const SOURCE_LAUNCHER = resolve("src/cormidia-local.cjs");
const GROUP_COMMANDS = {
  setup: ["org", "pipelines", "roles"],
  onboarding: ["app", "apps", "bootstrap", "new-app"],
  delivery: ["episode", "loop", "plan", "publication", "run-role"],
  operations: ["budget", "dispatch", "learn", "prune-runs", "retro", "scheduler", "task"],
  governance: ["approvals", "objective", "release"],
  inspection: ["analyze", "capabilities", "context", "doctor", "narrative", "observe", "report", "status", "telemetry"],
} satisfies Record<string, readonly string[]>;

async function runCli(args: readonly string[]): Promise<string> {
  const { stdout, stderr } = await execFileAsync("node", [SOURCE_LAUNCHER, ...args], {
    encoding: "utf8",
    timeout: 25_000,
  });
  expect(stderr).toBe("");
  return stdout.trimEnd();
}

function assertProgressiveTopLevel(help: string): void {
  if (help.split("\n").length > 35) throw new Error("top-level help is flat");
  if (!help.includes("Common starting actions:") || !help.includes("Help by task:")) {
    throw new Error("top-level help lacks orientation layers");
  }
  if (help.includes("cormidia org show") || help.includes("cormidia prune-runs")) {
    throw new Error("top-level help leaked the exhaustive command catalog");
  }
}

describe("CF-IF-CLI — progressive help hierarchy", () => {
  it("keeps the top level concise, task-oriented, and stable", async () => {
    const rendered = renderTopLevelHelp();
    assertProgressiveTopLevel(rendered);
    expect(await runCli(["--help"])).toBe(rendered);
    expect(await runCli([])).toBe(rendered);
    expect(rendered).toMatchInlineSnapshot(`
"cormidia — org runtime for a team of AI agents

Usage:
  cormidia <command> [options]
  cormidia <task> --help

Common starting actions:
  cormidia org init <path> --name <name>   create and select an org
  cormidia bootstrap <app-path>            onboard an existing app
  cormidia plan <app> --dry-run            preview planning without tokens
  cormidia status                          inspect recent activity

Help by task:
  cormidia setup       --help  Org setup: Create, select, configure, and validate an org.
  cormidia onboarding  --help  App onboarding: Register, verify, promote, reset, or create an app.
  cormidia delivery    --help  Planning and delivery: Plan work and advance it through governed delivery.
  cormidia operations  --help  Operations: Run scheduling, budgets, retention, tasks, and learning.
  cormidia governance  --help  Approvals and release: Manage authority, approvals, and release evidence.
  cormidia inspection  --help  Inspection: Inspect configuration, activity, evidence, and reports.

Next layers:
  cormidia <task> --help      commands for one operator task
  cormidia <command> --help   complete syntax, constraints, and safety notes

Machine discovery:
  cormidia capabilities --json   exhaustive stable command metadata
  cormidia context --json        resolved org, paths, authority, and apps"
`);
  });

  it("negative control: a seeded flat catalog trips the top-level detector", () => {
    const seeded = `${renderTopLevelHelp()}\n${Object.values(GROUP_COMMANDS)
      .flat()
      .map((command) => `  cormidia ${command}`)
      .join("\n")}`;
    expect(() => assertProgressiveTopLevel(seeded)).toThrow(/top-level help is flat/);
  });

  it("every intent group reveals its complete command families and the next layer", async () => {
    for (const [group, expectedCommands] of Object.entries(GROUP_COMMANDS)) {
      const output = await runCli([group, "--help"]);
      const commands = [...output.matchAll(/^  cormidia ([a-z-]+)\s{2,}/gm)].map((match) => match[1]);
      expect(commands, group).toEqual(expectedCommands);
      expect(output).toContain("complete syntax, constraints, and safety notes");
      expect(output).toContain("cormidia capabilities --json");
    }
  });

  it("compound command help retains exhaustive syntax and safety semantics", async () => {
    const [org, release, loop] = await Promise.all([
      runCli(["org", "init", "--help"]),
      runCli(["release", "verify", "--help"]),
      runCli(["loop", "rearm", "--help"]),
    ]);
    expect(org).toContain("cormidia org archive");
    expect(org).toContain("--execute plus an exact --confirm <org>");
    expect(release).toContain("cormidia release verify");
    expect(release).toContain("never run L3/L4/L5, create or push a tag, publish npm");
    expect(loop).toContain("cormidia loop rearm");
    expect(loop).toContain("Non-interactive execution requires every field plus exact --confirm");
  });

  it("capabilities --json remains byte-shape compatible with the pre-change catalog", async () => {
    const parsed: unknown = JSON.parse(await runCli(["capabilities", "--json"]));
    if (typeof parsed !== "object" || parsed === null || !("commands" in parsed) || !Array.isArray(parsed.commands)) {
      throw new Error("capabilities output omitted commands[]");
    }
    expect(parsed.commands).toHaveLength(39);
    expect(createHash("sha256").update(JSON.stringify(parsed.commands)).digest("hex")).toBe(
      "cdd677878886e8c276d43e2e76f844c7a95c0ae14652d6cbfc01134949378d6c",
    );
  });
});
