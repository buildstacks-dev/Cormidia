// Explicit packaging boundary: package source, committed org home, runtime
// state, and app repos are separate locations.

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  executeOrgInit,
  initOrgHome,
  ORG_HOME_DEFINITION,
  PACKAGE_ROOT,
  planOrgInit,
  resolveOperonHomes,
  STATE_HOME_DEFINITION,
} from "../src/org/home.js";
import { cmdOrg } from "../src/cli/org.js";
import { loadRoles } from "../src/org/roles.js";

const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function temp(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

async function captureOrg(
  args: string[],
  options: Parameters<typeof cmdOrg>[1],
): Promise<{ code: number; output: string }> {
  const lines: string[] = [];
  const log = vi.spyOn(console, "log").mockImplementation((...values: unknown[]) => {
    lines.push(values.map(String).join(" "));
  });
  try {
    const code = await cmdOrg(args, options);
    return { code, output: lines.join("\n") };
  } finally {
    log.mockRestore();
  }
}

describe("org home lifecycle", () => {
  it("atomically creates a complete org, separate state home, and active pointer", async () => {
    const parent = temp("operon-org-parent-");
    const fakeHome = temp("operon-user-home-");
    const orgHome = join(parent, "my-org");

    const result = await initOrgHome({ target: orgHome, name: "my-org", homeDir: fakeHome });

    expect(result.orgHome).toBe(orgHome);
    expect(result.stateHome).toBe(join(fakeHome, ".operon", "my-org"));
    for (const rel of ["AUTHORITY.md", "AGENTS.md", "CLAUDE.md", "TASTE.md", "roles.yaml", "apps.yaml", "pipelines.yaml", "prompts"]) {
      expect(existsSync(join(orgHome, rel))).toBe(true);
    }
    expect(result.authority.version).toBe("delegated-operator/v1");
    expect(await readFile(join(orgHome, "AGENTS.md"), "utf8")).toContain("operon-authority:start");
    expect(await readFile(join(orgHome, "CLAUDE.md"), "utf8")).toContain("AUTHORITY.md");
    expect(result.appsFile.apps).toEqual([]);
    expect(await readFile(join(fakeHome, ".operon", "config"), "utf8")).toContain(`org_home: ${orgHome}`);

    const resolved = await resolveOperonHomes({ homeDir: fakeHome });
    expect(resolved.orgHome).toBe(orgHome);
    expect(resolved.stateHome).toBe(result.stateHome);
  });

  it("persists an explicitly selected state home across later commands", async () => {
    const parent = temp("operon-custom-state-");
    const fakeHome = temp("operon-custom-home-");
    const orgHome = join(parent, "org");
    const stateHome = join(parent, "state");
    await initOrgHome({ target: orgHome, name: "custom", stateHome, homeDir: fakeHome });

    const resolved = await resolveOperonHomes({ homeDir: fakeHome });
    expect(resolved.orgHome).toBe(orgHome);
    expect(resolved.stateHome).toBe(stateHome);
    expect(await readFile(join(fakeHome, ".operon", "config"), "utf8")).toContain(
      `state_home: ${stateHome}`,
    );
  });

  it("keeps org and state overrides semantically independent", async () => {
    const parent = temp("operon-org-overrides-");
    const fakeHome = temp("operon-user-overrides-");
    const orgHome = join(parent, "org-config");
    const stateHome = join(parent, "runtime-state");
    await initOrgHome({ target: orgHome, name: "separate", homeDir: fakeHome });

    const resolved = await resolveOperonHomes({
      env: { OPERON_ORG_HOME: orgHome, OPERON_STATE_HOME: stateHome },
      homeDir: fakeHome,
    });
    expect(resolved.orgHome).toBe(orgHome);
    expect(resolved.stateHome).toBe(stateHome);
  });

  it("prints one-line meanings during org initialization", async () => {
    const parent = temp("operon-org-cli-");
    const fakeHome = temp("operon-user-cli-");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await cmdOrg(["init", join(parent, "team"), "--name", "team"], { homeDir: fakeHome });
    const output = log.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(output).toContain(ORG_HOME_DEFINITION);
    expect(output).toContain(STATE_HOME_DEFINITION);
    expect(output).toContain("operon doctor");
    expect(output).toContain("ordinary reversible decisions");
    expect(output).toContain("publication or deployment");
  });

  it("records an explicitly selected conservative authority profile", async () => {
    const parent = temp("operon-org-conservative-");
    const fakeHome = temp("operon-user-conservative-");
    const result = await initOrgHome({
      target: join(parent, "org"),
      name: "careful",
      homeDir: fakeHome,
      authorityProfile: "conservative",
    });
    expect(result.authority.version).toBe("conservative/v1");
    expect(await readFile(join(result.orgHome, "AUTHORITY.md"), "utf8")).toMatch(
      /Ask before\s+making edits/,
    );
  });

  it("accepts an attributable custom charter through org init", async () => {
    const parent = temp("operon-org-custom-");
    const fakeHome = temp("operon-user-custom-");
    const source = join(parent, "custom-authority.md");
    writeFileSync(source, "Run routine local work, but ask before changing billing logic.\n");
    await cmdOrg(
      [
        "init",
        join(parent, "org"),
        "--name",
        "custom",
        "--authority",
        "custom",
        "--authority-file",
        source,
        "--authority-by",
        "bikram",
      ],
      { homeDir: fakeHome },
    );
    const charter = await readFile(join(parent, "org", "AUTHORITY.md"), "utf8");
    expect(charter).toContain("profile: custom");
    expect(charter).toContain("granted_by: bikram");
    expect(charter).toContain("ask before changing billing logic");
  });

  it("populates an existing empty directory", async () => {
    const target = temp("operon-existing-empty-");
    const fakeHome = temp("operon-existing-empty-home-");

    const result = await initOrgHome({ target, name: "existing", homeDir: fakeHome });

    expect(result.orgHome).toBe(target);
    expect(existsSync(join(target, "roles.yaml"))).toBe(true);
    expect(result.created).toContain("roles.yaml");
    expect(result.created).toContain("prompts/");
  });

  it("preserves unrelated bytes while reusing existing generated directories", async () => {
    const target = temp("operon-existing-unrelated-");
    const fakeHome = temp("operon-existing-unrelated-home-");
    mkdirSync(join(target, "design"));
    mkdirSync(join(target, "operon-findings"));
    mkdirSync(join(target, "prompts"));
    mkdirSync(join(target, "memory"));
    writeFileSync(join(target, "design", "brief.md"), Buffer.from([0, 1, 2, 255]));
    writeFileSync(join(target, "operon-findings", "ISSUE.md"), "keep exactly\n");
    writeFileSync(join(target, "prompts", "operator-note.md"), "unrelated prompt note\n");
    writeFileSync(join(target, "memory", "operator-note.md"), "unrelated memory note\n");

    const result = await initOrgHome({ target, name: "preserve", homeDir: fakeHome });

    expect(readFileSync(join(target, "design", "brief.md"))).toEqual(Buffer.from([0, 1, 2, 255]));
    expect(readFileSync(join(target, "operon-findings", "ISSUE.md"), "utf8")).toBe("keep exactly\n");
    expect(readFileSync(join(target, "prompts", "operator-note.md"), "utf8")).toBe("unrelated prompt note\n");
    expect(readFileSync(join(target, "memory", "operator-note.md"), "utf8")).toBe("unrelated memory note\n");
    expect(existsSync(join(target, "prompts", "build", "contract.md"))).toBe(true);
    expect(result.created).not.toContain("prompts/");
    expect(result.created).not.toContain("memory/");
    expect(result.created).toContain("prompts/build/");
  });

  it("gives complete-org selection guidance before generic collision errors", async () => {
    const target = temp("operon-complete-collision-");
    const fakeHome = temp("operon-complete-collision-home-");
    for (const rel of ["TASTE.md", "roles.yaml", "apps.yaml", "pipelines.yaml"]) {
      writeFileSync(join(target, rel), `existing ${rel}\n`);
    }
    mkdirSync(join(target, "prompts"));
    const marker = readFileSync(join(target, "roles.yaml"));

    const plan = await planOrgInit({ target, name: "complete", homeDir: fakeHome });

    expect(plan.preview.executable).toBe(false);
    expect(plan.preview.blockers[0]).toMatchObject({ code: "existing_org", path: target });
    expect(plan.preview.blockers[0]!.detail).toContain("an Operon org already exists");
    expect(plan.preview.blockers[0]!.detail).toContain(`operon org use ${target}`);
    await expect(initOrgHome({ target, name: "complete", homeDir: fakeHome })).rejects.toThrow(
      /an Operon org already exists.*operon org use/,
    );
    expect(readFileSync(join(target, "roles.yaml"))).toEqual(marker);
    expect(existsSync(join(fakeHome, ".operon"))).toBe(false);
  });

  it("blocks a partial org collision before any mutation", async () => {
    const target = temp("operon-partial-collision-");
    const fakeHome = temp("operon-partial-collision-home-");
    writeFileSync(join(target, "roles.yaml"), "operator-owned partial bytes\n");
    const before = readdirSync(target);

    const plan = await planOrgInit({ target, name: "partial", homeDir: fakeHome });

    expect(plan.preview.executable).toBe(false);
    expect(plan.preview.blockers).toContainEqual(expect.objectContaining({
      code: "generated_path_collision",
      path: join(target, "roles.yaml"),
    }));
    await expect(initOrgHome({ target, name: "partial", homeDir: fakeHome })).rejects.toThrow(
      /generated destination already exists/,
    );
    expect(readdirSync(target)).toEqual(before);
    expect(readFileSync(join(target, "roles.yaml"), "utf8")).toBe("operator-owned partial bytes\n");
    expect(existsSync(join(fakeHome, ".operon"))).toBe(false);
  });

  it("blocks nested file and symlink collisions without following them", async () => {
    const target = temp("operon-nested-collision-");
    const fakeHome = temp("operon-nested-collision-home-");
    const outside = temp("operon-nested-collision-outside-");
    mkdirSync(join(target, "prompts", "build"), { recursive: true });
    writeFileSync(join(target, "prompts", "build", "contract.md"), "operator contract\n");
    mkdirSync(join(target, "memory", "roles"), { recursive: true });
    symlinkSync(outside, join(target, "memory", "roles", "planner"));

    const plan = await planOrgInit({ target, name: "nested", homeDir: fakeHome });

    expect(plan.preview.executable).toBe(false);
    expect(plan.preview.blockers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "generated_path_symlink",
        path: join(target, "memory", "roles", "planner"),
      }),
      expect.objectContaining({
        code: "generated_path_collision",
        path: join(target, "prompts", "build", "contract.md"),
      }),
    ]));
    await expect(initOrgHome({ target, name: "nested", homeDir: fakeHome })).rejects.toThrow();
    expect(readFileSync(join(target, "prompts", "build", "contract.md"), "utf8")).toBe("operator contract\n");
    expect(readdirSync(outside)).toEqual([]);
    expect(existsSync(join(target, "AUTHORITY.md"))).toBe(false);
  });

  it("rejects non-directory targets and invalid path ancestors", async () => {
    const parent = temp("operon-invalid-target-");
    const fakeHome = temp("operon-invalid-target-home-");
    const target = join(parent, "org-file");
    writeFileSync(target, "do not replace\n");
    const ancestorFile = join(parent, "state-parent");
    writeFileSync(ancestorFile, "not a directory\n");
    const outside = temp("operon-pointer-symlink-outside-");
    const targetParent = join(parent, "target-parent");
    const stateParent = join(parent, "state-symlink-parent");
    const pointerParent = join(parent, "pointer-parent");
    symlinkSync(outside, targetParent);
    symlinkSync(outside, stateParent);
    symlinkSync(outside, pointerParent);

    const targetPlan = await planOrgInit({ target, name: "invalid", homeDir: fakeHome });
    const statePlan = await planOrgInit({
      target: join(parent, "other-org"),
      name: "invalid-state",
      stateHome: join(ancestorFile, "state"),
      homeDir: fakeHome,
    });
    const pointerPlan = await planOrgInit({
      target: join(parent, "pointer-org"),
      name: "invalid-pointer",
      stateHome: join(parent, "pointer-state"),
      pointerPath: join(pointerParent, "config"),
      homeDir: fakeHome,
    });
    const targetSymlinkPlan = await planOrgInit({
      target: join(targetParent, "org"),
      name: "invalid-target-ancestor",
      stateHome: join(parent, "target-symlink-state"),
      homeDir: fakeHome,
    });
    const stateSymlinkPlan = await planOrgInit({
      target: join(parent, "state-symlink-org"),
      name: "invalid-state-ancestor",
      stateHome: join(stateParent, "state"),
      homeDir: fakeHome,
    });

    expect(targetPlan.preview.blockers[0]).toMatchObject({ code: "target_not_directory", path: target });
    expect(statePlan.preview.blockers).toContainEqual(expect.objectContaining({
      code: "state_home_ancestor_invalid",
      path: ancestorFile,
    }));
    expect(pointerPlan.preview.blockers).toContainEqual(expect.objectContaining({
      code: "pointer_ancestor_invalid",
      path: pointerParent,
    }));
    expect(targetSymlinkPlan.preview.blockers).toContainEqual(expect.objectContaining({
      code: "target_ancestor_invalid",
      path: targetParent,
    }));
    expect(stateSymlinkPlan.preview.blockers).toContainEqual(expect.objectContaining({
      code: "state_home_ancestor_invalid",
      path: stateParent,
    }));
    expect(readFileSync(target, "utf8")).toBe("do not replace\n");
    expect(readFileSync(ancestorFile, "utf8")).toBe("not a directory\n");
  });

  it("blocks overlapping org, state, and pointer effects", async () => {
    const parent = temp("operon-overlap-");
    const fakeHome = temp("operon-overlap-home-");
    const target = join(parent, "org");
    const insideState = await planOrgInit({
      target,
      name: "inside-state",
      stateHome: join(target, "state"),
      homeDir: fakeHome,
    });
    const ancestorState = await planOrgInit({
      target,
      name: "ancestor-state",
      stateHome: parent,
      homeDir: fakeHome,
    });
    const pointerInsideOrg = await planOrgInit({
      target,
      name: "pointer-overlap",
      stateHome: join(parent, "state"),
      pointerPath: join(target, "active-pointer"),
      homeDir: fakeHome,
    });

    expect(insideState.preview.blockers).toContainEqual(expect.objectContaining({ code: "effect_path_collision" }));
    expect(ancestorState.preview.blockers).toContainEqual(expect.objectContaining({ code: "effect_path_collision" }));
    expect(pointerInsideOrg.preview.blockers).toContainEqual(expect.objectContaining({
      code: "effect_path_collision",
      path: join(target, "active-pointer"),
    }));
    expect(existsSync(target)).toBe(false);
  });

  it("rechecks the plan before execution and preserves bytes when a collision appears", async () => {
    const target = temp("operon-plan-race-");
    const fakeHome = temp("operon-plan-race-home-");
    const stateHome = join(fakeHome, "state");
    const pointerPath = join(fakeHome, "pointer.yaml");
    writeFileSync(join(target, "operator-note.md"), "pre-existing note\n");
    const plan = await planOrgInit({
      target,
      name: "race",
      stateHome,
      pointerPath,
      homeDir: fakeHome,
    });
    expect(plan.preview.executable).toBe(true);
    writeFileSync(join(target, "roles.yaml"), "late collision\n");

    await expect(executeOrgInit(plan)).rejects.toThrow(/generated destination already exists/);

    expect(readFileSync(join(target, "operator-note.md"), "utf8")).toBe("pre-existing note\n");
    expect(readFileSync(join(target, "roles.yaml"), "utf8")).toBe("late collision\n");
    expect(readdirSync(target).sort()).toEqual(["operator-note.md", "roles.yaml"]);
    expect(existsSync(stateHome)).toBe(false);
    expect(existsSync(pointerPath)).toBe(false);
    const stagePrefix = `.${basename(target)}.operon-init-`;
    expect(readdirSync(dirname(target)).some((entry) => entry.startsWith(stagePrefix))).toBe(false);
  });

  it("rejects mutated plan paths, bytes, and file sets before creating or staging anything", async () => {
    const scenarios: Array<{
      name: string;
      mutate: (plan: Awaited<ReturnType<typeof planOrgInit>>) => void;
    }> = [
      {
        name: "path",
        mutate: (plan) => {
          plan.preview.effects.generated_destinations.find((entry) => entry.kind === "file")!.path =
            "relative/tampered-path";
        },
      },
      {
        name: "bytes",
        mutate: (plan) => {
          const file = plan.planned_files.find((entry) => entry.contents.length > 0)!;
          file.contents[0] = file.contents[0]! ^ 0xff;
        },
      },
      {
        name: "missing",
        mutate: (plan) => {
          plan.planned_files.pop();
        },
      },
      {
        name: "extra",
        mutate: (plan) => {
          plan.planned_files.push({ relative_path: "extra.md", contents: Buffer.from("extra\n") });
        },
      },
    ];

    for (const scenario of scenarios) {
      const root = temp(`operon-plan-integrity-${scenario.name}-`);
      const targetParent = join(root, "not-created");
      const target = join(targetParent, "org");
      const stateHome = join(root, "state");
      const pointerPath = join(root, "pointer", "config");
      const plan = await planOrgInit({
        target,
        name: scenario.name,
        stateHome,
        pointerPath,
        homeDir: root,
      });
      expect(plan.preview.executable).toBe(true);
      scenario.mutate(plan);

      await expect(executeOrgInit(plan)).rejects.toThrow(/plan integrity check failed/);

      expect(existsSync(targetParent)).toBe(false);
      expect(existsSync(stateHome)).toBe(false);
      expect(existsSync(pointerPath)).toBe(false);
    }
  });

  it("renders a complete text dry-run with zero writes or staging", async () => {
    const parent = temp("operon-dry-run-text-");
    const fakeHome = temp("operon-dry-run-text-home-");
    const target = join(parent, "team");
    const stateHome = join(parent, "runtime-state");
    const pointerPath = join(fakeHome, ".operon", "config");
    const parentMtime = statSync(parent, { bigint: true }).mtimeNs;
    const homeMtime = statSync(fakeHome, { bigint: true }).mtimeNs;

    const result = await captureOrg(
      ["init", target, "--name", "team", "--state-home", stateHome, "--dry-run"],
      { homeDir: fakeHome, pointerPath },
    );

    expect(result.code).toBe(0);
    expect(result.output).toContain("Org init preview: ready");
    expect(result.output).toContain(`create state home: ${stateHome}`);
    expect(result.output).toContain(`create active pointer: ${pointerPath}`);
    expect(result.output).toContain(join(target, "prompts", "build", "contract.md"));
    expect(result.output).toContain(join(target, "memory", "roles", "planner", "INDEX.md"));
    expect(result.output).toContain("Default role chart:");
    expect(result.output).toContain("learning-reviewer");
    expect(result.output).toContain("No changes made");
    expect(existsSync(target)).toBe(false);
    expect(existsSync(stateHome)).toBe(false);
    expect(existsSync(pointerPath)).toBe(false);
    expect(readdirSync(parent).some((entry) => entry.startsWith(".team.operon-init-"))).toBe(false);
    expect(statSync(parent, { bigint: true }).mtimeNs).toBe(parentMtime);
    expect(statSync(fakeHome, { bigint: true }).mtimeNs).toBe(homeMtime);
  });

  it("emits stable JSON with explicit effects and the exact packaged role projection", async () => {
    const parent = temp("operon-dry-run-json-");
    const fakeHome = temp("operon-dry-run-json-home-");
    const target = join(parent, "team");
    const stateHome = join(parent, "state");
    const pointerPath = join(fakeHome, "pointer.yaml");
    mkdirSync(stateHome);
    writeFileSync(pointerPath, "org_home: /old/org\n");
    const pointerBefore = readFileSync(pointerPath);

    const first = await captureOrg(
      ["init", target, "--name", "team", "--state-home", stateHome, "--dry-run", "--json"],
      { homeDir: fakeHome, pointerPath },
    );
    const second = await captureOrg(
      ["init", target, "--name", "team", "--state-home", stateHome, "--dry-run", "--json"],
      { homeDir: fakeHome, pointerPath },
    );
    const textPreview = await captureOrg(
      ["init", target, "--name", "team", "--state-home", stateHome, "--dry-run"],
      { homeDir: fakeHome, pointerPath },
    );
    const parsed = JSON.parse(first.output) as Record<string, any>;
    const packaged = await loadRoles(join(PACKAGE_ROOT, "roles.yaml"));

    expect(first.code).toBe(0);
    expect(second.output).toBe(first.output);
    expect(textPreview.output).toContain(`reuse state home: ${stateHome}`);
    expect(textPreview.output).toContain(`replace active pointer: ${pointerPath}`);
    expect(parsed).toMatchObject({
      schema_version: 1,
      operation: "org_init",
      status: "ready",
      executable: true,
      org_home: target,
      state_home: stateHome,
      pointer_path: pointerPath,
      effects: {
        org_home: { action: "create", path: target },
        state_home: { action: "reuse", path: stateHome },
        active_pointer: { action: "replace", path: pointerPath },
      },
    });
    expect(parsed.roles).toEqual(packaged.roles.map((role) => ({
      name: role.name,
      runtime: role.runtime,
      model: role.model,
      effort: role.effort,
      triggers: role.triggers,
    })));
    expect(parsed.effects.generated_destinations).toContainEqual(expect.objectContaining({
      relative_path: join("prompts", "build", "contract.md"),
      kind: "file",
      disposition: "create",
    }));
    expect(readFileSync(pointerPath)).toEqual(pointerBefore);
    expect(readdirSync(stateHome)).toEqual([]);
    expect(existsSync(target)).toBe(false);
  });

  it("returns a blocked dry-run code without target, state, pointer, or temp writes", async () => {
    const target = temp("operon-blocked-dry-run-");
    const parent = dirname(target);
    const fakeHome = temp("operon-blocked-dry-run-home-");
    const stateHome = join(fakeHome, "state");
    const pointerPath = join(fakeHome, "pointer.yaml");
    writeFileSync(join(target, "roles.yaml"), "collision\n");
    const targetBefore = readdirSync(target);

    const result = await captureOrg(
      ["init", target, "--name", "blocked", "--state-home", stateHome, "--dry-run", "--json"],
      { homeDir: fakeHome, pointerPath },
    );
    const parsed = JSON.parse(result.output) as { status: string; executable: boolean; blockers: Array<{ code: string }> };

    expect(result.code).toBe(2);
    expect(parsed.status).toBe("blocked");
    expect(parsed.executable).toBe(false);
    expect(parsed.blockers).toContainEqual(expect.objectContaining({ code: "generated_path_collision" }));
    expect(readdirSync(target)).toEqual(targetBefore);
    expect(existsSync(stateHome)).toBe(false);
    expect(existsSync(pointerPath)).toBe(false);
    const stagePrefix = `.${basename(target)}.operon-init-`;
    expect(readdirSync(parent).some((entry) => entry.startsWith(stagePrefix))).toBe(false);
  });
});
