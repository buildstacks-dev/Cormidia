// Envelope shaping for a Grok Build turn: the typed refusals, the usage
// projection, and the terminal status/summary/artifact mapping.
//
// Usage accounting follows grok's own documented policy (user guide, headless
// mode → usage notes): cost is reported as exact integer ticks with
// 1 USD = 10^10 ticks, and grok OMITS every cost figure whenever the server's
// cost was partial or the usage drain was incomplete. An omitted cost stays
// unknown here — `quality: "partial"` with no invented dollar figure — because
// "absence means unreported or incomplete, never free".

import type { Artifact, GateEscalation, TurnResult, TurnRequest, TurnUsage } from "../types.js";

const TICKS_PER_USD = 10_000_000_000;

export interface GrokTurnState {
  sessionId: string;
  startedAt: number;
  finalText: string;
  usage?: TurnUsage;
  stopReason?: string;
  errorCode?: string;
  budgetOverrun: boolean;
  done: boolean;
}

export function grokTurnState(sessionId: string, startedAt: number): GrokTurnState {
  return { sessionId, startedAt, finalText: "", budgetOverrun: false, done: false };
}

/** Provider-reported usage, or undefined when grok reported none at all. */
export function grokUsage(value: unknown, elapsedMs: number): TurnUsage | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const usage = value as Record<string, unknown>;
  const inputTokens = numberValue(usage["inputTokens"]);
  const outputTokens = numberValue(usage["outputTokens"]);
  const cacheRead = numberValue(usage["cachedReadTokens"]);
  const cacheCreation = numberValue(usage["cacheCreationTokens"]);
  const ticks = usage["costUsdTicks"];
  const partial = usage["costIsPartial"] === true || usage["usageIsIncomplete"] === true;
  const costKnown = !partial && typeof ticks === "number" && Number.isFinite(ticks);
  return {
    // ACP's PromptUsage `inputTokens` is the FULL prompt sum (both cache
    // buckets included) — only grok's headless projector subtracts them.
    tokensIn: inputTokens,
    tokensInUncached: Math.max(0, inputTokens - cacheRead - cacheCreation),
    cacheCreationTokens: cacheCreation,
    cacheReadTokens: cacheRead,
    // `outputTokens` already folds reasoning tokens in; adding them would
    // double-count.
    tokensOut: outputTokens,
    costUsd: costKnown ? (ticks as number) / TICKS_PER_USD : 0,
    // Fan-out is enforced off by the gate bridge, so a grok turn has no
    // subagent turns to report; a nonzero value here would be a contradiction.
    subagentTurns: 0,
    wallClockMs: Math.max(0, elapsedMs),
    quality: costKnown ? "complete" : "partial",
  };
}

export function grokTurnStatus(stopReason: string | undefined): TurnResult["status"] {
  if (stopReason === "end_turn") return "completed";
  if (stopReason === "cancelled") return "cancelled";
  return "failed";
}

export function classifyGrokStop(stopReason: string, text: string): string | undefined {
  if (stopReason === "max_turn_requests" || stopReason === "max_turns") return "error_max_turns";
  if (/unauthorized|not logged in|authentication|session expired|grok login/i.test(text)) return "error_auth";
  if (stopReason === "end_turn" || stopReason === "cancelled") return undefined;
  return "error_provider";
}

export function grokSummary(state: GrokTurnState, req: TurnRequest): string {
  if (state.budgetOverrun) return budgetOverrunSentence(state, req);
  const text = state.finalText.trim();
  if (text.length > 0) return text;
  return `grok turn ended with stopReason ${String(state.stopReason ?? "unknown")}`;
}

export function grokArtifacts(state: GrokTurnState, req: TurnRequest): Artifact[] {
  if (state.budgetOverrun) {
    return [
      {
        kind: "note",
        ref: `budget-overrun/${state.sessionId}`,
        summary:
          `${budgetOverrunSentence(state, req)} grok reports cost only at turn end, so this cap ` +
          `is enforced terminally. Overrun = incident note, not silent spend (roles.yaml).`,
      },
    ];
  }
  if (req.role.delegation.allow.length === 0) return [];
  return [
    {
      kind: "note",
      ref: "grok-delegation/no-certified-fanout",
      summary:
        "grok has no certified intra-turn subagent fan-out; the gate bridge denies spawn_subagent, " +
        "so delegation.allow is documented as degraded for this runtime.",
    },
  ];
}

export function stoppedGrokResult(req: TurnRequest, state: GrokTurnState, escalations: GateEscalation[]): TurnResult {
  const descriptor = stopDescriptor(req.signal?.reason);
  const elapsed = Date.now() - state.startedAt;
  const usage = state.usage ?? zeroGrokUsage(elapsed);
  return {
    status: descriptor.status,
    errorCode: descriptor.errorCode,
    summary: descriptor.reason,
    artifacts: [],
    session: { runtime: "grok", id: state.sessionId },
    usage: {
      ...usage,
      wallClockMs: elapsed,
      quality: state.usage === undefined ? "unavailable" : "partial",
    },
    escalations,
  };
}

export function zeroGrokUsage(wallClockMs: number): TurnUsage {
  return { tokensIn: 0, tokensOut: 0, costUsd: 0, subagentTurns: 0, wallClockMs };
}

function budgetOverrunSentence(state: GrokTurnState, req: TurnRequest): string {
  return (
    `Budget overrun: turn stopped at the per-turn cap — spent ` +
    `$${(state.usage?.costUsd ?? 0).toFixed(4)} against maxTurnBudgetUsd ` +
    `$${req.role.maxTurnBudgetUsd} (role ${req.role.name}).`
  );
}

function stopDescriptor(reason: unknown): { status: "cancelled" | "timed_out"; errorCode: string; reason: string } {
  if (reason !== null && typeof reason === "object") {
    const value = reason as Record<string, unknown>;
    if (
      (value["status"] === "cancelled" || value["status"] === "timed_out") &&
      typeof value["errorCode"] === "string" &&
      typeof value["reason"] === "string"
    ) {
      return { status: value["status"], errorCode: value["errorCode"], reason: value["reason"] };
    }
  }
  return {
    status: "cancelled",
    errorCode: "error_cancelled",
    reason: typeof reason === "string" && reason.length > 0 ? reason : "operator cancellation",
  };
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
