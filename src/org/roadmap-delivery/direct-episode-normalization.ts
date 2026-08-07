import { episodePlanHash, stableHash, type CreatorEpisodeScope, type EpisodePlan } from "../../loop/episode-plan.js";
import type { RoleConfig } from "../../runtime/types.js";
import type { AppEntry } from "../apps.js";
import { prepareEpisodePlan, type PreparedEpisodePlan } from "../episode-planner/coordinator.js";
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
import { persistAuthority, projectAccepted, renderAuthorityRef, requireAuthority } from "./authority-store.js";
import { assertPlanWithinExecutionUnitBudget, markExecutionUnitPlanned } from "./delivery-episode-binding.js";
import { assertDirectExecutionUnit, type DirectExecutionUnitAuthority } from "./direct-execution-authority.js";
import { assertExecutionBatchShape, type ExecutionBatch } from "./execution-model.js";
import { RoadmapDeliveryError } from "./failure.js";

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

type DeliveryEpisodeFacts = Omit<EpisodeIntentFacts, "episodeId" | "app" | "roles" | "creatorScope">;

/** Direct authority normalizes through the same coordinator without a RoadmapPlan. */
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
