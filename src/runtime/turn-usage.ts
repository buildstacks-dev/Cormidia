import type { TurnUsage } from "./types.js";

/** Immutable zero-valued usage seed. Spread it before adding quality or measured fields. */
export const ZERO_USAGE: Readonly<TurnUsage> = Object.freeze({
  tokensIn: 0,
  tokensOut: 0,
  costUsd: 0,
  subagentTurns: 0,
  wallClockMs: 0,
});
