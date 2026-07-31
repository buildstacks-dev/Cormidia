import { afterEach, describe, expect, it } from "vitest";
import {
  deriveEpisodeSafetyRoute,
  episodeIntentHash,
  persistEpisodePlan,
  readCurrentEpisodePlan,
  type EpisodeIntent,
  type EpisodePlan,
  type EpisodePlanValidationPolicy,
  type MechanicalGateStep,
} from "../../src/loop/episode-plan.js";
import {
  executeEpisodePlan,
  type EpisodePlanStepHandlers,
} from "../../src/loop/episode-plan-executor.js";
import {
  publishEpisodePlanRevision,
  readEpisodeReplanJournal,
  requestEpisodeReplan,
  type EpisodeReplanTrigger,
} from "../../src/loop/episode-replan.js";
import { makeOrgHome, type OrgHomeFixture } from "../fixtures/orgHome.js";

const FIXED_ASSIGNMENT = {
  harness: "codex",
  model: "gpt-5.6-sol",
  effort: "high",
} as const;

describe("bounded EpisodePlan replanning", () => {
  const homes: OrgHomeFixture[] = [];
  afterEach(() => {
    for (const home of homes.splice(0)) home.cleanup();
  });

  it("publishes only future changes from a typed request and durably caps revisions", async () => {
    const fixture = await setup(homes);
    await executeEpisodePlan({
      root: fixture.home.root,
      plan: fixture.plan,
      handlers: passingHandlers(),
      maxSteps: 1,
      now: () => new Date("2026-07-19T20:01:00.000Z"),
    });

    const first = trigger("failed_gate", 1, "replan-1");
    const requested = await requestEpisodeReplan({
      root: fixture.home.root,
      episodeId: fixture.intent.episodeId,
      trigger: first,
      now: new Date("2026-07-19T20:02:00.000Z"),
    });
    await expect(requestEpisodeReplan({
      root: fixture.home.root,
      episodeId: fixture.intent.episodeId,
      trigger: first,
    })).resolves.toEqual(requested);

    const v2 = revision(fixture.plan, 2, "Re-run the failed focused gate");
    await expect(publishEpisodePlanRevision({
      root: fixture.home.root,
      requestId: first.id,
      intent: fixture.intent,
      plan: v2,
      policy: fixture.policy,
      now: new Date("2026-07-19T20:03:00.000Z"),
    })).resolves.toMatchObject({ status: "accepted", revisionVersion: 2 });
    expect((await readCurrentEpisodePlan(fixture.home.root, fixture.intent.episodeId))?.version).toBe(2);

    const second = trigger("estimate_exhausted", 2, "replan-2");
    await requestEpisodeReplan({
      root: fixture.home.root,
      episodeId: fixture.intent.episodeId,
      trigger: second,
    });
    const v3 = revision(v2, 3, "Use a cheaper deterministic verification");
    await publishEpisodePlanRevision({
      root: fixture.home.root,
      requestId: second.id,
      intent: fixture.intent,
      plan: v3,
      policy: fixture.policy,
    });
    await expect(requestEpisodeReplan({
      root: fixture.home.root,
      episodeId: fixture.intent.episodeId,
      trigger: trigger("new_scope", 3, "replan-3"),
    })).rejects.toMatchObject({ code: "error_episode_replan_allowance_exhausted" });
    expect((await readEpisodeReplanJournal(fixture.home.root, fixture.intent.episodeId))?.records)
      .toMatchObject([
        { status: "accepted", revisionVersion: 2 },
        { status: "accepted", revisionVersion: 3 },
      ]);
  });

  it("refuses publication while a step execution is unterminated", async () => {
    const fixture = await setup(homes);
    await expect(executeEpisodePlan({
      root: fixture.home.root,
      plan: fixture.plan,
      handlers: {
        ...passingHandlers(),
        // An invalid return models a process-owned handler that never reached
        // a durable terminal outcome. Ordinary caught handler exceptions are
        // now terminal failures so they cannot wedge revision.
        mechanical: async () => ({ status: "completed" } as never),
      },
    })).rejects.toMatchObject({ code: "error_episode_plan_execution_outcome_invalid" });
    const event = trigger("failed_assumption", 1, "replan-active");
    await requestEpisodeReplan({
      root: fixture.home.root,
      episodeId: fixture.intent.episodeId,
      trigger: event,
    });
    await expect(publishEpisodePlanRevision({
      root: fixture.home.root,
      requestId: event.id,
      intent: fixture.intent,
      plan: revision(fixture.plan, 2, "Changed future"),
      policy: fixture.policy,
    })).rejects.toMatchObject({ code: "error_episode_replan_execution_active" });
  });

  it("recovers when the revision pointer was published before replan acceptance", async () => {
    const fixture = await setup(homes);
    await executeEpisodePlan({
      root: fixture.home.root,
      plan: fixture.plan,
      handlers: passingHandlers(),
      maxSteps: 1,
    });
    const event = trigger("failed_gate", 1, "replan-crash-window");
    await requestEpisodeReplan({
      root: fixture.home.root,
      episodeId: fixture.intent.episodeId,
      trigger: event,
    });
    const v2 = revision(fixture.plan, 2, "Recover the already-published revision");

    // Simulate a crash after immutable plan + pointer publication but before
    // the replan journal's pending -> accepted projection.
    await expect(publishEpisodePlanRevision({
      root: fixture.home.root,
      requestId: event.id,
      plan: v2,
      intent: fixture.intent,
      policy: fixture.policy,
      afterPlanPersisted: () => { throw new Error("simulated crash after plan publication"); },
    })).rejects.toThrow("simulated crash after plan publication");
    expect((await readEpisodeReplanJournal(fixture.home.root, fixture.intent.episodeId))?.records[0])
      .toMatchObject({ status: "pending", revisionVersion: null });

    await expect(publishEpisodePlanRevision({
      root: fixture.home.root,
      requestId: event.id,
      intent: fixture.intent,
      plan: v2,
      policy: fixture.policy,
    })).resolves.toMatchObject({ status: "accepted", revisionVersion: 2 });
  });

  it("rejects untyped or ungrounded requests", async () => {
    const fixture = await setup(homes);
    await expect(requestEpisodeReplan({
      root: fixture.home.root,
      episodeId: fixture.intent.episodeId,
      trigger: {
        ...trigger("failed_gate", 1, "bad-event"),
        kind: "looks-hard",
        evidenceRefs: [],
      } as unknown as EpisodeReplanTrigger,
    })).rejects.toMatchObject({ code: "error_episode_replan_invalid" });
  });

  it("binds every revision to the immutable persisted intent", async () => {
    const fixture = await setup(homes);
    const event = trigger("new_scope", 1, "replan-intent-widening");
    await requestEpisodeReplan({
      root: fixture.home.root,
      episodeId: fixture.intent.episodeId,
      trigger: event,
    });
    const widenedIntent: EpisodeIntent = {
      ...structuredClone(fixture.intent),
      hardBudget: {
        ...fixture.intent.hardBudget,
        maxProviderTurns: 99,
        maxEquivalentCostUsd: 999,
      },
      allowedAssignments: [
        ...structuredClone(fixture.intent.allowedAssignments),
        {
          ...structuredClone(fixture.intent.allowedAssignments[0]!),
          candidateId: "caller-invented",
          assignment: { ...FIXED_ASSIGNMENT, model: "gpt-5.6-caller-invented" },
        },
      ],
    };
    const widenedRevision = {
      ...revision(fixture.plan, 2, "Attempt to widen immutable authority"),
      intentHash: episodeIntentHash(widenedIntent),
    };

    await expect(publishEpisodePlanRevision({
      root: fixture.home.root,
      requestId: event.id,
      intent: widenedIntent,
      plan: widenedRevision,
      policy: fixture.policy,
    })).rejects.toMatchObject({
      code: "error_episode_plan_invalid",
      issues: [{ code: "plan_intent_hash_mismatch" }],
    });
    expect(await readCurrentEpisodePlan(fixture.home.root, fixture.intent.episodeId))
      .toMatchObject({ version: 1, intentHash: fixture.plan.intentHash });
  });

  it("rejects requests and publication once execution is terminal", async () => {
    const fixture = await setup(homes);
    const event = trigger("failed_gate", 1, "replan-before-terminal");
    await requestEpisodeReplan({
      root: fixture.home.root,
      episodeId: fixture.intent.episodeId,
      trigger: event,
    });
    await executeEpisodePlan({
      root: fixture.home.root,
      plan: fixture.plan,
      handlers: passingHandlers(),
    });

    await expect(publishEpisodePlanRevision({
      root: fixture.home.root,
      requestId: event.id,
      intent: fixture.intent,
      plan: revision(fixture.plan, 2, "Too late to revise"),
      policy: fixture.policy,
    })).rejects.toMatchObject({ code: "error_episode_replan_terminal" });
    await expect(requestEpisodeReplan({
      root: fixture.home.root,
      episodeId: fixture.intent.episodeId,
      trigger: trigger("new_scope", 1, "replan-after-terminal"),
    })).rejects.toMatchObject({ code: "error_episode_replan_terminal" });
    expect((await readCurrentEpisodePlan(fixture.home.root, fixture.intent.episodeId))?.version)
      .toBe(1);
  });
});

async function setup(homes: OrgHomeFixture[]) {
  const home = makeOrgHome();
  homes.push(home);
  const intent = makeIntent();
  const policy = makePolicy();
  const plan = makePlan(intent);
  await persistEpisodePlan({ root: home.root, plan, intent, policy });
  return { home, intent, policy, plan };
}

function makeIntent(): EpisodeIntent {
  return {
    episodeId: "ticket:replan:#9",
    app: "replan",
    assignmentMode: "fixed",
    trigger: { kind: "ticket", sourceRef: "github:#9" },
    goal: "Run two bounded deterministic gates",
    lifecycle: "existing-ticket",
    appStage: "growth",
    repositoryFacts: { revision: "abc123" },
    requestedConstraints: {},
    hardBudget: { maxProviderTurns: 0, maxEquivalentCostUsd: 0, maxMechanicalOverheadUsd: 1 },
    availableRoles: [{
      role: "builder",
      responsibility: "Build",
      requiredCapabilities: [],
      expectedOutputs: [],
      configuredAssignment: FIXED_ASSIGNMENT,
    }],
    allowedAssignments: [{
      candidateId: "configured",
      role: "builder",
      assignment: FIXED_ASSIGNMENT,
      providerFamily: "openai",
      capabilities: [],
      qualificationRef: "configured-role-assignment:builder",
      priceRef: "test-price",
      maxTurnCostUsd: 1,
      available: true,
    }],
    requiredSafetyFacts: [],
  };
}

function makePolicy(): EpisodePlanValidationPolicy {
  return {
    mode: "fixed",
    configuredAssignmentFor: (role) => role === "builder" ? FIXED_ASSIGNMENT : undefined,
    isKnownRole: (role) => role === "builder",
    isAssignmentAllowed: (role, assignment) =>
      role === "builder" && JSON.stringify(assignment) === JSON.stringify(FIXED_ASSIGNMENT),
    capabilitiesFor: () => [],
    requiredTerminalOutputIds: ["done"],
  };
}

function makePlan(intent: EpisodeIntent): EpisodePlan {
  const steps = [gate("inspect", [], "inspection"), gate("verify", ["inspect"], "done")];
  return {
    schemaVersion: 1,
    episodeId: intent.episodeId,
    version: 1,
    intentHash: episodeIntentHash(intent),
    summary: "Inspect, then verify",
    workflowClass: "deterministic-test",
    planningSource: "episode_planner",
    steps,
    estimatedBudget: {
      providerTurns: 0,
      providerTurnBudgetUsd: 0,
      mechanicalOverheadUsd: 0,
      totalBudgetUsd: 0,
    },
    derivedSafetyRoute: deriveEpisodeSafetyRoute(steps, intent.requiredSafetyFacts),
    createdAt: "2026-07-19T20:00:00.000Z",
  };
}

function revision(previous: EpisodePlan, version: number, futureObjective: string): EpisodePlan {
  const next = structuredClone(previous);
  next.version = version;
  next.createdAt = `2026-07-19T20:0${version + 2}:00.000Z`;
  next.summary = futureObjective;
  const future = next.steps.find((step) => step.id === "verify");
  if (future === undefined) throw new Error("test plan missing verify step");
  future.objective = futureObjective;
  next.derivedSafetyRoute = deriveEpisodeSafetyRoute(next.steps, []);
  return next;
}

function gate(id: string, dependsOn: string[], output: string): MechanicalGateStep {
  return {
    kind: "mechanical_gate",
    id,
    objective: `Run ${id}`,
    dependsOn,
    gate: id,
    inputRefs: [],
    expectedOutputs: [{ id: output, kind: "evidence", required: true }],
  };
}

function trigger(
  kind: EpisodeReplanTrigger["kind"],
  planVersion: number,
  id: string,
): EpisodeReplanTrigger {
  return {
    id,
    kind,
    planVersion,
    detectedAt: "2026-07-19T20:01:00.000Z",
    summary: `${kind} requires future work to change`,
    evidenceRefs: [`execution:${id}`],
    affectedStepIds: ["verify"],
  };
}

function passingHandlers(): EpisodePlanStepHandlers {
  return {
    provider: async (step) => ({ status: "completed", artifact: { providerStepId: step.id } }),
    mechanical: async (step) => ({ status: "completed", artifact: { gate: step.gate } }),
    approval: async (step) => ({ status: "completed", artifact: { approval: step.actionRef } }),
  };
}
