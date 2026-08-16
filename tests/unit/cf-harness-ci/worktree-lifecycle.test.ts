// CF-HARNESS-CI — HB-P7 — repository worktree tooling stays deterministic and fail-closed.

import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  defaultWorktreePath,
  cleanCandidates,
  executeClean,
  parseRemoteHeads,
  parseWorktreePorcelain,
  sanitizeBranchForPath,
  type CleanCandidate,
} from "../../../scripts/worktree.js";
import { makeTempGitRepo, makeTempWorktree, type TempGitRepo, type TempWorktree } from "../../fixtures/git-repo.js";

describe("worktree lifecycle helpers", () => {
  it("parses attached and detached porcelain worktrees without guessing a branch", () => {
    expect(
      parseWorktreePorcelain(
        [
          "worktree /repo",
          "HEAD abc123",
          "branch refs/heads/trunk",
          "",
          "worktree /tmp/detached",
          "HEAD def456",
          "",
        ].join("\n"),
      ),
    ).toEqual([
      { path: "/repo", head: "abc123", branch: "trunk", detached: false },
      { path: "/tmp/detached", head: "def456", branch: null, detached: true },
    ]);
  });

  it("parses remote heads by ref name and preserves full object IDs", () => {
    expect(parseRemoteHeads("abc\trefs/heads/trunk\ndef\trefs/heads/feature/x\n")).toEqual([
      { name: "trunk", oid: "abc" },
      { name: "feature/x", oid: "def" },
    ]);
  });

  it("creates stable external paths for slash-bearing branch names", () => {
    expect(sanitizeBranchForPath("codex/issue-42")).toBe("codex-issue-42");
    expect(defaultWorktreePath("/build/Cormidia", "codex/issue-42", "/build/Cormidia-worktrees")).toBe(
      "/build/Cormidia-worktrees/codex-issue-42",
    );
  });

  it("includes merged remote-only branches when remote cleanup is requested", () => {
    const candidates = cleanCandidates(
      {
        schema_version: "worktree-reconcile/v1",
        repository: "/repo",
        remote: "origin",
        default_branch: "trunk",
        default_ref: "origin/trunk",
        current_branch: "trunk",
        worktrees: [],
        local_branches: [],
        remote_branches: [
          {
            name: "codex/old",
            oid: "abc",
            worktree: null,
            dirty: null,
            remote: true,
            merged: true,
            upstream: null,
            tracking: null,
          },
        ],
      },
      "merged",
      [],
      false,
    );
    expect(candidates).toEqual([
      {
        branch: "codex/old",
        path: null,
        dirty: null,
        remote: true,
        local: false,
        reason: "merged",
      },
    ]);
  });

  it("sweeps local and remote-only branches matching a substring, leaving others alone", () => {
    const candidates = cleanCandidates(
      {
        schema_version: "worktree-reconcile/v1",
        repository: "/repo",
        remote: "origin",
        default_branch: "trunk",
        default_ref: "origin/trunk",
        current_branch: "trunk",
        worktrees: [],
        local_branches: [
          {
            name: "claude/feature-a",
            oid: "aaa",
            worktree: "/repo-worktrees/claude-feature-a",
            dirty: false,
            remote: true,
            merged: false,
            upstream: "origin/claude/feature-a",
            tracking: null,
          },
          {
            name: "codex/unrelated",
            oid: "bbb",
            worktree: null,
            dirty: null,
            remote: false,
            merged: false,
            upstream: null,
            tracking: null,
          },
        ],
        remote_branches: [
          {
            name: "claude/feature-b",
            oid: "ccc",
            worktree: null,
            dirty: null,
            remote: true,
            merged: false,
            upstream: null,
            tracking: null,
          },
        ],
      },
      "match",
      [],
      false,
      "claude/",
    );
    expect(candidates).toEqual([
      {
        branch: "claude/feature-a",
        path: "/repo-worktrees/claude-feature-a",
        dirty: false,
        remote: true,
        local: true,
        reason: "match",
      },
      {
        branch: "claude/feature-b",
        path: null,
        dirty: null,
        remote: true,
        local: false,
        reason: "match",
      },
    ]);
  });

  it("protects the default and current branch even when the name matches", () => {
    const candidates = cleanCandidates(
      {
        schema_version: "worktree-reconcile/v1",
        repository: "/repo",
        remote: "origin",
        default_branch: "claude/trunk",
        default_ref: "origin/claude/trunk",
        current_branch: "claude/trunk",
        worktrees: [],
        local_branches: [
          {
            name: "claude/trunk",
            oid: "aaa",
            worktree: "/repo",
            dirty: false,
            remote: true,
            merged: false,
            upstream: null,
            tracking: null,
          },
        ],
        remote_branches: [],
      },
      "match",
      [],
      false,
      "claude/",
    );
    expect(candidates).toEqual([]);
  });

  it("requires a non-empty pattern for match mode", () => {
    const report = {
      schema_version: "worktree-reconcile/v1",
      repository: "/repo",
      remote: "origin",
      default_branch: "trunk",
      default_ref: "origin/trunk",
      current_branch: "trunk",
      worktrees: [],
      local_branches: [],
      remote_branches: [],
    } as const;
    expect(() => cleanCandidates(report, "match", [], false, "")).toThrow(/non-empty substring/);
    expect(() => cleanCandidates(report, "match", [], false, undefined)).toThrow(/non-empty substring/);
  });
});

describe("worktree clean batch resilience", () => {
  // Defect: `pnpm worktree -- clean --match claude/ --apply` hit an unmerged
  // branch partway through a multi-branch sweep, threw out of the loop, and
  // exited before touching any of the remaining matches — with no summary of
  // what was and wasn't deleted. executeClean must keep going and report the
  // failure instead of aborting the batch.
  let repo: TempGitRepo | undefined;
  let worktreesToClean: TempWorktree[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    for (const worktree of worktreesToClean.splice(0)) await worktree.cleanup();
    await repo?.cleanup();
    repo = undefined;
  });

  it("still deletes the remaining candidates after one branch fails to delete", async () => {
    repo = await makeTempGitRepo({ defaultBranch: "main" });
    const mergeable = await makeTempWorktree(repo, { branch: "claude/mergeable" });
    const blocked = await makeTempWorktree(repo, { branch: "claude/blocked" });
    worktreesToClean.push(mergeable, blocked);
    writeFileSync(join(blocked.dir, "unmerged.txt"), "not on main\n", "utf8");
    execFileSync("git", ["add", "unmerged.txt"], { cwd: blocked.dir });
    execFileSync("git", ["commit", "--no-gpg-sign", "-m", "fixture: unmerged commit"], { cwd: blocked.dir });

    const candidates: CleanCandidate[] = [
      { branch: mergeable.branch, path: mergeable.dir, dirty: false, remote: false, local: true, reason: "match" },
      { branch: blocked.branch, path: blocked.dir, dirty: false, remote: false, local: true, reason: "match" },
    ];

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const hadFailure = executeClean(repo.dir, candidates, {
      apply: true,
      force: false,
      json: false,
      remote: "origin",
      remoteDelete: false,
      refresh: false,
      keep: [],
      path: undefined,
      base: undefined,
      setupCommand: undefined,
      match: "claude/",
    });

    expect(hadFailure).toBe(true);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("FAILED claude/blocked"));
    expect(existsSync(mergeable.dir)).toBe(false);
    expect(existsSync(blocked.dir)).toBe(false);
    expect(repo.git(["branch", "--list", "claude/mergeable"])).toBe("");
    expect(repo.git(["branch", "--list", "claude/blocked"])).not.toBe("");
  });
});
