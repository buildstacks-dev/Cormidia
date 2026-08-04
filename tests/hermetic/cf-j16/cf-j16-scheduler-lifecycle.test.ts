// HB-043 — CF-J16-S/R/I and CF-C-B05 scheduler-host lifecycle.

import { afterEach, describe, expect, it } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { buildSchedulerExpectation } from "../../../src/org/scheduler/definition.js";
import {
  installScheduler,
  schedulerDefinitionStatus,
  schedulerInstallationPath,
  schedulerTransactionPath,
  uninstallScheduler,
} from "../../../src/org/scheduler/lifecycle.js";
import type { SchedulerManager, SchedulerManagerInspection } from "../../../src/org/scheduler/manager.js";
import { schedulerOperationalStatus } from "../../../src/org/scheduler/status.js";
import { SchedulerEvidenceStore } from "../../../src/org/scheduler/evidence.js";
import { schedulerIdentity } from "../../../src/org/scheduler/model.js";
import { makeTempStateHome, type TempStateHome } from "../../fixtures/state-home.js";

class FakeSchedulerManager implements SchedulerManager {
  readonly backend = "launchd" as const;
  readonly platform = "darwin" as const;
  readonly supported = true;
  definition: string | undefined;
  loaded = false;
  active = false;
  writes = 0;
  enables = 0;
  disables = 0;
  removes = 0;

  constructor(readonly dir: string) {}
  definitionPath(id: string): string { return join(this.dir, `${id}.plist`); }
  async readDefinition(): Promise<string | undefined> { return this.definition; }
  async writeDefinition(_id: string, definition: string): Promise<void> { this.definition = definition; this.writes += 1; }
  async removeDefinition(): Promise<void> { this.definition = undefined; this.removes += 1; }
  async enable(): Promise<void> { this.loaded = true; this.active = true; this.enables += 1; }
  async disable(): Promise<void> { this.loaded = false; this.active = false; this.disables += 1; }
  async inspect(): Promise<SchedulerManagerInspection> {
    return this.definition === undefined
      ? { installed: false, loaded: false, active: false, detail: "definition absent" }
      : { installed: true, loaded: this.loaded, active: this.active, detail: this.active ? "active" : "present but inactive" };
  }
}

const homes: TempStateHome[] = [];
afterEach(async () => Promise.all(homes.splice(0).map((home) => home.cleanup())));

async function world(orgName = "scheduler-org") {
  const home = await makeTempStateHome({ name: orgName });
  homes.push(home);
  const root = dirname(home.stateHome);
  const orgHome = join(root, "org");
  const manager = new FakeSchedulerManager(join(root, "definitions"));
  await mkdir(orgHome, { recursive: true });
  const input = {
    backend: "launchd" as const,
    orgName,
    orgHome,
    stateHome: home.stateHome,
    packageEntryPath: resolve("src/cli.ts"),
    executablePath: process.execPath,
    cadenceMinutes: 5,
    manager,
    now: () => new Date("2026-07-31T12:00:00.000Z"),
  };
  return { home, orgHome, manager, input };
}

describe("HB-043 scheduler lifecycle", () => {
  it("previews without writes, requires exact confirmation, installs idempotently, and uninstalls exactly once", async () => {
    const { home, manager, input } = await world();
    const preview = await installScheduler(input);
    expect(preview).toMatchObject({ mode: "preview", action: "install", changed: false, writes_planned: true });
    expect(manager.definition).toBeUndefined();
    expect(await fileExists(schedulerTransactionPath(home.stateHome))).toBe(false);

    await expect(installScheduler({ ...input, execute: true, confirm: "wrong" })).rejects.toThrow("--confirm must exactly equal");
    expect(manager.definition).toBeUndefined();

    const installed = await installScheduler({ ...input, execute: true, confirm: preview.scheduler_id });
    expect(installed).toMatchObject({ action: "install", changed: true });
    expect(manager.enables).toBe(1);
    expect(await fileExists(schedulerInstallationPath(home.stateHome))).toBe(true);
    expect(manager.definition).toContain(resolve(input.orgHome));
    expect(manager.definition).toContain(resolve(input.stateHome));
    expect(manager.definition).not.toContain("process.env");
    expect(manager.definition).not.toContain("API_KEY");

    const rerun = await installScheduler({ ...input, execute: true, confirm: preview.scheduler_id });
    expect(rerun).toMatchObject({ action: "noop", changed: false });
    expect(manager.writes).toBe(1);

    const uninstallPreview = await uninstallScheduler(input);
    expect(uninstallPreview).toMatchObject({ mode: "preview", action: "uninstall", changed: false });
    expect(manager.definition).toBeDefined();
    const removed = await uninstallScheduler({ ...input, execute: true, confirm: input.orgName });
    expect(removed).toMatchObject({ action: "uninstall", changed: true });
    expect(manager.removes).toBe(1);
    expect((await uninstallScheduler(input)).action).toBe("noop");
  });

  it("refuses foreign/wrong-org definitions and repairs owned definition drift by unload/reload", async () => {
    const { manager, input } = await world();
    manager.definition = "# foreign scheduler definition\n";
    expect(await installScheduler(input)).toMatchObject({ action: "refuse", reason_codes: ["ownership_mismatch"] });
    expect(manager.writes).toBe(0);

    manager.definition = buildSchedulerExpectation({ ...input, orgName: "other-org" }).definition;
    const wrong = await schedulerDefinitionStatus(input);
    expect(wrong.reason_codes).toContain("wrong_org");
    expect((await installScheduler(input)).action).toBe("refuse");

    manager.definition = undefined;
    const expected = buildSchedulerExpectation(input);
    await installScheduler({ ...input, execute: true, confirm: expected.metadata.scheduler_id });
    manager.definition = `${manager.definition!}\n# owned drift\n`;
    const repair = await installScheduler({ ...input, execute: true, confirm: expected.metadata.scheduler_id });
    expect(repair.reason_codes).toContain("stale_definition");
    expect(repair).toMatchObject({ action: "repair", changed: true });
    expect(manager.disables).toBe(1);
    expect(manager.enables).toBe(2);
  });

  it("names inactive, unmeasured, duplicate, and orphan evidence as blocking health states", async () => {
    const { home, manager, input } = await world();
    const expected = buildSchedulerExpectation(input);
    await installScheduler({ ...input, execute: true, confirm: expected.metadata.scheduler_id });
    manager.active = false;
    manager.loaded = false;
    const inactive = await schedulerOperationalStatus({ ...input, now: input.now() });
    expect(inactive.healthy).toBe(false);
    expect(inactive.reason_codes).toEqual(expect.arrayContaining(["inactive", "measurement_unavailable"]));

    manager.active = true;
    manager.loaded = true;
    const decisions = join(home.stateHome, "scheduler", "evidence", "decisions");
    await mkdir(decisions, { recursive: true });
    const duplicate = {
      schema_version: 1,
      decision_id: "decision_duplicate",
      invocation_id: "tick_missing",
      app: "app",
      role: "sre",
      stage: "terminal",
      trigger: "hourly",
      episode_id: "scheduled_duplicate",
      outcome: "skipped",
      reason_code: "no_due_work",
      provider_turns: 0,
      provider_settlements: 0,
    };
    await writeFile(join(decisions, "one.json"), JSON.stringify(duplicate) + "\n", "utf8");
    await writeFile(join(decisions, "two.json"), JSON.stringify(duplicate) + "\n", "utf8");
    const locks = join(home.stateHome, "locks");
    await mkdir(locks, { recursive: true });
    await writeFile(join(locks, "orphan.lock"), JSON.stringify({ turnId: "scheduled_orphan" }) + "\n", "utf8");

    const integrity = await schedulerOperationalStatus({ ...input, now: input.now() });
    expect(integrity.healthy).toBe(false);
    expect(integrity.reason_codes).toEqual(expect.arrayContaining([
      "duplicate_scheduler_decision",
      "duplicate_scheduler_episode",
      "orphan_scheduler_lock",
    ]));
    expect(integrity.blocking_reasons).toEqual(expect.arrayContaining([
      "duplicate_scheduler_decision",
      "orphan_scheduler_lock",
    ]));
  });

  it("does not present stale runtime failure reasons as current after intentional uninstall", async () => {
    const { manager, input } = await world("stopped-org");
    const expected = buildSchedulerExpectation(input);
    await installScheduler({ ...input, execute: true, confirm: expected.metadata.scheduler_id });
    const evidence = new SchedulerEvidenceStore({
      stateHome: input.stateHome,
      orgName: input.orgName,
      orgHome: input.orgHome,
      schedulerId: schedulerIdentity(input.orgName, input.orgHome),
    });
    const completedAt = new Date(input.now().getTime() - 5 * 60_000);
    const completed = await evidence.beginInvocation(completedAt);
    await evidence.finishInvocation(completed.invocation_id, "completed", "no_due_work", completedAt);
    const failed = await evidence.beginInvocation(input.now());
    await evidence.finishInvocation(failed.invocation_id, "failed", "scheduler_state_failure", input.now());
    await uninstallScheduler({ ...input, execute: true, confirm: input.orgName });

    const stopped = await schedulerOperationalStatus({ ...input, now: input.now() });
    expect(stopped.reason_codes).toContain("not_installed");
    expect(stopped.reason_codes).not.toContain("last_tick_failed");
    expect(stopped.reason_codes).not.toContain("measurement_unavailable");
    expect(stopped.reason_codes).not.toContain("healthy_recent_tick");
  });
});

async function fileExists(path: string): Promise<boolean> {
  try {
    await import("node:fs/promises").then(({ access }) => access(path));
    return true;
  } catch {
    return false;
  }
}
