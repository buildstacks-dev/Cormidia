import { turnAssignmentsEqual } from "../runtime/assignment.js";
import { resolvedRuntimeCapabilities } from "../runtime/capabilities.js";
import type { AdmissionFactor, AuthorizedPass, RouteAdmissionInput, RouteBudget } from "./efficiency.js";
import type { AllowedTurnAssignment, EpisodeIntent, ProviderTurnStep, SafetyFactKind } from "./episode-plan.js";
import { episodePlanHash, type EpisodePlan } from "./episode-plan.js";
import type { TicketTier } from "./pipelines.js";

export const EPISODE_PLAN_ROUTE_POLICY_VERSION = "episode-plan-route/v1" as const;
export const EPISODE_PLAN_EXECUTION_PIPELINE = "episode-plan-dag" as const;
const EPISODE_PLAN_FACTOR_RULE = "accepted_episode_plan" as const;

/**
 * Convert an already accepted plan into the legacy route/accounting record.
 * This is deliberately a one-way projection: it cannot add, remove, reorder,
 * or alter any provider turn.
 */
export function routeAdmissionForEpisodePlan(input: {
  root: string;
  intent: EpisodeIntent;
  plan: EpisodePlan;
  now: Date;
}): RouteAdmissionInput {
  if (input.plan.episodeId !== input.intent.episodeId) {
    throw new Error("plan route projection requires matching episode identities");
  }
  const route = planRouteLabel(input.plan);
  const factors = factorsForPlan(input.plan, input.intent);
  const passes = input.plan.steps
    .filter((step): step is ProviderTurnStep => step.kind === "provider_turn")
    .map((step) => authorizedPassForStep(step, input.plan, input.intent));
  return {
    root: input.root,
    episodeId: input.plan.episodeId,
    app: input.intent.app,
    route,
    policyVersion: EPISODE_PLAN_ROUTE_POLICY_VERSION,
    factors,
    passes,
    now: input.now,
    budgetOverrides: hardBudgetProjection(input.intent),
    // Static pass/tool/review allowances are not a second workflow authority.
    executionBounds: null,
    currentPlanVersion: input.plan.version,
    currentPlanHash: episodePlanHash(input.plan),
  };
}

export function planRouteLabel(plan: EpisodePlan): TicketTier {
  const label = plan.derivedSafetyRoute.label;
  if (label !== "quick" && label !== "standard" && label !== "deep") {
    throw new Error(`accepted EpisodePlan has invalid derived route label ${JSON.stringify(label)}`);
  }
  return label;
}

function authorizedPassForStep(step: ProviderTurnStep, plan: EpisodePlan, intent: EpisodeIntent): AuthorizedPass {
  const candidate = exactCandidate(intent.allowedAssignments, step);
  const canonicalCapabilities = resolvedRuntimeCapabilities(step.assignment.harness);
  if (JSON.stringify([...candidate.capabilities].sort()) !== JSON.stringify(canonicalCapabilities)) {
    throw new Error(
      `assignment metadata for ${step.id} does not match the registered ${step.assignment.harness} capability profile`,
    );
  }
  return {
    pipeline: EPISODE_PLAN_EXECUTION_PIPELINE,
    pass: step.id,
    role: step.role,
    runtime: step.assignment.harness,
    model: step.assignment.model,
    effort: step.assignment.effort,
    factor_rules: [EPISODE_PLAN_FACTOR_RULE],
    assignment_source: step.assignmentSource,
    assignment_candidate_id: candidate.candidateId,
    plan_version: plan.version,
    plan_step_id: step.id,
    selection_reason: step.selectionReason,
    provider_family: candidate.providerFamily,
    resolved_capabilities: canonicalCapabilities,
  };
}

function exactCandidate(candidates: readonly AllowedTurnAssignment[], step: ProviderTurnStep): AllowedTurnAssignment {
  const matching = candidates.filter(
    (candidate) => candidate.role === step.role && turnAssignmentsEqual(candidate.assignment, step.assignment),
  );
  if (matching.length !== 1) {
    throw new Error(
      `plan step ${step.id} must resolve to exactly one approved assignment candidate; found ${matching.length}`,
    );
  }
  const candidate = matching[0]!;
  if (!candidate.available) {
    throw new Error(`plan step ${step.id} assignment is no longer available`);
  }
  return candidate;
}

function hardBudgetProjection(intent: EpisodeIntent): Partial<RouteBudget> {
  const budget: Partial<RouteBudget> = {
    provider_turns: intent.hardBudget.maxProviderTurns,
    equivalent_cost_usd: intent.hardBudget.maxEquivalentCostUsd,
  };
  if (intent.hardBudget.maxActiveTimeMs !== undefined) {
    budget.active_time_ms = intent.hardBudget.maxActiveTimeMs;
  }
  if (intent.hardBudget.maxHumanDecisions !== undefined) {
    budget.human_decisions = intent.hardBudget.maxHumanDecisions;
  }
  return budget;
}

function factorsForPlan(plan: EpisodePlan, intent: EpisodeIntent): AdmissionFactor[] {
  const factors: AdmissionFactor[] = [
    {
      kind: "evidence_quality",
      evidence: `validated EpisodePlan v${plan.version} (${plan.workflowClass})`,
      policy_rule: EPISODE_PLAN_FACTOR_RULE,
    },
  ];
  for (const fact of intent.requiredSafetyFacts) {
    const kind = factorKindForSafetyFact(fact.kind);
    factors.push({
      kind,
      evidence: `${fact.kind}: ${fact.evidenceRefs.join(", ")}`,
      policy_rule: `episode_plan_safety_${fact.kind}`,
    });
  }
  return factors.sort((left, right) =>
    `${left.kind}\0${left.policy_rule}\0${left.evidence}`.localeCompare(
      `${right.kind}\0${right.policy_rule}\0${right.evidence}`,
    ),
  );
}

function factorKindForSafetyFact(kind: SafetyFactKind): AdmissionFactor["kind"] {
  if (kind === "authentication" || kind === "secrets" || kind === "data_migration") {
    return "sensitive_domain";
  }
  if (
    kind === "production_deployment" ||
    kind === "release" ||
    kind === "external_publication" ||
    kind === "critical_operation"
  ) {
    return "release_consequence";
  }
  if (kind === "performance_sensitive") return "external_system_count";
  return "uncertainty";
}
