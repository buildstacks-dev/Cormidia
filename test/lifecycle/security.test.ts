import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { bootstrapFromRecoveredAnswers, executeAppPromotion, planAppPromotion, readLifecycleRecord, verifyApp } from "../../src/org/app-lifecycle.js";
import { loadApps } from "../../src/org/apps.js";
import { readAnswersFromResetArchive, storeOnboardingAnswers } from "../../src/org/onboarding-answers.js";
import { stableJson } from "../../src/org/lifecycle.js";
import { executeAppReset, planAppReset } from "../../src/org/app-reset.js";
import { parseAnswers } from "../../src/org/bootstrap.js";
import { FakeGhOps } from "../support/fakeGhOps.js";
import { LIFECYCLE_ANSWERS, READY_RUNTIME_PROBE, bootstrapReachable, git, makeLifecycleTestWorld, sourceSnapshot, type LifecycleTestWorld } from "./helpers.js";

const worlds: LifecycleTestWorld[] = [];
afterEach(() => { for (const world of worlds.splice(0)) world.cleanup(); });

describe("C-LIFE-03 lifecycle refusal and corruption safety", () => {
  it("rejects archive tampering and secret-like answer values", async () => {
    const world = await makeLifecycleTestWorld(); worlds.push(world);
    const allRoles = ["planner", "builder", "reviewer", "sre", "support", "marketing", "distiller", "learning-reviewer"];
    await (await import("../../src/org/apps.js")).joinExistingOrg(world.orgHome, { name: "sparse", repo: "local/sparse", status: "onboarding", cadence: {} });
    await storeOnboardingAnswers(world.stateHome, "sparse", parseAnswers(LIFECYCLE_ANSWERS, allRoles));
    const input = { orgHome: world.orgHome, stateHome: world.stateHome, appsFile: await loadApps(join(world.orgHome, "apps.yaml")), appName: "sparse", gh: new FakeGhOps({ repo: "local/sparse" }), archiveRoot: world.archives };
    const reset = await executeAppReset(input, await planAppReset(input));
    const answersPath = join(reset.archivePath, "answers.json");
    writeFileSync(answersPath, `${readFileSync(answersPath, "utf8")} `, "utf8");
    await expect(readAnswersFromResetArchive(reset.archivePath)).rejects.toThrow("archive checksum mismatch");

    const before = sourceSnapshot(world.git.clone.root);
    await expect(bootstrapFromRecoveredAnswers(world.git.clone.root, {
      ...LIFECYCLE_ANSWERS,
      product: "api_key=abcdefgh",
    }, { orgHome: world.orgHome, stateHome: world.stateHome, appName: "sparse" })).rejects.toThrow("secret-like value forbidden");
    expect(sourceSnapshot(world.git.clone.root)).toEqual(before);
  });

  it("names a missing remote and refuses divergent default-branch ancestry", async () => {
    const missing = await makeLifecycleTestWorld(); worlds.push(missing);
    const missingBootstrap = await bootstrapFromRecoveredAnswers(missing.git.clone.root, LIFECYCLE_ANSWERS, { orgHome: missing.orgHome, stateHome: missing.stateHome, appName: "sparse" });
    renameSync(missing.git.bare.root, `${missing.git.bare.root}.offline`);
    const missingReport = await verifyApp({ orgHome: missing.orgHome, stateHome: missing.stateHome, appName: "sparse", readinessProbe: READY_RUNTIME_PROBE });
    expect(missingReport.status).toBe("blocked");
    expect(missingReport.checks.find((check) => check.id === "remote-reachable")?.status).toBe("blocked");
    expect(existsSync(missingBootstrap.managedClone)).toBe(true);

    const divergent = await makeLifecycleTestWorld(); worlds.push(divergent);
    await bootstrapFromRecoveredAnswers(divergent.git.clone.root, LIFECYCLE_ANSWERS, { orgHome: divergent.orgHome, stateHome: divergent.stateHome, appName: "sparse" });
    const writer = join(divergent.root, "remote-writer");
    execFileSync("git", ["clone", divergent.git.bare.root, writer], { stdio: "ignore" });
    writeFileSync(join(writer, "remote.txt"), "remote-only\n");
    git(writer, "add", "remote.txt");
    execFileSync("git", ["-c", "user.name=Remote Writer", "-c", "user.email=remote@operon.invalid", "-c", "commit.gpgsign=false", "commit", "-m", "remote advance"], { cwd: writer, stdio: "ignore" });
    git(writer, "push", "origin", "main");
    const report = await verifyApp({ orgHome: divergent.orgHome, stateHome: divergent.stateHome, appName: "sparse", readinessProbe: READY_RUNTIME_PROBE });
    expect(report.checks.find((check) => check.id === "branch-ancestry")?.status).toBe("blocked");
  });

  it("rejects managed-clone symlinks and lifecycle traversal records", async () => {
    const world = await makeLifecycleTestWorld(); worlds.push(world);
    const bootstrap = await bootstrapFromRecoveredAnswers(world.git.clone.root, LIFECYCLE_ANSWERS, { orgHome: world.orgHome, stateHome: world.stateHome, appName: "sparse" });
    const outside = join(world.root, "outside"); mkdirSync(outside); writeFileSync(join(outside, "sentinel"), "safe\n");
    rmSync(bootstrap.managedClone, { recursive: true, force: true });
    symlinkSync(outside, bootstrap.managedClone);
    const report = await verifyApp({ orgHome: world.orgHome, stateHome: world.stateHome, appName: "sparse", readinessProbe: READY_RUNTIME_PROBE });
    expect(report.status).toBe("invalid");
    expect(readFileSync(join(outside, "sentinel"), "utf8")).toBe("safe\n");

    rmSync(bootstrap.managedClone, { force: true });
    const recordPath = join(world.stateHome, "lifecycle", "apps", "sparse", "record.json");
    const record = JSON.parse(readFileSync(recordPath, "utf8"));
    record.managed_clone = outside;
    writeFileSync(recordPath, stableJson(record));
    await expect(readLifecycleRecord(world.stateHome, "sparse")).rejects.toThrow("escapes app state");
  });

  it("recreates a corrupt reachable clone and serializes concurrent promotion", async () => {
    const world = await makeLifecycleTestWorld(); worlds.push(world);
    const bootstrap = await bootstrapReachable(world);
    rmSync(bootstrap.managedClone, { recursive: true, force: true });
    mkdirSync(bootstrap.managedClone, { recursive: true });
    writeFileSync(join(bootstrap.managedClone, "corrupt"), "x\n");
    const repaired = await verifyApp({ orgHome: world.orgHome, stateHome: world.stateHome, appName: "sparse", readinessProbe: READY_RUNTIME_PROBE });
    expect(repaired.status).toBe("ready");
    expect(repaired.managed_head).toBe(repaired.remote_head);

    const input = { orgHome: world.orgHome, stateHome: world.stateHome, appName: "sparse", to: "live" as const, readinessProbe: READY_RUNTIME_PROBE };
    const plan = await planAppPromotion(input);
    const lockPath = join(world.stateHome, "lifecycle", "locks", "sparse.lock");
    mkdirSync(join(world.stateHome, "lifecycle", "locks"), { recursive: true });
    writeFileSync(lockPath, stableJson({ schema_version: 1, key: "sparse", operation: "app promote", pid: process.pid }));
    await expect(executeAppPromotion(input, plan)).rejects.toThrow("concurrent lifecycle operation");
    writeFileSync(lockPath, stableJson({ schema_version: 1, key: "sparse", operation: "app promote", pid: 999_999_999 }));
    expect((await executeAppPromotion(input, plan)).status).toBe("promoted");
  });

  it("returns byte-stable JSON projections for repeated verification and promotion plans", async () => {
    const world = await makeLifecycleTestWorld(); worlds.push(world);
    await bootstrapReachable(world);
    const a = await verifyApp({ orgHome: world.orgHome, stateHome: world.stateHome, appName: "sparse", readinessProbe: READY_RUNTIME_PROBE });
    const b = await verifyApp({ orgHome: world.orgHome, stateHome: world.stateHome, appName: "sparse", readinessProbe: READY_RUNTIME_PROBE });
    expect(stableJson(a)).toBe(stableJson(b));
    const input = { orgHome: world.orgHome, stateHome: world.stateHome, appName: "sparse", to: "live" as const, readinessProbe: READY_RUNTIME_PROBE };
    expect(stableJson(await planAppPromotion(input))).toBe(stableJson(await planAppPromotion(input)));
  });
});
