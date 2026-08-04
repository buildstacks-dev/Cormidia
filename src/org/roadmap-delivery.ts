// Durable roadmap-to-delivery authority joins (HB-100/HB-101).
//
// This module is deliberately provider-free until EpisodePlanner normalization:
// roadmap admission, validation admission, batching, claims, and evidence review
// are deterministic state transitions. A complete creator scope enters the real
// EpisodePlanner coordinator and produces the same durable EpisodePlan as every
// other episode without constructing a runtime.

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  episodePlanHash,
  stableHash,
  type CreatorEpisodeScope,
  type EpisodePlan,
} from "../loop/episode-plan.js";
import { writeLoopFileAtomic, writeLoopFileOnce } from "../loop/durable.js";
import {
  DurableClaimStore,
  durableClaimSettlementId,
  type DurableClaimDisposition,
  type DurableClaimRecord,
  type DurableClaimToken,
} from "../runtime/durable-claim.js";
import { withFileLock } from "../runtime/file-lock.js";
import type { RoleConfig, TurnAssignment } from "../runtime/types.js";
import type { AppEntry } from "./apps.js";
import {
  prepareEpisodePlan,
  type PreparedEpisodePlan,
} from "./episode-planner/coordinator.js";
import {
  buildEpisodeIntent,
  type EpisodeIntentFacts,
  type EpisodePlanningPolicyOptions,
} from "./episode-planner/policy.js";

export const ROADMAP_DELIVERY_SCHEMA_VERSION = 1 as const;

export type RoadmapDeliveryFailureCode =
  | "backlog_incomplete"
  | "roadmap_missing"
  | "roadmap_invalid"
  | "issue_unaccounted"
  | "issue_multiply_assigned"
  | "unit_cycle"
  | "frontier_stale"
  | "routing_ineligible"
  | "validation_contract_missing"
  | "validation_contract_invalid"
  | "validation_incomplete"
  | "batch_unit_duplicate"
  | "batch_hard_constraint_failed"
  | "already_claimed"
  | "builder_evidence_missing"
  | "evidence_head_mismatch"
  | "evidence_unit_mismatch"
  | "reviewer_evidence_incomplete"
  | "reviewer_independence_invalid"
  | "projection_contradiction"
  | "authority_conflict"
  | "authority_corrupt";

export class RoadmapDeliveryError extends Error {
  constructor(
    readonly code: RoadmapDeliveryFailureCode,
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = "RoadmapDeliveryError";
  }
}

export interface AuthorityRef {
  kind:
    | "backlog_snapshot"
    | "roadmap_plan"
    | "validation_contract"
    | "execution_batch"
    | "delivery_episode_binding"
    | "builder_evidence"
    | "reviewer_verdict";
  id: string;
  version: number;
  sha256: string;
}

export interface AcceptedAuthority<T> {
  schemaVersion: typeof ROADMAP_DELIVERY_SCHEMA_VERSION;
  ref: AuthorityRef;
  value: T;
}

export interface RoadmapDeliveryProjection {
  kind:
    | AuthorityRef["kind"]
    | "delivery_unit_claimed"
    | "delivery_unit_claim_committed"
    | "delivery_unit_settled";
  app: string;
  path: string;
  authorityRef?: AuthorityRef;
  settlementId?: string;
}

export type RoadmapDeliveryProjector = (
  projection: Readonly<RoadmapDeliveryProjection>,
) => void | Promise<void>;

export interface RoadmapWorkstream {
  workstreamId: string;
  outcome: string;
  priority: number;
}

export interface BacklogSnapshotIssue {
  issueNumber: number;
  contentHash: string;
  lifecycle: "open" | "closed";
  routing: "automated" | "human_only";
  dependencyIssues: number[];
}

export interface BacklogSnapshot {
  schemaVersion: typeof ROADMAP_DELIVERY_SCHEMA_VERSION;
  snapshotId: string;
  version: number;
  app: string;
  source: string;
  capturedAt: string;
  completeness: "complete" | "partial" | "unavailable";
  pagination: {
    pagesObserved: number;
    hasNextPage: boolean;
    unavailablePages: number[];
  };
  issues: BacklogSnapshotIssue[];
}

export interface BacklogDelta {
  previousSnapshotRef: AuthorityRef;
  currentSnapshotRef: AuthorityRef;
  addedIssueNumbers: number[];
  removedIssueNumbers: number[];
  changedIssueNumbers: number[];
  unchangedIssueNumbers: number[];
}

export interface RoadmapDeliveryUnit {
  unitId: string;
  workstreamId: string;
  issueNumbers: number[];
  dependsOn: string[];
  priority: number;
  objective: string;
}

export interface RoadmapIssueMove {
  issueNumber: number;
  fromUnitId: string;
  toUnitId: string;
  reason: string;
  movedAt: string;
}

export interface RoadmapPlan {
  schemaVersion: typeof ROADMAP_DELIVERY_SCHEMA_VERSION;
  planId: string;
  version: number;
  app: string;
  backlogSnapshotRef: AuthorityRef;
  predecessor: AuthorityRef | null;
  workstreams: RoadmapWorkstream[];
  deliveryUnits: RoadmapDeliveryUnit[];
  completedUnitIds: string[];
  readyFrontier: string[];
  wipLimit: number;
  moves: RoadmapIssueMove[];
  acceptedAt: string;
}

export interface AcceptedRoadmapPlan extends AcceptedAuthority<RoadmapPlan> {
  frontierHash: string;
}

export interface RoadmapIssueProjection {
  issueNumber: number;
  labels: string[];
  authorityRef: AuthorityRef | null;
  unitId: string | null;
  membershipHash: string | null;
}

export interface RoadmapProjectionRepair {
  issueNumber: number;
  labels: string[];
  authorityRef: AuthorityRef;
  unitId: string;
  membershipHash: string;
  reason: "missing" | "stale" | "contradictory" | "current";
}

export interface ValidationObligation {
  caseId: string;
  layer: "L1" | "L2";
  detectorId: string;
  negativeControlId: string;
  expectedEvidence: string[];
}

export interface ValidationContract {
  schemaVersion: typeof ROADMAP_DELIVERY_SCHEMA_VERSION;
  contractId: string;
  version: number;
  app: string;
  roadmapRef: AuthorityRef;
  unitId: string;
  unitMembershipHash: string;
  obligations: ValidationObligation[];
  requiredGates: string[];
  acceptedAt: string;
}

export interface RoutingSnapshotEntry {
  issueNumber: number;
  disposition: "automated" | "human_only";
  /** Projection evidence only. Labels never establish roadmap or validation authority. */
  observedLabels: string[];
}

export interface ExecutionBatchUnit {
  unitId: string;
  membershipHash: string;
  validationRef: AuthorityRef;
}

export interface ExecutionBatch {
  schemaVersion: typeof ROADMAP_DELIVERY_SCHEMA_VERSION;
  batchId: string;
  version: number;
  app: string;
  roadmapRef: AuthorityRef;
  frontierHash: string;
  units: ExecutionBatchUnit[];
  admittedAt: string;
}

export interface DeliveryEpisodeBinding {
  schemaVersion: typeof ROADMAP_DELIVERY_SCHEMA_VERSION;
  app: string;
  unitId: string;
  membershipHash: string;
  roadmapRef: AuthorityRef;
  validationRef: AuthorityRef;
  batchRef: AuthorityRef;
  episodeId: string;
  episodePlanVersion: number;
  episodePlanHash: string;
  createdAt: string;
}

export interface DeliveryUnitClaimPayload {
  app: string;
  unitId: string;
  issueNumbers: number[];
  membershipHash: string;
  roadmapRef: AuthorityRef;
  validationRef: AuthorityRef;
  batchRef: AuthorityRef;
  episodeBindingRef: AuthorityRef;
}

export interface DeliveryUnitClaim {
  disposition: DurableClaimDisposition;
  record: DurableClaimRecord<DeliveryUnitClaimPayload>;
  token?: DurableClaimToken;
}

export interface CaseEvidence {
  caseId: string;
  detectorId: string;
  negativeControlId: string;
  status: "passed";
  evidence: string;
}

export interface GateEvidence {
  gate: string;
  status: "passed";
  evidence: string;
}

export interface BuilderEvidenceManifest {
  schemaVersion: typeof ROADMAP_DELIVERY_SCHEMA_VERSION;
  app: string;
  unitId: string;
  issueNumbers: number[];
  membershipHash: string;
  roadmapRef: AuthorityRef;
  validationRef: AuthorityRef;
  batchRef: AuthorityRef;
  episodeBindingRef: AuthorityRef;
  episodeId: string;
  episodePlanVersion: number;
  episodePlanHash: string;
  claimSettlementId: string;
  claimAttempt: number;
  repository: string;
  baseRevision: string;
  candidateHead: string;
  pullRequestNumber: number;
  pullRequestUrl: string;
  builderRole: string;
  builderAssignment: TurnAssignment;
  builderSessionId: string;
  cases: CaseEvidence[];
  gates: GateEvidence[];
  recordedAt: string;
}

export interface ReviewerVerdict {
  schemaVersion: typeof ROADMAP_DELIVERY_SCHEMA_VERSION;
  app: string;
  unitId: string;
  membershipHash: string;
  roadmapRef: AuthorityRef;
  validationRef: AuthorityRef;
  episodeBindingRef: AuthorityRef;
  builderEvidenceRef: AuthorityRef;
  candidateHead: string;
  reviewerRole: string;
  reviewerAssignment: TurnAssignment;
  reviewerSessionId: string;
  disposition: "approved" | "returned";
  evidenceAccepted: boolean;
  reproducedCaseIds: string[];
  rationale: string;
  recordedAt: string;
}

type DeliveryEpisodeFacts = Omit<
  EpisodeIntentFacts,
  "episodeId" | "app" | "roles" | "creatorScope"
>;

const CLAIM_NAMESPACE = "planning/delivery-unit-claims";
const ID = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const HASH = /^[a-f0-9]{64}$/;
const CANDIDATE_HEAD = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/;
const ROADMAP_MUTATION_LOCK = {
  staleMs: 30_000,
  maxWaitMs: 31_000,
  retryMinMs: 2,
  retryMaxMs: 8,
} as const;

interface CurrentRoadmapPointer {
  schemaVersion: typeof ROADMAP_DELIVERY_SCHEMA_VERSION;
  app: string;
  ref: AuthorityRef;
  updatedAt: string;
}

export async function acceptBacklogSnapshot(input: {
  root: string;
  snapshot: BacklogSnapshot;
  project?: RoadmapDeliveryProjector;
}): Promise<AcceptedAuthority<BacklogSnapshot>> {
  assertBacklogSnapshot(input.snapshot);
  if (
    input.snapshot.completeness !== "complete" ||
    input.snapshot.pagination.hasNextPage ||
    input.snapshot.pagination.unavailablePages.length > 0
  ) {
    throw new RoadmapDeliveryError(
      "backlog_incomplete",
      `snapshot ${input.snapshot.snapshotId}@${input.snapshot.version} is ${input.snapshot.completeness} ` +
        `with ${input.snapshot.pagination.unavailablePages.length} unavailable page(s)`,
    );
  }
  const accepted = await persistAuthority(
    input.root,
    input.snapshot.app,
    "backlog_snapshot",
    input.snapshot.snapshotId,
    input.snapshot.version,
    input.snapshot,
  );
  await projectAccepted(input.root, input.snapshot.app, accepted, input.project);
  return accepted;
}

export function deriveBacklogDelta(
  previous: AcceptedAuthority<BacklogSnapshot>,
  current: AcceptedAuthority<BacklogSnapshot>,
): BacklogDelta {
  if (previous.value.app !== current.value.app) {
    throw new RoadmapDeliveryError("roadmap_invalid", "a backlog delta cannot cross apps");
  }
  const before = new Map(previous.value.issues.map((issue) => [issue.issueNumber, issue]));
  const after = new Map(current.value.issues.map((issue) => [issue.issueNumber, issue]));
  const addedIssueNumbers = [...after.keys()].filter((issue) => !before.has(issue)).sort(numeric);
  const removedIssueNumbers = [...before.keys()].filter((issue) => !after.has(issue)).sort(numeric);
  const changedIssueNumbers: number[] = [];
  const unchangedIssueNumbers: number[] = [];
  for (const issueNumber of [...before.keys()].filter((issue) => after.has(issue)).sort(numeric)) {
    if (stableHash(before.get(issueNumber)) === stableHash(after.get(issueNumber))) {
      unchangedIssueNumbers.push(issueNumber);
    } else {
      changedIssueNumbers.push(issueNumber);
    }
  }
  return {
    previousSnapshotRef: previous.ref,
    currentSnapshotRef: current.ref,
    addedIssueNumbers,
    removedIssueNumbers,
    changedIssueNumbers,
    unchangedIssueNumbers,
  };
}

export async function acceptRoadmapPlan(input: {
  root: string;
  plan: RoadmapPlan;
  project?: RoadmapDeliveryProjector;
}): Promise<AcceptedRoadmapPlan> {
  assertRoadmapPlan(input.plan);
  const snapshot = await requireAuthority<BacklogSnapshot>(
    input.root,
    input.plan.app,
    input.plan.backlogSnapshotRef,
    "backlog_snapshot",
    "backlog_incomplete",
  );
  assertBacklogSnapshot(snapshot.value);
  if (snapshot.value.completeness !== "complete" || snapshot.value.pagination.hasNextPage) {
    throw new RoadmapDeliveryError("backlog_incomplete", "RoadmapPlan names an incomplete backlog snapshot");
  }
  assertRoadmapAccounting(input.plan, snapshot.value);
  const accepted = await withFileLock(
    roadmapMutationLockPath(input.root, input.plan.app),
    ROADMAP_MUTATION_LOCK,
    async () => {
      const current = await readCurrentRoadmapPlan(input.root, input.plan.app);
      assertRoadmapRevision(input.plan, current);
      const persisted = await persistAuthority(
        input.root,
        input.plan.app,
        "roadmap_plan",
        input.plan.planId,
        input.plan.version,
        input.plan,
      );
      const pointer: CurrentRoadmapPointer = {
        schemaVersion: ROADMAP_DELIVERY_SCHEMA_VERSION,
        app: input.plan.app,
        ref: persisted.ref,
        updatedAt: input.plan.acceptedAt,
      };
      await writeLoopFileAtomic(
        currentRoadmapPointerPath(input.root, input.plan.app),
        `${JSON.stringify(pointer, null, 2)}\n`,
      );
      return persisted;
    },
  );
  await projectAccepted(input.root, input.plan.app, accepted, input.project);
  return {
    ...accepted,
    frontierHash: stableHash(input.plan.readyFrontier),
  };
}

export async function readCurrentRoadmapPlan(
  root: string,
  app: string,
): Promise<AcceptedAuthority<RoadmapPlan> | undefined> {
  const pointerPath = currentRoadmapPointerPath(root, app);
  if (!existsSync(pointerPath)) return undefined;
  let pointer: unknown;
  try {
    pointer = JSON.parse(await readFile(pointerPath, "utf8")) as unknown;
  } catch (error) {
    throw new RoadmapDeliveryError(
      "authority_corrupt",
      `current RoadmapPlan pointer is unreadable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!isCurrentRoadmapPointer(pointer) || pointer.app !== app) {
    throw new RoadmapDeliveryError("authority_corrupt", "current RoadmapPlan pointer is invalid");
  }
  return requireAuthority<RoadmapPlan>(
    root,
    app,
    pointer.ref,
    "roadmap_plan",
    "roadmap_missing",
  );
}

export function reconcileRoadmapProjections(input: {
  roadmap: AcceptedRoadmapPlan;
  snapshot: AcceptedAuthority<BacklogSnapshot>;
  current: readonly RoadmapIssueProjection[];
}): RoadmapProjectionRepair[] {
  if (!sameAuthorityRef(input.roadmap.value.backlogSnapshotRef, input.snapshot.ref)) {
    throw new RoadmapDeliveryError("projection_contradiction", "projection snapshot does not belong to RoadmapPlan");
  }
  const currentByIssue = new Map(input.current.map((projection) => [projection.issueNumber, projection]));
  const unitByIssue = new Map<number, RoadmapDeliveryUnit>();
  for (const unit of input.roadmap.value.deliveryUnits) {
    for (const issueNumber of unit.issueNumbers) unitByIssue.set(issueNumber, unit);
  }
  const ready = new Set(input.roadmap.value.readyFrontier);
  return input.snapshot.value.issues
    .map((issue): RoadmapProjectionRepair => {
      const unit = unitByIssue.get(issue.issueNumber);
      if (unit === undefined) {
        throw new RoadmapDeliveryError("issue_unaccounted", `projection has no unit for #${issue.issueNumber}`);
      }
      const membershipHash = unitMembershipHash(unit.issueNumbers);
      const prior = currentByIssue.get(issue.issueNumber);
      const desired = new Set(
        (prior?.labels ?? []).filter((label) => label !== "planning:preplanned" && label !== "op:ready"),
      );
      desired.add("planning:preplanned");
      if (ready.has(unit.unitId) && issue.routing === "automated") desired.add("op:ready");
      const labels = [...desired].sort();
      const authorityMatches = prior !== undefined &&
        prior.authorityRef !== null &&
        sameAuthorityRef(prior.authorityRef, input.roadmap.ref) &&
        prior.unitId === unit.unitId &&
        prior.membershipHash === membershipHash;
      const labelsMatch = prior !== undefined && stableHash([...prior.labels].sort()) === stableHash(labels);
      const reason: RoadmapProjectionRepair["reason"] = prior === undefined
        ? "missing"
        : authorityMatches && labelsMatch
          ? "current"
          : prior.authorityRef === null
            ? "contradictory"
            : "stale";
      return {
        issueNumber: issue.issueNumber,
        labels,
        authorityRef: input.roadmap.ref,
        unitId: unit.unitId,
        membershipHash,
        reason,
      };
    })
    .sort((left, right) => left.issueNumber - right.issueNumber);
}

export async function acceptValidationContract(input: {
  root: string;
  contract: ValidationContract;
  project?: RoadmapDeliveryProjector;
}): Promise<AcceptedAuthority<ValidationContract>> {
  assertValidationContractShape(input.contract);
  const roadmap = await requireAuthority<RoadmapPlan>(
    input.root,
    input.contract.app,
    input.contract.roadmapRef,
    "roadmap_plan",
    "roadmap_missing",
  );
  assertRoadmapPlan(roadmap.value);
  const unit = requireUnit(roadmap.value, input.contract.unitId);
  if (unitMembershipHash(unit.issueNumbers) !== input.contract.unitMembershipHash) {
    throw new RoadmapDeliveryError(
      "validation_contract_invalid",
      `contract ${input.contract.contractId} does not bind the accepted membership of ${unit.unitId}`,
    );
  }
  const accepted = await persistAuthority(
    input.root,
    input.contract.app,
    "validation_contract",
    input.contract.contractId,
    input.contract.version,
    input.contract,
  );
  await projectAccepted(input.root, input.contract.app, accepted, input.project);
  return accepted;
}

/** Token-free admission. This function neither builds an EpisodeIntent nor calls EpisodePlanner. */
export async function admitExecutionBatch(input: {
  root: string;
  app: string;
  batchId: string;
  roadmapRef: AuthorityRef;
  expectedFrontierHash: string;
  orderedUnitIds: string[];
  validationRefs: AuthorityRef[];
  routing: RoutingSnapshotEntry[];
  admittedAt: string;
  project?: RoadmapDeliveryProjector;
}): Promise<AcceptedAuthority<ExecutionBatch>> {
  assertId(input.batchId, "batch id");
  if (new Set(input.orderedUnitIds).size !== input.orderedUnitIds.length) {
    throw new RoadmapDeliveryError("batch_unit_duplicate", "a batch contains a duplicate unit");
  }
  const roadmap = await requireAuthority<RoadmapPlan>(
    input.root,
    input.app,
    input.roadmapRef,
    "roadmap_plan",
    "roadmap_missing",
  );
  assertRoadmapPlan(roadmap.value);
  const currentRoadmap = await readCurrentRoadmapPlan(input.root, input.app);
  if (currentRoadmap === undefined || !sameAuthorityRef(currentRoadmap.ref, roadmap.ref)) {
    throw new RoadmapDeliveryError(
      "frontier_stale",
      `${renderAuthorityRef(roadmap.ref)} is not the current accepted RoadmapPlan`,
    );
  }
  const frontierHash = stableHash(roadmap.value.readyFrontier);
  if (frontierHash !== input.expectedFrontierHash) {
    throw new RoadmapDeliveryError(
      "frontier_stale",
      `expected ${input.expectedFrontierHash}, accepted frontier is ${frontierHash}`,
    );
  }
  const validationByUnit = new Map<string, AcceptedAuthority<ValidationContract>>();
  for (const ref of input.validationRefs) {
    const validation = await requireAuthority<ValidationContract>(
      input.root,
      input.app,
      ref,
      "validation_contract",
      "validation_contract_missing",
    );
    assertValidationContractShape(validation.value);
    if (validationByUnit.has(validation.value.unitId)) {
      throw new RoadmapDeliveryError(
        "validation_contract_invalid",
        `multiple validation contracts supplied for ${validation.value.unitId}`,
      );
    }
    validationByUnit.set(validation.value.unitId, validation);
  }
  const units = input.orderedUnitIds.map((unitId): ExecutionBatchUnit => {
    if (!roadmap.value.readyFrontier.includes(unitId)) {
      throw new RoadmapDeliveryError(
        "batch_hard_constraint_failed",
        `${unitId} is not in the exact accepted ready frontier`,
      );
    }
    const unit = requireUnit(roadmap.value, unitId);
    assertRoutingEligible(unit, input.routing);
    const validation = validationByUnit.get(unitId);
    if (validation === undefined) {
      throw new RoadmapDeliveryError(
        "validation_incomplete",
        `${unitId} has no accepted validation contract`,
      );
    }
    if (!sameAuthorityRef(validation.value.roadmapRef, roadmap.ref)) {
      throw new RoadmapDeliveryError(
        "validation_contract_invalid",
        `${unitId} validation contract belongs to another RoadmapPlan`,
      );
    }
    const membershipHash = unitMembershipHash(unit.issueNumbers);
    if (validation.value.unitMembershipHash !== membershipHash) {
      throw new RoadmapDeliveryError(
        "validation_contract_invalid",
        `${unitId} validation membership is stale`,
      );
    }
    return { unitId, membershipHash, validationRef: validation.ref };
  });
  if (units.length === 0) {
    throw new RoadmapDeliveryError("batch_hard_constraint_failed", "a batch must contain a unit");
  }
  const batch: ExecutionBatch = {
    schemaVersion: ROADMAP_DELIVERY_SCHEMA_VERSION,
    batchId: input.batchId,
    version: 1,
    app: input.app,
    roadmapRef: roadmap.ref,
    frontierHash,
    units,
    admittedAt: requireDateTime(input.admittedAt, "batch admittedAt"),
  };
  const accepted = await persistAuthority(
    input.root,
    input.app,
    "execution_batch",
    batch.batchId,
    batch.version,
    batch,
  );
  await projectAccepted(input.root, input.app, accepted, input.project);
  return accepted;
}

/** Lazily normalize exactly one admitted unit through the real EpisodePlanner coordinator. */
export async function normalizeDeliveryUnitEpisode(input: {
  root: string;
  app: AppEntry;
  roles: readonly RoleConfig[];
  batchRef: AuthorityRef;
  unitId: string;
  facts: DeliveryEpisodeFacts;
  creatorScope: CreatorEpisodeScope;
  providerOperations?: readonly string[];
  workflowTemplates?: EpisodePlanningPolicyOptions["workflowTemplates"];
  independentReview?: EpisodePlanningPolicyOptions["independentReview"];
  now?: () => Date;
  project?: RoadmapDeliveryProjector;
}): Promise<{
  prepared: PreparedEpisodePlan;
  plan: EpisodePlan;
  binding: AcceptedAuthority<DeliveryEpisodeBinding>;
}> {
  const batch = await requireAuthority<ExecutionBatch>(
    input.root,
    input.app.name,
    input.batchRef,
    "execution_batch",
    "batch_hard_constraint_failed",
  );
  const batchUnit = batch.value.units.find((candidate) => candidate.unitId === input.unitId);
  if (batchUnit === undefined) {
    throw new RoadmapDeliveryError(
      "batch_hard_constraint_failed",
      `${input.unitId} is not admitted in ${batch.value.batchId}`,
    );
  }
  const roadmap = await requireAuthority<RoadmapPlan>(
    input.root,
    input.app.name,
    batch.value.roadmapRef,
    "roadmap_plan",
    "roadmap_missing",
  );
  const unit = requireUnit(roadmap.value, input.unitId);
  const validation = await requireAuthority<ValidationContract>(
    input.root,
    input.app.name,
    batchUnit.validationRef,
    "validation_contract",
    "validation_contract_missing",
  );
  const episodeId = `delivery-${stableHash({
    app: input.app.name,
    unitId: input.unitId,
    roadmap: roadmap.ref,
    validation: validation.ref,
  }).slice(0, 32)}`;
  const authorityInputs = [
    renderAuthorityRef(roadmap.ref),
    renderAuthorityRef(validation.ref),
    renderAuthorityRef(batch.ref),
  ];
  const creatorScope = bindCreatorScope(input.creatorScope, authorityInputs);
  const intent = buildEpisodeIntent({
    ...input.facts,
    episodeId,
    app: input.app,
    roles: input.roles,
    creatorScope,
  });
  const prepared = await prepareEpisodePlan({
    root: input.root,
    app: input.app,
    roles: input.roles,
    intent,
    ...(input.providerOperations === undefined
      ? {}
      : { providerOperations: input.providerOperations }),
    ...(input.workflowTemplates === undefined
      ? {}
      : { workflowTemplates: input.workflowTemplates }),
    ...(input.independentReview === undefined
      ? {}
      : { independentReview: input.independentReview }),
    ...(input.now === undefined ? {} : { now: input.now }),
  });
  if (!prepared.planningTurnSkipped || prepared.plannerAttempts !== 0) {
    throw new RoadmapDeliveryError(
      "batch_hard_constraint_failed",
      "HB-100 normalization requires complete creator scope and zero planner turns",
    );
  }
  const bindingValue: DeliveryEpisodeBinding = {
    schemaVersion: ROADMAP_DELIVERY_SCHEMA_VERSION,
    app: input.app.name,
    unitId: input.unitId,
    membershipHash: unitMembershipHash(unit.issueNumbers),
    roadmapRef: roadmap.ref,
    validationRef: validation.ref,
    batchRef: batch.ref,
    episodeId,
    episodePlanVersion: prepared.plan.version,
    episodePlanHash: episodePlanHash(prepared.plan),
    createdAt: prepared.plan.createdAt,
  };
  const binding = await persistAuthority(
    input.root,
    input.app.name,
    "delivery_episode_binding",
    input.unitId,
    prepared.plan.version,
    bindingValue,
  );
  await projectAccepted(input.root, input.app.name, binding, input.project);
  return { prepared, plan: prepared.plan, binding };
}

/** One content-bound claim owns every member. No per-ticket partial claim exists here. */
export async function claimDeliveryUnit(input: {
  root: string;
  app: string;
  episodeBindingRef: AuthorityRef;
  routing: RoutingSnapshotEntry[];
  now: Date;
  project?: RoadmapDeliveryProjector;
}): Promise<DeliveryUnitClaim> {
  const joined = await loadDeliveryJoin(input.root, input.app, input.episodeBindingRef);
  assertRoutingEligible(joined.unit, input.routing);
  const payload: DeliveryUnitClaimPayload = {
    app: input.app,
    unitId: joined.unit.unitId,
    issueNumbers: [...joined.unit.issueNumbers],
    membershipHash: joined.binding.value.membershipHash,
    roadmapRef: joined.roadmap.ref,
    validationRef: joined.validation.ref,
    batchRef: joined.batch.ref,
    episodeBindingRef: joined.binding.ref,
  };
  const identity = deliveryClaimIdentity(payload);
  const store = deliveryClaimStore(input.root);
  const claimed = await store.claim({ identity, payload, maxAttempts: 1, now: input.now });
  if (claimed.disposition === "claimed" || claimed.disposition === "recovered_claim") {
    await projectClaim(input.root, input.app, claimed.record.settlement_id, "delivery_unit_claimed", input.project);
  }
  return claimed;
}

export async function commitDeliveryUnitClaim(input: {
  root: string;
  app: string;
  claim: DeliveryUnitClaim;
  runId: string;
  now: Date;
  project?: RoadmapDeliveryProjector;
}): Promise<DurableClaimRecord<DeliveryUnitClaimPayload>> {
  if (input.claim.token === undefined) {
    throw new RoadmapDeliveryError("already_claimed", "claim attempt does not own the unit");
  }
  const record = await deliveryClaimStore(input.root).commit({
    settlementId: input.claim.record.settlement_id,
    attempt: input.claim.record.attempt,
    token: input.claim.token,
    runId: input.runId,
    now: input.now,
  });
  await projectClaim(input.root, input.app, record.settlement_id, "delivery_unit_claim_committed", input.project);
  return record;
}

export async function recordBuilderEvidence(input: {
  root: string;
  manifest: BuilderEvidenceManifest;
  project?: RoadmapDeliveryProjector;
}): Promise<AcceptedAuthority<BuilderEvidenceManifest>> {
  assertBuilderEvidenceShape(input.manifest);
  const joined = await loadDeliveryJoin(
    input.root,
    input.manifest.app,
    input.manifest.episodeBindingRef,
  );
  assertEvidenceJoin(input.manifest, joined);
  const claim = await deliveryClaimStore(input.root).read(input.manifest.claimSettlementId);
  if (
    claim === undefined ||
    claim.status !== "committed" ||
    claim.attempt !== input.manifest.claimAttempt ||
    claim.payload.unitId !== input.manifest.unitId ||
    claim.payload.membershipHash !== input.manifest.membershipHash
  ) {
    throw new RoadmapDeliveryError(
      "builder_evidence_missing",
      "builder evidence has no matching committed all-member claim",
    );
  }
  assertValidationEvidenceComplete(input.manifest, joined.validation.value);
  const accepted = await persistAuthority(
    input.root,
    input.manifest.app,
    "builder_evidence",
    input.manifest.unitId,
    1,
    input.manifest,
  );
  await projectAccepted(input.root, input.manifest.app, accepted, input.project);
  return accepted;
}

export function assertReviewerVerdictAdmissible(input: {
  verdict: ReviewerVerdict;
  evidence: AcceptedAuthority<BuilderEvidenceManifest>;
  validation: AcceptedAuthority<ValidationContract>;
}): void {
  const { verdict, evidence, validation } = input;
  if (
    verdict.unitId !== evidence.value.unitId ||
    verdict.membershipHash !== evidence.value.membershipHash ||
    !sameAuthorityRef(verdict.roadmapRef, evidence.value.roadmapRef) ||
    !sameAuthorityRef(verdict.episodeBindingRef, evidence.value.episodeBindingRef)
  ) {
    throw new RoadmapDeliveryError(
      "evidence_unit_mismatch",
      "review verdict and Builder evidence do not bind the same delivery unit",
    );
  }
  if (
    !sameAuthorityRef(verdict.validationRef, validation.ref) ||
    !sameAuthorityRef(evidence.value.validationRef, validation.ref) ||
    !sameAuthorityRef(verdict.builderEvidenceRef, evidence.ref)
  ) {
    throw new RoadmapDeliveryError(
      "validation_contract_invalid",
      "review lineage uses a different validation contract or evidence artifact",
    );
  }
  if (verdict.candidateHead !== evidence.value.candidateHead) {
    throw new RoadmapDeliveryError(
      "evidence_head_mismatch",
      `reviewed ${verdict.candidateHead}, Builder evidence binds ${evidence.value.candidateHead}`,
    );
  }
  if (
    verdict.reviewerRole === evidence.value.builderRole ||
    verdict.reviewerSessionId === evidence.value.builderSessionId ||
    sameAssignment(verdict.reviewerAssignment, evidence.value.builderAssignment)
  ) {
    throw new RoadmapDeliveryError(
      "reviewer_independence_invalid",
      "Reviewer role, assignment, and private session must be independent of Builder",
    );
  }
  if (verdict.disposition === "approved") {
    const reproduced = new Set(verdict.reproducedCaseIds);
    const missing = validation.value.obligations
      .map((obligation) => obligation.caseId)
      .filter((caseId) => !reproduced.has(caseId));
    if (!verdict.evidenceAccepted || missing.length > 0) {
      throw new RoadmapDeliveryError(
        "reviewer_evidence_incomplete",
        `approval lacks accepted evidence for: ${missing.join(", ") || "the manifest"}`,
      );
    }
  }
}

export async function recordReviewerVerdict(input: {
  root: string;
  verdict: ReviewerVerdict;
  project?: RoadmapDeliveryProjector;
}): Promise<AcceptedAuthority<ReviewerVerdict>> {
  assertReviewerVerdictShape(input.verdict);
  const evidence = await requireAuthority<BuilderEvidenceManifest>(
    input.root,
    input.verdict.app,
    input.verdict.builderEvidenceRef,
    "builder_evidence",
    "builder_evidence_missing",
  );
  const validation = await requireAuthority<ValidationContract>(
    input.root,
    input.verdict.app,
    input.verdict.validationRef,
    "validation_contract",
    "validation_contract_missing",
  );
  assertReviewerVerdictAdmissible({ verdict: input.verdict, evidence, validation });
  const accepted = await persistAuthority(
    input.root,
    input.verdict.app,
    "reviewer_verdict",
    input.verdict.unitId,
    1,
    input.verdict,
  );
  await projectAccepted(input.root, input.verdict.app, accepted, input.project);
  return accepted;
}

export async function settleDeliveryUnitClaim(input: {
  root: string;
  app: string;
  claimSettlementId: string;
  claimAttempt: number;
  runId: string;
  reviewerVerdictRef: AuthorityRef;
  outcome: "approved" | "returned";
  now: Date;
  project?: RoadmapDeliveryProjector;
}): Promise<DurableClaimRecord<DeliveryUnitClaimPayload>> {
  const store = deliveryClaimStore(input.root);
  const [claim, verdict] = await Promise.all([
    store.read(input.claimSettlementId),
    requireAuthority<ReviewerVerdict>(
      input.root,
      input.app,
      input.reviewerVerdictRef,
      "reviewer_verdict",
      "reviewer_evidence_incomplete",
    ),
  ]);
  if (
    claim === undefined ||
    verdict.value.disposition !== input.outcome ||
    verdict.value.unitId !== claim.payload.unitId ||
    verdict.value.membershipHash !== claim.payload.membershipHash ||
    !sameAuthorityRef(verdict.value.roadmapRef, claim.payload.roadmapRef) ||
    !sameAuthorityRef(verdict.value.validationRef, claim.payload.validationRef) ||
    !sameAuthorityRef(verdict.value.episodeBindingRef, claim.payload.episodeBindingRef)
  ) {
    throw new RoadmapDeliveryError(
      "reviewer_evidence_incomplete",
      "claim settlement has no exact matching independent Reviewer verdict",
    );
  }
  const record = await store.settle({
    settlementId: input.claimSettlementId,
    attempt: input.claimAttempt,
    runId: input.runId,
    outcome: input.outcome,
    now: input.now,
  });
  await projectClaim(input.root, input.app, record.settlement_id, "delivery_unit_settled", input.project);
  return record;
}

export function roadmapAuthorityPath(
  root: string,
  app: string,
  id: string,
  version: number,
): string {
  return authorityPath(root, app, "roadmap_plan", id, version);
}

export function backlogSnapshotAuthorityPath(
  root: string,
  app: string,
  id: string,
  version: number,
): string {
  return authorityPath(root, app, "backlog_snapshot", id, version);
}

export function currentRoadmapPointerPath(root: string, app: string): string {
  return join(planningAppDir(root, app), "roadmap-current.json");
}

export function validationAuthorityPath(
  root: string,
  app: string,
  id: string,
  version: number,
): string {
  return authorityPath(root, app, "validation_contract", id, version);
}

export function batchAuthorityPath(
  root: string,
  app: string,
  id: string,
  version: number,
): string {
  return authorityPath(root, app, "execution_batch", id, version);
}

export function deliveryClaimRecordPath(root: string, identity: string): string {
  const settlementId = durableClaimSettlementId(identity);
  return join(resolve(root), CLAIM_NAMESPACE, "records", `${settlementId}.json`);
}

export function deliveryClaimIdentity(payload: DeliveryUnitClaimPayload): string {
  return [
    "roadmap-delivery-unit/v1",
    payload.app,
    payload.unitId,
    payload.membershipHash,
    payload.roadmapRef.sha256,
    payload.validationRef.sha256,
    payload.batchRef.sha256,
    payload.episodeBindingRef.sha256,
  ].join("\0");
}

export function unitMembershipHash(issueNumbers: readonly number[]): string {
  return stableHash([...issueNumbers]);
}

function deliveryClaimStore(root: string): DurableClaimStore<DeliveryUnitClaimPayload> {
  return new DurableClaimStore<DeliveryUnitClaimPayload>({ root, namespace: CLAIM_NAMESPACE });
}

async function loadDeliveryJoin(root: string, app: string, bindingRef: AuthorityRef) {
  const binding = await requireAuthority<DeliveryEpisodeBinding>(
    root,
    app,
    bindingRef,
    "delivery_episode_binding",
    "batch_hard_constraint_failed",
  );
  const roadmap = await requireAuthority<RoadmapPlan>(
    root,
    app,
    binding.value.roadmapRef,
    "roadmap_plan",
    "roadmap_missing",
  );
  const validation = await requireAuthority<ValidationContract>(
    root,
    app,
    binding.value.validationRef,
    "validation_contract",
    "validation_contract_missing",
  );
  const batch = await requireAuthority<ExecutionBatch>(
    root,
    app,
    binding.value.batchRef,
    "execution_batch",
    "batch_hard_constraint_failed",
  );
  const unit = requireUnit(roadmap.value, binding.value.unitId);
  if (
    binding.value.membershipHash !== unitMembershipHash(unit.issueNumbers) ||
    !sameAuthorityRef(validation.value.roadmapRef, roadmap.ref) ||
    !batch.value.units.some((entry) =>
      entry.unitId === unit.unitId &&
      entry.membershipHash === binding.value.membershipHash &&
      sameAuthorityRef(entry.validationRef, validation.ref))
  ) {
    throw new RoadmapDeliveryError(
      "evidence_unit_mismatch",
      "delivery episode binding does not reproduce its roadmap, validation, and batch lineage",
    );
  }
  return { binding, roadmap, validation, batch, unit };
}

function assertEvidenceJoin(
  manifest: BuilderEvidenceManifest,
  joined: Awaited<ReturnType<typeof loadDeliveryJoin>>,
): void {
  if (
    manifest.unitId !== joined.unit.unitId ||
    stableHash(manifest.issueNumbers) !== joined.binding.value.membershipHash ||
    manifest.membershipHash !== joined.binding.value.membershipHash ||
    !sameAuthorityRef(manifest.roadmapRef, joined.roadmap.ref) ||
    !sameAuthorityRef(manifest.validationRef, joined.validation.ref) ||
    !sameAuthorityRef(manifest.batchRef, joined.batch.ref) ||
    !sameAuthorityRef(manifest.episodeBindingRef, joined.binding.ref) ||
    manifest.episodeId !== joined.binding.value.episodeId ||
    manifest.episodePlanVersion !== joined.binding.value.episodePlanVersion ||
    manifest.episodePlanHash !== joined.binding.value.episodePlanHash
  ) {
    throw new RoadmapDeliveryError(
      "evidence_unit_mismatch",
      "Builder evidence does not bind the exact accepted unit/plan lineage",
    );
  }
}

function assertValidationEvidenceComplete(
  manifest: BuilderEvidenceManifest,
  contract: ValidationContract,
): void {
  const cases = new Map(manifest.cases.map((entry) => [entry.caseId, entry]));
  for (const obligation of contract.obligations) {
    const evidence = cases.get(obligation.caseId);
    if (
      evidence === undefined ||
      evidence.detectorId !== obligation.detectorId ||
      evidence.negativeControlId !== obligation.negativeControlId ||
      evidence.status !== "passed" ||
      evidence.evidence.trim().length === 0
    ) {
      throw new RoadmapDeliveryError(
        "builder_evidence_missing",
        `missing exact detector/negative-control evidence for ${obligation.caseId}`,
      );
    }
  }
  const gates = new Set(
    manifest.gates
      .filter((entry) => entry.status === "passed" && entry.evidence.trim().length > 0)
      .map((entry) => entry.gate),
  );
  const missingGates = contract.requiredGates.filter((gate) => !gates.has(gate));
  if (missingGates.length > 0) {
    throw new RoadmapDeliveryError(
      "builder_evidence_missing",
      `missing gate evidence for ${missingGates.join(", ")}`,
    );
  }
}

function bindCreatorScope(
  scope: CreatorEpisodeScope,
  authorityInputs: readonly string[],
): CreatorEpisodeScope {
  const inputs = authorityInputs.map((ref) => ({ ref, required: true }));
  return {
    ...structuredClone(scope),
    provenance: {
      ...structuredClone(scope.provenance),
      evidenceRefs: [...new Set([...scope.provenance.evidenceRefs, ...authorityInputs])].sort(),
    },
    ...(scope.steps === undefined
      ? {}
      : {
          steps: scope.steps.map((step) => ({
            ...structuredClone(step),
            inputRefs: step.dependsOn.length === 0
              ? uniqueInputRefs([...step.inputRefs, ...inputs])
              : structuredClone(step.inputRefs),
          })),
        }),
  };
}

function uniqueInputRefs(
  refs: Array<{ ref: string; required: boolean }>,
): Array<{ ref: string; required: boolean }> {
  const byRef = new Map<string, { ref: string; required: boolean }>();
  for (const ref of refs) {
    const existing = byRef.get(ref.ref);
    byRef.set(ref.ref, { ref: ref.ref, required: ref.required || existing?.required === true });
  }
  return [...byRef.values()].sort((left, right) => left.ref.localeCompare(right.ref));
}

function assertRoadmapPlan(plan: RoadmapPlan): void {
  if (plan.schemaVersion !== ROADMAP_DELIVERY_SCHEMA_VERSION) {
    throw new RoadmapDeliveryError("roadmap_invalid", "unsupported RoadmapPlan schema");
  }
  assertId(plan.planId, "roadmap plan id");
  assertVersion(plan.version, "roadmap plan version");
  assertAuthorityRef(plan.backlogSnapshotRef, "backlog_snapshot");
  requireDateTime(plan.acceptedAt, "roadmap acceptedAt");
  if (
    plan.app.trim().length === 0 ||
    plan.workstreams.length === 0 ||
    plan.deliveryUnits.length === 0 ||
    !Number.isInteger(plan.wipLimit) ||
    plan.wipLimit < 1 ||
    plan.readyFrontier.length > plan.wipLimit
  ) {
    throw new RoadmapDeliveryError("roadmap_invalid", "app, workstreams, and delivery units are required");
  }
  if (plan.predecessor !== null) assertAuthorityRef(plan.predecessor, "roadmap_plan");
  const workstreams = new Set<string>();
  for (const workstream of plan.workstreams) {
    assertId(workstream.workstreamId, "workstream id");
    if (workstreams.has(workstream.workstreamId)) {
      throw new RoadmapDeliveryError("roadmap_invalid", `duplicate workstream ${workstream.workstreamId}`);
    }
    workstreams.add(workstream.workstreamId);
    if (!Number.isInteger(workstream.priority) || workstream.outcome.trim().length === 0) {
      throw new RoadmapDeliveryError("roadmap_invalid", `invalid workstream ${workstream.workstreamId}`);
    }
  }
  const units = new Map<string, RoadmapDeliveryUnit>();
  const issues = new Set<number>();
  for (const unit of plan.deliveryUnits) {
    assertId(unit.unitId, "delivery unit id");
    if (units.has(unit.unitId)) {
      throw new RoadmapDeliveryError("roadmap_invalid", `duplicate delivery unit ${unit.unitId}`);
    }
    if (!workstreams.has(unit.workstreamId) || unit.issueNumbers.length === 0) {
      throw new RoadmapDeliveryError("roadmap_invalid", `invalid delivery unit ${unit.unitId}`);
    }
    for (const issue of unit.issueNumbers) {
      if (!Number.isInteger(issue) || issue < 1) {
        throw new RoadmapDeliveryError("issue_unaccounted", `${unit.unitId} has invalid issue ${issue}`);
      }
      if (issues.has(issue)) {
        throw new RoadmapDeliveryError("issue_multiply_assigned", `issue #${issue} appears in multiple units`);
      }
      issues.add(issue);
    }
    units.set(unit.unitId, unit);
  }
  for (const unit of plan.deliveryUnits) {
    for (const dependency of unit.dependsOn) {
      if (!units.has(dependency) || dependency === unit.unitId) {
        throw new RoadmapDeliveryError("unit_cycle", `${unit.unitId} has invalid dependency ${dependency}`);
      }
    }
  }
  assertAcyclic(plan.deliveryUnits);
  const completed = new Set<string>();
  for (const unitId of plan.completedUnitIds) {
    if (completed.has(unitId) || !units.has(unitId)) {
      throw new RoadmapDeliveryError("roadmap_invalid", `invalid completed unit ${unitId}`);
    }
    completed.add(unitId);
  }
  const frontier = new Set<string>();
  for (const unitId of plan.readyFrontier) {
    if (frontier.has(unitId) || !units.has(unitId) || completed.has(unitId)) {
      throw new RoadmapDeliveryError("roadmap_invalid", `invalid ready-frontier unit ${unitId}`);
    }
    const unit = units.get(unitId)!;
    const unmet = unit.dependsOn.filter((dependency) => !completed.has(dependency));
    if (unmet.length > 0) {
      throw new RoadmapDeliveryError(
        "roadmap_invalid",
        `ready-frontier unit ${unitId} has unmet dependencies: ${unmet.join(", ")}`,
      );
    }
    frontier.add(unitId);
  }
  const expectedOrder = plan.readyFrontier
    .map((unitId) => units.get(unitId)!)
    .sort((left, right) => left.priority - right.priority || left.unitId.localeCompare(right.unitId))
    .map((unit) => unit.unitId);
  if (stableHash(expectedOrder) !== stableHash(plan.readyFrontier)) {
    throw new RoadmapDeliveryError("roadmap_invalid", "ready frontier is not in stable priority order");
  }
  const seenMoves = new Set<string>();
  for (const move of plan.moves) {
    if (
      !Number.isInteger(move.issueNumber) ||
      move.issueNumber < 1 ||
      !units.has(move.toUnitId) ||
      move.fromUnitId === move.toUnitId ||
      move.reason.trim().length === 0 ||
      seenMoves.has(`${move.issueNumber}\0${move.fromUnitId}\0${move.toUnitId}`)
    ) {
      throw new RoadmapDeliveryError("roadmap_invalid", `invalid move for issue #${move.issueNumber}`);
    }
    requireDateTime(move.movedAt, "roadmap move movedAt");
    seenMoves.add(`${move.issueNumber}\0${move.fromUnitId}\0${move.toUnitId}`);
  }
}

function assertBacklogSnapshot(snapshot: BacklogSnapshot): void {
  if (snapshot.schemaVersion !== ROADMAP_DELIVERY_SCHEMA_VERSION) {
    throw new RoadmapDeliveryError("backlog_incomplete", "unsupported backlog snapshot schema");
  }
  assertId(snapshot.snapshotId, "snapshot id");
  assertVersion(snapshot.version, "snapshot version");
  requireDateTime(snapshot.capturedAt, "snapshot capturedAt");
  if (
    snapshot.app.trim().length === 0 ||
    snapshot.source.trim().length === 0 ||
    !Number.isInteger(snapshot.pagination.pagesObserved) ||
    snapshot.pagination.pagesObserved < 1 ||
    snapshot.issues.length === 0
  ) {
    throw new RoadmapDeliveryError("backlog_incomplete", "backlog snapshot metadata is incomplete");
  }
  const issues = new Set<number>();
  for (const issue of snapshot.issues) {
    if (!Number.isInteger(issue.issueNumber) || issue.issueNumber < 1 || issues.has(issue.issueNumber)) {
      throw new RoadmapDeliveryError(
        issues.has(issue.issueNumber) ? "issue_multiply_assigned" : "backlog_incomplete",
        `invalid or duplicate snapshot issue #${issue.issueNumber}`,
      );
    }
    assertHash(issue.contentHash, `snapshot issue #${issue.issueNumber} content hash`);
    if (
      new Set(issue.dependencyIssues).size !== issue.dependencyIssues.length ||
      issue.dependencyIssues.some((dependency) => !Number.isInteger(dependency) || dependency < 1)
    ) {
      throw new RoadmapDeliveryError("backlog_incomplete", `invalid dependencies for #${issue.issueNumber}`);
    }
    issues.add(issue.issueNumber);
  }
  for (const issue of snapshot.issues) {
    const missing = issue.dependencyIssues.filter((dependency) => !issues.has(dependency));
    if (missing.length > 0) {
      throw new RoadmapDeliveryError(
        "backlog_incomplete",
        `snapshot issue #${issue.issueNumber} has unavailable dependencies: ${missing.join(", ")}`,
      );
    }
  }
}

function assertRoadmapAccounting(plan: RoadmapPlan, snapshot: BacklogSnapshot): void {
  if (plan.app !== snapshot.app || !sameAuthorityRef(plan.backlogSnapshotRef, authorityRefForSnapshot(snapshot))) {
    throw new RoadmapDeliveryError("roadmap_invalid", "RoadmapPlan does not bind the accepted backlog snapshot");
  }
  const expected = snapshot.issues
    .filter((issue) => issue.lifecycle === "open")
    .map((issue) => issue.issueNumber)
    .sort(numeric);
  const actual = plan.deliveryUnits.flatMap((unit) => unit.issueNumbers).sort(numeric);
  if (stableHash(expected) !== stableHash(actual)) {
    const actualSet = new Set(actual);
    const expectedSet = new Set(expected);
    const missing = expected.filter((issue) => !actualSet.has(issue));
    const unexpected = actual.filter((issue) => !expectedSet.has(issue));
    throw new RoadmapDeliveryError(
      "issue_unaccounted",
      `RoadmapPlan accounting mismatch; missing [${missing.join(",")}], unexpected [${unexpected.join(",")}]`,
    );
  }
}

function assertRoadmapRevision(
  plan: RoadmapPlan,
  current: AcceptedAuthority<RoadmapPlan> | undefined,
): void {
  const proposedRef: AuthorityRef = {
    kind: "roadmap_plan",
    id: plan.planId,
    version: plan.version,
    sha256: stableHash(plan),
  };
  if (current === undefined) {
    if (plan.version !== 1 || plan.predecessor !== null || plan.moves.length !== 0) {
      throw new RoadmapDeliveryError(
        "roadmap_invalid",
        "the first RoadmapPlan must be v1 with no predecessor or move history",
      );
    }
    return;
  }
  if (sameAuthorityRef(current.ref, proposedRef)) return;
  if (
    plan.planId !== current.value.planId ||
    plan.version !== current.value.version + 1 ||
    plan.predecessor === null ||
    !sameAuthorityRef(plan.predecessor, current.ref)
  ) {
    throw new RoadmapDeliveryError(
      "frontier_stale",
      `RoadmapPlan revision must advance ${renderAuthorityRef(current.ref)} by exactly one version`,
    );
  }
  if (plan.moves.length < current.value.moves.length) {
    throw new RoadmapDeliveryError("roadmap_invalid", "roadmap move history cannot shrink");
  }
  for (let index = 0; index < current.value.moves.length; index += 1) {
    if (stableHash(plan.moves[index]) !== stableHash(current.value.moves[index])) {
      throw new RoadmapDeliveryError("roadmap_invalid", "roadmap move history is not append-only");
    }
  }
  const priorByIssue = unitByIssue(current.value);
  const nextByIssue = unitByIssue(plan);
  const newMoves = plan.moves.slice(current.value.moves.length);
  for (const [issueNumber, priorUnit] of priorByIssue) {
    const nextUnit = nextByIssue.get(issueNumber);
    if (nextUnit === undefined || nextUnit.unitId === priorUnit.unitId) continue;
    const move = newMoves.find((candidate) =>
      candidate.issueNumber === issueNumber &&
      candidate.fromUnitId === priorUnit.unitId &&
      candidate.toUnitId === nextUnit.unitId);
    if (move === undefined) {
      throw new RoadmapDeliveryError(
        "roadmap_invalid",
        `issue #${issueNumber} moved ${priorUnit.unitId} → ${nextUnit.unitId} without append-only evidence`,
      );
    }
  }
  const priorMembershipIds = new Map(
    current.value.deliveryUnits.map((unit) => [stableHash([...unit.issueNumbers].sort(numeric)), unit.unitId]),
  );
  for (const unit of plan.deliveryUnits) {
    const priorId = priorMembershipIds.get(stableHash([...unit.issueNumbers].sort(numeric)));
    if (priorId !== undefined && priorId !== unit.unitId) {
      throw new RoadmapDeliveryError(
        "roadmap_invalid",
        `unchanged membership ${unit.issueNumbers.join(",")} changed stable unit id ${priorId} → ${unit.unitId}`,
      );
    }
  }
}

function assertValidationContractShape(contract: ValidationContract): void {
  if (contract.schemaVersion !== ROADMAP_DELIVERY_SCHEMA_VERSION) {
    throw new RoadmapDeliveryError("validation_contract_invalid", "unsupported validation schema");
  }
  assertId(contract.contractId, "validation contract id");
  assertId(contract.unitId, "validation unit id");
  assertVersion(contract.version, "validation contract version");
  assertAuthorityRef(contract.roadmapRef, "roadmap_plan");
  assertHash(contract.unitMembershipHash, "validation membership hash");
  requireDateTime(contract.acceptedAt, "validation acceptedAt");
  if (contract.app.trim().length === 0 || contract.obligations.length === 0 || contract.requiredGates.length === 0) {
    throw new RoadmapDeliveryError(
      "validation_contract_invalid",
      "app, obligations, and required gates are required",
    );
  }
  const caseIds = new Set<string>();
  for (const obligation of contract.obligations) {
    if (
      obligation.caseId.trim().length === 0 ||
      obligation.detectorId.trim().length === 0 ||
      obligation.negativeControlId.trim().length === 0 ||
      obligation.expectedEvidence.length === 0 ||
      caseIds.has(obligation.caseId)
    ) {
      throw new RoadmapDeliveryError(
        "validation_contract_invalid",
        `invalid or duplicate validation obligation ${obligation.caseId}`,
      );
    }
    caseIds.add(obligation.caseId);
  }
}

function assertBuilderEvidenceShape(manifest: BuilderEvidenceManifest): void {
  if (manifest.schemaVersion !== ROADMAP_DELIVERY_SCHEMA_VERSION) {
    throw new RoadmapDeliveryError("builder_evidence_missing", "unsupported evidence schema");
  }
  assertId(manifest.unitId, "evidence unit id");
  assertHash(manifest.membershipHash, "evidence membership hash");
  assertHash(manifest.episodePlanHash, "EpisodePlan hash");
  if (!CANDIDATE_HEAD.test(manifest.candidateHead)) {
    throw new RoadmapDeliveryError("evidence_head_mismatch", "candidate HEAD is not a full git object id");
  }
  if (
    !Number.isInteger(manifest.pullRequestNumber) ||
    manifest.pullRequestNumber < 1 ||
    manifest.builderRole.trim().length === 0 ||
    manifest.builderSessionId.trim().length === 0 ||
    manifest.repository.trim().length === 0 ||
    manifest.baseRevision.trim().length === 0 ||
    manifest.cases.length === 0 ||
    manifest.gates.length === 0
  ) {
    throw new RoadmapDeliveryError("builder_evidence_missing", "Builder evidence is structurally incomplete");
  }
  requireDateTime(manifest.recordedAt, "Builder evidence recordedAt");
}

function assertReviewerVerdictShape(verdict: ReviewerVerdict): void {
  if (verdict.schemaVersion !== ROADMAP_DELIVERY_SCHEMA_VERSION) {
    throw new RoadmapDeliveryError("reviewer_evidence_incomplete", "unsupported Reviewer verdict schema");
  }
  assertId(verdict.unitId, "review unit id");
  assertHash(verdict.membershipHash, "review membership hash");
  if (
    !CANDIDATE_HEAD.test(verdict.candidateHead) ||
    verdict.reviewerRole.trim().length === 0 ||
    verdict.reviewerSessionId.trim().length === 0 ||
    verdict.rationale.trim().length === 0
  ) {
    throw new RoadmapDeliveryError("reviewer_evidence_incomplete", "Reviewer verdict is structurally incomplete");
  }
  requireDateTime(verdict.recordedAt, "Reviewer verdict recordedAt");
}

function assertRoutingEligible(
  unit: RoadmapDeliveryUnit,
  routing: readonly RoutingSnapshotEntry[],
): void {
  const byIssue = new Map(routing.map((entry) => [entry.issueNumber, entry]));
  for (const issueNumber of unit.issueNumbers) {
    const current = byIssue.get(issueNumber);
    if (current === undefined || current.disposition !== "automated") {
      throw new RoadmapDeliveryError(
        "routing_ineligible",
        `delivery unit ${unit.unitId} is excluded because #${issueNumber} is ${current?.disposition ?? "unreadable"}`,
      );
    }
  }
}

function requireUnit(plan: RoadmapPlan, unitId: string): RoadmapDeliveryUnit {
  const unit = plan.deliveryUnits.find((candidate) => candidate.unitId === unitId);
  if (unit === undefined) {
    throw new RoadmapDeliveryError("issue_unaccounted", `RoadmapPlan has no unit ${unitId}`);
  }
  return unit;
}

function assertAcyclic(units: readonly RoadmapDeliveryUnit[]): void {
  const byId = new Map(units.map((unit) => [unit.unitId, unit]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visited.has(id)) return;
    if (visiting.has(id)) throw new RoadmapDeliveryError("unit_cycle", `cycle includes ${id}`);
    visiting.add(id);
    for (const dependency of byId.get(id)?.dependsOn ?? []) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };
  for (const unit of units) visit(unit.unitId);
}

async function persistAuthority<T>(
  root: string,
  app: string,
  kind: AuthorityRef["kind"],
  id: string,
  version: number,
  value: T,
): Promise<AcceptedAuthority<T>> {
  assertId(id, `${kind} id`);
  assertVersion(version, `${kind} version`);
  const ref: AuthorityRef = { kind, id, version, sha256: stableHash(value) };
  const accepted: AcceptedAuthority<T> = {
    schemaVersion: ROADMAP_DELIVERY_SCHEMA_VERSION,
    ref,
    value: structuredClone(value),
  };
  const path = authorityPath(root, app, kind, id, version);
  const won = await writeLoopFileOnce(path, `${JSON.stringify(accepted, null, 2)}\n`);
  if (!won) {
    const existing = await readAuthorityFile<T>(path);
    if (!sameAuthorityRef(existing.ref, ref) || stableHash(existing.value) !== ref.sha256) {
      throw new RoadmapDeliveryError("authority_conflict", `${kind} ${id}@${version} already differs`);
    }
  }
  const persisted = await readAuthorityFile<T>(path);
  if (!sameAuthorityRef(persisted.ref, ref) || stableHash(persisted.value) !== ref.sha256) {
    throw new RoadmapDeliveryError("authority_corrupt", `${kind} ${id}@${version} failed readback`);
  }
  return persisted;
}

async function requireAuthority<T>(
  root: string,
  app: string,
  ref: AuthorityRef,
  kind: AuthorityRef["kind"],
  missingCode: RoadmapDeliveryFailureCode,
): Promise<AcceptedAuthority<T>> {
  assertAuthorityRef(ref, kind);
  const path = authorityPath(root, app, kind, ref.id, ref.version);
  if (!existsSync(path)) {
    throw new RoadmapDeliveryError(missingCode, `${renderAuthorityRef(ref)} is missing`);
  }
  const accepted = await readAuthorityFile<T>(path);
  if (!sameAuthorityRef(accepted.ref, ref) || stableHash(accepted.value) !== ref.sha256) {
    throw new RoadmapDeliveryError("authority_corrupt", `${renderAuthorityRef(ref)} failed content binding`);
  }
  return accepted;
}

async function readAuthorityFile<T>(path: string): Promise<AcceptedAuthority<T>> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    throw new RoadmapDeliveryError(
      "authority_corrupt",
      `${path} is unreadable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!isAcceptedAuthority(parsed)) {
    throw new RoadmapDeliveryError("authority_corrupt", `${path} is not an accepted authority envelope`);
  }
  return parsed as AcceptedAuthority<T>;
}

function isAcceptedAuthority(value: unknown): value is AcceptedAuthority<unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  if (row["schemaVersion"] !== ROADMAP_DELIVERY_SCHEMA_VERSION || !("value" in row)) return false;
  const ref = row["ref"];
  if (ref === null || typeof ref !== "object" || Array.isArray(ref)) return false;
  const candidate = ref as Record<string, unknown>;
  return typeof candidate["kind"] === "string" &&
    typeof candidate["id"] === "string" &&
    Number.isInteger(candidate["version"]) &&
    typeof candidate["sha256"] === "string";
}

function authorityPath(
  root: string,
  app: string,
  kind: AuthorityRef["kind"],
  id: string,
  version: number,
): string {
  assertId(id, `${kind} id`);
  assertVersion(version, `${kind} version`);
  return join(planningAppDir(root, app), `${kind}s`, id, `v${version}.json`);
}

function planningAppDir(root: string, app: string): string {
  const appKey = stableHash(app).slice(0, 32);
  return join(resolve(root), "planning", "apps", appKey);
}

function roadmapMutationLockPath(root: string, app: string): string {
  return join(planningAppDir(root, app), "roadmap-mutation.lock");
}

function claimRecordPath(root: string, settlementId: string): string {
  return join(resolve(root), CLAIM_NAMESPACE, "records", `${settlementId}.json`);
}

async function projectAccepted<T>(
  root: string,
  app: string,
  accepted: AcceptedAuthority<T>,
  project?: RoadmapDeliveryProjector,
): Promise<void> {
  if (project === undefined) return;
  const path = authorityPath(root, app, accepted.ref.kind, accepted.ref.id, accepted.ref.version);
  if (!existsSync(path)) {
    throw new RoadmapDeliveryError("authority_corrupt", `projection preceded persistence: ${path}`);
  }
  await project({ kind: accepted.ref.kind, app, path, authorityRef: accepted.ref });
}

async function projectClaim(
  root: string,
  app: string,
  settlementId: string,
  kind: Extract<RoadmapDeliveryProjection["kind"],
    "delivery_unit_claimed" | "delivery_unit_claim_committed" | "delivery_unit_settled">,
  project?: RoadmapDeliveryProjector,
): Promise<void> {
  if (project === undefined) return;
  const path = claimRecordPath(root, settlementId);
  if (!existsSync(path)) {
    throw new RoadmapDeliveryError("authority_corrupt", `claim projection preceded persistence: ${path}`);
  }
  await project({ kind, app, path, settlementId });
}

function renderAuthorityRef(ref: AuthorityRef): string {
  return `${ref.kind}:${ref.id}@${ref.version}#${ref.sha256}`;
}

function sameAuthorityRef(left: AuthorityRef, right: AuthorityRef): boolean {
  return left.kind === right.kind &&
    left.id === right.id &&
    left.version === right.version &&
    left.sha256 === right.sha256;
}

function authorityRefForSnapshot(snapshot: BacklogSnapshot): AuthorityRef {
  return {
    kind: "backlog_snapshot",
    id: snapshot.snapshotId,
    version: snapshot.version,
    sha256: stableHash(snapshot),
  };
}

function isCurrentRoadmapPointer(value: unknown): value is CurrentRoadmapPointer {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  if (
    row["schemaVersion"] !== ROADMAP_DELIVERY_SCHEMA_VERSION ||
    typeof row["app"] !== "string" ||
    typeof row["updatedAt"] !== "string"
  ) return false;
  const ref = row["ref"];
  if (ref === null || typeof ref !== "object" || Array.isArray(ref)) return false;
  const candidate = ref as Record<string, unknown>;
  return candidate["kind"] === "roadmap_plan" &&
    typeof candidate["id"] === "string" &&
    Number.isInteger(candidate["version"]) &&
    typeof candidate["sha256"] === "string";
}

function unitByIssue(plan: RoadmapPlan): Map<number, RoadmapDeliveryUnit> {
  const result = new Map<number, RoadmapDeliveryUnit>();
  for (const unit of plan.deliveryUnits) {
    for (const issueNumber of unit.issueNumbers) result.set(issueNumber, unit);
  }
  return result;
}

function numeric(left: number, right: number): number {
  return left - right;
}

function assertAuthorityRef(ref: AuthorityRef, kind: AuthorityRef["kind"]): void {
  if (ref.kind !== kind) {
    throw new RoadmapDeliveryError("authority_corrupt", `expected ${kind}, got ${ref.kind}`);
  }
  assertId(ref.id, `${kind} ref id`);
  assertVersion(ref.version, `${kind} ref version`);
  assertHash(ref.sha256, `${kind} ref hash`);
}

function sameAssignment(left: TurnAssignment, right: TurnAssignment): boolean {
  return left.harness === right.harness && left.model === right.model && left.effort === right.effort;
}

function assertId(value: string, label: string): void {
  if (!ID.test(value)) throw new RoadmapDeliveryError("roadmap_invalid", `${label} is invalid: ${value}`);
}

function assertVersion(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new RoadmapDeliveryError("roadmap_invalid", `${label} must be a positive integer`);
  }
}

function assertHash(value: string, label: string): void {
  if (!HASH.test(value)) throw new RoadmapDeliveryError("authority_corrupt", `${label} is not sha256`);
}

function requireDateTime(value: string, label: string): string {
  if (value.trim().length === 0 || Number.isNaN(Date.parse(value))) {
    throw new RoadmapDeliveryError("roadmap_invalid", `${label} is not a date-time`);
  }
  return value;
}
