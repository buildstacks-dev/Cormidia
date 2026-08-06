// CF-INV-009 structural guard — source code may not reintroduce a hardcoded
// default branch after the legacy scanner was retired (HB-030; broadened by
// #203).
//
// AGENTS.md carries the rule ("Never hardcode a default branch… nor may a
// resolved base be cached across claims"), and this is the guard that enforces
// its source-literal half. #203 was the third breach of the rule's spirit
// (#60 fixed `plan`, #101 fixed the turn path, #203 the loop), which is why the
// sweep now covers all of `src/`, every reserved branch name, and git-argument
// positions rather than `origin/main` alone.
//
// Traceability: INV-009 (base resolved, never guessed) · control point T-7 ·
// boundary B-15 · case-catalog.md §3 (CF-INV-009) and §10 (CF-REG-203-G).
//
// LAYER: 1. A source-literal rule is falsifiable by reading the source.
//
// The negative control runs the REAL detector over seeded source. `src/` is
// clean, so without it this whole family would be an assumption that has never
// fired.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assertNonEmptyWalk } from "../../fixtures/walk.js";
import { defaultBranchViolations, RESERVED_DEFAULT_BRANCHES } from "./default-branch-detector.js";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const SRC = fileURLToPath(new URL("../../../src/", import.meta.url));

describe("CF-INV-009 — resolved-default-branch structural pin", () => {
  it("sweeps all of src/**/*.ts and finds no hardcoded default-branch literal", async () => {
    const files = await assertNonEmptyWalk(SRC, /\.ts$/);
    // The sweep must reach the modules that own base resolution; a walk that
    // quietly stopped covering them would be green by absence.
    for (const owner of [
      "loop/default-branch.ts",
      "loop/driver.ts",
      "loop/loop.ts",
      "org/turn-runner.ts",
      "org/plan.ts",
    ]) {
      expect(files).toContain(owner);
    }

    const found = files.flatMap((file) =>
      defaultBranchViolations(`src/${file}`, readFileSync(join(SRC, file), "utf8")),
    );
    expect(found).toEqual([]);
  });

  it("negative control: the detector FIRES on each seeded hardcoded-base shape", () => {
    // The remote-tracking ref, in every quoting style and every position.
    for (const seed of [
      'const ref = "origin/main";',
      "const ref = 'origin/master';",
      "const ref = `origin/trunk`;",
      "diff(`origin/main...HEAD`);",
    ]) {
      expect(defaultBranchViolations("seed.ts", seed).length).toBeGreaterThan(0);
    }

    // A branch name assigned to a consequential property.
    expect(defaultBranchViolations("seed.ts", 'const base = { ref: "origin/main", defaultBranch: "main" };')).toEqual([
      "seed.ts:1: defaultBranch=main",
      "seed.ts:1: origin/main", // the `ref:` value, caught as a remote-tracking ref
    ]);
    expect(defaultBranchViolations("seed.ts", 'openPr({ baseRefName: "master" });')).toEqual([
      "seed.ts:1: baseRefName=master",
    ]);

    // A branch name handed straight to git, in both invocation shapes.
    expect(defaultBranchViolations("seed.ts", 'git(repoDir, "fetch", "origin", "main");')).toEqual([
      "seed.ts:1: git argument main",
    ]);
    expect(defaultBranchViolations("seed.ts", 'execFileSync("git", ["checkout", "trunk"], opts);')).toEqual([
      "seed.ts:1: git argument trunk",
    ]);

    // Every reserved name is covered, not just `main`.
    for (const branch of RESERVED_DEFAULT_BRANCHES) {
      expect(defaultBranchViolations("seed.ts", `git(dir, "checkout", "${branch}");`)).toEqual([
        `seed.ts:1: git argument ${branch}`,
      ]);
    }
  });

  it("negative control: prose and unrelated strings are NOT flagged", () => {
    // Every one of these exists in src/ today, deliberately, as the record of
    // #60/#101/#203. A guard that forced them out would trade a real defect
    // for a documentation loss.
    const prose = [
      "// hardcoded `origin/main` this threw in a `master` repo",
      "/** Always resolved from git, never assumed to be `main`. */",
      "const x = 1;",
    ].join("\n");
    expect(defaultBranchViolations("seed.ts", prose)).toEqual([]);

    // A rendered HTML landmark is not a git ref.
    expect(defaultBranchViolations("seed.ts", 'const page = `<main id="main">${body}</main>`;')).toEqual([]);
    // Nor is an unrelated call that merely takes the word.
    expect(defaultBranchViolations("seed.ts", 'setEntryPoint("main");')).toEqual([]);
  });

  it("reports the real line number so a failure points at the offending code", () => {
    const source = ["const a = 1;", "", 'const ref = "origin/main";'].join("\n");
    expect(defaultBranchViolations("seed.ts", source)).toEqual(["seed.ts:3: origin/main"]);
  });
});
