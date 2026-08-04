import type {
  ValidationAffectedStructure,
  ValidationCatalog,
} from "../../src/org/roadmap-delivery.js";

export const VALIDATION_BASE_AFFECTED: ValidationAffectedStructure = {
  journeyIds: ["J-03"],
  boundaryIds: ["B-21"],
  contractIds: ["CORMIDIA-C-B21-001"],
  invariantIds: ["CORMIDIA-INV-016"],
  interfaceIds: ["API-roadmap-delivery"],
  stateOwnerIds: ["planning-state"],
  controlPointIds: [],
};

export const VALIDATION_EMPTY_AFFECTED: ValidationAffectedStructure = {
  journeyIds: [],
  boundaryIds: [],
  contractIds: [],
  invariantIds: [],
  interfaceIds: [],
  stateOwnerIds: [],
  controlPointIds: [],
};

export function validationCatalog(app: string): ValidationCatalog {
  return {
    schemaVersion: 1,
    catalogId: "validation-catalog",
    version: 1,
    predecessor: null,
    app,
    harnessRevisionId: "roadmap-validation-delivery-batching-2026-08-03",
    journeys: [{ canonicalId: "J-03", aliases: ["J03"] }],
    boundaries: [{
      canonicalId: "B-21",
      aliases: ["B21"],
      requiresSharedDetector: true,
      sharedDetectorId: "shared-boundary-lineage",
      routineEligible: true,
    }],
    contracts: [{ canonicalId: "CORMIDIA-C-B21-001", aliases: ["B-21"] }],
    invariants: [
      { canonicalId: "CORMIDIA-INV-016", aliases: ["INV-016"], floor: false },
      { canonicalId: "CORMIDIA-INV-001", aliases: ["INV-001"], floor: true },
    ],
    interfaces: [{ canonicalId: "API-roadmap-delivery", aliases: ["roadmap-delivery"] }],
    stateOwners: [{ canonicalId: "planning-state", aliases: ["state:planning"] }],
    controlPoints: [{ canonicalId: "T-9", aliases: ["T9"] }],
    cases: [
      {
        canonicalId: "CF-B21-SHARED",
        aliases: ["CF-B21-*"],
        cheapestFalsifyingLayer: "L2",
        affected: structuredClone(VALIDATION_BASE_AFFECTED),
        detectorId: "shared-boundary-lineage",
        negativeControlRequired: true,
        routineEligible: true,
      },
      {
        canonicalId: "CF-HB100-LINEAGE",
        aliases: [],
        cheapestFalsifyingLayer: "L1",
        affected: structuredClone(VALIDATION_EMPTY_AFFECTED),
        detectorId: "review-lineage",
        negativeControlRequired: true,
        routineEligible: true,
      },
      {
        canonicalId: "CF-HB101-FRONTIER",
        aliases: [],
        cheapestFalsifyingLayer: "L2",
        affected: structuredClone(VALIDATION_EMPTY_AFFECTED),
        detectorId: "current-roadmap-pointer",
        negativeControlRequired: true,
        routineEligible: true,
      },
      {
        canonicalId: "CF-HB102-C3",
        aliases: ["CF-SM-VALIDATION-C"],
        cheapestFalsifyingLayer: "L2",
        affected: { ...structuredClone(VALIDATION_EMPTY_AFFECTED), controlPointIds: ["T-9"] },
        detectorId: "validation-authority-detector",
        negativeControlRequired: true,
        routineEligible: false,
      },
      {
        canonicalId: "CF-HB102-FLOOR",
        aliases: ["CF-INV-001"],
        cheapestFalsifyingLayer: "L1",
        affected: { ...structuredClone(VALIDATION_EMPTY_AFFECTED), invariantIds: ["CORMIDIA-INV-001"] },
        detectorId: "validation-floor-detector",
        negativeControlRequired: true,
        routineEligible: false,
      },
      {
        canonicalId: "CF-HB102-WAIVER",
        aliases: [],
        cheapestFalsifyingLayer: "L1",
        affected: structuredClone(VALIDATION_EMPTY_AFFECTED),
        detectorId: "validation-waiver-detector",
        negativeControlRequired: true,
        routineEligible: true,
      },
      {
        canonicalId: "CF-HB102-WAIVER-2",
        aliases: [],
        cheapestFalsifyingLayer: "L1",
        affected: structuredClone(VALIDATION_EMPTY_AFFECTED),
        detectorId: "validation-waiver-detector-2",
        negativeControlRequired: true,
        routineEligible: true,
      },
    ],
    templates: [
      { templateId: "routine-v1", aliases: ["routine"], version: 1, kind: "routine" },
      { templateId: "custom-v1", aliases: ["custom"], version: 1, kind: "custom" },
    ],
    waiverClasses: [{
      classId: "bounded-defer",
      aliases: ["defer"],
      maxDurationMs: 60 * 60_000,
      maxWaiversPerContract: 1,
      allowedTemplateKinds: ["routine", "custom"],
    }],
    acceptedAt: "2026-08-03T21:55:00.000Z",
  };
}
