// `cormidia prune-runs [root] [--retention-days N]` — delete finalized run
// dirs older than the retention window (docs/loop/design.md §9). Root defaults to
// the current directory (the org runtime home once one exists — M3/M7 wire
// the real default); running-status runs are never deleted.
//
// `cormidia prune-runs --sweep` runs the full state-home retention sweep
// (review P1-14 / F-003; docs/scheduler/design.md → State retention) across every
// retained subtree with the default windows — the same sweep the scheduler's
// dispatch tick runs at most once per UTC day. The manual form runs
// immediately (it does not consume the daily claim's exact-once semantics —
// concurrent sweeps are idempotent) and records the day's sweep marker.

import { resolveCormidiaHomes } from "../org/home.js";
import { recordSweepMarker, sweepStateRetention, type StateSweepResult } from "../org/retention.js";
import { pruneRuns } from "../runtime/runlog/retention.js";
import { extractHomeFlags } from "./home-flags.js";

const DEFAULT_RETENTION_DAYS = 30;

export async function cmdPruneRuns(args: string[]): Promise<number> {
  const common = extractHomeFlags(args, "prune-runs");
  let root: string | undefined;
  let retentionDays: number | undefined;
  let sweep = false;

  for (let i = 0; i < common.rest.length; i++) {
    const arg = common.rest[i];
    if (arg === "--retention-days") {
      const value = Number(common.rest[++i]);
      if (!Number.isFinite(value) || value < 0) {
        throw new Error(`--retention-days needs a non-negative number, got "${common.rest[i]}"`);
      }
      retentionDays = value;
    } else if (arg === "--sweep") {
      sweep = true;
    } else if (arg !== undefined && !arg.startsWith("--")) {
      root = arg;
    } else {
      throw new Error(`prune-runs: unknown flag "${arg}"`);
    }
  }
  if (sweep && retentionDays !== undefined) {
    throw new Error(
      "prune-runs: --sweep applies the documented per-subtree windows; it cannot be combined with --retention-days",
    );
  }

  const effectiveRoot = root ?? (await resolveCormidiaHomes(common)).stateHome;
  if (sweep) {
    const now = new Date();
    const result = await sweepStateRetention(effectiveRoot, now);
    await recordSweepMarker(effectiveRoot, now, "manual", result);
    printSweep(result);
    return result.errors.length > 0 ? 1 : 0;
  }

  const result = await pruneRuns(effectiveRoot, retentionDays ?? DEFAULT_RETENTION_DAYS, new Date());
  console.log(
    `pruned ${result.deleted.length} run dir(s) (retention ${retentionDays ?? DEFAULT_RETENTION_DAYS} days); kept ${result.kept}`,
  );
  for (const run of result.deleted) console.log(`  deleted ${run}`);
  return 0;
}

function printSweep(result: StateSweepResult): void {
  const rows: Array<[string, keyof StateSweepResult, number]> = [
    ["runs/", "runs", result.windows.runsDays],
    ["telemetry/", "telemetry", result.windows.telemetryDays],
    ["efficiency/episodes/", "efficiency_episodes", result.windows.efficiencyEpisodeDays],
    ["invocations/", "invocations", result.windows.invocationsDays],
    ["tasks/", "tasks", result.windows.tasksDays],
    ["learning/events/", "learning_events", result.windows.learningEventsDays],
    ["scheduler/evidence/", "scheduler_evidence", result.windows.schedulerEvidenceDays],
    ["state/retention/sweeps/", "sweep_records", result.windows.sweepRecordDays],
    ["narrative/", "narrative", result.windows.narrativeDays],
  ];
  console.log(`state retention sweep at ${result.swept_at}`);
  for (const [label, key, windowDays] of rows) {
    const sweepResult = result[key] as { pruned: number; kept: number };
    console.log(`  ${label} pruned=${sweepResult.pruned} kept=${sweepResult.kept} (window ${windowDays}d)`);
  }
  for (const error of result.errors) console.log(`  error: ${error}`);
}
