import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EPISODE_PLAN_PROPOSAL_SCHEMA,
  episodeIntentHash,
  readCurrentEpisodePlan,
  type CreatorEpisodeScope,
  type EpisodeIntent,
  type ProposedEpisodePlan,
  type ProposedProviderTurnStep,
} from "../src/loop/episode-plan.js";
import { readExecutionSteps, routeRecordPath } from "../src/loop/efficiency.js";
import {
  plannerAdmissionPath,
  plannerPlanAcceptancePath,
  type PlannerAdmissionLimits,
} from "../src/loop/planner-admission.js";
import { buildEpisodeIntent } from "../src/org/episode-planner/policy.js";
import { prepareEpisodePlanWithRuntime } from "../src/org/episode-planner/runtime.js";
import type { AppEntry } from "../src/org/apps.js";
import { FakeRuntime } from "../src/runtime/testing/fakeRuntime.js";
import { readEnvelope } from "../src/runtime/runlog/envelope.js";
import { runPaths } from "../src/runtime/runlog/paths.js";
import { readTurnRecords } from "../src/runtime/telemetry.js";
import type {
  ContextBundle,
  RoleConfig,
  Runtime,
  TurnAssignment,
  TurnResult,
} from "../src/runtime/types.js";
import { makeOrgHome, type OrgHomeFixture } from "./fixtures/orgHome.js";

const NOW = new Date("2026-07-19T19:00:00.000Z");
const PLANNER_ASSIGNMENT: TurnAssignment = {
  harness: "codex",
  model: "gpt-planner-test",
  effort: "high",
};
const BUILDER_ASSIGNMENT: TurnAssignment = {
  harness: "claude",
  model: "claude-builder-test",
  effort: "medium",
};
const LIMITS: PlannerAdmissionLimits = {
  maxAttempts: 2,
  perAttempt: {
    inputTokens: 100,
    equivalentCostUsd: 0.5,
    activeTimeMs: 1_000,
  },
  aggregate: {
    providerTurns: 2,
    inputTokens: 200,
    equivalentCostUsd: 1,
    activeTimeMs: 2_000,
  },
};
const CONTEXT: ContextBundle = { taste: [], memoryExcerpts: [] };

describe("provider-backed EpisodePlanner", () => {
  let home: OrgHomeFixture;
  afterEach(() => home?.cleanup());

  it("admits the fixed boot tuple before construction and records exact ordinary evidence", async () => {
    home = makeOrgHome();
    const intent = makeIntent();
    const result = completed(JSON.stringify(proposal(intent)));
    const runtime = new FakeRuntime([{ result }], "codex");
    const factory = vi.fn((assignment: TurnAssignment, role: RoleConfig) => {
      expect(existsSync(plannerAdmissionPath(home.root, intent.episodeId))).toBe(true);
      expect(existsSync(routeRecordPath(home.root, intent.episodeId))).toBe(false);
      expect(assignment).toEqual(PLANNER_ASSIGNMENT);
      expect(role).toEqual(roles()[0]);
      return runtime;
    });

    const prepared = await prepareEpisodePlanWithRuntime({
      ...baseOptions(home.root, intent),
      runtimeForAssignment: factory,
    });

    expect(prepared).toMatchObject({
      planningTurnSkipped: false,
      plannerAttempts: 1,
      plan: { planningSource: "episode_planner" },
    });
    expect(factory).toHaveBeenCalledOnce();
    expect(runtime.calls).toHaveLength(1);
    expect(runtime.calls[0]!.req).toMatchObject({
      role: { name: "planner", delegation: { allow: ["research-fanout"] } },
      assignment: PLANNER_ASSIGNMENT,
      verdictSchema: EPISODE_PLAN_PROPOSAL_SCHEMA,
      context: {
        execution: {
          role: "planner",
          assignment: PLANNER_ASSIGNMENT,
          requiredCapabilities: [
            "cancellation",
            "session_resume",
            "structured_verdict",
            "tool_gate",
          ],
          roleDelegation: { allow: ["research-fanout"] },
        },
      },
    });

    const [step] = await readExecutionSteps(home.root, intent.episodeId);
    expect(step).toMatchObject({
      operation: "episode-planner/plan",
      runtime: PLANNER_ASSIGNMENT.harness,
      model: PLANNER_ASSIGNMENT.model,
      effort: PLANNER_ASSIGNMENT.effort,
      assignment_source: "configured",
      assignment_candidate_id: "configured",
      selection_reason: "Fixed EpisodePlanner boot assignment",
      status: "completed",
    });
    const envelope = await readEnvelope(home.root, "fixture", step!.run_id);
    expect(envelope).toMatchObject({
      episode_id: intent.episodeId,
      runtime: PLANNER_ASSIGNMENT.harness,
      model: PLANNER_ASSIGNMENT.model,
      effort: PLANNER_ASSIGNMENT.effort,
      assignment_source: "configured",
      provider_turn_ids: [step!.provider_turn_id],
      execution_step_ids: [step!.execution_step_id],
      status: "completed",
    });
    expect(await readFile(runPaths(home.root, "fixture", step!.run_id).brief, "utf8"))
      .toContain("[episode_planner_input]");
    expect(await readFile(runPaths(home.root, "fixture", step!.run_id).prompt, "utf8"))
      .toContain("Return exactly one EpisodePlan JSON object.");
    expect(existsSync(plannerPlanAcceptancePath(home.root, intent.episodeId))).toBe(true);

    const ledger = await readTurnRecords(home.root);
    expect(ledger).toEqual([
      expect.objectContaining({
        role: "planner",
        runtime: PLANNER_ASSIGNMENT.harness,
        model: PLANNER_ASSIGNMENT.model,
        effort: PLANNER_ASSIGNMENT.effort,
        providerTurnId: step!.provider_turn_id,
        executionStepId: step!.execution_step_id,
        episodeId: intent.episodeId,
        assignmentSource: "configured",
        assignmentCandidateId: "configured",
      }),
    ]);
  });

  it("uses one bounded structural repair with deterministic diagnostics", async () => {
    home = makeOrgHome();
    const intent = makeIntent();
    const runtime = new FakeRuntime([
      { result: completed(JSON.stringify({ schemaVersion: 99 })) },
      { result: completed(JSON.stringify(proposal(intent))) },
    ], "codex");

    const prepared = await prepareEpisodePlanWithRuntime({
      ...baseOptions(home.root, intent),
      runtimeForAssignment: () => runtime,
    });

    expect(prepared.plannerAttempts).toBe(2);
    expect(runtime.calls).toHaveLength(2);
    expect(runtime.calls[1]!.req.task).toContain("plan_structure_invalid");
    expect(runtime.calls[1]!.req.task).toContain('"attempt": 2');
    expect((await readExecutionSteps(home.root, intent.episodeId)).map((step) => step.operation))
      .toEqual(["episode-planner/plan", "episode-planner/repair"]);
    expect(await readTurnRecords(home.root)).toHaveLength(2);
  });

  it("confines planner attempts to the bounded manifest and denies every tool without network access", async () => {
    home = makeOrgHome();
    const intent = makeIntent();
    const runtime = new FakeRuntime([{
      toolActions: [{
        action: { tool: "read", input: { path: "package.json" } },
        fromSubagent: true,
      }],
      result: completed(JSON.stringify(proposal(intent))),
    }], "codex");
    const outerGate = vi.fn(() => ({ allow: true as const }));

    const prepared = await prepareEpisodePlanWithRuntime({
      ...baseOptions(home.root, intent),
      hooks: { gate: outerGate },
      networkAccess: true,
      runtimeForAssignment: () => runtime,
    });

    expect(prepared.plan.planningSource).toBe("episode_planner");
    expect(outerGate).not.toHaveBeenCalled();
    expect(runtime.calls[0]!.req.networkAccess).toBeUndefined();
    expect(runtime.calls[0]!.gateCalls).toEqual([{
      action: { tool: "read", input: { path: "package.json" } },
      decision: {
        allow: false,
        reason: expect.stringContaining("bounded intent"),
        escalate: false,
      },
    }]);
  });

  it("resumes a terminal attempt after a crash, settles once, and never calls the provider again", async () => {
    home = makeOrgHome();
    const intent = makeIntent();
    const runtime = new FakeRuntime([
      { result: completed(JSON.stringify(proposal(intent))) },
    ], "codex");
    let crash = true;
    const options = {
      ...baseOptions(home.root, intent),
      runtimeForAssignment: () => runtime,
      afterAttemptFinalized: () => {
        if (crash) {
          crash = false;
          throw new Error("simulated crash after terminal write");
        }
      },
    };

    await expect(prepareEpisodePlanWithRuntime(options))
      .rejects.toThrow("simulated crash after terminal write");
    expect(runtime.calls).toHaveLength(1);
    expect(await readTurnRecords(home.root)).toHaveLength(0);
    expect(await readCurrentEpisodePlan(home.root, intent.episodeId)).toBeUndefined();
    const [terminal] = await readExecutionSteps(home.root, intent.episodeId);
    expect((await readEnvelope(home.root, "fixture", terminal!.run_id)).status).toBe("running");

    const resumed = await prepareEpisodePlanWithRuntime(options);
    expect(resumed.plan.planningSource).toBe("episode_planner");
    expect(runtime.calls).toHaveLength(1);
    expect(await readTurnRecords(home.root)).toHaveLength(1);
    expect((await readEnvelope(home.root, "fixture", terminal!.run_id)).status).toBe("completed");

    const idempotent = await prepareEpisodePlanWithRuntime(options);
    expect(idempotent.plan).toEqual(resumed.plan);
    expect(runtime.calls).toHaveLength(1);
    expect(await readTurnRecords(home.root)).toHaveLength(1);
  });

  it("fails closed when returned session evidence names a different harness", async () => {
    home = makeOrgHome();
    const intent = makeIntent();
    const mismatched: TurnResult = {
      ...completed(JSON.stringify(proposal(intent))),
      session: { runtime: "claude", id: "wrong-provider-session" },
    };
    const runtime = new FakeRuntime([{ result: mismatched }], "codex");

    await expect(prepareEpisodePlanWithRuntime({
      ...baseOptions(home.root, intent),
      runtimeForAssignment: () => runtime,
    })).rejects.toMatchObject({ code: "error_episode_planner_failed" });

    expect(await readCurrentEpisodePlan(home.root, intent.episodeId)).toBeUndefined();
    expect(await readExecutionSteps(home.root, intent.episodeId)).toEqual([
      expect.objectContaining({
        runtime: "codex",
        status: "failed",
        error_code: "error_episode_planner_assignment_mismatch",
      }),
    ]);
  });

  it("aborts at the admitted per-attempt active-time ceiling", async () => {
    home = makeOrgHome();
    const intent = makeIntent();
    let observedAbort = false;
    const runtime: Runtime = {
      kind: "codex",
      runTurn: async (request) => new Promise<TurnResult>((resolve) => {
        request.signal!.addEventListener("abort", () => {
          observedAbort = true;
          resolve({
            ...completed(JSON.stringify(proposal(intent))),
            usage: {
              ...completed("unused").usage,
              wallClockMs: 10,
            },
          });
        }, { once: true });
      }),
    };
    const tightLimits: PlannerAdmissionLimits = {
      maxAttempts: 1,
      perAttempt: { ...LIMITS.perAttempt, activeTimeMs: 10 },
      aggregate: {
        providerTurns: 1,
        inputTokens: LIMITS.perAttempt.inputTokens,
        equivalentCostUsd: LIMITS.perAttempt.equivalentCostUsd,
        activeTimeMs: 10,
      },
    };

    await expect(prepareEpisodePlanWithRuntime({
      ...baseOptions(home.root, intent),
      limits: tightLimits,
      cancellationGraceMs: 20,
      runtimeForAssignment: () => runtime,
    })).rejects.toMatchObject({ code: "error_episode_planner_budget_unmeasured" });

    expect(observedAbort).toBe(true);
    expect(await readExecutionSteps(home.root, intent.episodeId)).toEqual([
      expect.objectContaining({
        status: "timed_out",
        error_code: "error_episode_planner_active_time_exceeded",
      }),
    ]);
  });

  it("keeps an execution-ready creator scope on the zero-provider path", async () => {
    home = makeOrgHome();
    const intent = makeIntent(creatorScope());
    const factory = vi.fn(() => new FakeRuntime([], "codex"));

    const prepared = await prepareEpisodePlanWithRuntime({
      ...baseOptions(home.root, intent),
      // A normalized creator scope never consumes the provider protocol.
      // Its bypass must remain valid even when no planner prompt bytes are
      // available to this invocation.
      promptText: "",
      runtimeForAssignment: factory,
    });

    expect(prepared).toMatchObject({
      planningTurnSkipped: true,
      plannerAttempts: 0,
      plan: { planningSource: "creator_scope" },
    });
    expect(factory).not.toHaveBeenCalled();
    expect(existsSync(plannerAdmissionPath(home.root, intent.episodeId))).toBe(false);
    expect(await readExecutionSteps(home.root, intent.episodeId)).toEqual([]);
    expect(await readTurnRecords(home.root)).toEqual([]);
  });
});

function baseOptions(root: string, intent: EpisodeIntent) {
  return {
    root,
    app: app(),
    roles: roles(),
    intent,
    promptText: "Return exactly one EpisodePlan JSON object.",
    context: CONTEXT,
    workdir: root,
    hooks: { gate: () => ({ allow: true as const }) },
    policyVersion: "episode-planner/test-v1",
    limits: LIMITS,
    now: () => NOW,
  };
}

function app(): AppEntry {
  return {
    name: "fixture",
    repo: "example/fixture",
    status: "live",
    budgetUsdMonth: 100,
    cadence: {},
  };
}

function roles(): RoleConfig[] {
  return [{
    name: "planner",
    runtime: PLANNER_ASSIGNMENT.harness,
    model: PLANNER_ASSIGNMENT.model,
    effort: PLANNER_ASSIGNMENT.effort,
    delegation: { allow: ["research-fanout"] },
    triggers: [],
    outputs: ["episode-plan"],
    maxTurnBudgetUsd: 2,
  }, {
    name: "builder",
    runtime: BUILDER_ASSIGNMENT.harness,
    model: BUILDER_ASSIGNMENT.model,
    effort: BUILDER_ASSIGNMENT.effort,
    delegation: { allow: [] },
    triggers: [],
    outputs: ["patch"],
    maxTurnBudgetUsd: 3,
  }];
}

function makeIntent(creator?: CreatorEpisodeScope): EpisodeIntent {
  return buildEpisodeIntent({
    episodeId: "ticket:fixture:runtime-planner",
    app: app(),
    roles: roles(),
    trigger: { kind: "ticket", sourceRef: "github:#42" },
    goal: "Fix a bounded parser bug",
    lifecycle: "existing-ticket",
    appStage: "growth",
    repositoryFacts: { revision: "abc123", clean: true },
    requestedConstraints: { network: false },
    hardBudget: { maxProviderTurns: 2, maxEquivalentCostUsd: 5 },
    requiredSafetyFacts: [],
    requiredCapabilitiesByRole: { builder: ["tool_gate"] },
    ...(creator === undefined ? {} : { creatorScope: creator }),
  });
}

function proposal(intent: EpisodeIntent): ProposedEpisodePlan {
  const step = providerStep();
  return {
    schemaVersion: 1,
    episodeId: intent.episodeId,
    version: 1,
    intentHash: episodeIntentHash(intent),
    summary: "Implement the bounded parser fix",
    workflowClass: "localized-bug",
    planningSource: "episode_planner",
    steps: [step],
    estimatedBudget: {
      providerTurns: 1,
      providerTurnBudgetUsd: step.maxTurnBudgetUsd,
      mechanicalOverheadUsd: 0,
      totalBudgetUsd: step.maxTurnBudgetUsd,
    },
    derivedSafetyRoute: {
      label: "quick",
      reasons: ["provider-value-is-recomputed"],
      gateStepIds: [],
      approvalStepIds: [],
    },
    createdAt: NOW.toISOString(),
  };
}

function providerStep(): ProposedProviderTurnStep {
  return {
    kind: "provider_turn",
    operation: "build/implement",
    id: "build",
    role: "builder",
    objective: "Implement the bounded parser fix",
    dependsOn: [],
    requiredCapabilities: ["tool_gate"],
    inputRefs: [{ ref: "ticket", required: true }],
    expectedOutputs: [{ id: "patch", kind: "patch", required: true }],
    maxTurnBudgetUsd: 3,
    selectionReason: "One localized implementation turn is sufficient",
  };
}

function creatorScope(): CreatorEpisodeScope {
  return {
    planningDisposition: "execution_ready",
    provenance: {
      source: "agent",
      creatorId: "parent-plan:1",
      createdAt: "2026-07-19T18:00:00.000Z",
      evidenceRefs: ["task:parent-plan-1"],
    },
    objective: "Fix the bounded parser bug",
    inScope: ["parser fix"],
    outOfScope: ["unrelated refactor"],
    acceptanceCriteria: ["focused parser test passes"],
    expectedArtifacts: [{ id: "patch", kind: "patch", required: true }],
    declaredConstraints: { network: false },
    safetyFacts: [],
    steps: [providerStep()],
  };
}

function completed(summary: string): TurnResult {
  return {
    status: "completed",
    summary,
    artifacts: [],
    session: { runtime: "codex", id: "thread-planner-test" },
    usage: {
      tokensIn: 25,
      tokensOut: 20,
      costUsd: 0.1,
      subagentTurns: 0,
      wallClockMs: 100,
      quality: "complete",
    },
    escalations: [],
  };
}
