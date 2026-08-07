export const VALIDATION_LAYERS = ["L1", "L2", "L3", "L4", "L5"] as const;
type ValidationLayer = (typeof VALIDATION_LAYERS)[number];

export type ValidationAuthorityRef = {
  kind:
    | "backlog_snapshot"
    | "roadmap_plan"
    | "validation_catalog"
    | "validation_contract"
    | "delivery_unit_readiness"
    | "direct_execution_unit"
    | "direct_episode_binding"
    | "execution_batch"
    | "delivery_episode_binding"
    | "builder_evidence"
    | "reviewer_verdict";
  id: string;
  version: number;
  sha256: string;
};

export interface ValidationCatalogId {
  canonicalId: string;
  aliases: string[];
}

export interface ValidationCatalogBoundary extends ValidationCatalogId {
  requiresSharedDetector: boolean;
  sharedDetectorId: string | null;
  routineEligible: boolean;
}

export interface ValidationCatalogInvariant extends ValidationCatalogId {
  floor: boolean;
}

export interface ValidationAffectedStructure {
  journeyIds: string[];
  boundaryIds: string[];
  contractIds: string[];
  invariantIds: string[];
  interfaceIds: string[];
  stateOwnerIds: string[];
  controlPointIds: string[];
}

export interface ValidationCatalogCase extends ValidationCatalogId {
  cheapestFalsifyingLayer: ValidationLayer;
  affected: ValidationAffectedStructure;
  detectorId: string;
  negativeControlRequired: boolean;
  routineEligible: boolean;
}

export interface ValidationCatalogTemplate {
  templateId: string;
  aliases: string[];
  version: number;
  kind: "routine" | "custom";
}

export interface ValidationWaiverClass {
  classId: string;
  aliases: string[];
  maxDurationMs: number;
  maxWaiversPerContract: number;
  allowedTemplateKinds: Array<ValidationCatalogTemplate["kind"]>;
}

export interface ValidationCatalog {
  schemaVersion: 1;
  catalogId: string;
  version: number;
  predecessor: ValidationAuthorityRef | null;
  app: string;
  harnessRevisionId: string;
  journeys: ValidationCatalogId[];
  boundaries: ValidationCatalogBoundary[];
  contracts: ValidationCatalogId[];
  invariants: ValidationCatalogInvariant[];
  interfaces: ValidationCatalogId[];
  stateOwners: ValidationCatalogId[];
  controlPoints: ValidationCatalogId[];
  cases: ValidationCatalogCase[];
  templates: ValidationCatalogTemplate[];
  waiverClasses: ValidationWaiverClass[];
  acceptedAt: string;
}
