import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { dispatchTick, type DispatchTickOptions } from "../../src/org/dispatch.js";
import { readJournal, writeJournalPatch } from "../../src/org/journal.js";
import { releaseLock } from "../../src/org/locks.js";
import { SchedulerEvidenceStore } from "../../src/org/scheduler/evidence.js";
import { schedulerIdentity } from "../../src/org/scheduler/model.js";
import { makeOrgHome } from "../fixtures/orgHome.js";

const NOW = new Date("2026-07-14T10:00:00Z");

function fixture() {
  const home = makeOrgHome({ state: true });
  const orgRoot = join(home.root, "org");
  mkdirSync(orgRoot, { recursive: true });
  const appsPath = join(orgRoot, "apps.yaml");
  const rolesPath = join(orgRoot, "roles.yaml");
  writeFileSync(appsPath, `schema_version: 1\norg:\n  name: scheduler-fixture\n  max_concurrent_turns: 1\ndefaults:\n  budget_usd_month: 1000\napps:\n  service:\n    repo: fixture/service\n    status: live\n`);
  writeFileSync(rolesPath, `roles:\n  planner:\n    runtime: claude\n    model: fixture\n    effort: low\n    delegation: {allow: []}\n    triggers:\n      - schedule: daily 07:00\n    outputs: []\n`);
  const base: DispatchTickOptions = {
    orgRoot,
    runtimeHome: home.root,
    appsPath,
    rolesPath,
    now: () => NOW,
    eventSource: { ticketReady: async () => [], prOpened: async () => [], ciFailed: async () => [], releaseShipped: async () => [] },
  };
  const store = new SchedulerEvidenceStore({ stateHome: home.root, orgName: "scheduler-fixture", orgHome: orgRoot, schedulerId: schedulerIdentity("scheduler-fixture", orgRoot) });
  return { home, base, store };
}

describe("scheduler dispatch crash boundaries", () => {
  for (const boundary of ["after_scheduler_lock", "after_tick_journal"] as const) {
    it(`resumes exactly once after ${boundary}`, async () => {
      const f = fixture(); let spawned = 0; let failed = false;
      try {
        await expect(dispatchTick({ ...f.base, spawn: async () => { spawned += 1; }, schedulerFault: (at) => { if (at === boundary && !failed) { failed = true; throw new Error(`crash:${boundary}`); } } })).rejects.toThrow(`crash:${boundary}`);
        await releaseLock(f.home.root, "service", "planner");
        const resumed = await dispatchTick({ ...f.base, spawn: async ({ turnId }) => { spawned += 1; await writeJournalPatch(f.home.root, turnId, { app: "service", role: "planner", phase: "done" }, NOW); await releaseLock(f.home.root, "service", "planner"); } });
        expect(resumed.spawned).toHaveLength(1);
        expect(spawned).toBe(1);
        const records = await f.store.listDecisions();
        expect(records.filter((record) => record.outcome === "executed")).toHaveLength(1);
      } finally { f.home.cleanup(); }
    });
  }

  it("does not duplicate a successful detached spawn when bookkeeping crashes", async () => {
    const f = fixture(); let spawned = 0; let failed = false;
    try {
      await expect(dispatchTick({ ...f.base, spawn: async ({ turnId }) => { spawned += 1; await writeJournalPatch(f.home.root, turnId, { app: "service", role: "planner", phase: "done" }, NOW); await releaseLock(f.home.root, "service", "planner"); }, schedulerFault: (at) => { if (at === "after_child_spawn" && !failed) { failed = true; throw new Error("crash:after_child_spawn"); } } })).rejects.toThrow("crash:after_child_spawn");
      const resumed = await dispatchTick({ ...f.base, spawn: async () => { spawned += 1; } });
      expect(resumed.spawned).toEqual([]);
      expect(spawned).toBe(1);
      const journal = (await f.store.listDecisions())[0]!;
      expect(journal.stage).toBe("spawn_committed");
      expect(await readJournal(f.home.root, journal.episode_id!)).toMatchObject({ phase: "done" });
    } finally { f.home.cleanup(); }
  });

  it("fails closed when durable scheduler evidence is corrupt", async () => {
    const f = fixture();
    try {
      const corrupt = join(f.home.root, "scheduler", "evidence", "decisions");
      mkdirSync(corrupt, { recursive: true });
      writeFileSync(join(corrupt, "torn.json"), "{\"schema_version\":1");
      await expect(dispatchTick({ ...f.base, spawn: async () => { throw new Error("provider_tripwire"); } })).rejects.toThrow("scheduler decision evidence corrupt");
    } finally { f.home.cleanup(); }
  });
});
