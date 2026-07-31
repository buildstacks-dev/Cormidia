import { describe, expect, it } from "vitest";
import {
  deriveEpisodeSafetyRoute,
  episodeIntentHash,
  type EpisodeIntent,
  type EpisodePlan,
  type ProviderTurnStep,
} from "../../src/loop/episode-plan.js";
import {
  EPISODE_PLAN_EXECUTION_PIPELINE,
  routeAdmissionForEpisodePlan,
} from "../../src/loop/episode-route.js";

const STEP: ProviderTurnStep = {
  kind: "provider_turn",
  operation: "build/implement",
  id: "build",
  role: "builder",
  objective: "Implement the bounded change",
  dependsOn: [],
  requiredCapabilities: ["tool_gate"],
  assignment: { harness: "codex", model: "gpt-5.6-sol", effort: "high" },
  assignmentSource: "configured",
  inputRefs: [{ ref: "ticket", required: true }],
  expectedOutputs: [{ id: "patch", kind: "patch", required: true }],
  maxTurnBudgetUsd: 2,
  selectionReason: "localized implementation",
};

describe("EpisodePlan route projection", () => {
  it("projects exact plan assignments and hard ceilings without selecting work", () => {
    const intent = makeIntent();
    const plan = makePlan(intent);
    const projected = routeAdmissionForEpisodePlan({
      root: "/state",
      intent,
      plan,
      now: new Date("2026-07-19T20:00:00.000Z"),
    });

    expect(projected).toMatchObject({
      route: "quick",
      executionBounds: null,
      budgetOverrides: {
        provider_turns: 4,
        equivalent_cost_usd: 9,
      },
    });
    expect(projected.passes).toEqual([expect.objectContaining({
      pipeline: EPISODE_PLAN_EXECUTION_PIPELINE,
      pass: "build",
      role: "builder",
      runtime: "codex",
      model: "gpt-5.6-sol",
      effort: "high",
      assignment_source: "configured",
      assignment_candidate_id: "configured",
      plan_version: 1,
      plan_step_id: "build",
      provider_family: "openai",
    })]);
  });

  it("fails closed when assignment metadata is missing, duplicated, unavailable, or spoofed", () => {
    const cases: EpisodeIntent[] = [];
    const missing = makeIntent();
    missing.allowedAssignments = [];
    cases.push(missing);
    const duplicated = makeIntent();
    duplicated.allowedAssignments.push(structuredClone(duplicated.allowedAssignments[0]!));
    cases.push(duplicated);
    const unavailable = makeIntent();
    unavailable.allowedAssignments[0]!.available = false;
    cases.push(unavailable);
    const spoofed = makeIntent();
    spoofed.allowedAssignments[0]!.capabilities.push("intra_turn_fanout");
    cases.push(spoofed);

    for (const intent of cases) {
      const plan = makePlan(intent);
      expect(() => routeAdmissionForEpisodePlan({
        root: "/state",
        intent,
        plan,
        now: new Date("2026-07-19T20:00:00.000Z"),
      })).toThrow();
    }
  });

  it("rejects a non-derived route label", () => {
    const intent = makeIntent();
    const plan = { ...makePlan(intent), derivedSafetyRoute: {
      ...makePlan(intent).derivedSafetyRoute,
      label: "ceremonial",
    } };
    expect(() => routeAdmissionForEpisodePlan({
      root: "/state",
      intent,
      plan,
      now: new Date(),
    })).toThrow(/invalid derived route label/);
  });
});

function makeIntent(): EpisodeIntent {
  const intent: EpisodeIntent = {
    episodeId: "ticket:route:1",
    app: "fixture",
    assignmentMode: "fixed",
    trigger: { kind: "ticket" },
    goal: "Implement the bounded change",
    lifecycle: "existing-ticket",
    appStage: "growth",
    repositoryFacts: { revision: "abc" },
    requestedConstraints: {},
    hardBudget: {
      maxProviderTurns: 4,
      maxEquivalentCostUsd: 9,
    },
    availableRoles: [{
      role: "builder",
      responsibility: "implement",
      requiredCapabilities: ["tool_gate"],
      expectedOutputs: ["patch"],
      configuredAssignment: STEP.assignment,
    }],
    allowedAssignments: [{
      candidateId: "configured",
      role: "builder",
      assignment: STEP.assignment,
      providerFamily: "openai",
      capabilities: [
        "cache_telemetry",
        "cancellation",
        "intra_turn_fanout",
        "session_resume",
        "structured_verdict",
        "tool_gate",
      ],
      qualificationRef: "configured-role-assignment:builder",
      priceRef: "role.max_turn_budget_usd",
      maxTurnCostUsd: 2,
      available: true,
    }],
    requiredSafetyFacts: [],
  };
  return intent;
}

function makePlan(intent: EpisodeIntent): EpisodePlan {
  return {
    schemaVersion: 1,
    episodeId: intent.episodeId,
    version: 1,
    intentHash: episodeIntentHash(intent),
    summary: "Implement the bounded change",
    workflowClass: "localized-change",
    planningSource: "episode_planner",
    steps: [structuredClone(STEP)],
    estimatedBudget: {
      providerTurns: 1,
      providerTurnBudgetUsd: 2,
      mechanicalOverheadUsd: 0,
      totalBudgetUsd: 2,
    },
    derivedSafetyRoute: deriveEpisodeSafetyRoute([STEP], intent.requiredSafetyFacts),
    createdAt: "2026-07-19T19:00:00.000Z",
  };
}
