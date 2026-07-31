import { afterEach, describe, expect, it } from "vitest";
import { readExecutionSteps, readRouteRecord } from "../src/loop/efficiency.js";
import { readExecutionJournal } from "../src/loop/execution-journal.js";
import { readEpisodePlanExecutionJournal } from "../src/loop/episode-plan-executor.js";
import type { CreatorEpisodeScope } from "../src/loop/episode-plan.js";
import {
  publishEpisodePlanRevision,
  requestEpisodeReplan,
} from "../src/loop/episode-replan.js";
import { executeAcceptedEpisodePlan } from "../src/org/episode-planner/execution.js";
import { prepareEpisodePlan } from "../src/org/episode-planner/coordinator.js";
import { buildEpisodeIntent, createEpisodePlanningPolicy } from "../src/org/episode-planner/policy.js";
import type { AppEntry } from "../src/org/apps.js";
import { readEnvelope } from "../src/runtime/runlog/envelope.js";
import type { RuntimeReadinessProbe } from "../src/runtime/readiness.js";
import { readTurnRecords } from "../src/runtime/telemetry.js";
import { FakeRuntime } from "../src/runtime/testing/fakeRuntime.js";
import type {
  RoleConfig,
  RuntimeKind,
  TurnAssignment,
  TurnResult,
} from "../src/runtime/types.js";
import { makeOrgHome, type OrgHomeFixture } from "./fixtures/orgHome.js";

describe("accepted EpisodePlan execution", () => {
  let home: OrgHomeFixture;
  afterEach(() => home?.cleanup());

  it("executes one exact planned assignment through the ordinary evidence substrate", async () => {
    home = makeOrgHome();
    const app = fixtureApp();
    const roles = fixtureRoles();
    const intent = buildEpisodeIntent({
      episodeId: "ticket:fixture:execute",
      app,
      roles,
      trigger: { kind: "ticket", sourceRef: "github:#9" },
      goal: "Implement the bounded parser fix",
      lifecycle: "existing-ticket",
      appStage: "growth",
      repositoryFacts: { revision: "abc123" },
      requestedConstraints: { network: false },
      hardBudget: {
        maxProviderTurns: 2,
        maxEquivalentCostUsd: 5,
        maxActiveTimeMs: 60_000,
      },
      requiredSafetyFacts: [],
      creatorScope: creatorScope(),
    });
    const prepared = await prepareEpisodePlan({
      root: home.root,
      app,
      roles,
      intent,
      now: () => new Date("2026-07-19T21:00:00.000Z"),
    });
    const fake = new FakeRuntime([{
      result: completedResult("parser fixed"),
    }], "codex");

    const result = await executeAcceptedEpisodePlan({
      root: home.root,
      intent,
      plan: prepared.plan,
      roles,
      workdir: home.root,
      hooks: { gate: () => ({ allow: true }) },
      runtimeForAssignment: () => fake,
      contextForProviderStep: () => ({ taste: [], memoryExcerpts: [] }),
      mechanical: async (step) => ({ status: "completed", artifact: { gate: step.gate } }),
      approval: async (step) => ({ status: "completed", artifact: { approval: step.actionRef } }),
      telemetry: { orgDir: home.root, trigger: "manual" },
      now: monotonicClock("2026-07-19T21:00:01.000Z"),
    });

    expect(result).toMatchObject({ status: "completed", completedStepIds: ["build"] });
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]!.req).toMatchObject({
      role: { name: "builder", maxTurnBudgetUsd: 2 },
      assignment: { harness: "codex", model: "gpt-5.6-sol", effort: "high" },
    });
    const resumed = await executeAcceptedEpisodePlan({
      root: home.root,
      intent,
      plan: prepared.plan,
      roles,
      workdir: home.root,
      hooks: { gate: () => ({ allow: true }) },
      runtimeForAssignment: () => fake,
      contextForProviderStep: () => ({ taste: [], memoryExcerpts: [] }),
      mechanical: async (step) => ({ status: "completed", artifact: { gate: step.gate } }),
      approval: async (step) => ({ status: "completed", artifact: { approval: step.actionRef } }),
      telemetry: { orgDir: home.root, trigger: "manual" },
      now: monotonicClock("2026-07-19T21:01:01.000Z"),
    });
    expect(resumed.status).toBe("completed");
    expect(fake.calls).toHaveLength(1);
    const route = await readRouteRecord(home.root, intent.episodeId);
    expect(route).toMatchObject({
      policy_version: "episode-plan-route/v1",
      planned_route: "quick",
      execution_bounds: null,
      terminal: { status: "completed" },
    });
    expect(route.authorized_passes).toEqual([expect.objectContaining({
      pipeline: "episode-plan-dag",
      pass: "build",
      plan_version: 1,
      plan_step_id: "build",
      runtime: "codex",
      model: "gpt-5.6-sol",
      effort: "high",
    })]);
    expect((await readEpisodePlanExecutionJournal(home.root, intent.episodeId))?.status)
      .toBe("completed");
    const ledger = await readTurnRecords(home.root);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({
      app: "fixture",
      planVersion: 1,
      planStepId: "build",
      runtime: "codex",
      model: "gpt-5.6-sol",
      effort: "high",
    });
  });

  it("executes an adaptive cross-harness plan without changing either role's authority", async () => {
    home = makeOrgHome();
    const app = adaptiveApp();
    const roles = adaptiveRoles();
    const scope = adaptiveCreatorScope();
    const intent = buildEpisodeIntent({
      episodeId: "ticket:fixture:adaptive-cross-harness",
      app,
      roles,
      trigger: { kind: "ticket", sourceRef: "github:#18" },
      goal: scope.objective,
      lifecycle: "existing-ticket",
      appStage: "growth",
      repositoryFacts: { revision: "def456" },
      requestedConstraints: { network: false },
      hardBudget: {
        maxProviderTurns: 2,
        maxEquivalentCostUsd: 4,
        maxActiveTimeMs: 60_000,
      },
      requiredSafetyFacts: [],
      creatorScope: scope,
    });
    const prepared = await prepareEpisodePlan({
      root: home.root,
      app,
      roles,
      intent,
      independentReview: {
        subjectRoles: ["builder"],
        reviewerRoles: ["reviewer"],
      },
      now: () => new Date("2026-07-19T22:00:00.000Z"),
    });
    expect(prepared).toMatchObject({ planningTurnSkipped: true, plannerAttempts: 0 });
    expect(prepared.plan.steps).toEqual([
      expect.objectContaining({
        id: "build",
        assignment: CODEX_BUILD_ASSIGNMENT,
        assignmentSource: "creator",
      }),
      expect.objectContaining({
        id: "review",
        assignment: CLAUDE_REVIEW_ASSIGNMENT,
        assignmentSource: "creator",
      }),
    ]);

    const codex = new FakeRuntime([{
      result: completedResultFor("implementation complete", "codex"),
    }], "codex");
    const claude = new FakeRuntime([{
      result: completedResultFor("independent review complete", "claude"),
    }], "claude");
    const resolved: Array<{ assignment: TurnAssignment; role: string }> = [];

    const result = await executeAcceptedEpisodePlan({
      root: home.root,
      intent,
      plan: prepared.plan,
      roles,
      workdir: home.root,
      hooks: { gate: () => ({ allow: true }) },
      assignmentReadinessProbe: READY_ASSIGNMENT_PROBE,
      runtimeForAssignment: (assignment, role) => {
        resolved.push({ assignment: { ...assignment }, role: role.name });
        return assignment.harness === "codex" ? codex : claude;
      },
      contextForProviderStep: () => ({ taste: [], memoryExcerpts: [] }),
      mechanical: async (step) => ({ status: "completed", artifact: { gate: step.gate } }),
      approval: async (step) => ({ status: "completed", artifact: { approval: step.actionRef } }),
      telemetry: { orgDir: home.root, trigger: "manual" },
      now: monotonicClock("2026-07-19T22:00:01.000Z"),
    });

    expect(result).toMatchObject({
      status: "completed",
      completedStepIds: ["build", "review"],
    });
    expect(resolved).toEqual([
      { assignment: CODEX_BUILD_ASSIGNMENT, role: "builder" },
      { assignment: CLAUDE_REVIEW_ASSIGNMENT, role: "reviewer" },
    ]);
    expect(codex.calls).toHaveLength(1);
    expect(claude.calls).toHaveLength(1);

    const builderRole = roles.find((role) => role.name === "builder")!;
    const reviewerRole = roles.find((role) => role.name === "reviewer")!;
    expect(codex.calls[0]!.req).toMatchObject({
      assignment: CODEX_BUILD_ASSIGNMENT,
      role: {
        name: "builder",
        runtime: builderRole.runtime,
        model: builderRole.model,
        effort: builderRole.effort,
        delegation: builderRole.delegation,
        outputs: builderRole.outputs,
      },
      context: {
        execution: {
          role: "builder",
          assignment: CODEX_BUILD_ASSIGNMENT,
          roleDelegation: builderRole.delegation,
        },
      },
    });
    expect(claude.calls[0]!.req).toMatchObject({
      assignment: CLAUDE_REVIEW_ASSIGNMENT,
      role: {
        name: "reviewer",
        runtime: reviewerRole.runtime,
        model: reviewerRole.model,
        effort: reviewerRole.effort,
        delegation: reviewerRole.delegation,
        outputs: reviewerRole.outputs,
      },
      context: {
        execution: {
          role: "reviewer",
          assignment: CLAUDE_REVIEW_ASSIGNMENT,
          roleDelegation: reviewerRole.delegation,
        },
      },
    });
    // The selected harness differs from each role's fixed runtime. Authority
    // nevertheless remains the role's configured delegation/output contract.
    expect(codex.calls[0]!.req.role.runtime).toBe("claude");
    expect(claude.calls[0]!.req.role.runtime).toBe("codex");

    const route = await readRouteRecord(home.root, intent.episodeId);
    expect(route.authorized_passes).toEqual([
      expect.objectContaining({
        pass: "build",
        role: "builder",
        runtime: "codex",
        model: CODEX_BUILD_ASSIGNMENT.model,
        effort: CODEX_BUILD_ASSIGNMENT.effort,
        assignment_source: "creator",
        assignment_candidate_id: "builder-codex",
        plan_version: 1,
        plan_step_id: "build",
      }),
      expect.objectContaining({
        pass: "review",
        role: "reviewer",
        runtime: "claude",
        model: CLAUDE_REVIEW_ASSIGNMENT.model,
        effort: CLAUDE_REVIEW_ASSIGNMENT.effort,
        assignment_source: "creator",
        assignment_candidate_id: "reviewer-claude",
        plan_version: 1,
        plan_step_id: "review",
      }),
    ]);

    const steps = await readExecutionSteps(home.root, intent.episodeId);
    expect(steps).toHaveLength(2);
    expect(steps.map((step) => ({
      step: step.plan_step_id,
      role: step.role,
      harness: step.runtime,
      model: step.model,
      effort: step.effort,
      source: step.assignment_source,
      candidate: step.assignment_candidate_id,
    }))).toEqual([
      {
        step: "build",
        role: "builder",
        harness: "codex",
        model: CODEX_BUILD_ASSIGNMENT.model,
        effort: CODEX_BUILD_ASSIGNMENT.effort,
        source: "creator",
        candidate: "builder-codex",
      },
      {
        step: "review",
        role: "reviewer",
        harness: "claude",
        model: CLAUDE_REVIEW_ASSIGNMENT.model,
        effort: CLAUDE_REVIEW_ASSIGNMENT.effort,
        source: "creator",
        candidate: "reviewer-claude",
      },
    ]);

    const journal = await readEpisodePlanExecutionJournal(home.root, intent.episodeId);
    expect(journal).toMatchObject({ status: "completed", current_plan_version: 1 });
    expect(journal?.events.filter((event) => event.kind === "step_completed").map((event) => event.step_id))
      .toEqual(["build", "review"]);

    const ledger = await readTurnRecords(home.root);
    expect(ledger.map((turn) => ({
      step: turn.planStepId,
      role: turn.role,
      harness: turn.runtime,
      model: turn.model,
      effort: turn.effort,
      source: turn.assignmentSource,
      candidate: turn.assignmentCandidateId,
    }))).toEqual([
      {
        step: "build",
        role: "builder",
        harness: "codex",
        model: CODEX_BUILD_ASSIGNMENT.model,
        effort: CODEX_BUILD_ASSIGNMENT.effort,
        source: "creator",
        candidate: "builder-codex",
      },
      {
        step: "review",
        role: "reviewer",
        harness: "claude",
        model: CLAUDE_REVIEW_ASSIGNMENT.model,
        effort: CLAUDE_REVIEW_ASSIGNMENT.effort,
        source: "creator",
        candidate: "reviewer-claude",
      },
    ]);
    const envelopes = await Promise.all(ledger.map((turn) =>
      readEnvelope(home.root, "fixture", turn.runId!)
    ));
    expect(envelopes.map((envelope) => ({
      step: envelope.plan_step_id,
      role: envelope.role,
      harness: envelope.runtime,
      model: envelope.model,
      effort: envelope.effort,
      source: envelope.assignment_source,
      candidate: envelope.assignment_candidate_id,
    }))).toEqual([
      {
        step: "build",
        role: "builder",
        harness: "codex",
        model: CODEX_BUILD_ASSIGNMENT.model,
        effort: CODEX_BUILD_ASSIGNMENT.effort,
        source: "creator",
        candidate: "builder-codex",
      },
      {
        step: "review",
        role: "reviewer",
        harness: "claude",
        model: CLAUDE_REVIEW_ASSIGNMENT.model,
        effort: CLAUDE_REVIEW_ASSIGNMENT.effort,
        source: "creator",
        candidate: "reviewer-claude",
      },
    ]);
  });

  it("revises route authority for only unfinished v2 steps and never reauthorizes completed v1 work", async () => {
    home = makeOrgHome();
    const app = adaptiveApp();
    const roles = adaptiveRoles();
    const scope = adaptiveCreatorScope();
    const intent = buildEpisodeIntent({
      episodeId: "ticket:fixture:forward-route-revision",
      app,
      roles,
      trigger: { kind: "ticket", sourceRef: "github:#19" },
      goal: scope.objective,
      lifecycle: "existing-ticket",
      appStage: "growth",
      repositoryFacts: { revision: "revision-v1" },
      requestedConstraints: { network: false },
      hardBudget: {
        maxProviderTurns: 2,
        maxEquivalentCostUsd: 4,
        maxActiveTimeMs: 60_000,
      },
      requiredSafetyFacts: [],
      creatorScope: scope,
    });
    const independentReview = {
      subjectRoles: ["builder"],
      reviewerRoles: ["reviewer"],
    } as const;
    const prepared = await prepareEpisodePlan({
      root: home.root,
      app,
      roles,
      intent,
      independentReview,
      now: () => new Date("2026-07-19T23:00:00.000Z"),
    });
    const codex = new FakeRuntime([{
      result: completedResultFor("implementation complete", "codex"),
    }], "codex");
    const claude = new FakeRuntime([{
      result: completedResultFor("revised independent review complete", "claude"),
    }], "claude");
    const executionOptions = {
      root: home.root,
      intent,
      roles,
      workdir: home.root,
      hooks: { gate: () => ({ allow: true as const }) },
      assignmentReadinessProbe: READY_ASSIGNMENT_PROBE,
      runtimeForAssignment: (assignment: TurnAssignment) =>
        assignment.harness === "codex" ? codex : claude,
      contextForProviderStep: () => Promise.resolve({ taste: [], memoryExcerpts: [] }),
      mechanical: async () => ({ status: "completed" as const, artifact: { mechanical: "complete" } }),
      approval: async () => ({ status: "completed" as const, artifact: { approval: "complete" } }),
      telemetry: { orgDir: home.root, trigger: "manual" as const },
    };

    const partial = await executeAcceptedEpisodePlan({
      ...executionOptions,
      plan: prepared.plan,
      maxSteps: 1,
      now: monotonicClock("2026-07-19T23:00:01.000Z"),
    });
    expect(partial).toMatchObject({ status: "running", completedStepIds: ["build"] });

    const v2 = structuredClone(prepared.plan);
    v2.version = 2;
    v2.summary = "Revise only the unfinished independent review";
    v2.createdAt = "2026-07-19T23:01:00.000Z";
    const review = v2.steps.find((step) => step.id === "review");
    if (review?.kind !== "provider_turn") throw new Error("expected review provider step");
    review.objective = "Review the implementation against newly clarified evidence";
    review.selectionReason = "The forward-only revision requires updated independent review";
    const policy = createEpisodePlanningPolicy(app, { intent, roles, independentReview });
    await requestEpisodeReplan({
      root: home.root,
      episodeId: intent.episodeId,
      trigger: {
        id: "review-evidence-clarified",
        kind: "new_scope",
        planVersion: 1,
        detectedAt: "2026-07-19T23:00:30.000Z",
        summary: "New evidence clarifies the unfinished independent review",
        evidenceRefs: ["test:review-evidence"],
        affectedStepIds: ["review"],
      },
    });
    await publishEpisodePlanRevision({
      root: home.root,
      requestId: "review-evidence-clarified",
      plan: v2,
      intent,
      policy: policy.validation,
    });

    const completed = await executeAcceptedEpisodePlan({
      ...executionOptions,
      plan: v2,
      now: monotonicClock("2026-07-19T23:01:01.000Z"),
    });
    expect(completed).toMatchObject({ status: "completed", planVersion: 2 });
    expect(codex.calls).toHaveLength(1);
    expect(claude.calls).toHaveLength(1);

    const route = await readRouteRecord(home.root, intent.episodeId);
    expect(route).toMatchObject({ current_plan_version: 2, terminal: { status: "completed" } });
    expect(route.authorized_passes.map((pass) => [pass.plan_version, pass.plan_step_id]))
      .toEqual([[1, "build"], [1, "review"], [2, "review"]]);
    expect(route.authorized_passes).not.toContainEqual(expect.objectContaining({
      plan_version: 2,
      plan_step_id: "build",
    }));
  });

  it("keeps pre-EpisodePlan route, delivery-journal, and step artifacts readable", async () => {
    const episodeId = "ticket:fixture:#legacy";
    home = makeOrgHome({
      efficiency: {
        episodes: {
          [episodeId]: {
            route: {
              policy_version: "efficiency/v1",
              authorized_passes: [{
                pipeline: "build",
                pass: "implement",
                role: "builder",
                runtime: "codex",
                model: "gpt-legacy",
                effort: "medium",
                factor_rules: ["legacy_route"],
              }],
            },
            journal: {
              stages: [{
                boundary: "route",
                status: "completed",
                artifact_sha256: "legacy-route-sha",
                completed_at: "2026-07-12T10:01:00.000Z",
                attempt: 1,
              }],
              status: "running",
              next_boundary: "contract",
            },
            steps: {
              "legacy-provider-step": {
                run_id: "legacy-run",
                operation: "build/implement",
                role: "builder",
                runtime: "codex",
                model: "gpt-legacy",
                effort: "medium",
              },
            },
          },
        },
      },
    });

    const route = await readRouteRecord(home.root, episodeId);
    expect(route.authorized_passes).toEqual([{
      pipeline: "build",
      pass: "implement",
      role: "builder",
      runtime: "codex",
      model: "gpt-legacy",
      effort: "medium",
      factor_rules: ["legacy_route"],
    }]);
    expect(await readExecutionJournal(home.root, episodeId)).toMatchObject({
      episode_id: episodeId,
      status: "running",
      next_boundary: "contract",
      stages: [expect.objectContaining({ boundary: "route", status: "completed" })],
    });
    expect(await readExecutionSteps(home.root, episodeId)).toEqual([
      expect.objectContaining({
        execution_step_id: "legacy-provider-step",
        role: "builder",
        runtime: "codex",
        model: "gpt-legacy",
        effort: "medium",
      }),
    ]);
    const [legacyStep] = await readExecutionSteps(home.root, episodeId);
    expect(legacyStep).not.toHaveProperty("assignment_source");
    expect(legacyStep).not.toHaveProperty("plan_version");
    expect(await readEpisodePlanExecutionJournal(home.root, episodeId)).toBeUndefined();
  });
});

const CODEX_BUILD_ASSIGNMENT: TurnAssignment = {
  harness: "codex",
  model: "gpt-5.6-sol",
  effort: "high",
};

const CLAUDE_REVIEW_ASSIGNMENT: TurnAssignment = {
  harness: "claude",
  model: "claude-opus-4-8",
  effort: "high",
};

const READY_ASSIGNMENT_PROBE: RuntimeReadinessProbe = async (request) => ({
  runtime: request.runtime,
  models: request.models,
  status: "ready",
  detail: "test fixture proves the selected exact tuple is ready",
  durationMs: 1,
  billable: false,
});

function fixtureApp(): AppEntry {
  return {
    name: "fixture",
    repo: "example/fixture",
    status: "live",
    budgetUsdMonth: 100,
    cadence: {},
  };
}

function adaptiveApp(): AppEntry {
  return {
    ...fixtureApp(),
    execution: {
      assignmentMode: "adaptive",
      allowedAssignments: {
        builder: ["builder-codex"],
        reviewer: ["reviewer-claude"],
      },
    },
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
    runtime: "codex",
    model: "gpt-5.6-sol",
    effort: "high",
    delegation: { allow: ["test-fanout"] },
    triggers: [],
    outputs: ["patch"],
    maxTurnBudgetUsd: 3,
  }];
}

function adaptiveRoles(): RoleConfig[] {
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
    runtime: "claude",
    model: "claude-sonnet-4-6",
    effort: "medium",
    adaptiveAssignments: [{
      id: "builder-codex",
      harness: CODEX_BUILD_ASSIGNMENT.harness,
      model: CODEX_BUILD_ASSIGNMENT.model,
      efforts: [CODEX_BUILD_ASSIGNMENT.effort],
      providerFamily: "openai",
      capabilityRef: "codex/v1",
      qualificationRef: "qualification:test:builder-codex",
      pricing: {
        kind: "conservative_estimate",
        maxTurnCostUsd: 2,
        sourceRef: "price:test:builder-codex",
      },
    }],
    delegation: { allow: ["test-fanout"] },
    triggers: [],
    outputs: ["patch"],
    maxTurnBudgetUsd: 3,
  }, {
    name: "reviewer",
    runtime: "codex",
    model: "gpt-5.6-sol",
    effort: "medium",
    adaptiveAssignments: [{
      id: "reviewer-claude",
      harness: CLAUDE_REVIEW_ASSIGNMENT.harness,
      model: CLAUDE_REVIEW_ASSIGNMENT.model,
      efforts: [CLAUDE_REVIEW_ASSIGNMENT.effort],
      providerFamily: "anthropic",
      capabilityRef: "claude/v1",
      qualificationRef: "qualification:test:reviewer-claude",
      pricing: {
        kind: "conservative_estimate",
        maxTurnCostUsd: 2,
        sourceRef: "price:test:reviewer-claude",
      },
    }],
    delegation: { allow: [] },
    triggers: [],
    outputs: ["review"],
    maxTurnBudgetUsd: 3,
  }];
}

function creatorScope(): CreatorEpisodeScope {
  return {
    planningDisposition: "execution_ready",
    provenance: {
      source: "human",
      creatorId: "test-operator",
      createdAt: "2026-07-19T20:59:00.000Z",
      evidenceRefs: ["test:ticket-9"],
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
      inputRefs: [{ ref: "test:ticket-9", required: true }],
      expectedOutputs: [{ id: "patch", kind: "patch", required: true }],
      maxTurnBudgetUsd: 2,
      selectionReason: "one localized implementation turn",
    }],
  };
}

function adaptiveCreatorScope(): CreatorEpisodeScope {
  return {
    planningDisposition: "execution_ready",
    provenance: {
      source: "agent",
      creatorId: "parent-plan:18",
      createdAt: "2026-07-19T21:59:00.000Z",
      evidenceRefs: ["task:parent-18"],
    },
    objective: "Implement and independently review the bounded parser fix",
    inScope: ["parser implementation", "focused independent review"],
    outOfScope: ["parser redesign"],
    acceptanceCriteria: ["review finds the bounded change correct"],
    expectedArtifacts: [{ id: "review", kind: "review", required: true }],
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
      assignment: CODEX_BUILD_ASSIGNMENT,
      inputRefs: [{ ref: "task:parent-18", required: true }],
      expectedOutputs: [{ id: "patch", kind: "patch", required: true }],
      maxTurnBudgetUsd: 2,
      selectionReason: "Codex is the approved implementation assignment",
    }, {
      kind: "provider_turn",
      operation: "review/verify",
      id: "review",
      role: "reviewer",
      objective: "Independently review the bounded parser fix",
      dependsOn: ["build"],
      requiredCapabilities: ["tool_gate"],
      assignment: CLAUDE_REVIEW_ASSIGNMENT,
      inputRefs: [{ ref: "artifact:patch", required: true }],
      expectedOutputs: [{ id: "review", kind: "review", required: true }],
      maxTurnBudgetUsd: 2,
      selectionReason: "Claude is the approved independent review assignment",
    }],
  };
}

function completedResult(summary: string): TurnResult {
  return {
    status: "completed",
    summary,
    artifacts: [{ kind: "file", ref: "git:working-tree", summary }],
    session: { runtime: "codex", id: "thread-episode-execution" },
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

function completedResultFor(summary: string, runtime: RuntimeKind): TurnResult {
  return {
    ...completedResult(summary),
    session: { runtime, id: `session-${runtime}-${summary.replaceAll(" ", "-")}` },
  };
}

function monotonicClock(start: string): () => Date {
  let current = new Date(start).getTime();
  return () => {
    const value = new Date(current);
    current += 1_000;
    return value;
  };
}
