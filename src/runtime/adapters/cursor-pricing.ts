// Cursor cost estimation. cursor-agent's stream-json carries token counts but
// no dollar cost, so Cormidia estimates spend from the vendor's OWN published
// rate table and flags every figure `costEstimated: true`. The estimate also
// backs the per-turn budget check, so it is deliberately biased to over-count.

import type { TurnUsage } from "../types.js";

export interface CursorPrice {
  inputPerMTok: number;
  cacheWritePerMTok: number;
  cacheReadPerMTok: number;
  outputPerMTok: number;
}

// USD per million tokens, fetched 2026-08-07 from
// <https://cursor.com/docs/account/pricing> and recorded in
// research/2026-08-07_cursor-adapter-certification.md. These are the ONLY
// prices Cormidia asserts for this harness; no figure here is invented.
//
// Keys match as longest id PREFIXES because the CLI's roster spells effort
// into the id (`gpt-5.6-sol-high`, `claude-opus-5-thinking-xhigh`).
const CURSOR_PRICES: ReadonlyArray<readonly [string, CursorPrice]> = [
  ["claude-opus-5", { inputPerMTok: 5, cacheWritePerMTok: 6.25, cacheReadPerMTok: 0.5, outputPerMTok: 25 }],
  ["claude-opus-4-8", { inputPerMTok: 5, cacheWritePerMTok: 6.25, cacheReadPerMTok: 0.5, outputPerMTok: 25 }],
  ["claude-sonnet-5", { inputPerMTok: 3, cacheWritePerMTok: 3.75, cacheReadPerMTok: 0.3, outputPerMTok: 15 }],
  ["claude-fable-5", { inputPerMTok: 10, cacheWritePerMTok: 12.5, cacheReadPerMTok: 1, outputPerMTok: 50 }],
  ["gpt-5.6-sol", { inputPerMTok: 5, cacheWritePerMTok: 6.25, cacheReadPerMTok: 0.5, outputPerMTok: 30 }],
  ["gpt-5.5", { inputPerMTok: 5, cacheWritePerMTok: 5, cacheReadPerMTok: 0.5, outputPerMTok: 30 }],
  ["gpt-5.4", { inputPerMTok: 2.5, cacheWritePerMTok: 2.5, cacheReadPerMTok: 0.25, outputPerMTok: 15 }],
  ["gpt-5.3-codex", { inputPerMTok: 1.75, cacheWritePerMTok: 1.75, cacheReadPerMTok: 0.175, outputPerMTok: 14 }],
  ["gpt-5.2", { inputPerMTok: 1.75, cacheWritePerMTok: 1.75, cacheReadPerMTok: 0.175, outputPerMTok: 14 }],
  ["kimi-k3", { inputPerMTok: 3, cacheWritePerMTok: 3, cacheReadPerMTok: 0.3, outputPerMTok: 15 }],
];

/**
 * Documented upper bounds — not invented numbers — for ids the table does not
 * price (`auto`, `composer-2.5`, `cursor-grok-4.5-*`, anything newer):
 *  - the dearest published NON-fast row (Claude Fable 5) for ordinary ids;
 *  - the dearest published row overall, itself a fast-mode row (Claude Opus
 *    4.7 fast mode), for `-fast` ids, because the table shows fast mode
 *    carrying a large surcharge and Cormidia will not extrapolate a multiplier
 *    from a single data point.
 * Over-estimating is the fail-safe direction: unknown spend must never round
 * toward zero when the same figure backs the budget check.
 */
const CURSOR_UNPRICED: CursorPrice = {
  inputPerMTok: 10,
  cacheWritePerMTok: 12.5,
  cacheReadPerMTok: 1,
  outputPerMTok: 50,
};
const CURSOR_UNPRICED_FAST: CursorPrice = {
  inputPerMTok: 30,
  cacheWritePerMTok: 37.5,
  cacheReadPerMTok: 3,
  outputPerMTok: 150,
};

export function cursorModelPrice(model: string): CursorPrice {
  const id = model.toLowerCase();
  let best: CursorPrice | undefined;
  let bestLength = -1;
  for (const [prefix, price] of CURSOR_PRICES) {
    if (id.startsWith(prefix) && prefix.length > bestLength) {
      best = price;
      bestLength = prefix.length;
    }
  }
  if (best !== undefined) return best;
  return id.endsWith("-fast") ? CURSOR_UNPRICED_FAST : CURSOR_UNPRICED;
}

export function estimateCursorCostUsd(
  tokens: { uncached: number; cacheRead: number; cacheWrite: number; tokensOut: number },
  model: string,
): number {
  const price = cursorModelPrice(model);
  return (
    (tokens.uncached / 1_000_000) * price.inputPerMTok +
    (tokens.cacheWrite / 1_000_000) * price.cacheWritePerMTok +
    (tokens.cacheRead / 1_000_000) * price.cacheReadPerMTok +
    (tokens.tokensOut / 1_000_000) * price.outputPerMTok
  );
}

/** Map the terminal `result.usage` object onto TurnUsage. `inputTokens` is the
 *  UNCACHED input count, so tokensIn is the sum of all three input classes. */
export function cursorUsage(
  usage: Record<string, unknown>,
  model: string,
  subagentTurns: number,
  wallClockMs: number,
): TurnUsage {
  const uncached = numberValue(usage["inputTokens"]);
  const cacheRead = numberValue(usage["cacheReadTokens"]);
  const cacheWrite = numberValue(usage["cacheWriteTokens"]);
  const tokensOut = numberValue(usage["outputTokens"]);
  return {
    tokensIn: uncached + cacheRead + cacheWrite,
    tokensInUncached: uncached,
    cacheCreationTokens: cacheWrite,
    cacheReadTokens: cacheRead,
    tokensOut,
    costUsd: estimateCursorCostUsd({ uncached, cacheRead, cacheWrite, tokensOut }, model),
    costEstimated: true,
    subagentTurns,
    wallClockMs,
  };
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
