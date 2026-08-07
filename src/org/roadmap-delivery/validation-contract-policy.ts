import { stableHash } from "../../loop/episode-plan.js";
import type { AcceptedAuthority, AuthorityRef } from "./authority-core.js";
import { renderAuthorityRef, sameAuthorityRef } from "./authority-store.js";
import type { ValidationCatalog } from "./validation-catalog.js";
import type { ValidationContract } from "./validation-contract.js";
import {
  assertAffectedStructureEqual,
  assertCoverageSupported,
  emptyAffectedStructure,
  mergeAffectedStructure,
} from "./validation-coverage.js";
import { RoadmapDeliveryError } from "./failure.js";
import {
  assertCanonicalAffectedStructure,
  canonicalizeAffectedStructure,
  resolveTemplateId,
  resolveValidationId,
  resolveWaiverClassId,
} from "./validation-identifiers.js";
import { assertValidationWaiver } from "./validation-waivers.js";

export function canonicalizeValidationContract(
  contract: ValidationContract,
  catalog: ValidationCatalog,
): ValidationContract {
  const canonical = structuredClone(contract);
  canonical.affected = canonicalizeAffectedStructure(canonical.affected, catalog);
  canonical.obligations = canonical.obligations.map((obligation) => ({
    ...obligation,
    caseId: resolveCanonicalValidationCaseId(catalog, obligation.caseId),
    covers: canonicalizeAffectedStructure(obligation.covers, catalog),
    ...(obligation.waiver === null
      ? {}
      : {
          waiver: {
            ...obligation.waiver,
            policyClassId: resolveWaiverClassId(catalog.waiverClasses, obligation.waiver.policyClassId),
          },
        }),
  }));
  canonical.sharedBoundaryDetectorRefs = canonical.sharedBoundaryDetectorRefs.map((shared) => ({
    boundaryId: resolveValidationId(catalog.boundaries, shared.boundaryId, "boundary"),
    caseId: resolveCanonicalValidationCaseId(catalog, shared.caseId),
    detectorId: shared.detectorId,
  }));
  if (canonical.templateRef !== null) {
    canonical.templateRef.templateId = resolveTemplateId(
      catalog.templates,
      canonical.templateRef.templateId,
      canonical.templateRef.version,
    );
  }
  return canonical;
}

function resolveCanonicalValidationCaseId(catalog: ValidationCatalog, id: string): string {
  return resolveValidationId(catalog.cases, id, "case");
}

export function assertValidationContractPolicy(contract: ValidationContract, catalog: ValidationCatalog): void {
  if (contract.requiresHarnessRevision) {
    throw new RoadmapDeliveryError(
      "validation_structure_mismatch",
      `contract requires harness revision: ${contract.harnessRevisionReason ?? "unspecified"}`,
    );
  }
  assertCanonicalAffectedStructure(contract.affected, catalog, "validation contract");
  const template =
    contract.templateRef === null
      ? undefined
      : catalog.templates.find(
          (candidate) =>
            candidate.templateId === contract.templateRef!.templateId &&
            candidate.version === contract.templateRef!.version,
        );
  if (contract.templateRef !== null && template === undefined) {
    throw new RoadmapDeliveryError(
      "validation_id_unknown",
      `unknown or stale validation template ${contract.templateRef.templateId}@${contract.templateRef.version}`,
    );
  }
  const floorIds = new Set(catalog.invariants.filter((entry) => entry.floor).map((entry) => entry.canonicalId));
  const hasFloor = contract.affected.invariantIds.some((id) => floorIds.has(id));
  const hasC3 = contract.affected.controlPointIds.length > 0;
  if (template?.kind === "routine" && (hasFloor || hasC3)) {
    throw new RoadmapDeliveryError(
      "validation_contract_invalid",
      "routine validation templates cannot cover invariant floors or C3 control points",
    );
  }
  if (template?.kind === "routine") {
    const forbiddenBoundary = contract.affected.boundaryIds.find(
      (id) => catalog.boundaries.find((entry) => entry.canonicalId === id)?.routineEligible !== true,
    );
    if (forbiddenBoundary !== undefined) {
      throw new RoadmapDeliveryError(
        "validation_contract_invalid",
        `routine validation template cannot cover boundary ${forbiddenBoundary}`,
      );
    }
  }
  const coverage = emptyAffectedStructure();
  const waiverCounts = new Map<string, number>();
  for (const obligation of contract.obligations) {
    assertCanonicalAffectedStructure(obligation.covers, catalog, `obligation ${obligation.obligationId}`);
    const caseEntry = catalog.cases.find((entry) => entry.canonicalId === obligation.caseId)!;
    if (caseEntry.cheapestFalsifyingLayer !== obligation.cheapestFalsifyingLayer) {
      throw new RoadmapDeliveryError(
        "validation_contract_invalid",
        `${obligation.caseId} must stay at cheapest layer ${caseEntry.cheapestFalsifyingLayer}`,
      );
    }
    if (caseEntry.detectorId !== obligation.detectorId) {
      throw new RoadmapDeliveryError(
        "validation_contract_invalid",
        `${obligation.caseId} must use canonical detector ${caseEntry.detectorId}`,
      );
    }
    if (caseEntry.negativeControlRequired && obligation.negativeControlId.trim().length === 0) {
      throw new RoadmapDeliveryError(
        "negative_control_missing",
        `${obligation.caseId} requires a seeded negative control`,
      );
    }
    assertCoverageSupported(obligation, caseEntry);
    mergeAffectedStructure(coverage, obligation.covers);
    if (template?.kind === "routine" && !caseEntry.routineEligible) {
      throw new RoadmapDeliveryError(
        "validation_contract_invalid",
        `routine validation template cannot select ${caseEntry.canonicalId}`,
      );
    }
    if (obligation.waiver !== null) {
      assertValidationWaiver(obligation, contract, catalog, template?.kind ?? "custom", hasFloor, hasC3);
      waiverCounts.set(obligation.waiver.policyClassId, (waiverCounts.get(obligation.waiver.policyClassId) ?? 0) + 1);
    }
  }
  assertAffectedStructureEqual(coverage, contract.affected);
  for (const [classId, count] of waiverCounts) {
    const policy = catalog.waiverClasses.find((entry) => entry.classId === classId)!;
    if (count > policy.maxWaiversPerContract) {
      throw new RoadmapDeliveryError(
        "validation_waiver_invalid",
        `waiver class ${classId} permits at most ${policy.maxWaiversPerContract} obligation(s)`,
      );
    }
  }
  assertSharedBoundaryDetectors(contract, catalog);
}

export function assertValidationContractRevision(
  contract: ValidationContract,
  current: AcceptedAuthority<ValidationContract> | undefined,
): void {
  const proposedRef: AuthorityRef = {
    kind: "validation_contract",
    id: contract.contractId,
    version: contract.version,
    sha256: stableHash(contract),
  };
  if (current === undefined) {
    if (contract.version !== 1 || contract.predecessor !== null) {
      throw new RoadmapDeliveryError(
        "validation_contract_stale",
        "the first validation contract must be v1 with no predecessor",
      );
    }
    return;
  }
  if (sameAuthorityRef(current.ref, proposedRef)) return;
  if (
    contract.contractId !== current.value.contractId ||
    contract.version !== current.value.version + 1 ||
    contract.predecessor === null ||
    !sameAuthorityRef(contract.predecessor, current.ref)
  ) {
    throw new RoadmapDeliveryError(
      "validation_contract_stale",
      `validation contract must advance ${renderAuthorityRef(current.ref)} by exactly one version`,
    );
  }
}

function assertSharedBoundaryDetectors(contract: ValidationContract, catalog: ValidationCatalog): void {
  const required = catalog.boundaries.filter(
    (entry) => contract.affected.boundaryIds.includes(entry.canonicalId) && entry.requiresSharedDetector,
  );
  const byBoundary = new Map(contract.sharedBoundaryDetectorRefs.map((entry) => [entry.boundaryId, entry]));
  for (const boundary of required) {
    const shared = byBoundary.get(boundary.canonicalId);
    const obligation =
      shared === undefined ? undefined : contract.obligations.find((entry) => entry.caseId === shared.caseId);
    if (
      shared === undefined ||
      shared.detectorId !== boundary.sharedDetectorId ||
      obligation === undefined ||
      obligation.detectorId !== shared.detectorId ||
      !obligation.covers.boundaryIds.includes(boundary.canonicalId)
    ) {
      throw new RoadmapDeliveryError(
        "validation_contract_invalid",
        `shared boundary ${boundary.canonicalId} lacks its exact detector reference`,
      );
    }
  }
  const unexpected = contract.sharedBoundaryDetectorRefs.find(
    (entry) => !contract.affected.boundaryIds.includes(entry.boundaryId),
  );
  if (unexpected !== undefined) {
    throw new RoadmapDeliveryError(
      "validation_contract_invalid",
      `shared detector names unaffected boundary ${unexpected.boundaryId}`,
    );
  }
}
