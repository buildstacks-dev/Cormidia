// In-memory GitHub for loop tests (M5.2), paired with the real-git
// bare/clone fixture when merge semantics matter.

import { execFileSync } from "node:child_process";
import { devNull } from "node:os";
import type {
  CreatePrInput,
  CreateReviewInput,
  GhIssue,
  GhOps,
  GhPullRequest,
  GhReview,
  ListIssueOptions,
  ListPullRequestOptions,
  SquashMergeInput,
} from "../../src/loop/github.js";
import { GhOpsError } from "../../src/loop/github.js";

export interface FakeGhIssueSeed {
  number: number;
  title: string;
  body?: string;
  labels?: string[];
  state?: string;
}

export interface FakeGhOpsOptions {
  repo?: string;
  issues?: FakeGhIssueSeed[];
  /** Working clone from makeBareWithClone(); origin is the paired bare repo. */
  cloneRoot?: string;
}

export interface FakeGhCall {
  op: string;
  detail: Record<string, unknown>;
}

export class FakeGhOps implements GhOps {
  readonly repo: string;
  readonly calls: FakeGhCall[] = [];
  readonly issueComments = new Map<number, string[]>();
  private readonly issues = new Map<number, GhIssue>();
  private readonly prs = new Map<number, GhPullRequest>();
  private readonly reviews = new Map<number, GhReview[]>();
  private readonly cloneRoot?: string;
  private nextPrNumber = 1;

  constructor(options: FakeGhOpsOptions = {}) {
    this.repo = options.repo ?? "fixture/repo";
    if (options.cloneRoot !== undefined) this.cloneRoot = options.cloneRoot;
    for (const issue of options.issues ?? []) {
      this.issues.set(issue.number, {
        number: issue.number,
        title: issue.title,
        body: issue.body ?? "",
        labels: [...(issue.labels ?? [])],
        state: issue.state ?? "OPEN",
      });
    }
  }

  /** Model the PR branch advancing to a new head commit (e.g. a builder
   *  pushing after a review was posted). Later reviews are stamped with this
   *  commit_id, mirroring GitHub. */
  setPrHead(prNumber: number, oid: string): void {
    this.requirePr(prNumber).headRefOid = oid;
  }

  seedIssue(issue: FakeGhIssueSeed): GhIssue {
    const seeded: GhIssue = {
      number: issue.number,
      title: issue.title,
      body: issue.body ?? "",
      labels: [...(issue.labels ?? [])],
      state: issue.state ?? "OPEN",
    };
    this.issues.set(issue.number, seeded);
    return cloneIssue(seeded);
  }

  async addLabel(issueNumber: number, label: string): Promise<void> {
    this.log("addLabel", { issueNumber, label });
    const issue = this.requireIssue(issueNumber);
    if (!issue.labels.includes(label)) issue.labels.push(label);
  }

  async removeLabel(issueNumber: number, label: string): Promise<void> {
    this.log("removeLabel", { issueNumber, label });
    const issue = this.requireIssue(issueNumber);
    issue.labels = issue.labels.filter((l) => l !== label);
  }

  async swapLabel(issueNumber: number, removeLabel: string, addLabel: string): Promise<void> {
    this.log("swapLabel", { issueNumber, removeLabel, addLabel });
    const issue = this.requireIssue(issueNumber);
    if (!issue.labels.includes(removeLabel)) {
      throw new GhOpsError("fake gh label swap precondition failed", {
        args: ["issue", "edit", String(issueNumber), "--remove-label", removeLabel],
        stdout: "",
        stderr: `issue #${issueNumber} does not have label ${removeLabel}`,
        exitCode: 1,
      });
    }
    issue.labels = issue.labels.filter((l) => l !== removeLabel);
    if (!issue.labels.includes(addLabel)) issue.labels.push(addLabel);
  }

  async commentIssue(issueNumber: number, body: string): Promise<void> {
    this.log("commentIssue", { issueNumber, body });
    this.requireIssue(issueNumber);
    const list = this.issueComments.get(issueNumber) ?? [];
    list.push(body);
    this.issueComments.set(issueNumber, list);
  }

  async listIssueComments(issueNumber: number): Promise<{ body: string }[]> {
    this.log("listIssueComments", { issueNumber });
    this.requireIssue(issueNumber);
    return (this.issueComments.get(issueNumber) ?? []).map((body) => ({ body }));
  }

  async createIssue(input: { title: string; body: string; labels: string[] }): Promise<GhIssue> {
    this.log("createIssue", { title: input.title, labels: input.labels.join(",") });
    for (const label of input.labels) {
      if (!this.repoLabels.has(label)) {
        throw new GhOpsError("fake gh: label does not exist on the repo", {
          args: ["issue", "create", "--label", label],
          stdout: "",
          stderr: `could not add label: '${label}' not found`,
          exitCode: 1,
        });
      }
    }
    const number = Math.max(0, ...this.issues.keys()) + 1;
    const issue: GhIssue = {
      number,
      title: input.title,
      body: input.body,
      labels: [...input.labels],
      state: "OPEN",
    };
    this.issues.set(number, issue);
    return cloneIssue(issue);
  }

  async updateIssueBody(issueNumber: number, body: string): Promise<void> {
    this.log("updateIssueBody", { issueNumber });
    this.requireIssue(issueNumber).body = body;
  }

  readonly repoLabels = new Set<string>();
  readonly repoLabelDefinitions = new Map<string, { name: string; color: string; description: string }>();

  async ensureLabel(input: { name: string; color: string; description: string }): Promise<void> {
    this.log("ensureLabel", { name: input.name });
    this.repoLabels.add(input.name);
    this.repoLabelDefinitions.set(input.name, { ...input });
  }

  async listLabels(): Promise<Array<{ name: string; color: string; description: string }>> {
    this.log("listLabels", {});
    return [...this.repoLabels]
      .sort((left, right) => left.localeCompare(right))
      .map((name) => ({
        ...(this.repoLabelDefinitions.get(name) ?? { name, color: "", description: "" }),
      }));
  }

  async listIssues(options: ListIssueOptions = {}): Promise<GhIssue[]> {
    this.log("listIssues", { labels: options.labels ?? [], state: options.state ?? "open" });
    const labels = options.labels ?? [];
    const state = options.state ?? "open";
    const limit = options.limit ?? 100;
    return [...this.issues.values()]
      .filter((issue) => state === "all" || issue.state.toLowerCase() === state)
      .filter((issue) => labels.every((label) => issue.labels.includes(label)))
      .slice(0, limit)
      .map(cloneIssue);
  }

  async readIssue(issueNumber: number): Promise<GhIssue> {
    this.log("readIssue", { issueNumber });
    return cloneIssue(this.requireIssue(issueNumber));
  }

  async closeIssue(issueNumber: number): Promise<void> {
    this.log("closeIssue", { issueNumber });
    this.requireIssue(issueNumber).state = "CLOSED";
  }

  async createPR(input: CreatePrInput): Promise<GhPullRequest> {
    this.log("createPR", { head: input.head, base: input.base, title: input.title });
    const number = this.nextPrNumber++;
    const headRefOid = this.resolveRef(input.head);
    const pr: GhPullRequest = {
      number,
      title: input.title,
      body: input.body,
      state: "OPEN",
      headRefName: input.head,
      baseRefName: input.base,
      ...(headRefOid !== undefined ? { headRefOid } : {}),
      isDraft: input.draft === true,
      url: `https://github.invalid/${this.repo}/pull/${number}`,
    };
    this.prs.set(number, pr);
    return clonePr(pr);
  }

  async readPR(selector: number | string): Promise<GhPullRequest> {
    this.log("readPR", { selector });
    const pr = this.findPr(selector);
    return clonePr(pr);
  }

  async listPullRequests(options: ListPullRequestOptions = {}): Promise<GhPullRequest[]> {
    this.log("listPullRequests", { state: options.state ?? "open" });
    const state = options.state ?? "open";
    const limit = options.limit ?? 100;
    return [...this.prs.values()]
      .filter((pr) => state === "all" || pr.state.toLowerCase() === state)
      .slice(0, limit)
      .map(clonePr);
  }

  async listPRsForBranch(
    branch: string,
    options: ListPullRequestOptions = {},
  ): Promise<GhPullRequest[]> {
    this.log("listPRsForBranch", { branch, state: options.state ?? "all" });
    const state = options.state ?? "all";
    return [...this.prs.values()]
      .filter((pr) => pr.headRefName === branch)
      .filter((pr) => state === "all" || pr.state.toLowerCase() === state)
      .map(clonePr);
  }

  async closePullRequest(prNumber: number): Promise<void> {
    this.log("closePullRequest", { prNumber });
    this.requirePr(prNumber).state = "CLOSED";
  }

  async createReview(prNumber: number, input: CreateReviewInput, author?: string): Promise<GhReview> {
    this.log("createReview", { prNumber, state: input.state });
    const pr = this.requirePr(prNumber);
    const review: GhReview = {
      state:
        input.state === "approve"
          ? "APPROVED"
          : input.state === "request_changes"
            ? "CHANGES_REQUESTED"
            : "COMMENTED",
      body: input.body,
      ...(pr.headRefOid !== undefined ? { commitId: pr.headRefOid } : {}),
      ...(author !== undefined ? { author } : {}),
    };
    const list = this.reviews.get(prNumber) ?? [];
    list.push(review);
    this.reviews.set(prNumber, list);
    return { ...review };
  }

  async listReviews(prNumber: number): Promise<GhReview[]> {
    this.log("listReviews", { prNumber });
    this.requirePr(prNumber);
    return (this.reviews.get(prNumber) ?? []).map((review) => ({ ...review }));
  }

  async squashMerge(prNumber: number, input: SquashMergeInput): Promise<GhPullRequest> {
    this.log("squashMerge", { prNumber, subject: input.subject });
    const pr = this.requirePr(prNumber);
    if (this.cloneRoot !== undefined) {
      try {
        git(this.cloneRoot, "fetch", "origin", pr.headRefName);
        git(this.cloneRoot, "checkout", "main");
        git(this.cloneRoot, "reset", "--hard", "origin/main");
        git(this.cloneRoot, "merge", "--squash", `origin/${pr.headRefName}`);
        git(this.cloneRoot, "commit", "-m", input.subject, ...(input.body ? ["-m", input.body] : []));
        git(this.cloneRoot, "push", "origin", "main");
      } catch (error) {
        abortMerge(this.cloneRoot);
        throw new GhOpsError("fake gh squash merge conflict", {
          args: ["pr", "merge", String(prNumber), "--squash"],
          stdout: "",
          stderr: error instanceof Error ? error.message : String(error),
          exitCode: 1,
          code: "merge_conflict",
        });
      }
      pr.mergeCommitOid = git(this.cloneRoot, "rev-parse", "HEAD");
    }
    pr.state = "MERGED";
    closeLinkedIssue(pr.body, this.issues);
    return clonePr(pr);
  }

  async deleteBranch(branch: string): Promise<void> {
    this.log("deleteBranch", { branch });
    if (this.cloneRoot !== undefined) {
      git(this.cloneRoot, "push", "origin", "--delete", branch);
    }
  }

  private requireIssue(issueNumber: number): GhIssue {
    const issue = this.issues.get(issueNumber);
    if (issue === undefined) {
      throw new Error(`fake gh: issue #${issueNumber} not found`);
    }
    return issue;
  }

  private requirePr(prNumber: number): GhPullRequest {
    const pr = this.prs.get(prNumber);
    if (pr === undefined) throw new Error(`fake gh: PR #${prNumber} not found`);
    return pr;
  }

  private findPr(selector: number | string): GhPullRequest {
    if (typeof selector === "number" || /^\d+$/.test(selector)) {
      return this.requirePr(Number(selector));
    }
    const byUrl = [...this.prs.values()].find((pr) => pr.url === selector);
    if (byUrl !== undefined) return byUrl;
    const byHead = [...this.prs.values()].find((pr) => pr.headRefName === selector);
    if (byHead !== undefined) return byHead;
    throw new Error(`fake gh: PR ${selector} not found`);
  }

  private resolveRef(ref: string): string | undefined {
    if (this.cloneRoot === undefined) return `fake-${ref}`;
    try {
      return git(this.cloneRoot, "rev-parse", ref);
    } catch {
      try {
        return git(this.cloneRoot, "rev-parse", `origin/${ref}`);
      } catch {
        return undefined;
      }
    }
  }

  private log(op: string, detail: Record<string, unknown>): void {
    this.calls.push({ op, detail });
  }
}

function cloneIssue(issue: GhIssue): GhIssue {
  return { ...issue, labels: [...issue.labels] };
}

function clonePr(pr: GhPullRequest): GhPullRequest {
  return { ...pr };
}

function closeLinkedIssue(body: string, issues: Map<number, GhIssue>): void {
  for (const match of body.matchAll(/\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/gi)) {
    const number = Number(match[1]);
    const issue = issues.get(number);
    if (issue !== undefined) issue.state = "CLOSED";
  }
}

const fixtureGitEnv: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: devNull,
  GIT_CONFIG_SYSTEM: devNull,
  GIT_AUTHOR_NAME: "Operon Fixture",
  GIT_AUTHOR_EMAIL: "fixture@operon.invalid",
  GIT_COMMITTER_NAME: "Operon Fixture",
  GIT_COMMITTER_EMAIL: "fixture@operon.invalid",
  GIT_TERMINAL_PROMPT: "0",
};

function git(cwd: string, ...args: string[]): string {
  try {
    return execFileSync("git", args, {
      cwd,
      env: fixtureGitEnv,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    const stderr = (error as { stderr?: unknown }).stderr;
    const detail = typeof stderr === "string" && stderr.trim() !== "" ? stderr.trim() : "";
    throw new Error(`git ${args.join(" ")} failed${detail ? `\n${detail}` : ""}`);
  }
}

function abortMerge(cwd: string): void {
  for (const args of [
    ["merge", "--abort"],
    ["reset", "--merge"],
    ["reset", "--hard", "origin/main"],
  ]) {
    try {
      git(cwd, ...args);
      return;
    } catch {
      // Try the next cleanup shape; merge --squash conflicts vary by git version.
    }
  }
}
