import { afterEach, describe, expect, it } from "vitest";
import {
  initializeExecutionJournal,
  readExecutionJournal,
  recordExecutionBoundary,
  resumeExecutionJournal,
  stopExecutionJournal,
} from "../../../src/loop/execution-journal.js";
import {
  deriveEpisodeCounters,
  readExecutionSteps,
  readRouteRecord,
} from "../../../src/loop/efficiency.js";
import { executePipeline } from "../../../src/loop/pipeline.js";
import { readTurnRecords } from "../../../src/runtime/telemetry.js";
import { FakeRuntime } from "../../../src/runtime/testing/fakeRuntime.js";
import type { RoleConfig, TurnResult } from "../../../src/runtime/types.js";
import { writeJournalPatch } from "../../../src/org/journal.js";
import type { TurnLock } from "../../../src/org/locks.js";
import { recoverStaleTurn } from "../../../src/org/recovery.js";
import {
  createControlledWorld,
  FakeClock,
  type ControlledWorld,
} from "../../src/fixtures/controlled-world.js";

let world: ControlledWorld | undefined;

afterEach(async () => {
  await world?.cleanup();
  world = undefined;
});

describe("provider timeout and content-bound recovery", () => {
  it("preserves durable truth and resumes the same session without blind re-admission", async () => {
    world = await createControlledWorld("layer-2-recovery-composition");
    const clock = new FakeClock();
    const episodeId = "episode-recovery-1";
    const turnId = "turn-recovery-1";
    const role: RoleConfig = {
      name: "builder",
      runtime: "pi",
      model: "fixture-model",
      effort: "low",
      delegation: { allow: [] },
      triggers: [],
      outputs: [],
      maxTurnBudgetUsd: 1,
    };
    const timedOut: TurnResult = {
      status: "timed_out",
      summary: "provider timed out after returning a durable session handle",
      artifacts: [],
      session: { runtime: "pi", id: "session-content-bound-1" },
      usage: {
        tokensIn: 100,
        tokensOut: 0,
        costUsd: 0.25,
        subagentTurns: 0,
        wallClockMs: 100,
        quality: "unavailable",
      },
      escalations: [],
      errorCode: "error_adapter_timeout",
    };
    const runtime = new FakeRuntime([{ result: timedOut }], "pi");

    await initializeExecutionJournal({
      root: world.stateRoot,
      episodeId,
      app: "sample-app",
      ticketRef: "ticket:sample-app:#1",
      now: clock.now(),
    });
    await recordExecutionBoundary({
      root: world.stateRoot,
      episodeId,
      boundary: "route",
      artifact: { episodeId, planVersion: 1 },
      now: clock.now(),
    });
    await recordExecutionBoundary({
      root: world.stateRoot,
      episodeId,
      boundary: "contract",
      artifact: { acceptance: ["timeout is not success"] },
      now: clock.now(),
    });

    const result = await executePipeline({
      pipeline: {
        name: "walking",
        mechanical: false,
        passes: [{ id: "provider", role: "builder", template: "walking-skeleton.md" }],
      },
      selection: { tier: "quick" },
      roles: { builder: role },
      runtimeFor: () => runtime,
      briefFor: () => "Exercise a controlled timeout",
      promptsDir: world.promptsDir,
      context: { taste: [], memoryExcerpts: [] },
      workdir: world.workdir,
      hooks: { gate: () => ({ allow: true }) },
      runlog: {
        root: world.stateRoot,
        app: "sample-app",
        ticket: "#1",
        traceId: "trace-recovery",
      },
      runIdForPass: () => "20260101-000000-walking-provider",
      episode: {
        id: episodeId,
        route: "quick",
        policyVersion: "walking-skeleton/v1",
      },
      telemetry: { orgDir: world.orgRoot },
      clock: clock.now,
    });

    expect(result.aborted).toBe(true);
    expect(result.passes).toHaveLength(1);
    expect(runtime.calls).toHaveLength(1);

    const stepsBeforeRecovery = await readExecutionSteps(world.stateRoot, episodeId);
    const routeBeforeRecovery = await readRouteRecord(world.stateRoot, episodeId);
    const countersBeforeRecovery = await deriveEpisodeCounters(world.stateRoot, episodeId);
    const ledgerBeforeRecovery = await readTurnRecords(world.orgRoot);
    expect(stepsBeforeRecovery).toHaveLength(1);
    expect(stepsBeforeRecovery[0]).toMatchObject({
      kind: "provider",
      status: "timed_out",
      usage: { quality: "unavailable", costUsd: 0.25 },
    });
    expect(routeBeforeRecovery.terminal?.status).toBe("timed_out");
    expect(countersBeforeRecovery).toMatchObject({
      provider_turns: 1,
      equivalent_cost_usd: 0.25,
    });
    expect(countersBeforeRecovery.partial_or_unavailable_steps).toHaveLength(1);
    expect(ledgerBeforeRecovery).toHaveLength(1);
    expect(ledgerBeforeRecovery[0]).toMatchObject({
      providerTurnId: stepsBeforeRecovery[0]?.provider_turn_id,
      usageQuality: "unavailable",
      unmeasured: true,
    });

    await stopExecutionJournal({
      root: world.stateRoot,
      episodeId,
      kind: "provider_timeout",
      reason: timedOut.summary,
      now: clock.now(),
    });
    const journal = await writeJournalPatch(
      world.orgRoot,
      turnId,
      {
        role: role.name,
        app: "sample-app",
        phase: "running",
        attempt: 0,
        session: timedOut.session,
        worktree: world.workdir,
      },
      clock.now(),
    );
    const lock: TurnLock = {
      app: "sample-app",
      role: role.name,
      pid: 4242,
      turnId,
      startedAt: clock.now().toISOString(),
      heartbeatAt: clock.now().toISOString(),
    };
    const spawnCalls: Array<{ sessionId: string | undefined; action: string }> = [];
    const recovery = await recoverStaleTurn(world.orgRoot, lock, journal, {
      now: clock.now(),
      spawn: async ({ journal: recoveredJournal, decision }) => {
        spawnCalls.push({
          sessionId: recoveredJournal.session?.id,
          action: decision.action,
        });
      },
    });

    expect(recovery.decision.action).toBe("resume");
    expect(spawnCalls).toEqual([
      { sessionId: "session-content-bound-1", action: "resume" },
    ]);
    expect(runtime.calls).toHaveLength(1);
    expect(await readExecutionSteps(world.stateRoot, episodeId)).toEqual(stepsBeforeRecovery);
    expect(await readTurnRecords(world.orgRoot)).toEqual(ledgerBeforeRecovery);

    const resume = await resumeExecutionJournal({
      root: world.stateRoot,
      episodeId,
      artifacts: {
        route: { episodeId, planVersion: 1 },
        contract: { acceptance: ["timeout is not success"] },
      },
      now: clock.now(),
    });
    expect(resume).toMatchObject({
      nextBoundary: "implementation",
      reused: ["route", "contract"],
      invalidations: [],
    });
    expect((await readExecutionJournal(world.stateRoot, episodeId))?.status).toBe("stopped");
  });
});
