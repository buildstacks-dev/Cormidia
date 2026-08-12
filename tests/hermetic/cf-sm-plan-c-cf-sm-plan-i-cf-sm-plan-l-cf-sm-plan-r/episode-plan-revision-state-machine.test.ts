// Traceability: CF-SM-PLAN-L, CF-SM-PLAN-I, CF-SM-PLAN-R, CF-SM-PLAN-C · HB-147 · validation-design/case-catalog.md §2 state-machine inventory; validation-design/contracts/OP-planning.md §2; docs/episodes/contract.md EpisodePlan authority and forward-only revisions.

import { writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { executeEpisodePlan, type EpisodePlanStepHandlers } from "../../../src/loop/episode-plan-executor.js";
import {
  EpisodePlanValidationError,
  episodePlanVersionPath,
  readCurrentEpisodePlan,
  readEpisodePlanVersion,
  type CreatorEpisodeScope,
  type EpisodeIntent,
  type EpisodePlan,
  type EpisodePlanValidationPolicy,
} from "../../../src/loop/episode-plan.js";
import {
  publishEpisodePlanRevision,
  readEpisodeReplanJournal,
  requestEpisodeReplan,
  type EpisodeReplanRecord,
} from "../../../src/loop/episode-replan.js";
import type { AppEntry } from "../../../src/org/apps.js";
import { prepareEpisodePlan } from "../../../src/org/episode-planner/coordinator.js";
import { buildEpisodeIntent, createEpisodePlanningPolicy } from "../../../src/org/episode-planner/policy.js";
import type { RoleConfig } from "../../../src/runtime/types.js";
import { makeTempStateHome, type TempStateHome } from "../../fixtures/state-home.js";

const app: AppEntry = {
  name: "plan-revision-app",
  repo: "cormidia-double/plan-revision-app",
  status: "live",
  budgetUsdMonth: 100,
  objectiveBudgetUsd: 100,
  cadence: {},
  execution: { assignmentMode: "fixed", allowedAssignments: {} },
};

const roles: RoleConfig[] = [
  {
    name: "planner",
    runtime: "claude",
    model: "claude-test",
    effort: "high",
    delegation: { allow: [] },
    triggers: [],
    outputs: ["plan"],
    maxTurnBudgetUsd: 5,
  },
  {
    name: "builder",
    runtime: "codex",
    model: "codex-test",
    effort: "high",
    delegation: { allow: [] },
    triggers: [],
    outputs: ["implementation"],
    maxTurnBudgetUsd: 5,
  },
];

function creatorScope(): CreatorEpisodeScope {
  return {
    planningDisposition: "execution_ready",
    provenance: {
      source: "human",
      creatorId: "owner",
      createdAt: "2026-08-11T12:00:00.000Z",
      evidenceRefs: ["request:hb-147"],
    },
    objective: "Implement and verify the bounded revision fixture.",
    inScope: ["src/fixture.ts"],
    outOfScope: ["unrelated work"],
    acceptanceCriteria: ["the verification artifact is produced"],
    expectedArtifacts: [{ id: "verification", kind: "report", required: true }],
    declaredConstraints: {},
    safetyFacts: [],
    steps: [
      {
        kind: "provider_turn",
        id: "implement",
        operation: "build/implement",
        role: "builder",
        objective: "Implement the fixture.",
        requiredCapabilities: [],
        dependsOn: [],
        inputRefs: [],
        expectedOutputs: [{ id: "implementation", kind: "file", required: true }],
        maxTurnBudgetUsd: 5,
        selectionReason: "The configured builder owns implementation.",
      },
      {
        kind: "mechanical_gate",
        id: "verify",
        objective: "Verify the fixture.",
        dependsOn: ["implement"],
        inputRefs: [{ ref: "plan-output:implementation", required: true }],
        expectedOutputs: [{ id: "verification", kind: "report", required: true }],
        gate: "quality-gates",
      },
    ],
  };
}

function intentFor(episodeId: string): EpisodeIntent {
  return buildEpisodeIntent({
    episodeId,
    app,
    roles,
    trigger: { kind: "manual" },
    goal: "Implement and verify the bounded revision fixture.",
    lifecycle: "live",
    appStage: "growth",
    repositoryFacts: { defaultBranch: "trunk" },
    requestedConstraints: {},
    hardBudget: {
      maxProviderTurns: 3,
      maxEquivalentCostUsd: 15,
      maxActiveTimeMs: 600_000,
      maxHumanDecisions: 0,
    },
    requiredSafetyFacts: [],
    creatorScope: creatorScope(),
  });
}

const handlers: EpisodePlanStepHandlers = {
  provider: async () => ({ status: "completed", artifact: { implementation: true } }),
  mechanical: async () => ({ status: "completed", artifact: { verification: true } }),
  approval: async () => ({ status: "failed", reasonCode: "unused", summary: "unused" }),
};

interface Rig {
  home: TempStateHome;
  intent: EpisodeIntent;
  previous: EpisodePlan;
  revision: EpisodePlan;
  policy: EpisodePlanValidationPolicy;
  request: EpisodeReplanRecord;
}

async function rig(name: string): Promise<Rig> {
  const home = await makeTempStateHome({ name });
  const intent = intentFor(`episode:${name}`);
  const prepared = await prepareEpisodePlan({
    root: home.stateHome,
    app,
    roles,
    intent,
    now: () => new Date("2026-08-11T12:00:00.000Z"),
  });
  await executeEpisodePlan({
    root: home.stateHome,
    plan: prepared.plan,
    handlers,
    maxSteps: 1,
    now: () => new Date("2026-08-11T12:01:00.000Z"),
  });
  const request = await requestEpisodeReplan({
    root: home.stateHome,
    episodeId: intent.episodeId,
    trigger: {
      id: `replan:${name}`,
      kind: "failed_gate",
      planVersion: 1,
      detectedAt: "2026-08-11T12:02:00.000Z",
      summary: "The future verification step needs revision.",
      evidenceRefs: ["gate:verification"],
      affectedStepIds: ["verify"],
    },
    now: new Date("2026-08-11T12:02:00.000Z"),
  });
  const revision = structuredClone(prepared.plan);
  revision.version = 2;
  revision.summary = "Implement and verify the bounded revised fixture.";
  revision.createdAt = "2026-08-11T12:03:00.000Z";
  const verification = revision.steps.find((step) => step.id === "verify");
  if (verification === undefined) throw new Error("revision fixture has no verification step");
  verification.objective = "Verify the revised fixture.";
  const policy = createEpisodePlanningPolicy(app, { intent, roles }).validation;
  return { home, intent, previous: prepared.plan, revision, policy, request };
}

async function publish(input: Rig, plan: EpisodePlan = input.revision): Promise<EpisodeReplanRecord> {
  return publishEpisodePlanRevision({
    root: input.home.stateHome,
    requestId: input.request.trigger.id,
    intent: input.intent,
    plan,
    policy: input.policy,
    now: new Date("2026-08-11T12:04:00.000Z"),
  });
}

describe("CF-SM-PLAN-L/I/R/C — EpisodePlan revisions are forward-only and crash-safe", () => {
  const homes: TempStateHome[] = [];
  afterEach(async () => Promise.all(homes.splice(0).map((home) => home.cleanup())));

  async function trackedRig(name: string): Promise<Rig> {
    const fixture = await rig(name);
    homes.push(fixture.home);
    return fixture;
  }

  it("CF-SM-PLAN-L accepts one legal future-only revision and advances durable authority", async () => {
    const fixture = await trackedRig("legal");
    const accepted = await publish(fixture);

    expect(accepted).toMatchObject({ status: "accepted", revisionVersion: 2 });
    expect(await readCurrentEpisodePlan(fixture.home.stateHome, fixture.intent.episodeId)).toEqual(fixture.revision);
    expect(fixture.revision.steps.find((step) => step.id === "implement")).toEqual(
      fixture.previous.steps.find((step) => step.id === "implement"),
    );
  });

  it("CF-SM-PLAN-I negative control: a seeded backward revision makes the version detector fire", async () => {
    const fixture = await trackedRig("backward");
    const backward = structuredClone(fixture.revision);
    backward.version = 1;

    await expect(publish(fixture, backward)).rejects.toMatchObject({
      code: "error_episode_replan_plan_version_changed",
    });
    expect((await readCurrentEpisodePlan(fixture.home.stateHome, fixture.intent.episodeId))?.version).toBe(1);
  });

  it("CF-SM-PLAN-I negative control: editing a completed step in place is refused", async () => {
    const fixture = await trackedRig("edit-completed");
    const edited = structuredClone(fixture.revision);
    const completed = edited.steps.find((step) => step.id === "implement");
    if (completed === undefined) throw new Error("revision fixture has no completed step");
    completed.objective = "Silently replace already-completed work.";

    const rejection = publish(fixture, edited).catch((error: unknown) => error);
    await expect(rejection).resolves.toBeInstanceOf(EpisodePlanValidationError);
    await expect(rejection).resolves.toMatchObject({
      issues: expect.arrayContaining([expect.objectContaining({ code: "plan_revision_completed_step_changed" })]),
    });
    expect((await readCurrentEpisodePlan(fixture.home.stateHome, fixture.intent.episodeId))?.version).toBe(1);
  });

  it("CF-SM-PLAN-R replays an identical accepted revision idempotently", async () => {
    const fixture = await trackedRig("replay");
    const first = await publish(fixture);

    const replayed = await publish(fixture);

    expect(replayed).toEqual(first);
    expect((await readEpisodeReplanJournal(fixture.home.stateHome, fixture.intent.episodeId))?.records).toEqual([
      first,
    ]);
    expect((await readCurrentEpisodePlan(fixture.home.stateHome, fixture.intent.episodeId))?.version).toBe(2);
  });

  it("CF-SM-PLAN-C resumes a crash between immutable plan publication and journal acceptance", async () => {
    const fixture = await trackedRig("checkpoint-crash");
    await expect(
      publishEpisodePlanRevision({
        root: fixture.home.stateHome,
        requestId: fixture.request.trigger.id,
        intent: fixture.intent,
        plan: fixture.revision,
        policy: fixture.policy,
        now: new Date("2026-08-11T12:04:00.000Z"),
        afterPlanPersisted: () => {
          throw new Error("seeded crash after immutable plan publication");
        },
      }),
    ).rejects.toThrow(/seeded crash/);
    expect((await readCurrentEpisodePlan(fixture.home.stateHome, fixture.intent.episodeId))?.version).toBe(2);
    expect(
      (await readEpisodeReplanJournal(fixture.home.stateHome, fixture.intent.episodeId))?.records[0],
    ).toMatchObject({
      status: "pending",
      revisionVersion: null,
    });

    const recovered = await publish(fixture);
    expect(recovered).toMatchObject({ status: "accepted", revisionVersion: 2 });
  });

  it("CF-SM-PLAN-C negative control: seeded torn version bytes never become current authority", async () => {
    const fixture = await trackedRig("torn-version");
    await writeFile(
      episodePlanVersionPath(fixture.home.stateHome, fixture.intent.episodeId, 2),
      '{"schemaVersion":1,"episodeId":"torn',
      "utf8",
    );

    await expect(readEpisodePlanVersion(fixture.home.stateHome, fixture.intent.episodeId, 2)).rejects.toMatchObject({
      code: "error_episode_plan_corrupt",
    });
    expect(await readCurrentEpisodePlan(fixture.home.stateHome, fixture.intent.episodeId)).toEqual(fixture.previous);
    expect(
      (await readEpisodeReplanJournal(fixture.home.stateHome, fixture.intent.episodeId))?.records[0],
    ).toMatchObject({
      status: "pending",
      revisionVersion: null,
    });
  });
});
