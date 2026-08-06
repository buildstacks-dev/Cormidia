// CF-J01-S — org init / upgrade / use happy paths (L2, STD; C-OP-LIFE §§1–3,
// journey-acceptance J-01; case-catalog row CF-J01-S).
//
// State family: a successful init yields a COMPLETE org home (the product's
// own validator accepts it), a state home, and an atomic active pointer; the
// chosen authority profile lands in AUTHORITY.md and resolves back; a legacy
// org upgrades additively behind a checksummed archive; `org use` re-points
// the selection. All on temp worlds — never the operator's ~/.cormidia.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cmdOrg } from "../../../src/cli/org.js";
import { loadRoles } from "../../../src/org/roles.js";
import { CONSERVATIVE_VERSION, DELEGATED_OPERATOR_VERSION, resolveAuthority } from "../../../src/org/authority.js";
import {
  executeOrgInit,
  initOrgHome,
  migrateLegacyStateRoot,
  ORG_REQUIRED_FILES,
  planOrgInit,
  readActiveOrgPointer,
  resolveCormidiaHomes,
  validateOrgHome,
} from "../../../src/org/home.js";
import { executeOrgUpgrade, planOrgUpgrade } from "../../../src/org/org-upgrade.js";
import { buildSchedulerExpectation } from "../../../src/org/scheduler/definition.js";
import type { SchedulerManager, SchedulerManagerInspection } from "../../../src/org/scheduler/manager.js";
import { schedulerIdentity, schedulerOrgId, sha256 as schedulerSha256 } from "../../../src/org/scheduler/model.js";
import {
  diffIsEmpty,
  diffSnapshots,
  makeInitWorld,
  makeUpgradeWorld,
  snapshotTree,
  type InitWorld,
} from "./support.js";

class MigrationSchedulerManager implements SchedulerManager {
  readonly backend = "launchd" as const;
  readonly platform = "darwin" as const;
  readonly supported = true;
  readonly definitions = new Map<string, string>();
  readonly enabled = new Set<string>();
  readonly operations: string[] = [];

  constructor(private readonly root: string) {}

  definitionPath(schedulerId: string): string {
    return join(this.root, `${schedulerId}.plist`);
  }

  async readDefinition(schedulerId: string): Promise<string | undefined> {
    return this.definitions.get(schedulerId);
  }

  async writeDefinition(schedulerId: string, definition: string): Promise<void> {
    this.operations.push(`write:${schedulerId}`);
    this.definitions.set(schedulerId, definition);
  }

  async removeDefinition(schedulerId: string): Promise<void> {
    this.operations.push(`remove:${schedulerId}`);
    this.definitions.delete(schedulerId);
  }

  async enable(schedulerId: string): Promise<void> {
    this.operations.push(`enable:${schedulerId}`);
    this.enabled.add(schedulerId);
  }

  async disable(schedulerId: string): Promise<void> {
    this.operations.push(`disable:${schedulerId}`);
    this.enabled.delete(schedulerId);
  }

  async inspect(schedulerId: string): Promise<SchedulerManagerInspection> {
    return {
      installed: this.definitions.has(schedulerId),
      loaded: this.enabled.has(schedulerId),
      active: this.enabled.has(schedulerId),
      detail: "migration fixture",
    };
  }
}

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

  it("first Cormidia resolution atomically migrates the retired default state root and converges", async () => {
    const w = await world();
    const legacyRoot = join(w.homeDir, ".operon");
    const legacyState = join(legacyRoot, "migrating-org");
    const legacyPointer = join(legacyRoot, "config");
    await initOrgHome({
      target: w.target,
      name: "migrating-org",
      stateHome: legacyState,
      homeDir: w.homeDir,
      pointerPath: legacyPointer,
    });
    await writeFile(join(legacyState, "preserved.txt"), "state bytes survive the move\n", "utf8");

    const legacyRepo = join(legacyState, "repos", "demo");
    const legacyWorktree = join(legacyState, "worktrees", "demo", "ticket-1");
    await mkdir(legacyRepo, { recursive: true });
    execFileSync("git", ["init", "-q", "-b", "trunk", legacyRepo]);
    execFileSync("git", ["-C", legacyRepo, "config", "user.name", "Cormidia Test"]);
    execFileSync("git", ["-C", legacyRepo, "config", "user.email", "cormidia@example.invalid"]);
    await writeFile(join(legacyRepo, "README.md"), "fixture\n", "utf8");
    execFileSync("git", ["-C", legacyRepo, "add", "README.md"]);
    execFileSync("git", ["-C", legacyRepo, "commit", "-q", "-m", "fixture"]);
    await mkdir(join(legacyState, "worktrees", "demo"), { recursive: true });
    execFileSync("git", ["-C", legacyRepo, "worktree", "add", "-q", "-b", "op/test", legacyWorktree]);

    const lifecycleRecord = join(legacyState, "lifecycle", "apps", "demo", "record.json");
    await mkdir(join(legacyState, "lifecycle", "apps", "demo"), { recursive: true });
    await writeFile(
      lifecycleRecord,
      `${JSON.stringify({ schema_version: 1, kind: "app-lifecycle", managed_clone: legacyRepo }, null, 2)}\n`,
      "utf8",
    );

    const turnJournal = join(legacyState, "state", "turns", "turn-1.json");
    await mkdir(join(legacyState, "state", "turns"), { recursive: true });
    await writeFile(
      turnJournal,
      `${JSON.stringify(
        {
          turnId: "turn-1",
          role: "builder",
          app: "demo",
          phase: "failed",
          attempt: 1,
          startedAt: "2026-08-02T00:00:00.000Z",
          updatedAt: "2026-08-02T00:01:00.000Z",
          worktree: legacyWorktree,
          recovery: {
            reasonCode: "error_ambiguous_worktree",
            path: legacyWorktree,
            branch: "op/test",
            dirty: false,
            statusEntries: 0,
            recoveryCommand: `git -C ${JSON.stringify(legacyWorktree)} status --short --branch`,
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const schedulerManager = new MigrationSchedulerManager(join(w.root, "scheduler-definitions"));
    const retiredOwner = ["ope", "ron"].join("");
    const currentIdentity = schedulerIdentity("migrating-org", w.target);
    const retiredIdentity = currentIdentity.replace("dev.cormidia.dispatch.", `dev.${retiredOwner}.dispatch.`);
    const retiredMetadata = {
      schema_version: 1,
      owner: retiredOwner,
      scheduler_id: retiredIdentity,
      org_id: schedulerOrgId("migrating-org", w.target),
      org_name: "migrating-org",
      backend: "launchd",
      cadence_minutes: 5,
      executable_path: "/usr/bin/node",
      package_entry_path: join(w.root, "dist", "cli.js"),
      org_home: w.target,
      state_home: legacyState,
      command_sha256: "sha256:retired-command",
    };
    const retiredDefinition =
      `<!-- ${retiredOwner}-scheduler-metadata-v1:` +
      `${Buffer.from(JSON.stringify(retiredMetadata), "utf8").toString("base64url")} -->\n`;
    schedulerManager.definitions.set(retiredIdentity, retiredDefinition);
    schedulerManager.enabled.add(retiredIdentity);
    await mkdir(join(legacyState, "scheduler"), { recursive: true });
    await writeFile(
      join(legacyState, "scheduler", "installation.json"),
      `${JSON.stringify(
        {
          schema_version: 1,
          scheduler_id: retiredIdentity,
          org_id: retiredMetadata.org_id,
          org_name: retiredMetadata.org_name,
          backend: retiredMetadata.backend,
          cadence_minutes: retiredMetadata.cadence_minutes,
          executable_path: retiredMetadata.executable_path,
          package_entry_path: retiredMetadata.package_entry_path,
          org_home: retiredMetadata.org_home,
          state_home: retiredMetadata.state_home,
          definition_path: schedulerManager.definitionPath(retiredIdentity),
          rendered_definition_hash: schedulerSha256(retiredDefinition),
          installed_at: "2026-08-02T00:00:00.000Z",
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const homes = await resolveCormidiaHomes({
      env: {},
      homeDir: w.homeDir,
      migration: { schedulerManager: () => schedulerManager },
    });
    const currentRoot = join(w.homeDir, ".cormidia");
    const currentState = join(currentRoot, "migrating-org");
    const currentRepo = join(currentState, "repos", "demo");
    const currentWorktree = join(currentState, "worktrees", "demo", "ticket-1");
    expect(existsSync(legacyRoot)).toBe(false);
    expect(homes.stateHome).toBe(currentState);
    expect(await readFile(join(currentState, "preserved.txt"), "utf8")).toBe("state bytes survive the move\n");
    expect(await readActiveOrgPointer(join(currentRoot, "config"))).toEqual({
      orgHome: w.target,
      stateHome: currentState,
    });
    expect(
      JSON.parse(await readFile(join(currentState, "lifecycle", "apps", "demo", "record.json"), "utf8")),
    ).toMatchObject({ managed_clone: currentRepo });
    const repairedJournal = JSON.parse(await readFile(join(currentState, "state", "turns", "turn-1.json"), "utf8")) as {
      worktree: string;
      recovery: { path: string; recoveryCommand: string };
    };
    expect(repairedJournal).toMatchObject({
      worktree: currentWorktree,
      recovery: { path: currentWorktree },
    });
    expect(repairedJournal.recovery.recoveryCommand).toContain(JSON.stringify(currentWorktree));
    expect(
      execFileSync("git", ["-C", currentWorktree, "rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim(),
    ).toBe(await realpath(currentWorktree));

    const expectedScheduler = buildSchedulerExpectation({
      backend: "launchd",
      orgName: "migrating-org",
      orgHome: w.target,
      stateHome: currentState,
      packageEntryPath: retiredMetadata.package_entry_path,
      executablePath: retiredMetadata.executable_path,
      cadenceMinutes: retiredMetadata.cadence_minutes,
    });
    expect(schedulerManager.definitions.has(retiredIdentity)).toBe(false);
    expect(schedulerManager.definitions.get(expectedScheduler.metadata.scheduler_id)).toBe(
      expectedScheduler.definition,
    );
    expect(schedulerManager.enabled.has(expectedScheduler.metadata.scheduler_id)).toBe(true);
    expect(JSON.parse(await readFile(join(currentState, "scheduler", "installation.json"), "utf8"))).toMatchObject({
      scheduler_id: expectedScheduler.metadata.scheduler_id,
      org_id: expectedScheduler.metadata.org_id,
      state_home: currentState,
      rendered_definition_hash: expectedScheduler.definitionHash,
    });

    const before = await snapshotTree(currentRoot);
    const again = await migrateLegacyStateRoot(w.homeDir, { schedulerManager: () => schedulerManager });
    expect(again.status).toBe("not_needed");
    expect(diffIsEmpty(diffSnapshots(before, await snapshotTree(currentRoot)))).toBe(true);
  });

  it("repairs only registered linked worktrees while preserving other worktree-root directories", async () => {
    const w = await world();
    const legacyRoot = join(w.homeDir, [".ope", "ron"].join(""));
    const legacyState = join(legacyRoot, "migrating-org");
    await initOrgHome({
      target: w.target,
      name: "migrating-org",
      stateHome: legacyState,
      homeDir: w.homeDir,
      pointerPath: join(legacyRoot, "config"),
    });

    const legacyRepo = join(legacyState, "repos", "demo");
    const legacyWorktrees = join(legacyState, "worktrees", "demo");
    const linkedWorktree = join(legacyWorktrees, "ticket-1");
    await mkdir(legacyRepo, { recursive: true });
    execFileSync("git", ["init", "-q", "-b", "trunk", legacyRepo]);
    execFileSync("git", ["-C", legacyRepo, "config", "user.name", "Cormidia Test"]);
    execFileSync("git", ["-C", legacyRepo, "config", "user.email", "cormidia@example.invalid"]);
    await writeFile(join(legacyRepo, "README.md"), "fixture\n", "utf8");
    execFileSync("git", ["-C", legacyRepo, "add", "README.md"]);
    execFileSync("git", ["-C", legacyRepo, "commit", "-q", "-m", "fixture"]);
    await mkdir(legacyWorktrees, { recursive: true });
    execFileSync("git", ["-C", legacyRepo, "worktree", "add", "-q", "-b", "op/test", linkedWorktree]);

    const staleWorktree = join(legacyWorktrees, "preserved-stale-worktree");
    await mkdir(staleWorktree, { recursive: true });
    await writeFile(
      join(staleWorktree, ".git"),
      `gitdir: ${join(legacyRepo, ".git", "worktrees", "missing-registration")}\n`,
      "utf8",
    );
    await writeFile(join(staleWorktree, "preserved.txt"), "ambiguous worktree bytes\n", "utf8");

    const standaloneRepo = join(legacyWorktrees, "standalone-plan-clone");
    execFileSync("git", ["init", "-q", "-b", "plan", standaloneRepo]);
    await writeFile(join(standaloneRepo, "preserved.txt"), "standalone clone bytes\n", "utf8");

    const migration = await migrateLegacyStateRoot(w.homeDir);
    const currentState = join(w.homeDir, ".cormidia", "migrating-org");
    const currentLinkedWorktree = join(currentState, "worktrees", "demo", "ticket-1");
    expect(migration.status).toBe("migrated");
    expect(
      execFileSync("git", ["-C", currentLinkedWorktree, "rev-parse", "--show-toplevel"], {
        encoding: "utf8",
      }).trim(),
    ).toBe(await realpath(currentLinkedWorktree));
    expect(
      await readFile(join(currentState, "worktrees", "demo", "preserved-stale-worktree", "preserved.txt"), "utf8"),
    ).toBe("ambiguous worktree bytes\n");
    expect(
      await readFile(join(currentState, "worktrees", "demo", "standalone-plan-clone", "preserved.txt"), "utf8"),
    ).toBe("standalone clone bytes\n");
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
