// Tests clean restart recovery in src/org/recovery.ts.
// Covers removing uncommitted edits and untracked files from a real temporary
// git repo via restartClean.
// makeWorkingRepo supplies all git state locally; no network, auth, real org
// state, or wall-clock time is required.

import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { restartClean } from "../src/org/recovery.js";
import { makeWorkingRepo } from "./fixtures/gitRepo.js";

describe("crash recovery", () => {
  it("restartClean removes uncommitted and untracked work in a real repo", () => {
    const repo = makeWorkingRepo();
    try {
      writeFileSync(join(repo.root, "README.md"), "dirty\n", "utf8");
      writeFileSync(join(repo.root, "stray.txt"), "remove me\n", "utf8");
      restartClean(repo.root);
      expect(repo.git("status", "--short")).toBe("");
      expect(existsSync(join(repo.root, "stray.txt"))).toBe(false);
    } finally {
      repo.cleanup();
    }
  });
});
