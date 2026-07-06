// Proves the M4.1 git fixture: real-git tests with zero network. Named
// cases per the build plan's Accept: clean init; commit visible in log;
// changedFiles correct between two commits; bare/clone pair supports push +
// merge into origin main observable via `git log`; cleanup removes both.
// Later suites (qgates M4.3–M4.5, FakeGhOps sandbox M5.2) consume
// `makeWorkingRepo`/`makeBareWithClone` without re-proving any of this.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeBareWithClone, makeWorkingRepo } from "./gitRepo.js";

describe("makeWorkingRepo", () => {
  it("clean init: main branch, empty status, configured scripts committed", () => {
    const repo = makeWorkingRepo({ testCommand: "node test.mjs", lintCommand: "node lint.mjs" });

    expect(repo.git("rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
    expect(repo.git("status", "--porcelain")).toBe(""); // nothing uncommitted
    expect(repo.log()).toEqual(["chore: init fixture app"]);

    const pkg = JSON.parse(readFileSync(join(repo.root, "package.json"), "utf8"));
    expect(pkg.scripts).toEqual({ test: "node test.mjs", lint: "node lint.mjs" });

    repo.cleanup();
  });

  it("clean init with no options still commits a package.json (empty scripts)", () => {
    const repo = makeWorkingRepo();
    const pkg = JSON.parse(readFileSync(join(repo.root, "package.json"), "utf8"));
    expect(pkg.scripts).toEqual({});
    expect(repo.git("status", "--porcelain")).toBe("");
    repo.cleanup();
  });

  it("commit is visible in log and returns the new HEAD sha", () => {
    const repo = makeWorkingRepo();
    const sha = repo.commit("feat: add a", { "src/a.ts": "export const a = 1;\n" });

    expect(sha).toMatch(/^[0-9a-f]{40}$/);
    expect(repo.head()).toBe(sha);
    expect(repo.log()).toEqual(["feat: add a", "chore: init fixture app"]);

    repo.cleanup();
  });

  it("changedFiles is correct between two commits", () => {
    const repo = makeWorkingRepo();
    const first = repo.commit("feat: a", { "src/a.ts": "v1\n" });
    const second = repo.commit("feat: b, edit a", { "src/a.ts": "v2\n", "src/b.ts": "b\n" });

    expect(repo.changedFiles(first, second)).toEqual(["src/a.ts", "src/b.ts"]);
    expect(repo.changedFiles(first)).toEqual(["src/a.ts", "src/b.ts"]); // `to` defaults to HEAD
    expect(repo.changedFiles(second, second)).toEqual([]);

    repo.cleanup();
  });

  it("writeFiles creates nested directories without committing", () => {
    const repo = makeWorkingRepo();
    repo.writeFiles({ "deep/nested/file.txt": "content\n" });

    expect(readFileSync(join(repo.root, "deep/nested/file.txt"), "utf8")).toBe("content\n");
    expect(repo.git("status", "--porcelain")).toContain("deep/"); // staged by commit(), not here

    repo.cleanup();
  });

  it("commit with nothing to commit throws loudly", () => {
    const repo = makeWorkingRepo();
    expect(() => repo.commit("chore: empty")).toThrow(/git commit/);
    repo.cleanup();
  });

  it("cleanup removes the repo and is safe to call twice", () => {
    const repo = makeWorkingRepo();
    expect(existsSync(repo.root)).toBe(true);
    repo.cleanup();
    expect(existsSync(repo.root)).toBe(false);
    repo.cleanup(); // idempotent
  });
});

describe("makeBareWithClone", () => {
  it("clone starts on main with the seed commit already pushed to origin", () => {
    const pair = makeBareWithClone();

    expect(pair.clone.git("rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
    // The seed commit is observable in the BARE repo — the push happened.
    expect(pair.bare.log("main")).toEqual(["chore: init origin main"]);
    expect(pair.clone.git("rev-parse", "origin/main")).toBe(pair.clone.head());

    pair.cleanup();
  });

  it("supports push + squash-merge into origin main, observable via git log in the bare repo", () => {
    const pair = makeBareWithClone();
    const { clone, bare } = pair;

    // Feature branch with a real commit, pushed to origin (M5's claim shape).
    clone.git("checkout", "-b", "op/1-demo");
    clone.commit("feat: demo change", { "src/demo.ts": "export const demo = true;\n" });
    clone.git("push", "-u", "origin", "op/1-demo");
    expect(bare.log("op/1-demo")).toEqual(["feat: demo change", "chore: init origin main"]);

    // Squash-merge into main and push — the discipline the loop ships with.
    clone.git("checkout", "main");
    clone.git("merge", "--squash", "op/1-demo");
    const mergeSha = clone.commit("feat: demo change (#1)");
    clone.git("push", "origin", "main");

    expect(bare.log("main")).toEqual(["feat: demo change (#1)", "chore: init origin main"]);
    expect(bare.git("rev-parse", "main")).toBe(mergeSha);
    // Squash means main's history has exactly one new commit, no merge parent.
    expect(bare.git("rev-list", "--count", "main")).toBe("2");

    pair.cleanup();
  });

  it("branch delete on origin is observable in the bare repo", () => {
    const pair = makeBareWithClone();
    const { clone, bare } = pair;

    clone.git("checkout", "-b", "op/2-doomed");
    clone.commit("feat: doomed", { "doomed.txt": "x\n" });
    clone.git("push", "-u", "origin", "op/2-doomed");
    expect(bare.git("branch", "--list", "op/2-doomed")).toContain("op/2-doomed");

    clone.git("push", "origin", "--delete", "op/2-doomed");
    expect(bare.git("branch", "--list", "op/2-doomed")).toBe("");

    pair.cleanup();
  });

  it("cleanup removes both repos and is safe to call twice", () => {
    const pair = makeBareWithClone();
    expect(existsSync(pair.bare.root)).toBe(true);
    expect(existsSync(pair.clone.root)).toBe(true);

    pair.cleanup();
    expect(existsSync(pair.bare.root)).toBe(false);
    expect(existsSync(pair.clone.root)).toBe(false);
    expect(existsSync(pair.root)).toBe(false);
    pair.cleanup(); // idempotent
  });
});
