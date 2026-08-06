// HB-100 — provider-free vertical walking skeleton for the accepted 2026-08-03
// roadmap/validation/delivery-unit/batching contract.
//
// The happy path uses real product persistence and the real EpisodePlanner
// creator-scope normalization boundary. The seeded lineage cases prove the
// independent Reviewer detector turns red for a swapped contract or PR HEAD.

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import {
  readCurrentEpisodePlan,
  stableHash,
  type CreatorEpisodeScope,
} from "../../../src/loop/episode-plan.js";
import {
  assertTicketEpisodePlanValid,
  ticketGovernedWorkflowTemplates,
  TICKET_STANDARD_DELIVERY_WORKFLOW_TEMPLATE,
} from "../../../src/loop/ticket-episode-plan.js";
import type { GhIssue, GhOps, GhPullRequest } from "../../../src/loop/github.js";
import { issueContentHash } from "../../../src/loop/issue-snapshot.js";
import type { RoleConfig, TurnAssignment } from "../../../src/runtime/types.js";
import type { AppEntry } from "../../../src/org/apps.js";
import {
  ROADMAP_DELIVERY_SCHEMA_VERSION,
  RoadmapDeliveryError,
  acceptBacklogSnapshot,
  acceptDeliveryUnitReadiness,
  acceptRoadmapPlan,
  acceptValidationCatalog,
  acceptValidationContract,
  admitExecutionBatch,
  assertReviewerVerdictAdmissible,
  batchAuthorityPath,
  bindDeliveryUnitEpisodePlan,
  claimDeliveryUnit,
  commitDeliveryUnitClaim,
  deliveryClaimIdentity,
  deliveryClaimRecordPath,
  normalizeDeliveryUnitEpisode,
  readDeliveryUnitClaim,
  readExecutionUnitJournal,
  recordBuilderEvidence,
  recordReviewerVerdict,
  roadmapAuthorityPath,
  settleDeliveryUnitClaim,
  transitionExecutionUnitJournal,
  unitMembershipHash,
  validationAuthorityPath,
  type AcceptedAuthority,
  type AcceptedRoadmapPlan,
  type AuthorityRef,
  type BacklogSnapshot,
  type BuilderEvidenceManifest,
  type DeliveryEpisodeBinding,
  type DeliveryUnitReadiness,
  type DeliveryUnitClaim,
  type ExecutionBatch,
  type RoadmapDeliveryProjection,
  type RoadmapPlan,
  type ReviewerVerdict,
  type RoutingSnapshotEntry,
  type ValidationContract,
} from "../../../src/org/roadmap-delivery.js";
import { createRoadmapLoopRuntime } from "../../../src/org/roadmap-loop-runtime.js";
import { previewEpisode } from "../../../src/org/episode-planner/orchestrator.js";
import { prepareEpisodePlan } from "../../../src/org/episode-planner/coordinator.js";
import { buildEpisodeIntent } from "../../../src/org/episode-planner/policy.js";
import { makeTempStateHome, type TempStateHome } from "../../fixtures/state-home.js";
import {
  VALIDATION_BASE_AFFECTED,
  VALIDATION_EMPTY_AFFECTED,
  validationCatalog,
} from "../../fixtures/validation-catalog.js";

const AT = "2026-08-03T22:00:00.000Z";
const APP: AppEntry = {
  name: "hb100-app",
  repo: "cormidia-double/hb100-app",
  status: "live",
  budgetUsdMonth: 100, objectiveBudgetUsd: 1000,
  cadence: {},
  execution: { assignmentMode: "fixed", allowedAssignments: {} },
};

const ROLES: RoleConfig[] = [
  role("planner", "claude", "planner-model", ["plan"]),
  role("builder", "codex", "builder-model", ["candidate", "builder-evidence"]),
  role("reviewer", "claude", "reviewer-model", ["review-verdict"]),
];

const BUILDER_ASSIGNMENT = assignmentOf("builder");
const REVIEWER_ASSIGNMENT = assignmentOf("reviewer");
const ISSUE_NUMBERS = [233, 240] as const;
const AUTOMATED_ROUTING: RoutingSnapshotEntry[] = ISSUE_NUMBERS.map((issueNumber) => ({
  issueNumber,
  disposition: "automated",
  observedLabels: ["op:ready", "planning:preplanned"],
}));

const homes: TempStateHome[] = [];

afterEach(async () => {
  await Promise.all(homes.splice(0).map((home) => home.cleanup()));
});

function role(
  name: string,
  runtime: RoleConfig["runtime"],
  model: string,
  outputs: string[],
): RoleConfig {
  return {
    name,
    runtime,
    model,
    effort: "high",
    delegation: { allow: [] },
    triggers: [],
    outputs,
    maxTurnBudgetUsd: 5,
  };
}

function assignmentOf(name: string): TurnAssignment {
  const selected = ROLES.find((candidate) => candidate.name === name);
  if (selected === undefined) throw new Error(`missing fixture role ${name}`);
  return { harness: selected.runtime, model: selected.model, effort: selected.effort };
}

function backlogSnapshot(): BacklogSnapshot {
  return {
    schemaVersion: ROADMAP_DELIVERY_SCHEMA_VERSION,
    snapshotId: "backlog-2026-08-03",
    version: 1,
    app: APP.name,
    source: "github:issues",
    capturedAt: AT,
    completeness: "complete",
    pagination: { pagesObserved: 1, hasNextPage: false, unavailablePages: [] },
    issues: ISSUE_NUMBERS.map((issueNumber) => ({
      issueNumber,
      contentHash: issueContentHash({
        title: `Recovery issue ${issueNumber}`,
        body: "## Goal\nRecover atomically.",
        labels: ["op:ready", "planning:preplanned"],
        state: "OPEN",
      }),
      lifecycle: "open",
      routing: "automated",
      observedLabels: ["planning:preplanned"],
      dependencyIssues: [],
    })),
  };
}

function roadmapPlan(snapshotRef: AuthorityRef): RoadmapPlan {
  return {
    schemaVersion: ROADMAP_DELIVERY_SCHEMA_VERSION,
    planId: "roadmap-2026-08-03",
    version: 1,
    app: APP.name,
    backlogSnapshotRef: snapshotRef,
    predecessor: null,
    workstreams: [{
      workstreamId: "autonomous-loop",
      outcome: "Enable the governed Cormidia delivery loop",
      priority: 1,
    }],
    deliveryUnits: [{
      unitId: "unit-roadmap-validation",
      workstreamId: "autonomous-loop",
      issueNumbers: [...ISSUE_NUMBERS],
      dependsOn: [],
      priority: 1,
      objective: "Land roadmap batching and validation as one reviewable PR",
    }],
    completedUnitIds: [],
    readyFrontier: ["unit-roadmap-validation"],
    wipLimit: 1,
    moves: [],
    acceptedAt: AT,
  };
}

function validationContract(
  roadmap: AcceptedRoadmapPlan,
  catalogRef: AuthorityRef,
  templateId: "routine" | "custom" = "routine",
): ValidationContract {
  return {
    schemaVersion: ROADMAP_DELIVERY_SCHEMA_VERSION,
    contractId: "validation-roadmap-delivery",
    version: 1,
    predecessor: null,
    app: APP.name,
    catalogRef,
    roadmapRef: roadmap.ref,
    unitId: "unit-roadmap-validation",
    unitMembershipHash: unitMembershipHash(ISSUE_NUMBERS),
    templateRef: { templateId, version: 1 },
    affected: structuredClone(VALIDATION_BASE_AFFECTED),
    acceptanceCriteria: ["The exact two-ticket unit and candidate HEAD retain validation lineage."],
    requiresHarnessRevision: false,
    harnessRevisionReason: null,
    sharedBoundaryDetectorRefs: [{
      boundaryId: "B21",
      caseId: "CF-B21-*",
      detectorId: "shared-boundary-lineage",
    }],
    obligations: [
      {
        obligationId: "shared-boundary",
        caseId: "CF-B21-*",
        covers: structuredClone(VALIDATION_BASE_AFFECTED),
        cheapestFalsifyingLayer: "L2",
        failureCases: ["a delivery unit loses its shared boundary lineage"],
        detectorId: "shared-boundary-lineage",
        negativeControlId: "label-without-artifact",
        expectedEvidence: ["durable authority projection order"],
        waiver: null,
      },
      {
        obligationId: "review-lineage",
        caseId: "CF-HB100-LINEAGE",
        covers: structuredClone(VALIDATION_EMPTY_AFFECTED),
        cheapestFalsifyingLayer: "L1",
        failureCases: ["the contract or candidate HEAD is substituted"],
        detectorId: "review-lineage",
        negativeControlId: "wrong-contract-or-head",
        expectedEvidence: ["typed refusal before approval"],
        waiver: null,
      },
    ],
    requiredGates: ["pnpm-test", "pnpm-typecheck"],
    proposedAt: "2026-08-03T21:59:00.000Z",
    acceptedAt: AT,
  };
}

function creatorScope(): CreatorEpisodeScope {
  return {
    planningDisposition: "execution_ready",
    provenance: {
      source: "human",
      creatorId: "product-owner",
      createdAt: AT,
      evidenceRefs: ["ratification-package:10.7"],
    },
    workKind: "roadmap-delivery-unit",
    objective: "Build and independently review the accepted two-ticket delivery unit.",
    inScope: ["issues:233,240"],
    outOfScope: ["merge", "publication", "live campaign", "protocol-surface edits"],
    acceptanceCriteria: [
      "one PR binds both tickets and the accepted validation contract",
      "independent review binds the exact candidate HEAD",
    ],
    expectedArtifacts: [{ id: "review-verdict", kind: "review", required: true }],
    declaredConstraints: { onePullRequest: true, providerFreePlanning: true },
    safetyFacts: [{ kind: "independent_review", evidenceRefs: ["validation-contract"] }],
    steps: [
      {
        id: "build",
        kind: "provider_turn",
        operation: "delivery/build",
        role: "builder",
        objective: "Build both members and produce one exact-HEAD evidence manifest.",
        requiredCapabilities: [],
        dependsOn: [],
        inputRefs: [],
        expectedOutputs: [{ id: "builder-evidence", kind: "evidence", required: true }],
        maxTurnBudgetUsd: 5,
        selectionReason: "Builder owns code mutation for the whole delivery unit.",
      },
      {
        id: "review",
        kind: "provider_turn",
        operation: "delivery/review",
        role: "reviewer",
        objective: "Independently review the exact candidate and validation evidence.",
        requiredCapabilities: [],
        dependsOn: ["build"],
        inputRefs: [{ ref: "plan-output:builder-evidence", required: true }],
        expectedOutputs: [{ id: "review-verdict", kind: "review", required: true }],
        maxTurnBudgetUsd: 5,
        selectionReason: "Reviewer is independent of Builder.",
      },
    ],
  };
}

async function acceptedPlanningAuthorities(
  home: TempStateHome,
  project?: (entry: Readonly<RoadmapDeliveryProjection>) => void | Promise<void>,
  templateId: "routine" | "custom" = "routine",
): Promise<{
  roadmap: AcceptedRoadmapPlan;
  validation: AcceptedAuthority<ValidationContract>;
  readiness: AcceptedAuthority<DeliveryUnitReadiness>;
}> {
  const snapshot = await acceptBacklogSnapshot({
    root: home.stateHome,
    snapshot: backlogSnapshot(),
    ...(project === undefined ? {} : { project }),
  });
  const roadmap = await acceptRoadmapPlan({
    root: home.stateHome,
    plan: roadmapPlan(snapshot.ref),
    ...(project === undefined ? {} : { project }),
  });
  const catalog = await acceptValidationCatalog({
    root: home.stateHome,
    catalog: validationCatalog(APP.name),
    ...(project === undefined ? {} : { project }),
  });
  const validation = await acceptValidationContract({
    root: home.stateHome,
    contract: validationContract(roadmap, catalog.ref, templateId),
    ...(project === undefined ? {} : { project }),
  });
  const readiness = await acceptDeliveryUnitReadiness({
    root: home.stateHome,
    app: APP.name,
    roadmapRef: roadmap.ref,
    expectedFrontierHash: roadmap.frontierHash,
    validationRef: validation.ref,
    unitId: "unit-roadmap-validation",
    routing: AUTOMATED_ROUTING,
    readyAt: AT,
    ...(project === undefined ? {} : { project }),
  });
  return { roadmap, validation, readiness };
}

async function acceptedEpisode(input: {
  home: TempStateHome;
  project?: (entry: Readonly<RoadmapDeliveryProjection>) => void | Promise<void>;
}): Promise<{
  roadmap: AcceptedRoadmapPlan;
  validation: AcceptedAuthority<ValidationContract>;
  readiness: AcceptedAuthority<DeliveryUnitReadiness>;
  batch: AcceptedAuthority<ExecutionBatch>;
  binding: AcceptedAuthority<DeliveryEpisodeBinding>;
}> {
  const { roadmap, validation, readiness } = await acceptedPlanningAuthorities(input.home, input.project);
  const batch = await admitExecutionBatch({
    root: input.home.stateHome,
    app: APP.name,
    batchId: "batch-hb100",
    roadmapRef: roadmap.ref,
    expectedFrontierHash: roadmap.frontierHash,
    orderedUnitIds: ["unit-roadmap-validation"],
    readinessRefs: [readiness.ref],
    routing: AUTOMATED_ROUTING,
    admittedAt: AT,
    ...(input.project === undefined ? {} : { project: input.project }),
  });
  // Batch admission is a token-free grouping decision and must remain lazy.
  expect(existsSync(input.home.path("efficiency"))).toBe(false);
  const normalized = await normalizeDeliveryUnitEpisode({
    root: input.home.stateHome,
    app: APP,
    roles: ROLES,
    batchRef: batch.ref,
    unitId: "unit-roadmap-validation",
    facts: {
      trigger: { kind: "roadmap_batch", sourceRef: batch.ref.sha256 },
      goal: "Deliver the accepted roadmap unit.",
      lifecycle: "live",
      appStage: "growth",
      repositoryFacts: { repo: APP.repo, baseRevision: "origin/trunk" },
      requestedConstraints: { onePullRequest: true },
      hardBudget: {
        maxProviderTurns: 2,
        maxEquivalentCostUsd: 10,
        maxMechanicalOverheadUsd: 0,
        maxActiveTimeMs: 45 * 60_000,
        maxHumanDecisions: 0,
      },
      requiredSafetyFacts: [],
    },
    creatorScope: creatorScope(),
    providerOperations: ["delivery/build", "delivery/review"],
    independentReview: { subjectRoles: ["builder"], reviewerRoles: ["reviewer"] },
    now: () => new Date(AT),
    ...(input.project === undefined ? {} : { project: input.project }),
  });
  expect(normalized.prepared).toMatchObject({ planningTurnSkipped: true, plannerAttempts: 0 });
  expect(normalized.plan.planningSource).toBe("creator_scope");
  expect(normalized.plan.creatorProvenance?.evidenceRefs).toContain(
    `validation_contract:${validation.ref.id}@${validation.ref.version}#${validation.ref.sha256}`,
  );
  expect(normalized.binding.value).toMatchObject({
    readinessRef: readiness.ref,
    validationRef: validation.ref,
    validationContractHash: validation.ref.sha256,
  });
  return { roadmap, validation, readiness, batch, binding: normalized.binding };
}

function evidenceManifest(input: {
  roadmap: AcceptedRoadmapPlan;
  validation: AcceptedAuthority<ValidationContract>;
  readiness: AcceptedAuthority<DeliveryUnitReadiness>;
  batch: AcceptedAuthority<ExecutionBatch>;
  binding: AcceptedAuthority<DeliveryEpisodeBinding>;
  claim: DeliveryUnitClaim;
}): BuilderEvidenceManifest {
  return {
    schemaVersion: ROADMAP_DELIVERY_SCHEMA_VERSION,
    app: APP.name,
    unitId: "unit-roadmap-validation",
    issueNumbers: [...ISSUE_NUMBERS],
    membershipHash: unitMembershipHash(ISSUE_NUMBERS),
    roadmapRef: input.roadmap.ref,
    readinessRef: input.readiness.ref,
    validationRef: input.validation.ref,
    validationContractHash: input.validation.ref.sha256,
    batchRef: input.batch.ref,
    episodeBindingRef: input.binding.ref,
    episodeId: input.binding.value.episodeId,
    episodePlanVersion: input.binding.value.episodePlanVersion,
    episodePlanHash: input.binding.value.episodePlanHash,
    claimSettlementId: input.claim.record.settlement_id,
    claimAttempt: input.claim.record.attempt,
    repository: APP.repo,
    baseRevision: "origin/trunk",
    candidateHead: "a".repeat(40),
    pullRequestNumber: 901,
    pullRequestUrl: "https://example.invalid/cormidia/hb100/pull/901",
    builderRole: "builder",
    builderAssignment: BUILDER_ASSIGNMENT,
    builderSessionId: "builder-session-hb100",
    cases: [
      {
        caseId: "CF-B21-SHARED",
        detectorId: "shared-boundary-lineage",
        negativeControlId: "label-without-artifact",
        status: "passed",
        waiverId: null,
        evidence: "all persisted authority files existed before their projection callbacks",
      },
      {
        caseId: "CF-HB100-LINEAGE",
        detectorId: "review-lineage",
        negativeControlId: "wrong-contract-or-head",
        status: "passed",
        waiverId: null,
        evidence: "seeded contract and HEAD swaps produced typed refusals",
      },
    ],
    gates: [
      { gate: "pnpm-test", status: "passed", evidence: "synthetic HB-100 gate receipt" },
      { gate: "pnpm-typecheck", status: "passed", evidence: "synthetic HB-100 gate receipt" },
    ],
    recordedAt: "2026-08-03T22:05:00.000Z",
  };
}

function reviewerVerdict(
  evidence: AcceptedAuthority<BuilderEvidenceManifest>,
): ReviewerVerdict {
  return {
    schemaVersion: ROADMAP_DELIVERY_SCHEMA_VERSION,
    app: APP.name,
    unitId: evidence.value.unitId,
    membershipHash: evidence.value.membershipHash,
    roadmapRef: evidence.value.roadmapRef,
    readinessRef: evidence.value.readinessRef,
    validationRef: evidence.value.validationRef,
    validationContractHash: evidence.value.validationContractHash,
    episodeBindingRef: evidence.value.episodeBindingRef,
    builderEvidenceRef: evidence.ref,
    candidateHead: evidence.value.candidateHead,
    reviewerRole: "reviewer",
    reviewerAssignment: REVIEWER_ASSIGNMENT,
    reviewerSessionId: "reviewer-session-hb100",
    disposition: "approved",
    evidenceAccepted: true,
    reproducedCaseIds: ["CF-B21-SHARED", "CF-HB100-LINEAGE"],
    rationale: "Exact membership, validation, PR HEAD, detectors, gates, and independence agree.",
    recordedAt: "2026-08-03T22:06:00.000Z",
  };
}

async function expectRoadmapError(
  operation: () => unknown | Promise<unknown>,
  code: RoadmapDeliveryError["code"],
): Promise<void> {
  try {
    await operation();
    throw new Error(`expected RoadmapDeliveryError ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(RoadmapDeliveryError);
    expect((error as RoadmapDeliveryError).code).toBe(code);
  }
}

describe("HB-100 — roadmap → validation → unit → batch → EpisodePlan → review", () => {
  it("walks one two-ticket unit provider-free and projects only persisted authority", async () => {
    const home = await makeTempStateHome({ name: "hb100-walk" });
    homes.push(home);
    const projections: RoadmapDeliveryProjection[] = [];
    const project = async (entry: Readonly<RoadmapDeliveryProjection>): Promise<void> => {
      // The callback is intentionally an external-projection stand-in. If the
      // product ever calls it first, this read is the detector that turns red.
      expect(JSON.parse(await readFile(entry.path, "utf8"))).toBeTruthy();
      projections.push(structuredClone(entry));
    };

    const authorities = await acceptedEpisode({ home, project });
    const raced = await Promise.all([
      claimDeliveryUnit({
        root: home.stateHome,
        app: APP.name,
        episodeBindingRef: authorities.binding.ref,
        readCurrentRouting: async () => AUTOMATED_ROUTING,
        now: new Date("2026-08-03T22:01:00.000Z"),
        project,
      }),
      claimDeliveryUnit({
        root: home.stateHome,
        app: APP.name,
        episodeBindingRef: authorities.binding.ref,
        readCurrentRouting: async () => AUTOMATED_ROUTING,
        now: new Date("2026-08-03T22:01:00.000Z"),
        project,
      }),
    ]);
    expect(raced.map((entry) => entry.disposition).sort()).toEqual(["already_claimed", "claimed"]);
    const claim = raced.find((entry) => entry.disposition === "claimed")!;
    expect(claim.record.payload.issueNumbers).toEqual([...ISSUE_NUMBERS]);
    const claimPath = deliveryClaimRecordPath(
      home.stateHome,
      deliveryClaimIdentity(claim.record.payload),
    );
    expect(JSON.parse(await readFile(claimPath, "utf8"))).toMatchObject({
      status: "claimed",
      payload: { issueNumbers: [...ISSUE_NUMBERS] },
    });
    await commitDeliveryUnitClaim({
      root: home.stateHome,
      app: APP.name,
      claim,
      runId: "delivery-run-hb100",
      now: new Date("2026-08-03T22:02:00.000Z"),
      project,
    });
    await transitionExecutionUnitJournal({
      root: home.stateHome,
      app: APP.name,
      batchRef: authorities.batch.ref,
      unitId: "unit-roadmap-validation",
      expectedStates: ["claimed"],
      nextState: "running",
      usageDelta: { providerTurns: 1 },
      now: new Date("2026-08-03T22:02:01.000Z"),
    });

    const manifest = evidenceManifest({ ...authorities, claim });
    // Seeded negative control: evidence for a different unit cannot cross the join.
    await expectRoadmapError(
      () => recordBuilderEvidence({
        root: home.stateHome,
        manifest: { ...manifest, unitId: "unit-swapped" },
      }),
      "evidence_unit_mismatch",
    );
    const evidence = await recordBuilderEvidence({
      root: home.stateHome,
      manifest,
      project,
    });
    const verdict = reviewerVerdict(evidence);

    // Seeded negative control: a sibling/old contract cannot be substituted.
    const wrongContract: AuthorityRef = {
      ...verdict.validationRef,
      sha256: "b".repeat(64),
    };
    await expectRoadmapError(
      () => assertReviewerVerdictAdmissible({
        verdict: {
          ...verdict,
          validationRef: wrongContract,
          validationContractHash: wrongContract.sha256,
        },
        evidence,
        validation: authorities.validation,
      }),
      "validation_contract_invalid",
    );
    // Seeded negative control: a verdict over another HEAD turns the detector red.
    await expectRoadmapError(
      () => assertReviewerVerdictAdmissible({
        verdict: { ...verdict, candidateHead: "c".repeat(40) },
        evidence,
        validation: authorities.validation,
      }),
      "evidence_head_mismatch",
    );

    const acceptedVerdict = await recordReviewerVerdict({
      root: home.stateHome,
      verdict,
      project,
    });
    expect(acceptedVerdict.value.disposition).toBe("approved");
    const settled = await settleDeliveryUnitClaim({
      root: home.stateHome,
      app: APP.name,
      claimSettlementId: claim.record.settlement_id,
      claimAttempt: claim.record.attempt,
      runId: "delivery-run-hb100",
      reviewerVerdictRef: acceptedVerdict.ref,
      validationContractHash: authorities.validation.ref.sha256,
      outcome: "approved",
      now: new Date("2026-08-03T22:07:00.000Z"),
      project,
    });
    expect(settled).toMatchObject({ status: "settled", outcome: "approved" });
    expect(claim.record.payload.validationContractHash).toBe(authorities.validation.ref.sha256);
    expect(evidence.value.validationContractHash).toBe(authorities.validation.ref.sha256);
    expect(acceptedVerdict.value.validationContractHash).toBe(authorities.validation.ref.sha256);
    expect(settled.payload.validationContractHash).toBe(authorities.validation.ref.sha256);
    expect(projections.map((entry) => entry.kind)).toEqual([
      "backlog_snapshot",
      "roadmap_plan",
      "validation_catalog",
      "validation_contract",
      "delivery_unit_readiness",
      "execution_batch",
      "delivery_episode_binding",
      "delivery_unit_claimed",
      "delivery_unit_claim_committed",
      "builder_evidence",
      "reviewer_verdict",
      "delivery_unit_settled",
    ]);
  });

  it("refuses ready-looking labels when the RoadmapPlan artifact is absent", async () => {
    const home = await makeTempStateHome({ name: "hb100-label-is-not-authority" });
    homes.push(home);
    const fabricatedRoadmapRef: AuthorityRef = {
      kind: "roadmap_plan",
      id: "fabricated-roadmap",
      version: 1,
      sha256: "d".repeat(64),
    };
    await expectRoadmapError(
      () => admitExecutionBatch({
        root: home.stateHome,
        app: APP.name,
        batchId: "batch-label-only",
        roadmapRef: fabricatedRoadmapRef,
        expectedFrontierHash: stableHash(["unit-roadmap-validation"]),
        orderedUnitIds: ["unit-roadmap-validation"],
        readinessRefs: [],
        routing: AUTOMATED_ROUTING,
        admittedAt: AT,
      }),
      "roadmap_missing",
    );
    expect(existsSync(batchAuthorityPath(home.stateHome, APP.name, "batch-label-only", 1))).toBe(false);
  });

  it("excludes the whole unit when one current member has either autonomous exclusion", async () => {
    const home = await makeTempStateHome({ name: "hb100-human-only" });
    homes.push(home);
    const { roadmap, validation, readiness } = await acceptedPlanningAuthorities(home);
    await expectRoadmapError(
      () => admitExecutionBatch({
        root: home.stateHome,
        app: APP.name,
        batchId: "batch-human-only",
        roadmapRef: roadmap.ref,
        expectedFrontierHash: roadmap.frontierHash,
        orderedUnitIds: ["unit-roadmap-validation"],
        readinessRefs: [readiness.ref],
        routing: AUTOMATED_ROUTING.map((entry) =>
          entry.issueNumber === 240 ? { ...entry, disposition: "human_only" as const } : entry),
        admittedAt: AT,
      }),
      "routing_ineligible",
    );
    expect(existsSync(batchAuthorityPath(home.stateHome, APP.name, "batch-human-only", 1))).toBe(false);
    expect(existsSync(roadmapAuthorityPath(home.stateHome, APP.name, roadmap.ref.id, 1))).toBe(true);
    expect(existsSync(validationAuthorityPath(home.stateHome, APP.name, validation.ref.id, 1))).toBe(true);
    expect(existsSync(home.path("efficiency"))).toBe(false);

    await expectRoadmapError(
      () => admitExecutionBatch({
        root: home.stateHome,
        app: APP.name,
        batchId: "batch-manual-review",
        roadmapRef: roadmap.ref,
        expectedFrontierHash: roadmap.frontierHash,
        orderedUnitIds: ["unit-roadmap-validation"],
        readinessRefs: [readiness.ref],
        routing: AUTOMATED_ROUTING.map((entry) => entry.issueNumber === 240
          ? { ...entry, observedLabels: [...entry.observedLabels, "manual-review"] }
          : entry),
        admittedAt: AT,
      }),
      "routing_ineligible",
    );
    expect(existsSync(batchAuthorityPath(home.stateHome, APP.name, "batch-manual-review", 1))).toBe(false);
  });

  it("re-checks both exact exclusions at the Builder claim boundary", async () => {
    const home = await makeTempStateHome({ name: "hb100-human-only-claim" });
    homes.push(home);
    const authorities = await acceptedEpisode({ home });
    const currentReads: number[][] = [];
    await expectRoadmapError(
      () => claimDeliveryUnit({
        root: home.stateHome,
        app: APP.name,
        episodeBindingRef: authorities.binding.ref,
        readCurrentRouting: async () => AUTOMATED_ROUTING.map((entry) =>
          entry.issueNumber === 240 ? { ...entry, disposition: "human_only" as const } : entry),
        now: new Date("2026-08-03T22:01:00.000Z"),
      }),
      "routing_ineligible",
    );
    await expectRoadmapError(
      () => claimDeliveryUnit({
        root: home.stateHome,
        app: APP.name,
        episodeBindingRef: authorities.binding.ref,
        readCurrentRouting: async (issueNumbers) => {
          currentReads.push([...issueNumbers]);
          return AUTOMATED_ROUTING.map((entry) => entry.issueNumber === 240
            ? { ...entry, observedLabels: [...entry.observedLabels, "manual-review"] }
            : entry);
        },
        now: new Date("2026-08-03T22:01:00.000Z"),
      }),
      "routing_ineligible",
    );
    expect(currentReads).toEqual([[...ISSUE_NUMBERS]]);
    await expectRoadmapError(
      () => claimDeliveryUnit({
        root: home.stateHome,
        app: APP.name,
        episodeBindingRef: authorities.binding.ref,
        readCurrentRouting: async () => { throw new Error("current labels unavailable"); },
        now: new Date("2026-08-03T22:01:00.000Z"),
      }),
      "routing_ineligible",
    );
  });

  it("refuses Builder claim when a successor RoadmapPlan makes the episode join stale", async () => {
    const home = await makeTempStateHome({ name: "hb100-stale-roadmap-claim" });
    homes.push(home);
    const authorities = await acceptedEpisode({ home });
    await acceptRoadmapPlan({
      root: home.stateHome,
      plan: {
        ...structuredClone(authorities.roadmap.value),
        version: 2,
        predecessor: authorities.roadmap.ref,
        acceptedAt: "2026-08-03T22:02:00.000Z",
      },
    });

    await expectRoadmapError(
      () => claimDeliveryUnit({
        root: home.stateHome,
        app: APP.name,
        episodeBindingRef: authorities.binding.ref,
        readCurrentRouting: async () => AUTOMATED_ROUTING,
        now: new Date("2026-08-03T22:03:00.000Z"),
      }),
      "frontier_stale",
    );
  });
});

describe("HB-103/HB-104 — durable delivery-unit crash recovery", () => {
  it("turns accepted routine roadmap/validation authority into the real governed zero-turn path", async () => {
    const home = await makeTempStateHome({ name: "hb105-roadmap-fast-path" });
    homes.push(home);
    const authorities = await acceptedPlanningAuthorities(home);
    const gh = new RecoveryGh(ISSUE_NUMBERS.map((number) => ({
      ...recoveryIssue(number, "op:ready"),
      labels: ["op:ready", "planning:preplanned"],
    })));
    const runtime = createRoadmapLoopRuntime({
      root: home.stateHome,
      app: APP,
      gh: gh as unknown as GhOps,
    });
    const previewAdmission = await runtime.admit({ maxUnits: 1, planOnly: true, now: new Date(AT) });
    expect(previewAdmission.units[0]?.creatorScope?.workflowTemplate)
      .toEqual(TICKET_STANDARD_DELIVERY_WORKFLOW_TEMPLATE);
    const admission = await runtime.admit({ maxUnits: 1, planOnly: false, now: new Date(AT) });

    expect(admission.units, JSON.stringify(admission)).toHaveLength(1);
    const scope = admission.units[0]?.creatorScope;
    if (scope === undefined) throw new Error("accepted routine authority did not produce creator scope");
    expect(scope).toMatchObject({
      planningDisposition: "execution_ready",
      workflowTemplate: TICKET_STANDARD_DELIVERY_WORKFLOW_TEMPLATE,
      declaredConstraints: {
        membershipHash: unitMembershipHash(ISSUE_NUMBERS),
        onePullRequest: true,
        exactHeadReview: true,
      },
    });
    expect(scope.provenance.evidenceRefs).toContain(
      `validation_contract:${authorities.validation.ref.id}@${authorities.validation.ref.version}#${authorities.validation.ref.sha256}`,
    );
    const workflows = ticketGovernedWorkflowTemplates({
      contractUsd: 5,
      implementationUsd: 5,
      reviewUsd: 5,
    });
    const steps = workflows.get(
      `${TICKET_STANDARD_DELIVERY_WORKFLOW_TEMPLATE.id}@${TICKET_STANDARD_DELIVERY_WORKFLOW_TEMPLATE.version}`,
    )!;
    expect(() => assertTicketEpisodePlanValid({ steps: [...steps] })).not.toThrow();
    const facts = {
      episodeId: admission.units[0]!.episodeId,
      trigger: { kind: "roadmap_batch", sourceRef: authorities.roadmap.ref.sha256 },
      goal: scope.objective,
      lifecycle: "live",
      appStage: "growth" as const,
      repositoryFacts: { repo: APP.repo },
      requestedConstraints: {},
      hardBudget: {
        maxProviderTurns: 3,
        maxEquivalentCostUsd: 15,
        maxMechanicalOverheadUsd: 0,
      },
      requiredSafetyFacts: [{
        kind: "independent_review" as const,
        evidenceRefs: ["accepted-validation-contract"],
      }],
    };
    const normalized = await prepareEpisodePlan({
      root: home.stateHome,
      app: APP,
      roles: ROLES,
      intent: buildEpisodeIntent({ ...facts, app: APP, roles: ROLES, creatorScope: scope }),
      workflowTemplates: workflows,
      independentReview: { subjectRoles: ["builder"], reviewerRoles: ["reviewer"] },
    });
    expect(normalized).toMatchObject({
      planningTurnSkipped: true,
      plannerAttempts: 0,
      plan: { planningSource: "creator_scope" },
    });

    // Seeded negative control: the same detailed goal/criteria without the
    // accepted provenance-bearing scope must take the provider planning path.
    expect(previewEpisode({
      app: APP,
      roles: ROLES,
      facts,
      planner: {
        limits: {
          maxAttempts: 2,
          perAttempt: { equivalentCostUsd: 5, activeTimeMs: 120_000 },
          aggregate: { providerTurns: 2, equivalentCostUsd: 10, activeTimeMs: 240_000 },
        },
        workflowTemplates: workflows,
        independentReview: { subjectRoles: ["builder"], reviewerRoles: ["reviewer"] },
      },
    }).planningPath).toBe("episode_planner_provider_turn");

    const customHome = await makeTempStateHome({ name: "hb105-custom-planning-path" });
    homes.push(customHome);
    await acceptedPlanningAuthorities(customHome, undefined, "custom");
    const customAdmission = await createRoadmapLoopRuntime({
      root: customHome.stateHome,
      app: APP,
      gh: new RecoveryGh(ISSUE_NUMBERS.map((number) => ({
        ...recoveryIssue(number, "op:ready"),
        labels: ["op:ready", "planning:preplanned"],
      }))) as unknown as GhOps,
    }).admit({ maxUnits: 1, planOnly: false, now: new Date(AT) });
    expect(customAdmission.units).toHaveLength(1);
    expect(customAdmission.units[0]?.creatorScope).toBeUndefined();

    const changedHome = await makeTempStateHome({ name: "hb105-changed-member-refusal" });
    homes.push(changedHome);
    await acceptedPlanningAuthorities(changedHome);
    const changedIssues = ISSUE_NUMBERS.map((number) => ({
      ...recoveryIssue(number, "op:ready"),
      labels: ["op:ready", "planning:preplanned"],
    }));
    changedIssues[1]!.body += "\nchanged after the accepted snapshot";
    const changedAdmission = await createRoadmapLoopRuntime({
      root: changedHome.stateHome,
      app: APP,
      gh: new RecoveryGh(changedIssues) as unknown as GhOps,
    }).admit({ maxUnits: 1, planOnly: false, now: new Date(AT) });
    expect(changedAdmission.units).toEqual([]);
    expect(changedAdmission.refusals).toMatchObject([{
      issueNumber: ISSUE_NUMBERS[1],
      code: "roadmap_member_changed",
    }]);
  });

  it("repairs a subset pre-provider claim projection for every member", async () => {
    const home = await makeTempStateHome({ name: "hb103-claim-crash" });
    homes.push(home);
    const authorities = await acceptedEpisode({ home });
    const claim = await claimDeliveryUnit({
      root: home.stateHome,
      app: APP.name,
      episodeBindingRef: authorities.binding.ref,
      readCurrentRouting: async () => AUTOMATED_ROUTING,
      now: new Date(AT),
    });
    await commitDeliveryUnitClaim({
      root: home.stateHome,
      app: APP.name,
      claim,
      runId: "pre-provider-committed-run",
      now: new Date(AT),
    });
    const plan = await readCurrentEpisodePlan(home.stateHome, authorities.binding.value.episodeId);
    expect(plan).toBeDefined();
    const replayedBinding = await bindDeliveryUnitEpisodePlan({
      root: home.stateHome,
      app: APP.name,
      batchRef: authorities.batch.ref,
      unitId: "unit-roadmap-validation",
      plan: plan!,
      now: new Date("2026-08-03T22:00:01.000Z"),
    });
    expect(replayedBinding.ref).toEqual(authorities.binding.ref);
    expect(await readExecutionUnitJournal(
      home.stateHome,
      APP.name,
      authorities.batch.ref.id,
      "unit-roadmap-validation",
    )).toMatchObject({ state: "claimed", usage: { providerTurns: 0 } });
    const gh = new RecoveryGh([
      recoveryIssue(ISSUE_NUMBERS[0], "op:building"),
      recoveryIssue(ISSUE_NUMBERS[1], "op:ready"),
    ]);

    const lines = await createRoadmapLoopRuntime({
      root: home.stateHome,
      app: APP,
      gh: gh as unknown as GhOps,
    }).reconcile({ now: new Date(AT) });

    expect(lines).toContain(
      "unit-roadmap-validation: recovered pre-provider claim projection to op:ready for every member",
    );
    expect(gh.stateLabel(ISSUE_NUMBERS[0])).toBe("op:ready");
    expect(gh.stateLabel(ISSUE_NUMBERS[1])).toBe("op:ready");
  });

  it("settles a consistent post-provider crash without lending a sibling outcome", async () => {
    const home = await makeTempStateHome({ name: "hb104-running-crash" });
    homes.push(home);
    const authorities = await acceptedEpisode({ home });
    const claim = await claimDeliveryUnit({
      root: home.stateHome,
      app: APP.name,
      episodeBindingRef: authorities.binding.ref,
      readCurrentRouting: async () => AUTOMATED_ROUTING,
      now: new Date(AT),
    });
    await commitDeliveryUnitClaim({
      root: home.stateHome,
      app: APP.name,
      claim,
      runId: "crashed-delivery-run",
      now: new Date(AT),
    });
    await transitionExecutionUnitJournal({
      root: home.stateHome,
      app: APP.name,
      batchRef: authorities.batch.ref,
      unitId: "unit-roadmap-validation",
      expectedStates: ["claimed"],
      nextState: "running",
      usageDelta: { providerTurns: 1 },
      now: new Date(AT),
    });
    const gh = new RecoveryGh(ISSUE_NUMBERS.map((number) => recoveryIssue(number, "op:building")));

    await createRoadmapLoopRuntime({
      root: home.stateHome,
      app: APP,
      gh: gh as unknown as GhOps,
    }).reconcile({ now: new Date(AT) });

    expect(gh.stateLabel(ISSUE_NUMBERS[0])).toBe("op:returned");
    expect(gh.stateLabel(ISSUE_NUMBERS[1])).toBe("op:returned");
    expect(await readDeliveryUnitClaim(home.stateHome, claim.record.settlement_id)).toMatchObject({
      status: "settled",
      outcome: "returned",
    });
    expect(await readExecutionUnitJournal(
      home.stateHome,
      APP.name,
      authorities.batch.ref.id,
      "unit-roadmap-validation",
    )).toMatchObject({ state: "returned", outcome: "returned" });
  });

  it("preserves one all-member approval continuation instead of terminalizing it", async () => {
    const home = await makeTempStateHome({ name: "hb103-approval-continuation" });
    homes.push(home);
    const authorities = await acceptedEpisode({ home });
    const claim = await claimDeliveryUnit({
      root: home.stateHome,
      app: APP.name,
      episodeBindingRef: authorities.binding.ref,
      readCurrentRouting: async () => AUTOMATED_ROUTING,
      now: new Date(AT),
    });
    await commitDeliveryUnitClaim({
      root: home.stateHome,
      app: APP.name,
      claim,
      runId: "approval-continuation-run",
      now: new Date(AT),
    });
    await transitionExecutionUnitJournal({
      root: home.stateHome,
      app: APP.name,
      batchRef: authorities.batch.ref,
      unitId: "unit-roadmap-validation",
      expectedStates: ["claimed"],
      nextState: "running",
      usageDelta: { providerTurns: 1 },
      now: new Date(AT),
    });
    const gh = new RecoveryGh(ISSUE_NUMBERS.map((number) => recoveryIssue(number, "op:blocked")));

    const lines = await createRoadmapLoopRuntime({
      root: home.stateHome,
      app: APP,
      gh: gh as unknown as GhOps,
    }).reconcile({ now: new Date(AT) });

    expect(lines).toContain("unit-roadmap-validation: preserved one all-member approval continuation");
    expect(gh.stateLabel(ISSUE_NUMBERS[0])).toBe("op:blocked");
    expect(gh.stateLabel(ISSUE_NUMBERS[1])).toBe("op:blocked");
    expect(await readDeliveryUnitClaim(home.stateHome, claim.record.settlement_id)).toMatchObject({
      status: "committed",
      outcome: null,
    });
  });

  it("recovers an exact-HEAD merge crash to one completed member projection", async () => {
    const home = await makeTempStateHome({ name: "hb103-merge-crash" });
    homes.push(home);
    const authorities = await acceptedEpisode({ home });
    const claim = await claimDeliveryUnit({
      root: home.stateHome,
      app: APP.name,
      episodeBindingRef: authorities.binding.ref,
      readCurrentRouting: async () => AUTOMATED_ROUTING,
      now: new Date(AT),
    });
    await commitDeliveryUnitClaim({
      root: home.stateHome,
      app: APP.name,
      claim,
      runId: "merged-crash-run",
      now: new Date(AT),
    });
    await transitionExecutionUnitJournal({
      root: home.stateHome,
      app: APP.name,
      batchRef: authorities.batch.ref,
      unitId: "unit-roadmap-validation",
      expectedStates: ["claimed"],
      nextState: "running",
      usageDelta: { providerTurns: 1 },
      now: new Date(AT),
    });
    const builder = await recordBuilderEvidence({
      root: home.stateHome,
      manifest: evidenceManifest({ ...authorities, claim }),
    });
    const reviewer = await recordReviewerVerdict({
      root: home.stateHome,
      verdict: reviewerVerdict(builder),
    });
    await transitionExecutionUnitJournal({
      root: home.stateHome,
      app: APP.name,
      batchRef: authorities.batch.ref,
      unitId: "unit-roadmap-validation",
      expectedStates: ["running"],
      nextState: "approved",
      evidenceRefs: [builder.ref, reviewer.ref],
      candidateHead: builder.value.candidateHead,
      pullRequestNumber: builder.value.pullRequestNumber,
      now: new Date("2026-08-03T22:06:00.000Z"),
    });
    const gh = new RecoveryGh([
      {
        ...recoveryIssue(ISSUE_NUMBERS[0], "op:in-review"),
        labels: ["op:tier-standard", "op:in-review"],
        state: "CLOSED",
      },
      {
        ...recoveryIssue(ISSUE_NUMBERS[1], "op:in-review"),
        labels: ["op:tier-standard", "op:in-review"],
        state: "CLOSED",
      },
    ], {
      number: builder.value.pullRequestNumber,
      title: "delivery unit",
      body: "Closes #233\nCloses #240",
      state: "MERGED",
      headRefName: "op/unit-roadmap-validation",
      baseRefName: "main",
      headRefOid: builder.value.candidateHead,
    }, ISSUE_NUMBERS[1]);

    const runtime = createRoadmapLoopRuntime({
      root: home.stateHome,
      app: APP,
      gh: gh as unknown as GhOps,
    });
    // Seeded crash boundary: one member projection lands, then cleanup fails.
    // The exact merge remains approved/committed and the retry repairs the
    // subset; it must never be rewritten as a returned unit.
    await expect(runtime.reconcile({ now: new Date("2026-08-03T22:07:00.000Z") }))
      .rejects.toThrow("seeded member cleanup crash");
    expect(gh.stateLabel(ISSUE_NUMBERS[0])).toBeUndefined();
    expect(gh.stateLabel(ISSUE_NUMBERS[1])).toBe("op:in-review");
    expect(await readDeliveryUnitClaim(home.stateHome, claim.record.settlement_id)).toMatchObject({
      status: "committed",
      outcome: null,
    });
    expect(await readExecutionUnitJournal(
      home.stateHome,
      APP.name,
      authorities.batch.ref.id,
      "unit-roadmap-validation",
    )).toMatchObject({ state: "approved", outcome: null });

    await runtime.reconcile({ now: new Date("2026-08-03T22:07:01.000Z") });

    expect(gh.stateLabel(ISSUE_NUMBERS[0])).toBeUndefined();
    expect(gh.stateLabel(ISSUE_NUMBERS[1])).toBeUndefined();
    expect(await readDeliveryUnitClaim(home.stateHome, claim.record.settlement_id)).toMatchObject({
      status: "settled",
      outcome: "approved",
    });
    expect(await readExecutionUnitJournal(
      home.stateHome,
      APP.name,
      authorities.batch.ref.id,
      "unit-roadmap-validation",
    )).toMatchObject({ state: "completed", outcome: "completed" });
  });
});

class RecoveryGh {
  private readonly issues = new Map<number, GhIssue>();
  private failRemoveOnceFor: number | undefined;

  constructor(
    issues: readonly GhIssue[],
    private readonly pr?: GhPullRequest,
    failRemoveOnceFor?: number,
  ) {
    for (const issue of issues) this.issues.set(issue.number, structuredClone(issue));
    this.failRemoveOnceFor = failRemoveOnceFor;
  }

  async readIssue(number: number): Promise<GhIssue> {
    const issue = this.issues.get(number);
    if (issue === undefined) throw new Error(`missing recovery issue #${number}`);
    return structuredClone(issue);
  }

  async swapLabel(number: number, from: string, to: string): Promise<void> {
    const issue = this.issues.get(number)!;
    if (!issue.labels.includes(from)) throw new Error(`#${number} lacks ${from}`);
    issue.labels = issue.labels.map((label) => label === from ? to : label);
  }

  async removeLabel(number: number, label: string): Promise<void> {
    if (this.failRemoveOnceFor === number) {
      this.failRemoveOnceFor = undefined;
      throw new Error("seeded member cleanup crash");
    }
    const issue = this.issues.get(number)!;
    issue.labels = issue.labels.filter((candidate) => candidate !== label);
  }

  async readPR(number: number | string): Promise<GhPullRequest> {
    if (this.pr === undefined || String(this.pr.number) !== String(number)) {
      throw new Error(`missing recovery PR ${number}`);
    }
    return structuredClone(this.pr);
  }

  stateLabel(number: number): string | undefined {
    return this.issues.get(number)?.labels.find((label) =>
      ["op:ready", "op:building", "op:in-review", "op:returned", "op:blocked"].includes(label));
  }
}

function recoveryIssue(number: number, stateLabel: string): GhIssue {
  return {
    number,
    title: `Recovery issue ${number}`,
    body: "## Goal\nRecover atomically.",
    labels: [stateLabel, "op:tier-standard"],
    state: "OPEN",
  };
}
