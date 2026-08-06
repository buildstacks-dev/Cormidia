// Shared, pure ordering + disclosure primitives for the Observer projection.
//
// The root cause behind #91/#93/#94/#97 is that the projection emitted flat,
// unlabeled collections and the client rendered each as a bare list without
// declaring its SCOPE, ORDERING, COMPLETENESS, or GROUPING. These helpers are
// the single place those four facts are produced, so every section declares
// them the same way and no section can silently truncate.
//
// This module imports nothing above `src/observe` and is deliberately pure.

import type { OrderDirection, OrderingView, SectionScopeView } from "./types.js";

/** U+0000 sorts below every printable character, so composite keys built with
 *  it have correct prefix boundaries. Precedent: the existing trace grouping
 *  key in project.ts and the client. */
export const ORDER_SEPARATOR = "\u0000";

/**
 * Code-unit comparison. NOT `localeCompare`: that is ICU/locale-sensitive, so
 * the same durable state would order differently on two machines, which is
 * exactly the instability the grouping/ordering acceptance criteria forbid.
 */
export function compareStable(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The total activity order. A single DESCENDING lexicographic sort over the
 * emitted key IS the whole ordering contract: dated before undated, newest
 * instant first, then app, then run id, then reverse append order within the
 * pass event log.
 *
 * `ts_utc` is already canonical UTC with milliseconds, so a raw string compare
 * of the dated portion is a correct instant compare (this is why the
 * projection canonicalizes instants — a `+02:00` offset string sorts wrong).
 *
 * Note the trade: because ONE descending sort covers the whole composite key,
 * the tie-break components are read in reverse too. That is the price of an
 * opaque single-key total order a client can sort on without knowing the
 * schema, and it is declared in `ACTIVITY_ORDER.tie_break` rather than left
 * implicit for a reader to discover.
 */
export function buildOrderKey(input: { ts_utc: string | null; app: string; run_id: string; seq: number }): string {
  const tail = [input.app, input.run_id, String(input.seq).padStart(9, "0")].join(ORDER_SEPARATOR);
  return input.ts_utc === null
    ? `0${ORDER_SEPARATOR}${tail}`
    : `1${ORDER_SEPARATOR}${input.ts_utc}${ORDER_SEPARATOR}${tail}`;
}

export const ACTIVITY_ORDER = Object.freeze({
  direction: "newest_first" as const,
  key_fields: Object.freeze(["ts_utc", "app", "run_id", "seq"]) as unknown as string[],
  tie_break:
    "same timestamp: app, then run id, then append order within the pass event log — all read in reverse, because one descending sort covers the whole composite key",
});

/**
 * Order rows by a primary string key with an ALWAYS-ascending identity
 * tie-breaker. The tie-breaker is never reversed, so `chronological` is not
 * `[...rows].reverse()` — reversing would silently reverse ties too.
 */
export function orderRows<T>(
  rows: T[],
  key: (row: T) => string,
  id: (row: T) => string,
  direction: OrderDirection,
): T[] {
  const sign = direction === "newest_first" ? -1 : 1;
  return [...rows].sort((a, b) => {
    const primary = compareStable(key(a), key(b));
    if (primary !== 0) return primary * sign;
    return compareStable(id(a), id(b));
  });
}

export function orderingView(sortKey: string, tieBreaker: string, direction: OrderDirection): OrderingView {
  return {
    sort_key: sortKey,
    direction,
    label: direction === "newest_first" ? "Newest first" : "Oldest first",
    tie_breaker: tieBreaker,
  };
}

/**
 * Truncation disclosure. `total` is the PRE-cap count, so "showing 40 of 312"
 * is truthful; the client never recomputes a total from what it received.
 */
export function sectionScope<T>(
  label: string,
  all: T[],
  cap: number | null,
  ordering: OrderingView | null,
): { scope: SectionScopeView; rows: T[] } {
  const rows = cap === null ? [...all] : all.slice(0, cap);
  return {
    scope: {
      label,
      total: all.length,
      returned: rows.length,
      truncated: rows.length < all.length,
      cap,
      ordering,
    },
    rows,
  };
}
