import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runVirtualSchedulerSoak } from "../../../src/org/scheduler/virtual-soak.js";
import {
  ARTIFACT_ROOT,
  assertArtifactPath,
  createControlledWorld,
  type ControlledWorld,
} from "../../src/fixtures/controlled-world.js";
import { runAcceleratedHarnessSoak } from "../../src/simulators/autonomous-soak.js";

let world: ControlledWorld | undefined;

afterEach(async () => {
  await world?.cleanup();
  world = undefined;
});

describe("accelerated operational plumbing", () => {
  it("keeps the small seam-plumbing model explicitly non-production", () => {
    const report = runAcceleratedHarnessSoak(90);

    expect(report).toMatchObject({
      simulatedDays: 90,
      independentEpisodesCompleted: 90,
      approvalDependentEpisodesCompleted: 0,
      approvalStillPending: true,
      providerTurnsReserved: 90,
      providerTurnsSettled: 90,
      falseHealthyObservations: 0,
      acceleratedOnly: true,
      realTimeObligationSatisfied: false,
    });
    expect(report.duplicateEffectsSuppressed).toBeGreaterThan(0);
    expect(report.unknownUsageReconciliations).toBeGreaterThan(0);
    expect(report.maximumTelemetryRecords).toBeLessThanOrEqual(62);
  });

  it(
    "runs 90 accelerated days through production scheduler evidence and recovery composition",
    async () => {
      world = await createControlledWorld("layer-5-production-virtual-soak");
      const report = await runVirtualSchedulerSoak({
        stateHome: world.stateRoot,
        orgHome: world.orgRoot,
        orgName: "controlled-operational-org",
        start: "2026-01-01T00:00:00.000Z",
        days: 90,
        cadenceMinutes: 60,
        providerExecutor: async () => ({ providerTurns: 1, providerSettlements: 1 }),
      });

      expect(report).toMatchObject({
        schema_version: 1,
        virtual_days: 90,
        due_windows: 2_160,
        due_decisions: 2_160,
        duplicate_ticks: 0,
        duplicate_episodes: 0,
        silent_misses: 0,
        orphaned_runs: 0,
        orphaned_locks: 0,
        orphaned_journals: 0,
        orphaned_settlements: 0,
        mechanical_provider_leakage: 0,
        cross_app_budget_leaks: 0,
        unapproved_outward_effects: 0,
        terminal_integrity: true,
      });
      expect(report.process_restarts).toBe(4);
      expect(report.provider_turns).toBe(report.provider_settlements);
      expect(report.provider_turns).toBeGreaterThan(0);
      expect(report.reason_counts["approval_blocked"]).toBeGreaterThan(0);
      expect(report.reason_counts["executed"]).toBeGreaterThan(
        report.reason_counts["approval_blocked"] ?? 0,
      );
      expect(report.reason_counts).toMatchObject({
        approval_blocked: expect.any(Number),
        budget_paused: expect.any(Number),
        fresh_lock: expect.any(Number),
        missed_window_reconciled: expect.any(Number),
        wip_limit: expect.any(Number),
      });
      const footprint = await measureTree(world.stateRoot);
      expect(footprint.files).toBe(report.due_windows * 2);
      expect(footprint.bytes).toBeLessThanOrEqual(report.due_windows * 2_048);

      const evidencePath = assertArtifactPath(
        resolve(ARTIFACT_ROOT, "operational", "accelerated-90-day-production-composition.json"),
      );
      await mkdir(dirname(evidencePath), { recursive: true });
      await writeFile(
        evidencePath,
        `${JSON.stringify(
          {
            schema_version: 1,
            case_id: "OPERON-CASE-WS-006",
            source_ids: [
              "OPERON-INV-001",
              "OPERON-INV-005",
              "OPERON-INV-008",
              "OPERON-INV-009",
              "OPERON-INV-010",
              "OPERON-BND-004",
              "OPERON-BND-005",
              "OPERON-BND-006",
              "OPERON-BND-013",
            ],
            simulated_days: report.virtual_days,
            cadence_minutes: 60,
            due_windows: report.due_windows,
            process_restarts: report.process_restarts,
            provider_turns: report.provider_turns,
            provider_settlements: report.provider_settlements,
            state_files: footprint.files,
            state_bytes: footprint.bytes,
            state_file_bound: report.due_windows * 2,
            state_byte_bound: report.due_windows * 2_048,
            terminal_integrity: report.terminal_integrity,
            reason_counts: report.reason_counts,
            evidence_sha256: report.evidence_sha256,
            real_time_obligation_satisfied: false,
            explicit_non_claim:
              "Accelerated production composition does not satisfy the separately authorized 72-hour production-shaped soak.",
          },
          null,
          2,
        )}\n`,
        "utf8",
      );
    },
    30_000,
  );
});

async function measureTree(root: string): Promise<{ files: number; bytes: number }> {
  const result = { files: 0, bytes: 0 };
  await walk(root);
  return result;

  async function walk(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else {
        result.files += 1;
        result.bytes += (await stat(path)).size;
      }
    }
  }
}
