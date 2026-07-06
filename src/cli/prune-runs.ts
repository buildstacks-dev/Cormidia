// `operon prune-runs [root] [--retention-days N]` — delete finalized run
// dirs older than the retention window (docs/loop.md §9). Root defaults to
// the current directory (the org runtime home once one exists — M3/M7 wire
// the real default); running-status runs are never deleted.

import { pruneRuns } from "../runtime/runlog/retention.js";

const DEFAULT_RETENTION_DAYS = 30;

export async function cmdPruneRuns(args: string[]): Promise<number> {
  let root = ".";
  let retentionDays = DEFAULT_RETENTION_DAYS;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--retention-days") {
      const value = Number(args[++i]);
      if (!Number.isFinite(value) || value < 0) {
        throw new Error(`--retention-days needs a non-negative number, got "${args[i]}"`);
      }
      retentionDays = value;
    } else if (arg !== undefined && !arg.startsWith("--")) {
      root = arg;
    } else {
      throw new Error(`prune-runs: unknown flag "${arg}"`);
    }
  }

  const result = await pruneRuns(root, retentionDays, new Date());
  console.log(
    `pruned ${result.deleted.length} run dir(s) (retention ${retentionDays} days); kept ${result.kept}`,
  );
  for (const run of result.deleted) console.log(`  deleted ${run}`);
  return 0;
}
