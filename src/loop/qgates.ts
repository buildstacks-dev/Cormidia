// Quality-gate engine — process gates: tests, lint, e2e (build plan M4.3;
// docs/loop.md §5 rows, §10: qgates is pure subprocess + git, no adapter
// dependency).
//
// Quality gates are orchestrator code, distinct from the safety gate
// (src/runtime/gate.ts): they run *between passes* as subprocesses against
// the ticket's worktree, and no agent hallucination can bypass them. This
// module is deliberately LLM-free — a shell command, an exit code, a
// bounded output tail.
//
// Port notes (predecessor `orchestrator/gates.py`, run_gate_tests /
// run_gate_lint / run_gate_e2e_tests):
// - Commands are shell strings (the app's `test_command` / `lint_command` /
//   `e2e_test_command` from `.operon/config.yaml` — the loader lives with
//   the app registry, not here; callers pass a plain `GateCommands`). They
//   run with cwd = the worktree, stdout+stderr captured together, exit 0 =
//   pass.
// - Per-gate timeout defaults keep the predecessor's numbers (tests 300s,
//   lint 120s, e2e 600s). A timeout is a *distinct* failure message —
//   "timed out after Ns", never dressed up as an exit-code failure — so a
//   remediation brief says what actually happened.
// - On failure the last `tailLines` lines of combined output land verbatim
//   in `outputTail` (predecessor: last 10; default here is 50 — briefs
//   carry gate output verbatim per loop.md §3, and 10 lines routinely cuts
//   off the failing test's name; the brief assembler budgets downstream).
//   Capture is byte-bounded while streaming, so a chatty suite can't balloon
//   orchestrator memory.
// - Dropped: the predecessor's silent PASS when tests/lint are unconfigured
//   (loop.md §1 drops silent best-effort). A scheduled tests or lint gate
//   with no configured command **fails** loudly. Only e2e is
//   optional-by-design — the §5 row says "when configured" — so an
//   unconfigured e2e gate returns status "skip", not a failure.
//
// M4.4/M4.5 extend the process gates with the security scan, completeness,
// review-freshness, and the tier orchestrator `runGates`.

import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import { asGlobal, SECRET_PATTERNS } from "../runtime/secret-patterns.js";
import { gatesForTier, type GateName, type Policy, type RiskTier } from "./policy.js";

/** Every gate the engine can report on: the policy-schedulable set plus
 *  `review-freshness`, which always runs (policy.ts rejects configuring it;
 *  the M4.5 orchestrator appends it unconditionally). */
export type GateId = GateName | "review-freshness" | "setup";

/** `skip` is reserved for gates that are optional by design (e2e without an
 *  `e2e_test_command`) — a gate that *should* have run but couldn't is a
 *  `fail`, never a `skip`. */
export type GateStatus = "pass" | "fail" | "skip";

/** One gate's outcome — plain data the orchestrator acts on and the brief
 *  assembler quotes verbatim (loop.md §3: gate output is never summarized). */
export interface GateResult {
  gate: GateId;
  status: GateStatus;
  /** One-line human summary: what ran and what happened. */
  detail: string;
  /** The shell command that ran (absent when unconfigured). */
  command?: string;
  /** Exit code when the process ran to completion (absent on timeout and
   *  signal deaths). */
  exitCode?: number;
  /** Last `tailLines` lines of combined stdout+stderr, verbatim — present
   *  on failure whenever the process produced output. */
  outputTail?: string;
  /** True only when the gate's timeout killed the process. */
  timedOut?: boolean;
  /** Machine-readable secret-scan matches; summaries never include secret material. */
  matches?: SecretMatch[];
  /** Machine-readable data-gate failures (completeness / freshness). */
  failures?: string[];
  /** Wall-clock subprocess time; 0 for unconfigured/skipped gates. */
  durationMs: number;
}

export interface SecretMatch {
  file: string;
  line: number;
  pattern: string;
}

/** The app's gate commands — the camelCase mirror of `.operon/config.yaml`'s
 *  `test_command` / `lint_command` / `e2e_test_command` (predecessor schema,
 *  loop.md §5 table). */
export interface GateCommands {
  /** App-owned dependency-install/setup step (`.operon/config.yaml`'s
   *  `setup_command`), run in the worktree once before the scheduled gates.
   *  A fresh clone/worktree has no `node_modules`, so a lint or test command
   *  that shells out to an installed tool (e.g. `eslint .`) would otherwise
   *  fail purely for lack of deps. Unconfigured = no setup step (unchanged). */
  setupCommand?: string;
  testCommand?: string;
  lintCommand?: string;
  e2eTestCommand?: string;
}

export interface DiffRange {
  /** Older ref in `git diff --numstat <baseRef> <headRef> --`. */
  baseRef?: string;
  /** Newer ref; defaults to HEAD. */
  headRef?: string;
}

export interface SecurityGateOpts extends DiffRange {
  /** Lines of file:line match output to keep on failure. */
  tailLines?: number;
}

export interface AcceptanceCriterion {
  id: string;
  text: string;
  checked: boolean;
}

/** Contract-pass mapping: every acceptance criterion id must map to at least
 *  one named test or the completeness gate fails. */
export type CriterionTestMap = Record<string, readonly string[]>;

export interface CompletenessFinding {
  id: string;
  description: string;
  resolved: boolean;
}

export interface ReviewFreshnessState {
  /** The commit_id from the approving review. Missing means no approval. */
  approvedCommitId?: string | null;
  /** Optional injection for tests/callers that already resolved local HEAD. */
  headCommitId?: string;
}

export type GateRunStatus = "pass" | "fail" | "blocked";

export interface GateRunResult {
  tier: RiskTier;
  status: GateRunStatus;
  results: GateResult[];
  remediation: {
    currentAttempt: number;
    maxAttempts: number;
    attemptsRemaining: number;
    canRetry: boolean;
    exhausted: boolean;
  };
}

export interface RunGatesOptions {
  policy: Policy;
  commands: GateCommands;
  criterionTests: CriterionTestMap;
  /** Number of remediation attempts already used; persistence is caller-owned. */
  currentAttempt?: number;
  process?: ProcessGateOpts;
  diff?: DiffRange;
}

export interface ProcessGateOpts {
  /** Overrides the per-gate default (DEFAULT_TIMEOUTS_MS). */
  timeoutMs?: number;
  /** Lines of combined output kept on failure (default DEFAULT_TAIL_LINES). */
  tailLines?: number;
}

/** Predecessor parity: tests 300s, lint 120s, e2e 600s. Setup (dependency
 *  install) gets the tests budget — `npm ci` on a cold cache is comparable. */
export const DEFAULT_TIMEOUTS_MS = {
  setup: 300_000,
  tests: 300_000,
  lint: 120_000,
  e2e: 600_000,
} as const;

export const DEFAULT_TAIL_LINES = 50;

/** Byte bound on retained subprocess output while streaming — the tail is
 *  cut from at most this much; everything older is discarded as it streams. */
const MAX_CAPTURE_BYTES = 256 * 1024;

// ---------------------------------------------------------------------------
// The three process gates
// ---------------------------------------------------------------------------

/** Run the app's setup/install command in the worktree; exit 0 passes.
 *  Returns `undefined` when no `setup_command` is configured — an unconfigured
 *  setup step is simply absent, never a failure and never reported (unlike the
 *  tests/lint gates, which fail loudly when unconfigured). */
export async function runSetupGate(
  worktree: string,
  commands: GateCommands,
  opts: ProcessGateOpts = {},
): Promise<GateResult | undefined> {
  if (commands.setupCommand === undefined || commands.setupCommand === "") return undefined;
  return runProcessGate(worktree, opts, {
    gate: "setup",
    command: commands.setupCommand,
    configKey: "setup_command",
    unconfigured: "skip",
    defaultTimeoutMs: DEFAULT_TIMEOUTS_MS.setup,
  });
}

/** Run the app's test command in the worktree; exit 0 passes. Unconfigured
 *  is a loud failure (see the header's drop note). */
export function runTestsGate(
  worktree: string,
  commands: GateCommands,
  opts: ProcessGateOpts = {},
): Promise<GateResult> {
  return runProcessGate(worktree, opts, {
    gate: "tests",
    command: commands.testCommand,
    configKey: "test_command",
    unconfigured: "fail",
    defaultTimeoutMs: DEFAULT_TIMEOUTS_MS.tests,
  });
}

/** Lint gate — same mechanics as tests (loop.md §5 "lint_command" row). */
export function runLintGate(
  worktree: string,
  commands: GateCommands,
  opts: ProcessGateOpts = {},
): Promise<GateResult> {
  return runProcessGate(worktree, opts, {
    gate: "lint",
    command: commands.lintCommand,
    configKey: "lint_command",
    unconfigured: "fail",
    defaultTimeoutMs: DEFAULT_TIMEOUTS_MS.lint,
  });
}

/** E2e gate — "when configured" (§5 row): unconfigured is a SKIP, the one
 *  process gate that is optional by design. */
export function runE2eGate(
  worktree: string,
  commands: GateCommands,
  opts: ProcessGateOpts = {},
): Promise<GateResult> {
  return runProcessGate(worktree, opts, {
    gate: "e2e",
    command: commands.e2eTestCommand,
    configKey: "e2e_test_command",
    unconfigured: "skip",
    defaultTimeoutMs: DEFAULT_TIMEOUTS_MS.e2e,
  });
}

// ---------------------------------------------------------------------------
// Security regex scan (M4.4)
// ---------------------------------------------------------------------------

/** Scan changed, non-binary files in a local git diff range using the
 * canonical secret pattern list from src/runtime/secret-patterns.ts. */
export function runSecurityGate(worktree: string, opts: SecurityGateOpts = {}): GateResult {
  const started = Date.now();
  let changed: ChangedFile[];
  try {
    changed = changedFiles(worktree, opts);
  } catch (error) {
    return {
      gate: "security",
      status: "fail",
      detail: `security could not inspect git diff: ${errorMessage(error)}`,
      durationMs: Date.now() - started,
    };
  }

  const matches: SecretMatch[] = [];
  let skippedBinary = 0;
  try {
    for (const file of changed) {
      if (file.binary) {
        skippedBinary++;
        continue;
      }
      const path = pathInsideWorktree(worktree, file.path);
      const bytes = readFileSync(path);
      if (bytes.includes(0)) {
        skippedBinary++;
        continue;
      }
      matches.push(...secretMatches(file.path, bytes.toString("utf8")));
    }
  } catch (error) {
    return {
      gate: "security",
      status: "fail",
      detail: `security could not scan changed files: ${errorMessage(error)}`,
      durationMs: Date.now() - started,
    };
  }

  const binarySuffix =
    skippedBinary === 0
      ? ""
      : `; skipped ${skippedBinary} binary file${skippedBinary === 1 ? "" : "s"}`;
  if (matches.length === 0) {
    return {
      gate: "security",
      status: "pass",
      detail: `security passed (${changed.length} changed file${changed.length === 1 ? "" : "s"} scanned${binarySuffix})`,
      durationMs: Date.now() - started,
    };
  }

  const lines = matches.map((m) => `${m.file}:${m.line} ${m.pattern}`);
  return {
    gate: "security",
    status: "fail",
    detail: `security found ${matches.length} secret-like match${matches.length === 1 ? "" : "es"}${binarySuffix}`,
    outputTail: lastLines(lines.join("\n"), opts.tailLines ?? DEFAULT_TAIL_LINES),
    matches,
    durationMs: Date.now() - started,
  };
}

// ---------------------------------------------------------------------------
// Data gates + tier orchestrator (M4.5)
// ---------------------------------------------------------------------------

export function runCompletenessGate(
  criteria: readonly AcceptanceCriterion[],
  findings: readonly CompletenessFinding[],
  criterionTests: CriterionTestMap,
): GateResult {
  const failures: string[] = [];

  for (const criterion of criteria) {
    if (!criterion.checked) failures.push(`unchecked criterion ${criterion.id}: ${criterion.text}`);
    const tests = criterionTests[criterion.id] ?? [];
    if (tests.filter((test) => test.trim() !== "").length === 0) {
      failures.push(`criterion ${criterion.id} has no covering test in the contract mapping`);
    }
  }

  for (const finding of findings) {
    if (!finding.resolved) {
      failures.push(`unresolved finding ${finding.id}: ${finding.description}`);
    }
  }

  if (failures.length === 0) {
    return {
      gate: "completeness",
      status: "pass",
      detail: `completeness passed (${criteria.length} ${criteria.length === 1 ? "criterion" : "criteria"}, ${findings.length} finding${findings.length === 1 ? "" : "s"})`,
      durationMs: 0,
    };
  }

  return {
    gate: "completeness",
    status: "fail",
    detail: `completeness failed (${failures.length} issue${failures.length === 1 ? "" : "s"})`,
    outputTail: lastLines(failures.join("\n"), DEFAULT_TAIL_LINES),
    failures,
    durationMs: 0,
  };
}

export function runReviewFreshnessGate(
  worktree: string,
  reviewState: ReviewFreshnessState,
): GateResult {
  let head: string;
  try {
    head = reviewState.headCommitId ?? git(worktree, ["rev-parse", "HEAD"]);
  } catch (error) {
    return {
      gate: "review-freshness",
      status: "fail",
      detail: `review-freshness could not resolve branch HEAD: ${errorMessage(error)}`,
      durationMs: 0,
    };
  }

  const approved = reviewState.approvedCommitId;
  if (approved === undefined || approved === null || approved === "") {
    return {
      gate: "review-freshness",
      status: "fail",
      detail: "review-freshness failed: no approving review commit_id is recorded",
      failures: ["no approving review commit_id"],
      durationMs: 0,
    };
  }

  if (head !== approved) {
    const failure = `branch HEAD ${shortSha(head)} does not match approved commit ${shortSha(approved)}`;
    return {
      gate: "review-freshness",
      status: "fail",
      detail: `review-freshness failed: ${failure}`,
      outputTail: failure,
      failures: [failure],
      durationMs: 0,
    };
  }

  return {
    gate: "review-freshness",
    status: "pass",
    detail: `review-freshness passed (${shortSha(head)})`,
    durationMs: 0,
  };
}

export async function runGates(
  tier: RiskTier,
  worktree: string,
  criteria: readonly AcceptanceCriterion[],
  findings: readonly CompletenessFinding[],
  reviewState: ReviewFreshnessState,
  options: RunGatesOptions,
): Promise<GateRunResult> {
  const results: GateResult[] = [];

  // Dependency install runs first, in the worktree, before any scheduled gate.
  // If it fails, the deps the tests/lint gates rely on are absent, so running
  // those gates would only produce misleading failures — short-circuit and
  // report just the setup failure, which the remediation brief carries verbatim.
  const setupResult = await runSetupGate(worktree, options.commands, options.process);
  if (setupResult !== undefined) {
    results.push(setupResult);
  }

  if (setupResult === undefined || setupResult.status !== "fail") {
    for (const gate of gatesForTier(options.policy, tier)) {
      results.push(
        await runScheduledGate(gate, worktree, criteria, findings, options),
      );
    }
    results.push(runReviewFreshnessGate(worktree, reviewState));
  }

  const failed = results.some((result) => result.status === "fail");
  const maxAttempts = options.policy.remediation.maxAttempts;
  const currentAttempt = Math.max(0, Math.trunc(options.currentAttempt ?? 0));
  const exhausted = failed && currentAttempt >= maxAttempts;
  return {
    tier,
    status: failed ? (exhausted ? "blocked" : "fail") : "pass",
    results,
    remediation: {
      currentAttempt,
      maxAttempts,
      attemptsRemaining: Math.max(0, maxAttempts - currentAttempt),
      canRetry: failed && !exhausted,
      exhausted,
    },
  };
}

async function runScheduledGate(
  gate: GateName,
  worktree: string,
  criteria: readonly AcceptanceCriterion[],
  findings: readonly CompletenessFinding[],
  options: RunGatesOptions,
): Promise<GateResult> {
  switch (gate) {
    case "tests":
      return runTestsGate(worktree, options.commands, options.process);
    case "lint":
      return runLintGate(worktree, options.commands, options.process);
    case "e2e":
      return runE2eGate(worktree, options.commands, options.process);
    case "security":
      return runSecurityGate(worktree, {
        ...options.diff,
        ...(options.process?.tailLines !== undefined ? { tailLines: options.process.tailLines } : {}),
      });
    case "completeness":
      return runCompletenessGate(criteria, findings, options.criterionTests);
  }
}

interface ChangedFile {
  path: string;
  binary: boolean;
}

function changedFiles(worktree: string, range: DiffRange): ChangedFile[] {
  const baseRef = range.baseRef ?? "HEAD~1";
  const headRef = range.headRef ?? "HEAD";
  const output = git(worktree, [
    "diff",
    "--numstat",
    "--diff-filter=ACMRT",
    baseRef,
    headRef,
    "--",
  ]);
  if (output === "") return [];
  return output.split("\n").map((line) => {
    const [added, deleted, ...pathParts] = line.split("\t");
    const path = pathParts.join("\t");
    if (added === undefined || deleted === undefined || path === "") {
      throw new Error(`unexpected git diff --numstat line: ${JSON.stringify(line)}`);
    }
    return { path, binary: added === "-" && deleted === "-" };
  });
}

function secretMatches(file: string, text: string): SecretMatch[] {
  const matches: SecretMatch[] = [];
  for (const secret of SECRET_PATTERNS) {
    const re = asGlobal(secret);
    for (const match of text.matchAll(re)) {
      matches.push({
        file,
        line: lineNumberAt(text, match.index ?? 0),
        pattern: secret.name,
      });
    }
  }
  return matches.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

function lineNumberAt(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) {
    if (text.charCodeAt(i) === 10) line++;
  }
  return line;
}

function pathInsideWorktree(worktree: string, file: string): string {
  const root = resolve(worktree);
  const path = resolve(root, file);
  if (path !== root && !path.startsWith(`${root}${sep}`)) {
    throw new Error(`git reported a path outside the worktree: ${file}`);
  }
  return path;
}

function git(cwd: string, args: string[]): string {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    }).trimEnd();
  } catch (error) {
    const stderr = (error as { stderr?: unknown }).stderr;
    const detail = typeof stderr === "string" && stderr.trim() !== "" ? `: ${stderr.trim()}` : "";
    throw new Error(`git ${args.join(" ")} failed${detail}`);
  }
}

function shortSha(sha: string): string {
  return sha.slice(0, 12);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ---------------------------------------------------------------------------
// Shared subprocess core
// ---------------------------------------------------------------------------

interface ProcessGateSpec {
  gate: GateId;
  command: string | undefined;
  /** The `.operon/config.yaml` key — named in messages so the fix is obvious. */
  configKey: string;
  unconfigured: "fail" | "skip";
  defaultTimeoutMs: number;
}

async function runProcessGate(
  worktree: string,
  opts: ProcessGateOpts,
  spec: ProcessGateSpec,
): Promise<GateResult> {
  if (spec.command === undefined || spec.command === "") {
    if (spec.unconfigured === "skip") {
      return {
        gate: spec.gate,
        status: "skip",
        detail: `no ${spec.configKey} configured — ${spec.gate} skipped`,
        durationMs: 0,
      };
    }
    return {
      gate: spec.gate,
      status: "fail",
      detail:
        `no ${spec.configKey} configured — the scheduled ${spec.gate} gate cannot run ` +
        `(set ${spec.configKey} in .operon/config.yaml or remove "${spec.gate}" ` +
        `from the tier's gate set in .operon/policy.yaml)`,
      durationMs: 0,
    };
  }

  const timeoutMs = opts.timeoutMs ?? spec.defaultTimeoutMs;
  const tailLines = opts.tailLines ?? DEFAULT_TAIL_LINES;
  const started = Date.now();
  const run = await runShell(spec.command, worktree, timeoutMs);
  const durationMs = Date.now() - started;

  const tail = lastLines(run.output, tailLines);
  const withTail = tail === "" ? {} : { outputTail: tail };

  if (run.timedOut) {
    return {
      gate: spec.gate,
      status: "fail",
      detail: `${spec.gate} timed out after ${timeoutMs / 1000}s`,
      command: spec.command,
      timedOut: true,
      durationMs,
      ...withTail,
    };
  }

  if (run.spawnError !== undefined) {
    // The command never ran (bad cwd, missing shell, …) — an orchestrator
    // problem, reported loudly as a failure, never a silent pass.
    return {
      gate: spec.gate,
      status: "fail",
      detail: `${spec.gate} could not run: ${run.spawnError.message}`,
      command: spec.command,
      durationMs,
      ...withTail,
    };
  }

  if (run.exitCode === 0) {
    return {
      gate: spec.gate,
      status: "pass",
      detail: `${spec.gate} passed (exit 0)`,
      command: spec.command,
      exitCode: 0,
      durationMs,
    };
  }

  return {
    gate: spec.gate,
    status: "fail",
    detail:
      run.exitCode !== null
        ? `${spec.gate} failed (exit ${run.exitCode})`
        : `${spec.gate} died on signal ${run.signal ?? "unknown"}`,
    command: spec.command,
    ...(run.exitCode !== null ? { exitCode: run.exitCode } : {}),
    durationMs,
    ...withTail,
  };
}

interface ShellRun {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  spawnError?: Error;
  /** Combined stdout+stderr in arrival order, byte-bounded. */
  output: string;
}

/** Run a shell command with cwd = the worktree; never rejects — every
 *  outcome (exit, signal, timeout, spawn failure) is data in the result. */
function runShell(command: string, cwd: string, timeoutMs: number): Promise<ShellRun> {
  return new Promise((resolve) => {
    const child = spawn(command, {
      shell: true,
      cwd,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      // Gates always run non-interactively: package managers must never wait
      // on (or fail for lack of) a TTY. pnpm refuses to replace an existing
      // modules dir without CI=1 — that refusal cost a full remediation turn
      // in the 2026-07-10 episode (proportionality-review Stage 3).
      env: { ...process.env, CI: "1" },
    });

    const tail = new TailBuffer(MAX_CAPTURE_BYTES);
    child.stdout?.on("data", (chunk: Buffer) => tail.push(chunk));
    child.stderr?.on("data", (chunk: Buffer) => tail.push(chunk));

    let timedOut = false;
    let spawnError: Error | undefined;
    let settled = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killProcessTree(child);
    }, timeoutMs);

    const settle = (exitCode: number | null, signal: NodeJS.Signals | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        exitCode,
        signal,
        timedOut,
        ...(spawnError !== undefined ? { spawnError } : {}),
        output: tail.toString(),
      });
    };

    child.on("error", (err) => {
      // Spawn failures may never emit "close" — settle here.
      spawnError = err;
      settle(null, null);
    });
    child.on("close", (code, signal) => settle(code, signal));
  });
}

function killProcessTree(child: ChildProcess): void {
  if (child.pid === undefined) {
    child.kill("SIGKILL");
    return;
  }

  try {
    // `detached: true` makes the shell the process-group leader on POSIX.
    // Killing the group prevents grandchildren from surviving a timeout.
    process.kill(-child.pid, "SIGKILL");
  } catch {
    child.kill("SIGKILL");
  }
}

/** Rolling byte-bounded buffer: keeps only the newest ~cap bytes while the
 *  subprocess streams, so capture memory is O(cap) regardless of output. */
class TailBuffer {
  private chunks: Buffer[] = [];
  private total = 0;

  constructor(private readonly cap: number) {}

  push(chunk: Buffer): void {
    this.chunks.push(chunk);
    this.total += chunk.length;
    // Drop whole old chunks while the rest still covers the cap.
    while (this.chunks.length > 1 && this.total - this.chunks[0]!.length >= this.cap) {
      this.total -= this.chunks[0]!.length;
      this.chunks.shift();
    }
  }

  toString(): string {
    const all = Buffer.concat(this.chunks);
    const bounded = all.length > this.cap ? all.subarray(all.length - this.cap) : all;
    return bounded.toString("utf8");
  }
}

function lastLines(output: string, n: number): string {
  const trimmed = output.replace(/\s+$/, "");
  if (trimmed === "") return "";
  const lines = trimmed.split(/\r?\n/);
  return lines.slice(-n).join("\n");
}
