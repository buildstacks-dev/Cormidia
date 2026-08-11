// Traceability: CF-J14-R · HB-015 · contracts/journey-acceptance.md J-14 refusal criterion.

// CF-J14-R — reset refuses on active runs/locks/journals/pending approvals;
// --force crosses ONLY the stale-heartbeat (>10 min) condition; wrong
// --confirm refuses (L2, E1; C-OP-LIFE §6 + error split, journey-acceptance
// J-14 "`--force` crosses only the stale-heartbeat (>10 min) condition",
// INV-010 adversarial seed (c); case-catalog row CF-J14-R).
//
// The >10 min literal: OP-lifecycle.md §6 defers the numeric bound to the
// journey acceptance text — contracts/journey-acceptance.md J-14 ratifies
// "stale-heartbeat (>10 min)", which the boundary legs below pin EXACTLY
// (10:00.000 old = still active; strictly older = stale, force-eligible).
// RESET_STALE_RUN_MS is the product constant under test, asserted against
// the ratified value rather than read as its own truth.

import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cmdApp } from "../../../src/cli/app.js";
import { executeAppReset, planAppReset, RESET_STALE_RUN_MS, type AppResetOptions } from "../../../src/org/app-reset.js";
import { loadApps } from "../../../src/org/apps.js";
import {
  assertResetScope,
  diffWorld,
  makeResetWorld,
  mutatingOpsSince,
  preDestructionAllowance,
  seedActiveJournal,
  seedActiveLock,
  seedPendingApproval,
  seedRunningRun,
  snapshotWorld,
  TARGET_APP,
  type ResetWorld,
} from "./support.js";

const NOW = new Date("2026-07-31T12:00:00.000Z");

describe("CF-J14-R — refusal classes and the narrow --force condition (C-OP-LIFE §6, J-14)", () => {
  let cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.reverse()) await cleanup();
    cleanups = [];
  });

  async function world(): Promise<ResetWorld> {
    const w = await makeResetWorld();
    cleanups.push(() => w.cleanup());
    return w;
  }

  function resetInput(w: ResetWorld, overrides: Partial<AppResetOptions> = {}): AppResetOptions {
    return {
      orgHome: w.orgHome,
      stateHome: w.stateHome,
      appsFile: w.appsFile,
      appName: TARGET_APP,
      gh: w.gh,
      archiveRoot: w.archiveRoot,
      now: NOW,
      ...overrides,
    };
  }

  /** Plan must carry exactly the expected blocker; execute must refuse with
   *  zero destruction, zero remote mutation, and the sibling world intact. */
  async function expectRefusal(
    w: ResetWorld,
    input: AppResetOptions,
    code: string,
    expectation: { forceEligible: boolean; ids?: string[] },
  ): Promise<void> {
    const before = await snapshotWorld(w);
    const plan = await planAppReset(input);
    const blocker = plan.blockers.find((item) => item.code === code);
    expect(blocker, `expected blocker ${code}; got ${JSON.stringify(plan.blockers)}`).toBeDefined();
    expect(blocker!.forceEligible).toBe(expectation.forceEligible);
    expect(blocker!.remediation.length).toBeGreaterThan(0);
    if (expectation.ids !== undefined) expect(blocker!.ids).toEqual(expectation.ids);

    await expect(executeAppReset(input, plan)).rejects.toThrow(new RegExp(`cannot reset .*${code}`));
    // Precondition refusal = before domain mutation (error split): nothing
    // destroyed, registry intact, no remote mutation. (The plan itself is
    // free of even the non-destructive journal writes.)
    const diff = diffWorld(before, await snapshotWorld(w));
    assertResetScope(TARGET_APP, diff, preDestructionAllowance(TARGET_APP));
    expect((await loadApps(join(w.orgHome, "apps.yaml"))).apps.map((app) => app.name)).toContain(TARGET_APP);
    expect(mutatingOpsSince(w)).toEqual([]);
  }

  it("active run (fresh heartbeat): refuses, not force-eligible", async () => {
    const w = await world();
    await seedRunningRun(w, "run-live", new Date(NOW.getTime() - 30_000));
    await expectRefusal(w, resetInput(w), "active_run", { forceEligible: false, ids: ["run-live"] });
  });

  it("negative control: --force against a fresh heartbeat — the refusal detector still FIRES (INV-010 seed c)", async () => {
    const w = await world();
    // SEEDED VIOLATION: the operator reaches for --force while the run's
    // heartbeat is 30s old. Force must not cross an active run.
    await seedRunningRun(w, "run-live", new Date(NOW.getTime() - 30_000));
    await expectRefusal(w, resetInput(w, { force: true }), "active_run", {
      forceEligible: false,
      ids: ["run-live"],
    });
  });

  it("heartbeat exactly 10:00 old: still an ACTIVE run — the ratified bound is strictly greater-than (J-14)", async () => {
    expect(RESET_STALE_RUN_MS).toBe(10 * 60 * 1000); // the ratified >10 min literal
    const w = await world();
    await seedRunningRun(w, "run-boundary", new Date(NOW.getTime() - RESET_STALE_RUN_MS));
    await expectRefusal(w, resetInput(w, { force: true }), "active_run", {
      forceEligible: false,
      ids: ["run-boundary"],
    });
  });

  it("heartbeat >10 min old without --force: refuses as stale_run, force-eligible", async () => {
    const w = await world();
    await seedRunningRun(w, "run-stale", new Date(NOW.getTime() - RESET_STALE_RUN_MS - 1000));
    await expectRefusal(w, resetInput(w), "stale_run", { forceEligible: true, ids: ["run-stale"] });
  });

  it("--force crosses ONLY the stale-heartbeat condition: the same stale run resets cleanly with --force", async () => {
    const w = await world();
    await seedRunningRun(w, "run-stale", new Date(NOW.getTime() - RESET_STALE_RUN_MS - 1000));
    const input = resetInput(w, { force: true });
    const plan = await planAppReset(input);
    expect(plan.blockers).toEqual([]);
    expect(plan.staleRuns).toEqual(["run-stale"]);
    const result = await executeAppReset(input, plan);
    expect(result.archivePath.length).toBeGreaterThan(0);
    expect((await loadApps(join(w.orgHome, "apps.yaml"))).apps.map((app) => app.name)).not.toContain(TARGET_APP);
  });

  it("active journal: refuses, never force-eligible", async () => {
    const w = await world();
    const turnId = await seedActiveJournal(w);
    await expectRefusal(w, resetInput(w, { force: true }), "active_journal", {
      forceEligible: false,
      ids: [turnId],
    });
  });

  it("active role lock held by a live process: refuses, --force never crosses locks", async () => {
    const w = await world();
    await seedActiveLock(w);
    await expectRefusal(w, resetInput(w, { force: true }), "active_lock", { forceEligible: false });
  });

  it("pending approval: refuses, --force never crosses the operator boundary (INV-010 seed c)", async () => {
    const w = await world();
    const id = await seedPendingApproval(w);
    await expectRefusal(w, resetInput(w, { force: true }), "pending_approval", {
      forceEligible: false,
      ids: [id],
    });
  });

  it("wrong --confirm identity: the CLI refuses before resolving homes or planning (error split)", async () => {
    // The identity check precedes every read and write — no homes are
    // resolved, so nothing can mutate; the world is not even needed.
    await expect(cmdApp(["reset", TARGET_APP, "--execute", "--confirm", "not-the-app"])).rejects.toThrow(
      new RegExp(`--execute requires --confirm ${TARGET_APP}`),
    );
  });

  it("execute with a blocked reviewed plan refuses before locks, archive, or intent", async () => {
    const w = await world();
    await seedPendingApproval(w);
    const input = resetInput(w);
    const before = await snapshotWorld(w);
    const plan = await planAppReset(input);
    expect(plan.blockers.length).toBeGreaterThan(0);
    await expect(executeAppReset(input, plan)).rejects.toThrow(/cannot reset/);
    // Not even the non-destructive intent journal exists after this refusal.
    const diff = diffWorld(before, await snapshotWorld(w));
    expect(diff.state).toEqual({ added: [], removed: [], changed: [] });
    expect(diff.org).toEqual({ added: [], removed: [], changed: [] });
    expect(diff.human).toEqual({ added: [], removed: [], changed: [] });
  });
});
