import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readlinkSync } from "node:fs";
import { resolve, sep } from "node:path";
import { appCommandEnv } from "../runtime/non-interactive-env.js";
import { definedProps } from "../runtime/optional-properties.js";

const MAX_CAPTURE_BYTES = 256 * 1024;
const TRUNCATION_MARKER = "[cormidia: output truncated]";
// Keep a few bytes of UTF-8 boundary headroom: slicing a byte stream may
// replace a split leading code point with U+FFFD when it becomes text.
const PROCESS_CAPTURE_BYTES = MAX_CAPTURE_BYTES - Buffer.byteLength(`${TRUNCATION_MARKER}\n`) - 4;

export interface CandidateBoundProcessResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  spawnError?: Error;
  candidateError?: Error;
  outputTail?: string;
  worktree: string;
  candidateSha?: string;
  candidateMutationPaths?: string[];
}

interface CandidateSnapshot {
  head: string;
  fingerprint: string;
  changedPaths: string[];
}

/** Run one app-owned command against an immutable candidate identity. */
export async function runCandidateBoundProcess(
  command: string,
  cwd: string,
  timeoutMs: number,
  tailLines: number,
): Promise<CandidateBoundProcessResult> {
  const worktree = resolve(cwd);
  let before: CandidateSnapshot;
  try {
    before = candidateSnapshot(worktree);
  } catch (error) {
    return {
      exitCode: null,
      signal: null,
      timedOut: false,
      candidateError: error instanceof Error ? error : new Error(String(error)),
      worktree,
    };
  }

  const process = await runShell(command, worktree, timeoutMs, tailLines);
  let after: CandidateSnapshot;
  try {
    after = candidateSnapshot(worktree);
  } catch (error) {
    return {
      ...process,
      candidateError: error instanceof Error ? error : new Error(String(error)),
      worktree,
      candidateSha: before.head,
    };
  }

  return {
    ...process,
    worktree,
    candidateSha: before.head,
    ...(before.fingerprint === after.fingerprint
      ? {}
      : { candidateMutationPaths: candidateMutationPaths(worktree, before, after) }),
  };
}

function candidateMutationPaths(worktree: string, before: CandidateSnapshot, after: CandidateSnapshot): string[] {
  const paths = new Set([...before.changedPaths, ...after.changedPaths]);
  if (before.head !== after.head) {
    for (const path of gitText(worktree, ["diff", "--name-only", before.head, after.head, "--"])
      .split("\n")
      .filter(Boolean)) {
      paths.add(path);
    }
  }
  if (paths.size === 0) paths.add("candidate identity changed");
  return [...paths].sort();
}

function candidateSnapshot(worktree: string): CandidateSnapshot {
  const head = gitText(worktree, ["rev-parse", "HEAD"]);
  const diff = gitBuffer(worktree, ["diff", "--no-ext-diff", "--binary", "HEAD", "--"]);
  const tracked = gitText(worktree, ["diff", "--name-only", "HEAD", "--"]).split("\n").filter(Boolean);
  const untracked = gitBuffer(worktree, ["ls-files", "--others", "--exclude-standard", "-z"])
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .sort();
  const hash = createHash("sha256").update(head).update("\0").update(diff).update("\0");
  for (const relative of untracked) {
    const path = pathInsideWorktree(worktree, relative);
    const stat = lstatSync(path);
    hash.update(relative).update("\0").update(String(stat.mode)).update("\0");
    if (stat.isSymbolicLink()) hash.update(readlinkSync(path));
    else hash.update(readFileSync(path));
    hash.update("\0");
  }
  return { head, fingerprint: hash.digest("hex"), changedPaths: [...new Set([...tracked, ...untracked])].sort() };
}

function pathInsideWorktree(worktree: string, relative: string): string {
  const path = resolve(worktree, relative);
  if (path !== worktree && !path.startsWith(`${worktree}${sep}`)) {
    throw new Error(`git reported a path outside the worktree: ${relative}`);
  }
  return path;
}

function gitText(cwd: string, args: string[]): string {
  return gitBuffer(cwd, args).toString("utf8").trimEnd();
}

function gitBuffer(cwd: string, args: string[]): Buffer {
  return execFileSync("git", args, {
    cwd,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  });
}

async function runShell(command: string, cwd: string, timeoutMs: number, tailLines: number) {
  return new Promise<Omit<CandidateBoundProcessResult, "worktree">>((resolveRun) => {
    const child = spawn(command, {
      shell: true,
      cwd,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: appCommandEnv(),
    });
    const tail = new TailBuffer(PROCESS_CAPTURE_BYTES);
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
      const outputTail = boundedTail(tail.toString(), tailLines, tail.wasTruncated());
      resolveRun({
        exitCode,
        signal,
        timedOut,
        ...definedProps({ spawnError, outputTail }),
      });
    };

    child.on("error", (error) => {
      spawnError = error;
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
    process.kill(-child.pid, "SIGKILL");
  } catch {
    child.kill("SIGKILL");
  }
}

function boundedTail(output: string, lineCap: number, byteTruncated: boolean): string | undefined {
  const trimmed = output.replace(/\s+$/, "");
  if (trimmed === "") return byteTruncated ? TRUNCATION_MARKER : undefined;
  const lines = trimmed.split(/\r?\n/);
  const truncated = byteTruncated || lines.length > lineCap;
  const body = lines.slice(-lineCap).join("\n");
  return truncated ? `${TRUNCATION_MARKER}\n${body}` : body;
}

class TailBuffer {
  private chunks: Buffer[] = [];
  private total = 0;
  private truncated = false;

  constructor(private readonly cap: number) {}

  push(chunk: Buffer): void {
    this.chunks.push(chunk);
    this.total += chunk.length;
    if (this.total > this.cap) this.truncated = true;
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

  wasTruncated(): boolean {
    return this.truncated;
  }
}
