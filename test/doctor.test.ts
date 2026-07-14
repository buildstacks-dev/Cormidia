// Tests the doctor CLI checks for scheduler install state and config health.
// Covers launchd plist linting, installed/not-installed messaging, parsing real
// repo config surfaces, and failing clearly when config is absent.
// Uses temp directories and one repo-local plist/config read; no network, auth,
// real org state, or meaningful wall-clock dependence is required.

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { cmdDoctor } from "../src/cli/doctor.js";
import { makeOrgHome } from "./fixtures/orgHome.js";

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
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await cmdDoctor({
        orgHome: REPO_ROOT,
        stateHome: home.root,
        launchAgentsDir: join(home.root, "LaunchAgents"),
        configOnly: true,
      });
      const output = spy.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(output).toContain("launchd not installed");
      expect(output).toContain("launchctl load");
    } finally {
      spy.mockRestore();
      home.cleanup();
    }
  });

  it("prints installed with unload command", async () => {
    const dir = join(tmpdir(), `operon-launch-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "dev.operon.dispatch.plist"), "<plist/>", "utf8");
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await cmdDoctor({ orgHome: REPO_ROOT, stateHome: dir, launchAgentsDir: dir, configOnly: true });
      const output = spy.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(output).toContain("launchd installed");
      expect(output).toContain("launchctl unload");
    } finally {
      spy.mockRestore();
    }
  });
});

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
});
