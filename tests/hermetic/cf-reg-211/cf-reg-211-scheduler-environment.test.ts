// Traceability: CF-REG-211 · HB-139 · case-catalog.md §10.3.

// #211 — the scheduler definition owns its environment. Required binaries
// are resolved at install time and verified under that exact PATH.

import { afterEach, describe, expect, it } from "vitest";
import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { buildSchedulerExpectation } from "../../../src/org/scheduler/definition.js";
import { assertScheduledRequiredExecutables, resolveExecutableOnPath } from "../../../src/org/scheduler/environment.js";
import { installScheduler, schedulerDefinitionStatus } from "../../../src/org/scheduler/lifecycle.js";
import type { SchedulerManager, SchedulerManagerInspection } from "../../../src/org/scheduler/manager.js";
import { makeTempStateHome, type TempStateHome } from "../../fixtures/state-home.js";

class FakeManager implements SchedulerManager {
  readonly backend = "launchd" as const;
  readonly platform = "darwin" as const;
  readonly supported = true;
  definition: string | undefined;
  constructor(readonly root: string) {}
  definitionPath(id: string): string {
    return join(this.root, `${id}.plist`);
  }
  async readDefinition(): Promise<string | undefined> {
    return this.definition;
  }
  async writeDefinition(_id: string, value: string): Promise<void> {
    this.definition = value;
  }
  async removeDefinition(): Promise<void> {
    this.definition = undefined;
  }
  async enable(): Promise<void> {}
  async disable(): Promise<void> {}
  async inspect(): Promise<SchedulerManagerInspection> {
    return this.definition === undefined
      ? { installed: false, loaded: false, active: false, detail: "absent" }
      : { installed: true, loaded: true, active: true, detail: "active" };
  }
}

class MissingSchedulerToolViolation extends Error {}

function assertDefinitionResolves(tool: string, path: string): void {
  if (resolveExecutableOnPath(tool, path) === undefined) throw new MissingSchedulerToolViolation();
}

describe("CF-REG-211 — scheduler-owned executable environment", () => {
  let home: TempStateHome | undefined;
  afterEach(async () => {
    await home?.cleanup();
    home = undefined;
  });

  async function world() {
    home = await makeTempStateHome({ name: "scheduler-environment" });
    const root = dirname(home.stateHome);
    const orgHome = join(root, "org");
    const bin = join(root, "tools", "bin");
    const gh = join(bin, "gh");
    const node = join(bin, "node");
    const entry = join(root, "dist", "cli.js");
    await mkdir(orgHome, { recursive: true });
    await mkdir(bin, { recursive: true });
    await mkdir(dirname(entry), { recursive: true });
    for (const path of [gh, node]) {
      await writeFile(path, "#!/bin/sh\nexit 0\n", "utf8");
      await chmod(path, 0o755);
    }
    await writeFile(entry, "// fixture\n", "utf8");
    const manager = new FakeManager(join(root, "definitions"));
    const input = {
      backend: "launchd" as const,
      orgName: "scheduler-environment",
      orgHome,
      stateHome: home.stateHome,
      packageEntryPath: entry,
      executablePath: node,
      cadenceMinutes: 5,
      environmentPath: "/usr/bin:/bin",
      requiredExecutables: { gh },
      manager,
      now: () => new Date("2026-08-03T12:00:00.000Z"),
    };
    return { input, manager, gh, bin };
  }

  it("renders an explicit PATH that resolves every recorded required executable", async () => {
    const { input, gh, bin } = await world();
    const expected = buildSchedulerExpectation(input);

    expect(expected.command.environment.PATH.split(":")[0]).toBe(bin);
    expect(expected.command.requiredExecutables).toEqual({ gh });
    expect(resolveExecutableOnPath("gh", expected.command.environment.PATH)).toBe(gh);
    expect(expected.definition).toContain("EnvironmentVariables");
    expect(expected.definition).toContain("CORMIDIA_SCHEDULER_REQUIRED_EXECUTABLES");
  });

  it("fails fast when a scheduled process cannot resolve its recorded gh path", async () => {
    const { gh } = await world();
    expect(() =>
      assertScheduledRequiredExecutables({
        PATH: "/usr/bin:/bin",
        CORMIDIA_SCHEDULER_REQUIRED_EXECUTABLES: JSON.stringify({ gh }),
      }),
    ).toThrow("required tool 'gh' not found on scheduled-turn PATH");
  });

  it("makes the doctor-owned definition status fail after a required tool disappears", async () => {
    const { input, manager, gh } = await world();
    const expected = buildSchedulerExpectation(input);
    await installScheduler({ ...input, execute: true, confirm: expected.metadata.scheduler_id });
    await rm(gh);

    const status = await schedulerDefinitionStatus(input);
    expect(status.reason_codes).toContain("missing_required_executable");
    expect(status.definition_valid).toBe(false);
    expect(status.detail.join("\n")).toContain("required tool 'gh'");
    expect(manager.definition).toBeDefined();
  });

  it("negative control: the detector fires for launchd's minimal PATH", () => {
    expect(() => assertDefinitionResolves("gh", "/path/that/does/not/exist")).toThrow(MissingSchedulerToolViolation);
  });
});
