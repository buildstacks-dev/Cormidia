// Durable roadmap-to-delivery authority joins (HB-100 through HB-107).
//
// This module is deliberately provider-free until EpisodePlanner normalization:
// roadmap admission, validation admission, batching, claims, and evidence review
// are deterministic state transitions. A complete creator scope enters the real
// EpisodePlanner coordinator and produces the same durable EpisodePlan as every
// other episode without constructing a runtime.

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  episodePlanHash,
  readCurrentEpisodePlan,
  stableHash,
  type CreatorEpisodeScope,
  type EpisodePlan,
} from "../loop/episode-plan.js";
import {
  durableClaimSettlementId,
  DurableClaimStore,
  type DurableClaimDisposition,
  type DurableClaimRecord,
  type DurableClaimToken,
} from "../runtime/durable-claim.js";
import { withFileLock } from "../runtime/file-lock.js";
import type { RoleConfig, TurnAssignment } from "../runtime/types.js";
import type { AppEntry } from "./apps.js";
import {
  prepareEpisodePlan,
  type EpisodePlannerProposer,
  type PreparedEpisodePlan,
} from "./episode-planner/coordinator.js";
import {
  buildEpisodeIntent,
  type EpisodeIntentFacts,
  type EpisodePlanningPolicyOptions,
} from "./episode-planner/policy.js";
import { planningAppDir } from "./planning-artifact-path.js";
import {
  ROADMAP_DELIVERY_SCHEMA_VERSION,
  assertAuthorityRef,
  assertExactObjectKeys,
  assertHash,
  assertId,
  assertVersion,
  type AcceptedAuthority,
  type AuthorityRef,
  type RoadmapDeliveryProjection,
  type RoadmapDeliveryProjector,
} from "./roadmap-delivery/authority-core.js";
import {
  backlogSnapshotAuthorityPath,
  batchAuthorityPath,
  currentRoadmapPointerPath,
  currentValidationCatalogPointerPath,
  currentValidationContractPointerPath,
  executionUnitJournalPath,
  readinessAuthorityPath,
  roadmapAuthorityPath,
  validationAuthorityPath,
  validationContractLifecyclePath,
} from "./roadmap-delivery/authority-paths.js";
import {
  persistAuthority,
  projectAccepted,
  readAuthorityFile,
  renderAuthorityRef,
  requireAuthority,
  sameAuthorityRef,
} from "./roadmap-delivery/authority-store.js";
import type {
  ValidationAffectedStructure,
  ValidationCatalog,
  ValidationCatalogCase,
} from "./roadmap-delivery/validation-catalog.js";
import { VALIDATION_CONTRACT_SCHEMA } from "./roadmap-delivery/validation-contract-schema.js";
import {
  type ValidationContract,
  type ValidationObligation,
  type ValidationWaiver,
} from "./roadmap-delivery/validation-contract.js";
import {
  acceptValidationCatalog,
  assertCurrentValidationCatalogRef,
  readCurrentValidationCatalog,
} from "./roadmap-delivery/validation-catalog-authority.js";
import { RATIFIED_VALIDATION_CATALOG_CONTENT_SHA256 } from "./roadmap-delivery/validation-catalog-revision.js";
import {
  acceptValidationContract,
  readCurrentValidationContract,
} from "./roadmap-delivery/validation-contract-authority.js";
import { assertValidationContractBaseShape } from "./roadmap-delivery/validation-contract-shape.js";
import { readValidationContractLifecycle } from "./roadmap-delivery/validation-lifecycle.js";
import { assertNonEmpty, requireDateTime } from "./roadmap-delivery/validation-values.js";
import {
  assertValidationWaiverAuthorities,
  assertValidationWaiversCurrent,
  validationWaiverApprovalAction,
} from "./roadmap-delivery/validation-waivers.js";
import {
  acceptBacklogSnapshot,
  deriveBacklogDelta,
  readBacklogSnapshotAuthority,
} from "./roadmap-delivery/backlog-authority.js";
import { RoadmapDeliveryError } from "./roadmap-delivery/failure.js";
import {
  acceptDeliveryUnitReadiness,
  assertDeliveryUnitReadinessShape,
  readCurrentDeliveryUnitReadiness,
  type DeliveryUnitReadiness,
} from "./roadmap-delivery/delivery-readiness.js";
import {
  acceptDirectExecutionUnit,
  assertDirectExecutionUnit,
  type DirectExecutionUnitAuthority,
} from "./roadmap-delivery/direct-execution-authority.js";
import {
  assertNoActiveExecutionUnitOverlap,
  findActiveExecutionUnit,
  listActiveExecutionUnits,
  readExecutionBatch,
} from "./roadmap-delivery/active-execution-units.js";
import {
  ensureExecutionUnitJournal,
  executionBatchDispositionPath,
  readExecutionUnitJournal,
  transitionExecutionUnitJournal,
} from "./roadmap-delivery/execution-journal.js";
import type { ExecutionUnitJournal } from "./roadmap-delivery/execution-journal-model.js";
import {
  assertExecutionBatchShape,
  normalizeExecutionUnitBudget,
  type ExecutionBatch,
  type ExecutionUnit,
  type ExecutionUnitBudget,
} from "./roadmap-delivery/execution-model.js";
import {
  assertRoadmapPlan,
  assertRoutingEligible,
  requireUnit,
  routingSnapshotHash,
  unitMembershipHash,
} from "./roadmap-delivery/roadmap-invariants.js";
import type {
  AcceptedRoadmapPlan,
  BacklogSnapshot,
  BacklogSnapshotIssue,
  RoadmapDeliveryUnit,
  RoadmapIssueMove,
  RoadmapIssueProjection,
  RoadmapPlan,
  RoadmapWorkstream,
  RoutingSnapshotEntry,
} from "./roadmap-delivery/roadmap-model.js";
import {
  ROADMAP_MUTATION_LOCK,
  acceptRoadmapPlan,
  assertCurrentRoadmapRef,
  readCurrentRoadmapPlan,
} from "./roadmap-delivery/roadmap-plan.js";
import { reconcileRoadmapProjections } from "./roadmap-delivery/roadmap-projections.js";

export { RoadmapDeliveryError };
export { ROADMAP_DELIVERY_SCHEMA_VERSION };
export type { AcceptedAuthority, AuthorityRef, RoadmapDeliveryProjection };
export {
  backlogSnapshotAuthorityPath,
  batchAuthorityPath,
  currentRoadmapPointerPath,
  currentValidationCatalogPointerPath,
  currentValidationContractPointerPath,
  executionUnitJournalPath,
  readinessAuthorityPath,
  roadmapAuthorityPath,
  validationAuthorityPath,
  validationContractLifecyclePath,
};
export { VALIDATION_CONTRACT_SCHEMA };
export { RATIFIED_VALIDATION_CATALOG_CONTENT_SHA256 };
export type { ValidationAffectedStructure, ValidationCatalog, ValidationCatalogCase };
export type { ValidationContract, ValidationObligation, ValidationWaiver };
export {
  acceptValidationCatalog,
  acceptValidationContract,
  readCurrentValidationCatalog,
  readCurrentValidationContract,
  readValidationContractLifecycle,
  validationWaiverApprovalAction,
};
export { acceptBacklogSnapshot, acceptRoadmapPlan, deriveBacklogDelta, readBacklogSnapshotAuthority };
export { readCurrentRoadmapPlan, unitMembershipHash };
export { acceptDeliveryUnitReadiness, readCurrentDeliveryUnitReadiness, reconcileRoadmapProjections };
export type { DeliveryUnitReadiness };
export { acceptDirectExecutionUnit };
export type { DirectExecutionUnitAuthority, ExecutionBatch, ExecutionUnit, ExecutionUnitBudget };
export {
  executionBatchDispositionPath,
  findActiveExecutionUnit,
  listActiveExecutionUnits,
  readExecutionBatch,
  readExecutionUnitJournal,
  transitionExecutionUnitJournal,
};
export type { ActiveExecutionUnit } from "./roadmap-delivery/active-execution-units.js";
export type { ExecutionBatchDisposition } from "./roadmap-delivery/execution-journal-model.js";
export type {
  AcceptedRoadmapPlan,
  BacklogSnapshot,
  BacklogSnapshotIssue,
  RoadmapDeliveryUnit,
  RoadmapIssueMove,
  RoadmapIssueProjection,
  RoadmapPlan,
  RoadmapWorkstream,
  RoutingSnapshotEntry,
};

export interface DeliveryEpisodeBinding {
  schemaVersion: typeof ROADMAP_DELIVERY_SCHEMA_VERSION;
  app: string;
  unitId: string;
  membershipHash: string;
  roadmapRef: AuthorityRef;
  readinessRef: AuthorityRef;
  validationRef: AuthorityRef;
  validationContractHash: string;
  batchRef: AuthorityRef;
  episodeId: string;
  episodePlanVersion: number;
  episodePlanHash: string;
  createdAt: string;
}

interface DirectEpisodeBinding {
  schemaVersion: typeof ROADMAP_DELIVERY_SCHEMA_VERSION;
  app: string;
  unitId: string;
  directAuthorityRef: AuthorityRef;
  batchRef: AuthorityRef;
  episodeId: string;
  episodePlanVersion: number;
  episodePlanHash: string;
  createdAt: string;
}

interface DeliveryUnitClaimPayload {
  app: string;
  unitId: string;
  issueNumbers: number[];
  membershipHash: string;
  roadmapRef: AuthorityRef;
  readinessRef: AuthorityRef;
  validationRef: AuthorityRef;
  validationContractHash: string;
  batchRef: AuthorityRef;
  episodeBindingRef: AuthorityRef;
}

export interface DeliveryUnitClaim {
  disposition: DurableClaimDisposition;
  record: DurableClaimRecord<DeliveryUnitClaimPayload>;
  token?: DurableClaimToken;
}

interface CaseEvidence {
  caseId: string;
  detectorId: string;
  negativeControlId: string;
  status: "passed" | "waived";
  waiverId: string | null;
  evidence: string;
}

interface GateEvidence {
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
  readinessRef: AuthorityRef;
  validationRef: AuthorityRef;
  validationContractHash: string;
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
  readinessRef: AuthorityRef;
  validationRef: AuthorityRef;
  validationContractHash: string;
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

type DeliveryEpisodeFacts = Omit<EpisodeIntentFacts, "episodeId" | "app" | "roles" | "creatorScope">;

const CLAIM_NAMESPACE = "planning/delivery-unit-claims";
const DEFAULT_EXECUTION_BATCH_MAX_UNITS = 8;
const DEFAULT_EXECUTION_BATCH_MAX_MANIFEST_BYTES = 64 * 1024;
const CANDIDATE_HEAD = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/;

/** Token-free admission. This function neither builds an EpisodeIntent nor calls EpisodePlanner. */
export async function admitExecutionBatch(input: {
  root: string;
  app: string;
  batchId: string;
  roadmapRef?: AuthorityRef;
  expectedFrontierHash?: string;
  orderedUnitIds?: string[];
  readinessRefs?: AuthorityRef[];
  directUnitRefs?: AuthorityRef[];
  budgetsByUnit?: Readonly<Record<string, ExecutionUnitBudget>>;
  maxUnits?: number;
  maxManifestBytes?: number;
  routing: RoutingSnapshotEntry[];
  admittedAt: string;
  project?: RoadmapDeliveryProjector;
}): Promise<AcceptedAuthority<ExecutionBatch>> {
  assertId(input.batchId, "batch id");
  const orderedUnitIds = input.orderedUnitIds ?? [];
  if (new Set(orderedUnitIds).size !== orderedUnitIds.length) {
    throw new RoadmapDeliveryError("batch_unit_duplicate", "a batch contains a duplicate unit");
  }
  const roadmap =
    input.roadmapRef === undefined
      ? undefined
      : await requireAuthority<RoadmapPlan>(input.root, input.app, input.roadmapRef, "roadmap_plan", "roadmap_missing");
  if (roadmap !== undefined) assertRoadmapPlan(roadmap.value);
  const currentRoadmap = roadmap === undefined ? undefined : await readCurrentRoadmapPlan(input.root, input.app);
  if (roadmap !== undefined && (currentRoadmap === undefined || !sameAuthorityRef(currentRoadmap.ref, roadmap.ref))) {
    throw new RoadmapDeliveryError(
      "frontier_stale",
      `${renderAuthorityRef(roadmap.ref)} is not the current accepted RoadmapPlan`,
    );
  }
  const frontierHash = roadmap === undefined ? null : stableHash(roadmap.value.readyFrontier);
  if (frontierHash !== (input.expectedFrontierHash ?? null)) {
    throw new RoadmapDeliveryError(
      "frontier_stale",
      `expected ${input.expectedFrontierHash ?? "no frontier"}, accepted frontier is ${frontierHash ?? "none"}`,
    );
  }
  if (roadmap === undefined && orderedUnitIds.length > 0) {
    throw new RoadmapDeliveryError("roadmap_missing", "roadmap code units require a RoadmapPlan");
  }
  if (roadmap !== undefined) {
    const positions = new Map(roadmap.value.readyFrontier.map((id, index) => [id, index]));
    const deterministic = [...orderedUnitIds].sort(
      (left, right) =>
        (positions.get(left) ?? Number.MAX_SAFE_INTEGER) - (positions.get(right) ?? Number.MAX_SAFE_INTEGER) ||
        left.localeCompare(right),
    );
    if (stableHash(deterministic) !== stableHash(orderedUnitIds)) {
      throw new RoadmapDeliveryError(
        "batch_hard_constraint_failed",
        "batch code units are not in deterministic accepted-frontier order",
      );
    }
  }
  const readinessByUnit = new Map<string, AcceptedAuthority<DeliveryUnitReadiness>>();
  for (const ref of input.readinessRefs ?? []) {
    const readiness = await requireAuthority<DeliveryUnitReadiness>(
      input.root,
      input.app,
      ref,
      "delivery_unit_readiness",
      "validation_incomplete",
    );
    assertDeliveryUnitReadinessShape(readiness.value);
    if (readinessByUnit.has(readiness.value.unitId)) {
      throw new RoadmapDeliveryError(
        "validation_contract_invalid",
        `multiple readiness records supplied for ${readiness.value.unitId}`,
      );
    }
    readinessByUnit.set(readiness.value.unitId, readiness);
  }
  const validationByUnit = new Map<string, AcceptedAuthority<ValidationContract>>();
  for (const readiness of readinessByUnit.values()) {
    const ref = readiness.value.validationRef;
    const validation = await requireAuthority<ValidationContract>(
      input.root,
      input.app,
      ref,
      "validation_contract",
      "validation_contract_missing",
    );
    assertValidationContractBaseShape(validation.value);
    await assertCurrentValidationCatalogRef(input.root, input.app, validation.value.catalogRef);
    if (validationByUnit.has(validation.value.unitId)) {
      throw new RoadmapDeliveryError(
        "validation_contract_invalid",
        `multiple validation contracts supplied for ${validation.value.unitId}`,
      );
    }
    validationByUnit.set(validation.value.unitId, validation);
  }
  const codeUnits = await Promise.all(
    orderedUnitIds.map(async (unitId): Promise<Exclude<ExecutionUnit, { kind: "direct_operation" }>> => {
      if (roadmap === undefined || frontierHash === null) {
        throw new RoadmapDeliveryError("roadmap_missing", `${unitId} has no RoadmapPlan`);
      }
      if (!roadmap.value.readyFrontier.includes(unitId)) {
        throw new RoadmapDeliveryError(
          "batch_hard_constraint_failed",
          `${unitId} is not in the exact accepted ready frontier`,
        );
      }
      const unit = requireUnit(roadmap.value, unitId);
      assertRoutingEligible(unit, input.routing);
      const readiness = readinessByUnit.get(unitId);
      if (readiness === undefined) {
        throw new RoadmapDeliveryError("validation_incomplete", `${unitId} has no accepted readiness authority`);
      }
      const validation = validationByUnit.get(unitId);
      if (validation === undefined) {
        throw new RoadmapDeliveryError("validation_incomplete", `${unitId} has no accepted validation contract`);
      }
      assertValidationWaiversCurrent(validation.value, input.admittedAt);
      await assertValidationWaiverAuthorities(input.root, validation.value);
      if (!sameAuthorityRef(validation.value.roadmapRef, roadmap.ref)) {
        throw new RoadmapDeliveryError(
          "validation_contract_invalid",
          `${unitId} validation contract belongs to another RoadmapPlan`,
        );
      }
      const membershipHash = unitMembershipHash(unit.issueNumbers);
      const currentValidation =
        validation === undefined ? undefined : await readCurrentValidationContract(input.root, input.app, unitId);
      if (
        validation.value.unitMembershipHash !== membershipHash ||
        readiness.value.membershipHash !== membershipHash ||
        !sameAuthorityRef(readiness.value.roadmapRef, roadmap.ref) ||
        readiness.value.frontierHash !== frontierHash ||
        !sameAuthorityRef(readiness.value.validationRef, validation.ref) ||
        readiness.value.validationContractHash !== validation.ref.sha256 ||
        readiness.value.routingSnapshotHash !== routingSnapshotHash(unit, input.routing) ||
        currentValidation === undefined ||
        !sameAuthorityRef(currentValidation.ref, validation.ref)
      ) {
        throw new RoadmapDeliveryError(
          "validation_contract_stale",
          `${unitId} readiness or validation lineage is stale`,
        );
      }
      return {
        kind: "roadmap_code",
        unitId,
        issueNumbers: [...unit.issueNumbers],
        membershipHash,
        readinessRef: readiness.ref,
        validationRef: validation.ref,
        validationContractHash: validation.ref.sha256,
        priority: unit.priority,
        budget: normalizeExecutionUnitBudget(input.budgetsByUnit?.[unitId]),
      };
    }),
  );
  const directUnits: Array<Extract<ExecutionUnit, { kind: "direct_operation" }>> = [];
  for (const ref of input.directUnitRefs ?? []) {
    const direct = await requireAuthority<DirectExecutionUnitAuthority>(
      input.root,
      input.app,
      ref,
      "direct_execution_unit",
      "direct_unit_incomplete",
    );
    assertDirectExecutionUnit(direct.value);
    if (direct.value.app !== input.app) {
      throw new RoadmapDeliveryError("batch_hard_constraint_failed", "a batch cannot cross apps");
    }
    directUnits.push({
      kind: "direct_operation",
      unitId: direct.value.unitId,
      authorityRef: direct.ref,
      authorityHash: direct.ref.sha256,
      dedupeKey: direct.value.dedupeKey,
      priority: 0,
      budget: normalizeExecutionUnitBudget(input.budgetsByUnit?.[direct.value.unitId] ?? direct.value.admittedBudget),
    });
  }
  directUnits.sort((left, right) => left.priority - right.priority || left.unitId.localeCompare(right.unitId));
  const units: ExecutionUnit[] = [...codeUnits, ...directUnits];
  if (new Set(units.map((unit) => unit.unitId)).size !== units.length) {
    throw new RoadmapDeliveryError("batch_unit_duplicate", "a batch contains a duplicate execution unit");
  }
  if (units.length === 0) {
    throw new RoadmapDeliveryError("batch_hard_constraint_failed", "a batch must contain a unit");
  }
  const maxUnits = input.maxUnits ?? DEFAULT_EXECUTION_BATCH_MAX_UNITS;
  const maxManifestBytes = input.maxManifestBytes ?? DEFAULT_EXECUTION_BATCH_MAX_MANIFEST_BYTES;
  if (!Number.isInteger(maxUnits) || maxUnits <= 0 || units.length > maxUnits) {
    throw new RoadmapDeliveryError(
      "batch_manifest_too_large",
      `batch admits ${units.length} units; maximum is ${maxUnits}`,
    );
  }
  const batch: ExecutionBatch = {
    schemaVersion: ROADMAP_DELIVERY_SCHEMA_VERSION,
    batchId: input.batchId,
    version: 1,
    app: input.app,
    roadmapRef: roadmap?.ref ?? null,
    frontierHash,
    units,
    manifestLimits: { maxUnits, maxManifestBytes },
    admittedAt: requireDateTime(input.admittedAt, "batch admittedAt"),
  };
  if (Buffer.byteLength(JSON.stringify(batch), "utf8") > maxManifestBytes) {
    throw new RoadmapDeliveryError("batch_manifest_too_large", `batch manifest exceeds ${maxManifestBytes} bytes`);
  }
  const accepted = await withFileLock(batchMutationLockPath(input.root, input.app), ROADMAP_MUTATION_LOCK, async () => {
    const existingPath = batchAuthorityPath(input.root, input.app, batch.batchId, batch.version);
    if (existsSync(existingPath)) {
      const existing = await readAuthorityFile<ExecutionBatch>(existingPath);
      const replay = { ...batch, admittedAt: existing.value.admittedAt };
      if (stableHash(existing.value) !== stableHash(replay)) {
        throw new RoadmapDeliveryError("authority_conflict", `batch ${batch.batchId} already differs`);
      }
      for (const unit of units) await ensureExecutionUnitJournal(input.root, existing, unit);
      return existing;
    }
    await assertNoActiveExecutionUnitOverlap(input.root, input.app, units);
    const persisted = await persistAuthority(
      input.root,
      input.app,
      "execution_batch",
      batch.batchId,
      batch.version,
      batch,
    );
    for (const unit of units) await ensureExecutionUnitJournal(input.root, persisted, unit);
    return persisted;
  });
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
  creatorScope?: CreatorEpisodeScope;
  propose?: EpisodePlannerProposer;
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
  assertExecutionBatchShape(batch.value);
  const batchUnit = batch.value.units.find((candidate) => candidate.unitId === input.unitId);
  if (batchUnit === undefined) {
    throw new RoadmapDeliveryError(
      "batch_hard_constraint_failed",
      `${input.unitId} is not admitted in ${batch.value.batchId}`,
    );
  }
  if (batchUnit.kind === "direct_operation") {
    throw new RoadmapDeliveryError(
      "batch_hard_constraint_failed",
      `${input.unitId} is direct work; use normalizeDirectExecutionUnitEpisode`,
    );
  }
  if (batch.value.roadmapRef === null || batch.value.frontierHash === null) {
    throw new RoadmapDeliveryError("roadmap_missing", "roadmap code batch lost roadmap authority");
  }
  const roadmap = await requireAuthority<RoadmapPlan>(
    input.root,
    input.app.name,
    batch.value.roadmapRef,
    "roadmap_plan",
    "roadmap_missing",
  );
  await assertCurrentRoadmapRef(input.root, input.app.name, roadmap.ref, batch.value.frontierHash);
  const unit = requireUnit(roadmap.value, input.unitId);
  const readiness = await requireAuthority<DeliveryUnitReadiness>(
    input.root,
    input.app.name,
    batchUnit.readinessRef,
    "delivery_unit_readiness",
    "validation_incomplete",
  );
  assertDeliveryUnitReadinessShape(readiness.value);
  const validation = await requireAuthority<ValidationContract>(
    input.root,
    input.app.name,
    batchUnit.validationRef,
    "validation_contract",
    "validation_contract_missing",
  );
  assertValidationContractBaseShape(validation.value);
  await assertValidationWaiverAuthorities(input.root, validation.value);
  await assertCurrentValidationCatalogRef(input.root, input.app.name, validation.value.catalogRef);
  const currentValidation = await readCurrentValidationContract(input.root, input.app.name, input.unitId);
  if (
    currentValidation === undefined ||
    !sameAuthorityRef(currentValidation.ref, validation.ref) ||
    !sameAuthorityRef(readiness.value.validationRef, validation.ref) ||
    readiness.value.validationContractHash !== validation.ref.sha256 ||
    batchUnit.validationContractHash !== validation.ref.sha256
  ) {
    throw new RoadmapDeliveryError(
      "validation_contract_stale",
      "EpisodePlan normalization requires the current readiness and validation hash",
    );
  }
  const operationNow = input.now?.() ?? new Date();
  assertValidationWaiversCurrent(validation.value, operationNow);
  const episodeId = `delivery-${stableHash({
    app: input.app.name,
    unitId: input.unitId,
    roadmap: roadmap.ref,
    validation: validation.ref,
  }).slice(0, 32)}`;
  const authorityInputs = [
    renderAuthorityRef(roadmap.ref),
    renderAuthorityRef(readiness.ref),
    renderAuthorityRef(validation.ref),
    renderAuthorityRef(batch.ref),
  ];
  const creatorScope =
    input.creatorScope === undefined ? undefined : bindCreatorScope(input.creatorScope, authorityInputs);
  const intent = buildEpisodeIntent({
    ...input.facts,
    episodeId,
    app: input.app,
    roles: input.roles,
    ...(creatorScope === undefined ? {} : { creatorScope }),
  });
  const prepared = await prepareEpisodePlan({
    root: input.root,
    app: input.app,
    roles: input.roles,
    intent,
    ...(input.providerOperations === undefined ? {} : { providerOperations: input.providerOperations }),
    ...(input.workflowTemplates === undefined ? {} : { workflowTemplates: input.workflowTemplates }),
    ...(input.independentReview === undefined ? {} : { independentReview: input.independentReview }),
    ...(input.propose === undefined ? {} : { propose: input.propose }),
    now: () => operationNow,
  });
  const validationLineage = renderAuthorityRef(validation.ref);
  if (prepared.planningTurnSkipped && !prepared.plan.creatorProvenance?.evidenceRefs.includes(validationLineage)) {
    throw new RoadmapDeliveryError(
      "validation_contract_invalid",
      "EpisodePlan dropped the exact validation-contract ref and hash",
    );
  }
  const bindingValue: DeliveryEpisodeBinding = {
    schemaVersion: ROADMAP_DELIVERY_SCHEMA_VERSION,
    app: input.app.name,
    unitId: input.unitId,
    membershipHash: unitMembershipHash(unit.issueNumbers),
    roadmapRef: roadmap.ref,
    readinessRef: readiness.ref,
    validationRef: validation.ref,
    validationContractHash: validation.ref.sha256,
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
  await markExecutionUnitPlanned(input.root, input.app.name, batch.ref, input.unitId, binding.ref, operationNow);
  await projectAccepted(input.root, input.app.name, binding, input.project);
  return { prepared, plan: prepared.plan, binding };
}

/** Bind an EpisodePlan produced by the production ticket planner to the exact
 * admitted roadmap/validation join. This is the non-shortcut lazy path. */
export async function bindDeliveryUnitEpisodePlan(input: {
  root: string;
  app: string;
  batchRef: AuthorityRef;
  unitId: string;
  plan: EpisodePlan;
  now: Date;
  project?: RoadmapDeliveryProjector;
}): Promise<AcceptedAuthority<DeliveryEpisodeBinding>> {
  const batch = await requireAuthority<ExecutionBatch>(
    input.root,
    input.app,
    input.batchRef,
    "execution_batch",
    "batch_hard_constraint_failed",
  );
  assertExecutionBatchShape(batch.value);
  const batchUnit = batch.value.units.find((candidate) => candidate.unitId === input.unitId);
  if (batchUnit === undefined || batchUnit.kind === "direct_operation") {
    throw new RoadmapDeliveryError("batch_hard_constraint_failed", `${input.unitId} is not admitted code work`);
  }
  if (batch.value.roadmapRef === null || batch.value.frontierHash === null) {
    throw new RoadmapDeliveryError("roadmap_missing", "code batch lost RoadmapPlan lineage");
  }
  const roadmap = await requireAuthority<RoadmapPlan>(
    input.root,
    input.app,
    batch.value.roadmapRef,
    "roadmap_plan",
    "roadmap_missing",
  );
  await assertCurrentRoadmapRef(input.root, input.app, roadmap.ref, batch.value.frontierHash);
  const unit = requireUnit(roadmap.value, input.unitId);
  const readiness = await requireAuthority<DeliveryUnitReadiness>(
    input.root,
    input.app,
    batchUnit.readinessRef,
    "delivery_unit_readiness",
    "validation_incomplete",
  );
  const validation = await requireAuthority<ValidationContract>(
    input.root,
    input.app,
    batchUnit.validationRef,
    "validation_contract",
    "validation_contract_missing",
  );
  assertValidationWaiversCurrent(validation.value, input.now);
  await assertValidationWaiverAuthorities(input.root, validation.value);
  const currentValidation = await readCurrentValidationContract(input.root, input.app, input.unitId);
  if (
    currentValidation === undefined ||
    !sameAuthorityRef(currentValidation.ref, validation.ref) ||
    !sameAuthorityRef(readiness.value.validationRef, validation.ref) ||
    batchUnit.validationContractHash !== validation.ref.sha256
  ) {
    throw new RoadmapDeliveryError("validation_contract_stale", "plan binding uses stale validation authority");
  }
  assertPlanWithinExecutionUnitBudget(input.plan, normalizeExecutionUnitBudget(batchUnit.budget));
  const bindingValue: DeliveryEpisodeBinding = {
    schemaVersion: ROADMAP_DELIVERY_SCHEMA_VERSION,
    app: input.app,
    unitId: input.unitId,
    membershipHash: unitMembershipHash(unit.issueNumbers),
    roadmapRef: roadmap.ref,
    readinessRef: readiness.ref,
    validationRef: validation.ref,
    validationContractHash: validation.ref.sha256,
    batchRef: batch.ref,
    episodeId: input.plan.episodeId,
    episodePlanVersion: input.plan.version,
    episodePlanHash: episodePlanHash(input.plan),
    createdAt: input.plan.createdAt,
  };
  const binding = await persistAuthority(
    input.root,
    input.app,
    "delivery_episode_binding",
    input.unitId,
    input.plan.version,
    bindingValue,
  );
  await markExecutionUnitPlanned(input.root, input.app, batch.ref, input.unitId, binding.ref, input.now);
  await projectAccepted(input.root, input.app, binding, input.project);
  return binding;
}

/** Direct work uses the same EpisodePlanner coordinator but needs no
 * RoadmapPlan. Its accepted authority is itself the complete creator scope,
 * so normalization is necessarily a strict zero-turn path. */
export async function normalizeDirectExecutionUnitEpisode(input: {
  root: string;
  app: AppEntry;
  roles: readonly RoleConfig[];
  batchRef: AuthorityRef;
  unitId: string;
  facts: DeliveryEpisodeFacts;
  providerOperations?: readonly string[];
  workflowTemplates: EpisodePlanningPolicyOptions["workflowTemplates"];
  independentReview?: EpisodePlanningPolicyOptions["independentReview"];
  now?: () => Date;
  project?: RoadmapDeliveryProjector;
}): Promise<{
  prepared: PreparedEpisodePlan;
  plan: EpisodePlan;
  binding: AcceptedAuthority<DirectEpisodeBinding>;
}> {
  const batch = await requireAuthority<ExecutionBatch>(
    input.root,
    input.app.name,
    input.batchRef,
    "execution_batch",
    "batch_hard_constraint_failed",
  );
  assertExecutionBatchShape(batch.value);
  const unit = batch.value.units.find((candidate) => candidate.unitId === input.unitId);
  if (unit === undefined || unit.kind !== "direct_operation") {
    throw new RoadmapDeliveryError("batch_hard_constraint_failed", `${input.unitId} is not direct work`);
  }
  const authority = await requireAuthority<DirectExecutionUnitAuthority>(
    input.root,
    input.app.name,
    unit.authorityRef,
    "direct_execution_unit",
    "direct_unit_incomplete",
  );
  assertDirectExecutionUnit(authority.value);
  const operationNow = input.now?.() ?? new Date();
  const creatorScope: CreatorEpisodeScope = {
    planningDisposition: "execution_ready",
    provenance: {
      ...authority.value.provenance,
      evidenceRefs: [
        ...authority.value.provenance.evidenceRefs,
        renderAuthorityRef(authority.ref),
        renderAuthorityRef(batch.ref),
      ],
    },
    objective: authority.value.objective,
    inScope: [...authority.value.inScope],
    outOfScope: [...authority.value.outOfScope],
    acceptanceCriteria: [...authority.value.acceptanceCriteria],
    expectedArtifacts: structuredClone(authority.value.expectedArtifacts),
    declaredConstraints: structuredClone(authority.value.declaredConstraints),
    safetyFacts: structuredClone(authority.value.safetyFacts),
    ...(authority.value.workflowTemplate === undefined
      ? { steps: structuredClone(authority.value.steps!) }
      : { workflowTemplate: structuredClone(authority.value.workflowTemplate) }),
  };
  const episodeId = `direct-${stableHash({ app: input.app.name, authority: authority.ref }).slice(0, 32)}`;
  const intent = buildEpisodeIntent({
    ...input.facts,
    episodeId,
    app: input.app,
    roles: input.roles,
    requiredSafetyFacts: [
      ...new Map(
        [...input.facts.requiredSafetyFacts, ...authority.value.safetyFacts].map((fact) => [
          stableHash(fact),
          structuredClone(fact),
        ]),
      ).values(),
    ],
    creatorScope,
  });
  const prepared = await prepareEpisodePlan({
    root: input.root,
    app: input.app,
    roles: input.roles,
    intent,
    workflowTemplates: input.workflowTemplates,
    ...(input.providerOperations === undefined ? {} : { providerOperations: input.providerOperations }),
    ...(input.independentReview === undefined ? {} : { independentReview: input.independentReview }),
    now: () => operationNow,
  });
  if (!prepared.planningTurnSkipped || prepared.plannerAttempts !== 0) {
    throw new RoadmapDeliveryError("direct_unit_incomplete", "complete direct authority did not normalize zero-turn");
  }
  assertPlanWithinExecutionUnitBudget(prepared.plan, unit.budget);
  const value: DirectEpisodeBinding = {
    schemaVersion: ROADMAP_DELIVERY_SCHEMA_VERSION,
    app: input.app.name,
    unitId: input.unitId,
    directAuthorityRef: authority.ref,
    batchRef: batch.ref,
    episodeId,
    episodePlanVersion: prepared.plan.version,
    episodePlanHash: episodePlanHash(prepared.plan),
    createdAt: prepared.plan.createdAt,
  };
  const binding = await persistAuthority(
    input.root,
    input.app.name,
    "direct_episode_binding",
    input.unitId,
    prepared.plan.version,
    value,
  );
  await markExecutionUnitPlanned(input.root, input.app.name, batch.ref, input.unitId, binding.ref, operationNow);
  await projectAccepted(input.root, input.app.name, binding, input.project);
  return { prepared, plan: prepared.plan, binding };
}

/** One content-bound claim owns every member. No per-ticket partial claim exists here. */
export async function claimDeliveryUnit(input: {
  root: string;
  app: string;
  episodeBindingRef: AuthorityRef;
  /** Builder-owned current-fact read. The claim boundary invokes this after
   * loading durable authority; a caller cannot pass a stale routing snapshot
   * through as if it were a fresh re-read. */
  readCurrentRouting: (issueNumbers: readonly number[]) => Promise<RoutingSnapshotEntry[]>;
  now: Date;
  project?: RoadmapDeliveryProjector;
}): Promise<DeliveryUnitClaim> {
  const joined = await loadDeliveryJoin(input.root, input.app, input.episodeBindingRef);
  assertValidationWaiversCurrent(joined.validation.value, input.now);
  let currentRouting: RoutingSnapshotEntry[];
  try {
    currentRouting = await input.readCurrentRouting([...joined.unit.issueNumbers]);
  } catch (error) {
    throw new RoadmapDeliveryError(
      "routing_ineligible",
      `Builder could not reread current delivery-unit labels: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  assertRoutingEligible(joined.unit, currentRouting);
  const payload: DeliveryUnitClaimPayload = {
    app: input.app,
    unitId: joined.unit.unitId,
    issueNumbers: [...joined.unit.issueNumbers],
    membershipHash: joined.binding.value.membershipHash,
    roadmapRef: joined.roadmap.ref,
    readinessRef: joined.readiness.ref,
    validationRef: joined.validation.ref,
    validationContractHash: joined.validation.ref.sha256,
    batchRef: joined.batch.ref,
    episodeBindingRef: joined.binding.ref,
  };
  const identity = deliveryClaimIdentity(payload);
  const store = deliveryClaimStore(input.root);
  const claimed = await store.claim({ identity, payload, maxAttempts: 1, now: input.now });
  if (claimed.disposition === "claimed" || claimed.disposition === "recovered_claim") {
    await transitionExecutionUnitJournal({
      root: input.root,
      app: input.app,
      batchRef: joined.batch.ref,
      unitId: joined.unit.unitId,
      expectedStates: ["planning", "claimed"],
      nextState: "claimed",
      episodeBindingRef: joined.binding.ref,
      claimSettlementId: claimed.record.settlement_id,
      now: input.now,
    });
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
  const joined = await loadDeliveryJoin(input.root, input.app, input.claim.record.payload.episodeBindingRef);
  assertValidationWaiversCurrent(joined.validation.value, input.now);
  const record = await deliveryClaimStore(input.root).commit({
    settlementId: input.claim.record.settlement_id,
    attempt: input.claim.record.attempt,
    token: input.claim.token,
    runId: input.runId,
    now: input.now,
  });
  await transitionExecutionUnitJournal({
    root: input.root,
    app: input.app,
    batchRef: joined.batch.ref,
    unitId: joined.unit.unitId,
    expectedStates: ["claimed"],
    nextState: "claimed",
    episodeBindingRef: joined.binding.ref,
    claimSettlementId: record.settlement_id,
    now: input.now,
  });
  await projectClaim(input.root, input.app, record.settlement_id, "delivery_unit_claim_committed", input.project);
  return record;
}

async function markExecutionUnitPlanned(
  root: string,
  app: string,
  batchRef: AuthorityRef,
  unitId: string,
  episodeBindingRef: AuthorityRef,
  now: Date,
): Promise<void> {
  const current = await readExecutionUnitJournal(root, app, batchRef.id, unitId);
  if (
    current?.state === "claimed" &&
    current.episodeBindingRef !== null &&
    sameAuthorityRef(current.episodeBindingRef, episodeBindingRef)
  ) {
    // A committed claim with no provider usage is still a pre-provider
    // recovery point. Replaying the immutable plan/binding must not move the
    // journal backwards or consume another claim allowance.
    return;
  }
  await transitionExecutionUnitJournal({
    root,
    app,
    batchRef,
    unitId,
    expectedStates: ["admitted", "planning"],
    nextState: "planning",
    episodeBindingRef,
    now,
  });
}

export async function recordBuilderEvidence(input: {
  root: string;
  manifest: BuilderEvidenceManifest;
  project?: RoadmapDeliveryProjector;
}): Promise<AcceptedAuthority<BuilderEvidenceManifest>> {
  assertBuilderEvidenceShape(input.manifest);
  const joined = await loadDeliveryJoin(input.root, input.manifest.app, input.manifest.episodeBindingRef);
  assertEvidenceJoin(input.manifest, joined);
  await assertEvidencePlanCurrent(input.root, input.manifest);
  assertValidationWaiversCurrent(joined.validation.value, input.manifest.recordedAt);
  const claim = await deliveryClaimStore(input.root).read(input.manifest.claimSettlementId);
  if (
    claim === undefined ||
    claim.status !== "committed" ||
    claim.attempt !== input.manifest.claimAttempt ||
    claim.payload.unitId !== input.manifest.unitId ||
    claim.payload.membershipHash !== input.manifest.membershipHash ||
    !sameAuthorityRef(claim.payload.readinessRef, input.manifest.readinessRef) ||
    !sameAuthorityRef(claim.payload.validationRef, input.manifest.validationRef) ||
    claim.payload.validationContractHash !== input.manifest.validationContractHash ||
    !sameAuthorityRef(claim.payload.episodeBindingRef, input.manifest.episodeBindingRef)
  ) {
    throw new RoadmapDeliveryError(
      "builder_evidence_missing",
      "builder evidence has no matching committed all-member claim",
    );
  }
  assertValidationEvidenceComplete(input.manifest, joined.validation.value, input.manifest.recordedAt);
  const accepted = await persistAuthority(
    input.root,
    input.manifest.app,
    "builder_evidence",
    input.manifest.unitId,
    input.manifest.episodePlanVersion,
    input.manifest,
  );
  await projectAccepted(input.root, input.manifest.app, accepted, input.project);
  return accepted;
}

export function assertReviewerVerdictAdmissible(input: {
  verdict: ReviewerVerdict;
  evidence: AcceptedAuthority<BuilderEvidenceManifest>;
  validation: AcceptedAuthority<ValidationContract>;
  at?: Date | string;
}): void {
  const { verdict, evidence, validation } = input;
  assertReviewerVerdictShape(verdict);
  assertBuilderEvidenceShape(evidence.value);
  assertValidationContractBaseShape(validation.value);
  assertValidationWaiversCurrent(validation.value, input.at);
  if (
    verdict.unitId !== evidence.value.unitId ||
    verdict.membershipHash !== evidence.value.membershipHash ||
    !sameAuthorityRef(verdict.roadmapRef, evidence.value.roadmapRef) ||
    !sameAuthorityRef(verdict.readinessRef, evidence.value.readinessRef) ||
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
    verdict.validationContractHash !== validation.ref.sha256 ||
    evidence.value.validationContractHash !== validation.ref.sha256 ||
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
      .filter((obligation) => obligation.waiver === null)
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
  assertValidationContractBaseShape(validation.value);
  const joined = await loadDeliveryJoin(input.root, input.verdict.app, input.verdict.episodeBindingRef);
  assertEvidenceJoin(evidence.value, joined);
  await assertEvidencePlanCurrent(input.root, evidence.value);
  const currentValidation = await readCurrentValidationContract(input.root, input.verdict.app, input.verdict.unitId);
  if (currentValidation === undefined || !sameAuthorityRef(currentValidation.ref, validation.ref)) {
    throw new RoadmapDeliveryError(
      "validation_contract_stale",
      "Reviewer verdict does not bind the current validation contract",
    );
  }
  await assertCurrentValidationCatalogRef(input.root, input.verdict.app, validation.value.catalogRef);
  assertReviewerVerdictAdmissible({
    verdict: input.verdict,
    evidence,
    validation,
    at: input.verdict.recordedAt,
  });
  const accepted = await persistAuthority(
    input.root,
    input.verdict.app,
    "reviewer_verdict",
    input.verdict.unitId,
    evidence.ref.version,
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
  validationContractHash: string;
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
  assertReviewerVerdictShape(verdict.value);
  const joined =
    claim === undefined ? undefined : await loadDeliveryJoin(input.root, input.app, claim.payload.episodeBindingRef);
  const builderEvidence = await requireAuthority<BuilderEvidenceManifest>(
    input.root,
    input.app,
    verdict.value.builderEvidenceRef,
    "builder_evidence",
    "builder_evidence_missing",
  );
  await assertEvidencePlanCurrent(input.root, builderEvidence.value);
  if (
    claim === undefined ||
    verdict.value.disposition !== input.outcome ||
    verdict.value.unitId !== claim.payload.unitId ||
    verdict.value.membershipHash !== claim.payload.membershipHash ||
    !sameAuthorityRef(verdict.value.roadmapRef, claim.payload.roadmapRef) ||
    !sameAuthorityRef(verdict.value.readinessRef, claim.payload.readinessRef) ||
    !sameAuthorityRef(verdict.value.validationRef, claim.payload.validationRef) ||
    verdict.value.validationContractHash !== claim.payload.validationContractHash ||
    input.validationContractHash !== claim.payload.validationContractHash ||
    !sameAuthorityRef(verdict.value.episodeBindingRef, claim.payload.episodeBindingRef)
  ) {
    throw new RoadmapDeliveryError(
      "reviewer_evidence_incomplete",
      "claim settlement has no exact matching independent Reviewer verdict",
    );
  }
  if (joined === undefined) {
    throw new RoadmapDeliveryError("reviewer_evidence_incomplete", "claim settlement has no delivery join");
  }
  assertValidationWaiversCurrent(joined.validation.value, input.now);
  const currentValidation = await readCurrentValidationContract(input.root, input.app, claim.payload.unitId);
  if (
    currentValidation === undefined ||
    !sameAuthorityRef(currentValidation.ref, claim.payload.validationRef) ||
    currentValidation.ref.sha256 !== input.validationContractHash
  ) {
    throw new RoadmapDeliveryError(
      "validation_contract_stale",
      "settlement does not bind the current validation contract",
    );
  }
  await assertCurrentValidationCatalogRef(input.root, input.app, currentValidation.value.catalogRef);
  const record = await store.settle({
    settlementId: input.claimSettlementId,
    attempt: input.claimAttempt,
    runId: input.runId,
    outcome: input.outcome,
    now: input.now,
  });
  await transitionExecutionUnitJournal({
    root: input.root,
    app: input.app,
    batchRef: joined.batch.ref,
    unitId: joined.unit.unitId,
    expectedStates: ["running", "reviewing", "approved", "returned"],
    nextState: input.outcome === "approved" ? "approved" : "returned",
    evidenceRefs: [builderEvidence.ref, verdict.ref],
    candidateHead: verdict.value.candidateHead,
    pullRequestNumber: builderEvidence.value.pullRequestNumber,
    ...(input.outcome === "returned" ? { outcome: "returned" as const } : {}),
    now: input.now,
  });
  await projectClaim(input.root, input.app, record.settlement_id, "delivery_unit_settled", input.project);
  return record;
}

export async function completeDeliveryUnitMerge(input: {
  root: string;
  app: string;
  batchRef: AuthorityRef;
  unitId: string;
  candidateHead: string;
  pullRequestNumber: number;
  now: Date;
}): Promise<ExecutionUnitJournal> {
  const journal = await readExecutionUnitJournal(input.root, input.app, input.batchRef.id, input.unitId);
  if (
    journal === undefined ||
    journal.state !== "approved" ||
    journal.candidateHead !== input.candidateHead ||
    journal.pullRequestNumber !== input.pullRequestNumber ||
    journal.evidenceRefs.length < 2
  ) {
    throw new RoadmapDeliveryError(
      "reviewer_evidence_incomplete",
      "merge completion requires exact-HEAD Builder evidence and Reviewer verdict",
    );
  }
  return transitionExecutionUnitJournal({
    root: input.root,
    app: input.app,
    batchRef: input.batchRef,
    unitId: input.unitId,
    expectedStates: ["approved"],
    nextState: "completed",
    candidateHead: input.candidateHead,
    pullRequestNumber: input.pullRequestNumber,
    outcome: "completed",
    now: input.now,
  });
}

export async function settleDeliveryUnitRefusal(input: {
  root: string;
  app: string;
  claimSettlementId: string;
  claimAttempt: number;
  runId: string;
  batchRef: AuthorityRef;
  unitId: string;
  reason: string;
  now: Date;
}): Promise<void> {
  assertNonEmpty(input.reason, "delivery refusal reason");
  await deliveryClaimStore(input.root).settle({
    settlementId: input.claimSettlementId,
    attempt: input.claimAttempt,
    runId: input.runId,
    outcome: "returned",
    now: input.now,
  });
  await transitionExecutionUnitJournal({
    root: input.root,
    app: input.app,
    batchRef: input.batchRef,
    unitId: input.unitId,
    expectedStates: ["claimed", "running", "reviewing", "approved"],
    nextState: "returned",
    outcome: "returned",
    now: input.now,
  });
}

export function deliveryClaimRecordPath(root: string, identity: string): string {
  const settlementId = durableClaimSettlementId(identity);
  return join(resolve(root), CLAIM_NAMESPACE, "records", `${settlementId}.json`);
}

export async function readDeliveryUnitClaim(
  root: string,
  settlementId: string,
): Promise<DurableClaimRecord<DeliveryUnitClaimPayload> | undefined> {
  return deliveryClaimStore(root).read(settlementId);
}

export function deliveryClaimIdentity(payload: DeliveryUnitClaimPayload): string {
  return [
    "roadmap-delivery-unit/v1",
    payload.app,
    payload.unitId,
    payload.membershipHash,
    payload.roadmapRef.sha256,
    payload.readinessRef.sha256,
    payload.validationRef.sha256,
    payload.validationContractHash,
    payload.batchRef.sha256,
    payload.episodeBindingRef.sha256,
  ].join("\0");
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
  assertDeliveryEpisodeBindingShape(binding.value);
  const roadmap = await requireAuthority<RoadmapPlan>(
    root,
    app,
    binding.value.roadmapRef,
    "roadmap_plan",
    "roadmap_missing",
  );
  const readiness = await requireAuthority<DeliveryUnitReadiness>(
    root,
    app,
    binding.value.readinessRef,
    "delivery_unit_readiness",
    "validation_incomplete",
  );
  assertDeliveryUnitReadinessShape(readiness.value);
  const validation = await requireAuthority<ValidationContract>(
    root,
    app,
    binding.value.validationRef,
    "validation_contract",
    "validation_contract_missing",
  );
  assertValidationContractBaseShape(validation.value);
  await assertValidationWaiverAuthorities(root, validation.value);
  await assertCurrentValidationCatalogRef(root, app, validation.value.catalogRef);
  const batch = await requireAuthority<ExecutionBatch>(
    root,
    app,
    binding.value.batchRef,
    "execution_batch",
    "batch_hard_constraint_failed",
  );
  assertExecutionBatchShape(batch.value);
  if (batch.value.roadmapRef === null || batch.value.frontierHash === null) {
    throw new RoadmapDeliveryError("evidence_unit_mismatch", "code delivery binding points at a direct-only batch");
  }
  await assertCurrentRoadmapRef(root, app, roadmap.ref, batch.value.frontierHash);
  const unit = requireUnit(roadmap.value, binding.value.unitId);
  const currentValidation = await readCurrentValidationContract(root, app, unit.unitId);
  if (
    binding.value.membershipHash !== unitMembershipHash(unit.issueNumbers) ||
    !sameAuthorityRef(readiness.value.roadmapRef, roadmap.ref) ||
    !sameAuthorityRef(readiness.value.validationRef, validation.ref) ||
    readiness.value.validationContractHash !== validation.ref.sha256 ||
    !sameAuthorityRef(binding.value.readinessRef, readiness.ref) ||
    binding.value.validationContractHash !== validation.ref.sha256 ||
    !sameAuthorityRef(validation.value.roadmapRef, roadmap.ref) ||
    currentValidation === undefined ||
    !sameAuthorityRef(currentValidation.ref, validation.ref) ||
    !batch.value.units.some(
      (entry) =>
        entry.kind !== "direct_operation" &&
        entry.unitId === unit.unitId &&
        entry.membershipHash === binding.value.membershipHash &&
        sameAuthorityRef(entry.readinessRef, readiness.ref) &&
        sameAuthorityRef(entry.validationRef, validation.ref) &&
        entry.validationContractHash === validation.ref.sha256,
    )
  ) {
    throw new RoadmapDeliveryError(
      "evidence_unit_mismatch",
      "delivery episode binding does not reproduce its roadmap, validation, and batch lineage",
    );
  }
  return { binding, roadmap, readiness, validation, batch, unit };
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
    !sameAuthorityRef(manifest.readinessRef, joined.readiness.ref) ||
    !sameAuthorityRef(manifest.validationRef, joined.validation.ref) ||
    manifest.validationContractHash !== joined.validation.ref.sha256 ||
    !sameAuthorityRef(manifest.batchRef, joined.batch.ref) ||
    !sameAuthorityRef(manifest.episodeBindingRef, joined.binding.ref) ||
    manifest.episodeId !== joined.binding.value.episodeId ||
    manifest.episodePlanVersion < joined.binding.value.episodePlanVersion
  ) {
    throw new RoadmapDeliveryError(
      "evidence_unit_mismatch",
      "Builder evidence does not bind the exact accepted unit/plan lineage",
    );
  }
}

async function assertEvidencePlanCurrent(
  root: string,
  manifest: Pick<BuilderEvidenceManifest, "episodeId" | "episodePlanVersion" | "episodePlanHash">,
): Promise<void> {
  const current = await readCurrentEpisodePlan(root, manifest.episodeId);
  if (
    current === undefined ||
    current.version !== manifest.episodePlanVersion ||
    episodePlanHash(current) !== manifest.episodePlanHash
  ) {
    throw new RoadmapDeliveryError(
      "evidence_unit_mismatch",
      "Builder evidence does not bind the current accepted delivery EpisodePlan",
    );
  }
}

function assertPlanWithinExecutionUnitBudget(plan: EpisodePlan, budget: ExecutionUnitBudget): void {
  const humanDecisions = plan.steps.filter((step) => step.kind === "approval").length;
  if (
    plan.estimatedBudget.providerTurns > budget.maxProviderTurns ||
    plan.estimatedBudget.providerTurnBudgetUsd > budget.maxEquivalentCostUsd ||
    plan.estimatedBudget.mechanicalOverheadUsd > budget.maxMechanicalOverheadUsd ||
    humanDecisions > budget.maxHumanDecisions
  ) {
    throw new RoadmapDeliveryError(
      "unit_budget_exhausted",
      `EpisodePlan ${plan.episodeId}@${plan.version} exceeds the admitted unit budget`,
    );
  }
}

export function assertValidationEvidenceComplete(
  manifest: Pick<BuilderEvidenceManifest, "cases" | "gates">,
  contract: ValidationContract,
  at?: Date | string,
): void {
  assertValidationWaiversCurrent(contract, at);
  const cases = new Map(manifest.cases.map((entry) => [entry.caseId, entry]));
  for (const obligation of contract.obligations) {
    const evidence = cases.get(obligation.caseId);
    const expectedStatus = obligation.waiver === null ? "passed" : "waived";
    const expectedWaiverId = obligation.waiver?.waiverId ?? null;
    if (
      evidence === undefined ||
      evidence.detectorId !== obligation.detectorId ||
      evidence.negativeControlId !== obligation.negativeControlId ||
      evidence.status !== expectedStatus ||
      evidence.waiverId !== expectedWaiverId ||
      typeof evidence.evidence !== "string" ||
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
      .filter(
        (entry) => entry.status === "passed" && typeof entry.evidence === "string" && entry.evidence.trim().length > 0,
      )
      .map((entry) => entry.gate),
  );
  const missingGates = contract.requiredGates.filter((gate) => !gates.has(gate));
  if (missingGates.length > 0) {
    throw new RoadmapDeliveryError("builder_evidence_missing", `missing gate evidence for ${missingGates.join(", ")}`);
  }
}

function bindCreatorScope(scope: CreatorEpisodeScope, authorityInputs: readonly string[]): CreatorEpisodeScope {
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
            inputRefs:
              step.dependsOn.length === 0
                ? uniqueInputRefs([...step.inputRefs, ...inputs])
                : structuredClone(step.inputRefs),
          })),
        }),
  };
}

function uniqueInputRefs(refs: Array<{ ref: string; required: boolean }>): Array<{ ref: string; required: boolean }> {
  const byRef = new Map<string, { ref: string; required: boolean }>();
  for (const ref of refs) {
    const existing = byRef.get(ref.ref);
    byRef.set(ref.ref, { ref: ref.ref, required: ref.required || existing?.required === true });
  }
  return [...byRef.values()].sort((left, right) => left.ref.localeCompare(right.ref));
}

function assertDeliveryEpisodeBindingShape(binding: DeliveryEpisodeBinding): void {
  assertExactObjectKeys(
    binding,
    [
      "schemaVersion",
      "app",
      "unitId",
      "membershipHash",
      "roadmapRef",
      "readinessRef",
      "validationRef",
      "validationContractHash",
      "batchRef",
      "episodeId",
      "episodePlanVersion",
      "episodePlanHash",
      "createdAt",
    ],
    "delivery episode binding",
    "evidence_unit_mismatch",
  );
  if (binding.schemaVersion !== ROADMAP_DELIVERY_SCHEMA_VERSION) {
    throw new RoadmapDeliveryError("evidence_unit_mismatch", "unsupported delivery binding schema");
  }
  assertNonEmpty(binding.app, "delivery binding app");
  assertId(binding.unitId, "delivery binding unit id");
  assertHash(binding.membershipHash, "delivery binding membership hash");
  assertAuthorityRef(binding.roadmapRef, "roadmap_plan");
  assertAuthorityRef(binding.readinessRef, "delivery_unit_readiness");
  assertAuthorityRef(binding.validationRef, "validation_contract");
  assertHash(binding.validationContractHash, "delivery binding validation-contract hash");
  assertAuthorityRef(binding.batchRef, "execution_batch");
  assertNonEmpty(binding.episodeId, "delivery binding episode id");
  assertVersion(binding.episodePlanVersion, "delivery binding EpisodePlan version");
  assertHash(binding.episodePlanHash, "delivery binding EpisodePlan hash");
  requireDateTime(binding.createdAt, "delivery binding createdAt");
  if (binding.validationContractHash !== binding.validationRef.sha256) {
    throw new RoadmapDeliveryError("evidence_unit_mismatch", "delivery binding validation hash differs");
  }
}

function assertBuilderEvidenceShape(manifest: BuilderEvidenceManifest): void {
  assertExactObjectKeys(
    manifest,
    [
      "schemaVersion",
      "app",
      "unitId",
      "issueNumbers",
      "membershipHash",
      "roadmapRef",
      "readinessRef",
      "validationRef",
      "validationContractHash",
      "batchRef",
      "episodeBindingRef",
      "episodeId",
      "episodePlanVersion",
      "episodePlanHash",
      "claimSettlementId",
      "claimAttempt",
      "repository",
      "baseRevision",
      "candidateHead",
      "pullRequestNumber",
      "pullRequestUrl",
      "builderRole",
      "builderAssignment",
      "builderSessionId",
      "cases",
      "gates",
      "recordedAt",
    ],
    "Builder evidence",
    "builder_evidence_missing",
  );
  if (manifest.schemaVersion !== ROADMAP_DELIVERY_SCHEMA_VERSION) {
    throw new RoadmapDeliveryError("builder_evidence_missing", "unsupported evidence schema");
  }
  assertId(manifest.unitId, "evidence unit id");
  assertHash(manifest.membershipHash, "evidence membership hash");
  assertAuthorityRef(manifest.roadmapRef, "roadmap_plan");
  assertAuthorityRef(manifest.readinessRef, "delivery_unit_readiness");
  assertAuthorityRef(manifest.validationRef, "validation_contract");
  assertAuthorityRef(manifest.batchRef, "execution_batch");
  assertAuthorityRef(manifest.episodeBindingRef, "delivery_episode_binding");
  assertHash(manifest.validationContractHash, "evidence validation-contract hash");
  assertHash(manifest.episodePlanHash, "EpisodePlan hash");
  if (!CANDIDATE_HEAD.test(manifest.candidateHead)) {
    throw new RoadmapDeliveryError("evidence_head_mismatch", "candidate HEAD is not a full git object id");
  }
  if (
    !Array.isArray(manifest.issueNumbers) ||
    manifest.issueNumbers.length === 0 ||
    manifest.issueNumbers.some((issueNumber) => !Number.isSafeInteger(issueNumber) || issueNumber < 1) ||
    new Set(manifest.issueNumbers).size !== manifest.issueNumbers.length ||
    !Array.isArray(manifest.cases) ||
    !Array.isArray(manifest.gates) ||
    typeof manifest.app !== "string" ||
    manifest.app.trim().length === 0 ||
    typeof manifest.episodeId !== "string" ||
    manifest.episodeId.trim().length === 0 ||
    !Number.isSafeInteger(manifest.episodePlanVersion) ||
    manifest.episodePlanVersion < 1 ||
    typeof manifest.claimSettlementId !== "string" ||
    manifest.claimSettlementId.trim().length === 0 ||
    !Number.isSafeInteger(manifest.claimAttempt) ||
    manifest.claimAttempt < 1 ||
    !Number.isInteger(manifest.pullRequestNumber) ||
    manifest.pullRequestNumber < 1 ||
    typeof manifest.pullRequestUrl !== "string" ||
    manifest.pullRequestUrl.trim().length === 0 ||
    typeof manifest.builderRole !== "string" ||
    manifest.builderRole.trim().length === 0 ||
    typeof manifest.builderSessionId !== "string" ||
    manifest.builderSessionId.trim().length === 0 ||
    typeof manifest.repository !== "string" ||
    manifest.repository.trim().length === 0 ||
    typeof manifest.baseRevision !== "string" ||
    manifest.baseRevision.trim().length === 0 ||
    manifest.cases.length === 0 ||
    manifest.gates.length === 0 ||
    manifest.validationContractHash !== manifest.validationRef.sha256 ||
    new Set(manifest.cases.map((entry) => entry.caseId)).size !== manifest.cases.length
  ) {
    throw new RoadmapDeliveryError("builder_evidence_missing", "Builder evidence is structurally incomplete");
  }
  assertTurnAssignmentShape(manifest.builderAssignment, "Builder assignment", "builder_evidence_missing");
  for (const evidence of manifest.cases) {
    assertExactObjectKeys(
      evidence,
      ["caseId", "detectorId", "negativeControlId", "status", "waiverId", "evidence"],
      "Builder case evidence",
      "builder_evidence_missing",
    );
    if (
      typeof evidence.caseId !== "string" ||
      evidence.caseId.trim().length === 0 ||
      typeof evidence.detectorId !== "string" ||
      evidence.detectorId.trim().length === 0 ||
      typeof evidence.negativeControlId !== "string" ||
      evidence.negativeControlId.trim().length === 0 ||
      (evidence.status !== "passed" && evidence.status !== "waived") ||
      (evidence.waiverId !== null &&
        (typeof evidence.waiverId !== "string" || evidence.waiverId.trim().length === 0)) ||
      typeof evidence.evidence !== "string" ||
      evidence.evidence.trim().length === 0
    ) {
      throw new RoadmapDeliveryError("builder_evidence_missing", "Builder case evidence is incomplete");
    }
  }
  for (const evidence of manifest.gates) {
    assertExactObjectKeys(
      evidence,
      ["gate", "status", "evidence"],
      "Builder gate evidence",
      "builder_evidence_missing",
    );
    if (
      typeof evidence.gate !== "string" ||
      evidence.gate.trim().length === 0 ||
      evidence.status !== "passed" ||
      typeof evidence.evidence !== "string" ||
      evidence.evidence.trim().length === 0
    ) {
      throw new RoadmapDeliveryError("builder_evidence_missing", "Builder gate evidence is incomplete");
    }
  }
  requireDateTime(manifest.recordedAt, "Builder evidence recordedAt");
}

function assertReviewerVerdictShape(verdict: ReviewerVerdict): void {
  assertExactObjectKeys(
    verdict,
    [
      "schemaVersion",
      "app",
      "unitId",
      "membershipHash",
      "roadmapRef",
      "readinessRef",
      "validationRef",
      "validationContractHash",
      "episodeBindingRef",
      "builderEvidenceRef",
      "candidateHead",
      "reviewerRole",
      "reviewerAssignment",
      "reviewerSessionId",
      "disposition",
      "evidenceAccepted",
      "reproducedCaseIds",
      "rationale",
      "recordedAt",
    ],
    "Reviewer verdict",
    "reviewer_evidence_incomplete",
  );
  if (verdict.schemaVersion !== ROADMAP_DELIVERY_SCHEMA_VERSION) {
    throw new RoadmapDeliveryError("reviewer_evidence_incomplete", "unsupported Reviewer verdict schema");
  }
  assertId(verdict.unitId, "review unit id");
  assertHash(verdict.membershipHash, "review membership hash");
  assertAuthorityRef(verdict.roadmapRef, "roadmap_plan");
  assertAuthorityRef(verdict.readinessRef, "delivery_unit_readiness");
  assertAuthorityRef(verdict.validationRef, "validation_contract");
  assertAuthorityRef(verdict.episodeBindingRef, "delivery_episode_binding");
  assertAuthorityRef(verdict.builderEvidenceRef, "builder_evidence");
  assertHash(verdict.validationContractHash, "review validation-contract hash");
  if (
    !CANDIDATE_HEAD.test(verdict.candidateHead) ||
    typeof verdict.reviewerRole !== "string" ||
    verdict.reviewerRole.trim().length === 0 ||
    typeof verdict.reviewerSessionId !== "string" ||
    verdict.reviewerSessionId.trim().length === 0 ||
    typeof verdict.rationale !== "string" ||
    verdict.rationale.trim().length === 0 ||
    !Array.isArray(verdict.reproducedCaseIds) ||
    verdict.reproducedCaseIds.some((caseId) => typeof caseId !== "string" || caseId.trim().length === 0) ||
    new Set(verdict.reproducedCaseIds).size !== verdict.reproducedCaseIds.length ||
    (verdict.disposition !== "approved" && verdict.disposition !== "returned") ||
    typeof verdict.evidenceAccepted !== "boolean" ||
    verdict.validationContractHash !== verdict.validationRef.sha256
  ) {
    throw new RoadmapDeliveryError("reviewer_evidence_incomplete", "Reviewer verdict is structurally incomplete");
  }
  assertTurnAssignmentShape(verdict.reviewerAssignment, "Reviewer assignment", "reviewer_evidence_incomplete");
  requireDateTime(verdict.recordedAt, "Reviewer verdict recordedAt");
}

function batchMutationLockPath(root: string, app: string): string {
  return join(planningAppDir(root, app), "execution-batch.lock");
}

function claimRecordPath(root: string, settlementId: string): string {
  return join(resolve(root), CLAIM_NAMESPACE, "records", `${settlementId}.json`);
}

async function projectClaim(
  root: string,
  app: string,
  settlementId: string,
  kind: Extract<
    RoadmapDeliveryProjection["kind"],
    "delivery_unit_claimed" | "delivery_unit_claim_committed" | "delivery_unit_settled"
  >,
  project?: RoadmapDeliveryProjector,
): Promise<void> {
  if (project === undefined) return;
  const path = claimRecordPath(root, settlementId);
  if (!existsSync(path)) {
    throw new RoadmapDeliveryError("authority_corrupt", `claim projection preceded persistence: ${path}`);
  }
  await project({ kind, app, path, settlementId });
}

function sameAssignment(left: TurnAssignment, right: TurnAssignment): boolean {
  return left.harness === right.harness && left.model === right.model && left.effort === right.effort;
}

function assertTurnAssignmentShape(
  assignment: unknown,
  label: string,
  code: RoadmapDeliveryError["code"],
): asserts assignment is TurnAssignment {
  assertExactObjectKeys(assignment, ["harness", "model", "effort"], label, code);
  const row = assignment as Record<string, unknown>;
  if (
    !["claude", "codex", "pi"].includes(String(row["harness"])) ||
    typeof row["model"] !== "string" ||
    row["model"].trim().length === 0 ||
    !["low", "medium", "high", "xhigh", "max"].includes(String(row["effort"]))
  ) {
    throw new RoadmapDeliveryError(code, `${label} is invalid`);
  }
}
