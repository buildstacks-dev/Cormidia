import { assertAuthorityRef, assertExactObjectKeys, assertHash, assertId, assertVersion } from "./authority-core.js";
import { VALIDATION_LAYERS } from "./validation-catalog.js";
import { VALIDATION_CONTRACT_SCHEMA_VERSION, type ValidationContract } from "./validation-contract.js";
import { assertAffectedStructureShape } from "./validation-coverage.js";
import { RoadmapDeliveryError } from "./failure.js";
import { assertMachineId, assertNonEmpty, assertStringList, requireDateTime } from "./validation-values.js";

export function assertValidationContractBaseShape(contract: ValidationContract): void {
  assertExactObjectKeys(
    contract,
    [
      "schemaVersion",
      "contractId",
      "version",
      "predecessor",
      "app",
      "catalogRef",
      "roadmapRef",
      "unitId",
      "unitMembershipHash",
      "templateRef",
      "affected",
      "acceptanceCriteria",
      "requiresHarnessRevision",
      "harnessRevisionReason",
      "sharedBoundaryDetectorRefs",
      "obligations",
      "requiredGates",
      "proposedAt",
      "acceptedAt",
    ],
    "validation contract",
  );
  if (contract.schemaVersion !== VALIDATION_CONTRACT_SCHEMA_VERSION) {
    throw new RoadmapDeliveryError("validation_contract_invalid", "unsupported validation-contract schema");
  }
  assertId(contract.contractId, "validation contract id");
  assertId(contract.unitId, "validation unit id");
  assertVersion(contract.version, "validation contract version");
  if (contract.predecessor !== null) assertAuthorityRef(contract.predecessor, "validation_contract");
  assertAuthorityRef(contract.catalogRef, "validation_catalog");
  assertAuthorityRef(contract.roadmapRef, "roadmap_plan");
  assertHash(contract.unitMembershipHash, "validation membership hash");
  requireDateTime(contract.proposedAt, "validation proposedAt");
  requireDateTime(contract.acceptedAt, "validation acceptedAt");
  if (Date.parse(contract.proposedAt) > Date.parse(contract.acceptedAt)) {
    throw new RoadmapDeliveryError("validation_contract_invalid", "validation acceptance precedes proposal");
  }
  assertNonEmpty(contract.app, "validation contract app");
  if (
    !Array.isArray(contract.obligations) ||
    !Array.isArray(contract.requiredGates) ||
    !Array.isArray(contract.acceptanceCriteria) ||
    !Array.isArray(contract.sharedBoundaryDetectorRefs) ||
    contract.obligations.length === 0 ||
    contract.requiredGates.length === 0 ||
    contract.acceptanceCriteria.length === 0
  ) {
    throw new RoadmapDeliveryError(
      "validation_contract_invalid",
      "app, acceptance criteria, obligations, and required gates are required",
    );
  }
  assertStringList(contract.acceptanceCriteria, "validation acceptance criteria");
  assertStringList(contract.requiredGates, "validation required gates");
  assertAffectedStructureShape(contract.affected, "validation affected structure", false);
  if (typeof contract.requiresHarnessRevision !== "boolean") {
    throw new RoadmapDeliveryError("validation_structure_mismatch", "requires_harness_revision must be boolean");
  }
  if (
    contract.requiresHarnessRevision !== (contract.harnessRevisionReason !== null) ||
    (contract.harnessRevisionReason !== null &&
      (typeof contract.harnessRevisionReason !== "string" || contract.harnessRevisionReason.trim().length === 0))
  ) {
    throw new RoadmapDeliveryError(
      "validation_structure_mismatch",
      "requires_harness_revision and its reason must be explicit and agree",
    );
  }
  if (contract.templateRef !== null) {
    assertExactObjectKeys(contract.templateRef, ["templateId", "version"], "validation template ref");
    assertMachineId(contract.templateRef.templateId, "validation template id");
    assertVersion(contract.templateRef.version, "validation template version");
  }
  const obligationIds = new Set<string>();
  const caseIds = new Set<string>();
  for (const obligation of contract.obligations) {
    assertExactObjectKeys(
      obligation,
      [
        "obligationId",
        "caseId",
        "covers",
        "cheapestFalsifyingLayer",
        "failureCases",
        "detectorId",
        "negativeControlId",
        "expectedEvidence",
        "waiver",
      ],
      "validation obligation",
    );
    assertMachineId(obligation.obligationId, "validation obligation id");
    assertNonEmpty(obligation.caseId, "validation case id");
    assertAffectedStructureShape(obligation.covers, `obligation ${obligation.obligationId} coverage`, true);
    assertStringList(obligation.failureCases, `obligation ${obligation.obligationId} failure cases`);
    assertStringList(obligation.expectedEvidence, `obligation ${obligation.obligationId} expected evidence`);
    assertNonEmpty(obligation.detectorId, `obligation ${obligation.obligationId} detector`);
    if (typeof obligation.negativeControlId !== "string" || obligation.negativeControlId.trim().length === 0) {
      throw new RoadmapDeliveryError(
        "negative_control_missing",
        `obligation ${obligation.obligationId} has no seeded negative control`,
      );
    }
    if (!VALIDATION_LAYERS.includes(obligation.cheapestFalsifyingLayer)) {
      throw new RoadmapDeliveryError(
        "validation_contract_invalid",
        `obligation ${obligation.obligationId} has an invalid cheapest layer`,
      );
    }
    if (obligationIds.has(obligation.obligationId) || caseIds.has(obligation.caseId)) {
      throw new RoadmapDeliveryError(
        "validation_contract_invalid",
        `duplicate validation obligation or case ${obligation.obligationId}/${obligation.caseId}`,
      );
    }
    obligationIds.add(obligation.obligationId);
    caseIds.add(obligation.caseId);
  }
  const sharedKeys = new Set<string>();
  for (const shared of contract.sharedBoundaryDetectorRefs) {
    assertExactObjectKeys(shared, ["boundaryId", "caseId", "detectorId"], "shared-boundary detector ref");
    assertNonEmpty(shared.boundaryId, "shared boundary id");
    assertNonEmpty(shared.caseId, "shared boundary case id");
    assertNonEmpty(shared.detectorId, "shared boundary detector id");
    if (sharedKeys.has(shared.boundaryId)) {
      throw new RoadmapDeliveryError(
        "validation_contract_invalid",
        `duplicate shared-boundary detector for ${shared.boundaryId}`,
      );
    }
    sharedKeys.add(shared.boundaryId);
  }
}
