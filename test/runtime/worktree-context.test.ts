// Tests runtime worktree context helpers.
// Covers rendering taste/memory bundles, writing masked context files, recording
// git exclude entries once, and rejecting absolute or escaping paths.
// Uses temporary local git repos only; no network, auth, real org state, or
// wall-clock time is required.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { makeWorkingRepo } from "../fixtures/gitRepo.js";
import {
  renderContextBundle,
  writeMaskedWorktreeFile,
} from "../../src/runtime/worktree-context.js";
import { buildTurnExecutionFacts } from "../../src/runtime/assignment.js";

describe("worktree context helper", () => {
  it("renders taste layers followed by memory excerpts", () => {
    expect(
      renderContextBundle({
        taste: ["ORG", "ROLE", "APP"],
        memoryExcerpts: ["MEMORY-1", "MEMORY-2"],
      }),
    ).toBe("ORG\n\n---\n\nROLE\n\n---\n\nAPP\n\n---\n\n## Memory excerpts\n\nMEMORY-1\n\nMEMORY-2");
  });

  it("renders validated assignment and capability facts without granting authority", () => {
    const rendered = renderContextBundle({
      taste: ["ORG"],
      memoryExcerpts: [],
      execution: buildTurnExecutionFacts(
        { harness: "codex", model: "gpt-5.6-sol", effort: "xhigh" },
        { name: "builder", delegation: { allow: ["explore"] } },
        ["structured_verdict", "session_resume"],
      ),
    });

    expect(rendered).toContain("## Turn execution facts");
    expect(rendered).toContain("Harness: codex");
    expect(rendered).toContain("Exact model: gpt-5.6-sol");
    expect(rendered).toContain("Effort: xhigh");
    expect(rendered).toContain("- structured verdict: adapter-built; required for this turn");
    expect(rendered).toContain("- intra-turn fan-out: native");
    expect(rendered).toContain("Role-approved subagent types: explore");
    expect(rendered).toContain("does not change the role's tools, permissions, or approval boundaries");
  });

  it("rejects malformed or duplicate resolved capability facts", () => {
    const execution = buildTurnExecutionFacts(
      { harness: "claude", model: "claude-exact", effort: "high" },
      { name: "reviewer", delegation: { allow: [] } },
    );
    expect(() =>
      renderContextBundle({
        taste: [],
        memoryExcerpts: [],
        execution: {
          ...execution,
          resolvedCapabilities: [...execution.resolvedCapabilities, "tool_gate"],
        },
      }),
    ).toThrow(/duplicates "tool_gate"/);
  });

  it("writes a masked context file and records it once in git exclude", async () => {
    const repo = await makeWorkingRepo();

    const first = writeMaskedWorktreeFile(repo.root, ".pi/APPEND_SYSTEM.md", "context v1\n");
    const second = writeMaskedWorktreeFile(repo.root, ".pi/APPEND_SYSTEM.md", "context v2\n");

    expect(readFileSync(first.path, "utf8")).toBe("context v2\n");
    expect(second.excludePath).toBe(first.excludePath);
    const excluded = readFileSync(first.excludePath, "utf8")
      .split(/\r?\n/)
      .filter((line) => line === ".pi/APPEND_SYSTEM.md");
    expect(excluded).toHaveLength(1);
  });

  it("rejects absolute or escaping paths", async () => {
    const repo = await makeWorkingRepo();

    expect(() => writeMaskedWorktreeFile(repo.root, "/tmp/nope", "x")).toThrow(/must be relative/);
    expect(() => writeMaskedWorktreeFile(repo.root, "../nope", "x")).toThrow(/escapes/);
  });
});
