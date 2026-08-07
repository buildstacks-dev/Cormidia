import {
  ROADMAP_DELIVERY_SCHEMA_VERSION,
  assertAuthorityRef,
  assertExactObjectKeys,
  assertHash,
  assertId,
  assertVersion,
  type AuthorityRef,
} from "./authority-core.js";
import { RoadmapDeliveryError } from "./failure.js";
import { unitMembershipHash } from "./roadmap-invariants.js";
import { assertNonEmpty, requireDateTime } from "./validation-values.js";

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

const DEFAULT_EXECUTION_UNIT_BUDGET: ExecutionUnitBudget = {
  maxProviderTurns: 24,
  maxEquivalentCostUsd: 100,
  maxMechanicalOverheadUsd: 10,
  maxActiveTimeMs: 2 * 60 * 60_000,
  maxHumanDecisions: 2,
};

export function normalizeExecutionUnitBudget(value: ExecutionUnitBudget | undefined): ExecutionUnitBudget {
  const budget = structuredClone(value ?? DEFAULT_EXECUTION_UNIT_BUDGET);
  assertExecutionUnitBudget(budget);
  return budget;
}

export function assertExecutionUnitBudget(budget: ExecutionUnitBudget): void {
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

export function assertExecutionBatchShape(batch: ExecutionBatch): void {
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
