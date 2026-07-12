export function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

export function nearestRank(values: readonly number[], percentile: number): number | null {
  const eligible = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (eligible.length === 0) return null;
  if (!Number.isFinite(percentile) || percentile <= 0 || percentile > 1) throw new Error("percentile must be within (0, 1]");
  return eligible[Math.ceil(percentile * eligible.length) - 1]!;
}

export function share(value: number, denominator: number): number | null {
  return denominator > 0 ? value / denominator : null;
}

export function deterministicCounts(values: readonly string[]): Array<{ status: string; count: number }> {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts].map(([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count || a.status.localeCompare(b.status));
}
