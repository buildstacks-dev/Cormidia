import { describe, expect, it } from "vitest";
import {
  defaultWorktreePath,
  cleanCandidates,
  parseRemoteHeads,
  parseWorktreePorcelain,
  sanitizeBranchForPath,
} from "../../scripts/worktree.js";

describe("worktree lifecycle helpers", () => {
  it("parses attached and detached porcelain worktrees without guessing a branch", () => {
    expect(parseWorktreePorcelain([
      "worktree /repo",
      "HEAD abc123",
      "branch refs/heads/trunk",
      "",
      "worktree /tmp/detached",
      "HEAD def456",
      "",
    ].join("\n"))).toEqual([
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
    const candidates = cleanCandidates({
      schema_version: "worktree-reconcile/v1",
      repository: "/repo",
      remote: "origin",
      default_branch: "trunk",
      default_ref: "origin/trunk",
      current_branch: "trunk",
      worktrees: [],
      local_branches: [],
      remote_branches: [{
        name: "codex/old",
        oid: "abc",
        worktree: null,
        dirty: null,
        remote: true,
        merged: true,
        upstream: null,
        tracking: null,
      }],
    }, "merged", [], false);
    expect(candidates).toEqual([{
      branch: "codex/old",
      path: null,
      dirty: null,
      remote: true,
      local: false,
      reason: "merged",
    }]);
  });
});
