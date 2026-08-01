// CF-REG-203-G — the restored default-branch literal guard.
//
// AGENTS.md: "Never hardcode a default branch. Resolve with
// `resolveRemoteDefaultBranch()` … and thread the resulting `BaseRevision`
// through", plus the standing note that "the literal scanner that enforced this
// is archived with the legacy suite; the rule stands on its own until the
// replacement harness re-guards it." This is that re-guard, deposited with the
// #203 fix per its acceptance criteria.
//
// Traceability: INV-009 (base resolved, never guessed) · control point T-7 ·
// boundary B-15. Registered in validation-design/case-catalog.md §10.
//
// LAYER: 1. A source-literal rule is falsifiable by reading the source; no
// composition, process, or git substrate is needed.
//
// The negative control is load-bearing here: the sweep over real `src/` is
// expected to be CLEAN, so without a seeded violation this whole family would
// be an assumption that has never fired.

import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { assertNonEmptyWalk } from "../../fixtures/walk.js";
import { findDefaultBranchLiterals, stripComments } from "./default-branch-literal-detector.js";

const SRC = fileURLToPath(new URL("../../../src/", import.meta.url));

describe("CF-REG-203-G — no source file hardcodes a default branch (#203/#101/#60, INV-009/T-7)", () => {
  it("negative control: the detector FIRES on each seeded hardcoded-base shape", () => {
    // Shape 1 — the whole-value literal a git call would receive.
    expect(findDefaultBranchLiterals(`git(repoDir, "fetch", "origin", "main");`)).toEqual([
      { line: 1, literal: '"main"' },
    ]);
    expect(findDefaultBranchLiterals(`const base = { ref: 'master' };`)).toEqual([
      { line: 1, literal: "'master'" },
    ]);

    // A backtick template that is ONLY the branch name is the same defect
    // written the long way, and must not be a blind spot.
    expect(findDefaultBranchLiterals("git(dir, `checkout`, `main`);")).toEqual([
      { line: 1, literal: "`main`" },
    ]);

    // Shape 2 — the remote-tracking ref #101 removed, in every quoting style.
    for (const seed of [
      `const ref = "origin/main";`,
      `const ref = 'origin/main';`,
      "const ref = `origin/master`;",
      "git(dir, `diff`, `origin/main...HEAD`);",
    ]) {
      expect(findDefaultBranchLiterals(seed).length).toBeGreaterThan(0);
    }

    // And it fires on a multi-line file at the right line.
    const seeded = ['const a = 1;', 'const branch = "main";', 'const b = 2;'].join("\n");
    expect(findDefaultBranchLiterals(seeded)).toEqual([{ line: 2, literal: '"main"' }]);
  });

  it("negative control: prose about the scar is NOT flagged — the rule guards code, not memory", () => {
    // Every one of these spellings exists in src/ today, deliberately, as the
    // institutional record of #60/#101. A guard that forced them out would
    // trade a real defect for a documentation loss.
    const prose = [
      '// hardcoded `origin/main` this threw in a `master` repo',
      '/** Always resolved from git, never assumed to be `main`. */',
      '/* inventing `main` is exactly how a `master` repo crashed */',
    ].join("\n");
    expect(findDefaultBranchLiterals(prose)).toEqual([]);

    // Rendered HTML landmarks are not git refs.
    expect(findDefaultBranchLiterals('const page = `<main id="main">${body}</main>`;')).toEqual([]);
  });

  it("stripComments preserves line numbering so a report points at the real line", () => {
    const source = ["/* a\n   b */", 'const x = "main";'].join("\n");
    expect(stripComments(source).split("\n")).toHaveLength(source.split("\n").length);
    expect(findDefaultBranchLiterals(source)).toEqual([{ line: 3, literal: '"main"' }]);
  });

  it("sweep: every src/**/*.ts file is free of hardcoded default-branch literals", async () => {
    const files = await assertNonEmptyWalk(SRC, /\.ts$/);
    // The sweep must actually reach the modules that own base resolution —
    // a walk that quietly stopped covering them would be green by absence.
    expect(files).toContain("loop/default-branch.ts");
    expect(files).toContain("loop/driver.ts");
    expect(files).toContain("loop/loop.ts");
    expect(files).toContain("org/turn-runner.ts");

    const offenders: string[] = [];
    for (const file of files) {
      const source = await readFile(join(SRC, file), "utf8");
      for (const hit of findDefaultBranchLiterals(source)) {
        offenders.push(`src/${file}:${hit.line} ${hit.literal}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
