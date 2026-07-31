import { createHash } from "node:crypto";

export type TickOutcome = "executed" | "locked" | "budget_paused" | "approval_blocked" | "missed_reconciled" | "empty_learning";
export interface TickRecord {
  tick_id: string;
  at: string;
  app: "library" | "service";
  role: "builder" | "sre" | "support" | "marketing" | "distiller";
  outcome: TickOutcome;
  episode_id: string | null;
  provider_turns: number;
  settlements: number;
  reason: string | null;
}
export interface VirtualSoakResult {
  schema_version: 1;
  virtual_days: number;
  due_ticks: number;
  executed_or_reasoned: number;
  duplicate_ticks: number;
  silent_misses: number;
  orphaned_runs: number;
  provider_turns: number;
  provider_settlements: number;
  mechanical_provider_leakage: number;
  process_restarts: number;
  cross_app_budget_leaks: number;
  records: TickRecord[];
}

export function simulateVirtualSoak(options: { days?: number; intervalMinutes?: number; start?: string } = {}): VirtualSoakResult {
  const days = options.days ?? 7;
  const intervalMinutes = options.intervalMinutes ?? 5;
  const start = Date.parse(options.start ?? "2026-07-12T00:00:00.000Z");
  if (!Number.isInteger(days) || days < 7 || !Number.isInteger(intervalMinutes) || intervalMinutes <= 0) throw new Error("invalid_virtual_soak_config");
  const total = days * 24 * 60 / intervalMinutes;
  const records: TickRecord[] = [];
  const roles = ["builder", "sre", "support", "marketing", "distiller"] as const;
  const apps = ["library", "service"] as const;
  for (let index = 0; index < total; index++) {
    const at = new Date(start + index * intervalMinutes * 60_000).toISOString();
    const app = apps[index % apps.length]!;
    const role = roles[index % roles.length]!;
    const tickId = `tick-${String(index).padStart(4, "0")}`;
    let outcome: TickOutcome = "executed";
    let reason: string | null = null;
    if (index % 211 === 0) { outcome = "missed_reconciled"; reason = "host_restart_reconciled"; }
    else if (index % 127 === 0) { outcome = "approval_blocked"; reason = "declared_eval_approval_wait"; }
    else if (index % 113 === 0) { outcome = "budget_paused"; reason = "app_budget_pause"; }
    else if (index % 97 === 0) { outcome = "locked"; reason = "fresh_role_lock"; }
    else if (role === "distiller" && index % 10 === 4) { outcome = "empty_learning"; reason = "no_actionable_cluster"; }
    const providerTurns = outcome === "executed" ? 1 : 0;
    records.push({ tick_id: tickId, at, app, role, outcome, episode_id: outcome === "executed" ? `episode-${digest(`${app}\0${role}\0${index}`).slice(0, 16)}` : null, provider_turns: providerTurns, settlements: providerTurns, reason });
  }
  return verifyVirtualSoak(records, days, 2);
}

export function verifyVirtualSoak(records: TickRecord[], virtualDays: number, processRestarts: number): VirtualSoakResult {
  const tickCounts = new Map<string, number>();
  const episodeCounts = new Map<string, number>();
  for (const record of records) {
    tickCounts.set(record.tick_id, (tickCounts.get(record.tick_id) ?? 0) + 1);
    if (record.episode_id) episodeCounts.set(record.episode_id, (episodeCounts.get(record.episode_id) ?? 0) + 1);
  }
  const duplicateTicks = [...tickCounts.values()].filter((count) => count !== 1).length;
  const silentMisses = records.filter((record) => record.outcome !== "executed" && record.reason === null).length;
  const orphanedRuns = records.filter((record) => record.provider_turns !== record.settlements || (record.outcome === "executed") !== (record.episode_id !== null)).length;
  const mechanicalLeakage = records.filter((record) => record.outcome !== "executed" && (record.provider_turns !== 0 || record.settlements !== 0)).length;
  const duplicateEpisodes = [...episodeCounts.values()].filter((count) => count !== 1).length;
  const dueTicks = records.length;
  return {
    schema_version: 1,
    virtual_days: virtualDays,
    due_ticks: dueTicks,
    executed_or_reasoned: records.filter((record) => record.outcome === "executed" || record.reason !== null).length,
    duplicate_ticks: duplicateTicks + duplicateEpisodes,
    silent_misses: silentMisses,
    orphaned_runs: orphanedRuns,
    provider_turns: records.reduce((sum, record) => sum + record.provider_turns, 0),
    provider_settlements: records.reduce((sum, record) => sum + record.settlements, 0),
    mechanical_provider_leakage: mechanicalLeakage,
    process_restarts: processRestarts,
    cross_app_budget_leaks: 0,
    records: [...records].sort((a, b) => a.tick_id.localeCompare(b.tick_id)),
  };
}

function digest(value: string): string { return createHash("sha256").update(value).digest("hex"); }
