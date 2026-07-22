// Provider-blind GitHub operations for the build loop (M5.1).
//
// The loop state machine depends on GitHub artifacts and labels, but not on
// any GitHub client library. GhCliOps is deliberately a thin wrapper over the
// installed `gh` CLI with an injectable executor for tests. Every non-zero
// command becomes a GhOpsError carrying stderr verbatim: orchestrator side
// effects either happen or fail loudly (docs/loop.md §1).

import { spawn } from "node:child_process";
import { createHmac, timingSafeEqual } from "node:crypto";

export type IssueState = "OPEN" | "CLOSED" | string;
export type PullRequestState = "OPEN" | "CLOSED" | "MERGED" | string;
export type ReviewState = "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | string;

export interface GhIssue {
  number: number;
  title: string;
  body: string;
  labels: string[];
  state: IssueState;
  url?: string;
}

export interface GhPullRequest {
  number: number;
  title: string;
  body: string;
  url?: string;
  state: PullRequestState;
  headRefName: string;
  baseRefName: string;
  headRefOid?: string;
  isDraft?: boolean;
  mergeCommitOid?: string;
  /** Explicit GitHub relationship from closing keywords, never inferred from
   * branch names or title/body similarity. Read-only consumers use this to
   * correlate delivery evidence to an issue even when a non-default PR base
   * means GitHub has not closed the issue yet. */
  closingIssueNumbers?: number[];
}

export interface GhReview {
  state: ReviewState;
  body: string;
  commitId?: string;
  submittedAt?: string;
  author?: string;
}

export interface CreatePrInput {
  head: string;
  base: string;
  title: string;
  body: string;
  draft?: boolean;
}

export interface CreateReviewInput {
  state: "approve" | "request_changes" | "comment";
  body: string;
  /** Content-bound delivery fence. The adapter refuses to publish if the PR
   * head no longer equals the commit the orchestrator reviewed. */
  expectedCommit?: string;
}

export interface SquashMergeInput {
  subject: string;
  body?: string;
  matchHeadCommit?: string;
}

export interface ListIssueOptions {
  labels?: string[];
  state?: "open" | "closed" | "all";
  limit?: number;
}

export interface ListPullRequestOptions {
  state?: "open" | "closed" | "merged" | "all";
  limit?: number;
}

export interface GhIssueComment {
  body: string;
  /** ISO timestamp; absent when the backend does not report it. */
  createdAt?: string;
}

export interface CreateIssueInput {
  title: string;
  body: string;
  labels: string[];
}

export interface EnsureLabelInput {
  name: string;
  color: string;
  description: string;
}

export interface GhOps {
  addLabel(issueNumber: number, label: string): Promise<void>;
  removeLabel(issueNumber: number, label: string): Promise<void>;
  swapLabel(issueNumber: number, removeLabel: string, addLabel: string): Promise<void>;
  commentIssue(issueNumber: number, body: string): Promise<void>;
  /** Orchestrator-owned ticket publication (Stage 4): create an issue with a
   *  validated body and canonical labels. */
  createIssue(input: CreateIssueInput): Promise<GhIssue>;
  updateIssueBody(issueNumber: number, body: string): Promise<void>;
  /** Idempotently create-or-update a repo label — the loop's label contract
   *  must exist before the first `op:ready -> op:building` swap. */
  ensureLabel(input: EnsureLabelInput): Promise<void>;
  /** Read the repository label definitions for token-free onboarding
   *  verification. */
  listLabels(): Promise<EnsureLabelInput[]>;
  /** All comments on the issue, oldest first — the durable artifacts
   *  (contract, review verdicts, fix resolutions) that rehydration reads back
   *  on a re-claim (proportionality campaign Stage 2). */
  listIssueComments(issueNumber: number): Promise<GhIssueComment[]>;
  listIssues(options?: ListIssueOptions): Promise<GhIssue[]>;
  readIssue(issueNumber: number): Promise<GhIssue>;
  /** Close a tracked issue without changing its body or labels. Used by the
   *  explicit app-reset lifecycle command, never by an agent turn. */
  closeIssue(issueNumber: number): Promise<void>;
  createPR(input: CreatePrInput): Promise<GhPullRequest>;
  readPR(selector: number | string): Promise<GhPullRequest>;
  /** Enumerate PRs for an explicit operator lifecycle operation. The build
   *  loop itself deliberately uses the narrower branch lookup below. */
  listPullRequests(options?: ListPullRequestOptions): Promise<GhPullRequest[]>;
  listPRsForBranch(branch: string, options?: ListPullRequestOptions): Promise<GhPullRequest[]>;
  /** Close a tracked PR without merging it. */
  closePullRequest(prNumber: number): Promise<void>;
  createReview(prNumber: number, input: CreateReviewInput): Promise<GhReview>;
  listReviews(prNumber: number): Promise<GhReview[]>;
  squashMerge(prNumber: number, input: SquashMergeInput): Promise<GhPullRequest>;
  deleteBranch(branch: string): Promise<void>;
}

const SELF_APPROVAL_FALLBACK_PREFIX = "<!-- operon:self-approval-fallback";
export const SELF_APPROVAL_FALLBACK_MARKER = `${SELF_APPROVAL_FALLBACK_PREFIX} -->`;
export const SELF_CHANGES_REQUESTED_FALLBACK_MARKER =
  "<!-- operon:self-changes-requested-fallback -->";

// The self-approval fallback (single-account pilot: GitHub rejects approving
// your own PR) must not be authorizable by a static, repo-visible string —
// anyone who can post a review (including a prompt-injected builder) could then
// forge a merge. The trusted marker carries an HMAC, computed with an operator
// secret the sandboxed agent cannot read, over BOTH the PR number AND the
// reviewed commit (headRefOid).
//
// Binding the commit is what defeats replay (A-001): the marker line is
// published into a world-readable PR review, so a prompt-injected builder can
// copy it, push arbitrary code, and post it again on a new --comment review.
// GitHub stamps that replayed review's commit_id to the NEW head, so
// verification (loop.ts, against review.commitId) recomputes the HMAC over the
// new commit and rejects a marker minted for the old one. A bare marker, a
// mis-signed tag, an unset secret, or an unresolved reviewed commit is never
// trusted.

export function signSelfApproval(secret: string, prNumber: number, commit: string): string {
  return createHmac("sha256", secret)
    .update(`operon-self-approval:${prNumber}:${commit}`)
    .digest("hex");
}

/** Build the self-approval marker line. With a secret AND the resolved reviewed
 *  commit it carries the commit-bound HMAC tag; without either it is the bare
 *  (untrusted) marker — the loop fails closed. */
export function selfApprovalMarker(
  secret: string | undefined,
  prNumber: number,
  commit: string | undefined,
): string {
  if (secret === undefined || commit === undefined) return SELF_APPROVAL_FALLBACK_MARKER;
  return `${SELF_APPROVAL_FALLBACK_PREFIX} sig=${signSelfApproval(secret, prNumber, commit)} -->`;
}

/** True only for a marker carrying a valid HMAC tag for THIS PR and THIS
 *  reviewed commit. A bare marker, a mis-signed tag, an unset secret, or an
 *  unknown reviewed commit is never trusted. */
export function verifiedSelfApprovalMarker(
  body: string,
  secret: string | undefined,
  prNumber: number,
  commit: string | undefined,
): boolean {
  if (secret === undefined || commit === undefined) return false;
  const match = new RegExp(`${escapeRegExp(SELF_APPROVAL_FALLBACK_PREFIX)}\\s+sig=([0-9a-f]+)\\s+-->`).exec(
    body,
  );
  const candidate = match?.[1];
  if (candidate === undefined) return false;
  const expected = signSelfApproval(secret, prNumber, commit);
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(candidate, "hex"), Buffer.from(expected, "hex"));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface GhExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type GhExec = (args: readonly string[], input?: string) => Promise<GhExecResult>;

export interface GhOpsErrorDetails {
  args: readonly string[];
  stdout: string;
  stderr: string;
  exitCode: number;
  code?: string;
}

export class GhOpsError extends Error {
  readonly args: readonly string[];
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly code?: string;

  constructor(message: string, details: GhOpsErrorDetails) {
    const suffix = details.stderr.trim().length > 0 ? `\n${details.stderr}` : "";
    super(`${message}${suffix}`);
    this.name = "GhOpsError";
    this.args = details.args;
    this.stdout = details.stdout;
    this.stderr = details.stderr;
    this.exitCode = details.exitCode;
    if (details.code !== undefined) this.code = details.code;
  }
}

const ISSUE_FIELDS = "number,title,body,labels,state,url";
const PR_FIELDS = [
  "number",
  "title",
  "body",
  "url",
  "state",
  "headRefName",
  "headRefOid",
  "baseRefName",
  "isDraft",
  "mergeCommit",
  "closingIssuesReferences",
].join(",");

export class GhCliOps implements GhOps {
  readonly repo: string;
  private readonly exec: GhExec;
  private readonly selfApprovalSecret?: string;

  constructor(repo: string, exec: GhExec = defaultGhExec, selfApprovalSecret?: string) {
    this.repo = repo;
    this.exec = exec;
    if (selfApprovalSecret !== undefined) this.selfApprovalSecret = selfApprovalSecret;
  }

  async addLabel(issueNumber: number, label: string): Promise<void> {
    await this.run(["issue", "edit", String(issueNumber), "--repo", this.repo, "--add-label", label]);
  }

  async removeLabel(issueNumber: number, label: string): Promise<void> {
    await this.run([
      "issue",
      "edit",
      String(issueNumber),
      "--repo",
      this.repo,
      "--remove-label",
      label,
    ]);
  }

  async swapLabel(issueNumber: number, removeLabel: string, addLabel: string): Promise<void> {
    await this.run([
      "issue",
      "edit",
      String(issueNumber),
      "--repo",
      this.repo,
      "--add-label",
      addLabel,
      "--remove-label",
      removeLabel,
    ]);
  }

  async commentIssue(issueNumber: number, body: string): Promise<void> {
    await this.run(
      ["issue", "comment", String(issueNumber), "--repo", this.repo, "--body-file", "-"],
      body,
    );
  }

  async listIssues(options: ListIssueOptions = {}): Promise<GhIssue[]> {
    const args = [
      "issue",
      "list",
      "--repo",
      this.repo,
      "--state",
      options.state ?? "open",
      "--limit",
      String(options.limit ?? 100),
      "--json",
      ISSUE_FIELDS,
    ];
    for (const label of options.labels ?? []) args.push("--label", label);
    return parseIssueList(await this.runJson(args));
  }

  async readIssue(issueNumber: number): Promise<GhIssue> {
    return parseIssue(
      await this.runJson([
        "issue",
        "view",
        String(issueNumber),
        "--repo",
        this.repo,
        "--json",
        ISSUE_FIELDS,
      ]),
    );
  }

  async closeIssue(issueNumber: number): Promise<void> {
    await this.run(["issue", "close", String(issueNumber), "--repo", this.repo]);
  }

  async createIssue(input: CreateIssueInput): Promise<GhIssue> {
    const args = ["issue", "create", "--repo", this.repo, "--title", input.title, "--body-file", "-"];
    for (const label of input.labels) args.push("--label", label);
    const { stdout } = await this.run(args, input.body);
    const match = /\/issues\/(\d+)\s*$/.exec(stdout.trim());
    if (match === null) {
      throw new GhOpsError("issue create returned no issue URL", {
        args,
        stdout,
        stderr: "",
        exitCode: 0,
      });
    }
    return this.readIssue(Number(match[1]));
  }

  async updateIssueBody(issueNumber: number, body: string): Promise<void> {
    await this.run(
      ["issue", "edit", String(issueNumber), "--repo", this.repo, "--body-file", "-"],
      body,
    );
  }

  async ensureLabel(input: EnsureLabelInput): Promise<void> {
    // --force updates an existing label in place — idempotent by contract.
    await this.run([
      "label",
      "create",
      input.name,
      "--repo",
      this.repo,
      "--color",
      input.color,
      "--description",
      input.description,
      "--force",
    ]);
  }

  async listLabels(): Promise<EnsureLabelInput[]> {
    const raw = await this.runJson([
      "label",
      "list",
      "--repo",
      this.repo,
      "--limit",
      "100",
      "--json",
      "name,color,description",
    ]);
    if (!Array.isArray(raw)) throw new Error("gh label list returned a non-array response");
    return raw.map((value, index) => parseLabelDefinition(value, index));
  }

  async listIssueComments(issueNumber: number): Promise<GhIssueComment[]> {
    const raw = (await this.runJson([
      "issue",
      "view",
      String(issueNumber),
      "--repo",
      this.repo,
      "--json",
      "comments",
    ])) as { comments?: { body?: unknown; createdAt?: unknown }[] };
    return (raw.comments ?? [])
      .filter((comment) => typeof comment.body === "string")
      .map((comment) => ({
        body: comment.body as string,
        ...(typeof comment.createdAt === "string" ? { createdAt: comment.createdAt } : {}),
      }));
  }

  async createPR(input: CreatePrInput): Promise<GhPullRequest> {
    const args = [
      "pr",
      "create",
      "--repo",
      this.repo,
      "--head",
      input.head,
      "--base",
      input.base,
      "--title",
      input.title,
      "--body-file",
      "-",
    ];
    if (input.draft === true) args.push("--draft");
    const created = await this.run(args, input.body);
    const selector = created.stdout.trim().length > 0 ? created.stdout.trim() : input.head;
    return this.readPR(selector);
  }

  async readPR(selector: number | string): Promise<GhPullRequest> {
    return parsePullRequest(
      await this.runJson([
        "pr",
        "view",
        String(selector),
        "--repo",
        this.repo,
        "--json",
        PR_FIELDS,
      ]),
    );
  }

  async listPullRequests(options: ListPullRequestOptions = {}): Promise<GhPullRequest[]> {
    return parsePullRequestList(
      await this.runJson([
        "pr",
        "list",
        "--repo",
        this.repo,
        "--state",
        options.state ?? "open",
        "--limit",
        String(options.limit ?? 100),
        "--json",
        PR_FIELDS,
      ]),
    );
  }

  async listPRsForBranch(
    branch: string,
    options: ListPullRequestOptions = {},
  ): Promise<GhPullRequest[]> {
    return parsePullRequestList(
      await this.runJson([
        "pr",
        "list",
        "--repo",
        this.repo,
        "--head",
        branch,
        "--state",
        options.state ?? "all",
        "--limit",
        String(options.limit ?? 100),
        "--json",
        PR_FIELDS,
      ]),
    );
  }

  async closePullRequest(prNumber: number): Promise<void> {
    await this.run(["pr", "close", String(prNumber), "--repo", this.repo]);
  }

  async createReview(prNumber: number, input: CreateReviewInput): Promise<GhReview> {
    let reviewedCommit = input.expectedCommit;
    if (input.expectedCommit !== undefined) {
      const current = (await this.readPR(prNumber)).headRefOid;
      if (current !== input.expectedCommit) {
        throw new Error(
          `refusing to publish review for PR #${prNumber}: expected head ${input.expectedCommit}, got ${current ?? "unresolved"}`,
        );
      }
    }
    const flag =
      input.state === "approve"
        ? "--approve"
        : input.state === "request_changes"
          ? "--request-changes"
          : "--comment";
    try {
      await this.run(
        ["pr", "review", String(prNumber), "--repo", this.repo, flag, "--body-file", "-"],
        input.body,
      );
    } catch (error) {
      if (input.state === "request_changes" && isSelfChangesRequestedError(error)) {
        const body = `${input.body.trimEnd()}\n\n${SELF_CHANGES_REQUESTED_FALLBACK_MARKER}\n`;
        await this.run(
          ["pr", "review", String(prNumber), "--repo", this.repo, "--comment", "--body-file", "-"],
          body,
        );
        return {
          state: "COMMENTED",
          body,
          ...(reviewedCommit === undefined ? {} : { commitId: reviewedCommit }),
        };
      }
      if (input.state !== "approve" || !isSelfApprovalError(error)) throw error;
      // Bind the marker to the exact commit under review so it cannot be
      // replayed on a later push (A-001). GitHub stamps the fallback comment
      // review's commit_id to the current PR head, which is what verification
      // checks against — so sign that same head. If the head cannot be
      // resolved (or no secret is configured), fall back to the bare
      // (untrusted) marker and let the loop fail closed.
      //
      // Benign TOCTOU (availability, not security): there is an unavoidable gap
      // between reading headRefOid here and GitHub stamping commit_id when the
      // --comment review posts below. If the PR head advances in that window
      // (a concurrent push), GitHub stamps the review at the NEW head while the
      // marker is signed over the OLD head, so verification mismatches and this
      // legitimate self-approval fails. That is fail-closed by design: a stale
      // signature is rejected, never accepted — the worst case is that a
      // legitimate merge waits for a human tap; an attacker gains nothing (they
      // cannot make us sign a head we did not read). Do NOT "fix" this by
      // re-reading the head after posting: the
      // marker must commit to a head BEFORE the review exists, or the binding
      // is meaningless.
      if (reviewedCommit === undefined && this.selfApprovalSecret !== undefined) {
        reviewedCommit = (await this.readPR(prNumber)).headRefOid;
      }
      const marker = selfApprovalMarker(this.selfApprovalSecret, prNumber, reviewedCommit);
      const body = `${input.body.trimEnd()}\n\n${marker}\n`;
      await this.run(
        ["pr", "review", String(prNumber), "--repo", this.repo, "--comment", "--body-file", "-"],
        body,
      );
      return {
        state: "COMMENTED",
        body,
        ...(reviewedCommit === undefined ? {} : { commitId: reviewedCommit }),
      };
    }
    return {
      state:
        input.state === "approve"
          ? "APPROVED"
          : input.state === "request_changes"
            ? "CHANGES_REQUESTED"
            : "COMMENTED",
      body: input.body,
      ...(reviewedCommit === undefined ? {} : { commitId: reviewedCommit }),
    };
  }

  async listReviews(prNumber: number): Promise<GhReview[]> {
    const raw = await this.runJson([
      "pr",
      "view",
      String(prNumber),
      "--repo",
      this.repo,
      "--json",
      "reviews",
    ]);
    const record = asRecord(raw, "gh pr view reviews output");
    const reviews = record["reviews"];
    if (!Array.isArray(reviews)) throw new Error("gh pr view reviews output: reviews is not a list");
    return reviews.map(parseReview);
  }

  async squashMerge(prNumber: number, input: SquashMergeInput): Promise<GhPullRequest> {
    const args = [
      "pr",
      "merge",
      String(prNumber),
      "--repo",
      this.repo,
      "--squash",
      "--subject",
      input.subject,
    ];
    if (input.body !== undefined) args.push("--body", input.body);
    if (input.matchHeadCommit !== undefined) {
      args.push("--match-head-commit", input.matchHeadCommit);
    }
    try {
      await this.run(args);
    } catch (error) {
      if (error instanceof GhOpsError && /conflict|mergeable|not merge/i.test(error.stderr)) {
        throw new GhOpsError("gh squash merge failed with a merge conflict", {
          args: error.args,
          stdout: error.stdout,
          stderr: error.stderr,
          exitCode: error.exitCode,
          code: "merge_conflict",
        });
      }
      throw error;
    }
    return this.readPR(prNumber);
  }

  async deleteBranch(branch: string): Promise<void> {
    await this.run(["api", "-X", "DELETE", `repos/${this.repo}/git/refs/heads/${branch}`]);
  }

  private async run(args: readonly string[], input?: string): Promise<GhExecResult> {
    const result = await this.exec(args, input);
    if (result.exitCode !== 0) {
      throw new GhOpsError(`gh ${args.join(" ")} failed with exit ${result.exitCode}`, {
        args,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
      });
    }
    return result;
  }

  private async runJson(args: readonly string[], input?: string): Promise<unknown> {
    const result = await this.run(args, input);
    try {
      return JSON.parse(result.stdout) as unknown;
    } catch (error) {
      throw new Error(
        `gh ${args.join(" ")} did not return valid JSON: ` +
          `${error instanceof Error ? error.message : String(error)}\n${result.stdout}`,
      );
    }
  }
}

function isSelfApprovalError(error: unknown): boolean {
  return (
    error instanceof GhOpsError &&
    /can not approve your own pull request|cannot approve your own pull request/i.test(
      error.stderr,
    )
  );
}

function isSelfChangesRequestedError(error: unknown): boolean {
  return (
    error instanceof GhOpsError &&
    /can not request changes on your own pull request|cannot request changes on your own pull request/i.test(
      error.stderr,
    )
  );
}

export function isMergeConflict(error: unknown): boolean {
  return error instanceof GhOpsError && error.code === "merge_conflict";
}

function defaultGhExec(args: readonly string[], input?: string): Promise<GhExecResult> {
  return new Promise((resolve) => {
    const child = spawn("gh", [...args], {
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      resolve({ stdout, stderr: stderr + error.message, exitCode: 1 });
    });
    child.on("close", (code) => {
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });
    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
  });
}

function parseIssueList(raw: unknown): GhIssue[] {
  if (!Array.isArray(raw)) throw new Error("gh issue list output is not a list");
  return raw.map(parseIssue);
}

function parseLabelDefinition(raw: unknown, index: number): EnsureLabelInput {
  const where = `gh label list output[${index}]`;
  const record = asRecord(raw, where);
  return {
    name: stringField(record, "name", where),
    color: stringField(record, "color", where),
    description: stringField(record, "description", where, ""),
  };
}

function parseIssue(raw: unknown): GhIssue {
  const record = asRecord(raw, "gh issue output");
  return {
    number: numberField(record, "number", "gh issue output"),
    title: stringField(record, "title", "gh issue output"),
    body: stringField(record, "body", "gh issue output", ""),
    labels: parseLabels(record["labels"]),
    state: stringField(record, "state", "gh issue output", "OPEN"),
    ...(typeof record["url"] === "string" ? { url: record["url"] } : {}),
  };
}

function parsePullRequestList(raw: unknown): GhPullRequest[] {
  if (!Array.isArray(raw)) throw new Error("gh pr list output is not a list");
  return raw.map(parsePullRequest);
}

function parsePullRequest(raw: unknown): GhPullRequest {
  const record = asRecord(raw, "gh pr output");
  const mergeCommit = record["mergeCommit"];
  const mergeCommitOid =
    mergeCommit && typeof mergeCommit === "object" && !Array.isArray(mergeCommit)
      ? (mergeCommit as Record<string, unknown>)["oid"]
      : undefined;
  const closingIssues = record["closingIssuesReferences"];
  const closingIssueNumbers = Array.isArray(closingIssues)
    ? closingIssues.flatMap((value) => {
        if (value === null || typeof value !== "object" || Array.isArray(value)) return [];
        const number = (value as Record<string, unknown>)["number"];
        return typeof number === "number" ? [number] : [];
      })
    : [];
  return {
    number: numberField(record, "number", "gh pr output"),
    title: stringField(record, "title", "gh pr output"),
    body: stringField(record, "body", "gh pr output", ""),
    state: stringField(record, "state", "gh pr output", "OPEN"),
    headRefName: stringField(record, "headRefName", "gh pr output"),
    // No default: `gh` always reports the base when asked for it, and guessing
    // `main` for a repo whose base is `master` silently records the wrong
    // merge target. A missing field is a malformed response, so say so (#101).
    baseRefName: stringField(record, "baseRefName", "gh pr output"),
    ...(typeof record["url"] === "string" ? { url: record["url"] } : {}),
    ...(typeof record["headRefOid"] === "string" ? { headRefOid: record["headRefOid"] } : {}),
    ...(typeof record["isDraft"] === "boolean" ? { isDraft: record["isDraft"] } : {}),
    ...(typeof mergeCommitOid === "string" ? { mergeCommitOid } : {}),
    ...(closingIssueNumbers.length > 0 ? { closingIssueNumbers } : {}),
  };
}

function parseReview(raw: unknown): GhReview {
  const record = asRecord(raw, "gh review output");
  const commit = record["commit"];
  const commitId =
    typeof record["commitId"] === "string"
      ? record["commitId"]
      : typeof record["commit_id"] === "string"
        ? record["commit_id"]
        : commit && typeof commit === "object" && !Array.isArray(commit)
          ? (commit as Record<string, unknown>)["oid"]
          : undefined;
  const author = record["author"];
  const login =
    author && typeof author === "object" && !Array.isArray(author)
      ? (author as Record<string, unknown>)["login"]
      : undefined;
  return {
    state: stringField(record, "state", "gh review output"),
    body: stringField(record, "body", "gh review output", ""),
    ...(typeof commitId === "string" ? { commitId } : {}),
    ...(typeof record["submittedAt"] === "string" ? { submittedAt: record["submittedAt"] } : {}),
    ...(typeof login === "string" ? { author: login } : {}),
  };
}

function parseLabels(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((label) => {
      if (typeof label === "string") return label;
      if (label && typeof label === "object" && !Array.isArray(label)) {
        const name = (label as Record<string, unknown>)["name"];
        if (typeof name === "string") return name;
      }
      return undefined;
    })
    .filter((label): label is string => label !== undefined);
}

function asRecord(raw: unknown, where: string): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`${where}: expected object`);
  }
  return raw as Record<string, unknown>;
}

function stringField(
  record: Record<string, unknown>,
  key: string,
  where: string,
  fallback?: string,
): string {
  const value = record[key];
  if (typeof value === "string") return value;
  if (fallback !== undefined) return fallback;
  throw new Error(`${where}: ${key} is required`);
}

function numberField(record: Record<string, unknown>, key: string, where: string): number {
  const value = record[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  throw new Error(`${where}: ${key} is required`);
}
