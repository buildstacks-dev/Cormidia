// CF-J01-RC — rerun after interruption converges; archived bytes restorable;
// ratified surfaces unreplaced (L2, E1; C-OP-LIFE §3, INV-013, B-10;
// journey-acceptance J-01 "Given an interrupted upgrade, when rerun, then it
// converges with the archived bytes restorable and ratified surfaces
// unreplaced"; case-catalog row CF-J01-RC).
//
// Each convergence leg first SIGKILLs a real subprocess upgrade at a named
// journaled step (same seam as CF-J01-I), then reruns the upgrade IN PROCESS
// and proves: the rerun reclaims the dead lock and completes; the org home
// validates; the FIRST run's archive still holds the exact pre-upgrade
// registry bytes; and the human-marked ratified surface was never replaced.

import { existsSync } from "node:fs";
import { appendFile, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PACKAGE_ROOT, validateOrgHome } from "../../../src/org/home.js";
import { resolveAuthority } from "../../../src/org/authority.js";
import { executeOrgUpgrade, planOrgUpgrade, type OrgUpgradeOptions } from "../../../src/org/org-upgrade.js";
import { runKillPointScenario } from "../../fixtures/kill-point.js";
import {
  diffIsEmpty,
  diffPaths,
  diffSnapshots,
  makeUpgradeWorld,
  snapshotTree,
  upgradeKillEnv,
  UPGRADE_KILL_SCENARIO,
  type UpgradeWorld,
} from "./support.js";

describe("CF-J01-RC — interrupted upgrade rerun converges (C-OP-LIFE §3, INV-013)", () => {
  let cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.reverse()) await cleanup();
    cleanups = [];
  });

  function upgradeInput(world: UpgradeWorld): OrgUpgradeOptions {
    return {
      orgHome: world.orgHome,
      stateHome: world.stateHome,
      archiveRoot: world.archiveRoot,
      authorityChoice: "conservative",
    };
  }

  async function killAtThen(world: UpgradeWorld, killAt: string): Promise<void> {
    const result = await runKillPointScenario({
      source: UPGRADE_KILL_SCENARIO,
      killAt,
      env: upgradeKillEnv(world),
      timeoutMs: 25_000,
    });
    cleanups.push(() => result.cleanup());
    expect(result.timedOut).toBe(false);
    expect(result.killedAt).toBe(killAt);
  }

  async function archiveDirs(world: UpgradeWorld): Promise<string[]> {
    if (!existsSync(world.archiveRoot)) return [];
    return (await readdir(world.archiveRoot)).filter((name) => !name.endsWith(".partial")).sort();
  }

  // Interruption points spanning the transaction: mid-archive, archive
  // complete, registry applied, first config write applied.
  const CONVERGENCE_LEGS = [
    "after_archive_creation",
    "after_archive_rename",
    "after_registry_write",
    "after_config_write",
  ] as const;

  it.each(CONVERGENCE_LEGS.map((leg) => [leg] as const))(
    "kill at %s, rerun: converges, archive restorable, ratified surfaces unreplaced",
    async (killAt) => {
      const world = await makeUpgradeWorld(`rc-${killAt.replaceAll("_", "-")}`);
      cleanups.push(() => world.cleanup());
      await killAtThen(world, killAt);

      // Rerun in-process: reclaims the dead-pid lifecycle lock and completes.
      const input = upgradeInput(world);
      const plan = await planOrgUpgrade(input);
      expect(plan.executable).toBe(true);
      const rerun = await executeOrgUpgrade(input, plan);
      expect(rerun.status).toBe("upgraded");

      // Converged: the org home is complete and authority resolves.
      await validateOrgHome(world.orgHome);
      const authority = await resolveAuthority({ orgHome: world.orgHome });
      expect(authority.profile).toBe("conservative");
      expect(await readFile(join(world.orgHome, "apps.yaml"), "utf8")).toBe(
        `schema_version: 1\n${world.originalAppsYaml}`,
      );
      expect(await readFile(join(world.orgHome, "TASTE.md"), "utf8")).toBe(
        await readFile(join(PACKAGE_ROOT, "TASTE.md"), "utf8"),
      );

      // Ratified surfaces unreplaced: the human marker survives the rerun.
      expect(await readFile(join(world.orgHome, "roles.yaml"), "utf8")).toBe(world.ratifiedRolesYaml);

      // Archived bytes restorable: some completed archive holds the exact
      // pre-upgrade registry bytes (the first run's archive when the kill
      // came after the rename, the rerun's otherwise).
      const archives = await archiveDirs(world);
      expect(archives.length).toBeGreaterThan(0);
      const archivedRegistry = await Promise.all(
        archives.map(async (name) => {
          const path = join(world.archiveRoot, name, "before", "apps.yaml");
          return existsSync(path) ? readFile(path, "utf8") : undefined;
        }),
      );
      expect(archivedRegistry).toContain(world.originalAppsYaml);
    },
  );

  it("a thrown mid-transaction failure restores the exact archived bytes (§3 'thrown failure restores exact archived bytes')", async () => {
    const world = await makeUpgradeWorld("rc-restore");
    cleanups.push(() => world.cleanup());
    const before = await snapshotTree(world.orgHome);

    // In-process fault: fail AFTER the first config write applied (apps.yaml
    // and TASTE.md are already in place) — the archive must roll both back.
    let configWrites = 0;
    const input: OrgUpgradeOptions = {
      ...upgradeInput(world),
      fault: (point) => {
        if (point === "after_config_write") {
          configWrites += 1;
          throw new Error("cf-j01-rc: injected mid-transaction failure");
        }
      },
    };
    await expect(executeOrgUpgrade(input)).rejects.toThrow(/injected mid-transaction failure/);
    expect(configWrites).toBe(1);

    // Exact restoration: the org home is byte-identical to before the attempt.
    const diff = diffSnapshots(before, await snapshotTree(world.orgHome));
    expect(
      diffIsEmpty(diff),
      `thrown failure did not restore exactly: ${diffPaths(diff).join(", ")}`,
    ).toBe(true);

    // And the same input converges when the fault is gone.
    const rerun = await executeOrgUpgrade(upgradeInput(world));
    expect(rerun.status).toBe("upgraded");
    await validateOrgHome(world.orgHome);
  });

  it("negative control: archived bytes tampered after an interruption — the checksum detector FIRES and no change applies", async () => {
    const world = await makeUpgradeWorld("rc-tamper");
    cleanups.push(() => world.cleanup());
    await killAtThen(world, "after_archive_rename");

    const archives = await archiveDirs(world);
    expect(archives.length).toBe(1);
    // SEEDED VIOLATION: a byte appended to the archived registry copy.
    await appendFile(join(world.archiveRoot, archives[0]!, "before", "apps.yaml"), "# tampered\n", "utf8");

    const orgBefore = await snapshotTree(world.orgHome);
    await expect(executeOrgUpgrade(upgradeInput(world))).rejects.toThrow(/archive checksum mismatch/);
    // The refused rerun changed nothing in the org home.
    const diff = diffSnapshots(orgBefore, await snapshotTree(world.orgHome));
    expect(diffIsEmpty(diff), `tamper refusal mutated: ${diffPaths(diff).join(", ")}`).toBe(true);
    expect(existsSync(join(world.orgHome, "TASTE.md"))).toBe(false);
  });

  it("a ratified surface appearing after preview is never overwritten — the stale-plan detector FIRES (§3 additive-only)", async () => {
    const world = await makeUpgradeWorld("rc-stale");
    cleanups.push(() => world.cleanup());
    const input = upgradeInput(world);
    const plan = await planOrgUpgrade(input);
    expect(plan.changes.some((change) => change.path === "TASTE.md")).toBe(true);

    // SEEDED VIOLATION: a human lands their own TASTE.md between preview and
    // execute. Upgrade must refuse rather than replace it.
    const humanBytes = "# human TASTE written after the preview\n";
    await writeFile(join(world.orgHome, "TASTE.md"), humanBytes, "utf8");
    await expect(executeOrgUpgrade(input, plan)).rejects.toThrow(
      /reviewed plan is stale|refusing to overwrite/,
    );
    expect(await readFile(join(world.orgHome, "TASTE.md"), "utf8")).toBe(humanBytes);
  });
});
