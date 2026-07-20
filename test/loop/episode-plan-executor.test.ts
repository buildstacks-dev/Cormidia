import { readFile, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EpisodePlanExecutionError,
  completedEpisodePlanStepIds,
  episodePlanExecutionJournalPath,
  executeEpisodePlan,
  readEpisodePlanExecutionJournal,
  type EpisodeStepCompletedOutcome,
  type EpisodePlanStepHandlers,
} from "../../src/loop/episode-plan-executor.js";
import {
  deriveEpisodeSafetyRoute,
  episodeIntentHash,
  episodePlanHash,
  estimateEpisodePlanBudget,
  persistEpisodePlan,
  type EpisodeIntent,
  type EpisodePlan,
  type EpisodePlanValidationPolicy,
  type EpisodeStep,
  type ProviderTurnStep,
} from "../../src/loop/episode-plan.js";
import { turnAssignmentKey } from "../../src/runtime/assignment.js";
import { FileLockBusyError } from "../../src/runtime/file-lock.js";
import {
  publishEpisodePlanRevision,
  requestEpisodeReplan,
} from "../../src/loop/episode-replan.js";
import type { TurnAssignment } from "../../src/runtime/types.js";
import { makeOrgHome, type OrgHomeFixture } from "../fixtures/orgHome.js";

const ASSIGNMENT: TurnAssignment = {
  harness: "codex",
  model: "gpt-5.6-sol",
  effort: "high",
};

describe("EpisodePlan DAG execution", () => {
  const homes: OrgHomeFixture[] = [];
  afterEach(() => {
    for (const home of homes.splice(0)) home.cleanup();
  });

  it("executes the persisted DAG in stable ready-step order and passes the exact provider step", async () => {
    const fixture = await setup(homes);
    const calls: string[] = [];
    const provider = vi.fn(async (step: ProviderTurnStep) => {
      calls.push(step.id);
      expect(step).toBe(fixture.plan.steps.find((candidate) => candidate.id === "build"));
      expect(step.assignment).toEqual(ASSIGNMENT);
      return { status: "completed" as const, artifact: { patch: "sha256:patch" } };
    });
    const handlers = passingHandlers(calls, provider);

    const execution = await executeEpisodePlan({
      root: fixture.home.root,
      plan: fixture.plan,
      handlers,
    });

    // alpha and beta become ready together; proposal array order deliberately
    // lists beta first, while execution uses the stable id order.
    expect(calls).toEqual(["build", "alpha", "beta", "approve", "finish"]);
    expect(execution).toMatchObject({ status: "completed", nextStepId: null });
    expect(execution.completedStepIds).toEqual(["alpha", "approve", "beta", "build", "finish"]);
    expect(provider).toHaveBeenCalledOnce();

    const journal = await readEpisodePlanExecutionJournal(fixture.home.root, fixture.plan.episodeId);
    expect(journal).toMatchObject({
      current_plan_version: 1,
      status: "completed",
      blocked_step_id: null,
    });
    expect(journal?.events.filter((event) => event.kind === "step_started").map((event) => event.step_id))
      .toEqual(calls);
    const buildCompletion = journal?.events.find((event) =>
      event.kind === "step_completed" && event.step_id === "build");
    expect(buildCompletion).toMatchObject({
      output_artifacts: [{
        output_id: "patch",
        output_kind: "artifact",
        artifact_sha256: buildCompletion?.kind === "step_completed"
          ? buildCompletion.artifact_sha256
          : "missing",
      }],
    });
    expect(journal === undefined ? [] : completedEpisodePlanStepIds(journal)).toEqual(execution.completedStepIds);
  });

  it("rejects completion without content-bound artifact evidence", async () => {
    const fixture = await setup(homes);
    const handlers = passingHandlers([], async () =>
      ({ status: "completed" } as unknown as EpisodeStepCompletedOutcome));

    await expect(executeEpisodePlan({
      root: fixture.home.root,
      plan: fixture.plan,
      handlers,
      maxSteps: 1,
    })).rejects.toMatchObject({ code: "error_episode_plan_execution_outcome_invalid" });

    const journal = await readEpisodePlanExecutionJournal(fixture.home.root, fixture.plan.episodeId);
    expect(journal?.events.map((event) => event.kind)).toEqual(["plan_adopted", "step_started"]);
  });

  it("terminalizes a handler throw before provider evidence so a revision can proceed", async () => {
    const fixture = await setup(homes);
    const calls: string[] = [];
    const crashingHandlers = passingHandlers([], async (_step, context) => {
      calls.push(context.executionId);
      expect(context.resume).toBe(false);
      throw new Error("handler failed before provider evidence");
    });

    const failed = await executeEpisodePlan({
      root: fixture.home.root,
      plan: fixture.plan,
      handlers: crashingHandlers,
    });
    expect(failed).toMatchObject({
      status: "failed",
      nextStepId: "build",
      reasonCode: "error_episode_plan_step_handler_failed",
      summary: "handler failed before provider evidence",
    });

    const afterFailure = await readEpisodePlanExecutionJournal(fixture.home.root, fixture.plan.episodeId);
    expect(afterFailure?.events.map((event) => event.kind)).toEqual([
      "plan_adopted",
      "step_started",
      "step_failed",
    ]);

    await requestEpisodeReplan({
      root: fixture.home.root,
      episodeId: fixture.plan.episodeId,
      trigger: {
        id: "handler-failure-replan",
        kind: "failed_assumption",
        planVersion: 1,
        detectedAt: "2026-07-19T18:01:00.000Z",
        summary: "Replace the failed future provider step",
        evidenceRefs: [`plan-execution:${calls[0]}`],
        affectedStepIds: ["build"],
      },
    });
    const revision = structuredClone(fixture.plan);
    revision.version = 2;
    revision.createdAt = "2026-07-19T18:02:00.000Z";
    revision.summary = "Retry the not-yet-completed provider work under a revision";
    await expect(publishEpisodePlanRevision({
      root: fixture.home.root,
      requestId: "handler-failure-replan",
      intent: fixture.intent,
      plan: revision,
      policy: fixture.policy,
    })).resolves.toMatchObject({
      status: "accepted",
      revisionVersion: 2,
    });
  });

  it("blocks on a pending approval, polls that same step, and never reruns a denial", async () => {
    const fixture = await setup(homes);
    const calls: string[] = [];
    const approval = vi.fn()
      .mockResolvedValueOnce({ status: "pending", reasonCode: "awaiting-human", summary: "No decision yet" })
      .mockResolvedValueOnce({ status: "denied", reasonCode: "human-denied", summary: "Change not authorized" });
    const handlers = passingHandlers(calls, undefined, approval);

    const pending = await executeEpisodePlan({ root: fixture.home.root, plan: fixture.plan, handlers });
    expect(pending).toMatchObject({
      status: "waiting_approval",
      nextStepId: "approve",
      lastStepId: "approve",
    });
    expect(calls).toEqual(["build", "alpha", "beta", "approve"]);

    const denied = await executeEpisodePlan({ root: fixture.home.root, plan: fixture.plan, handlers });
    expect(denied).toMatchObject({
      status: "denied",
      nextStepId: "approve",
      reasonCode: "human-denied",
    });
    expect(approval).toHaveBeenCalledTimes(2);
    expect(calls).toEqual(["build", "alpha", "beta", "approve", "approve"]);

    const stillDenied = await executeEpisodePlan({ root: fixture.home.root, plan: fixture.plan, handlers });
    expect(stillDenied.status).toBe("denied");
    expect(approval).toHaveBeenCalledTimes(2);
    expect(calls).not.toContain("finish");
  });

  it("fails closed on a step failure and does not run ready siblings or retry it", async () => {
    const fixture = await setup(homes);
    const calls: string[] = [];
    const handlers = passingHandlers(calls);
    handlers.mechanical = vi.fn(async (step) => {
      calls.push(step.id);
      return step.id === "alpha"
        ? { status: "failed" as const, reasonCode: "gate-failed", summary: "Focused gate failed" }
        : { status: "completed" as const, artifact: { gate: step.gate } };
    });

    const failed = await executeEpisodePlan({ root: fixture.home.root, plan: fixture.plan, handlers });
    expect(failed).toMatchObject({
      status: "failed",
      nextStepId: "alpha",
      reasonCode: "gate-failed",
    });
    expect(calls).toEqual(["build", "alpha"]);

    const second = await executeEpisodePlan({ root: fixture.home.root, plan: fixture.plan, handlers });
    expect(second.status).toBe("failed");
    expect(calls).toEqual(["build", "alpha"]);
  });

  it("adopts a forward-only revision while preserving and never rerunning completed work", async () => {
    const fixture = await setup(homes);
    const v1Calls: string[] = [];
    const first = await executeEpisodePlan({
      root: fixture.home.root,
      plan: fixture.plan,
      handlers: passingHandlers(v1Calls),
      maxSteps: 1,
    });
    expect(first.completedStepIds).toEqual(["build"]);

    const v2 = structuredClone(fixture.plan);
    v2.version = 2;
    v2.createdAt = "2026-07-19T18:02:00.000Z";
    v2.summary = "Revise only the future gate after implementation evidence";
    mechanical(v2, "alpha").objective = "Run revised focused checks";
    v2.derivedSafetyRoute = deriveEpisodeSafetyRoute(v2.steps, fixture.intent.requiredSafetyFacts);
    await requestEpisodeReplan({
      root: fixture.home.root,
      episodeId: fixture.intent.episodeId,
      trigger: {
        id: "revise-alpha",
        kind: "failed_gate",
        planVersion: 1,
        detectedAt: "2026-07-19T18:01:30.000Z",
        summary: "New evidence requires revised focused checks",
        evidenceRefs: ["gate:alpha"],
        affectedStepIds: ["alpha"],
      },
    });
    await publishEpisodePlanRevision({
      root: fixture.home.root,
      requestId: "revise-alpha",
      plan: v2,
      intent: fixture.intent,
      policy: fixture.policy,
    });

    const v2Calls: string[] = [];
    const completed = await executeEpisodePlan({
      root: fixture.home.root,
      plan: v2,
      handlers: passingHandlers(v2Calls),
    });
    expect(completed.status).toBe("completed");
    expect(v2Calls).toEqual(["alpha", "beta", "approve", "finish"]);
    expect(v2Calls).not.toContain("build");

    const journal = await readEpisodePlanExecutionJournal(fixture.home.root, fixture.plan.episodeId);
    expect(journal?.events.filter((event) => event.kind === "plan_adopted").map((event) => event.plan_version))
      .toEqual([1, 2]);
    const buildCompletion = journal?.events.find((event) =>
      event.kind === "step_completed" && event.step_id === "build");
    expect(buildCompletion).toMatchObject({ plan_version: 1 });
  });

  it("rejects an unpersisted or non-current plan and corrupt journal state", async () => {
    const fixture = await setup(homes);
    const divergent = structuredClone(fixture.plan);
    divergent.summary = "Unpersisted divergent plan";
    await expect(executeEpisodePlan({
      root: fixture.home.root,
      plan: divergent,
      handlers: passingHandlers([]),
    })).rejects.toMatchObject({ code: "error_episode_plan_execution_plan_mismatch" });

    await executeEpisodePlan({
      root: fixture.home.root,
      plan: fixture.plan,
      handlers: passingHandlers([]),
      maxSteps: 1,
    });
    const journalPath = episodePlanExecutionJournalPath(fixture.home.root, fixture.plan.episodeId);
    const malformed = JSON.parse(await readFile(journalPath, "utf8")) as Record<string, unknown>;
    malformed.status = "mystery";
    await writeFile(journalPath, `${JSON.stringify(malformed)}\n`, "utf8");
    await expect(readEpisodePlanExecutionJournal(fixture.home.root, fixture.plan.episodeId))
      .rejects.toMatchObject({ code: "error_episode_plan_execution_journal_corrupt" });
  });

  it("admits only one executor for an episode while a step handler is active", async () => {
    const fixture = await setup(homes);
    let entered!: () => void;
    let release!: () => void;
    const handlerEntered = new Promise<void>((resolve) => { entered = resolve; });
    const handlerRelease = new Promise<void>((resolve) => { release = resolve; });
    const first = executeEpisodePlan({
      root: fixture.home.root,
      plan: fixture.plan,
      handlers: passingHandlers([], async () => {
        entered();
        await handlerRelease;
        return { status: "completed", artifact: { provider: "complete" } };
      }),
      maxSteps: 1,
    });
    await handlerEntered;

    await expect(executeEpisodePlan({
      root: fixture.home.root,
      plan: fixture.plan,
      handlers: passingHandlers([]),
      maxSteps: 1,
      lockOptions: { staleMs: 60_000, maxWaitMs: 1, retryMinMs: 1, retryMaxMs: 1 },
    })).rejects.toBeInstanceOf(FileLockBusyError);

    release();
    await expect(first).resolves.toMatchObject({ status: "running", completedStepIds: ["build"] });
  });

  it("fails closed if a revision changes completed work even when handed a forged pointer", async () => {
    const fixture = await setup(homes);
    const first = await executeEpisodePlan({
      root: fixture.home.root,
      plan: fixture.plan,
      handlers: passingHandlers([]),
      maxSteps: 1,
    });
    expect(first.completedStepIds).toEqual(["build"]);

    const changed = structuredClone(fixture.plan);
    changed.version = 2;
    changed.createdAt = "2026-07-19T18:03:00.000Z";
    provider(changed, "build").objective = "Rewrite completed work";
    // The ordinary persistence boundary rejects this. Assert the executor's
    // independent completed-step check too by writing a coherent immutable
    // version/pointer as if an external writer had bypassed that boundary.
    const planHash = episodePlanHash(changed);
    const episodeDir = episodePlanExecutionJournalPath(fixture.home.root, changed.episodeId).replace(
      /\/plan-execution-journal\.json$/,
      "",
    );
    await writeFile(`${episodeDir}/plan-v2.json`, `${JSON.stringify(changed, null, 2)}\n`, "utf8");
    await writeFile(`${episodeDir}/plan-current.json`, `${JSON.stringify({
      schemaVersion: 1,
      episodeId: changed.episodeId,
      version: 2,
      planHash,
      file: "plan-v2.json",
      updatedAt: changed.createdAt,
    }, null, 2)}\n`, "utf8");

    await expect(executeEpisodePlan({
      root: fixture.home.root,
      plan: changed,
      handlers: passingHandlers([]),
    })).rejects.toMatchObject({ code: "error_episode_plan_execution_completed_step_changed" });
  });
});

async function setup(homes: OrgHomeFixture[]) {
  const home = makeOrgHome();
  homes.push(home);
  const intent = makeIntent();
  const policy = makePolicy();
  const plan = makePlan(intent);
  await persistEpisodePlan({ root: home.root, plan, intent, policy });
  return { home, intent, policy, plan };
}

function makeIntent(): EpisodeIntent {
  return {
    episodeId: "ticket:executor:#17",
    app: "executor",
    assignmentMode: "fixed",
    trigger: { kind: "ticket", sourceRef: "github:#17" },
    goal: "Execute a bounded accepted plan",
    lifecycle: "existing-ticket",
    appStage: "growth",
    repositoryFacts: { revision: "abc123" },
    requestedConstraints: {},
    hardBudget: {
      maxProviderTurns: 2,
      maxEquivalentCostUsd: 4,
      maxMechanicalOverheadUsd: 1,
      maxHumanDecisions: 1,
    },
    availableRoles: [{
      role: "Builder",
      responsibility: "Implement",
      requiredCapabilities: ["workspace_write"],
      expectedOutputs: ["patch"],
      configuredAssignment: ASSIGNMENT,
    }],
    allowedAssignments: [{
      candidateId: "builder-primary",
      role: "Builder",
      assignment: ASSIGNMENT,
      providerFamily: "openai",
      capabilities: ["workspace_write"],
      qualificationRef: "qualification:builder",
      priceRef: "price:builder",
      maxTurnCostUsd: 2,
      available: true,
    }],
    requiredSafetyFacts: [],
  };
}

function makePolicy(): EpisodePlanValidationPolicy {
  return {
    mode: "fixed",
    configuredAssignmentFor: (role) => role === "Builder" ? ASSIGNMENT : undefined,
    isKnownRole: (role) => role === "Builder",
    isAssignmentAllowed: (role, assignment) =>
      role === "Builder" && turnAssignmentKey(assignment) === turnAssignmentKey(ASSIGNMENT),
    capabilitiesFor: () => ["workspace_write"],
    requiredTerminalOutputIds: ["done"],
  };
}

function makePlan(intent: EpisodeIntent): EpisodePlan {
  const steps: EpisodeStep[] = [
    gate("beta", ["build"], "beta-result"),
    providerStep(),
    approvalStep(),
    gate("alpha", ["build"], "alpha-result"),
    gate("finish", ["alpha", "beta", "approve"], "done"),
  ];
  return {
    schemaVersion: 1,
    episodeId: intent.episodeId,
    version: 1,
    intentHash: episodeIntentHash(intent),
    summary: "Implement, check two independent gates, approve, and finish",
    workflowClass: "bounded-delivery",
    planningSource: "episode_planner",
    steps,
    estimatedBudget: estimateEpisodePlanBudget(steps, 0),
    derivedSafetyRoute: deriveEpisodeSafetyRoute(steps, intent.requiredSafetyFacts),
    createdAt: "2026-07-19T18:01:00.000Z",
  };
}

function providerStep(): ProviderTurnStep {
  return {
    kind: "provider_turn",
    operation: "build/implement",
    id: "build",
    role: "Builder",
    objective: "Implement the bounded change",
    dependsOn: [],
    requiredCapabilities: ["workspace_write"],
    assignment: ASSIGNMENT,
    assignmentSource: "configured",
    inputRefs: [{ ref: "ticket", required: true }],
    expectedOutputs: [{ id: "patch", kind: "artifact", required: true }],
    maxTurnBudgetUsd: 2,
    selectionReason: "The accepted plan requires one implementation turn",
  };
}

function gate(id: string, dependsOn: string[], output: string): EpisodeStep {
  return {
    kind: "mechanical_gate",
    id,
    objective: `Run ${id}`,
    dependsOn,
    inputRefs: [],
    expectedOutputs: [{ id: output, kind: "gate", required: true }],
    gate: id,
  };
}

function approvalStep(): EpisodeStep {
  return {
    kind: "approval",
    id: "approve",
    objective: "Approve the bounded action",
    dependsOn: ["alpha", "beta"],
    inputRefs: [],
    expectedOutputs: [{ id: "approval-result", kind: "approval", required: true }],
    approvalKind: "critical-operation",
    actionRef: "action:executor:17",
  };
}

function passingHandlers(
  calls: string[],
  providerHandler?: EpisodePlanStepHandlers["provider"],
  approvalHandler?: EpisodePlanStepHandlers["approval"],
): EpisodePlanStepHandlers {
  return {
    provider: providerHandler ?? (async (step) => {
      calls.push(step.id);
      return { status: "completed", artifact: { providerStepId: step.id } };
    }),
    mechanical: async (step) => {
      calls.push(step.id);
      return { status: "completed", artifact: { gate: step.gate } };
    },
    approval: approvalHandler === undefined
      ? async (step) => {
          calls.push(step.id);
          return { status: "completed", artifact: { approval: step.actionRef } };
        }
      : async (step, context) => {
          calls.push(step.id);
          return approvalHandler(step, context);
        },
  };
}

function provider(plan: EpisodePlan, id: string): ProviderTurnStep {
  const step = plan.steps.find((candidate) => candidate.id === id);
  if (step?.kind !== "provider_turn") throw new Error(`missing provider ${id}`);
  return step;
}

function mechanical(plan: EpisodePlan, id: string) {
  const step = plan.steps.find((candidate) => candidate.id === id);
  if (step?.kind !== "mechanical_gate") throw new Error(`missing gate ${id}`);
  return step;
}
