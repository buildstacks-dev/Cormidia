// Traceability: CF-REG-388 · HB-139 · case-catalog.md §10.3.
// Binds INV-008/010/013; boundaries B-14 (checkout containment), B-15 (git
// substrate identity/failure), B-10 (org-home surfaces ↔ resolver).

// CF-REG-388 — the refusal half. Every detector this family relies on is
// exercised against a seeded violation here, because a detector that has never
// fired is an assumption (harness rule 4).
//
// Covered negative controls:
//   - foreign-path staging (unrelated staged content makes the scope ambiguous)
//   - stale content between preview and execute
//   - stale base: the remote default branch moved between preview and execute
//   - partial publication: the commit exists, the push did not land
//   - an org home with no remote, and one that is not a git checkout at all
//
// Scope fence: nothing here compares the org home's origin against a
// *registered* repository slug. Which boundary owns that comparison is an open
// product-truth question (F-PT-016), and asserting either placement would
// encode a guess. These cases only detect DRIFT of the observed remote between
// preview and execution, which is a different, uncontested fact.

import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { joinExistingOrg } from "../../../src/org/apps.js";
import { PublicationRefusedError } from "../../../src/org/git-publication-execute.js";
import {
  executeOrgHomePublication,
  orgHomeDivergence,
  orgHomePublicationBranch,
  planOrgHomePublication,
} from "../../../src/org/org-home-publication.js";
import { makeTempOrgHome } from "../../fixtures/org-home.js";
import { cloneRemote, git, makeGitOrgHome, makePublicationGhDouble, type GitOrgHome } from "./helpers.js";

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

describe("CF-REG-388 — publication refusals and negative controls", () => {
  it("negative control: unrelated staged content makes the scope ambiguous and refuses before any effect", async () => {
    const home = await registeredOrgHome();
    await writeFile(join(home.orgHome, "TASTE.md"), "# operator work in the index\n", "utf8");
    git(home.orgHome, ["add", "--", "TASTE.md"]);

    const plan = await planOrgHomePublication({ orgHome: home.orgHome, surface: "app-registry" });
    expect(plan.preflight.foreign_staged).toEqual(["TASTE.md"]);
    expect(plan.preflight.blockers.join("\n")).toContain("unrelated staged changes");

    const gh = makePublicationGhDouble();
    const outcome = await publish(home, { gh });
    expect(outcome.transaction).toBeNull();
    expect(gh.createdCount()).toBe(0);
    // Nothing reached the remote: the publish branch does not exist.
    expect(git(home.orgHome, ["ls-remote", "--heads", "origin", BRANCH])).toBe("");
  });

  it("negative control: owned content changed after the preview refuses instead of publishing the newer bytes", async () => {
    const home = await registeredOrgHome();
    const reviewed = await planOrgHomePublication({ orgHome: home.orgHome, surface: "app-registry" });

    // The operator edits the registry again between preview and execution.
    await joinExistingOrg(home.orgHome, { name: "second-app", repo: "fixture/second-app" });

    // One attempt, two assertions on it: a second publish would be a second
    // full preflight for no additional coverage.
    const refused = publish(home, { expectedContentId: reviewed.preflight.content_id });
    await expect(refused).rejects.toThrow(PublicationRefusedError);
    await expect(refused).rejects.toThrow(/moved since the preview/);
    expect(git(home.orgHome, ["ls-remote", "--heads", "origin", BRANCH])).toBe("");
  });

  it("negative control: a remote default branch that moved between preview and execute is detected, never overwritten", async () => {
    const home = await registeredOrgHome();
    const reviewed = await planOrgHomePublication({ orgHome: home.orgHome, surface: "app-registry" });
    const reviewedBase = reviewed.preflight.base?.commit;
    expect(reviewedBase).toBeDefined();

    // Someone else lands an unrelated change on the org's default branch.
    const other = await cloneRemote(home.remoteDir, home.defaultBranch);
    cleanups.push(() => other.cleanup());
    git(other.dir, ["config", "user.name", "Someone Else"]);
    git(other.dir, ["config", "user.email", "else@cormidia.invalid"]);
    await writeFile(join(other.dir, "TASTE.md"), "# ratified elsewhere\n", "utf8");
    git(other.dir, ["commit", "--quiet", "-am", "someone else's ratified change"]);
    git(other.dir, ["push", "--quiet", "origin", home.defaultBranch]);
    const movedTip = git(other.dir, ["rev-parse", "HEAD"]);

    await expect(publish(home, { expectedContentId: reviewed.preflight.content_id })).rejects.toThrow(
      /moved since the preview/,
    );

    // The default branch is exactly where the other author left it.
    expect(git(home.orgHome, ["ls-remote", "origin", `refs/heads/${home.defaultBranch}`]).split(/\s+/)[0]).toBe(
      movedTip,
    );

    // Re-previewing rebases onto the new tip: a fresh identity, not an
    // overwrite of the reviewed one.
    const replanned = await planOrgHomePublication({ orgHome: home.orgHome, surface: "app-registry" });
    expect(replanned.preflight.base?.commit).toBe(movedTip);
    expect(replanned.preflight.content_id).not.toBe(reviewed.preflight.content_id);
    const { plan } = await publish(home, {
      expectedContentId: replanned.preflight.content_id,
      gh: makePublicationGhDouble(),
    });
    expect(plan.durability).toBe("pending_merge");
  });

  it("negative control: a partial publication is never reported as converged", async () => {
    const home = await registeredOrgHome();
    home.denyPush();
    await expect(publish(home, { gh: makePublicationGhDouble() })).rejects.toThrow(/seeded push failure/);
    const divergence = orgHomeDivergence(home.orgHome);
    expect(divergence.state).toBe("diverged");
    expect(divergence.surfaces.map((entry) => entry.surface)).toContain("app-registry");
    expect(git(home.orgHome, ["ls-remote", "--heads", "origin", BRANCH])).toBe("");
  });

  it("an org home with no remote reports the explicit local-only contract", async () => {
    const home = await makeGitOrgHome();
    cleanups.push(() => home.cleanup());
    git(home.orgHome, ["remote", "remove", "origin"]);
    await joinExistingOrg(home.orgHome, { name: APP, repo: REPO });

    const plan = await planOrgHomePublication({ orgHome: home.orgHome, surface: "app-registry" });
    expect(plan.preflight.mode).toBe("local_only");
    expect(plan.durability).toBe("local_only");
    expect(plan.next_action).toContain("local-only");
    expect(orgHomeDivergence(home.orgHome).state).toBe("local_only");

    // Executing is a no-op that claims nothing rather than a silent success.
    const outcome = await publish(home, { gh: makePublicationGhDouble() });
    expect(outcome.transaction).toBeNull();
    expect(outcome.plan.durability).toBe("local_only");
  });

  it("an org home that is not a git checkout reports its limitation instead of claiming durability", async () => {
    const org = await makeTempOrgHome({ name: "cf-reg-388-nogit" });
    cleanups.push(() => org.cleanup());
    await joinExistingOrg(org.orgHome, { name: APP, repo: REPO });

    const plan = await planOrgHomePublication({ orgHome: org.orgHome, surface: "app-registry" });
    expect(plan.preflight.mode).toBe("not_a_repository");
    expect(plan.durability).toBe("local_only");
    expect(orgHomeDivergence(org.orgHome).state).toBe("not_a_repository");
  });

  it("an org home with a remote but no fetched default-branch ref reports unknown, never converged", async () => {
    const home = await registeredOrgHome();
    // Remove the fetched remote-tracking metadata: the checkout can no longer
    // prove anything about the remote, and silence would read as agreement.
    await rm(join(home.orgHome, ".git", "refs", "remotes", "origin"), { recursive: true, force: true });
    await rm(join(home.orgHome, ".git", "packed-refs"), { force: true });

    const divergence = orgHomeDivergence(home.orgHome);
    expect(divergence.state).toBe("unknown");
    expect(divergence.detail).toContain("cannot be proven");
  });

  it("an unresolved placeholder remote is pushed for review but claims no pull request", async () => {
    const home = await registeredOrgHome();
    // A remote URL can parse as GitHub and still name no repository anyone can
    // review in. #385 owns that rule; this publication defers to it rather than
    // opening a draft pull request against `OWNER/YOUR_APP_REPOSITORY`.
    git(home.orgHome, ["remote", "set-url", "origin", "https://github.com/OWNER/YOUR_APP_REPOSITORY.git"]);
    git(home.orgHome, [
      "config",
      `url.${home.remoteDir}.insteadOf`,
      "https://github.com/OWNER/YOUR_APP_REPOSITORY.git",
    ]);

    const plan = await planOrgHomePublication({ orgHome: home.orgHome, surface: "app-registry" });
    expect(plan.preflight.identity.github_slug).toBeNull();

    const gh = makePublicationGhDouble();
    const { plan: executed } = await publish(home, { gh });
    expect(gh.createdCount()).toBe(0);
    expect(executed.durability).toBe("pending_merge");
    expect(git(home.orgHome, ["ls-remote", "--heads", "origin", BRANCH])).not.toBe("");
  });

  it("refuses while a merge is in progress or HEAD is detached", async () => {
    const home = await registeredOrgHome();
    const detachedAt = git(home.orgHome, ["rev-parse", "HEAD"]);
    git(home.orgHome, ["checkout", "--quiet", "--detach", detachedAt]);
    const detached = await planOrgHomePublication({ orgHome: home.orgHome, surface: "app-registry" });
    expect(detached.preflight.blockers.join("\n")).toContain("detached HEAD");

    git(home.orgHome, ["checkout", "--quiet", home.defaultBranch]);
    await writeFile(join(home.orgHome, ".git", "MERGE_HEAD"), `${detachedAt}\n`, "utf8");
    const merging = await planOrgHomePublication({ orgHome: home.orgHome, surface: "app-registry" });
    expect(merging.preflight.blockers.join("\n")).toContain("operation in progress");
  });
});
