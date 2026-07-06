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
// This file grows with M4.4 (security regex scan) and M4.5 (completeness,
// review-freshness, the tier orchestrator `runGates`).

import { spawn } from "node:child_process";
import type { GateName } from "./policy.js";

/** Every gate the engine can report on: the policy-schedulable set plus
 *  `review-freshness`, which always runs (policy.ts rejects configuring it;
 *  the M4.5 orchestrator appends it unconditionally). */
export type GateId = GateName | "review-freshness";

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
  /** Wall-clock subprocess time; 0 for unconfigured/skipped gates. */
  durationMs: number;
}

/** The app's gate commands — the camelCase mirror of `.operon/config.yaml`'s
 *  `test_command` / `lint_command` / `e2e_test_command` (predecessor schema,
 *  loop.md §5 table). */
export interface GateCommands {
  testCommand?: string;
  lintCommand?: string;
  e2eTestCommand?: string;
}

export interface ProcessGateOpts {
  /** Overrides the per-gate default (DEFAULT_TIMEOUTS_MS). */
  timeoutMs?: number;
  /** Lines of combined output kept on failure (default DEFAULT_TAIL_LINES). */
  tailLines?: number;
}

/** Predecessor parity: tests 300s, lint 120s, e2e 600s. */
export const DEFAULT_TIMEOUTS_MS = {
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
      stdio: ["ignore", "pipe", "pipe"],
    });

    const tail = new TailBuffer(MAX_CAPTURE_BYTES);
    child.stdout?.on("data", (chunk: Buffer) => tail.push(chunk));
    child.stderr?.on("data", (chunk: Buffer) => tail.push(chunk));

    let timedOut = false;
    let spawnError: Error | undefined;
    let settled = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
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
