// The one cost-aggregation primitive. Every surface that presents an aggregate
// equivalent cost — CLI telemetry (terminal/JSON/HTML), Live Observer, and
// Reports — projects it through `aggregateCost` so the same scope and filters
// can never disagree about known cost or settlement coverage.
//
// Two rules this module exists to enforce, both of which used to be violated by
// independent re-implementations:
//
//   1. Unknown cost is never silently zero. A provider turn whose usage could
//      not be observed contributes `null`, is counted, and is referenced for
//      drill-down — it never contributes 0 to a sum.
//   2. Unknown cost never erases known cost. One unobservable turn downgrades
//      the aggregate to `partial`; it does not collapse an otherwise complete
//      total to "unavailable". The recorded subtotal remains a true floor.
//
// The third rule is upstream of this module but inseparable from it: a pass
// that invoked no provider carries `usage_quality: "none"`, which is an
// authoritative zero, not missing evidence. Such passes are counted separately
// as `mechanical_passes` and are excluded from `unknown_turns` entirely.

import type { UsageQuality } from "./types.js";

/** Worst-wins ordering over usage quality. `none` is the identity element: it
 *  is authoritative (a real, known zero) so it can never drag an aggregate
 *  down, and it must lose to any genuine provider quality — a scope holding one
 *  mechanical pass and one complete turn is `complete`, not `none`. */
const QUALITY_RANK: Record<UsageQuality, number> = {
  none: -1,
  complete: 0,
  estimated: 1,
  partial: 2,
  unavailable: 3,
};

const KNOWN_QUALITIES: ReadonlySet<string> = new Set<UsageQuality>([
  "none",
  "complete",
  "estimated",
  "partial",
  "unavailable",
]);

/** Anything unrecognized — including `undefined` on a legacy ledger row — is
 *  unavailable, never a silent `complete`. */
export function normalizeUsageQuality(value: string | undefined): UsageQuality {
  return value !== undefined && KNOWN_QUALITIES.has(value) ? (value as UsageQuality) : "unavailable";
}

export function worstUsageQuality(left: string | undefined, right: string | undefined): UsageQuality {
  const a = normalizeUsageQuality(left);
  const b = normalizeUsageQuality(right);
  return QUALITY_RANK[a] >= QUALITY_RANK[b] ? a : b;
}

/** Worst-wins across a set. An empty set is `unavailable` — absence of evidence
 *  is not evidence of completeness. A set containing only mechanical passes is
 *  `none`, which is a known zero. */
export function aggregateUsageQuality(qualities: readonly (string | undefined)[]): UsageQuality {
  if (qualities.length === 0) return "unavailable";
  return qualities.reduce<UsageQuality>((worst, quality) => worstUsageQuality(worst, quality), "none");
}

/**
 * How completely an aggregate's provider cost is known.
 *
 * - `none`        — no provider turns in scope. `known_cost_usd` is 0 and that
 *                   zero is authoritative (mechanical passes only, or empty).
 * - `complete`    — every provider turn in scope has observable usage.
 * - `partial`     — some provider turns are unobservable. `known_cost_usd` is a
 *                   real floor; the unknown component is separately counted and
 *                   must never be presented as zero.
 * - `unavailable` — provider turns exist and none has observable usage.
 */
export type CostCoverage = "none" | "complete" | "partial" | "unavailable";

/** One activity's contribution to an aggregate. */
export interface CostContribution {
  /** Authoritatively recorded cost, or `null` when a genuine provider turn's
   *  usage could not be observed. A mechanical pass contributes 0 with
   *  `quality: "none"` — that is a known zero, not an unknown. */
  costUsd: number | null;
  quality: UsageQuality | string | undefined;
  /** Stable identity (provider turn id, run id, ledger row) used to name the
   *  unknown component for drill-down. */
  ref?: string;
}

export interface CostAggregate {
  /** Sum of authoritatively recorded cost. A true floor under `partial`. */
  known_cost_usd: number;
  /** Genuine provider turns in scope. Excludes mechanical passes. */
  provider_turns: number;
  /** Provider turns whose cost is known. */
  known_turns: number;
  /** Provider turns whose usage could not be observed. Never treated as zero. */
  unknown_turns: number;
  /** References for the unknown turns, so the unknown component is drillable. */
  unknown_refs: string[];
  /** Non-provider passes with an authoritative zero cost. */
  mechanical_passes: number;
  coverage: CostCoverage;
  /** Worst-wins quality across provider turns; `none` when there are none. */
  usage_quality: UsageQuality;
}

/** A fresh empty aggregate. Deliberately a function, not a shared const: the
 *  value carries a mutable `unknown_refs` array, and handing the same object to
 *  every caller would let one of them poison the rest. */
export function emptyCostAggregate(): CostAggregate {
  return {
    known_cost_usd: 0,
    provider_turns: 0,
    known_turns: 0,
    unknown_turns: 0,
    unknown_refs: [],
    mechanical_passes: 0,
    coverage: "none",
    usage_quality: "none",
  };
}

/**
 * The ONE cross-surface identity for a provider pass, used as the `ref` of a
 * pass that reached NO settled ledger row.
 *
 * Both the Observer projection and Reports must contribute such a pass to the
 * aggregate as a counted unknown (never an absent turn, never an authoritative
 * zero — invariant 4). If the two surfaces named it differently, they would
 * report identical scope with different `unknown_refs`, which is the same class
 * of defect as reporting it with different totals (#89).
 */
export function providerPassRef(app: string, runId: string): string {
  return `pass:${app}:${runId}`;
}

export function aggregateCost(contributions: readonly CostContribution[]): CostAggregate {
  let knownCost = 0;
  let knownTurns = 0;
  let mechanical = 0;
  const unknownRefs: string[] = [];
  const qualities: UsageQuality[] = [];

  for (const contribution of contributions) {
    const quality = normalizeUsageQuality(typeof contribution.quality === "string" ? contribution.quality : undefined);
    if (quality === "none") {
      // An authoritative zero. It is not a provider turn, so it neither adds to
      // the unknown component nor influences provider usage quality.
      mechanical += 1;
      continue;
    }
    qualities.push(quality);
    const observable =
      quality !== "unavailable" && contribution.costUsd !== null && Number.isFinite(contribution.costUsd);
    if (observable) {
      knownCost += contribution.costUsd!;
      knownTurns += 1;
    } else {
      unknownRefs.push(contribution.ref ?? "unattributed");
    }
  }

  const providerTurns = qualities.length;
  const unknownTurns = providerTurns - knownTurns;
  const coverage: CostCoverage =
    providerTurns === 0 ? "none" : unknownTurns === 0 ? "complete" : knownTurns === 0 ? "unavailable" : "partial";

  return {
    known_cost_usd: roundCost(knownCost),
    provider_turns: providerTurns,
    known_turns: knownTurns,
    unknown_turns: unknownTurns,
    unknown_refs: [...new Set(unknownRefs)].sort(),
    mechanical_passes: mechanical,
    coverage,
    usage_quality: providerTurns === 0 ? "none" : aggregateUsageQuality(qualities),
  };
}

/** Merge already-computed aggregates without double-counting or losing refs. */
export function mergeCostAggregates(parts: readonly CostAggregate[]): CostAggregate {
  if (parts.length === 0) return emptyCostAggregate();
  const knownTurns = parts.reduce((sum, part) => sum + part.known_turns, 0);
  const providerTurns = parts.reduce((sum, part) => sum + part.provider_turns, 0);
  const unknownTurns = providerTurns - knownTurns;
  return {
    known_cost_usd: roundCost(parts.reduce((sum, part) => sum + part.known_cost_usd, 0)),
    provider_turns: providerTurns,
    known_turns: knownTurns,
    unknown_turns: unknownTurns,
    unknown_refs: [...new Set(parts.flatMap((part) => part.unknown_refs))].sort(),
    mechanical_passes: parts.reduce((sum, part) => sum + part.mechanical_passes, 0),
    coverage:
      providerTurns === 0 ? "none" : unknownTurns === 0 ? "complete" : knownTurns === 0 ? "unavailable" : "partial",
    usage_quality:
      providerTurns === 0
        ? "none"
        : aggregateUsageQuality(parts.filter((part) => part.provider_turns > 0).map((part) => part.usage_quality)),
  };
}

/**
 * The one rendering of an aggregate. Kept here rather than per-surface so a
 * partial total can never be presented as a plain number on one surface and as
 * "unavailable" on another.
 */
export function formatCostAggregate(aggregate: CostAggregate): string {
  const amount = `${aggregate.usage_quality === "estimated" ? "~" : ""}$${aggregate.known_cost_usd.toFixed(2)}`;
  switch (aggregate.coverage) {
    case "none":
      return "$0.00 (no provider turns)";
    case "complete":
      return amount;
    case "partial":
      return `${amount} recorded + ${aggregate.unknown_turns} unknown`;
    case "unavailable":
      return `unavailable (${aggregate.unknown_turns} ${aggregate.unknown_turns === 1 ? "turn" : "turns"})`;
  }
}

/** Settlement coverage disclosed alongside every aggregate total, so an
 *  operator can see the scope the number was projected from. */
export interface CostScope {
  /** Provider execution steps that reached the ledger. */
  settled_provider_turns: number;
  /** Provider execution steps with no ledger settlement in scope. */
  unsettled_provider_turns: number;
}

export function formatCostScope(scope: CostScope): string {
  const total = scope.settled_provider_turns + scope.unsettled_provider_turns;
  return `${scope.settled_provider_turns}/${total} provider turns settled`;
}

/** Cost sums accumulate float error across hundreds of turns; two surfaces
 *  summing the same rows in different orders must still compare equal. */
function roundCost(value: number): number {
  return Number.isFinite(value) ? Math.round(value * 1e6) / 1e6 : 0;
}
