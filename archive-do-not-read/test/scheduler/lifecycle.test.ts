import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { buildSchedulerExpectation } from "../../src/org/scheduler/definition.js";
import { SchedulerEvidenceStore } from "../../src/org/scheduler/evidence.js";
import { installScheduler, schedulerDefinitionStatus, uninstallScheduler } from "../../src/org/scheduler/lifecycle.js";
import { PlatformSchedulerManager, type SchedulerHostCommand } from "../../src/org/scheduler/manager.js";
import { schedulerOperationalStatus } from "../../src/org/scheduler/status.js";
import { makeOrgHome } from "../fixtures/orgHome.js";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const ENTRY = join(ROOT, "src", "cli.ts");
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture(orgName = "phase5") {
  const home = makeOrgHome({ state: true });
  roots.push(home.root);
  const definitions = mkdtempSync(join(tmpdir(), "operon-scheduler-defs-"));
  roots.push(definitions);
  let active = false;
  const commands: SchedulerHostCommand[] = [];
  const manager = new PlatformSchedulerManager({
    backend: "launchd",
    platform: "darwin",
    definitionDir: definitions,
    supported: true,
    runHostCommand: async (input) => {
      commands.push(input);
      if (input.args[0] === "bootstrap") active = true;
      if (input.args[0] === "bootout") active = false;
      return input.args[0] === "print" && !active
        ? { code: 113, stdout: "", stderr: "Could not find service" }
        : { code: 0, stdout: active ? "state = running" : "", stderr: "" };
    },
  });
  const input = { backend: "launchd" as const, orgName, orgHome: join(home.root, "org"), stateHome: home.root, packageEntryPath: ENTRY, executablePath: process.execPath, cadenceMinutes: 5, manager };
  mkdirSync(input.orgHome, { recursive: true });
  return { home, definitions, manager, input, commands, setActive(value: boolean) { active = value; } };
}

describe("I-INSTALL-01 org-scoped scheduler lifecycle", () => {
  it("previews with zero writes, applies idempotently, reports healthy ticks, and uninstalls idempotently", async () => {
    const f = fixture();
    const preview = await installScheduler(f.input);
    expect(preview).toMatchObject({ mode: "preview", action: "install", changed: false, writes_planned: true, backend: "launchd" });
    expect(existsSync(preview.definition_path)).toBe(false);
    expect(existsSync(join(f.home.root, "scheduler"))).toBe(false);

    const installed = await installScheduler({ ...f.input, execute: true, confirm: preview.scheduler_id, now: () => new Date("2026-07-14T12:00:00Z") });
    expect(installed).toMatchObject({ action: "install", changed: true });
    const second = await installScheduler({ ...f.input, execute: true, confirm: preview.scheduler_id });
    expect(second).toMatchObject({ action: "noop", changed: false });
    expect(f.commands.filter((item) => item.args[0] === "bootstrap")).toHaveLength(1);

    const store = new SchedulerEvidenceStore({ stateHome: f.home.root, orgName: f.input.orgName, orgHome: f.input.orgHome, schedulerId: preview.scheduler_id });
    const invocation = await store.beginInvocation(new Date("2026-07-14T12:00:00Z"));
    await store.finishInvocation(invocation.invocation_id, "completed", "no_due_work", new Date("2026-07-14T12:00:01Z"));
    const healthy = await schedulerOperationalStatus({ ...f.input, now: new Date("2026-07-14T12:04:00Z") });
    expect(healthy).toMatchObject({ healthy: true, measurement_valid: true, definition: { installed: true, active: true, definition_valid: true } });
    expect(healthy.evidence.provider_settlement_agreement).toBe(true);

    const uninstallPreview = await uninstallScheduler(f.input);
    expect(uninstallPreview).toMatchObject({ mode: "preview", action: "uninstall", changed: false });
    expect(existsSync(uninstallPreview.definition_path)).toBe(true);
    await expect(uninstallScheduler({
      ...f.input,
      execute: true,
      confirm: preview.scheduler_id,
      fault: (boundary) => { if (boundary === "after_definition_remove") throw new Error("crash_after_definition_remove"); },
    })).rejects.toThrow("crash_after_definition_remove");
    expect(existsSync(uninstallPreview.definition_path)).toBe(false);
    const removed = await uninstallScheduler({ ...f.input, execute: true, confirm: preview.scheduler_id });
    expect(removed).toMatchObject({ action: "uninstall", changed: true });
    expect(existsSync(uninstallPreview.definition_path)).toBe(false);
    const repeated = await uninstallScheduler({ ...f.input, execute: true, confirm: preview.scheduler_id });
    expect(repeated).toMatchObject({ action: "noop", changed: false });
  });

  it("resumes an interrupted install transaction and repairs inactive owned state", async () => {
    const f = fixture("resume-org");
    const expected = buildSchedulerExpectation(f.input);
    await expect(installScheduler({
      ...f.input,
      execute: true,
      confirm: expected.metadata.scheduler_id,
      fault: (boundary) => { if (boundary === "after_definition_write") throw new Error("crash_after_definition"); },
    })).rejects.toThrow("crash_after_definition");
    expect(existsSync(f.manager.definitionPath(expected.metadata.scheduler_id))).toBe(true);
    const repaired = await installScheduler({ ...f.input, execute: true, confirm: expected.metadata.scheduler_id });
    expect(repaired).toMatchObject({ action: "repair", changed: true });
    f.setActive(false);
    const inactive = await schedulerDefinitionStatus(f.input);
    expect(inactive.reason_codes).toContain("inactive");
    const reloaded = await installScheduler({ ...f.input, execute: true, confirm: expected.metadata.scheduler_id });
    expect(reloaded.action).toBe("repair");
    expect(f.commands.filter((item) => item.args[0] === "bootout").length).toBeGreaterThan(0);
  });

  it("converges an install that crashed after the ownership record was written", async () => {
    const f = fixture("record-crash-org");
    const expected = buildSchedulerExpectation(f.input);
    await expect(installScheduler({
      ...f.input,
      execute: true,
      confirm: expected.metadata.scheduler_id,
      fault: (boundary) => { if (boundary === "after_record_write") throw new Error("crash_after_record"); },
    })).rejects.toThrow("crash_after_record");
    expect(existsSync(join(f.home.root, "scheduler", "lifecycle-transaction.json"))).toBe(true);
    const resumed = await installScheduler({ ...f.input, execute: true, confirm: expected.metadata.scheduler_id });
    expect(resumed).toMatchObject({ action: "repair", changed: true });
    expect(existsSync(join(f.home.root, "scheduler", "lifecycle-transaction.json"))).toBe(false);
  });
});

describe("I-INSTALL-02 definition ownership and honest health", () => {
  it("fails closed for malformed, foreign, wrong-org, stale, wrong-path, and corrupt state", async () => {
    const f = fixture("exact-org");
    const expected = buildSchedulerExpectation(f.input);
    const path = f.manager.definitionPath(expected.metadata.scheduler_id);
    mkdirSync(join(path, ".."), { recursive: true });

    writeFileSync(path, "<plist><dict/></plist>\n");
    expect((await installScheduler(f.input)).reason_codes).toContain("ownership_mismatch");
    expect((await uninstallScheduler({ ...f.input, execute: true, confirm: expected.metadata.scheduler_id })).action).toBe("refuse");
    expect(existsSync(path)).toBe(true);

    writeFileSync(path, "<!-- operon-scheduler-metadata-v1:not-base64 -->\n");
    expect((await schedulerDefinitionStatus(f.input)).reason_codes).toContain("malformed_definition");
    expect((await uninstallScheduler(f.input)).action).toBe("refuse");

    const other = buildSchedulerExpectation({ ...f.input, orgName: "other-org", orgHome: join(f.home.root, "other") });
    writeFileSync(path, other.definition);
    const wrong = await schedulerDefinitionStatus(f.input);
    expect(wrong.reason_codes).toContain("wrong_org");
    expect((await installScheduler(f.input)).action).toBe("refuse");

    writeFileSync(path, buildSchedulerExpectation({ ...f.input, stateHome: join(f.home.root, "moved") }).definition);
    expect((await schedulerDefinitionStatus(f.input)).reason_codes).toEqual(expect.arrayContaining(["wrong_state_home", "stale_definition"]));

    writeFileSync(path, buildSchedulerExpectation({ ...f.input, executablePath: join(f.home.root, "stale-node") }).definition);
    expect((await schedulerDefinitionStatus(f.input)).reason_codes).toEqual(expect.arrayContaining(["wrong_executable", "stale_definition"]));

    writeFileSync(path, buildSchedulerExpectation({ ...f.input, cadenceMinutes: 10 }).definition);
    expect((await schedulerDefinitionStatus(f.input)).reason_codes).toEqual(expect.arrayContaining(["cadence_drift", "stale_definition"]));

    writeFileSync(path, expected.definition);
    expect((await schedulerDefinitionStatus(f.input)).reason_codes).toContain("scheduler_state_missing");
    mkdirSync(join(f.home.root, "scheduler"), { recursive: true });
    writeFileSync(join(f.home.root, "scheduler", "installation.json"), "not-json\n");
    expect((await schedulerDefinitionStatus(f.input)).reason_codes).toContain("scheduler_state_corrupt");
    writeFileSync(join(f.home.root, "scheduler", "lifecycle-transaction.json"), "not-json\n");
    expect((await installScheduler(f.input)).action).toBe("refuse");
  });

  it("keeps scheduler identities isolated by exact org and reports systemd as representation-only", async () => {
    const one = fixture("same-name");
    const two = fixture("same-name");
    expect(buildSchedulerExpectation(one.input).metadata.scheduler_id).not.toBe(buildSchedulerExpectation(two.input).metadata.scheduler_id);
    const manager = new PlatformSchedulerManager({ backend: "systemd", platform: "linux", definitionDir: one.definitions });
    const status = await schedulerDefinitionStatus({ ...one.input, backend: "systemd", manager });
    expect(status.supported).toBe(false);
    expect(status.reason_codes).toContain("unsupported_backend");
  });
});
