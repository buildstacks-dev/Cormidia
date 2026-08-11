// Traceability: CF-J14-RC · HB-015 · contracts/journey-acceptance.md J-14 recovery criterion.

// CF-J14-RC — a resumed reset completes without re-destroying and without
// duplicating GitHub closes (L2, E1; C-OP-LIFE §6, INV-010/013,
// journey-acceptance J-13 "never re-performs an external effect";
// case-catalog row CF-J14-RC).
//
// Each leg kills a real subprocess reset at a named step (same seam as
// CF-J14-I), then RESUMES in-process and proves: the rerun adopts the durable
// intent (same archive id), verifies rather than recreates the archive
// (manifest bytes bit-identical), closes each PR/issue/branch exactly once
// across both attempts, and converges to the terminal state with the intent
// journal removed. The post-registry kill resumes through the idempotent
// finalizer, exactly as the dispatched CLI does for a vanished app.

import { existsSync } from "node:fs";
import { appendFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  executeAppReset,
  finalizeInterruptedAppReset,
  planAppReset,
  type AppResetOptions,
} from "../../../src/org/app-reset.js";
import { loadApps } from "../../../src/org/apps.js";
import { latestResetArchiveForApp } from "../../../src/org/onboarding-answers.js";
import { runKillPointScenario } from "../../fixtures/kill-point.js";
import {
  makeResetWorld,
  resetKillEnv,
  RESET_KILL_SCENARIO,
  TARGET_APP,
  SIBLING_APP,
  type ResetWorld,
} from "./support.js";

describe("CF-J14-RC — resumed reset: no re-destruction, no duplicated closes (C-OP-LIFE §6)", () => {
  let cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.reverse()) await cleanup();
    cleanups = [];
  });

  async function makeKilledWorld(killAt: string): Promise<ResetWorld> {
    const w = await makeResetWorld();
    cleanups.push(() => w.cleanup());
    const result = await runKillPointScenario({
      source: RESET_KILL_SCENARIO,
      killAt,
      env: resetKillEnv(w),
      timeoutMs: 25_000,
    });
    cleanups.push(() => result.cleanup());
    expect(result.timedOut).toBe(false);
    expect(result.killedAt).toBe(killAt);
    return w;
  }

  function resetInput(w: ResetWorld): AppResetOptions {
    return {
      orgHome: w.orgHome,
      stateHome: w.stateHome,
      appsFile: w.appsFile,
      appName: TARGET_APP,
      gh: w.gh,
      archiveRoot: w.archiveRoot,
    };
  }

  function closeCounts(w: ResetWorld): { pr: number; issue: number; branch: number } {
    const log = w.handle.callLog().slice(w.baseCallCount);
    return {
      pr: log.filter((entry) => entry.op === "pr.close").length,
      issue: log.filter((entry) => entry.op === "issue.close").length,
      branch: log.filter((entry) => entry.op === "ref.delete").length,
    };
  }

  async function expectConverged(w: ResetWorld, archivePath: string): Promise<void> {
    // Terminal state: registry entry gone, managed state gone, intent gone.
    expect((await loadApps(join(w.orgHome, "apps.yaml"))).apps.map((app) => app.name)).toEqual([SIBLING_APP]);
    expect(existsSync(join(w.stateHome, "runs", TARGET_APP))).toBe(false);
    expect(existsSync(join(w.stateHome, "lifecycle", "transactions", `reset-${TARGET_APP}.json`))).toBe(false);
    expect(existsSync(join(archivePath, "manifest.json"))).toBe(true);
    // Remote terminal state, each effect exactly once.
    const state = w.handle.readState();
    expect(state.prs[String(w.pr.number)]?.state).toBe("CLOSED");
    expect(state.issues[String(w.issue.number)]?.state).toBe("CLOSED");
    expect(state.branches[w.opBranch]).toBeUndefined();
    expect(closeCounts(w)).toEqual({ pr: 1, issue: 1, branch: 1 });
  }

  it("killed after the archive rename: the resume adopts the intent, reuses the archive, closes once, converges", async () => {
    const w = await makeKilledWorld("after_archive_rename");
    const intent = JSON.parse(
      await readFile(join(w.stateHome, "lifecycle", "transactions", `reset-${TARGET_APP}.json`), "utf8"),
    ) as { archive_id: string };
    const manifestBefore = await readFile(join(w.archiveRoot, intent.archive_id, "manifest.json"), "utf8");

    const input = resetInput(w);
    const plan = await planAppReset(input);
    // The resumed plan adopts the durable intent identity, not a fresh one.
    expect(plan.archiveId).toBe(intent.archive_id);
    expect(plan.blockers).toEqual([]);
    const result = await executeAppReset(input, plan);

    // No re-archive: the manifest bytes are bit-identical to the first run's.
    expect(result.archivePath).toBe(join(w.archiveRoot, intent.archive_id));
    expect(await readFile(join(result.archivePath, "manifest.json"), "utf8")).toBe(manifestBefore);
    await expectConverged(w, result.archivePath);
  });

  it("killed between the PR close and the issue close: the resume never re-closes the PR", async () => {
    const w = await makeKilledWorld("after_pull_request_update");
    expect(closeCounts(w)).toEqual({ pr: 1, issue: 0, branch: 0 });

    const input = resetInput(w);
    const plan = await planAppReset(input);
    expect(plan.blockers).toEqual([]);
    // The already-closed PR stays in the resumed plan (from the intent), but
    // the executor re-lists open PRs and skips it — the close happens once.
    expect(plan.github.pullRequests.map((pr) => pr.number)).toEqual([w.pr.number]);
    const result = await executeAppReset(input, plan);
    await expectConverged(w, result.archivePath);
  });

  it("killed after the registry write: the idempotent finalizer completes the terminal cleanup (twice, safely)", async () => {
    const w = await makeKilledWorld("after_registry_write");
    // The app is gone from the registry: a fresh dispatch (which reloads
    // apps.yaml, as resolveCormidiaHomes does) reports unknown app — the
    // resume path is the finalizer over the latest archive pointer, exactly
    // what the dispatched CLI does.
    const reloaded = await loadApps(join(w.orgHome, "apps.yaml"));
    await expect(planAppReset({ ...resetInput(w), appsFile: reloaded })).rejects.toThrow(/unknown app/);
    const archive = await latestResetArchiveForApp(w.archiveRoot, TARGET_APP);
    expect(archive).toBeDefined();

    await finalizeInterruptedAppReset(w.stateHome, TARGET_APP, archive!);
    expect(existsSync(join(w.stateHome, "lifecycle", "transactions", `reset-${TARGET_APP}.json`))).toBe(false);
    // Idempotent: a second finalization changes nothing and does not throw.
    await finalizeInterruptedAppReset(w.stateHome, TARGET_APP, archive!);
    await expectConverged(w, archive!);
  });

  it("negative control: archive tampered between kill and resume — the checksum detector FIRES and nothing is destroyed", async () => {
    const w = await makeKilledWorld("after_archive_rename");
    const intent = JSON.parse(
      await readFile(join(w.stateHome, "lifecycle", "transactions", `reset-${TARGET_APP}.json`), "utf8"),
    ) as { archive_id: string };
    // SEEDED VIOLATION: a byte appended to an archived file after the kill.
    await appendFile(
      join(w.archiveRoot, intent.archive_id, "state", "runs", TARGET_APP, "seed-run", "artifact.txt"),
      "tampered\n",
      "utf8",
    );

    const input = resetInput(w);
    const plan = await planAppReset(input);
    await expect(executeAppReset(input, plan)).rejects.toThrow(/archive checksum mismatch/);
    // Destruction never proceeded behind the broken backup: the managed
    // state, the registry entry, and the remote issue are all still there.
    expect(existsSync(join(w.stateHome, "runs", TARGET_APP, "seed-run", "artifact.txt"))).toBe(true);
    expect((await loadApps(join(w.orgHome, "apps.yaml"))).apps.map((app) => app.name)).toContain(TARGET_APP);
    expect(closeCounts(w)).toEqual({ pr: 0, issue: 0, branch: 0 });
  });
});
