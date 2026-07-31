import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  deriveEpisodeSafetyRoute,
  readCurrentEpisodePlan,
  type CreatorEpisodeScope,
  type EpisodeIntent,
  type ProposedProviderTurnStep,
} from "../src/loop/episode-plan.js";
import { episodeIdFor } from "../src/loop/efficiency.js";
import { readEpisodePlanExecutionJournal } from "../src/loop/episode-plan-executor.js";
import type { PlannerAdmissionLimits } from "../src/loop/planner-admission.js";
import type { AppEntry, AppsFile } from "../src/org/apps.js";
import { writeJournalPatch } from "../src/org/journal.js";
import { runDispatchedTurn } from "../src/org/turn-runner.js";
import type {
  RoleConfig,
  Runtime,
  RuntimeKind,
  TurnAssignment,
  TurnRequest,
  TurnResult,
} from "../src/runtime/types.js";
import { makeBareWithClone } from "./fixtures/gitRepo.js";
import { makeOrgHome, type OrgHomeFixture } from "./fixtures/orgHome.js";

const NOW = new Date("2026-07-19T18:00:00.000Z");
const PROMPT = "Return exactly one strict EpisodePlan JSON object.";
const LIMITS: PlannerAdmissionLimits = {
  maxAttempts: 2,
  perAttempt: {
    equivalentCostUsd: 0.5,
    activeTimeMs: 5_000,
  },
  aggregate: {
    providerTurns: 2,
    equivalentCostUsd: 1,
    activeTimeMs: 10_000,
  },
};
const SUPPORT: RoleConfig = {
  name: "support",
  runtime: "codex",
  model: "support-model-test",
  effort: "medium",
  delegation: { allow: [] },
  triggers: [],
  outputs: ["digest"],
  maxTurnBudgetUsd: 2,
};

describe("generic dispatched-turn EpisodePlanner boundary", () => {
  const homes: OrgHomeFixture[] = [];
  const repos: Array<ReturnType<typeof makeBareWithClone>> = [];

  afterEach(() => {
    for (const home of homes.splice(0)) home.cleanup();
    for (const repo of repos.splice(0)) repo.cleanup();
  });

  it("runs the fixed boot planner before any delivery provider and executes the exact accepted assignment", async () => {
    const fixture = await setup();
    const calls: ObservedCall[] = [];
    let deliveryObservedPersistedPlan = false;
    const runtimeForAssignment = runtimeFactory({
      calls,
      stateHome: fixture.state.root,
      episodeId: fixture.episodeId,
      onDeliveryPlan: () => {
        deliveryObservedPersistedPlan = true;
      },
    });

    const result = await runDispatchedTurn({
      ...fixture.options,
      episodePlannerPromptText: PROMPT,
      episodePlannerLimits: LIMITS,
      runtimeForAssignment,
    });

    expect(result.status).toBe("completed");
    expect(calls.map((call) => call.role)).toEqual(["planner", "support"]);
    expect(calls[0]?.planExistedBeforeCall).toBe(false);
    expect(calls[1]?.planExistedBeforeCall).toBe(true);
    expect(parsePlannerInput(calls[0]!.request.task).intent.hardBudget.maxEquivalentCostUsd)
      .toBe(99);
    expect(deliveryObservedPersistedPlan).toBe(true);
    expect(calls[1]).toMatchObject({
      assignment: {
        harness: "codex",
        model: "support-model-test",
        effort: "medium",
      },
      requestAssignment: {
        harness: "codex",
        model: "support-model-test",
        effort: "medium",
      },
    });
    const plan = await readCurrentEpisodePlan(fixture.state.root, fixture.episodeId);
    expect(plan).toMatchObject({
      planningSource: "episode_planner",
      steps: [expect.objectContaining({
        kind: "provider_turn",
        role: "support",
        assignmentSource: "configured",
        assignment: {
          harness: "codex",
          model: "support-model-test",
          effort: "medium",
        },
      })],
    });
    expect(await readEpisodePlanExecutionJournal(fixture.state.root, fixture.episodeId))
      .toMatchObject({ status: "completed" });

    const ledger = readFileSync(
      join(fixture.state.root, "telemetry", "2026-07-19.jsonl"),
      "utf8",
    ).trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(ledger).toHaveLength(2);
    expect(ledger.map((row) => row["role"])).toEqual(["planner", "support"]);
    expect(ledger[1]).toMatchObject({
      runtime: "codex",
      model: "support-model-test",
      effort: "medium",
      assignmentSource: "configured",
      planVersion: 1,
      planStepId: "support-digest",
    });
  });

  it("preserves incomplete creator scope as planner input and still runs EpisodePlanner", async () => {
    const fixture = await setup("incomplete-scope");
    const calls: ObservedCall[] = [];
    const creatorScope = incompleteCreatorScope(fixture.turnId);

    const result = await runDispatchedTurn({
      ...fixture.options,
      creatorScope,
      episodePlannerPromptText: PROMPT,
      episodePlannerLimits: LIMITS,
      runtimeForAssignment: runtimeFactory({
        calls,
        stateHome: fixture.state.root,
        episodeId: fixture.episodeId,
      }),
    });

    expect(result.status).toBe("completed");
    expect(calls.map((call) => call.role)).toEqual(["planner", "support"]);
    expect(calls[0]?.request.task).toContain('"planningDisposition": "planner_input"');
    expect(calls[0]?.request.task).toContain("Creator-bounded support digest");
    expect((await readCurrentEpisodePlan(fixture.state.root, fixture.episodeId))?.planningSource)
      .toBe("episode_planner");
  });

  it("skips the planner only for an explicit execution-ready creator scope", async () => {
    const fixture = await setup("creator-ready");
    const calls: ObservedCall[] = [];

    const result = await runDispatchedTurn({
      ...fixture.options,
      creatorScope: completeCreatorScope(fixture.turnId, true),
      networkAccess: true,
      episodePlannerLimits: LIMITS,
      runtimeForAssignment: runtimeFactory({
        calls,
        stateHome: fixture.state.root,
        episodeId: fixture.episodeId,
        failPlannerCall: true,
      }),
    });

    expect(result.status).toBe("completed");
    expect(calls.map((call) => call.role)).toEqual(["support"]);
    expect(calls[0]?.planExistedBeforeCall).toBe(true);
    expect(calls[0]?.request.networkAccess).toBe(true);
    expect((await readCurrentEpisodePlan(fixture.state.root, fixture.episodeId)))
      .toMatchObject({
        planningSource: "creator_scope",
        creatorProvenance: { creatorId: "test-creator" },
      });
  });

  it("fails closed before constructing a provider when the protected planner prompt is absent", async () => {
    const fixture = await setup("missing-prompt");
    const calls: ObservedCall[] = [];

    const result = await runDispatchedTurn({
      ...fixture.options,
      episodePlannerLimits: LIMITS,
      runtimeForAssignment: runtimeFactory({
        calls,
        stateHome: fixture.state.root,
        episodeId: fixture.episodeId,
      }),
    });

    expect(result.status).toBe("failed");
    expect(result.summary).toContain("human-ratified EpisodePlanner prompt");
    expect(result.summary).toContain("prompts/episode/plan.md");
    expect(calls).toHaveLength(0);
    expect(await readCurrentEpisodePlan(fixture.state.root, fixture.episodeId)).toBeUndefined();
  });

  async function setup(suffix = "unscoped"): Promise<Fixture> {
    const repo = makeBareWithClone();
    repos.push(repo);
    const state = makeOrgHome({ approvals: true, state: true });
    homes.push(state);
    const org = makeOrgHome({
      taste: true,
      memory: { roles: { planner: {}, support: {} } },
    });
    homes.push(org);
    writeFileSync(join(org.root, "roles.yaml"), TEST_ROLES_YAML);
    const app: AppEntry = {
      name: "alpha",
      repo: repo.bare.root,
      status: "live",
      budgetUsdMonth: 100,
      cadence: {},
      execution: { assignmentMode: "fixed", allowedAssignments: {} },
    };
    const appsFile: AppsFile = {
      org: { name: "test", maxConcurrentTurns: 1 },
      defaults: { budgetUsdMonth: 100 },
      apps: [app],
    };
    const turnId = `generic-${suffix}`;
    await writeJournalPatch(state.root, turnId, {
      role: SUPPORT.name,
      app: app.name,
      phase: "assembling",
      attempt: 0,
      triggerKind: "event",
      trigger: "unmapped-support-event",
    }, NOW);
    return {
      state,
      org,
      app,
      appsFile,
      turnId,
      episodeId: episodeIdFor({ app: app.name, traceId: turnId }),
      options: {
        role: SUPPORT,
        app,
        appsFile,
        turnId,
        runtimeHome: state.root,
        orgRoot: org.root,
        now: () => NOW,
      },
    };
  }
});

interface Fixture {
  state: OrgHomeFixture;
  org: OrgHomeFixture;
  app: AppEntry;
  appsFile: AppsFile;
  turnId: string;
  episodeId: string;
  options: {
    role: RoleConfig;
    app: AppEntry;
    appsFile: AppsFile;
    turnId: string;
    runtimeHome: string;
    orgRoot: string;
    now: () => Date;
  };
}

interface ObservedCall {
  role: string;
  assignment: TurnAssignment;
  requestAssignment: TurnAssignment | undefined;
  request: TurnRequest;
  planExistedBeforeCall: boolean;
}

function runtimeFactory(input: {
  calls: ObservedCall[];
  stateHome: string;
  episodeId: string;
  onDeliveryPlan?: () => void;
  failPlannerCall?: boolean;
}): (assignment: TurnAssignment, role: RoleConfig) => Runtime {
  return (assignment, role) => ({
    kind: assignment.harness,
    async runTurn(request) {
      const planExistedBeforeCall =
        (await readCurrentEpisodePlan(input.stateHome, input.episodeId)) !== undefined;
      input.calls.push({
        role: role.name,
        assignment: { ...assignment },
        requestAssignment: request.assignment === undefined
          ? undefined
          : { ...request.assignment },
        request,
        planExistedBeforeCall,
      });
      if (role.name === "planner") {
        if (input.failPlannerCall) throw new Error("planner must have been skipped");
        const plannerInput = parsePlannerInput(request.task);
        return completed(
          JSON.stringify(plannerProposal(plannerInput.intent, plannerInput.requiredPlanIdentity)),
          assignment.harness,
          "planner",
        );
      }
      if (!planExistedBeforeCall) throw new Error("delivery provider ran before accepted plan persistence");
      input.onDeliveryPlan?.();
      return completed("bounded support digest complete", assignment.harness, "support");
    },
  });
}

function parsePlannerInput(task: string): {
  intent: EpisodeIntent;
  requiredPlanIdentity: {
    schemaVersion: 1;
    episodeId: string;
    version: 1;
    intentHash: string;
    planningSource: "episode_planner";
    createdAt: string;
  };
} {
  const marker = "[episode_planner_input]\n";
  const start = task.indexOf(marker);
  const end = task.indexOf("\n\n---\n\n", start);
  if (start < 0 || end < 0) throw new Error("planner input envelope missing");
  const envelope = JSON.parse(task.slice(start + marker.length, end)) as {
    intent: EpisodeIntent;
    requiredPlanIdentity: {
      schemaVersion: 1;
      episodeId: string;
      version: 1;
      intentHash: string;
      planningSource: "episode_planner";
      createdAt: string;
    };
  };
  return envelope;
}

function plannerProposal(
  intent: EpisodeIntent,
  identity: ReturnType<typeof parsePlannerInput>["requiredPlanIdentity"],
) {
  const step = supportStep();
  return {
    ...identity,
    summary: "One bounded support turn is sufficient",
    workflowClass: "generic-support",
    steps: [step],
    estimatedBudget: {
      providerTurns: 1,
      providerTurnBudgetUsd: 1,
      mechanicalOverheadUsd: 0,
      totalBudgetUsd: 1,
    },
    derivedSafetyRoute: deriveEpisodeSafetyRoute([step], intent.requiredSafetyFacts),
  };
}

function supportStep(): ProposedProviderTurnStep {
  return {
    kind: "provider_turn",
    operation: "support/digest",
    id: "support-digest",
    role: "support",
    objective: "Produce the bounded support digest",
    dependsOn: [],
    requiredCapabilities: ["tool_gate"],
    inputRefs: [{ ref: "dispatch:journal", required: true }],
    expectedOutputs: [{ id: "digest", kind: "digest", required: true }],
    maxTurnBudgetUsd: 1,
    selectionReason: "One support turn is the shortest sufficient workflow",
  };
}

function incompleteCreatorScope(turnId: string): CreatorEpisodeScope {
  return {
    planningDisposition: "planner_input",
    provenance: creatorProvenance(turnId),
    objective: "Creator-bounded support digest",
    inScope: ["the dispatched support fact"],
    outOfScope: ["external publication"],
    acceptanceCriteria: ["produce one digest"],
    expectedArtifacts: [{ id: "digest", kind: "digest", required: true }],
    declaredConstraints: { networkAccess: false },
    safetyFacts: [],
  };
}

function completeCreatorScope(turnId: string, networkAccess = false): CreatorEpisodeScope {
  return {
    ...incompleteCreatorScope(turnId),
    planningDisposition: "execution_ready",
    declaredConstraints: { networkAccess },
    steps: [supportStep()],
  };
}

function creatorProvenance(turnId: string): CreatorEpisodeScope["provenance"] {
  return {
    source: "human",
    creatorId: "test-creator",
    createdAt: NOW.toISOString(),
    evidenceRefs: [`turn:${turnId}`],
  };
}

function completed(summary: string, runtime: RuntimeKind, suffix: string): TurnResult {
  return {
    status: "completed",
    summary,
    artifacts: [],
    session: { runtime, id: `${suffix}-session` },
    usage: {
      tokensIn: 50,
      tokensOut: 25,
      costUsd: 0.1,
      subagentTurns: 0,
      wallClockMs: 100,
      quality: "complete",
    },
    escalations: [],
  };
}

const TEST_ROLES_YAML = `
defaults:
  max_turn_budget_usd: 2
roles:
  planner:
    runtime: claude
    model: planner-model-test
    effort: high
    delegation:
      allow: []
    triggers: []
    outputs: [episode-plan]
  support:
    runtime: codex
    model: support-model-test
    effort: medium
    delegation:
      allow: []
    triggers: []
    outputs: [digest]
`;
