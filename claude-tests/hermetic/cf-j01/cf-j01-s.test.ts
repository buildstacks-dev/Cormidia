// CF-J01-S — org init / upgrade / use happy paths (L2, STD; C-OP-LIFE §§1–3,
// journey-acceptance J-01; case-catalog row CF-J01-S).
//
// State family: a successful init yields a COMPLETE org home (the product's
// own validator accepts it), a state home, and an atomic active pointer; the
// chosen authority profile lands in AUTHORITY.md and resolves back; a legacy
// org upgrades additively behind a checksummed archive; `org use` re-points
// the selection. All on temp worlds — never the operator's ~/.operon.

import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cmdOrg } from "../../../src/cli/org.js";
import { loadRoles } from "../../../src/org/roles.js";
import {
  CONSERVATIVE_VERSION,
  DELEGATED_OPERATOR_VERSION,
  resolveAuthority,
} from "../../../src/org/authority.js";
import {
  executeOrgInit,
  initOrgHome,
  ORG_REQUIRED_FILES,
  planOrgInit,
  readActiveOrgPointer,
  resolveOperonHomes,
  validateOrgHome,
} from "../../../src/org/home.js";
import { executeOrgUpgrade, planOrgUpgrade } from "../../../src/org/org-upgrade.js";
import {
  makeInitWorld,
  makeUpgradeWorld,
  snapshotTree,
  HUMAN_RATIFIED_MARKER,
  type InitWorld,
} from "./support.js";

describe("CF-J01-S — init/upgrade/use happy paths (C-OP-LIFE §§1–3)", () => {
  let cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.reverse()) await cleanup();
    cleanups = [];
  });

  async function world(): Promise<InitWorld> {
    const w = await makeInitWorld();
    cleanups.push(() => w.cleanup());
    return w;
  }

  it("init (default authority): complete org home + state home + active pointer, plan and result agree (§1)", async () => {
    const w = await world();
    const plan = await planOrgInit({
      target: w.target,
      name: "happy-org",
      stateHome: w.stateHome,
      homeDir: w.homeDir,
      pointerPath: w.pointerPath,
    });
    expect(plan.preview.status).toBe("ready");
    expect(plan.preview.executable).toBe(true);
    expect(plan.preview.effects.org_home).toEqual({ action: "create", path: w.target });
    expect(plan.preview.effects.state_home.action).toBe("create");
    expect(plan.preview.effects.active_pointer.action).toBe("create");

    const result = await executeOrgInit(plan);
    expect(result.orgHome).toBe(w.target);
    expect(result.stateHome).toBe(w.stateHome);

    // Complete home: the product's own resolver/validator accepts it.
    await validateOrgHome(w.target);
    for (const rel of [...ORG_REQUIRED_FILES, "prompts", "AUTHORITY.md", "AGENTS.md", "CLAUDE.md"]) {
      expect(existsSync(join(w.target, rel)), `expected ${rel} in the new org home`).toBe(true);
    }
    // Every planned destination was created — created list mirrors the plan.
    const plannedFiles = plan.preview.effects.generated_destinations
      .filter((entry) => entry.kind === "file")
      .map((entry) => entry.relative_path)
      .sort();
    const createdFiles = result.created.filter((entry) => !entry.endsWith("/")).sort();
    expect(createdFiles).toEqual(plannedFiles);
    // Per-role curated memory exists for every packaged role.
    const roles = await loadRoles(join(w.target, "roles.yaml"));
    for (const role of roles.roles) {
      expect(existsSync(join(w.target, "memory", "roles", role.name, "INDEX.md"))).toBe(true);
    }

    // Active pointer selects the pair; resolveOperonHomes agrees end to end.
    const pointer = await readActiveOrgPointer(w.pointerPath);
    expect(pointer).toEqual({ orgHome: w.target, stateHome: w.stateHome });
    const homes = await resolveOperonHomes({ env: {}, homeDir: w.homeDir, pointerPath: w.pointerPath });
    expect(homes.orgHome).toBe(w.target);
    expect(homes.stateHome).toBe(w.stateHome);
    expect(existsSync(w.stateHome)).toBe(true);

    // Default authority profile is delegated-operator and resolves back.
    const authority = await resolveAuthority({ orgHome: w.target });
    expect(authority.profile).toBe("delegated-operator");
    expect(authority.version).toBe(DELEGATED_OPERATOR_VERSION);
    expect(result.authority.profile).toBe("delegated-operator");
    expect(result.authorityPreview.humanGated.length).toBeGreaterThan(0);
  });

  it("init (conservative authority): the explicit human choice lands and resolves back (§1/§2)", async () => {
    const w = await world();
    const result = await initOrgHome({
      target: w.target,
      name: "cautious-org",
      stateHome: w.stateHome,
      homeDir: w.homeDir,
      pointerPath: w.pointerPath,
      authorityProfile: "conservative",
    });
    expect(result.authority.profile).toBe("conservative");
    const authority = await resolveAuthority({ orgHome: w.target });
    expect(authority.profile).toBe("conservative");
    expect(authority.version).toBe(CONSERVATIVE_VERSION);
    // Conservative gates the destructive/external actions on a human.
    expect(result.authorityPreview.humanGated.length).toBeGreaterThan(0);
  });

  it("upgrade (legacy org): additive changes behind a checksummed archive; registry edit is byte-preserving (§3)", async () => {
    const w = await makeUpgradeWorld("legacy-happy");
    cleanups.push(() => w.cleanup());
    const input = {
      orgHome: w.orgHome,
      stateHome: w.stateHome,
      archiveRoot: w.archiveRoot,
      authorityChoice: "conservative" as const,
    };
    const plan = await planOrgUpgrade(input);
    expect(plan.executable).toBe(true);
    expect(plan.changes.map((change) => change.path).sort()).toEqual([
      "AUTHORITY.md",
      "TASTE.md",
      "apps.yaml",
    ]);
    expect(plan.changes.find((change) => change.path === "apps.yaml")?.action).toBe("schema_add");

    const result = await executeOrgUpgrade(input, plan);
    expect(result.status).toBe("upgraded");
    await validateOrgHome(w.orgHome);

    // Checksummed archive outside the state home holds the exact prior bytes.
    expect(result.archive_path).not.toBeNull();
    const archived = await readFile(join(result.archive_path!, "before", "apps.yaml"), "utf8");
    expect(archived).toBe(w.originalAppsYaml);
    expect(existsSync(join(result.archive_path!, "manifest.json"))).toBe(true);

    // schema_add prepends the version and preserves every other byte.
    const upgraded = await readFile(join(w.orgHome, "apps.yaml"), "utf8");
    expect(upgraded).toBe(`schema_version: 1\n${w.originalAppsYaml}`);

    // Ratified surfaces never replaced: the human marker survives verbatim.
    expect(await readFile(join(w.orgHome, "roles.yaml"), "utf8")).toBe(w.ratifiedRolesYaml);

    // Authority landed with the explicit human choice.
    const authority = await resolveAuthority({ orgHome: w.orgHome });
    expect(authority.profile).toBe("conservative");
  });

  it("upgrade (current org): reports up_to_date and changes nothing (§3)", async () => {
    const w = await makeUpgradeWorld("legacy-idem");
    cleanups.push(() => w.cleanup());
    const input = {
      orgHome: w.orgHome,
      stateHome: w.stateHome,
      archiveRoot: w.archiveRoot,
      authorityChoice: "conservative" as const,
    };
    await executeOrgUpgrade(input);
    const before = await snapshotTree(w.orgHome);
    const again = await executeOrgUpgrade(input);
    expect(again.status).toBe("up_to_date");
    expect(again.archive_path).toBeNull();
    expect(await snapshotTree(w.orgHome)).toEqual(before);
  });

  it("org use: re-points the atomic active pointer at a second complete org and records its state home (§2)", async () => {
    const w = await world();
    await initOrgHome({
      target: w.target,
      name: "first-org",
      stateHome: w.stateHome,
      homeDir: w.homeDir,
      pointerPath: w.pointerPath,
    });
    const secondOrg = join(w.root, "org-two");
    const secondState = join(w.root, "state-two");
    await initOrgHome({
      target: secondOrg,
      name: "second-org",
      stateHome: secondState,
      homeDir: w.homeDir,
      pointerPath: w.pointerPath,
    });
    // init selected the second org; point back to the first through the CLI.
    const code = await cmdOrg(["use", w.target, "--state-home", w.stateHome], {
      homeDir: w.homeDir,
      pointerPath: w.pointerPath,
    });
    expect(code).toBe(0);
    const pointer = await readActiveOrgPointer(w.pointerPath);
    expect(pointer).toEqual({ orgHome: w.target, stateHome: w.stateHome });
    const homes = await resolveOperonHomes({ env: {}, homeDir: w.homeDir, pointerPath: w.pointerPath });
    expect(homes.orgHome).toBe(w.target);
    expect(homes.stateHome).toBe(w.stateHome);
  });

  it("negative control: a required surface removed from a 'complete' home — the completeness detector FIRES", async () => {
    // The happy-path oracle above is validateOrgHome; prove it is a real
    // detector, not an assumption (claude-tests/README.md rule 3).
    const w = await world();
    await initOrgHome({
      target: w.target,
      name: "control-org",
      stateHome: w.stateHome,
      homeDir: w.homeDir,
      pointerPath: w.pointerPath,
    });
    await rm(join(w.target, "pipelines.yaml"));
    await expect(validateOrgHome(w.target)).rejects.toThrow(/missing pipelines\.yaml/);
    await expect(
      resolveOperonHomes({ env: {}, homeDir: w.homeDir, pointerPath: w.pointerPath }),
    ).rejects.toThrow(/not a complete org home/);
  });
});
