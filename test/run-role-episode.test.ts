import { describe, expect, it } from "vitest";
import { episodeIdFor } from "../src/loop/efficiency.js";
import { readCurrentEpisodePlan } from "../src/loop/episode-plan.js";
import type { RoleConfig } from "../src/runtime/types.js";
import type { AppEntry } from "../src/org/apps.js";
import {
  buildStandaloneRunRoleScope,
  prepareStandaloneRunRoleScope,
} from "../src/org/run-role-episode.js";
import {
  buildEpisodeIntent,
  createEpisodePlanningPolicy,
} from "../src/org/episode-planner/policy.js";
import {
  persistEpisodeIntent,
  prepareEpisodePlan,
} from "../src/org/episode-planner/coordinator.js";
import { assessCreatorScope } from "../src/loop/episode-plan.js";
import { writeJournalPatch } from "../src/org/journal.js";
import { makeOrgHome } from "./fixtures/orgHome.js";

const NOW = new Date("2026-07-19T18:00:00.000Z");

const PLANNER: RoleConfig = {
  name: "planner",
  runtime: "claude",
  model: "planner-model",
  effort: "high",
  delegation: { allow: [] },
  triggers: [],
  outputs: ["episode-plan"],
  maxTurnBudgetUsd: 5,
};

const SUPPORT: RoleConfig = {
  name: "support",
  runtime: "claude",
  model: "support-model",
  effort: "medium",
  adaptiveAssignments: [{
    id: "pi-qualified",
    harness: "pi",
    model: "openai/support-model",
    efforts: ["medium", "high"],
    providerFamily: "openai",
    capabilityRef: "pi/v1",
    qualificationRef: "qualification:test",
    pricing: {
      kind: "conservative_estimate",
      maxTurnCostUsd: 2,
      sourceRef: "test-catalog",
    },
  }],
  delegation: { allow: [] },
  triggers: [],
  outputs: ["feedback-digest"],
  maxTurnBudgetUsd: 4,
};

const FIXED_APP: AppEntry = {
  name: "alpha",
  repo: "example/alpha",
  status: "live",
  budgetUsdMonth: 100,
  cadence: {},
  execution: { assignmentMode: "fixed", allowedAssignments: {} },
};

const ADAPTIVE_APP: AppEntry = {
  ...FIXED_APP,
  execution: {
    assignmentMode: "adaptive",
    allowedAssignments: { support: ["pi-qualified"] },
  },
};

const PROVENANCE = {
  source: "human" as const,
  creatorId: "operon-cli",
  createdAt: NOW.toISOString(),
  evidenceRefs: ["turn:manual-support"],
};

describe("standalone run-role EpisodePlan boundary", () => {
  it("normalizes a fixed invocation into one durable creator-scoped provider turn", async () => {
    const home = makeOrgHome();
    const roles = [PLANNER, SUPPORT];
    try {
      const scope = buildStandaloneRunRoleScope({
        app: FIXED_APP,
        roles,
        role: SUPPORT,
        turnId: "manual-support",
        provenance: PROVENANCE,
      });
      expect(scope.steps).toEqual([
        expect.objectContaining({
          kind: "provider_turn",
          id: "run-role",
          operation: "manual/run-role",
          role: "support",
          maxTurnBudgetUsd: 4,
        }),
      ]);
      expect(scope.steps?.[0]).not.toHaveProperty("assignment");
      expect(scope.declaredConstraints).toMatchObject({
        standaloneRunRole: { networkAccess: false },
      });

      const intent = intentFor(FIXED_APP, roles, scope, "manual-support");
      const policy = createEpisodePlanningPolicy(FIXED_APP, { intent, roles });
      expect(assessCreatorScope(scope, policy.creatorScope)).toMatchObject({
        executionReady: true,
        runEpisodePlanner: false,
      });
      const prepared = await prepareEpisodePlan({
        root: home.root,
        app: FIXED_APP,
        roles,
        intent,
        now: () => NOW,
      });

      expect(prepared.planningTurnSkipped).toBe(true);
      expect(prepared.plan).toMatchObject({
        planningSource: "creator_scope",
        creatorProvenance: PROVENANCE,
        steps: [{
          kind: "provider_turn",
          id: "run-role",
          role: "support",
          assignmentSource: "configured",
          assignment: {
            harness: "claude",
            model: "support-model",
            effort: "medium",
          },
        }],
      });
      expect(await readCurrentEpisodePlan(home.root, intent.episodeId)).toEqual(prepared.plan);
    } finally {
      home.cleanup();
    }
  });

  it("requires and persists one exact approved tuple in adaptive mode", async () => {
    const home = makeOrgHome();
    const roles = [PLANNER, SUPPORT];
    try {
      expect(() => buildStandaloneRunRoleScope({
        app: ADAPTIVE_APP,
        roles,
        role: SUPPORT,
        turnId: "adaptive-support",
        provenance: PROVENANCE,
      })).toThrow(/adaptive mode requires --assignment/);
      expect(() => buildStandaloneRunRoleScope({
        app: ADAPTIVE_APP,
        roles,
        role: SUPPORT,
        turnId: "adaptive-support",
        provenance: PROVENANCE,
        assignmentSelector: "pi-qualified@xhigh",
      })).toThrow(/not one exact approved support tuple/);

      const scope = buildStandaloneRunRoleScope({
        app: ADAPTIVE_APP,
        roles,
        role: SUPPORT,
        turnId: "adaptive-support",
        provenance: PROVENANCE,
        assignmentSelector: "pi-qualified@high",
      });
      const intent = intentFor(ADAPTIVE_APP, roles, scope, "adaptive-support");
      const prepared = await prepareEpisodePlan({
        root: home.root,
        app: ADAPTIVE_APP,
        roles,
        intent,
        now: () => NOW,
      });

      expect(prepared.plan.steps).toEqual([
        expect.objectContaining({
          kind: "provider_turn",
          assignmentSource: "creator",
          assignment: {
            harness: "pi",
            model: "openai/support-model",
            effort: "high",
          },
          maxTurnBudgetUsd: 2,
        }),
      ]);
    } finally {
      home.cleanup();
    }
  });

  it("reuses durable creator bytes on resume before reading a mutable template", async () => {
    const home = makeOrgHome({ state: true });
    const roles = [PLANNER, SUPPORT];
    try {
      const first = await prepareStandaloneRunRoleScope({
        stateHome: home.root,
        app: FIXED_APP,
        roles,
        role: SUPPORT,
        turnId: "resume-support",
        networkAccess: true,
        now: () => NOW,
      });
      expect(first.creatorScope?.declaredConstraints).toMatchObject({
        standaloneRunRole: { networkAccess: true },
      });
      expect(first.creatorScope?.provenance).toMatchObject({
        source: "human",
        creatorId: "operon-cli",
        createdAt: NOW.toISOString(),
      });
      const intent = intentFor(FIXED_APP, roles, first.creatorScope!, "resume-support");
      await persistEpisodeIntent(home.root, intent);

      const resumed = await prepareStandaloneRunRoleScope({
        stateHome: home.root,
        app: FIXED_APP,
        roles,
        role: SUPPORT,
        turnId: "resume-support",
        templatePath: "/this/template/does/not-exist.md",
        networkAccess: true,
        now: () => new Date("2026-07-20T18:00:00.000Z"),
      });
      expect(resumed.reusedPersistedIntent).toBe(true);
      expect(resumed.creatorScope).toEqual(first.creatorScope);

      await expect(prepareStandaloneRunRoleScope({
        stateHome: home.root,
        app: FIXED_APP,
        roles,
        role: SUPPORT,
        turnId: "resume-support",
      })).rejects.toThrow(/requested network access denied conflicts with the persisted episode intent/);
    } finally {
      home.cleanup();
    }
  });

  it("does not invent a standalone scope for an already-governed scheduled route", async () => {
    const home = makeOrgHome({ state: true });
    const scheduledSupport: RoleConfig = {
      ...SUPPORT,
      triggers: [{ schedule: "every 4h" }],
    };
    const roles = [PLANNER, scheduledSupport];
    try {
      await writeJournalPatch(home.root, "scheduled-support", {
        role: "support",
        app: "alpha",
        phase: "assembling",
        attempt: 0,
        triggerKind: "schedule",
        trigger: "every 4h",
      }, NOW);
      const prepared = await prepareStandaloneRunRoleScope({
        stateHome: home.root,
        app: ADAPTIVE_APP,
        roles,
        role: scheduledSupport,
        turnId: "scheduled-support",
      });

      expect(prepared.route).toEqual({ kind: "pipeline", pipeline: "support-digest" });
      expect(prepared.creatorScope).toBeUndefined();
    } finally {
      home.cleanup();
    }
  });
});

function intentFor(
  app: AppEntry,
  roles: readonly RoleConfig[],
  creatorScope: NonNullable<Awaited<ReturnType<typeof prepareStandaloneRunRoleScope>>["creatorScope"]>,
  turnId: string,
) {
  return buildEpisodeIntent({
    episodeId: episodeIdFor({ app: app.name, traceId: turnId }),
    app,
    roles,
    trigger: { kind: "manual", sourceRef: `manual:${turnId}` },
    goal: creatorScope.objective,
    lifecycle: "manual",
    appStage: app.status,
    repositoryFacts: { fixture: true },
    requestedConstraints: {
      dispatchRole: "support",
      networkAccess: creatorScope.declaredConstraints["standaloneRunRole"] !== null &&
        typeof creatorScope.declaredConstraints["standaloneRunRole"] === "object" &&
        !Array.isArray(creatorScope.declaredConstraints["standaloneRunRole"]) &&
        creatorScope.declaredConstraints["standaloneRunRole"]!["networkAccess"] === true,
    },
    hardBudget: {
      maxProviderTurns: 1,
      maxEquivalentCostUsd: 10,
      maxMechanicalOverheadUsd: 0,
      maxInputTokens: 64_000,
      maxActiveTimeMs: 300_000,
      maxHumanDecisions: 0,
    },
    requiredSafetyFacts: [],
    creatorScope,
  });
}
