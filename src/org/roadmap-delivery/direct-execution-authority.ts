import type { CreatorEpisodeScope, ProposedEpisodeStep } from "../../loop/episode-plan.js";
import {
  ROADMAP_DELIVERY_SCHEMA_VERSION,
  assertExactObjectKeys,
  assertId,
  type AcceptedAuthority,
  type RoadmapDeliveryProjector,
} from "./authority-core.js";
import { assertExecutionUnitBudget, type ExecutionUnitBudget } from "./execution-model.js";
import { RoadmapDeliveryError } from "./failure.js";
import { persistAuthority, projectAccepted } from "./authority-store.js";
import { assertNonEmpty, requireDateTime } from "./validation-values.js";

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

export function assertDirectExecutionUnit(authority: DirectExecutionUnitAuthority): void {
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
