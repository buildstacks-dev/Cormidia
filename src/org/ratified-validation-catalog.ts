import type {
  ValidationAffectedStructure,
  ValidationCatalog,
  ValidationCatalogCase,
} from "./roadmap-delivery/validation-catalog.js";
export const RATIFIED_VALIDATION_BASE_AFFECTED: ValidationAffectedStructure = {
  journeyIds: ["J-03"],
  boundaryIds: ["B-21"],
  contractIds: ["CORMIDIA-C-B21-001"],
  invariantIds: ["CORMIDIA-INV-016"],
  interfaceIds: ["API-roadmap-delivery"],
  stateOwnerIds: ["planning-state"],
  controlPointIds: [],
};
export const RATIFIED_VALIDATION_EMPTY_AFFECTED: ValidationAffectedStructure = {
  journeyIds: [],
  boundaryIds: [],
  contractIds: [],
  invariantIds: [],
  interfaceIds: [],
  stateOwnerIds: [],
  controlPointIds: [],
};
/** Complete deterministic 2026-08-03 revision catalog. Human reference review
 * and F-PT-010/011 thresholds remain outside this L1/L2 authority. */
export function ratifiedRoadmapValidationCatalog(app: string): ValidationCatalog {
  const roadmapAffected = affected({
    journeyIds: ["J-03"],
    boundaryIds: ["B-20", "B-21"],
    contractIds: ["CORMIDIA-C-B20-001", "CORMIDIA-C-B21-001", "CORMIDIA-C-OPVALIDATION-001"],
  });
  const deliveryAffected = affected({
    journeyIds: ["J-04"],
    boundaryIds: ["B-20", "B-21", "B-22"],
    contractIds: [
      "CORMIDIA-C-B20-001",
      "CORMIDIA-C-B21-001",
      "CORMIDIA-C-B22-001",
      "CORMIDIA-C-OPVALIDATION-001",
      "CORMIDIA-C-OPBATCH-001",
    ],
  });
  const batchAffected = affected({
    journeyIds: ["J-20"],
    boundaryIds: ["B-22"],
    contractIds: ["CORMIDIA-C-B22-001", "CORMIDIA-C-OPBATCH-001"],
  });
  const crossSurfaceAffected = affected({
    interfaceIds: ["API-roadmap-delivery", "CLI-status", "JSON-status", "ObserveSnapshot", "ReportSnapshot"],
  });
  const cases: ValidationCatalogCase[] = [
    catalogCase(
      "CF-B21-SHARED",
      ["CF-B21-*"],
      "L2",
      RATIFIED_VALIDATION_BASE_AFFECTED,
      "shared-boundary-lineage",
      true,
    ),
    catalogCase("CF-HB100-LINEAGE", [], "L1", RATIFIED_VALIDATION_EMPTY_AFFECTED, "review-lineage", true),
    catalogCase("CF-HB101-FRONTIER", [], "L2", RATIFIED_VALIDATION_EMPTY_AFFECTED, "current-roadmap-pointer", true),
    catalogCase(
      "CF-HB102-C3",
      ["CF-SM-VALIDATION-C", "CF-SM-VALIDATION-L/I/R/C"],
      "L2",
      affected({ controlPointIds: ["T-9"] }),
      "validation-authority-detector",
      false,
    ),
    catalogCase(
      "CF-HB102-FLOOR",
      ["CF-INV-001"],
      "L1",
      affected({ invariantIds: ["CORMIDIA-INV-001"] }),
      "validation-floor-detector",
      false,
    ),
    catalogCase("CF-HB102-WAIVER", [], "L1", RATIFIED_VALIDATION_EMPTY_AFFECTED, "validation-waiver-detector", true),
    catalogCase(
      "CF-HB102-WAIVER-2",
      [],
      "L1",
      RATIFIED_VALIDATION_EMPTY_AFFECTED,
      "validation-waiver-detector-2",
      true,
    ),
    ...["S", "R", "I", "RC", "A"].map((row) =>
      catalogCase(`CF-J03-${row}`, [], row === "R" ? "L1" : "L2", roadmapAffected, "roadmap-family-detector", false),
    ),
    ...["S", "R", "I", "RC", "A"].map((row) =>
      catalogCase(`CF-J04-${row}`, [], "L2", deliveryAffected, "delivery-family-detector", false),
    ),
    ...["S", "R", "I", "RC", "A"].map((row) =>
      catalogCase(`CF-J20-${row}`, [], row === "R" ? "L1" : "L2", batchAffected, "batch-family-detector", false),
    ),
    catalogCase("CF-SM-ROADMAP", ["CF-SM-ROADMAP-L/I/R/C"], "L2", roadmapAffected, "roadmap-lifecycle-detector", false),
    catalogCase("CF-SM-BATCH", ["CF-SM-BATCH-L/I/R/C"], "L2", batchAffected, "batch-lifecycle-detector", false),
    catalogCase(
      "CF-INV-016",
      [],
      "L1",
      affected({ invariantIds: ["CORMIDIA-INV-016"] }),
      "lineage-swap-detector",
      false,
    ),
    catalogCase("CF-B20-SUITE", ["CF-B20-*"], "L2", roadmapAffected, "roadmap-boundary-detector", false),
    catalogCase("CF-B22-SUITE", ["CF-B22-*"], "L2", batchAffected, "batch-boundary-detector", false),
    catalogCase("CF-C-B20", [], "L2", roadmapAffected, "roadmap-contract-detector", false),
    catalogCase("CF-C-B21", [], "L2", RATIFIED_VALIDATION_BASE_AFFECTED, "validation-contract-detector", false),
    catalogCase("CF-C-B22", [], "L2", batchAffected, "batch-contract-detector", false),
    catalogCase("CF-C-OPVALIDATION", [], "L2", roadmapAffected, "validation-operation-detector", false),
    catalogCase("CF-C-OPBATCH", [], "L2", batchAffected, "batch-operation-detector", false),
    catalogCase("CF-S1-ENV", ["CF-S1-env"], "L2", roadmapAffected, "planner-envelope-detector", false),
    catalogCase("CF-S10-ENV", ["CF-S10-env"], "L2", roadmapAffected, "validation-designer-envelope-detector", false),
    catalogCase("CF-IF-XSURF", [], "L2", crossSurfaceAffected, "cross-surface-agreement-detector", false),
  ];
  return {
    schemaVersion: 1,
    catalogId: "validation-catalog",
    version: 1,
    predecessor: null,
    app,
    harnessRevisionId: "roadmap-validation-delivery-batching-2026-08-03",
    journeys: [
      { canonicalId: "J-03", aliases: ["J03"] },
      { canonicalId: "J-04", aliases: ["J04"] },
      { canonicalId: "J-20", aliases: ["J20"] },
    ],
    boundaries: [
      {
        canonicalId: "B-20",
        aliases: ["B20"],
        requiresSharedDetector: false,
        sharedDetectorId: null,
        routineEligible: true,
      },
      {
        canonicalId: "B-21",
        aliases: ["B21"],
        requiresSharedDetector: true,
        sharedDetectorId: "shared-boundary-lineage",
        routineEligible: true,
      },
      {
        canonicalId: "B-22",
        aliases: ["B22"],
        requiresSharedDetector: false,
        sharedDetectorId: null,
        routineEligible: false,
      },
    ],
    contracts: [
      { canonicalId: "CORMIDIA-C-B20-001", aliases: ["B-20"] },
      { canonicalId: "CORMIDIA-C-B21-001", aliases: ["B-21"] },
      { canonicalId: "CORMIDIA-C-B22-001", aliases: ["B-22"] },
      { canonicalId: "CORMIDIA-C-OPBATCH-001", aliases: ["C-OP-BATCH"] },
      { canonicalId: "CORMIDIA-C-OPVALIDATION-001", aliases: ["C-OP-VALIDATION"] },
    ],
    invariants: [
      { canonicalId: "CORMIDIA-INV-016", aliases: ["INV-016"], floor: false },
      { canonicalId: "CORMIDIA-INV-001", aliases: ["INV-001"], floor: true },
    ],
    interfaces: [
      { canonicalId: "API-roadmap-delivery", aliases: ["roadmap-delivery"] },
      { canonicalId: "CLI-status", aliases: ["cormidia-status"] },
      { canonicalId: "JSON-status", aliases: ["status-json"] },
      { canonicalId: "ObserveSnapshot", aliases: ["observe"] },
      { canonicalId: "ReportSnapshot", aliases: ["report"] },
    ],
    stateOwners: [{ canonicalId: "planning-state", aliases: ["state:planning"] }],
    controlPoints: [{ canonicalId: "T-9", aliases: ["T9"] }],
    cases,
    templates: [
      { templateId: "routine-v1", aliases: ["routine"], version: 1, kind: "routine" },
      { templateId: "custom-v1", aliases: ["custom"], version: 1, kind: "custom" },
    ],
    waiverClasses: [
      {
        classId: "bounded-defer",
        aliases: ["defer"],
        maxDurationMs: 60 * 60_000,
        maxWaiversPerContract: 1,
        allowedTemplateKinds: ["routine", "custom"],
      },
    ],
    acceptedAt: "2026-08-03T21:55:00.000Z",
  };
}
function affected(overrides: Partial<ValidationAffectedStructure>): ValidationAffectedStructure {
  return {
    ...structuredClone(RATIFIED_VALIDATION_EMPTY_AFFECTED),
    invariantIds: ["CORMIDIA-INV-016"],
    interfaceIds: ["API-roadmap-delivery"],
    stateOwnerIds: ["planning-state"],
    ...structuredClone(overrides),
  };
}

function catalogCase(
  canonicalId: string,
  aliases: string[],
  cheapestFalsifyingLayer: ValidationCatalogCase["cheapestFalsifyingLayer"],
  affectedStructure: ValidationAffectedStructure,
  detectorId: string,
  routineEligible: boolean,
): ValidationCatalogCase {
  return {
    canonicalId,
    aliases,
    cheapestFalsifyingLayer,
    affected: structuredClone(affectedStructure),
    detectorId,
    negativeControlRequired: true,
    routineEligible,
  };
}
