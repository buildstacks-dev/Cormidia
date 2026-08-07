import { type AcceptedAuthority, type RoadmapDeliveryProjector } from "./authority-core.js";
import { persistAuthority, projectAccepted, requireAuthority, sameAuthorityRef } from "./authority-store.js";
import { assertBuilderEvidenceShape, type BuilderEvidenceManifest } from "./builder-evidence-model.js";
import { assertEvidenceJoin, assertEvidencePlanCurrent } from "./builder-evidence.js";
import { loadDeliveryJoin } from "./delivery-join.js";
import { RoadmapDeliveryError } from "./failure.js";
import { assertReviewerVerdictShape, type ReviewerVerdict, sameAssignment } from "./reviewer-verdict-model.js";
import { assertCurrentValidationCatalogRef } from "./validation-catalog-authority.js";
import type { ValidationContract } from "./validation-contract.js";
import { readCurrentValidationContract } from "./validation-contract-authority.js";
import { assertValidationContractBaseShape } from "./validation-contract-shape.js";
import { assertValidationWaiversCurrent } from "./validation-waivers.js";

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
