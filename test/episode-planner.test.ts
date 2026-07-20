import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  CreatorEpisodeScope,
  EpisodeIntent,
  ProposedEpisodePlan,
  ProposedProviderTurnStep,
} from "../src/loop/episode-plan.js";
import {
  deriveEpisodeSafetyRoute,
  episodeIntentHash,
  estimateEpisodePlanBudget,
  materializeEpisodePlanAssignments,
  validateEpisodePlan,
} from "../src/loop/episode-plan.js";
import {
  CreatorScopeConflictError,
  episodeIntentPath,
  prepareEpisodePlan,
  readPersistedEpisodeIntent,
} from "../src/org/episode-planner/coordinator.js";
import {
  buildEpisodeIntent,
  createEpisodePlanningPolicy,
} from "../src/org/episode-planner/policy.js";
import type { AppEntry } from "../src/org/apps.js";
import type { RoleConfig, RuntimeKind, TurnAssignment } from "../src/runtime/types.js";
import { makeOrgHome, type OrgHomeFixture } from "./fixtures/orgHome.js";

const FIXED: TurnAssignment = { harness: "codex", model: "gpt-5.6-sol", effort: "high" };
const ECONOMICAL: TurnAssignment = { harness: "codex", model: "gpt-5.6-sol", effort: "medium" };
const NOW = new Date("2026-07-19T18:00:00.000Z");

describe("EpisodePlanner coordination", () => {
  let home: OrgHomeFixture;
  afterEach(() => home?.cleanup());

  it("defaults legacy app config to fixed and exposes bounded exact candidates", () => {
    const intent = makeIntent(fixedApp());
    expect(intent.assignmentMode).toBe("fixed");
    expect(intent.allowedAssignments).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: "builder",
        candidateId: "configured",
        assignment: FIXED,
        maxTurnCostUsd: 3,
        available: true,
      }),
    ]));
    expect(intent.allowedAssignments.every((entry) => entry.qualificationRef.length > 0)).toBe(true);
  });

  it("keeps role requirements separate from adapter capability facts", () => {
    const intent = buildEpisodeIntent({
      episodeId: "ticket:fixture:capabilities",
      app: fixedApp(),
      roles: roles(),
      trigger: { kind: "ticket" },
      goal: "Exercise a capability boundary",
      lifecycle: "existing-ticket",
      appStage: "growth",
      repositoryFacts: { revision: "abc123" },
      requestedConstraints: {},
      hardBudget: { maxProviderTurns: 3, maxEquivalentCostUsd: 8 },
      requiredSafetyFacts: [],
      requiredCapabilitiesByRole: { builder: ["unregistered-role-requirement"] },
    });

    expect(intent.availableRoles.find((entry) => entry.role === "builder")?.requiredCapabilities)
      .toEqual(["unregistered-role-requirement"]);
    expect(intent.allowedAssignments.find((entry) => entry.role === "builder")?.capabilities)
      .not.toContain("unregistered-role-requirement");
  });

  it("keeps approved catalog rows valid when unavailable and rejects only a selected row", () => {
    const app = fixedApp();
    const intent = buildEpisodeIntent({
      episodeId: "ticket:fixture:availability",
      app,
      roles: roles(),
      trigger: { kind: "ticket" },
      goal: "Exercise assignment readiness",
      lifecycle: "existing-ticket",
      appStage: "growth",
      repositoryFacts: { revision: "abc123" },
      requestedConstraints: {},
      hardBudget: { maxProviderTurns: 3, maxEquivalentCostUsd: 8 },
      requiredSafetyFacts: [],
      requiredCapabilitiesByRole: { builder: ["tool_gate"] },
      assignmentAvailable: ({ role }) => role.name !== "planner",
    });
    const policy = createEpisodePlanningPolicy(app, { intent, roles: roles() });
    const plan = materializeEpisodePlanAssignments(proposal(intent, FIXED), policy.materialization);

    expect(intent.allowedAssignments.find((candidate) => candidate.role === "planner")?.available)
      .toBe(false);
    expect(validateEpisodePlan(plan, intent, policy.validation).issues).toEqual([]);

    const selectedUnavailable = {
      ...intent,
      allowedAssignments: intent.allowedAssignments.map((candidate) =>
        candidate.role === "builder" ? { ...candidate, available: false } : candidate),
    };
    const selectedPolicy = createEpisodePlanningPolicy(app, {
      intent: selectedUnavailable,
      roles: roles(),
    });
    const selectedPlan = materializeEpisodePlanAssignments(
      proposal(selectedUnavailable, FIXED),
      selectedPolicy.materialization,
    );
    const issues = validateEpisodePlan(selectedPlan, selectedUnavailable, selectedPolicy.validation).issues;
    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "plan_assignment_unavailable", stepId: "build" }),
    ]));
    expect(issues).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "plan_assignment_not_allowed",
        message: expect.stringContaining("intent assignment"),
      }),
    ]));
  });

  it("unions creator-declared safety floors into the deterministic intent", () => {
    const creator = scope();
    creator.safetyFacts = [{ kind: "secrets", evidenceRefs: ["creator:scope:secrets"] }];
    const intent = buildEpisodeIntent({
      episodeId: "ticket:fixture:creator-safety",
      app: fixedApp(),
      roles: roles(),
      trigger: { kind: "ticket" },
      goal: "Rotate a scoped secret",
      lifecycle: "existing-ticket",
      appStage: "growth",
      repositoryFacts: { revision: "abc123" },
      requestedConstraints: {},
      hardBudget: { maxProviderTurns: 3, maxEquivalentCostUsd: 8 },
      requiredSafetyFacts: [{ kind: "authentication", evidenceRefs: ["detector:auth"] }],
      creatorScope: creator,
    });

    expect(intent.requiredSafetyFacts).toEqual([
      { kind: "authentication", evidenceRefs: ["detector:auth"] },
      { kind: "secrets", evidenceRefs: ["creator:scope:secrets"] },
    ]);

    const dropped = {
      ...intent,
      requiredSafetyFacts: [{ kind: "authentication" as const, evidenceRefs: ["detector:auth"] }],
    };
    const policy = createEpisodePlanningPolicy(fixedApp(), { intent: dropped, roles: roles() });
    const plan = materializeEpisodePlanAssignments(proposal(dropped, FIXED), policy.materialization);
    expect(validateEpisodePlan(plan, dropped, policy.validation).issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "plan_creator_safety_fact_missing" }),
      ]),
    );
  });

  it("uses only canonical adapter capabilities and requires every role capability on the step", () => {
    const app = fixedApp();
    const intent = buildEpisodeIntent({
      episodeId: "ticket:fixture:capability-policy",
      app,
      roles: roles(),
      trigger: { kind: "ticket" },
      goal: "Exercise the role capability policy",
      lifecycle: "existing-ticket",
      appStage: "growth",
      repositoryFacts: { revision: "abc123" },
      requestedConstraints: {},
      hardBudget: { maxProviderTurns: 3, maxEquivalentCostUsd: 8 },
      requiredSafetyFacts: [],
      requiredCapabilitiesByRole: { builder: ["manufactured-capability"] },
    });
    const policy = createEpisodePlanningPolicy(app, {
      intent,
      roles: roles(),
      additionalCapabilitiesByRole: { builder: ["manufactured-capability"] },
    });
    const proposalValue = proposal(intent, FIXED);
    const build = proposalValue.steps[0];
    if (build?.kind !== "provider_turn") throw new Error("missing build step");

    const omitted = materializeEpisodePlanAssignments(proposalValue, policy.materialization);
    expect(policy.validation.capabilitiesFor("builder", FIXED)).not.toContain("manufactured-capability");
    expect(validateEpisodePlan(omitted, intent, policy.validation).issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "plan_capability_missing",
          message: expect.stringContaining("omits role-required capability manufactured-capability"),
        }),
      ]),
    );

    build.requiredCapabilities.push("manufactured-capability");
    const declared = materializeEpisodePlanAssignments(proposalValue, policy.materialization);
    expect(validateEpisodePlan(declared, intent, policy.validation).issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "plan_capability_missing",
          message: expect.stringContaining("assignment lacks role-required capability manufactured-capability"),
        }),
      ]),
    );
  });

  it("derives Builder-to-Reviewer independence from safety facts and compares provider families", () => {
    const app = fixedApp();
    const sameFamilyRoles = rolesWithReviewer("pi", "openai-codex/gpt-5.6-sol");
    const intent = buildEpisodeIntent({
      episodeId: "ticket:fixture:independent-review",
      app,
      roles: sameFamilyRoles,
      trigger: { kind: "ticket" },
      goal: "Implement and independently review a change",
      lifecycle: "existing-ticket",
      appStage: "growth",
      repositoryFacts: { revision: "abc123" },
      requestedConstraints: {},
      hardBudget: { maxProviderTurns: 3, maxEquivalentCostUsd: 8 },
      requiredSafetyFacts: [{ kind: "independent_review", evidenceRefs: ["policy:test"] }],
      requiredCapabilitiesByRole: { builder: ["tool_gate"], reviewer: ["tool_gate"] },
    });
    const policy = createEpisodePlanningPolicy(app, { intent, roles: sameFamilyRoles });

    const buildOnlyProposal = proposal(intent, FIXED);
    const buildOnly = materializeEpisodePlanAssignments(buildOnlyProposal, policy.materialization);
    expect(validateEpisodePlan(buildOnly, intent, policy.validation).issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "plan_independent_review_missing" })]),
    );

    const reviewStep: ProposedProviderTurnStep = {
      ...providerStep(),
      id: "review",
      role: "reviewer",
      operation: "review/verify",
      objective: "Independently review the bounded fix",
      dependsOn: ["build"],
      inputRefs: [{ ref: "patch", required: true }],
      expectedOutputs: [{ id: "accepted", kind: "verdict", required: true }],
      selectionReason: "independent review policy",
      maxTurnBudgetUsd: 2,
    };
    const reviewedProposal: ProposedEpisodePlan = {
      ...buildOnlyProposal,
      steps: [buildOnlyProposal.steps[0]!, reviewStep],
      estimatedBudget: estimateEpisodePlanBudget(
        materializeEpisodePlanAssignments(
          { ...buildOnlyProposal, steps: [buildOnlyProposal.steps[0]!, reviewStep] },
          policy.materialization,
        ).steps,
        0,
      ),
      derivedSafetyRoute: deriveEpisodeSafetyRoute(
        [buildOnlyProposal.steps[0]!, reviewStep],
        intent.requiredSafetyFacts,
      ),
    };
    const reviewed = materializeEpisodePlanAssignments(reviewedProposal, policy.materialization);
    expect(validateEpisodePlan(reviewed, intent, policy.validation).issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "plan_independent_review_invalid" })]),
    );
  });

  it("maps semantic safety facts into a governed workflow's executable gate vocabulary", () => {
    const app = fixedApp();
    const intent = {
      ...makeIntent(app),
      requiredSafetyFacts: [
        { kind: "authentication" as const, evidenceRefs: ["scope:auth"] },
        { kind: "data_migration" as const, evidenceRefs: ["scope:migration"] },
        { kind: "critical_operation" as const, evidenceRefs: ["scope:production"] },
      ],
    };
    const policy = createEpisodePlanningPolicy(app, {
      intent,
      roles: roles(),
      safetyFloorMapping: {
        gateKinds: {
          authentication: ["ticket/security"],
          data_migration: ["ticket/data-integrity", "ticket/rollback"],
        },
      },
    });

    expect(policy.validation.requiredGateKinds).toEqual([
      "ticket/data-integrity",
      "ticket/rollback",
      "ticket/security",
    ]);
    expect(policy.validation.requiredApprovalKinds).toEqual(["critical-operation"]);
  });

  it("re-joins durable assignment rows to current config before planner authorization", async () => {
    home = makeOrgHome();
    const app = fixedApp();
    const propose = vi.fn();
    const forgedProvider = structuredClone(makeIntent(app));
    forgedProvider.allowedAssignments[0]!.providerFamily = "forged-provider";
    await expect(prepareEpisodePlan({
      root: home.root,
      app,
      roles: roles(),
      intent: forgedProvider,
      propose,
      now: () => NOW,
    })).rejects.toThrow("not an exact projection of current org/app authority");

    const forgedTuple = structuredClone(makeIntent(app));
    forgedTuple.allowedAssignments[0]!.assignment = ECONOMICAL;
    await expect(prepareEpisodePlan({
      root: home.root,
      app,
      roles: roles(),
      intent: forgedTuple,
      propose,
      now: () => NOW,
    })).rejects.toThrow("not an exact projection of current org/app authority");
    expect(propose).not.toHaveBeenCalled();
  });

  it("runs EpisodePlanner for unscoped fixed work and persists intent then plan", async () => {
    home = makeOrgHome();
    const app = fixedApp();
    const intent = makeIntent(app);
    const propose = vi.fn(async () => proposal(intent, FIXED));
    const prepared = await prepareEpisodePlan({
      root: home.root,
      app,
      roles: roles(),
      intent,
      propose,
      now: () => NOW,
    });

    expect(prepared).toMatchObject({ planningTurnSkipped: false, plannerAttempts: 1 });
    expect(propose).toHaveBeenCalledOnce();
    expect(prepared.plan.steps[0]).toMatchObject({
      assignment: FIXED,
      assignmentSource: "configured",
    });
    expect(await readPersistedEpisodeIntent(home.root, intent.episodeId)).toEqual(intent);
    expect(episodeIntentPath(home.root, intent.episodeId)).toContain("intent.json");
  });

  it.each([
    { mode: "fixed" as const, assignment: undefined, expected: FIXED },
    { mode: "adaptive" as const, assignment: ECONOMICAL, expected: ECONOMICAL },
  ])("skips only an explicit execution-ready creator scope in $mode mode", async ({ mode, assignment, expected }) => {
    home = makeOrgHome();
    const app = mode === "fixed" ? fixedApp() : adaptiveApp();
    const creatorScope = scope(assignment);
    const intent = makeIntent(app, creatorScope);
    const propose = vi.fn();
    const prepared = await prepareEpisodePlan({
      root: home.root,
      app,
      roles: roles(),
      intent,
      propose,
      now: () => NOW,
    });

    expect(propose).not.toHaveBeenCalled();
    expect(prepared).toMatchObject({ planningTurnSkipped: true, plannerAttempts: 0 });
    expect(prepared.plan).toMatchObject({
      planningSource: "creator_scope",
      creatorProvenance: creatorScope.provenance,
    });
    expect(prepared.plan.steps[0]).toMatchObject({
      assignment: expected,
      assignmentSource: mode === "fixed" ? "configured" : "creator",
    });
  });

  it("preserves incomplete creator boundaries and invokes the planner", async () => {
    home = makeOrgHome();
    const app = fixedApp();
    const partial: CreatorEpisodeScope = { ...scope(), acceptanceCriteria: [] };
    const intent = makeIntent(app, partial);
    const propose = vi.fn(async ({ intent: proposedIntent }) => {
      expect(proposedIntent.creatorScope).toEqual(partial);
      return proposal(intent, FIXED);
    });
    const prepared = await prepareEpisodePlan({
      root: home.root,
      app,
      roles: roles(),
      intent,
      propose,
      now: () => NOW,
    });
    expect(prepared.planningTurnSkipped).toBe(false);
    expect(propose).toHaveBeenCalledOnce();
  });

  it("allows exactly one structural repair with deterministic diagnostics", async () => {
    home = makeOrgHome();
    const app = fixedApp();
    const intent = makeIntent(app);
    const propose = vi.fn(async ({ attempt, validationDiagnostics }) => {
      if (attempt === 1) return { schemaVersion: 99 };
      expect(validationDiagnostics).toEqual(expect.arrayContaining([
        expect.objectContaining({
          code: "plan_structure_invalid",
          path: "$.schemaVersion",
          constraint: "const",
          expected: "1",
          received: "99",
        }),
      ]));
      return proposal(intent, FIXED);
    });
    const prepared = await prepareEpisodePlan({
      root: home.root,
      app,
      roles: roles(),
      intent,
      propose,
      now: () => NOW,
    });
    expect(prepared.plannerAttempts).toBe(2);
    expect(propose).toHaveBeenCalledTimes(2);
  });

  it("rejects contradictory creator authority instead of repairing it with a planner", async () => {
    home = makeOrgHome();
    const app = adaptiveApp();
    const creatorScope = scope({ harness: "claude", model: "invented", effort: "high" });
    const intent = makeIntent(app, creatorScope);
    const propose = vi.fn();
    await expect(prepareEpisodePlan({
      root: home.root,
      app,
      roles: roles(),
      intent,
      propose,
      now: () => NOW,
    })).rejects.toBeInstanceOf(CreatorScopeConflictError);
    expect(propose).not.toHaveBeenCalled();
  });
});

function makeIntent(app: AppEntry, creatorScope?: CreatorEpisodeScope): EpisodeIntent {
  return buildEpisodeIntent({
    episodeId: "ticket:fixture:42",
    app,
    roles: roles(),
    trigger: { kind: "ticket", sourceRef: "github:#42" },
    goal: "Fix a bounded parser bug",
    lifecycle: "existing-ticket",
    appStage: "growth",
    repositoryFacts: { revision: "abc123", clean: true },
    requestedConstraints: { network: false },
    hardBudget: { maxProviderTurns: 3, maxEquivalentCostUsd: 8 },
    requiredSafetyFacts: [],
    requiredCapabilitiesByRole: { builder: ["tool_gate"] },
    ...(creatorScope === undefined ? {} : { creatorScope }),
  });
}

function fixedApp(): AppEntry {
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
    ...fixedApp(),
    execution: {
      assignmentMode: "adaptive",
      allowedAssignments: { builder: ["economical"] },
    },
  };
}

function roles(): RoleConfig[] {
  return [
    {
      name: "planner",
      runtime: "claude",
      model: "claude-opus-4-6",
      effort: "high",
      delegation: { allow: [] },
      triggers: [],
      outputs: ["episode-plan"],
      maxTurnBudgetUsd: 4,
    },
    {
      name: "builder",
      runtime: FIXED.harness,
      model: FIXED.model,
      effort: FIXED.effort,
      adaptiveAssignments: [{
        id: "economical",
        harness: ECONOMICAL.harness,
        model: ECONOMICAL.model,
        efforts: [ECONOMICAL.effort],
        providerFamily: "openai",
        capabilityRef: "codex/v1",
        qualificationRef: "qualification:test",
        pricing: {
          kind: "conservative_estimate",
          maxTurnCostUsd: 1,
          sourceRef: "test-price",
        },
      }],
      delegation: { allow: [] },
      triggers: [],
      outputs: ["patch"],
      maxTurnBudgetUsd: 3,
    },
  ];
}

function rolesWithReviewer(runtime: RuntimeKind, model: string): RoleConfig[] {
  return [
    ...roles(),
    {
      name: "reviewer",
      runtime,
      model,
      effort: "high",
      delegation: { allow: [] },
      triggers: [],
      outputs: ["review"],
      maxTurnBudgetUsd: 2,
    },
  ];
}

function scope(assignment?: TurnAssignment): CreatorEpisodeScope {
  return {
    planningDisposition: "execution_ready",
    provenance: {
      source: "agent",
      creatorId: "parent-plan:7",
      createdAt: "2026-07-19T17:00:00.000Z",
      evidenceRefs: ["task:parent-7"],
    },
    objective: "Fix the bounded parser bug",
    inScope: ["parser fix"],
    outOfScope: ["unrelated refactor"],
    acceptanceCriteria: ["focused test passes"],
    expectedArtifacts: [{ id: "patch", kind: "patch", required: true }],
    declaredConstraints: { network: false },
    safetyFacts: [],
    steps: [providerStep(assignment)],
  };
}

function providerStep(assignment?: TurnAssignment): ProposedProviderTurnStep {
  return {
    kind: "provider_turn",
    operation: "build/implement",
    id: "build",
    role: "builder",
    objective: "Implement the bounded fix",
    dependsOn: [],
    requiredCapabilities: ["tool_gate"],
    inputRefs: [{ ref: "ticket", required: true }],
    expectedOutputs: [{ id: "patch", kind: "patch", required: true }],
    maxTurnBudgetUsd: assignment === ECONOMICAL ? 1 : 3,
    selectionReason: "small localized implementation",
    ...(assignment === undefined ? {} : { assignment }),
  };
}

function proposal(intent: EpisodeIntent, assignment: TurnAssignment): ProposedEpisodePlan {
  const step = providerStep(intent.assignmentMode === "adaptive" ? assignment : undefined);
  return {
    schemaVersion: 1,
    episodeId: intent.episodeId,
    version: 1,
    intentHash: episodeIntentHash(intent),
    summary: "Implement the bounded fix",
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
