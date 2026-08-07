// The `cursor-agent` subprocess boundary: argv in, the brief on stdin, ordered
// stream-json lines out, and a process-group kill for cancellation.
//
// The binary is resolved as `cursor-agent` and NEVER as the short alias
// `agent`: on the 2026-08-07 verification host `agent` resolves to Grok Build,
// so the short name is a collision hazard, not a convenience. Cormidia never
// installs a provider (#224).

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import type { CursorStreamEvent } from "./cursor-stream.js";

export const CURSOR_AGENT_BINARY = "cursor-agent";

export interface CursorLaunchOptions {
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}

export interface CursorProcess {
  /** The brief travels on stdin — never argv (the ARG_MAX lesson). */
  writeTask(task: string): void;
  events: AsyncIterable<CursorStreamEvent>;
  close(): Promise<void>;
}

export type CursorProcessFactory = (options: CursorLaunchOptions) => CursorProcess;

export class StdioCursorProcess implements CursorProcess {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly queue: CursorStreamEvent[] = [];
  private readonly waiters: Array<(result: IteratorResult<CursorStreamEvent>) => void> = [];
  private readonly stderr: string[] = [];
  private closed = false;
  private closing?: Promise<void>;
  private failure?: Error;

  constructor(options: CursorLaunchOptions) {
    this.child = spawn(CURSOR_AGENT_BINARY, options.args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["pipe", "pipe", "pipe"],
      // Own a process group so cancellation reaches cursor-agent's children,
      // not only the immediate wrapper.
      detached: process.platform !== "win32",
    });
    const stdout = createInterface({ input: this.child.stdout });
    stdout.on("line", (line) => this.receiveLine(line));
    // Deliberately NOT ending the stream on stdout close. stdout closes before
    // the child's own `close` event, so finishing here raced the exit-code
    // handler and swallowed the provider's diagnostic: a config-validation
    // exit(1) surfaced as a bare `failed` turn with no reason at all (caught in
    // live certification 2026-08-07). The child's `close` is the one terminal
    // signal that has both the exit code and the drained stderr.
    this.child.stderr.on("data", (chunk: Buffer) => {
      this.stderr.push(chunk.toString("utf8"));
      if (this.stderr.length > 20) this.stderr.shift();
    });
    this.child.on("error", (error) => {
      this.failure ??= error;
      this.finish();
    });
    this.child.on("close", (code) => {
      if (code !== 0 && code !== null && this.queue.length === 0) {
        const detail = this.stderr.join("").trim();
        this.failure ??= new Error(
          `cursor-agent exited ${code} before delivering a result${detail.length > 0 ? `\n${detail}` : ""}`,
        );
      }
      this.finish();
    });
  }

  writeTask(task: string): void {
    this.child.stdin.end(task);
  }

  events: AsyncIterable<CursorStreamEvent> = {
    [Symbol.asyncIterator]: (): AsyncIterator<CursorStreamEvent> => ({ next: () => this.nextEvent() }),
  };

  async close(): Promise<void> {
    this.closing ??= this.terminateProcessGroup();
    return this.closing;
  }

  private nextEvent(): Promise<IteratorResult<CursorStreamEvent>> {
    const queued = this.queue.shift();
    if (queued !== undefined) return Promise.resolve({ done: false, value: queued });
    if (this.closed) {
      return this.failure === undefined
        ? Promise.resolve({ done: true, value: undefined })
        : Promise.reject(this.failure);
    }
    return new Promise((resolve, reject) => {
      this.waiters.push((result) => {
        if (result.done === true && this.failure !== undefined) reject(this.failure);
        else resolve(result);
      });
    });
  }

  private receiveLine(line: string): void {
    if (line.trim() === "") return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      // Protocol drift on a fast-moving CLI is a typed failure, never a silent
      // re-parse or a skipped line (B-24).
      this.failure ??= new Error(
        `cursor-agent emitted a non-JSON stream-json line: ${JSON.stringify(line.slice(0, 200))}`,
      );
      this.finish();
      return;
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return;
    const event = parsed as CursorStreamEvent;
    const waiter = this.waiters.shift();
    if (waiter !== undefined) waiter({ done: false, value: event });
    else this.queue.push(event);
  }

  private finish(): void {
    if (this.closed) return;
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) waiter({ done: true, value: undefined });
  }

  private async terminateProcessGroup(): Promise<void> {
    this.finish();
    if (this.child.exitCode !== null || this.child.signalCode !== null) return;
    const pid = this.child.pid;
    const send = (signal: NodeJS.Signals): void => {
      try {
        if (process.platform !== "win32" && pid !== undefined) process.kill(-pid, signal);
        else this.child.kill(signal);
      } catch {
        // Already exited.
      }
    };
    await new Promise<void>((resolve) => {
      let done = false;
      let hardTimer: NodeJS.Timeout;
      let giveUpTimer: NodeJS.Timeout;
      const settle = (): void => {
        if (done) return;
        done = true;
        clearTimeout(hardTimer);
        clearTimeout(giveUpTimer);
        this.child.off("close", settle);
        resolve();
      };
      this.child.once("close", settle);
      hardTimer = setTimeout(() => send("SIGKILL"), 1_000);
      // A pathological OS/process state must not make adapter close infinite.
      giveUpTimer = setTimeout(settle, 1_750);
      send("SIGTERM");
      if (this.child.exitCode !== null || this.child.signalCode !== null) settle();
    });
  }
}
