import { writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppEntry, AppsFile } from "../../../src/org/apps.js";
import type { RoleConfig, TurnAssignment } from "../../../src/runtime/types.js";
import { stableHash, type CreatorEpisodeScope, type ProposedEpisodeStep } from "../../../src/loop/episode-plan.js";
import {
  ROADMAP_DELIVERY_SCHEMA_VERSION,
  acceptBacklogSnapshot,
  acceptDeliveryUnitReadiness,
  acceptDirectExecutionUnit,
  acceptRoadmapPlan,
  acceptValidationCatalog,
  acceptValidationContract,
  admitExecutionBatch,
  currentRoadmapPointerPath,
  executionBatchDispositionPath,
  normalizeDeliveryUnitEpisode,
  readExecutionUnitJournal,
  transitionExecutionUnitJournal,
  unitMembershipHash,
  type AcceptedRoadmapPlan,
  type AuthorityRef,
  type DirectExecutionUnitAuthority,
  type RoadmapPlan,
  type ValidationContract,
} from "../../../src/org/roadmap-delivery.js";
import {
  createExecutionContextAffinityManifest,
  prepareExecutionAffinityTurn,
  settleExecutionAffinityTurn,
} from "../../../src/org/execution-affinity.js";
import { readRoadmapExplanation } from "../../../src/org/roadmap-explanation.js";
import { cmdStatus } from "../../../src/cli/status.js";
import { buildReport } from "../../../src/report/project.js";
import { renderReportTerminal } from "../../../src/report/render-terminal.js";
import { renderReportHtml } from "../../../src/report/render-html.js";
import { indexLocalSources } from "../../../src/observe/file-index.js";
import { projectObserveSnapshot } from "../../../src/observe/project.js";
import { makeTempStateHome, type TempStateHome } from "../../fixtures/state-home.js";
import {
  VALIDATION_BASE_AFFECTED,
  VALIDATION_EMPTY_AFFECTED,
  validationCatalog,
} from "../../fixtures/validation-catalog.js";

const AT = "2026-08-04T12:00:00.000Z";
const APP: AppEntry = {
  name: "hb110-app",
  repo: "fixture/hb110",
  status: "live",
  budgetUsdMonth: 100,
  objectiveBudgetUsd: 1000,
  cadence: {},
  channels: {},
  execution: { assignmentMode: "fixed", allowedAssignments: {} },
};
const APPS_FILE: AppsFile = {
  schemaVersion: 1,
  org: { name: "hb110-org", maxConcurrentTurns: 2 },
  defaults: { budgetUsdMonth: 100, objectiveBudgetUsd: 1000 },
  apps: [APP],
};
const ROLES: RoleConfig[] = [
  role("planner", "claude", "planner-model"),
  role("builder", "codex", "builder-model"),
  role("reviewer", "claude", "reviewer-model"),
];
const homes: TempStateHome[] = [];

afterEach(async () => Promise.all(homes.splice(0).map((home) => home.cleanup())));

describe("HB-110 shared roadmap/validation/delivery explanation", () => {
  it("projects one exact fixture through Status JSON, Reports, Observe, and every text surface", async () => {
    const home = await fixture();
    const canonical = await readRoadmapExplanation(home.stateHome, [APP.name]);
    const unit = canonical.apps[0]!.delivery_units.find((entry) => entry.unit_id === "ready-unit")!;
    const batch = canonical.apps[0]!.batches[0]!;
    expect(canonical.apps[0]!.roadmap_plan).not.toBeNull();
    expect(unit.artifact_authority.validation_contract).not.toBeNull();
    expect(unit.fast_path).toEqual({
      provider_planning_turn_skipped: true,
      reason: "complete_structured_creator_scope",
      workflow_bypassed: false,
    });
    expect(unit.cache_evidence).toMatchObject({
      measurement: "hit",
      authority: "cost_affinity_only",
      unknown_is_zero: false,
    });
    expect(batch).toMatchObject({ complete: true, every_unit_success: false });
    expect(
      canonical.apps[0]!.delivery_units.find((entry) => entry.unit_id === "human-unit")?.routing_exclusion,
    ).toMatchObject({ excluded: true, authority_basis: "backlog_snapshot" });
    expect(unit.label_projection.authoritative).toBe(false);

    const jsonLog = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await expect(cmdStatus(["--state-home", home.stateHome, "--app", APP.name, "--json"])).resolves.toBe(0);
    const status = JSON.parse(String(jsonLog.mock.calls[0]![0])) as { roadmapExplanation: unknown };
    jsonLog.mockRestore();

    const report = await buildReport({
      orgName: APPS_FILE.org.name,
      stateHome: home.stateHome,
      appsFile: APPS_FILE,
      query: { app: APP.name, period: "7d" },
      now: new Date(AT),
    });
    const local = await indexLocalSources({
      orgName: APPS_FILE.org.name,
      stateHome: home.stateHome,
      appsFile: APPS_FILE,
      filters: { app: APP.name },
      now: new Date(AT),
    });
    const observe = projectObserveSnapshot({
      ...local,
      cursor: "0",
      github: [],
    });
    expect(status.roadmapExplanation).toEqual(canonical);
    expect(report.roadmap_explanation).toEqual(canonical);
    expect(local.roadmap_explanation).toEqual(canonical);
    expect(observe.roadmap_explanation).toEqual(canonical);

    const statusTextLog = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await cmdStatus(["--state-home", home.stateHome, "--app", APP.name]);
    const statusText = statusTextLog.mock.calls.map((call) => call.join(" ")).join("\n");
    statusTextLog.mockRestore();
    const terminal = renderReportTerminal(report);
    const html = renderReportHtml(report);
    for (const rendered of [statusText, terminal, html]) {
      expect(rendered).toContain("ready-unit");
      expect(rendered).toContain("complete");
      expect(rendered).toMatch(/every-unit-success|Every unit successful/);
      expect(rendered).toMatch(/projection-only|projection only|projections, never authority/);
      expect(rendered).toContain("hit");
      expect(rendered).toContain("terminal_completed");
    }
  });

  it("negative control: a corrupt current RoadmapPlan pointer degrades the source and names affected claims", async () => {
    const home = await fixture();
    await writeFile(currentRoadmapPointerPath(home.stateHome, APP.name), "{not-json\n", "utf8");
    const explanation = await readRoadmapExplanation(home.stateHome, [APP.name]);
    expect(explanation.apps[0]!.source).toMatchObject({ status: "degraded" });
    expect(explanation.apps[0]!.source.affected_claims).toContain("RoadmapPlan");
    expect(explanation.apps[0]!.roadmap_plan).toBeNull();
  });

  it("negative control: a corrupt batch disposition cannot project false completion", async () => {
    const home = await fixture();
    await writeFile(
      executionBatchDispositionPath(home.stateHome, APP.name, "hb110-mixed-batch"),
      `${JSON.stringify({ schemaVersion: 1, app: APP.name, units: [] })}\n`,
      "utf8",
    );
    const explanation = await readRoadmapExplanation(home.stateHome, [APP.name]);
    expect(explanation.apps[0]!.source).toMatchObject({ status: "degraded" });
    expect(explanation.apps[0]!.source.affected_claims).toContain("batch completion");
    expect(explanation.apps[0]!.batches[0]).toMatchObject({
      batch_id: "hb110-mixed-batch",
      complete: false,
      every_unit_success: null,
    });
  });
});

async function fixture(): Promise<TempStateHome> {
  const home = await makeTempStateHome({ name: "hb110" });
  homes.push(home);
  const snapshot = await acceptBacklogSnapshot({
    root: home.stateHome,
    snapshot: {
      schemaVersion: ROADMAP_DELIVERY_SCHEMA_VERSION,
      snapshotId: "hb110-backlog",
      version: 1,
      app: APP.name,
      source: "fixture:issues",
      capturedAt: AT,
      completeness: "complete",
      pagination: { pagesObserved: 1, hasNextPage: false, unavailablePages: [] },
      issues: [
        {
          issueNumber: 1101,
          contentHash: stableHash("1101"),
          lifecycle: "open",
          routing: "automated",
          observedLabels: ["planning:preplanned"],
          dependencyIssues: [],
        },
        {
          issueNumber: 1102,
          contentHash: stableHash("1102"),
          lifecycle: "open",
          routing: "human_only",
          observedLabels: ["manual-review"],
          dependencyIssues: [],
        },
      ],
    },
  });
  const roadmap = await acceptRoadmapPlan({ root: home.stateHome, plan: roadmapPlan(snapshot.ref) });
  const catalog = await acceptValidationCatalog({ root: home.stateHome, catalog: validationCatalog(APP.name) });
  const validation = await acceptValidationContract({
    root: home.stateHome,
    contract: validationContract(roadmap, catalog.ref),
  });
  const readiness = await acceptDeliveryUnitReadiness({
    root: home.stateHome,
    app: APP.name,
    roadmapRef: roadmap.ref,
    expectedFrontierHash: roadmap.frontierHash,
    validationRef: validation.ref,
    unitId: "ready-unit",
    routing: [{ issueNumber: 1101, disposition: "automated", observedLabels: ["planning:preplanned"] }],
    readyAt: AT,
  });
  const direct = await acceptDirectExecutionUnit({ root: home.stateHome, authority: directUnit() });
  const batch = await admitExecutionBatch({
    root: home.stateHome,
    app: APP.name,
    batchId: "hb110-mixed-batch",
    roadmapRef: roadmap.ref,
    expectedFrontierHash: roadmap.frontierHash,
    orderedUnitIds: ["ready-unit"],
    readinessRefs: [readiness.ref],
    directUnitRefs: [direct.ref],
    routing: [{ issueNumber: 1101, disposition: "automated", observedLabels: ["planning:preplanned"] }],
    admittedAt: AT,
  });
  await normalizeDeliveryUnitEpisode({
    root: home.stateHome,
    app: APP,
    roles: ROLES,
    batchRef: batch.ref,
    unitId: "ready-unit",
    facts: {
      trigger: { kind: "roadmap_batch", sourceRef: batch.ref.sha256 },
      goal: "Deliver the fixture unit.",
      lifecycle: "live",
      appStage: "growth",
      repositoryFacts: { repo: APP.repo },
      requestedConstraints: { onePullRequest: true },
      hardBudget: budget(),
      requiredSafetyFacts: [],
    },
    creatorScope: creatorScope(),
    providerOperations: ["delivery/build", "delivery/review"],
    independentReview: { subjectRoles: ["builder"], reviewerRoles: ["reviewer"] },
    now: () => new Date(AT),
  });
  const journal = await readExecutionUnitJournal(home.stateHome, APP.name, batch.ref.id, "ready-unit");
  await prepareAndSettleAffinity(home.stateHome);
  await transitionExecutionUnitJournal({
    root: home.stateHome,
    app: APP.name,
    batchRef: batch.ref,
    unitId: "ready-unit",
    expectedStates: [journal!.state],
    nextState: "completed",
    outcome: "completed",
    now: new Date(AT),
  });
  await transitionExecutionUnitJournal({
    root: home.stateHome,
    app: APP.name,
    batchRef: batch.ref,
    unitId: "direct-sibling",
    expectedStates: ["admitted"],
    nextState: "failed",
    outcome: "failed",
    now: new Date(Date.parse(AT) + 1_000),
  });
  return home;
}

function roadmapPlan(snapshotRef: AuthorityRef): RoadmapPlan {
  return {
    schemaVersion: ROADMAP_DELIVERY_SCHEMA_VERSION,
    planId: "hb110-roadmap",
    version: 1,
    app: APP.name,
    backlogSnapshotRef: snapshotRef,
    predecessor: null,
    workstreams: [{ workstreamId: "hb110", outcome: "Explain delivery state", priority: 1 }],
    deliveryUnits: [
      {
        unitId: "ready-unit",
        workstreamId: "hb110",
        issueNumbers: [1101],
        dependsOn: [],
        priority: 1,
        objective: "Deliver ready work",
      },
      {
        unitId: "human-unit",
        workstreamId: "hb110",
        issueNumbers: [1102],
        dependsOn: [],
        priority: 2,
        objective: "Wait for human review",
      },
    ],
    completedUnitIds: [],
    readyFrontier: ["ready-unit"],
    wipLimit: 1,
    moves: [],
    acceptedAt: AT,
  };
}

function validationContract(roadmap: AcceptedRoadmapPlan, catalogRef: AuthorityRef): ValidationContract {
  return {
    schemaVersion: ROADMAP_DELIVERY_SCHEMA_VERSION,
    contractId: "hb110-validation",
    version: 1,
    predecessor: null,
    app: APP.name,
    catalogRef,
    roadmapRef: roadmap.ref,
    unitId: "ready-unit",
    unitMembershipHash: unitMembershipHash([1101]),
    templateRef: { templateId: "routine", version: 1 },
    affected: structuredClone(VALIDATION_BASE_AFFECTED),
    acceptanceCriteria: ["Every surface explains the exact durable lineage."],
    requiresHarnessRevision: false,
    harnessRevisionReason: null,
    sharedBoundaryDetectorRefs: [{ boundaryId: "B21", caseId: "CF-B21-*", detectorId: "shared-boundary-lineage" }],
    obligations: [
      {
        obligationId: "hb110-lineage",
        caseId: "CF-B21-*",
        covers: structuredClone(VALIDATION_BASE_AFFECTED),
        cheapestFalsifyingLayer: "L2",
        failureCases: ["a surface substitutes label projections for artifacts"],
        detectorId: "shared-boundary-lineage",
        negativeControlId: "label-without-artifact",
        expectedEvidence: ["cross-surface exact equality"],
        waiver: null,
      },
      {
        obligationId: "hb110-rendering",
        caseId: "CF-HB100-LINEAGE",
        covers: structuredClone(VALIDATION_EMPTY_AFFECTED),
        cheapestFalsifyingLayer: "L1",
        failureCases: ["batch completion is rendered as all-unit success"],
        detectorId: "review-lineage",
        negativeControlId: "wrong-contract-or-head",
        expectedEvidence: ["text and JSON distinction"],
        waiver: null,
      },
    ],
    requiredGates: ["pnpm-test", "pnpm-typecheck"],
    proposedAt: AT,
    acceptedAt: AT,
  };
}

function creatorScope(): CreatorEpisodeScope {
  const steps: ProposedEpisodeStep[] = [
    {
      id: "build",
      kind: "provider_turn",
      operation: "delivery/build",
      role: "builder",
      objective: "Build the unit.",
      requiredCapabilities: [],
      dependsOn: [],
      inputRefs: [],
      expectedOutputs: [{ id: "artifact", kind: "content", required: true }],
      maxTurnBudgetUsd: 2,
      selectionReason: "Builder owns mutation.",
    },
    {
      id: "review",
      kind: "provider_turn",
      operation: "delivery/review",
      role: "reviewer",
      objective: "Review the unit.",
      requiredCapabilities: [],
      dependsOn: ["build"],
      inputRefs: [{ ref: "plan-output:artifact", required: true }],
      expectedOutputs: [{ id: "review", kind: "review", required: true }],
      maxTurnBudgetUsd: 2,
      selectionReason: "Reviewer is independent.",
    },
  ];
  return {
    planningDisposition: "execution_ready",
    provenance: { source: "human", creatorId: "fixture-owner", createdAt: AT, evidenceRefs: ["fixture:hb110"] },
    workKind: "roadmap-delivery-unit",
    objective: "Deliver the exact governed fixture.",
    inScope: ["ready-unit"],
    outOfScope: ["publication"],
    acceptanceCriteria: ["shared explanation agrees"],
    expectedArtifacts: [{ id: "review", kind: "review", required: true }],
    declaredConstraints: { onePullRequest: true, providerFreePlanning: true },
    safetyFacts: [{ kind: "independent_review", evidenceRefs: ["fixture:validation"] }],
    steps,
  };
}

function directUnit(): DirectExecutionUnitAuthority {
  return {
    schemaVersion: ROADMAP_DELIVERY_SCHEMA_VERSION,
    kind: "direct_operation",
    unitId: "direct-sibling",
    app: APP.name,
    objective: "Exercise a failed sibling.",
    inScope: ["fixture"],
    outOfScope: ["external effects"],
    acceptanceCriteria: ["failure stays isolated"],
    expectedArtifacts: [{ id: "artifact", kind: "content", required: true }],
    declaredConstraints: { externalEffects: false, governedTemplate: true },
    safetyFacts: [{ kind: "independent_review", evidenceRefs: ["fixture"] }],
    workflowTemplate: { id: "fixture/direct", version: "v1" },
    provenance: { source: "human", creatorId: "fixture-owner", createdAt: AT, evidenceRefs: ["fixture:direct"] },
    dedupeKey: "sibling",
    admittedBudget: budget(),
    createdAt: AT,
  };
}

async function prepareAndSettleAffinity(root: string): Promise<void> {
  const assignment: TurnAssignment = { harness: "codex", model: "builder-model", effort: "high" };
  const manifest = createExecutionContextAffinityManifest({
    unitId: "ready-unit",
    compatibility: { app: APP.name, role: "builder", assignment, operation: "delivery/build" },
    immutablePrefix: [
      { id: "roadmap", kind: "authority", sourceRef: "authority:roadmap", sha256: stableHash("roadmap") },
    ],
    unitDelta: [
      { id: "validation", kind: "validation", sourceRef: "validation:ready-unit", sha256: stableHash("validation") },
    ],
    requiredAuthorityRefs: ["authority:roadmap", "validation:ready-unit"],
  });
  await prepareExecutionAffinityTurn({
    root,
    recordId: "hb110-ready-build",
    batchId: "hb110-mixed-batch",
    episodeId: "hb110",
    planVersion: 1,
    stepId: "build",
    manifest,
    preparedAt: AT,
  });
  await settleExecutionAffinityTurn({
    root,
    recordId: "hb110-ready-build",
    providerTurnId: "hb110-turn",
    settlementId: "hb110-settlement",
    providerOutcome: "completed",
    session: { runtime: "codex", id: "hb110-session" },
    usage: {
      tokensIn: 100,
      tokensOut: 20,
      cacheReadTokens: 50,
      cacheCreationTokens: 0,
      tokensInUncached: 50,
      costUsd: 0.1,
      subagentTurns: 0,
      wallClockMs: 100,
      quality: "complete",
    },
    settledAt: new Date(Date.parse(AT) + 500).toISOString(),
  });
}

function role(name: string, runtime: RoleConfig["runtime"], model: string): RoleConfig {
  return {
    name,
    runtime,
    model,
    effort: "high",
    delegation: { allow: [] },
    triggers: [],
    outputs: [name],
    maxTurnBudgetUsd: 5,
  };
}

function budget() {
  return {
    maxProviderTurns: 2,
    maxEquivalentCostUsd: 4,
    maxMechanicalOverheadUsd: 0,
    maxActiveTimeMs: 60_000,
    maxHumanDecisions: 0,
  };
}
