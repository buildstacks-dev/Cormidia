// Tests the planner co-planning launcher in src/org/plan.ts and cmdPlan.
// Covers planning context assembly, Claude invocation arguments, temporary
// planning worktree creation/cleanup, dry-run output, and sibling checkout
// resolution.
// Uses local temp git repos and mocked console output; no network, auth, real
// org state, or live wall clock is required.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import {
  assemblePlanningContext,
  buildClaudeInvocation,
  cleanupPlanningWorktree,
  createPlanningWorktree,
  spawnClaude,
} from "../src/org/plan.js";
import { cmdPlan, formatPlanTicketSummary } from "../src/cli/plan.js";
import type { RoleConfig } from "../src/runtime/types.js";
import type { PlanTicket } from "../src/loop/plan-tickets.js";

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
  initGitApp(root, withCharter);
  return root;
}

function makeGitAppAt(root: string, withCharter = true): string {
  mkdirSync(root, { recursive: true });
  initGitApp(root, withCharter);
  return root;
}

/** An app checkout backed by a real (local, bare) origin.
 *
 * Interactive planning fetches and resolves the remote default branch before
 * cutting its worktree (#60), so a standalone repo with no origin is no longer
 * a valid planning source. `second` is an independent checkout of the same
 * origin, used to land commits that exist ONLY on the remote — that is how a
 * stale managed clone is modelled without any network. */
interface RemoteBackedApp {
  bare: string;
  clone: string;
  second: string;
}

function makeRemoteBackedApp(defaultBranch = "main", withCharter = true): RemoteBackedApp {
  return makeRemoteBackedAppAt(makeDir("operon-plan-remote-"), defaultBranch, withCharter);
}

function makeRemoteBackedAppAt(
  cloneRoot: string,
  defaultBranch = "main",
  withCharter = true,
): RemoteBackedApp {
  const host = makeDir("operon-plan-origin-");
  const bare = join(host, "origin.git");
  execFileSync("git", ["init", "--bare", `--initial-branch=${defaultBranch}`, bare], {
    encoding: "utf8",
  });

  // Seed the default branch on origin through a throwaway checkout.
  const seed = join(host, "seed");
  execFileSync("git", ["clone", bare, seed], { encoding: "utf8" });
  git(seed, ["config", "user.email", "test@example.com"]);
  git(seed, ["config", "user.name", "Operon Test"]);
  write(seed, "README.md", "# app\n");
  if (withCharter) write(seed, ".operon/TASTE.md", "# App Charter\n\nShip small.\n");
  git(seed, ["add", "."]);
  git(seed, ["commit", "-m", "initial"]);
  git(seed, ["push", "-u", "origin", defaultBranch]);

  mkdirSync(dirname(cloneRoot), { recursive: true });
  rmSync(cloneRoot, { recursive: true, force: true });
  execFileSync("git", ["clone", bare, cloneRoot], { encoding: "utf8" });
  git(cloneRoot, ["config", "user.email", "test@example.com"]);
  git(cloneRoot, ["config", "user.name", "Operon Test"]);

  const second = join(host, "second");
  execFileSync("git", ["clone", bare, second], { encoding: "utf8" });
  git(second, ["config", "user.email", "test@example.com"]);
  git(second, ["config", "user.name", "Operon Test"]);

  return { bare, clone: cloneRoot, second };
}

function initGitApp(root: string, withCharter = true): void {
  git(root, ["init", "--initial-branch=main"]);
  git(root, ["config", "user.email", "test@example.com"]);
  git(root, ["config", "user.name", "Operon Test"]);
  write(root, "README.md", "# app\n");
  if (withCharter) write(root, ".operon/TASTE.md", "# App Charter\n\nShip small.\n");
  git(root, ["add", "."]);
  git(root, ["commit", "-m", "initial"]);
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
  write(
    root,
    "pipelines.yaml",
    "plan:\n  passes:\n    - id: plan\n      role: planner\n      template: plan.md\n",
  );
  write(root, "prompts/plan.md", "Plan the requested work.\n");
  return root;
}

const PLANNER: RoleConfig = {
  name: "planner",
  runtime: "claude",
  model: "claude-opus-4-8",
  effort: "high",
  delegation: { allow: [] },
  triggers: [{ manual: true }],
  outputs: ["tickets"],
  maxTurnBudgetUsd: 5,
};

describe("assemblePlanningContext", () => {
  it("concatenates shared context layers and keeps the topic as task text", async () => {
    const orgHome = makeOrgHome();
    const app = makeGitApp(true);
    const context = await assemblePlanningContext({
      orgHome,
      appWorkdir: app,
      app: "operon-sandbox-alpha",
      role: PLANNER,
      topic: "stats percentile helper",
    });

    expect(context.systemPrompt).toContain("# Org Taste");
    expect(context.systemPrompt).toContain("# App Charter");
    expect(context.systemPrompt).toContain("## Role turn protocol");
    expect(context.systemPrompt).toContain("- tickets");
    expect(context.systemPrompt).not.toContain("stats percentile helper");
    expect(context.openingTask).toBe("Co-planning topic: stats percentile helper");
    expect(context.byteSize).toBe(Buffer.byteLength(context.systemPrompt, "utf8"));
  });

  it("omits the app charter layer when .operon/TASTE.md is absent", async () => {
    const orgHome = makeOrgHome();
    const app = makeGitApp(false);
    const context = await assemblePlanningContext({
      orgHome,
      appWorkdir: app,
      app: "operon-sandbox-beta",
      role: PLANNER,
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

  it.skipIf(process.platform === "win32")(
    "cancellation terminates the native CLI process group, including descendants",
    async () => {
      const root = makeDir("operon-plan-process-group-");
      const pidFile = join(root, "descendant.pid");
      const script = join(root, "parent.cjs");
      writeFileSync(
        script,
        [
          "const { spawn } = require('node:child_process');",
          "const { writeFileSync } = require('node:fs');",
          "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });",
          "writeFileSync(process.argv[2], String(child.pid));",
          "setInterval(() => {}, 1000);",
          "",
        ].join("\n"),
      );
      const controller = new AbortController();
      const running = spawnClaude(
        { command: process.execPath, args: [script, pidFile], cwd: root },
        controller.signal,
      );
      await pollUntil(() => existsSync(pidFile), 1_000);
      const descendantPid = Number(readFileSync(pidFile, "utf8"));
      expect(processAlive(descendantPid)).toBe(true);

      controller.abort({
        status: "cancelled",
        errorCode: "error_cancelled",
        reason: "operator cancellation (SIGTERM)",
      });
      expect(await running).toBe(143);
      await pollUntil(() => !processAlive(descendantPid), 2_500);
      expect(processAlive(descendantPid)).toBe(false);
    },
    5_000,
  );
});

async function pollUntil(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`condition not met within ${timeoutMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe("planning worktree lifecycle", () => {
  // The fixture is now a real bare+clone pair rather than a standalone repo:
  // #60 requires the interactive planning worktree to be cut from the *fetched*
  // remote default-branch tip, so a source with no remote is no longer a valid
  // input — an unfetchable source must stop the session, not launch it.
  it("creates op/plan-<slug> off the fetched default-branch tip and cleans it up", async () => {
    const { clone } = makeRemoteBackedApp("main");
    const worktree = await createPlanningWorktree(clone, {
      slug: "stats percentile helper",
      parentDir: makeDir("operon-plan-wt-"),
    });

    expect(worktree.branch).toBe("op/plan-stats-percentile-helper");
    expect(worktree.base).toEqual({ ref: "origin/main", defaultBranch: "main" });
    expect(existsSync(worktree.path)).toBe(true);
    expect(git(worktree.path, ["branch", "--show-current"]).trim()).toBe(worktree.branch);
    expect(git(worktree.path, ["rev-parse", "HEAD"]).trim()).toBe(
      git(clone, ["rev-parse", "origin/main"]).trim(),
    );

    await cleanupPlanningWorktree(worktree);
    expect(existsSync(worktree.path)).toBe(false);
    expect(git(clone, ["branch", "--list", worktree.branch]).trim()).toBe("");
  });

  // The #60 defect itself: the managed clone is behind its remote, and the
  // session used to plan against the stale local branch with nothing saying so.
  it("plans against the remote tip when the local clone is behind (#60)", async () => {
    const { bare, clone, second } = makeRemoteBackedApp("main");

    // A change lands on the remote from elsewhere; our clone never fetched it.
    write(second, "PRODUCT.md", "# shipped after the clone went stale\n");
    git(second, ["add", "."]);
    git(second, ["commit", "-m", "feat: land real product truth"]);
    git(second, ["push", "origin", "main"]);
    const remoteTip = git(second, ["rev-parse", "HEAD"]).trim();

    const staleLocal = git(clone, ["rev-parse", "main"]).trim();
    expect(staleLocal).not.toBe(remoteTip);

    const worktree = await createPlanningWorktree(clone, {
      slug: "stale check",
      parentDir: makeDir("operon-plan-wt-"),
    });

    // The session sees the remote tip, not the stale local branch...
    expect(git(worktree.path, ["rev-parse", "HEAD"]).trim()).toBe(remoteTip);
    // ...and the product truth that only exists on the remote is actually there.
    expect(existsSync(join(worktree.path, "PRODUCT.md"))).toBe(true);
    // The stale local branch is genuinely still stale — the worktree was cut
    // from the fetched remote-tracking ref, not from a silently reset branch.
    expect(git(clone, ["rev-parse", "main"]).trim()).toBe(staleLocal);
    expect(bare).toContain("origin.git");

    await cleanupPlanningWorktree(worktree);
  });

  // Non-main default branches: the hardcoded `main` failed these outright.
  for (const branch of ["master", "trunk"]) {
    it(`cuts the planning worktree from a ${branch} default branch (#60/#101)`, async () => {
      const { clone } = makeRemoteBackedApp(branch);
      const worktree = await createPlanningWorktree(clone, {
        slug: `plan on ${branch}`,
        parentDir: makeDir("operon-plan-wt-"),
      });

      expect(worktree.base).toEqual({ ref: `origin/${branch}`, defaultBranch: branch });
      expect(git(worktree.path, ["rev-parse", "HEAD"]).trim()).toBe(
        git(clone, ["rev-parse", `origin/${branch}`]).trim(),
      );

      await cleanupPlanningWorktree(worktree);
    });
  }

  // Fail safely: no stale worktree may be launched when the remote is
  // unreachable or the default branch cannot be resolved.
  it("refuses to launch a session when the remote cannot be resolved", async () => {
    const orphan = makeGitApp();
    const parentDir = makeDir("operon-plan-wt-");

    await expect(
      createPlanningWorktree(orphan, { slug: "no remote", parentDir }),
    ).rejects.toThrow(/plan: cannot resolve the default branch/i);

    // Nothing half-built was left behind for an operator to wander into.
    expect(existsSync(join(parentDir, "op-plan-no-remote"))).toBe(false);
    expect(git(orphan, ["branch", "--list", "op/plan-no-remote"]).trim()).toBe("");
  });

  it("refuses to launch a session when the fetch fails", async () => {
    const { clone } = makeRemoteBackedApp("main");
    // Point origin at a path that no longer exists: resolution and fetch both
    // fail, and the failure must surface before any worktree is created.
    git(clone, ["remote", "set-url", "origin", join(makeDir("operon-plan-gone-"), "missing.git")]);
    const parentDir = makeDir("operon-plan-wt-");

    await expect(
      createPlanningWorktree(clone, { slug: "dead remote", parentDir }),
    ).rejects.toThrow(/plan:/i);
    expect(git(clone, ["branch", "--list", "op/plan-dead-remote"]).trim()).toBe("");
  });
});

describe("cmdPlan", () => {
  it("console ticket summaries show final tier, requested tier, and escalation reason", () => {
    const ticket: PlanTicket = {
      title: "Store submissions",
      tier: "op:tier-deep",
      priority: "p1",
      dependsOn: [],
      executionGroup: "storage",
      fileScope: ["src/storage.ts"],
      goal: "Store user data",
      context: "Contact form",
      acceptanceCriteria: ["submissions persist"],
      outOfScope: "analytics",
      notesForBuilder: "bounded",
    };
    const line = formatPlanTicketSummary(0, ticket, {
      index: 0,
      ticket,
      requestedTier: "op:tier-standard",
      finalTier: "op:tier-deep",
      escalationReason: "sensitive-domain floor: data",
      domainLabels: ["domain:data"],
      labels: ["op:tier-deep", "p1", "domain:data", "op:ready"],
      ready: true,
    });
    expect(line).toContain("[op:tier-deep/p1]");
    expect(line).toContain("requested op:tier-standard");
    expect(line).toContain("sensitive-domain floor: data");
  });

  it("auto dry-run is token-free even when the legacy org has no plan-bootstrap pipeline", async () => {
    const orgHome = makeOrgHome();
    const app = makeGitApp();
    process.chdir(orgHome);
    const stateHome = makeDir("operon-plan-auto-dry-state-");
    const before = git(app, ["status", "--porcelain=v2", "--branch"]);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    const code = await cmdPlan([
      "operon-sandbox-alpha",
      "--auto",
      "--goal",
      "add one bounded helper",
      "--dry-run",
      "--workdir",
      app,
      "--org-home",
      orgHome,
      "--state-home",
      stateHome,
    ]);

    expect(code).toBe(0);
    expect(log.mock.calls.map((call) => call.join(" ")).join("\n")).toContain(
      "dry-run",
    );
    expect(log.mock.calls.map((call) => call.join(" ")).join("\n")).toContain(
      "planning depth: quick",
    );
    expect(existsSync(join(stateHome, "runs"))).toBe(false);
    expect(existsSync(join(stateHome, "telemetry"))).toBe(false);
    expect(git(app, ["status", "--porcelain=v2", "--branch"])).toBe(before);
  });

  it("auto dry-run keeps short auth work at quick planning while preserving the deep execution route", async () => {
    const orgHome = makeOrgHome();
    const app = makeGitApp();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const stateHome = makeDir("operon-plan-security-dry-state-");

    const code = await cmdPlan([
      "operon-sandbox-alpha",
      "--auto",
      "--goal",
      "Migrate auth keys",
      "--depth",
      "quick",
      "--work-lifecycle",
      "bounded-goal",
      "--sensitive-domains",
      "security/auth/secrets",
      "--dry-run",
      "--workdir",
      app,
      "--org-home",
      orgHome,
      "--state-home",
      stateHome,
    ]);

    expect(code).toBe(0);
    const out = log.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(out).toContain("planning depth: quick");
    expect(out).toContain("execution route: deep");
    expect(out).toContain("selected passes: decomposer");
    expect(existsSync(join(stateHome, "runs"))).toBe(false);
  });

  it("JSON dry-run explains direct existing-ticket admission with zero planning passes", async () => {
    const orgHome = makeOrgHome();
    const app = makeGitApp();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const stateHome = makeDir("operon-plan-direct-json-state-");

    const code = await cmdPlan([
      "operon-sandbox-alpha",
      "--auto",
      "--goal",
      "Issue #7 already has file scope and binary criteria",
      "--work-lifecycle",
      "existing-ticket",
      "--dry-run",
      "--json",
      "--workdir",
      app,
      "--org-home",
      orgHome,
      "--state-home",
      stateHome,
    ]);

    expect(code).toBe(0);
    const output = log.mock.calls.map((call) => call.join(" ")).join("\n");
    const parsed = JSON.parse(output) as {
      decision: { disposition: string };
      planningRoute: { selectedPasses: string[]; passRationales: unknown[] };
      effects: unknown[];
    };
    expect(parsed.decision.disposition).toBe("direct-execution");
    expect(parsed.planningRoute.selectedPasses).toEqual([]);
    expect(parsed.planningRoute.passRationales).toEqual([]);
    expect(parsed.effects).toEqual([]);
    expect(existsSync(join(stateHome, "runs"))).toBe(false);
  });

  it("auto dry-run preserves repeatable required and optional planning-source declarations", async () => {
    const orgHome = makeOrgHome();
    const app = makeGitApp();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const stateHome = makeDir("operon-plan-sources-json-state-");

    const code = await cmdPlan([
      "operon-sandbox-alpha",
      "--auto",
      "--goal",
      "ship the supplied design",
      "--work-lifecycle",
      "bounded-goal",
      "--source",
      "docs/spec.md",
      "--optional-source",
      "/tmp/research.md",
      "--dry-run",
      "--json",
      "--workdir",
      app,
      "--org-home",
      orgHome,
      "--state-home",
      stateHome,
    ]);

    expect(code).toBe(0);
    const parsed = JSON.parse(log.mock.calls.map((call) => call.join(" ")).join("\n")) as {
      planningSources: Array<{ path: string; requirement: string }>;
    };
    expect(parsed.planningSources).toEqual([
      { path: "docs/spec.md", requirement: "required" },
      { path: "/tmp/research.md", requirement: "optional" },
    ]);
    expect(existsSync(join(stateHome, "runs"))).toBe(false);
  });

  it("rejects --auto combined with --explain-route loudly instead of silently dropping the plan (L-008)", async () => {
    // The live campaign ran the documented `--auto --goal … --explain-route`
    // combination: exit 0, route JSON, zero tickets, zero spend, no warning.
    // A guard that cannot honor both instructions must not silently pick one.
    const orgHome = makeOrgHome();
    const stateHome = makeDir("operon-plan-explain-auto-state-");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(
      cmdPlan([
        "operon-sandbox-alpha",
        "--auto",
        "--goal",
        "ship the deliverable",
        "--explain-route",
        "--org-home",
        orgHome,
        "--state-home",
        stateHome,
      ]),
    ).rejects.toThrow(/--explain-route.*--auto|--auto.*--explain-route/);
    // Nothing was printed as if planning (or a preview) had happened.
    expect(log).not.toHaveBeenCalled();
    expect(existsSync(join(stateHome, "runs"))).toBe(false);
  });

  it("--explain-route without --auto still prints the token-free route preview", async () => {
    const orgHome = makeOrgHome();
    const stateHome = makeDir("operon-plan-explain-state-");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    const code = await cmdPlan([
      "operon-sandbox-alpha",
      "--explain-route",
      "--goal",
      "ship the deliverable",
      "--org-home",
      orgHome,
      "--state-home",
      stateHome,
    ]);

    expect(code).toBe(0);
    const out = log.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(out).toContain('"kind": "route-explanation"');
    expect(out).toContain('"passRationales"');
    expect(existsSync(join(stateHome, "runs"))).toBe(false);
  });

  it("dry-run prints app, branch, topic, and context byte size without spawning", async () => {
    const orgHome = makeOrgHome();
    // Remote-backed: planning now fetches and resolves the default branch
    // before cutting its worktree (#60), so the source needs a real origin.
    const app = makeRemoteBackedApp().clone;
    process.chdir(orgHome);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    const code = await cmdPlan([
      "operon-sandbox-alpha",
      "--topic",
      "stats percentile helper",
      "--dry-run",
      "--workdir",
      app,
      "--org-home",
      orgHome,
      "--state-home",
      makeDir("operon-plan-state-"),
    ]);

    expect(code).toBe(0);
    const out = log.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(out).toContain("plan app: operon-sandbox-alpha");
    expect(out).toContain("branch: op/plan-stats-percentile-helper");
    expect(out).toContain("topic: stats percentile helper");
    expect(out).toMatch(/context bytes: \d+/);
    expect(git(app, ["branch", "--list", "op/plan-stats-percentile-helper"]).trim()).toBe("");
  });

  it("dry-run resolves a sibling app checkout when --workdir is omitted", async () => {
    const parent = makeDir("operon-plan-parent-");
    const orgHome = join(parent, "Operon");
    mkdirSync(orgHome, { recursive: true });
    write(orgHome, "TASTE.md", "# Org Taste\n\nBe precise.\n");
    write(
      orgHome,
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
      orgHome,
      "pipelines.yaml",
      "plan:\n  passes:\n    - id: plan\n      role: planner\n      template: plan.md\n",
    );
    write(orgHome, "prompts/plan.md", "Plan the requested work.\n");
    write(
      orgHome,
      "apps.yaml",
      `org: {name: operon, max_concurrent_turns: 2}
defaults: {budget_usd_month: 1000}
apps:
  operon-sandbox-alpha:
    repo: owner/operon-sandbox-alpha
    status: onboarding
    cadence: {}
`,
    );
    // The sibling checkout is discovered by path, but it is still a planning
    // source and so still needs a resolvable origin (#60).
    const app = makeRemoteBackedAppAt(join(parent, "operon-sandbox-alpha")).clone;
    process.chdir(orgHome);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    const code = await cmdPlan([
      "operon-sandbox-alpha",
      "--dry-run",
      "--org-home",
      orgHome,
      "--state-home",
      makeDir("operon-plan-sibling-state-"),
    ]);

    expect(code).toBe(0);
    const out = log.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(out).toContain("plan app: operon-sandbox-alpha");
    expect(out).toContain("branch: op/plan-operon-sandbox-alpha");
    expect(git(app, ["branch", "--list", "op/plan-operon-sandbox-alpha"]).trim()).toBe("");
  });
});
