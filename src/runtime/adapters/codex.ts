// OpenAI roles -> Codex App Server over its generated JSON-RPC/JSONL protocol.
//
// M10 deliberately uses the App Server surface, not @openai/codex-sdk:
// the SDK wraps `codex exec` for batch jobs, while App Server is the rich
// client protocol with threads, resume, approval callbacks, streamed items,
// and token usage notifications. The wire types are generated per Codex CLI
// version with `codex app-server generate-ts`; this adapter keeps a small
// structural client so generated files do not become repo-owned source.

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createRequire } from "node:module";
import { createInterface } from "node:readline";
import type {
  Artifact,
  GateEscalation,
  Runtime,
  ToolAction,
  TurnHooks,
  TurnRequest,
  TurnResult,
  TurnUsage,
} from "../types.js";
import { renderContextBundle } from "../worktree-context.js";
import { toolUseEvent } from "../tool-events.js";
import { codexAppServerArgs, startCodexGateBridge } from "./codex-gate-bridge.js";

export type JsonRpcId = number | string;

export interface CodexServerMessage {
  method: string;
  params?: unknown;
  id?: JsonRpcId;
}

export interface CodexAppServerClient extends AsyncIterable<CodexServerMessage> {
  request(method: string, params?: unknown): Promise<unknown>;
  notify(method: string, params?: unknown): Promise<void>;
  respond(id: JsonRpcId, result: unknown): Promise<void>;
  close(): Promise<void>;
}

export interface CodexAppServerLaunchOptions {
  args?: string[];
  env?: NodeJS.ProcessEnv;
}

export type CodexAppServerClientFactory = (
  options?: CodexAppServerLaunchOptions,
) => CodexAppServerClient;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

export class StdioCodexAppServerClient implements CodexAppServerClient {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<JsonRpcId, PendingRequest>();
  private readonly queue: CodexServerMessage[] = [];
  private readonly waiters: Array<(result: IteratorResult<CodexServerMessage>) => void> = [];
  private readonly stderr: string[] = [];
  private nextId = 1;
  private closed = false;
  private closing?: Promise<void>;

  constructor(options: CodexAppServerLaunchOptions = {}) {
    const require = createRequire(import.meta.url);
    const codexBin = require.resolve("@openai/codex/bin/codex.js");
    this.child = spawn(process.execPath, [codexBin, ...(options.args ?? ["app-server", "--listen", "stdio://"])], {
      stdio: ["pipe", "pipe", "pipe"],
      ...(options.env !== undefined ? { env: options.env } : {}),
      // Own a process group so closing the adapter reaches App Server children,
      // not only the immediate Node wrapper.
      detached: process.platform !== "win32",
    });

    const stdout = createInterface({ input: this.child.stdout });
    stdout.on("line", (line) => this.receiveLine(line));
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
          `Codex App Server exited before the turn completed (code=${code}, signal=${signal})` +
            (detail.length > 0 ? `\n${detail}` : ""),
        ),
      );
    });
  }

  [Symbol.asyncIterator](): AsyncIterator<CodexServerMessage> {
    return {
      next: () => this.nextMessage(),
    };
  }

  async request(method: string, params?: unknown): Promise<unknown> {
    const id = this.nextId++;
    const payload = params === undefined ? { id, method } : { id, method, params };
    const result = new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    this.send(payload);
    return result;
  }

  async notify(method: string, params?: unknown): Promise<void> {
    this.send(params === undefined ? { method } : { method, params });
  }

  async respond(id: JsonRpcId, result: unknown): Promise<void> {
    this.send({ id, result });
  }

  async close(): Promise<void> {
    if (this.closing !== undefined) return this.closing;
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) waiter({ done: true, value: undefined });
    for (const pending of this.pending.values()) {
      pending.reject(new Error("Codex App Server client closed"));
    }
    this.pending.clear();
    this.closing = this.terminateProcessGroup();
    return this.closing;
  }

  private nextMessage(): Promise<IteratorResult<CodexServerMessage>> {
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
    } catch (error) {
      this.closeWithError(new Error(`Codex App Server sent invalid JSON: ${(error as Error).message}`));
      return;
    }

    if (!isRecord(message)) return;
    const id = asRpcId(message.id);
    const method = typeof message.method === "string" ? message.method : undefined;
    if (id !== undefined && method === undefined) {
      const pending = this.pending.get(id);
      if (pending === undefined) return;
      this.pending.delete(id);
      if ("error" in message) {
        pending.reject(new Error(`Codex App Server request failed: ${JSON.stringify(message.error)}`));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (method !== undefined) {
      const serverMessage: CodexServerMessage =
        id === undefined
          ? { method, params: message.params }
          : { method, params: message.params, id };
      const waiter = this.waiters.shift();
      if (waiter !== undefined) {
        waiter({ done: false, value: serverMessage });
      } else {
        this.queue.push(serverMessage);
      }
    }
  }

  private send(payload: unknown): void {
    if (this.closed) throw new Error("Codex App Server client is closed");
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

export interface CodexRuntimeOptions {
  clientFactory?: CodexAppServerClientFactory;
  /** Explicit environment for App Server and its hook subprocesses. Eval
   *  campaigns use this to pin provider scratch under the campaign root. */
  appServerEnv?: NodeJS.ProcessEnv;
}

interface CodexTurnState {
  threadId: string;
  finalSummary?: string;
  status?: TurnResult["status"];
  usage?: TurnUsage;
  subagentTurns: number;
  durationMs?: number;
  /** Set once the running (estimated) cost crosses role.maxTurnBudgetUsd; the
   *  turn is then stopped and mapped to failed + one incident note, mirroring
   *  ClaudeRuntime's budget-overrun contract. */
  budgetOverrun?: boolean;
  /** Stable code for a classified failure (e.g. "error_auth"); unclassified
   *  failures leave it unset and render as error_unknown downstream. */
  errorCode?: string;
}

export class CodexRuntime implements Runtime {
  readonly kind = "codex" as const;
  private readonly clientFactory: CodexAppServerClientFactory;
  private readonly appServerEnv: NodeJS.ProcessEnv | undefined;

  constructor(opts: CodexRuntimeOptions = {}) {
    this.clientFactory = opts.clientFactory ?? ((launch) => new StdioCodexAppServerClient(launch));
    this.appServerEnv = opts.appServerEnv;
  }

  async runTurn(req: TurnRequest, hooks: TurnHooks): Promise<TurnResult> {
    if (req.session !== undefined && req.session.runtime !== "codex") {
      throw new Error(
        `CodexRuntime cannot resume a "${req.session.runtime}" session - ` +
          `cross-runtime resume is an orchestrator bug (session id: ${req.session.id})`,
      );
    }

    const startTime = Date.now();
    const escalations: GateEscalation[] = [];
    const gateBridge = await startCodexGateBridge(req.workdir, hooks, escalations);
    const client = this.clientFactory({
      args: codexAppServerArgs(),
      env: { ...(this.appServerEnv ?? process.env), ...gateBridge.env },
    });
    const state: CodexTurnState = {
      threadId: req.session?.id ?? `pending-${startTime}`,
      subagentTurns: 0,
    };
    const abortClient = (): void => {
      void client.close();
    };
    req.signal?.addEventListener("abort", abortClient, { once: true });
    try {
      if (req.signal?.aborted) return stoppedCodexResult(req, state, escalations, startTime);
      await client.request("initialize", {
        clientInfo: { name: "operon", title: "Operon", version: "0.1.0" },
        capabilities: {
          experimentalApi: true,
          requestAttestation: false,
          optOutNotificationMethods: [],
        },
      });
      await client.notify("initialized");

      const threadResponse =
        req.session === undefined
          ? await client.request("thread/start", threadParams(req))
          : await client.request("thread/resume", { threadId: req.session.id, ...threadParams(req) });
      const threadId = extractThreadId(threadResponse) ?? req.session?.id;
      if (threadId === undefined) {
        throw new Error("CodexRuntime: App Server did not return a thread id");
      }
      state.threadId = threadId;
      hooks.onProgress?.({ session: { runtime: "codex", id: threadId } });

      await client.request("turn/start", turnParams(req, threadId));

      for await (const message of client) {
        await this.handleServerMessage(client, message, req, hooks, escalations, state);
        if (state.status !== undefined) break;
      }

      if (req.signal?.aborted) return stoppedCodexResult(req, state, escalations, startTime);

      const wallClockMs = state.durationMs ?? Date.now() - startTime;
      // A budget overrun is a hard stop: it fails the turn and emits exactly
      // one incident note, regardless of any gate escalations that also
      // occurred (mirrors ClaudeRuntime — the forced stop is the headline).
      const status = state.budgetOverrun
        ? "failed"
        : escalations.length > 0
          ? "blocked_on_gate"
          : state.status ?? "failed";
      return {
        status,
        summary: state.finalSummary ?? "Codex App Server turn completed without an agent message",
        artifacts: state.budgetOverrun
          ? [budgetOverrunNote(threadId, state.usage?.costUsd ?? 0, req)]
          : [],
        session: { runtime: "codex", id: threadId },
        usage: finalCodexUsage(state.usage ?? zeroUsage(wallClockMs, state.subagentTurns)),
        escalations,
        ...(state.budgetOverrun
          ? { errorCode: "error_max_budget_usd" }
          : status === "failed" && state.errorCode !== undefined
            ? { errorCode: state.errorCode }
            : {}),
      };
    } catch (error) {
      if (req.signal?.aborted) return stoppedCodexResult(req, state, escalations, startTime);
      throw error;
    } finally {
      req.signal?.removeEventListener("abort", abortClient);
      await client.close();
      await gateBridge.close();
    }
  }

  private async handleServerMessage(
    client: CodexAppServerClient,
    message: CodexServerMessage,
    req: TurnRequest,
    hooks: TurnHooks,
    escalations: GateEscalation[],
    state: CodexTurnState,
  ): Promise<void> {
    switch (message.method) {
      case "item/commandExecution/requestApproval":
        await routeApproval(client, message, req, hooks, escalations, "commandExecution");
        return;
      case "execCommandApproval":
        await routeApproval(client, message, req, hooks, escalations, "legacyExec");
        return;
      case "item/fileChange/requestApproval":
        await routeApproval(client, message, req, hooks, escalations, "fileChange");
        return;
      case "applyPatchApproval":
        await routeApproval(client, message, req, hooks, escalations, "legacyPatch");
        return;
      case "mcpServer/elicitation/request":
        await declineMcpElicitation(client, message, hooks);
        return;
      case "thread/tokenUsage/updated":
        {
          // `.last` is the LATEST request's usage, not the running total. A
          // multi-request turn emits several notifications; accumulate their
          // deltas so the reported usage (and the budget guard below) reflect
          // the whole turn instead of only the final request. Summing deltas
          // (rather than reading the cumulative `.total`) is also correct for a
          // resumed thread, whose `.total` would include prior turns' tokens.
          const delta = usageFromTokenNotification(
            message.params,
            req.role.model,
            state.subagentTurns,
            state.durationMs,
          );
          if (delta !== undefined) {
            state.usage = addUsageDelta(state.usage, delta, state.subagentTurns, state.durationMs);
            hooks.onProgress?.({
              at: new Date().toISOString(),
              session: { runtime: "codex", id: state.threadId },
              usage: { ...state.usage, quality: "partial" },
            });
            // Running per-turn budget guard on the ACCUMULATED estimate. The
            // App Server exposes no native budget knob (unlike Claude's
            // --max-budget-usd), so Operon enforces the cap itself: once the
            // estimated running spend crosses role.maxTurnBudgetUsd we stop
            // consuming and let the finally-block close the client (terminating
            // the App Server turn). Reading the accumulated total (not `.last`)
            // is what makes the cap non-evadable. Overrun = incident note, not
            // silent spend (roles.yaml).
            if (state.usage.costUsd >= req.role.maxTurnBudgetUsd) {
              state.budgetOverrun = true;
              state.status = "failed";
              state.finalSummary =
                `Budget overrun: turn stopped at the per-turn cap — estimated spend ` +
                `$${state.usage.costUsd.toFixed(4)} crossed maxTurnBudgetUsd ` +
                `$${req.role.maxTurnBudgetUsd} (role ${req.role.name}).`;
            }
          }
        }
        return;
      case "item/completed":
        this.handleItemCompleted(message.params, hooks, state);
        return;
      case "turn/completed":
        this.handleTurnCompleted(message.params, state);
        return;
      case "error":
        state.status = "failed";
        state.finalSummary = errorSummary(message.params);
        {
          const code = classifyCodexFailure(state.finalSummary);
          if (code !== undefined) state.errorCode ??= code;
        }
        return;
      default:
        if (message.id !== undefined) {
          await client.respond(message.id, { error: `Operon does not implement App Server request ${message.method}` });
          state.status = "failed";
          state.finalSummary = `Unsupported Codex App Server request: ${message.method}`;
        }
    }
  }

  private handleItemCompleted(params: unknown, hooks: TurnHooks, state: CodexTurnState): void {
    const item = isRecord(params) && isRecord(params.item) ? params.item : undefined;
    if (item === undefined) return;
    const type = item.type;
    if (type === "agentMessage" && typeof item.text === "string") {
      state.finalSummary = item.text.trim();
    } else if (type === "commandExecution") {
      // Executed command item (issue #27): unlike Claude's pre-execution
      // hook, the completed item carries the outcome — exit code and, when
      // the server reports it, duration. Approval-declined commands never
      // reach item/completed, so this emits executed tools only.
      const command = typeof item.command === "string" ? item.command : "";
      const exitCode = typeof item.exitCode === "number" ? item.exitCode : undefined;
      hooks.onEvent?.(
        toolUseEvent(
          { tool: "bash", input: { command } },
          {
            ...(exitCode !== undefined ? { success: exitCode === 0 } : {}),
            ...(typeof item.durationMs === "number" ? { durationMs: item.durationMs } : {}),
          },
        ),
      );
    } else if (type === "fileChange") {
      // One tool_use per changed file when the item lists them; a bare item
      // still emits one event so the write is never invisible (issue #27).
      const changes = Array.isArray(item.changes) ? item.changes : [undefined];
      for (const change of changes) {
        const path =
          isRecord(change) && typeof change.path === "string"
            ? change.path
            : typeof item.path === "string"
              ? item.path
              : "";
        hooks.onEvent?.(toolUseEvent({ tool: "write", input: { path } }));
      }
    } else if (type === "subAgentActivity") {
      state.subagentTurns += item.kind === "started" || item.kind === "start" ? 1 : 0;
      hooks.onEvent?.({
        type: "subagent",
        detail: `codex subagent ${String(item.kind)}: ${String(item.agentThreadId ?? item.agentPath ?? "")}`,
      });
    } else if (type === "collabAgentToolCall") {
      const receiverCount = Array.isArray(item.receiverThreadIds) ? item.receiverThreadIds.length : 0;
      if (receiverCount > 0) state.subagentTurns += receiverCount;
      hooks.onEvent?.({
        type: "subagent",
        detail: `codex collab agent call: ${String(item.tool)} (${receiverCount} receiver thread(s))`,
      });
    }
  }

  private handleTurnCompleted(params: unknown, state: CodexTurnState): void {
    const turn = isRecord(params) && isRecord(params.turn) ? params.turn : undefined;
    if (turn === undefined) {
      state.status = "failed";
      state.finalSummary = "Codex App Server sent turn/completed without a turn payload";
      return;
    }

    const duration = typeof turn.durationMs === "number" ? turn.durationMs : undefined;
    if (duration !== undefined) state.durationMs = duration;
    const finalFromTurn = finalAgentMessage(turn);
    if (finalFromTurn !== undefined) state.finalSummary = finalFromTurn;
    const status = typeof turn.status === "string" ? turn.status : "failed";
    if (status === "completed") {
      state.status = "completed";
    } else {
      state.status = "failed";
      if (state.finalSummary === undefined) state.finalSummary = turnErrorSummary(turn);
      const code = classifyCodexFailure(turnErrorSummary(turn));
      if (code !== undefined) state.errorCode ??= code;
    }
    if (state.usage !== undefined) {
      state.usage = { ...state.usage, subagentTurns: state.subagentTurns, wallClockMs: state.durationMs ?? state.usage.wallClockMs };
    }
  }
}

function finalCodexUsage(usage: TurnUsage): TurnUsage {
  return { ...usage, quality: "estimated" };
}

function stoppedCodexResult(
  req: TurnRequest,
  state: CodexTurnState,
  escalations: GateEscalation[],
  startedAt: number,
): TurnResult {
  const descriptor = stopDescriptor(req.signal?.reason);
  const usage = state.usage ?? zeroUsage(Date.now() - startedAt, state.subagentTurns);
  return {
    status: descriptor.status,
    errorCode: descriptor.errorCode,
    summary: descriptor.reason,
    artifacts: [],
    session: { runtime: "codex", id: state.threadId },
    usage: {
      ...usage,
      wallClockMs: Date.now() - startedAt,
      quality: state.usage === undefined ? "unavailable" : "partial",
    },
    escalations,
  };
}

function stopDescriptor(reason: unknown): {
  status: "cancelled" | "timed_out";
  errorCode: string;
  reason: string;
} {
  if (reason !== null && typeof reason === "object") {
    const value = reason as Record<string, unknown>;
    if (
      (value["status"] === "cancelled" || value["status"] === "timed_out") &&
      typeof value["errorCode"] === "string" &&
      typeof value["reason"] === "string"
    ) {
      return {
        status: value["status"],
        errorCode: value["errorCode"],
        reason: value["reason"],
      };
    }
  }
  return {
    status: "cancelled",
    errorCode: "error_cancelled",
    reason: typeof reason === "string" && reason.length > 0 ? reason : "operator cancellation",
  };
}

async function declineMcpElicitation(
  client: CodexAppServerClient,
  message: CodexServerMessage,
  hooks: TurnHooks,
): Promise<void> {
  if (message.id === undefined) return;
  const params = isRecord(message.params) ? message.params : {};
  hooks.onEvent?.({
    type: "text",
    detail:
      `codex mcp elicitation declined: ` +
      `${String(params.serverName ?? "unknown-server")} ` +
      `${String(params.mode ?? "unknown-mode")}`,
  });
  await client.respond(message.id, { action: "decline", content: null, _meta: null });
}

function threadParams(req: TurnRequest): Record<string, unknown> {
  return {
    model: req.role.model,
    cwd: req.workdir,
    approvalPolicy: "untrusted",
    approvalsReviewer: "user",
    sandbox: "workspace-write",
    developerInstructions: renderContextBundle(req.context),
    ephemeral: false,
    config: { model_reasoning_effort: mapCodexEffort(req.role.effort) },
  };
}

function turnParams(req: TurnRequest, threadId: string): Record<string, unknown> {
  return {
    threadId,
    input: [{ type: "text", text: req.task, text_elements: [] }],
    cwd: req.workdir,
    approvalPolicy: "untrusted",
    approvalsReviewer: "user",
    sandboxPolicy: {
      type: "workspaceWrite",
      writableRoots: [req.workdir],
      networkAccess: req.networkAccess === true,
      excludeTmpdirEnvVar: false,
      excludeSlashTmp: false,
    },
    model: req.role.model,
    effort: mapCodexEffort(req.role.effort),
    ...(req.verdictSchema !== undefined
      ? { outputSchema: toCodexStrictSchema(req.verdictSchema) }
      : {}),
  };
}

/** OpenAI/Codex strict structured outputs (`response_format` json_schema,
 *  strict:true) reject a schema whose object `required` omits any key in
 *  `properties` — the App Server surfaces this as
 *  "'required' ... must be ... an array including every key in properties".
 *  The loop's generic verdict schema marks a semantically optional field (the
 *  build verdict's `blockedEntry`, present only when status="blocked") by
 *  leaving it out of `required`. Translate that into the strict form OpenAI
 *  demands: every property is required, and an originally-optional field is
 *  made nullable instead. The loop's return-path validator treats an explicit
 *  null on an optional field as absent, so the round-trip stays lossless. */
export function toCodexStrictSchema(
  schema: Record<string, unknown>,
): Record<string, unknown> {
  return strictSchemaNode(schema, false) as Record<string, unknown>;
}

function strictSchemaNode(node: unknown, nullable: boolean): unknown {
  if (node === null || typeof node !== "object" || Array.isArray(node)) return node;
  const src = node as Record<string, unknown>;
  const out: Record<string, unknown> = { ...src };

  if (src["type"] === "object" && src["properties"] !== null && typeof src["properties"] === "object") {
    const props = src["properties"] as Record<string, unknown>;
    const originalRequired = new Set(
      Array.isArray(src["required"])
        ? (src["required"] as unknown[]).filter((k): k is string => typeof k === "string")
        : [],
    );
    const nextProps: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(props)) {
      nextProps[key] = strictSchemaNode(child, !originalRequired.has(key));
    }
    out["properties"] = nextProps;
    out["required"] = Object.keys(props);
    out["additionalProperties"] = false;
  } else if (src["type"] === "array" && src["items"] !== undefined) {
    out["items"] = strictSchemaNode(src["items"], false);
  }

  if (nullable) out["type"] = nullableType(src["type"]);
  return out;
}

function nullableType(type: unknown): unknown {
  if (Array.isArray(type)) return type.includes("null") ? type : [...type, "null"];
  if (typeof type === "string") return type === "null" ? type : [type, "null"];
  return type;
}

function mapCodexEffort(effort: TurnRequest["role"]["effort"]): string {
  if (effort === "max") return "xhigh";
  return effort;
}

async function routeApproval(
  client: CodexAppServerClient,
  message: CodexServerMessage,
  req: TurnRequest,
  hooks: TurnHooks,
  escalations: GateEscalation[],
  kind: "commandExecution" | "fileChange" | "legacyExec" | "legacyPatch",
): Promise<void> {
  if (message.id === undefined) return;
  // A single applyPatch approval can bundle MANY files. Gate EVERY one and
  // fail closed: if any file trips a critical rule the whole patch is
  // declined, because the App Server applies the patch atomically — there is
  // no per-file response. Gating only the first entry let a benign-first,
  // protocol-self-edit/scorecard-tamper-second patch slip the gate.
  const actions = normalizeCodexApprovalActions(kind, message.params, req.workdir);
  let allow = true;
  for (const action of actions) {
    const decision = hooks.gate(action);
    if (!decision.allow) {
      allow = false;
      if (decision.escalate) escalations.push({ action, reason: decision.reason });
    }
  }
  switch (kind) {
    case "commandExecution":
      await client.respond(message.id, { decision: allow ? "accept" : "decline" });
      return;
    case "fileChange":
      await client.respond(message.id, { decision: allow ? "accept" : "decline" });
      return;
    case "legacyExec":
    case "legacyPatch":
      await client.respond(message.id, { decision: allow ? "approved" : "denied" });
      return;
  }
}

/** All tool actions an approval covers. Only a legacyPatch can carry more
 *  than one (its `fileChanges` map is per-patch, many files); every other
 *  approval kind is single-action. The gate must see EVERY file. */
export function normalizeCodexApprovalActions(
  kind: "commandExecution" | "fileChange" | "legacyExec" | "legacyPatch",
  params: unknown,
  workdir: string,
): ToolAction[] {
  if (kind === "legacyPatch") {
    return normalizePatchApprovals(isRecord(params) ? params : {}, workdir);
  }
  return [normalizeCodexApprovalAction(kind, params, workdir)];
}

export function normalizeCodexApprovalAction(
  kind: "commandExecution" | "fileChange" | "legacyExec" | "legacyPatch",
  params: unknown,
  workdir: string,
): ToolAction {
  const p = isRecord(params) ? params : {};
  switch (kind) {
    case "commandExecution": {
      const command = typeof p.command === "string" ? p.command : "";
      return withOptionalDescription(
        { tool: "bash", input: { command } },
        typeof p.reason === "string" ? p.reason : undefined,
      );
    }
    case "legacyExec": {
      const command = Array.isArray(p.command)
        ? p.command.map((part) => String(part)).join(" ")
        : typeof p.command === "string"
          ? p.command
          : "";
      return withOptionalDescription(
        { tool: "bash", input: { command } },
        typeof p.reason === "string" ? p.reason : undefined,
      );
    }
    case "fileChange": {
      const path = relativize(typeof p.path === "string" ? p.path : typeof p.grantRoot === "string" ? p.grantRoot : ".", workdir);
      return withOptionalDescription(
        { tool: "edit", input: { path } },
        typeof p.reason === "string" ? p.reason : undefined,
      );
    }
    case "legacyPatch":
      return normalizePatchApproval(p, workdir);
  }
}

/** One ToolAction per file in the patch (fail-closed multi-file gating). */
function normalizePatchApprovals(params: Record<string, unknown>, workdir: string): ToolAction[] {
  const fileChanges = isRecord(params.fileChanges) ? params.fileChanges : {};
  const entries = Object.entries(fileChanges);
  if (entries.length === 0) {
    const fallback = typeof params.grantRoot === "string" ? params.grantRoot : ".";
    return [patchEntryToAction(fallback, undefined, params, workdir)];
  }
  return entries.map(([path, change]) => patchEntryToAction(path, change, params, workdir));
}

/** Single-file normalization, retained for callers that only need the first
 *  file (e.g. the exported unit-test surface); the gate path uses the plural
 *  form above so no file is skipped. */
function normalizePatchApproval(params: Record<string, unknown>, workdir: string): ToolAction {
  const fileChanges = isRecord(params.fileChanges) ? params.fileChanges : {};
  const [firstPath, firstChange] = Object.entries(fileChanges)[0] ?? [
    typeof params.grantRoot === "string" ? params.grantRoot : ".",
    undefined,
  ];
  return patchEntryToAction(firstPath, firstChange, params, workdir);
}

function patchEntryToAction(
  rawPath: string,
  change: unknown,
  params: Record<string, unknown>,
  workdir: string,
): ToolAction {
  const path = relativize(rawPath, workdir);
  const reason = typeof params.reason === "string" ? params.reason : undefined;
  if (isRecord(change) && change.type === "add") {
    return withOptionalDescription({ tool: "write", input: { path, content: change.content } }, reason);
  }
  if (isRecord(change) && change.type === "update") {
    return withOptionalDescription(
      { tool: "edit", input: { path, unified_diff: change.unified_diff, move_path: change.move_path } },
      reason,
    );
  }
  return withOptionalDescription({ tool: "edit", input: { path } }, reason);
}

/** Add a per-request usage delta onto the turn's running total. */
function addUsageDelta(
  prev: TurnUsage | undefined,
  delta: TurnUsage,
  subagentTurns: number,
  wallClockMs: number | undefined,
): TurnUsage {
  if (prev === undefined) {
    return { ...delta, subagentTurns, wallClockMs: wallClockMs ?? delta.wallClockMs };
  }
  return {
    tokensIn: prev.tokensIn + delta.tokensIn,
    tokensInUncached: (prev.tokensInUncached ?? 0) + (delta.tokensInUncached ?? 0),
    cacheReadTokens: (prev.cacheReadTokens ?? 0) + (delta.cacheReadTokens ?? 0),
    tokensOut: prev.tokensOut + delta.tokensOut,
    costUsd: prev.costUsd + delta.costUsd,
    subagentTurns,
    wallClockMs: wallClockMs ?? prev.wallClockMs,
  };
}

/** Maps ONE token-usage notification's `.last` (the latest request's usage)
 *  into a TurnUsage delta; callers accumulate these across the turn. */
function usageFromTokenNotification(
  params: unknown,
  model: string,
  subagentTurns: number,
  wallClockMs: number | undefined,
): TurnUsage | undefined {
  const usage = isRecord(params) && isRecord(params.tokenUsage) ? params.tokenUsage : undefined;
  const last = isRecord(usage?.last) ? usage.last : undefined;
  if (last === undefined) return undefined;
  const inputTokens = numberValue(last.inputTokens);
  const cachedInputTokens = numberValue(last.cachedInputTokens);
  const outputTokens = numberValue(last.outputTokens);
  const reasoningOutputTokens = numberValue(last.reasoningOutputTokens);
  const tokensIn = inputTokens + cachedInputTokens;
  const tokensOut = outputTokens + reasoningOutputTokens;
  return {
    tokensIn,
    tokensInUncached: inputTokens,
    cacheReadTokens: cachedInputTokens,
    tokensOut,
    // App Server reports no dollar cost, so Operon estimates it from token
    // counts and documented list prices (see estimateCodexCostUsd). This is
    // an estimate — flagged as such — but it is what stops a codex turn from
    // spending $0 in the budget rollups and gives the per-turn cap something
    // to enforce against (build plan GAP C).
    costUsd: estimateCodexCostUsd(tokensIn, tokensOut, model),
    costEstimated: true,
    subagentTurns,
    wallClockMs: wallClockMs ?? 0,
  };
}

interface CodexPrice {
  inputPerMTok: number;
  outputPerMTok: number;
}

// Documented OpenAI list prices, USD per million tokens (input / output),
// from research/2026-07-05_model-id-verification.md — sourced from the OpenAI
// API models docs ([2] there, fetched 2026-07-05). These are the ONLY prices
// Operon asserts; no figure here is invented.
//
// Two deliberate conservative choices keep the estimate fail-safe (it may
// over- but must never silently under-count spend, because it also backs the
// hard budget cap):
//  - Cached input tokens are priced at the FULL input rate. The cited source
//    does not publish codex's cached-input discount, so Operon does not guess
//    one; charging cached tokens at full rate over-estimates slightly.
//  - Output covers reasoning tokens (OpenAI bills reasoning at the output
//    rate), which is why tokensOut already folds reasoningOutputTokens in.
// An unrecognized/unpriced model defaults to the flagship gpt-5.5 rate as a
// documented upper bound rather than $0 — an off-roster model must not slip
// the guard.
const CODEX_FLAGSHIP_PRICE: CodexPrice = { inputPerMTok: 5, outputPerMTok: 30 };

export function codexModelPrice(model: string): CodexPrice {
  const m = model.toLowerCase();
  if (m.startsWith("gpt-5.5")) return { inputPerMTok: 5, outputPerMTok: 30 };
  if (m.startsWith("gpt-5.4-mini")) return { inputPerMTok: 0.75, outputPerMTok: 4.5 };
  if (m.startsWith("gpt-5.4-nano")) return CODEX_FLAGSHIP_PRICE; // nano list price not published — conservative default
  if (m.startsWith("gpt-5.4")) return { inputPerMTok: 2.5, outputPerMTok: 15 };
  return CODEX_FLAGSHIP_PRICE;
}

export function estimateCodexCostUsd(tokensIn: number, tokensOut: number, model: string): number {
  const price = codexModelPrice(model);
  return (tokensIn / 1_000_000) * price.inputPerMTok + (tokensOut / 1_000_000) * price.outputPerMTok;
}

function finalAgentMessage(turn: Record<string, unknown>): string | undefined {
  if (!Array.isArray(turn.items)) return undefined;
  for (const item of [...turn.items].reverse()) {
    if (isRecord(item) && item.type === "agentMessage" && typeof item.text === "string") {
      return item.text.trim();
    }
  }
  return undefined;
}

function turnErrorSummary(turn: Record<string, unknown>): string {
  const error = isRecord(turn.error) ? turn.error : undefined;
  if (error !== undefined && typeof error.message === "string") return error.message;
  return `Codex App Server turn ended with status ${String(turn.status ?? "unknown")}`;
}

function errorSummary(params: unknown): string {
  if (isRecord(params)) {
    if (typeof params.message === "string") return params.message;
    if (isRecord(params.error) && typeof params.error.message === "string") return params.error.message;
  }
  return `Codex App Server error: ${JSON.stringify(params)}`;
}

/** Auth loss (expired/rotated ChatGPT refresh token, 401s) is
 *  operator-actionable — only an interactive `codex login` fixes it — so it
 *  must not masquerade as a generic failure in telemetry, the same Stage 3
 *  rule that carved out budget exhaustion (benchmark round 2, tick 1). */
function classifyCodexFailure(summary: string): string | undefined {
  return /refresh token|access token|unauthorized|not logged in|authentication/i.test(summary)
    ? "error_auth"
    : undefined;
}

function extractThreadId(response: unknown): string | undefined {
  if (!isRecord(response)) return undefined;
  if (isRecord(response.thread) && typeof response.thread.id === "string") return response.thread.id;
  if (typeof response.threadId === "string") return response.threadId;
  return undefined;
}

function extractTurnId(response: unknown): string | undefined {
  if (!isRecord(response)) return undefined;
  if (isRecord(response.turn) && typeof response.turn.id === "string") return response.turn.id;
  if (typeof response.turnId === "string") return response.turnId;
  return undefined;
}

function zeroUsage(wallClockMs: number, subagentTurns: number): TurnUsage {
  return { tokensIn: 0, tokensOut: 0, costUsd: 0, subagentTurns, wallClockMs };
}

function budgetOverrunNote(threadId: string, estimatedCostUsd: number, req: TurnRequest): Artifact {
  return {
    kind: "note",
    ref: `budget-overrun/${threadId}`,
    summary:
      `Budget overrun: turn stopped at the per-turn cap — estimated spend ` +
      `$${estimatedCostUsd.toFixed(4)} against maxTurnBudgetUsd ` +
      `$${req.role.maxTurnBudgetUsd} (role ${req.role.name}). Codex cost is an ` +
      `Operon estimate (App Server reports no dollar cost). ` +
      `Overrun = incident note, not silent spend (roles.yaml).`,
  };
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function asRpcId(value: unknown): JsonRpcId | undefined {
  return typeof value === "string" || typeof value === "number" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function withOptionalDescription(action: ToolAction, description: string | undefined): ToolAction {
  return description === undefined || description.length === 0 ? action : { ...action, description };
}

function relativize(target: string, workdir: string): string {
  if (target.startsWith(`${workdir}/`)) return target.slice(workdir.length + 1);
  return target;
}
