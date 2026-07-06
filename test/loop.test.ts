import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  advanceGates,
  advanceReviewing,
  advanceShipping,
  claimTicket,
  type LoopItem,
} from "../src/loop/loop.js";
import { SELF_APPROVAL_FALLBACK_MARKER } from "../src/loop/github.js";
import type { Policy } from "../src/loop/policy.js";
import type { AcceptanceCriterion, CriterionTestMap, GateRunResult } from "../src/loop/qgates.js";
import { makeBareWithClone } from "./fixtures/gitRepo.js";
import { FakeGhOps } from "./support/fakeGhOps.js";

const body = [
  "## Goal",
  "Ship a small fixture change.",
  "",
  "## Acceptance criteria",
  "- [x] fixture gates pass",
  "",
].join("\n");

const criteria: AcceptanceCriterion[] = [
  { id: "AC1", text: "fixture gates pass", checked: true },
];
const criterionTests: CriterionTestMap = { AC1: ["fixture-gate"] };

function policy(maxAttempts = 3): Policy {
  return {
    riskTiers: { high: [], medium: [], low: [] },
    gates: {
      high: ["tests", "completeness"],
      medium: ["tests", "completeness"],
      low: ["tests", "completeness"],
    },
    dimensionGlobs: {},
    remediation: { maxAttempts },
  };
}

describe("claimTicket", () => {
  it("swaps the ready label and creates the ticket branch/worktree", async () => {
    const pair = makeBareWithClone();
    try {
      const gh = new FakeGhOps({
        cloneRoot: pair.clone.root,
        issues: [{ number: 1, title: "Add Demo Helper", body, labels: ["op:ready", "op:tier-quick"] }],
      });

      const item = await claimTicket(await gh.readIssue(1), {
        gh,
        targetRepo: "fixture/repo",
        localRepo: pair.clone.root,
        worktreeRoot: join(pair.root, "worktrees"),
      });

      expect(item.phase).toBe("building");
      expect(item.tier).toBe("quick");
      expect(item.branch).toBe("op/1-add-demo-helper");
      expect(existsSync(item.worktree as string)).toBe(true);
      expect(pair.clone.git("branch", "--list", item.branch as string)).toContain(item.branch);
      expect(gh.calls[1]).toMatchObject({
        op: "swapLabel",
        detail: { removeLabel: "op:ready", addLabel: "op:building" },
      });
    } finally {
      pair.cleanup();
    }
  });

  it("rejects a concurrent second claim through the label precondition", async () => {
    const pair = makeBareWithClone();
    try {
      const gh = new FakeGhOps({
        cloneRoot: pair.clone.root,
        issues: [{ number: 1, title: "Add Demo Helper", body, labels: ["op:ready"] }],
      });
      const issue = await gh.readIssue(1);
      await claimTicket(issue, {
        gh,
        targetRepo: "fixture/repo",
        localRepo: pair.clone.root,
        worktreeRoot: join(pair.root, "worktrees"),
      });

      await expect(
        claimTicket(issue, {
          gh,
          targetRepo: "fixture/repo",
          localRepo: pair.clone.root,
          worktreeRoot: join(pair.root, "worktrees-2"),
        }),
      ).rejects.toMatchObject({ stderr: "issue #1 does not have label op:ready" });
    } finally {
      pair.cleanup();
    }
  });
});

describe("advanceGates", () => {
  it("fail-fail-pass reaches reviewing with two remediation attempts", async () => {
    const pair = makeBareWithClone();
    try {
      const gh = new FakeGhOps({
        cloneRoot: pair.clone.root,
        issues: [{ number: 1, title: "Gate Retry", body, labels: ["op:ready"] }],
      });
      let item = await claimTicket(await gh.readIssue(1), {
        gh,
        targetRepo: "fixture/repo",
        localRepo: pair.clone.root,
        worktreeRoot: join(pair.root, "worktrees"),
      });
      commit(item.worktree as string, "feat: start change", { "src/change.ts": "export const x = 1;\n" });

      let remediations = 0;
      item = await advanceGates(item, {
        gh,
        policy: policy(3),
        commands: { testCommand: "test -f pass.txt" },
        criteria,
        criterionTests,
        remediate: (current) => {
          remediations++;
          const files =
            remediations === 2
              ? { "pass.txt": "ok\n" }
              : { [`attempt-${remediations}.txt`]: "still failing\n" };
          commit(current.worktree as string, `fix: remediation ${remediations}`, files);
        },
      });

      expect(item.phase).toBe("reviewing");
      expect(item.remediationAttempts).toBe(2);
      expect(item.prNumber).toBe(1);
      expect(remediations).toBe(2);
    } finally {
      pair.cleanup();
    }
  });

  it("exhaustion returns the ticket with blocked-with-evidence comment", async () => {
    const pair = makeBareWithClone();
    try {
      const gh = new FakeGhOps({
        cloneRoot: pair.clone.root,
        issues: [{ number: 1, title: "Gate Exhaustion", body, labels: ["op:ready"] }],
      });
      const claimed = await claimTicket(await gh.readIssue(1), {
        gh,
        targetRepo: "fixture/repo",
        localRepo: pair.clone.root,
        worktreeRoot: join(pair.root, "worktrees"),
      });
      commit(claimed.worktree as string, "feat: start change", { "src/change.ts": "x\n" });

      const returned = await advanceGates(claimed, {
        gh,
        policy: policy(1),
        commands: { testCommand: "test -f never.txt" },
        criteria,
        criterionTests,
        remediate: (current) => {
          commit(current.worktree as string, "fix: failed remediation", { "attempt.txt": "nope\n" });
        },
      });

      expect(returned.phase).toBe("returned");
      expect(gh.issueComments.get(1)?.[0]).toContain("## Blocked with evidence");
      expect(gh.issueComments.get(1)?.[0]).toContain("tests failed");
      expect((await gh.readIssue(1)).labels).toContain("op:returned");
    } finally {
      pair.cleanup();
    }
  });

  it("green gates push, create a PR with Closes, then move op:in-review", async () => {
    const pair = makeBareWithClone();
    try {
      const gh = new FakeGhOps({
        cloneRoot: pair.clone.root,
        issues: [{ number: 1, title: "Green Gate", body, labels: ["op:ready"] }],
      });
      const claimed = await claimTicket(await gh.readIssue(1), {
        gh,
        targetRepo: "fixture/repo",
        localRepo: pair.clone.root,
        worktreeRoot: join(pair.root, "worktrees"),
      });
      commit(claimed.worktree as string, "feat: green", {
        "src/change.ts": "x\n",
        "pass.txt": "ok\n",
      });

      const reviewing = await advanceGates(claimed, {
        gh,
        policy: policy(),
        commands: { testCommand: "test -f pass.txt" },
        criteria,
        criterionTests,
      });

      expect(reviewing.phase).toBe("reviewing");
      const pr = await gh.readPR(reviewing.prNumber as number);
      expect(pr.body).toContain("Closes #1");
      const ops = gh.calls.map((call) => call.op);
      expect(ops.indexOf("createPR")).toBeLessThan(ops.lastIndexOf("swapLabel"));
    } finally {
      pair.cleanup();
    }
  });
});

describe("advanceReviewing", () => {
  it("parses REQUEST_CHANGES findings and routes back to building", async () => {
    const h = await reviewHarness();
    try {
      await h.gh.createReview(h.item.prNumber as number, {
        state: "request_changes",
        body: "- testing/major test/a.test.ts:1 -- missing regression -> add one\nVerdict: findings",
      });

      const next = await advanceReviewing(h.item, { gh: h.gh });

      expect(next.phase).toBe("building");
      expect(next.cycles).toBe(1);
      expect(next.findings[0]).toMatchObject({ category: "testing", severity: "major" });
    } finally {
      h.cleanup();
    }
  });

  it("cycle 4 returns the ticket with findings preserved", async () => {
    const h = await reviewHarness();
    try {
      await h.gh.createReview(h.item.prNumber as number, {
        state: "request_changes",
        body: "- scope/minor src/a.ts:1 -- stray file -> remove it\nVerdict: findings",
      });

      const next = await advanceReviewing({ ...h.item, cycles: 3 }, { gh: h.gh });

      expect(next.phase).toBe("returned");
      expect(ghComment(h.gh, 1)).toContain("Review cycles exceeded");
      expect(ghComment(h.gh, 1)).toContain("scope/minor");
    } finally {
      h.cleanup();
    }
  });

  it("stale APPROVE keeps the item reviewing", async () => {
    const h = await reviewHarness();
    try {
      await h.gh.createReview(h.item.prNumber as number, { state: "approve", body: "Verdict: approve" });
      commit(h.item.worktree as string, "feat: move head", { "src/later.ts": "x\n" });

      const next = await advanceReviewing(h.item, { gh: h.gh });

      expect(next.phase).toBe("reviewing");
    } finally {
      h.cleanup();
    }
  });

  it("fresh APPROVE advances to shipping", async () => {
    const h = await reviewHarness();
    try {
      await h.gh.createReview(h.item.prNumber as number, { state: "approve", body: "Verdict: approve" });

      const next = await advanceReviewing(h.item, { gh: h.gh });

      expect(next.phase).toBe("shipping");
      expect(next.approvedCommitId).toBe(head(h.item.worktree as string));
    } finally {
      h.cleanup();
    }
  });

  it("marked same-account comment review advances to shipping when fresh", async () => {
    const h = await reviewHarness();
    try {
      await h.gh.createReview(h.item.prNumber as number, {
        state: "comment",
        body: `Verdict: approve\n\n${SELF_APPROVAL_FALLBACK_MARKER}`,
      });

      const next = await advanceReviewing(h.item, { gh: h.gh });

      expect(next.phase).toBe("shipping");
      expect(next.approvedCommitId).toBe(head(h.item.worktree as string));
    } finally {
      h.cleanup();
    }
  });
});

describe("advanceShipping", () => {
  it("runs gates twice, squash-merges, deletes branch/worktree, and returns scorecard data", async () => {
    const h = await shippingHarness("Ship Green");
    try {
      let count = 0;
      const merged = await advanceShipping(
        { ...h.item, turnId: "turn-1" },
        {
          gh: h.gh,
          localRepo: h.pair.clone.root,
          policy: policy(),
          commands: { testCommand: "true" },
          criteria,
          criterionTests,
          gateRunner: async () => {
            count++;
            return gatePass();
          },
        },
      );

      expect(count).toBe(2);
      expect(merged.phase).toBe("merged");
      expect(h.pair.bare.log("main")[0]).toBe("Ship Green (#1)");
      expect(h.pair.bare.git("branch", "--list", h.item.branch as string)).toBe("");
      expect(existsSync(h.item.worktree as string)).toBe(false);
      expect(merged.scorecardEvents).toEqual([
        { type: "review_cycles", turnId: "turn-1", ticketRef: "#1", value: 0 },
      ]);
    } finally {
      h.cleanup();
    }
  });

  it("merge conflict aborts and returns to building with a rebase note", async () => {
    const pair = makeBareWithClone();
    try {
      const gh = new FakeGhOps({
        cloneRoot: pair.clone.root,
        issues: [
          { number: 1, title: "First", body, labels: ["op:ready"] },
          { number: 2, title: "Second", body, labels: ["op:ready"] },
        ],
      });
      const first = await claimTicket(await gh.readIssue(1), {
        gh,
        targetRepo: "fixture/repo",
        localRepo: pair.clone.root,
        worktreeRoot: join(pair.root, "worktrees"),
      });
      const second = await claimTicket(await gh.readIssue(2), {
        gh,
        targetRepo: "fixture/repo",
        localRepo: pair.clone.root,
        worktreeRoot: join(pair.root, "worktrees"),
      });

      commit(first.worktree as string, "feat: first", { "README.md": "first\n" });
      git(first.worktree as string, "push", "-u", "origin", first.branch as string);
      const firstPr = await gh.createPR({ head: first.branch as string, base: "main", title: "first", body: "Closes #1" });
      await gh.squashMerge(firstPr.number, { subject: "first (#1)" });

      commit(second.worktree as string, "feat: second", { "README.md": "second\n" });
      git(second.worktree as string, "push", "-u", "origin", second.branch as string);
      const secondPr = await gh.createPR({
        head: second.branch as string,
        base: "main",
        title: "second",
        body: "Closes #2",
      });

      const conflicted = await advanceShipping(
        {
          ...second,
          phase: "shipping",
          prNumber: secondPr.number,
          approvedCommitId: head(second.worktree as string),
        },
        {
          gh,
          localRepo: pair.clone.root,
          policy: policy(),
          commands: { testCommand: "true" },
          criteria,
          criterionTests,
          gateRunner: async () => gatePass(),
        },
      );

      expect(conflicted.phase).toBe("building");
      expect(conflicted.rebaseNote).toContain("Rebase this branch on main");
      expect(existsSync(second.worktree as string)).toBe(true);
    } finally {
      pair.cleanup();
    }
  });
});

async function reviewHarness(): Promise<{ gh: FakeGhOps; item: LoopItem; cleanup(): void }> {
  const pair = makeBareWithClone();
  const gh = new FakeGhOps({
    cloneRoot: pair.clone.root,
    issues: [{ number: 1, title: "Review Me", body, labels: ["op:ready"] }],
  });
  let item = await claimTicket(await gh.readIssue(1), {
    gh,
    targetRepo: "fixture/repo",
    localRepo: pair.clone.root,
    worktreeRoot: join(pair.root, "worktrees"),
  });
  commit(item.worktree as string, "feat: review me", { "src/review.ts": "x\n" });
  const pr = await gh.createPR({
    head: item.branch as string,
    base: "main",
    title: "review",
    body: "Closes #1",
  });
  await gh.swapLabel(1, "op:building", "op:in-review");
  item = { ...item, phase: "reviewing", prNumber: pr.number, labels: ["op:in-review"] };
  return { gh, item, cleanup: () => pair.cleanup() };
}

async function shippingHarness(title: string): Promise<{
  gh: FakeGhOps;
  item: LoopItem;
  pair: ReturnType<typeof makeBareWithClone>;
  cleanup(): void;
}> {
  const pair = makeBareWithClone();
  const gh = new FakeGhOps({
    cloneRoot: pair.clone.root,
    issues: [{ number: 1, title, body, labels: ["op:ready"] }],
  });
  let item = await claimTicket(await gh.readIssue(1), {
    gh,
    targetRepo: "fixture/repo",
    localRepo: pair.clone.root,
    worktreeRoot: join(pair.root, "worktrees"),
  });
  commit(item.worktree as string, "feat: shipping", { "src/ship.ts": "x\n" });
  git(item.worktree as string, "push", "-u", "origin", item.branch as string);
  const pr = await gh.createPR({ head: item.branch as string, base: "main", title, body: "Closes #1" });
  item = {
    ...item,
    phase: "shipping",
    prNumber: pr.number,
    approvedCommitId: head(item.worktree as string),
    labels: ["op:in-review"],
  };
  return { gh, item, pair, cleanup: () => pair.cleanup() };
}

function gatePass(): GateRunResult {
  return {
    tier: "medium",
    status: "pass",
    results: [],
    remediation: {
      currentAttempt: 0,
      maxAttempts: 3,
      attemptsRemaining: 3,
      canRetry: false,
      exhausted: false,
    },
  };
}

function ghComment(gh: FakeGhOps, issue: number): string {
  return gh.issueComments.get(issue)?.join("\n") ?? "";
}

function commit(worktree: string, message: string, files: Record<string, string>): string {
  for (const [rel, content] of Object.entries(files)) {
    const path = join(worktree, rel);
    execFileSync("mkdir", ["-p", join(path, "..")]);
    writeFileSync(path, content);
  }
  git(worktree, "add", "-A");
  git(worktree, "commit", "-m", message);
  return head(worktree);
}

function head(worktree: string): string {
  return git(worktree, "rev-parse", "HEAD");
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Operon Test",
      GIT_AUTHOR_EMAIL: "test@operon.invalid",
      GIT_COMMITTER_NAME: "Operon Test",
      GIT_COMMITTER_EMAIL: "test@operon.invalid",
      GIT_TERMINAL_PROMPT: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}
