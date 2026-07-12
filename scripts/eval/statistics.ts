import { createHash } from "node:crypto";

export interface Distribution {
  count: number;
  missing: number;
  values: number[];
  median: number | null;
  p90: number | null;
}

export function distribution(values: Array<number | null | undefined>): Distribution {
  const valid = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value)).sort((a, b) => a - b);
  return { count: valid.length, missing: values.length - valid.length, values: valid, median: percentile(valid, 0.5), p90: percentile(valid, 0.9) };
}

/** Linear interpolation on zero-indexed ranks. Defined here so reports do not
 * inherit a library/version-dependent percentile convention. */
export function percentile(sortedValues: number[], quantile: number): number | null {
  if (sortedValues.length === 0) return null;
  if (quantile < 0 || quantile > 1) throw new Error("quantile_out_of_range");
  const rank = (sortedValues.length - 1) * quantile;
  const low = Math.floor(rank); const high = Math.ceil(rank);
  const lower = sortedValues[low]!; const upper = sortedValues[high]!;
  return lower + (upper - lower) * (rank - low);
}

export function seededOrder<T>(items: T[], seed: string): T[] {
  return items.map((value, index) => ({ value, key: createHash("sha256").update(`${seed}\0${index}`).digest("hex") })).sort((a, b) => a.key.localeCompare(b.key)).map((item) => item.value);
}

export function pairedArmOrder(pairIndex: number, seed: string): "AB" | "BA" {
  const bit = createHash("sha256").update(`${seed}\0pair\0${pairIndex}`).digest()[0]! & 1;
  return bit === 0 ? "AB" : "BA";
}

export interface PairedDelta { pair_id: string; baseline: number; candidate: number; delta: number }
export function pairedDeltas(rows: Array<{ pair_id: string; arm: "baseline" | "candidate"; value: number }>): { pairs: PairedDelta[]; missing_pairs: string[] } {
  const grouped = new Map<string, Partial<Record<"baseline" | "candidate", number>>>();
  for (const row of rows) {
    const group = grouped.get(row.pair_id) ?? {};
    if (group[row.arm] !== undefined) throw new Error(`duplicate_pair_arm: ${row.pair_id}/${row.arm}`);
    group[row.arm] = row.value; grouped.set(row.pair_id, group);
  }
  const pairs: PairedDelta[] = []; const missing: string[] = [];
  for (const [pairId, group] of [...grouped].sort(([a], [b]) => a.localeCompare(b))) {
    if (group.baseline === undefined || group.candidate === undefined) { missing.push(pairId); continue; }
    pairs.push({ pair_id: pairId, baseline: group.baseline, candidate: group.candidate, delta: group.candidate - group.baseline });
  }
  return { pairs, missing_pairs: missing };
}
