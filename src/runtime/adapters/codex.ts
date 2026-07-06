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

export type CodexAppServerClientFactory = () => CodexAppServerClient;

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

  constructor() {
    const require = createRequire(import.meta.url);
    const codexBin = require.resolve("@openai/codex/bin/codex.js");
    this.child = spawn(process.execPath, [codexBin, "app-server", "--listen", "stdio://"], {
      stdio: ["pipe", "pipe", "pipe"],
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
    if (this.closed) return;
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) waiter({ done: true, value: undefined });
    for (const pending of this.pending.values()) {
      pending.reject(new Error("Codex App Server client closed"));
    }
    this.pending.clear();
    if (!this.child.killed) this.child.kill();
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
}

export interface CodexRuntimeOptions {
  clientFactory?: CodexAppServerClientFactory;
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
}

export class CodexRuntime implements Runtime {
  readonly kind = "codex" as const;
  private readonly clientFactory: CodexAppServerClientFactory;

  constructor(opts: CodexRuntimeOptions = {}) {
    this.clientFactory = opts.clientFactory ?? (() => new StdioCodexAppServerClient());
  }

  async runTurn(req: TurnRequest, hooks: TurnHooks): Promise<TurnResult> {
    if (req.session !== undefined && req.session.runtime !== "codex") {
      throw new Error(
        `CodexRuntime cannot resume a "${req.session.runtime}" session - ` +
          `cross-runtime resume is an orchestrator bug (session id: ${req.session.id})`,
      );
    }

    const startTime = Date.now();
    const client = this.clientFactory();
    const escalations: GateEscalation[] = [];
    try {
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

      await client.request("turn/start", turnParams(req, threadId));
      const state: CodexTurnState = {
        threadId,
        subagentTurns: 0,
      };

      for await (const message of client) {
        await this.handleServerMessage(client, message, req, hooks, escalations, state);
        if (state.status !== undefined) break;
      }

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
        usage: state.usage ?? zeroUsage(wallClockMs, state.subagentTurns),
        escalations,
      };
    } finally {
      await client.close();
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
      case "thread/tokenUsage/updated":
        {
          const usage = usageFromTokenNotification(
            message.params,
            req.role.model,
            state.subagentTurns,
            state.durationMs,
          );
          if (usage !== undefined) {
            state.usage = usage;
            // Running per-turn budget guard on the ESTIMATE. The App Server
            // exposes no native budget knob (unlike Claude's --max-budget-usd),
            // so Operon enforces the cap itself: once the estimated running
            // spend crosses role.maxTurnBudgetUsd we stop consuming and let the
            // finally-block close the client (terminating the App Server turn).
            // Overrun = incident note, not silent spend (roles.yaml).
            if (usage.costUsd >= req.role.maxTurnBudgetUsd) {
              state.budgetOverrun = true;
              state.status = "failed";
              state.finalSummary =
                `Budget overrun: turn stopped at the per-turn cap — estimated spend ` +
                `$${usage.costUsd.toFixed(4)} crossed maxTurnBudgetUsd ` +
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
    }
    if (state.usage !== undefined) {
      state.usage = { ...state.usage, subagentTurns: state.subagentTurns, wallClockMs: state.durationMs ?? state.usage.wallClockMs };
    }
  }
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
    model: req.role.model,
    effort: mapCodexEffort(req.role.effort),
    ...(req.verdictSchema !== undefined ? { outputSchema: req.verdictSchema } : {}),
  };
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
  const action = normalizeCodexApprovalAction(kind, message.params, req.workdir);
  const decision = hooks.gate(action);
  if (!decision.allow && decision.escalate) {
    escalations.push({ action, reason: decision.reason });
  }

  const allow = decision.allow;
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

function normalizePatchApproval(params: Record<string, unknown>, workdir: string): ToolAction {
  const fileChanges = isRecord(params.fileChanges) ? params.fileChanges : {};
  const [firstPath, firstChange] = Object.entries(fileChanges)[0] ?? [
    typeof params.grantRoot === "string" ? params.grantRoot : ".",
    undefined,
  ];
  const path = relativize(firstPath, workdir);
  if (isRecord(firstChange) && firstChange.type === "add") {
    return withOptionalDescription(
      { tool: "write", input: { path, content: firstChange.content } },
      typeof params.reason === "string" ? params.reason : undefined,
    );
  }
  if (isRecord(firstChange) && firstChange.type === "update") {
    return withOptionalDescription(
      { tool: "edit", input: { path, unified_diff: firstChange.unified_diff, move_path: firstChange.move_path } },
      typeof params.reason === "string" ? params.reason : undefined,
    );
  }
  return withOptionalDescription(
    { tool: "edit", input: { path } },
    typeof params.reason === "string" ? params.reason : undefined,
  );
}

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
  if (isRecord(params) && typeof params.message === "string") return params.message;
  return `Codex App Server error: ${JSON.stringify(params)}`;
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
