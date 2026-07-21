import { describe, expect, it } from "vitest";
import {
  EPISODE_PLAN_PROPOSAL_SCHEMA,
  episodeIntentHash,
  type EpisodePlan,
  type EpisodeIntent,
} from "../src/loop/episode-plan.js";
import type { EpisodeReplanRecord } from "../src/loop/episode-replan.js";
import {
  renderEpisodePlannerBrief,
  renderEpisodePlannerRevisionBrief,
} from "../src/org/episode-planner/brief.js";

describe("EpisodePlanner bounded brief", () => {
  it("renders exact intent, clock, attempt, and sorted repair diagnostics", () => {
    const intent = fixtureIntent();
    const rendered = renderEpisodePlannerBrief({
      intent,
      attempt: 2,
      proposalCreatedAt: "2026-07-19T18:00:00.000Z",
      validationDiagnostics: [
        {
          code: "plan_structure_invalid",
          message: "bad output kind",
          stepId: "z",
          path: "$.steps[0].expectedOutputs[0].kind",
          constraint: "minLength",
          expected: "at least 1 non-blank character(s)",
          received: '""',
        },
        { code: "plan_assignment_not_allowed", message: "bad tuple", stepId: "a" },
      ],
    });
    const payload = JSON.parse(rendered.slice(rendered.indexOf("\n") + 1)) as Record<string, unknown>;
    expect(payload).toMatchObject({
      schemaVersion: 1,
      kind: "episode-planner-input",
      attempt: 2,
      proposalCreatedAt: "2026-07-19T18:00:00.000Z",
      requiredPlanIdentity: {
        schemaVersion: 1,
        episodeId: intent.episodeId,
        version: 1,
        planningSource: "episode_planner",
        createdAt: "2026-07-19T18:00:00.000Z",
      },
      proposalSchema: EPISODE_PLAN_PROPOSAL_SCHEMA,
      intent,
      validationDiagnostics: [
        { code: "plan_assignment_not_allowed", stepId: "a" },
        {
          code: "plan_structure_invalid",
          stepId: "z",
          path: "$.steps[0].expectedOutputs[0].kind",
          constraint: "minLength",
          expected: "at least 1 non-blank character(s)",
          received: '""',
        },
      ],
    });
  });

  it("fails closed before provider construction on suspected secret material", () => {
    const intent = fixtureIntent();
    intent.goal = `inspect token=${"a".repeat(24)}`;
    expect(() => renderEpisodePlannerBrief({
      intent,
      attempt: 1,
      proposalCreatedAt: "2026-07-19T18:00:00.000Z",
      validationDiagnostics: [],
    })).toThrow(/suspected secret material/);
  });

  it("uses the same closed provider-operation enum in initial and revision context schemas", () => {
    const intent = fixtureIntent();
    const providerOperations = ["build/implement", "build/contract"];
    const initial = parseBrief(renderEpisodePlannerBrief({
      intent,
      attempt: 1,
      providerOperations,
      proposalCreatedAt: "2026-07-19T18:00:00.000Z",
      validationDiagnostics: [],
    }));
    const previousPlan: EpisodePlan = {
      schemaVersion: 1,
      episodeId: intent.episodeId,
      version: 1,
      intentHash: episodeIntentHash(intent),
      summary: "Initial plan",
      workflowClass: "fixture",
      planningSource: "episode_planner",
      steps: [],
      estimatedBudget: {
        providerTurns: 0,
        providerTurnBudgetUsd: 0,
        mechanicalOverheadUsd: 0,
        totalBudgetUsd: 0,
      },
      derivedSafetyRoute: {
        label: "quick",
        reasons: [],
        gateStepIds: [],
        approvalStepIds: [],
      },
      createdAt: "2026-07-19T18:00:00.000Z",
    };
    const replan: EpisodeReplanRecord = {
      trigger: {
        id: "fixture-replan",
        kind: "failed_gate",
        planVersion: 1,
        detectedAt: "2026-07-19T18:01:00.000Z",
        summary: "fixture gate failed",
        evidenceRefs: ["fixture:evidence"],
        affectedStepIds: ["implement"],
      },
      triggerSha256: "a".repeat(64),
      status: "pending",
      requestedAt: "2026-07-19T18:01:00.000Z",
      resolvedAt: null,
      revisionVersion: null,
      reason: null,
    };
    const revision = parseBrief(renderEpisodePlannerRevisionBrief({
      intent,
      previousPlan,
      replan,
      attempt: 1,
      providerOperations,
      proposalCreatedAt: "2026-07-19T18:01:00.000Z",
      validationDiagnostics: [],
    }));

    for (const payload of [initial, revision]) {
      expect(payload["providerOperationRegistry"]).toEqual([
        "build/contract",
        "build/implement",
      ]);
      expect(providerOperationEnum(payload["proposalSchema"])).toEqual([
        "build/contract",
        "build/implement",
      ]);
    }
  });
});

function parseBrief(rendered: string): Record<string, unknown> {
  return JSON.parse(rendered.slice(rendered.indexOf("\n") + 1)) as Record<string, unknown>;
}

function providerOperationEnum(schemaValue: unknown): unknown {
  const schema = schemaValue as {
    properties: {
      steps: {
        items: {
          oneOf: Array<{ properties: { kind: { const?: string }; operation?: { enum?: unknown } } }>;
        };
      };
    };
  };
  return schema.properties.steps.items.oneOf
    .find((entry) => entry.properties.kind.const === "provider_turn")
    ?.properties.operation?.enum;
}

function fixtureIntent(): EpisodeIntent {
  const intent: EpisodeIntent = {
    episodeId: "trace:fixture:brief",
    app: "fixture",
    assignmentMode: "fixed",
    trigger: { kind: "manual" },
    goal: "Create the smallest sufficient plan",
    lifecycle: "bounded-goal",
    appStage: "growth",
    repositoryFacts: { head: "a".repeat(40) },
    requestedConstraints: { network: false },
    hardBudget: { maxProviderTurns: 2, maxEquivalentCostUsd: 5 },
    availableRoles: [],
    allowedAssignments: [],
    requiredSafetyFacts: [],
  };
  return intent;
}
