// cursor-agent stream-json decoding: the reduction from ordered CLI events to
// the adapter's turn state. Every shape here was captured live from
// cursor-agent 2026.08.04-aaa8809 on 2026-08-07
// (research/2026-08-07_cursor-adapter-certification.md). Drift is a typed
// failure at the transport, never a silent re-parse here.

import { definedProps } from "../optional-properties.js";
import { toolUseEvent } from "../tool-events.js";
import type { ToolAction, TurnHooks, TurnResult, TurnUsage } from "../types.js";
import { cursorUsage } from "./cursor-pricing.js";

/** One decoded stream-json line. Unknown `type` values are forward-compatible
 *  and ignored; an unknown TOOL shape is not (the gate-coverage cross-check
 *  in CursorRuntime counts every executed call, whatever its kind). */
export type CursorStreamEvent = Record<string, unknown>;

export interface CursorTurnState {
  sessionId: string;
  finalSummary?: string;
  status?: TurnResult["status"];
  usage?: TurnUsage;
  subagentTurns: number;
  /** tool_call events whose result shows the tool actually ran. Compared
   *  against the gate's allowance count to detect an ungated turn. */
  executedToolCalls: number;
  durationMs?: number;
  budgetOverrun?: boolean;
  errorCode?: string;
}

/** Typed core-§4 refusal: `--resume` authenticated but restored a different
 *  chat. Continuing would repeat paid work under a new identity. */
export class CursorSessionResumeMismatchError extends Error {
  readonly code = "error_resume_session_mismatch";
  constructor(
    readonly requestedSessionId: string,
    readonly restoredSessionId: string,
  ) {
    super(
      `CursorRuntime: resume requested chat ${JSON.stringify(requestedSessionId)} but cursor-agent ` +
        `restored ${JSON.stringify(restoredSessionId)} — a resume must bind the exact prior session`,
    );
    this.name = "CursorSessionResumeMismatchError";
  }
}

export function newCursorTurnState(sessionId: string): CursorTurnState {
  return { sessionId, subagentTurns: 0, executedToolCalls: 0 };
}

export interface CursorStreamContext {
  requestedSessionId: string | undefined;
  model: string;
  maxTurnBudgetUsd: number;
  roleName: string;
}

/** Fold one stream event into the turn state. Returns nothing; the caller
 *  stops iterating once `state.status` is set. */
export function applyCursorStreamEvent(
  event: CursorStreamEvent,
  context: CursorStreamContext,
  hooks: TurnHooks,
  state: CursorTurnState,
): void {
  switch (event["type"]) {
    case "system":
      applyInit(event, context, hooks, state);
      return;
    case "assistant": {
      const text = assistantText(event);
      if (text !== undefined) state.finalSummary = text;
      return;
    }
    case "tool_call":
      applyToolCall(event, hooks, state);
      return;
    case "result":
      applyResult(event, context, state);
      return;
    default:
      return;
  }
}

function applyInit(
  event: CursorStreamEvent,
  context: CursorStreamContext,
  hooks: TurnHooks,
  state: CursorTurnState,
): void {
  const sessionId = typeof event["session_id"] === "string" ? event["session_id"] : "";
  if (sessionId === "") return;
  if (context.requestedSessionId !== undefined && sessionId !== context.requestedSessionId) {
    throw new CursorSessionResumeMismatchError(context.requestedSessionId, sessionId);
  }
  state.sessionId = sessionId;
  hooks.onProgress?.({ session: { runtime: "cursor", id: sessionId } });
}

function applyToolCall(event: CursorStreamEvent, hooks: TurnHooks, state: CursorTurnState): void {
  const call = asRecord(event["tool_call"]);
  if (call === undefined) return;
  const kind = Object.keys(call).find((key) => key.endsWith("ToolCall"));
  if (kind === undefined) return;
  const body = asRecord(call[kind]) ?? {};
  const subtype = event["subtype"];
  const spanId = typeof event["call_id"] === "string" ? event["call_id"] : undefined;

  if (kind === "taskToolCall") {
    // Fan-out. The parent stream reports the Task call itself, never the
    // subagent's own tool calls — those reach the gate through the same
    // preToolUse hook from the subagent's own conversation (certified
    // 2026-08-07), so they are gated but not itemized here.
    if (subtype !== "started" && subtype !== "completed") return;
    if (subtype === "started") state.subagentTurns += 1;
    const name = subagentType(body);
    hooks.onEvent?.({
      type: "subagent",
      detail: `cursor subagent ${subtype}: ${name}`,
      name,
      phase: subtype,
      ...definedProps({ spanId }),
    });
    return;
  }

  if (subtype !== "completed") return;
  const result = asRecord(body["result"]);
  // `rejected` is a Cormidia gate denial (the hook answered deny),
  // `permissionDenied` is Cursor's own static deny surface, `error` is a tool
  // failure. None of them executed, so none is tool activity.
  if (result === undefined || !("success" in result)) return;
  state.executedToolCalls += 1;
  hooks.onEvent?.(
    toolUseEvent(cursorToolAction(kind, asRecord(body["args"]) ?? {}), {
      success: true,
      ...definedProps({ durationMs: toolDurationMs(event) }),
    }),
  );
}

function applyResult(event: CursorStreamEvent, context: CursorStreamContext, state: CursorTurnState): void {
  if (typeof event["duration_ms"] === "number") state.durationMs = event["duration_ms"];
  const text = typeof event["result"] === "string" ? event["result"].trim() : "";
  if (text.length > 0) state.finalSummary = text;

  const usage = asRecord(event["usage"]);
  if (usage !== undefined) {
    state.usage = cursorUsage(usage, context.model, state.subagentTurns, state.durationMs ?? 0);
  }

  const failed = event["is_error"] === true || event["subtype"] !== "success";
  state.status = failed ? "failed" : "completed";
  if (failed) {
    const code = classifyCursorFailure(state.finalSummary ?? "");
    if (code !== undefined) state.errorCode ??= code;
  }

  // cursor-agent reports usage exactly once, in the terminal result — there is
  // no mid-turn token notification to guard against. The cap is enforced at the
  // finest truthful observation point this surface exposes (the turn boundary)
  // and is NOT a running guard; the capability matrix says so rather than
  // implying a hard mid-run ceiling (INV-008).
  if (state.usage !== undefined && state.usage.costUsd >= context.maxTurnBudgetUsd) {
    state.budgetOverrun = true;
    state.status = "failed";
    state.finalSummary =
      `Budget overrun: estimated spend $${state.usage.costUsd.toFixed(4)} crossed maxTurnBudgetUsd ` +
      `$${context.maxTurnBudgetUsd} (role ${context.roleName}). cursor-agent reports usage only at the ` +
      `turn boundary, so this is a terminal check, not a mid-run stop.`;
  }
}

/** Auth loss is operator-actionable (`cursor-agent login` / CURSOR_API_KEY),
 *  so it must not masquerade as a generic failure. */
function classifyCursorFailure(summary: string): string | undefined {
  if (/not logged in|unauthorized|authentication|invalid api key|expired token/i.test(summary)) return "error_auth";
  if (/not trusted|trust this workspace|workspace trust/i.test(summary)) return "error_cursor_workspace_untrusted";
  return undefined;
}

function subagentType(body: Record<string, unknown>): string {
  const args = asRecord(body["args"]);
  const declared = args === undefined ? undefined : args["subagentType"];
  if (typeof declared === "string" && declared !== "") return declared;
  return Object.keys(asRecord(declared) ?? {})[0] ?? "unspecified";
}

/** Map one stream tool_call onto the provider-neutral vocabulary the gate and
 *  the other adapters use, so `tool_counts` stay comparable across harnesses. */
function cursorToolAction(kind: string, args: Record<string, unknown>): ToolAction {
  const path = typeof args["path"] === "string" ? args["path"] : "";
  switch (kind) {
    case "shellToolCall":
      return { tool: "bash", input: { command: typeof args["command"] === "string" ? args["command"] : "" } };
    case "editToolCall":
    case "writeToolCall":
      return { tool: "write", input: { path } };
    case "readToolCall":
      return { tool: "read", input: { path } };
    case "deleteToolCall":
      return { tool: "delete", input: { path } };
    default:
      return { tool: kind.replace(/ToolCall$/, "").toLowerCase(), input: args };
  }
}

function toolDurationMs(event: CursorStreamEvent): number | undefined {
  const started = Number(event["startedAtMs"]);
  const completed = Number(event["completedAtMs"]);
  if (!Number.isFinite(started) || !Number.isFinite(completed) || completed < started) return undefined;
  return completed - started;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function assistantText(event: CursorStreamEvent): string | undefined {
  const message = asRecord(event["message"]);
  const content = message === undefined ? undefined : message["content"];
  if (!Array.isArray(content)) return undefined;
  const parts = content
    .map((part) => {
      const text = asRecord(part)?.["text"];
      return typeof text === "string" ? text : "";
    })
    .filter((part) => part.length > 0);
  return parts.length === 0 ? undefined : parts.join("").trim();
}
