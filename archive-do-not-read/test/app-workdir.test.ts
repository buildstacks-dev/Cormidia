// Tests app checkout resolution in src/org/app-workdir.ts.
// Covers explicit workdirs, managed runtime clones, sibling checkout discovery,
// repo-basename fallbacks, and actionable errors when nothing exists.
// Uses only temporary directories with fake .git markers; no network, auth,
// real org state, or wall-clock time is involved.

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  appWorkdirCandidates,
  resolveAppWorkdir,
} from "../src/org/app-workdir.js";
import type { AppEntry } from "../src/org/apps.js";

const tempDirs: string[] = [];

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function checkout(path: string): void {
  mkdirSync(join(path, ".git"), { recursive: true });
}

function app(name: string, repo = `owner/${name}`): AppEntry {
  return {
    name,
    repo,
    status: "onboarding",
    budgetUsdMonth: 1000,
    cadence: {},
  };
}

describe("resolveAppWorkdir", () => {
  it("uses an explicit workdir without requiring it to match candidates", () => {
    const explicit = join(tempDir("operon-workdir-explicit-"), "custom");

    expect(resolveAppWorkdir(app("alpha"), { explicitWorkdir: explicit })).toBe(explicit);
  });

  it("prefers a managed dispatch clone when present", () => {
    const runtimeHome = tempDir("operon-workdir-runtime-");
    const managed = join(runtimeHome, "repos", "alpha");
    checkout(managed);
    const siblingRoot = tempDir("operon-workdir-parent-");
    const orgRoot = join(siblingRoot, "Operon");
    checkout(join(siblingRoot, "alpha"));

    expect(resolveAppWorkdir(app("alpha"), { orgRoot, runtimeHome })).toBe(managed);
  });

  it("finds a sibling checkout by app name or repo basename", () => {
    const parent = tempDir("operon-workdir-sibling-");
    const orgRoot = join(parent, "Operon");
    checkout(join(parent, "alpha"));
    checkout(join(parent, "repo-name"));

    expect(resolveAppWorkdir(app("alpha"), { orgRoot, runtimeHome: tempDir("none-") })).toBe(
      join(parent, "alpha"),
    );
    expect(
      resolveAppWorkdir(app("display-name", "owner/repo-name.git"), {
        orgRoot,
        runtimeHome: tempDir("none-"),
      }),
    ).toBe(join(parent, "repo-name"));
  });

  it("throws with actionable candidates when no checkout exists", () => {
    const orgRoot = join(tempDir("operon-workdir-missing-"), "Operon");
    const candidates = appWorkdirCandidates(app("alpha"), {
      orgRoot,
      runtimeHome: "/tmp/operon-runtime",
    });

    expect(() =>
      resolveAppWorkdir(app("alpha"), { orgRoot, runtimeHome: "/tmp/operon-runtime" }),
    ).toThrow(`pass --workdir <path> or create one of: ${candidates.join(", ")}`);
  });
});
