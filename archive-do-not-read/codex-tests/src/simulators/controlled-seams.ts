import type {
  CreateIssueInput,
  CreatePrInput,
  CreateReviewInput,
  EnsureLabelInput,
  GhIssue,
  GhIssueComment,
  GhOps,
  GhPullRequest,
  GhReview,
  ListIssueOptions,
  ListPullRequestOptions,
  SquashMergeInput,
} from "../../../src/loop/github.js";
import { GhOpsError } from "../../../src/loop/github.js";
import type { AppEntry } from "../../../src/org/apps.js";
import type { GitHubEventSource } from "../../../src/org/events.js";
import type {
  SchedulerHostCommand,
  SchedulerHostCommandRunner,
} from "../../../src/org/scheduler/manager.js";

export type ControlledFault =
  | "unavailable"
  | "rate_limited"
  | "timeout_before_write"
  | "timeout_after_write"
  | "partial_success"
  | "stale_read"
  | "version_skew";

interface QueuedFault {
  operation: string;
  fault: ControlledFault;
}

export interface ControlledOperation {
  sequence: number;
  operation: string;
  outcome: "read" | "written" | "refused" | "ambiguous" | "stale";
}

interface GitHubSnapshot {
  issues: Map<number, GhIssue>;
  comments: Map<number, GhIssueComment[]>;
  pullRequests: Map<number, GhPullRequest>;
  reviews: Map<number, GhReview[]>;
  labels: Map<string, EnsureLabelInput>;
  deletedBranches: Set<string>;
}

/**
 * A stateful boundary double for the GhOps contract. It owns only simulated
 * remote state and faults; production orchestration remains real.
 */
export class StatefulGitHubSimulator implements GhOps {
  readonly operations: ControlledOperation[] = [];
  apiVersion = 1;

  private readonly faults: QueuedFault[] = [];
  private state: GitHubSnapshot = emptyGitHubSnapshot();
  private previousState: GitHubSnapshot = emptyGitHubSnapshot();
  private nextIssueNumber = 1;
  private nextPullRequestNumber = 1;

  queueFault(operation: string, fault: ControlledFault): void {
    this.faults.push({ operation, fault });
  }

  seedIssue(issue: GhIssue): void {
    this.previousState = cloneGitHubSnapshot(this.state);
    this.state.issues.set(issue.number, cloneIssue(issue));
    this.nextIssueNumber = Math.max(this.nextIssueNumber, issue.number + 1);
  }

  issueCount(): number {
    return this.state.issues.size;
  }

  operationCount(operation: string): number {
    return this.operations.filter((entry) => entry.operation === operation).length;
  }

  async addLabel(issueNumber: number, label: string): Promise<void> {
    this.mutate("addLabel", () => {
      const issue = this.mustIssue(issueNumber);
      issue.labels = [...new Set([...issue.labels, label])].sort();
    });
  }

  async removeLabel(issueNumber: number, label: string): Promise<void> {
    this.mutate("removeLabel", () => {
      const issue = this.mustIssue(issueNumber);
      issue.labels = issue.labels.filter((value) => value !== label);
    });
  }

  async swapLabel(issueNumber: number, removeLabel: string, addLabel: string): Promise<void> {
    const fault = this.takeFault("swapLabel");
    this.refuseBeforeWrite("swapLabel", fault);
    this.previousState = cloneGitHubSnapshot(this.state);
    const issue = this.mustIssue(issueNumber);
    issue.labels = issue.labels.filter((value) => value !== removeLabel);
    if (fault === "partial_success") {
      this.record("swapLabel", "ambiguous");
      this.throwFault("swapLabel", fault);
    }
    issue.labels = [...new Set([...issue.labels, addLabel])].sort();
    this.finishMutation("swapLabel", fault);
  }

  async commentIssue(issueNumber: number, body: string): Promise<void> {
    this.mutate("commentIssue", () => {
      this.mustIssue(issueNumber);
      const comments = this.state.comments.get(issueNumber) ?? [];
      comments.push({ body });
      this.state.comments.set(issueNumber, comments);
    });
  }

  async createIssue(input: CreateIssueInput): Promise<GhIssue> {
    return this.mutate("createIssue", () => {
      const number = this.nextIssueNumber;
      this.nextIssueNumber += 1;
      const issue: GhIssue = {
        number,
        title: input.title,
        body: input.body,
        labels: [...new Set(input.labels)].sort(),
        state: "OPEN",
        url: `https://github.invalid/controlled/issues/${number}`,
      };
      this.state.issues.set(number, issue);
      return cloneIssue(issue);
    });
  }

  async updateIssueBody(issueNumber: number, body: string): Promise<void> {
    this.mutate("updateIssueBody", () => {
      this.mustIssue(issueNumber).body = body;
    });
  }

  async ensureLabel(input: EnsureLabelInput): Promise<void> {
    this.mutate("ensureLabel", () => {
      this.state.labels.set(input.name, { ...input });
    });
  }

  async listLabels(): Promise<EnsureLabelInput[]> {
    const snapshot = this.readSnapshot("listLabels");
    return [...snapshot.labels.values()].map((label) => ({ ...label })).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
  }

  async listIssueComments(issueNumber: number): Promise<GhIssueComment[]> {
    const snapshot = this.readSnapshot("listIssueComments");
    if (!snapshot.issues.has(issueNumber)) this.throwNotFound("listIssueComments", issueNumber);
    return (snapshot.comments.get(issueNumber) ?? []).map((comment) => ({ ...comment }));
  }

  async listIssues(options: ListIssueOptions = {}): Promise<GhIssue[]> {
    const snapshot = this.readSnapshot("listIssues");
    const state = options.state ?? "open";
    const labels = options.labels ?? [];
    return [...snapshot.issues.values()]
      .filter((issue) => state === "all" || issue.state.toLowerCase() === state)
      .filter((issue) => labels.every((label) => issue.labels.includes(label)))
      .sort((a, b) => a.number - b.number)
      .slice(0, options.limit ?? Number.POSITIVE_INFINITY)
      .map(cloneIssue);
  }

  async readIssue(issueNumber: number): Promise<GhIssue> {
    const snapshot = this.readSnapshot("readIssue");
    const issue = snapshot.issues.get(issueNumber);
    if (issue === undefined) this.throwNotFound("readIssue", issueNumber);
    return cloneIssue(issue);
  }

  async closeIssue(issueNumber: number): Promise<void> {
    this.mutate("closeIssue", () => {
      this.mustIssue(issueNumber).state = "CLOSED";
    });
  }

  async createPR(input: CreatePrInput): Promise<GhPullRequest> {
    return this.mutate("createPR", () => {
      const number = this.nextPullRequestNumber;
      this.nextPullRequestNumber += 1;
      const pullRequest: GhPullRequest = {
        number,
        title: input.title,
        body: input.body,
        state: "OPEN",
        headRefName: input.head,
        baseRefName: input.base,
        headRefOid: `controlled-${number}-head`,
        isDraft: input.draft ?? false,
        url: `https://github.invalid/controlled/pull/${number}`,
      };
      this.state.pullRequests.set(number, pullRequest);
      return clonePullRequest(pullRequest);
    });
  }

  async updatePullRequestBody(prNumber: number, body: string): Promise<void> {
    this.mutate("updatePullRequestBody", () => {
      this.mustPullRequest(prNumber).body = body;
    });
  }

  async readPR(selector: number | string): Promise<GhPullRequest> {
    const snapshot = this.readSnapshot("readPR");
    const pullRequest = typeof selector === "number"
      ? snapshot.pullRequests.get(selector)
      : [...snapshot.pullRequests.values()].find((candidate) => candidate.headRefName === selector);
    if (pullRequest === undefined) this.throwNotFound("readPR", selector);
    return clonePullRequest(pullRequest);
  }

  async listPullRequests(options: ListPullRequestOptions = {}): Promise<GhPullRequest[]> {
    const snapshot = this.readSnapshot("listPullRequests");
    return filterPullRequests(snapshot, options).map(clonePullRequest);
  }

  async listPRsForBranch(
    branch: string,
    options: ListPullRequestOptions = {},
  ): Promise<GhPullRequest[]> {
    const snapshot = this.readSnapshot("listPRsForBranch");
    return filterPullRequests(snapshot, options)
      .filter((pullRequest) => pullRequest.headRefName === branch)
      .map(clonePullRequest);
  }

  async closePullRequest(prNumber: number): Promise<void> {
    this.mutate("closePullRequest", () => {
      this.mustPullRequest(prNumber).state = "CLOSED";
    });
  }

  async createReview(prNumber: number, input: CreateReviewInput): Promise<GhReview> {
    return this.mutate("createReview", () => {
      const pullRequest = this.mustPullRequest(prNumber);
      if (
        input.expectedCommit !== undefined &&
        input.expectedCommit !== pullRequest.headRefOid
      ) {
        throw new Error("controlled GitHub review rejected a stale expected commit");
      }
      const review: GhReview = {
        state:
          input.state === "approve"
            ? "APPROVED"
            : input.state === "request_changes"
              ? "CHANGES_REQUESTED"
              : "COMMENTED",
        body: input.body,
        ...(pullRequest.headRefOid !== undefined ? { commitId: pullRequest.headRefOid } : {}),
      };
      const reviews = this.state.reviews.get(prNumber) ?? [];
      reviews.push(review);
      this.state.reviews.set(prNumber, reviews);
      return { ...review };
    });
  }

  async listReviews(prNumber: number): Promise<GhReview[]> {
    const snapshot = this.readSnapshot("listReviews");
    if (!snapshot.pullRequests.has(prNumber)) this.throwNotFound("listReviews", prNumber);
    return (snapshot.reviews.get(prNumber) ?? []).map((review) => ({ ...review }));
  }

  async squashMerge(prNumber: number, input: SquashMergeInput): Promise<GhPullRequest> {
    return this.mutate("squashMerge", () => {
      const pullRequest = this.mustPullRequest(prNumber);
      if (
        input.matchHeadCommit !== undefined &&
        pullRequest.headRefOid !== input.matchHeadCommit
      ) {
        throw new Error("controlled GitHub merge rejected a stale head commit");
      }
      pullRequest.state = "MERGED";
      pullRequest.mergeCommitOid = `controlled-${prNumber}-merge`;
      return clonePullRequest(pullRequest);
    });
  }

  async deleteBranch(branch: string): Promise<void> {
    this.mutate("deleteBranch", () => {
      this.state.deletedBranches.add(branch);
    });
  }

  private readSnapshot(operation: string): GitHubSnapshot {
    const fault = this.takeFault(operation);
    this.refuseBeforeWrite(operation, fault);
    if (fault === "stale_read") {
      this.record(operation, "stale");
      return cloneGitHubSnapshot(this.previousState);
    }
    this.record(operation, "read");
    return cloneGitHubSnapshot(this.state);
  }

  private mutate<T>(operation: string, apply: () => T): T {
    const fault = this.takeFault(operation);
    this.refuseBeforeWrite(operation, fault);
    this.previousState = cloneGitHubSnapshot(this.state);
    const result = apply();
    this.finishMutation(operation, fault);
    return result;
  }

  private finishMutation(operation: string, fault: ControlledFault | undefined): void {
    if (fault === "timeout_after_write" || fault === "partial_success") {
      this.record(operation, "ambiguous");
      this.throwFault(operation, fault);
    }
    this.record(operation, "written");
  }

  private refuseBeforeWrite(operation: string, fault: ControlledFault | undefined): void {
    if (
      fault === "unavailable" ||
      fault === "rate_limited" ||
      fault === "timeout_before_write" ||
      fault === "version_skew"
    ) {
      this.record(operation, "refused");
      this.throwFault(operation, fault);
    }
  }

  private takeFault(operation: string): ControlledFault | undefined {
    const index = this.faults.findIndex(
      (candidate) => candidate.operation === operation || candidate.operation === "*",
    );
    if (index < 0) return undefined;
    return this.faults.splice(index, 1)[0]!.fault;
  }

  private throwFault(operation: string, fault: ControlledFault): never {
    const message = {
      unavailable: "controlled GitHub API unavailable",
      rate_limited: "controlled GitHub API rate limited",
      timeout_before_write: "controlled GitHub timeout before write",
      timeout_after_write: "controlled GitHub timeout after possible write",
      partial_success: "controlled GitHub partial success with unknown acknowledgement",
      stale_read: "controlled GitHub stale read",
      version_skew: `controlled GitHub API version ${this.apiVersion} is incompatible`,
    }[fault];
    throw new GhOpsError(`${operation}: ${message}`, {
      args: [operation],
      stdout: "",
      stderr: message,
      exitCode: fault === "rate_limited" ? 429 : 1,
      code: fault.includes("timeout") ? "ETIMEDOUT" : fault,
    });
  }

  private throwNotFound(operation: string, selector: string | number): never {
    throw new GhOpsError(`${operation}: controlled remote object ${selector} not found`, {
      args: [operation, String(selector)],
      stdout: "",
      stderr: "not found",
      exitCode: 404,
      code: "not_found",
    });
  }

  private mustIssue(issueNumber: number): GhIssue {
    const issue = this.state.issues.get(issueNumber);
    if (issue === undefined) this.throwNotFound("issue", issueNumber);
    return issue;
  }

  private mustPullRequest(prNumber: number): GhPullRequest {
    const pullRequest = this.state.pullRequests.get(prNumber);
    if (pullRequest === undefined) this.throwNotFound("pull request", prNumber);
    return pullRequest;
  }

  private record(operation: string, outcome: ControlledOperation["outcome"]): void {
    this.operations.push({
      sequence: this.operations.length + 1,
      operation,
      outcome,
    });
  }
}

type EventStream = "ticket-ready" | "pr-opened" | "ci-failed" | "release-shipped";

interface EventState {
  tickets: Array<{ issueNumber: number }>;
  pullRequests: Array<{ prNumber: number; headSha: string }>;
  checks: Array<{ sha: string; check: string }>;
  releases: Array<{ tag: string }>;
}

/** Stateful, versionable external event source composed through EventStore. */
export class StatefulEventSource implements GitHubEventSource {
  readonly calls: Array<{ stream: EventStream; app: string }> = [];
  private readonly current = new Map<string, EventState>();
  private readonly prior = new Map<string, EventState>();
  private readonly faults: Array<{ stream: EventStream; fault: "unavailable" | "stale_read" }> = [];

  publish(
    app: string,
    stream: EventStream,
    value:
      | { issueNumber: number }
      | { prNumber: number; headSha: string }
      | { sha: string; check: string }
      | { tag: string },
  ): void {
    const current = this.stateFor(app);
    this.prior.set(app, cloneEventState(current));
    if (stream === "ticket-ready") current.tickets.push(value as { issueNumber: number });
    if (stream === "pr-opened") {
      current.pullRequests.push(value as { prNumber: number; headSha: string });
    }
    if (stream === "ci-failed") current.checks.push(value as { sha: string; check: string });
    if (stream === "release-shipped") current.releases.push(value as { tag: string });
  }

  queueFault(stream: EventStream, fault: "unavailable" | "stale_read"): void {
    this.faults.push({ stream, fault });
  }

  async ticketReady(app: AppEntry): Promise<{ issueNumber: number }[]> {
    return this.read(app, "ticket-ready").tickets.map((value) => ({ ...value }));
  }

  async prOpened(app: AppEntry): Promise<{ prNumber: number; headSha: string }[]> {
    return this.read(app, "pr-opened").pullRequests.map((value) => ({ ...value }));
  }

  async ciFailed(app: AppEntry): Promise<{ sha: string; check: string }[]> {
    return this.read(app, "ci-failed").checks.map((value) => ({ ...value }));
  }

  async releaseShipped(app: AppEntry): Promise<{ tag: string }[]> {
    return this.read(app, "release-shipped").releases.map((value) => ({ ...value }));
  }

  private read(app: AppEntry, stream: EventStream): EventState {
    this.calls.push({ stream, app: app.name });
    const index = this.faults.findIndex((entry) => entry.stream === stream);
    const fault = index < 0 ? undefined : this.faults.splice(index, 1)[0]!.fault;
    if (fault === "unavailable") throw new Error(`controlled ${stream} source unavailable`);
    if (fault === "stale_read") {
      return cloneEventState(this.prior.get(app.name) ?? emptyEventState());
    }
    return cloneEventState(this.stateFor(app.name));
  }

  private stateFor(app: string): EventState {
    const existing = this.current.get(app);
    if (existing !== undefined) return existing;
    const created = emptyEventState();
    this.current.set(app, created);
    this.prior.set(app, cloneEventState(created));
    return created;
  }
}

export type ControlledProcessOutcome =
  | { kind: "success"; stdout?: string }
  | { kind: "refusal"; stderr?: string; code?: number }
  | { kind: "partial_success"; stdout: string; stderr: string }
  | { kind: "timeout" }
  | { kind: "hang" }
  | { kind: "ambiguous" };

/** Records host-command requests and supplies bounded process outcomes. */
export class ControlledProcessRunner {
  readonly calls: SchedulerHostCommand[] = [];
  private readonly outcomes: ControlledProcessOutcome[] = [];

  enqueue(outcome: ControlledProcessOutcome): void {
    this.outcomes.push(outcome);
  }

  readonly run: SchedulerHostCommandRunner = async (input) => {
    this.calls.push({ command: input.command, args: [...input.args] });
    const outcome = this.outcomes.shift();
    if (outcome === undefined) throw new Error("controlled process runner was not scripted");
    if (outcome.kind === "success") {
      return { code: 0, stdout: outcome.stdout ?? "", stderr: "" };
    }
    if (outcome.kind === "refusal") {
      return { code: outcome.code ?? 1, stdout: "", stderr: outcome.stderr ?? "refused" };
    }
    if (outcome.kind === "partial_success") {
      return { code: 1, stdout: outcome.stdout, stderr: outcome.stderr };
    }
    throw new ControlledProcessError(outcome.kind);
  };
}

export class ControlledProcessError extends Error {
  constructor(readonly outcome: "timeout" | "hang" | "ambiguous") {
    super(`controlled process outcome: ${outcome}`);
    this.name = "ControlledProcessError";
  }
}

export interface EffectRequest {
  operationId: string;
  target: string;
  payloadHash: string;
  marker: string;
}

export interface EffectAcknowledgement extends EffectRequest {
  remoteRef: string;
}

/** Idempotent external-effect target with explicit acknowledgement ambiguity. */
export class StatefulEffectTarget {
  readonly attempts: EffectRequest[] = [];
  private readonly effects = new Map<string, EffectAcknowledgement>();
  private readonly faults: Array<
    "reject" | "timeout_before_effect" | "timeout_after_effect" | "lost_acknowledgement"
  > = [];

  queueFault(
    fault: "reject" | "timeout_before_effect" | "timeout_after_effect" | "lost_acknowledgement",
  ): void {
    this.faults.push(fault);
  }

  execute(request: EffectRequest): EffectAcknowledgement {
    this.attempts.push({ ...request });
    const existing = this.effects.get(request.marker);
    if (existing !== undefined) {
      if (
        existing.operationId !== request.operationId ||
        existing.target !== request.target ||
        existing.payloadHash !== request.payloadHash
      ) {
        throw new Error("effect marker is already bound to different content");
      }
      return { ...existing };
    }
    const fault = this.faults.shift();
    if (fault === "reject") throw new Error("controlled effect target rejected the request");
    if (fault === "timeout_before_effect") {
      throw new Error("controlled effect target timed out before applying the effect");
    }
    const acknowledgement: EffectAcknowledgement = {
      ...request,
      remoteRef: `controlled://${request.target}/${request.operationId}`,
    };
    this.effects.set(request.marker, acknowledgement);
    if (fault === "timeout_after_effect" || fault === "lost_acknowledgement") {
      throw new Error(`controlled effect target ${fault.replaceAll("_", " ")}`);
    }
    return { ...acknowledgement };
  }

  reconcile(marker: string): EffectAcknowledgement | undefined {
    const acknowledgement = this.effects.get(marker);
    return acknowledgement === undefined ? undefined : { ...acknowledgement };
  }

  effectCount(): number {
    return this.effects.size;
  }
}

/** Small reproducible PRNG used only to order or select controlled stimuli. */
export class DeterministicRandom {
  private state: number;

  constructor(seed: number) {
    if (!Number.isInteger(seed)) throw new TypeError("deterministic random seed must be an integer");
    this.state = seed >>> 0;
  }

  next(): number {
    this.state = (Math.imul(this.state, 1_664_525) + 1_013_904_223) >>> 0;
    return this.state / 0x1_0000_0000;
  }

  pick<T>(values: readonly T[]): T {
    if (values.length === 0) throw new Error("cannot pick from an empty controlled set");
    return values[Math.floor(this.next() * values.length)]!;
  }
}

/** Copies only declared environment keys so ambient host state cannot leak in. */
export function boundedEnvironment(
  source: NodeJS.ProcessEnv,
  options: { allowed: readonly string[]; required?: readonly string[] },
): Readonly<Record<string, string>> {
  const allowed = new Set(options.allowed);
  const required = new Set(options.required ?? []);
  const result: Record<string, string> = {};
  for (const key of allowed) {
    const value = source[key];
    if (value !== undefined) result[key] = value;
  }
  for (const key of required) {
    if (result[key] === undefined) throw new Error(`required controlled environment key is missing: ${key}`);
  }
  return Object.freeze(result);
}

function emptyGitHubSnapshot(): GitHubSnapshot {
  return {
    issues: new Map(),
    comments: new Map(),
    pullRequests: new Map(),
    reviews: new Map(),
    labels: new Map(),
    deletedBranches: new Set(),
  };
}

function cloneGitHubSnapshot(snapshot: GitHubSnapshot): GitHubSnapshot {
  return {
    issues: new Map([...snapshot.issues].map(([id, issue]) => [id, cloneIssue(issue)])),
    comments: new Map(
      [...snapshot.comments].map(([id, comments]) => [
        id,
        comments.map((comment) => ({ ...comment })),
      ]),
    ),
    pullRequests: new Map(
      [...snapshot.pullRequests].map(([id, pullRequest]) => [
        id,
        clonePullRequest(pullRequest),
      ]),
    ),
    reviews: new Map(
      [...snapshot.reviews].map(([id, reviews]) => [
        id,
        reviews.map((review) => ({ ...review })),
      ]),
    ),
    labels: new Map([...snapshot.labels].map(([name, label]) => [name, { ...label }])),
    deletedBranches: new Set(snapshot.deletedBranches),
  };
}

function cloneIssue(issue: GhIssue): GhIssue {
  return { ...issue, labels: [...issue.labels] };
}

function clonePullRequest(pullRequest: GhPullRequest): GhPullRequest {
  return {
    ...pullRequest,
    ...(pullRequest.closingIssueNumbers !== undefined
      ? { closingIssueNumbers: [...pullRequest.closingIssueNumbers] }
      : {}),
  };
}

function filterPullRequests(
  snapshot: GitHubSnapshot,
  options: ListPullRequestOptions,
): GhPullRequest[] {
  const state = options.state ?? "open";
  return [...snapshot.pullRequests.values()]
    .filter((pullRequest) => state === "all" || pullRequest.state.toLowerCase() === state)
    .sort((a, b) => a.number - b.number)
    .slice(0, options.limit ?? Number.POSITIVE_INFINITY);
}

function emptyEventState(): EventState {
  return { tickets: [], pullRequests: [], checks: [], releases: [] };
}

function cloneEventState(state: EventState): EventState {
  return {
    tickets: state.tickets.map((value) => ({ ...value })),
    pullRequests: state.pullRequests.map((value) => ({ ...value })),
    checks: state.checks.map((value) => ({ ...value })),
    releases: state.releases.map((value) => ({ ...value })),
  };
}
