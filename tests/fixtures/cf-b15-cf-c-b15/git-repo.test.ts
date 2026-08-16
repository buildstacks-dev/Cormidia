// CF-B15 — HB-025; CF-C-B15 — HB-P2; fixtures/git-repo self-test — real repos/clones/remotes/worktrees
// that REAL product git code accepts: gitSnapshotOf (src/runtime/git.ts)
// reports them truthfully, and resolveRemoteDefaultBranch (src/loop/
// default-branch.ts, the #101 never-guess-main rule) reads the configured
// default branch off a fixture file:// remote.

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveRemoteDefaultBranch } from "../../../src/loop/default-branch.js";
import { gitSnapshotOf } from "../../../src/runtime/git.js";
import { makeTempClone, makeTempGitRepo, makeTempWorktree, type TempGitRepo } from "../git-repo.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function repoFixture(defaultBranch: string): Promise<TempGitRepo> {
  const repo = await makeTempGitRepo({ defaultBranch });
  cleanups.push(repo.cleanup);
  return repo;
}

describe("HB-002 fixtures/git-repo (real git substrate the product accepts)", () => {
  it("creates a repo on a configurable default branch that gitSnapshotOf reports truthfully", async () => {
    // Deliberately NOT main: proves nothing downstream assumed the name.
    const repo = await repoFixture("trunk");
    expect(repo.git(["symbolic-ref", "--short", "HEAD"])).toBe("trunk");
    const snapshot = gitSnapshotOf(repo.dir);
    expect(snapshot).toEqual({ head: repo.head(), branch: "trunk" });
  });

  it("seeds commits and returns each new HEAD", async () => {
    const repo = await repoFixture("main");
    const first = repo.head();
    const second = await repo.commitFile("src/app.ts", "export {};\n");
    expect(second).not.toBe(first);
    expect(repo.head()).toBe(second);
    expect(repo.git(["show", "--stat", "--oneline", "HEAD"])).toContain("src/app.ts");
  });

  it("advertises the configured default branch over a file:// remote to the REAL product resolver (#101)", async () => {
    const repo = await repoFixture("trunk");
    const remote = await repo.addFileRemote();
    expect(remote.url.startsWith("file://")).toBe(true);
    // Product seam: resolveRemoteDefaultBranch asks the remote, never guesses.
    expect(resolveRemoteDefaultBranch(remote.url)).toBe("trunk");
    // And by remote NAME from inside the repo (the managed-clone shape).
    expect(resolveRemoteDefaultBranch("origin", { cwd: repo.dir })).toBe("trunk");
  });

  it("clones keep the branch, the origin remote, and can push back", async () => {
    const repo = await repoFixture("trunk");
    const remote = await repo.addFileRemote();
    const clone = await makeTempClone(remote.url);
    cleanups.push(clone.cleanup);
    expect(clone.defaultBranch).toBe("trunk");
    expect(gitSnapshotOf(clone.dir)?.branch).toBe("trunk");
    expect(clone.git(["remote", "get-url", "origin"])).toBe(remote.url);
    await clone.commitFile("from-clone.txt", "hello\n");
    clone.git(["push", "origin", "trunk"]);
    // The push landed on the bare remote.
    repo.git(["fetch", "origin"]);
    expect(repo.git(["rev-parse", "origin/trunk"])).toBe(clone.head());
  });

  it("adds real linked worktrees that gitSnapshotOf attributes to their own branch", async () => {
    const repo = await repoFixture("main");
    const worktree = await makeTempWorktree(repo, { branch: "ticket-1" });
    cleanups.push(worktree.cleanup);
    expect(worktree.dir).not.toBe(repo.dir);
    const snapshot = gitSnapshotOf(worktree.dir);
    expect(snapshot).toEqual({ head: repo.head(), branch: "ticket-1" });
    // The main checkout still reports its own branch.
    expect(gitSnapshotOf(repo.dir)?.branch).toBe("main");
  });

  it("negative control: a plain directory nested in a checkout FIRES the non-checkout refusal", async () => {
    const repo = await repoFixture("main");
    const nested = join(repo.dir, "nested", "not-a-repo");
    await mkdir(nested, { recursive: true });
    // The product must refuse to attribute the enclosing repo's HEAD to a
    // nested non-checkout directory (src/runtime/git.ts truthfulness rule).
    expect(gitSnapshotOf(nested)).toBeUndefined();
  });

  it("negative control: corrupt refs (removed .git/HEAD) read as unknown, never a guess", async () => {
    const repo = await repoFixture("main");
    await repo.corrupt.removeHead();
    expect(gitSnapshotOf(repo.dir)).toBeUndefined();
  });

  it("negative control: a held index.lock makes a real mutating git command FIRE (B-15)", async () => {
    const repo = await repoFixture("main");
    const lockPath = await repo.corrupt.holdIndexLock();
    expect(lockPath.endsWith("index.lock")).toBe(true);
    await expect(repo.commitFile("blocked.txt", "nope\n")).rejects.toThrow();
  });
});
