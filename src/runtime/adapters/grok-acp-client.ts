// ACP (Agent Client Protocol) transport for Grok Build: newline-delimited
// JSON-RPC over the `grok agent stdio` subprocess's stdin/stdout.
//
// Deliberately structural rather than generated: ACP is a standard other CLIs
// also speak, but B-25 keeps transport reuse an implementation detail behind
// per-harness boundaries — a shared client never shares certification evidence
// across harnesses. Shape-wise this mirrors codex.ts's App Server client so a
// reader who knows one knows the other.

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { definedProps } from "../optional-properties.js";

export type GrokRpcId = number | string;

export interface GrokAgentMessage {
  method: string;
  params?: unknown;
  id?: GrokRpcId;
}

export interface GrokAcpClient extends AsyncIterable<GrokAgentMessage> {
  request(method: string, params?: unknown): Promise<unknown>;
  notify(method: string, params?: unknown): Promise<void>;
  respond(id: GrokRpcId, result: unknown): Promise<void>;
  close(): Promise<void>;
}

export interface GrokAcpLaunchOptions {
  args?: string[];
  env?: NodeJS.ProcessEnv;
  cwd?: string;
}

/** Protocol-version skew against the recorded binary band is a terminal config
 *  error, never something to negotiate around mid-turn (B-25). */
export class GrokProtocolVersionError extends Error {
  readonly code = "error_protocol_unsupported";
  constructor(readonly reported: unknown) {
    super(`GrokRuntime requires ACP protocolVersion 1; grok reported ${JSON.stringify(reported)}`);
    this.name = "GrokProtocolVersionError";
  }
}

export class StdioGrokAcpClient implements GrokAcpClient {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<GrokRpcId, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private readonly queue: GrokAgentMessage[] = [];
  private readonly waiters: Array<(result: IteratorResult<GrokAgentMessage>) => void> = [];
  private readonly stderr: string[] = [];
  private nextId = 1;
  private closed = false;
  private closing?: Promise<void>;

  constructor(options: GrokAcpLaunchOptions) {
    this.child = spawn("grok", options.args ?? ["agent", "stdio"], {
      stdio: ["pipe", "pipe", "pipe"],
      ...definedProps({ env: options.env, cwd: options.cwd }),
      // Own a process group so closing the adapter reaches grok's children
      // (hook handlers, shell commands), not only the immediate binary.
      detached: process.platform !== "win32",
    });
    createInterface({ input: this.child.stdout }).on("line", (line) => this.receiveLine(line));
    this.child.stderr.on("data", (chunk: Buffer) => {
      this.stderr.push(chunk.toString("utf8"));
      if (this.stderr.length > 20) this.stderr.shift();
    });
    this.child.on("error", (error) => this.closeWithError(error));
    this.child.on("close", (code, signal) => {
      if (this.closed) return;
      const detail = this.stderr.join("").trim();
      this.closeWithError(
        new Error(
          `grok agent stdio exited before the turn completed (code=${code}, signal=${signal})` +
            (detail.length > 0 ? `\n${detail}` : ""),
        ),
      );
    });
  }

  [Symbol.asyncIterator](): AsyncIterator<GrokAgentMessage> {
    return { next: () => this.nextMessage() };
  }

  async request(method: string, params?: unknown): Promise<unknown> {
    const id = this.nextId++;
    const result = new Promise<unknown>((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.send(params === undefined ? { jsonrpc: "2.0", id, method } : { jsonrpc: "2.0", id, method, params });
    return result;
  }

  async notify(method: string, params?: unknown): Promise<void> {
    this.send(params === undefined ? { jsonrpc: "2.0", method } : { jsonrpc: "2.0", method, params });
  }

  async respond(id: GrokRpcId, result: unknown): Promise<void> {
    this.send({ jsonrpc: "2.0", id, result });
  }

  async close(): Promise<void> {
    if (this.closing !== undefined) return this.closing;
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) waiter({ done: true, value: undefined });
    for (const pending of this.pending.values()) pending.reject(new Error("grok ACP client closed"));
    this.pending.clear();
    this.closing = this.terminateProcessGroup();
    return this.closing;
  }

  private nextMessage(): Promise<IteratorResult<GrokAgentMessage>> {
    const queued = this.queue.shift();
    if (queued !== undefined) return Promise.resolve({ done: false, value: queued });
    if (this.closed) return Promise.resolve({ done: true, value: undefined });
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  private receiveLine(line: string): void {
    if (line.trim() === "") return;
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      // A stray non-JSON line must not tear down a paid turn; skip it.
      return;
    }
    if (message === null || typeof message !== "object") return;
    const record = message as Record<string, unknown>;
    const rawId = record["id"];
    const id = typeof rawId === "string" || typeof rawId === "number" ? rawId : undefined;
    const method = typeof record["method"] === "string" ? record["method"] : undefined;
    if (id !== undefined && method === undefined) {
      const pending = this.pending.get(id);
      if (pending === undefined) return;
      this.pending.delete(id);
      if ("error" in record) pending.reject(new Error(`grok ACP request failed: ${JSON.stringify(record["error"])}`));
      else pending.resolve(record["result"]);
      return;
    }
    if (method === undefined) return;
    const agentMessage: GrokAgentMessage =
      id === undefined ? { method, params: record["params"] } : { method, params: record["params"], id };
    const waiter = this.waiters.shift();
    if (waiter !== undefined) waiter({ done: false, value: agentMessage });
    else this.queue.push(agentMessage);
  }

  private send(payload: unknown): void {
    if (this.closed) throw new Error("grok ACP client is closed");
    this.child.stdin.write(`${JSON.stringify(payload)}\n`);
  }

  private closeWithError(error: Error): void {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    for (const waiter of this.waiters.splice(0)) waiter(Promise.reject(error) as never);
  }

  private async terminateProcessGroup(): Promise<void> {
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
      const finish = (): void => {
        if (done) return;
        done = true;
        clearTimeout(hardTimer);
        clearTimeout(giveUpTimer);
        this.child.off("close", finish);
        resolve();
      };
      this.child.once("close", finish);
      hardTimer = setTimeout(() => send("SIGKILL"), 1_000);
      // A pathological OS/process state must not make adapter close infinite.
      giveUpTimer = setTimeout(finish, 1_750);
      send("SIGTERM");
      if (this.child.exitCode !== null || this.child.signalCode !== null) finish();
    });
  }
}
