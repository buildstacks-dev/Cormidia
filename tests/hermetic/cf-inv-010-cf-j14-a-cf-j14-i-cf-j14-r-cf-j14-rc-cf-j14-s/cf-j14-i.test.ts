// Traceability: CF-J14-I · HB-015 · contracts/journey-acceptance.md J-14 interruption criterion.

// CF-J14-I — SIGKILL at each reset step; the durable intent + checksummed
// archive keep the interrupted execution resumable (L2, E1; C-OP-LIFE §6,
// INV-010/013, B-07; case-catalog row CF-J14-I).
//
// Each leg SIGKILLs a REAL subprocess running executeAppReset (product fault
// hook bridged onto kill-point markers; the gh double served to UNMODIFIED
// GhCliOps over PATH — the B-01 process seam). After the kill, the world
// must show exactly the journaled intermediate for that step: intent durable
// from before the archive, archive complete only after its atomic rename, no
// destruction and no registry change before the closes finish, and the
// SIBLING WORLD BIT-IDENTICAL at every interruption point.

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadApps } from "../../../src/org/apps.js";
import { processIsAlive } from "../../../src/org/lifecycle.js";
import { runKillPointScenario } from "../../fixtures/kill-point.js";
import {
  makeResetWorld,
  mutatingOpsSince,
  resetKillEnv,
  RESET_KILL_SCENARIO,
  TARGET_APP,
  SIBLING_APP,
  type ResetWorld,
} from "./support.js";

interface ResetLegExpectation {
  /** Remote mutations (double ops) expected to have happened, in order. */
  mutatingOps: string[];
  /** The final renamed archive exists with a manifest. */
  finalArchive: boolean;
  /** The target app's managed state still exists (destruction not begun). */
  targetStateIntact: boolean;
  /** apps.yaml still registers the target app. */
  registryIntact: boolean;
}

const LEGS: Array<[killAt: string, expectation: ResetLegExpectation]> = [
  ["before_archive_creation", { mutatingOps: [], finalArchive: false, targetStateIntact: true, registryIntact: true }],
  ["before_archive_rename", { mutatingOps: [], finalArchive: false, targetStateIntact: true, registryIntact: true }],
  ["after_archive_rename", { mutatingOps: [], finalArchive: true, targetStateIntact: true, registryIntact: true }],
  [
    "after_pull_request_update",
    { mutatingOps: ["pr.close"], finalArchive: true, targetStateIntact: true, registryIntact: true },
  ],
  [
    "after_issue_update",
    { mutatingOps: ["pr.close", "issue.close"], finalArchive: true, targetStateIntact: true, registryIntact: true },
  ],
  [
    "after_branch_update",
    {
      mutatingOps: ["pr.close", "issue.close", "ref.delete"],
      finalArchive: true,
      targetStateIntact: true,
      registryIntact: true,
    },
  ],
  [
    // The registry write is the commit point; local clears precede it in the
    // current implementation (see the CF-J14-S order tripwire), so at this
    // kill the local state is gone, the registry entry is gone, and only the
    // terminal finalization (episode close + intent removal) is outstanding.
    "after_registry_write",
    {
      mutatingOps: ["pr.close", "issue.close", "ref.delete"],
      finalArchive: true,
      targetStateIntact: false,
      registryIntact: false,
    },
  ],
];

describe("CF-J14-I — kill at each reset step; durable intent + archive keep it resumable (C-OP-LIFE §6)", () => {
  let cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.reverse()) await cleanup();
    cleanups = [];
  });

  it.each(LEGS)("SIGKILL at %s leaves exactly the journaled intermediate", async (killAt, expectation) => {
    const w: ResetWorld = await makeResetWorld();
    cleanups.push(() => w.cleanup());
    const siblingArtifact = join(w.stateHome, "runs", SIBLING_APP, "seed-run", "artifact.txt");
    const siblingBytes = await readFile(siblingArtifact, "utf8");
    const humanBytes = await readFile(join(w.humanCheckout, "README.md"), "utf8");

    const result = await runKillPointScenario({
      source: RESET_KILL_SCENARIO,
      killAt,
      env: resetKillEnv(w),
      timeoutMs: 25_000,
    });
    cleanups.push(() => result.cleanup());
    expect(result.timedOut).toBe(false);
    expect(result.killedAt).toBe(killAt);
    expect(result.markers).not.toContain("done");
    expect(processIsAlive(result.pid)).toBe(false);

    // The durable recovery intent exists at EVERY interruption point — it is
    // written before the archive and removed only at terminal finalization.
    const intentPath = join(w.stateHome, "lifecycle", "transactions", `reset-${TARGET_APP}.json`);
    expect(existsSync(intentPath)).toBe(true);
    const intent = JSON.parse(await readFile(intentPath, "utf8")) as Record<string, unknown>;
    expect(intent["kind"]).toBe("app-reset-intent");
    expect(intent["app"]).toBe(TARGET_APP);

    // Remote mutations: exactly what the step order promises, never more.
    expect(mutatingOpsSince(w)).toEqual(expectation.mutatingOps);

    // Archive: final only after its atomic rename; a `.partial` staging dir
    // is never mistaken for a completed archive.
    const archiveId = String(intent["archive_id"]);
    const finalArchive = join(w.archiveRoot, archiveId, "manifest.json");
    expect(existsSync(finalArchive)).toBe(expectation.finalArchive);

    // Destruction / registry state at this step.
    expect(existsSync(join(w.stateHome, "runs", TARGET_APP, "seed-run", "artifact.txt"))).toBe(
      expectation.targetStateIntact,
    );
    const registry = await loadApps(join(w.orgHome, "apps.yaml"));
    expect(registry.apps.some((app) => app.name === TARGET_APP)).toBe(expectation.registryIntact);

    // The sibling app and the human checkout are bit-identical at every
    // interruption point (INV-010 — destruction stays inside its scope even
    // mid-crash).
    expect(await readFile(siblingArtifact, "utf8")).toBe(siblingBytes);
    expect(existsSync(join(w.stateHome, "repos", SIBLING_APP, "clone-marker.txt"))).toBe(true);
    expect(await readFile(join(w.humanCheckout, "README.md"), "utf8")).toBe(humanBytes);
    expect(registry.apps.some((app) => app.name === SIBLING_APP)).toBe(true);

    // When the archive is complete it already holds the restorable bytes.
    if (expectation.finalArchive) {
      expect(
        await readFile(join(w.archiveRoot, archiveId, "state", "runs", TARGET_APP, "seed-run", "artifact.txt"), "utf8"),
      ).toBe(`${TARGET_APP} run artifact\n`);
    }
  });
});
