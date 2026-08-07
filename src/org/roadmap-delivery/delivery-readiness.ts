import { existsSync } from "node:fs";
import { stableHash } from "../../loop/episode-plan.js";
import {
  ROADMAP_DELIVERY_SCHEMA_VERSION,
  assertAuthorityRef,
  assertExactObjectKeys,
  assertHash,
  assertId,
  type AcceptedAuthority,
  type AuthorityRef,
  type RoadmapDeliveryProjector,
} from "./authority-core.js";
import { readinessAuthorityPath } from "./authority-paths.js";
import {
  persistAuthority,
  projectAccepted,
  readAuthorityFile,
  requireAuthority,
  sameAuthorityRef,
} from "./authority-store.js";
import { assertCurrentValidationCatalogRef } from "./validation-catalog-authority.js";
import { readCurrentValidationContract } from "./validation-contract-authority.js";
import { assertValidationContractBaseShape } from "./validation-contract-shape.js";
import type { ValidationContract } from "./validation-contract.js";
import { requireDateTime } from "./validation-values.js";
import { assertValidationWaiverAuthorities, assertValidationWaiversCurrent } from "./validation-waivers.js";
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

/** Internal guard shared by later delivery stages; not part of the façade API. */
export function assertDeliveryUnitReadinessShape(readiness: DeliveryUnitReadiness): void {
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
