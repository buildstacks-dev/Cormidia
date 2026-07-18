// The default-branch resolver, and the repo-wide guard that stops a hardcoded
// `main` creeping back into an execution path (#101).
//
// The campaign failure this pins: a fresh private repo whose default branch
// was `master` reached its first ticket tick and died with
// `fatal: ambiguous argument 'origin/main': unknown revision`. Correct
// resolution already existed — it was the *propagation* that was missing, so
// these tests cover both the resolver and the absence of competing guesses.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { devNull, tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  baseRevisionForBranch,
  parseSymrefHead,
  remoteTrackingRef,
  resolveRemoteDefaultBranch,
} from "../../src/loop/default-branch.js";
import { makeBareWithClone } from "../fixtures/gitRepo.js";

const SRC_ROOT = fileURLToPath(new URL("../../src", import.meta.url));

const GIT_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: devNull,
  GIT_CONFIG_SYSTEM: devNull,
  GIT_TERMINAL_PROMPT: "0",
};

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "operon-default-branch-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

describe("resolveRemoteDefaultBranch", () => {
  // The whole point: the answer comes from the remote, not from a constant.
  // `trunk` is in here deliberately — a resolver that special-cases
  // main/master would pass the first two cases and still be wrong.
  for (const branch of ["main", "master", "trunk", "release-2026"]) {
    it(`resolves ${branch} from the remote, by URL and by remote name`, () => {
      const fixture = makeBareWithClone(branch);
      cleanups.push(fixture.cleanup);

      expect(resolveRemoteDefaultBranch(fixture.bare.root)).toBe(branch);
      expect(resolveRemoteDefaultBranch("origin", { cwd: fixture.clone.root })).toBe(branch);
    });
  }

  it("fails loudly, and never guesses, when the remote cannot be asked", () => {
    const dir = tempDir();
    execFileSync("git", ["init", "--quiet", "--initial-branch=main", dir], { env: GIT_ENV });

    // No `origin` configured at all — the classic "guess main" temptation.
    expect(() => resolveRemoteDefaultBranch("origin", { cwd: dir })).toThrowError(
      /cannot resolve the default branch/i,
    );
    // And it must not have silently produced a value.
    let resolved: string | undefined;
    try {
      resolved = resolveRemoteDefaultBranch("origin", { cwd: dir });
    } catch {
      resolved = undefined;
    }
    expect(resolved).toBeUndefined();
  });

  it("fails loudly on an empty repository that advertises no default branch", () => {
    const dir = tempDir();
    const bare = join(dir, "empty.git");
    execFileSync("git", ["init", "--bare", "--quiet", bare], { env: GIT_ENV });

    // A bare repo with zero commits advertises no symref HEAD. Inventing
    // `main` here is precisely how the first tick crashed.
    expect(() => resolveRemoteDefaultBranch(bare)).toThrowError(/advertises no default branch/i);
  });

  it("carries the caller's layer in the error so the failure names its origin", () => {
    const dir = tempDir();
    execFileSync("git", ["init", "--quiet", dir], { env: GIT_ENV });
    expect(() => resolveRemoteDefaultBranch("origin", { cwd: dir, errorPrefix: "plan" })).toThrowError(
      /^plan:/,
    );
  });
});

describe("parseSymrefHead", () => {
  it("reads the branch out of real ls-remote output", () => {
    const output =
      "ref: refs/heads/master\tHEAD\n" + "0123456789abcdef0123456789abcdef01234567\tHEAD\n";
    expect(parseSymrefHead(output)).toBe("master");
  });

  it("handles a branch name containing slashes", () => {
    expect(parseSymrefHead("ref: refs/heads/release/2026-07\tHEAD\n")).toBe("release/2026-07");
  });

  // A silent parse miss degrades into exactly the guessed-`main` behavior this
  // module exists to prevent, so "no match" must be distinguishable.
  it("returns undefined rather than a fallback when HEAD is not a symref", () => {
    expect(parseSymrefHead("0123456789abcdef0123456789abcdef01234567\tHEAD\n")).toBeUndefined();
    expect(parseSymrefHead("")).toBeUndefined();
  });
});

describe("BaseRevision construction", () => {
  it("pairs the remote-tracking ref with the bare branch name", () => {
    expect(baseRevisionForBranch("master")).toEqual({
      ref: "origin/master",
      defaultBranch: "master",
    });
    expect(remoteTrackingRef("trunk")).toBe("origin/trunk");
  });

  // The two fields answer different questions ("what do I diff against" vs
  // "what do I merge into"). Collapsing them is what let `origin/main` leak
  // into paths that only ever wanted a branch name.
  it("keeps the diff ref and the merge target distinguishable", () => {
    const base = baseRevisionForBranch("master");
    expect(base.ref).not.toBe(base.defaultBranch);
  });
});

describe("no execution path hardcodes a default branch (#101 regression guard)", () => {
  // Presentation-only leaves that never invoke git. `<main id="main">` is an
  // HTML landmark, not a git ref (AGENTS.md: src/observe and src/report are
  // presentation-only over durable state).
  const EXEMPT_PREFIXES = ["observe/", "report/"];

  // A quoted string that is exactly a default-branch name, or `origin/` one.
  // Deliberately broad: `trunk` and `master` are as wrong to hardcode as
  // `main`, and a guard that only catches `main` teaches the wrong lesson.
  //
  // Only " and ' count as quotes. Backticks are excluded because prose in this
  // codebase writes branch names as `main` for emphasis, and the correct
  // template-literal form is `origin/${branch}` — which has no bare name to
  // match anyway.
  const HARDCODED = /(["'])(origin\/)?(main|master|trunk)\1/;

  /** Drop comment text before scanning: these fixes are *documented* by
   *  comments that name the very branches the guard forbids, and a guard that
   *  fires on its own rationale would just get disabled. Line-oriented and
   *  deliberately conservative — it strips whole comment lines and trailing
   *  `//` comments, and leaves anything ambiguous in place to be scanned. */
  function stripComments(line: string): string {
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return "";
    // Trailing `//` comment, but not the `//` inside a URL or a string.
    const marker = line.indexOf("//");
    if (marker > 0 && !/[:"'`]$/.test(line.slice(marker - 1, marker))) {
      const before = line.slice(0, marker);
      const quotes = (before.match(/["']/g) ?? []).length;
      if (quotes % 2 === 0) return before;
    }
    return line;
  }

  async function typescriptSources(dir: string): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) files.push(...(await typescriptSources(full)));
      else if (entry.name.endsWith(".ts")) files.push(full);
    }
    return files;
  }

  it("finds no hardcoded default-branch literal anywhere under src/", async () => {
    const files = await typescriptSources(SRC_ROOT);
    // Guard the guard: if the walk silently found nothing, an empty result
    // would look like a pass.
    expect(files.length).toBeGreaterThan(50);

    const offenders: string[] = [];
    for (const file of files) {
      const rel = relative(SRC_ROOT, file).split("\\").join("/");
      if (EXEMPT_PREFIXES.some((prefix) => rel.startsWith(prefix))) continue;
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, index) => {
        if (HARDCODED.test(stripComments(line))) {
          offenders.push(`${rel}:${index + 1}: ${line.trim()}`);
        }
      });
    }

    expect(
      offenders,
      "Hardcoded default-branch names in an execution path (#101). Resolve the " +
        "branch with resolveRemoteDefaultBranch() and thread the BaseRevision " +
        "through instead:\n" +
        offenders.join("\n"),
    ).toEqual([]);
  });

  // Adversarial near-miss: the guard must actually be capable of failing.
  // A regression check that cannot detect its own target is decoration.
  it("detects the exact patterns it exists to catch", () => {
    const flags = (line: string) => HARDCODED.test(stripComments(line));

    // Every one of these is a real line this workstream removed.
    expect(flags('git(repoDir, "reset", "--hard", "origin/main");')).toBe(true);
    expect(flags('const baseRef = options.baseRef ?? "origin/main";')).toBe(true);
    expect(flags('git(localRepo, "worktree", "add", "-b", branch, path, "main");')).toBe(true);
    expect(flags("await git(sourceRepo, ['worktree', 'add', path, 'master']);")).toBe(true);
    expect(flags('base: "main",')).toBe(true);
    expect(flags('.filter((branch) => branch !== "main")')).toBe(true);
    expect(flags('stringField(record, "baseRefName", "gh pr output", "main"),')).toBe(true);

    // ...and must not fire on a resolved value or an unrelated word.
    expect(flags("git(repoDir, \"reset\", \"--hard\", `origin/${branch}`);")).toBe(false);
    expect(flags("return baseRevisionForBranch(branch);")).toBe(false);
    expect(flags('const domain = "maintenance";')).toBe(false);
    expect(flags('console.log("the main loop");')).toBe(false);

    // Comment stripping must not become a loophole: a hardcode is still a
    // hardcode when a comment happens to sit on the same line.
    expect(flags('git(dir, "checkout", "main"); // resolved elsewhere')).toBe(true);
  });
});
