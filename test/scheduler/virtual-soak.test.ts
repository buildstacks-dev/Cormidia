import { describe, expect, it } from "vitest";
import { runVirtualSchedulerSoak, verifyVirtualSchedulerSoak } from "../../src/org/scheduler/virtual-soak.js";
import { makeOrgHome } from "../fixtures/orgHome.js";
import { FakeClock } from "../fixtures/fakeClock.js";

// Promoted production contracts: I-SOAK-01 (seven virtual days), I-SOAK-02
// (exact-once/reasoned integrity), and I-SOAK-03 (runtime/settlement boundary).

describe("SCHEDULER-SOAK-001 deterministic seven-day virtual-time harness", () => {
  it("positive case executes thousands of production-backed due decisions with complete reasons and exact settlement", async () => {
    const home = makeOrgHome({ state: true });
    const clock = new FakeClock("2026-07-12T00:00:00Z");
    let providerCalls = 0;
    try {
      const result = await runVirtualSchedulerSoak({ stateHome: home.root, orgHome: home.root, start: clock.now().toISOString(), providerExecutor: async () => { providerCalls += 1; return { providerTurns: 1, providerSettlements: 1 }; } });
      expect(result).toMatchObject({ virtual_days: 7, due_windows: 2016, due_decisions: 2016, executed_or_reasoned: 2016, duplicate_ticks: 0, duplicate_episodes: 0, silent_misses: 0, orphaned_runs: 0, orphaned_locks: 0, orphaned_journals: 0, orphaned_settlements: 0, mechanical_provider_leakage: 0, empty_learning_runtime_constructions: 0, process_restarts: 4, cross_app_budget_leaks: 0, terminal_integrity: true });
      expect(providerCalls).toBe(result.provider_executor_calls);
      expect(result.provider_settlements).toBe(result.provider_turns);
      expect(Object.keys(result.reason_counts)).toEqual(expect.arrayContaining(["executed", "fresh_lock", "wip_limit", "budget_paused", "approval_blocked", "channel_gated", "missed_window_reconciled", "empty_learning_window"]));
      const replay = await runVirtualSchedulerSoak({ stateHome: home.root, orgHome: home.root, start: clock.now().toISOString(), providerExecutor: async () => { throw new Error("replay_must_not_construct_runtime"); } });
      expect(replay.evidence_sha256).toBe(result.evidence_sha256);
      expect(replay.records).toEqual(result.records);
    } finally { home.cleanup(); }
  }, 40_000);
  it("near-miss case is invariant to durable evidence enumeration order", async () => {
    const home = makeOrgHome({ state: true });
    try {
      const result = await runVirtualSchedulerSoak({ stateHome: home.root, orgHome: home.root });
      const reversed = verifyVirtualSchedulerSoak([...result.records].reverse(), { virtualDays: 7, dueWindows: 2016, processRestarts: 4, providerExecutorCalls: result.provider_executor_calls, evidenceSha256: result.evidence_sha256, orphanedLocks: result.orphaned_locks, orphanedJournals: result.orphaned_journals, orphanedRuns: result.orphaned_runs, orphanedSettlements: result.orphaned_settlements });
      expect(reversed).toEqual(result);
    } finally { home.cleanup(); }
  }, 40_000);
  it("honest failure exposes a duplicate decision and provider-without-settlement orphan", async () => {
    const home = makeOrgHome({ state: true });
    try {
      const result = await runVirtualSchedulerSoak({ stateHome: home.root, orgHome: home.root });
      const duplicate = { ...result.records[1]! };
      const executed = result.records.find((record) => record.outcome === "executed" && (record.provider_turns ?? 0) > 0)!;
      const orphan = { ...executed, decision_id: "orphan", provider_settlements: 0 };
      const invalid = verifyVirtualSchedulerSoak([...result.records, duplicate, orphan], { virtualDays: 7, dueWindows: 2016, processRestarts: 4, providerExecutorCalls: result.provider_executor_calls });
      expect(invalid.duplicate_ticks).toBeGreaterThan(0);
      expect(invalid.orphaned_runs).toBeGreaterThan(0);
      expect(invalid.terminal_integrity).toBe(false);
    } finally { home.cleanup(); }
  }, 40_000);
});
