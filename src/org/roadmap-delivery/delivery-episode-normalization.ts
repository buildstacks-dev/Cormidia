import { episodePlanHash, stableHash, type CreatorEpisodeScope, type EpisodePlan } from "../../loop/episode-plan.js";
import type { RoleConfig } from "../../runtime/types.js";
import type { AppEntry } from "../apps.js";
import {
  prepareEpisodePlan,
  type EpisodePlannerProposer,
  type PreparedEpisodePlan,
} from "../episode-planner/coordinator.js";
import {
  buildEpisodeIntent,
  type EpisodeIntentFacts,
  type EpisodePlanningPolicyOptions,
} from "../episode-planner/policy.js";
import {
  ROADMAP_DELIVERY_SCHEMA_VERSION,
  type AcceptedAuthority,
  type AuthorityRef,
  type RoadmapDeliveryProjector,
} from "./authority-core.js";
import {
  persistAuthority,
  projectAccepted,
  renderAuthorityRef,
  requireAuthority,
  sameAuthorityRef,
} from "./authority-store.js";
import { assertCurrentValidationCatalogRef } from "./validation-catalog-authority.js";
import type { ValidationContract } from "./validation-contract.js";
import { readCurrentValidationContract } from "./validation-contract-authority.js";
import { assertValidationContractBaseShape } from "./validation-contract-shape.js";
import { assertValidationWaiverAuthorities, assertValidationWaiversCurrent } from "./validation-waivers.js";
import { assertDeliveryUnitReadinessShape, type DeliveryUnitReadiness } from "./delivery-readiness.js";
import { markExecutionUnitPlanned } from "./delivery-episode-binding.js";
import type { DeliveryEpisodeBinding } from "./delivery-join.js";
import { assertExecutionBatchShape, type ExecutionBatch } from "./execution-model.js";
import { RoadmapDeliveryError } from "./failure.js";
import { requireUnit, unitMembershipHash } from "./roadmap-invariants.js";
import type { RoadmapPlan } from "./roadmap-model.js";
import { assertCurrentRoadmapRef } from "./roadmap-plan.js";

type DeliveryEpisodeFacts = Omit<EpisodeIntentFacts, "episodeId" | "app" | "roles" | "creatorScope">;

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
