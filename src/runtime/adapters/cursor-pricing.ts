// Cursor cost estimation. cursor-agent's stream-json carries token counts but
// no dollar cost, so Cormidia estimates spend from the vendor's OWN published
// rate table and flags every figure `costEstimated: true`. The estimate also
// backs the per-turn budget check, so it is deliberately biased to over-count.

// The rate table itself — every row, both documented fallbacks, and the source
// it was transcribed from — lives in `harness-metadata.json` (#332), because a
// vendor rate card is exactly the kind of fact that drifts. This module keeps
// the arithmetic and the `TurnUsage` mapping.

import { harnessModelPrice } from "../harness-pricing.js";
import type { ModelPrice } from "../harness-metadata.js";
import type { TurnUsage } from "../types.js";

/** Cursor publishes all four token classes, so every field is present. */
export interface CursorPrice extends ModelPrice {
  readonly cacheWritePerMTok: number;
  readonly cacheReadPerMTok: number;
}

/** Narrows the shared four-field metadata row. A missing cache rate is an
 *  authoring error in `harness-metadata.json`, and it fails loudly here rather
 *  than silently costing a cached token $0. */
export function cursorModelPrice(model: string): CursorPrice {
  const price = harnessModelPrice("cursor", model);
  if (price.cacheWritePerMTok === undefined || price.cacheReadPerMTok === undefined) {
    throw new Error(`cursor price for ${model} is missing a cache rate; every Cursor row publishes all four`);
  }
  return { ...price, cacheWritePerMTok: price.cacheWritePerMTok, cacheReadPerMTok: price.cacheReadPerMTok };
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
