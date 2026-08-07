import { episodePlanHash, type EpisodePlan } from "../../loop/episode-plan.js";
import {
  ROADMAP_DELIVERY_SCHEMA_VERSION,
  type AcceptedAuthority,
  type AuthorityRef,
  type RoadmapDeliveryProjector,
} from "./authority-core.js";
import { persistAuthority, projectAccepted, requireAuthority, sameAuthorityRef } from "./authority-store.js";
import type { ValidationContract } from "./validation-contract.js";
import { readCurrentValidationContract } from "./validation-contract-authority.js";
import { assertValidationWaiverAuthorities, assertValidationWaiversCurrent } from "./validation-waivers.js";
import type { DeliveryUnitReadiness } from "./delivery-readiness.js";
import type { DeliveryEpisodeBinding } from "./delivery-join.js";
import { readExecutionUnitJournal, transitionExecutionUnitJournal } from "./execution-journal.js";
import {
  assertExecutionBatchShape,
  normalizeExecutionUnitBudget,
  type ExecutionBatch,
  type ExecutionUnitBudget,
} from "./execution-model.js";
import { RoadmapDeliveryError } from "./failure.js";
import { requireUnit, unitMembershipHash } from "./roadmap-invariants.js";
import type { RoadmapPlan } from "./roadmap-model.js";
import { assertCurrentRoadmapRef } from "./roadmap-plan.js";

/** Bind a production ticket plan to the exact admitted roadmap/validation join. */
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

export async function markExecutionUnitPlanned(
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

export function assertPlanWithinExecutionUnitBudget(plan: EpisodePlan, budget: ExecutionUnitBudget): void {
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
