import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { devNull, tmpdir } from "node:os";
import { join } from "node:path";
import { baseRevisionForBranch, resolveRemoteDefaultBranch } from "../../../src/loop/default-branch.js";
import { DEFAULT_LOOP_POLICY } from "../../../src/loop/driver.js";
import { GhCliOps, type GhIssue } from "../../../src/loop/github.js";
import {
  advanceGates,
  branchNameForIssue,
  claimTicket,
  parseAcceptanceCriteria,
  type LoopItem,
} from "../../../src/loop/loop.js";
import { makeTempGitRepo, type TempGitRepo } from "../../fixtures/git-repo.js";
import { installGithubDouble, type GithubDoubleHandle } from "../../fixtures/github-double/install.js";

export const J04_APP = "cf-j04-app";
export const J04_DEFAULT_BRANCH = "trunk";
export const J04_BODY = [
  "## Goal",
  "Deliver one deterministic artifact.",
  "",
  "## Acceptance criteria",
  "- [ ] delivery.md records the artifact",
  "",
].join("\n");
export const J04_CONTRACT = JSON.stringify({
  files: ["delivery.md"],
  approach: "write and verify the delivery artifact",
  tests: [{ criterionId: "AC1", tests: ["cf-j04 wave-3 suite"] }],
  risks: "delivery state drift",
  complexity: "low",
});
export const J04_LABELS = [
  { name: "op:ready", color: "1d76db", description: "ready" },
  { name: "op:building", color: "fbca04", description: "building" },
  { name: "op:in-review", color: "0e8a16", description: "review" },
  { name: "op:returned", color: "b60205", description: "returned" },
  { name: "op:blocked", color: "5319e7", description: "blocked" },
];

const GIT_ENV = {
  ...process.env,
  GIT_TERMINAL_PROMPT: "0",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: devNull,
};

export function j04Git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    env: GIT_ENV,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

export interface J04World {
  repo: TempGitRepo;
  remoteDir: string;
  github: GithubDoubleHandle;
  gh: GhCliOps;
  issue: GhIssue;
  worktreeRoot: string;
  base: ReturnType<typeof baseRevisionForBranch>;
  cleanup(): Promise<void>;
}

export async function makeJ04World(): Promise<J04World> {
  const repo = await makeTempGitRepo({ defaultBranch: J04_DEFAULT_BRANCH });
  const remote = await repo.addFileRemote();
  const github = await installGithubDouble({ defaultBranch: J04_DEFAULT_BRANCH, labels: J04_LABELS });
  const gh = new GhCliOps(github.repo, github.exec);
  const issue = await gh.createIssue({ title: "Wave 3 delivery", body: J04_BODY, labels: ["op:ready"] });
  const worktreeRoot = await mkdtemp(join(tmpdir(), "operon-cf-j04-wave3-"));
  const base = baseRevisionForBranch(resolveRemoteDefaultBranch("origin", { cwd: repo.dir }));
  return {
    repo,
    remoteDir: remote.dir,
    github,
    gh,
    issue,
    worktreeRoot,
    base,
    async cleanup() {
      await rm(worktreeRoot, { recursive: true, force: true });
      await github.dispose();
      await repo.cleanup();
    },
  };
}

export async function buildJ04Item(world: J04World): Promise<LoopItem> {
  const item = await claimTicket(world.issue, {
    gh: world.gh,
    targetRepo: world.github.repo,
    localRepo: world.repo.dir,
    worktreeRoot: world.worktreeRoot,
    base: world.base,
  });
  await writeFile(join(item.worktree!, "delivery.md"), "# Delivered\n");
  j04Git(item.worktree!, "add", "--", "delivery.md");
  j04Git(item.worktree!, "commit", "--no-gpg-sign", "-m", "build: wave 3 delivery");
  world.github.setBranchHead(branchNameForIssue(world.issue), j04Git(item.worktree!, "rev-parse", "HEAD"));
  return { ...item, contract: J04_CONTRACT, criterionTests: { AC1: ["cf-j04 wave-3 suite"] } };
}

export async function reviewJ04Item(world: J04World, item?: LoopItem): Promise<LoopItem> {
  const built = item ?? await buildJ04Item(world);
  return advanceGates(built, {
    gh: world.gh,
    policy: DEFAULT_LOOP_POLICY,
    commands: { testCommand: "true" },
    base: world.base,
    criteria: parseAcceptanceCriteria(built.body),
    criterionTests: built.criterionTests ?? {},
  });
}
