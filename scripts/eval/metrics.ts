export interface Metric<T = number> { value: T | null; numerator: number; denominator: number; excluded: string[]; missing: string[]; quality: "valid" | "invalid_measurement" }
export interface ExecutionStep { id: string; kind: "provider" | "mechanical"; terminal_records: number; status: string }
export interface Settlement { step_id: string; settlement_id: string }

export function settlementIntegrity(steps: ExecutionStep[], settlements: Settlement[]): { terminal: Metric; ledger: Metric; mechanical_zero_settlement: Metric } {
  const settlementCounts = new Map<string, number>();
  for (const row of settlements) settlementCounts.set(row.step_id, (settlementCounts.get(row.step_id) ?? 0) + 1);
  const provider = steps.filter((step) => step.kind === "provider"); const mechanical = steps.filter((step) => step.kind === "mechanical");
  return {
    terminal: ratio(steps.filter((step) => step.terminal_records === 1).length, steps.length, [], steps.filter((step) => step.terminal_records !== 1).map((step) => step.id)),
    ledger: ratio(provider.filter((step) => settlementCounts.get(step.id) === 1).length, provider.length, [], provider.filter((step) => settlementCounts.get(step.id) !== 1).map((step) => step.id)),
    mechanical_zero_settlement: ratio(mechanical.filter((step) => !settlementCounts.has(step.id)).length, mechanical.length, [], mechanical.filter((step) => settlementCounts.has(step.id)).map((step) => step.id)),
  };
}

export function unionDurationMs(intervals: Array<{ id: string; start: number; end: number }>): Metric {
  const missing = intervals.filter((item) => !Number.isFinite(item.start) || !Number.isFinite(item.end) || item.end < item.start).map((item) => item.id);
  if (missing.length > 0) return { value: null, numerator: 0, denominator: intervals.length, excluded: [], missing, quality: "invalid_measurement" };
  const sorted = intervals.map((item) => ({ ...item })).sort((a, b) => a.start - b.start || a.end - b.end || a.id.localeCompare(b.id));
  let total = 0; let start: number | undefined; let end: number | undefined;
  for (const item of sorted) {
    if (start === undefined) { start = item.start; end = item.end; continue; }
    if (item.start <= end!) end = Math.max(end!, item.end);
    else { total += end! - start; start = item.start; end = item.end; }
  }
  if (start !== undefined) total += end! - start;
  return { value: total, numerator: total, denominator: intervals.length, excluded: [], missing: [], quality: "valid" };
}

export interface PassFingerprint { id: string; intended_fingerprint: string | null; prior_valid_fingerprints: string[]; creates_required_verification?: boolean; cost_usd: number | null }
export function productivePasses(passes: PassFingerprint[]): { productive: string[]; repeated: string[]; repeated_work_cost: Metric } {
  const productive: string[] = []; const repeated: string[] = []; const missing: string[] = []; let cost = 0;
  for (const pass of [...passes].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!pass.intended_fingerprint) { missing.push(pass.id); continue; }
    const duplicate = pass.prior_valid_fingerprints.includes(pass.intended_fingerprint) && pass.creates_required_verification !== true;
    (duplicate ? repeated : productive).push(pass.id);
    if (duplicate) {
      if (pass.cost_usd === null) missing.push(pass.id);
      else cost += pass.cost_usd;
    }
  }
  return { productive, repeated, repeated_work_cost: { value: missing.length > 0 ? null : cost, numerator: cost, denominator: repeated.length, excluded: [], missing: [...new Set(missing)].sort(), quality: missing.length > 0 ? "invalid_measurement" : "valid" } };
}

function ratio(numerator: number, denominator: number, excluded: string[], missing: string[]): Metric {
  return { value: denominator === 0 || missing.length > 0 ? null : numerator / denominator, numerator, denominator, excluded, missing: [...missing].sort(), quality: denominator === 0 || missing.length > 0 ? "invalid_measurement" : "valid" };
}
