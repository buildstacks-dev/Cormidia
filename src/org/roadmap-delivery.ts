// Durable roadmap-to-delivery authority joins (HB-100 through HB-107).
//
// This module is deliberately provider-free until EpisodePlanner normalization:
// roadmap admission, validation admission, batching, claims, and evidence review
// are deterministic state transitions. A complete creator scope enters the real
// EpisodePlanner coordinator and produces the same durable EpisodePlan as every
// other episode without constructing a runtime.

import { episodePlanHash, readCurrentEpisodePlan, stableHash } from "../loop/episode-plan.js";
import type { DurableClaimRecord } from "../runtime/durable-claim.js";
import type { TurnAssignment } from "../runtime/types.js";
import {
  ROADMAP_DELIVERY_SCHEMA_VERSION,
  assertAuthorityRef,
  assertExactObjectKeys,
  assertHash,
  assertId,
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
  readCurrentDeliveryUnitReadiness,
  type DeliveryUnitReadiness,
} from "./roadmap-delivery/delivery-readiness.js";
import {
  acceptDirectExecutionUnit,
  type DirectExecutionUnitAuthority,
} from "./roadmap-delivery/direct-execution-authority.js";
import {
  findActiveExecutionUnit,
  listActiveExecutionUnits,
  readExecutionBatch,
} from "./roadmap-delivery/active-execution-units.js";
import { admitExecutionBatch } from "./roadmap-delivery/execution-batch-admission.js";
import { bindDeliveryUnitEpisodePlan } from "./roadmap-delivery/delivery-episode-binding.js";
import { normalizeDeliveryUnitEpisode } from "./roadmap-delivery/delivery-episode-normalization.js";
import { loadDeliveryJoin, type DeliveryEpisodeBinding } from "./roadmap-delivery/delivery-join.js";
import {
  claimDeliveryUnit,
  commitDeliveryUnitClaim,
  deliveryClaimIdentity,
  deliveryClaimRecordPath,
  deliveryClaimStore,
  type DeliveryUnitClaim,
  type DeliveryUnitClaimPayload,
  projectClaim,
  readDeliveryUnitClaim,
} from "./roadmap-delivery/delivery-unit-claims.js";
import { normalizeDirectExecutionUnitEpisode } from "./roadmap-delivery/direct-episode-normalization.js";
import {
  executionBatchDispositionPath,
  readExecutionUnitJournal,
  transitionExecutionUnitJournal,
} from "./roadmap-delivery/execution-journal.js";
import type { ExecutionUnitJournal } from "./roadmap-delivery/execution-journal-model.js";
import {
  type ExecutionBatch,
  type ExecutionUnit,
  type ExecutionUnitBudget,
} from "./roadmap-delivery/execution-model.js";
import { unitMembershipHash } from "./roadmap-delivery/roadmap-invariants.js";
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
import { acceptRoadmapPlan, readCurrentRoadmapPlan } from "./roadmap-delivery/roadmap-plan.js";
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
export { admitExecutionBatch };
export { bindDeliveryUnitEpisodePlan, normalizeDeliveryUnitEpisode, normalizeDirectExecutionUnitEpisode };
export {
  claimDeliveryUnit,
  commitDeliveryUnitClaim,
  deliveryClaimIdentity,
  deliveryClaimRecordPath,
  readDeliveryUnitClaim,
};
export type { DeliveryEpisodeBinding, DeliveryUnitClaim };
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

const CANDIDATE_HEAD = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/;

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
