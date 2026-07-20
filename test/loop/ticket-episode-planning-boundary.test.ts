import { describe, expect, it, vi } from "vitest";
import { baseRevisionForBranch } from "../../src/loop/default-branch.js";
import {
  requireAcceptedTicketEpisodePlan,
  TicketEpisodePlanningBoundaryError,
  type AcceptedTicketEpisodePlan,
  type TicketEpisodePlanningRequest,
} from "../../src/loop/driver.js";
import {
  deriveEpisodeSafetyRoute,
  episodeIntentHash,
  persistEpisodePlan,
  type CreatorEpisodeScope,
  type EpisodeIntent,
  type EpisodePlan,
  type EpisodePlanValidationPolicy,
  type ProviderTurnStep,
} from "../../src/loop/episode-plan.js";
import { routeAdmissionForEpisodePlan } from "../../src/loop/episode-route.js";
import { admitPlannedEpisodeRoute } from "../../src/loop/planner-admission.js";
import { resolvedRuntimeCapabilities } from "../../src/runtime/capabilities.js";
import type { TurnAssignment } from "../../src/runtime/types.js";
import { makeOrgHome } from "../fixtures/orgHome.js";

const ASSIGNMENT: TurnAssignment = {
  harness: "codex",
  model: "gpt-5.6-sol",
  effort: "high",
};
const PROVIDER_STEP: ProviderTurnStep = {
  kind: "provider_turn",
  operation: "build/implement",
  id: "implement",
  role: "builder",
  objective: "Implement the bounded ticket",
  dependsOn: [],
  requiredCapabilities: ["tool_gate"],
  assignment: ASSIGNMENT,
  assignmentSource: "configured",
  inputRefs: [{ ref: "github:#7", required: true }],
  expectedOutputs: [{ id: "patch", kind: "patch", required: true }],
  maxTurnBudgetUsd: 2,
  selectionReason: "The accepted plan requires one bounded implementation turn",
};

describe("ticket EpisodePlan planning boundary", () => {
  it("fails closed before a delivery runtime factory when planning is absent", async () => {
    const home = makeOrgHome();
    const runtimeFor = vi.fn();
    try {
      await expect(deliveryEntry(request(home.root), undefined, runtimeFor)).rejects.toMatchObject({
        code: "error_ticket_episode_planner_missing",
      });
      expect(runtimeFor).not.toHaveBeenCalled();
    } finally {
      home.cleanup();
    }
  });

  it("rejects an in-memory plan and a route that was not durably admitted", async () => {
    const home = makeOrgHome();
    const authority = makeAuthority();
    try {
      await expect(requireAcceptedTicketEpisodePlan({
        request: request(home.root),
        planner: async () => authority,
      })).rejects.toMatchObject({ code: "error_ticket_episode_plan_not_persisted" });

      await persistEpisodePlan({
        root: home.root,
        plan: authority.plan,
        intent: authority.intent,
        policy: validationPolicy(),
      });
      await expect(requireAcceptedTicketEpisodePlan({
        request: request(home.root),
        planner: async () => authority,
      })).rejects.toMatchObject({ code: "error_ticket_episode_route_not_admitted" });
    } finally {
      home.cleanup();
    }
  });

  it("returns only the exact persisted plan with its plan-derived route", async () => {
    const home = makeOrgHome();
    const authority = makeAuthority();
    const planner = vi.fn(async (input: TicketEpisodePlanningRequest) => {
      expect(input.ticket).toMatchObject({ issueNumber: 7, ticketRef: "#7" });
      await persistEpisodePlan({
        root: home.root,
        plan: authority.plan,
        intent: authority.intent,
        policy: validationPolicy(),
      });
      await admitPlannedEpisodeRoute(routeAdmissionForEpisodePlan({
        root: home.root,
        intent: authority.intent,
        plan: authority.plan,
        now: new Date("2026-07-19T22:01:00.000Z"),
      }));
      return authority;
    });

    try {
      const accepted = await requireAcceptedTicketEpisodePlan({
        request: request(home.root),
        planner,
      });
      expect(planner).toHaveBeenCalledOnce();
      expect(accepted).toEqual(authority);

      const altered = {
        ...authority,
        plan: { ...authority.plan, summary: "not the persisted plan" },
      };
      await expect(requireAcceptedTicketEpisodePlan({
        request: request(home.root),
        planner: async () => altered,
      })).rejects.toMatchObject({ code: "error_ticket_episode_plan_mismatch" });
    } finally {
      home.cleanup();
    }
  });

  it("exposes stable typed failures", () => {
    expect(new TicketEpisodePlanningBoundaryError(
      "error_ticket_episode_plan_mismatch",
      "mismatch",
    )).toMatchObject({
      name: "TicketEpisodePlanningBoundaryError",
      code: "error_ticket_episode_plan_mismatch",
    });
  });
});

async function deliveryEntry(
  planningRequest: TicketEpisodePlanningRequest,
  planner: Parameters<typeof requireAcceptedTicketEpisodePlan>[0]["planner"],
  runtimeFor: () => unknown,
): Promise<unknown> {
  const accepted = await requireAcceptedTicketEpisodePlan({
    request: planningRequest,
    ...(planner === undefined ? {} : { planner }),
  });
  return { accepted, runtime: runtimeFor() };
}

function request(root: string): TicketEpisodePlanningRequest {
  return {
    root,
    episodeId: "ticket:fixture:#7",
    app: "fixture",
    targetRepo: "example/fixture",
    localRepo: "/tmp/fixture",
    base: baseRevisionForBranch("main"),
    ticket: {
      issueNumber: 7,
      ticketRef: "#7",
      title: "Fix a bounded parser bug",
      body: "## Goal\nFix the parser.\n",
      labels: ["op:ready"],
    },
  };
}

function makeAuthority(): AcceptedTicketEpisodePlan {
  const provenance = {
    source: "agent" as const,
    creatorId: "parent-episode-planner",
    createdAt: "2026-07-19T22:00:00.000Z",
    evidenceRefs: ["parent-plan:v1"],
  };
  const creatorStep = structuredClone(PROVIDER_STEP);
  delete (creatorStep as Partial<ProviderTurnStep>).assignmentSource;
  const creatorScope: CreatorEpisodeScope = {
    planningDisposition: "execution_ready",
    provenance,
    objective: "Fix a bounded parser bug",
    inScope: ["src/parser.ts"],
    outOfScope: ["unrelated parser features"],
    acceptanceCriteria: ["the parser regression is covered"],
    expectedArtifacts: [{ id: "patch", kind: "patch", required: true }],
    declaredConstraints: { network: false },
    safetyFacts: [],
    steps: [creatorStep],
  };
  const intent: EpisodeIntent = {
    episodeId: "ticket:fixture:#7",
    app: "fixture",
    assignmentMode: "fixed",
    trigger: { kind: "ticket", sourceRef: "github:#7" },
    goal: creatorScope.objective,
    lifecycle: "existing-ticket",
    appStage: "growth",
    repositoryFacts: { baseRef: "refs/remotes/origin/main" },
    requestedConstraints: { network: false },
    hardBudget: { maxProviderTurns: 2, maxEquivalentCostUsd: 5 },
    availableRoles: [{
      role: "builder",
      responsibility: "implement",
      requiredCapabilities: ["tool_gate"],
      expectedOutputs: ["patch"],
      configuredAssignment: ASSIGNMENT,
    }],
    allowedAssignments: [{
      candidateId: "configured",
      role: "builder",
      assignment: ASSIGNMENT,
      providerFamily: "openai",
      capabilities: resolvedRuntimeCapabilities("codex"),
      qualificationRef: "configured-role-assignment:builder",
      priceRef: "role.max_turn_budget_usd",
      maxTurnCostUsd: 2,
      available: true,
    }],
    requiredSafetyFacts: [],
    creatorScope,
  };
  const plan: EpisodePlan = {
    schemaVersion: 1,
    episodeId: intent.episodeId,
    version: 1,
    intentHash: episodeIntentHash(intent),
    summary: creatorScope.objective,
    workflowClass: "creator-scoped-ticket",
    planningSource: "creator_scope",
    creatorProvenance: provenance,
    steps: [structuredClone(PROVIDER_STEP)],
    estimatedBudget: {
      providerTurns: 1,
      providerTurnBudgetUsd: 2,
      mechanicalOverheadUsd: 0,
      totalBudgetUsd: 2,
    },
    derivedSafetyRoute: deriveEpisodeSafetyRoute([PROVIDER_STEP], []),
    createdAt: "2026-07-19T22:00:00.000Z",
  };
  return { intent, plan };
}

function validationPolicy(): EpisodePlanValidationPolicy {
  return {
    mode: "fixed",
    configuredAssignmentFor: (role) => role === "builder" ? ASSIGNMENT : undefined,
    isAssignmentAllowed: (role, assignment) =>
      role === "builder" && JSON.stringify(assignment) === JSON.stringify(ASSIGNMENT),
    isKnownRole: (role) => role === "builder",
    capabilitiesFor: () => resolvedRuntimeCapabilities("codex"),
    requiredTerminalOutputIds: ["patch"],
  };
}
