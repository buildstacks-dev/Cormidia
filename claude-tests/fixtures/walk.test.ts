// HB-002 fixtures/walk self-test — the empty-walk detector itself lands
// red-then-green (harness rule: a sweep may never pass on an empty walk).

import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assertNonEmptyWalk, EmptyWalkError, walkFiles } from "./walk.js";

const tempDirs: string[] = [];
afterEach(async () => {
  for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function tempTree(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "hb002-walk-"));
  tempDirs.push(root);
  return root;
}

describe("HB-002 fixtures/walk (non-empty-walk assertion)", () => {
  it("walks a populated tree recursively and returns sorted relative paths", async () => {
    const root = await tempTree();
    await mkdir(join(root, "b", "nested"), { recursive: true });
    await writeFile(join(root, "a.txt"), "a", "utf8");
    await writeFile(join(root, "b", "nested", "c.json"), "{}", "utf8");
    await writeFile(join(root, "b", "d.txt"), "d", "utf8");

    const files = await assertNonEmptyWalk(root);
    expect(files).toEqual(["a.txt", "b/d.txt", "b/nested/c.json"]);
  });

  it("filters by pattern and still returns a non-empty result", async () => {
    const root = await tempTree();
    await mkdir(join(root, "specs"), { recursive: true });
    await writeFile(join(root, "specs", "one.test.ts"), "", "utf8");
    await writeFile(join(root, "readme.md"), "", "utf8");

    const matched = await assertNonEmptyWalk(root, /\.test\.ts$/);
    expect(matched).toEqual(["specs/one.test.ts"]);
  });

  it("does not treat directories or dangling symlink targets as walked files", async () => {
    const root = await tempTree();
    await mkdir(join(root, "only-dirs", "deeper"), { recursive: true });
    await symlink(join(root, "absent"), join(root, "only-dirs", "dangling"));
    // walkFiles is the non-throwing projection: directories and the dangling
    // symlink are not regular files, so the walk is honestly empty here.
    expect(await walkFiles(root)).toEqual([]);
  });

  it("negative control: an empty directory walk FIRES EmptyWalkError", async () => {
    const root = await tempTree();
    await mkdir(join(root, "empty", "still-empty"), { recursive: true });
    const failure = await assertNonEmptyWalk(root).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(EmptyWalkError);
    expect((failure as EmptyWalkError).reason).toBe("no-files");
  });

  it("negative control: a missing directory FIRES — absence is never a pass", async () => {
    const root = await tempTree();
    const missing = join(root, "never-created");
    await expect(assertNonEmptyWalk(missing)).rejects.toMatchObject({
      name: "EmptyWalkError",
      reason: "missing-directory",
    });
    // The non-throwing walker refuses too: a missing dir is not "zero files".
    await expect(walkFiles(missing)).rejects.toBeInstanceOf(EmptyWalkError);
  });

  it("negative control: a pattern matching nothing FIRES even when files exist", async () => {
    const root = await tempTree();
    await writeFile(join(root, "present.md"), "", "utf8");
    await expect(assertNonEmptyWalk(root, /\.test\.ts$/)).rejects.toMatchObject({
      name: "EmptyWalkError",
      reason: "pattern-matched-nothing",
    });
  });
});
