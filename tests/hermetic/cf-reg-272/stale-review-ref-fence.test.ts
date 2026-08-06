// CF-REG-272 — GitHub's PR projection can lag a just-pushed branch ref. The
// review write fence must compare expectedCommit to the authoritative ref,
// not accept a stale `pr view` result and publish against the old commit.

import { afterEach, describe, expect, it } from "vitest";
import { GhCliOps } from "../../../src/loop/github.js";
import { installGithubDouble, type GithubDoubleHandle } from "../../fixtures/github-double/install.js";

describe("CF-REG-272 — review publication uses the authoritative branch ref", () => {
  let handle: GithubDoubleHandle | undefined;
  let restorePath: (() => void) | undefined;

  afterEach(async () => {
    restorePath?.();
    await handle?.dispose();
    restorePath = undefined;
    handle = undefined;
  });

  async function scenario(): Promise<{
    gh: GhCliOps;
    prNumber: number;
    oldHead: string;
    newHead: string;
  }> {
    handle = await installGithubDouble();
    restorePath = handle.activatePath();
    const gh = new GhCliOps(handle.repo);
    const branch = "op/272-stale-review";
    const oldHead = handle.seedBranch(branch);
    const pr = await gh.createPR({ head: branch, base: "main", title: "stale fence", body: "fixture" });
    const newHead = handle.advanceBranch(branch);
    expect(newHead).not.toBe(oldHead);
    return { gh, prNumber: pr.number, oldHead, newHead };
  }

  it("refuses before writing even when pr view serves the stale expected oid", async () => {
    const { gh, prNumber, oldHead } = await scenario();
    handle!.script({ op: "pr.view", stale: true });

    await expect(
      gh.createReview(prNumber, {
        state: "comment",
        body: "must not publish",
        expectedCommit: oldHead,
      }),
    ).rejects.toThrow(/refusing to publish review/);

    handle!.assertScenarioDrained();
    expect(handle!.readState().prs[String(prNumber)]?.reviews).toEqual([]);
  });

  it("negative control: a seeded projection-only fence publishes the stale review", async () => {
    const { gh, prNumber, oldHead } = await scenario();
    handle!.script({ op: "pr.view", stale: true });

    // Seed the removed behavior explicitly: trust only the lagging PR
    // projection, then write without consulting the branch-ref endpoint.
    expect((await gh.readPR(prNumber)).headRefOid).toBe(oldHead);
    const result = await handle!.exec(
      ["pr", "review", String(prNumber), "--repo", handle!.repo, "--comment", "--body-file", "-"],
      "seeded stale publication",
    );
    expect(result.exitCode).toBe(0);
    expect(handle!.readState().prs[String(prNumber)]?.reviews).toHaveLength(1);
    handle!.assertScenarioDrained();
  });
});
