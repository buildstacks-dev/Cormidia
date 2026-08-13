// GitHub double v1 — engine (HB-003, boundary B-01, contract CORMIDIA-C-B01-001).
//
// Honest fake of the `gh` CLI surface that src/loop/github.ts (GhCliOps) and
// src/observe/github-source.ts (`gh pr checks`) spawn. The seam is the real
// `gh` PROCESS seam: install.ts writes a `bin/gh` shim (shebang + node) into a
// temp dir; tests prepend that dir to process.env.PATH and product code runs
// completely unmodified — `spawn("gh", ...)` resolves to the shim, which
// executes this engine against a JSON repo state machine persisted in the
// double's home dir.
//
// Failure modes are first-class and scriptable per boundary-map.md B-01:
// timeout / rate limit / 5xx / forbidden (no effect, typed stderr), partial
// success (issue created + labels not applied; merge landed + branch-delete
// scripted to fail), LOST-RESPONSE (effect applied, error returned — execution
// ambiguity + retry pressure), duplicate delivery (retried create really does
// create twice), stale read-after-write (per-entity pre-write shadow served on
// demand), configurable default branch + default-branch-moved mid-scenario,
// and force-push skew (branch tip rewritten under an open PR).
//
// IMPORTANT: this module must stay self-contained (node builtins only). At
// install time it is transpiled AS A SINGLE FILE to CommonJS so the PATH shim
// can run it under plain `node`, outside vitest. Do not import product code or
// sibling test modules here.
//
// POSIX only (darwin/linux): the shim relies on shebang execution. That
// matches the product's own launchd-era platform assumptions.

import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FailureKind =
  | "timeout"
  | "rate_limit"
  | "server_error"
  | "forbidden"
  | "lost_response"
  | "merge_conflict"
  | "partial_labels";

/** One scripted behavior, consumed FIFO when a call matches. */
export interface ScenarioStep {
  /** Canonical op name (e.g. "issue.create", "pr.merge", "ref.delete"). Omit = any call. */
  op?: string;
  /** Substring that must appear in the space-joined argv for the step to match. */
  argIncludes?: string;
  /** How many matching calls consume this step (default 1). */
  times?: number;
  /** Inject a failure. `lost_response` and `partial_labels` still apply effects. */
  fail?: FailureKind;
  /** Serve the pre-write snapshot of the entity on a `*.view` read. */
  stale?: boolean;
  /** Move the repo default branch BEFORE executing this call (branch is created if missing). */
  setDefaultBranch?: string;
  /** Block the shim this long before responding (models slow calls / timeouts). */
  delayMs?: number;
}

interface ScenarioFile {
  steps: (ScenarioStep & { remaining: number })[];
}

/** Deliberate misbehaviors for conformance negative controls. A lying fake
 *  variant MUST fail the conformance suite (HB-003 acceptance). */
export interface DoubleLies {
  /** `pr merge` reports success but records nothing. */
  mergeNotRecorded?: boolean;
  /** `repo view --json defaultBranchRef` reports this name instead of the truth. */
  reportedDefaultBranch?: string;
}

export interface DoubleConfig {
  /** owner/name slug; calls naming any other repo are rejected (INV-004: repo identity from registry). */
  repo: string;
  /** Reject `--approve` / `--request-changes` on every PR with GitHub's
   *  own-PR error text — models the single-account pilot that drives the
   *  product's HMAC self-approval fallback. */
  singleAccount: boolean;
  viewerLogin: string;
  /** Deterministic clock base for createdAt/submittedAt stamps. */
  epochIso: string;
  lies: DoubleLies;
}

export interface DoubleLabel {
  name: string;
  color: string;
  description: string;
}

export interface DoubleComment {
  body: string;
  createdAt: string;
}

export interface DoubleIssue {
  number: number;
  title: string;
  body: string;
  labels: string[];
  state: "OPEN" | "CLOSED";
  createdAt: string;
  comments: DoubleComment[];
}

export interface DoubleReview {
  state: "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED";
  body: string;
  commitOid: string;
  submittedAt: string;
  author: string;
}

export interface DoubleCheck {
  name: string;
  state: string;
  link?: string;
}

export interface DoublePr {
  number: number;
  title: string;
  body: string;
  state: "OPEN" | "CLOSED" | "MERGED";
  headRefName: string;
  baseRefName: string;
  headRefOid: string;
  isDraft: boolean;
  mergeCommitOid?: string;
  reviews: DoubleReview[];
  closingIssueNumbers: number[];
  checks: DoubleCheck[];
  createdAt: string;
}

export interface CallLogEntry {
  seq: number;
  op: string;
  argv: string[];
  exitCode: number;
  /** True when the call mutated repo state (lost_response logs true). */
  effect: boolean;
}

/** The repository's own existence and shape (#382). Before provisioning
 *  existed the double modelled exactly one repository that was always there;
 *  a provisioning scenario needs to start from "not there yet" and needs the
 *  facts a verification gate reads back. */
export interface DoubleRepository {
  /** False models a slug nobody has created. Reads 404 and `repo create`
   *  succeeds; true makes `repo create` fail the way GitHub does. */
  exists: boolean;
  visibility: "PRIVATE" | "PUBLIC" | "INTERNAL";
  /** Carries the provisioning idempotency marker. */
  description: string;
}

export interface DoubleState {
  config: DoubleConfig;
  repository: DoubleRepository;
  defaultBranch: string;
  labels: Record<string, DoubleLabel>;
  branches: Record<string, { oid: string }>;
  issues: Record<string, DoubleIssue>;
  prs: Record<string, DoublePr>;
  /** Issues and PRs share one number sequence, like GitHub. */
  nextNumber: number;
  oidSeq: number;
  timeSeq: number;
  /** Pre-write snapshots served by `stale: true` scenario steps. */
  staleShadow: { issues: Record<string, DoubleIssue>; prs: Record<string, DoublePr> };
  log: CallLogEntry[];
}

export interface ShimResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  delayMs: number;
}

interface OpResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  effect: boolean;
}

// ---------------------------------------------------------------------------
// State persistence (file-backed so state survives across shim processes)
// ---------------------------------------------------------------------------

const STATE_FILE = "state.json";
const SCENARIO_FILE = "scenario.json";
const LOCK_DIR = "lock";

function sleepMs(ms: number): void {
  if (ms <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function acquireLock(home: string): () => void {
  const lockPath = path.join(home, LOCK_DIR);
  const deadline = Date.now() + 5000;
  for (;;) {
    try {
      fs.mkdirSync(lockPath);
      return () => {
        try {
          fs.rmdirSync(lockPath);
        } catch {
          // Already released; losing the lock dir is harmless.
        }
      };
    } catch {
      if (Date.now() > deadline) {
        throw new Error(`github double: could not acquire state lock at ${lockPath}`);
      }
      sleepMs(5);
    }
  }
}

function loadState(home: string): DoubleState {
  const file = path.join(home, STATE_FILE);
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (error) {
    throw new Error(`github double: state file unreadable at ${file}: ${String(error)}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    // Loud, never fabricated: a corrupt state file must fail every call.
    throw new Error(`github double: state file corrupt at ${file}: ${String(error)}`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`github double: state file corrupt at ${file}: expected an object`);
  }
  return parsed as DoubleState;
}

function atomicWriteJson(file: string, value: unknown): void {
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

function saveState(home: string, state: DoubleState): void {
  atomicWriteJson(path.join(home, STATE_FILE), state);
}

function loadScenario(home: string): ScenarioFile {
  const file = path.join(home, SCENARIO_FILE);
  if (!fs.existsSync(file)) return { steps: [] };
  const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as ScenarioFile;
  return { steps: parsed.steps ?? [] };
}

function saveScenario(home: string, scenario: ScenarioFile): void {
  atomicWriteJson(path.join(home, SCENARIO_FILE), scenario);
}

/** Run `fn` against the persisted state under the double's lock. Exported for
 *  install.ts (in-process handle mutations use the same lock + files as the
 *  shim subprocesses). */
export function withDoubleState<T>(home: string, fn: (state: DoubleState) => T): T {
  const unlock = acquireLock(home);
  try {
    const state = loadState(home);
    const result = fn(state);
    saveState(home, state);
    return result;
  } finally {
    unlock();
  }
}

export function readDoubleState(home: string): DoubleState {
  return loadState(home);
}

export function appendScenarioSteps(home: string, steps: ScenarioStep[]): void {
  const unlock = acquireLock(home);
  try {
    const scenario = loadScenario(home);
    for (const step of steps) {
      scenario.steps.push({ ...step, remaining: step.times ?? 1 });
    }
    saveScenario(home, scenario);
  } finally {
    unlock();
  }
}

/** Steps that never matched a call would otherwise be silent no-ops (green by
 *  absence). Tests call this to prove their scripts actually fired. */
export function undrainedScenarioSteps(home: string): ScenarioStep[] {
  return loadScenario(home)
    .steps.filter((step) => step.remaining > 0)
    .map(({ remaining: _remaining, ...step }) => step);
}

// ---------------------------------------------------------------------------
// Deterministic identity helpers
// ---------------------------------------------------------------------------

export function nextOid(state: DoubleState, hint: string): string {
  state.oidSeq += 1;
  return createHash("sha1").update(`${state.config.repo}:${hint}:${state.oidSeq}`).digest("hex");
}

function stamp(state: DoubleState): string {
  state.timeSeq += 1;
  return new Date(Date.parse(state.config.epochIso) + state.timeSeq * 1000).toISOString();
}

function snapshotIssue(state: DoubleState, num: number): void {
  const issue = state.issues[String(num)];
  if (issue !== undefined) state.staleShadow.issues[String(num)] = structuredClone(issue);
}

function snapshotPr(state: DoubleState, num: number): void {
  const pr = state.prs[String(num)];
  if (pr !== undefined) state.staleShadow.prs[String(num)] = structuredClone(pr);
}

// ---------------------------------------------------------------------------
// argv parsing (generic gh-style flags)
// ---------------------------------------------------------------------------

const BOOLEAN_FLAGS = new Set(["--force", "--draft", "--squash", "--approve", "--request-changes", "--comment"]);

interface ParsedArgs {
  positionals: string[];
  flags: Map<string, string[]>;
  bools: Set<string>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags = new Map<string, string[]>();
  const bools = new Set<string>();
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === undefined) continue;
    if (token.startsWith("-") && token !== "-") {
      if (BOOLEAN_FLAGS.has(token)) {
        bools.add(token);
        continue;
      }
      const value = argv[i + 1];
      if (value === undefined) {
        throw new Error(`github double: flag ${token} expects a value`);
      }
      const existing = flags.get(token) ?? [];
      existing.push(value);
      flags.set(token, existing);
      i += 1;
      continue;
    }
    positionals.push(token);
  }
  return { positionals, flags, bools };
}

function flagValue(parsed: ParsedArgs, name: string): string | undefined {
  const values = parsed.flags.get(name);
  return values === undefined ? undefined : values[values.length - 1];
}

function flagValues(parsed: ParsedArgs, name: string): string[] {
  return parsed.flags.get(name) ?? [];
}

/** Canonical op name for scenario matching and the call log. */
export function canonicalOp(argv: string[]): string {
  const parsed = parseArgs(argv);
  const [first, second] = parsed.positionals;
  if (first === "api") {
    return (flagValue(parsed, "-X") ?? "GET").toUpperCase() === "DELETE" ? "ref.delete" : "ref.view";
  }
  if (first === undefined || second === undefined) return `unknown.${first ?? "empty"}`;
  return `${first}.${second}`;
}

// ---------------------------------------------------------------------------
// JSON projections (must match what gh emits and src/loop/github.ts parses)
// ---------------------------------------------------------------------------

function issueJson(state: DoubleState, issue: DoubleIssue): Record<string, unknown> {
  return {
    number: issue.number,
    title: issue.title,
    body: issue.body,
    labels: issue.labels.map((name) => {
      const label = state.labels[name];
      return { name, color: label?.color ?? "ededed", description: label?.description ?? "" };
    }),
    state: issue.state,
    url: `https://github.com/${state.config.repo}/issues/${issue.number}`,
    comments: issue.comments.map((comment) => ({
      body: comment.body,
      createdAt: comment.createdAt,
    })),
  };
}

function prJson(state: DoubleState, pr: DoublePr): Record<string, unknown> {
  return {
    number: pr.number,
    title: pr.title,
    body: pr.body,
    url: `https://github.com/${state.config.repo}/pull/${pr.number}`,
    state: pr.state,
    headRefName: pr.headRefName,
    headRefOid: pr.headRefOid,
    baseRefName: pr.baseRefName,
    isDraft: pr.isDraft,
    mergeCommit: pr.mergeCommitOid === undefined ? null : { oid: pr.mergeCommitOid },
    closingIssuesReferences: pr.closingIssueNumbers.map((number) => ({ number })),
    reviews: pr.reviews.map((review) => ({
      state: review.state,
      body: review.body,
      commit: { oid: review.commitOid },
      submittedAt: review.submittedAt,
      author: { login: review.author },
    })),
  };
}

function project(record: Record<string, unknown>, fields: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    if (field in record) out[field] = record[field];
  }
  return out;
}

function jsonFields(parsed: ParsedArgs): string[] {
  const raw = flagValue(parsed, "--json");
  return raw === undefined ? [] : raw.split(",").map((field) => field.trim());
}

// ---------------------------------------------------------------------------
// Closing-keyword parsing (GitHub linked-issue semantics)
// ---------------------------------------------------------------------------

export function parseClosingIssueNumbers(body: string): number[] {
  const out: number[] = [];
  const pattern = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/gi;
  for (const match of body.matchAll(pattern)) {
    const num = Number(match[1]);
    if (!out.includes(num)) out.push(num);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Failure payloads (stderr text chosen so product-side typed matching works:
// isSelfApprovalError / isMergeConflict regexes in src/loop/github.ts)
// ---------------------------------------------------------------------------

function failurePayload(kind: FailureKind, repo: string): { stdout: string; stderr: string } {
  switch (kind) {
    case "timeout":
      return {
        stdout: "",
        stderr:
          "error connecting to api.github.com\n" +
          "context deadline exceeded (Client.Timeout exceeded while awaiting headers)",
      };
    case "rate_limit":
      return {
        stdout: "",
        stderr: "HTTP 403: API rate limit exceeded for user ID 12345678. (https://api.github.com/graphql)",
      };
    case "server_error":
      return { stdout: "", stderr: "HTTP 502: Server Error (https://api.github.com/graphql)" };
    case "forbidden":
      return {
        stdout: "",
        stderr: `HTTP 403: Resource not accessible by integration (https://api.github.com/repos/${repo})`,
      };
    case "lost_response":
      return {
        stdout: "",
        stderr: `Post "https://api.github.com/repos/${repo}": read tcp 192.0.2.10:443: read: connection reset by peer`,
      };
    case "merge_conflict":
      return {
        stdout: "",
        stderr: "X Pull request is not mergeable: the merge commit cannot be cleanly created",
      };
    case "partial_labels":
      return {
        stdout: "",
        stderr: "HTTP 422: Validation Failed — issue created but labels could not be applied",
      };
  }
}

// ---------------------------------------------------------------------------
// Entity resolution
// ---------------------------------------------------------------------------

function ok(stdout: string, effect: boolean): OpResult {
  return { stdout, stderr: "", exitCode: 0, effect };
}

function err(stderr: string, exitCode = 1): OpResult {
  return { stdout: "", stderr, exitCode, effect: false };
}

function requireRepoMatch(state: DoubleState, parsed: ParsedArgs): OpResult | undefined {
  const named = flagValue(parsed, "--repo");
  if (named !== undefined && named !== state.config.repo) {
    return err(`GraphQL: Could not resolve to a Repository with the name '${named}'. (repository)`);
  }
  return undefined;
}

function resolveIssue(state: DoubleState, selector: string | undefined): DoubleIssue | undefined {
  if (selector === undefined || !/^\d+$/.test(selector)) return undefined;
  return state.issues[selector];
}

function resolvePr(state: DoubleState, selector: string | undefined): DoublePr | undefined {
  if (selector === undefined) return undefined;
  if (/^\d+$/.test(selector)) return state.prs[selector];
  const urlMatch = /\/pull\/(\d+)/.exec(selector);
  if (urlMatch !== null) return state.prs[urlMatch[1] ?? ""];
  // Branch selector: prefer the open PR, else the most recent of any state.
  const all = Object.values(state.prs).filter((pr) => pr.headRefName === selector);
  const open = all.find((pr) => pr.state === "OPEN");
  if (open !== undefined) return open;
  return all.sort((a, b) => b.number - a.number)[0];
}

// ---------------------------------------------------------------------------
// Op handlers
// ---------------------------------------------------------------------------

function executeOp(
  state: DoubleState,
  op: string,
  parsed: ParsedArgs,
  stdinBody: string,
  step: ScenarioStep | undefined,
): OpResult {
  const repoMismatch = requireRepoMatch(state, parsed);
  if (repoMismatch !== undefined) return repoMismatch;
  const repo = state.config.repo;

  switch (op) {
    case "label.create": {
      const name = parsed.positionals[2];
      if (name === undefined) return err("label create: name required");
      const exists = state.labels[name] !== undefined;
      if (exists && !parsed.bools.has("--force")) {
        return err(
          `HTTP 422: Validation Failed (https://api.github.com/repos/${repo}/labels)\nlabel '${name}' already exists`,
        );
      }
      state.labels[name] = {
        name,
        color: (flagValue(parsed, "--color") ?? "ededed").toLowerCase(),
        description: flagValue(parsed, "--description") ?? "",
      };
      return ok("", true);
    }

    case "label.list": {
      const fields = jsonFields(parsed);
      const labels = Object.values(state.labels).map((label) =>
        project({ ...label }, fields.length > 0 ? fields : ["name", "color", "description"]),
      );
      return ok(`${JSON.stringify(labels)}\n`, false);
    }

    case "issue.create": {
      const title = flagValue(parsed, "--title");
      if (title === undefined) return err("issue create: --title required");
      const labels = flagValues(parsed, "--label");
      for (const label of labels) {
        if (state.labels[label] === undefined) {
          return err(`could not add label: '${label}' not found`);
        }
      }
      const partial = step?.fail === "partial_labels";
      const number = state.nextNumber;
      state.nextNumber += 1;
      state.issues[String(number)] = {
        number,
        title,
        body: stdinBody,
        labels: partial ? [] : [...labels],
        state: "OPEN",
        createdAt: stamp(state),
        comments: [],
      };
      return ok(`https://github.com/${repo}/issues/${number}\n`, true);
    }

    case "issue.view": {
      const issue = resolveIssue(state, parsed.positionals[2]);
      if (issue === undefined) {
        return err(
          `GraphQL: Could not resolve to an issue or pull request with the number of ${parsed.positionals[2] ?? "?"}. (repository.issue)`,
        );
      }
      const served = step?.stale === true ? (state.staleShadow.issues[String(issue.number)] ?? issue) : issue;
      return ok(`${JSON.stringify(project(issueJson(state, served), jsonFields(parsed)))}\n`, false);
    }

    case "issue.list": {
      const stateFilter = (flagValue(parsed, "--state") ?? "open").toUpperCase();
      const wantedLabels = flagValues(parsed, "--label");
      const limit = Number(flagValue(parsed, "--limit") ?? "30");
      const fields = jsonFields(parsed);
      const rows = Object.values(state.issues)
        .filter((issue) => stateFilter === "ALL" || issue.state === stateFilter)
        .filter((issue) => wantedLabels.every((label) => issue.labels.includes(label)))
        .sort((a, b) => b.number - a.number)
        .slice(0, limit)
        .map((issue) => project(issueJson(state, issue), fields));
      return ok(`${JSON.stringify(rows)}\n`, false);
    }

    case "issue.edit": {
      const issue = resolveIssue(state, parsed.positionals[2]);
      if (issue === undefined) {
        return err(
          `GraphQL: Could not resolve to an issue or pull request with the number of ${parsed.positionals[2] ?? "?"}. (repository.issue)`,
        );
      }
      const adds = flagValues(parsed, "--add-label");
      const removes = flagValues(parsed, "--remove-label");
      // Validate everything BEFORE any mutation (contract §1: refusal before write).
      for (const label of [...adds, ...removes]) {
        if (state.labels[label] === undefined) return err(`'${label}' not found`);
      }
      snapshotIssue(state, issue.number);
      for (const label of removes) {
        issue.labels = issue.labels.filter((existing) => existing !== label);
      }
      for (const label of adds) {
        if (!issue.labels.includes(label)) issue.labels.push(label);
      }
      if (parsed.flags.has("--body-file")) issue.body = stdinBody;
      return ok(`https://github.com/${repo}/issues/${issue.number}\n`, true);
    }

    case "issue.comment": {
      const issue = resolveIssue(state, parsed.positionals[2]);
      if (issue === undefined) {
        return err(
          `GraphQL: Could not resolve to an issue or pull request with the number of ${parsed.positionals[2] ?? "?"}. (repository.issue)`,
        );
      }
      snapshotIssue(state, issue.number);
      issue.comments.push({ body: stdinBody, createdAt: stamp(state) });
      return ok(`https://github.com/${repo}/issues/${issue.number}#issuecomment-${issue.comments.length}\n`, true);
    }

    case "issue.close": {
      const issue = resolveIssue(state, parsed.positionals[2]);
      if (issue === undefined) {
        return err(
          `GraphQL: Could not resolve to an issue or pull request with the number of ${parsed.positionals[2] ?? "?"}. (repository.issue)`,
        );
      }
      snapshotIssue(state, issue.number);
      issue.state = "CLOSED";
      return ok(`✓ Closed issue #${issue.number}\n`, true);
    }

    case "pr.create": {
      const head = flagValue(parsed, "--head");
      const base = flagValue(parsed, "--base");
      const title = flagValue(parsed, "--title");
      if (head === undefined || base === undefined || title === undefined) {
        return err("pr create: --head, --base and --title are required");
      }
      const headBranch = state.branches[head];
      if (headBranch === undefined) {
        return err(`head branch "${head}" does not exist on ${repo}`);
      }
      if (state.branches[base] === undefined) {
        return err(`HTTP 422: Validation Failed — base ref "${base}" does not exist`);
      }
      if (head === base) return err("head and base branches are identical");
      const existing = Object.values(state.prs).find((pr) => pr.headRefName === head && pr.state === "OPEN");
      if (existing !== undefined) {
        // Duplicate-create detection (contract §4: creates carry detectable
        // markers — the op/ branch itself makes a retry discover prior effect).
        return err(
          `a pull request for branch "${head}" into branch "${existing.baseRefName}" already exists:\nhttps://github.com/${repo}/pull/${existing.number}`,
        );
      }
      const number = state.nextNumber;
      state.nextNumber += 1;
      state.prs[String(number)] = {
        number,
        title,
        body: stdinBody,
        state: "OPEN",
        headRefName: head,
        baseRefName: base,
        headRefOid: headBranch.oid,
        isDraft: parsed.bools.has("--draft"),
        reviews: [],
        closingIssueNumbers: parseClosingIssueNumbers(stdinBody),
        checks: [],
        createdAt: stamp(state),
      };
      return ok(`https://github.com/${repo}/pull/${number}\n`, true);
    }

    case "pr.view": {
      const pr = resolvePr(state, parsed.positionals[2]);
      if (pr === undefined) {
        return err(`no pull requests found for "${parsed.positionals[2] ?? "?"}"`);
      }
      const served = step?.stale === true ? (state.staleShadow.prs[String(pr.number)] ?? pr) : pr;
      return ok(`${JSON.stringify(project(prJson(state, served), jsonFields(parsed)))}\n`, false);
    }

    case "pr.list": {
      const stateFilter = (flagValue(parsed, "--state") ?? "open").toUpperCase();
      const headFilter = flagValue(parsed, "--head");
      const limit = Number(flagValue(parsed, "--limit") ?? "30");
      const fields = jsonFields(parsed);
      const rows = Object.values(state.prs)
        .filter((pr) => stateFilter === "ALL" || pr.state === stateFilter)
        .filter((pr) => headFilter === undefined || pr.headRefName === headFilter)
        .sort((a, b) => b.number - a.number)
        .slice(0, limit)
        .map((pr) => project(prJson(state, pr), fields));
      return ok(`${JSON.stringify(rows)}\n`, false);
    }

    case "pr.edit": {
      const pr = resolvePr(state, parsed.positionals[2]);
      if (pr === undefined) return err(`no pull requests found for "${parsed.positionals[2] ?? "?"}"`);
      snapshotPr(state, pr.number);
      if (parsed.flags.has("--body-file")) {
        pr.body = stdinBody;
        pr.closingIssueNumbers = parseClosingIssueNumbers(stdinBody);
      }
      return ok(`https://github.com/${repo}/pull/${pr.number}\n`, true);
    }

    case "pr.close": {
      const pr = resolvePr(state, parsed.positionals[2]);
      if (pr === undefined) return err(`no pull requests found for "${parsed.positionals[2] ?? "?"}"`);
      if (pr.state === "MERGED") return err(`Pull request #${pr.number} was already merged`);
      snapshotPr(state, pr.number);
      pr.state = "CLOSED";
      return ok(`✓ Closed pull request #${pr.number}\n`, true);
    }

    case "pr.review": {
      const pr = resolvePr(state, parsed.positionals[2]);
      if (pr === undefined) return err(`no pull requests found for "${parsed.positionals[2] ?? "?"}"`);
      if (pr.state !== "OPEN") return err(`Pull request #${pr.number} is not open`);
      const kind = parsed.bools.has("--approve")
        ? "APPROVED"
        : parsed.bools.has("--request-changes")
          ? "CHANGES_REQUESTED"
          : "COMMENTED";
      if (state.config.singleAccount && kind === "APPROVED") {
        return err("failed to create review: GraphQL: Can not approve your own pull request (addPullRequestReview)");
      }
      if (state.config.singleAccount && kind === "CHANGES_REQUESTED") {
        return err(
          "failed to create review: GraphQL: Can not request changes on your own pull request (addPullRequestReview)",
        );
      }
      snapshotPr(state, pr.number);
      pr.reviews.push({
        state: kind,
        body: stdinBody,
        // GitHub stamps a review's commit_id at the PR head current when the
        // review posts — exactly the binding the product's HMAC verification
        // and force-push-skew refusal rely on.
        commitOid: pr.headRefOid,
        submittedAt: stamp(state),
        author: state.config.viewerLogin,
      });
      return ok(`Reviewed pull request #${pr.number}\n`, true);
    }

    case "pr.merge": {
      const pr = resolvePr(state, parsed.positionals[2]);
      if (pr === undefined) return err(`no pull requests found for "${parsed.positionals[2] ?? "?"}"`);
      if (!parsed.bools.has("--squash")) return err("github double: only --squash merges are modeled");
      if (pr.state !== "OPEN") return err(`Pull request #${pr.number} is not open`);
      const matchHead = flagValue(parsed, "--match-head-commit");
      if (matchHead !== undefined && matchHead !== pr.headRefOid) {
        // Deliberately does NOT match /conflict|mergeable|not merge/i so the
        // product surfaces it as a plain GhOpsError, not a merge conflict.
        return err(`X Pull request #${pr.number} head branch was modified. Review and try the merge again.`);
      }
      if (state.config.lies.mergeNotRecorded === true) {
        // LIAR VARIANT (negative control): reports success, records nothing.
        return ok(`✓ Squashed and merged pull request #${pr.number}\n`, false);
      }
      snapshotPr(state, pr.number);
      pr.state = "MERGED";
      const mergeOid = nextOid(state, `merge:${pr.number}`);
      pr.mergeCommitOid = mergeOid;
      const baseBranch = state.branches[pr.baseRefName];
      if (baseBranch !== undefined) baseBranch.oid = mergeOid;
      // GitHub closes linked issues only when the merge lands on the default
      // branch (see GhPullRequest.closingIssueNumbers doc in src/loop/github.ts).
      if (pr.baseRefName === state.defaultBranch) {
        for (const issueNumber of pr.closingIssueNumbers) {
          const issue = state.issues[String(issueNumber)];
          if (issue !== undefined && issue.state === "OPEN") {
            snapshotIssue(state, issueNumber);
            issue.state = "CLOSED";
          }
        }
      }
      return ok(`✓ Squashed and merged pull request #${pr.number}\n`, true);
    }

    case "pr.checks": {
      const pr = resolvePr(state, parsed.positionals[2]);
      if (pr === undefined) return err(`no pull requests found for "${parsed.positionals[2] ?? "?"}"`);
      if (pr.checks.length === 0) {
        return err(`no checks reported on the '${pr.headRefName}' branch`);
      }
      const rows = pr.checks.map((check) => ({
        name: check.name,
        state: check.state,
        ...(check.link === undefined ? {} : { link: check.link }),
      }));
      const allGreen = pr.checks.every((check) => check.state === "SUCCESS");
      // Like real gh: red checks exit non-zero while still emitting the JSON.
      return { stdout: `${JSON.stringify(rows)}\n`, stderr: "", exitCode: allGreen ? 0 : 1, effect: false };
    }

    case "ref.view": {
      const target = parsed.positionals[1];
      if (target === undefined) return err("api: path required");
      const match = /^repos\/([^\s]+)\/git\/ref\/heads\/(.+)$/.exec(target);
      if (match === null) return err(`github double: unsupported api path: ${target}`);
      const [, apiRepo, branch] = match;
      if (apiRepo !== repo) {
        return err(`HTTP 404: Not Found (https://api.github.com/repos/${apiRepo ?? "?"})`);
      }
      const oid = branch === undefined ? undefined : state.branches[branch]?.oid;
      if (branch === undefined || oid === undefined) {
        return err(
          `HTTP 404: Reference does not exist (https://api.github.com/repos/${repo}/git/ref/heads/${branch ?? "?"})`,
        );
      }
      return ok(`${JSON.stringify({ ref: `refs/heads/${branch}`, object: { type: "commit", sha: oid } })}\n`, false);
    }

    case "ref.delete": {
      const target = parsed.positionals[1];
      if (target === undefined) return err("api: path required");
      const match = /^repos\/([^\s]+)\/git\/refs\/heads\/(.+)$/.exec(target);
      if (match === null) return err(`github double: unsupported api path: ${target}`);
      const [, apiRepo, branch] = match;
      if (apiRepo !== repo) {
        return err(`HTTP 404: Not Found (https://api.github.com/repos/${apiRepo ?? "?"})`);
      }
      if (branch === undefined || state.branches[branch] === undefined) {
        return err(
          `HTTP 422: Reference does not exist (https://api.github.com/repos/${repo}/git/refs/heads/${branch ?? "?"})`,
        );
      }
      delete state.branches[branch];
      return ok("", true);
    }

    case "repo.view": {
      const positionalRepo = parsed.positionals[2];
      if (positionalRepo !== undefined && positionalRepo !== repo) {
        return err(`GraphQL: Could not resolve to a Repository with the name '${positionalRepo}'. (repository)`);
      }
      // A slug nobody has created reads exactly like GitHub's not-found, so
      // the product's "absent vs I-could-not-look" split is exercised for real
      // rather than being assumed (#382).
      if (!state.repository.exists) {
        return err(`GraphQL: Could not resolve to a Repository with the name '${repo}'. (repository)`);
      }
      const reported = state.config.lies.reportedDefaultBranch ?? state.defaultBranch;
      // An empty repository has no default branch ref at all. The product must
      // read null rather than inventing `main` for a repo with no commits.
      const isEmpty = Object.keys(state.branches).length === 0;
      const record: Record<string, unknown> = {
        name: repo.split("/")[1] ?? repo,
        nameWithOwner: repo,
        visibility: state.repository.visibility,
        description: state.repository.description,
        isEmpty,
        defaultBranchRef: isEmpty ? null : { name: reported },
      };
      const fields = jsonFields(parsed);
      return ok(`${JSON.stringify(fields.length > 0 ? project(record, fields) : record)}\n`, false);
    }

    case "repo.create": {
      const named = parsed.positionals[2];
      if (named !== undefined && named !== repo) {
        return err(`HTTP 422: Validation Failed — this double only models ${repo}, not '${named}'`);
      }
      if (state.repository.exists) {
        // GitHub's own text. The product must treat this as "reconcile against
        // what is there", never as "try again".
        return err(
          `HTTP 422: Validation Failed (https://api.github.com/user/repos)\nname already exists on this account`,
        );
      }
      state.repository = {
        exists: true,
        visibility: parsed.bools.has("--public") ? "PUBLIC" : parsed.bools.has("--internal") ? "INTERNAL" : "PRIVATE",
        description: flagValue(parsed, "--description") ?? "",
      };
      // Created EMPTY: no commits, so no default branch. The push is a
      // separate, separately-resumable step.
      state.branches = {};
      return ok(`https://github.com/${repo}\n`, true);
    }

    default:
      return err(`cormidia-github-double: unsupported gh invocation: ${op}`);
  }
}

// ---------------------------------------------------------------------------
// Scenario matching + top-level call handling
// ---------------------------------------------------------------------------

function matchStep(scenario: ScenarioFile, op: string, argv: string[]): ScenarioStep | undefined {
  const joined = argv.join(" ");
  for (const step of scenario.steps) {
    if (step.remaining <= 0) continue;
    if (step.op !== undefined && step.op !== op) continue;
    if (step.argIncludes !== undefined && !joined.includes(step.argIncludes)) continue;
    step.remaining -= 1;
    return step;
  }
  return undefined;
}

/** Handle one gh invocation against the double home. Pure with respect to the
 *  caller: all state lives in files under `home`. */
export function handleShimCall(home: string, argv: string[], stdinBody: string): ShimResult {
  const unlock = acquireLock(home);
  try {
    const state = loadState(home);
    const scenario = loadScenario(home);
    const op = canonicalOp(argv);
    const step = matchStep(scenario, op, argv);
    saveScenario(home, scenario);

    if (step?.setDefaultBranch !== undefined) {
      // Default-branch-moved failure mode: the remote moves underneath the
      // caller before this call executes.
      if (state.branches[step.setDefaultBranch] === undefined) {
        state.branches[step.setDefaultBranch] = { oid: nextOid(state, step.setDefaultBranch) };
      }
      state.defaultBranch = step.setDefaultBranch;
    }

    let result: OpResult;
    const parsed = parseArgs(argv);
    if (step?.fail !== undefined && step.fail !== "lost_response" && step.fail !== "partial_labels") {
      const payload = failurePayload(step.fail, state.config.repo);
      result = { ...payload, exitCode: 1, effect: false };
    } else if (step?.fail === "lost_response") {
      // LOST-RESPONSE mode, first-class: the effect is applied, the response
      // is lost. The caller sees a transport error; the remote state moved.
      const applied = executeOp(state, op, parsed, stdinBody, step);
      const payload = failurePayload("lost_response", state.config.repo);
      result = { ...payload, exitCode: 1, effect: applied.effect };
    } else if (step?.fail === "partial_labels") {
      // Partial success: entity created, labels not applied, error surfaced.
      const applied = executeOp(state, op, parsed, stdinBody, step);
      const payload = failurePayload("partial_labels", state.config.repo);
      result = { ...payload, exitCode: 1, effect: applied.effect };
    } else {
      result = executeOp(state, op, parsed, stdinBody, step);
    }

    state.log.push({
      seq: state.log.length + 1,
      op,
      argv: [...argv],
      exitCode: result.exitCode,
      effect: result.effect,
    });
    saveState(home, state);
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      delayMs: step?.delayMs ?? 0,
    };
  } finally {
    unlock();
  }
}

/** Entry point for the generated `bin/gh` shim. Any internal failure exits
 *  non-zero with a loud message — the double never fabricates a success. */
export function shimMain(home: string): void {
  const argv = process.argv.slice(2);
  let stdinBody = "";
  const wantsStdin = argv.some((token, index) => token === "--body-file" && argv[index + 1] === "-");
  if (wantsStdin) {
    try {
      stdinBody = fs.readFileSync(0, "utf8");
    } catch {
      stdinBody = "";
    }
  }
  let result: ShimResult;
  try {
    result = handleShimCall(home, argv, stdinBody);
  } catch (error) {
    process.stderr.write(`cormidia-github-double: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
  if (result.delayMs > 0) sleepMs(result.delayMs);
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exit(result.exitCode);
}
