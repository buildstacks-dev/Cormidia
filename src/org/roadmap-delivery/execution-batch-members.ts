import { stableHash } from "../../loop/episode-plan.js";
import type { AcceptedAuthority, AuthorityRef } from "./authority-core.js";
import { renderAuthorityRef, requireAuthority, sameAuthorityRef } from "./authority-store.js";
import { assertCurrentValidationCatalogRef } from "./validation-catalog-authority.js";
import type { ValidationContract } from "./validation-contract.js";
import { readCurrentValidationContract } from "./validation-contract-authority.js";
import { assertValidationContractBaseShape } from "./validation-contract-shape.js";
import { assertValidationWaiverAuthorities, assertValidationWaiversCurrent } from "./validation-waivers.js";
import { assertDeliveryUnitReadinessShape, type DeliveryUnitReadiness } from "./delivery-readiness.js";
import { assertDirectExecutionUnit, type DirectExecutionUnitAuthority } from "./direct-execution-authority.js";
import { normalizeExecutionUnitBudget, type ExecutionUnit, type ExecutionUnitBudget } from "./execution-model.js";
import { RoadmapDeliveryError } from "./failure.js";
import {
  assertRoadmapPlan,
  assertRoutingEligible,
  requireUnit,
  routingSnapshotHash,
  unitMembershipHash,
} from "./roadmap-invariants.js";
import type { RoadmapPlan, RoutingSnapshotEntry } from "./roadmap-model.js";
import { readCurrentRoadmapPlan } from "./roadmap-plan.js";

interface ExecutionBatchMembersInput {
  root: string;
  app: string;
  roadmapRef?: AuthorityRef;
  expectedFrontierHash?: string;
  orderedUnitIds?: string[];
  readinessRefs?: AuthorityRef[];
  directUnitRefs?: AuthorityRef[];
  budgetsByUnit?: Readonly<Record<string, ExecutionUnitBudget>>;
  routing: RoutingSnapshotEntry[];
  admittedAt: string;
}

/** Resolve and validate every authority join before the batch mutation lock is acquired. */
export async function resolveExecutionBatchMembers(input: ExecutionBatchMembersInput): Promise<{
  roadmap: AcceptedAuthority<RoadmapPlan> | undefined;
  frontierHash: string | null;
  units: ExecutionUnit[];
}> {
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
    orderedUnitIds.map(async (unitId): Promise<Exclude<ExecutionUnit, { kind: "direct_operation" }>> => {
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
  const directUnits: Array<Extract<ExecutionUnit, { kind: "direct_operation" }>> = [];
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
  return { roadmap, frontierHash, units };
}
