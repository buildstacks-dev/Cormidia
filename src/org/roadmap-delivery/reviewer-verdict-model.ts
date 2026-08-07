import type { TurnAssignment } from "../../runtime/types.js";
import {
  ROADMAP_DELIVERY_SCHEMA_VERSION,
  assertAuthorityRef,
  assertExactObjectKeys,
  assertHash,
  assertId,
  type AuthorityRef,
} from "./authority-core.js";
import { assertTurnAssignmentShape } from "./builder-evidence-model.js";
import { RoadmapDeliveryError } from "./failure.js";
import { requireDateTime } from "./validation-values.js";

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

export function assertReviewerVerdictShape(verdict: ReviewerVerdict): void {
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

export function sameAssignment(left: TurnAssignment, right: TurnAssignment): boolean {
  return left.harness === right.harness && left.model === right.model && left.effort === right.effort;
}
