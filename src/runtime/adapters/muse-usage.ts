// Muse spend accounting.
//
// `muse exec --json` streams run and task lifecycle but NO usage: token counts
// exist only in the durable session log
// (`<share>/muse/sessions/<Y>/<M>/<D>/<session>/session.jsonl`). That log is
// therefore the finest truthful observation point this harness exposes, and it
// is what both the reported usage and the running budget guard read.
//
// The vendor reports no dollar figure at all, so `costUsd` is a Cormidia
// ESTIMATE from documented list prices and is flagged `costEstimated: true`.
// An estimate is evidence; a silent zero is not (INV-006).

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Artifact, RoleConfig, TurnUsage, UsageQuality } from "../types.js";

/** Token counts observed in the durable session log for one session. */
export interface MuseObservedUsage {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  subagentTurns: number;
}

/**
 * Documented Muse Spark list prices, USD per million tokens
 * (research/2026-08-06_adapter-upstream-references.md → Muse section:
 * $1.25/M in, $4.25/M out, $0.15/M cached). These are the ONLY prices Cormidia
 * asserts for this harness; no figure here is invented.
 */
const MUSE_PRICE = { inputPerMTok: 1.25, outputPerMTok: 4.25, cachedPerMTok: 0.15 } as const;

export function estimateMuseCostUsd(uncachedIn: number, cachedIn: number, out: number): number {
  return (
    (uncachedIn / 1_000_000) * MUSE_PRICE.inputPerMTok +
    (cachedIn / 1_000_000) * MUSE_PRICE.cachedPerMTok +
    (out / 1_000_000) * MUSE_PRICE.outputPerMTok
  );
}

export function museTurnUsage(
  observed: MuseObservedUsage,
  wallClockMs: number,
  quality: UsageQuality,
  subagentTurns = observed.subagentTurns,
): TurnUsage {
  const uncached = Math.max(observed.inputTokens - observed.cachedTokens, 0);
  return {
    tokensIn: observed.inputTokens,
    tokensInUncached: uncached,
    cacheReadTokens: observed.cachedTokens,
    tokensOut: observed.outputTokens,
    costUsd: estimateMuseCostUsd(uncached, observed.cachedTokens, observed.outputTokens),
    costEstimated: true,
    subagentTurns,
    wallClockMs,
    quality,
  };
}

/** Unknown spend is `unavailable` with zero markers — never a claimed zero. */
export function museUnknownUsage(wallClockMs: number, subagentTurns = 0): TurnUsage {
  return { tokensIn: 0, tokensOut: 0, costUsd: 0, subagentTurns, wallClockMs, quality: "unavailable" };
}

/** Budget overrun is an incident, never silent spend (roles.yaml): exactly one
 *  note, and the measured (estimated) spend survives the forced stop. */
export function museBudgetOverrun(
  sessionId: string,
  usage: MuseObservedUsage | undefined,
  role: Pick<RoleConfig, "name" | "maxTurnBudgetUsd">,
): { summary: string; note: Artifact } {
  const cost = usage === undefined ? 0 : museTurnUsage(usage, 0, "estimated").costUsd;
  const headline =
    `Budget overrun: turn stopped at the per-turn cap — estimated spend $${cost.toFixed(4)} ` +
    `against maxTurnBudgetUsd $${role.maxTurnBudgetUsd} (role ${role.name}).`;
  return {
    summary: headline,
    note: {
      kind: "note",
      ref: `budget-overrun/${sessionId}`,
      summary:
        `${headline} Muse cost is a Cormidia estimate (the event stream reports no dollar cost). ` +
        `Overrun = incident note, not silent spend (roles.yaml).`,
    },
  };
}

/** Reads the durable session log; absence stays unknown, never zero. */
export async function readMuseSessionUsage(
  sessionLogRoot: string,
  sessionId: string,
): Promise<MuseObservedUsage | undefined> {
  for (const path of sessionLogCandidates(sessionLogRoot, sessionId)) {
    try {
      return parseMuseSessionUsage(await readFile(path, "utf8"), sessionId);
    } catch {
      // Try the next dated directory.
    }
  }
  return undefined;
}

/**
 * Parses one session log for this session's token totals and the distinct swarm
 * children that spent under it. Fan-out accounting comes from these records
 * ONLY — never from the assistant's prose about what it did.
 */
export function parseMuseSessionUsage(contents: string, sessionId: string): MuseObservedUsage {
  let inputTokens = 0;
  let outputTokens = 0;
  let cachedTokens = 0;
  const children = new Set<string>();
  for (const line of contents.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const event = eventOf(parsed);
    if (event === undefined) continue;
    if (event["kind"] === "model_completed" && isRecord(event["usage"])) {
      const usage = event["usage"];
      inputTokens += numberValue(usage["input_tokens"]);
      outputTokens += numberValue(usage["output_tokens"]) + numberValue(usage["reasoning_tokens"]);
      cachedTokens += numberValue(usage["cached_tokens"]);
      continue;
    }
    if (event["kind"] === "goal_usage_attribution" && isRecord(event["record"])) {
      const owner = isRecord(event["record"]["owner"]) ? event["record"]["owner"] : {};
      const ownerSession = typeof owner["session_id"] === "string" ? owner["session_id"] : undefined;
      if (ownerSession !== undefined && ownerSession !== sessionId) children.add(ownerSession);
    }
  }
  return { inputTokens, outputTokens, cachedTokens, subagentTurns: children.size };
}

function eventOf(parsed: unknown): Record<string, unknown> | undefined {
  if (!isRecord(parsed)) return undefined;
  const payload = isRecord(parsed["payload"]) ? parsed["payload"] : undefined;
  if (payload === undefined) return undefined;
  return isRecord(payload["event"]) ? payload["event"] : undefined;
}

function sessionLogCandidates(root: string, sessionId: string): string[] {
  const now = new Date();
  return [0, 1]
    .map((offset) => new Date(now.getTime() - offset * 86_400_000))
    .map((day) =>
      join(
        root,
        String(day.getUTCFullYear()),
        String(day.getUTCMonth() + 1).padStart(2, "0"),
        String(day.getUTCDate()).padStart(2, "0"),
        sessionId,
        "session.jsonl",
      ),
    );
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
