import type { DurableClaimRecord } from "../../runtime/durable-claim.js";
import type { AuthorityRef, RoadmapDeliveryProjector } from "./authority-core.js";
import type { BuilderEvidenceManifest } from "./builder-evidence-model.js";
import { assertEvidencePlanCurrent } from "./builder-evidence.js";
import { requireAuthority, sameAuthorityRef } from "./authority-store.js";
import { loadDeliveryJoin } from "./delivery-join.js";
import { type DeliveryUnitClaimPayload, deliveryClaimStore, projectClaim } from "./delivery-unit-claims.js";
import { readExecutionUnitJournal, transitionExecutionUnitJournal } from "./execution-journal.js";
import type { ExecutionUnitJournal } from "./execution-journal-model.js";
import { RoadmapDeliveryError } from "./failure.js";
import { assertReviewerVerdictShape, type ReviewerVerdict } from "./reviewer-verdict-model.js";
import { assertCurrentValidationCatalogRef } from "./validation-catalog-authority.js";
import { readCurrentValidationContract } from "./validation-contract-authority.js";
import { assertNonEmpty } from "./validation-values.js";
import { assertValidationWaiversCurrent } from "./validation-waivers.js";

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
