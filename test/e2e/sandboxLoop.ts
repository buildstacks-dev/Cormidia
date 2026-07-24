import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GhCliOps, type GhOps, type GhReview } from "../../src/loop/github.js";
import { baseRevisionForBranch } from "../../src/loop/default-branch.js";
import { DEFAULT_LOOP_POLICY, runLoopOnce } from "../../src/loop/driver.js";
import type { LoopItem } from "../../src/loop/types.js";

const repo = process.env["GH_SANDBOX_REPO"];
if (!repo) {
  console.error("GH_SANDBOX_REPO is required (owner/repo)");
  process.exit(2);
}

const root = mkdtempSync(join(tmpdir(), "operon-m5-e2e-"));
const checkout = join(root, "repo");
const worktrees = join(root, "worktrees");

class InjectedReviewGhOps implements GhOps {
  private readonly approvals = new Map<number, GhReview>();
  private readonly inner: GhOps;

  constructor(inner: GhOps) {
    this.inner = inner;
  }

  injectApproval(prNumber: number, commitId: string): void {
    this.approvals.set(prNumber, { state: "APPROVED", body: "Verdict: approve", commitId });
  }

  addLabel(issueNumber: number, label: string) {
    return this.inner.addLabel(issueNumber, label);
  }
  removeLabel(issueNumber: number, label: string) {
    return this.inner.removeLabel(issueNumber, label);
  }
  swapLabel(issueNumber: number, removeLabel: string, addLabel: string) {
    return this.inner.swapLabel(issueNumber, removeLabel, addLabel);
  }
  commentIssue(issueNumber: number, body: string) {
    return this.inner.commentIssue(issueNumber, body);
  }
  listIssues(...args: Parameters<GhOps["listIssues"]>) {
    return this.inner.listIssues(...args);
  }
  readIssue(issueNumber: number) {
    return this.inner.readIssue(issueNumber);
  }
  closeIssue(issueNumber: number) {
    return this.inner.closeIssue(issueNumber);
  }
  createPR(...args: Parameters<GhOps["createPR"]>) {
    return this.inner.createPR(...args);
  }
  updatePullRequestBody(...args: Parameters<GhOps["updatePullRequestBody"]>) {
    return this.inner.updatePullRequestBody(...args);
  }
  readPR(selector: number | string) {
    return this.inner.readPR(selector);
  }
  listPullRequests(...args: Parameters<GhOps["listPullRequests"]>) {
    return this.inner.listPullRequests(...args);
  }
  listPRsForBranch(...args: Parameters<GhOps["listPRsForBranch"]>) {
    return this.inner.listPRsForBranch(...args);
  }
  closePullRequest(prNumber: number) {
    return this.inner.closePullRequest(prNumber);
  }
  createReview(...args: Parameters<GhOps["createReview"]>) {
    return this.inner.createReview(...args);
  }
  squashMerge(...args: Parameters<GhOps["squashMerge"]>) {
    return this.inner.squashMerge(...args);
  }
  deleteBranch(branch: string) {
    return this.inner.deleteBranch(branch);
  }
  createIssue(...args: Parameters<GhOps["createIssue"]>) {
    return this.inner.createIssue(...args);
  }
  updateIssueBody(...args: Parameters<GhOps["updateIssueBody"]>) {
    return this.inner.updateIssueBody(...args);
  }
  ensureLabel(...args: Parameters<GhOps["ensureLabel"]>) {
    return this.inner.ensureLabel(...args);
  }
  listLabels() {
    return this.inner.listLabels();
  }
  listIssueComments(...args: Parameters<GhOps["listIssueComments"]>) {
    return this.inner.listIssueComments(...args);
  }

  async listReviews(prNumber: number): Promise<GhReview[]> {
    const injected = this.approvals.get(prNumber);
    if (injected !== undefined) return [injected];
    return this.inner.listReviews(prNumber);
  }
}

try {
  gh("repo", "clone", repo, checkout);
  ensureFixtureApp(checkout);
  closeStaleE2eIssues(repo);

  const title = `M5 loop e2e ${Date.now()}`;
  const body = [
    "## Goal",
    "Prove the M5 loop can claim, gate, review, ship, and close a sandbox ticket.",
    "",
    "## Context",
    "Seeded by Operon's M5 e2e harness.",
    "",
    "## Acceptance criteria",
    "- [x] the Node test suite passes",
    "",
    "## Out of scope",
    "- real AI builder and reviewer turns",
    "",
    "## Scope",
    "- `src/**`",
    "",
  ].join("\n");
  const issueUrl = gh(
    "issue",
    "create",
    "--repo",
    repo,
    "--title",
    title,
    "--body-file",
    "-",
    "--label",
    "op:ready",
    "--label",
    "p3",
    "--label",
    "op:tier-standard",
    { input: body },
  ).trim();
  const issueNumber = Number(issueUrl.split("/").pop());
  if (!Number.isInteger(issueNumber)) throw new Error(`could not parse issue number from ${issueUrl}`);
  waitForReadyIssue(repo, issueNumber);

  const ghOps = new InjectedReviewGhOps(new GhCliOps(repo));
  const result = await runLoopOnce({
    app: "sandbox",
    repo,
    gh: ghOps,
    localRepo: checkout,
    worktreeRoot: worktrees,
    // `ensureFixtureApp` pins the sandbox checkout to `main` and pushes it,
    // so the sandbox base is that branch rather than a resolved unknown.
    base: baseRevisionForBranch("main"),
    policy: DEFAULT_LOOP_POLICY,
    commands: {
      testCommand: "npm test",
      lintCommand: "npm run lint",
    },
    maxConcurrent: 20,
    afterClaim: (item) => {
      const worktree = must(item.worktree, "worktree");
      mkdirSync(join(worktree, "src"), { recursive: true });
      writeFileSync(
        join(worktree, "src", `operon-m5-${item.issueNumber}.txt`),
        `merged by Operon M5 e2e for ${item.ticketRef}\n`,
      );
      git(worktree, "add", "-A");
      git(worktree, "commit", "-m", `${item.ticketRef}: e2e sandbox change`);
      return item;
    },
    injectReview: (item) => {
      ghOps.injectApproval(must(item.prNumber, "prNumber"), head(must(item.worktree, "worktree")));
    },
  });

  const item = result.items.find((candidate) => candidate.issueNumber === issueNumber);
  if (item?.phase !== "merged") {
    throw new Error(`expected ticket #${issueNumber} to merge, got ${item?.phase ?? "missing"}`);
  }
  const state = gh("issue", "view", String(issueNumber), "--repo", repo, "--json", "state", "--jq", ".state");
  if (state.trim() !== "CLOSED") {
    throw new Error(`expected issue #${issueNumber} to be CLOSED, got ${state.trim()}`);
  }

  console.log(`RESULT: merged #${issueNumber}`);
} finally {
  rmSync(root, { recursive: true, force: true });
}

function ensureFixtureApp(dir: string): void {
  if (!hasCommit(dir)) {
    git(dir, "checkout", "-B", "main");
  } else {
    git(dir, "checkout", "main");
    try {
      git(dir, "pull", "--ff-only", "origin", "main");
    } catch {
      // A fresh empty repository has no origin/main yet.
    }
  }

  mkdirSync(join(dir, "test"), { recursive: true });
  const pkgPath = join(dir, "package.json");
  const pkg = existsSync(pkgPath)
    ? (JSON.parse(readFileSync(pkgPath, "utf8")) as Record<string, unknown>)
    : {};
  pkg["name"] = "operon-m5-sandbox";
  pkg["private"] = true;
  pkg["scripts"] = {
    ...(typeof pkg["scripts"] === "object" && pkg["scripts"] !== null ? pkg["scripts"] : {}),
    test: "node --test",
    lint: "node -e \"process.exit(0)\"",
  };
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  writeFileSync(
    join(dir, "test", "smoke.test.js"),
    [
      "import test from 'node:test';",
      "import assert from 'node:assert/strict';",
      "",
      "test('sandbox smoke', () => {",
      "  assert.equal(1 + 1, 2);",
      "});",
      "",
    ].join("\n"),
  );
  writeFileSync(join(dir, "README.md"), "# Operon M5 sandbox\n");

  if (git(dir, "status", "--porcelain") !== "") {
    git(dir, "add", "-A");
    git(dir, "commit", "-m", "chore: seed operon m5 sandbox");
    git(dir, "push", "-u", "origin", "main");
  }
}

function closeStaleE2eIssues(repoSlug: string): void {
  const raw = gh(
    "issue",
    "list",
    "--repo",
    repoSlug,
    "--state",
    "open",
    "--limit",
    "100",
    "--json",
    "number,title",
  );
  const issues = JSON.parse(raw) as { number: number; title: string }[];
  for (const issue of issues) {
    if (!issue.title.startsWith("M5 loop e2e ")) continue;
    gh(
      "issue",
      "close",
      String(issue.number),
      "--repo",
      repoSlug,
      "--comment",
      "Closing stale M5 e2e issue before rerun.",
    );
  }
}

function waitForReadyIssue(repoSlug: string, issueNumber: number): void {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const raw = gh(
      "issue",
      "list",
      "--repo",
      repoSlug,
      "--state",
      "open",
      "--label",
      "op:ready",
      "--limit",
      "100",
      "--json",
      "number",
    );
    const issues = JSON.parse(raw) as { number: number }[];
    if (issues.some((issue) => issue.number === issueNumber)) return;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
  }
  throw new Error(`issue #${issueNumber} did not appear in op:ready list within 30s`);
}

function hasCommit(dir: string): boolean {
  try {
    git(dir, "rev-parse", "--verify", "HEAD");
    return true;
  } catch {
    return false;
  }
}

function head(dir: string): string {
  return git(dir, "rev-parse", "HEAD");
}

function must<T>(value: T | undefined, name: string): T {
  if (value === undefined) throw new Error(`missing ${name}`);
  return value;
}

function gh(...argsAndMaybeOptions: unknown[]): string {
  const options =
    typeof argsAndMaybeOptions[argsAndMaybeOptions.length - 1] === "object" &&
    !Array.isArray(argsAndMaybeOptions[argsAndMaybeOptions.length - 1])
      ? (argsAndMaybeOptions.pop() as { input?: string })
      : {};
  return execFileSync("gh", argsAndMaybeOptions as string[], {
    input: options.input,
    encoding: "utf8",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    stdio: ["pipe", "pipe", "pipe"],
  });
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Operon E2E",
      GIT_AUTHOR_EMAIL: "e2e@operon.invalid",
      GIT_COMMITTER_NAME: "Operon E2E",
      GIT_COMMITTER_EMAIL: "e2e@operon.invalid",
      GIT_TERMINAL_PROMPT: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}
