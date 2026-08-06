// Durable roadmap-to-delivery authority joins (HB-100 through HB-107).
//
// This module is deliberately provider-free until EpisodePlanner normalization:
// roadmap admission, validation admission, batching, claims, and evidence review
// are deterministic state transitions. A complete creator scope enters the real
// EpisodePlanner coordinator and produces the same durable EpisodePlan as every
// other episode without constructing a runtime.

import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { writeLoopFileAtomic, writeLoopFileOnce } from "../loop/durable.js";
import {
  episodePlanHash,
  readCurrentEpisodePlan,
  stableHash,
  type CreatorEpisodeScope,
  type EpisodePlan,
  type ProposedEpisodeStep,
} from "../loop/episode-plan.js";
import { autonomousExecutionExclusionLabel } from "../loop/plan-tickets.js";
import {
  durableClaimSettlementId,
  DurableClaimStore,
  type DurableClaimDisposition,
  type DurableClaimRecord,
  type DurableClaimToken,
} from "../runtime/durable-claim.js";
import { withFileLock } from "../runtime/file-lock.js";
import type { RoleConfig, ToolAction, TurnAssignment } from "../runtime/types.js";
import { ApprovalStore } from "./approvals.js";
import type { AppEntry } from "./apps.js";
import {
  prepareEpisodePlan,
  type EpisodePlannerProposer,
  type PreparedEpisodePlan,
} from "./episode-planner/coordinator.js";
import {
  buildEpisodeIntent,
  type EpisodeIntentFacts,
  type EpisodePlanningPolicyOptions,
} from "./episode-planner/policy.js";

export const ROADMAP_DELIVERY_SCHEMA_VERSION = 1 as const;
const VALIDATION_CATALOG_SCHEMA_VERSION = 1 as const;
const VALIDATION_CONTRACT_SCHEMA_VERSION = 1 as const;
const RATIFIED_HARNESS_REVISION_ID = "roadmap-validation-delivery-batching-2026-08-03" as const;
/** Content root for the complete deterministic HB-100..108 catalog. */
export const RATIFIED_VALIDATION_CATALOG_CONTENT_SHA256 =
  "58b677769721a28840733bd9e7da8aa729194fa6d1b1ed533128f17e56aa4880" as const;

const VALIDATION_LAYERS = ["L1", "L2", "L3", "L4", "L5"] as const;
type ValidationLayer = (typeof VALIDATION_LAYERS)[number];

type RoadmapDeliveryFailureCode =
  | "backlog_incomplete"
  | "roadmap_missing"
  | "roadmap_invalid"
  | "issue_unaccounted"
  | "issue_multiply_assigned"
  | "unit_cycle"
  | "frontier_stale"
  | "routing_ineligible"
  | "validation_contract_missing"
  | "validation_contract_invalid"
  | "validation_contract_stale"
  | "validation_catalog_missing"
  | "validation_catalog_stale"
  | "validation_id_unknown"
  | "validation_structure_mismatch"
  | "validation_waiver_invalid"
  | "negative_control_missing"
  | "validation_incomplete"
  | "batch_unit_duplicate"
  | "batch_hard_constraint_failed"
  | "batch_manifest_too_large"
  | "batch_membership_active"
  | "direct_unit_incomplete"
  | "unit_budget_exhausted"
  | "unit_journal_conflict"
  | "already_claimed"
  | "builder_evidence_missing"
  | "evidence_head_mismatch"
  | "evidence_unit_mismatch"
  | "reviewer_evidence_incomplete"
  | "reviewer_independence_invalid"
  | "projection_contradiction"
  | "authority_conflict"
  | "authority_corrupt";

export class RoadmapDeliveryError extends Error {
  constructor(
    readonly code: RoadmapDeliveryFailureCode,
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = "RoadmapDeliveryError";
  }
}

export interface AuthorityRef {
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
}

export interface AcceptedAuthority<T> {
  schemaVersion: typeof ROADMAP_DELIVERY_SCHEMA_VERSION;
  ref: AuthorityRef;
  value: T;
}

export interface RoadmapDeliveryProjection {
  kind: AuthorityRef["kind"] | "delivery_unit_claimed" | "delivery_unit_claim_committed" | "delivery_unit_settled";
  app: string;
  path: string;
  authorityRef?: AuthorityRef;
  settlementId?: string;
}

type RoadmapDeliveryProjector = (projection: Readonly<RoadmapDeliveryProjection>) => void | Promise<void>;

export interface RoadmapWorkstream {
  workstreamId: string;
  outcome: string;
  priority: number;
}

export interface BacklogSnapshotIssue {
  issueNumber: number;
  contentHash: string;
  lifecycle: "open" | "closed";
  routing: "automated" | "human_only";
  /** Exact labels observed with this snapshot. `manual-review` is evaluated
   * independently from the technical routing disposition. */
  observedLabels: string[];
  dependencyIssues: number[];
}

export interface BacklogSnapshot {
  schemaVersion: typeof ROADMAP_DELIVERY_SCHEMA_VERSION;
  snapshotId: string;
  version: number;
  app: string;
  source: string;
  capturedAt: string;
  completeness: "complete" | "partial" | "unavailable";
  pagination: {
    pagesObserved: number;
    hasNextPage: boolean;
    unavailablePages: number[];
  };
  issues: BacklogSnapshotIssue[];
}

interface BacklogDelta {
  previousSnapshotRef: AuthorityRef;
  currentSnapshotRef: AuthorityRef;
  addedIssueNumbers: number[];
  removedIssueNumbers: number[];
  changedIssueNumbers: number[];
  unchangedIssueNumbers: number[];
}

export interface RoadmapDeliveryUnit {
  unitId: string;
  workstreamId: string;
  issueNumbers: number[];
  dependsOn: string[];
  priority: number;
  objective: string;
}

export interface RoadmapIssueMove {
  issueNumber: number;
  fromUnitId: string;
  toUnitId: string;
  reason: string;
  movedAt: string;
}

export interface RoadmapPlan {
  schemaVersion: typeof ROADMAP_DELIVERY_SCHEMA_VERSION;
  planId: string;
  version: number;
  app: string;
  backlogSnapshotRef: AuthorityRef;
  predecessor: AuthorityRef | null;
  workstreams: RoadmapWorkstream[];
  deliveryUnits: RoadmapDeliveryUnit[];
  completedUnitIds: string[];
  readyFrontier: string[];
  wipLimit: number;
  moves: RoadmapIssueMove[];
  acceptedAt: string;
}

export interface AcceptedRoadmapPlan extends AcceptedAuthority<RoadmapPlan> {
  frontierHash: string;
}

export interface RoadmapIssueProjection {
  issueNumber: number;
  labels: string[];
  authorityRef: AuthorityRef | null;
  unitId: string | null;
  membershipHash: string | null;
}

interface RoadmapProjectionRepair {
  issueNumber: number;
  labels: string[];
  authorityRef: AuthorityRef;
  unitId: string;
  membershipHash: string;
  reason: "missing" | "stale" | "contradictory" | "current";
}

interface ValidationCatalogId {
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

interface ValidationCatalogTemplate {
  templateId: string;
  aliases: string[];
  version: number;
  kind: "routine" | "custom";
}

interface ValidationWaiverClass {
  classId: string;
  aliases: string[];
  maxDurationMs: number;
  maxWaiversPerContract: number;
  allowedTemplateKinds: Array<ValidationCatalogTemplate["kind"]>;
}

export interface ValidationCatalog {
  schemaVersion: typeof VALIDATION_CATALOG_SCHEMA_VERSION;
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

interface ValidationTemplateRef {
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
  cheapestFalsifyingLayer: ValidationLayer;
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
  predecessor: AuthorityRef | null;
  app: string;
  catalogRef: AuthorityRef;
  roadmapRef: AuthorityRef;
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

export function validationWaiverApprovalAction(
  contract: Pick<ValidationContract, "app" | "unitId" | "contractId" | "version">,
  obligation: ValidationObligation,
): ToolAction {
  const waiver = obligation.waiver;
  if (waiver === null) {
    throw new RoadmapDeliveryError(
      "validation_waiver_invalid",
      `obligation ${obligation.obligationId} has no waiver to authorize`,
    );
  }
  return {
    tool: "validation-waiver",
    input: {
      schemaVersion: VALIDATION_CONTRACT_SCHEMA_VERSION,
      kind: "validation-waiver",
      app: contract.app,
      unitId: contract.unitId,
      contractId: contract.contractId,
      contractVersion: contract.version,
      obligationId: waiver.obligationId,
      waiverId: waiver.waiverId,
      policyClassId: waiver.policyClassId,
      reason: waiver.reason,
      expiresAt: waiver.expiresAt,
      obligationSha256: stableHash({
        obligationId: obligation.obligationId,
        caseId: obligation.caseId,
        covers: obligation.covers,
        cheapestFalsifyingLayer: obligation.cheapestFalsifyingLayer,
        failureCases: obligation.failureCases,
        detectorId: obligation.detectorId,
        negativeControlId: obligation.negativeControlId,
        expectedEvidence: obligation.expectedEvidence,
        waiver: {
          waiverId: waiver.waiverId,
          policyClassId: waiver.policyClassId,
          obligationId: waiver.obligationId,
          unitId: waiver.unitId,
          contractId: waiver.contractId,
          contractVersion: waiver.contractVersion,
          reason: waiver.reason,
          expiresAt: waiver.expiresAt,
        },
      }),
    },
    description: `Authorize validation waiver ${waiver.waiverId} for ${contract.unitId}`,
  };
}

/**
 * Portable schema for the immutable validation-contract payload. Runtime
 * admission applies the same closed-world shape plus catalog-backed semantic
 * checks; consumers may persist this object as the v1 interchange schema.
 */
export const VALIDATION_CONTRACT_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://cormidia.dev/schemas/validation-contract/v1.json",
  title: "Cormidia validation contract v1",
  type: "object",
  additionalProperties: false,
  required: [
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
  properties: {
    schemaVersion: { const: VALIDATION_CONTRACT_SCHEMA_VERSION },
    contractId: { type: "string", pattern: "^[a-z0-9][a-z0-9._-]{0,127}$" },
    version: { type: "integer", minimum: 1 },
    predecessor: { anyOf: [{ type: "null" }, { $ref: "#/$defs/validationContractRef" }] },
    app: { type: "string", minLength: 1 },
    catalogRef: { $ref: "#/$defs/validationCatalogRef" },
    roadmapRef: { $ref: "#/$defs/roadmapRef" },
    unitId: { type: "string", pattern: "^[a-z0-9][a-z0-9._-]{0,127}$" },
    unitMembershipHash: { $ref: "#/$defs/hash" },
    templateRef: { anyOf: [{ type: "null" }, { $ref: "#/$defs/templateRef" }] },
    affected: { $ref: "#/$defs/affected" },
    acceptanceCriteria: { $ref: "#/$defs/nonEmptyUniqueStrings" },
    requiresHarnessRevision: { type: "boolean" },
    harnessRevisionReason: { type: ["string", "null"] },
    sharedBoundaryDetectorRefs: {
      type: "array",
      items: { $ref: "#/$defs/sharedDetectorRef" },
    },
    obligations: {
      type: "array",
      minItems: 1,
      items: { $ref: "#/$defs/obligation" },
    },
    requiredGates: { $ref: "#/$defs/nonEmptyUniqueStrings" },
    proposedAt: { type: "string", format: "date-time" },
    acceptedAt: { type: "string", format: "date-time" },
  },
  $defs: {
    hash: { type: "string", pattern: "^[a-f0-9]{64}$" },
    machineId: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._*:/-]{0,255}$" },
    nonEmptyUniqueStrings: {
      type: "array",
      minItems: 1,
      uniqueItems: true,
      items: { type: "string", minLength: 1 },
    },
    stringSet: {
      type: "array",
      uniqueItems: true,
      items: { $ref: "#/$defs/machineId" },
    },
    authorityRef: {
      type: "object",
      additionalProperties: false,
      required: ["kind", "id", "version", "sha256"],
      properties: {
        kind: { type: "string" },
        id: { type: "string", minLength: 1 },
        version: { type: "integer", minimum: 1 },
        sha256: { $ref: "#/$defs/hash" },
      },
    },
    validationContractRef: {
      allOf: [{ $ref: "#/$defs/authorityRef" }, { properties: { kind: { const: "validation_contract" } } }],
    },
    validationCatalogRef: {
      allOf: [{ $ref: "#/$defs/authorityRef" }, { properties: { kind: { const: "validation_catalog" } } }],
    },
    roadmapRef: {
      allOf: [{ $ref: "#/$defs/authorityRef" }, { properties: { kind: { const: "roadmap_plan" } } }],
    },
    templateRef: {
      type: "object",
      additionalProperties: false,
      required: ["templateId", "version"],
      properties: {
        templateId: { $ref: "#/$defs/machineId" },
        version: { type: "integer", minimum: 1 },
      },
    },
    affected: {
      type: "object",
      additionalProperties: false,
      required: [
        "journeyIds",
        "boundaryIds",
        "contractIds",
        "invariantIds",
        "interfaceIds",
        "stateOwnerIds",
        "controlPointIds",
      ],
      properties: {
        journeyIds: { $ref: "#/$defs/stringSet" },
        boundaryIds: { $ref: "#/$defs/stringSet" },
        contractIds: { $ref: "#/$defs/stringSet" },
        invariantIds: { $ref: "#/$defs/stringSet" },
        interfaceIds: { $ref: "#/$defs/stringSet" },
        stateOwnerIds: { $ref: "#/$defs/stringSet" },
        controlPointIds: { $ref: "#/$defs/stringSet" },
      },
    },
    waiver: {
      type: "object",
      additionalProperties: false,
      required: [
        "waiverId",
        "policyClassId",
        "obligationId",
        "unitId",
        "contractId",
        "contractVersion",
        "reason",
        "provenance",
        "expiresAt",
      ],
      properties: {
        waiverId: { $ref: "#/$defs/machineId" },
        policyClassId: { $ref: "#/$defs/machineId" },
        obligationId: { $ref: "#/$defs/machineId" },
        unitId: { type: "string", minLength: 1 },
        contractId: { type: "string", minLength: 1 },
        contractVersion: { type: "integer", minimum: 1 },
        reason: { type: "string", minLength: 1 },
        provenance: {
          type: "object",
          additionalProperties: false,
          required: ["actorId", "authorityRef", "decidedAt"],
          properties: {
            actorId: { type: "string", minLength: 1 },
            authorityRef: { type: "string", minLength: 1 },
            decidedAt: { type: "string", format: "date-time" },
          },
        },
        expiresAt: { type: "string", format: "date-time" },
      },
    },
    obligation: {
      type: "object",
      additionalProperties: false,
      required: [
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
      properties: {
        obligationId: { $ref: "#/$defs/machineId" },
        caseId: { $ref: "#/$defs/machineId" },
        covers: { $ref: "#/$defs/affected" },
        cheapestFalsifyingLayer: { enum: VALIDATION_LAYERS },
        failureCases: { $ref: "#/$defs/nonEmptyUniqueStrings" },
        detectorId: { type: "string", minLength: 1 },
        negativeControlId: { type: "string", minLength: 1 },
        expectedEvidence: { $ref: "#/$defs/nonEmptyUniqueStrings" },
        waiver: { anyOf: [{ type: "null" }, { $ref: "#/$defs/waiver" }] },
      },
    },
    sharedDetectorRef: {
      type: "object",
      additionalProperties: false,
      required: ["boundaryId", "caseId", "detectorId"],
      properties: {
        boundaryId: { $ref: "#/$defs/machineId" },
        caseId: { $ref: "#/$defs/machineId" },
        detectorId: { type: "string", minLength: 1 },
      },
    },
  },
} as const;

type ValidationContractLifecycleState = "proposed" | "validated" | "accepted" | "superseded";

interface ValidationContractLifecycleRecord {
  schemaVersion: typeof VALIDATION_CONTRACT_SCHEMA_VERSION;
  app: string;
  unitId: string;
  contractId: string;
  version: number;
  proposalHash: string;
  acceptedRef: AuthorityRef | null;
  predecessor: AuthorityRef | null;
  state: ValidationContractLifecycleState;
  transitions: Array<{
    state: ValidationContractLifecycleState;
    at: string;
    authorityRef: AuthorityRef | null;
  }>;
}

export interface RoutingSnapshotEntry {
  issueNumber: number;
  disposition: "automated" | "human_only";
  /** Projection evidence only. Labels never establish roadmap or validation authority. */
  observedLabels: string[];
}

interface ExecutionBatchUnit {
  kind?: "roadmap_code";
  unitId: string;
  issueNumbers?: number[];
  membershipHash: string;
  readinessRef: AuthorityRef;
  validationRef: AuthorityRef;
  validationContractHash: string;
  priority?: number;
  budget?: ExecutionUnitBudget;
}

export interface DirectExecutionUnitAuthority {
  schemaVersion: typeof ROADMAP_DELIVERY_SCHEMA_VERSION;
  kind: "direct_operation";
  unitId: string;
  app: string;
  objective: string;
  inScope: string[];
  outOfScope: string[];
  acceptanceCriteria: string[];
  expectedArtifacts: CreatorEpisodeScope["expectedArtifacts"];
  declaredConstraints: CreatorEpisodeScope["declaredConstraints"];
  safetyFacts: CreatorEpisodeScope["safetyFacts"];
  /** Generic repeatable work may name a governed template. A content-bound
   * operational campaign instead carries its exact instantiated steps so the
   * seven destination approvals cannot be widened by template lookup. Exactly
   * one workflow representation is required. */
  workflowTemplate?: NonNullable<CreatorEpisodeScope["workflowTemplate"]>;
  steps?: ProposedEpisodeStep[];
  provenance: CreatorEpisodeScope["provenance"];
  dedupeKey: string;
  admittedBudget: ExecutionUnitBudget;
  createdAt: string;
}

interface DirectExecutionBatchUnit {
  kind: "direct_operation";
  unitId: string;
  authorityRef: AuthorityRef;
  authorityHash: string;
  dedupeKey: string;
  priority: number;
  budget: ExecutionUnitBudget;
}

export type ExecutionUnit = ExecutionBatchUnit | DirectExecutionBatchUnit;

export interface ExecutionUnitBudget {
  maxProviderTurns: number;
  maxEquivalentCostUsd: number;
  maxMechanicalOverheadUsd: number;
  maxActiveTimeMs: number;
  maxHumanDecisions: number;
}

export interface DeliveryUnitReadiness {
  schemaVersion: typeof ROADMAP_DELIVERY_SCHEMA_VERSION;
  app: string;
  unitId: string;
  membershipHash: string;
  roadmapRef: AuthorityRef;
  frontierHash: string;
  validationRef: AuthorityRef;
  validationContractHash: string;
  routingSnapshotHash: string;
  readyAt: string;
}

export interface ExecutionBatch {
  schemaVersion: typeof ROADMAP_DELIVERY_SCHEMA_VERSION;
  batchId: string;
  version: number;
  app: string;
  roadmapRef: AuthorityRef | null;
  frontierHash: string | null;
  units: ExecutionUnit[];
  manifestLimits?: {
    maxUnits: number;
    maxManifestBytes: number;
  };
  admittedAt: string;
}

type ExecutionUnitJournalState =
  | "admitted"
  | "planning"
  | "claimed"
  | "running"
  | "reviewing"
  | "approved"
  | "returned"
  | "failed"
  | "completed";

interface ExecutionUnitJournal {
  schemaVersion: typeof ROADMAP_DELIVERY_SCHEMA_VERSION;
  app: string;
  batchRef: AuthorityRef;
  unitId: string;
  unitIdentityHash: string;
  state: ExecutionUnitJournalState;
  budget: ExecutionUnitBudget;
  usage: {
    providerTurns: number;
    equivalentCostUsd: number;
    mechanicalOverheadUsd: number;
    activeTimeMs: number;
    humanDecisions: number;
  };
  episodeBindingRef: AuthorityRef | null;
  claimSettlementId: string | null;
  evidenceRefs: AuthorityRef[];
  candidateHead: string | null;
  pullRequestNumber: number | null;
  outcome: "completed" | "returned" | "failed" | null;
  updatedAt: string;
}

export interface ExecutionBatchDisposition {
  schemaVersion: typeof ROADMAP_DELIVERY_SCHEMA_VERSION;
  app: string;
  batchRef: AuthorityRef;
  units: Array<{
    unitId: string;
    outcome: "completed" | "returned" | "failed";
    journalHash: string;
  }>;
  completedAt: string;
}

export interface DeliveryEpisodeBinding {
  schemaVersion: typeof ROADMAP_DELIVERY_SCHEMA_VERSION;
  app: string;
  unitId: string;
  membershipHash: string;
  roadmapRef: AuthorityRef;
  readinessRef: AuthorityRef;
  validationRef: AuthorityRef;
  validationContractHash: string;
  batchRef: AuthorityRef;
  episodeId: string;
  episodePlanVersion: number;
  episodePlanHash: string;
  createdAt: string;
}

interface DirectEpisodeBinding {
  schemaVersion: typeof ROADMAP_DELIVERY_SCHEMA_VERSION;
  app: string;
  unitId: string;
  directAuthorityRef: AuthorityRef;
  batchRef: AuthorityRef;
  episodeId: string;
  episodePlanVersion: number;
  episodePlanHash: string;
  createdAt: string;
}

interface DeliveryUnitClaimPayload {
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
}

export interface DeliveryUnitClaim {
  disposition: DurableClaimDisposition;
  record: DurableClaimRecord<DeliveryUnitClaimPayload>;
  token?: DurableClaimToken;
}

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

type DeliveryEpisodeFacts = Omit<EpisodeIntentFacts, "episodeId" | "app" | "roles" | "creatorScope">;

const CLAIM_NAMESPACE = "planning/delivery-unit-claims";
const DEFAULT_EXECUTION_BATCH_MAX_UNITS = 8;
const DEFAULT_EXECUTION_BATCH_MAX_MANIFEST_BYTES = 64 * 1024;
const DEFAULT_EXECUTION_UNIT_BUDGET: ExecutionUnitBudget = {
  maxProviderTurns: 24,
  maxEquivalentCostUsd: 100,
  maxMechanicalOverheadUsd: 10,
  maxActiveTimeMs: 2 * 60 * 60_000,
  maxHumanDecisions: 2,
};
const ID = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const MACHINE_ID = /^[A-Za-z0-9][A-Za-z0-9._*:/-]{0,255}$/;
const HASH = /^[a-f0-9]{64}$/;
const CANDIDATE_HEAD = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/;
const ROADMAP_MUTATION_LOCK = {
  staleMs: 30_000,
  maxWaitMs: 31_000,
  retryMinMs: 2,
  retryMaxMs: 8,
} as const;

interface CurrentRoadmapPointer {
  schemaVersion: typeof ROADMAP_DELIVERY_SCHEMA_VERSION;
  app: string;
  ref: AuthorityRef;
  updatedAt: string;
}

interface CurrentValidationCatalogPointer {
  schemaVersion: typeof VALIDATION_CATALOG_SCHEMA_VERSION;
  app: string;
  ref: AuthorityRef;
  updatedAt: string;
}

interface CurrentValidationContractPointer {
  schemaVersion: typeof VALIDATION_CONTRACT_SCHEMA_VERSION;
  app: string;
  unitId: string;
  ref: AuthorityRef;
  updatedAt: string;
}

const VALIDATION_MUTATION_LOCK = ROADMAP_MUTATION_LOCK;

export async function acceptBacklogSnapshot(input: {
  root: string;
  snapshot: BacklogSnapshot;
  project?: RoadmapDeliveryProjector;
}): Promise<AcceptedAuthority<BacklogSnapshot>> {
  assertBacklogSnapshot(input.snapshot);
  if (
    input.snapshot.completeness !== "complete" ||
    input.snapshot.pagination.hasNextPage ||
    input.snapshot.pagination.unavailablePages.length > 0
  ) {
    throw new RoadmapDeliveryError(
      "backlog_incomplete",
      `snapshot ${input.snapshot.snapshotId}@${input.snapshot.version} is ${input.snapshot.completeness} ` +
        `with ${input.snapshot.pagination.unavailablePages.length} unavailable page(s)`,
    );
  }
  const accepted = await persistAuthority(
    input.root,
    input.snapshot.app,
    "backlog_snapshot",
    input.snapshot.snapshotId,
    input.snapshot.version,
    input.snapshot,
  );
  await projectAccepted(input.root, input.snapshot.app, accepted, input.project);
  return accepted;
}

export function deriveBacklogDelta(
  previous: AcceptedAuthority<BacklogSnapshot>,
  current: AcceptedAuthority<BacklogSnapshot>,
): BacklogDelta {
  if (previous.value.app !== current.value.app) {
    throw new RoadmapDeliveryError("roadmap_invalid", "a backlog delta cannot cross apps");
  }
  const before = new Map(previous.value.issues.map((issue) => [issue.issueNumber, issue]));
  const after = new Map(current.value.issues.map((issue) => [issue.issueNumber, issue]));
  const addedIssueNumbers = [...after.keys()].filter((issue) => !before.has(issue)).sort(numeric);
  const removedIssueNumbers = [...before.keys()].filter((issue) => !after.has(issue)).sort(numeric);
  const changedIssueNumbers: number[] = [];
  const unchangedIssueNumbers: number[] = [];
  for (const issueNumber of [...before.keys()].filter((issue) => after.has(issue)).sort(numeric)) {
    if (stableHash(before.get(issueNumber)) === stableHash(after.get(issueNumber))) {
      unchangedIssueNumbers.push(issueNumber);
    } else {
      changedIssueNumbers.push(issueNumber);
    }
  }
  return {
    previousSnapshotRef: previous.ref,
    currentSnapshotRef: current.ref,
    addedIssueNumbers,
    removedIssueNumbers,
    changedIssueNumbers,
    unchangedIssueNumbers,
  };
}

export async function acceptRoadmapPlan(input: {
  root: string;
  plan: RoadmapPlan;
  project?: RoadmapDeliveryProjector;
}): Promise<AcceptedRoadmapPlan> {
  assertRoadmapPlan(input.plan);
  const snapshot = await requireAuthority<BacklogSnapshot>(
    input.root,
    input.plan.app,
    input.plan.backlogSnapshotRef,
    "backlog_snapshot",
    "backlog_incomplete",
  );
  assertBacklogSnapshot(snapshot.value);
  if (snapshot.value.completeness !== "complete" || snapshot.value.pagination.hasNextPage) {
    throw new RoadmapDeliveryError("backlog_incomplete", "RoadmapPlan names an incomplete backlog snapshot");
  }
  assertRoadmapAccounting(input.plan, snapshot.value);
  assertRoadmapRoutingFrontier(input.plan, snapshot.value);
  const accepted = await withFileLock(
    roadmapMutationLockPath(input.root, input.plan.app),
    ROADMAP_MUTATION_LOCK,
    async () => {
      const current = await readCurrentRoadmapPlan(input.root, input.plan.app);
      assertRoadmapRevision(input.plan, current);
      const persisted = await persistAuthority(
        input.root,
        input.plan.app,
        "roadmap_plan",
        input.plan.planId,
        input.plan.version,
        input.plan,
      );
      const pointer: CurrentRoadmapPointer = {
        schemaVersion: ROADMAP_DELIVERY_SCHEMA_VERSION,
        app: input.plan.app,
        ref: persisted.ref,
        updatedAt: input.plan.acceptedAt,
      };
      await writeLoopFileAtomic(
        currentRoadmapPointerPath(input.root, input.plan.app),
        `${JSON.stringify(pointer, null, 2)}\n`,
      );
      return persisted;
    },
  );
  await projectAccepted(input.root, input.plan.app, accepted, input.project);
  return {
    ...accepted,
    frontierHash: stableHash(input.plan.readyFrontier),
  };
}

export async function readCurrentRoadmapPlan(
  root: string,
  app: string,
): Promise<AcceptedAuthority<RoadmapPlan> | undefined> {
  const pointerPath = currentRoadmapPointerPath(root, app);
  if (!existsSync(pointerPath)) return undefined;
  let pointer: unknown;
  try {
    pointer = JSON.parse(await readFile(pointerPath, "utf8")) as unknown;
  } catch (error) {
    throw new RoadmapDeliveryError(
      "authority_corrupt",
      `current RoadmapPlan pointer is unreadable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!isCurrentRoadmapPointer(pointer) || pointer.app !== app) {
    throw new RoadmapDeliveryError("authority_corrupt", "current RoadmapPlan pointer is invalid");
  }
  return requireAuthority<RoadmapPlan>(root, app, pointer.ref, "roadmap_plan", "roadmap_missing");
}

export async function reconcileRoadmapProjections(input: {
  root: string;
  roadmap: AcceptedRoadmapPlan;
  snapshot: AcceptedAuthority<BacklogSnapshot>;
  readiness: readonly AcceptedAuthority<DeliveryUnitReadiness>[];
  current: readonly RoadmapIssueProjection[];
  now: Date;
}): Promise<RoadmapProjectionRepair[]> {
  const [persistedRoadmap, persistedSnapshot] = await Promise.all([
    requireAuthority<RoadmapPlan>(
      input.root,
      input.roadmap.value.app,
      input.roadmap.ref,
      "roadmap_plan",
      "roadmap_missing",
    ),
    requireAuthority<BacklogSnapshot>(
      input.root,
      input.roadmap.value.app,
      input.snapshot.ref,
      "backlog_snapshot",
      "backlog_incomplete",
    ),
  ]);
  const currentRoadmap = await readCurrentRoadmapPlan(input.root, input.roadmap.value.app);
  if (
    currentRoadmap === undefined ||
    !sameAuthorityRef(currentRoadmap.ref, input.roadmap.ref) ||
    stableHash(persistedRoadmap.value) !== stableHash(input.roadmap.value) ||
    stableHash(persistedSnapshot.value) !== stableHash(input.snapshot.value)
  ) {
    throw new RoadmapDeliveryError("projection_contradiction", "projection inputs are not current durable authority");
  }
  if (!sameAuthorityRef(input.roadmap.value.backlogSnapshotRef, input.snapshot.ref)) {
    throw new RoadmapDeliveryError("projection_contradiction", "projection snapshot does not belong to RoadmapPlan");
  }
  const currentByIssue = new Map(input.current.map((projection) => [projection.issueNumber, projection]));
  const unitByIssue = new Map<number, RoadmapDeliveryUnit>();
  for (const unit of input.roadmap.value.deliveryUnits) {
    for (const issueNumber of unit.issueNumbers) unitByIssue.set(issueNumber, unit);
  }
  const ready = new Set<string>();
  for (const supplied of input.readiness) {
    const entry = await requireAuthority<DeliveryUnitReadiness>(
      input.root,
      input.roadmap.value.app,
      supplied.ref,
      "delivery_unit_readiness",
      "validation_incomplete",
    );
    if (stableHash(entry.value) !== stableHash(supplied.value)) {
      throw new RoadmapDeliveryError(
        "projection_contradiction",
        "readiness projection input differs from durable authority",
      );
    }
    assertAuthorityRef(entry.ref, "delivery_unit_readiness");
    assertDeliveryUnitReadinessShape(entry.value);
    if (stableHash(entry.value) !== entry.ref.sha256) {
      throw new RoadmapDeliveryError("authority_corrupt", "readiness projection input is not content-bound");
    }
    if (
      sameAuthorityRef(entry.value.roadmapRef, input.roadmap.ref) &&
      entry.value.frontierHash === input.roadmap.frontierHash &&
      entry.value.validationContractHash === entry.value.validationRef.sha256
    ) {
      const unit = requireUnit(input.roadmap.value, entry.value.unitId);
      const validation = await requireAuthority<ValidationContract>(
        input.root,
        input.roadmap.value.app,
        entry.value.validationRef,
        "validation_contract",
        "validation_contract_missing",
      );
      const currentValidation = await readCurrentValidationContract(
        input.root,
        input.roadmap.value.app,
        entry.value.unitId,
      );
      await assertCurrentValidationCatalogRef(input.root, input.roadmap.value.app, validation.value.catalogRef);
      await assertValidationWaiverAuthorities(input.root, validation.value);
      assertValidationWaiversCurrent(validation.value, input.now);
      if (
        currentValidation === undefined ||
        !sameAuthorityRef(currentValidation.ref, validation.ref) ||
        entry.value.membershipHash !== unitMembershipHash(unit.issueNumbers)
      ) {
        throw new RoadmapDeliveryError("projection_contradiction", "readiness projection lineage is stale");
      }
      if (ready.has(entry.value.unitId)) {
        throw new RoadmapDeliveryError(
          "projection_contradiction",
          `multiple readiness authorities name ${entry.value.unitId}`,
        );
      }
      ready.add(entry.value.unitId);
    }
  }
  const excludedUnits = new Set<string>();
  for (const unit of input.roadmap.value.deliveryUnits) {
    const snapshotExcluded = unit.issueNumbers.some((issueNumber) => {
      const issue = input.snapshot.value.issues.find((candidate) => candidate.issueNumber === issueNumber);
      return (
        issue === undefined ||
        issue.routing !== "automated" ||
        autonomousExecutionExclusionLabel(issue.observedLabels) !== undefined
      );
    });
    const currentExcluded = unit.issueNumbers.some((issueNumber) => {
      const current = currentByIssue.get(issueNumber);
      return current !== undefined && autonomousExecutionExclusionLabel(current.labels) !== undefined;
    });
    if (snapshotExcluded || currentExcluded) excludedUnits.add(unit.unitId);
  }
  return input.snapshot.value.issues
    .map((issue): RoadmapProjectionRepair => {
      const unit = unitByIssue.get(issue.issueNumber);
      if (unit === undefined) {
        throw new RoadmapDeliveryError("issue_unaccounted", `projection has no unit for #${issue.issueNumber}`);
      }
      const membershipHash = unitMembershipHash(unit.issueNumbers);
      const prior = currentByIssue.get(issue.issueNumber);
      const desired = new Set(
        (prior?.labels ?? []).filter((label) => label !== "planning:preplanned" && label !== "op:ready"),
      );
      desired.add("planning:preplanned");
      if (ready.has(unit.unitId) && !excludedUnits.has(unit.unitId)) {
        desired.add("op:ready");
      }
      const labels = [...desired].sort();
      const authorityMatches =
        prior !== undefined &&
        prior.authorityRef !== null &&
        sameAuthorityRef(prior.authorityRef, input.roadmap.ref) &&
        prior.unitId === unit.unitId &&
        prior.membershipHash === membershipHash;
      const labelsMatch = prior !== undefined && stableHash([...prior.labels].sort()) === stableHash(labels);
      const reason: RoadmapProjectionRepair["reason"] =
        prior === undefined
          ? "missing"
          : authorityMatches && labelsMatch
            ? "current"
            : prior.authorityRef === null
              ? "contradictory"
              : "stale";
      return {
        issueNumber: issue.issueNumber,
        labels,
        authorityRef: input.roadmap.ref,
        unitId: unit.unitId,
        membershipHash,
        reason,
      };
    })
    .sort((left, right) => left.issueNumber - right.issueNumber);
}

export async function acceptValidationCatalog(input: {
  root: string;
  catalog: ValidationCatalog;
  project?: RoadmapDeliveryProjector;
}): Promise<AcceptedAuthority<ValidationCatalog>> {
  assertValidationCatalogShape(input.catalog);
  const accepted = await withFileLock(
    validationMutationLockPath(input.root, input.catalog.app),
    VALIDATION_MUTATION_LOCK,
    async () => {
      const current = await readCurrentValidationCatalog(input.root, input.catalog.app);
      assertValidationCatalogRevision(input.catalog, current);
      const persisted = await persistAuthority(
        input.root,
        input.catalog.app,
        "validation_catalog",
        input.catalog.catalogId,
        input.catalog.version,
        input.catalog,
      );
      const pointer: CurrentValidationCatalogPointer = {
        schemaVersion: VALIDATION_CATALOG_SCHEMA_VERSION,
        app: input.catalog.app,
        ref: persisted.ref,
        updatedAt: input.catalog.acceptedAt,
      };
      await writeLoopFileAtomic(
        currentValidationCatalogPointerPath(input.root, input.catalog.app),
        `${JSON.stringify(pointer, null, 2)}\n`,
      );
      return persisted;
    },
  );
  await projectAccepted(input.root, input.catalog.app, accepted, input.project);
  return accepted;
}

export async function readCurrentValidationCatalog(
  root: string,
  app: string,
): Promise<AcceptedAuthority<ValidationCatalog> | undefined> {
  const pointer = await readCurrentAuthorityPointer(
    currentValidationCatalogPointerPath(root, app),
    "validation_catalog",
    app,
  );
  if (pointer === undefined) return undefined;
  const catalog = await requireAuthority<ValidationCatalog>(
    root,
    app,
    pointer,
    "validation_catalog",
    "validation_catalog_missing",
  );
  assertValidationCatalogShape(catalog.value);
  return catalog;
}

async function assertCurrentValidationCatalogRef(root: string, app: string, expected: AuthorityRef): Promise<void> {
  const current = await readCurrentValidationCatalog(root, app);
  if (current === undefined || !sameAuthorityRef(current.ref, expected)) {
    throw new RoadmapDeliveryError(
      "validation_catalog_stale",
      "validation lineage does not bind the current accepted harness catalog",
    );
  }
}

async function assertCurrentRoadmapRef(
  root: string,
  app: string,
  expected: AuthorityRef,
  expectedFrontierHash?: string,
): Promise<void> {
  const current = await readCurrentRoadmapPlan(root, app);
  if (
    current === undefined ||
    !sameAuthorityRef(current.ref, expected) ||
    (expectedFrontierHash !== undefined && stableHash(current.value.readyFrontier) !== expectedFrontierHash)
  ) {
    throw new RoadmapDeliveryError(
      "frontier_stale",
      "delivery lineage does not bind the current RoadmapPlan and frontier",
    );
  }
}

function assertValidationWaiversCurrent(contract: ValidationContract, at: Date | string | undefined): void {
  const waivers = contract.obligations
    .map((obligation) => obligation.waiver)
    .filter((waiver): waiver is ValidationWaiver => waiver !== null);
  if (waivers.length === 0) return;
  if (at === undefined) {
    throw new RoadmapDeliveryError(
      "validation_waiver_invalid",
      "waived validation obligations require an explicit operation time",
    );
  }
  const observedAt = at instanceof Date ? at.getTime() : Date.parse(at);
  if (!Number.isFinite(observedAt)) {
    throw new RoadmapDeliveryError("validation_waiver_invalid", "waiver operation time is invalid");
  }
  const expired = waivers.find((waiver) => observedAt >= Date.parse(waiver.expiresAt));
  if (expired !== undefined) {
    throw new RoadmapDeliveryError(
      "validation_waiver_invalid",
      `waiver ${expired.waiverId} expired before this operation`,
    );
  }
}

function resolveCanonicalValidationCaseId(catalog: ValidationCatalog, id: string): string {
  return resolveValidationId(catalog.cases, id, "case");
}

export async function acceptValidationContract(input: {
  root: string;
  contract: ValidationContract;
  project?: RoadmapDeliveryProjector;
}): Promise<AcceptedAuthority<ValidationContract>> {
  assertValidationContractBaseShape(input.contract);
  const accepted = await withFileLock(
    validationMutationLockPath(input.root, input.contract.app),
    VALIDATION_MUTATION_LOCK,
    async () => {
      const roadmap = await requireAuthority<RoadmapPlan>(
        input.root,
        input.contract.app,
        input.contract.roadmapRef,
        "roadmap_plan",
        "roadmap_missing",
      );
      assertRoadmapPlan(roadmap.value);
      const currentRoadmap = await readCurrentRoadmapPlan(input.root, input.contract.app);
      if (currentRoadmap === undefined || !sameAuthorityRef(currentRoadmap.ref, roadmap.ref)) {
        throw new RoadmapDeliveryError(
          "frontier_stale",
          "validation contract does not bind the current accepted RoadmapPlan",
        );
      }
      const catalog = await requireAuthority<ValidationCatalog>(
        input.root,
        input.contract.app,
        input.contract.catalogRef,
        "validation_catalog",
        "validation_catalog_missing",
      );
      assertValidationCatalogShape(catalog.value);
      const currentCatalog = await readCurrentValidationCatalog(input.root, input.contract.app);
      if (currentCatalog === undefined || !sameAuthorityRef(currentCatalog.ref, catalog.ref)) {
        throw new RoadmapDeliveryError(
          "validation_catalog_stale",
          "validation contract does not bind the current accepted harness catalog",
        );
      }
      const unit = requireUnit(roadmap.value, input.contract.unitId);
      if (unitMembershipHash(unit.issueNumbers) !== input.contract.unitMembershipHash) {
        throw new RoadmapDeliveryError(
          "validation_contract_invalid",
          `contract ${input.contract.contractId} does not bind the accepted membership of ${unit.unitId}`,
        );
      }
      const canonical = canonicalizeValidationContract(input.contract, catalog.value);
      assertValidationContractPolicy(canonical, catalog.value);
      await assertValidationWaiverAuthorities(input.root, canonical);
      const expectedRef: AuthorityRef = {
        kind: "validation_contract",
        id: canonical.contractId,
        version: canonical.version,
        sha256: stableHash(canonical),
      };
      const current = await readCurrentValidationContract(input.root, input.contract.app, input.contract.unitId);
      assertValidationContractRevision(canonical, current);
      // Only semantically admissible canonical proposals enter the durable
      // lifecycle. A malformed attempt must not poison this id/version and
      // prevent a corrected retry.
      await ensureValidationProposalLifecycle(input.root, canonical);
      const lifecycle = await readValidationContractLifecycle(
        input.root,
        canonical.app,
        canonical.unitId,
        canonical.contractId,
        canonical.version,
      );
      if (lifecycle === undefined) {
        throw new RoadmapDeliveryError("authority_corrupt", "validation lifecycle proposal is missing");
      }
      if (lifecycle.state === "proposed") {
        await transitionValidationLifecycle(input.root, canonical, "validated", canonical.acceptedAt, null);
      } else if (lifecycle.state === "accepted") {
        if (lifecycle.acceptedRef === null || !sameAuthorityRef(lifecycle.acceptedRef, expectedRef)) {
          throw new RoadmapDeliveryError("authority_conflict", "accepted validation lifecycle differs from proposal");
        }
      } else if (lifecycle.state !== "validated") {
        throw new RoadmapDeliveryError(
          "validation_contract_stale",
          `cannot accept validation contract from ${lifecycle.state} lifecycle state`,
        );
      }
      const persisted = await persistAuthority(
        input.root,
        canonical.app,
        "validation_contract",
        canonical.contractId,
        canonical.version,
        canonical,
      );
      if (lifecycle.state !== "accepted") {
        await transitionValidationLifecycle(input.root, canonical, "accepted", canonical.acceptedAt, persisted.ref);
      }
      const pointer: CurrentValidationContractPointer = {
        schemaVersion: VALIDATION_CONTRACT_SCHEMA_VERSION,
        app: canonical.app,
        unitId: canonical.unitId,
        ref: persisted.ref,
        updatedAt: canonical.acceptedAt,
      };
      await writeLoopFileAtomic(
        currentValidationContractPointerPath(input.root, canonical.app, canonical.unitId),
        `${JSON.stringify(pointer, null, 2)}\n`,
      );
      if (canonical.predecessor !== null) {
        const predecessor = await requireAuthority<ValidationContract>(
          input.root,
          canonical.app,
          canonical.predecessor,
          "validation_contract",
          "validation_contract_stale",
        );
        await transitionPersistedValidationLifecycle(
          input.root,
          predecessor.value,
          "superseded",
          canonical.acceptedAt,
          persisted.ref,
        );
      }
      return persisted;
    },
  );
  await projectAccepted(input.root, input.contract.app, accepted, input.project);
  return accepted;
}

export async function readCurrentValidationContract(
  root: string,
  app: string,
  unitId: string,
): Promise<AcceptedAuthority<ValidationContract> | undefined> {
  assertId(unitId, "validation unit id");
  const pointer = await readCurrentAuthorityPointer(
    currentValidationContractPointerPath(root, app, unitId),
    "validation_contract",
    app,
    unitId,
  );
  if (pointer === undefined) return undefined;
  const contract = await requireAuthority<ValidationContract>(
    root,
    app,
    pointer,
    "validation_contract",
    "validation_contract_missing",
  );
  assertValidationContractBaseShape(contract.value);
  return contract;
}

export async function readValidationContractLifecycle(
  root: string,
  app: string,
  unitId: string,
  contractId: string,
  version: number,
): Promise<ValidationContractLifecycleRecord | undefined> {
  const path = validationContractLifecyclePath(root, app, unitId, contractId, version);
  if (!existsSync(path)) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    throw new RoadmapDeliveryError(
      "authority_corrupt",
      `validation lifecycle is unreadable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!isValidationContractLifecycleRecord(parsed)) {
    throw new RoadmapDeliveryError("authority_corrupt", "validation lifecycle record is invalid");
  }
  return parsed;
}

export async function acceptDeliveryUnitReadiness(input: {
  root: string;
  app: string;
  roadmapRef: AuthorityRef;
  expectedFrontierHash: string;
  validationRef: AuthorityRef;
  unitId: string;
  routing: RoutingSnapshotEntry[];
  readyAt: string;
  project?: RoadmapDeliveryProjector;
}): Promise<AcceptedAuthority<DeliveryUnitReadiness>> {
  const roadmap = await requireAuthority<RoadmapPlan>(
    input.root,
    input.app,
    input.roadmapRef,
    "roadmap_plan",
    "roadmap_missing",
  );
  assertRoadmapPlan(roadmap.value);
  const currentRoadmap = await readCurrentRoadmapPlan(input.root, input.app);
  const frontierHash = stableHash(roadmap.value.readyFrontier);
  if (
    currentRoadmap === undefined ||
    !sameAuthorityRef(currentRoadmap.ref, roadmap.ref) ||
    frontierHash !== input.expectedFrontierHash
  ) {
    throw new RoadmapDeliveryError("frontier_stale", "readiness does not bind the current frontier");
  }
  if (!roadmap.value.readyFrontier.includes(input.unitId)) {
    throw new RoadmapDeliveryError(
      "validation_incomplete",
      `${input.unitId} is not in the accepted validation-candidate frontier`,
    );
  }
  const unit = requireUnit(roadmap.value, input.unitId);
  assertRoutingEligible(unit, input.routing);
  const validation = await requireAuthority<ValidationContract>(
    input.root,
    input.app,
    input.validationRef,
    "validation_contract",
    "validation_contract_missing",
  );
  assertValidationContractBaseShape(validation.value);
  await assertValidationWaiverAuthorities(input.root, validation.value);
  assertValidationWaiversCurrent(validation.value, input.readyAt);
  await assertCurrentValidationCatalogRef(input.root, input.app, validation.value.catalogRef);
  const currentValidation = await readCurrentValidationContract(input.root, input.app, input.unitId);
  if (
    currentValidation === undefined ||
    !sameAuthorityRef(currentValidation.ref, validation.ref) ||
    !sameAuthorityRef(validation.value.roadmapRef, roadmap.ref) ||
    validation.value.unitMembershipHash !== unitMembershipHash(unit.issueNumbers)
  ) {
    throw new RoadmapDeliveryError(
      "validation_contract_stale",
      "readiness does not bind the current accepted validation contract",
    );
  }
  const readiness: DeliveryUnitReadiness = {
    schemaVersion: ROADMAP_DELIVERY_SCHEMA_VERSION,
    app: input.app,
    unitId: input.unitId,
    membershipHash: validation.value.unitMembershipHash,
    roadmapRef: roadmap.ref,
    frontierHash,
    validationRef: validation.ref,
    validationContractHash: validation.ref.sha256,
    routingSnapshotHash: routingSnapshotHash(unit, input.routing),
    readyAt: requireDateTime(input.readyAt, "delivery readiness readyAt"),
  };
  const accepted = await persistAuthority(
    input.root,
    input.app,
    "delivery_unit_readiness",
    input.unitId,
    validation.ref.version,
    readiness,
  );
  await projectAccepted(input.root, input.app, accepted, input.project);
  return accepted;
}

/** Complete direct-work authority. Ordinary prose and labels cannot create it. */
export async function acceptDirectExecutionUnit(input: {
  root: string;
  authority: DirectExecutionUnitAuthority;
  project?: RoadmapDeliveryProjector;
}): Promise<AcceptedAuthority<DirectExecutionUnitAuthority>> {
  assertDirectExecutionUnit(input.authority);
  const accepted = await persistAuthority(
    input.root,
    input.authority.app,
    "direct_execution_unit",
    input.authority.unitId,
    1,
    input.authority,
  );
  await projectAccepted(input.root, input.authority.app, accepted, input.project);
  return accepted;
}

/** Token-free admission. This function neither builds an EpisodeIntent nor calls EpisodePlanner. */
export async function admitExecutionBatch(input: {
  root: string;
  app: string;
  batchId: string;
  roadmapRef?: AuthorityRef;
  expectedFrontierHash?: string;
  orderedUnitIds?: string[];
  readinessRefs?: AuthorityRef[];
  directUnitRefs?: AuthorityRef[];
  budgetsByUnit?: Readonly<Record<string, ExecutionUnitBudget>>;
  maxUnits?: number;
  maxManifestBytes?: number;
  routing: RoutingSnapshotEntry[];
  admittedAt: string;
  project?: RoadmapDeliveryProjector;
}): Promise<AcceptedAuthority<ExecutionBatch>> {
  assertId(input.batchId, "batch id");
  const orderedUnitIds = input.orderedUnitIds ?? [];
  if (new Set(orderedUnitIds).size !== orderedUnitIds.length) {
    throw new RoadmapDeliveryError("batch_unit_duplicate", "a batch contains a duplicate unit");
  }
  const roadmap =
    input.roadmapRef === undefined
      ? undefined
      : await requireAuthority<RoadmapPlan>(input.root, input.app, input.roadmapRef, "roadmap_plan", "roadmap_missing");
  if (roadmap !== undefined) assertRoadmapPlan(roadmap.value);
  const currentRoadmap = roadmap === undefined ? undefined : await readCurrentRoadmapPlan(input.root, input.app);
  if (roadmap !== undefined && (currentRoadmap === undefined || !sameAuthorityRef(currentRoadmap.ref, roadmap.ref))) {
    throw new RoadmapDeliveryError(
      "frontier_stale",
      `${renderAuthorityRef(roadmap.ref)} is not the current accepted RoadmapPlan`,
    );
  }
  const frontierHash = roadmap === undefined ? null : stableHash(roadmap.value.readyFrontier);
  if (frontierHash !== (input.expectedFrontierHash ?? null)) {
    throw new RoadmapDeliveryError(
      "frontier_stale",
      `expected ${input.expectedFrontierHash ?? "no frontier"}, accepted frontier is ${frontierHash ?? "none"}`,
    );
  }
  if (roadmap === undefined && orderedUnitIds.length > 0) {
    throw new RoadmapDeliveryError("roadmap_missing", "roadmap code units require a RoadmapPlan");
  }
  if (roadmap !== undefined) {
    const positions = new Map(roadmap.value.readyFrontier.map((id, index) => [id, index]));
    const deterministic = [...orderedUnitIds].sort(
      (left, right) =>
        (positions.get(left) ?? Number.MAX_SAFE_INTEGER) - (positions.get(right) ?? Number.MAX_SAFE_INTEGER) ||
        left.localeCompare(right),
    );
    if (stableHash(deterministic) !== stableHash(orderedUnitIds)) {
      throw new RoadmapDeliveryError(
        "batch_hard_constraint_failed",
        "batch code units are not in deterministic accepted-frontier order",
      );
    }
  }
  const readinessByUnit = new Map<string, AcceptedAuthority<DeliveryUnitReadiness>>();
  for (const ref of input.readinessRefs ?? []) {
    const readiness = await requireAuthority<DeliveryUnitReadiness>(
      input.root,
      input.app,
      ref,
      "delivery_unit_readiness",
      "validation_incomplete",
    );
    assertDeliveryUnitReadinessShape(readiness.value);
    if (readinessByUnit.has(readiness.value.unitId)) {
      throw new RoadmapDeliveryError(
        "validation_contract_invalid",
        `multiple readiness records supplied for ${readiness.value.unitId}`,
      );
    }
    readinessByUnit.set(readiness.value.unitId, readiness);
  }
  const validationByUnit = new Map<string, AcceptedAuthority<ValidationContract>>();
  for (const readiness of readinessByUnit.values()) {
    const ref = readiness.value.validationRef;
    const validation = await requireAuthority<ValidationContract>(
      input.root,
      input.app,
      ref,
      "validation_contract",
      "validation_contract_missing",
    );
    assertValidationContractBaseShape(validation.value);
    await assertCurrentValidationCatalogRef(input.root, input.app, validation.value.catalogRef);
    if (validationByUnit.has(validation.value.unitId)) {
      throw new RoadmapDeliveryError(
        "validation_contract_invalid",
        `multiple validation contracts supplied for ${validation.value.unitId}`,
      );
    }
    validationByUnit.set(validation.value.unitId, validation);
  }
  const codeUnits = await Promise.all(
    orderedUnitIds.map(async (unitId): Promise<ExecutionBatchUnit> => {
      if (roadmap === undefined || frontierHash === null) {
        throw new RoadmapDeliveryError("roadmap_missing", `${unitId} has no RoadmapPlan`);
      }
      if (!roadmap.value.readyFrontier.includes(unitId)) {
        throw new RoadmapDeliveryError(
          "batch_hard_constraint_failed",
          `${unitId} is not in the exact accepted ready frontier`,
        );
      }
      const unit = requireUnit(roadmap.value, unitId);
      assertRoutingEligible(unit, input.routing);
      const readiness = readinessByUnit.get(unitId);
      if (readiness === undefined) {
        throw new RoadmapDeliveryError("validation_incomplete", `${unitId} has no accepted readiness authority`);
      }
      const validation = validationByUnit.get(unitId);
      if (validation === undefined) {
        throw new RoadmapDeliveryError("validation_incomplete", `${unitId} has no accepted validation contract`);
      }
      assertValidationWaiversCurrent(validation.value, input.admittedAt);
      await assertValidationWaiverAuthorities(input.root, validation.value);
      if (!sameAuthorityRef(validation.value.roadmapRef, roadmap.ref)) {
        throw new RoadmapDeliveryError(
          "validation_contract_invalid",
          `${unitId} validation contract belongs to another RoadmapPlan`,
        );
      }
      const membershipHash = unitMembershipHash(unit.issueNumbers);
      const currentValidation =
        validation === undefined ? undefined : await readCurrentValidationContract(input.root, input.app, unitId);
      if (
        validation.value.unitMembershipHash !== membershipHash ||
        readiness.value.membershipHash !== membershipHash ||
        !sameAuthorityRef(readiness.value.roadmapRef, roadmap.ref) ||
        readiness.value.frontierHash !== frontierHash ||
        !sameAuthorityRef(readiness.value.validationRef, validation.ref) ||
        readiness.value.validationContractHash !== validation.ref.sha256 ||
        readiness.value.routingSnapshotHash !== routingSnapshotHash(unit, input.routing) ||
        currentValidation === undefined ||
        !sameAuthorityRef(currentValidation.ref, validation.ref)
      ) {
        throw new RoadmapDeliveryError(
          "validation_contract_stale",
          `${unitId} readiness or validation lineage is stale`,
        );
      }
      return {
        kind: "roadmap_code",
        unitId,
        issueNumbers: [...unit.issueNumbers],
        membershipHash,
        readinessRef: readiness.ref,
        validationRef: validation.ref,
        validationContractHash: validation.ref.sha256,
        priority: unit.priority,
        budget: normalizeExecutionUnitBudget(input.budgetsByUnit?.[unitId]),
      };
    }),
  );
  const directUnits: DirectExecutionBatchUnit[] = [];
  for (const ref of input.directUnitRefs ?? []) {
    const direct = await requireAuthority<DirectExecutionUnitAuthority>(
      input.root,
      input.app,
      ref,
      "direct_execution_unit",
      "direct_unit_incomplete",
    );
    assertDirectExecutionUnit(direct.value);
    if (direct.value.app !== input.app) {
      throw new RoadmapDeliveryError("batch_hard_constraint_failed", "a batch cannot cross apps");
    }
    directUnits.push({
      kind: "direct_operation",
      unitId: direct.value.unitId,
      authorityRef: direct.ref,
      authorityHash: direct.ref.sha256,
      dedupeKey: direct.value.dedupeKey,
      priority: 0,
      budget: normalizeExecutionUnitBudget(input.budgetsByUnit?.[direct.value.unitId] ?? direct.value.admittedBudget),
    });
  }
  directUnits.sort((left, right) => left.priority - right.priority || left.unitId.localeCompare(right.unitId));
  const units: ExecutionUnit[] = [...codeUnits, ...directUnits];
  if (new Set(units.map((unit) => unit.unitId)).size !== units.length) {
    throw new RoadmapDeliveryError("batch_unit_duplicate", "a batch contains a duplicate execution unit");
  }
  if (units.length === 0) {
    throw new RoadmapDeliveryError("batch_hard_constraint_failed", "a batch must contain a unit");
  }
  const maxUnits = input.maxUnits ?? DEFAULT_EXECUTION_BATCH_MAX_UNITS;
  const maxManifestBytes = input.maxManifestBytes ?? DEFAULT_EXECUTION_BATCH_MAX_MANIFEST_BYTES;
  if (!Number.isInteger(maxUnits) || maxUnits <= 0 || units.length > maxUnits) {
    throw new RoadmapDeliveryError(
      "batch_manifest_too_large",
      `batch admits ${units.length} units; maximum is ${maxUnits}`,
    );
  }
  const batch: ExecutionBatch = {
    schemaVersion: ROADMAP_DELIVERY_SCHEMA_VERSION,
    batchId: input.batchId,
    version: 1,
    app: input.app,
    roadmapRef: roadmap?.ref ?? null,
    frontierHash,
    units,
    manifestLimits: { maxUnits, maxManifestBytes },
    admittedAt: requireDateTime(input.admittedAt, "batch admittedAt"),
  };
  if (Buffer.byteLength(JSON.stringify(batch), "utf8") > maxManifestBytes) {
    throw new RoadmapDeliveryError("batch_manifest_too_large", `batch manifest exceeds ${maxManifestBytes} bytes`);
  }
  const accepted = await withFileLock(batchMutationLockPath(input.root, input.app), ROADMAP_MUTATION_LOCK, async () => {
    const existingPath = batchAuthorityPath(input.root, input.app, batch.batchId, batch.version);
    if (existsSync(existingPath)) {
      const existing = await readAuthorityFile<ExecutionBatch>(existingPath);
      const replay = { ...batch, admittedAt: existing.value.admittedAt };
      if (stableHash(existing.value) !== stableHash(replay)) {
        throw new RoadmapDeliveryError("authority_conflict", `batch ${batch.batchId} already differs`);
      }
      for (const unit of units) await ensureExecutionUnitJournal(input.root, existing, unit);
      return existing;
    }
    await assertNoActiveExecutionUnitOverlap(input.root, input.app, units);
    const persisted = await persistAuthority(
      input.root,
      input.app,
      "execution_batch",
      batch.batchId,
      batch.version,
      batch,
    );
    for (const unit of units) await ensureExecutionUnitJournal(input.root, persisted, unit);
    return persisted;
  });
  await projectAccepted(input.root, input.app, accepted, input.project);
  return accepted;
}

/** Lazily normalize exactly one admitted unit through the real EpisodePlanner coordinator. */
export async function normalizeDeliveryUnitEpisode(input: {
  root: string;
  app: AppEntry;
  roles: readonly RoleConfig[];
  batchRef: AuthorityRef;
  unitId: string;
  facts: DeliveryEpisodeFacts;
  creatorScope?: CreatorEpisodeScope;
  propose?: EpisodePlannerProposer;
  providerOperations?: readonly string[];
  workflowTemplates?: EpisodePlanningPolicyOptions["workflowTemplates"];
  independentReview?: EpisodePlanningPolicyOptions["independentReview"];
  now?: () => Date;
  project?: RoadmapDeliveryProjector;
}): Promise<{
  prepared: PreparedEpisodePlan;
  plan: EpisodePlan;
  binding: AcceptedAuthority<DeliveryEpisodeBinding>;
}> {
  const batch = await requireAuthority<ExecutionBatch>(
    input.root,
    input.app.name,
    input.batchRef,
    "execution_batch",
    "batch_hard_constraint_failed",
  );
  assertExecutionBatchShape(batch.value);
  const batchUnit = batch.value.units.find((candidate) => candidate.unitId === input.unitId);
  if (batchUnit === undefined) {
    throw new RoadmapDeliveryError(
      "batch_hard_constraint_failed",
      `${input.unitId} is not admitted in ${batch.value.batchId}`,
    );
  }
  if (batchUnit.kind === "direct_operation") {
    throw new RoadmapDeliveryError(
      "batch_hard_constraint_failed",
      `${input.unitId} is direct work; use normalizeDirectExecutionUnitEpisode`,
    );
  }
  if (batch.value.roadmapRef === null || batch.value.frontierHash === null) {
    throw new RoadmapDeliveryError("roadmap_missing", "roadmap code batch lost roadmap authority");
  }
  const roadmap = await requireAuthority<RoadmapPlan>(
    input.root,
    input.app.name,
    batch.value.roadmapRef,
    "roadmap_plan",
    "roadmap_missing",
  );
  await assertCurrentRoadmapRef(input.root, input.app.name, roadmap.ref, batch.value.frontierHash);
  const unit = requireUnit(roadmap.value, input.unitId);
  const readiness = await requireAuthority<DeliveryUnitReadiness>(
    input.root,
    input.app.name,
    batchUnit.readinessRef,
    "delivery_unit_readiness",
    "validation_incomplete",
  );
  assertDeliveryUnitReadinessShape(readiness.value);
  const validation = await requireAuthority<ValidationContract>(
    input.root,
    input.app.name,
    batchUnit.validationRef,
    "validation_contract",
    "validation_contract_missing",
  );
  assertValidationContractBaseShape(validation.value);
  await assertValidationWaiverAuthorities(input.root, validation.value);
  await assertCurrentValidationCatalogRef(input.root, input.app.name, validation.value.catalogRef);
  const currentValidation = await readCurrentValidationContract(input.root, input.app.name, input.unitId);
  if (
    currentValidation === undefined ||
    !sameAuthorityRef(currentValidation.ref, validation.ref) ||
    !sameAuthorityRef(readiness.value.validationRef, validation.ref) ||
    readiness.value.validationContractHash !== validation.ref.sha256 ||
    batchUnit.validationContractHash !== validation.ref.sha256
  ) {
    throw new RoadmapDeliveryError(
      "validation_contract_stale",
      "EpisodePlan normalization requires the current readiness and validation hash",
    );
  }
  const operationNow = input.now?.() ?? new Date();
  assertValidationWaiversCurrent(validation.value, operationNow);
  const episodeId = `delivery-${stableHash({
    app: input.app.name,
    unitId: input.unitId,
    roadmap: roadmap.ref,
    validation: validation.ref,
  }).slice(0, 32)}`;
  const authorityInputs = [
    renderAuthorityRef(roadmap.ref),
    renderAuthorityRef(readiness.ref),
    renderAuthorityRef(validation.ref),
    renderAuthorityRef(batch.ref),
  ];
  const creatorScope =
    input.creatorScope === undefined ? undefined : bindCreatorScope(input.creatorScope, authorityInputs);
  const intent = buildEpisodeIntent({
    ...input.facts,
    episodeId,
    app: input.app,
    roles: input.roles,
    ...(creatorScope === undefined ? {} : { creatorScope }),
  });
  const prepared = await prepareEpisodePlan({
    root: input.root,
    app: input.app,
    roles: input.roles,
    intent,
    ...(input.providerOperations === undefined ? {} : { providerOperations: input.providerOperations }),
    ...(input.workflowTemplates === undefined ? {} : { workflowTemplates: input.workflowTemplates }),
    ...(input.independentReview === undefined ? {} : { independentReview: input.independentReview }),
    ...(input.propose === undefined ? {} : { propose: input.propose }),
    now: () => operationNow,
  });
  const validationLineage = renderAuthorityRef(validation.ref);
  if (prepared.planningTurnSkipped && !prepared.plan.creatorProvenance?.evidenceRefs.includes(validationLineage)) {
    throw new RoadmapDeliveryError(
      "validation_contract_invalid",
      "EpisodePlan dropped the exact validation-contract ref and hash",
    );
  }
  const bindingValue: DeliveryEpisodeBinding = {
    schemaVersion: ROADMAP_DELIVERY_SCHEMA_VERSION,
    app: input.app.name,
    unitId: input.unitId,
    membershipHash: unitMembershipHash(unit.issueNumbers),
    roadmapRef: roadmap.ref,
    readinessRef: readiness.ref,
    validationRef: validation.ref,
    validationContractHash: validation.ref.sha256,
    batchRef: batch.ref,
    episodeId,
    episodePlanVersion: prepared.plan.version,
    episodePlanHash: episodePlanHash(prepared.plan),
    createdAt: prepared.plan.createdAt,
  };
  const binding = await persistAuthority(
    input.root,
    input.app.name,
    "delivery_episode_binding",
    input.unitId,
    prepared.plan.version,
    bindingValue,
  );
  await markExecutionUnitPlanned(input.root, input.app.name, batch.ref, input.unitId, binding.ref, operationNow);
  await projectAccepted(input.root, input.app.name, binding, input.project);
  return { prepared, plan: prepared.plan, binding };
}

/** Bind an EpisodePlan produced by the production ticket planner to the exact
 * admitted roadmap/validation join. This is the non-shortcut lazy path. */
export async function bindDeliveryUnitEpisodePlan(input: {
  root: string;
  app: string;
  batchRef: AuthorityRef;
  unitId: string;
  plan: EpisodePlan;
  now: Date;
  project?: RoadmapDeliveryProjector;
}): Promise<AcceptedAuthority<DeliveryEpisodeBinding>> {
  const batch = await requireAuthority<ExecutionBatch>(
    input.root,
    input.app,
    input.batchRef,
    "execution_batch",
    "batch_hard_constraint_failed",
  );
  assertExecutionBatchShape(batch.value);
  const batchUnit = batch.value.units.find((candidate) => candidate.unitId === input.unitId);
  if (batchUnit === undefined || batchUnit.kind === "direct_operation") {
    throw new RoadmapDeliveryError("batch_hard_constraint_failed", `${input.unitId} is not admitted code work`);
  }
  if (batch.value.roadmapRef === null || batch.value.frontierHash === null) {
    throw new RoadmapDeliveryError("roadmap_missing", "code batch lost RoadmapPlan lineage");
  }
  const roadmap = await requireAuthority<RoadmapPlan>(
    input.root,
    input.app,
    batch.value.roadmapRef,
    "roadmap_plan",
    "roadmap_missing",
  );
  await assertCurrentRoadmapRef(input.root, input.app, roadmap.ref, batch.value.frontierHash);
  const unit = requireUnit(roadmap.value, input.unitId);
  const readiness = await requireAuthority<DeliveryUnitReadiness>(
    input.root,
    input.app,
    batchUnit.readinessRef,
    "delivery_unit_readiness",
    "validation_incomplete",
  );
  const validation = await requireAuthority<ValidationContract>(
    input.root,
    input.app,
    batchUnit.validationRef,
    "validation_contract",
    "validation_contract_missing",
  );
  assertValidationWaiversCurrent(validation.value, input.now);
  await assertValidationWaiverAuthorities(input.root, validation.value);
  const currentValidation = await readCurrentValidationContract(input.root, input.app, input.unitId);
  if (
    currentValidation === undefined ||
    !sameAuthorityRef(currentValidation.ref, validation.ref) ||
    !sameAuthorityRef(readiness.value.validationRef, validation.ref) ||
    batchUnit.validationContractHash !== validation.ref.sha256
  ) {
    throw new RoadmapDeliveryError("validation_contract_stale", "plan binding uses stale validation authority");
  }
  assertPlanWithinExecutionUnitBudget(input.plan, normalizeExecutionUnitBudget(batchUnit.budget));
  const bindingValue: DeliveryEpisodeBinding = {
    schemaVersion: ROADMAP_DELIVERY_SCHEMA_VERSION,
    app: input.app,
    unitId: input.unitId,
    membershipHash: unitMembershipHash(unit.issueNumbers),
    roadmapRef: roadmap.ref,
    readinessRef: readiness.ref,
    validationRef: validation.ref,
    validationContractHash: validation.ref.sha256,
    batchRef: batch.ref,
    episodeId: input.plan.episodeId,
    episodePlanVersion: input.plan.version,
    episodePlanHash: episodePlanHash(input.plan),
    createdAt: input.plan.createdAt,
  };
  const binding = await persistAuthority(
    input.root,
    input.app,
    "delivery_episode_binding",
    input.unitId,
    input.plan.version,
    bindingValue,
  );
  await markExecutionUnitPlanned(input.root, input.app, batch.ref, input.unitId, binding.ref, input.now);
  await projectAccepted(input.root, input.app, binding, input.project);
  return binding;
}

/** Direct work uses the same EpisodePlanner coordinator but needs no
 * RoadmapPlan. Its accepted authority is itself the complete creator scope,
 * so normalization is necessarily a strict zero-turn path. */
export async function normalizeDirectExecutionUnitEpisode(input: {
  root: string;
  app: AppEntry;
  roles: readonly RoleConfig[];
  batchRef: AuthorityRef;
  unitId: string;
  facts: DeliveryEpisodeFacts;
  providerOperations?: readonly string[];
  workflowTemplates: EpisodePlanningPolicyOptions["workflowTemplates"];
  independentReview?: EpisodePlanningPolicyOptions["independentReview"];
  now?: () => Date;
  project?: RoadmapDeliveryProjector;
}): Promise<{
  prepared: PreparedEpisodePlan;
  plan: EpisodePlan;
  binding: AcceptedAuthority<DirectEpisodeBinding>;
}> {
  const batch = await requireAuthority<ExecutionBatch>(
    input.root,
    input.app.name,
    input.batchRef,
    "execution_batch",
    "batch_hard_constraint_failed",
  );
  assertExecutionBatchShape(batch.value);
  const unit = batch.value.units.find((candidate) => candidate.unitId === input.unitId);
  if (unit === undefined || unit.kind !== "direct_operation") {
    throw new RoadmapDeliveryError("batch_hard_constraint_failed", `${input.unitId} is not direct work`);
  }
  const authority = await requireAuthority<DirectExecutionUnitAuthority>(
    input.root,
    input.app.name,
    unit.authorityRef,
    "direct_execution_unit",
    "direct_unit_incomplete",
  );
  assertDirectExecutionUnit(authority.value);
  const operationNow = input.now?.() ?? new Date();
  const creatorScope: CreatorEpisodeScope = {
    planningDisposition: "execution_ready",
    provenance: {
      ...authority.value.provenance,
      evidenceRefs: [
        ...authority.value.provenance.evidenceRefs,
        renderAuthorityRef(authority.ref),
        renderAuthorityRef(batch.ref),
      ],
    },
    objective: authority.value.objective,
    inScope: [...authority.value.inScope],
    outOfScope: [...authority.value.outOfScope],
    acceptanceCriteria: [...authority.value.acceptanceCriteria],
    expectedArtifacts: structuredClone(authority.value.expectedArtifacts),
    declaredConstraints: structuredClone(authority.value.declaredConstraints),
    safetyFacts: structuredClone(authority.value.safetyFacts),
    ...(authority.value.workflowTemplate === undefined
      ? { steps: structuredClone(authority.value.steps!) }
      : { workflowTemplate: structuredClone(authority.value.workflowTemplate) }),
  };
  const episodeId = `direct-${stableHash({ app: input.app.name, authority: authority.ref }).slice(0, 32)}`;
  const intent = buildEpisodeIntent({
    ...input.facts,
    episodeId,
    app: input.app,
    roles: input.roles,
    requiredSafetyFacts: [
      ...new Map(
        [...input.facts.requiredSafetyFacts, ...authority.value.safetyFacts].map((fact) => [
          stableHash(fact),
          structuredClone(fact),
        ]),
      ).values(),
    ],
    creatorScope,
  });
  const prepared = await prepareEpisodePlan({
    root: input.root,
    app: input.app,
    roles: input.roles,
    intent,
    workflowTemplates: input.workflowTemplates,
    ...(input.providerOperations === undefined ? {} : { providerOperations: input.providerOperations }),
    ...(input.independentReview === undefined ? {} : { independentReview: input.independentReview }),
    now: () => operationNow,
  });
  if (!prepared.planningTurnSkipped || prepared.plannerAttempts !== 0) {
    throw new RoadmapDeliveryError("direct_unit_incomplete", "complete direct authority did not normalize zero-turn");
  }
  assertPlanWithinExecutionUnitBudget(prepared.plan, unit.budget);
  const value: DirectEpisodeBinding = {
    schemaVersion: ROADMAP_DELIVERY_SCHEMA_VERSION,
    app: input.app.name,
    unitId: input.unitId,
    directAuthorityRef: authority.ref,
    batchRef: batch.ref,
    episodeId,
    episodePlanVersion: prepared.plan.version,
    episodePlanHash: episodePlanHash(prepared.plan),
    createdAt: prepared.plan.createdAt,
  };
  const binding = await persistAuthority(
    input.root,
    input.app.name,
    "direct_episode_binding",
    input.unitId,
    prepared.plan.version,
    value,
  );
  await markExecutionUnitPlanned(input.root, input.app.name, batch.ref, input.unitId, binding.ref, operationNow);
  await projectAccepted(input.root, input.app.name, binding, input.project);
  return { prepared, plan: prepared.plan, binding };
}

/** One content-bound claim owns every member. No per-ticket partial claim exists here. */
export async function claimDeliveryUnit(input: {
  root: string;
  app: string;
  episodeBindingRef: AuthorityRef;
  /** Builder-owned current-fact read. The claim boundary invokes this after
   * loading durable authority; a caller cannot pass a stale routing snapshot
   * through as if it were a fresh re-read. */
  readCurrentRouting: (issueNumbers: readonly number[]) => Promise<RoutingSnapshotEntry[]>;
  now: Date;
  project?: RoadmapDeliveryProjector;
}): Promise<DeliveryUnitClaim> {
  const joined = await loadDeliveryJoin(input.root, input.app, input.episodeBindingRef);
  assertValidationWaiversCurrent(joined.validation.value, input.now);
  let currentRouting: RoutingSnapshotEntry[];
  try {
    currentRouting = await input.readCurrentRouting([...joined.unit.issueNumbers]);
  } catch (error) {
    throw new RoadmapDeliveryError(
      "routing_ineligible",
      `Builder could not reread current delivery-unit labels: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  assertRoutingEligible(joined.unit, currentRouting);
  const payload: DeliveryUnitClaimPayload = {
    app: input.app,
    unitId: joined.unit.unitId,
    issueNumbers: [...joined.unit.issueNumbers],
    membershipHash: joined.binding.value.membershipHash,
    roadmapRef: joined.roadmap.ref,
    readinessRef: joined.readiness.ref,
    validationRef: joined.validation.ref,
    validationContractHash: joined.validation.ref.sha256,
    batchRef: joined.batch.ref,
    episodeBindingRef: joined.binding.ref,
  };
  const identity = deliveryClaimIdentity(payload);
  const store = deliveryClaimStore(input.root);
  const claimed = await store.claim({ identity, payload, maxAttempts: 1, now: input.now });
  if (claimed.disposition === "claimed" || claimed.disposition === "recovered_claim") {
    await transitionExecutionUnitJournal({
      root: input.root,
      app: input.app,
      batchRef: joined.batch.ref,
      unitId: joined.unit.unitId,
      expectedStates: ["planning", "claimed"],
      nextState: "claimed",
      episodeBindingRef: joined.binding.ref,
      claimSettlementId: claimed.record.settlement_id,
      now: input.now,
    });
    await projectClaim(input.root, input.app, claimed.record.settlement_id, "delivery_unit_claimed", input.project);
  }
  return claimed;
}

export async function commitDeliveryUnitClaim(input: {
  root: string;
  app: string;
  claim: DeliveryUnitClaim;
  runId: string;
  now: Date;
  project?: RoadmapDeliveryProjector;
}): Promise<DurableClaimRecord<DeliveryUnitClaimPayload>> {
  if (input.claim.token === undefined) {
    throw new RoadmapDeliveryError("already_claimed", "claim attempt does not own the unit");
  }
  const joined = await loadDeliveryJoin(input.root, input.app, input.claim.record.payload.episodeBindingRef);
  assertValidationWaiversCurrent(joined.validation.value, input.now);
  const record = await deliveryClaimStore(input.root).commit({
    settlementId: input.claim.record.settlement_id,
    attempt: input.claim.record.attempt,
    token: input.claim.token,
    runId: input.runId,
    now: input.now,
  });
  await transitionExecutionUnitJournal({
    root: input.root,
    app: input.app,
    batchRef: joined.batch.ref,
    unitId: joined.unit.unitId,
    expectedStates: ["claimed"],
    nextState: "claimed",
    episodeBindingRef: joined.binding.ref,
    claimSettlementId: record.settlement_id,
    now: input.now,
  });
  await projectClaim(input.root, input.app, record.settlement_id, "delivery_unit_claim_committed", input.project);
  return record;
}

async function markExecutionUnitPlanned(
  root: string,
  app: string,
  batchRef: AuthorityRef,
  unitId: string,
  episodeBindingRef: AuthorityRef,
  now: Date,
): Promise<void> {
  const current = await readExecutionUnitJournal(root, app, batchRef.id, unitId);
  if (
    current?.state === "claimed" &&
    current.episodeBindingRef !== null &&
    sameAuthorityRef(current.episodeBindingRef, episodeBindingRef)
  ) {
    // A committed claim with no provider usage is still a pre-provider
    // recovery point. Replaying the immutable plan/binding must not move the
    // journal backwards or consume another claim allowance.
    return;
  }
  await transitionExecutionUnitJournal({
    root,
    app,
    batchRef,
    unitId,
    expectedStates: ["admitted", "planning"],
    nextState: "planning",
    episodeBindingRef,
    now,
  });
}

export async function recordBuilderEvidence(input: {
  root: string;
  manifest: BuilderEvidenceManifest;
  project?: RoadmapDeliveryProjector;
}): Promise<AcceptedAuthority<BuilderEvidenceManifest>> {
  assertBuilderEvidenceShape(input.manifest);
  const joined = await loadDeliveryJoin(input.root, input.manifest.app, input.manifest.episodeBindingRef);
  assertEvidenceJoin(input.manifest, joined);
  await assertEvidencePlanCurrent(input.root, input.manifest);
  assertValidationWaiversCurrent(joined.validation.value, input.manifest.recordedAt);
  const claim = await deliveryClaimStore(input.root).read(input.manifest.claimSettlementId);
  if (
    claim === undefined ||
    claim.status !== "committed" ||
    claim.attempt !== input.manifest.claimAttempt ||
    claim.payload.unitId !== input.manifest.unitId ||
    claim.payload.membershipHash !== input.manifest.membershipHash ||
    !sameAuthorityRef(claim.payload.readinessRef, input.manifest.readinessRef) ||
    !sameAuthorityRef(claim.payload.validationRef, input.manifest.validationRef) ||
    claim.payload.validationContractHash !== input.manifest.validationContractHash ||
    !sameAuthorityRef(claim.payload.episodeBindingRef, input.manifest.episodeBindingRef)
  ) {
    throw new RoadmapDeliveryError(
      "builder_evidence_missing",
      "builder evidence has no matching committed all-member claim",
    );
  }
  assertValidationEvidenceComplete(input.manifest, joined.validation.value, input.manifest.recordedAt);
  const accepted = await persistAuthority(
    input.root,
    input.manifest.app,
    "builder_evidence",
    input.manifest.unitId,
    input.manifest.episodePlanVersion,
    input.manifest,
  );
  await projectAccepted(input.root, input.manifest.app, accepted, input.project);
  return accepted;
}

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

export async function settleDeliveryUnitClaim(input: {
  root: string;
  app: string;
  claimSettlementId: string;
  claimAttempt: number;
  runId: string;
  reviewerVerdictRef: AuthorityRef;
  validationContractHash: string;
  outcome: "approved" | "returned";
  now: Date;
  project?: RoadmapDeliveryProjector;
}): Promise<DurableClaimRecord<DeliveryUnitClaimPayload>> {
  const store = deliveryClaimStore(input.root);
  const [claim, verdict] = await Promise.all([
    store.read(input.claimSettlementId),
    requireAuthority<ReviewerVerdict>(
      input.root,
      input.app,
      input.reviewerVerdictRef,
      "reviewer_verdict",
      "reviewer_evidence_incomplete",
    ),
  ]);
  assertReviewerVerdictShape(verdict.value);
  const joined =
    claim === undefined ? undefined : await loadDeliveryJoin(input.root, input.app, claim.payload.episodeBindingRef);
  const builderEvidence = await requireAuthority<BuilderEvidenceManifest>(
    input.root,
    input.app,
    verdict.value.builderEvidenceRef,
    "builder_evidence",
    "builder_evidence_missing",
  );
  await assertEvidencePlanCurrent(input.root, builderEvidence.value);
  if (
    claim === undefined ||
    verdict.value.disposition !== input.outcome ||
    verdict.value.unitId !== claim.payload.unitId ||
    verdict.value.membershipHash !== claim.payload.membershipHash ||
    !sameAuthorityRef(verdict.value.roadmapRef, claim.payload.roadmapRef) ||
    !sameAuthorityRef(verdict.value.readinessRef, claim.payload.readinessRef) ||
    !sameAuthorityRef(verdict.value.validationRef, claim.payload.validationRef) ||
    verdict.value.validationContractHash !== claim.payload.validationContractHash ||
    input.validationContractHash !== claim.payload.validationContractHash ||
    !sameAuthorityRef(verdict.value.episodeBindingRef, claim.payload.episodeBindingRef)
  ) {
    throw new RoadmapDeliveryError(
      "reviewer_evidence_incomplete",
      "claim settlement has no exact matching independent Reviewer verdict",
    );
  }
  if (joined === undefined) {
    throw new RoadmapDeliveryError("reviewer_evidence_incomplete", "claim settlement has no delivery join");
  }
  assertValidationWaiversCurrent(joined.validation.value, input.now);
  const currentValidation = await readCurrentValidationContract(input.root, input.app, claim.payload.unitId);
  if (
    currentValidation === undefined ||
    !sameAuthorityRef(currentValidation.ref, claim.payload.validationRef) ||
    currentValidation.ref.sha256 !== input.validationContractHash
  ) {
    throw new RoadmapDeliveryError(
      "validation_contract_stale",
      "settlement does not bind the current validation contract",
    );
  }
  await assertCurrentValidationCatalogRef(input.root, input.app, currentValidation.value.catalogRef);
  const record = await store.settle({
    settlementId: input.claimSettlementId,
    attempt: input.claimAttempt,
    runId: input.runId,
    outcome: input.outcome,
    now: input.now,
  });
  await transitionExecutionUnitJournal({
    root: input.root,
    app: input.app,
    batchRef: joined.batch.ref,
    unitId: joined.unit.unitId,
    expectedStates: ["running", "reviewing", "approved", "returned"],
    nextState: input.outcome === "approved" ? "approved" : "returned",
    evidenceRefs: [builderEvidence.ref, verdict.ref],
    candidateHead: verdict.value.candidateHead,
    pullRequestNumber: builderEvidence.value.pullRequestNumber,
    ...(input.outcome === "returned" ? { outcome: "returned" as const } : {}),
    now: input.now,
  });
  await projectClaim(input.root, input.app, record.settlement_id, "delivery_unit_settled", input.project);
  return record;
}

export async function completeDeliveryUnitMerge(input: {
  root: string;
  app: string;
  batchRef: AuthorityRef;
  unitId: string;
  candidateHead: string;
  pullRequestNumber: number;
  now: Date;
}): Promise<ExecutionUnitJournal> {
  const journal = await readExecutionUnitJournal(input.root, input.app, input.batchRef.id, input.unitId);
  if (
    journal === undefined ||
    journal.state !== "approved" ||
    journal.candidateHead !== input.candidateHead ||
    journal.pullRequestNumber !== input.pullRequestNumber ||
    journal.evidenceRefs.length < 2
  ) {
    throw new RoadmapDeliveryError(
      "reviewer_evidence_incomplete",
      "merge completion requires exact-HEAD Builder evidence and Reviewer verdict",
    );
  }
  return transitionExecutionUnitJournal({
    root: input.root,
    app: input.app,
    batchRef: input.batchRef,
    unitId: input.unitId,
    expectedStates: ["approved"],
    nextState: "completed",
    candidateHead: input.candidateHead,
    pullRequestNumber: input.pullRequestNumber,
    outcome: "completed",
    now: input.now,
  });
}

export async function settleDeliveryUnitRefusal(input: {
  root: string;
  app: string;
  claimSettlementId: string;
  claimAttempt: number;
  runId: string;
  batchRef: AuthorityRef;
  unitId: string;
  reason: string;
  now: Date;
}): Promise<void> {
  assertNonEmpty(input.reason, "delivery refusal reason");
  await deliveryClaimStore(input.root).settle({
    settlementId: input.claimSettlementId,
    attempt: input.claimAttempt,
    runId: input.runId,
    outcome: "returned",
    now: input.now,
  });
  await transitionExecutionUnitJournal({
    root: input.root,
    app: input.app,
    batchRef: input.batchRef,
    unitId: input.unitId,
    expectedStates: ["claimed", "running", "reviewing", "approved"],
    nextState: "returned",
    outcome: "returned",
    now: input.now,
  });
}

export function roadmapAuthorityPath(root: string, app: string, id: string, version: number): string {
  return authorityPath(root, app, "roadmap_plan", id, version);
}

export function backlogSnapshotAuthorityPath(root: string, app: string, id: string, version: number): string {
  return authorityPath(root, app, "backlog_snapshot", id, version);
}

export function currentRoadmapPointerPath(root: string, app: string): string {
  return join(planningAppDir(root, app), "roadmap-current.json");
}

export function validationAuthorityPath(root: string, app: string, id: string, version: number): string {
  return authorityPath(root, app, "validation_contract", id, version);
}

export function currentValidationCatalogPointerPath(root: string, app: string): string {
  return join(planningAppDir(root, app), "validation-catalog-current.json");
}

export function currentValidationContractPointerPath(root: string, app: string, unitId: string): string {
  assertId(unitId, "validation unit id");
  return join(planningAppDir(root, app), "validation-current", `${unitId}.json`);
}

export function validationContractLifecyclePath(
  root: string,
  app: string,
  unitId: string,
  contractId: string,
  version: number,
): string {
  assertId(unitId, "validation unit id");
  assertId(contractId, "validation contract id");
  assertVersion(version, "validation contract version");
  return join(planningAppDir(root, app), "validation-lifecycle", unitId, contractId, `v${version}.json`);
}

export function readinessAuthorityPath(root: string, app: string, unitId: string, version: number): string {
  return authorityPath(root, app, "delivery_unit_readiness", unitId, version);
}

export function batchAuthorityPath(root: string, app: string, id: string, version: number): string {
  return authorityPath(root, app, "execution_batch", id, version);
}

export function executionUnitJournalPath(root: string, app: string, batchId: string, unitId: string): string {
  assertId(batchId, "execution batch id");
  assertId(unitId, "execution unit id");
  return join(planningAppDir(root, app), "execution-unit-journals", batchId, `${unitId}.json`);
}

export async function readExecutionUnitJournal(
  root: string,
  app: string,
  batchId: string,
  unitId: string,
): Promise<ExecutionUnitJournal | undefined> {
  const path = executionUnitJournalPath(root, app, batchId, unitId);
  if (!existsSync(path)) return undefined;
  const value = JSON.parse(await readFile(path, "utf8")) as ExecutionUnitJournal;
  assertExecutionUnitJournal(value);
  return value;
}

export async function transitionExecutionUnitJournal(input: {
  root: string;
  app: string;
  batchRef: AuthorityRef;
  unitId: string;
  expectedStates: ExecutionUnitJournalState[];
  nextState: ExecutionUnitJournalState;
  usageDelta?: Partial<ExecutionUnitJournal["usage"]>;
  episodeBindingRef?: AuthorityRef;
  claimSettlementId?: string;
  evidenceRefs?: AuthorityRef[];
  candidateHead?: string;
  pullRequestNumber?: number;
  outcome?: "completed" | "returned" | "failed";
  now: Date;
}): Promise<ExecutionUnitJournal> {
  return withFileLock(
    executionUnitJournalLockPath(input.root, input.app, input.batchRef.id, input.unitId),
    ROADMAP_MUTATION_LOCK,
    async () => {
      const batch = await requireAuthority<ExecutionBatch>(
        input.root,
        input.app,
        input.batchRef,
        "execution_batch",
        "batch_hard_constraint_failed",
      );
      assertExecutionBatchShape(batch.value);
      const unit = batch.value.units.find((candidate) => candidate.unitId === input.unitId);
      if (unit === undefined) {
        throw new RoadmapDeliveryError("unit_journal_conflict", `${input.unitId} is not in the batch`);
      }
      const current =
        (await readExecutionUnitJournal(input.root, input.app, batch.ref.id, input.unitId)) ??
        initialExecutionUnitJournal(batch, unit);
      if (!input.expectedStates.includes(current.state)) {
        if (current.state === input.nextState && input.outcome === current.outcome) {
          if (isTerminalJournalState(current.state)) {
            await writeBatchDispositionIfComplete(input.root, batch, input.now);
          }
          return current;
        }
        throw new RoadmapDeliveryError(
          "unit_journal_conflict",
          `${input.unitId} is ${current.state}, expected ${input.expectedStates.join("|")}`,
        );
      }
      const usage = addExecutionUnitUsage(current.usage, input.usageDelta ?? {});
      assertUsageWithinBudget(usage, current.budget);
      const next: ExecutionUnitJournal = {
        ...current,
        state: input.nextState,
        usage,
        ...(input.episodeBindingRef === undefined ? {} : { episodeBindingRef: input.episodeBindingRef }),
        ...(input.claimSettlementId === undefined ? {} : { claimSettlementId: input.claimSettlementId }),
        ...(input.evidenceRefs === undefined ? {} : { evidenceRefs: [...input.evidenceRefs] }),
        ...(input.candidateHead === undefined ? {} : { candidateHead: input.candidateHead }),
        ...(input.pullRequestNumber === undefined ? {} : { pullRequestNumber: input.pullRequestNumber }),
        ...(input.outcome === undefined ? {} : { outcome: input.outcome }),
        updatedAt: input.now.toISOString(),
      };
      assertExecutionUnitJournal(next);
      await writeLoopFileAtomic(
        executionUnitJournalPath(input.root, input.app, batch.ref.id, input.unitId),
        `${JSON.stringify(next, null, 2)}\n`,
      );
      if (isTerminalJournalState(next.state)) {
        await writeBatchDispositionIfComplete(input.root, batch, input.now);
      }
      return next;
    },
  );
}

export async function readExecutionBatch(
  root: string,
  app: string,
  ref: AuthorityRef,
): Promise<AcceptedAuthority<ExecutionBatch>> {
  const batch = await requireAuthority<ExecutionBatch>(
    root,
    app,
    ref,
    "execution_batch",
    "batch_hard_constraint_failed",
  );
  assertExecutionBatchShape(batch.value);
  return batch;
}

export async function readBacklogSnapshotAuthority(
  root: string,
  app: string,
  ref: AuthorityRef,
): Promise<AcceptedAuthority<BacklogSnapshot>> {
  const snapshot = await requireAuthority<BacklogSnapshot>(root, app, ref, "backlog_snapshot", "backlog_incomplete");
  assertBacklogSnapshot(snapshot.value);
  return snapshot;
}

export async function findActiveExecutionUnit(
  root: string,
  app: string,
  unitId: string,
): Promise<ActiveExecutionUnit | undefined> {
  return (await listActiveExecutionUnits(root, app)).find((entry) => entry.unit.unitId === unitId);
}

export interface ActiveExecutionUnit {
  batch: AcceptedAuthority<ExecutionBatch>;
  unit: ExecutionUnit;
  journal: ExecutionUnitJournal;
}

export async function listActiveExecutionUnits(root: string, app: string): Promise<ActiveExecutionUnit[]> {
  const directory = join(planningAppDir(root, app), "execution_batchs");
  if (!existsSync(directory)) return [];
  const found = new Map<string, ActiveExecutionUnit>();
  for (const batchId of (await readdir(directory)).sort()) {
    const batchDir = join(directory, batchId);
    let versions: string[];
    try {
      versions = await readdir(batchDir);
    } catch {
      continue;
    }
    for (const version of versions.filter((name) => /^v\d+\.json$/.test(name)).sort()) {
      const batch = await readAuthorityFile<ExecutionBatch>(join(batchDir, version));
      assertExecutionBatchShape(batch.value);
      for (const unit of batch.value.units) {
        const journal =
          (await readExecutionUnitJournal(root, app, batch.ref.id, unit.unitId)) ??
          (await ensureExecutionUnitJournal(root, batch, unit));
        if (isTerminalJournalState(journal.state)) continue;
        if (found.has(unit.unitId)) {
          throw new RoadmapDeliveryError(
            "batch_membership_active",
            `${unit.unitId} appears in multiple active batches`,
          );
        }
        found.set(unit.unitId, { batch, unit, journal });
      }
    }
  }
  return [...found.values()].sort((a, b) => a.unit.unitId.localeCompare(b.unit.unitId));
}

export async function readCurrentDeliveryUnitReadiness(
  root: string,
  app: string,
  unitId: string,
): Promise<AcceptedAuthority<DeliveryUnitReadiness> | undefined> {
  const validation = await readCurrentValidationContract(root, app, unitId);
  if (validation === undefined) return undefined;
  const path = readinessAuthorityPath(root, app, unitId, validation.ref.version);
  if (!existsSync(path)) return undefined;
  const readiness = await readAuthorityFile<DeliveryUnitReadiness>(path);
  assertDeliveryUnitReadinessShape(readiness.value);
  return readiness;
}

export function deliveryClaimRecordPath(root: string, identity: string): string {
  const settlementId = durableClaimSettlementId(identity);
  return join(resolve(root), CLAIM_NAMESPACE, "records", `${settlementId}.json`);
}

export async function readDeliveryUnitClaim(
  root: string,
  settlementId: string,
): Promise<DurableClaimRecord<DeliveryUnitClaimPayload> | undefined> {
  return deliveryClaimStore(root).read(settlementId);
}

export function deliveryClaimIdentity(payload: DeliveryUnitClaimPayload): string {
  return [
    "roadmap-delivery-unit/v1",
    payload.app,
    payload.unitId,
    payload.membershipHash,
    payload.roadmapRef.sha256,
    payload.readinessRef.sha256,
    payload.validationRef.sha256,
    payload.validationContractHash,
    payload.batchRef.sha256,
    payload.episodeBindingRef.sha256,
  ].join("\0");
}

export function unitMembershipHash(issueNumbers: readonly number[]): string {
  return stableHash([...issueNumbers]);
}

function deliveryClaimStore(root: string): DurableClaimStore<DeliveryUnitClaimPayload> {
  return new DurableClaimStore<DeliveryUnitClaimPayload>({ root, namespace: CLAIM_NAMESPACE });
}

async function loadDeliveryJoin(root: string, app: string, bindingRef: AuthorityRef) {
  const binding = await requireAuthority<DeliveryEpisodeBinding>(
    root,
    app,
    bindingRef,
    "delivery_episode_binding",
    "batch_hard_constraint_failed",
  );
  assertDeliveryEpisodeBindingShape(binding.value);
  const roadmap = await requireAuthority<RoadmapPlan>(
    root,
    app,
    binding.value.roadmapRef,
    "roadmap_plan",
    "roadmap_missing",
  );
  const readiness = await requireAuthority<DeliveryUnitReadiness>(
    root,
    app,
    binding.value.readinessRef,
    "delivery_unit_readiness",
    "validation_incomplete",
  );
  assertDeliveryUnitReadinessShape(readiness.value);
  const validation = await requireAuthority<ValidationContract>(
    root,
    app,
    binding.value.validationRef,
    "validation_contract",
    "validation_contract_missing",
  );
  assertValidationContractBaseShape(validation.value);
  await assertValidationWaiverAuthorities(root, validation.value);
  await assertCurrentValidationCatalogRef(root, app, validation.value.catalogRef);
  const batch = await requireAuthority<ExecutionBatch>(
    root,
    app,
    binding.value.batchRef,
    "execution_batch",
    "batch_hard_constraint_failed",
  );
  assertExecutionBatchShape(batch.value);
  if (batch.value.roadmapRef === null || batch.value.frontierHash === null) {
    throw new RoadmapDeliveryError("evidence_unit_mismatch", "code delivery binding points at a direct-only batch");
  }
  await assertCurrentRoadmapRef(root, app, roadmap.ref, batch.value.frontierHash);
  const unit = requireUnit(roadmap.value, binding.value.unitId);
  const currentValidation = await readCurrentValidationContract(root, app, unit.unitId);
  if (
    binding.value.membershipHash !== unitMembershipHash(unit.issueNumbers) ||
    !sameAuthorityRef(readiness.value.roadmapRef, roadmap.ref) ||
    !sameAuthorityRef(readiness.value.validationRef, validation.ref) ||
    readiness.value.validationContractHash !== validation.ref.sha256 ||
    !sameAuthorityRef(binding.value.readinessRef, readiness.ref) ||
    binding.value.validationContractHash !== validation.ref.sha256 ||
    !sameAuthorityRef(validation.value.roadmapRef, roadmap.ref) ||
    currentValidation === undefined ||
    !sameAuthorityRef(currentValidation.ref, validation.ref) ||
    !batch.value.units.some(
      (entry) =>
        entry.kind !== "direct_operation" &&
        entry.unitId === unit.unitId &&
        entry.membershipHash === binding.value.membershipHash &&
        sameAuthorityRef(entry.readinessRef, readiness.ref) &&
        sameAuthorityRef(entry.validationRef, validation.ref) &&
        entry.validationContractHash === validation.ref.sha256,
    )
  ) {
    throw new RoadmapDeliveryError(
      "evidence_unit_mismatch",
      "delivery episode binding does not reproduce its roadmap, validation, and batch lineage",
    );
  }
  return { binding, roadmap, readiness, validation, batch, unit };
}

function assertEvidenceJoin(
  manifest: BuilderEvidenceManifest,
  joined: Awaited<ReturnType<typeof loadDeliveryJoin>>,
): void {
  if (
    manifest.unitId !== joined.unit.unitId ||
    stableHash(manifest.issueNumbers) !== joined.binding.value.membershipHash ||
    manifest.membershipHash !== joined.binding.value.membershipHash ||
    !sameAuthorityRef(manifest.roadmapRef, joined.roadmap.ref) ||
    !sameAuthorityRef(manifest.readinessRef, joined.readiness.ref) ||
    !sameAuthorityRef(manifest.validationRef, joined.validation.ref) ||
    manifest.validationContractHash !== joined.validation.ref.sha256 ||
    !sameAuthorityRef(manifest.batchRef, joined.batch.ref) ||
    !sameAuthorityRef(manifest.episodeBindingRef, joined.binding.ref) ||
    manifest.episodeId !== joined.binding.value.episodeId ||
    manifest.episodePlanVersion < joined.binding.value.episodePlanVersion
  ) {
    throw new RoadmapDeliveryError(
      "evidence_unit_mismatch",
      "Builder evidence does not bind the exact accepted unit/plan lineage",
    );
  }
}

async function assertEvidencePlanCurrent(
  root: string,
  manifest: Pick<BuilderEvidenceManifest, "episodeId" | "episodePlanVersion" | "episodePlanHash">,
): Promise<void> {
  const current = await readCurrentEpisodePlan(root, manifest.episodeId);
  if (
    current === undefined ||
    current.version !== manifest.episodePlanVersion ||
    episodePlanHash(current) !== manifest.episodePlanHash
  ) {
    throw new RoadmapDeliveryError(
      "evidence_unit_mismatch",
      "Builder evidence does not bind the current accepted delivery EpisodePlan",
    );
  }
}

function assertPlanWithinExecutionUnitBudget(plan: EpisodePlan, budget: ExecutionUnitBudget): void {
  const humanDecisions = plan.steps.filter((step) => step.kind === "approval").length;
  if (
    plan.estimatedBudget.providerTurns > budget.maxProviderTurns ||
    plan.estimatedBudget.providerTurnBudgetUsd > budget.maxEquivalentCostUsd ||
    plan.estimatedBudget.mechanicalOverheadUsd > budget.maxMechanicalOverheadUsd ||
    humanDecisions > budget.maxHumanDecisions
  ) {
    throw new RoadmapDeliveryError(
      "unit_budget_exhausted",
      `EpisodePlan ${plan.episodeId}@${plan.version} exceeds the admitted unit budget`,
    );
  }
}

export function assertValidationEvidenceComplete(
  manifest: Pick<BuilderEvidenceManifest, "cases" | "gates">,
  contract: ValidationContract,
  at?: Date | string,
): void {
  assertValidationWaiversCurrent(contract, at);
  const cases = new Map(manifest.cases.map((entry) => [entry.caseId, entry]));
  for (const obligation of contract.obligations) {
    const evidence = cases.get(obligation.caseId);
    const expectedStatus = obligation.waiver === null ? "passed" : "waived";
    const expectedWaiverId = obligation.waiver?.waiverId ?? null;
    if (
      evidence === undefined ||
      evidence.detectorId !== obligation.detectorId ||
      evidence.negativeControlId !== obligation.negativeControlId ||
      evidence.status !== expectedStatus ||
      evidence.waiverId !== expectedWaiverId ||
      typeof evidence.evidence !== "string" ||
      evidence.evidence.trim().length === 0
    ) {
      throw new RoadmapDeliveryError(
        "builder_evidence_missing",
        `missing exact detector/negative-control evidence for ${obligation.caseId}`,
      );
    }
  }
  const gates = new Set(
    manifest.gates
      .filter(
        (entry) => entry.status === "passed" && typeof entry.evidence === "string" && entry.evidence.trim().length > 0,
      )
      .map((entry) => entry.gate),
  );
  const missingGates = contract.requiredGates.filter((gate) => !gates.has(gate));
  if (missingGates.length > 0) {
    throw new RoadmapDeliveryError("builder_evidence_missing", `missing gate evidence for ${missingGates.join(", ")}`);
  }
}

function bindCreatorScope(scope: CreatorEpisodeScope, authorityInputs: readonly string[]): CreatorEpisodeScope {
  const inputs = authorityInputs.map((ref) => ({ ref, required: true }));
  return {
    ...structuredClone(scope),
    provenance: {
      ...structuredClone(scope.provenance),
      evidenceRefs: [...new Set([...scope.provenance.evidenceRefs, ...authorityInputs])].sort(),
    },
    ...(scope.steps === undefined
      ? {}
      : {
          steps: scope.steps.map((step) => ({
            ...structuredClone(step),
            inputRefs:
              step.dependsOn.length === 0
                ? uniqueInputRefs([...step.inputRefs, ...inputs])
                : structuredClone(step.inputRefs),
          })),
        }),
  };
}

function uniqueInputRefs(refs: Array<{ ref: string; required: boolean }>): Array<{ ref: string; required: boolean }> {
  const byRef = new Map<string, { ref: string; required: boolean }>();
  for (const ref of refs) {
    const existing = byRef.get(ref.ref);
    byRef.set(ref.ref, { ref: ref.ref, required: ref.required || existing?.required === true });
  }
  return [...byRef.values()].sort((left, right) => left.ref.localeCompare(right.ref));
}

function assertRoadmapPlan(plan: RoadmapPlan): void {
  if (plan.schemaVersion !== ROADMAP_DELIVERY_SCHEMA_VERSION) {
    throw new RoadmapDeliveryError("roadmap_invalid", "unsupported RoadmapPlan schema");
  }
  assertId(plan.planId, "roadmap plan id");
  assertVersion(plan.version, "roadmap plan version");
  assertAuthorityRef(plan.backlogSnapshotRef, "backlog_snapshot");
  requireDateTime(plan.acceptedAt, "roadmap acceptedAt");
  if (
    plan.app.trim().length === 0 ||
    plan.workstreams.length === 0 ||
    plan.deliveryUnits.length === 0 ||
    !Number.isInteger(plan.wipLimit) ||
    plan.wipLimit < 1 ||
    plan.readyFrontier.length > plan.wipLimit
  ) {
    throw new RoadmapDeliveryError("roadmap_invalid", "app, workstreams, and delivery units are required");
  }
  if (plan.predecessor !== null) assertAuthorityRef(plan.predecessor, "roadmap_plan");
  const workstreams = new Set<string>();
  for (const workstream of plan.workstreams) {
    assertId(workstream.workstreamId, "workstream id");
    if (workstreams.has(workstream.workstreamId)) {
      throw new RoadmapDeliveryError("roadmap_invalid", `duplicate workstream ${workstream.workstreamId}`);
    }
    workstreams.add(workstream.workstreamId);
    if (!Number.isInteger(workstream.priority) || workstream.outcome.trim().length === 0) {
      throw new RoadmapDeliveryError("roadmap_invalid", `invalid workstream ${workstream.workstreamId}`);
    }
  }
  const units = new Map<string, RoadmapDeliveryUnit>();
  const issues = new Set<number>();
  for (const unit of plan.deliveryUnits) {
    assertId(unit.unitId, "delivery unit id");
    if (units.has(unit.unitId)) {
      throw new RoadmapDeliveryError("roadmap_invalid", `duplicate delivery unit ${unit.unitId}`);
    }
    if (!workstreams.has(unit.workstreamId) || unit.issueNumbers.length === 0) {
      throw new RoadmapDeliveryError("roadmap_invalid", `invalid delivery unit ${unit.unitId}`);
    }
    for (const issue of unit.issueNumbers) {
      if (!Number.isInteger(issue) || issue < 1) {
        throw new RoadmapDeliveryError("issue_unaccounted", `${unit.unitId} has invalid issue ${issue}`);
      }
      if (issues.has(issue)) {
        throw new RoadmapDeliveryError("issue_multiply_assigned", `issue #${issue} appears in multiple units`);
      }
      issues.add(issue);
    }
    units.set(unit.unitId, unit);
  }
  for (const unit of plan.deliveryUnits) {
    for (const dependency of unit.dependsOn) {
      if (!units.has(dependency) || dependency === unit.unitId) {
        throw new RoadmapDeliveryError("unit_cycle", `${unit.unitId} has invalid dependency ${dependency}`);
      }
    }
  }
  assertAcyclic(plan.deliveryUnits);
  const completed = new Set<string>();
  for (const unitId of plan.completedUnitIds) {
    if (completed.has(unitId) || !units.has(unitId)) {
      throw new RoadmapDeliveryError("roadmap_invalid", `invalid completed unit ${unitId}`);
    }
    completed.add(unitId);
  }
  const frontier = new Set<string>();
  for (const unitId of plan.readyFrontier) {
    if (frontier.has(unitId) || !units.has(unitId) || completed.has(unitId)) {
      throw new RoadmapDeliveryError("roadmap_invalid", `invalid ready-frontier unit ${unitId}`);
    }
    const unit = units.get(unitId)!;
    const unmet = unit.dependsOn.filter((dependency) => !completed.has(dependency));
    if (unmet.length > 0) {
      throw new RoadmapDeliveryError(
        "roadmap_invalid",
        `ready-frontier unit ${unitId} has unmet dependencies: ${unmet.join(", ")}`,
      );
    }
    frontier.add(unitId);
  }
  const expectedOrder = plan.readyFrontier
    .map((unitId) => units.get(unitId)!)
    .sort((left, right) => left.priority - right.priority || left.unitId.localeCompare(right.unitId))
    .map((unit) => unit.unitId);
  if (stableHash(expectedOrder) !== stableHash(plan.readyFrontier)) {
    throw new RoadmapDeliveryError("roadmap_invalid", "ready frontier is not in stable priority order");
  }
  const seenMoves = new Set<string>();
  for (const move of plan.moves) {
    if (
      !Number.isInteger(move.issueNumber) ||
      move.issueNumber < 1 ||
      !units.has(move.toUnitId) ||
      move.fromUnitId === move.toUnitId ||
      move.reason.trim().length === 0 ||
      seenMoves.has(`${move.issueNumber}\0${move.fromUnitId}\0${move.toUnitId}`)
    ) {
      throw new RoadmapDeliveryError("roadmap_invalid", `invalid move for issue #${move.issueNumber}`);
    }
    requireDateTime(move.movedAt, "roadmap move movedAt");
    seenMoves.add(`${move.issueNumber}\0${move.fromUnitId}\0${move.toUnitId}`);
  }
}

function assertBacklogSnapshot(snapshot: BacklogSnapshot): void {
  if (snapshot.schemaVersion !== ROADMAP_DELIVERY_SCHEMA_VERSION) {
    throw new RoadmapDeliveryError("backlog_incomplete", "unsupported backlog snapshot schema");
  }
  assertId(snapshot.snapshotId, "snapshot id");
  assertVersion(snapshot.version, "snapshot version");
  requireDateTime(snapshot.capturedAt, "snapshot capturedAt");
  if (
    snapshot.app.trim().length === 0 ||
    snapshot.source.trim().length === 0 ||
    !Number.isInteger(snapshot.pagination.pagesObserved) ||
    snapshot.pagination.pagesObserved < 1 ||
    snapshot.issues.length === 0
  ) {
    throw new RoadmapDeliveryError("backlog_incomplete", "backlog snapshot metadata is incomplete");
  }
  const issues = new Set<number>();
  for (const issue of snapshot.issues) {
    if (!Number.isInteger(issue.issueNumber) || issue.issueNumber < 1 || issues.has(issue.issueNumber)) {
      throw new RoadmapDeliveryError(
        issues.has(issue.issueNumber) ? "issue_multiply_assigned" : "backlog_incomplete",
        `invalid or duplicate snapshot issue #${issue.issueNumber}`,
      );
    }
    assertHash(issue.contentHash, `snapshot issue #${issue.issueNumber} content hash`);
    if (
      !Array.isArray(issue.observedLabels) ||
      issue.observedLabels.some((label) => typeof label !== "string" || label.trim().length === 0) ||
      new Set(issue.observedLabels).size !== issue.observedLabels.length ||
      new Set(issue.dependencyIssues).size !== issue.dependencyIssues.length ||
      issue.dependencyIssues.some((dependency) => !Number.isInteger(dependency) || dependency < 1)
    ) {
      throw new RoadmapDeliveryError("backlog_incomplete", `invalid dependencies for #${issue.issueNumber}`);
    }
    issues.add(issue.issueNumber);
  }
  for (const issue of snapshot.issues) {
    const missing = issue.dependencyIssues.filter((dependency) => !issues.has(dependency));
    if (missing.length > 0) {
      throw new RoadmapDeliveryError(
        "backlog_incomplete",
        `snapshot issue #${issue.issueNumber} has unavailable dependencies: ${missing.join(", ")}`,
      );
    }
  }
}

function assertRoadmapAccounting(plan: RoadmapPlan, snapshot: BacklogSnapshot): void {
  if (plan.app !== snapshot.app || !sameAuthorityRef(plan.backlogSnapshotRef, authorityRefForSnapshot(snapshot))) {
    throw new RoadmapDeliveryError("roadmap_invalid", "RoadmapPlan does not bind the accepted backlog snapshot");
  }
  const expected = snapshot.issues
    .filter((issue) => issue.lifecycle === "open")
    .map((issue) => issue.issueNumber)
    .sort(numeric);
  const actual = plan.deliveryUnits.flatMap((unit) => unit.issueNumbers).sort(numeric);
  if (stableHash(expected) !== stableHash(actual)) {
    const actualSet = new Set(actual);
    const expectedSet = new Set(expected);
    const missing = expected.filter((issue) => !actualSet.has(issue));
    const unexpected = actual.filter((issue) => !expectedSet.has(issue));
    throw new RoadmapDeliveryError(
      "issue_unaccounted",
      `RoadmapPlan accounting mismatch; missing [${missing.join(",")}], unexpected [${unexpected.join(",")}]`,
    );
  }
}

function assertRoadmapRoutingFrontier(plan: RoadmapPlan, snapshot: BacklogSnapshot): void {
  const routing = new Map(snapshot.issues.map((issue) => [issue.issueNumber, issue]));
  for (const unitId of plan.readyFrontier) {
    const unit = requireUnit(plan, unitId);
    for (const issueNumber of unit.issueNumbers) {
      const issue = routing.get(issueNumber);
      if (issue?.routing !== "automated" || autonomousExecutionExclusionLabel(issue.observedLabels) !== undefined) {
        throw new RoadmapDeliveryError(
          "routing_ineligible",
          `ready-frontier unit ${unitId} contains excluded or unreadable issue #${issueNumber}`,
        );
      }
    }
  }
}

function assertRoadmapRevision(plan: RoadmapPlan, current: AcceptedAuthority<RoadmapPlan> | undefined): void {
  const proposedRef: AuthorityRef = {
    kind: "roadmap_plan",
    id: plan.planId,
    version: plan.version,
    sha256: stableHash(plan),
  };
  if (current === undefined) {
    if (plan.version !== 1 || plan.predecessor !== null || plan.moves.length !== 0) {
      throw new RoadmapDeliveryError(
        "roadmap_invalid",
        "the first RoadmapPlan must be v1 with no predecessor or move history",
      );
    }
    return;
  }
  if (sameAuthorityRef(current.ref, proposedRef)) return;
  if (
    plan.planId !== current.value.planId ||
    plan.version !== current.value.version + 1 ||
    plan.predecessor === null ||
    !sameAuthorityRef(plan.predecessor, current.ref)
  ) {
    throw new RoadmapDeliveryError(
      "frontier_stale",
      `RoadmapPlan revision must advance ${renderAuthorityRef(current.ref)} by exactly one version`,
    );
  }
  if (plan.moves.length < current.value.moves.length) {
    throw new RoadmapDeliveryError("roadmap_invalid", "roadmap move history cannot shrink");
  }
  for (let index = 0; index < current.value.moves.length; index += 1) {
    if (stableHash(plan.moves[index]) !== stableHash(current.value.moves[index])) {
      throw new RoadmapDeliveryError("roadmap_invalid", "roadmap move history is not append-only");
    }
  }
  const priorByIssue = unitByIssue(current.value);
  const nextByIssue = unitByIssue(plan);
  const newMoves = plan.moves.slice(current.value.moves.length);
  for (const [issueNumber, priorUnit] of priorByIssue) {
    const nextUnit = nextByIssue.get(issueNumber);
    if (nextUnit === undefined || nextUnit.unitId === priorUnit.unitId) continue;
    const move = newMoves.find(
      (candidate) =>
        candidate.issueNumber === issueNumber &&
        candidate.fromUnitId === priorUnit.unitId &&
        candidate.toUnitId === nextUnit.unitId,
    );
    if (move === undefined) {
      throw new RoadmapDeliveryError(
        "roadmap_invalid",
        `issue #${issueNumber} moved ${priorUnit.unitId} → ${nextUnit.unitId} without append-only evidence`,
      );
    }
  }
  const priorMembershipIds = new Map(
    current.value.deliveryUnits.map((unit) => [stableHash([...unit.issueNumbers].sort(numeric)), unit.unitId]),
  );
  for (const unit of plan.deliveryUnits) {
    const priorId = priorMembershipIds.get(stableHash([...unit.issueNumbers].sort(numeric)));
    if (priorId !== undefined && priorId !== unit.unitId) {
      throw new RoadmapDeliveryError(
        "roadmap_invalid",
        `unchanged membership ${unit.issueNumbers.join(",")} changed stable unit id ${priorId} → ${unit.unitId}`,
      );
    }
  }
}

function assertValidationCatalogShape(catalog: ValidationCatalog): void {
  assertExactObjectKeys(
    catalog,
    [
      "schemaVersion",
      "catalogId",
      "version",
      "predecessor",
      "app",
      "harnessRevisionId",
      "journeys",
      "boundaries",
      "contracts",
      "invariants",
      "interfaces",
      "stateOwners",
      "controlPoints",
      "cases",
      "templates",
      "waiverClasses",
      "acceptedAt",
    ],
    "validation catalog",
  );
  if (catalog.schemaVersion !== VALIDATION_CATALOG_SCHEMA_VERSION) {
    throw new RoadmapDeliveryError("validation_catalog_stale", "unsupported validation catalog schema");
  }
  assertId(catalog.catalogId, "validation catalog id");
  assertVersion(catalog.version, "validation catalog version");
  if (catalog.predecessor !== null) assertAuthorityRef(catalog.predecessor, "validation_catalog");
  requireDateTime(catalog.acceptedAt, "validation catalog acceptedAt");
  assertNonEmpty(catalog.app, "validation catalog app");
  assertNonEmpty(catalog.harnessRevisionId, "validation catalog harness revision");
  for (const entries of [
    catalog.journeys,
    catalog.boundaries,
    catalog.contracts,
    catalog.invariants,
    catalog.interfaces,
    catalog.stateOwners,
    catalog.controlPoints,
    catalog.cases,
    catalog.templates,
    catalog.waiverClasses,
  ]) {
    if (!Array.isArray(entries)) {
      throw new RoadmapDeliveryError("validation_contract_invalid", "validation catalog collection is missing");
    }
  }
  for (const entry of [
    ...catalog.journeys,
    ...catalog.contracts,
    ...catalog.interfaces,
    ...catalog.stateOwners,
    ...catalog.controlPoints,
  ])
    assertExactObjectKeys(entry, ["canonicalId", "aliases"], "validation catalog ID");
  for (const invariant of catalog.invariants) {
    assertExactObjectKeys(invariant, ["canonicalId", "aliases", "floor"], "validation invariant");
    if (typeof invariant.floor !== "boolean") {
      throw new RoadmapDeliveryError("validation_contract_invalid", "validation invariant floor is not explicit");
    }
  }
  for (const [label, entries] of [
    ["journey", catalog.journeys],
    ["boundary", catalog.boundaries],
    ["contract", catalog.contracts],
    ["invariant", catalog.invariants],
    ["interface", catalog.interfaces],
    ["state owner", catalog.stateOwners],
    ["control point", catalog.controlPoints],
    ["case", catalog.cases],
  ] as const) {
    if (!Array.isArray(entries)) {
      throw new RoadmapDeliveryError("validation_contract_invalid", `validation catalog ${label} IDs are missing`);
    }
    if (entries.length === 0) {
      throw new RoadmapDeliveryError("validation_contract_invalid", `validation catalog has no ${label} IDs`);
    }
    assertCatalogIds(entries, label);
  }
  for (const boundary of catalog.boundaries) {
    assertExactObjectKeys(
      boundary,
      ["canonicalId", "aliases", "requiresSharedDetector", "sharedDetectorId", "routineEligible"],
      `validation boundary ${String(boundary?.canonicalId)}`,
    );
    if (
      typeof boundary.requiresSharedDetector !== "boolean" ||
      typeof boundary.routineEligible !== "boolean" ||
      boundary.requiresSharedDetector !== (boundary.sharedDetectorId !== null)
    ) {
      throw new RoadmapDeliveryError(
        "validation_contract_invalid",
        `boundary ${boundary.canonicalId} shared-detector policy is inconsistent`,
      );
    }
    if (boundary.sharedDetectorId !== null) assertNonEmpty(boundary.sharedDetectorId, "shared detector id");
  }
  for (const entry of catalog.cases) {
    assertExactObjectKeys(
      entry,
      [
        "canonicalId",
        "aliases",
        "cheapestFalsifyingLayer",
        "affected",
        "detectorId",
        "negativeControlRequired",
        "routineEligible",
      ],
      `validation case ${String(entry?.canonicalId)}`,
    );
    if (
      typeof entry.negativeControlRequired !== "boolean" ||
      typeof entry.routineEligible !== "boolean" ||
      !VALIDATION_LAYERS.includes(entry.cheapestFalsifyingLayer)
    ) {
      throw new RoadmapDeliveryError("validation_contract_invalid", `case ${entry.canonicalId} has an invalid layer`);
    }
    assertAffectedStructureShape(entry.affected, `catalog case ${entry.canonicalId}`, true);
    assertCanonicalAffectedStructure(entry.affected, catalog, `catalog case ${entry.canonicalId}`);
    assertNonEmpty(entry.detectorId, `case ${entry.canonicalId} detector id`);
  }
  if (catalog.templates.length === 0) {
    throw new RoadmapDeliveryError("validation_contract_invalid", "validation catalog has no governed templates");
  }
  const templateKeys = new Set<string>();
  const templateAliases = new Map<string, string>();
  for (const template of catalog.templates) {
    assertExactObjectKeys(template, ["templateId", "aliases", "version", "kind"], "validation template");
    assertMachineId(template.templateId, "validation template id");
    assertVersion(template.version, "validation template version");
    if (template.kind !== "routine" && template.kind !== "custom") {
      throw new RoadmapDeliveryError("validation_contract_invalid", "validation template kind is invalid");
    }
    const key = `${template.templateId}\0${template.version}`;
    if (templateKeys.has(key)) {
      throw new RoadmapDeliveryError("validation_contract_invalid", `duplicate validation template ${key}`);
    }
    templateKeys.add(key);
    assertStringList(template.aliases, `template ${template.templateId} aliases`, true);
    for (const id of [template.templateId, ...template.aliases]) {
      const aliasKey = `${template.version}\0${id}`;
      const prior = templateAliases.get(aliasKey);
      if (prior !== undefined && prior !== template.templateId) {
        throw new RoadmapDeliveryError(
          "validation_contract_invalid",
          `template ID ${id}@${template.version} resolves ambiguously`,
        );
      }
      templateAliases.set(aliasKey, template.templateId);
    }
  }
  if (catalog.waiverClasses.length === 0) {
    throw new RoadmapDeliveryError("validation_contract_invalid", "validation catalog has no explicit waiver policy");
  }
  assertWaiverClassIds(catalog.waiverClasses);
  for (const waiverClass of catalog.waiverClasses) {
    assertExactObjectKeys(
      waiverClass,
      ["classId", "aliases", "maxDurationMs", "maxWaiversPerContract", "allowedTemplateKinds"],
      "validation waiver class",
    );
    if (
      !Number.isSafeInteger(waiverClass.maxDurationMs) ||
      waiverClass.maxDurationMs < 1 ||
      !Number.isSafeInteger(waiverClass.maxWaiversPerContract) ||
      waiverClass.maxWaiversPerContract < 1 ||
      !Array.isArray(waiverClass.allowedTemplateKinds) ||
      waiverClass.allowedTemplateKinds.length === 0 ||
      waiverClass.allowedTemplateKinds.some((kind) => kind !== "routine" && kind !== "custom")
    ) {
      throw new RoadmapDeliveryError(
        "validation_contract_invalid",
        `waiver class ${waiverClass.classId} is unbounded or invalid`,
      );
    }
  }
}

function assertValidationCatalogRevision(
  catalog: ValidationCatalog,
  current: AcceptedAuthority<ValidationCatalog> | undefined,
): void {
  const proposedRef: AuthorityRef = {
    kind: "validation_catalog",
    id: catalog.catalogId,
    version: catalog.version,
    sha256: stableHash(catalog),
  };
  if (catalog.harnessRevisionId !== RATIFIED_HARNESS_REVISION_ID) {
    throw new RoadmapDeliveryError(
      "validation_catalog_stale",
      `catalog must bind ratified harness revision ${RATIFIED_HARNESS_REVISION_ID}`,
    );
  }
  const contentHash = stableHash(validationCatalogContent(catalog));
  if (contentHash !== RATIFIED_VALIDATION_CATALOG_CONTENT_SHA256) {
    throw new RoadmapDeliveryError(
      "validation_catalog_stale",
      `catalog content ${contentHash} is not the ratified ${RATIFIED_VALIDATION_CATALOG_CONTENT_SHA256}`,
    );
  }
  if (current === undefined) {
    if (catalog.version !== 1 || catalog.predecessor !== null) {
      throw new RoadmapDeliveryError(
        "validation_catalog_stale",
        "the first validation catalog must be v1 with no predecessor",
      );
    }
    return;
  }
  if (sameAuthorityRef(current.ref, proposedRef)) return;
  if (
    catalog.catalogId !== current.value.catalogId ||
    catalog.version !== current.value.version + 1 ||
    catalog.predecessor === null ||
    !sameAuthorityRef(catalog.predecessor, current.ref)
  ) {
    throw new RoadmapDeliveryError(
      "validation_catalog_stale",
      `validation catalog must advance ${renderAuthorityRef(current.ref)} by exactly one version`,
    );
  }
  if (Date.parse(catalog.acceptedAt) < Date.parse(current.value.acceptedAt)) {
    throw new RoadmapDeliveryError("validation_catalog_stale", "validation catalog acceptance moved backward");
  }
  assertValidationCatalogTightens(catalog, current.value);
}

function validationCatalogContent(
  catalog: ValidationCatalog,
): Omit<ValidationCatalog, "schemaVersion" | "version" | "predecessor" | "app" | "acceptedAt"> {
  const {
    schemaVersion: _schemaVersion,
    version: _version,
    predecessor: _predecessor,
    app: _app,
    acceptedAt: _acceptedAt,
    ...content
  } = catalog;
  return content;
}

function assertValidationCatalogTightens(next: ValidationCatalog, prior: ValidationCatalog): void {
  const requireIds = <T extends ValidationCatalogId>(
    nextEntries: readonly T[],
    priorEntries: readonly T[],
    label: string,
  ): Map<string, T> => {
    const nextById = new Map(nextEntries.map((entry) => [entry.canonicalId, entry]));
    for (const old of priorEntries) {
      const replacement = nextById.get(old.canonicalId);
      if (replacement === undefined || old.aliases.some((alias) => !replacement.aliases.includes(alias))) {
        throw new RoadmapDeliveryError(
          "validation_catalog_stale",
          `${label} ${old.canonicalId} or one of its canonical aliases was removed`,
        );
      }
    }
    return nextById;
  };
  requireIds(next.journeys, prior.journeys, "journey");
  requireIds(next.contracts, prior.contracts, "contract");
  requireIds(next.interfaces, prior.interfaces, "interface");
  requireIds(next.stateOwners, prior.stateOwners, "state owner");
  requireIds(next.controlPoints, prior.controlPoints, "control point");

  const boundaries = requireIds(next.boundaries, prior.boundaries, "boundary");
  for (const old of prior.boundaries) {
    const replacement = boundaries.get(old.canonicalId)!;
    if (
      (old.requiresSharedDetector && !replacement.requiresSharedDetector) ||
      (old.sharedDetectorId !== null && replacement.sharedDetectorId !== old.sharedDetectorId) ||
      (!old.routineEligible && replacement.routineEligible)
    ) {
      throw new RoadmapDeliveryError("validation_catalog_stale", `boundary ${old.canonicalId} policy was weakened`);
    }
  }

  const invariants = requireIds(next.invariants, prior.invariants, "invariant");
  for (const old of prior.invariants) {
    if (old.floor && !invariants.get(old.canonicalId)!.floor) {
      throw new RoadmapDeliveryError("validation_catalog_stale", `invariant ${old.canonicalId} lost its floor`);
    }
  }

  const cases = requireIds(next.cases, prior.cases, "case");
  for (const old of prior.cases) {
    const replacement = cases.get(old.canonicalId)!;
    const oldLayer = VALIDATION_LAYERS.indexOf(old.cheapestFalsifyingLayer);
    const nextLayer = VALIDATION_LAYERS.indexOf(replacement.cheapestFalsifyingLayer);
    if (
      nextLayer > oldLayer ||
      old.detectorId !== replacement.detectorId ||
      (old.negativeControlRequired && !replacement.negativeControlRequired) ||
      (!old.routineEligible && replacement.routineEligible) ||
      !affectedContains(replacement.affected, old.affected)
    ) {
      throw new RoadmapDeliveryError("validation_catalog_stale", `case ${old.canonicalId} policy was weakened`);
    }
  }

  const templates = new Map(next.templates.map((entry) => [`${entry.templateId}\0${entry.version}`, entry]));
  for (const old of prior.templates) {
    const replacement = templates.get(`${old.templateId}\0${old.version}`);
    if (replacement === undefined || stableHash(replacement) !== stableHash(old)) {
      throw new RoadmapDeliveryError("validation_catalog_stale", `template ${old.templateId}@${old.version} changed`);
    }
  }

  const waiverClasses = requireIds(
    next.waiverClasses.map((entry) => ({ ...entry, canonicalId: entry.classId })),
    prior.waiverClasses.map((entry) => ({ ...entry, canonicalId: entry.classId })),
    "waiver class",
  );
  for (const old of prior.waiverClasses) {
    const replacement = waiverClasses.get(old.classId)!;
    if (
      replacement.maxDurationMs > old.maxDurationMs ||
      replacement.maxWaiversPerContract > old.maxWaiversPerContract ||
      replacement.allowedTemplateKinds.some((kind) => !old.allowedTemplateKinds.includes(kind))
    ) {
      throw new RoadmapDeliveryError("validation_catalog_stale", `waiver class ${old.classId} was widened`);
    }
  }
}

function affectedContains(superset: ValidationAffectedStructure, subset: ValidationAffectedStructure): boolean {
  return affectedStructureKeys().every((key) => subset[key].every((id) => superset[key].includes(id)));
}

function assertValidationContractBaseShape(contract: ValidationContract): void {
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

function canonicalizeValidationContract(contract: ValidationContract, catalog: ValidationCatalog): ValidationContract {
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

function assertValidationContractPolicy(contract: ValidationContract, catalog: ValidationCatalog): void {
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

function assertValidationContractRevision(
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

function assertDeliveryUnitReadinessShape(readiness: DeliveryUnitReadiness): void {
  assertExactObjectKeys(
    readiness,
    [
      "schemaVersion",
      "app",
      "unitId",
      "membershipHash",
      "roadmapRef",
      "frontierHash",
      "validationRef",
      "validationContractHash",
      "routingSnapshotHash",
      "readyAt",
    ],
    "delivery-unit readiness",
    "validation_incomplete",
  );
  if (readiness.schemaVersion !== ROADMAP_DELIVERY_SCHEMA_VERSION) {
    throw new RoadmapDeliveryError("validation_incomplete", "unsupported readiness schema");
  }
  assertId(readiness.unitId, "readiness unit id");
  assertHash(readiness.membershipHash, "readiness membership hash");
  assertHash(readiness.frontierHash, "readiness frontier hash");
  assertHash(readiness.validationContractHash, "readiness validation-contract hash");
  assertHash(readiness.routingSnapshotHash, "readiness routing hash");
  assertAuthorityRef(readiness.roadmapRef, "roadmap_plan");
  assertAuthorityRef(readiness.validationRef, "validation_contract");
  requireDateTime(readiness.readyAt, "readiness readyAt");
  if (
    typeof readiness.app !== "string" ||
    readiness.app.trim().length === 0 ||
    readiness.validationContractHash !== readiness.validationRef.sha256
  ) {
    throw new RoadmapDeliveryError("validation_incomplete", "readiness lineage is incomplete");
  }
}

function assertDirectExecutionUnit(authority: DirectExecutionUnitAuthority): void {
  const workflowKeys = authority.workflowTemplate === undefined ? ["steps"] : ["workflowTemplate"];
  assertExactObjectKeys(
    authority,
    [
      "schemaVersion",
      "kind",
      "unitId",
      "app",
      "objective",
      "inScope",
      "outOfScope",
      "acceptanceCriteria",
      "expectedArtifacts",
      "declaredConstraints",
      "safetyFacts",
      ...workflowKeys,
      "provenance",
      "dedupeKey",
      "admittedBudget",
      "createdAt",
    ],
    "direct execution unit",
    "direct_unit_incomplete",
  );
  if (authority.schemaVersion !== ROADMAP_DELIVERY_SCHEMA_VERSION || authority.kind !== "direct_operation") {
    throw new RoadmapDeliveryError("direct_unit_incomplete", "unsupported direct-unit schema");
  }
  assertId(authority.unitId, "direct unit id");
  assertNonEmpty(authority.app, "direct unit app");
  assertNonEmpty(authority.objective, "direct unit objective");
  assertNonEmpty(authority.dedupeKey, "direct unit dedupe key");
  requireDateTime(authority.createdAt, "direct unit createdAt");
  for (const [name, values] of [
    ["inScope", authority.inScope],
    ["outOfScope", authority.outOfScope],
    ["acceptanceCriteria", authority.acceptanceCriteria],
    ["expectedArtifacts", authority.expectedArtifacts],
  ] as const) {
    if (!Array.isArray(values) || values.length === 0) {
      throw new RoadmapDeliveryError("direct_unit_incomplete", `direct unit ${name} is empty`);
    }
  }
  if (!Array.isArray(authority.safetyFacts)) {
    throw new RoadmapDeliveryError("direct_unit_incomplete", "direct unit safetyFacts must be explicit");
  }
  if (
    authority.provenance === undefined ||
    !["human", "agent"].includes(authority.provenance.source) ||
    authority.provenance.creatorId.trim().length === 0 ||
    Number.isNaN(Date.parse(authority.provenance.createdAt)) ||
    authority.provenance.evidenceRefs.length === 0 ||
    authority.provenance.evidenceRefs.some((ref) => ref.trim().length === 0) ||
    Object.keys(authority.declaredConstraints).length === 0
  ) {
    throw new RoadmapDeliveryError(
      "direct_unit_incomplete",
      "direct unit requires provenance, governed template, and declared constraints",
    );
  }
  const hasTemplate = authority.workflowTemplate !== undefined;
  const hasSteps = authority.steps !== undefined;
  if (hasTemplate === hasSteps) {
    throw new RoadmapDeliveryError(
      "direct_unit_incomplete",
      "direct unit requires exactly one governed template or exact step graph",
    );
  }
  if (
    hasTemplate &&
    (authority.workflowTemplate!.id.trim().length === 0 || authority.workflowTemplate!.version.trim().length === 0)
  ) {
    throw new RoadmapDeliveryError("direct_unit_incomplete", "direct-unit workflow template is invalid");
  }
  if (hasSteps && (!Array.isArray(authority.steps) || authority.steps.length === 0)) {
    throw new RoadmapDeliveryError("direct_unit_incomplete", "direct-unit step graph is empty");
  }
  assertExecutionUnitBudget(authority.admittedBudget);
}

function normalizeExecutionUnitBudget(value: ExecutionUnitBudget | undefined): ExecutionUnitBudget {
  const budget = structuredClone(value ?? DEFAULT_EXECUTION_UNIT_BUDGET);
  assertExecutionUnitBudget(budget);
  return budget;
}

function assertExecutionUnitBudget(budget: ExecutionUnitBudget): void {
  if (
    !Number.isInteger(budget.maxProviderTurns) ||
    budget.maxProviderTurns < 0 ||
    !Number.isFinite(budget.maxEquivalentCostUsd) ||
    budget.maxEquivalentCostUsd < 0 ||
    !Number.isFinite(budget.maxMechanicalOverheadUsd) ||
    budget.maxMechanicalOverheadUsd < 0 ||
    !Number.isInteger(budget.maxActiveTimeMs) ||
    budget.maxActiveTimeMs < 0 ||
    !Number.isInteger(budget.maxHumanDecisions) ||
    budget.maxHumanDecisions < 0
  ) {
    throw new RoadmapDeliveryError("batch_hard_constraint_failed", "execution-unit budget is invalid");
  }
}

function assertExecutionBatchShape(batch: ExecutionBatch): void {
  assertExactObjectKeys(
    batch,
    batch.manifestLimits === undefined
      ? ["schemaVersion", "batchId", "version", "app", "roadmapRef", "frontierHash", "units", "admittedAt"]
      : [
          "schemaVersion",
          "batchId",
          "version",
          "app",
          "roadmapRef",
          "frontierHash",
          "units",
          "manifestLimits",
          "admittedAt",
        ],
    "execution batch",
    "batch_hard_constraint_failed",
  );
  if (batch.schemaVersion !== ROADMAP_DELIVERY_SCHEMA_VERSION) {
    throw new RoadmapDeliveryError("batch_hard_constraint_failed", "unsupported execution-batch schema");
  }
  assertId(batch.batchId, "execution batch id");
  assertVersion(batch.version, "execution batch version");
  assertNonEmpty(batch.app, "execution batch app");
  if ((batch.roadmapRef === null) !== (batch.frontierHash === null)) {
    throw new RoadmapDeliveryError("batch_hard_constraint_failed", "batch roadmap/frontier lineage is partial");
  }
  if (batch.roadmapRef !== null) assertAuthorityRef(batch.roadmapRef, "roadmap_plan");
  if (batch.frontierHash !== null) assertHash(batch.frontierHash, "execution batch frontier hash");
  requireDateTime(batch.admittedAt, "execution batch admittedAt");
  if (
    batch.manifestLimits !== undefined &&
    (!Number.isInteger(batch.manifestLimits.maxUnits) ||
      batch.manifestLimits.maxUnits <= 0 ||
      !Number.isInteger(batch.manifestLimits.maxManifestBytes) ||
      batch.manifestLimits.maxManifestBytes <= 0)
  ) {
    throw new RoadmapDeliveryError("batch_hard_constraint_failed", "execution batch limits are invalid");
  }
  if (!Array.isArray(batch.units) || batch.units.length === 0) {
    throw new RoadmapDeliveryError("batch_hard_constraint_failed", "execution batch has no units");
  }
  const unitIds = new Set<string>();
  for (const unit of batch.units) {
    if (unit.kind === "direct_operation") {
      assertExactObjectKeys(
        unit,
        ["kind", "unitId", "authorityRef", "authorityHash", "dedupeKey", "priority", "budget"],
        "direct execution batch unit",
        "batch_hard_constraint_failed",
      );
      assertId(unit.unitId, "direct execution batch unit id");
      assertAuthorityRef(unit.authorityRef, "direct_execution_unit");
      assertHash(unit.authorityHash, "direct execution authority hash");
      assertNonEmpty(unit.dedupeKey, "direct execution dedupe key");
      assertExecutionUnitBudget(unit.budget);
      if (unit.authorityHash !== unit.authorityRef.sha256) {
        throw new RoadmapDeliveryError("batch_hard_constraint_failed", "direct unit loses authority lineage");
      }
      if (unitIds.has(unit.unitId)) {
        throw new RoadmapDeliveryError("batch_hard_constraint_failed", `duplicate unit ${unit.unitId}`);
      }
      unitIds.add(unit.unitId);
      continue;
    }
    assertExactObjectKeys(
      unit,
      unit.kind === undefined
        ? ["unitId", "membershipHash", "readinessRef", "validationRef", "validationContractHash"]
        : [
            "kind",
            "unitId",
            "membershipHash",
            "readinessRef",
            "validationRef",
            "validationContractHash",
            "priority",
            "budget",
            "issueNumbers",
          ],
      "execution batch unit",
      "batch_hard_constraint_failed",
    );
    assertId(unit.unitId, "execution batch unit id");
    if (
      unit.issueNumbers !== undefined &&
      (unit.issueNumbers.length === 0 || unitMembershipHash(unit.issueNumbers) !== unit.membershipHash)
    ) {
      throw new RoadmapDeliveryError("batch_hard_constraint_failed", "batch unit membership is incomplete");
    }
    assertHash(unit.membershipHash, "execution batch membership hash");
    assertAuthorityRef(unit.readinessRef, "delivery_unit_readiness");
    assertAuthorityRef(unit.validationRef, "validation_contract");
    assertHash(unit.validationContractHash, "execution batch validation-contract hash");
    assertExecutionUnitBudget(unit.budget ?? DEFAULT_EXECUTION_UNIT_BUDGET);
    if (unitIds.has(unit.unitId) || unit.validationContractHash !== unit.validationRef.sha256) {
      throw new RoadmapDeliveryError(
        "batch_hard_constraint_failed",
        `execution batch unit ${unit.unitId} is duplicated or loses validation lineage`,
      );
    }
    unitIds.add(unit.unitId);
  }
}

function assertDeliveryEpisodeBindingShape(binding: DeliveryEpisodeBinding): void {
  assertExactObjectKeys(
    binding,
    [
      "schemaVersion",
      "app",
      "unitId",
      "membershipHash",
      "roadmapRef",
      "readinessRef",
      "validationRef",
      "validationContractHash",
      "batchRef",
      "episodeId",
      "episodePlanVersion",
      "episodePlanHash",
      "createdAt",
    ],
    "delivery episode binding",
    "evidence_unit_mismatch",
  );
  if (binding.schemaVersion !== ROADMAP_DELIVERY_SCHEMA_VERSION) {
    throw new RoadmapDeliveryError("evidence_unit_mismatch", "unsupported delivery binding schema");
  }
  assertNonEmpty(binding.app, "delivery binding app");
  assertId(binding.unitId, "delivery binding unit id");
  assertHash(binding.membershipHash, "delivery binding membership hash");
  assertAuthorityRef(binding.roadmapRef, "roadmap_plan");
  assertAuthorityRef(binding.readinessRef, "delivery_unit_readiness");
  assertAuthorityRef(binding.validationRef, "validation_contract");
  assertHash(binding.validationContractHash, "delivery binding validation-contract hash");
  assertAuthorityRef(binding.batchRef, "execution_batch");
  assertNonEmpty(binding.episodeId, "delivery binding episode id");
  assertVersion(binding.episodePlanVersion, "delivery binding EpisodePlan version");
  assertHash(binding.episodePlanHash, "delivery binding EpisodePlan hash");
  requireDateTime(binding.createdAt, "delivery binding createdAt");
  if (binding.validationContractHash !== binding.validationRef.sha256) {
    throw new RoadmapDeliveryError("evidence_unit_mismatch", "delivery binding validation hash differs");
  }
}

function assertCatalogIds(entries: readonly ValidationCatalogId[], label: string): void {
  const seen = new Map<string, string>();
  for (const entry of entries) {
    assertMachineId(entry.canonicalId, `${label} canonical id`);
    assertStringList(entry.aliases, `${label} ${entry.canonicalId} aliases`, true);
    for (const id of [entry.canonicalId, ...entry.aliases]) {
      const prior = seen.get(id);
      if (prior !== undefined) {
        throw new RoadmapDeliveryError(
          "validation_contract_invalid",
          `${label} id ${id} resolves ambiguously to ${prior} and ${entry.canonicalId}`,
        );
      }
      seen.set(id, entry.canonicalId);
    }
  }
}

function assertWaiverClassIds(entries: readonly ValidationWaiverClass[]): void {
  assertCatalogIds(
    entries.map((entry) => ({ canonicalId: entry.classId, aliases: entry.aliases })),
    "waiver class",
  );
}

function resolveValidationId(entries: readonly ValidationCatalogId[], id: string, label: string): string {
  const matches = entries.filter((entry) => entry.canonicalId === id || entry.aliases.includes(id));
  if (matches.length !== 1) {
    throw new RoadmapDeliveryError("validation_id_unknown", `unknown or ambiguous ${label} ID ${id}`);
  }
  return matches[0]!.canonicalId;
}

function resolveWaiverClassId(entries: readonly ValidationWaiverClass[], id: string): string {
  return resolveValidationId(
    entries.map((entry) => ({ canonicalId: entry.classId, aliases: entry.aliases })),
    id,
    "waiver class",
  );
}

function resolveTemplateId(entries: readonly ValidationCatalogTemplate[], id: string, version: number): string {
  const matches = entries.filter(
    (entry) => entry.version === version && (entry.templateId === id || entry.aliases.includes(id)),
  );
  if (matches.length !== 1) {
    throw new RoadmapDeliveryError(
      "validation_id_unknown",
      `unknown or ambiguous validation template ${id}@${version}`,
    );
  }
  return matches[0]!.templateId;
}

function canonicalizeAffectedStructure(
  affected: ValidationAffectedStructure,
  catalog: ValidationCatalog,
): ValidationAffectedStructure {
  return {
    journeyIds: affected.journeyIds.map((id) => resolveValidationId(catalog.journeys, id, "journey")),
    boundaryIds: affected.boundaryIds.map((id) => resolveValidationId(catalog.boundaries, id, "boundary")),
    contractIds: affected.contractIds.map((id) => resolveValidationId(catalog.contracts, id, "contract")),
    invariantIds: affected.invariantIds.map((id) => resolveValidationId(catalog.invariants, id, "invariant")),
    interfaceIds: affected.interfaceIds.map((id) => resolveValidationId(catalog.interfaces, id, "interface")),
    stateOwnerIds: affected.stateOwnerIds.map((id) => resolveValidationId(catalog.stateOwners, id, "state owner")),
    controlPointIds: affected.controlPointIds.map((id) =>
      resolveValidationId(catalog.controlPoints, id, "control point"),
    ),
  };
}

function assertCanonicalAffectedStructure(
  affected: ValidationAffectedStructure,
  catalog: ValidationCatalog,
  label: string,
): void {
  const canonical = canonicalizeAffectedStructure(affected, catalog);
  if (stableHash(canonical) !== stableHash(affected)) {
    throw new RoadmapDeliveryError("validation_contract_invalid", `${label} did not persist canonical validation IDs`);
  }
}

function assertAffectedStructureShape(affected: ValidationAffectedStructure, label: string, allowEmpty: boolean): void {
  assertExactObjectKeys(
    affected,
    ["journeyIds", "boundaryIds", "contractIds", "invariantIds", "interfaceIds", "stateOwnerIds", "controlPointIds"],
    label,
  );
  const rows: Array<[string, string[]]> = [
    ["journeys", affected.journeyIds],
    ["boundaries", affected.boundaryIds],
    ["contracts", affected.contractIds],
    ["invariants", affected.invariantIds],
    ["interfaces", affected.interfaceIds],
    ["state owners", affected.stateOwnerIds],
    ["control points", affected.controlPointIds],
  ];
  for (const [name, values] of rows) {
    assertStringList(values, `${label} ${name}`, allowEmpty || name === "control points");
  }
}

function emptyAffectedStructure(): ValidationAffectedStructure {
  return {
    journeyIds: [],
    boundaryIds: [],
    contractIds: [],
    invariantIds: [],
    interfaceIds: [],
    stateOwnerIds: [],
    controlPointIds: [],
  };
}

function mergeAffectedStructure(target: ValidationAffectedStructure, source: ValidationAffectedStructure): void {
  for (const key of affectedStructureKeys()) {
    target[key] = [...new Set([...target[key], ...source[key]])].sort();
  }
}

function assertAffectedStructureEqual(
  actual: ValidationAffectedStructure,
  expected: ValidationAffectedStructure,
): void {
  for (const key of affectedStructureKeys()) {
    const left = [...actual[key]].sort();
    const right = [...expected[key]].sort();
    if (stableHash(left) !== stableHash(right)) {
      throw new RoadmapDeliveryError(
        "validation_contract_invalid",
        `validation obligations do not exactly cover affected ${key}: expected ${right.join(",")}`,
      );
    }
  }
}

function affectedStructureKeys(): Array<keyof ValidationAffectedStructure> {
  return [
    "journeyIds",
    "boundaryIds",
    "contractIds",
    "invariantIds",
    "interfaceIds",
    "stateOwnerIds",
    "controlPointIds",
  ];
}

function assertCoverageSupported(obligation: ValidationObligation, entry: ValidationCatalogCase): void {
  for (const key of affectedStructureKeys()) {
    const supported = new Set(entry.affected[key]);
    const unsupported = obligation.covers[key].filter((id) => !supported.has(id));
    if (unsupported.length > 0) {
      throw new RoadmapDeliveryError(
        "validation_contract_invalid",
        `${obligation.caseId} does not cover ${key}: ${unsupported.join(",")}`,
      );
    }
  }
}

function assertValidationWaiver(
  obligation: ValidationObligation,
  contract: ValidationContract,
  catalog: ValidationCatalog,
  templateKind: ValidationCatalogTemplate["kind"],
  contractHasFloor: boolean,
  contractHasC3: boolean,
): void {
  const waiver = obligation.waiver!;
  assertExactObjectKeys(
    waiver,
    [
      "waiverId",
      "policyClassId",
      "obligationId",
      "unitId",
      "contractId",
      "contractVersion",
      "reason",
      "provenance",
      "expiresAt",
    ],
    "validation waiver",
  );
  assertExactObjectKeys(waiver.provenance, ["actorId", "authorityRef", "decidedAt"], "validation waiver provenance");
  assertMachineId(waiver.waiverId, "validation waiver id");
  assertNonEmpty(waiver.reason, "validation waiver reason");
  assertNonEmpty(waiver.provenance.actorId, "validation waiver actor");
  assertNonEmpty(waiver.provenance.authorityRef, "validation waiver authority ref");
  const decidedAt = Date.parse(requireDateTime(waiver.provenance.decidedAt, "validation waiver decidedAt"));
  const expiresAt = Date.parse(requireDateTime(waiver.expiresAt, "validation waiver expiresAt"));
  const acceptedAt = Date.parse(contract.acceptedAt);
  const policy = catalog.waiverClasses.find((entry) => entry.classId === waiver.policyClassId);
  if (
    policy === undefined ||
    waiver.obligationId !== obligation.obligationId ||
    waiver.unitId !== contract.unitId ||
    waiver.contractId !== contract.contractId ||
    waiver.contractVersion !== contract.version ||
    !policy.allowedTemplateKinds.includes(templateKind) ||
    decidedAt > acceptedAt ||
    acceptedAt >= expiresAt ||
    expiresAt - decidedAt > policy.maxDurationMs ||
    contractHasFloor ||
    contractHasC3 ||
    obligation.covers.controlPointIds.length > 0 ||
    obligation.covers.invariantIds.some(
      (id) => catalog.invariants.find((entry) => entry.canonicalId === id)?.floor === true,
    )
  ) {
    throw new RoadmapDeliveryError(
      "validation_waiver_invalid",
      `waiver ${waiver.waiverId} is stale, unbounded, mismatched, or forbidden`,
    );
  }
}

async function assertValidationWaiverAuthorities(root: string, contract: ValidationContract): Promise<void> {
  const store = new ApprovalStore(root);
  let decided: Awaited<ReturnType<ApprovalStore["listDecidedReadOnly"]>>;
  try {
    decided = await store.listDecidedReadOnly();
  } catch (error) {
    throw new RoadmapDeliveryError(
      "validation_waiver_invalid",
      `validation waiver authority store is unreadable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  for (const obligation of contract.obligations) {
    const waiver = obligation.waiver;
    if (waiver === null) continue;
    const match = /^approval:([A-Za-z0-9._-]+)$/.exec(waiver.provenance.authorityRef);
    if (match?.[1] === undefined) {
      throw new RoadmapDeliveryError(
        "validation_waiver_invalid",
        `waiver ${waiver.waiverId} does not name a durable approval authority`,
      );
    }
    const approved = decided.find((item) => item.id === match[1]);
    if (approved === undefined) {
      throw new RoadmapDeliveryError(
        "validation_waiver_invalid",
        `waiver ${waiver.waiverId} approval authority is missing`,
      );
    }
    const expectedAction = validationWaiverApprovalAction(contract, obligation);
    let approvalRecord: Awaited<ReturnType<ApprovalStore["show"]>>;
    try {
      approvalRecord = await store.show(approved.id);
    } catch (error) {
      throw new RoadmapDeliveryError(
        "validation_waiver_invalid",
        `waiver ${waiver.waiverId} approval grant is unreadable: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (
      approved.app !== contract.app ||
      approved.rule !== "validation-waiver" ||
      approved.decision !== "approved" ||
      approved.status !== "approved" ||
      approved.decidedBy?.kind !== "human" ||
      approved.decidedBy.identity !== waiver.provenance.actorId ||
      approved.decidedAt !== waiver.provenance.decidedAt ||
      stableHash(approved.action) !== stableHash(expectedAction) ||
      approvalRecord.grant === undefined ||
      approvalRecord.grant.approvalId !== approved.id ||
      approvalRecord.grant.revokedAt !== undefined ||
      Date.parse(approvalRecord.grant.expiresAt) < Date.parse(waiver.expiresAt)
    ) {
      throw new RoadmapDeliveryError(
        "validation_waiver_invalid",
        `waiver ${waiver.waiverId} does not reproduce its exact human approval`,
      );
    }
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

function assertStringList(values: unknown, label: string, allowEmpty = false): void {
  if (
    !Array.isArray(values) ||
    (!allowEmpty && values.length === 0) ||
    values.some((value) => typeof value !== "string" || value.trim().length === 0) ||
    new Set(values).size !== values.length
  ) {
    throw new RoadmapDeliveryError("validation_contract_invalid", `${label} is missing, blank, or duplicated`);
  }
}

function assertNonEmpty(value: unknown, label: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new RoadmapDeliveryError("validation_contract_invalid", `${label} is required`);
  }
}

function assertMachineId(value: unknown, label: string): void {
  if (typeof value !== "string" || !MACHINE_ID.test(value)) {
    throw new RoadmapDeliveryError("validation_contract_invalid", `${label} is invalid: ${value}`);
  }
}

async function ensureValidationProposalLifecycle(root: string, contract: ValidationContract): Promise<void> {
  const path = validationContractLifecyclePath(
    root,
    contract.app,
    contract.unitId,
    contract.contractId,
    contract.version,
  );
  const proposalHash = stableHash(contract);
  const record: ValidationContractLifecycleRecord = {
    schemaVersion: VALIDATION_CONTRACT_SCHEMA_VERSION,
    app: contract.app,
    unitId: contract.unitId,
    contractId: contract.contractId,
    version: contract.version,
    proposalHash,
    acceptedRef: null,
    predecessor: contract.predecessor,
    state: "proposed",
    transitions: [{ state: "proposed", at: contract.proposedAt, authorityRef: null }],
  };
  const won = await writeLoopFileOnce(path, `${JSON.stringify(record, null, 2)}\n`);
  if (won) return;
  const existing = await readValidationContractLifecycle(
    root,
    contract.app,
    contract.unitId,
    contract.contractId,
    contract.version,
  );
  if (
    existing === undefined ||
    existing.proposalHash !== proposalHash ||
    existing.app !== contract.app ||
    existing.unitId !== contract.unitId ||
    !sameNullableAuthorityRef(existing.predecessor, contract.predecessor)
  ) {
    throw new RoadmapDeliveryError(
      "authority_conflict",
      `validation proposal ${contract.contractId}@${contract.version} already differs`,
    );
  }
}

async function transitionValidationLifecycle(
  root: string,
  contract: ValidationContract,
  next: ValidationContractLifecycleState,
  at: string,
  authorityRef: AuthorityRef | null,
): Promise<void> {
  await transitionPersistedValidationLifecycle(root, contract, next, at, authorityRef);
}

async function transitionPersistedValidationLifecycle(
  root: string,
  contract: ValidationContract,
  next: ValidationContractLifecycleState,
  at: string,
  authorityRef: AuthorityRef | null,
): Promise<void> {
  const current = await readValidationContractLifecycle(
    root,
    contract.app,
    contract.unitId,
    contract.contractId,
    contract.version,
  );
  if (current === undefined) {
    throw new RoadmapDeliveryError("authority_corrupt", "validation lifecycle proposal is missing");
  }
  if (current.state === next) {
    const latestRef = current.transitions.at(-1)?.authorityRef ?? null;
    if (
      (next === "accepted" &&
        (authorityRef === null ||
          current.acceptedRef === null ||
          !sameAuthorityRef(current.acceptedRef, authorityRef))) ||
      (next === "superseded" &&
        (authorityRef === null || latestRef === null || !sameAuthorityRef(latestRef, authorityRef))) ||
      (next !== "accepted" && next !== "superseded" && authorityRef !== null)
    ) {
      throw new RoadmapDeliveryError("authority_conflict", `validation lifecycle ${next} replay differs`);
    }
    return;
  }
  const allowed: Record<ValidationContractLifecycleState, ValidationContractLifecycleState[]> = {
    proposed: ["validated"],
    validated: ["accepted"],
    accepted: ["superseded"],
    superseded: [],
  };
  if (!allowed[current.state].includes(next)) {
    throw new RoadmapDeliveryError(
      "validation_contract_stale",
      `illegal validation lifecycle transition ${current.state} → ${next}`,
    );
  }
  requireDateTime(at, `validation ${next} transition`);
  const lastAt = Date.parse(current.transitions.at(-1)!.at);
  if (Date.parse(at) < lastAt) {
    throw new RoadmapDeliveryError("validation_contract_stale", "validation lifecycle moved backward in time");
  }
  if ((next === "accepted" || next === "superseded") && authorityRef === null) {
    throw new RoadmapDeliveryError("authority_corrupt", `validation ${next} transition lacks authority ref`);
  }
  const updated: ValidationContractLifecycleRecord = {
    ...current,
    state: next,
    acceptedRef: next === "accepted" ? authorityRef : current.acceptedRef,
    transitions: [...current.transitions, { state: next, at, authorityRef }],
  };
  await writeLoopFileAtomic(
    validationContractLifecyclePath(root, contract.app, contract.unitId, contract.contractId, contract.version),
    `${JSON.stringify(updated, null, 2)}\n`,
  );
}

async function readCurrentAuthorityPointer(
  path: string,
  kind: AuthorityRef["kind"],
  app: string,
  unitId?: string,
): Promise<AuthorityRef | undefined> {
  if (!existsSync(path)) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    throw new RoadmapDeliveryError(
      "authority_corrupt",
      `current ${kind} pointer is unreadable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new RoadmapDeliveryError("authority_corrupt", `current ${kind} pointer is invalid`);
  }
  const row = parsed as Record<string, unknown>;
  const expectedKeys =
    unitId === undefined
      ? ["schemaVersion", "app", "ref", "updatedAt"]
      : ["schemaVersion", "app", "unitId", "ref", "updatedAt"];
  if (
    stableHash(Object.keys(row).sort()) !== stableHash(expectedKeys.sort()) ||
    row["schemaVersion"] !== 1 ||
    row["app"] !== app ||
    typeof row["updatedAt"] !== "string" ||
    Number.isNaN(Date.parse(row["updatedAt"])) ||
    (unitId !== undefined && row["unitId"] !== unitId) ||
    row["ref"] === null ||
    typeof row["ref"] !== "object" ||
    Array.isArray(row["ref"])
  ) {
    throw new RoadmapDeliveryError("authority_corrupt", `current ${kind} pointer is invalid`);
  }
  const ref = row["ref"] as AuthorityRef;
  try {
    assertAuthorityRef(ref, kind);
  } catch {
    throw new RoadmapDeliveryError("authority_corrupt", `current ${kind} pointer ref is invalid`);
  }
  return ref;
}

function isValidationContractLifecycleRecord(value: unknown): value is ValidationContractLifecycleRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  try {
    assertExactObjectKeys(
      row,
      [
        "schemaVersion",
        "app",
        "unitId",
        "contractId",
        "version",
        "proposalHash",
        "acceptedRef",
        "predecessor",
        "state",
        "transitions",
      ],
      "validation lifecycle",
    );
  } catch {
    return false;
  }
  if (
    row["schemaVersion"] !== VALIDATION_CONTRACT_SCHEMA_VERSION ||
    typeof row["app"] !== "string" ||
    row["app"].trim().length === 0 ||
    typeof row["unitId"] !== "string" ||
    !ID.test(row["unitId"]) ||
    typeof row["contractId"] !== "string" ||
    !ID.test(row["contractId"]) ||
    !Number.isSafeInteger(row["version"]) ||
    Number(row["version"]) < 1 ||
    typeof row["proposalHash"] !== "string" ||
    !HASH.test(row["proposalHash"] as string) ||
    !["proposed", "validated", "accepted", "superseded"].includes(String(row["state"])) ||
    !Array.isArray(row["transitions"]) ||
    row["transitions"].length === 0
  )
    return false;
  const version = Number(row["version"]);
  const predecessor = row["predecessor"];
  const acceptedRef = row["acceptedRef"];
  try {
    if (predecessor !== null) assertAuthorityRef(predecessor as AuthorityRef, "validation_contract");
    if (acceptedRef !== null) assertAuthorityRef(acceptedRef as AuthorityRef, "validation_contract");
  } catch {
    return false;
  }
  if (
    (version === 1) !== (predecessor === null) ||
    (predecessor !== null &&
      ((predecessor as AuthorityRef).id !== row["contractId"] ||
        (predecessor as AuthorityRef).version !== version - 1)) ||
    (acceptedRef !== null &&
      ((acceptedRef as AuthorityRef).id !== row["contractId"] ||
        (acceptedRef as AuthorityRef).version !== version ||
        (acceptedRef as AuthorityRef).sha256 !== row["proposalHash"]))
  )
    return false;

  const transitions = row["transitions"] as unknown[];
  const legalStates: ValidationContractLifecycleState[] = ["proposed", "validated", "accepted", "superseded"];
  if (transitions.length > legalStates.length) return false;
  let lastAt = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < transitions.length; index += 1) {
    const transition = transitions[index];
    if (transition === null || typeof transition !== "object" || Array.isArray(transition)) return false;
    const entry = transition as Record<string, unknown>;
    try {
      assertExactObjectKeys(entry, ["state", "at", "authorityRef"], "validation lifecycle transition");
    } catch {
      return false;
    }
    const expectedState = legalStates[index];
    const at = typeof entry["at"] === "string" ? Date.parse(entry["at"]) : Number.NaN;
    if (entry["state"] !== expectedState || !Number.isFinite(at) || at < lastAt) return false;
    lastAt = at;
    const transitionRef = entry["authorityRef"];
    if (expectedState === "proposed" || expectedState === "validated") {
      if (transitionRef !== null) return false;
    } else {
      try {
        assertAuthorityRef(transitionRef as AuthorityRef, "validation_contract");
      } catch {
        return false;
      }
      if (
        expectedState === "accepted" &&
        (acceptedRef === null || !sameAuthorityRef(transitionRef as AuthorityRef, acceptedRef as AuthorityRef))
      )
        return false;
      if (
        expectedState === "superseded" &&
        ((transitionRef as AuthorityRef).id !== row["contractId"] ||
          (transitionRef as AuthorityRef).version !== version + 1)
      )
        return false;
    }
  }
  const finalState = legalStates[transitions.length - 1];
  return (
    row["state"] === finalState &&
    (finalState === "proposed" || finalState === "validated" ? acceptedRef === null : acceptedRef !== null)
  );
}

function sameNullableAuthorityRef(left: AuthorityRef | null, right: AuthorityRef | null): boolean {
  return left === null ? right === null : right !== null && sameAuthorityRef(left, right);
}

function assertBuilderEvidenceShape(manifest: BuilderEvidenceManifest): void {
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

function assertReviewerVerdictShape(verdict: ReviewerVerdict): void {
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

function assertRoutingEligible(unit: RoadmapDeliveryUnit, routing: readonly RoutingSnapshotEntry[]): void {
  if (new Set(routing.map((entry) => entry.issueNumber)).size !== routing.length) {
    throw new RoadmapDeliveryError("routing_ineligible", "routing snapshot contains duplicate issue facts");
  }
  const byIssue = new Map(routing.map((entry) => [entry.issueNumber, entry]));
  for (const issueNumber of unit.issueNumbers) {
    const current = byIssue.get(issueNumber);
    if (
      current === undefined ||
      current.disposition !== "automated" ||
      !Array.isArray(current.observedLabels) ||
      current.observedLabels.some((label) => typeof label !== "string" || label.trim().length === 0) ||
      new Set(current.observedLabels).size !== current.observedLabels.length ||
      autonomousExecutionExclusionLabel(current.observedLabels) !== undefined
    ) {
      const exclusion =
        current === undefined
          ? "unreadable"
          : (autonomousExecutionExclusionLabel(current.observedLabels) ?? current.disposition);
      throw new RoadmapDeliveryError(
        "routing_ineligible",
        `delivery unit ${unit.unitId} is excluded because #${issueNumber} is ${exclusion}`,
      );
    }
  }
}

function routingSnapshotHash(unit: RoadmapDeliveryUnit, routing: readonly RoutingSnapshotEntry[]): string {
  assertRoutingEligible(unit, routing);
  const byIssue = new Map(routing.map((entry) => [entry.issueNumber, entry]));
  return stableHash(
    [...unit.issueNumbers].sort(numeric).map((issueNumber) => ({
      issueNumber,
      disposition: byIssue.get(issueNumber)?.disposition,
      observedLabels: [...(byIssue.get(issueNumber)?.observedLabels ?? [])].sort(),
    })),
  );
}

function requireUnit(plan: RoadmapPlan, unitId: string): RoadmapDeliveryUnit {
  const unit = plan.deliveryUnits.find((candidate) => candidate.unitId === unitId);
  if (unit === undefined) {
    throw new RoadmapDeliveryError("issue_unaccounted", `RoadmapPlan has no unit ${unitId}`);
  }
  return unit;
}

function assertAcyclic(units: readonly RoadmapDeliveryUnit[]): void {
  const byId = new Map(units.map((unit) => [unit.unitId, unit]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visited.has(id)) return;
    if (visiting.has(id)) throw new RoadmapDeliveryError("unit_cycle", `cycle includes ${id}`);
    visiting.add(id);
    for (const dependency of byId.get(id)?.dependsOn ?? []) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };
  for (const unit of units) visit(unit.unitId);
}

async function persistAuthority<T>(
  root: string,
  app: string,
  kind: AuthorityRef["kind"],
  id: string,
  version: number,
  value: T,
): Promise<AcceptedAuthority<T>> {
  assertId(id, `${kind} id`);
  assertVersion(version, `${kind} version`);
  const ref: AuthorityRef = { kind, id, version, sha256: stableHash(value) };
  const accepted: AcceptedAuthority<T> = {
    schemaVersion: ROADMAP_DELIVERY_SCHEMA_VERSION,
    ref,
    value: structuredClone(value),
  };
  const path = authorityPath(root, app, kind, id, version);
  const won = await writeLoopFileOnce(path, `${JSON.stringify(accepted, null, 2)}\n`);
  if (!won) {
    const existing = await readAuthorityFile<T>(path);
    if (!sameAuthorityRef(existing.ref, ref) || stableHash(existing.value) !== ref.sha256) {
      throw new RoadmapDeliveryError("authority_conflict", `${kind} ${id}@${version} already differs`);
    }
  }
  const persisted = await readAuthorityFile<T>(path);
  if (!sameAuthorityRef(persisted.ref, ref) || stableHash(persisted.value) !== ref.sha256) {
    throw new RoadmapDeliveryError("authority_corrupt", `${kind} ${id}@${version} failed readback`);
  }
  return persisted;
}

async function requireAuthority<T>(
  root: string,
  app: string,
  ref: AuthorityRef,
  kind: AuthorityRef["kind"],
  missingCode: RoadmapDeliveryFailureCode,
): Promise<AcceptedAuthority<T>> {
  assertAuthorityRef(ref, kind);
  const path = authorityPath(root, app, kind, ref.id, ref.version);
  if (!existsSync(path)) {
    throw new RoadmapDeliveryError(missingCode, `${renderAuthorityRef(ref)} is missing`);
  }
  const accepted = await readAuthorityFile<T>(path);
  if (!sameAuthorityRef(accepted.ref, ref) || stableHash(accepted.value) !== ref.sha256) {
    throw new RoadmapDeliveryError("authority_corrupt", `${renderAuthorityRef(ref)} failed content binding`);
  }
  return accepted;
}

async function readAuthorityFile<T>(path: string): Promise<AcceptedAuthority<T>> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    throw new RoadmapDeliveryError(
      "authority_corrupt",
      `${path} is unreadable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!isAcceptedAuthority(parsed)) {
    throw new RoadmapDeliveryError("authority_corrupt", `${path} is not an accepted authority envelope`);
  }
  return parsed as AcceptedAuthority<T>;
}

function isAcceptedAuthority(value: unknown): value is AcceptedAuthority<unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  if (row["schemaVersion"] !== ROADMAP_DELIVERY_SCHEMA_VERSION || !("value" in row)) return false;
  const ref = row["ref"];
  if (ref === null || typeof ref !== "object" || Array.isArray(ref)) return false;
  const candidate = ref as Record<string, unknown>;
  return (
    typeof candidate["kind"] === "string" &&
    typeof candidate["id"] === "string" &&
    Number.isInteger(candidate["version"]) &&
    typeof candidate["sha256"] === "string"
  );
}

function authorityPath(root: string, app: string, kind: AuthorityRef["kind"], id: string, version: number): string {
  assertId(id, `${kind} id`);
  assertVersion(version, `${kind} version`);
  return join(planningAppDir(root, app), `${kind}s`, id, `v${version}.json`);
}

function planningAppDir(root: string, app: string): string {
  const appKey = stableHash(app).slice(0, 32);
  return join(resolve(root), "planning", "apps", appKey);
}

function executionUnitIdentityHash(unit: ExecutionUnit): string {
  return unit.kind === "direct_operation"
    ? stableHash({ kind: unit.kind, dedupeKey: unit.dedupeKey })
    : stableHash({ kind: "roadmap_code", membershipHash: unit.membershipHash });
}

function initialExecutionUnitJournal(
  batch: AcceptedAuthority<ExecutionBatch>,
  unit: ExecutionUnit,
): ExecutionUnitJournal {
  return {
    schemaVersion: ROADMAP_DELIVERY_SCHEMA_VERSION,
    app: batch.value.app,
    batchRef: batch.ref,
    unitId: unit.unitId,
    unitIdentityHash: executionUnitIdentityHash(unit),
    state: "admitted",
    budget: normalizeExecutionUnitBudget(unit.budget),
    usage: {
      providerTurns: 0,
      equivalentCostUsd: 0,
      mechanicalOverheadUsd: 0,
      activeTimeMs: 0,
      humanDecisions: 0,
    },
    episodeBindingRef: null,
    claimSettlementId: null,
    evidenceRefs: [],
    candidateHead: null,
    pullRequestNumber: null,
    outcome: null,
    updatedAt: batch.value.admittedAt,
  };
}

async function ensureExecutionUnitJournal(
  root: string,
  batch: AcceptedAuthority<ExecutionBatch>,
  unit: ExecutionUnit,
): Promise<ExecutionUnitJournal> {
  const path = executionUnitJournalPath(root, batch.value.app, batch.ref.id, unit.unitId);
  const initial = initialExecutionUnitJournal(batch, unit);
  const won = await writeLoopFileOnce(path, `${JSON.stringify(initial, null, 2)}\n`);
  const current = won ? initial : await readExecutionUnitJournal(root, batch.value.app, batch.ref.id, unit.unitId);
  if (
    current === undefined ||
    current.unitIdentityHash !== initial.unitIdentityHash ||
    !sameAuthorityRef(current.batchRef, batch.ref)
  ) {
    throw new RoadmapDeliveryError("unit_journal_conflict", `${unit.unitId} journal differs from batch authority`);
  }
  return current;
}

function addExecutionUnitUsage(
  current: ExecutionUnitJournal["usage"],
  delta: Partial<ExecutionUnitJournal["usage"]>,
): ExecutionUnitJournal["usage"] {
  const next = {
    providerTurns: current.providerTurns + (delta.providerTurns ?? 0),
    equivalentCostUsd: current.equivalentCostUsd + (delta.equivalentCostUsd ?? 0),
    mechanicalOverheadUsd: current.mechanicalOverheadUsd + (delta.mechanicalOverheadUsd ?? 0),
    activeTimeMs: current.activeTimeMs + (delta.activeTimeMs ?? 0),
    humanDecisions: current.humanDecisions + (delta.humanDecisions ?? 0),
  };
  if (Object.values(next).some((value) => !Number.isFinite(value) || value < 0)) {
    throw new RoadmapDeliveryError("unit_journal_conflict", "unit usage delta is invalid");
  }
  return next;
}

function assertUsageWithinBudget(usage: ExecutionUnitJournal["usage"], budget: ExecutionUnitBudget): void {
  if (
    usage.providerTurns > budget.maxProviderTurns ||
    usage.equivalentCostUsd > budget.maxEquivalentCostUsd ||
    usage.mechanicalOverheadUsd > budget.maxMechanicalOverheadUsd ||
    usage.activeTimeMs > budget.maxActiveTimeMs ||
    usage.humanDecisions > budget.maxHumanDecisions
  ) {
    throw new RoadmapDeliveryError("unit_budget_exhausted", "unit usage exceeds its own admitted budget");
  }
}

function assertExecutionUnitJournal(journal: ExecutionUnitJournal): void {
  if (
    journal.schemaVersion !== ROADMAP_DELIVERY_SCHEMA_VERSION ||
    journal.app.trim().length === 0 ||
    !HASH.test(journal.unitIdentityHash) ||
    ![
      "admitted",
      "planning",
      "claimed",
      "running",
      "reviewing",
      "approved",
      "returned",
      "failed",
      "completed",
    ].includes(journal.state)
  ) {
    throw new RoadmapDeliveryError("unit_journal_conflict", "execution-unit journal is invalid");
  }
  assertAuthorityRef(journal.batchRef, "execution_batch");
  assertExecutionUnitBudget(journal.budget);
  assertUsageWithinBudget(journal.usage, journal.budget);
  requireDateTime(journal.updatedAt, "execution-unit journal updatedAt");
  if (isTerminalJournalState(journal.state) !== (journal.outcome !== null)) {
    throw new RoadmapDeliveryError("unit_journal_conflict", "terminal journal outcome is partial");
  }
}

function isTerminalJournalState(state: ExecutionUnitJournalState): boolean {
  return state === "completed" || state === "returned" || state === "failed";
}

async function writeBatchDispositionIfComplete(
  root: string,
  batch: AcceptedAuthority<ExecutionBatch>,
  now: Date,
): Promise<void> {
  const journals = await Promise.all(
    batch.value.units.map((unit) => readExecutionUnitJournal(root, batch.value.app, batch.ref.id, unit.unitId)),
  );
  if (journals.some((journal) => journal === undefined || !isTerminalJournalState(journal.state))) return;
  const value: ExecutionBatchDisposition = {
    schemaVersion: ROADMAP_DELIVERY_SCHEMA_VERSION,
    app: batch.value.app,
    batchRef: batch.ref,
    units: journals.map((journal) => ({
      unitId: journal!.unitId,
      outcome: journal!.outcome!,
      journalHash: stableHash(journal),
    })),
    completedAt:
      journals
        .map((journal) => journal!.updatedAt)
        .sort()
        .at(-1) ?? now.toISOString(),
  };
  const path = executionBatchDispositionPath(root, batch.value.app, batch.ref.id);
  const won = await writeLoopFileOnce(path, `${JSON.stringify(value, null, 2)}\n`);
  if (!won) {
    const existing = JSON.parse(await readFile(path, "utf8")) as ExecutionBatchDisposition;
    if (stableHash(existing) !== stableHash(value)) {
      throw new RoadmapDeliveryError(
        "unit_journal_conflict",
        "execution-batch disposition differs from terminal journals",
      );
    }
  }
}

export function executionBatchDispositionPath(root: string, app: string, batchId: string): string {
  assertId(batchId, "execution batch disposition id");
  return join(planningAppDir(root, app), "execution-batch-dispositions", `${batchId}.json`);
}

async function assertNoActiveExecutionUnitOverlap(
  root: string,
  app: string,
  candidates: readonly ExecutionUnit[],
): Promise<void> {
  const candidateKeys = new Set(candidates.flatMap(executionUnitExclusiveKeys));
  const directory = join(planningAppDir(root, app), "execution_batchs");
  if (!existsSync(directory)) return;
  for (const batchId of await readdir(directory)) {
    const batchDir = join(directory, batchId);
    let versions: string[];
    try {
      versions = await readdir(batchDir);
    } catch {
      continue;
    }
    for (const version of versions.filter((name) => /^v\d+\.json$/.test(name))) {
      const batch = await readAuthorityFile<ExecutionBatch>(join(batchDir, version));
      assertExecutionBatchShape(batch.value);
      for (const unit of batch.value.units) {
        const journal = await readExecutionUnitJournal(root, app, batch.ref.id, unit.unitId);
        if (journal !== undefined && isTerminalJournalState(journal.state)) continue;
        if (executionUnitExclusiveKeys(unit).some((key) => candidateKeys.has(key))) {
          throw new RoadmapDeliveryError(
            "batch_membership_active",
            `${unit.unitId} overlaps an active execution unit in batch ${batch.ref.id}`,
          );
        }
      }
    }
  }
}

function executionUnitExclusiveKeys(unit: ExecutionUnit): string[] {
  return unit.kind === "direct_operation"
    ? [`direct:${unit.dedupeKey}`]
    : [`code-membership:${unit.membershipHash}`, ...(unit.issueNumbers ?? []).map((number) => `issue:${number}`)];
}

function roadmapMutationLockPath(root: string, app: string): string {
  return join(planningAppDir(root, app), "roadmap-mutation.lock");
}

function batchMutationLockPath(root: string, app: string): string {
  return join(planningAppDir(root, app), "execution-batch.lock");
}

function executionUnitJournalLockPath(root: string, app: string, batchId: string, unitId: string): string {
  return join(planningAppDir(root, app), "execution-unit-journals", batchId, `${unitId}.lock`);
}

function validationMutationLockPath(root: string, app: string): string {
  return join(planningAppDir(root, app), "validation-mutation.lock");
}

function claimRecordPath(root: string, settlementId: string): string {
  return join(resolve(root), CLAIM_NAMESPACE, "records", `${settlementId}.json`);
}

async function projectAccepted<T>(
  root: string,
  app: string,
  accepted: AcceptedAuthority<T>,
  project?: RoadmapDeliveryProjector,
): Promise<void> {
  if (project === undefined) return;
  const path = authorityPath(root, app, accepted.ref.kind, accepted.ref.id, accepted.ref.version);
  if (!existsSync(path)) {
    throw new RoadmapDeliveryError("authority_corrupt", `projection preceded persistence: ${path}`);
  }
  await project({ kind: accepted.ref.kind, app, path, authorityRef: accepted.ref });
}

async function projectClaim(
  root: string,
  app: string,
  settlementId: string,
  kind: Extract<
    RoadmapDeliveryProjection["kind"],
    "delivery_unit_claimed" | "delivery_unit_claim_committed" | "delivery_unit_settled"
  >,
  project?: RoadmapDeliveryProjector,
): Promise<void> {
  if (project === undefined) return;
  const path = claimRecordPath(root, settlementId);
  if (!existsSync(path)) {
    throw new RoadmapDeliveryError("authority_corrupt", `claim projection preceded persistence: ${path}`);
  }
  await project({ kind, app, path, settlementId });
}

function renderAuthorityRef(ref: AuthorityRef): string {
  return `${ref.kind}:${ref.id}@${ref.version}#${ref.sha256}`;
}

function sameAuthorityRef(left: AuthorityRef, right: AuthorityRef): boolean {
  return (
    left.kind === right.kind && left.id === right.id && left.version === right.version && left.sha256 === right.sha256
  );
}

function authorityRefForSnapshot(snapshot: BacklogSnapshot): AuthorityRef {
  return {
    kind: "backlog_snapshot",
    id: snapshot.snapshotId,
    version: snapshot.version,
    sha256: stableHash(snapshot),
  };
}

function isCurrentRoadmapPointer(value: unknown): value is CurrentRoadmapPointer {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  if (
    row["schemaVersion"] !== ROADMAP_DELIVERY_SCHEMA_VERSION ||
    typeof row["app"] !== "string" ||
    typeof row["updatedAt"] !== "string"
  )
    return false;
  const ref = row["ref"];
  if (ref === null || typeof ref !== "object" || Array.isArray(ref)) return false;
  const candidate = ref as Record<string, unknown>;
  return (
    candidate["kind"] === "roadmap_plan" &&
    typeof candidate["id"] === "string" &&
    Number.isInteger(candidate["version"]) &&
    typeof candidate["sha256"] === "string"
  );
}

function unitByIssue(plan: RoadmapPlan): Map<number, RoadmapDeliveryUnit> {
  const result = new Map<number, RoadmapDeliveryUnit>();
  for (const unit of plan.deliveryUnits) {
    for (const issueNumber of unit.issueNumbers) result.set(issueNumber, unit);
  }
  return result;
}

function numeric(left: number, right: number): number {
  return left - right;
}

function assertAuthorityRef(ref: unknown, kind: AuthorityRef["kind"]): asserts ref is AuthorityRef {
  if (ref === null || typeof ref !== "object" || Array.isArray(ref)) {
    throw new RoadmapDeliveryError("authority_corrupt", `expected ${kind} authority ref`);
  }
  assertExactObjectKeys(ref, ["kind", "id", "version", "sha256"], `${kind} authority ref`, "authority_corrupt");
  const row = ref as Record<string, unknown>;
  if (row["kind"] !== kind) {
    throw new RoadmapDeliveryError("authority_corrupt", `expected ${kind}, got ${String(row["kind"])}`);
  }
  assertId(row["id"], `${kind} ref id`);
  assertVersion(row["version"], `${kind} ref version`);
  assertHash(row["sha256"], `${kind} ref hash`);
}

function sameAssignment(left: TurnAssignment, right: TurnAssignment): boolean {
  return left.harness === right.harness && left.model === right.model && left.effort === right.effort;
}

function assertTurnAssignmentShape(
  assignment: unknown,
  label: string,
  code: RoadmapDeliveryFailureCode,
): asserts assignment is TurnAssignment {
  assertExactObjectKeys(assignment, ["harness", "model", "effort"], label, code);
  const row = assignment as Record<string, unknown>;
  if (
    !["claude", "codex", "pi"].includes(String(row["harness"])) ||
    typeof row["model"] !== "string" ||
    row["model"].trim().length === 0 ||
    !["low", "medium", "high", "xhigh", "max"].includes(String(row["effort"]))
  ) {
    throw new RoadmapDeliveryError(code, `${label} is invalid`);
  }
}

function assertId(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !ID.test(value)) {
    throw new RoadmapDeliveryError("roadmap_invalid", `${label} is invalid: ${String(value)}`);
  }
}

function assertVersion(value: unknown, label: string): asserts value is number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new RoadmapDeliveryError("roadmap_invalid", `${label} must be a positive integer`);
  }
}

function assertHash(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !HASH.test(value)) {
    throw new RoadmapDeliveryError("authority_corrupt", `${label} is not sha256`);
  }
}

function requireDateTime(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0 || Number.isNaN(Date.parse(value))) {
    throw new RoadmapDeliveryError("roadmap_invalid", `${label} is not a date-time`);
  }
  return value;
}

function assertExactObjectKeys(
  value: unknown,
  expected: readonly string[],
  label: string,
  code: RoadmapDeliveryFailureCode = "validation_contract_invalid",
): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new RoadmapDeliveryError(code, `${label} must be an object`);
  }
  const keys = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (stableHash(keys) !== stableHash(wanted)) {
    const expectedSet = new Set(wanted);
    const actualSet = new Set(keys);
    const missing = wanted.filter((key) => !actualSet.has(key));
    const unexpected = keys.filter((key) => !expectedSet.has(key));
    throw new RoadmapDeliveryError(
      code,
      `${label} keys differ; missing [${missing.join(",")}], unexpected [${unexpected.join(",")}]`,
    );
  }
}
