import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { makeWorkingRepo } from "../fixtures/gitRepo.js";
import {
  renderContextBundle,
  writeMaskedWorktreeFile,
} from "../../src/runtime/worktree-context.js";

describe("worktree context helper", () => {
  it("renders taste layers followed by memory excerpts", () => {
    expect(
      renderContextBundle({
        taste: ["ORG", "ROLE", "APP"],
        memoryExcerpts: ["MEMORY-1", "MEMORY-2"],
      }),
    ).toBe("ORG\n\n---\n\nROLE\n\n---\n\nAPP\n\n---\n\n## Memory excerpts\n\nMEMORY-1\n\nMEMORY-2");
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
