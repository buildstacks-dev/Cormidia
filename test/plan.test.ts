// Planner co-planning launcher (M3.6): minimal context, Claude invocation,
// planning worktree lifecycle, and dry-run CLI output.

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import {
  assembleMinimalContext,
  buildClaudeInvocation,
  cleanupPlanningWorktree,
  createPlanningWorktree,
} from "../src/org/plan.js";
import { cmdPlan } from "../src/cli/plan.js";

const tempDirs: string[] = [];
const originalCwd = process.cwd();

afterEach(() => {
  vi.restoreAllMocks();
  process.chdir(originalCwd);
});

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function makeDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function write(root: string, rel: string, content: string): void {
  const path = join(root, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

function makeGitApp(withCharter = true): string {
  const root = makeDir("operon-plan-app-");
  git(root, ["init", "--initial-branch=main"]);
  git(root, ["config", "user.email", "test@example.com"]);
  git(root, ["config", "user.name", "Operon Test"]);
  write(root, "README.md", "# app\n");
  if (withCharter) write(root, ".operon/TASTE.md", "# App Charter\n\nShip small.\n");
  git(root, ["add", "."]);
  git(root, ["commit", "-m", "initial"]);
  return root;
}

function makeOrgHome(appName = "operon-sandbox-alpha"): string {
  const root = makeDir("operon-plan-org-");
  write(root, "TASTE.md", "# Org Taste\n\nBe precise.\n");
  write(
    root,
    "roles.yaml",
    `defaults:
  max_turn_budget_usd: 5
roles:
  planner:
    runtime: claude
    model: claude-opus-4-8
    effort: high
    delegation: {allow: []}
    triggers: [{manual: true}]
    outputs: [tickets]
`,
  );
  write(
    root,
    "apps.yaml",
    `org: {name: operon, max_concurrent_turns: 2}
defaults: {budget_usd_month: 1000}
apps:
  ${appName}:
    repo: owner/${appName}
    status: onboarding
    cadence: {}
`,
  );
  return root;
}

describe("assembleMinimalContext", () => {
  it("concatenates org and app charters plus the topic task line", async () => {
    const orgHome = makeOrgHome();
    const app = makeGitApp(true);
    const context = await assembleMinimalContext({
      orgHome,
      appWorkdir: app,
      app: "operon-sandbox-alpha",
      topic: "stats percentile helper",
    });

    expect(context.systemPrompt).toContain("# Org Taste");
    expect(context.systemPrompt).toContain("# App Charter");
    expect(context.openingTask).toBe("Co-planning topic: stats percentile helper");
    expect(context.byteSize).toBe(Buffer.byteLength(context.systemPrompt, "utf8"));
  });

  it("omits the app charter layer when .operon/TASTE.md is absent", async () => {
    const orgHome = makeOrgHome();
    const app = makeGitApp(false);
    const context = await assembleMinimalContext({
      orgHome,
      appWorkdir: app,
      app: "operon-sandbox-beta",
    });

    expect(context.systemPrompt).toContain("# Org Taste");
    expect(context.systemPrompt).not.toContain("App .operon/TASTE.md");
  });
});

describe("Claude invocation", () => {
  it("includes --append-system-prompt and the worktree cwd", async () => {
    const context = {
      systemPrompt: "system context",
      openingTask: "Co-planning topic: x",
      byteSize: 14,
      sources: [],
    };
    const invocation = buildClaudeInvocation(context, "/tmp/worktree");
    expect(invocation.command).toBe("claude");
    expect(invocation.args).toEqual([
      "--append-system-prompt",
      "system context",
      "Co-planning topic: x",
    ]);
    expect(invocation.cwd).toBe("/tmp/worktree");
  });
});

describe("planning worktree lifecycle", () => {
  it("creates op/plan-<slug> off main and cleans it up", async () => {
    const app = makeGitApp();
    const worktree = await createPlanningWorktree(app, {
      slug: "stats percentile helper",
      parentDir: makeDir("operon-plan-wt-"),
    });

    expect(worktree.branch).toBe("op/plan-stats-percentile-helper");
    expect(existsSync(worktree.path)).toBe(true);
    expect(git(worktree.path, ["branch", "--show-current"]).trim()).toBe(worktree.branch);
    expect(git(worktree.path, ["rev-parse", "HEAD"]).trim()).toBe(
      git(app, ["rev-parse", "main"]).trim(),
    );

    await cleanupPlanningWorktree(worktree);
    expect(existsSync(worktree.path)).toBe(false);
    expect(git(app, ["branch", "--list", worktree.branch]).trim()).toBe("");
  });
});

describe("cmdPlan", () => {
  it("dry-run prints app, branch, topic, and context byte size without spawning", async () => {
    const orgHome = makeOrgHome();
    const app = makeGitApp();
    process.chdir(orgHome);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    const code = await cmdPlan([
      "operon-sandbox-alpha",
      "--topic",
      "stats percentile helper",
      "--dry-run",
      "--workdir",
      app,
    ]);

    expect(code).toBe(0);
    const out = log.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(out).toContain("plan app: operon-sandbox-alpha");
    expect(out).toContain("branch: op/plan-stats-percentile-helper");
    expect(out).toContain("topic: stats percentile helper");
    expect(out).toMatch(/context bytes: \d+/);
    expect(git(app, ["branch", "--list", "op/plan-stats-percentile-helper"]).trim()).toBe("");
  });
});
