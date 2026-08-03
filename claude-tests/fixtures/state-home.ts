// fixtures/state-home.ts — the ~/.cormidia/<org> high-churn state home shape
// (system-map §2.2 durable-state table; boundary-map B-10a/B-15).
//
// Discovered from src, not assumed: the product creates state-home
// subdirectories lazily (`mkdir recursive` at each write path) and
// `executeOrgInit` creates only the bare state-home directory itself. This
// fixture pre-creates the standing shape those write paths use, so suites can
// assert against a stable tree, plant state at real product paths, and sweep
// it without inventing locations. Each entry names the owning module.
//
// `assertStateHomeShape` is the fixture's detector: it fires (throws) when a
// directory the product relies on is missing — the self-test proves it fires
// on a seeded violation.

import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { walkFiles } from "./walk.js";

/** Standing state-home directories and the src owner of each. */
export const STATE_HOME_DIRS: readonly string[] = [
  "approvals/pending", // src/org/approvals.ts (FileApprovalStore)
  "approvals/decided", // src/org/approvals.ts
  "approvals/grants", // src/org/approvals.ts
  "locks", // src/org/locks.ts lockPath(root, …)
  "runs", // runtime runlog, src/org/budget.ts rollups
  "telemetry", // src/runtime/telemetry.ts recordTurn (daily JSONL ledger)
  "tickets", // loop atomic claim transactions (tickets/<app>/<issue>.json)
  "repos", // managed clones (src/org/app-lifecycle.ts, approval-command.ts)
  "worktrees", // src/org/turn-runner.ts worktreeRoot
  "lifecycle/apps", // src/org/app-lifecycle.ts promotion journal
  "lifecycle/readiness", // src/org/app-lifecycle.ts
  "lifecycle/staging", // src/org/app-lifecycle.ts
  "invocations", // src/runtime/invocation-ledger.ts audit JSONL
  "state/turns", // src/org/journal.ts turn journals
  "state/events/inbox", // src/org/events.ts file-drop inbox
  "state/invocation-journal", // src/runtime/invocation-ledger.ts
  "scheduler/evidence", // src/org/scheduler/evidence.ts
  "learning", // src/org/learning/* state-home stores
  "tasks", // src/org/parent-task.ts
];

export interface TempStateHome {
  /** The state home root — pass wherever product code takes `stateHome` /
   *  `runtimeHome` / lock `root`. */
  stateHome: string;
  /** Join segments under the state home. */
  path(...segments: string[]): string;
  cleanup(): Promise<void>;
}

export interface MakeTempStateHomeOptions {
  /** Directory-name hint, mirroring ~/.cormidia/<org>. */
  name?: string;
}

export async function makeTempStateHome(
  options: MakeTempStateHomeOptions = {},
): Promise<TempStateHome> {
  const root = await mkdtemp(join(tmpdir(), "cormidia-fixture-state-"));
  const stateHome = join(root, options.name ?? "fixture-org");
  for (const dir of STATE_HOME_DIRS) {
    await mkdir(join(stateHome, dir), { recursive: true });
  }
  return {
    stateHome,
    path: (...segments) => join(stateHome, ...segments),
    cleanup: async () => {
      await rm(root, { recursive: true, force: true });
    },
  };
}

export class StateHomeShapeError extends Error {
  constructor(
    readonly stateHome: string,
    readonly missing: readonly string[],
  ) {
    super(`state home ${stateHome} is missing standing directories: ${missing.join(", ")}`);
    this.name = "StateHomeShapeError";
  }
}

/** Throws `StateHomeShapeError` naming every standing directory that is
 *  absent. A directory is "present" when it can be walked (even empty). */
export async function assertStateHomeShape(stateHome: string): Promise<void> {
  const missing: string[] = [];
  for (const dir of STATE_HOME_DIRS) {
    try {
      await walkFiles(join(stateHome, dir));
    } catch {
      missing.push(dir);
    }
  }
  if (missing.length > 0) throw new StateHomeShapeError(stateHome, missing);
}
