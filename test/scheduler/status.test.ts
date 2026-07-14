import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cmdDoctor } from "../../src/cli/doctor.js";
import { runSchedulerCommand } from "../../src/cli/scheduler.js";
import { SchedulerEvidenceStore } from "../../src/org/scheduler/evidence.js";
import { installScheduler } from "../../src/org/scheduler/lifecycle.js";
import { PlatformSchedulerManager } from "../../src/org/scheduler/manager.js";
import { schedulerOperationalStatus } from "../../src/org/scheduler/status.js";
import { schedulerIdentity } from "../../src/org/scheduler/model.js";
import { makeOrgHome } from "../fixtures/orgHome.js";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const roots: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const home = makeOrgHome({ state: true }); roots.push(home.root);
  const definitions = mkdtempSync(join(tmpdir(), "operon-status-defs-")); roots.push(definitions);
  let active = false;
  const manager = new PlatformSchedulerManager({ backend: "launchd", platform: "darwin", definitionDir: definitions, supported: true, runHostCommand: async ({ args }) => {
    if (args[0] === "bootstrap") active = true;
    if (args[0] === "bootout") active = false;
    return args[0] === "print" && !active ? { code: 1, stdout: "", stderr: "inactive" } : { code: 0, stdout: "active", stderr: "" };
  } });
  const input = { backend: "launchd" as const, orgName: "operon", orgHome: ROOT, stateHome: home.root, packageEntryPath: join(ROOT, "src", "cli.ts"), manager };
  return { home, manager, input, setActive(value: boolean) { active = value; } };
}

describe("truthful scheduler health", () => {
  it("names overdue, failed, corrupt, and missing-denominator evidence instead of reporting zero/healthy", async () => {
    const f = fixture();
    const preview = await installScheduler(f.input);
    await installScheduler({ ...f.input, execute: true, confirm: preview.scheduler_id, now: () => new Date("2026-07-14T00:00:00Z") });
    const store = new SchedulerEvidenceStore({ stateHome: f.home.root, orgName: "operon", orgHome: ROOT, schedulerId: preview.scheduler_id });
    const invocation = await store.beginInvocation(new Date("2026-07-14T00:00:00Z"));
    const decision = await store.claimDecision({ invocationId: invocation.invocation_id, cadenceWindow: invocation.cadence_window, app: "service", role: "sre", triggerKind: "schedule", trigger: "hourly", now: new Date("2026-07-14T00:00:00Z") });
    await store.finishDecision(decision.record.decision_id, "executed", "executed", new Date("2026-07-14T00:00:00Z"));
    await store.finishInvocation(invocation.invocation_id, "failed", "scheduler_state_failure", new Date("2026-07-14T00:00:01Z"));
    const status = await schedulerOperationalStatus({ ...f.input, now: new Date("2026-07-14T00:20:00Z") });
    expect(status.healthy).toBe(false);
    expect(status.measurement_valid).toBe(false);
    expect(status.reason_codes).toEqual(expect.arrayContaining(["overdue_tick", "last_tick_failed", "measurement_unavailable"]));
    expect(status.reason_codes).not.toContain("scheduler_state_corrupt");
    expect(status.evidence.provider_turns).toBeNull();
    expect(status.evidence.missing_denominators).toEqual([decision.record.decision_id]);

    const corruptPath = join(f.home.root, "scheduler", "evidence", "decisions", "corrupt.json");
    mkdirSync(join(corruptPath, ".."), { recursive: true });
    writeFileSync(corruptPath, "not-json\n");
    const corrupt = await schedulerOperationalStatus({ ...f.input, now: new Date("2026-07-14T00:20:00Z") });
    expect(corrupt.evidence.corrupt_records).toContain(corruptPath);
    expect(corrupt.evidence.measurement_valid).toBe(false);
    expect(corrupt.reason_codes).toContain("scheduler_state_corrupt");
  });

  it("keeps lifecycle/status/doctor token-free and makes JSON/terminal project the same identity", async () => {
    const f = fixture();
    let readinessCalls = 0;
    const jsonSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const code = await runSchedulerCommand(["install", "--org-home", ROOT, "--state-home", f.home.root, "--backend", "launchd", "--json"], { manager: f.manager, platform: "darwin", packageEntryPath: join(ROOT, "src", "cli.ts") });
    expect(code).toBe(0);
    const preview = JSON.parse(jsonSpy.mock.calls.at(-1)![0] as string) as { scheduler_id: string; mode: string };
    expect(preview).toMatchObject({ scheduler_id: schedulerIdentity("operon", ROOT), mode: "preview" });
    jsonSpy.mockClear();
    await runSchedulerCommand(["install", "--org-home", ROOT, "--state-home", f.home.root, "--backend", "launchd", "--execute", "--confirm", preview.scheduler_id, "--json"], { manager: f.manager, platform: "darwin", packageEntryPath: join(ROOT, "src", "cli.ts") });
    const installed = JSON.parse(jsonSpy.mock.calls.at(-1)![0] as string) as { scheduler_id: string };
    jsonSpy.mockClear();
    await runSchedulerCommand(["status", "--org-home", ROOT, "--state-home", f.home.root, "--backend", "launchd", "--json"], { manager: f.manager, platform: "darwin", packageEntryPath: join(ROOT, "src", "cli.ts"), now: () => new Date("2026-07-14T00:00:00Z") });
    const status = JSON.parse(jsonSpy.mock.calls.at(-1)![0] as string) as { definition: { scheduler_id: string } };
    expect(status.definition.scheduler_id).toBe(installed.scheduler_id);
    jsonSpy.mockClear();
    await runSchedulerCommand(["status", "--org-home", ROOT, "--state-home", f.home.root, "--backend", "launchd"], { manager: f.manager, platform: "darwin", packageEntryPath: join(ROOT, "src", "cli.ts"), now: () => new Date("2026-07-14T00:00:00Z") });
    expect(jsonSpy.mock.calls.flat().join("\n")).toContain(installed.scheduler_id);

    await cmdDoctor({ orgHome: ROOT, stateHome: f.home.root, configOnly: true, schedulerManager: f.manager, platform: "darwin", readinessProbe: async () => { readinessCalls += 1; throw new Error("provider_tripwire"); } });
    expect(readinessCalls).toBe(0);
  });
});
