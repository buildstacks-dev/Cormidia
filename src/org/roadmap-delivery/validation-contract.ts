import {
  VALIDATION_LAYERS,
  type ValidationAffectedStructure,
  type ValidationAuthorityRef,
} from "./validation-catalog.js";

export const VALIDATION_CONTRACT_SCHEMA_VERSION = 1 as const;

export interface ValidationTemplateRef {
  templateId: string;
  version: number;
}

export interface ValidationWaiver {
  waiverId: string;
  policyClassId: string;
  obligationId: string;
  unitId: string;
  contractId: string;
  contractVersion: number;
  reason: string;
  provenance: {
    actorId: string;
    authorityRef: string;
    decidedAt: string;
  };
  expiresAt: string;
}

export interface ValidationObligation {
  obligationId: string;
  caseId: string;
  covers: ValidationAffectedStructure;
  cheapestFalsifyingLayer: (typeof VALIDATION_LAYERS)[number];
  failureCases: string[];
  detectorId: string;
  negativeControlId: string;
  expectedEvidence: string[];
  waiver: ValidationWaiver | null;
}

export interface ValidationContract {
  schemaVersion: typeof VALIDATION_CONTRACT_SCHEMA_VERSION;
  contractId: string;
  version: number;
  predecessor: ValidationAuthorityRef | null;
  app: string;
  catalogRef: ValidationAuthorityRef;
  roadmapRef: ValidationAuthorityRef;
  unitId: string;
  unitMembershipHash: string;
  templateRef: ValidationTemplateRef | null;
  affected: ValidationAffectedStructure;
  acceptanceCriteria: string[];
  requiresHarnessRevision: boolean;
  harnessRevisionReason: string | null;
  sharedBoundaryDetectorRefs: Array<{
    boundaryId: string;
    caseId: string;
    detectorId: string;
  }>;
  obligations: ValidationObligation[];
  requiredGates: string[];
  proposedAt: string;
  acceptedAt: string;
}
