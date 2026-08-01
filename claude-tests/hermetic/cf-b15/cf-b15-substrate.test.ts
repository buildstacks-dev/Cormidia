// CF-B15-* / HB-025 + HB-P2 — local persistence and git substrate faults.

import { afterEach, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pushBranch } from "../../../src/loop/loop.js";
import { managedRemoteIdentityProblem } from "../../../src/org/app-lifecycle.js";
import { writeJournalPatch, readJournal } from "../../../src/org/journal.js";
import { acquireLock } from "../../../src/org/locks.js";
import { recoverStaleTurn } from "../../../src/org/recovery.js";
import { preflightGitWorktreeIndex } from "../../../src/runtime/git-worktree-sandbox.js";
import { makeTempGitRepo, type TempGitRepo } from "../../fixtures/git-repo.js";
import { makeTempStateHome, type TempStateHome } from "../../fixtures/state-home.js";

class AmbiguousBytesLostViolation extends Error {
  constructor(path: string) {
    super(`ambiguous worktree bytes changed or vanished: ${path}`);
    this.name = "AmbiguousBytesLostViolation";
  }
}

async function assertBytesPreserved(path: string, expected: string): Promise<void> {
  const actual = existsSync(path) ? await readFile(path, "utf8") : undefined;
  if (actual !== expected) throw new AmbiguousBytesLostViolation(path);
}

class PushPostStateViolation extends Error {}
function assertRemoteMatchesLocal(repo: TempGitRepo, branch: string): void {
  const local = repo.git(["rev-parse", "HEAD"]);
  const remote = repo.git(["ls-remote", "--heads", "origin", `refs/heads/${branch}`]).split(/\s+/)[0];
  if (local !== remote) throw new PushPostStateViolation(`local ${local}; remote ${remote ?? "missing"}`);
}

describe("CF-B15 — FS/git substrate faults and preserve-and-inspect (L2, HB-025/HB-P2)", () => {
  let repo: TempGitRepo | undefined;
  let state: TempStateHome | undefined;
  afterEach(async () => {
    await state?.cleanup();
    await repo?.cleanup();
    state = undefined;
    repo = undefined;
  });

  it("ambiguous uncommitted bytes survive stale-turn recovery and are surfaced for inspection; no respawn occurs", async () => {
    repo = await makeTempGitRepo();
    state = await makeTempStateHome({ name: "cf-b15-preserve" });
    const ambiguousPath = join(repo.dir, "ambiguous.txt");
    const ambiguousBytes = "provider bytes not yet accepted\n";
    await writeFile(ambiguousPath, ambiguousBytes, "utf8");
    const lock = await acquireLock(state.stateHome, {
      app: "b15-app",
      role: "builder",
      turnId: "turn-b15",
      now: new Date("2026-07-31T10:00:00.000Z"),
    });
    expect(lock.acquired).toBe(true);
    await writeJournalPatch(state.stateHome, "turn-b15", {
      app: "b15-app",
      role: "builder",
      phase: "assembling",
      attempt: 0,
    });
    const journal = await writeJournalPatch(state.stateHome, "turn-b15", {
      app: "b15-app",
      role: "builder",
      phase: "running",
      attempt: 0,
      worktree: repo.dir,
      worktreeBranch: repo.defaultBranch,
    });
    let spawned = false;
    const recovered = await recoverStaleTurn(state.stateHome, lock.lock, journal, {
      spawn: async () => { spawned = true; },
    });

    expect(recovered).toMatchObject({ decision: { action: "preserve_inspect" }, spawned: false });
    expect(spawned).toBe(false);
    await assertBytesPreserved(ambiguousPath, ambiguousBytes);
    const durable = await readJournal(state.stateHome, "turn-b15");
    expect(durable).toMatchObject({
      phase: "failed",
      errorCode: "error_ambiguous_worktree",
      recovery: {
        path: repo.dir,
        branch: repo.defaultBranch,
        dirty: true,
        statusEntries: 1,
      },
    });
    expect(durable.recovery?.recoveryCommand).toContain("status --short --branch");
  });

  it("negative control: a silent reset/clean simulation makes the preservation detector FIRE", async () => {
    repo = await makeTempGitRepo();
    const path = join(repo.dir, "ambiguous.txt");
    await writeFile(path, "valuable bytes\n", "utf8");
    repo.git(["clean", "-fd"]); // seeded old behavior; test repo only
    await expect(assertBytesPreserved(path, "valuable bytes\n")).rejects.toBeInstanceOf(
      AmbiguousBytesLostViolation,
    );
  });

  it("a foreign index.lock fails typed and bounded without deleting or stealing the lock", async () => {
    repo = await makeTempGitRepo();
    const lockPath = await repo.corrupt.holdIndexLock();
    const started = Date.now();
    const result = preflightGitWorktreeIndex(repo.dir);
    expect(Date.now() - started).toBeLessThan(30_000);
    expect(result).toMatchObject({ status: "fail", errorCode: "error_git_index_unwritable" });
    expect(existsSync(lockPath)).toBe(true);
  });

  it("corrupt ref metadata yields a typed invalid-worktree failure, never a guessed ref", async () => {
    repo = await makeTempGitRepo({ defaultBranch: "trunk" });
    await repo.corrupt.removeHead();
    expect(preflightGitWorktreeIndex(repo.dir)).toMatchObject({
      status: "fail",
      errorCode: "error_git_worktree_invalid",
    });
  });

  it("remote URL drift is an identity stop even when both remotes could advertise the same commit", () => {
    expect(managedRemoteIdentityProblem("file:///expected.git", "file:///expected.git")).toBeUndefined();
    expect(managedRemoteIdentityProblem("file:///expected.git", "file:///substitute.git")).toContain(
      "remote identity changed",
    );
  });

  it("push disables repository hooks and verifies the exact remote branch post-state", async () => {
    repo = await makeTempGitRepo({ defaultBranch: "trunk" });
    await repo.addFileRemote();
    const marker = join(repo.dir, "hook-ran.marker");
    const hook = join(repo.dir, ".git", "hooks", "pre-push");
    await writeFile(hook, `#!/bin/sh\ntouch ${JSON.stringify(marker)}\nexit 1\n`, { mode: 0o755 });

    pushBranch(repo.dir, repo.defaultBranch);
    expect(existsSync(marker)).toBe(false);
    expect(() => assertRemoteMatchesLocal(repo!, repo!.defaultBranch)).not.toThrow();
  });

  it("negative control: exit success without matching remote post-state makes the verifier FIRE", async () => {
    repo = await makeTempGitRepo({ defaultBranch: "trunk" });
    await repo.addFileRemote();
    await repo.commitFile("local-only.txt", "not pushed\n");
    expect(() => assertRemoteMatchesLocal(repo!, repo!.defaultBranch)).toThrow(PushPostStateViolation);
  });

  it("managed git wrappers keep hooks disabled; deleting the pin makes the structural detector fire", async () => {
    const sources = await Promise.all([
      readFile("src/org/app-lifecycle.ts", "utf8"),
      readFile("src/org/plan-auto.ts", "utf8"),
      readFile("src/loop/loop.ts", "utf8"),
    ]);
    const assertPins = (texts: readonly string[]): void => {
      for (const [index, text] of texts.entries()) {
        if (!text.includes("core.hooksPath=/dev/null")) {
          throw new Error(`managed git wrapper ${index} does not disable hooks`);
        }
      }
    };
    expect(() => assertPins(sources)).not.toThrow();
    expect(() => assertPins([sources[0]!.replaceAll("core.hooksPath=/dev/null", "")])).toThrow(
      "does not disable hooks",
    );
  });
});
