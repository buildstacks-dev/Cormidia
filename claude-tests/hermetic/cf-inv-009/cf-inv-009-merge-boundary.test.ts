// CF-INV-009 — merge authority binds the resolved base, exact reviewed HEAD,
// content-bound HMAC, and orchestrator identity (L2, E3; HB-030).

import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { devNull, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ApprovalStore } from "../../../src/org/approvals.js";
import { composeGate } from "../../../src/org/gate-compose.js";
import { baseRevisionForBranch, resolveRemoteDefaultBranch } from "../../../src/loop/default-branch.js";
import { GhCliOps, selfApprovalMarker, verifiedSelfApprovalMarker } from "../../../src/loop/github.js";
import {
  advanceGates,
  advanceReviewing,
  advanceShipping,
  branchNameForIssue,
  claimTicket,
  parseAcceptanceCriteria,
  type LoopItem,
} from "../../../src/loop/loop.js";
import { DEFAULT_LOOP_POLICY } from "../../../src/loop/driver.js";
import { defaultGate } from "../../../src/runtime/gate.js";
import { makeTempGitRepo, type TempGitRepo } from "../../fixtures/git-repo.js";
import { installGithubDouble, type GithubDoubleHandle } from "../../fixtures/github-double/install.js";

const DEFAULT_BRANCH = "trunk";
const BODY = "## Acceptance criteria\n- [ ] merge boundary remains content-bound\n";
const LABELS = [
  { name: "op:ready", color: "1d76db", description: "ready" },
  { name: "op:building", color: "fbca04", description: "building" },
  { name: "op:in-review", color: "0e8a16", description: "review" },
  { name: "op:returned", color: "b60205", description: "returned" },
];
const GIT_ENV = {
  ...process.env,
  GIT_TERMINAL_PROMPT: "0",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: devNull,
};

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    env: GIT_ENV,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

interface MergeWorld {
  repo: TempGitRepo;
  github: GithubDoubleHandle;
  gh: GhCliOps;
  root: string;
  item: LoopItem;
  base: ReturnType<typeof baseRevisionForBranch>;
  head: string;
}

describe("CF-INV-009 — merge boundary refuses stale, guessed, forged, and agent-owned authority", () => {
  const cleanups: Array<() => Promise<void> | void> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  async function makeBuiltWorld(): Promise<MergeWorld> {
    const repo = await makeTempGitRepo({ defaultBranch: DEFAULT_BRANCH });
    cleanups.push(() => repo.cleanup());
    await repo.addFileRemote();
    const github = await installGithubDouble({ defaultBranch: DEFAULT_BRANCH, labels: LABELS });
    cleanups.push(() => github.dispose());
    const gh = new GhCliOps(github.repo, github.exec);
    const issue = await gh.createIssue({ title: "Merge boundary", body: BODY, labels: ["op:ready"] });
    const root = await mkdtemp(join(tmpdir(), "operon-cf-inv-009-"));
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    const base = baseRevisionForBranch(resolveRemoteDefaultBranch("origin", { cwd: repo.dir }));
    const item = await claimTicket(issue, {
      gh,
      targetRepo: github.repo,
      localRepo: repo.dir,
      worktreeRoot: root,
      base,
    });
    await writeFile(join(item.worktree!, "merge-boundary.txt"), "reviewed bytes\n");
    git(item.worktree!, "add", "--", "merge-boundary.txt");
    git(item.worktree!, "commit", "--no-gpg-sign", "-m", "test: reviewed merge bytes");
    const head = git(item.worktree!, "rev-parse", "HEAD");
    github.setBranchHead(branchNameForIssue(issue), head);
    const contract = JSON.stringify({
      files: ["merge-boundary.txt"],
      approach: "bind review and merge to the exact candidate",
      tests: [{ criterionId: "AC1", tests: ["cf-inv-009-merge-boundary.test.ts"] }],
      risks: "stale review authority",
      complexity: "low",
    });
    return { repo, github, gh, root, item: { ...item, contract }, base, head };
  }

  async function toReview(world: MergeWorld): Promise<LoopItem> {
    const reviewing = await advanceGates(world.item, {
      gh: world.gh,
      policy: DEFAULT_LOOP_POLICY,
      commands: { testCommand: "true", lintCommand: "true" },
      base: world.base,
      criteria: parseAcceptanceCriteria(world.item.body),
      criterionTests: { AC1: ["cf-inv-009-merge-boundary.test.ts"] },
    });
    expect(reviewing.phase).toBe("reviewing");
    expect(reviewing.prNumber).toBeDefined();
    return reviewing;
  }

  it("post-APPROVE push fails the freshness gate and never reaches merge", async () => {
    const world = await makeBuiltWorld();
    const reviewing = await toReview(world);
    await world.gh.createReview(reviewing.prNumber!, {
      state: "approve",
      body: "reviewed exact head",
      expectedCommit: world.head,
    });
    const shipping = await advanceReviewing(reviewing, { gh: world.gh });
    expect(shipping).toMatchObject({ phase: "shipping", approvedCommitId: world.head });

    await writeFile(join(reviewing.worktree!, "merge-boundary.txt"), "changed after approval\n");
    git(reviewing.worktree!, "add", "--", "merge-boundary.txt");
    git(reviewing.worktree!, "commit", "--no-gpg-sign", "-m", "test: post-approval drift");
    git(reviewing.worktree!, "push", "origin", `HEAD:${reviewing.branch}`);
    const driftedHead = git(reviewing.worktree!, "rev-parse", "HEAD");
    world.github.setBranchHead(reviewing.branch!, driftedHead);

    const reviewRetry = await advanceReviewing(reviewing, { gh: world.gh });
    expect(reviewRetry).toMatchObject({ phase: "reviewing", cycles: 1 });
    const shipRetry = await advanceShipping(shipping, {
      gh: world.gh,
      localRepo: world.repo.dir,
      policy: DEFAULT_LOOP_POLICY,
      commands: { testCommand: "true", lintCommand: "true" },
      base: world.base,
      criteria: parseAcceptanceCriteria(shipping.body),
      criterionTests: { AC1: ["cf-inv-009-merge-boundary.test.ts"] },
    });
    expect(shipRetry.phase).toBe("building");
    expect(world.github.callLog().filter((entry) => entry.op === "pr.merge")).toEqual([]);
    expect((await world.gh.readPR(reviewing.prNumber!)).state).toBe("OPEN");
  });

  it("a guessed main base fails before PR creation; the resolved trunk base succeeds", async () => {
    const world = await makeBuiltWorld();
    await expect(advanceGates(world.item, {
      gh: world.gh,
      policy: DEFAULT_LOOP_POLICY,
      commands: { testCommand: "true", lintCommand: "true" },
      base: { ref: "origin/main", defaultBranch: "main" },
      criteria: parseAcceptanceCriteria(world.item.body),
      criterionTests: { AC1: ["cf-inv-009-merge-boundary.test.ts"] },
    })).rejects.toThrow();
    expect(world.github.readState().prs).toEqual({});
    expect((await world.gh.readIssue(world.item.issueNumber)).labels).toEqual(["op:building"]);

    const reviewing = await toReview(world);
    expect((await world.gh.readPR(reviewing.prNumber!)).baseRefName).toBe(DEFAULT_BRANCH);
  });

  it("negative control: HMAC bytes minted for one commit never authorize another", () => {
    const secret = "operator-only-test-secret";
    const marker = selfApprovalMarker(secret, 42, "a".repeat(40));
    expect(verifiedSelfApprovalMarker(marker, secret, 42, "a".repeat(40))).toBe(true);
    expect(verifiedSelfApprovalMarker(marker, secret, 42, "b".repeat(40))).toBe(false);
    expect(verifiedSelfApprovalMarker(marker, secret, 43, "a".repeat(40))).toBe(false);
  });

  it("builder identity cannot own a merge operation or manufacture a human approval", async () => {
    const root = await mkdtemp(join(tmpdir(), "operon-cf-inv-009-gate-"));
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    const store = new ApprovalStore(root);
    const gate = composeGate(defaultGate, store, { app: "merge-app", role: "builder" });
    const decision = gate({ tool: "bash", input: { command: "gh pr merge 42 --squash" } });
    expect(decision).toMatchObject({ allow: false, escalate: false });
    if (!decision.allow) expect(decision.reason).toContain("orchestrator owns this operation");
    expect(await store.listPending()).toEqual([]);
  });
});
