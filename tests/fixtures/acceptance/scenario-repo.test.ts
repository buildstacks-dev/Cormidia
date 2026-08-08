// Self-test for the fixture scenario repositories (HB-120).
//
// The load-bearing claim is the git-history one: after `commitPlantsThenDelete`
// the working tree is clean and `git log -p` still yields the plant. If that
// stopped being true the CF-INV-ACC-1 reachability case would pass vacuously.

import { readdir } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { assertNonEmptyWalk } from "../walk.js";
import { FIXTURE_SCENARIO_KINDS } from "./scenario-corpus.js";
import { makeFixtureScenarioRepo } from "./scenario-repo.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

describe("fixtures/acceptance/scenario-repo self-test", () => {
  it("seeds every kind with a non-empty tracked file walk", async () => {
    for (const kind of FIXTURE_SCENARIO_KINDS) {
      const fixture = await makeFixtureScenarioRepo({ kind });
      cleanups.push(fixture.cleanup);
      const files = await assertNonEmptyWalk(fixture.repo.dir, /^(?!\.git\/)/);
      expect(files.length).toBeGreaterThan(0);
      expect(fixture.repo.git(["status", "--porcelain"])).toBe("");
    }
  });

  it("commitPlantsThenDelete leaves a clean working tree and a dirty history", async () => {
    const fixture = await makeFixtureScenarioRepo({ kind: "greenfield", commitPlantsThenDelete: true });
    cleanups.push(fixture.cleanup);
    const token = fixture.tokens[0];
    expect(token).toBeDefined();

    const tracked = fixture.repo.git(["ls-files"]).split("\n");
    expect(tracked.some((path) => path.includes("FIX-ACC-greenfield.md"))).toBe(false);
    const worktreeEntries = await readdir(fixture.repo.dir);
    expect(worktreeEntries).not.toContain("acceptance");

    const history = fixture.repo.git(["log", "-p", "--no-color"]);
    expect(history).toContain(token as string);
  });

  it("without the seed, no plant byte is anywhere in the repository", async () => {
    const fixture = await makeFixtureScenarioRepo({ kind: "greenfield" });
    cleanups.push(fixture.cleanup);
    const history = fixture.repo.git(["log", "-p", "--no-color"]);
    for (const token of fixture.tokens) expect(history).not.toContain(token);
  });

  it("hand-authored commits carry the supervisor identity, seeded commits do not", async () => {
    const fixture = await makeFixtureScenarioRepo({
      kind: "greenfield",
      handAuthoredCommit: { path: "src/patch.txt", contents: "manual fix\n" },
    });
    cleanups.push(fixture.cleanup);
    const authors = fixture.repo.git(["log", "--format=%an <%ae>"]).split("\n");
    expect(authors[0]).toBe("Supervising Agent <supervisor@example.invalid>");
    expect(authors.slice(1).every((author) => author.endsWith("@cormidia.invalid>"))).toBe(true);
  });

  it("adds a real file:// origin when asked, and none otherwise", async () => {
    const withOrigin = await makeFixtureScenarioRepo({ kind: "job", withOrigin: true });
    cleanups.push(withOrigin.cleanup);
    expect(withOrigin.originUrl).toMatch(/^file:\/\//);
    expect(withOrigin.repo.git(["remote", "get-url", "origin"])).toBe(withOrigin.originUrl);

    const withoutOrigin = await makeFixtureScenarioRepo({ kind: "job" });
    cleanups.push(withoutOrigin.cleanup);
    expect(withoutOrigin.originUrl).toBeUndefined();
    expect(withoutOrigin.repo.git(["remote"])).toBe("");
  });
});
