// CF-J01-R — every named init/use collision & refusal class refuses
// PRE-MUTATION (L2, E1 — T-8 slice; C-OP-LIFE §1/§2 + error split,
// journey-acceptance J-01, INV-010/013; case-catalog row CF-J01-R).
//
// Oracle: a full-tree snapshot of the world taken before the attempt equals
// the tree after the refusal — a refusal that mutated anything is a failure,
// not a refusal. Snapshots walk via fixtures/walk.ts (non-empty guaranteed by
// the world sentinel).
//
// PRODUCT DEFECT TRIPWIRE (nested org): C-OP-LIFE §1 ratifies "any collision
// (existing org, generated-path collision, nested org, non-directory,
// symlink) blocks before mutation". planOrgInit/preflightInitEffects
// (src/org/home.ts) checks the target itself for a complete-org shape but
// never walks ancestors, so a target INSIDE an existing org home plans
// "ready" and would initialize a nested org. The it.fails tripwire below
// stays green while the defect exists and turns red the moment ancestor
// detection lands — then promote it to a regular refusal case.

import { symlink, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cmdOrg } from "../../../src/cli/org.js";
import {
  executeOrgInit,
  initOrgHome,
  planOrgInit,
  type InitOrgHomeOptions,
  type InitOrgHomePlan,
} from "../../../src/org/home.js";
import {
  diffIsEmpty,
  diffPaths,
  diffSnapshots,
  makeInitWorld,
  snapshotTree,
  type InitWorld,
} from "./support.js";

describe("CF-J01-R — collision/refusal classes refuse pre-mutation (C-OP-LIFE §1/§2)", () => {
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

  function initOptions(w: InitWorld, overrides: Partial<InitOrgHomeOptions> = {}): InitOrgHomeOptions {
    return {
      target: w.target,
      name: "refused-org",
      stateHome: w.stateHome,
      homeDir: w.homeDir,
      pointerPath: w.pointerPath,
      ...overrides,
    };
  }

  /** Plan must be blocked with the named code, execute must refuse, and the
   *  world tree must be byte-identical afterwards. */
  async function expectBlockedRefusal(
    w: InitWorld,
    options: InitOrgHomeOptions,
    code: string,
  ): Promise<InitOrgHomePlan> {
    const before = await snapshotTree(w.root);
    const plan = await planOrgInit(options);
    expect(plan.preview.status).toBe("blocked");
    expect(plan.preview.executable).toBe(false);
    expect(
      plan.preview.blockers.map((blocker) => blocker.code),
      `expected blocker ${code}; got ${JSON.stringify(plan.preview.blockers)}`,
    ).toContain(code);
    for (const blocker of plan.preview.blockers) {
      expect(blocker.remediation.length).toBeGreaterThan(0);
    }
    await expect(executeOrgInit(plan)).rejects.toThrow();
    const diff = diffSnapshots(before, await snapshotTree(w.root));
    expect(diffIsEmpty(diff), `refusal mutated: ${diffPaths(diff).join(", ")}`).toBe(true);
    return plan;
  }

  it("existing org at the target: blocked as existing_org, nothing mutated", async () => {
    const w = await world();
    await initOrgHome(initOptions(w, { name: "occupant" }));
    const before = await snapshotTree(w.root);
    const plan = await planOrgInit(initOptions(w, { stateHome: join(w.root, "state-b") }));
    expect(plan.preview.status).toBe("blocked");
    expect(plan.preview.blockers.map((blocker) => blocker.code)).toContain("existing_org");
    await expect(executeOrgInit(plan)).rejects.toThrow(/already exists/);
    expect(diffIsEmpty(diffSnapshots(before, await snapshotTree(w.root)))).toBe(true);
  });

  it.fails(
    "TRIPWIRE (product defect vs C-OP-LIFE §1): a target nested inside an existing org home must plan blocked",
    async () => {
      const w = await world();
      await initOrgHome(initOptions(w, { name: "outer" }));
      const plan = await planOrgInit(
        initOptions(w, {
          target: join(w.target, "nested-org"),
          name: "nested",
          stateHome: join(w.root, "state-nested"),
        }),
      );
      // Ratified: the nested-org collision blocks before mutation. Actual
      // (2026-07-31): status is "ready" with no blocker — the collision scan
      // never looks upward from the target.
      expect(plan.preview.status).toBe("blocked");
    },
  );

  it("symlink target: blocked as target_not_directory", async () => {
    const w = await world();
    await mkdir(join(w.root, "real-dir"));
    await symlink(join(w.root, "real-dir"), w.target);
    await expectBlockedRefusal(w, initOptions(w), "target_not_directory");
  });

  it("non-directory target: blocked as target_not_directory", async () => {
    const w = await world();
    await writeFile(w.target, "a file where the org home should go\n", "utf8");
    await expectBlockedRefusal(w, initOptions(w), "target_not_directory");
  });

  it("generated-path collision in an existing directory: blocked, never overwritten", async () => {
    const w = await world();
    await mkdir(w.target);
    await writeFile(join(w.target, "TASTE.md"), "pre-existing human bytes\n", "utf8");
    await expectBlockedRefusal(w, initOptions(w), "generated_path_collision");
    // The colliding bytes survive verbatim.
    expect(await readFile(join(w.target, "TASTE.md"), "utf8")).toBe("pre-existing human bytes\n");
  });

  it("generated-path symlink: blocked as generated_path_symlink, never followed", async () => {
    const w = await world();
    await mkdir(w.target);
    await writeFile(join(w.root, "elsewhere.md"), "bytes behind the symlink\n", "utf8");
    await symlink(join(w.root, "elsewhere.md"), join(w.target, "TASTE.md"));
    await expectBlockedRefusal(w, initOptions(w), "generated_path_symlink");
    expect(await readFile(join(w.root, "elsewhere.md"), "utf8")).toBe("bytes behind the symlink\n");
  });

  it("state home is a file: blocked as state_home_not_directory", async () => {
    const w = await world();
    await writeFile(w.stateHome, "not a directory\n", "utf8");
    await expectBlockedRefusal(w, initOptions(w), "state_home_not_directory");
  });

  it("org and state homes overlapping: blocked as effect_path_collision", async () => {
    const w = await world();
    await expectBlockedRefusal(
      w,
      initOptions(w, { stateHome: join(w.target, "state-inside-org") }),
      "effect_path_collision",
    );
  });

  it("active pointer inside the org home: blocked as effect_path_collision", async () => {
    const w = await world();
    await expectBlockedRefusal(
      w,
      initOptions(w, { pointerPath: join(w.target, "pointer-config") }),
      "effect_path_collision",
    );
  });

  it("world changed between plan and execute: the recheck refuses with no org files installed", async () => {
    const w = await world();
    const plan = await planOrgInit(initOptions(w));
    expect(plan.preview.executable).toBe(true);
    // The world moves under the reviewed plan: the target appears.
    await mkdir(w.target);
    const before = await snapshotTree(w.root);
    await expect(executeOrgInit(plan)).rejects.toThrow(/target changed during initialization/);
    const diff = diffSnapshots(before, await snapshotTree(w.root));
    expect(diffIsEmpty(diff), `recheck refusal mutated: ${diffPaths(diff).join(", ")}`).toBe(true);
  });

  it("incomplete org for `org use`: refuses and leaves the active pointer byte-identical (§2)", async () => {
    const w = await world();
    await initOrgHome(initOptions(w, { name: "good-org" }));
    const secondOrg = join(w.root, "broken-org");
    await initOrgHome(
      initOptions(w, { target: secondOrg, name: "broken-org", stateHome: join(w.root, "state-broken") }),
    );
    // Break the second org, then point back at the first so `use broken` is a
    // real re-selection attempt against an incomplete org.
    await rm(join(secondOrg, "roles.yaml"));
    await cmdOrg(["use", w.target, "--state-home", w.stateHome], {
      homeDir: w.homeDir,
      pointerPath: w.pointerPath,
    });
    const pointerBefore = await readFile(w.pointerPath, "utf8");
    const before = await snapshotTree(w.root);
    await expect(
      cmdOrg(["use", secondOrg, "--state-home", join(w.root, "state-broken")], {
        homeDir: w.homeDir,
        pointerPath: w.pointerPath,
      }),
    ).rejects.toThrow(/not a complete org home — missing roles\.yaml/);
    expect(await readFile(w.pointerPath, "utf8")).toBe(pointerBefore);
    const diff = diffSnapshots(before, await snapshotTree(w.root));
    expect(diffIsEmpty(diff), `refused use mutated: ${diffPaths(diff).join(", ")}`).toBe(true);
  });

  it("wrong --confirm on the destructive org form: refuses before any planning or mutation (error split)", async () => {
    const w = await world();
    await initOrgHome(initOptions(w, { name: "keeper" }));
    const before = await snapshotTree(w.root);
    await expect(
      cmdOrg(["archive", "keeper", "--execute", "--confirm", "not-keeper"], {
        homeDir: w.homeDir,
        pointerPath: w.pointerPath,
      }),
    ).rejects.toThrow(/--execute requires --confirm keeper/);
    const diff = diffSnapshots(before, await snapshotTree(w.root));
    expect(diffIsEmpty(diff), `wrong-confirm mutated: ${diffPaths(diff).join(", ")}`).toBe(true);
  });

  it("negative control: a tampered reviewed plan — the plan-integrity detector FIRES with no changes made", async () => {
    const w = await world();
    const plan = await planOrgInit(initOptions(w));
    expect(plan.preview.executable).toBe(true);
    // SEEDED VIOLATION: planned bytes are swapped after review, so the bytes
    // no longer match the previewed content hash.
    const tampered = plan.planned_files.find((file) => file.relative_path === "TASTE.md");
    expect(tampered).toBeDefined();
    tampered!.contents = Buffer.from("tampered bytes that were never previewed\n", "utf8");
    const before = await snapshotTree(w.root);
    await expect(executeOrgInit(plan)).rejects.toThrow(
      /plan integrity check failed: planned file bytes do not match the preview hash.*no changes were made/,
    );
    const diff = diffSnapshots(before, await snapshotTree(w.root));
    expect(diffIsEmpty(diff), `integrity refusal mutated: ${diffPaths(diff).join(", ")}`).toBe(true);
  });
});
