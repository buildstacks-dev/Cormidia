import {
  ROADMAP_DELIVERY_SCHEMA_VERSION,
  assertAuthorityRef,
  assertExactObjectKeys,
  assertHash,
  assertId,
  assertVersion,
  type AuthorityRef,
} from "./authority-core.js";
import { requireAuthority, sameAuthorityRef } from "./authority-store.js";
import { assertCurrentValidationCatalogRef } from "./validation-catalog-authority.js";
import type { ValidationContract } from "./validation-contract.js";
import { readCurrentValidationContract } from "./validation-contract-authority.js";
import { assertValidationContractBaseShape } from "./validation-contract-shape.js";
import { assertValidationWaiverAuthorities } from "./validation-waivers.js";
import { assertDeliveryUnitReadinessShape, type DeliveryUnitReadiness } from "./delivery-readiness.js";
import { assertExecutionBatchShape, type ExecutionBatch } from "./execution-model.js";
import { RoadmapDeliveryError } from "./failure.js";
import { requireUnit, unitMembershipHash } from "./roadmap-invariants.js";
import type { RoadmapPlan } from "./roadmap-model.js";
import { assertCurrentRoadmapRef } from "./roadmap-plan.js";
import { assertNonEmpty, requireDateTime } from "./validation-values.js";

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

export async function loadDeliveryJoin(root: string, app: string, bindingRef: AuthorityRef) {
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
