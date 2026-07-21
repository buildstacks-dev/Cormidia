// Tests the doctor CLI checks for scheduler install state and config health.
// Covers launchd plist linting, installed/not-installed messaging, parsing real
// repo config surfaces, and failing clearly when config is absent.
// Uses temp directories and one repo-local plist/config read; no network, auth,
// real org state, or meaningful wall-clock dependence is required.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { devNull, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { cmdDoctor } from "../src/cli/doctor.js";
import { makeOrgHome } from "./fixtures/orgHome.js";
import { installScheduler } from "../src/org/scheduler/lifecycle.js";
import { PlatformSchedulerManager } from "../src/org/scheduler/manager.js";

const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url));

describe("doctor scheduler status", () => {
  it("launchd template is valid plist", () => {
    const template = join(REPO_ROOT, "config/launchd/operon-dispatch.plist.template");
    if (process.platform === "darwin") {
      execFileSync("plutil", ["-lint", template], { encoding: "utf8" });
      return;
    }

    const python = process.platform === "win32" ? "python" : "python3";
    execFileSync(
      python,
      ["-c", "import plistlib, sys; plistlib.load(open(sys.argv[1], 'rb'))", template],
      { encoding: "utf8" },
    );
  });

  it("prints not-installed with install and load commands", async () => {
    const home = makeOrgHome();
    const manager = fakeManager(join(home.root, "LaunchAgents"));
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await cmdDoctor({
        orgHome: REPO_ROOT,
        stateHome: home.root,
        schedulerManager: manager,
        platform: "darwin",
        configOnly: true,
      });
      const output = spy.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(output).toContain("launchd not installed");
      expect(output).toContain("operon scheduler install");
    } finally {
      spy.mockRestore();
      home.cleanup();
    }
  });

  it("accepts an owned valid definition but config-only never claims execution health", async () => {
    const dir = mkdtempSync(join(tmpdir(), "operon-launch-"));
    const manager = fakeManager(dir);
    const packageEntryPath = existsSync(join(REPO_ROOT, "dist", "cli.js"))
      ? join(REPO_ROOT, "dist", "cli.js")
      : join(REPO_ROOT, "src", "cli.ts");
    const expected = await installScheduler({ backend: "launchd", orgName: "operon", orgHome: REPO_ROOT, stateHome: dir, packageEntryPath, manager });
    await installScheduler({ backend: "launchd", orgName: "operon", orgHome: REPO_ROOT, stateHome: dir, packageEntryPath, manager, execute: true, confirm: expected.scheduler_id });
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const code = await cmdDoctor({ orgHome: REPO_ROOT, stateHome: dir, schedulerManager: manager, platform: "darwin", configOnly: true });
      const output = spy.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(output).toContain("launchd installed");
      expect(output).toContain("execution health not inspected");
      expect(output).not.toContain("healthy; last tick");
      expect(code).toBe(0);
    } finally {
      spy.mockRestore();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

function fakeManager(definitionDir: string) {
  let active = false;
  return new PlatformSchedulerManager({
    backend: "launchd",
    platform: "darwin",
    definitionDir,
    supported: true,
    runHostCommand: async ({ args }) => {
      if (args[0] === "bootstrap") active = true;
      if (args[0] === "bootout") active = false;
      return args[0] === "print" && !active
        ? { code: 1, stdout: "", stderr: "inactive" }
        : { code: 0, stdout: active ? "active" : "", stderr: "" };
    },
  });
}

describe("doctor precondition checks", () => {
  it("actually verifies config surfaces and reports them at the org root", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const code = await cmdDoctor({
        orgHome: REPO_ROOT,
        stateHome: mkdtempSync(join(tmpdir(), "operon-doctor-state-")),
        launchAgentsDir: join(tmpdir(), "no-such-launch-agents"),
        configOnly: true,
      });
      const output = spy.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(output).toContain("config:");
      expect(output).toContain("roles.yaml");
      expect(output).toContain("pipelines.yaml");
      expect(output).toContain("legacy-conservative/v1");
      // Real repo root: every ratified config parses, so doctor is green.
      expect(code).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });

  it("exits non-zero and reports FAIL when the config surfaces are missing", async () => {
    const cwd = process.cwd();
    const empty = mkdtempSync(join(tmpdir(), "operon-doctor-empty-"));
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      process.chdir(empty);
      const code = await cmdDoctor({
        orgHome: empty,
        stateHome: join(empty, "state"),
        launchAgentsDir: join(empty, "LaunchAgents"),
        configOnly: true,
      });
      const output = spy.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(code).toBe(1);
      expect(output).toContain("FAIL");
    } finally {
      process.chdir(cwd);
      spy.mockRestore();
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it("probes only configured adapters and fails on an unauthenticated runtime", async () => {
    const calls: Array<{ runtime: string; models: string[] }> = [];
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const code = await cmdDoctor({
        orgHome: REPO_ROOT,
        stateHome: mkdtempSync(join(tmpdir(), "operon-doctor-readiness-")),
        launchAgentsDir: join(tmpdir(), "no-such-launch-agents"),
        readinessProbe: async (request) => {
          calls.push({ runtime: request.runtime, models: [...request.models] });
          return {
            runtime: request.runtime,
            models: [...request.models],
            billable: false,
            durationMs: 1,
            ...(request.runtime === "codex"
              ? {
                  status: "unauthenticated" as const,
                  errorCode: "error_adapter_unauthenticated",
                  detail: "App Server has no account",
                }
              : { status: "ready" as const, detail: "SDK account available" }),
          };
        },
      });
      const output = spy.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(code).toBe(1);
      expect(calls.map((call) => call.runtime).sort()).toEqual(["claude", "codex"]);
      expect(calls.every((call) => call.models.length > 0)).toBe(true);
      expect(output).toContain("unauthenticated");
      expect(output).toContain("not configured by any role; probe skipped");
    } finally {
      spy.mockRestore();
    }
  });
  // ISSUE-010: a per-turn budget cap stopped a builder and left a complete,
  // uncommitted migration in the org-managed clone. No command reported it, so
  // the next turn would have inherited an undefined tree.
  it("flags an org-managed clone with uncommitted work and names it without touching it", async () => {
    const stateHome = mkdtempSync(join(tmpdir(), "operon-doctor-clone-"));
    const clone = join(stateHome, "repos", "operon-sandbox-alpha");
    seedManagedClone(clone, { "astro.config.mjs": "export default {};\n" });
    const before = gitStatus(clone);
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const code = await cmdDoctor({
        orgHome: REPO_ROOT,
        stateHome,
        launchAgentsDir: join(stateHome, "LaunchAgents"),
        configOnly: true,
      });
      const output = spy.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(output).toContain("managed clones");
      expect(output).toContain("repos/operon-sandbox-alpha");
      expect(output).toContain("uncommitted work on main");
      expect(output).toContain("astro.config.mjs");
      expect(output).toContain("The next managed turn inherits this tree");
      expect(output).toContain(`git -C ${clone} status --short`);
      // Uncommitted work is a condition to surface, never a reason to fail
      // the installation check — and doctor must not have changed the tree.
      expect(code).toBe(0);
      expect(gitStatus(clone)).toBe(before);
    } finally {
      spy.mockRestore();
      rmSync(stateHome, { recursive: true, force: true });
    }
  });

  it("reports a clean clone as OK and an uncloned app as not-yet-cloned", async () => {
    // Adversarial near-miss: the warning must key on actual working-tree
    // state, not on the directory merely existing.
    const stateHome = mkdtempSync(join(tmpdir(), "operon-doctor-clean-"));
    const clone = join(stateHome, "repos", "operon-sandbox-alpha");
    seedManagedClone(clone, {});
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await cmdDoctor({
        orgHome: REPO_ROOT,
        stateHome,
        launchAgentsDir: join(stateHome, "LaunchAgents"),
        configOnly: true,
      });
      const output = spy.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(output).toContain("repos/operon-sandbox-alpha OK   — clean on main");
      expect(output).toContain("repos/operon-sandbox-beta OK   — not cloned yet");
      expect(output).not.toContain("uncommitted work");
    } finally {
      spy.mockRestore();
      rmSync(stateHome, { recursive: true, force: true });
    }
  });
});

const FIXTURE_GIT_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: devNull,
  GIT_CONFIG_SYSTEM: devNull,
  GIT_AUTHOR_NAME: "Operon Fixture",
  GIT_AUTHOR_EMAIL: "fixture@operon.invalid",
  GIT_COMMITTER_NAME: "Operon Fixture",
  GIT_COMMITTER_EMAIL: "fixture@operon.invalid",
  GIT_TERMINAL_PROMPT: "0",
};

function seedManagedClone(root: string, dirty: Record<string, string>): void {
  mkdirSync(root, { recursive: true });
  const run = (...args: string[]): void => {
    execFileSync("git", args, { cwd: root, env: FIXTURE_GIT_ENV, stdio: "ignore" });
  };
  run("init", "--initial-branch=main");
  writeFileSync(join(root, "README.md"), "# fixture\n");
  run("add", "-A");
  run("commit", "-m", "chore: init managed clone fixture");
  for (const [name, content] of Object.entries(dirty)) {
    writeFileSync(join(root, name), content);
  }
}

function gitStatus(root: string): string {
  return execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
    cwd: root,
    env: FIXTURE_GIT_ENV,
    encoding: "utf8",
  });
}
