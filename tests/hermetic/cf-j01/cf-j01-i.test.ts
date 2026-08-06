// CF-J01-I — kill mid-init-staging / mid-upgrade-transaction at each
// journaled step (L2, E1; C-OP-LIFE §1/§3, INV-013, B-07/B-15;
// case-catalog row CF-J01-I).
//
// The upgrade legs SIGKILL a REAL subprocess running executeOrgUpgrade with
// the product's in-memory LifecycleFaultHook bridged onto kill-point markers
// (fixtures/kill-point.ts), so the kill lands exactly at each named journaled
// step. After each kill the org home must be exactly as the journal
// semantics promise: no domain byte changes before the registry write, the
// dead-process-aware lifecycle lock left in place, and archive staging never
// mistaken for a final archive.
//
// HONEST REDUCTION (init): executeOrgInit (src/org/home.ts) exposes no fault
// hook, so a deterministic kill INSIDE its build→validate→rename staging is
// out of hermetic reach without modifying product code. The init legs cover
// the reachable seams honestly: a kill between plan and execute (nothing
// exists yet), and the exact on-disk aftermath a mid-staging SIGKILL leaves
// (an orphaned `.<name>.cormidia-init-*` stage), which the rerun must converge
// past. The atomic-rename step itself is asserted transitively: no kill leg
// ever observes a half-populated target.

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { initOrgHome, validateOrgHome } from "../../../src/org/home.js";
import { processIsAlive } from "../../../src/org/lifecycle.js";
import { runKillPointScenario, type KillPointResult } from "../../fixtures/kill-point.js";
import {
  diffIsEmpty,
  diffPaths,
  diffSnapshots,
  makeInitWorld,
  makeUpgradeWorld,
  snapshotTree,
  upgradeKillEnv,
  REPO_ROOT,
  UPGRADE_KILL_SCENARIO,
  type TreeSnapshot,
  type UpgradeWorld,
} from "./support.js";

describe("CF-J01-I — kill mid-init-staging / mid-upgrade-transaction (C-OP-LIFE §1/§3, INV-013)", () => {
  let cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.reverse()) await cleanup();
    cleanups = [];
  });

  async function killUpgradeAt(world: UpgradeWorld, killAt: string): Promise<KillPointResult> {
    const result = await runKillPointScenario({
      source: UPGRADE_KILL_SCENARIO,
      killAt,
      env: upgradeKillEnv(world),
      timeoutMs: 25_000,
    });
    cleanups.push(() => result.cleanup());
    expect(result.timedOut).toBe(false);
    expect(result.killedAt).toBe(killAt);
    expect(result.markers.at(-1)).toBe(killAt);
    expect(result.markers).not.toContain("done");
    return result;
  }

  interface UpgradeLegExpectation {
    /** Domain (org home) bytes untouched at this point. */
    orgUnchanged: boolean;
    /** The final (renamed) archive directory exists. */
    finalArchive: boolean;
    /** apps.yaml already carries the schema_version registry write. */
    registryWritten: boolean;
  }

  const UPGRADE_LEGS: Array<[killAt: string, expectation: UpgradeLegExpectation]> = [
    ["before_archive_creation", { orgUnchanged: true, finalArchive: false, registryWritten: false }],
    ["after_archive_creation", { orgUnchanged: true, finalArchive: false, registryWritten: false }],
    ["before_archive_checksum", { orgUnchanged: true, finalArchive: false, registryWritten: false }],
    ["after_archive_checksum", { orgUnchanged: true, finalArchive: false, registryWritten: false }],
    ["before_archive_rename", { orgUnchanged: true, finalArchive: false, registryWritten: false }],
    ["after_archive_rename", { orgUnchanged: true, finalArchive: true, registryWritten: false }],
    // apps.yaml is the first change applied: its fault point is the registry
    // boundary; the remaining additive files are config writes.
    ["before_registry_write", { orgUnchanged: true, finalArchive: true, registryWritten: false }],
    ["after_registry_write", { orgUnchanged: false, finalArchive: true, registryWritten: true }],
    ["before_config_write", { orgUnchanged: false, finalArchive: true, registryWritten: true }],
    ["after_config_write", { orgUnchanged: false, finalArchive: true, registryWritten: true }],
  ];

  async function findFinalArchive(world: UpgradeWorld): Promise<string | undefined> {
    if (!existsSync(world.archiveRoot)) return undefined;
    const { readdir } = await import("node:fs/promises");
    const entries = await readdir(world.archiveRoot);
    return entries.find((name) => !name.endsWith(".partial"));
  }

  it.each(UPGRADE_LEGS)(
    "SIGKILL at %s leaves the journaled intermediate the contract promises",
    async (killAt, expectation) => {
      const world = await makeUpgradeWorld(`kill-${killAt.replaceAll("_", "-")}`);
      cleanups.push(() => world.cleanup());
      const orgBefore: TreeSnapshot = await snapshotTree(world.orgHome);

      const result = await killUpgradeAt(world, killAt);
      expect(processIsAlive(result.pid)).toBe(false);

      // Dead-process-aware lock: the interrupted run's lock file survives the
      // SIGKILL and names a pid that no longer runs — exactly what the next
      // execute reclaims (INV-013 "interrupted migration safe to rerun").
      const lockPath = join(world.stateHome, "lifecycle", "locks", "_org-upgrade.lock");
      expect(existsSync(lockPath)).toBe(true);
      const lock = JSON.parse(await readFile(lockPath, "utf8")) as { pid: number };
      expect(processIsAlive(lock.pid)).toBe(false);

      if (expectation.orgUnchanged) {
        const diff = diffSnapshots(orgBefore, await snapshotTree(world.orgHome));
        expect(
          diffIsEmpty(diff),
          `org home mutated before the registry boundary at ${killAt}: ${diffPaths(diff).join(", ")}`,
        ).toBe(true);
      }

      const appsNow = await readFile(join(world.orgHome, "apps.yaml"), "utf8");
      if (expectation.registryWritten) {
        expect(appsNow).toBe(`schema_version: 1\n${world.originalAppsYaml}`);
      } else {
        expect(appsNow).toBe(world.originalAppsYaml);
      }

      const finalArchive = await findFinalArchive(world);
      if (expectation.finalArchive) {
        expect(finalArchive).toBeDefined();
        // The renamed archive is complete: manifest plus the exact prior
        // registry bytes, restorable after the interruption.
        const archiveDir = join(world.archiveRoot, finalArchive!);
        expect(existsSync(join(archiveDir, "manifest.json"))).toBe(true);
        expect(await readFile(join(archiveDir, "before", "apps.yaml"), "utf8")).toBe(world.originalAppsYaml);
      } else {
        expect(finalArchive, `a partial archive must never appear as final when killed at ${killAt}`).toBeUndefined();
      }

      // Ratified surfaces are never among the casualties of a kill: the
      // human-marked roles.yaml is byte-identical at every interruption point.
      expect(await readFile(join(world.orgHome, "roles.yaml"), "utf8")).toBe(world.ratifiedRolesYaml);
    },
  );

  it("init: SIGKILL between plan and execute leaves no target, state home, or pointer", async () => {
    const w = await makeInitWorld();
    cleanups.push(() => w.cleanup());
    const scenario = `
import { executeOrgInit, planOrgInit } from ${JSON.stringify(join(REPO_ROOT, "src/org/home.js"))};
const plan = await planOrgInit({
  target: process.env.CF_TARGET!,
  name: "killed-before-execute",
  stateHome: process.env.CF_STATE!,
  homeDir: process.env.CF_HOME!,
  pointerPath: process.env.CF_POINTER!,
});
await kp("planned");
await executeOrgInit(plan);
await kp("done");
`;
    const before = await snapshotTree(w.root);
    const result = await runKillPointScenario({
      source: scenario,
      killAt: "planned",
      env: {
        CF_TARGET: w.target,
        CF_STATE: w.stateHome,
        CF_HOME: w.homeDir,
        CF_POINTER: w.pointerPath,
      },
      timeoutMs: 25_000,
    });
    cleanups.push(() => result.cleanup());
    expect(result.killedAt).toBe("planned");
    expect(result.markers).not.toContain("done");
    expect(existsSync(w.target)).toBe(false);
    expect(existsSync(w.stateHome)).toBe(false);
    expect(existsSync(w.pointerPath)).toBe(false);
    const diff = diffSnapshots(before, await snapshotTree(w.root));
    expect(diffIsEmpty(diff), `planning left residue: ${diffPaths(diff).join(", ")}`).toBe(true);
  });

  it("init: the orphaned stage a mid-staging SIGKILL leaves never becomes the org, and the rerun converges past it", async () => {
    const w = await makeInitWorld();
    cleanups.push(() => w.cleanup());
    // The exact aftermath of a SIGKILL inside materializeInitStage: a
    // `.<name>.cormidia-init-*` sibling holding a partial, unvalidated tree.
    const orphan = join(w.root, ".org.cormidia-init-killed01");
    await mkdir(orphan, { recursive: true });
    await writeFile(join(orphan, "TASTE.md"), "partial staged bytes from a killed init\n", "utf8");

    const result = await initOrgHome({
      target: w.target,
      name: "converged-org",
      stateHome: w.stateHome,
      homeDir: w.homeDir,
      pointerPath: w.pointerPath,
    });
    expect(result.orgHome).toBe(w.target);
    await validateOrgHome(w.target);
    // The orphan was neither adopted nor destroyed — the new org's bytes come
    // from its OWN validated stage, and the stray evidence survives for the
    // operator to inspect.
    expect(existsSync(orphan)).toBe(true);
    expect(await readFile(join(w.target, "TASTE.md"), "utf8")).not.toBe("partial staged bytes from a killed init\n");
  });
});
