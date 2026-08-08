import type { AuthMode } from "./auth-mode.js";
import type { TurnUsage } from "./types.js";

/** Immutable zero-valued usage seed. Spread it before adding quality or measured fields. */
export const ZERO_USAGE: Readonly<TurnUsage> = Object.freeze({
  tokensIn: 0,
  tokensOut: 0,
  costUsd: 0,
  subagentTurns: 0,
  wallClockMs: 0,
});

/**
 * Apply the connection's billing label to one turn's usage (#333).
 *
 * A `subscription` turn ran on the operator's own plan, so its marginal dollar
 * cost is zero — an AUTHORITATIVE zero, carried with the label that says why.
 * Any equivalent-cost figure the provider reported describes what the same
 * tokens would have cost on a metered key. It is retained under the explicitly
 * non-invoice `equivalentCostUsd` field for bounded comparisons such as L-ACC,
 * while `costUsd` remains zero for ordinary spend rollups.
 *
 * Token counts and `quality` are untouched. Quality describes the completeness
 * of the usage OBSERVATION and keeps its meaning exactly
 * (docs/episodes/contract.md); billing describes who pays. An unobservable
 * subscription turn is still `unavailable` — labeled zero cost, unknown tokens.
 *
 * `undefined` billing returns the usage unchanged: an undeclared connection
 * settles exactly as it did before #333, which is the safe direction (metered
 * spend is never silently zeroed).
 */
export function settleBilling(usage: TurnUsage, billing: AuthMode | undefined): TurnUsage {
  if (billing === undefined) return usage;
  if (billing === "api_key") return { ...usage, billing };
  const { costEstimated: _dropped, ...rest } = usage;
  const equivalentCostUsd = usage.equivalentCostUsd ?? usage.costUsd;
  const estimated = usage.costEstimated === true ? { equivalentCostEstimated: true as const } : {};
  return { ...rest, billing, costUsd: 0, equivalentCostUsd, ...estimated };
}

/**
 * Why this settled record cannot be trusted, or `undefined` when it is
 * coherent. A `subscription` row carrying real dollars is the dangerous shape:
 * either the label is wrong (metered spend disappearing from the rollup) or the
 * cost is (a plan turn inflating it). Readers fail closed on it rather than
 * picking whichever half they prefer.
 */
export function billingSettlementFault(record: { costUsd?: unknown; billing?: AuthMode }): string | undefined {
  if (record.billing !== "subscription") return undefined;
  const cost = record.costUsd;
  if (typeof cost !== "number" || !Number.isFinite(cost)) {
    return "billing=subscription with a non-finite costUsd";
  }
  return cost === 0 ? undefined : `billing=subscription with a non-zero costUsd (${cost})`;
}
