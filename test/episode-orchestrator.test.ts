import { existsSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { efficiencyEpisodeDir } from "../src/loop/efficiency.js";
import { readExecutionSteps } from "../src/loop/efficiency.js";
import { readEpisodePlanExecutionJournal } from "../src/loop/episode-plan-executor.js";
import {
  deriveEpisodeSafetyRoute,
  episodeIntentHash,
  readCurrentEpisodePlan,
  type CreatorEpisodeScope,
  type EpisodeIntent,
  type ProposedEpisodePlan,
  type ProposedProviderTurnStep,
} from "../src/loop/episode-plan.js";
import { readEpisodeReplanJournal } from "../src/loop/episode-replan.js";
import type { PlannerAdmissionLimits } from "../src/loop/planner-admission.js";
import {
  explainEpisode,
  orchestrateEpisode,
  previewEpisode,
  type EpisodeOrchestrationFacts,
} from "../src/org/episode-planner/orchestrator.js";
import { buildEpisodeIntent } from "../src/org/episode-planner/policy.js";
import type { AppEntry } from "../src/org/apps.js";
import { FakeRuntime } from "../src/runtime/testing/fakeRuntime.js";
import type { RuntimeReadinessProbe } from "../src/runtime/readiness.js";
import { readTurnRecords } from "../src/runtime/telemetry.js";
import type {
  ContextBundle,
  RoleConfig,
  TurnAssignment,
  TurnResult,
} from "../src/runtime/types.js";
import { makeOrgHome, type OrgHomeFixture } from "./fixtures/orgHome.js";

const NOW = new Date("2026-07-19T23:00:00.000Z");
const PLANNER: TurnAssignment = {
  harness: "codex",
  model: "gpt-planner-test",
  effort: "high",
};
const FIXED_BUILDER: TurnAssignment = {
  harness: "codex",
  model: "gpt-builder-test",
  effort: "high",
};
const ADAPTIVE_BUILDER: TurnAssignment = {
  harness: "claude",
  model: "claude-builder-test",
  effort: "medium",
};
const ADAPTIVE_FALLBACK: TurnAssignment = {
  harness: "codex",
  model: "gpt-builder-fallback-test",
  effort: "medium",
};
const LIMITS: PlannerAdmissionLimits = {
  maxAttempts: 2,
  perAttempt: {
    equivalentCostUsd: 0.5,
    activeTimeMs: 2_000,
  },
  aggregate: {
    providerTurns: 2,
    equivalentCostUsd: 1,
    activeTimeMs: 4_000,
  },
};
const CONTEXT: ContextBundle = { taste: [], memoryExcerpts: [] };
const READY_ASSIGNMENT_PROBE: RuntimeReadinessProbe = async (request) => ({
  runtime: request.runtime,
  models: [...request.models],
  status: "ready",
  detail: "test adapter ready; no model turn sent",
  durationMs: 1,
  billable: false,
});

describe("EpisodePlanner org orchestrator", () => {
  const homes: OrgHomeFixture[] = [];
  afterEach(() => {
    for (const home of homes.splice(0)) home.cleanup();
  });

  it.each([
    { assignmentMode: "fixed" as const, creatorScoped: false },
    { assignmentMode: "adaptive" as const, creatorScoped: false },
    { assignmentMode: "fixed" as const, creatorScoped: true },
    { assignmentMode: "adaptive" as const, creatorScoped: true },
  ])(
    "uses the only valid planning path for $assignmentMode / creator=$creatorScoped",
    async ({ assignmentMode, creatorScoped }) => {
      const home = makeOrgHome();
      homes.push(home);
      const app = fixtureApp(assignmentMode);
      const configuredRoles = roles();
      const episodeId = `ticket:orchestrator:${assignmentMode}:${creatorScoped ? "scoped" : "unscoped"}`;
      const scope = creatorScoped ? creatorScope(assignmentMode) : undefined;
      const facts = episodeFacts(episodeId, scope);
      const intent = buildEpisodeIntent({ ...facts, app, roles: configuredRoles });
      const plannerRuntime = new FakeRuntime(
        creatorScoped
          ? []
          : [{ result: completed(JSON.stringify(proposal(intent)), "codex") }],
        "codex",
      );
      const runtimeFactory = vi.fn(() => plannerRuntime);
      const readinessProbe = vi.fn(READY_ASSIGNMENT_PROBE);

      const result = await orchestrateEpisode({
        root: home.root,
        app,
        roles: configuredRoles,
        facts,
        mode: "plan_only",
        assignmentReadinessProbe: readinessProbe,
        planner: plannerInput(home.root, runtimeFactory),
      });

      expect(runtimeFactory).toHaveBeenCalledTimes(creatorScoped ? 0 : 1);
      expect(plannerRuntime.calls).toHaveLength(creatorScoped ? 0 : 1);
      expect(readinessProbe).toHaveBeenCalledTimes(assignmentMode === "adaptive" ? 2 : 0);
      expect(result.execution).toBeNull();
      expect(result.prepared).toMatchObject({
        planningTurnSkipped: creatorScoped,
        plannerAttempts: creatorScoped ? 0 : 1,
      });
      expect(result.prepared.plan).toMatchObject({
        planningSource: creatorScoped ? "creator_scope" : "episode_planner",
        steps: [expect.objectContaining({
          assignment: assignmentMode === "fixed" ? FIXED_BUILDER : ADAPTIVE_BUILDER,
          assignmentSource:
            assignmentMode === "fixed"
              ? "configured"
              : creatorScoped ? "creator" : "episode_planner",
        })],
      });
      expect(result.route).toMatchObject({
        episode_id: episodeId,
        policy_version: "episode-plan-route/v1",
        execution_bounds: null,
        terminal: null,
      });
      // Plan-only admission must not start the delivery DAG.
      expect(await readEpisodePlanExecutionJournal(home.root, episodeId)).toBeUndefined();
    },
  );

  it("preserves incomplete creator boundaries and invokes EpisodePlanner", async () => {
    const home = makeOrgHome();
    homes.push(home);
    const app = fixtureApp("fixed");
    const configuredRoles = roles();
    const incomplete: CreatorEpisodeScope = {
      ...creatorScope("fixed"),
      acceptanceCriteria: [],
    };
    const facts = episodeFacts("ticket:orchestrator:incomplete", incomplete);
    const intent = buildEpisodeIntent({ ...facts, app, roles: configuredRoles });
    const runtime = new FakeRuntime([{
      result: completed(JSON.stringify(proposal(intent)), "codex"),
    }], "codex");

    const result = await orchestrateEpisode({
      root: home.root,
      app,
      roles: configuredRoles,
      facts,
      mode: "plan_only",
      planner: plannerInput(home.root, () => runtime),
    });

    expect(runtime.calls).toHaveLength(1);
    expect(result.prepared.planningTurnSkipped).toBe(false);
    expect(result.prepared.creatorScopeAssessment.issues).toEqual([
      expect.objectContaining({ code: "creator_scope_acceptance_required" }),
    ]);
    expect(result.intent.creatorScope).toEqual(incomplete);
  });

  it("previews resolved facts without a runtime surface or durable writes", () => {
    const home = makeOrgHome();
    homes.push(home);
    const app = fixtureApp("adaptive");
    const configuredRoles = roles();
    const episodeId = "ticket:orchestrator:preview";
    const facts: EpisodeOrchestrationFacts = {
      ...episodeFacts(episodeId),
      requiredSafetyFacts: [{ kind: "authentication", evidenceRefs: ["ticket:auth-change"] }],
    };

    const preview = previewEpisode({
      app,
      roles: configuredRoles,
      facts,
      planner: {
        limits: LIMITS,
        requiredCapabilities: ["tool_gate", "structured_verdict"],
      },
    });

    expect(preview).toMatchObject({
      previewKind: "deterministic_intent_only",
      providerRuntimeCalled: false,
      durableStateWritten: false,
      exactProviderAuthoredPlan: null,
      assignmentMode: "adaptive",
      planningPath: "episode_planner_provider_turn",
      requiredSafetyFacts: [{ kind: "authentication", evidenceRefs: ["ticket:auth-change"] }],
      creatorScope: {
        executionReady: false,
        runEpisodePlanner: true,
        issues: [expect.objectContaining({ code: "creator_scope_absent" })],
      },
      plannerBoot: {
        assignment: PLANNER,
        limits: LIMITS,
        providerTurnRequired: true,
      },
    });
    expect(preview.intentHash).toBe(episodeIntentHash(preview.intent));
    expect(preview.allowedAssignments).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: "builder",
        candidateId: "economical",
        assignment: ADAPTIVE_BUILDER,
      }),
    ]));
    expect(preview.disclaimer).toContain("cannot claim the exact provider-authored EpisodePlan");
    expect(existsSync(efficiencyEpisodeDir(home.root, episodeId))).toBe(false);
  });

  it("executes the accepted DAG and explains exact persisted assignment evidence", async () => {
    const home = makeOrgHome();
    homes.push(home);
    const app = fixtureApp("adaptive");
    const configuredRoles = roles();
    const episodeId = "ticket:orchestrator:execute-explain";
    const facts = episodeFacts(episodeId, creatorScope("adaptive"));
    const plannerFactory = vi.fn(() => new FakeRuntime([], "codex"));
    const delivery = new FakeRuntime([{
      result: completed("Implemented the scoped change", "claude"),
    }], "claude");
    const deliveryFactory = vi.fn(() => delivery);

    const result = await orchestrateEpisode({
      root: home.root,
      app,
      roles: configuredRoles,
      facts,
      mode: "execute",
      assignmentReadinessProbe: READY_ASSIGNMENT_PROBE,
      planner: plannerInput(home.root, plannerFactory),
      execution: {
        workdir: home.root,
        hooks: { gate: () => ({ allow: true }) },
        runtimeForAssignment: deliveryFactory,
        contextForProviderStep: () => CONTEXT,
        mechanical: async (step) => ({ status: "completed", artifact: { gate: step.gate } }),
        approval: async (step) => ({ status: "completed", artifact: { approval: step.actionRef } }),
        telemetry: { orgDir: home.root, trigger: "manual" },
        now: monotonicClock(NOW),
      },
    });

    expect(plannerFactory).not.toHaveBeenCalled();
    expect(deliveryFactory).toHaveBeenCalledOnce();
    expect(delivery.calls).toHaveLength(1);
    expect(result.execution).toMatchObject({ status: "completed", completedStepIds: ["build"] });
    expect(result.route.terminal).toMatchObject({ status: "completed" });

    const explanation = await explainEpisode(home.root, episodeId);
    expect(explanation).toMatchObject({
      episodeId,
      planningSource: "creator_scope",
      planningTurnSkipped: true,
      route: { terminal: { status: "completed" } },
      journal: { status: "completed" },
      steps: [{
        id: "build",
        kind: "provider_turn",
        operation: "build/implement",
        status: "completed",
        role: "builder",
        assignment: ADAPTIVE_BUILDER,
        assignmentSource: "creator",
        selectionReason: "One localized implementation turn is sufficient",
        assignmentCandidateId: "economical",
        providerFamily: "anthropic",
        routeAuthorized: true,
      }],
    });
    expect(explanation.intentHash).toBe(episodeIntentHash(explanation.intent));
    expect(explanation.planHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("resumes an accepted fixed plan with its persisted tuple after configured defaults change", async () => {
    const home = makeOrgHome();
    homes.push(home);
    const app = fixtureApp("fixed");
    const configuredRoles = roles();
    const episodeId = "ticket:orchestrator:persisted-fixed-assignment";
    const facts = episodeFacts(episodeId, creatorScope("fixed"));

    await orchestrateEpisode({
      root: home.root,
      app,
      roles: configuredRoles,
      facts,
      mode: "plan_only",
      planner: plannerInput(home.root, () => new FakeRuntime([], "codex")),
    });

    const changedRoles = configuredRoles.map((role) =>
      role.name === "builder"
        ? { ...role, model: "gpt-builder-new-default", effort: "medium" as const }
        : role
    );
    const delivered = new FakeRuntime([{
      result: completed("Implemented with persisted assignment", "codex"),
    }], "codex");
    const deliveryFactory = vi.fn(() => delivered);
    const result = await orchestrateEpisode({
      root: home.root,
      app,
      roles: changedRoles,
      facts,
      mode: "execute",
      planner: plannerInput(home.root, () => new FakeRuntime([], "codex")),
      execution: {
        workdir: home.root,
        hooks: { gate: () => ({ allow: true }) },
        runtimeForAssignment: deliveryFactory,
        contextForProviderStep: () => CONTEXT,
        mechanical: async (step) => ({ status: "completed", artifact: { gate: step.gate } }),
        approval: async (step) => ({ status: "completed", artifact: { approval: step.actionRef } }),
        telemetry: { orgDir: home.root, trigger: "manual" },
        now: monotonicClock(NOW),
      },
    });

    expect(result.execution?.status).toBe("completed");
    expect(deliveryFactory).toHaveBeenCalledWith(
      FIXED_BUILDER,
      expect.objectContaining({ name: "builder", model: "gpt-builder-new-default" }),
    );
    expect(delivered.calls[0]?.req.assignment).toEqual(FIXED_BUILDER);
  });

  it("fails an adaptive planner boot before provider construction when readiness is negative", async () => {
    const home = makeOrgHome();
    homes.push(home);
    const app = fixtureApp("adaptive");
    const configuredRoles = roles();
    const episodeId = "ticket:orchestrator:planner-unavailable";
    const runtimeFactory = vi.fn(() => new FakeRuntime([], "codex"));
    const readinessProbe: RuntimeReadinessProbe = async (request) => ({
      runtime: request.runtime,
      models: [...request.models],
      status: request.models.includes(PLANNER.model) ? "unauthenticated" : "ready",
      detail: request.models.includes(PLANNER.model)
        ? "test planner credential unavailable"
        : "test adapter ready",
      durationMs: 1,
      billable: false,
      ...(request.models.includes(PLANNER.model)
        ? { errorCode: "error_adapter_unauthenticated" }
        : {}),
    });

    await expect(orchestrateEpisode({
      root: home.root,
      app,
      roles: configuredRoles,
      facts: episodeFacts(episodeId),
      mode: "plan_only",
      assignmentReadinessProbe: readinessProbe,
      planner: plannerInput(home.root, runtimeFactory),
    })).rejects.toMatchObject({ code: "plan_assignment_unavailable" });
    expect(runtimeFactory).not.toHaveBeenCalled();
  });

  it("rechecks an adaptive tuple and adopts one planner-authored corrective V2 without substitution", async () => {
    const home = makeOrgHome();
    homes.push(home);
    const app = fixtureApp("adaptive");
    const configuredRoles = roles();
    configuredRoles[1]!.adaptiveAssignments!.push({
      id: "fallback",
      harness: ADAPTIVE_FALLBACK.harness,
      model: ADAPTIVE_FALLBACK.model,
      efforts: [ADAPTIVE_FALLBACK.effort],
      providerFamily: "openai",
      capabilityRef: "codex/v1",
      qualificationRef: "qualification:test:codex-builder-fallback",
      pricing: {
        kind: "conservative_estimate",
        maxTurnCostUsd: 1,
        sourceRef: "qualification:test:price",
      },
    });
    app.execution!.allowedAssignments!.builder = ["economical", "fallback"];
    const episodeId = "ticket:orchestrator:assignment-became-unavailable";
    const scope = creatorScope("adaptive");
    const intent = buildEpisodeIntent({
      ...episodeFacts(episodeId, scope),
      app,
      roles: configuredRoles,
    });
    const revisedStep = providerStep(ADAPTIVE_FALLBACK);
    const revision: ProposedEpisodePlan = {
      schemaVersion: 1,
      episodeId,
      version: 2,
      intentHash: episodeIntentHash(intent),
      summary: "Use the approved available Builder assignment",
      workflowClass: "localized-bug",
      planningSource: "creator_scope",
      creatorProvenance: structuredClone(scope.provenance),
      steps: [revisedStep],
      estimatedBudget: {
        providerTurns: 1,
        providerTurnBudgetUsd: revisedStep.maxTurnBudgetUsd,
        mechanicalOverheadUsd: 0,
        totalBudgetUsd: revisedStep.maxTurnBudgetUsd,
      },
      derivedSafetyRoute: deriveEpisodeSafetyRoute([revisedStep], []),
      createdAt: NOW.toISOString(),
    };
    const revisionRuntime = new FakeRuntime([{
      result: completed(JSON.stringify(revision), "codex"),
    }], "codex");
    const plannerFactory = vi.fn(() => revisionRuntime);
    let builderChecks = 0;
    const readinessProbe: RuntimeReadinessProbe = async (request) => {
      const builder = request.models.includes(ADAPTIVE_BUILDER.model);
      if (builder) builderChecks += 1;
      const unavailable = builder && builderChecks > 1;
      return {
        runtime: request.runtime,
        models: [...request.models],
        status: unavailable ? "transport_unavailable" : "ready",
        detail: unavailable ? "test transport disappeared" : "test adapter ready",
        durationMs: 1,
        billable: false,
        ...(unavailable ? { errorCode: "error_adapter_transport_unavailable" } : {}),
      };
    };
    const deliveryFactory = vi.fn(() => new FakeRuntime([], "claude"));
    const customProvider = vi.fn(async () => ({
      status: "completed" as const,
      artifact: { output: "should-not-run" },
    }));

    const result = await orchestrateEpisode({
      root: home.root,
      app,
      roles: configuredRoles,
      facts: episodeFacts(episodeId, scope),
      mode: "execute",
      assignmentReadinessProbe: readinessProbe,
      planner: plannerInput(home.root, plannerFactory),
      execution: {
        workdir: home.root,
        hooks: { gate: () => ({ allow: true }) },
        runtimeForAssignment: deliveryFactory,
        contextForProviderStep: () => CONTEXT,
        provider: customProvider,
        mechanical: async (step) => ({ status: "completed", artifact: { gate: step.gate } }),
        approval: async (step) => ({ status: "completed", artifact: { approval: step.actionRef } }),
        telemetry: { orgDir: home.root, trigger: "manual" },
        now: () => NOW,
      },
    });

    expect(result.execution).toMatchObject({
      status: "running",
      planVersion: 2,
      nextStepId: "build",
      replan: {
        kind: "assignment_unavailable",
        status: "accepted",
        revisionVersion: 2,
      },
    });
    expect(deliveryFactory).not.toHaveBeenCalled();
    expect(customProvider).not.toHaveBeenCalled();
    expect(builderChecks).toBe(2);
    expect(plannerFactory).toHaveBeenCalledOnce();
    expect(revisionRuntime.calls).toHaveLength(1);
    expect((await readTurnRecords(home.root)).filter((row) =>
      row.pipeline === "episode-planner" && row.pass === "plan"))
      .toHaveLength(1);
  });

  it("uses the production EpisodePlanner callback to correct a failed gate with V2", async () => {
    const home = makeOrgHome();
    homes.push(home);
    const app = fixtureApp("fixed");
    const configuredRoles = roles();
    const episodeId = "ticket:orchestrator:failed-gate-revision";
    const scope = creatorScope("fixed");
    const intent = buildEpisodeIntent({
      ...episodeFacts(episodeId, scope),
      app,
      roles: configuredRoles,
    });
    const diagnose = {
      kind: "mechanical_gate" as const,
      id: "diagnose-failure",
      objective: "Capture the focused failure before retrying implementation",
      dependsOn: [],
      gate: "focused-diagnostic",
      inputRefs: [{ ref: "plan-execution:build", required: true }],
      expectedOutputs: [{ id: "diagnosis", kind: "evidence", required: true }],
    };
    const revisedBuild = providerStep();
    revisedBuild.dependsOn = [diagnose.id];
    revisedBuild.inputRefs = [
      ...revisedBuild.inputRefs,
      { ref: "plan-output:diagnosis", required: true },
    ];
    const revision: ProposedEpisodePlan = {
      schemaVersion: 1,
      episodeId,
      version: 2,
      intentHash: episodeIntentHash(intent),
      summary: "Diagnose the failed gate before the bounded implementation retry",
      workflowClass: "localized-bug-correction",
      planningSource: "creator_scope",
      creatorProvenance: structuredClone(scope.provenance),
      steps: [diagnose, revisedBuild],
      estimatedBudget: {
        providerTurns: 1,
        providerTurnBudgetUsd: revisedBuild.maxTurnBudgetUsd,
        mechanicalOverheadUsd: 0,
        totalBudgetUsd: revisedBuild.maxTurnBudgetUsd,
      },
      derivedSafetyRoute: deriveEpisodeSafetyRoute([diagnose, revisedBuild], []),
      createdAt: NOW.toISOString(),
    };
    const revisionRuntime = new FakeRuntime([{
      result: completed(JSON.stringify(revision), "codex"),
    }], "codex");
    const provider = vi.fn(async () => ({
      status: "failed" as const,
      reasonCode: "ticket_quality_gate_failed",
      summary: "focused test exposed a missing diagnostic",
    }));

    const result = await orchestrateEpisode({
      root: home.root,
      app,
      roles: configuredRoles,
      facts: episodeFacts(episodeId, scope),
      mode: "execute",
      planner: plannerInput(home.root, () => revisionRuntime),
      execution: {
        workdir: home.root,
        hooks: { gate: () => ({ allow: true }) },
        runtimeForAssignment: () => new FakeRuntime([], "codex"),
        contextForProviderStep: () => CONTEXT,
        provider,
        mechanical: async (step) => ({ status: "completed", artifact: { gate: step.gate } }),
        approval: async (step) => ({ status: "completed", artifact: { approval: step.actionRef } }),
        telemetry: { orgDir: home.root, trigger: "manual" },
        now: () => NOW,
      },
    });

    expect(result.execution).toMatchObject({
      status: "running",
      planVersion: 2,
      nextStepId: "diagnose-failure",
      replan: { kind: "failed_gate", status: "accepted", revisionVersion: 2 },
    });
    expect(provider).toHaveBeenCalledOnce();
    expect(revisionRuntime.calls).toHaveLength(1);
    expect(await readCurrentEpisodePlan(home.root, episodeId)).toMatchObject({ version: 2 });
    expect((await readTurnRecords(home.root)).filter((row) =>
      row.pipeline === "episode-planner" && row.pass === "plan"))
      .toHaveLength(1);
  });

  it("bounds revision planning to one repair and durably rejects an invalid proposal", async () => {
    const home = makeOrgHome();
    homes.push(home);
    const app = fixtureApp("fixed");
    const configuredRoles = roles();
    const episodeId = "ticket:orchestrator:revision-rejected";
    const scope = creatorScope("fixed");
    const revisionRuntime = new FakeRuntime([{
      result: completed("{}", "codex"),
    }, {
      result: completed("{}", "codex"),
    }], "codex");

    const result = await orchestrateEpisode({
      root: home.root,
      app,
      roles: configuredRoles,
      facts: episodeFacts(episodeId, scope),
      mode: "execute",
      planner: plannerInput(home.root, () => revisionRuntime),
      execution: {
        workdir: home.root,
        hooks: { gate: () => ({ allow: true }) },
        runtimeForAssignment: () => new FakeRuntime([], "codex"),
        contextForProviderStep: () => CONTEXT,
        provider: async () => ({
          status: "failed",
          reasonCode: "ticket_quality_gate_failed",
          summary: "focused gate failed",
        }),
        mechanical: async (step) => ({ status: "completed", artifact: { gate: step.gate } }),
        approval: async (step) => ({ status: "completed", artifact: { approval: step.actionRef } }),
        telemetry: { orgDir: home.root, trigger: "manual" },
        now: () => NOW,
      },
    });

    expect(result.execution).toMatchObject({
      status: "failed",
      planVersion: 1,
      replan: {
        kind: "failed_gate",
        status: "rejected",
        revisionVersion: null,
        reason: expect.stringContaining("EpisodePlanner failed after 2 bounded attempt"),
      },
    });
    expect(revisionRuntime.calls).toHaveLength(2);
    expect(await readCurrentEpisodePlan(home.root, episodeId)).toMatchObject({ version: 1 });
    expect(await readEpisodeReplanJournal(home.root, episodeId)).toMatchObject({
      maxRevisions: 2,
      records: [{ status: "rejected", revisionVersion: null }],
    });
    expect((await readExecutionSteps(home.root, episodeId)).filter((step) =>
      step.operation.startsWith("episode-planner/revision-v2-"))).toHaveLength(2);
    expect((await readTurnRecords(home.root)).filter((row) =>
      row.pipeline === "episode-planner"))
      .toHaveLength(2);
  });

  it("rejects a valid revision before pointer advance when its future work no longer fits", async () => {
    const home = makeOrgHome();
    homes.push(home);
    const app = fixtureApp("fixed");
    const configuredRoles = roles();
    const episodeId = "ticket:orchestrator:revision-budget-headroom";
    const scope = creatorScope("fixed");
    const facts: EpisodeOrchestrationFacts = {
      ...episodeFacts(episodeId, scope),
      hardBudget: {
        maxProviderTurns: 2,
        maxEquivalentCostUsd: 5,
        maxActiveTimeMs: 30_000,
      },
    };
    const intent = buildEpisodeIntent({ ...facts, app, roles: configuredRoles });
    const revisedBuild = providerStep();
    const revision: ProposedEpisodePlan = {
      schemaVersion: 1,
      episodeId,
      version: 2,
      intentHash: episodeIntentHash(intent),
      summary: "Retry the bounded implementation after the failed gate",
      workflowClass: "localized-bug-correction",
      planningSource: "creator_scope",
      creatorProvenance: structuredClone(scope.provenance),
      steps: [revisedBuild],
      estimatedBudget: {
        providerTurns: 1,
        providerTurnBudgetUsd: revisedBuild.maxTurnBudgetUsd,
        mechanicalOverheadUsd: 0,
        totalBudgetUsd: revisedBuild.maxTurnBudgetUsd,
      },
      derivedSafetyRoute: deriveEpisodeSafetyRoute([revisedBuild], []),
      createdAt: NOW.toISOString(),
    };
    const revisionRuntime = new FakeRuntime([{
      result: completed(JSON.stringify(revision), "codex"),
    }], "codex");
    const deliveryRuntime = new FakeRuntime([{
      result: {
        ...completed("focused gate failed", "codex"),
        status: "failed",
        errorCode: "ticket_quality_gate_failed",
        artifacts: [],
      },
    }], "codex");

    const result = await orchestrateEpisode({
      root: home.root,
      app,
      roles: configuredRoles,
      facts,
      mode: "execute",
      planner: plannerInput(home.root, () => revisionRuntime),
      execution: {
        workdir: home.root,
        hooks: { gate: () => ({ allow: true }) },
        runtimeForAssignment: () => deliveryRuntime,
        contextForProviderStep: () => CONTEXT,
        mechanical: async (step) => ({ status: "completed", artifact: { gate: step.gate } }),
        approval: async (step) => ({ status: "completed", artifact: { approval: step.actionRef } }),
        telemetry: { orgDir: home.root, trigger: "manual" },
        now: () => NOW,
      },
    });

    expect(result.execution).toMatchObject({
      status: "failed",
      planVersion: 1,
      replan: {
        status: "rejected",
        revisionVersion: null,
        reason: expect.stringContaining("cannot publish EpisodePlan v2"),
      },
    });
    expect(revisionRuntime.calls).toHaveLength(1);
    expect(await readCurrentEpisodePlan(home.root, episodeId)).toMatchObject({ version: 1 });
    expect(result.route).toMatchObject({ current_plan_version: 1, terminal: null });
  });

  it("recovers and settles one terminal revision-planner turn exactly once", async () => {
    const home = makeOrgHome();
    homes.push(home);
    const app = fixtureApp("fixed");
    const configuredRoles = roles();
    const episodeId = "ticket:orchestrator:revision-settlement-recovery";
    const scope = creatorScope("fixed");
    const facts = episodeFacts(episodeId, scope);
    const intent = buildEpisodeIntent({ ...facts, app, roles: configuredRoles });
    const revisedBuild = providerStep();
    const revision: ProposedEpisodePlan = {
      schemaVersion: 1,
      episodeId,
      version: 2,
      intentHash: episodeIntentHash(intent),
      summary: "Retry the bounded implementation after the material failure",
      workflowClass: "localized-bug-correction",
      planningSource: "creator_scope",
      creatorProvenance: structuredClone(scope.provenance),
      steps: [revisedBuild],
      estimatedBudget: {
        providerTurns: 1,
        providerTurnBudgetUsd: revisedBuild.maxTurnBudgetUsd,
        mechanicalOverheadUsd: 0,
        totalBudgetUsd: revisedBuild.maxTurnBudgetUsd,
      },
      derivedSafetyRoute: deriveEpisodeSafetyRoute([revisedBuild], []),
      createdAt: NOW.toISOString(),
    };
    const revisionRuntime = new FakeRuntime([{
      result: completed(JSON.stringify(revision), "codex"),
    }], "codex");
    const runtimeFactory = vi.fn(() => revisionRuntime);
    let injectFault = true;
    const planner = {
      ...plannerInput(home.root, runtimeFactory),
      afterAttemptFinalized: () => {
        if (injectFault) throw new Error("fault after terminal revision evidence");
      },
    };
    const execution = {
      workdir: home.root,
      hooks: { gate: () => ({ allow: true as const }) },
      runtimeForAssignment: () => new FakeRuntime([], "codex"),
      contextForProviderStep: () => CONTEXT,
      provider: async () => ({
        status: "failed" as const,
        reasonCode: "ticket_quality_gate_failed",
        summary: "focused gate failed",
      }),
      mechanical: async (step: { gate: string }) => ({
        status: "completed" as const,
        artifact: { gate: step.gate },
      }),
      approval: async (step: { actionRef: string }) => ({
        status: "completed" as const,
        artifact: { approval: step.actionRef },
      }),
      telemetry: { orgDir: home.root, trigger: "manual" as const },
      now: () => NOW,
    };

    const first = await orchestrateEpisode({
      root: home.root,
      app,
      roles: configuredRoles,
      facts,
      mode: "execute",
      planner,
      execution,
    });
    expect(first.execution).toMatchObject({
      status: "failed",
      replan: { status: "pending", revisionVersion: null },
    });
    expect(runtimeFactory).toHaveBeenCalledOnce();
    expect((await readTurnRecords(home.root)).filter((row) =>
      row.pipeline === "episode-planner")).toHaveLength(0);

    injectFault = false;
    const resumed = await orchestrateEpisode({
      root: home.root,
      app,
      roles: configuredRoles,
      facts,
      mode: "execute",
      planner,
      execution,
    });
    expect(resumed.execution).toMatchObject({
      status: "running",
      planVersion: 2,
      replan: { status: "accepted", revisionVersion: 2 },
    });
    expect(runtimeFactory).toHaveBeenCalledOnce();
    expect(revisionRuntime.calls).toHaveLength(1);
    const plannerRows = (await readTurnRecords(home.root)).filter((row) =>
      row.pipeline === "episode-planner");
    expect(plannerRows).toHaveLength(1);
    expect(new Set(plannerRows.map((row) => row.providerTurnId)).size).toBe(1);
  });
});

function fixtureApp(assignmentMode: "fixed" | "adaptive"): AppEntry {
  return {
    name: "fixture",
    repo: "example/fixture",
    status: "live",
    budgetUsdMonth: 100,
    cadence: {},
    ...(assignmentMode === "fixed"
      ? {}
      : {
          execution: {
            assignmentMode,
            allowedAssignments: { builder: ["economical"] },
          },
        }),
  };
}

function roles(): RoleConfig[] {
  return [{
    name: "planner",
    runtime: PLANNER.harness,
    model: PLANNER.model,
    effort: PLANNER.effort,
    delegation: { allow: [] },
    triggers: [],
    outputs: ["episode-plan"],
    maxTurnBudgetUsd: 2,
  }, {
    name: "builder",
    runtime: FIXED_BUILDER.harness,
    model: FIXED_BUILDER.model,
    effort: FIXED_BUILDER.effort,
    adaptiveAssignments: [{
      id: "economical",
      harness: ADAPTIVE_BUILDER.harness,
      model: ADAPTIVE_BUILDER.model,
      efforts: [ADAPTIVE_BUILDER.effort],
      providerFamily: "anthropic",
      capabilityRef: "claude/v1",
      qualificationRef: "qualification:test:claude-builder",
      pricing: {
        kind: "conservative_estimate",
        maxTurnCostUsd: 1,
        sourceRef: "qualification:test:price",
      },
    }],
    delegation: { allow: [] },
    triggers: [],
    outputs: ["patch"],
    maxTurnBudgetUsd: 2,
  }];
}

function episodeFacts(
  episodeId: string,
  creatorScope?: CreatorEpisodeScope,
): EpisodeOrchestrationFacts {
  return {
    episodeId,
    trigger: { kind: "ticket", sourceRef: "github:#42" },
    goal: "Implement the bounded parser fix",
    lifecycle: "existing-ticket",
    appStage: "growth",
    repositoryFacts: { revision: "abc123", clean: true },
    requestedConstraints: { network: false },
    hardBudget: {
      maxProviderTurns: 4,
      maxEquivalentCostUsd: 5,
      maxActiveTimeMs: 30_000,
    },
    requiredSafetyFacts: [],
    requiredCapabilitiesByRole: { builder: ["tool_gate"] },
    ...(creatorScope === undefined ? {} : { creatorScope }),
  };
}

function plannerInput(
  root: string,
  runtimeForAssignment: NonNullable<Parameters<typeof orchestrateEpisode>[0]["planner"]>["runtimeForAssignment"],
) {
  return {
    promptText: "Return exactly one EpisodePlan JSON object.",
    context: CONTEXT,
    workdir: root,
    hooks: { gate: () => ({ allow: true as const }) },
    runtimeForAssignment,
    policyVersion: "episode-planner/orchestrator-test-v1",
    limits: LIMITS,
    now: () => NOW,
  };
}

function creatorScope(assignmentMode: "fixed" | "adaptive"): CreatorEpisodeScope {
  return {
    planningDisposition: "execution_ready",
    provenance: {
      source: "agent",
      creatorId: "parent-plan:orchestrator-test",
      createdAt: "2026-07-19T22:55:00.000Z",
      evidenceRefs: ["task:parent-plan"],
    },
    objective: "Implement the bounded parser fix",
    inScope: ["localized parser code"],
    outOfScope: ["parser redesign"],
    acceptanceCriteria: ["focused parser test passes"],
    expectedArtifacts: [{ id: "patch", kind: "patch", required: true }],
    declaredConstraints: { network: false },
    safetyFacts: [],
    steps: [providerStep(assignmentMode === "adaptive" ? ADAPTIVE_BUILDER : undefined)],
  };
}

function providerStep(assignment?: TurnAssignment): ProposedProviderTurnStep {
  return {
    kind: "provider_turn",
    operation: "build/implement",
    id: "build",
    role: "builder",
    objective: "Implement the bounded parser fix",
    dependsOn: [],
    requiredCapabilities: ["tool_gate"],
    inputRefs: [{ ref: "github:#42", required: true }],
    expectedOutputs: [{ id: "patch", kind: "patch", required: true }],
    maxTurnBudgetUsd: 1,
    selectionReason: "One localized implementation turn is sufficient",
    ...(assignment === undefined ? {} : { assignment }),
  };
}

function proposal(intent: EpisodeIntent): ProposedEpisodePlan {
  const step = providerStep(
    intent.assignmentMode === "adaptive" ? ADAPTIVE_BUILDER : undefined,
  );
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
    derivedSafetyRoute: deriveEpisodeSafetyRoute([step], intent.requiredSafetyFacts),
    createdAt: NOW.toISOString(),
  };
}

function completed(summary: string, runtime: TurnResult["session"]["runtime"]): TurnResult {
  return {
    status: "completed",
    summary,
    artifacts: [],
    session: { runtime, id: `session-${runtime}-orchestrator-test` },
    usage: {
      tokensIn: 25,
      tokensOut: 10,
      costUsd: 0.1,
      subagentTurns: 0,
      wallClockMs: 100,
      quality: "complete",
    },
    escalations: [],
  };
}

function monotonicClock(start: Date): () => Date {
  let current = start.getTime() + 1_000;
  return () => {
    const value = new Date(current);
    current += 1_000;
    return value;
  };
}
