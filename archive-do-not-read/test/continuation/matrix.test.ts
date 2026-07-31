import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  EXECUTION_BOUNDARIES,
  initializeExecutionJournal,
  readExecutionJournal,
  recordExecutionBoundary,
  resumeExecutionJournal,
  stopExecutionJournal,
} from "../../src/loop/execution-journal.js";
import {
  admitEpisode,
  readRouteRecord,
  remainingExecutionAllowance,
} from "../../src/loop/efficiency.js";
import { executionBoundsFor } from "../../src/loop/route-policy.js";

const NOW = new Date("2026-07-14T00:00:00Z");

function root(): string {
  return mkdtempSync(join(tmpdir(), "operon-continuation-"));
}

async function initialized(state: string, episodeId = "episode"): Promise<void> {
  await initializeExecutionJournal({ root: state, episodeId, app: "app", ticketRef: "#1", now: NOW });
}

function artifact(boundary: string): unknown {
  return { boundary, identity: `${boundary}-v1` };
}

describe("Phase 3 execution continuation", () => {
  it("F-CONT-01 interrupts and resumes after every legal durable boundary", async () => {
    for (let stopAfter = 0; stopAfter < EXECUTION_BOUNDARIES.length; stopAfter++) {
      const state = root();
      await initialized(state);
      for (const boundary of EXECUTION_BOUNDARIES.slice(0, stopAfter + 1)) {
        await recordExecutionBoundary({ root: state, episodeId: "episode", boundary, artifact: artifact(boundary), now: NOW });
      }
      await stopExecutionJournal({ root: state, episodeId: "episode", kind: "crash", reason: `injected after ${EXECUTION_BOUNDARIES[stopAfter]}`, now: NOW });
      const resumed = await resumeExecutionJournal({ root: state, episodeId: "episode", now: NOW });
      expect(resumed.nextBoundary).toBe(EXECUTION_BOUNDARIES[stopAfter + 1] ?? null);
      expect(resumed.reused).toEqual(EXECUTION_BOUNDARIES.slice(0, stopAfter + 1));
    }
  });

  it("F-CONT-02 reuses every valid productive stage and runs only the next boundary", async () => {
    const state = root();
    await initialized(state);
    for (const boundary of EXECUTION_BOUNDARIES.slice(0, 6)) {
      await recordExecutionBoundary({ root: state, episodeId: "episode", boundary, artifact: artifact(boundary), now: NOW });
    }
    const decision = await resumeExecutionJournal({
      root: state,
      episodeId: "episode",
      artifacts: Object.fromEntries(EXECUTION_BOUNDARIES.slice(0, 6).map((boundary) => [boundary, artifact(boundary)])),
      now: NOW,
    });
    expect(decision.nextBoundary).toBe("findings");
    expect(decision.reused).toEqual(EXECUTION_BOUNDARIES.slice(0, 6));
    expect(decision.invalidations).toEqual([]);
  });

  it("F-CONT-03 ticket, commit, and finding changes invalidate only the necessary suffix with a reason", async () => {
    for (const boundary of ["contract", "implementation", "findings"] as const) {
      const state = root();
      await initialized(state);
      for (const stage of EXECUTION_BOUNDARIES) {
        await recordExecutionBoundary({ root: state, episodeId: "episode", boundary: stage, artifact: artifact(stage), now: NOW });
      }
      const decision = await resumeExecutionJournal({
        root: state,
        episodeId: "episode",
        artifacts: { [boundary]: { boundary, identity: `${boundary}-changed` } },
        now: new Date("2026-07-14T00:01:00Z"),
      });
      expect(decision.nextBoundary).toBe(boundary);
      expect(decision.invalidations[0]?.reason).toContain(`${boundary} artifact changed`);
      const journal = await readExecutionJournal(state, "episode");
      expect(journal?.stages.filter((stage) => stage.status === "invalidated").map((stage) => stage.boundary)).toEqual(
        EXECUTION_BOUNDARIES.slice(EXECUTION_BOUNDARIES.indexOf(boundary)),
      );
    }
  });

  it("F-CONT-04 cap, cancellation, crash, and timeout preserve durable refs and executable next step", async () => {
    for (const kind of ["cap_stop", "cancelled", "crash", "provider_timeout"] as const) {
      const state = root();
      await initialized(state);
      for (const boundary of ["route", "contract", "implementation"] as const) {
        await recordExecutionBoundary({ root: state, episodeId: "episode", boundary, artifact: artifact(boundary), now: NOW });
      }
      const stopped = await stopExecutionJournal({ root: state, episodeId: "episode", kind, reason: `${kind} injected`, now: NOW });
      expect(stopped.stop).toMatchObject({ kind, next_boundary: "push" });
      expect(stopped.stop?.durable_artifacts).toHaveLength(3);
      expect((await resumeExecutionJournal({ root: state, episodeId: "episode", now: NOW })).nextBoundary).toBe("push");
    }
  });

  it("F-BOUND-01 persists route-wide retry/tool/claim/repair/review/wall-time bounds", async () => {
    const state = root();
    await admitEpisode({
      root: state,
      episodeId: "bounded",
      app: "app",
      route: "quick",
      policyVersion: "test",
      factors: [{ kind: "uncertainty", evidence: "bounded fixture", policy_rule: "fixture" }],
      passes: [],
      now: NOW,
    });
    expect((await readRouteRecord(state, "bounded")).execution_bounds).toEqual(executionBoundsFor("quick"));
    expect(await remainingExecutionAllowance(state, "bounded")).toMatchObject({
      providerTurns: 3,
      toolCalls: 40,
      activeTimeMs: 20 * 60_000,
    });
    expect(executionBoundsFor("standard")).toMatchObject({ environmentRetries: 1, claimAttempts: 3, repairAttempts: 2, reviewCycles: 2 });
    expect(executionBoundsFor("deep")).toMatchObject({ environmentRetries: 2, toolCalls: 200, repairAttempts: 3, reviewCycles: 3 });
  });
});
