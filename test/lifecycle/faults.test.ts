import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { afterEach, describe, expect, it } from "vitest";
import { bootstrapFromRecoveredAnswers, executeAppPromotion, planAppPromotion, verifyApp } from "../../src/org/app-lifecycle.js";
import { joinExistingOrg, loadApps } from "../../src/org/apps.js";
import { executeOrgUpgrade, planOrgUpgrade } from "../../src/org/org-upgrade.js";
import type { LifecycleFaultPoint } from "../../src/org/lifecycle.js";
import { executeAppReset, planAppReset } from "../../src/org/app-reset.js";
import { parseAnswers } from "../../src/org/bootstrap.js";
import { storeOnboardingAnswers } from "../../src/org/onboarding-answers.js";
import { FakeGhOps } from "../support/fakeGhOps.js";
import { LIFECYCLE_ANSWERS, READY_RUNTIME_PROBE, bootstrapReachable, makeLegacy, makeLifecycleTestWorld, sourceSnapshot, type LifecycleTestWorld } from "./helpers.js";

const worlds: LifecycleTestWorld[] = [];
afterEach(() => { for (const world of worlds.splice(0)) world.cleanup(); });
const failAt = (expected: LifecycleFaultPoint) => async (actual: LifecycleFaultPoint) => {
  if (actual === expected) throw new Error(`injected:${expected}`);
};

describe("C-LIFE-02 lifecycle transaction restart boundaries", () => {
  for (const point of [
    "before_archive_creation",
    "after_archive_creation",
    "before_archive_checksum",
    "after_archive_checksum",
    "before_archive_rename",
    "after_archive_rename",
    "before_registry_write",
    "after_registry_write",
  ] as const) {
    it(`app reset rolls back/resumes ${point}`, async () => {
      const world = await makeLifecycleTestWorld(); worlds.push(world);
      await joinExistingOrg(world.orgHome, { name: "sparse", repo: "local/sparse", status: "onboarding", cadence: {} });
      await storeOnboardingAnswers(world.stateHome, "sparse", parseAnswers(LIFECYCLE_ANSWERS, ["planner", "builder", "reviewer", "sre", "support", "marketing", "distiller", "learning-reviewer"]));
      const base = { orgHome: world.orgHome, stateHome: world.stateHome, appsFile: await loadApps(join(world.orgHome, "apps.yaml")), appName: "sparse", gh: new FakeGhOps({ repo: "local/sparse" }), archiveRoot: world.archives };
      const plan = await planAppReset(base);
      await expect(executeAppReset({ ...base, fault: failAt(point) }, plan)).rejects.toThrow(`injected:${point}`);
      expect((await loadApps(join(world.orgHome, "apps.yaml"))).apps.map((app) => app.name)).toContain("sparse");
      expect(existsSync(join(world.stateHome, "lifecycle", "apps", "sparse", "answers.json"))).toBe(true);
      const completed = await executeAppReset(base, plan);
      expect(existsSync(completed.archivePath)).toBe(true);
      expect((await loadApps(join(world.orgHome, "apps.yaml"))).apps).toEqual([]);
    });
  }

  it("reclaims only its own dead reset role lock after a killed process", async () => {
    const world = await makeLifecycleTestWorld(); worlds.push(world);
    await joinExistingOrg(world.orgHome, { name: "sparse", repo: "local/sparse", status: "onboarding", cadence: {} });
    await storeOnboardingAnswers(world.stateHome, "sparse", parseAnswers(LIFECYCLE_ANSWERS, ["planner", "builder", "reviewer", "sre", "support", "marketing", "distiller", "learning-reviewer"]));
    const input = { orgHome: world.orgHome, stateHome: world.stateHome, appsFile: await loadApps(join(world.orgHome, "apps.yaml")), appName: "sparse", gh: new FakeGhOps({ repo: "local/sparse" }), archiveRoot: world.archives };
    const initial = await planAppReset(input);
    const lockDir = join(world.stateHome, "locks");
    mkdirSync(lockDir, { recursive: true });
    writeFileSync(join(lockDir, "sparse--planner.lock"), JSON.stringify({ app: "sparse", role: "planner", pid: 999_999_999, turnId: `reset-${initial.archiveId}`, startedAt: "2026-07-14T00:00:00.000Z", heartbeatAt: "2026-07-14T00:00:00.000Z" }));
    const recovered = await planAppReset(input);
    expect(recovered.blockers).toEqual([]);
    await executeAppReset(input, recovered);
    expect((await loadApps(join(world.orgHome, "apps.yaml"))).apps).toEqual([]);
  });

  for (const point of [
    "before_pull_request_update",
    "after_pull_request_update",
    "before_issue_update",
    "after_issue_update",
    "before_branch_update",
    "after_branch_update",
  ] as const) {
    it(`app reset resumes the exact remote transaction after ${point}`, async () => {
      const world = await makeLifecycleTestWorld(); worlds.push(world);
      await joinExistingOrg(world.orgHome, { name: "sparse", repo: "local/sparse", status: "onboarding", cadence: {} });
      await storeOnboardingAnswers(world.stateHome, "sparse", parseAnswers(LIFECYCLE_ANSWERS, ["planner", "builder", "reviewer", "sre", "support", "marketing", "distiller", "learning-reviewer"]));
      const gh = new FakeGhOps({ repo: "local/sparse", issues: [{ number: 1, title: "managed", labels: ["op:ready"] }] });
      await gh.createPR({ title: "managed PR", body: "Fixes #1", head: "op/1", base: "main" });
      const input = { orgHome: world.orgHome, stateHome: world.stateHome, appsFile: await loadApps(join(world.orgHome, "apps.yaml")), appName: "sparse", gh, archiveRoot: world.archives };
      const plan = await planAppReset(input);
      await expect(executeAppReset({ ...input, fault: failAt(point) }, plan)).rejects.toThrow(`injected:${point}`);
      const resumedInput = { ...input, appsFile: await loadApps(join(world.orgHome, "apps.yaml")) };
      const resumedPlan = await planAppReset(resumedInput);
      expect(resumedPlan.archiveId).toBe(plan.archiveId);
      await executeAppReset(resumedInput, resumedPlan);
      expect(await gh.listIssues({ state: "open" })).toEqual([]);
      expect(await gh.listPullRequests({ state: "open" })).toEqual([]);
      expect(existsSync(join(world.stateHome, "lifecycle", "transactions", "reset-sparse.json"))).toBe(false);
    });
  }

  for (const point of [
    "before_archive_creation",
    "after_archive_creation",
    "before_archive_checksum",
    "after_archive_checksum",
    "before_archive_rename",
    "after_archive_rename",
    "before_registry_write",
    "after_registry_write",
    "before_config_write",
    "after_config_write",
  ] as const) {
    it(`org upgrade rolls back/resumes ${point}`, async () => {
      const world = await makeLifecycleTestWorld(); worlds.push(world); makeLegacy(world);
      const input = { orgHome: world.orgHome, stateHome: world.stateHome, archiveRoot: world.archives, authorityChoice: "delegated-operator" as const };
      const plan = await planOrgUpgrade(input);
      await expect(executeOrgUpgrade({ ...input, fault: failAt(point) }, plan)).rejects.toThrow(`injected:${point}`);
      expect((parse(readFileSync(join(world.orgHome, "apps.yaml"), "utf8")) as Record<string, unknown>)["schema_version"]).toBeUndefined();
      expect(existsSync(join(world.orgHome, "AUTHORITY.md"))).toBe(false);
      const completed = await executeOrgUpgrade(input, await planOrgUpgrade(input));
      expect(completed.status).toBe("upgraded");
      const rerun = await executeOrgUpgrade(input, await planOrgUpgrade(input));
      expect(rerun.status).toBe("up_to_date");
    });
  }

  for (const point of ["before_worktree_creation", "after_worktree_creation", "before_commit", "after_commit", "before_registry_write", "after_registry_write"] as const) {
    it(`recovered bootstrap leaves no partial state and resumes ${point}`, async () => {
      const world = await makeLifecycleTestWorld(); worlds.push(world);
      const before = sourceSnapshot(world.git.clone.root);
      await expect(bootstrapFromRecoveredAnswers(world.git.clone.root, LIFECYCLE_ANSWERS, {
        orgHome: world.orgHome, stateHome: world.stateHome, appName: "sparse", fault: failAt(point),
      })).rejects.toThrow(`injected:${point}`);
      expect((await loadApps(join(world.orgHome, "apps.yaml"))).apps).toEqual([]);
      expect(existsSync(join(world.stateHome, "repos", "sparse"))).toBe(false);
      expect(existsSync(join(world.stateHome, "lifecycle", "apps", "sparse"))).toBe(false);
      expect(sourceSnapshot(world.git.clone.root)).toEqual(before);
      const completed = await bootstrapFromRecoveredAnswers(world.git.clone.root, LIFECYCLE_ANSWERS, {
        orgHome: world.orgHome, stateHome: world.stateHome, appName: "sparse",
      });
      expect(completed.immutableSource).toBe(true);
    });
  }

  for (const point of ["before_git_fetch", "after_git_fetch", "before_ref_validation", "after_ref_validation"] as const) {
    it(`verification reports and recovers ${point}`, async () => {
      const world = await makeLifecycleTestWorld(); worlds.push(world);
      await bootstrapReachable(world);
      const interrupted = await verifyApp({ orgHome: world.orgHome, stateHome: world.stateHome, appName: "sparse", fault: failAt(point), readinessProbe: READY_RUNTIME_PROBE });
      expect(interrupted.status).not.toBe("ready");
      const recovered = await verifyApp({ orgHome: world.orgHome, stateHome: world.stateHome, appName: "sparse", readinessProbe: READY_RUNTIME_PROBE });
      expect(recovered.status).toBe("ready");
    });
  }

  for (const point of ["before_config_write", "after_config_write", "before_commit", "after_commit", "before_push", "after_push", "before_registry_write", "after_registry_write"] as const) {
    it(`promotion journal resumes ${point} exactly once`, async () => {
      const world = await makeLifecycleTestWorld(); worlds.push(world);
      await bootstrapReachable(world);
      const input = { orgHome: world.orgHome, stateHome: world.stateHome, appName: "sparse", to: "live" as const, readinessProbe: READY_RUNTIME_PROBE };
      const plan = await planAppPromotion(input);
      await expect(executeAppPromotion({ ...input, fault: failAt(point) }, plan)).rejects.toThrow(`injected:${point}`);
      const resumedPlan = await planAppPromotion(input);
      expect(resumedPlan.executable).toBe(true);
      const completed = await executeAppPromotion(input, resumedPlan);
      expect(completed.verification).toMatchObject({ status: "ready", registry_status: "live" });
      expect((await executeAppPromotion(input, await planAppPromotion(input))).status).toBe("already_live");
      expect(world.git.bare.log("main").filter((subject) => subject === "chore: promote app to live")).toHaveLength(1);
    });
  }
});
