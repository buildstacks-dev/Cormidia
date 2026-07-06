import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
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

  it("prints not-installed with install and load commands", () => {
    const home = makeOrgHome();
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      cmdDoctor({ launchAgentsDir: join(home.root, "LaunchAgents") });
      const output = spy.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(output).toContain("launchd not installed");
      expect(output).toContain("launchctl load");
    } finally {
      spy.mockRestore();
      home.cleanup();
    }
  });

  it("prints installed with unload command", () => {
    const dir = join(tmpdir(), `operon-launch-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "dev.operon.dispatch.plist"), "<plist/>", "utf8");
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      cmdDoctor({ launchAgentsDir: dir });
      const output = spy.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(output).toContain("launchd installed");
      expect(output).toContain("launchctl unload");
    } finally {
      spy.mockRestore();
    }
  });
});
