import { describe, expect, it } from "vitest";
import { simulateVirtualSoak, verifyVirtualSoak } from "../../scripts/eval/virtual-soak.js";

describe("SCHEDULER-SOAK-001 deterministic seven-day virtual-time harness", () => {
  it("positive case executes thousands of due ticks with complete reasons and exact settlement", () => {
    const result = simulateVirtualSoak();
    expect(result).toMatchObject({ virtual_days: 7, due_ticks: 2016, executed_or_reasoned: 2016, duplicate_ticks: 0, silent_misses: 0, orphaned_runs: 0, mechanical_provider_leakage: 0, process_restarts: 2, cross_app_budget_leaks: 0 });
    expect(result.provider_settlements).toBe(result.provider_turns);
    expect(new Set(result.records.map((record) => record.outcome))).toEqual(new Set(["executed", "locked", "budget_paused", "approval_blocked", "missed_reconciled", "empty_learning"]));
  });
  it("near-miss case is invariant to durable journal enumeration order", () => {
    const result = simulateVirtualSoak();
    const reversed = verifyVirtualSoak([...result.records].reverse(), 7, 2);
    expect({ ...reversed, records: undefined }).toEqual({ ...result, records: undefined });
  });
  it("honest failure case exposes a duplicate tick and provider-without-settlement orphan", () => {
    const result = simulateVirtualSoak();
    const duplicate = { ...result.records[1]! };
    const orphan = { ...result.records[2]!, tick_id: "orphan", settlements: 0 };
    const invalid = verifyVirtualSoak([...result.records, duplicate, orphan], 7, 2);
    expect(invalid.duplicate_ticks).toBeGreaterThan(0);
    expect(invalid.orphaned_runs).toBeGreaterThan(0);
  });
});
