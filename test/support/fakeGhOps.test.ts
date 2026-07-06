import { describe, expect, it } from "vitest";
import { makeBareWithClone } from "../fixtures/gitRepo.js";
import { FakeGhOps } from "./fakeGhOps.js";

describe("FakeGhOps", () => {
  it("label swap fails when the precondition label is absent", async () => {
    const gh = new FakeGhOps({
      issues: [{ number: 1, title: "demo", labels: ["p3"] }],
    });

    await expect(gh.swapLabel(1, "op:ready", "op:building")).rejects.toMatchObject({
      stderr: "issue #1 does not have label op:ready",
    });
    expect((await gh.readIssue(1)).labels).toEqual(["p3"]);
  });

  it("listPRsForBranch reflects created PRs", async () => {
    const gh = new FakeGhOps();
    await gh.createPR({
      head: "op/1-demo",
      base: "main",
      title: "build: demo (#1)",
      body: "Closes #1",
    });

    expect((await gh.listPRsForBranch("op/1-demo"))[0]).toMatchObject({
      number: 1,
      headRefName: "op/1-demo",
    });
    expect(await gh.listPRsForBranch("op/2-other")).toEqual([]);
  });

  it("squashMerge performs a real merge into fixture main", async () => {
    const pair = makeBareWithClone();
    try {
      const gh = new FakeGhOps({
        cloneRoot: pair.clone.root,
        issues: [{ number: 1, title: "demo", labels: ["op:building"] }],
      });
      pair.clone.git("checkout", "-b", "op/1-demo");
      pair.clone.commit("feat: demo change", { "src/demo.ts": "export const demo = true;\n" });
      pair.clone.git("push", "-u", "origin", "op/1-demo");
      const pr = await gh.createPR({
        head: "op/1-demo",
        base: "main",
        title: "build: demo (#1)",
        body: "Closes #1",
      });

      await gh.squashMerge(pr.number, { subject: "feat: demo change (#1)" });

      expect(pair.bare.log("main")).toEqual([
        "feat: demo change (#1)",
        "chore: init origin main",
      ]);
      expect((await gh.readIssue(1)).state).toBe("CLOSED");
    } finally {
      pair.cleanup();
    }
  });

  it("deleteBranch removes the remote ref", async () => {
    const pair = makeBareWithClone();
    try {
      const gh = new FakeGhOps({ cloneRoot: pair.clone.root });
      pair.clone.git("checkout", "-b", "op/2-doomed");
      pair.clone.commit("feat: doomed", { "doomed.txt": "x\n" });
      pair.clone.git("push", "-u", "origin", "op/2-doomed");

      await gh.deleteBranch("op/2-doomed");

      expect(pair.bare.git("branch", "--list", "op/2-doomed")).toBe("");
    } finally {
      pair.cleanup();
    }
  });
});
