import { describe, expect, it } from "vitest";
import {
  EPISODE_PLAN_PROPOSAL_SCHEMA,
  type EpisodeIntent,
} from "../src/loop/episode-plan.js";
import { renderEpisodePlannerBrief } from "../src/org/episode-planner/brief.js";

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
});

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
