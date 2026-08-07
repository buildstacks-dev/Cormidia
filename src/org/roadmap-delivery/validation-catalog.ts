import type { AuthorityRef } from "./authority-core.js";

export const VALIDATION_LAYERS = ["L1", "L2", "L3", "L4", "L5"] as const;
type ValidationLayer = (typeof VALIDATION_LAYERS)[number];

export interface ValidationCatalogId {
  canonicalId: string;
  aliases: string[];
}

interface ValidationCatalogBoundary extends ValidationCatalogId {
  requiresSharedDetector: boolean;
  sharedDetectorId: string | null;
  routineEligible: boolean;
}

interface ValidationCatalogInvariant extends ValidationCatalogId {
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
  predecessor: AuthorityRef | null;
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
