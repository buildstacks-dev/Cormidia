// Tests the doctor CLI checks for scheduler install state and config health.
// Covers launchd plist linting, installed/not-installed messaging, parsing real
// repo config surfaces, and failing clearly when config is absent.
// Uses temp directories and one repo-local plist/config read; no network, auth,
// real org state, or meaningful wall-clock dependence is required.

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { cmdDoctor } from "../src/cli/doctor.js";
import { makeOrgHome } from "./fixtures/orgHome.js";

describe("doctor scheduler status", () => {
  it("launchd template is valid plist", () => {
    execFileSync("plutil", ["-lint", "config/launchd/operon-dispatch.plist.template"], {
      encoding: "utf8",
    });
  });

  it("prints not-installed with install and load commands", async () => {
    const home = makeOrgHome();
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await cmdDoctor({ launchAgentsDir: join(home.root, "LaunchAgents") });
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
      await cmdDoctor({ launchAgentsDir: dir });
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
      const code = await cmdDoctor({ launchAgentsDir: join(tmpdir(), "no-such-launch-agents") });
      const output = spy.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(output).toContain("config:");
      expect(output).toContain("roles.yaml");
      expect(output).toContain("pipelines.yaml");
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
      const code = await cmdDoctor({ launchAgentsDir: join(empty, "LaunchAgents") });
      const output = spy.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(code).toBe(1);
      expect(output).toContain("FAIL");
    } finally {
      process.chdir(cwd);
      spy.mockRestore();
      rmSync(empty, { recursive: true, force: true });
    }
  });
});
