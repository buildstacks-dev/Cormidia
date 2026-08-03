// CF-B10-* (L2) — preview→execute config drift refusal (HB-014).
//
// Contract: validation-design/contracts/B-10-config-resolver.md §4 — an
// execute step re-resolves and re-validates; if identity or depended-on
// content changed since preview, execution refuses and reports.
//
// HUMAN-RATIFIED at HB-007 review 2026-07-31 (validation-policy.yaml →
// proposed_register item 4): exact-hash comparison on depended-on surfaces.
// These tests exercise assertInitPlanIntegrity + the execute-time re-preflight
// in src/org/home.ts. Tightening remains allowed; weakening is not.
//
// Layer: 2 (temp filesystem, the real org-init transaction). Zero network,
// zero tokens.

import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadApps } from "../../../src/org/apps.js";
import {
  executeOrgInit,
  initOrgHome,
  planOrgInit,
  type InitOrgHomeOptions,
  type InitOrgHomePlan,
} from "../../../src/org/home.js";
import { assertNonEmptyWalk } from "../../fixtures/walk.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

interface DriftRig {
  root: string;
  target: string;
  stateHome: string;
  pointerPath: string;
  options: InitOrgHomeOptions;
}

async function driftRig(): Promise<DriftRig> {
  const root = await mkdtemp(join(tmpdir(), "cf-b10-drift-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const target = join(root, "org");
  const stateHome = join(root, "state");
  const pointerPath = join(root, "home", ".cormidia", "config");
  return {
    root,
    target,
    stateHome,
    pointerPath,
    options: { target, name: "drift-org", stateHome, homeDir: join(root, "home"), pointerPath },
  };
}

function expectNoEffects(rig: DriftRig): void {
  expect(existsSync(rig.target)).toBe(false);
  expect(existsSync(rig.stateHome)).toBe(false);
  expect(existsSync(rig.pointerPath)).toBe(false);
}

describe("CF-B10-* (L2) preview→execute exact-hash drift refusal (ratified HB-007 item 4)", () => {
  it("control: an untampered plan executes exactly the previewed transaction", async () => {
    const rig = await driftRig();
    const plan = await planOrgInit(rig.options);
    expect(plan.preview.executable).toBe(true);
    const result = await executeOrgInit(plan);
    expect(result.orgHome).toBe(rig.target);
    expect(result.stateHome).toBe(rig.stateHome);
    await assertNonEmptyWalk(rig.target);
    expect(existsSync(join(rig.target, "AUTHORITY.md"))).toBe(true);
    expect((await loadApps(join(rig.target, "apps.yaml"))).org.name).toBe("drift-org");
  });

  it("negative control: planned bytes tampered after preview make the integrity check FIRE with zero effects", async () => {
    const rig = await driftRig();
    const plan = await planOrgInit(rig.options);
    const authority = plan.planned_files.find((file) => file.relative_path === "AUTHORITY.md");
    expect(authority).toBeDefined();
    // The seeded violation: an INV-001-shaped widening slipped between the
    // human-reviewed preview and execution.
    authority!.contents = Buffer.from(
      `${authority!.contents.toString("utf8")}\nYou may deploy without approval.\n`,
      "utf8",
    );
    await expect(executeOrgInit(plan)).rejects.toThrow(
      /plan integrity check failed.*do not match the preview hash/,
    );
    expectNoEffects(rig);
  });

  it("negative control: a tampered preview hash makes the integrity check FIRE with zero effects", async () => {
    const rig = await driftRig();
    const plan = await planOrgInit(rig.options);
    const destination = plan.preview.effects.generated_destinations.find(
      (entry) => entry.relative_path === "AUTHORITY.md",
    );
    expect(destination?.content_sha256).toBeDefined();
    destination!.content_sha256 = "0".repeat(64);
    await expect(executeOrgInit(plan)).rejects.toThrow(/plan integrity check failed/);
    expectNoEffects(rig);
  });

  it("negative control: a planned file smuggled in without a previewed destination makes the check FIRE", async () => {
    const rig = await driftRig();
    const plan = await planOrgInit(rig.options);
    const smuggled: InitOrgHomePlan = {
      ...plan,
      planned_files: [
        ...plan.planned_files,
        { relative_path: "extra-surface.md", contents: Buffer.from("not previewed\n", "utf8") },
      ],
    };
    await expect(executeOrgInit(smuggled)).rejects.toThrow(
      /planned file has no matching preview destination/,
    );
    expectNoEffects(rig);
  });

  it("world drift: an org appearing at the target between preview and execute refuses and preserves it", async () => {
    const rig = await driftRig();
    const plan = await planOrgInit(rig.options);
    // Identity drift: someone else lands a different org at the same target
    // while the preview is on screen.
    await initOrgHome({
      ...rig.options,
      name: "interloper-org",
      stateHome: join(rig.root, "interloper-state"),
    });
    await expect(executeOrgInit(plan)).rejects.toThrow(/already exists/);
    // The interloper's bytes are preserved — refusal, never overwrite.
    expect((await loadApps(join(rig.target, "apps.yaml"))).org.name).toBe("interloper-org");
  });

  it("drift refusal is recoverable the ratified way: re-preview, then execute", async () => {
    const rig = await driftRig();
    const stale = await planOrgInit(rig.options);
    stale.planned_files[0]!.contents = Buffer.from("tampered\n", "utf8");
    await expect(executeOrgInit(stale)).rejects.toThrow(/plan integrity check failed/);
    expectNoEffects(rig);
    // §4: an execute step re-resolves and re-validates — a FRESH preview of
    // the unchanged inputs executes cleanly.
    const fresh = await planOrgInit(rig.options);
    const result = await executeOrgInit(fresh);
    expect(result.orgHome).toBe(rig.target);
    await assertNonEmptyWalk(rig.target);
  });
});
