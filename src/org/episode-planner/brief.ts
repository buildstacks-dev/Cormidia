import { SECRET_PATTERNS } from "../../runtime/secret-patterns.js";
import {
  EPISODE_PLAN_PROPOSAL_SCHEMA,
  episodePlanProposalSchemaForOperations,
  episodeIntentHash,
} from "../../loop/episode-plan.js";
import type { EpisodePlan } from "../../loop/episode-plan.js";
import type { EpisodeReplanRecord } from "../../loop/episode-replan.js";
import type { EpisodePlannerProposalRequest } from "./coordinator.js";

export const MAX_EPISODE_PLANNER_BRIEF_BYTES = 512 * 1024;

const DETERMINISTIC_PROPOSAL_CONTRACT = {
  mechanicalOverheadUsd: 0,
  totalBudgetFormula: "providerTurnBudgetUsd + mechanicalOverheadUsd",
  planOutputReferences: {
    format: "plan-output:<output-id>",
    example: "plan-output:build-contract",
    requirements: [
      "output-id is declared by exactly one expectedOutputs entry",
      "the producing step is a transitive dependency ancestor of the consuming step",
    ],
  },
} as const;

/** Closed domain topology contract supplied by the caller. It is data the
 * planner is given before it generates, not prose the prompt has to carry. */
export type EpisodePlanTopologyContract = Readonly<Record<string, unknown>>;

interface TopologyRuleLike {
  id: string;
  statement: string;
}

function topologyRules(
  contract: EpisodePlanTopologyContract | undefined,
): TopologyRuleLike[] {
  const declared = contract?.["topologyRules"];
  if (!Array.isArray(declared)) return [];
  return declared.filter((entry): entry is TopologyRuleLike =>
    entry !== null && typeof entry === "object" &&
    typeof (entry as { id?: unknown }).id === "string" &&
    typeof (entry as { statement?: unknown }).statement === "string");
}

/**
 * A repair pass that receives only the error list optimizes for the reported
 * errors and regresses everything else — run 3's repair inverted a review
 * ordering its input had right (ISSUE-023). Hand it the invariants the
 * rejected proposal already satisfied, and require it to keep them.
 */
function repairContract(
  contract: EpisodePlanTopologyContract | undefined,
  diagnostics: readonly { readonly rule?: string; readonly constraint?: string }[],
): Record<string, unknown> | undefined {
  const rules = topologyRules(contract);
  if (rules.length === 0 || diagnostics.length === 0) return undefined;
  const reported = new Set<string>();
  for (const entry of diagnostics) {
    if (entry.rule !== undefined) reported.add(entry.rule);
    if (entry.constraint !== undefined) reported.add(entry.constraint);
  }
  const violated = rules.filter((rule) => reported.has(rule.id));
  const preserved = rules.filter((rule) => !reported.has(rule.id));
  return {
    mustBeNonRegressive: true,
    rule:
      "the repaired plan must violate a strict subset of the reported violations; " +
      "introducing a violation of any invariant listed in invariantsAlreadySatisfied " +
      "rejects the repair as regressive",
    violatedInvariants: violated.map((rule) => rule.id),
    invariantsAlreadySatisfied: preserved.map((rule) => rule.id),
  };
}

function renderDiagnostics(
  entries: EpisodePlannerProposalRequest["validationDiagnostics"],
): Array<{ code: string; message: string; rule?: string; constraint?: string; stepId?: string }> {
  return entries
    .map((entry) => ({
      code: entry.code,
      message: entry.message,
      ...(entry.stepId === undefined ? {} : { stepId: entry.stepId }),
      ...(entry.path === undefined ? {} : { path: entry.path }),
      ...(entry.constraint === undefined ? {} : { constraint: entry.constraint }),
      ...(entry.rule === undefined ? {} : { rule: entry.rule }),
      ...(entry.expected === undefined ? {} : { expected: entry.expected }),
      ...(entry.received === undefined ? {} : { received: entry.received }),
    }))
    .sort((left, right) =>
      left.code.localeCompare(right.code) ||
      (left.stepId ?? "").localeCompare(right.stepId ?? "") ||
      left.message.localeCompare(right.message));
}

/** Exact bounded data envelope consumed by the human-ratified planner prompt. */
export function renderEpisodePlannerBrief(
  request: EpisodePlannerProposalRequest,
): string {
  const proposalSchema = request.providerOperations === undefined
    ? EPISODE_PLAN_PROPOSAL_SCHEMA
    : episodePlanProposalSchemaForOperations(
      request.providerOperations,
      request.mechanicalGates === undefined ? {} : { mechanicalGates: request.mechanicalGates },
    );
  const diagnostics = renderDiagnostics(request.validationDiagnostics);
  const repair = repairContract(request.topologyContract, diagnostics);
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
    // Pi's structured-verdict capability is an explicit prompt/parser
    // fallback, and native adapter regressions must remain diagnosable rather
    // than asking the planner to guess a hidden shape. Keep the canonical
    // schema in the bounded input as well as on TurnRequest.verdictSchema.
    proposalSchema,
    ...(request.providerOperations === undefined
      ? {}
      : { providerOperationRegistry: [...new Set(request.providerOperations)].sort() }),
    ...(request.mechanicalGates === undefined
      ? {}
      : { mechanicalGateRegistry: [...new Set(request.mechanicalGates)].sort() }),
    deterministicProposalContract: DETERMINISTIC_PROPOSAL_CONTRACT,
    ...(request.topologyContract === undefined
      ? {}
      : { topologyContract: request.topologyContract }),
    ...(repair === undefined ? {} : { repairContract: repair }),
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
  providerOperations?: readonly string[];
  mechanicalGates?: readonly string[];
  topologyContract?: EpisodePlanTopologyContract;
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
  const proposalSchema = request.providerOperations === undefined
    ? EPISODE_PLAN_PROPOSAL_SCHEMA
    : episodePlanProposalSchemaForOperations(
      request.providerOperations,
      request.mechanicalGates === undefined ? {} : { mechanicalGates: request.mechanicalGates },
    );
  const diagnostics = renderDiagnostics(request.validationDiagnostics);
  const repair = repairContract(request.topologyContract, diagnostics);
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
    proposalSchema,
    ...(request.providerOperations === undefined
      ? {}
      : { providerOperationRegistry: [...new Set(request.providerOperations)].sort() }),
    ...(request.mechanicalGates === undefined
      ? {}
      : { mechanicalGateRegistry: [...new Set(request.mechanicalGates)].sort() }),
    deterministicProposalContract: DETERMINISTIC_PROPOSAL_CONTRACT,
    ...(request.topologyContract === undefined
      ? {}
      : { topologyContract: request.topologyContract }),
    ...(repair === undefined ? {} : { repairContract: repair }),
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
