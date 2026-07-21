import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import {
  checkProviderBudget,
  readEfficiencyEvidence,
  readExecutionSteps,
  reconcileStaleProviderSteps,
  routeRecordPath,
  type AdmissionFactor,
  type AuthorizedPass,
} from "../../src/loop/efficiency.js";
import {
  EPISODE_PLAN_SCHEMA_VERSION,
  deriveEpisodeSafetyRoute,
  episodePlanMutationLockPath,
  episodeIntentHash,
  type EpisodeIntent,
  type EpisodePlan,
  type EpisodePlanValidationPolicy,
} from "../../src/loop/episode-plan.js";
import {
  admitEpisodePlanner,
  admitPlannedEpisodeRoute,
  beginEpisodePlannerAttempt,
  finalizeEpisodePlannerAttempt,
  MAX_EPISODE_PLANNER_ATTEMPTS,
  persistAcceptedEpisodePlannerPlan,
  plannerAdmissionPath,
  plannerPlanAcceptancePath,
  plannerPlanPublicationPath,
  readPlannerAdmission,
  readPlannerBudgetStatus,
  type PlannerAdmissionLimits,
} from "../../src/loop/planner-admission.js";
import {
  publishEpisodePlanRevision,
  requestEpisodeReplan,
} from "../../src/loop/episode-replan.js";
import { turnAssignmentsEqual } from "../../src/runtime/assignment.js";
import { acquireFileLock, releaseFileLock } from "../../src/runtime/file-lock.js";
import type {
  RoleConfig,
  TurnAssignment,
  TurnResult,
} from "../../src/runtime/types.js";
import { makeOrgHome, type OrgHomeFixture } from "../fixtures/orgHome.js";

const PLANNER: RoleConfig = {
  name: "planner",
  runtime: "codex",
  model: "gpt-planner-test",
  effort: "high",
  adaptiveAssignments: [{
    id: "adaptive-not-boot",
    harness: "claude",
    model: "claude-adaptive-test",
    efforts: ["high"],
    providerFamily: "anthropic",
    capabilityRef: "test-capabilities",
    qualificationRef: "test-qualification",
    pricing: { kind: "conservative_estimate", maxTurnCostUsd: 1, sourceRef: "test-price" },
  }],
  delegation: { allow: [] },
  triggers: [],
  outputs: [],
  maxTurnBudgetUsd: 2,
};
const BOOT_ASSIGNMENT: TurnAssignment = {
  harness: PLANNER.runtime,
  model: PLANNER.model,
  effort: PLANNER.effort,
};
const LIMITS: PlannerAdmissionLimits = {
  maxAttempts: 2,
  perAttempt: {
    equivalentCostUsd: 1,
    activeTimeMs: 1_000,
  },
  aggregate: {
    providerTurns: 2,
    equivalentCostUsd: 2,
    activeTimeMs: 2_000,
  },
};
const FACTOR: AdmissionFactor = {
  kind: "uncertainty",
  evidence: "accepted EpisodePlan requires one bounded delivery turn",
  policy_rule: "accepted_plan_v1",
};
const PASS: AuthorizedPass = {
  pipeline: "episode-plan-dag",
  pass: "deliver",
  role: PLANNER.name,
  runtime: PLANNER.runtime,
  model: PLANNER.model,
  effort: PLANNER.effort,
  factor_rules: [FACTOR.policy_rule],
  assignment_source: "configured",
  assignment_candidate_id: "configured",
  plan_version: 1,
  plan_step_id: "deliver",
  selection_reason: "The accepted plan contains one bounded delivery step",
  provider_family: "openai",
  resolved_capabilities: ["workspace-read"],
};

describe("EpisodePlanner pre-route admission", () => {
  let home: OrgHomeFixture;
  afterEach(() => home?.cleanup());

  it("persists the fixed boot tuple before construction without inventing route.json", async () => {
    home = makeOrgHome();
    const episodeId = "episode:planner-admission";
    const record = await admission(home.root, episodeId);

    expect(existsSync(plannerAdmissionPath(home.root, episodeId))).toBe(true);
    expect(existsSync(routeRecordPath(home.root, episodeId))).toBe(false);
    expect(record).toMatchObject({
      assignment_source: "configured",
      assignment_candidate_id: "configured",
      boot_assignment: BOOT_ASSIGNMENT,
      budget: {
        max_attempts: 2,
        per_attempt: { equivalent_cost_usd: 1, active_time_ms: 1_000 },
        aggregate: { provider_turns: 2, equivalent_cost_usd: 2, active_time_ms: 2_000 },
      },
    });
    expect(turnAssignmentsEqual(record.boot_assignment, BOOT_ASSIGNMENT)).toBe(true);
    expect(record.boot_assignment).not.toMatchObject({ harness: "claude" });

    // Existing evidence readers retain their route-null shape while treating
    // the deliberate pre-route marker as valid evidence rather than damage.
    expect(await readEfficiencyEvidence(home.root)).toMatchObject([{
      route: null,
      steps: [],
      pending_started: [],
      corrupt_files: [],
    }]);
  });

  it("makes conflicting admission and concurrent reservation fail closed", async () => {
    home = makeOrgHome();
    const episodeId = "episode:planner-race";
    const first = admission(home.root, episodeId, { intentHash: digest("intent-a") });
    const conflicting = admission(home.root, episodeId, { intentHash: digest("intent-b") });
    const outcomes = await Promise.allSettled([first, conflicting]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    const rejected = outcomes.find((outcome) => outcome.status === "rejected");
    expect(rejected).toMatchObject({
      status: "rejected",
      reason: expect.objectContaining({ code: "error_episode_planner_admission_conflict" }),
    });

    const persisted = await readPlannerAdmission(home.root, episodeId);
    const intentHash = persisted!.intent_hash;
    const reservations = await Promise.allSettled([
      beginAttempt(home.root, episodeId, 1, "run-a", digest("attempt-a")),
      beginAttempt(home.root, episodeId, 1, "run-b", digest("attempt-b")),
    ]);
    expect(reservations.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(reservations.find((outcome) => outcome.status === "rejected")).toMatchObject({
      status: "rejected",
      reason: expect.objectContaining({ code: "error_episode_planner_attempt_in_flight" }),
    });
    expect((await readPlannerAdmission(home.root, episodeId))?.intent_hash).toBe(intentHash);
    expect(existsSync(routeRecordPath(home.root, episodeId))).toBe(false);
  });

  it("resumes terminal planner evidence without reserving or charging the attempt again", async () => {
    home = makeOrgHome();
    const episodeId = "episode:planner-resume";
    await admission(home.root, episodeId);
    const begun = await beginAttempt(home.root, episodeId, 1, "run-1", digest("attempt-1"));
    expect(begun.kind).toBe("start");
    if (begun.kind !== "start") throw new Error("expected start");
    const terminal = await finalizeEpisodePlannerAttempt({
      root: home.root,
      episodeId,
      app: "fixture",
      runId: "run-1",
      attempt: 1,
      plannerRole: PLANNER,
      started: begun.started,
      result: result(),
      finishedAt: new Date("2026-07-19T00:00:00.500Z"),
      contextManifestRef: "context-manifest.json",
    });

    const resumed = await beginAttempt(home.root, episodeId, 1, "run-retry", digest("retry-input"));
    expect(resumed).toMatchObject({
      kind: "resume_terminal",
      attempt: 1,
      step: { execution_step_id: terminal.execution_step_id, provider_turn_id: terminal.provider_turn_id },
    });
    expect(await readPlannerBudgetStatus(home.root, episodeId)).toMatchObject({
      settled: { providerTurns: 1, equivalentCostUsd: 0.25, activeTimeMs: 500 },
      reserved: { providerTurns: 0, equivalentCostUsd: 0 },
      terminalAttempts: [1],
      pendingAttempts: [],
    });
    expect(await readExecutionSteps(home.root, episodeId)).toHaveLength(1);

    const repair = await beginAttempt(home.root, episodeId, 2, "run-2", digest("repair-input"));
    expect(repair).toMatchObject({
      kind: "start",
      attempt: 2,
      assignment: BOOT_ASSIGNMENT,
      started: {
        reservation: { equivalentCostUsd: 1, activeTimeMs: 1_000 },
      },
    });
  });

  it("enforces the two-attempt maximum and exact per-attempt/aggregate ceilings", async () => {
    home = makeOrgHome();
    await expect(admission(home.root, "episode:too-many", {
      limits: {
        ...LIMITS,
        maxAttempts: MAX_EPISODE_PLANNER_ATTEMPTS + 1,
        aggregate: { ...LIMITS.aggregate, providerTurns: MAX_EPISODE_PLANNER_ATTEMPTS + 1 },
      },
    })).rejects.toThrow(`between 1 and ${MAX_EPISODE_PLANNER_ATTEMPTS}`);

    const episodeId = "episode:aggregate-cap";
    await admission(home.root, episodeId, {
      limits: { ...LIMITS, aggregate: { ...LIMITS.aggregate, equivalentCostUsd: 1.5 } },
    });
    const begun = await beginAttempt(home.root, episodeId, 1, "run-1", digest("attempt-1"));
    if (begun.kind !== "start") throw new Error("expected start");
    await finalizeEpisodePlannerAttempt({
      root: home.root,
      episodeId,
      app: "fixture",
      runId: "run-1",
      attempt: 1,
      plannerRole: PLANNER,
      started: begun.started,
      result: result({ costUsd: 0.75 }),
      finishedAt: new Date("2026-07-19T00:00:00.500Z"),
      contextManifestRef: "context-manifest.json",
    });
    await expect(beginAttempt(home.root, episodeId, 2, "run-2", digest("attempt-2"))).rejects.toMatchObject({
      code: "error_episode_planner_budget_exhausted",
    });

    const overrunEpisode = "episode:attempt-overrun";
    await admission(home.root, overrunEpisode);
    const overrun = await beginAttempt(home.root, overrunEpisode, 1, "overrun", digest("overrun"));
    if (overrun.kind !== "start") throw new Error("expected start");
    await expect(finalizeEpisodePlannerAttempt({
      root: home.root,
      episodeId: overrunEpisode,
      app: "fixture",
      runId: "overrun",
      attempt: 1,
      plannerRole: PLANNER,
      started: overrun.started,
      result: result({ costUsd: 1.01 }),
      finishedAt: new Date("2026-07-19T00:00:00.500Z"),
      contextManifestRef: "context-manifest.json",
    })).rejects.toMatchObject({
      code: "error_episode_planner_budget_exhausted",
      terminalStep: expect.objectContaining({ usage: expect.objectContaining({ costUsd: 1.01 }) }),
    });
    expect(await readExecutionSteps(home.root, overrunEpisode)).toHaveLength(1);
    await expect(beginAttempt(home.root, overrunEpisode, 2, "blocked", digest("blocked"))).rejects.toMatchObject({
      code: "error_episode_planner_budget_exhausted",
    });
  });

  it("uses standard stale reconciliation and fails closed when planner usage is unavailable", async () => {
    home = makeOrgHome();
    const episodeId = "episode:planner-stale";
    await admission(home.root, episodeId);
    await beginAttempt(home.root, episodeId, 1, "stale-run", digest("stale"));
    const reconciled = await reconcileStaleProviderSteps(
      home.root,
      new Date("2026-07-19T00:01:00.000Z"),
      1,
    );
    expect(reconciled.finalized).toMatchObject([{
      execution_step_id: "episode-planner:attempt:1",
      status: "interrupted",
      error_code: "error_stale_missing_finalization",
      assignment_source: "configured",
    }]);
    await expect(beginAttempt(home.root, episodeId, 2, "repair", digest("repair"))).rejects.toMatchObject({
      code: "error_episode_planner_budget_unmeasured",
    });
  });

  it("persists the accepted plan before admitting a route that includes planner consumption once", async () => {
    home = makeOrgHome();
    const episodeId = "episode:planned-route";
    const intent = makeIntent(episodeId);
    await admission(home.root, episodeId, { intentHash: episodeIntentHash(intent) });
    const begun = await beginAttempt(home.root, episodeId, 1, "planner-run", digest("planner-input"));
    if (begun.kind !== "start") throw new Error("expected start");
    await finalizeEpisodePlannerAttempt({
      root: home.root,
      episodeId,
      app: "fixture",
      runId: "planner-run",
      attempt: 1,
      plannerRole: PLANNER,
      started: begun.started,
      result: result(),
      finishedAt: new Date("2026-07-19T00:00:00.500Z"),
      contextManifestRef: "context-manifest.json",
    });
    const plan = makePlan(intent);
    const policy = makePolicy();
    await persistAcceptedEpisodePlannerPlan({
      root: home.root,
      plan,
      intent,
      policy,
      now: new Date("2026-07-19T00:00:01.000Z"),
    });
    expect(existsSync(routeRecordPath(home.root, episodeId))).toBe(false);

    await expect(admitPlannedEpisodeRoute({
      root: home.root,
      episodeId,
      app: "fixture",
      route: "quick",
      policyVersion: "episode-plan/test-v1",
      factors: [FACTOR],
      passes: [PASS],
      budgetOverrides: { provider_turns: 1 },
      executionBounds: null,
      now: new Date("2026-07-19T00:00:02.000Z"),
    })).rejects.toMatchObject({ code: "error_episode_planner_derived_route_budget" });
    expect(existsSync(routeRecordPath(home.root, episodeId))).toBe(false);

    const admitted = await admitPlannedEpisodeRoute({
      root: home.root,
      episodeId,
      app: "fixture",
      route: "quick",
      policyVersion: "episode-plan/test-v1",
      factors: [FACTOR],
      passes: [PASS],
      executionBounds: null,
      now: new Date("2026-07-19T00:00:02.000Z"),
    });
    expect(admitted.consumedBeforeRoute).toEqual({
      providerTurns: 1,
      equivalentCostUsd: 0.25,
      activeTimeMs: 500,
    });
    expect(await checkProviderBudget({ root: home.root, episodeId })).toMatchObject({
      allowed: true,
      counters: { provider_turns: 1, equivalent_cost_usd: 0.25 },
      remaining: { provider_turns: 2, equivalent_cost_usd: 7.75 },
    });

    const resumed = await beginAttempt(home.root, episodeId, 2, "must-not-run", digest("no-rerun"));
    expect(resumed).toMatchObject({ kind: "plan_accepted", plan: { version: 1 } });
    expect(await readExecutionSteps(home.root, episodeId)).toHaveLength(1);
  });

  it("keeps immutable acceptance evidence for every accepted planner-authored version", async () => {
    home = makeOrgHome();
    const episodeId = "episode:versioned-plan-acceptance";
    const intent = makeIntent(episodeId);
    await admission(home.root, episodeId, { intentHash: episodeIntentHash(intent) });
    const begun = await beginAttempt(home.root, episodeId, 1, "planner-run", digest("planner-input"));
    if (begun.kind !== "start") throw new Error("expected start");
    await finalizeEpisodePlannerAttempt({
      root: home.root,
      episodeId,
      app: "fixture",
      runId: "planner-run",
      attempt: 1,
      plannerRole: PLANNER,
      started: begun.started,
      result: result(),
      finishedAt: new Date("2026-07-19T00:00:00.500Z"),
      contextManifestRef: "context-manifest.json",
    });
    const v1 = makePlan(intent);
    const policy = makePolicy();
    await persistAcceptedEpisodePlannerPlan({
      root: home.root,
      plan: v1,
      intent,
      policy,
      now: new Date("2026-07-19T00:00:01.000Z"),
    });
    await admitPlannedEpisodeRoute({
      root: home.root,
      episodeId,
      app: "fixture",
      route: "quick",
      policyVersion: "episode-plan/test-v1",
      factors: [FACTOR],
      passes: [PASS],
      executionBounds: null,
      now: new Date("2026-07-19T00:00:01.500Z"),
    });
    const v2 = structuredClone(v1);
    v2.version = 2;
    v2.summary = "Forward-only revised planner-authored workflow";
    v2.createdAt = "2026-07-19T00:00:02.000Z";
    const delivery = v2.steps[0];
    if (delivery?.kind !== "provider_turn") throw new Error("expected provider step");
    delivery.expectedOutputs = [{ id: "intermediate", kind: "note", required: true }];
    v2.steps.push({
      ...structuredClone(delivery),
      id: "verify",
      objective: "Verify and publish the required artifact",
      dependsOn: ["deliver"],
      expectedOutputs: [{ id: "done", kind: "note", required: true }],
      selectionReason: "A revision added one bounded verification turn",
    });
    v2.estimatedBudget = {
      providerTurns: 2,
      providerTurnBudgetUsd: 2,
      mechanicalOverheadUsd: 0,
      totalBudgetUsd: 2,
    };
    v2.derivedSafetyRoute = deriveEpisodeSafetyRoute(v2.steps, intent.requiredSafetyFacts);
    await requestEpisodeReplan({
      root: home.root,
      episodeId,
      trigger: {
        id: "planner-versioned-acceptance-v2",
        kind: "new_scope",
        planVersion: 1,
        detectedAt: "2026-07-19T00:00:01.750Z",
        summary: "Add one bounded verification turn",
        evidenceRefs: ["test:planner-versioned-acceptance"],
        affectedStepIds: ["deliver", "verify"],
      },
    });
    await publishEpisodePlanRevision({
      root: home.root,
      requestId: "planner-versioned-acceptance-v2",
      plan: v2,
      intent,
      policy,
      now: new Date("2026-07-19T00:00:01.900Z"),
    });
    await persistAcceptedEpisodePlannerPlan({
      root: home.root,
      plan: v2,
      intent,
      policy,
      now: new Date("2026-07-19T00:00:02.000Z"),
    });
    const revisedPasses: AuthorizedPass[] = v2.steps.map((step) => {
      if (step.kind !== "provider_turn") throw new Error("expected provider step");
      return {
        ...PASS,
        pass: step.id,
        plan_version: 2,
        plan_step_id: step.id,
        selection_reason: step.selectionReason,
      };
    });
    const revisedRoute = await admitPlannedEpisodeRoute({
      root: home.root,
      episodeId,
      app: "fixture",
      route: "standard",
      policyVersion: "episode-plan/test-v1",
      factors: [FACTOR],
      passes: revisedPasses,
      executionBounds: null,
      now: new Date("2026-07-19T00:00:02.500Z"),
    });

    expect(existsSync(plannerPlanAcceptancePath(home.root, episodeId, 1))).toBe(true);
    expect(existsSync(plannerPlanAcceptancePath(home.root, episodeId, 2))).toBe(true);
    const latest = JSON.parse(
      await readFile(plannerPlanAcceptancePath(home.root, episodeId), "utf8"),
    ) as Record<string, unknown>;
    expect(latest).toMatchObject({ episode_id: episodeId, plan_version: 2 });
    const historical = JSON.parse(
      await readFile(plannerPlanAcceptancePath(home.root, episodeId, 1), "utf8"),
    ) as Record<string, unknown>;
    expect(historical).toMatchObject({ episode_id: episodeId, plan_version: 1 });
    expect(revisedRoute.route).toMatchObject({
      planned_route: "quick",
      current_route: "standard",
      current_plan_version: 2,
    });
    expect(revisedRoute.route.authorized_passes.map((pass) => [pass.plan_version, pass.plan_step_id]))
      .toEqual([[1, "deliver"], [2, "deliver"], [2, "verify"]]);
  });

  it("does not hold the planner lock while waiting to publish under the plan lock", async () => {
    home = makeOrgHome();
    const episodeId = "episode:planner-plan-lock-order";
    const intent = makeIntent(episodeId);
    await admission(home.root, episodeId, { intentHash: episodeIntentHash(intent) });
    const begun = await beginAttempt(home.root, episodeId, 1, "planner-run", digest("planner-input"));
    if (begun.kind !== "start") throw new Error("expected start");
    await finalizeEpisodePlannerAttempt({
      root: home.root,
      episodeId,
      app: "fixture",
      runId: "planner-run",
      attempt: 1,
      plannerRole: PLANNER,
      started: begun.started,
      result: result(),
      finishedAt: new Date("2026-07-19T00:00:00.500Z"),
      contextManifestRef: "context-manifest.json",
    });

    const lockPath = episodePlanMutationLockPath(home.root, episodeId);
    const token = await acquireFileLock(lockPath, {
      staleMs: 60_000,
      maxWaitMs: 1_000,
      retryMinMs: 1,
      retryMaxMs: 1,
    });
    const publication = persistAcceptedEpisodePlannerPlan({
      root: home.root,
      plan: makePlan(intent),
      intent,
      policy: makePolicy(),
      now: new Date("2026-07-19T00:00:01.000Z"),
    });
    try {
      await waitForFile(plannerPlanPublicationPath(home.root, episodeId));
      await expect(beginAttempt(
        home.root,
        episodeId,
        2,
        "repair-must-not-start",
        digest("repair-must-not-start"),
      )).rejects.toMatchObject({ code: "error_episode_planner_plan_already_accepted" });
    } finally {
      await releaseFileLock(lockPath, token);
    }
    await expect(publication).resolves.toMatchObject({ version: 1 });
    expect(existsSync(plannerPlanPublicationPath(home.root, episodeId))).toBe(false);
  });
});

async function admission(
  root: string,
  episodeId: string,
  overrides: { intentHash?: string; limits?: PlannerAdmissionLimits } = {},
) {
  return admitEpisodePlanner({
    root,
    episodeId,
    app: "fixture",
    policyVersion: "episode-planner/test-v1",
    intentHash: overrides.intentHash ?? digest(`intent:${episodeId}`),
    plannerRole: PLANNER,
    requiredCapabilities: ["structured_verdict"],
    limits: overrides.limits ?? LIMITS,
    now: new Date("2026-07-19T00:00:00.000Z"),
  });
}

function beginAttempt(root: string, episodeId: string, attempt: number, runId: string, inputFingerprint: string) {
  return beginEpisodePlannerAttempt({
    root,
    episodeId,
    app: "fixture",
    runId,
    attempt,
    inputFingerprint,
    now: new Date("2026-07-19T00:00:00.000Z"),
  });
}

function result(usage: Partial<TurnResult["usage"]> = {}): TurnResult {
  return {
    status: "completed",
    summary: "schema-valid plan proposal",
    artifacts: [],
    session: { runtime: "codex", id: "planner-session" },
    usage: {
      tokensIn: 50,
      tokensOut: 10,
      costUsd: 0.25,
      subagentTurns: 0,
      wallClockMs: 500,
      quality: "complete",
      ...usage,
    },
    escalations: [],
  };
}

async function waitForFile(path: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (existsSync(path)) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`timed out waiting for ${path}`);
}

function makeIntent(episodeId: string): EpisodeIntent {
  return {
    episodeId,
    app: "fixture",
    assignmentMode: "fixed",
    trigger: { kind: "test" },
    goal: "produce a bounded delivery artifact",
    lifecycle: "bounded-goal",
    appStage: "growth",
    repositoryFacts: {},
    requestedConstraints: {},
    hardBudget: { maxProviderTurns: 2, maxEquivalentCostUsd: 5 },
    availableRoles: [{
      role: PLANNER.name,
      responsibility: "plan and deliver the bounded fixture",
      requiredCapabilities: ["workspace-read"],
      expectedOutputs: ["done"],
      configuredAssignment: BOOT_ASSIGNMENT,
    }],
    allowedAssignments: [{
      candidateId: "configured",
      role: PLANNER.name,
      assignment: BOOT_ASSIGNMENT,
      providerFamily: "openai",
      capabilities: ["workspace-read"],
      qualificationRef: "test-qualification",
      priceRef: "test-price",
      maxTurnCostUsd: 1,
      available: true,
    }],
    requiredSafetyFacts: [],
  };
}

function makePlan(intent: EpisodeIntent): EpisodePlan {
  const steps: EpisodePlan["steps"] = [{
    kind: "provider_turn",
    operation: "episode-planner/plan",
    id: "deliver",
    role: PLANNER.name,
    objective: "Produce the required artifact",
    dependsOn: [],
    requiredCapabilities: ["workspace-read"],
    assignment: BOOT_ASSIGNMENT,
    assignmentSource: "configured",
    inputRefs: [],
    expectedOutputs: [{ id: "done", kind: "note", required: true }],
    maxTurnBudgetUsd: 1,
    selectionReason: PASS.selection_reason!,
  }];
  return {
    schemaVersion: EPISODE_PLAN_SCHEMA_VERSION,
    episodeId: intent.episodeId,
    version: 1,
    intentHash: episodeIntentHash(intent),
    summary: "One bounded delivery turn",
    workflowClass: "bounded-delivery",
    planningSource: "episode_planner",
    steps,
    estimatedBudget: {
      providerTurns: 1,
      providerTurnBudgetUsd: 1,
      mechanicalOverheadUsd: 0,
      totalBudgetUsd: 1,
    },
    derivedSafetyRoute: deriveEpisodeSafetyRoute(steps, intent.requiredSafetyFacts),
    createdAt: "2026-07-19T00:00:01.000Z",
  };
}

function makePolicy(): EpisodePlanValidationPolicy {
  return {
    mode: "fixed",
    configuredAssignmentFor: (role) => role === PLANNER.name ? BOOT_ASSIGNMENT : undefined,
    isAssignmentAllowed: (role, assignment) => role === PLANNER.name && turnAssignmentsEqual(assignment, BOOT_ASSIGNMENT),
    isKnownRole: (role) => role === PLANNER.name,
    capabilitiesFor: () => ["workspace-read"],
    requiredTerminalOutputIds: ["done"],
  };
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
