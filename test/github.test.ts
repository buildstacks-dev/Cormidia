// Tests the GitHub CLI adapter in src/loop/github.ts using an injected gh exec.
// Covers labels, PR creation/listing/merge parsing, comments/reviews, branch
// deletion, same-account approval fallback signing, and error propagation.
// The gh calls are all mocked in memory; no network, auth, real GitHub state,
// filesystem fixture, or wall-clock time is required.

import { describe, expect, it } from "vitest";
import {
  GhCliOps,
  GhOpsError,
  SELF_APPROVAL_FALLBACK_MARKER,
  SELF_CHANGES_REQUESTED_FALLBACK_MARKER,
  verifiedSelfApprovalMarker,
  type GhExec,
  type GhExecResult,
} from "../src/loop/github.js";

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
  closingIssuesReferences: [{ number: 1, url: "https://github.invalid/o/r/issues/1" }],
});

describe("GhCliOps", () => {
  it("creates labels idempotently with the locally documented --force surface", async () => {
    const { exec, calls } = execFrom(() => ({ stdout: "", stderr: "", exitCode: 0 }));
    const gh = new GhCliOps("o/r", exec);

    await gh.ensureLabel({
      name: "op:ready",
      color: "0e8a16",
      description: "Ready for the build loop to claim",
    });

    expect(calls).toEqual([{
      args: [
        "label",
        "create",
        "op:ready",
        "--repo",
        "o/r",
        "--color",
        "0e8a16",
        "--description",
        "Ready for the build loop to claim",
        "--force",
      ],
    }]);
  });

  it("lists and parses exact repository label definitions through one bounded read", async () => {
    const { exec, calls } = execFrom(() => ({
      stdout: JSON.stringify([
        { name: "op:ready", color: "0E8A16", description: "Ready for the build loop to claim" },
        { name: "stock", color: "ededed", description: null },
      ]),
      stderr: "",
      exitCode: 0,
    }));
    const gh = new GhCliOps("o/r", exec);

    await expect(gh.listLabels()).resolves.toEqual([
      { name: "op:ready", color: "0E8A16", description: "Ready for the build loop to claim" },
      { name: "stock", color: "ededed", description: "" },
    ]);
    expect(calls).toEqual([{
      args: [
        "label",
        "list",
        "--repo",
        "o/r",
        "--limit",
        "100",
        "--json",
        "name,color,description",
      ],
    }]);
  });

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
    expect(pr.closingIssueNumbers).toEqual([1]);
    expect(calls[0]?.args).toContain("--body-file");
    expect(calls[1]?.args).toEqual([
      "pr",
      "view",
      "https://github.invalid/o/r/pull/7",
      "--repo",
      "o/r",
      "--json",
      "number,title,body,url,state,headRefName,headRefOid,baseRefName,isDraft,mergeCommit,closingIssuesReferences",
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

  it("falls back to a marked comment review when GitHub rejects same-account approval", async () => {
    const { exec, calls } = execFrom((args) => {
      if (args[0] === "pr" && args[1] === "review" && args.includes("--approve")) {
        return {
          stdout: "",
          stderr: "failed to create review: GraphQL: Review Can not approve your own pull request",
          exitCode: 1,
        };
      }
      if (args[0] === "pr" && args[1] === "review" && args.includes("--comment")) {
        return { stdout: "", stderr: "", exitCode: 0 };
      }
      throw new Error(`unexpected ${args.join(" ")}`);
    });
    const gh = new GhCliOps("o/r", exec);

    const review = await gh.createReview(7, { state: "approve", body: "Verdict: approve" });

    expect(review.state).toBe("COMMENTED");
    expect(review.body).toContain(SELF_APPROVAL_FALLBACK_MARKER);
    expect(calls[0]?.args).toContain("--approve");
    expect(calls[1]?.args).toContain("--comment");
    expect(calls[1]?.input).toContain("Verdict: approve");
    // No operator secret configured: the marker is bare and NOT verifiable —
    // the loop must fail closed on it rather than treating it as an approval
    // (regardless of which reviewed commit it is checked against).
    expect(verifiedSelfApprovalMarker(review.body, undefined, 7, "abc123")).toBe(false);
    expect(verifiedSelfApprovalMarker(review.body, "any-secret", 7, "abc123")).toBe(false);
  });

  it("falls back to a comment review when GitHub rejects same-account changes requests", async () => {
    const { exec, calls } = execFrom((args) => {
      if (args[0] === "pr" && args[1] === "review" && args.includes("--request-changes")) {
        return {
          stdout: "",
          stderr: "failed to create review: GraphQL: Review Can not request changes on your own pull request",
          exitCode: 1,
        };
      }
      if (args[0] === "pr" && args[1] === "review" && args.includes("--comment")) {
        return { stdout: "", stderr: "", exitCode: 0 };
      }
      throw new Error(`unexpected ${args.join(" ")}`);
    });
    const gh = new GhCliOps("o/r", exec);

    const review = await gh.createReview(7, { state: "request_changes", body: "Verdict: findings" });

    expect(review).toMatchObject({ state: "COMMENTED" });
    expect(review.body).toContain(SELF_CHANGES_REQUESTED_FALLBACK_MARKER);
    expect(calls[0]?.args).toContain("--request-changes");
    expect(calls[1]?.args).toContain("--comment");
  });

  it("signs the self-approval marker with the operator secret and the reviewed commit so it cannot be forged or replayed", async () => {
    const { exec } = execFrom((args) => {
      if (args[0] === "pr" && args[1] === "review" && args.includes("--approve")) {
        return {
          stdout: "",
          stderr: "failed to create review: GraphQL: Review Can not approve your own pull request",
          exitCode: 1,
        };
      }
      // The adapter resolves the PR head so the marker binds the reviewed
      // commit (headRefOid "abc123" per prJson).
      if (args[0] === "pr" && args[1] === "view") {
        return { stdout: prJson, stderr: "", exitCode: 0 };
      }
      if (args[0] === "pr" && args[1] === "review" && args.includes("--comment")) {
        return { stdout: "", stderr: "", exitCode: 0 };
      }
      throw new Error(`unexpected ${args.join(" ")}`);
    });
    const gh = new GhCliOps("o/r", exec, "operator-only-secret");

    const review = await gh.createReview(7, { state: "approve", body: "Verdict: approve" });

    // The signed marker verifies only for the exact (secret, prNumber, commit)
    // triple.
    expect(verifiedSelfApprovalMarker(review.body, "operator-only-secret", 7, "abc123")).toBe(true);
    expect(verifiedSelfApprovalMarker(review.body, "operator-only-secret", 8, "abc123")).toBe(false);
    expect(verifiedSelfApprovalMarker(review.body, "attacker-guess", 7, "abc123")).toBe(false);
    // A-001: the marker copied onto a review of a DIFFERENT commit is rejected —
    // this is what makes a replayed marker worthless once the branch advances.
    expect(verifiedSelfApprovalMarker(review.body, "operator-only-secret", 7, "def456")).toBe(false);
    // An unresolved reviewed commit fails closed.
    expect(verifiedSelfApprovalMarker(review.body, "operator-only-secret", 7, undefined)).toBe(false);
    // A forger who copies just the public static marker cannot pass.
    expect(
      verifiedSelfApprovalMarker(SELF_APPROVAL_FALLBACK_MARKER, "operator-only-secret", 7, "abc123"),
    ).toBe(false);
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
