import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  beginProviderStep,
  executionStepPath,
  finalizeProviderStep,
  readExecutionSteps,
  readPendingProviderSteps,
  readRouteRecord,
  type ProviderStepPlanMetadata,
  type ProviderStepSettlementAttribution,
  type StartedProviderStep,
} from "../src/loop/efficiency.js";
import { readEpisodePlanExecutionJournal } from "../src/loop/episode-plan-executor.js";
import { readEpisodeReplanJournal } from "../src/loop/episode-replan.js";
import {
  deriveEpisodeSafetyRoute,
  readCurrentEpisodePlan,
  type MechanicalGateStep,
  CreatorEpisodeScope,
  type EpisodeIntent,
  type EpisodePlan,
  type ProviderTurnStep,
} from "../src/loop/episode-plan.js";
import { routeAdmissionForEpisodePlan } from "../src/loop/episode-route.js";
import { admitPlannedEpisodeRoute } from "../src/loop/planner-admission.js";
import { prepareEpisodePlan } from "../src/org/episode-planner/coordinator.js";
import {
  EpisodeProviderReconciliationRequiredError,
  executeAcceptedEpisodePlan,
} from "../src/org/episode-planner/execution.js";
import {
  buildEpisodeIntent,
  createEpisodePlanningPolicy,
} from "../src/org/episode-planner/policy.js";
import { turnRecordFromExecutionStep } from "../src/org/budget.js";
import type { AppEntry } from "../src/org/apps.js";
import {
  finalizeRun,
  readEnvelope,
  startRun,
  updateEnvelope,
} from "../src/runtime/runlog/envelope.js";
import { runDir, sanitizeIdPart } from "../src/runtime/runlog/paths.js";
import {
  readTurnRecords,
  recordTurn,
  recordTurnOnce,
  settlementKey,
  type TurnRecord,
} from "../src/runtime/telemetry.js";
import { FakeRuntime } from "../src/runtime/testing/fakeRuntime.js";
import type {
  RoleConfig,
  TurnAssignment,
  TurnResult,
} from "../src/runtime/types.js";
import { makeOrgHome, type OrgHomeFixture } from "./fixtures/orgHome.js";

const CREATED_AT = "2026-07-19T20:00:00.000Z";
const EXECUTION_NOW = new Date("2026-07-19T20:10:00.000Z");
const ASSIGNMENT: TurnAssignment = {
  harness: "codex",
  model: "gpt-5.6-sol",
  effort: "high",
};

describe("accepted EpisodePlan provider identity and reconciliation", () => {
  let home: OrgHomeFixture;
  afterEach(() => home?.cleanup());

  it("keeps exact episode identities distinct when sanitized ids, step ids, and timestamps match", async () => {
    home = makeOrgHome();
    const firstEpisodeId = "ticket:fixture:collision/a";
    const secondEpisodeId = "ticket:fixture:collision?a";
    expect(sanitizeIdPart(firstEpisodeId)).toBe(sanitizeIdPart(secondEpisodeId));

    const first = await acceptedEpisode(home.root, firstEpisodeId);
    const second = await acceptedEpisode(home.root, secondEpisodeId);
    expect(first.plan.createdAt).toBe(second.plan.createdAt);
    expect(first.step.id).toBe(second.step.id);

    const runtime = new FakeRuntime([
      { result: completedResult("first exact episode completed") },
      { result: completedResult("second exact episode completed") },
    ], "codex");
    const runtimeForAssignment = vi.fn(() => runtime);

    await executeAcceptedEpisodePlan(executionOptions(
      home.root,
      first,
      runtimeForAssignment,
      sameSecondClock("2026-07-19T20:10:00.100Z"),
    ));
    await executeAcceptedEpisodePlan(executionOptions(
      home.root,
      second,
      runtimeForAssignment,
      sameSecondClock("2026-07-19T20:10:00.100Z"),
    ));

    expect(runtime.calls).toHaveLength(2);
    const firstStep = onlyProviderEvidence(await readExecutionSteps(home.root, firstEpisodeId));
    const secondStep = onlyProviderEvidence(await readExecutionSteps(home.root, secondEpisodeId));
    expect(firstStep.run_id).not.toBe(secondStep.run_id);
    expect(new Set([firstStep.run_id, secondStep.run_id]).size).toBe(2);
    expect(existsSync(runDir(home.root, "fixture", firstStep.run_id))).toBe(true);
    expect(existsSync(runDir(home.root, "fixture", secondStep.run_id))).toBe(true);

    const firstEnvelope = await readEnvelope(home.root, "fixture", firstStep.run_id);
    const secondEnvelope = await readEnvelope(home.root, "fixture", secondStep.run_id);
    expect(firstEnvelope).toMatchObject({
      episode_id: firstEpisodeId,
      plan_version: 1,
      plan_step_id: "build",
      assignment_source: "configured",
      runtime: ASSIGNMENT.harness,
      model: ASSIGNMENT.model,
      effort: ASSIGNMENT.effort,
    });
    expect(secondEnvelope).toMatchObject({
      episode_id: secondEpisodeId,
      plan_version: 1,
      plan_step_id: "build",
      assignment_source: "configured",
      runtime: ASSIGNMENT.harness,
      model: ASSIGNMENT.model,
      effort: ASSIGNMENT.effort,
    });
    expect(firstStep).toMatchObject({
      episode_id: firstEpisodeId,
      plan_version: 1,
      plan_step_id: "build",
      assignment_source: "configured",
    });
    expect(secondStep).toMatchObject({
      episode_id: secondEpisodeId,
      plan_version: 1,
      plan_step_id: "build",
      assignment_source: "configured",
    });
    const ledger = await readTurnRecords(home.root);
    expect(ledger).toHaveLength(2);
    expect(new Set(ledger.map((turn) => turn.runId)).size).toBe(2);
  });

  it("requires typed reconciliation for a fresh receipt without rerunning it or touching another episode", async () => {
    home = makeOrgHome();
    const target = await acceptedEpisode(home.root, "ticket:fixture:fresh-reservation", true);
    const unrelated = await acceptedEpisode(home.root, "ticket:fixture:unrelated-fresh", true);
    const fresh = await seedStartedReceipt(
      home.root,
      target,
      new Date(EXECUTION_NOW.getTime() - 30_000),
      "fresh-target-run",
    );
    const unrelatedStarted = await seedStartedReceipt(
      home.root,
      unrelated,
      new Date(EXECUTION_NOW.getTime() - 10 * 60_000),
      "unrelated-stale-run",
    );
    const unrelatedPath = `${executionStepPath(
      home.root,
      unrelated.intent.episodeId,
      unrelatedStarted.executionStepId,
    )}.started`;
    const unrelatedBefore = await readFile(unrelatedPath, "utf8");
    const runtime = new FakeRuntime([{ result: completedResult("must not run") }], "codex");
    const runtimeForAssignment = vi.fn(() => runtime);

    let caught: unknown;
    try {
      await executeAcceptedEpisodePlan(executionOptions(
        home.root,
        target,
        runtimeForAssignment,
        () => new Date(EXECUTION_NOW),
      ));
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(EpisodeProviderReconciliationRequiredError);
    expect(caught).toMatchObject({
      code: "error_episode_provider_reconciliation_required",
      episodeId: target.intent.episodeId,
      executionStepIds: [fresh.executionStepId],
    });
    expect(runtimeForAssignment).not.toHaveBeenCalled();
    expect(runtime.calls).toHaveLength(0);
    expect(await readPendingProviderSteps(home.root, target.intent.episodeId)).toEqual([
      expect.objectContaining({ execution_step_id: fresh.executionStepId }),
    ]);
    expect(await readEpisodePlanExecutionJournal(home.root, target.intent.episodeId)).toBeUndefined();
    expect(await readFile(unrelatedPath, "utf8")).toBe(unrelatedBefore);
    expect(await readExecutionSteps(home.root, unrelated.intent.episodeId)).toEqual([]);
  });

  it("terminalizes only the stale episode receipt and records a failed outer DAG step without a rerun", async () => {
    home = makeOrgHome();
    const target = await acceptedEpisode(home.root, "ticket:fixture:stale-reservation", true);
    const unrelated = await acceptedEpisode(home.root, "ticket:fixture:unrelated-stale", true);
    const stale = await seedStartedReceipt(
      home.root,
      target,
      new Date(EXECUTION_NOW.getTime() - 5 * 60_000),
      "stale-target-run",
      true,
    );
    const unrelatedStarted = await seedStartedReceipt(
      home.root,
      unrelated,
      new Date(EXECUTION_NOW.getTime() - 10 * 60_000),
      "unrelated-stale-run",
    );
    const unrelatedPath = `${executionStepPath(
      home.root,
      unrelated.intent.episodeId,
      unrelatedStarted.executionStepId,
    )}.started`;
    const unrelatedBefore = await readFile(unrelatedPath, "utf8");
    const runtime = new FakeRuntime([{ result: completedResult("must not run") }], "codex");
    const runtimeForAssignment = vi.fn(() => runtime);

    const result = await executeAcceptedEpisodePlan(executionOptions(
      home.root,
      target,
      runtimeForAssignment,
      () => new Date(EXECUTION_NOW),
    ));

    expect(result).toMatchObject({
      status: "failed",
      nextStepId: "build",
      lastStepId: "build",
      reasonCode: "error_stale_missing_finalization",
    });
    expect(runtimeForAssignment).not.toHaveBeenCalled();
    expect(runtime.calls).toHaveLength(0);
    expect(await readPendingProviderSteps(home.root, target.intent.episodeId)).toEqual([]);
    expect(onlyProviderEvidence(await readExecutionSteps(home.root, target.intent.episodeId)))
      .toMatchObject({
        execution_step_id: stale.executionStepId,
        status: "interrupted",
        error_code: "error_stale_missing_finalization",
        plan_version: 1,
        plan_step_id: "build",
        assignment_source: "configured",
        runtime: ASSIGNMENT.harness,
        model: ASSIGNMENT.model,
        effort: ASSIGNMENT.effort,
      });
    expect(await readEpisodePlanExecutionJournal(home.root, target.intent.episodeId))
      .toMatchObject({
        status: "failed",
        blocked_step_id: "build",
        events: [
          expect.objectContaining({ kind: "plan_adopted", plan_version: 1 }),
          expect.objectContaining({ kind: "step_started", step_id: "build", plan_version: 1 }),
          expect.objectContaining({
            kind: "step_failed",
            step_id: "build",
            reason_code: "error_stale_missing_finalization",
          }),
        ],
      });
    expect(await readFile(unrelatedPath, "utf8")).toBe(unrelatedBefore);
    expect(await readPendingProviderSteps(home.root, unrelated.intent.episodeId)).toEqual([
      expect.objectContaining({ execution_step_id: unrelatedStarted.executionStepId }),
    ]);
    expect(await readExecutionSteps(home.root, unrelated.intent.episodeId)).toEqual([]);
  });

  it("repairs a crash after terminal provider evidence without rerunning or double-settling", async () => {
    home = makeOrgHome();
    const target = await acceptedEpisode(home.root, "ticket:fixture:terminal-tail", true);
    const startedAt = new Date(EXECUTION_NOW.getTime() - 1_000);
    const started = await seedStartedReceipt(
      home.root,
      target,
      startedAt,
      "terminal-tail-run",
      false,
      {
        experiment_ref: "exp_terminal_tail",
        candidate_ref: "cand_terminal_tail",
        learning_activity: "review",
      },
    );
    const role = target.roles.find((candidate) => candidate.name === target.step.role)!;
    await startRun(home.root, {
      runId: "terminal-tail-run",
      traceId: "terminal-tail-trace",
      parentTaskId: "parent-terminal-tail",
      episodeId: target.intent.episodeId,
      planVersion: target.plan.version,
      planStepId: target.step.id,
      app: target.intent.app,
      pipeline: "episode-plan-dag",
      pass: target.step.id,
      role: target.step.role,
      runtime: target.step.assignment.harness,
      model: target.step.assignment.model,
      effort: target.step.assignment.effort,
      assignmentSource: target.step.assignmentSource,
      selectionReason: target.step.selectionReason,
      providerTurnIds: [started.providerTurnId],
      executionStepIds: [started.executionStepId],
    }, startedAt);
    const providerResult = completedResult("durable provider result");
    const terminal = await finalizeProviderStep({
      root: home.root,
      episodeId: target.intent.episodeId,
      app: target.intent.app,
      runId: "terminal-tail-run",
      started,
      operation: target.step.operation,
      role,
      assignment: target.step.assignment,
      ...(started.planMetadata === undefined ? {} : { planMetadata: started.planMetadata }),
      result: providerResult,
      finishedAt: new Date(startedAt.getTime() + 500),
      contextManifestRef: "context-manifest.json",
    });
    expect(terminal).toMatchObject({
      experiment_ref: "exp_terminal_tail",
      candidate_ref: "cand_terminal_tail",
      learning_activity: "review",
    });
    expect(existsSync(runDir(home.root, target.intent.app, "terminal-tail-run") + "/output.md"))
      .toBe(false);
    expect(await readTurnRecords(home.root)).toEqual([]);

    const runtime = new FakeRuntime([{ result: completedResult("must not rerun") }], "codex");
    const runtimeForAssignment = vi.fn(() => runtime);
    const first = await executeAcceptedEpisodePlan(executionOptions(
      home.root,
      target,
      runtimeForAssignment,
      () => new Date(EXECUTION_NOW),
    ));
    const second = await executeAcceptedEpisodePlan(executionOptions(
      home.root,
      target,
      runtimeForAssignment,
      () => new Date(EXECUTION_NOW.getTime() + 1_000),
    ));

    expect(first.status).toBe("completed");
    expect(second.status).toBe("completed");
    expect(runtimeForAssignment).not.toHaveBeenCalled();
    expect(runtime.calls).toHaveLength(0);
    expect(await readFile(
      runDir(home.root, target.intent.app, "terminal-tail-run") + "/output.md",
      "utf8",
    )).toBe("durable provider result");
    expect(await readEnvelope(home.root, target.intent.app, "terminal-tail-run"))
      .toMatchObject({
        status: "completed",
        usage: { tokens_in: 100, tokens_out: 25, cost_usd: 0.25 },
        verdict_summary: "durable provider result",
        execution_step_ids: [started.executionStepId],
      });
    expect(await readTurnRecords(home.root)).toEqual([
      expect.objectContaining({
        providerTurnId: started.providerTurnId,
        executionStepId: started.executionStepId,
        planVersion: 1,
        planStepId: "build",
        assignmentSource: "configured",
        effort: "high",
        experimentRef: "exp_terminal_tail",
        candidateRef: "cand_terminal_tail",
        learningActivity: "review",
        traceId: "terminal-tail-trace",
        parentTaskId: "parent-terminal-tail",
      }),
    ]);
  });

  it("repairs a ledger-first sidecar crash while resuming terminal plan evidence exactly once", async () => {
    home = makeOrgHome();
    const target = await acceptedEpisode(home.root, "ticket:fixture:settlement-index-tail", true);
    const startedAt = new Date(EXECUTION_NOW.getTime() - 1_000);
    const started = await seedStartedReceipt(
      home.root,
      target,
      startedAt,
      "settlement-index-tail-run",
    );
    const role = target.roles.find((candidate) => candidate.name === target.step.role)!;
    const terminal = await finalizeProviderStep({
      root: home.root,
      episodeId: target.intent.episodeId,
      app: target.intent.app,
      runId: "settlement-index-tail-run",
      started,
      operation: target.step.operation,
      role,
      assignment: target.step.assignment,
      ...(started.planMetadata === undefined ? {} : { planMetadata: started.planMetadata }),
      result: completedResult("ledger durable before sidecar"),
      finishedAt: new Date(startedAt.getTime() + 500),
      contextManifestRef: "context-manifest.json",
    });

    // Establish an existing sidecar, then persist the exact interrupted
    // transaction state: intent journal + authoritative ledger row, with the
    // target key absent from the derived index.
    const sentinel = settlementFixture("sentinel-turn", "sentinel-step");
    expect(await recordTurnOnce(home.root, sentinel)).toBe(true);
    const settlement = turnRecordFromExecutionStep(terminal);
    const targetKey = settlementKey(settlement.app, settlement.providerTurnId!);
    await writeFile(
      join(home.root, "telemetry-index", "pending-settlement.json"),
      `${JSON.stringify({
        schema_version: 1,
        key: targetKey,
        ledger_day: settlement.at.slice(0, 10),
      })}\n`,
      "utf8",
    );
    await recordTurn(home.root, settlement);
    expect((await readFile(
      join(home.root, "telemetry-index", "settled.keys"),
      "utf8",
    )).split("\n")).not.toContain(targetKey);

    const runtime = new FakeRuntime([{ result: completedResult("must not rerun") }], "codex");
    const runtimeForAssignment = vi.fn(() => runtime);
    const resumed = await executeAcceptedEpisodePlan(executionOptions(
      home.root,
      target,
      runtimeForAssignment,
      () => new Date(EXECUTION_NOW),
    ));

    expect(resumed.status).toBe("completed");
    expect(runtimeForAssignment).not.toHaveBeenCalled();
    expect(runtime.calls).toHaveLength(0);
    const rows = await readTurnRecords(home.root);
    expect(rows.filter((row) => row.providerTurnId === started.providerTurnId)).toHaveLength(1);
    const indexKeys = (await readFile(
      join(home.root, "telemetry-index", "settled.keys"),
      "utf8",
    )).split("\n").filter(Boolean);
    expect(indexKeys.filter((key) => key === targetKey)).toHaveLength(1);
    expect(existsSync(join(home.root, "telemetry-index", "pending-settlement.json"))).toBe(false);
  });

  it("turns an ordinary provider failure into one bounded typed replan request", async () => {
    home = makeOrgHome();
    const target = await acceptedEpisode(home.root, "ticket:fixture:runtime-failure");
    const runtime = new FakeRuntime([{
      result: {
        ...completedResult("selected runtime became unavailable"),
        status: "failed",
        errorCode: "error_runtime_failed",
        artifacts: [],
      },
    }], "codex");
    const runtimeForAssignment = vi.fn(() => runtime);

    const first = await executeAcceptedEpisodePlan(executionOptions(
      home.root,
      target,
      runtimeForAssignment,
      sameSecondClock("2026-07-19T20:12:00.000Z"),
    ));
    const second = await executeAcceptedEpisodePlan(executionOptions(
      home.root,
      target,
      runtimeForAssignment,
      sameSecondClock("2026-07-19T20:13:00.000Z"),
    ));

    expect(first).toMatchObject({
      status: "failed",
      nextStepId: "build",
      reasonCode: "error_runtime_failed",
      replan: {
        kind: "failed_assumption",
        status: "pending",
        revisionVersion: null,
      },
    });
    expect(second).toMatchObject({
      status: "failed",
      nextStepId: "build",
      reasonCode: "error_runtime_failed",
    });
    expect(runtime.calls).toHaveLength(1);
    expect(runtimeForAssignment).toHaveBeenCalledTimes(1);
    expect(await readEpisodeReplanJournal(home.root, target.intent.episodeId))
      .toMatchObject({
        maxRevisions: 2,
        records: [{
          status: "pending",
          trigger: {
            kind: "failed_assumption",
            planVersion: 1,
            affectedStepIds: ["build"],
          },
        }],
      });
  });

  it("terminalizes a pre-provider handler throw and opens the typed replan path", async () => {
    home = makeOrgHome();
    const target = await acceptedEpisode(home.root, "ticket:fixture:handler-before-provider");
    const runtime = new FakeRuntime([{ result: completedResult("must not run") }], "codex");
    const runtimeForAssignment = vi.fn(() => runtime);
    const handlerError = Object.assign(
      new Error("provider context could not be assembled"),
      { code: "plan_provider_context_unavailable" },
    );

    const execution = await executeAcceptedEpisodePlan({
      ...executionOptions(
        home.root,
        target,
        runtimeForAssignment,
        sameSecondClock("2026-07-19T20:14:00.000Z"),
      ),
      provider: async () => {
        throw handlerError;
      },
    });

    expect(execution).toMatchObject({
      status: "failed",
      nextStepId: "build",
      reasonCode: "plan_provider_context_unavailable",
      summary: "provider context could not be assembled",
    });
    expect(runtimeForAssignment).not.toHaveBeenCalled();
    expect(runtime.calls).toHaveLength(0);
    expect(await readExecutionSteps(home.root, target.intent.episodeId)).toEqual([]);
    expect(await readEpisodePlanExecutionJournal(home.root, target.intent.episodeId))
      .toMatchObject({
        status: "failed",
        blocked_step_id: "build",
        events: [
          { kind: "plan_adopted" },
          { kind: "step_started", step_id: "build" },
          {
            kind: "step_failed",
            step_id: "build",
            reason_code: "plan_provider_context_unavailable",
          },
        ],
      });
    expect(await readEpisodeReplanJournal(home.root, target.intent.episodeId))
      .toMatchObject({
        records: [{
          status: "pending",
          trigger: {
            kind: "failed_assumption",
            affectedStepIds: ["build"],
          },
        }],
      });
  });

  it("publishes and adopts an actual future-only revision from the bounded coordinator", async () => {
    home = makeOrgHome();
    const target = await acceptedEpisode(home.root, "ticket:fixture:coordinated-revision");
    const runtime = new FakeRuntime([{
      result: {
        ...completedResult("focused verification exposed a missing diagnostic"),
        status: "failed",
        errorCode: "ticket_quality_gate_failed",
        artifacts: [],
      },
    }], "codex");
    const runtimeForAssignment = vi.fn(() => runtime);
    const proposeRevision = vi.fn(async ({
      intent,
      previousPlan,
    }: {
      intent: EpisodeIntent;
      previousPlan: EpisodePlan;
    }) => {
      const build = structuredClone(previousPlan.steps[0]!);
      if (build.kind !== "provider_turn") throw new Error("fixture build step changed");
      const diagnose: MechanicalGateStep = {
        kind: "mechanical_gate",
        id: "diagnose-failure",
        objective: "Capture the focused failure before corrective implementation",
        dependsOn: [],
        gate: "focused-diagnostic",
        inputRefs: [{ ref: "plan-execution:build", required: true }],
        expectedOutputs: [{ id: "failure-diagnosis", kind: "evidence", required: true }],
      };
      build.objective = "Implement the bounded fix using the captured diagnosis";
      build.dependsOn = [diagnose.id];
      build.inputRefs = [
        ...build.inputRefs,
        { ref: "plan-output:failure-diagnosis", required: true },
      ];
      const plan: EpisodePlan = {
        ...structuredClone(previousPlan),
        version: previousPlan.version + 1,
        summary: "Diagnose the failed gate, then implement the bounded correction",
        steps: [diagnose, build],
        derivedSafetyRoute: deriveEpisodeSafetyRoute(
          [diagnose, build],
          intent.requiredSafetyFacts,
        ),
        createdAt: "2026-07-19T20:12:01.000Z",
      };
      return {
        plan,
        policy: createEpisodePlanningPolicy(fixtureApp(), {
          intent,
          roles: target.roles,
        }).validation,
      };
    });

    const result = await executeAcceptedEpisodePlan({
      ...executionOptions(
        home.root,
        target,
        runtimeForAssignment,
        sameSecondClock("2026-07-19T20:12:00.000Z"),
      ),
      proposeRevision,
    });

    expect(result).toMatchObject({
      status: "running",
      planVersion: 2,
      nextStepId: "diagnose-failure",
      replan: {
        kind: "failed_gate",
        status: "accepted",
        revisionVersion: 2,
      },
    });
    expect(proposeRevision).toHaveBeenCalledOnce();
    expect(runtime.calls).toHaveLength(1);
    expect(runtimeForAssignment).toHaveBeenCalledTimes(1);
    expect(await readCurrentEpisodePlan(home.root, target.intent.episodeId))
      .toMatchObject({ version: 2, intentHash: target.plan.intentHash });
    expect(await readEpisodePlanExecutionJournal(home.root, target.intent.episodeId))
      .toMatchObject({ status: "running", current_plan_version: 2 });
    expect(await readEpisodeReplanJournal(home.root, target.intent.episodeId))
      .toMatchObject({
        records: [{ status: "accepted", revisionVersion: 2 }],
      });
  });
});

interface AcceptedEpisodeFixture {
  intent: EpisodeIntent;
  plan: EpisodePlan;
  step: ProviderTurnStep;
  roles: RoleConfig[];
}

async function acceptedEpisode(
  root: string,
  episodeId: string,
  admitRoute = false,
): Promise<AcceptedEpisodeFixture> {
  const app = fixtureApp();
  const roles = fixtureRoles();
  const intent = buildEpisodeIntent({
    episodeId,
    app,
    roles,
    trigger: { kind: "ticket", sourceRef: `github:${episodeId}` },
    goal: "Implement the bounded parser fix",
    lifecycle: "existing-ticket",
    appStage: "growth",
    repositoryFacts: { revision: "abc123" },
    requestedConstraints: { network: false },
    hardBudget: {
      maxProviderTurns: 2,
      maxEquivalentCostUsd: 5,
      maxActiveTimeMs: 20 * 60_000,
    },
    requiredSafetyFacts: [],
    creatorScope: creatorScope(episodeId),
  });
  const prepared = await prepareEpisodePlan({
    root,
    app,
    roles,
    intent,
    now: () => new Date(CREATED_AT),
  });
  const step = prepared.plan.steps.find(
    (candidate): candidate is ProviderTurnStep => candidate.kind === "provider_turn",
  );
  if (step === undefined) throw new Error("fixture plan has no provider step");
  const fixture = { intent, plan: prepared.plan, step, roles };
  if (admitRoute) {
    await admitPlannedEpisodeRoute(routeAdmissionForEpisodePlan({
      root,
      intent,
      plan: prepared.plan,
      now: new Date(CREATED_AT),
    }));
  }
  return fixture;
}

async function seedStartedReceipt(
  root: string,
  fixture: AcceptedEpisodeFixture,
  startedAt: Date,
  runId: string,
  withRecoverableEnvelope = false,
  settlementAttribution?: ProviderStepSettlementAttribution,
): Promise<StartedProviderStep> {
  const role = fixture.roles.find((candidate) => candidate.name === fixture.step.role);
  if (role === undefined) throw new Error("fixture role is unavailable");
  const route = await readRouteRecord(root, fixture.intent.episodeId);
  const authorization = route.authorized_passes.find(
    (candidate) => candidate.plan_step_id === fixture.step.id,
  );
  if (authorization === undefined) throw new Error("fixture route authorization is unavailable");
  const planMetadata: ProviderStepPlanMetadata = {
    ...(authorization.assignment_source === undefined
      ? {}
      : { assignment_source: authorization.assignment_source }),
    ...(authorization.assignment_candidate_id === undefined
      ? {}
      : { assignment_candidate_id: authorization.assignment_candidate_id }),
    ...(authorization.plan_version === undefined
      ? {}
      : { plan_version: authorization.plan_version }),
    ...(authorization.plan_step_id === undefined
      ? {}
      : { plan_step_id: authorization.plan_step_id }),
    ...(authorization.selection_reason === undefined
      ? {}
      : { selection_reason: authorization.selection_reason }),
    ...(authorization.provider_family === undefined
      ? {}
      : { provider_family: authorization.provider_family }),
    ...(authorization.resolved_capabilities === undefined
      ? {}
      : { resolved_capabilities: [...authorization.resolved_capabilities] }),
  };
  const started = await beginProviderStep({
    root,
    episodeId: fixture.intent.episodeId,
    app: fixture.intent.app,
    runId,
    ordinal: 1,
    operation: fixture.step.operation,
    role,
    assignment: fixture.step.assignment,
    planMetadata,
    ...(settlementAttribution === undefined ? {} : { settlementAttribution }),
    inputFingerprint: `input:${fixture.intent.episodeId}`,
    now: startedAt,
    next: { costUsd: fixture.step.maxTurnBudgetUsd },
  });
  if (withRecoverableEnvelope) {
    const usage = {
      tokens_in: 20,
      tokens_out: 5,
      cost_usd: 0.25,
      subagent_turns: 0,
      quality: "complete" as const,
    };
    await startRun(root, {
      runId,
      traceId: `${fixture.intent.episodeId}:orphaned-provider`,
      episodeId: fixture.intent.episodeId,
      planVersion: fixture.plan.version,
      planStepId: fixture.step.id,
      app: fixture.intent.app,
      pipeline: "episode-plan-dag",
      pass: fixture.step.id,
      role: fixture.step.role,
      runtime: fixture.step.assignment.harness,
      model: fixture.step.assignment.model,
      effort: fixture.step.assignment.effort,
      assignmentSource: fixture.step.assignmentSource,
      ...(authorization.assignment_candidate_id === undefined
        ? {}
        : { assignmentCandidateId: authorization.assignment_candidate_id }),
      selectionReason: fixture.step.selectionReason,
      ...(authorization.resolved_capabilities === undefined
        ? {}
        : { resolvedCapabilities: authorization.resolved_capabilities }),
      providerTurnIds: [started.providerTurnId],
      executionStepIds: [started.executionStepId],
    }, startedAt);
    await updateEnvelope(root, fixture.intent.app, runId, {
      usage,
      providerTurnIds: [started.providerTurnId],
      executionStepIds: [started.executionStepId],
      lastSeenAt: new Date(startedAt.getTime() + 250).toISOString(),
    });
    await finalizeRun(root, fixture.intent.app, runId, {
      status: "failed",
      errorCode: "simulated_owner_loss",
      reason: "runtime completed but execution-step finalization did not",
      usage,
    }, new Date(startedAt.getTime() + 500));
  }
  return started;
}

function executionOptions(
  root: string,
  fixture: AcceptedEpisodeFixture,
  runtimeForAssignment: () => FakeRuntime,
  now: () => Date,
) {
  return {
    root,
    intent: fixture.intent,
    plan: fixture.plan,
    roles: fixture.roles,
    workdir: root,
    hooks: { gate: () => ({ allow: true as const }) },
    runtimeForAssignment,
    contextForProviderStep: () => ({ taste: [], memoryExcerpts: [] }),
    mechanical: async () => ({ status: "completed" as const, artifact: { mechanical: "complete" } }),
    approval: async () => ({ status: "completed" as const, artifact: { approval: "complete" } }),
    telemetry: { orgDir: root, trigger: "manual" as const },
    providerReceiptStaleAfterMs: 60_000,
    now,
  };
}

function onlyProviderEvidence(records: Awaited<ReturnType<typeof readExecutionSteps>>) {
  expect(records).toHaveLength(1);
  const record = records[0];
  if (record === undefined || record.kind !== "provider") {
    throw new Error("expected exactly one provider execution record");
  }
  return record;
}

function fixtureApp(): AppEntry {
  return {
    name: "fixture",
    repo: "example/fixture",
    status: "live",
    budgetUsdMonth: 100,
    cadence: {},
  };
}

function fixtureRoles(): RoleConfig[] {
  return [{
    name: "planner",
    runtime: "claude",
    model: "claude-opus-4-8",
    effort: "high",
    delegation: { allow: [] },
    triggers: [],
    outputs: ["episode-plan"],
    maxTurnBudgetUsd: 3,
  }, {
    name: "builder",
    runtime: ASSIGNMENT.harness,
    model: ASSIGNMENT.model,
    effort: ASSIGNMENT.effort,
    delegation: { allow: [] },
    triggers: [],
    outputs: ["patch"],
    maxTurnBudgetUsd: 3,
  }];
}

function creatorScope(episodeId: string): CreatorEpisodeScope {
  const sourceRef = `scope:${episodeId}`;
  return {
    planningDisposition: "execution_ready",
    provenance: {
      source: "human",
      creatorId: "test-operator",
      createdAt: "2026-07-19T19:59:00.000Z",
      evidenceRefs: [sourceRef],
    },
    objective: "Implement the bounded parser fix",
    inScope: ["parser implementation"],
    outOfScope: ["parser redesign"],
    acceptanceCriteria: ["focused regression passes"],
    expectedArtifacts: [{ id: "patch", kind: "patch", required: true }],
    declaredConstraints: { network: false },
    safetyFacts: [],
    steps: [{
      kind: "provider_turn",
      operation: "build/implement",
      id: "build",
      role: "builder",
      objective: "Implement the bounded parser fix",
      dependsOn: [],
      requiredCapabilities: ["tool_gate"],
      inputRefs: [{ ref: sourceRef, required: true }],
      expectedOutputs: [{ id: "patch", kind: "patch", required: true }],
      maxTurnBudgetUsd: 2,
      selectionReason: "one localized implementation turn",
    }],
  };
}

function completedResult(summary: string): TurnResult {
  return {
    status: "completed",
    summary,
    artifacts: [{ kind: "file", ref: "git:working-tree", summary }],
    session: { runtime: "codex", id: `thread-${summary.replaceAll(" ", "-")}` },
    usage: {
      tokensIn: 100,
      tokensOut: 25,
      costUsd: 0.25,
      subagentTurns: 0,
      wallClockMs: 500,
      quality: "complete",
    },
    escalations: [],
  };
}

function settlementFixture(providerTurnId: string, executionStepId: string): TurnRecord {
  return {
    at: "2026-07-19T20:09:00.000Z",
    role: "builder",
    runtime: "codex",
    model: "gpt-5.6-sol",
    effort: "high",
    status: "completed",
    tokensIn: 1,
    tokensOut: 1,
    costUsd: 0.01,
    usageQuality: "complete",
    subagentTurns: 0,
    wallClockMs: 1,
    escalations: 0,
    app: "fixture",
    providerTurnId,
    executionStepId,
  };
}

function sameSecondClock(start: string): () => Date {
  let current = new Date(start).getTime();
  return () => {
    const value = new Date(current);
    current += 10;
    return value;
  };
}
