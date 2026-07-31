import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { inspectEpisodeRepository } from "../src/org/episode-planner/repository-facts.js";

describe("EpisodeIntent repository facts", () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it("captures bounded deterministic git, manifest, command, and change facts", () => {
    const root = mkdtempSync(join(tmpdir(), "operon-episode-facts-"));
    roots.push(root);
    git(root, "init", "-b", "integration");
    git(root, "config", "user.email", "fixture@example.com");
    git(root, "config", "user.name", "Fixture");
    writeFileSync(join(root, "package.json"), JSON.stringify({
      packageManager: "pnpm@11.10.0",
      scripts: { test: "not exposed", build: "not exposed either" },
    }));
    writeFileSync(join(root, "source.ts"), "export const before = true;\n");
    git(root, "add", ".");
    git(root, "commit", "-m", "fixture");
    const head = git(root, "rev-parse", "HEAD");
    writeFileSync(join(root, "source.ts"), "export const after = true;\n");
    writeFileSync(join(root, "untracked.md"), "bounded fixture\n");

    const first = inspectEpisodeRepository({
      workdir: root,
      baseRevision: { ref: head, defaultBranch: "integration" },
    });
    const second = inspectEpisodeRepository({
      workdir: root,
      baseRevision: { ref: head, defaultBranch: "integration" },
    });

    expect(second).toEqual(first);
    expect(first.repositoryFacts).toMatchObject({
      head,
      branch: "integration",
      baseRef: head,
      defaultBranch: "integration",
      trackedFileCount: 2,
      manifests: { "package.json": true },
      package: {
        status: "valid",
        packageManager: "pnpm@11.10.0",
        scriptNames: ["build", "test"],
      },
    });
    expect(first.changeFacts).toMatchObject({
      dirty: true,
      changedPathCount: 2,
      changedPathsTruncated: false,
      changedPaths: [
        { status: "M", path: "source.ts" },
        { status: "untracked", path: "untracked.md" },
      ],
    });
    expect(JSON.stringify(first)).not.toContain("not exposed");
  });

  it("fails closed when the declared base is not a commit", () => {
    const root = mkdtempSync(join(tmpdir(), "operon-episode-facts-"));
    roots.push(root);
    git(root, "init", "-b", "integration");
    expect(() => inspectEpisodeRepository({
      workdir: root,
      baseRevision: { ref: "missing-ref", defaultBranch: "integration" },
    })).toThrow();
  });
});

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}
