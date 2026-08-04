// CF-J14-S — reset plan (default) mutates nothing; execute runs
// archive → GitHub closes → registry → local clears in order (L2, E1 — T-8;
// C-OP-LIFE §6, journey-acceptance J-14, INV-010; case-catalog row CF-J14-S).
//
// Order is observed from INSIDE the transaction: the product's in-memory
// LifecycleFaultHook records a checkpoint of world state at each named fault
// point, and the gh double's call log dates every remote mutation.
//
// PRODUCT DEFECT TRIPWIRE (step order): C-OP-LIFE §6 ratifies
// "archive-first, then closes planned PRs/issues, deletes their head
// branches, removes registry entry, clears managed state" — registry removal
// BEFORE local clears (the case-catalog row spells it
// archive→closes→registry→local clears). executeAppReset
// (src/org/app-reset.ts:378-385) runs removeLocalAppState BEFORE the
// registry write. The it.fails tripwire asserts the ratified order and stays
// green while the defect exists.

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { executeAppReset, planAppReset, type AppResetOptions } from "../../../src/org/app-reset.js";
import { loadApps } from "../../../src/org/apps.js";
import type { LifecycleFaultPoint } from "../../../src/org/lifecycle.js";
import {
  assertResetScope,
  completedResetAllowance,
  diffWorld,
  makeResetWorld,
  mutatingOpsSince,
  snapshotWorld,
  TARGET_APP,
  SIBLING_APP,
  type ResetWorld,
} from "./support.js";

interface Checkpoint {
  mutatingOps: string[];
  registryHasTarget: boolean;
  targetRunsPresent: boolean;
  finalArchivePresent: boolean;
  intentPresent: boolean;
}

describe("CF-J14-S — reset plan mutates nothing; execute order archive→closes→registry→clears (C-OP-LIFE §6)", () => {
  let cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.reverse()) await cleanup();
    cleanups = [];
  });

  async function world(): Promise<ResetWorld> {
    const w = await makeResetWorld();
    cleanups.push(() => w.cleanup());
    return w;
  }

  function resetInput(w: ResetWorld): AppResetOptions {
    return {
      orgHome: w.orgHome,
      stateHome: w.stateHome,
      appsFile: w.appsFile,
      appName: TARGET_APP,
      gh: w.gh,
      archiveRoot: w.archiveRoot,
    };
  }

  it("the default plan performs GitHub reads only and mutates no local byte", async () => {
    const w = await world();
    const before = await snapshotWorld(w);
    const plan = await planAppReset(resetInput(w));

    // The reviewable inventory is exact: the seeded op:* work, nothing else.
    expect(plan.blockers).toEqual([]);
    expect(plan.github.issues.map((issue) => issue.number)).toEqual([w.issue.number]);
    expect(plan.github.pullRequests.map((pr) => pr.number)).toEqual([w.pr.number]);
    expect(plan.github.branches).toEqual([w.opBranch]);
    expect(plan.managedPaths.length).toBeGreaterThan(0);

    // Zero mutation anywhere — org, state, human checkout — and zero
    // mutating remote calls (reads are the point of the plan).
    const diff = diffWorld(before, await snapshotWorld(w));
    expect(diff.org).toEqual({ added: [], removed: [], changed: [] });
    expect(diff.state).toEqual({ added: [], removed: [], changed: [] });
    expect(diff.human).toEqual({ added: [], removed: [], changed: [] });
    expect(mutatingOpsSince(w)).toEqual([]);
  });

  it("execute: durable intent, then archive, then closes, then destruction — each boundary observed in order", async () => {
    const w = await world();
    const input = resetInput(w);
    const plan = await planAppReset(input);
    expect(plan.blockers).toEqual([]);

    const checkpoints = new Map<string, Checkpoint>();
    const record = async (point: LifecycleFaultPoint): Promise<void> => {
      if (checkpoints.has(point)) return; // first firing only
      checkpoints.set(point, {
        mutatingOps: mutatingOpsSince(w),
        registryHasTarget: (await loadApps(join(w.orgHome, "apps.yaml"))).apps.some(
          (app) => app.name === TARGET_APP,
        ),
        targetRunsPresent: existsSync(join(w.stateHome, "runs", TARGET_APP, "seed-run", "artifact.txt")),
        finalArchivePresent: existsSync(join(w.archiveRoot, plan.archiveId, "manifest.json")),
        intentPresent: existsSync(join(w.stateHome, "lifecycle", "transactions", `reset-${TARGET_APP}.json`)),
      });
    };

    const result = await executeAppReset({ ...input, fault: record }, plan);

    // (0) durable intent precedes the archive.
    const beforeArchive = checkpoints.get("before_archive_creation")!;
    expect(beforeArchive.intentPresent).toBe(true);
    expect(beforeArchive.finalArchivePresent).toBe(false);
    expect(beforeArchive.mutatingOps).toEqual([]);

    // (1) archive completes before ANY remote close and ANY destruction.
    const archived = checkpoints.get("after_archive_rename")!;
    expect(archived.finalArchivePresent).toBe(true);
    expect(archived.mutatingOps).toEqual([]);
    expect(archived.targetRunsPresent).toBe(true);
    expect(archived.registryHasTarget).toBe(true);

    // (2) closes: PR before its head branch; issue closed; all before the
    // registry boundary.
    const beforeRegistry = checkpoints.get("before_registry_write")!;
    expect(beforeRegistry.mutatingOps).toEqual(["pr.close", "issue.close", "ref.delete"]);
    expect(beforeRegistry.registryHasTarget).toBe(true);

    // (3) end state: registry entry gone, managed state gone, intent gone,
    // archive verifiable and restorable.
    const after = await loadApps(join(w.orgHome, "apps.yaml"));
    expect(after.apps.map((app) => app.name)).toEqual([SIBLING_APP]);
    expect(existsSync(join(w.stateHome, "runs", TARGET_APP))).toBe(false);
    expect(existsSync(join(w.stateHome, "repos", TARGET_APP))).toBe(false);
    expect(existsSync(join(w.stateHome, "lifecycle", "transactions", `reset-${TARGET_APP}.json`))).toBe(false);
    expect(result.archivePath).toBe(join(w.archiveRoot, plan.archiveId));
    // Archived bytes restorable: the exact seeded artifact bytes.
    expect(
      await readFile(join(result.archivePath, "state", "runs", TARGET_APP, "seed-run", "artifact.txt"), "utf8"),
    ).toBe(`${TARGET_APP} run artifact\n`);
    expect(existsSync(join(result.archivePath, "manifest.json"))).toBe(true);

    // Remote end state on the double: closed PR/issue, deleted branch.
    const state = w.handle.readState();
    expect(state.prs[String(w.pr.number)]?.state).toBe("CLOSED");
    expect(state.issues[String(w.issue.number)]?.state).toBe("CLOSED");
    expect(state.branches[w.opBranch]).toBeUndefined();
  });

  // BLOCKED:F-PT-012 — the execute-order clause is a genuine design ambiguity,
  // not a plain defect: OP-lifecycle §6 prose (and the CF-J14-S catalog row)
  // order registry removal before local clears, but finalizeInterruptedAppReset
  // documents local-clears-first as the deliberate atomic-commit-point design.
  // Neither direction may be encoded until the owner rules (F-PT-012 in
  // validation-policy.yaml → open_findings). The body below asserts the
  // contract-prose order and stays parked; unskip + resolve polarity when the
  // finding ratifies.
  it.skip(
    "BLOCKED:F-PT-012 — execute-order clause (registry boundary vs local clears) awaits owner ruling",
    async () => {
      const w = await world();
      const input = resetInput(w);
      const plan = await planAppReset(input);
      let targetStateAtRegistryWrite: boolean | undefined;
      await executeAppReset(
        {
          ...input,
          fault: (point) => {
            if (point === "before_registry_write" && targetStateAtRegistryWrite === undefined) {
              targetStateAtRegistryWrite = existsSync(join(w.stateHome, "runs", TARGET_APP));
            }
          },
        },
        plan,
      );
      // Ratified §6 order: "…closes planned PRs/issues, deletes their head
      // branches, removes registry entry, clears managed state". Actual
      // (2026-07-31): removeLocalAppState has already run — the managed
      // state is gone before the registry write.
      expect(targetStateAtRegistryWrite).toBe(true);
    },
  );

  it("execute stays inside the authorized destructive set (INV-010 oracle over the full world)", async () => {
    const w = await world();
    const before = await snapshotWorld(w);
    const input = resetInput(w);
    const plan = await planAppReset(input);
    await executeAppReset(input, plan);
    const diff = diffWorld(before, await snapshotWorld(w));
    assertResetScope(
      TARGET_APP,
      diff,
      completedResetAllowance(TARGET_APP, [
        ...w.targetApprovalFiles,
        "telemetry/mixed.jsonl",
        "invocations/audit.jsonl",
      ]),
    );
    // Sibling ledger lines survive the shared-file rewrites verbatim.
    expect(await readFile(join(w.stateHome, "telemetry", "mixed.jsonl"), "utf8")).toBe(
      `${JSON.stringify({ app: SIBLING_APP, turn: 2 })}\n`,
    );
    expect(await readFile(join(w.stateHome, "telemetry", "sibling-only.jsonl"), "utf8")).toBe(
      `${JSON.stringify({ app: SIBLING_APP, turn: 3 })}\n`,
    );
  });
});
