// CF-J04-I — real SIGKILL at each durable delivery-loop boundary: claim,
// branch, PR, review, merge. Recovery always starts from the furthest durable
// artifact, never a later label or a repeated paid/build stage (L2, E2;
// J-04, B-01/B-07/B-15, INV-008/013; case-catalog CF-J04-I).

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { devNull, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  recoverInterruptedClaims,
} from "../../../src/loop/claim-recovery.js";
import { baseRevisionForBranch, resolveRemoteDefaultBranch } from "../../../src/loop/default-branch.js";
import { GhCliOps, type GhIssue } from "../../../src/loop/github.js";
import {
  advanceReviewing,
  branchNameForIssue,
  recoverAlreadyMergedTicket,
  type LoopItem,
} from "../../../src/loop/loop.js";
import {
  readTicketClaimState,
  rehydrateTicketState,
} from "../../../src/loop/rehydrate.js";
import { runKillPointScenario, type KillPointResult } from "../../fixtures/kill-point.js";
import { makeTempGitRepo, type TempGitRepo } from "../../fixtures/git-repo.js";
import { installGithubDouble, type GithubDoubleHandle } from "../../fixtures/github-double/install.js";

const REPO_ROOT = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const APP = "cf-j04-app";
const DEFAULT_BRANCH = "trunk";
const OP_LABELS = [
  { name: "op:ready", color: "1D76DB", description: "ready" },
  { name: "op:building", color: "FBCA04", description: "building" },
  { name: "op:in-review", color: "0E8A16", description: "reviewing" },
  { name: "op:returned", color: "B60205", description: "returned" },
];
const BODY = [
  "## Goal",
  "Exercise crash recovery at every delivery boundary.",
  "",
  "## Acceptance criteria",
  "- [ ] delivery.md records the delivered artifact",
  "",
].join("\n");

const HERMETIC_GIT_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_TERMINAL_PROMPT: "0",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: devNull,
};

function gitIn(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    env: HERMETIC_GIT_ENV,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 15_000,
  }).trim();
}

interface World {
  repo: TempGitRepo;
  remoteDir: string;
  github: GithubDoubleHandle;
  gh: GhCliOps;
  issue: GhIssue;
  branch: string;
  worktreeRoot: string;
  runlogRoot: string;
}

interface Checkpoint {
  stage: "claim" | "branch" | "pr" | "review" | "merge" | "done";
  item?: LoopItem;
  prNumber?: number;
}

function scenarioSource(): string {
  const modulePath = (relative: string): string => JSON.stringify(join(REPO_ROOT, relative));
  return `
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  beginTicketClaim,
  finishTicketClaim,
  markTicketClaimed,
  markTicketProviderStarted,
} from ${modulePath("src/loop/claim-recovery.js")};
import { baseRevisionForBranch, resolveRemoteDefaultBranch } from ${modulePath("src/loop/default-branch.js")};
import { DEFAULT_LOOP_POLICY, runLoopOnce } from ${modulePath("src/loop/driver.js")};
import { GhCliOps } from ${modulePath("src/loop/github.js")};
import { branchNameForIssue } from ${modulePath("src/loop/loop.js")};
import { setBranchHead } from ${modulePath("claude-tests/fixtures/github-double/install.js")};

const world = JSON.parse(process.env.CF_J04_WORLD);
const checkpointPath = join(process.env.KP_SCRATCH, "checkpoint.json");
const checkpoint = (value) => writeFileSync(checkpointPath, JSON.stringify(value, null, 2) + "\\n");
const git = (cwd, ...args) => execFileSync("git", args, {
  cwd,
  encoding: "utf8",
  env: {
    ...process.env,
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: ${JSON.stringify(devNull)},
  },
}).trim();

const issue = world.issue;
const branch = branchNameForIssue(issue);
const baseGh = new GhCliOps(world.githubRepo);
let currentItem;
let reviewItem;

const gh = new Proxy(baseGh, {
  get(target, property, receiver) {
    if (property === "createPR") {
      return async (input) => {
        if (currentItem?.worktree === undefined) throw new Error("cf-j04: no worktree before PR");
        setBranchHead(world.githubHome, input.head, git(currentItem.worktree, "rev-parse", "HEAD"));
        const pr = await target.createPR(input);
        checkpoint({
          stage: "pr",
          prNumber: pr.number,
          item: { ...currentItem, phase: "reviewing", prNumber: pr.number },
        });
        await kp("pr");
        return pr;
      };
    }
    if (property === "createReview") {
      return async (prNumber, input) => {
        const review = await target.createReview(prNumber, input);
        checkpoint({ stage: "review", prNumber, item: reviewItem });
        await kp("review");
        return review;
      };
    }
    if (property === "squashMerge") {
      return async (prNumber, input) => {
        const shipping = {
          ...reviewItem,
          phase: "shipping",
          approvedCommitId: input.matchHeadCommit,
        };
        const merged = await target.squashMerge(prNumber, input);
        checkpoint({ stage: "merge", prNumber, item: shipping });
        await kp("merge");
        return merged;
      };
    }
    const value = Reflect.get(target, property, receiver);
    return typeof value === "function" ? value.bind(target) : value;
  },
});

const begun = await beginTicketClaim({
  root: world.runlogRoot,
  app: ${JSON.stringify(APP)},
  issueNumber: issue.number,
  defaultAllowance: 3,
  now: new Date("2026-07-31T12:00:00.000Z"),
});
if (!begun.allowed || begun.lease === undefined) throw new Error("cf-j04: claim lease refused");
const lease = begun.lease;

const result = await runLoopOnce({
  app: ${JSON.stringify(APP)},
  repo: world.githubRepo,
  gh,
  localRepo: world.repoDir,
  worktreeRoot: world.worktreeRoot,
  policy: DEFAULT_LOOP_POLICY,
  commands: { testCommand: "true" },
  base: baseRevisionForBranch(resolveRemoteDefaultBranch("origin", {
    cwd: world.repoDir,
    errorPrefix: "cf-j04-i",
  })),
  maxConcurrent: 1,
  claimFault: async (boundary) => {
    if (boundary === "after_label_transition") {
      checkpoint({ stage: "claim" });
      await kp("claim");
    }
    if (boundary === "after_pass_selection") {
      await markTicketClaimed({
        root: world.runlogRoot,
        app: ${JSON.stringify(APP)},
        issueNumber: issue.number,
        claimId: lease.claimId,
      });
      checkpoint({ stage: "branch" });
      await kp("branch");
    }
  },
  afterClaim: async (item) => {
    await markTicketProviderStarted({
      root: world.runlogRoot,
      app: ${JSON.stringify(APP)},
      issueNumber: issue.number,
      claimId: lease.claimId,
      now: new Date("2026-07-31T12:01:00.000Z"),
    });
    writeFileSync(join(item.worktree, "delivery.md"), "# Delivered\\n");
    git(item.worktree, "add", "--", "delivery.md");
    git(item.worktree, "commit", "--no-gpg-sign", "-m", "build: crash sweep artifact");
    currentItem = {
      ...item,
      contract: JSON.stringify({
        files: ["delivery.md"],
        approach: "write the artifact",
        tests: [{ criterionId: "AC1", tests: ["cf-j04-i.test.ts"] }],
        risks: "none",
        complexity: "low",
      }),
      criterionTests: { AC1: ["cf-j04-i.test.ts"] },
    };
    return currentItem;
  },
  injectReview: async (item) => {
    reviewItem = item;
    const head = git(item.worktree, "rev-parse", "HEAD");
    await gh.createReview(item.prNumber, {
      state: "approve",
      body: "independent deterministic approval",
      expectedCommit: head,
    });
  },
});

const terminal = result.items[0];
if (terminal === undefined) throw new Error("cf-j04: loop returned no item");
await finishTicketClaim({
  root: world.runlogRoot,
  app: ${JSON.stringify(APP)},
  issueNumber: issue.number,
  claimId: lease.claimId,
  item: terminal,
});
checkpoint({ stage: "done", item: terminal, prNumber: terminal.prNumber });
await kp("done");
`;
}

describe("CF-J04-I — crash-point sweep follows artifact authority", () => {
  const cleanups: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  async function makeWorld(): Promise<World> {
    const repo = await makeTempGitRepo({ defaultBranch: DEFAULT_BRANCH });
    cleanups.push(() => repo.cleanup());
    const remote = await repo.addFileRemote();
    expect(resolveRemoteDefaultBranch("origin", { cwd: repo.dir })).toBe(DEFAULT_BRANCH);

    const github = await installGithubDouble({ defaultBranch: DEFAULT_BRANCH, labels: OP_LABELS });
    cleanups.push(() => github.dispose());
    const gh = new GhCliOps(github.repo, github.exec);
    const issue = await gh.createIssue({
      title: "Crash sweep delivery",
      body: BODY,
      labels: ["op:ready"],
    });
    const worktreeRoot = await mkdtemp(join(tmpdir(), "operon-cf-j04-worktrees-"));
    cleanups.push(() => rm(worktreeRoot, { recursive: true, force: true }));
    const runlogRoot = await mkdtemp(join(tmpdir(), "operon-cf-j04-runlog-"));
    cleanups.push(() => rm(runlogRoot, { recursive: true, force: true }));
    return {
      repo,
      remoteDir: remote.dir,
      github,
      gh,
      issue,
      branch: branchNameForIssue(issue),
      worktreeRoot,
      runlogRoot,
    };
  }

  async function killAt(world: World, stage: Checkpoint["stage"]): Promise<{
    result: KillPointResult;
    checkpoint: Checkpoint;
  }> {
    const result = await runKillPointScenario({
      source: scenarioSource(),
      killAt: stage,
      env: {
        PATH: `${world.github.binDir}:${process.env.PATH ?? ""}`,
        CF_J04_WORLD: JSON.stringify({
          repoDir: world.repo.dir,
          githubHome: world.github.home,
          githubRepo: world.github.repo,
          issue: world.issue,
          worktreeRoot: world.worktreeRoot,
          runlogRoot: world.runlogRoot,
        }),
      },
      timeoutMs: 30_000,
    });
    cleanups.push(() => result.cleanup());
    expect(result.timedOut).toBe(false);
    expect(result.killedAt).toBe(stage);
    expect(result.markers.at(-1)).toBe(stage);
    const checkpoint = JSON.parse(
      await readFile(join(result.stateDir, "checkpoint.json"), "utf8"),
    ) as Checkpoint;
    expect(checkpoint.stage).toBe(stage);
    return { result, checkpoint };
  }

  it("kill after claim label: the dead provisional claim re-arms; no branch artifact is invented", async () => {
    const world = await makeWorld();
    const { result } = await killAt(world, "claim");
    const state = readTicketClaimState(world.runlogRoot, APP, world.issue.number);

    expect(state.active).toMatchObject({ ownerPid: result.pid, phase: "acquiring" });
    expect((await world.gh.readIssue(world.issue.number)).labels).toEqual(["op:building"]);
    expect(() => gitIn(world.repo.dir, "show-ref", "--verify", `refs/heads/${world.branch}`)).toThrow();
    expect(world.github.readState().prs).toEqual({});

    const lines = await recoverInterruptedClaims({
      root: world.runlogRoot,
      app: APP,
      gh: world.gh,
      entries: [{ issueNumber: world.issue.number, state }],
    });
    expect(lines).toEqual([`#${world.issue.number}: orphaned pre-provider claim auto-rearmed`]);
    expect((await world.gh.readIssue(world.issue.number)).labels).toEqual(["op:ready"]);
    expect(readTicketClaimState(world.runlogRoot, APP, world.issue.number).active).toBeUndefined();
  });

  it("kill after branch: the branch/worktree survive and pre-provider recovery consumes no claim", async () => {
    const world = await makeWorld();
    await killAt(world, "branch");
    const state = readTicketClaimState(world.runlogRoot, APP, world.issue.number);
    const branchHead = gitIn(world.repo.dir, "rev-parse", world.branch);

    expect(state).toMatchObject({ claims: 0, active: { phase: "claimed" } });
    expect(branchHead).toBe(gitIn(world.repo.dir, "rev-parse", baseRevisionForBranch(DEFAULT_BRANCH).ref));
    expect(existsSync(join(world.worktreeRoot, world.branch.replaceAll("/", "-")))).toBe(true);
    expect(world.github.readState().prs).toEqual({});

    await recoverInterruptedClaims({
      root: world.runlogRoot,
      app: APP,
      gh: world.gh,
      entries: [{ issueNumber: world.issue.number, state }],
    });
    expect(readTicketClaimState(world.runlogRoot, APP, world.issue.number).claims).toBe(0);
    expect((await world.gh.readIssue(world.issue.number)).labels).toEqual(["op:ready"]);
    expect(gitIn(world.repo.dir, "rev-parse", world.branch)).toBe(branchHead);
  });

  it("kill after PR: rehydration trusts the open PR artifact despite the lagging build label", async () => {
    const world = await makeWorld();
    const { checkpoint } = await killAt(world, "pr");
    const state = world.github.readState();
    const pr = state.prs[String(checkpoint.prNumber)];

    expect((await world.gh.readIssue(world.issue.number)).labels).toEqual(["op:building"]);
    expect(pr).toMatchObject({ state: "OPEN", headRefName: world.branch, baseRefName: DEFAULT_BRANCH });
    expect(gitIn(world.remoteDir, "rev-parse", `refs/heads/${world.branch}`)).toBe(pr?.headRefOid);
    const recovered = await rehydrateTicketState(
      { issueNumber: world.issue.number, body: BODY },
      { gh: world.gh, branch: world.branch },
    );
    expect(recovered.prNumber).toBe(checkpoint.prNumber);
    expect(state.prs[String(checkpoint.prNumber)]?.reviews).toEqual([]);
  });

  it("kill after review: the exact-HEAD approval advances directly to shipping", async () => {
    const world = await makeWorld();
    const { checkpoint } = await killAt(world, "review");
    expect(checkpoint.item).toBeDefined();
    const pr = await world.gh.readPR(checkpoint.prNumber!);
    expect(pr.state).toBe("OPEN");
    expect((await world.gh.listReviews(checkpoint.prNumber!))).toHaveLength(1);

    const recovered = await advanceReviewing(checkpoint.item!, { gh: world.gh });
    expect(recovered).toMatchObject({
      phase: "shipping",
      approvedCommitId: pr.headRefOid,
      prNumber: checkpoint.prNumber,
    });
  });

  it("kill after merge: merged PR authority runs only the idempotent cleanup tail", async () => {
    const world = await makeWorld();
    const { checkpoint } = await killAt(world, "merge");
    expect(checkpoint.item).toBeDefined();
    expect((await world.gh.readPR(checkpoint.prNumber!)).state).toBe("MERGED");
    expect((await world.gh.readIssue(world.issue.number)).labels).toEqual(["op:in-review"]);
    expect(existsSync(checkpoint.item!.worktree!)).toBe(true);

    const mergeCallsBefore = world.github.callLog().filter((entry) => entry.op === "pr.merge").length;
    const recovered = await recoverAlreadyMergedTicket(checkpoint.item!, {
      gh: world.gh,
      localRepo: world.repo.dir,
    });
    expect(recovered.phase).toBe("merged");
    expect((await world.gh.readIssue(world.issue.number)).labels).toEqual([]);
    expect(existsSync(checkpoint.item!.worktree!)).toBe(false);
    expect(world.github.callLog().filter((entry) => entry.op === "pr.merge")).toHaveLength(mergeCallsBefore);
  });

  it("negative control: an in-review label without a PR never fabricates PR authority", async () => {
    const world = await makeWorld();
    await world.gh.swapLabel(world.issue.number, "op:ready", "op:in-review");
    const recovered = await rehydrateTicketState(
      { issueNumber: world.issue.number, body: BODY },
      { gh: world.gh, branch: world.branch },
    );
    expect(recovered.prNumber).toBeUndefined();
    expect(world.github.readState().prs).toEqual({});
  });
});
