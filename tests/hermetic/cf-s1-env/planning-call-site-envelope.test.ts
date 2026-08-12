// Traceability: CF-S1-env · HB-151 · validation-design/llm-eval-plan.md §2 S-1; validation-design/contracts/OP-planning.md §§1–2; validation-design/contracts/B-20-roadmap-admission.md.

// HB-151 — S-1 deterministic envelope. Existing roadmap and J-03 specs retain
// credit only for their own slices; this family closes the aggregate malformed-
// plan, large-roadmap/delta/lazy-plan, and bounded-repair call-site contract.

import { existsSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import {
  deriveEpisodeSafetyRoute,
  episodeIntentHash,
  readCurrentEpisodePlan,
  type EpisodeIntent,
  type ProposedEpisodePlan,
  type ProposedEpisodeStep,
} from "../../../src/loop/episode-plan.js";
import { GhCliOps, type GhIssue } from "../../../src/loop/github.js";
import type { PublishedTicket, TicketPlan } from "../../../src/loop/plan-tickets.js";
import {
  admitEpisodePlanner,
  plannerAdmissionPath,
  type PlannerAdmissionLimits,
} from "../../../src/loop/planner-admission.js";
import type { AppEntry } from "../../../src/org/apps.js";
import { EpisodePlannerFailedError, prepareEpisodePlan } from "../../../src/org/episode-planner/coordinator.js";
import { buildEpisodeIntent } from "../../../src/org/episode-planner/policy.js";
import { persistPublishedRoadmap } from "../../../src/org/plan-auto.js";
import { ROADMAP_DELIVERY_SCHEMA_VERSION } from "../../../src/org/roadmap-delivery/authority-core.js";
import {
  acceptBacklogSnapshot,
  deriveBacklogDelta,
  readBacklogSnapshotAuthority,
} from "../../../src/org/roadmap-delivery/backlog-authority.js";
import type { BacklogSnapshot, RoadmapPlan } from "../../../src/org/roadmap-delivery/roadmap-model.js";
import { acceptRoadmapPlan, readCurrentRoadmapPlan } from "../../../src/org/roadmap-delivery/roadmap-plan.js";
import type { RoleConfig } from "../../../src/runtime/types.js";
import { installGithubDouble, type GithubDoubleHandle } from "../../fixtures/github-double/install.js";
import { makeTempStateHome, type TempStateHome } from "../../fixtures/state-home.js";

const AT = "2026-08-11T18:00:00.000Z";
const app: AppEntry = {
  name: "hb151-planning-envelope",
  repo: "cormidia-double/hb151-planning-envelope",
  status: "live",
  budgetUsdMonth: 100,
  objectiveBudgetUsd: 1_000,
  cadence: {},
  execution: { assignmentMode: "fixed", allowedAssignments: {} },
};

const plannerRole = role("planner", "claude", "planner-test");
const roles: RoleConfig[] = [plannerRole, role("builder", "codex", "builder-test")];
const homes: TempStateHome[] = [];
const githubs: GithubDoubleHandle[] = [];

afterEach(async () => {
  await Promise.all(githubs.splice(0).map((github) => github.dispose()));
  await Promise.all(homes.splice(0).map((home) => home.cleanup()));
});

function role(name: string, runtime: RoleConfig["runtime"], model: string): RoleConfig {
  return {
    name,
    runtime,
    model,
    effort: "high",
    delegation: { allow: [] },
    triggers: [],
    outputs: [name === "planner" ? "plan" : "artifact"],
    maxTurnBudgetUsd: 5,
  };
}

async function stateHome(name: string): Promise<TempStateHome> {
  const home = await makeTempStateHome({ name: `hb151-${name}` });
  homes.push(home);
  return home;
}

function intent(episodeId: string): EpisodeIntent {
  return buildEpisodeIntent({
    episodeId,
    app,
    roles,
    trigger: { kind: "manual" },
    goal: "Produce one bounded delivery plan.",
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
  });
}

function validProposal(input: EpisodeIntent, createdAt: string): ProposedEpisodePlan {
  const steps: ProposedEpisodeStep[] = [
    {
      id: "implement",
      kind: "provider_turn",
      operation: "build/implement",
      role: "builder",
      objective: "Implement the bounded fixture.",
      requiredCapabilities: [],
      dependsOn: [],
      inputRefs: [],
      expectedOutputs: [{ id: "artifact", kind: "file", required: true }],
      maxTurnBudgetUsd: 5,
      selectionReason: "The configured builder owns implementation.",
    },
  ];
  return {
    schemaVersion: 1,
    episodeId: input.episodeId,
    version: 1,
    intentHash: episodeIntentHash(input),
    summary: "Implement the bounded fixture.",
    workflowClass: "single-provider-step",
    planningSource: "episode_planner",
    steps,
    estimatedBudget: {
      providerTurns: 1,
      providerTurnBudgetUsd: 5,
      mechanicalOverheadUsd: 0,
      totalBudgetUsd: 5,
    },
    derivedSafetyRoute: deriveEpisodeSafetyRoute(steps, input.requiredSafetyFacts),
    createdAt,
  };
}

function snapshot(): BacklogSnapshot {
  return {
    schemaVersion: ROADMAP_DELIVERY_SCHEMA_VERSION,
    snapshotId: "malformed-roadmap-input",
    version: 1,
    app: app.name,
    source: "fixture:hb151",
    capturedAt: AT,
    completeness: "complete",
    pagination: { pagesObserved: 1, hasNextPage: false, unavailablePages: [] },
    issues: [
      {
        issueNumber: 1,
        contentHash: "1".repeat(64),
        lifecycle: "open",
        routing: "automated",
        observedLabels: [],
        dependencyIssues: [],
      },
    ],
  };
}

function roadmap(snapshotRef: RoadmapPlan["backlogSnapshotRef"]): RoadmapPlan {
  return {
    schemaVersion: ROADMAP_DELIVERY_SCHEMA_VERSION,
    planId: "malformed-roadmap-plan",
    version: 1,
    app: app.name,
    backlogSnapshotRef: snapshotRef,
    predecessor: null,
    workstreams: [{ workstreamId: "fixture", outcome: "Prove strict admission", priority: 1 }],
    deliveryUnits: [
      {
        unitId: "unit-1",
        workstreamId: "fixture",
        issueNumbers: [1],
        dependsOn: [],
        priority: 1,
        objective: "Deliver issue 1",
      },
    ],
    completedUnitIds: [],
    readyFrontier: [],
    wipLimit: 1,
    moves: [],
    acceptedAt: AT,
  };
}

function ticketPlan(): TicketPlan {
  return {
    stage: "growth",
    ticketCountRationale: "One planned issue within one aggregate backlog.",
    releaseDisposition: "The operator owns the merge-only milestone.",
    releaseKind: "merge-only",
    tickets: [
      {
        title: "Aggregate planned issue",
        tier: "op:tier-standard",
        priority: "p2",
        dependsOn: [],
        executionGroup: "aggregate",
        fileScope: ["src/feature.ts"],
        goal: "Deliver the planned aggregate slice.",
        context: "A bounded aggregate backlog fixture.",
        acceptanceCriteria: ["The aggregate slice has deterministic evidence."],
        outOfScope: "Unrelated work.",
        notesForBuilder: "Preserve aggregate planning authority.",
      },
    ],
  };
}

function issue(issueNumber: number, title = `Backlog issue ${issueNumber}`): GhIssue {
  return {
    number: issueNumber,
    title,
    body: `Body for backlog issue ${issueNumber}`,
    labels: issueNumber === 1 ? ["op:ready"] : [],
    state: "OPEN",
  };
}

function unitIdsByIssue(plan: RoadmapPlan): Map<number, string> {
  return new Map<number, string>(
    plan.deliveryUnits.flatMap((unit) => unit.issueNumbers.map((number): [number, string] => [number, unit.unitId])),
  );
}

describe("HB-151 — CF-S1-env deterministic planning-call-site envelope", () => {
  it("rejects a seeded malformed RoadmapPlan before publishing current authority", async () => {
    const home = await stateHome("malformed-roadmap");
    const acceptedSnapshot = await acceptBacklogSnapshot({ root: home.stateHome, snapshot: snapshot() });
    const malformed = roadmap(acceptedSnapshot.ref);
    Reflect.set(malformed, "schemaVersion", ROADMAP_DELIVERY_SCHEMA_VERSION + 1);

    await expect(acceptRoadmapPlan({ root: home.stateHome, plan: malformed })).rejects.toMatchObject({
      name: "RoadmapDeliveryError",
      code: "roadmap_invalid",
    });
    expect(await readCurrentRoadmapPlan(home.stateHome, app.name)).toBeUndefined();
  });

  it("handles a malformed EpisodePlan with one bounded repair and persists only the valid plan", async () => {
    const home = await stateHome("episode-plan-repair");
    const episodeIntent = intent("hb151-episode-repair");
    const attempts: number[] = [];
    const diagnostics: string[][] = [];

    const prepared = await prepareEpisodePlan({
      root: home.stateHome,
      app,
      roles,
      intent: episodeIntent,
      providerOperations: ["build/implement"],
      now: () => new Date(AT),
      propose: async (request) => {
        attempts.push(request.attempt);
        diagnostics.push(request.validationDiagnostics.map((entry) => entry.code));
        if (request.attempt === 1) {
          const malformed = validProposal(request.intent, request.proposalCreatedAt);
          malformed.steps = [];
          return malformed;
        }
        return validProposal(request.intent, request.proposalCreatedAt);
      },
    });

    expect(attempts).toEqual([1, 2]);
    expect(diagnostics[0]).toEqual([]);
    expect(diagnostics[1]).toContain("plan_structure_invalid");
    expect(prepared).toMatchObject({ plannerAttempts: 2, planningTurnSkipped: false });
    expect(await readCurrentEpisodePlan(home.stateHome, episodeIntent.episodeId)).toEqual(prepared.plan);
  });

  it("stops after the single repair when both EpisodePlan proposals remain malformed", async () => {
    const home = await stateHome("episode-plan-repair-stop");
    const episodeIntent = intent("hb151-episode-repair-stop");
    const attempts: number[] = [];

    const failure = await prepareEpisodePlan({
      root: home.stateHome,
      app,
      roles,
      intent: episodeIntent,
      providerOperations: ["build/implement"],
      now: () => new Date(AT),
      propose: async (request) => {
        attempts.push(request.attempt);
        const malformed = validProposal(request.intent, request.proposalCreatedAt);
        malformed.steps = [];
        return malformed;
      },
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(EpisodePlannerFailedError);
    expect(failure).toMatchObject({ attempts: 2 });
    expect(attempts).toEqual([1, 2]);
    expect(await readCurrentEpisodePlan(home.stateHome, episodeIntent.episodeId)).toBeUndefined();
  });

  it("plans one aggregate 100-item roadmap, reuses a bounded delta, and creates no eager EpisodePlans", async () => {
    const home = await stateHome("aggregate-roadmap");
    const github = await installGithubDouble({ repo: app.repo, defaultBranch: "trunk" });
    githubs.push(github);
    const gh = new GhCliOps(github.repo, github.exec);
    const published: PublishedTicket[] = [
      {
        index: 0,
        issueNumber: 1,
        title: "Aggregate planned issue",
        ready: true,
        labels: ["op:tier-standard", "p2", "op:ready"],
      },
    ];
    const initialIssues = Array.from({ length: 100 }, (_, index) => issue(index + 1));

    await persistPublishedRoadmap({
      stateHome: home.stateHome,
      app,
      gh,
      plan: ticketPlan(),
      published,
      issues: initialIssues,
      readyIssueNumbers: [1],
      now: new Date(AT),
    });
    const first = await readCurrentRoadmapPlan(home.stateHome, app.name);
    if (first === undefined) throw new Error("initial aggregate RoadmapPlan was not persisted");
    const firstSnapshot = await readBacklogSnapshotAuthority(home.stateHome, app.name, first.value.backlogSnapshotRef);
    const accounted = first.value.deliveryUnits
      .flatMap((unit) => unit.issueNumbers)
      .sort((left, right) => left - right);
    expect(accounted).toEqual(Array.from({ length: 100 }, (_, index) => index + 1));
    expect(new Set(accounted).size).toBe(100);
    expect(first.value.readyFrontier).toHaveLength(1);
    expect(existsSync(home.path("efficiency"))).toBe(false);

    const nextIssues = initialIssues.map((entry) =>
      entry.number === 100 ? issue(100, "Changed backlog issue 100") : structuredClone(entry),
    );
    nextIssues.push(issue(101));
    await persistPublishedRoadmap({
      stateHome: home.stateHome,
      app,
      gh,
      plan: ticketPlan(),
      published,
      issues: nextIssues,
      readyIssueNumbers: [1],
      now: new Date("2026-08-11T18:01:00.000Z"),
    });
    const second = await readCurrentRoadmapPlan(home.stateHome, app.name);
    if (second === undefined) throw new Error("delta RoadmapPlan was not persisted");
    const secondSnapshot = await readBacklogSnapshotAuthority(
      home.stateHome,
      app.name,
      second.value.backlogSnapshotRef,
    );
    expect(deriveBacklogDelta(firstSnapshot, secondSnapshot)).toMatchObject({
      addedIssueNumbers: [101],
      removedIssueNumbers: [],
      changedIssueNumbers: [100],
    });
    expect(deriveBacklogDelta(firstSnapshot, secondSnapshot).unchangedIssueNumbers).toHaveLength(99);
    const firstUnits = unitIdsByIssue(first.value);
    const secondUnits = unitIdsByIssue(second.value);
    expect(Array.from({ length: 100 }, (_, index) => secondUnits.get(index + 1))).toEqual(
      Array.from({ length: 100 }, (_, index) => firstUnits.get(index + 1)),
    );
    expect(second.value.version).toBe(2);
    expect(existsSync(home.path("efficiency"))).toBe(false);
  });

  it("binds the complete repair budget and rejects a seeded second repair before runtime construction", async () => {
    const limits: PlannerAdmissionLimits = {
      maxAttempts: 2,
      perAttempt: { equivalentCostUsd: 5, activeTimeMs: 120_000 },
      aggregate: { providerTurns: 2, equivalentCostUsd: 10, activeTimeMs: 240_000 },
    };
    const acceptedHome = await stateHome("repair-budget");
    const acceptedIntent = intent("hb151-repair-budget");
    const admission = await admitEpisodePlanner({
      root: acceptedHome.stateHome,
      episodeId: acceptedIntent.episodeId,
      app: app.name,
      policyVersion: "hb151/v1",
      intentHash: episodeIntentHash(acceptedIntent),
      plannerRole,
      requiredCapabilities: [],
      limits,
      now: new Date(AT),
    });
    expect(admission.budget).toEqual({
      max_attempts: 2,
      per_attempt: { equivalent_cost_usd: 5, active_time_ms: 120_000 },
      aggregate: { provider_turns: 2, equivalent_cost_usd: 10, active_time_ms: 240_000 },
    });

    const rejectedHome = await stateHome("over-budget-repair");
    const rejectedIntent = intent("hb151-over-budget-repair");
    await expect(
      admitEpisodePlanner({
        root: rejectedHome.stateHome,
        episodeId: rejectedIntent.episodeId,
        app: app.name,
        policyVersion: "hb151/v1",
        intentHash: episodeIntentHash(rejectedIntent),
        plannerRole,
        requiredCapabilities: [],
        limits: {
          maxAttempts: 3,
          perAttempt: limits.perAttempt,
          aggregate: { providerTurns: 3, equivalentCostUsd: 15, activeTimeMs: 360_000 },
        },
        now: new Date(AT),
      }),
    ).rejects.toThrow("EpisodePlanner maxAttempts must be between 1 and 2");
    expect(existsSync(plannerAdmissionPath(rejectedHome.stateHome, rejectedIntent.episodeId))).toBe(false);
  });
});
