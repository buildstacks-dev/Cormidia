import {
  EpisodePlanValidationError,
  annotateRepairRegression,
  assessCreatorScope,
  assertEpisodePlanValid,
  deriveEpisodeSafetyRoute,
  episodeIntentHash,
  materializeEpisodePlanAssignments,
  parseNormalizedProposedEpisodePlan,
  persistEpisodeIntent as persistImmutableEpisodeIntent,
  persistEpisodePlan,
  readPersistedEpisodeIntent as readImmutableEpisodeIntent,
  episodeIntentPath,
  type CreatorScopeAssessment,
  type EpisodeIntent,
  type EpisodePlan,
  type EpisodePlanIssue,
  type EpisodePlanReasonCode,
  type ProposedEpisodePlan,
  type ProposedEpisodeStep,
} from "../../loop/episode-plan.js";
import type { RoleConfig } from "../../runtime/types.js";
import type { AppEntry } from "../apps.js";
import {
  createEpisodePlanningPolicy,
  type EpisodePlanningPolicy,
  type EpisodePlanningPolicyOptions,
} from "./policy.js";

export interface EpisodePlannerProposalRequest {
  intent: EpisodeIntent;
  attempt: 1 | 2;
  /** Closed domain vocabulary used by both the prompt schema and acceptance
   * policy. Omitted only by intentionally-open generic episodes. */
  providerOperations?: readonly string[];
  /** Closed mechanical-gate vocabulary, same contract as the operation
   * registry: a gate with no executor handler becomes unrepresentable. */
  mechanicalGates?: readonly string[];
  /** Machine-readable statement of the domain's plan topology rules — the
   * contract validation enforces, stated before generation (ISSUE-023). */
  topologyContract?: Readonly<Record<string, unknown>>;
  /** Orchestrator-owned timestamp the proposal must echo as `createdAt`. */
  proposalCreatedAt: string;
  /** Empty on the first call. On repair this contains concise deterministic
   * schema/policy diagnostics, never hidden reasoning or provider prose. */
  validationDiagnostics: EpisodePlanIssue[];
}

export type EpisodePlannerProposer = (
  request: EpisodePlannerProposalRequest,
) => Promise<unknown>;

export interface PrepareEpisodePlanOptions {
  root: string;
  app: AppEntry;
  roles: readonly RoleConfig[];
  intent: EpisodeIntent;
  providerOperations?: readonly string[];
  mechanicalGates?: readonly string[];
  topologyContract?: Readonly<Record<string, unknown>>;
  propose?: EpisodePlannerProposer;
  now?: () => Date;
  workflowTemplates?: EpisodePlanningPolicyOptions["workflowTemplates"];
  additionalCapabilitiesByRole?: EpisodePlanningPolicyOptions["additionalCapabilitiesByRole"];
  independentReview?: EpisodePlanningPolicyOptions["independentReview"];
  safetyFloorMapping?: EpisodePlanningPolicyOptions["safetyFloorMapping"];
  /** Domain adapter validation that must pass before the immutable plan is
   * published. Core DAG/assignment/safety validation always runs first. */
  validateAcceptedPlan?: (plan: EpisodePlan) => void;
}

export interface PreparedEpisodePlan {
  plan: EpisodePlan;
  intentHash: string;
  planningTurnSkipped: boolean;
  plannerAttempts: number;
  creatorScopeAssessment: CreatorScopeAssessment;
}

export class CreatorScopeConflictError extends Error {
  readonly code = "error_creator_scope_conflict" as const;
  constructor(readonly issues: readonly EpisodePlanIssue[]) {
    super(issues.map((entry) => `${entry.code}: ${entry.message}`).join("; "));
    this.name = "CreatorScopeConflictError";
  }
}

export class EpisodePlannerFailedError extends Error {
  readonly code = "error_episode_planner_failed" as const;
  constructor(
    readonly attempts: number,
    readonly issues: readonly EpisodePlanIssue[],
  ) {
    super(
      `EpisodePlanner failed after ${attempts} bounded attempt(s): ` +
        issues.map((entry) => `${entry.code}: ${entry.message}`).join("; "),
    );
    this.name = "EpisodePlannerFailedError";
  }
}

/**
 * Produce exactly one validated durable plan. The only zero-provider path is
 * an explicit creator scope that passes the same deterministic policy. A
 * planner proposal gets at most one structural repair attempt.
 */
export async function prepareEpisodePlan(
  options: PrepareEpisodePlanOptions,
): Promise<PreparedEpisodePlan> {
  assertIntentMatchesInvocation(options);
  const now = options.now ?? (() => new Date());
  const policy = createEpisodePlanningPolicy(options.app, {
    intent: options.intent,
    roles: options.roles,
    ...(options.providerOperations === undefined
      ? {}
      : { providerOperations: options.providerOperations }),
    ...(options.workflowTemplates === undefined
      ? {}
      : { workflowTemplates: options.workflowTemplates }),
    ...(options.additionalCapabilitiesByRole === undefined
      ? {}
      : { additionalCapabilitiesByRole: options.additionalCapabilitiesByRole }),
    ...(options.independentReview === undefined
      ? {}
      : { independentReview: options.independentReview }),
    ...(options.safetyFloorMapping === undefined
      ? {}
      : { safetyFloorMapping: options.safetyFloorMapping }),
  });
  await persistEpisodeIntent(options.root, options.intent);

  const creatorScopeAssessment = assessCreatorScope(
    options.intent.creatorScope,
    policy.creatorScope,
  );
  if (creatorScopeAssessment.executionReady) {
    const proposal = creatorProposal(
      options.intent,
      creatorScopeAssessment.resolvedSteps!,
      now(),
    );
    const plan = acceptProposal(
      proposal,
      options.intent,
      policy,
      options.validateAcceptedPlan,
    );
    await persistEpisodePlan({
      root: options.root,
      plan,
      intent: options.intent,
      policy: policy.validation,
    });
    return {
      plan,
      intentHash: plan.intentHash,
      planningTurnSkipped: true,
      plannerAttempts: 0,
      creatorScopeAssessment,
    };
  }

  if (hasAuthoritativeCreatorScopeConflict(creatorScopeAssessment.issues, options.intent.creatorScope)) {
    throw new CreatorScopeConflictError(creatorScopeAssessment.issues);
  }
  if (options.propose === undefined) {
    throw new EpisodePlannerFailedError(0, [
      {
        code: "plan_structure_invalid",
        message: "an incomplete or absent creator scope requires an EpisodePlanner proposer",
      },
    ]);
  }

  let diagnostics: EpisodePlanIssue[] = [];
  const proposalCreatedAt = now().toISOString();
  for (const attempt of [1, 2] as const) {
    const priorDiagnostics = diagnostics;
    try {
      const raw = await options.propose({
        intent: structuredClone(options.intent),
        attempt,
        ...(options.providerOperations === undefined
          ? {}
          : { providerOperations: [...options.providerOperations] }),
        ...(options.mechanicalGates === undefined
          ? {}
          : { mechanicalGates: [...options.mechanicalGates] }),
        ...(options.topologyContract === undefined
          ? {}
          : { topologyContract: options.topologyContract }),
        proposalCreatedAt,
        validationDiagnostics: structuredClone(diagnostics),
      });
      const proposal = parseNormalizedProposedEpisodePlan(parseProviderValue(raw));
      const plan = acceptProposal(
        proposal,
        options.intent,
        policy,
        options.validateAcceptedPlan,
      );
      await persistEpisodePlan({
        root: options.root,
        plan,
        intent: options.intent,
        policy: policy.validation,
      });
      return {
        plan,
        intentHash: plan.intentHash,
        planningTurnSkipped: false,
        plannerAttempts: attempt,
        creatorScopeAssessment,
      };
    } catch (error) {
      const contractDiagnostics = diagnosticsFrom(error);
      if (contractDiagnostics === undefined) throw error;
      diagnostics = contractDiagnostics;
      if (attempt === 2) {
        // A repair that fixes one violation while introducing another is
        // worse than no repair; name that rather than reporting the second
        // failure as if it were unrelated (ISSUE-023).
        throw new EpisodePlannerFailedError(
          attempt,
          annotateRepairRegression(priorDiagnostics, diagnostics),
        );
      }
    }
  }
  throw new EpisodePlannerFailedError(2, diagnostics);
}

export async function persistEpisodeIntent(
  root: string,
  intent: EpisodeIntent,
): Promise<string> {
  return persistImmutableEpisodeIntent(root, intent);
}

export async function readPersistedEpisodeIntent(
  root: string,
  episodeId: string,
): Promise<EpisodeIntent | undefined> {
  return readImmutableEpisodeIntent(root, episodeId);
}

export { episodeIntentPath };

function creatorProposal(
  intent: EpisodeIntent,
  steps: readonly ProposedEpisodeStep[],
  createdAt: Date,
): ProposedEpisodePlan {
  const scope = intent.creatorScope;
  if (scope === undefined) throw new Error("creator proposal requires creator scope");
  const clonedSteps: ProposedEpisodeStep[] = steps.map((step) => structuredClone(step));
  const materializedBudgetShape = clonedSteps.map((step) => {
    if (step.kind !== "provider_turn") return step;
    // A fixed-mode assignment is filled after workflow normalization; the
    // creator's declared per-turn ceiling remains policy-validated.
    return step;
  });
  const providerTurnBudgetUsd = materializedBudgetShape
    .filter((step) => step.kind === "provider_turn")
    .reduce((sum, step) => sum + step.maxTurnBudgetUsd, 0);
  return {
    schemaVersion: 1,
    episodeId: intent.episodeId,
    version: 1,
    intentHash: episodeIntentHash(intent),
    summary: scope.objective,
    workflowClass:
      scope.workKind ??
      (scope.workflowTemplate === undefined
        ? "creator-scoped"
        : `template:${scope.workflowTemplate.id}@${scope.workflowTemplate.version}`),
    planningSource: "creator_scope",
    creatorProvenance: structuredClone(scope.provenance),
    steps: clonedSteps,
    estimatedBudget: {
      providerTurns: materializedBudgetShape.filter((step) => step.kind === "provider_turn").length,
      providerTurnBudgetUsd,
      mechanicalOverheadUsd: 0,
      totalBudgetUsd: providerTurnBudgetUsd,
    },
    derivedSafetyRoute: deriveEpisodeSafetyRoute(clonedSteps, intent.requiredSafetyFacts),
    createdAt: createdAt.toISOString(),
  };
}

function acceptProposal(
  proposal: ProposedEpisodePlan,
  intent: EpisodeIntent,
  policy: EpisodePlanningPolicy,
  validateAcceptedPlan?: (plan: EpisodePlan) => void,
): EpisodePlan {
  const materialized = materializeEpisodePlanAssignments(proposal, policy.materialization);
  const plan: EpisodePlan = {
    ...materialized,
    derivedSafetyRoute: deriveEpisodeSafetyRoute(materialized.steps, intent.requiredSafetyFacts),
  };
  assertEpisodePlanValid(plan, intent, policy.validation);
  validateAcceptedPlan?.(structuredClone(plan));
  return plan;
}

export function hasAuthoritativeCreatorScopeConflict(
  issues: readonly EpisodePlanIssue[],
  scope?: EpisodeIntent["creatorScope"],
): boolean {
  // An explicit execution-ready disposition is an authoritative claim that
  // the creator supplied every decision needed to execute. Any validation
  // issue therefore refuses before provider construction; silently buying an
  // EpisodePlanner turn would contradict the caller's declared route.
  if (scope?.planningDisposition === "execution_ready") return issues.length > 0;
  const contradictions = new Set<EpisodePlanReasonCode>([
    "creator_scope_provenance_invalid",
    "creator_scope_workflow_ambiguous",
    "creator_scope_template_unresolved",
    "creator_scope_assignment_not_allowed",
    "plan_role_unknown",
    "plan_assignment_invalid",
    "plan_assignment_price_invalid",
    "plan_turn_budget_exceeds_assignment",
  ]);
  return issues.some((entry) => contradictions.has(entry.code));
}

function diagnosticsFrom(error: unknown): EpisodePlanIssue[] | undefined {
  if (error instanceof EpisodePlanValidationError) {
    return error.issues.map((entry) => ({ ...entry }));
  }
  if (!hasIssueArray(error)) return undefined;
  return error.issues.map((entry) => ({
    code: "plan_structure_invalid" as const,
    message: `${entry.code}: ${entry.message}`,
    ...(entry.stepId === undefined ? {} : { stepId: entry.stepId }),
    // Domain rejections stay machine-readable so the repair brief can list
    // exactly which invariants were violated and which must be preserved.
    constraint: entry.code,
    ...(entry.rule === undefined ? {} : { rule: entry.rule }),
  }));
}

function hasIssueArray(error: unknown): error is {
  issues: Array<{ code: string; message: string; stepId?: string; rule?: string }>;
} {
  if (error === null || typeof error !== "object" || !("issues" in error)) return false;
  const issues = (error as { issues?: unknown }).issues;
  return Array.isArray(issues) && issues.length > 0 && issues.every((entry) =>
    entry !== null && typeof entry === "object" &&
    typeof (entry as { code?: unknown }).code === "string" &&
    typeof (entry as { message?: unknown }).message === "string" &&
    ((entry as { stepId?: unknown }).stepId === undefined ||
      typeof (entry as { stepId?: unknown }).stepId === "string"));
}

function parseProviderValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new EpisodePlanValidationError([{
      code: "plan_structure_invalid",
      message: "EpisodePlanner output must be one strict JSON object",
    }]);
  }
}

function assertIntentMatchesInvocation(options: PrepareEpisodePlanOptions): void {
  if (options.intent.app !== options.app.name) {
    throw new Error(
      `episode intent app ${options.intent.app} does not match invocation ${options.app.name}`,
    );
  }
  if (options.roles.length === 0) throw new Error("EpisodePlanner requires at least one configured role");
}
