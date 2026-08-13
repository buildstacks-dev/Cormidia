// Traceability: CF-REG-388 · HB-139 · case-catalog.md §10.3.
// Binds INV-008 (evidence never outruns reality), INV-010 (destruction stays
// inside its named scope), INV-013 (durable writes have an integrity story);
// boundaries B-14 (human checkout ↔ managed workspace), B-15 (git substrate),
// B-01 (GitHub); journey J-02's evidence-ladder rung rule.

// CF-REG-388 — a committed org-home mutation is durable only when it is
// reachable at the remote.
//
// The defect: `cormidia new-app` wrote `apps.yaml` in the org-home working tree
// and returned the terminal outcome `app-created-and-registered` while
// `origin/<default>` still carried `apps: {}`. A second host, a fresh clone, or
// a recovery from the remote silently lost the registered app.
//
// L2 on real temp git checkouts with real file:// origins. The GitHub half is a
// two-call double; every git fact is real, including the default-branch
// resolution, which runs through the product's own `resolveRemoteDefaultBranch`
// against a remote whose default branch is deliberately NOT `main` (#101).

import { readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { joinExistingOrg } from "../../../src/org/apps.js";
import { PublicationRefusedError } from "../../../src/org/git-publication-execute.js";
import { listPublicationTransactions } from "../../../src/org/git-publication-journal.js";
import {
  executeOrgHomePublication,
  orgHomeDivergence,
  orgHomePublicationBranch,
  planOrgHomePublication,
} from "../../../src/org/org-home-publication.js";
import {
  cloneRemote,
  git,
  makeGitOrgHome,
  makePublicationGhDouble,
  remoteBlob,
  remoteTip,
  type GitOrgHome,
} from "./helpers.js";

const APP = "cf-reg-388-app";
const REPO = "fixture/cf-reg-388-app";
const BRANCH = orgHomePublicationBranch("app-registry");

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function registeredOrgHome(): Promise<GitOrgHome> {
  const home = await makeGitOrgHome();
  cleanups.push(() => home.cleanup());
  await joinExistingOrg(home.orgHome, { name: APP, repo: REPO });
  return home;
}

function publish(home: GitOrgHome, extra: Record<string, unknown> = {}) {
  return executeOrgHomePublication({
    orgHome: home.orgHome,
    stateHome: home.stateHome,
    surface: "app-registry",
    commitMessage: "chore(cormidia): register cf-reg-388-app",
    pullRequestTitle: "chore(cormidia): register cf-reg-388-app",
    pullRequestBody: "fixture",
    ...extra,
  });
}

describe("CF-REG-388 — committed org-home mutations publish or say they have not", () => {
  it("reports recorded_locally before publication, and the remote still says apps: {}", async () => {
    const home = await registeredOrgHome();
    const plan = await planOrgHomePublication({ orgHome: home.orgHome, surface: "app-registry" });

    expect(plan.durability).toBe("recorded_locally");
    expect(plan.preflight.mode).toBe("publishable");
    expect(plan.preflight.changed_paths).toEqual(["apps.yaml"]);
    expect(plan.preflight.base?.default_branch).toBe(home.defaultBranch);
    // Before/after hashes are both reported and actually differ.
    const owned = plan.preflight.owned_paths[0];
    expect(owned?.base_sha256).not.toBeNull();
    expect(owned?.worktree_sha256).not.toEqual(owned?.base_sha256);
    // The claim a command may make names a transition that is not itself.
    expect(plan.next_action).toContain("cormidia org publish");

    expect(remoteBlob(home.remoteDir, home.defaultBranch, "apps.yaml")).not.toContain(APP);
  });

  it("publishes the owned path and a fresh clone at the reported revision carries the change", async () => {
    const home = await registeredOrgHome();
    const gh = makePublicationGhDouble();
    const { plan, transaction } = await publish(home, { gh });

    expect(transaction).not.toBeNull();
    expect(transaction?.phase).toBe("pull_request_open");
    expect(transaction?.pushed_commit).toBe(transaction?.commit);
    expect(transaction?.pull_request?.number).toBe(1);
    // Not terminal: the branch is on the remote, a human still merges it.
    expect(plan.durability).toBe("pending_merge");
    expect(plan.next_action).toContain("merge");

    const clone = await cloneRemote(home.remoteDir, BRANCH);
    cleanups.push(() => clone.cleanup());
    expect(git(clone.dir, ["rev-parse", "HEAD"])).toBe(transaction?.pushed_commit);
    expect(readFileSync(join(clone.dir, "apps.yaml"), "utf8")).toContain(REPO);
    // …and the default branch is deliberately untouched: pending_merge means
    // pending, and the publication route never pushes a default branch.
    git(clone.dir, ["checkout", "--quiet", home.defaultBranch]);
    expect(readFileSync(join(clone.dir, "apps.yaml"), "utf8")).not.toContain(APP);
  });

  it("publishes only the owned path and leaves unrelated unstaged/untracked bytes byte-identical", async () => {
    const home = await registeredOrgHome();
    // Unrelated operator work in flight, none of it Cormidia's to commit.
    // (Unrelated *staged* content is a refusal, not an exclusion — that leg is
    // the foreign-staged negative control in org-publication-refusals.)
    await writeFile(join(home.orgHome, "TASTE.md"), "# operator edit, unstaged\n", "utf8");
    await writeFile(join(home.orgHome, "notes.txt"), "untracked operator scratch\n", "utf8");
    await writeFile(join(home.orgHome, "pipelines.yaml"), "# operator edit, unstaged too\n", "utf8");

    const before = new Map(
      ["TASTE.md", "notes.txt", "pipelines.yaml", "apps.yaml"].map((rel) => [
        rel,
        readFileSync(join(home.orgHome, rel), "utf8"),
      ]),
    );
    const headBefore = git(home.orgHome, ["rev-parse", "HEAD"]);
    const stagedBefore = git(home.orgHome, ["diff", "--cached", "--name-only"]);

    const { transaction } = await publish(home, { gh: makePublicationGhDouble() });
    expect(transaction?.pushed_commit).not.toBeNull();

    // The operator's checkout is exactly as they left it.
    for (const [rel, bytes] of before) {
      expect(readFileSync(join(home.orgHome, rel), "utf8"), `${rel} was mutated`).toBe(bytes);
    }
    expect(git(home.orgHome, ["rev-parse", "HEAD"])).toBe(headBefore);
    expect(git(home.orgHome, ["diff", "--cached", "--name-only"])).toBe(stagedBefore);

    // The published commit touches exactly one path.
    const changed = git(home.remoteDir, ["diff", "--name-only", home.defaultBranch, BRANCH]);
    expect(changed).toBe("apps.yaml");
    expect(remoteBlob(home.remoteDir, BRANCH, "TASTE.md")).not.toContain("operator edit");
    expect(remoteBlob(home.remoteDir, BRANCH, "notes.txt")).toBeUndefined();
  });

  it("recovers idempotently from a seeded push failure with no duplicate commit or pull request", async () => {
    const home = await registeredOrgHome();
    const gh = makePublicationGhDouble();
    // Seed the failure at the push boundary only: the commit is built and the
    // remote never hears about it. This is the partial-publication shape.
    home.denyPush();
    await expect(publish(home, { gh })).rejects.toThrow(/seeded push failure/);
    expect(gh.createdCount()).toBe(0);

    // Nothing may claim publication while the push has not landed.
    expect(orgHomeDivergence(home.orgHome).state).toBe("diverged");
    home.allowPush();

    const { plan, transaction } = await publish(home, { gh });
    expect(plan.durability).toBe("pending_merge");
    expect(gh.createdCount()).toBe(1);

    expect(git(home.remoteDir, ["rev-list", "--count", `${home.defaultBranch}..${BRANCH}`])).toBe("1");
    expect(remoteTip(home.remoteDir, BRANCH)).toBe(transaction?.pushed_commit);
  });

  it("recovers idempotently from a seeded lost createPR response without opening a second pull request", async () => {
    const home = await registeredOrgHome();
    const lossy = makePublicationGhDouble({ loseCreateResponse: true });
    await expect(publish(home, { gh: lossy })).rejects.toThrow(/seeded lost success response/);
    expect(lossy.createdCount()).toBe(1);

    // The retry must discover the pull request that already exists rather than
    // create a second one: the effect happened, only the answer was lost.
    const { plan, transaction } = await publish(home, { gh: lossy });
    expect(lossy.createdCount()).toBe(1);
    expect(transaction?.pull_request?.number).toBe(1);
    expect(plan.durability).toBe("pending_merge");

    expect(git(home.remoteDir, ["rev-list", "--count", `${home.defaultBranch}..${BRANCH}`])).toBe("1");
  });

  it("settles reachable_at_remote only after the change is on the resolved default branch", async () => {
    const home = await registeredOrgHome();
    const gh = makePublicationGhDouble();
    await publish(home, { gh });
    expect(orgHomeDivergence(home.orgHome).state).toBe("diverged");

    // A human merges the draft. Only now is the registration org truth.
    const merge = await cloneRemote(home.remoteDir, home.defaultBranch);
    cleanups.push(() => merge.cleanup());
    git(merge.dir, ["config", "user.name", "Fixture Human"]);
    git(merge.dir, ["config", "user.email", "human@cormidia.invalid"]);
    git(merge.dir, ["merge", "--quiet", "--no-ff", "-m", "merge publication", `origin/${BRANCH}`]);
    git(merge.dir, ["push", "--quiet", "origin", home.defaultBranch]);
    git(home.orgHome, ["fetch", "--quiet", "origin"]);

    expect(orgHomeDivergence(home.orgHome).state).toBe("converged");
    const plan = await planOrgHomePublication({ orgHome: home.orgHome, surface: "app-registry" });
    expect(plan.durability).toBe("reachable_at_remote");
    expect(plan.preflight.reachable_at_base).toBe(true);

    const fresh = await cloneRemote(home.remoteDir);
    cleanups.push(() => fresh.cleanup());
    expect(await readFile(join(fresh.dir, "apps.yaml"), "utf8")).toContain(REPO);
  });

  it("refuses a publish branch whose remote content differs, and never overwrites it", async () => {
    const home = await registeredOrgHome();
    // Someone else's branch already occupies the publication ref.
    const foreign = await cloneRemote(home.remoteDir, home.defaultBranch);
    cleanups.push(() => foreign.cleanup());
    git(foreign.dir, ["config", "user.name", "Someone Else"]);
    git(foreign.dir, ["config", "user.email", "else@cormidia.invalid"]);
    git(foreign.dir, ["checkout", "--quiet", "-b", BRANCH]);
    await writeFile(join(foreign.dir, "apps.yaml"), "org:\n  name: someone-else\napps: {}\n", "utf8");
    git(foreign.dir, ["commit", "--quiet", "-am", "someone else's work"]);
    git(foreign.dir, ["push", "--quiet", "origin", BRANCH]);
    const foreignTip = git(foreign.dir, ["rev-parse", "HEAD"]);

    await expect(publish(home, { gh: makePublicationGhDouble() })).rejects.toThrow(PublicationRefusedError);

    expect(remoteTip(home.remoteDir, BRANCH)).toBe(foreignTip);
    expect(remoteBlob(home.remoteDir, BRANCH, "apps.yaml")).toContain("someone-else");
  });

  it("journals the transaction so an interrupted publication is recognizable, never silently lost", async () => {
    const home = await registeredOrgHome();
    await publish(home, { gh: makePublicationGhDouble() });
    const journaled = await listPublicationTransactions(home.stateHome, "org", "app-registry");
    expect(journaled).toHaveLength(1);
    expect(journaled[0]?.owned_paths).toEqual(["apps.yaml"]);
    expect(journaled[0]?.base.default_branch).toBe(home.defaultBranch);
    expect(journaled[0]?.durability).toBe("pending_merge");
  });
});
