import { TURN_ASSIGNMENT_EFFORTS, TURN_ASSIGNMENT_HARNESSES } from "../../runtime/assignment.js";
import type { TurnAssignment } from "../../runtime/types.js";
import {
  ROADMAP_DELIVERY_SCHEMA_VERSION,
  assertAuthorityRef,
  assertExactObjectKeys,
  assertHash,
  assertId,
  type AuthorityRef,
} from "./authority-core.js";
import { RoadmapDeliveryError } from "./failure.js";
import { requireDateTime } from "./validation-values.js";

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

const CANDIDATE_HEAD = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/;

export function assertBuilderEvidenceShape(manifest: BuilderEvidenceManifest): void {
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

export function assertTurnAssignmentShape(
  assignment: unknown,
  label: string,
  code: RoadmapDeliveryError["code"],
): asserts assignment is TurnAssignment {
  assertExactObjectKeys(assignment, ["harness", "model", "effort"], label, code);
  const row = assignment as Record<string, unknown>;
  if (
    !TURN_ASSIGNMENT_HARNESSES.includes(String(row["harness"]) as TurnAssignment["harness"]) ||
    typeof row["model"] !== "string" ||
    row["model"].trim().length === 0 ||
    !TURN_ASSIGNMENT_EFFORTS.includes(String(row["effort"]) as TurnAssignment["effort"])
  ) {
    throw new RoadmapDeliveryError(code, `${label} is invalid`);
  }
}
