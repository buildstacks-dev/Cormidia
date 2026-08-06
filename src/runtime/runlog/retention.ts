// Run-dir retention (build plan M2.7; docs/loop/design.md §9: L3 retention =
// `session_retention_days`; run dirs pruned on the same schedule).
//
// Prune rule, fail-safe in every ambiguous case: a run dir is deleted ONLY
// when its envelope proves the run finalized (terminal status + finished_at)
// longer ago than the retention window. Running-status runs are kept
// regardless of age (crash recovery may still resume them —
// architecture.md §3), and a dir whose envelope is missing or unreadable is
// kept too: never delete what can't be proven finalized.

import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { readEnvelope } from "./envelope.js";

const DAY_MS = 86_400_000;

export interface PruneResult {
  /** `<app>/<runId>` of every deleted run dir. */
  deleted: string[];
  /** Run dirs inspected and kept (fresh, running, or unprovable). */
  kept: number;
}

export async function pruneRuns(root: string, retentionDays: number, now: Date): Promise<PruneResult> {
  const cutoff = now.getTime() - retentionDays * DAY_MS;
  const result: PruneResult = { deleted: [], kept: 0 };

  const runsDir = join(root, "runs");
  for (const app of await listDirs(runsDir)) {
    for (const runId of await listDirs(join(runsDir, app))) {
      if (await shouldPrune(root, app, runId, cutoff)) {
        await rm(join(runsDir, app, runId), { recursive: true, force: true });
        result.deleted.push(`${app}/${runId}`);
      } else {
        result.kept += 1;
      }
    }
  }
  return result;
}

async function shouldPrune(root: string, app: string, runId: string, cutoff: number): Promise<boolean> {
  try {
    const envelope = await readEnvelope(root, app, runId);
    if (envelope.status === "running") return false; // never unfinished ones
    if (envelope.finished_at === undefined) return false; // can't prove age
    return new Date(envelope.finished_at).getTime() < cutoff;
  } catch {
    return false; // unreadable envelope — keep, fail safe
  }
}

async function listDirs(path: string): Promise<string[]> {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  } catch {
    return []; // no runs/ tree at all — nothing to prune
  }
}
