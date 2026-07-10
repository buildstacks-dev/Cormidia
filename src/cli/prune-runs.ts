// `operon prune-runs [root] [--retention-days N]` — delete finalized run
// dirs older than the retention window (docs/loop.md §9). Root defaults to
// the current directory (the org runtime home once one exists — M3/M7 wire
// the real default); running-status runs are never deleted.

import { pruneRuns } from "../runtime/runlog/retention.js";
import { resolveOperonHomes } from "../org/home.js";
import { extractHomeFlags } from "./home-flags.js";

const DEFAULT_RETENTION_DAYS = 30;

export async function cmdPruneRuns(args: string[]): Promise<number> {
  const common = extractHomeFlags(args, "prune-runs");
  let root: string | undefined;
  let retentionDays = DEFAULT_RETENTION_DAYS;

  for (let i = 0; i < common.rest.length; i++) {
    const arg = common.rest[i];
    if (arg === "--retention-days") {
      const value = Number(common.rest[++i]);
      if (!Number.isFinite(value) || value < 0) {
        throw new Error(`--retention-days needs a non-negative number, got "${common.rest[i]}"`);
      }
      retentionDays = value;
    } else if (arg !== undefined && !arg.startsWith("--")) {
      root = arg;
    } else {
      throw new Error(`prune-runs: unknown flag "${arg}"`);
    }
  }

  const effectiveRoot = root ?? (await resolveOperonHomes(common)).stateHome;
  const result = await pruneRuns(effectiveRoot, retentionDays, new Date());
  console.log(
    `pruned ${result.deleted.length} run dir(s) (retention ${retentionDays} days); kept ${result.kept}`,
  );
  for (const run of result.deleted) console.log(`  deleted ${run}`);
  return 0;
}
