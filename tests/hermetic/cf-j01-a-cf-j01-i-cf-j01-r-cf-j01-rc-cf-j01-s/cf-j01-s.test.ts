// Traceability: CF-J01-S · HB-015 · contracts/journey-acceptance.md J-01 success criterion.

// CF-J01-S — org init / upgrade / use happy paths (L2, STD; C-OP-LIFE §§1–3,
// journey-acceptance J-01; case-catalog row CF-J01-S).
//
// State family: a successful init yields a COMPLETE org home (the product's
// own validator accepts it), a state home, and an atomic active pointer; the
// chosen authority profile lands in AUTHORITY.md and resolves back; a legacy
// org upgrades additively behind a checksummed archive; `org use` re-points
// the selection. All on temp worlds — never the operator's ~/.cormidia.
//
// #387 (2026-08-12) added the packaged-seed legs: init seeds the ratified
// Claude frontier tuple, and upgrade never migrates an org already pinned to
// the previous one (research/2026-08-12_claude-frontier-model-refresh.md).

import { existsSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cmdOrg } from "../../../src/cli/org.js";
import { loadRoles, type RolesFile } from "../../../src/org/roles.js";
import { CONSERVATIVE_VERSION, DELEGATED_OPERATOR_VERSION, resolveAuthority } from "../../../src/org/authority.js";
import {
  executeOrgInit,
  initOrgHome,
  ORG_REQUIRED_FILES,
  PACKAGE_ROOT,
  planOrgInit,
  readActiveOrgPointer,
  resolveCormidiaHomes,
  validateOrgHome,
} from "../../../src/org/home.js";
import { executeOrgUpgrade, planOrgUpgrade } from "../../../src/org/org-upgrade.js";
import { makeInitWorld, makeUpgradeWorld, snapshotTree, type InitWorld } from "./support.js";

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

    // Active pointer selects the pair; resolveCormidiaHomes agrees end to end.
    const pointer = await readActiveOrgPointer(w.pointerPath);
    expect(pointer).toEqual({ orgHome: w.target, stateHome: w.stateHome });
    const homes = await resolveCormidiaHomes({ env: {}, homeDir: w.homeDir, pointerPath: w.pointerPath });
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
    expect(plan.changes.map((change) => change.path).sort()).toEqual(["AUTHORITY.md", "TASTE.md", "apps.yaml"]);
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

  // #387 — the packaged seed's Claude frontier tier
  // (research/2026-08-12_claude-frontier-model-refresh.md). Two halves of one
  // product truth: init seeds the CURRENT ratified default, and upgrade never
  // pushes that default onto an org that already chose its own. The upgrade
  // half's negative control is the third leg — without it, "roles.yaml
  // unchanged" could pass simply because upgrade cannot write roles.yaml at
  // all.
  const CLAUDE_FRONTIER_ROLES = ["planner", "reviewer", "operator"] as const;
  const RATIFIED_CLAUDE_FRONTIER = { runtime: "claude", model: "claude-opus-5" } as const;
  /** The assignment a pre-refresh org was seeded with, pinned literally: the
   *  point of the case is that these exact bytes survive. */
  const PRE_REFRESH_CLAUDE_FRONTIER = "claude-opus-4-8";

  /** Named lookup that fails loudly on a missing role: a seed that lost a
   *  role must read as an error, never as a silently skipped assertion. */
  function requireRole(file: RolesFile, name: string) {
    const found = file.roles.find((entry) => entry.name === name);
    if (found === undefined) throw new Error(`roles.yaml has no "${name}" role`);
    return found;
  }

  it("init seeds the ratified Claude frontier tuple for planner/reviewer/operator (§1, #387)", async () => {
    const w = await world();
    await initOrgHome({
      target: w.target,
      name: "frontier-org",
      stateHome: w.stateHome,
      homeDir: w.homeDir,
      pointerPath: w.pointerPath,
    });

    const seeded = await loadRoles(join(w.target, "roles.yaml"));
    for (const name of CLAUDE_FRONTIER_ROLES) {
      const seededRole = requireRole(seeded, name);
      expect({ runtime: seededRole.runtime, model: seededRole.model }).toEqual(RATIFIED_CLAUDE_FRONTIER);
    }

    // The refresh moved the Claude side of the pair only: builder stays on a
    // DIFFERENT provider than reviewer (AGENTS.md working rule — uncorrelated
    // review blind spots are never collapsed onto one provider).
    expect(requireRole(seeded, "builder").runtime).toBe("codex");
    expect(requireRole(seeded, "builder").runtime).not.toBe(requireRole(seeded, "reviewer").runtime);

    // Seeded, never generated: the org's copy is the packaged ratified
    // surface verbatim, so this case pins the shipped file and not a
    // re-derivation of it.
    expect(await readFile(join(w.target, "roles.yaml"), "utf8")).toBe(
      await readFile(join(PACKAGE_ROOT, "roles.yaml"), "utf8"),
    );
  });

  it("upgrade leaves an existing org's roles.yaml byte-identical, including a pre-refresh model pin (§3, #387)", async () => {
    const w = await makeUpgradeWorld("frontier-pinned");
    cleanups.push(() => w.cleanup());

    // An org onboarded BEFORE the refresh: its planner/reviewer/operator are
    // pinned to the previous frontier id. Upgrading must not migrate them.
    const pinnedRolesYaml = w.ratifiedRolesYaml.replaceAll(
      `model: ${RATIFIED_CLAUDE_FRONTIER.model}`,
      `model: ${PRE_REFRESH_CLAUDE_FRONTIER}`,
    );
    expect(pinnedRolesYaml, "fixture did not actually pin the pre-refresh model").not.toBe(w.ratifiedRolesYaml);
    await writeFile(join(w.orgHome, "roles.yaml"), pinnedRolesYaml, "utf8");

    const input = {
      orgHome: w.orgHome,
      stateHome: w.stateHome,
      archiveRoot: w.archiveRoot,
      authorityChoice: "conservative" as const,
    };
    const plan = await planOrgUpgrade(input);
    expect(plan.changes.map((change) => change.path)).not.toContain("roles.yaml");
    const result = await executeOrgUpgrade(input, plan);
    expect(result.status).toBe("upgraded");
    await validateOrgHome(w.orgHome);

    // Bytes, then meaning: the file is untouched and still parses to the
    // operator's own assignment, not the newly packaged one.
    expect(await readFile(join(w.orgHome, "roles.yaml"), "utf8")).toBe(pinnedRolesYaml);
    const kept = await loadRoles(join(w.orgHome, "roles.yaml"));
    for (const name of CLAUDE_FRONTIER_ROLES) {
      expect(requireRole(kept, name).model).toBe(PRE_REFRESH_CLAUDE_FRONTIER);
    }
  });

  it("negative control: roles.yaml MISSING from the org — the additive path FIRES and copies the packaged seed (§3, #387)", async () => {
    // Proves the preceding leg is not vacuous: upgrade genuinely can write
    // roles.yaml, and does when it is absent. "Unchanged" there is a refusal
    // to overwrite, not an inability to write.
    const w = await makeUpgradeWorld("frontier-absent");
    cleanups.push(() => w.cleanup());
    await rm(join(w.orgHome, "roles.yaml"));

    const input = {
      orgHome: w.orgHome,
      stateHome: w.stateHome,
      archiveRoot: w.archiveRoot,
      authorityChoice: "conservative" as const,
    };
    const plan = await planOrgUpgrade(input);
    expect(plan.changes.find((change) => change.path === "roles.yaml")?.action).toBe("add");
    expect((await executeOrgUpgrade(input, plan)).status).toBe("upgraded");

    expect(await readFile(join(w.orgHome, "roles.yaml"), "utf8")).toBe(
      await readFile(join(PACKAGE_ROOT, "roles.yaml"), "utf8"),
    );
    const added = await loadRoles(join(w.orgHome, "roles.yaml"));
    for (const name of CLAUDE_FRONTIER_ROLES) {
      expect(requireRole(added, name).model).toBe(RATIFIED_CLAUDE_FRONTIER.model);
    }
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
    const homes = await resolveCormidiaHomes({ env: {}, homeDir: w.homeDir, pointerPath: w.pointerPath });
    expect(homes.orgHome).toBe(w.target);
    expect(homes.stateHome).toBe(w.stateHome);
  });

  it("negative control: a required surface removed from a 'complete' home — the completeness detector FIRES", async () => {
    // The happy-path oracle above is validateOrgHome; prove it is a real
    // detector, not an assumption (tests/README.md rule 3).
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
    await expect(resolveCormidiaHomes({ env: {}, homeDir: w.homeDir, pointerPath: w.pointerPath })).rejects.toThrow(
      /not a complete org home/,
    );
  });
});
