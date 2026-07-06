import { describe, expect, it } from "vitest";
import { GhCliOps, GhOpsError, type GhExec, type GhExecResult } from "../src/loop/github.js";

function execFrom(
  handler: (args: readonly string[], input?: string) => GhExecResult,
): { exec: GhExec; calls: { args: readonly string[]; input?: string }[] } {
  const calls: { args: readonly string[]; input?: string }[] = [];
  return {
    calls,
    exec: async (args, input) => {
      calls.push(input === undefined ? { args } : { args, input });
      return handler(args, input);
    },
  };
}

const prJson = JSON.stringify({
  number: 7,
  title: "build: demo (#1)",
  body: "Closes #1",
  state: "OPEN",
  headRefName: "op/1-demo",
  headRefOid: "abc123",
  baseRefName: "main",
  isDraft: false,
  url: "https://github.invalid/o/r/pull/7",
});

describe("GhCliOps", () => {
  it("swapLabel is one gh issue edit call with add+remove flags", async () => {
    const { exec, calls } = execFrom(() => ({ stdout: "", stderr: "", exitCode: 0 }));
    const gh = new GhCliOps("o/r", exec);

    await gh.swapLabel(12, "op:ready", "op:building");

    expect(calls).toEqual([
      {
        args: [
          "issue",
          "edit",
          "12",
          "--repo",
          "o/r",
          "--add-label",
          "op:building",
          "--remove-label",
          "op:ready",
        ],
      },
    ]);
  });

  it("createPR reads the created PR back through --json output", async () => {
    const { exec, calls } = execFrom((args) => {
      if (args[0] === "pr" && args[1] === "create") {
        return { stdout: "https://github.invalid/o/r/pull/7\n", stderr: "", exitCode: 0 };
      }
      if (args[0] === "pr" && args[1] === "view") {
        return { stdout: prJson, stderr: "", exitCode: 0 };
      }
      throw new Error(`unexpected ${args.join(" ")}`);
    });
    const gh = new GhCliOps("o/r", exec);

    const pr = await gh.createPR({
      head: "op/1-demo",
      base: "main",
      title: "build: demo (#1)",
      body: "Closes #1",
    });

    expect(pr.number).toBe(7);
    expect(pr.headRefOid).toBe("abc123");
    expect(calls[0]?.args).toContain("--body-file");
    expect(calls[1]?.args).toEqual([
      "pr",
      "view",
      "https://github.invalid/o/r/pull/7",
      "--repo",
      "o/r",
      "--json",
      "number,title,body,url,state,headRefName,headRefOid,baseRefName,isDraft,mergeCommit",
    ]);
  });

  it("listPRsForBranch and squashMerge parse --json PR output", async () => {
    const { exec, calls } = execFrom((args) => {
      if (args[0] === "pr" && args[1] === "list") {
        return { stdout: `[${prJson}]`, stderr: "", exitCode: 0 };
      }
      if (args[0] === "pr" && args[1] === "merge") {
        return { stdout: "", stderr: "", exitCode: 0 };
      }
      if (args[0] === "pr" && args[1] === "view") {
        return {
          stdout: JSON.stringify({ ...JSON.parse(prJson), state: "MERGED" }),
          stderr: "",
          exitCode: 0,
        };
      }
      throw new Error(`unexpected ${args.join(" ")}`);
    });
    const gh = new GhCliOps("o/r", exec);

    expect(await gh.listPRsForBranch("op/1-demo")).toHaveLength(1);
    const merged = await gh.squashMerge(7, { subject: "demo (#1)", matchHeadCommit: "abc123" });

    expect(merged.state).toBe("MERGED");
    expect(calls[0]?.args).toContain("--json");
    expect(calls[1]?.args).toContain("--squash");
    expect(calls[2]?.args).toContain("--json");
  });

  it("comments, reviews, and branch deletion use non-interactive gh commands", async () => {
    const { exec, calls } = execFrom((args) => {
      if (args[0] === "issue" && args[1] === "comment") {
        return { stdout: "", stderr: "", exitCode: 0 };
      }
      if (args[0] === "pr" && args[1] === "review") {
        return { stdout: "", stderr: "", exitCode: 0 };
      }
      if (args[0] === "pr" && args[1] === "view") {
        return {
          stdout: JSON.stringify({
            reviews: [
              {
                state: "APPROVED",
                body: "Verdict: approve",
                commit: { oid: "abc123" },
                author: { login: "reviewer" },
              },
            ],
          }),
          stderr: "",
          exitCode: 0,
        };
      }
      if (args[0] === "api") {
        return { stdout: "", stderr: "", exitCode: 0 };
      }
      throw new Error(`unexpected ${args.join(" ")}`);
    });
    const gh = new GhCliOps("o/r", exec);

    await gh.commentIssue(1, "hello");
    await gh.createReview(7, { state: "approve", body: "Verdict: approve" });
    const reviews = await gh.listReviews(7);
    await gh.deleteBranch("op/1-demo");

    expect(reviews).toEqual([
      { state: "APPROVED", body: "Verdict: approve", commitId: "abc123", author: "reviewer" },
    ]);
    expect(calls[0]).toEqual({
      args: ["issue", "comment", "1", "--repo", "o/r", "--body-file", "-"],
      input: "hello",
    });
    expect(calls[1]).toEqual({
      args: ["pr", "review", "7", "--repo", "o/r", "--approve", "--body-file", "-"],
      input: "Verdict: approve",
    });
    expect(calls[3]?.args).toEqual([
      "api",
      "-X",
      "DELETE",
      "repos/o/r/git/refs/heads/op/1-demo",
    ]);
  });

  it("non-zero exits throw GhOpsError carrying stderr verbatim", async () => {
    const { exec } = execFrom(() => ({
      stdout: "out",
      stderr: "fatal: bad credentials\nsecond line",
      exitCode: 4,
    }));
    const gh = new GhCliOps("o/r", exec);

    await expect(gh.addLabel(1, "op:ready")).rejects.toMatchObject({
      name: "GhOpsError",
      stderr: "fatal: bad credentials\nsecond line",
      exitCode: 4,
    } satisfies Partial<GhOpsError>);
  });
});
