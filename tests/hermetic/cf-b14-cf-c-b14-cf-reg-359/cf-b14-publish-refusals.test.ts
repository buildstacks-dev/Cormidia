// Traceability: CF-B14 · HB-P4 · boundary-map.md B-14; contracts/B-14-app-bootstrap.md.

// CF-B14-* — publish-only refusals (contracts/B-14-human-checkout.md §1/§3;
// boundary-map.md §B-14 "dirty files at bootstrap … wrong remote").
//
// Contract §1: the refusals for unrelated staged changes, a merge in
// progress, and a detached HEAD belong specifically to `bootstrap publish
// --execute` — they are NOT general bootstrap preconditions (the ordinary-
// accept mirror lives in cf-b14-bootstrap-checkout.test.ts §1). Every refusal
// here is asserted as a typed blocker raised by pure planning — before any
// mutation — and the planner's repo list stays empty for the refused side.
//
// L2 on real temp git checkouts with real file:// origins (git-repo.ts):
// `planBootstrapPublish` resolves the default branch through the product's
// own git ls-remote path against the temp remote, never the gh double.
// Planning is network-free by design, so no GitHub double is needed; the
// blocked-plan execute case throws before any gh call.
//
// WRONG REMOTE, two legs:
// - implemented leg (green): a checkout with no resolvable origin refuses
//   before mutation (contract §3);
// - PARKED leg: origin repointed to a DIFFERENT repository after
//   registration. Contract §3 lists "wrong remote → typed refusal" but does
//   not say which command performs which identity comparison, and
//   boundary-map B-15 separately owns "remote URL changed → identity stop".
//   Candidate-finding material (owner must place the comparison); asserting
//   either placement would encode a guess — reported in the wave report,
//   deliberately not implemented here.

import { afterEach, describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { executeBootstrapPublish, planBootstrapPublish } from "../../../src/org/bootstrap-publish.js";
import { bootstrapRun, registerAppWithExistingOrg } from "../../../src/org/bootstrap.js";
import { loadRoles } from "../../../src/org/roles.js";
import { makeTempGitRepo, type TempGitRepo } from "../../fixtures/git-repo.js";
import { makeTempOrgHome, type TempOrgHome } from "../../fixtures/org-home.js";
import { answersFor } from "./helpers.js";

const APP = "cf-b14-pub-app";
const AGENTS_SEED = "# Fixture app AGENTS.md\n\nHuman-authored content.\n";

describe("CF-B14-* — publish-only refusals (bootstrap publish planning, contract B-14 §1/§3)", () => {
  let cleanups: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    for (const cleanup of cleanups.reverse()) await cleanup();
    cleanups = [];
  });

  interface PublishWalk {
    repo: TempGitRepo;
    org: TempOrgHome;
    plan(): ReturnType<typeof planBootstrapPublish>;
  }

  /** A registered, bootstrapped checkout with a real file:// origin — the
   *  state an operator is in right before `bootstrap publish`. */
  async function makeBootstrappedWalk(): Promise<PublishWalk> {
    const repo = await makeTempGitRepo({
      defaultBranch: "trunk", // deliberately not main (#101)
      seedFiles: [
        { path: "README.md", contents: "# fixture app\n" },
        { path: "AGENTS.md", contents: AGENTS_SEED },
      ],
    });
    cleanups.push(() => repo.cleanup());
    await repo.addFileRemote();
    const org = await makeTempOrgHome();
    cleanups.push(() => org.cleanup());
    const role = (await loadRoles(join(org.orgHome, "roles.yaml"))).roles[0]!.name;
    await bootstrapRun(repo.dir, answersFor(role), {
      orgHome: org.orgHome,
      appName: APP,
      repoSlug: `fixture/${APP}`,
    });
    return {
      repo,
      org,
      plan: () =>
        planBootstrapPublish({
          app: APP,
          orgHome: org.orgHome,
          appDir: repo.dir,
          publishOrgHome: false, // the temp org home is not a git repo; app side is under test
        }),
    };
  }

  it("baseline: with only bootstrap-owned changes pending, planning raises no blockers and scopes exactly the owned paths", async () => {
    const walk = await makeBootstrappedWalk();
    const plan = await walk.plan();

    expect(plan.blockers).toEqual([]);
    expect(plan.repos).toHaveLength(1);
    const files = plan.repos[0]!.files;
    // Owned paths only — bootstrap output plus the two instruction docs it
    // composed; nothing the human owns is swept in.
    expect(files).toContain(".cormidia/TASTE.md");
    expect(files).toContain("AGENTS.md");
    expect(files).toContain("CLAUDE.md");
    expect(files.every((rel) => rel.startsWith(".cormidia/") || rel === "AGENTS.md" || rel === "CLAUDE.md")).toBe(true);
    expect(plan.repos[0]!.base.defaultBranch).toBe("trunk"); // resolved from the remote, never guessed
  });

  it("refuses a checkout with a merge in progress, and a conflicted bootstrap-owned path once the marker is gone (negative control: seeded conflict — the guard FIRES)", async () => {
    // Conflict on a bootstrap-owned path (AGENTS.md), built from real merges
    // BEFORE the app has artifacts: register-only keeps the walk minimal —
    // both guards fire before pending-change computation.
    const repo = await makeTempGitRepo({
      defaultBranch: "trunk",
      seedFiles: [{ path: "AGENTS.md", contents: "base\n" }],
    });
    cleanups.push(() => repo.cleanup());
    const org = await makeTempOrgHome();
    cleanups.push(() => org.cleanup());
    await registerAppWithExistingOrg(repo.dir, {
      orgHome: org.orgHome,
      appName: APP,
      repoSlug: `fixture/${APP}`,
    });

    repo.git(["checkout", "-b", "feature"]);
    await repo.commitFile("AGENTS.md", "feature version\n", "feature edit");
    repo.git(["checkout", "trunk"]);
    await repo.commitFile("AGENTS.md", "trunk version\n", "trunk edit");
    expect(() => repo.git(["merge", "feature"])).toThrow(); // real conflict

    const plan = (_kind?: string) =>
      planBootstrapPublish({
        app: APP,
        orgHome: org.orgHome,
        appDir: repo.dir,
        publishOrgHome: false,
      }).then((p) => {
        expect(p.repos).toEqual([]); // refusal → nothing planned, nothing mutable
        return p.blockers.join("\n");
      });

    // Leg 1 — operation in progress: MERGE_HEAD present.
    expect(await plan()).toMatch(/operation in progress \(MERGE_HEAD\).*finish or abort/s);

    // Leg 2 — the marker is gone (operator deleted it / tool crashed) but the
    // index still holds unresolved stages on an owned path: the conflicted-
    // path guard fires rather than committing conflict markers.
    await rm(join(repo.dir, ".git", "MERGE_HEAD"));
    expect(await plan()).toMatch(/unresolved conflicts in bootstrap-owned files \(AGENTS\.md\)/);
  });

  it("refuses a detached HEAD — there is no branch to return the operator to", async () => {
    const walk = await makeBootstrappedWalk();
    walk.repo.git(["checkout", "--detach"]);

    const plan = await walk.plan();
    expect(plan.repos).toEqual([]);
    expect(plan.blockers.join("\n")).toMatch(/detached HEAD.*check out a branch/s);
  });

  it("refuses unrelated staged changes — the publication scope would be ambiguous", async () => {
    const walk = await makeBootstrappedWalk();
    writeFileSync(join(walk.repo.dir, "human-work.txt"), "the operator's own staged work\n");
    walk.repo.git(["add", "--", "human-work.txt"]);

    const plan = await walk.plan();
    expect(plan.repos).toEqual([]);
    expect(plan.blockers.join("\n")).toMatch(/unrelated staged changes.*human-work\.txt.*unstage them/s);
  });

  it("refuses an instruction file whose pending change goes beyond the marked block — a file Cormidia did not write is not Cormidia's to commit", async () => {
    const walk = await makeBootstrappedWalk();
    // Baseline: bootstrap's own AGENTS.md change is block-only → publishable.
    expect((await walk.plan()).blockers).toEqual([]);

    // The human appends their OWN prose to AGENTS.md after bootstrap composed
    // the block. Publishing the whole file would sweep that in — refuse.
    const composed = join(walk.repo.dir, "AGENTS.md");
    await writeFile(composed, `${AGENTS_SEED}\nUnpublished human paragraph.\n`, { flag: "w" });
    // (Human bytes only: the block bootstrap appended is gone too, so the
    // remainder-diff cannot be block-only.)

    const plan = await walk.plan();
    expect(plan.repos).toEqual([]);
    expect(plan.blockers.join("\n")).toMatch(/beyond the Cormidia authority block.*commit or stash/s);
  });

  it("wrong remote (implemented leg): no resolvable origin → typed refusal before mutation", async () => {
    // Register-only checkout with NO origin remote: the base cannot be
    // resolved from remote truth, so planning refuses rather than guessing
    // (#101 — a guessed base silently diffs against the wrong tree).
    const repo = await makeTempGitRepo({ defaultBranch: "trunk" });
    cleanups.push(() => repo.cleanup());
    const org = await makeTempOrgHome();
    cleanups.push(() => org.cleanup());
    await registerAppWithExistingOrg(repo.dir, {
      orgHome: org.orgHome,
      appName: APP,
      repoSlug: `fixture/${APP}`,
    });

    const plan = await planBootstrapPublish({
      app: APP,
      orgHome: org.orgHome,
      appDir: repo.dir,
      publishOrgHome: false,
    });
    expect(plan.repos).toEqual([]);
    expect(plan.blockers.join("\n")).toMatch(/cannot resolve the default branch/);
  });

  it("refuses an app that was never registered — bootstrap first", async () => {
    const repo = await makeTempGitRepo({ defaultBranch: "trunk" });
    cleanups.push(() => repo.cleanup());
    const org = await makeTempOrgHome();
    cleanups.push(() => org.cleanup());

    const plan = await planBootstrapPublish({
      app: "never-bootstrapped",
      orgHome: org.orgHome,
      appDir: repo.dir,
      publishOrgHome: false,
    });
    expect(plan.repos).toEqual([]);
    expect(plan.blockers.join("\n")).toMatch(/"never-bootstrapped" is not registered .*run `cormidia bootstrap`/s);
  });

  it("a blocked plan can never be executed — the library seam refuses too", async () => {
    const walk = await makeBootstrappedWalk();
    walk.repo.git(["checkout", "--detach"]);
    const blocked = await walk.plan();
    expect(blocked.blockers.length).toBeGreaterThan(0);

    await expect(
      executeBootstrapPublish(blocked, {
        app: APP,
        orgHome: walk.org.orgHome,
        appDir: walk.repo.dir,
        publishOrgHome: false,
      }),
    ).rejects.toThrow(/refusing to execute a blocked plan/);
  });
});
