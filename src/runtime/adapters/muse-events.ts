// Folding one `muse exec --json` record into the turn state.
//
// The stream carries run/task lifecycle, assistant output deltas, and tool
// OUTCOMES (`tool.result`). It deliberately carries no gate decision — that
// happened at the hook, pre-execution — and no usage, which lives only in the
// durable session log (`muse-usage.ts`).

import { toolUseEvent } from "../tool-events.js";
import type { TurnHooks } from "../types.js";
import type { MuseRecord } from "./muse-exec.js";

export interface MuseTurnState {
  sessionId: string;
  summary: string | undefined;
  terminal: string | undefined;
  budgetOverrun: boolean;
  errorCode?: string;
}

export function newMuseTurnState(sessionId: string): MuseTurnState {
  return { sessionId, summary: undefined, terminal: undefined, budgetOverrun: false };
}

/** The session identity the PROVIDER reported — never the one we requested, so
 *  a resume mismatch stays observable downstream (core §2/§4). */
export function museReportedSessionId(record: MuseRecord): string | undefined {
  const stream = isRecord(record.stream) ? record.stream : undefined;
  if (stream === undefined || stream["kind"] !== "session") return undefined;
  return typeof stream["id"] === "string" ? stream["id"] : undefined;
}

export function applyMuseRecord(record: MuseRecord, hooks: TurnHooks, state: MuseTurnState): void {
  const type = typeof record.payload_type === "string" ? record.payload_type : "";
  const payload = isRecord(record.payload) ? record.payload : {};
  if (type === "run.output.delta") {
    state.summary = `${state.summary ?? ""}${typeof payload["text"] === "string" ? payload["text"] : ""}`;
    return;
  }
  if (type === "tool.result") {
    // Emitting the outcome keeps executed tools visible in L2 without a second
    // gate consultation: classification already happened at the hook.
    const facts = isRecord(payload["correlation_facts"]) ? payload["correlation_facts"] : {};
    const tool = typeof facts["tool_name"] === "string" ? facts["tool_name"] : "tool";
    hooks.onEvent?.(toolUseEvent({ tool, input: {} }, { success: facts["outcome"] === "success" }));
    return;
  }
  if (type.startsWith("run.terminal")) {
    const terminal = typeof payload["terminal"] === "string" ? payload["terminal"] : "failed";
    state.terminal = terminal;
    const text = typeof payload["text"] === "string" ? payload["text"] : undefined;
    if (text !== undefined && text.length > 0) state.summary = text;
    if (terminal === "completed") return;
    const reason = typeof payload["reason"] === "string" ? payload["reason"] : undefined;
    state.summary = reason ?? state.summary;
    setErrorCode(state, reason ?? "");
    return;
  }
  if (type === "task.lifecycle.failed" || type === "task.lifecycle.rejected") {
    const event = isRecord(payload["event"]) ? payload["event"] : {};
    const reason = typeof event["reason"] === "string" ? event["reason"] : undefined;
    if (reason !== undefined && state.errorCode === undefined) setErrorCode(state, reason);
  }
}

/** Auth loss is operator-actionable and must not masquerade as a generic
 *  failure; 0.1.x JSONL schema drift is a typed failure, never a re-parse. */
function setErrorCode(state: MuseTurnState, detail: string): void {
  if (/api key|unauthor|forbidden|401|403|login|credential/i.test(detail)) {
    state.errorCode ??= "error_auth";
    return;
  }
  if (/schema|unknown record|unsupported payload/i.test(detail)) {
    state.errorCode ??= "error_protocol_stale_capabilities";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
