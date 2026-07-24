import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  gitWorktreeWritableRoots,
  preflightGitWorktreeIndex,
} from "../../src/runtime/git-worktree-sandbox.js";
import { makeBareWithClone, type BareCloneFixture } from "../fixtures/gitRepo.js";

describe("linked-worktree runtime sandbox roots", () => {
  let pair: BareCloneFixture;

  afterEach(() => pair?.cleanup());

  it("includes the actual Git directories and supports a real edit, add, and commit", () => {
    pair = makeBareWithClone();
    const worktree = join(pair.root, "ticket-worktree");
    pair.clone.git("worktree", "add", "-b", "op/linked-index-guard", worktree, "main");

    const gitDir = git(worktree, "rev-parse", "--absolute-git-dir");
    const objectsDir = git(worktree, "rev-parse", "--git-path", "objects");
    const branchRef = git(worktree, "symbolic-ref", "HEAD");
    const branchRefDir = dirname(git(worktree, "rev-parse", "--git-path", branchRef));
    const branchReflogDir = dirname(
      git(worktree, "rev-parse", "--git-path", `logs/${branchRef}`),
    );
    const roots = gitWorktreeWritableRoots(worktree);
    expect(roots).toEqual([
      worktree,
      gitDir,
      objectsDir,
      branchRefDir,
      branchReflogDir,
    ]);
    expect(gitDir).not.toBe(join(worktree, ".git"));
    expect(gitDir).toContain(`${join(".git", "worktrees")}/`);
    expect(preflightGitWorktreeIndex(worktree)).toMatchObject({
      status: "pass",
      gitDir,
      indexPath: join(gitDir, "index"),
    });

    writeFileSync(join(worktree, "linked-worktree.txt"), "sandbox-visible change\n", "utf8");
    git(worktree, "add", "--", "linked-worktree.txt");
    git(worktree, "commit", "-m", "test: commit from linked worktree");

    expect(git(worktree, "show", "--format=", "--name-only", "HEAD"))
      .toBe("linked-worktree.txt");
    expect(git(worktree, "status", "--short")).toBe("");
  });

  it("keeps a non-Git workdir confined to itself", () => {
    pair = makeBareWithClone();
    expect(gitWorktreeWritableRoots(pair.root)).toEqual([pair.root]);
  });

  it("fails specifically and preserves the worktree when the index cannot be locked", () => {
    pair = makeBareWithClone();
    const worktree = join(pair.root, "ticket-worktree");
    pair.clone.git("worktree", "add", "-b", "op/index-preflight-failure", worktree, "main");
    const indexPath = git(worktree, "rev-parse", "--git-path", "index");
    const lockPath = `${indexPath}.lock`;
    writeFileSync(lockPath, "existing lock\n", "utf8");

    expect(preflightGitWorktreeIndex(worktree)).toMatchObject({
      status: "fail",
      errorCode: "error_git_index_unwritable",
      indexPath,
      detail: expect.stringContaining(`worktree is preserved at ${worktree}`),
    });
    expect(existsSync(worktree)).toBe(true);
    expect(existsSync(lockPath)).toBe(true);
  });
});

function git(workdir: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd: workdir,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Operon Fixture",
      GIT_AUTHOR_EMAIL: "fixture@operon.invalid",
      GIT_COMMITTER_NAME: "Operon Fixture",
      GIT_COMMITTER_EMAIL: "fixture@operon.invalid",
      GIT_TERMINAL_PROMPT: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}
