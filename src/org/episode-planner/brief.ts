import { SECRET_PATTERNS } from "../../runtime/secret-patterns.js";
import { episodeIntentHash } from "../../loop/episode-plan.js";
import type { EpisodePlan } from "../../loop/episode-plan.js";
import type { EpisodeReplanRecord } from "../../loop/episode-replan.js";
import type { EpisodePlannerProposalRequest } from "./coordinator.js";

export const MAX_EPISODE_PLANNER_BRIEF_BYTES = 512 * 1024;

/** Exact bounded data envelope consumed by the human-ratified planner prompt. */
export function renderEpisodePlannerBrief(
  request: EpisodePlannerProposalRequest,
): string {
  const diagnostics = request.validationDiagnostics
    .map((entry) => ({
      code: entry.code,
      message: entry.message,
      ...(entry.stepId === undefined ? {} : { stepId: entry.stepId }),
    }))
    .sort((left, right) =>
      left.code.localeCompare(right.code) ||
      (left.stepId ?? "").localeCompare(right.stepId ?? "") ||
      left.message.localeCompare(right.message));
  const payload = {
    schemaVersion: 1,
    kind: "episode-planner-input",
    attempt: request.attempt,
    proposalCreatedAt: request.proposalCreatedAt,
    requiredPlanIdentity: {
      schemaVersion: 1,
      episodeId: request.intent.episodeId,
      version: 1,
      intentHash: episodeIntentHash(request.intent),
      planningSource: "episode_planner",
      createdAt: request.proposalCreatedAt,
    },
    intent: request.intent,
    validationDiagnostics: diagnostics,
    deterministicSafetyFloor: {
      authentication: { requiredGates: ["security"] },
      secrets: { requiredGates: ["security"] },
      data_migration: { requiredGates: ["data-integrity", "rollback"] },
      production_deployment: {
        requiredGates: ["rollout", "rollback"],
        requiredApprovals: ["critical-operation"],
      },
      critical_operation: { requiredApprovals: ["critical-operation"] },
      release: { requiredGates: ["release"] },
      external_publication: { requiredApprovals: ["external-publication"] },
      performance_sensitive: { requiredGates: ["performance"] },
      independent_review: { requiredIndependentReview: true },
      incident_response: {
        requiredProviderRoles: ["sre"],
        responsibility: "incident diagnosis and mitigation",
      },
    },
  };
  const rendered = [
    "[episode_planner_input]",
    JSON.stringify(payload, null, 2),
  ].join("\n");
  const bytes = Buffer.byteLength(rendered);
  if (bytes > MAX_EPISODE_PLANNER_BRIEF_BYTES) {
    throw new Error(
      `EpisodePlanner input is ${bytes} bytes; bounded limit is ${MAX_EPISODE_PLANNER_BRIEF_BYTES}`,
    );
  }
  const secret = SECRET_PATTERNS.find((candidate) => candidate.pattern.test(rendered));
  if (secret !== undefined) {
    throw new Error(`EpisodePlanner input contains suspected secret material (${secret.name})`);
  }
  return rendered;
}

export interface EpisodePlannerRevisionRequest {
  intent: EpisodePlannerProposalRequest["intent"];
  previousPlan: EpisodePlan;
  replan: EpisodeReplanRecord;
  attempt: 1 | 2;
  proposalCreatedAt: string;
  validationDiagnostics: EpisodePlannerProposalRequest["validationDiagnostics"];
}

/** Bounded revision data for the same ratified EpisodePlanner protocol. The
 * prior accepted plan and typed material event are facts, not an authority to
 * rewrite completed work or expand the immutable EpisodeIntent. */
export function renderEpisodePlannerRevisionBrief(
  request: EpisodePlannerRevisionRequest,
): string {
  const diagnostics = request.validationDiagnostics
    .map((entry) => ({
      code: entry.code,
      message: entry.message,
      ...(entry.stepId === undefined ? {} : { stepId: entry.stepId }),
    }))
    .sort((left, right) =>
      left.code.localeCompare(right.code) ||
      (left.stepId ?? "").localeCompare(right.stepId ?? "") ||
      left.message.localeCompare(right.message));
  const payload = {
    schemaVersion: 1,
    kind: "episode-planner-revision-input",
    attempt: request.attempt,
    proposalCreatedAt: request.proposalCreatedAt,
    requiredPlanIdentity: {
      schemaVersion: 1,
      episodeId: request.intent.episodeId,
      version: request.previousPlan.version + 1,
      intentHash: episodeIntentHash(request.intent),
      planningSource: request.previousPlan.planningSource,
      createdAt: request.proposalCreatedAt,
    },
    immutableIntent: request.intent,
    previousAcceptedPlan: request.previousPlan,
    materialEvent: request.replan,
    validationDiagnostics: diagnostics,
    revisionRules: {
      completedStepsAreImmutable: true,
      futureWorkOnly: true,
      preserveCreatorProvenance:
        request.previousPlan.planningSource === "creator_scope",
      unavailableAssignmentsMustNotBeReusedForFutureWork:
        request.replan.trigger.kind === "assignment_unavailable",
    },
  };
  const rendered = [
    "[episode_planner_input]",
    JSON.stringify(payload, null, 2),
  ].join("\n");
  const bytes = Buffer.byteLength(rendered);
  if (bytes > MAX_EPISODE_PLANNER_BRIEF_BYTES) {
    throw new Error(
      `EpisodePlanner revision input is ${bytes} bytes; bounded limit is ${MAX_EPISODE_PLANNER_BRIEF_BYTES}`,
    );
  }
  const secret = SECRET_PATTERNS.find((candidate) => candidate.pattern.test(rendered));
  if (secret !== undefined) {
    throw new Error(`EpisodePlanner revision input contains suspected secret material (${secret.name})`);
  }
  return rendered;
}
