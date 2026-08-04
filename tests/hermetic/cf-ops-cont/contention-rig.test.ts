import { describe, expect, it, vi } from "vitest";

// The desktop sandbox denies `ps`, but the contention rig is about dispatch,
// locks, and settlement rather than the OS probe itself (CF-C-B07 owns that
// detector). Keep the new-lock invariant intact by giving this process a
// deterministic kernel-style start identity at the real probe boundary.
vi.mock("node:child_process", async (importOriginal) => ({
  ...await importOriginal<typeof import("node:child_process")>(),
  execFileSync: vi.fn(() => "Thu Jul 31 18:00:00 2026\n"),
}));

import { evaluateContentionRig, runContentionRig } from "../../ops/contention-rig.js";

describe("CF-OPS-CONT contention rig", () => {
  it("proves all six owner-ratified contention obligations", async () => {
    const result = await runContentionRig();
    expect(result.due_candidates).toBeGreaterThanOrEqual(10);
    expect(result.apps).toBeGreaterThanOrEqual(3);
    expect(result.max_live_observed).toBeLessThanOrEqual(2);
    expect(result.duplicate_pair_admissions).toBe(0);
    expect(result.priority_preserved).toBe(true);
    expect(result.typed_non_admissions).toBe(result.due_candidates - result.first_admitted.length);
    expect(result.reconsidered_after_capacity).toBeGreaterThan(0);
    expect(result.provider_turns).toBe(result.provider_settlements);
    expect(result.duplicate_decisions).toBe(0);
    expect(result.duplicate_episodes).toBe(0);
    expect(result.orphaned_locks + result.orphaned_journals + result.orphaned_runs + result.orphaned_settlements).toBe(0);
    expect(result.settlement_idempotence_refusals).toBeGreaterThanOrEqual(2);
    expect(result.terminal_integrity).toBe(true);
    expect(result.overlapping_batch_refusals).toBe(1);
    expect(result.duplicate_unit_stimulus_refusals).toBe(1);
    expect(result.multi_ticket_claim_atomic).toBe(true);
    expect(result.per_unit_settlements).toBe(2);
    expect(result.batch_complete).toBe(true);
    expect(result.every_unit_success).toBe(false);
    expect(result.sibling_isolation).toBe(true);
    expect(result.stale_frontier_refusals).toBe(1);
    expect(evaluateContentionRig(result)).toEqual([]);
  });

  it("negative control: seeded overload and vanished-decision evidence make the contention detector fire", async () => {
    const clean = await runContentionRig();
    const violations = evaluateContentionRig({
      ...clean,
      max_live_observed: clean.wip_limit + 1,
      typed_non_admissions: 0,
      sibling_isolation: false,
      stale_frontier_refusals: 0,
    });
    expect(violations).toEqual(expect.arrayContaining([
      "CF-OPS-CONT:wip_exceeded",
      "CF-OPS-CONT:untyped_non_admission",
      "CF-OPS-CONT:sibling_contamination",
      "CF-OPS-CONT:stale_frontier_admitted",
    ]));
  });
});
