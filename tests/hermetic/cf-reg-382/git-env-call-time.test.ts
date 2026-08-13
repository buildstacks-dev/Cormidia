// CF-REG-382 — HB-139 — boundary-map B-15 (git substrate).
//
// The defect: `publicationGit` snapshotted `process.env` at MODULE LOAD. Any
// environment change made afterwards was silently ignored — and because ESM
// hoists imports above module bodies, a caller setting a variable at the top of
// its own file was already too late.
//
// It cost two CI runs. #382's hermetic suites pin `GIT_AUTHOR_*` so they do not
// depend on the host having a git identity; the pin did nothing, the suites
// passed on a developer machine (whose GLOBAL git config supplied one) and
// failed on the runner (which has none). The symptom of a snapshot is never an
// error — it is a setting that quietly does nothing.
//
// L2 — hermetic, real git. Risk REG. Control point T-1.

import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { devNull, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { publicationGit } from "../../../src/org/git-publication-substrate.js";

let workspace: string | undefined;

afterEach(async () => {
  if (workspace !== undefined) await rm(workspace, { recursive: true, force: true });
  workspace = undefined;
});

describe("CF-REG-382 — publicationGit reads the environment at CALL time", () => {
  it("sees a variable set after this module was imported", async () => {
    workspace = await mkdtemp(join(tmpdir(), "cormidia-git-env-"));
    execFileSync("git", ["init", "--quiet", "-b", "main", workspace], { stdio: "ignore" });

    const saved = { ...process.env };
    try {
      // Exactly the shape the suites use: no identity from config anywhere,
      // and `user.useConfigOnly` so git cannot auto-detect `user@hostname`
      // (which succeeds on macOS and fails on CI — the asymmetry that hid this).
      for (const key of ["GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL"]) {
        delete process.env[key];
      }
      process.env["GIT_CONFIG_GLOBAL"] = devNull;
      process.env["GIT_CONFIG_SYSTEM"] = devNull;
      process.env["GIT_CONFIG_COUNT"] = "1";
      process.env["GIT_CONFIG_KEY_0"] = "user.useConfigOnly";
      process.env["GIT_CONFIG_VALUE_0"] = "true";

      // Red half: with no identity reachable, git must refuse. If this passes,
      // the environment is not reaching the child and the green half below
      // would prove nothing.
      const tree = publicationGit(workspace, ["hash-object", "-t", "tree", "/dev/null"], "cf-reg-382");
      expect(() => publicationGit(workspace ?? "", ["commit-tree", tree, "-m", "x"], "cf-reg-382")).toThrow(
        /author identity|tell me who you are/i,
      );

      // Green half: setting the identity NOW — long after import — must reach
      // the very next call. Under the old snapshot this stayed red.
      process.env["GIT_AUTHOR_NAME"] = "Cormidia Fixture";
      process.env["GIT_AUTHOR_EMAIL"] = "fixture@cormidia.invalid";
      process.env["GIT_COMMITTER_NAME"] = "Cormidia Fixture";
      process.env["GIT_COMMITTER_EMAIL"] = "fixture@cormidia.invalid";
      const commit = publicationGit(workspace, ["commit-tree", tree, "-m", "x"], "cf-reg-382");
      expect(commit).toMatch(/^[0-9a-f]{40}$/);
    } finally {
      for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
      Object.assign(process.env, saved);
    }
  });

  it("still pins the invariants that must never come from the host", async () => {
    workspace = await mkdtemp(join(tmpdir(), "cormidia-git-env-"));
    execFileSync("git", ["init", "--quiet", "-b", "main", workspace], { stdio: "ignore" });
    const saved = process.env["GIT_TERMINAL_PROMPT"];
    try {
      // A caller cannot re-enable credential prompting by setting it: the
      // hardened values are applied AFTER the ambient environment, so they win.
      process.env["GIT_TERMINAL_PROMPT"] = "1";
      const out = publicationGit(workspace, ["var", "-l"], "cf-reg-382");
      expect(out).toBeTypeOf("string");
    } finally {
      if (saved === undefined) delete process.env["GIT_TERMINAL_PROMPT"];
      else process.env["GIT_TERMINAL_PROMPT"] = saved;
    }
  });
});
