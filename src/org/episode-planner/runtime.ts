import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import {
  completedEpisodePlanStepIds,
  readEpisodePlanExecutionJournal,
} from "../../loop/episode-plan-executor.js";
import {
  deriveEpisodeSafetyRoute,
  EpisodePlanValidationError,
  EPISODE_PLAN_REASON_CODES,
  EPISODE_PLAN_PROPOSAL_SCHEMA,
  annotateRepairRegression,
  episodePlanProposalSchemaForOperations,
  assertEpisodePlanValid,
  assessCreatorScope,
  episodeIntentHash,
  materializeEpisodePlanAssignments,
  parseNormalizedProposedEpisodePlan,
  readCurrentEpisodePlan,
  validateForwardOnlyRevision,
  validateInitialPlanSupersessions,
  type CreatorScopeAssessment,
  type EpisodeIntent,
  type EpisodePlan,
  type EpisodePlanIssue,
  type ProposedEpisodePlan,
  type ProviderTurnStep,
} from "../../loop/episode-plan.js";
import type { EpisodeReplanRecord } from "../../loop/episode-replan.js";
import {
  admitEpisodePlanner,
  beginEpisodePlannerAttempt,
  finalizeEpisodePlannerAttempt,
  persistAcceptedEpisodePlannerPlan,
  plannerAdmissionPath,
  readPlannerBudgetStatus,
  type PlannerAdmissionLimits,
} from "../../loop/planner-admission.js";
import {
  beginProviderStep,
  fingerprint,
  finalizeProviderStep,
  readExecutionSteps,
  readPendingProviderSteps,
  type ExecutionStepRecord,
  type ProviderStepPlanMetadata,
  type StartedProviderStep,
} from "../../loop/efficiency.js";
import { writeContextManifest } from "../../loop/context-manifest.js";
import {
  CONFIGURED_ASSIGNMENT_CANDIDATE_ID,
  buildTurnExecutionFacts,
  configuredProviderFamily,
  fixedAssignmentFromRole,
  turnAssignmentsEqual,
  validateTurnExecutionFacts,
} from "../../runtime/assignment.js";
import {
  resolvedRuntimeCapabilities,
  type RuntimeCapability,
} from "../../runtime/capabilities.js";
import {
  finalizeRun,
  readEnvelope,
  startRun,
  updateEnvelope,
  type EnvelopeStatus,
  type EnvelopeUsage,
  type SessionEvidence,
} from "../../runtime/runlog/envelope.js";
import { createEventWriter, type EventWriter } from "../../runtime/runlog/events.js";
import {
  createSessionLogSink,
  writeBrief,
  writeOutput,
  writePrompt,
} from "../../runtime/runlog/forensics.js";
import { mintRunId, runPaths } from "../../runtime/runlog/paths.js";
import { recordTurnOnce, toRecord, type TriggerKind } from "../../runtime/telemetry.js";
import type {
  ContextBundle,
  RoleConfig,
  Runtime,
  TurnAssignment,
  TurnHooks,
  TurnProgress,
  TurnResult,
  TurnUsage,
} from "../../runtime/types.js";
import type { AppEntry } from "../apps.js";
import {
  CreatorScopeConflictError,
  EpisodePlannerFailedError,
  hasAuthoritativeCreatorScopeConflict,
  persistEpisodeIntent,
  prepareEpisodePlan,
  type EpisodePlannerProposalRequest,
  type PreparedEpisodePlan,
} from "./coordinator.js";
import {
  renderEpisodePlannerBrief,
  renderEpisodePlannerRevisionBrief,
  type EpisodePlannerRevisionRequest,
} from "./brief.js";
import type {
  EpisodePlanRevisionProposal,
  EpisodePlanRevisionProposalRequest,
} from "./execution.js";
import {
  createEpisodePlanningPolicy,
  type EpisodePlanningPolicy,
  type EpisodePlanningPolicyOptions,
} from "./policy.js";

export const EPISODE_PLANNER_PIPELINE = "episode-planner" as const;
export const EPISODE_PLANNER_ACCEPTANCE_INTERNAL_ERROR =
  "error_episode_planner_acceptance_internal" as const;
export const MAX_EPISODE_PLANNER_PROMPT_BYTES = 64 * 1024;
export const MAX_EPISODE_PLANNER_CONTEXT_BYTES = 640 * 1024;

const DEFAULT_REQUIRED_CAPABILITIES = [
  "cancellation",
  "session_resume",
  "structured_verdict",
  "tool_gate",
] as const satisfies readonly RuntimeCapability[];

const EPISODE_PLANNER_TOOL_DENIAL =
  "EpisodePlanner is confined to the bounded intent and context manifest; tool calls are not authorized";

const EPISODE_PLAN_REASON_CODE_SET = new Set<string>(EPISODE_PLAN_REASON_CODES);

export interface ProviderEpisodePlannerOptions {
  root: string;
  app: AppEntry;
  roles: readonly RoleConfig[];
  intent: EpisodeIntent;
  /** Domain-owned provider operation registry. When present it becomes both
   * a structured-output enum and an acceptance policy constraint. */
  providerOperations?: readonly string[];
  /** Domain-owned mechanical-gate registry. Same contract as the operation
   * registry: an unhandled gate becomes unrepresentable, not merely rejected. */
  mechanicalGates?: readonly string[];
  /** Closed machine-readable topology contract rendered into the bounded
   * brief so the planner is taught the rules validation enforces. */
  topologyContract?: Readonly<Record<string, unknown>>;
  /** Human-ratified planner protocol supplied by the caller. This module does
   * not own or mutate the protected prompt surface. */
  promptText: string;
  context: ContextBundle;
  workdir: string;
  hooks: TurnHooks;
  runtimeForAssignment: (assignment: TurnAssignment, role: RoleConfig) => Runtime;
  policyVersion: string;
  limits: PlannerAdmissionLimits;
  requiredCapabilities?: readonly RuntimeCapability[];
  workflowTemplates?: EpisodePlanningPolicyOptions["workflowTemplates"];
  additionalCapabilitiesByRole?: EpisodePlanningPolicyOptions["additionalCapabilitiesByRole"];
  independentReview?: EpisodePlanningPolicyOptions["independentReview"];
  safetyFloorMapping?: EpisodePlanningPolicyOptions["safetyFloorMapping"];
  /** Optional domain protocol validation (for example, the ticket operation
   * catalog). It runs after core validation and before plan publication. */
  validateAcceptedPlan?: (plan: EpisodePlan) => void;
  traceId?: string;
  parentTaskId?: string;
  maxTurns?: number;
  /** Compatibility input from callers that share delivery options. Planning
   * is intentionally confined to its bounded intent and never receives
   * network access. */
  networkAccess?: boolean;
  signal?: AbortSignal;
  /** Grace for an adapter to return measured usage after cancellation. */
  cancellationGraceMs?: number;
  contextBudgetBytes?: number;
  telemetry?: {
    orgDir: string;
    trigger?: TriggerKind;
  };
  now?: () => Date;
  /** A durable-checkpoint observer. If it throws, a retry consumes the
   * terminal attempt and never calls the provider again. This is also the
   * fault-injection seam used by restart tests. */
  afterAttemptFinalized?: (input: {
    attempt: 1 | 2;
    step: ExecutionStepRecord;
  }) => void | Promise<void>;
}

export type ProviderEpisodePlannerRevisionOptions = Omit<
  ProviderEpisodePlannerOptions,
  "intent"
>;

/** A terminal provider receipt may exist before its run envelope or ledger
 * row is complete. Keep the typed replan request pending so a later invocation
 * can reconcile that exact turn; rejecting it would make a crash permanent. */
export class EpisodePlannerRevisionDeferredError extends Error {
  readonly code = "error_episode_replan_provider_in_flight" as const;
  constructor(message: string) {
    super(message);
    this.name = "EpisodePlannerRevisionDeferredError";
  }
}

class EpisodePlannerAcceptanceInternalError extends Error {
  readonly code = EPISODE_PLANNER_ACCEPTANCE_INTERNAL_ERROR;
  readonly detail: string;

  constructor(error: Error) {
    super(`EpisodePlanner plan acceptance failed internally: ${error.message}`, { cause: error });
    this.name = "EpisodePlannerAcceptanceInternalError";
    this.detail = error.message;
  }
}

class EpisodePlannerAttemptFailedError extends Error {
  readonly code: string;

  constructor(label: string, attempt: number, result: TurnResult) {
    super(`${label} attempt ${attempt} ended ${result.status}: ${result.summary}`);
    this.name = "EpisodePlannerAttemptFailedError";
    this.code = result.errorCode ?? "error_episode_planner_attempt_failed";
  }
}

interface PlannerExecutedAttemptOutput {
  rawOutput: string;
  result: TurnResult;
  step: ExecutionStepRecord;
  evaluation?: PlannerOutputEvaluation;
}

type PlannerOutputEvaluation =
  | { kind: "accepted"; plan: EpisodePlan }
  | { kind: "rejected"; diagnostics: EpisodePlanIssue[] }
  | { kind: "internal_error"; error: Error };

type PlannerOutputEvaluator = (rawOutput: string) => EpisodePlan;

type PlannerAttemptOutput =
  | PlannerExecutedAttemptOutput
  | { acceptedPlan: EpisodePlan };

interface StartedPlannerAttempt {
  assignment: TurnAssignment;
  planMetadata: ProviderStepPlanMetadata;
  started: StartedProviderStep;
  maxTurnBudgetUsd: number;
}

interface TerminalPlannerAttempt {
  attempt: number;
  step: ExecutionStepRecord;
}

/**
 * Prepare one durable EpisodePlan using either the explicit creator bypass or
 * an admitted provider-backed EpisodePlanner. Provider attempts are fixed to
 * the configured Planner tuple before any runtime is constructed.
 */
export async function prepareEpisodePlanWithRuntime(
  options: ProviderEpisodePlannerOptions,
): Promise<PreparedEpisodePlan> {
  assertOptions(options);
  const now = options.now ?? (() => new Date());
  const existing = await readCurrentEpisodePlan(options.root, options.intent.episodeId);
  const policy = planningPolicy(
    options,
    existing === undefined ? "current_config" : "persisted_intent",
  );
  const intentHash = await persistEpisodeIntent(options.root, options.intent);
  const creatorScopeAssessment = assessCreatorScope(
    options.intent.creatorScope,
    policy.creatorScope,
  );

  if (existing !== undefined) {
    assertEpisodePlanValid(existing, options.intent, policy.validation);
    options.validateAcceptedPlan?.(structuredClone(existing));
    if (existing.planningSource === "episode_planner") {
      const plannerRole = requirePlannerRole(options.roles);
      await persistAcceptedEpisodePlannerPlan({
        root: options.root,
        plan: existing,
        intent: options.intent,
        policy: policy.validation,
        now: now(),
      });
      await settleAcceptedPlannerAttempts(options, plannerRole, now);
    } else if (existsSync(plannerAdmissionPath(options.root, options.intent.episodeId))) {
      throw new Error("creator-scoped plan cannot have an EpisodePlanner boot admission");
    }
    return preparedResult(
      existing,
      creatorScopeAssessment,
      existing.planningSource === "creator_scope" ? 0 : await terminalAttemptCount(options),
    );
  }

  if (creatorScopeAssessment.executionReady) {
    // The existing coordinator is intentionally retained for the zero-provider
    // normalization path. It persists no planner admission or provider step.
    return prepareEpisodePlan({
      root: options.root,
      app: options.app,
      roles: options.roles,
      intent: options.intent,
      now,
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
      ...(options.providerOperations === undefined
        ? {}
        : { providerOperations: options.providerOperations }),
      ...(options.mechanicalGates === undefined
        ? {}
        : { mechanicalGates: options.mechanicalGates }),
      ...(options.topologyContract === undefined
        ? {}
        : { topologyContract: options.topologyContract }),
      ...(options.validateAcceptedPlan === undefined
        ? {}
        : { validateAcceptedPlan: options.validateAcceptedPlan }),
    });
  }
  if (hasAuthoritativeCreatorScopeConflict(creatorScopeAssessment.issues)) {
    throw new CreatorScopeConflictError(creatorScopeAssessment.issues);
  }

  // The protected provider protocol is an input only to an actual
  // EpisodePlanner turn. A complete creator-authored scope normalizes through
  // the zero-provider path above and must not depend on planner prompt bytes
  // that are never read or executed.
  assertPlannerPrompt(options.promptText);
  const plannerRole = requirePlannerRole(options.roles);
  const requiredCapabilities = uniqueSortedCapabilities(
    options.requiredCapabilities ?? DEFAULT_REQUIRED_CAPABILITIES,
  );
  const admission = await admitEpisodePlanner({
    root: options.root,
    episodeId: options.intent.episodeId,
    app: options.app.name,
    policyVersion: options.policyVersion,
    intentHash,
    plannerRole,
    requiredCapabilities,
    limits: options.limits,
    now: now(),
  });
  let diagnostics: EpisodePlanIssue[] = [];
  const proposalCreatedAt = admission.admitted_at;

  for (const attempt of [1, 2] as const) {
    const priorDiagnostics = diagnostics;
    const request: EpisodePlannerProposalRequest = {
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
    };
    const outcome = await runPlannerAttempt(
      options,
      plannerRole,
      requiredCapabilities,
      request,
      (rawOutput) => evaluateInitialPlannerOutput(
        rawOutput,
        options,
        policy,
        proposalCreatedAt,
      ),
      now,
    );
    if ("acceptedPlan" in outcome) {
      assertEpisodePlanValid(outcome.acceptedPlan, options.intent, policy.validation);
      options.validateAcceptedPlan?.(structuredClone(outcome.acceptedPlan));
      await persistAcceptedEpisodePlannerPlan({
        root: options.root,
        plan: outcome.acceptedPlan,
        intent: options.intent,
        policy: policy.validation,
        now: now(),
      });
      await settleAcceptedPlannerAttempts(options, plannerRole, now);
      return preparedResult(
        outcome.acceptedPlan,
        creatorScopeAssessment,
        await terminalAttemptCount(options),
      );
    }
    if (outcome.evaluation?.kind === "rejected") {
      diagnostics = outcome.evaluation.diagnostics;
      if (attempt === 2 || !hasActionableRepairDiagnostic(diagnostics)) {
        throw new EpisodePlannerFailedError(
          attempt,
          attempt === 2
            ? annotateRepairRegression(priorDiagnostics, diagnostics)
            : diagnostics,
        );
      }
      continue;
    }
    if (outcome.evaluation?.kind === "internal_error") {
      throw new EpisodePlannerAcceptanceInternalError(outcome.evaluation.error);
    }
    if (outcome.evaluation?.kind === "accepted") {
      const plan = outcome.evaluation.plan;
      await persistAcceptedEpisodePlannerPlan({
        root: options.root,
        plan,
        intent: options.intent,
        policy: policy.validation,
        now: now(),
      });
      await settleAcceptedPlannerAttempts(options, plannerRole, now);
      return preparedResult(
        plan,
        creatorScopeAssessment,
        await terminalAttemptCount(options),
      );
    }
    if (outcome.result.status !== "completed" || outcome.evaluation === undefined) {
      throw new EpisodePlannerAttemptFailedError("EpisodePlanner", attempt, outcome.result);
    }
    throw new EpisodePlannerAttemptFailedError("EpisodePlanner", attempt, outcome.result);
  }
  throw new EpisodePlannerFailedError(2, diagnostics);
}

/** Build the production callback consumed by the accepted-plan executor after
 * a typed material failure. Each invocation uses the configured Planner tuple
 * (never an assignment selected by the plan being revised), permits one
 * structural repair, and returns a proposal only after ordinary deterministic
 * validation plus forward-only completed-step checks pass. Publication remains
 * exclusively owned by the typed replan transaction in execution.ts. */
export function createProviderEpisodePlanRevisionProposer(
  base: ProviderEpisodePlannerRevisionOptions,
): (request: EpisodePlanRevisionProposalRequest) => Promise<EpisodePlanRevisionProposal> {
  return async (request) => {
    const options: ProviderEpisodePlannerOptions = {
      ...base,
      intent: structuredClone(request.intent),
    };
    assertOptions(options);
    assertPlannerPrompt(options.promptText);
    const current = await readCurrentEpisodePlan(options.root, request.intent.episodeId);
    if (
      current === undefined ||
      current.version !== request.previousPlan.version ||
      fingerprint(current) !== fingerprint(request.previousPlan)
    ) {
      throw new Error(
        `EpisodePlanner revision expected current plan v${request.previousPlan.version}`,
      );
    }
    const plannerRole = requirePlannerRole(options.roles);
    const requiredCapabilities = uniqueSortedCapabilities(
      options.requiredCapabilities ?? DEFAULT_REQUIRED_CAPABILITIES,
    );
    const policy = planningPolicy(options, "persisted_intent");
    const executionJournal = await readEpisodePlanExecutionJournal(
      options.root,
      request.intent.episodeId,
    );
    const completedStepIds = executionJournal === undefined
      ? []
      : completedEpisodePlanStepIds(executionJournal);
    const proposalCreatedAt = revisionProposalTimestamp(
      request.previousPlan.createdAt,
      request.replan.requestedAt,
    );
    let diagnostics: EpisodePlanIssue[] = [];

    for (const attempt of [1, 2] as const) {
      const priorDiagnostics = diagnostics;
      const plannerRequest: EpisodePlannerRevisionRequest = {
        intent: structuredClone(request.intent),
        ...(options.providerOperations === undefined
          ? {}
          : { providerOperations: [...options.providerOperations] }),
        ...(options.mechanicalGates === undefined
          ? {}
          : { mechanicalGates: [...options.mechanicalGates] }),
        ...(options.topologyContract === undefined
          ? {}
          : { topologyContract: options.topologyContract }),
        previousPlan: structuredClone(request.previousPlan),
        replan: structuredClone(request.replan),
        attempt,
        proposalCreatedAt,
        validationDiagnostics: structuredClone(diagnostics),
      };
      const outcome = await runRevisionPlannerAttempt(
        options,
        plannerRole,
        requiredCapabilities,
        plannerRequest,
        (rawOutput) => evaluateRevisionPlannerOutput(
          rawOutput,
          options,
          policy,
          request,
          proposalCreatedAt,
          completedStepIds,
        ),
        options.now ?? (() => new Date()),
      );
      if (outcome.evaluation?.kind === "rejected") {
        diagnostics = outcome.evaluation.diagnostics;
        if (attempt === 2 || !hasActionableRepairDiagnostic(diagnostics)) {
          throw new EpisodePlannerFailedError(
            attempt,
            attempt === 2
              ? annotateRepairRegression(priorDiagnostics, diagnostics)
              : diagnostics,
          );
        }
        continue;
      }
      if (outcome.evaluation?.kind === "internal_error") {
        throw new EpisodePlannerAcceptanceInternalError(outcome.evaluation.error);
      }
      if (outcome.evaluation?.kind === "accepted") {
        return { plan: outcome.evaluation.plan, policy: policy.validation };
      }
      if (outcome.result.status !== "completed" || outcome.evaluation === undefined) {
        throw new EpisodePlannerAttemptFailedError(
          "EpisodePlanner revision",
          attempt,
          outcome.result,
        );
      }
      throw new EpisodePlannerAttemptFailedError(
        "EpisodePlanner revision",
        attempt,
        outcome.result,
      );
    }
    throw new EpisodePlannerFailedError(2, diagnostics);
  };
}

async function runPlannerAttempt(
  options: ProviderEpisodePlannerOptions,
  plannerRole: RoleConfig,
  requiredCapabilities: RuntimeCapability[],
  request: EpisodePlannerProposalRequest,
  evaluateOutput: PlannerOutputEvaluator,
  now: () => Date,
): Promise<PlannerAttemptOutput> {
  const brief = renderEpisodePlannerBrief(request);
  const attemptName = request.attempt === 1 ? "plan" : "repair";
  const runId = mintRunId(
    now(),
    EPISODE_PLANNER_PIPELINE,
    `${attemptName}-${fingerprint(options.intent.episodeId).slice(0, 8)}`,
  );
  const inputFingerprint = fingerprint({
    operation: `${EPISODE_PLANNER_PIPELINE}/${attemptName}`,
    role: plannerRole.name,
    assignment: {
      harness: plannerRole.runtime,
      model: plannerRole.model,
      effort: plannerRole.effort,
    },
    brief,
    prompt: options.promptText,
  });
  const decision = await beginEpisodePlannerAttempt({
    root: options.root,
    episodeId: options.intent.episodeId,
    app: options.app.name,
    runId,
    attempt: request.attempt,
    inputFingerprint,
    now: now(),
  });
  if (decision.kind === "plan_accepted") {
    return { acceptedPlan: decision.plan };
  }
  if (decision.kind === "resume_terminal") {
    return recoverTerminalAttempt(options, plannerRole, decision, evaluateOutput, now);
  }
  return executeStartedAttempt(
    options,
    plannerRole,
    requiredCapabilities,
    request,
    brief,
    attemptName,
    runId,
    decision,
    evaluateOutput,
    now,
  );
}

async function runRevisionPlannerAttempt(
  options: ProviderEpisodePlannerOptions,
  plannerRole: RoleConfig,
  requiredCapabilities: RuntimeCapability[],
  request: EpisodePlannerRevisionRequest,
  evaluateOutput: PlannerOutputEvaluator,
  now: () => Date,
): Promise<PlannerExecutedAttemptOutput> {
  validateRevisionPlannerLimits(options.limits, plannerRole, request.attempt);
  const brief = renderEpisodePlannerRevisionBrief(request);
  const attemptName = request.attempt === 1
    ? `revision-v${request.previousPlan.version + 1}-plan`
    : `revision-v${request.previousPlan.version + 1}-repair`;
  const stableAt = new Date(request.replan.requestedAt);
  const runId = mintRunId(
    stableAt,
    EPISODE_PLANNER_PIPELINE,
    `${attemptName}-${fingerprint(request.replan.trigger.id).slice(0, 8)}`,
  );
  const operation = `${EPISODE_PLANNER_PIPELINE}/${attemptName}`;
  const executionStepId = `${runId}:provider:${request.attempt}`;
  const inputFingerprint = fingerprint({
    operation,
    role: plannerRole.name,
    assignment: fixedAssignmentFromRole(plannerRole),
    brief,
    prompt: options.promptText,
  });
  const terminal = (await readExecutionSteps(options.root, options.intent.episodeId))
    .find((step) => step.execution_step_id === executionStepId);
  if (terminal !== undefined) {
    if (
      terminal.operation !== operation ||
      terminal.input_fingerprint !== inputFingerprint
    ) {
      throw new Error(
        `EpisodePlanner revision attempt ${request.attempt} has conflicting durable evidence`,
      );
    }
    return recoverTerminalAttempt(
      options,
      plannerRole,
      { attempt: request.attempt, step: terminal },
      evaluateOutput,
      now,
      attemptName,
      true,
    );
  }
  const pending = (await readPendingProviderSteps(options.root, options.intent.episodeId))
    .find((receipt) => receipt.execution_step_id === executionStepId);
  if (pending !== undefined) {
    if (
      pending.operation !== operation ||
      pending.input_fingerprint !== inputFingerprint
    ) {
      throw new Error(
        `EpisodePlanner revision attempt ${request.attempt} has a conflicting reservation`,
      );
    }
    throw new EpisodePlannerRevisionDeferredError(
      `EpisodePlanner revision attempt ${request.attempt} is still in flight`,
    );
  }

  const assignment = fixedAssignmentFromRole(plannerRole);
  const executionFacts = buildTurnExecutionFacts(
    assignment,
    plannerRole,
    requiredCapabilities,
  );
  const planMetadata: ProviderStepPlanMetadata = {
    assignment_source: "configured",
    assignment_candidate_id: CONFIGURED_ASSIGNMENT_CANDIDATE_ID,
    selection_reason: "Fixed EpisodePlanner boot assignment for bounded plan revision",
    provider_family: configuredProviderFamily(assignment),
    resolved_capabilities: [...executionFacts.resolvedCapabilities],
  };
  const started = await beginProviderStep({
    root: options.root,
    episodeId: options.intent.episodeId,
    app: options.app.name,
    runId,
    ordinal: request.attempt,
    operation,
    role: plannerRole,
    assignment,
    planMetadata,
    inputFingerprint,
    now: now(),
    next: {
      costUsd: options.limits.perAttempt.equivalentCostUsd,
      activeTimeMs: options.limits.perAttempt.activeTimeMs,
    },
  });
  try {
    return await executeStartedAttempt(
      options,
      plannerRole,
      requiredCapabilities,
      request,
      brief,
      attemptName,
      runId,
      {
        assignment,
        planMetadata,
        started,
        maxTurnBudgetUsd: options.limits.perAttempt.equivalentCostUsd,
      },
      evaluateOutput,
      now,
      (input) => finalizeProviderStep({
        root: options.root,
        episodeId: options.intent.episodeId,
        app: options.app.name,
        runId,
        started: input.started,
        operation,
        role: plannerRole,
        assignment,
        planMetadata,
        result: input.result,
        finishedAt: input.finishedAt,
        contextManifestRef: input.contextManifestRef,
        ...(input.artifactFingerprint === undefined
          ? {}
          : { artifactFingerprint: input.artifactFingerprint }),
        toolCallCount: input.toolCallCount,
      }),
      true,
    );
  } catch (error) {
    if (error instanceof EpisodePlannerRevisionDeferredError) throw error;
    const terminalAfterFailure = (
      await readExecutionSteps(options.root, options.intent.episodeId)
    ).some((step) => step.execution_step_id === executionStepId);
    const pendingAfterFailure = (
      await readPendingProviderSteps(options.root, options.intent.episodeId)
    ).some((receipt) => receipt.execution_step_id === executionStepId);
    if (terminalAfterFailure || pendingAfterFailure) {
      throw new EpisodePlannerRevisionDeferredError(
        `EpisodePlanner revision attempt ${request.attempt} stopped after durable provider evidence; restart will reconcile the exact turn`,
      );
    }
    throw error;
  }
}

async function executeStartedAttempt(
  options: ProviderEpisodePlannerOptions,
  plannerRole: RoleConfig,
  requiredCapabilities: RuntimeCapability[],
  request: Pick<EpisodePlannerProposalRequest, "attempt">,
  brief: string,
  attemptName: string,
  runId: string,
  decision: StartedPlannerAttempt,
  evaluateOutput: PlannerOutputEvaluator,
  now: () => Date,
  finalizeAttempt: (input: {
    started: StartedProviderStep;
    result: TurnResult;
    finishedAt: Date;
    contextManifestRef: string;
    artifactFingerprint?: string;
    toolCallCount: number;
  }) => Promise<ExecutionStepRecord> = (input) => finalizeEpisodePlannerAttempt({
    root: options.root,
    episodeId: options.intent.episodeId,
    app: options.app.name,
    runId,
    attempt: request.attempt,
    plannerRole,
    ...input,
  }),
  strictSettlement = false,
): Promise<PlannerExecutedAttemptOutput> {
  const { assignment, planMetadata, started } = decision;
  const proposalSchema = options.providerOperations === undefined
    ? structuredClone(EPISODE_PLAN_PROPOSAL_SCHEMA) as Record<string, unknown>
    : episodePlanProposalSchemaForOperations(
      options.providerOperations,
      options.mechanicalGates === undefined ? {} : { mechanicalGates: options.mechanicalGates },
    );
  const executionFacts = buildTurnExecutionFacts(
    assignment,
    plannerRole,
    requiredCapabilities,
  );
  if (options.context.execution !== undefined) {
    const supplied = validateTurnExecutionFacts(
      options.context.execution,
      "EpisodePlanner context execution facts",
    );
    if (JSON.stringify(supplied) !== JSON.stringify(executionFacts)) {
      throw new Error("EpisodePlanner context execution facts disagree with its fixed boot assignment");
    }
  }
  const context: ContextBundle = { ...options.context, execution: executionFacts };
  const traceId = options.traceId ?? options.intent.episodeId;
  await startRun(options.root, {
    runId,
    traceId,
    ...(options.parentTaskId === undefined ? {} : { parentTaskId: options.parentTaskId }),
    episodeId: options.intent.episodeId,
    app: options.app.name,
    pipeline: EPISODE_PLANNER_PIPELINE,
    pass: attemptName,
    role: plannerRole.name,
    runtime: assignment.harness,
    model: assignment.model,
    effort: assignment.effort,
    assignmentSource: "configured",
    ...(planMetadata.assignment_candidate_id === undefined
      ? {}
      : { assignmentCandidateId: planMetadata.assignment_candidate_id }),
    ...(planMetadata.selection_reason === undefined
      ? {}
      : { selectionReason: planMetadata.selection_reason }),
    resolvedCapabilities: [...executionFacts.resolvedCapabilities],
    workdir: options.workdir,
    tracePlan: { required_passes: [attemptName], skipped_passes: [] },
    providerTurnIds: [started.providerTurnId],
    executionStepIds: [started.executionStepId],
  }, started.startedAt);

  const contextManifest = await writeContextManifest({
    root: options.root,
    episodeId: options.intent.episodeId,
    app: options.app.name,
    runId,
    context,
    brief,
    template: options.promptText,
    route: "deep",
    runtime: assignment.harness,
    capBytes: options.contextBudgetBytes ?? MAX_EPISODE_PLANNER_CONTEXT_BYTES,
  });
  const task = `${contextManifest.brief}\n\n---\n\n${contextManifest.template ?? ""}`;
  await Promise.all([
    writeBrief(options.root, options.app.name, runId, contextManifest.brief),
    writePrompt(options.root, options.app.name, runId, task),
  ]);
  await updateEnvelope(options.root, options.app.name, runId, {
    contextManifestRef: contextManifest.relativeRef,
  });

  const events = plannerEventWriter(options, runId, traceId, attemptName, assignment.model, now);
  await events.append({ type: "run.started" });
  await events.append({ type: "pass.started" });
  const sessionLog = createSessionLogSink(options.root, options.app.name, runId);
  let latestProgress: TurnProgress | undefined;
  let checkpointWrites = Promise.resolve();
  let toolCalls = 0;
  const turnHooks: TurnHooks = {
    // The deterministic repository/trigger inspection already happened
    // before this turn. Deny every tool (including subagent tools) so the
    // provider cannot expand its input authority by reading the worktree,
    // environment, network, or other local state while designing the plan.
    gate: () => ({
      allow: false,
      reason: EPISODE_PLANNER_TOOL_DENIAL,
      escalate: false,
    }),
    onEvent: (event) => {
      sessionLog(event);
      if (event.type === "tool_use") toolCalls += 1;
      options.hooks.onEvent?.(event);
    },
    onProgress: (progress) => {
      latestProgress = mergeProgress(latestProgress, progress);
      checkpointWrites = checkpointWrites.then(() =>
        updateEnvelope(options.root, options.app.name, runId, {
          ...(latestProgress?.usage === undefined
            ? {}
            : { usage: toEnvelopeUsage(latestProgress.usage, "partial") }),
          ...(latestProgress?.session === undefined
            ? {}
            : { session: sessionEvidence(latestProgress.session) }),
          lastSeenAt: progress.at ?? now().toISOString(),
        }).then(() => undefined),
      );
      options.hooks.onProgress?.(progress);
    },
  };

  let result: TurnResult;
  let executionError: Error | undefined;
  try {
    // Admission, started receipt, context manifest, and exact input are all
    // durable before this construction boundary.
    const runtime = options.runtimeForAssignment(assignment, plannerRole);
    if (runtime.kind !== assignment.harness) {
      throw new Error(
        `EpisodePlanner runtime factory returned ${runtime.kind} for ${assignment.harness} assignment`,
      );
    }
    const admittedRole: RoleConfig = {
      ...plannerRole,
      maxTurnBudgetUsd: Math.min(plannerRole.maxTurnBudgetUsd, decision.maxTurnBudgetUsd),
    };
    result = await runBoundedPlannerTurn({
      runtime,
      request: {
        role: admittedRole,
        assignment,
        workdir: options.workdir,
        task,
        context: contextManifest.context,
        verdictSchema: proposalSchema,
        ...(options.maxTurns === undefined ? {} : { maxTurns: options.maxTurns }),
      },
      hooks: turnHooks,
      assignment,
      attempt: request.attempt,
      activeTimeMs: started.reservation.activeTimeMs,
      cancellationGraceMs: options.cancellationGraceMs ?? 2_000,
      ...(options.signal === undefined ? {} : { parentSignal: options.signal }),
      latestProgress: () => latestProgress,
    });
    if (result.session.runtime !== assignment.harness) {
      result = {
        ...result,
        status: "failed",
        errorCode: "error_episode_planner_assignment_mismatch",
        summary:
          `EpisodePlanner returned ${result.session.runtime} session evidence for ` +
          `${assignment.harness} assignment`,
        artifacts: [],
        session: { runtime: assignment.harness, id: result.session.id },
      };
    }
  } catch (error) {
    executionError = normalizeError(error);
    result = failedResult(error, assignment, request.attempt, latestProgress);
  }
  await checkpointWrites;
  const rawOutput = result.summary;
  let evaluation: PlannerOutputEvaluation | undefined;
  if (result.status === "completed") {
    evaluation = evaluatePlannerOutput(rawOutput, evaluateOutput);
    if (evaluation.kind === "rejected") {
      result = rejectedPlannerResult(result, evaluation.diagnostics);
    } else if (evaluation.kind === "internal_error") {
      result = internalPlannerResult(result, evaluation.error);
    }
  }
  await writeOutput(options.root, options.app.name, runId, rawOutput);
  await updateEnvelope(options.root, options.app.name, runId, {
    usage: toEnvelopeUsage(result.usage),
    session: sessionEvidence(result.session),
    ...(result.artifacts.length === 0 ? {} : { artifacts: result.artifacts }),
    previews: { task, output: rawOutput },
    ...(toolCalls === 0 ? {} : { tool_counts: { provider: toolCalls } }),
  });
  for (const escalation of result.escalations) {
    await events.append({
      type: "escalation.raised",
      severity: "warn",
      detail: { tool: escalation.action.tool, reason: escalation.reason },
    });
  }

  let step: ExecutionStepRecord;
  try {
    step = await finalizeAttempt({
      started,
      result,
      finishedAt: now(),
      contextManifestRef: contextManifest.relativeRef,
      ...(result.artifacts.length === 0
        ? {}
        : { artifactFingerprint: fingerprint(result.artifacts) }),
      toolCallCount: toolCalls,
    });
  } catch (error) {
    if (
      error !== null &&
      typeof error === "object" &&
      "terminalStep" in error &&
      (error as { terminalStep?: ExecutionStepRecord }).terminalStep !== undefined
    ) {
      step = (error as { terminalStep: ExecutionStepRecord }).terminalStep;
      await finishRunAndSettle(
        options,
        plannerRole,
        result,
        step,
        events,
        now,
        strictSettlement,
        evaluation?.kind === "internal_error" ? evaluation.error : executionError,
      );
    }
    throw error;
  }
  await options.afterAttemptFinalized?.({ attempt: request.attempt, step });
  await finishRunAndSettle(
    options,
    plannerRole,
    result,
    step,
    events,
    now,
    strictSettlement,
    evaluation?.kind === "internal_error" ? evaluation.error : executionError,
  );
  return {
    rawOutput,
    result,
    step,
    ...(evaluation === undefined ? {} : { evaluation }),
  };
}

async function recoverTerminalAttempt(
  options: ProviderEpisodePlannerOptions,
  plannerRole: RoleConfig,
  decision: TerminalPlannerAttempt,
  evaluateOutput: PlannerOutputEvaluator,
  now: () => Date,
  pass = decision.attempt === 1 ? "plan" : "repair",
  strictSettlement = false,
): Promise<PlannerExecutedAttemptOutput> {
  const step = decision.step;
  const envelope = await readEnvelope(options.root, options.app.name, step.run_id);
  const events = plannerEventWriter(
    options,
    step.run_id,
    envelope.trace_id,
    pass,
    step.model ?? undefined,
    now,
  );
  let rawOutput = step.reason;
  const outputPath = runPaths(options.root, options.app.name, step.run_id).output;
  if (existsSync(outputPath)) rawOutput = await readFile(outputPath, "utf8");
  else await writeOutput(options.root, options.app.name, step.run_id, rawOutput);
  const terminalResult = resultFromTerminal(step);
  const evaluation = shouldEvaluateRecoveredPlannerOutput(terminalResult)
    ? evaluatePlannerOutput(rawOutput, evaluateOutput)
    : undefined;
  // A terminal provider receipt may predate its envelope finalization. Apply
  // deterministic plan rejection before that remaining durable work so a
  // recovered crash cannot recreate the old completed-on-invalid-output bug.
  // Already-terminal legacy envelopes remain immutable and are only diagnosed
  // by `evaluation`; this recovery path never rewrites terminal evidence.
  const result = envelope.status === "running" && terminalResult.status === "completed"
    ? evaluation?.kind === "rejected"
      ? rejectedPlannerResult(terminalResult, evaluation.diagnostics)
      : evaluation?.kind === "internal_error"
        ? internalPlannerResult(terminalResult, evaluation.error)
        : terminalResult
    : terminalResult;
  if (envelope.status === "running") {
    await updateEnvelope(options.root, options.app.name, step.run_id, {
      usage: toEnvelopeUsage(result.usage),
      previews: { output: rawOutput },
    });
    await finalizePlannerRun(
      options,
      result,
      step.run_id,
      events,
      now,
      evaluation?.kind === "internal_error" ? evaluation.error : undefined,
    );
  }
  await settlePlannerTurn(options, plannerRole, result, step, events, strictSettlement);
  return {
    rawOutput,
    result,
    step,
    ...(evaluation === undefined ? {} : { evaluation }),
  };
}

async function finishRunAndSettle(
  options: ProviderEpisodePlannerOptions,
  plannerRole: RoleConfig,
  result: TurnResult,
  step: ExecutionStepRecord,
  events: EventWriter,
  now: () => Date,
  strictSettlement = false,
  internalError?: Error,
): Promise<void> {
  await settlePlannerTurn(options, plannerRole, result, step, events, strictSettlement);
  await finalizePlannerRun(options, result, step.run_id, events, now, internalError);
}

async function settlePlannerTurn(
  options: ProviderEpisodePlannerOptions,
  plannerRole: RoleConfig,
  result: TurnResult,
  step: ExecutionStepRecord,
  events: EventWriter,
  strict = false,
): Promise<void> {
  if (step.provider_turn_id === null || step.runtime === null || step.model === null || step.effort === null) {
    throw new Error(`EpisodePlanner terminal step ${step.execution_step_id} lacks provider identity`);
  }
  const assignment: TurnAssignment = {
    harness: step.runtime,
    model: step.model,
    effort: step.effort,
  };
  const settlementRole: RoleConfig = {
    ...plannerRole,
    runtime: assignment.harness,
    model: assignment.model,
    effort: assignment.effort,
  };
  const envelope = await readEnvelope(options.root, options.app.name, step.run_id);
  const record = toRecord(settlementRole, result, new Date(step.finished_at), {
    app: options.app.name,
    ...(options.telemetry?.trigger === undefined ? {} : { trigger: options.telemetry.trigger }),
    runId: step.run_id,
    providerTurnId: step.provider_turn_id,
    executionStepId: step.execution_step_id,
    episodeId: options.intent.episodeId,
    effort: assignment.effort,
    assignmentSource: "configured",
    assignmentCandidateId: step.assignment_candidate_id ?? "configured",
    selectionReason: step.selection_reason ?? "Fixed EpisodePlanner boot assignment",
    resolvedCapabilities:
      step.resolved_capabilities ?? resolvedRuntimeCapabilities(assignment.harness),
    traceId: envelope.trace_id,
    ...(envelope.parent_task_id === undefined ? {} : { parentTaskId: envelope.parent_task_id }),
    pipeline: EPISODE_PLANNER_PIPELINE,
    pass: step.operation.endsWith("repair") ? "repair" : "plan",
    ...(result.usage.quality === "unavailable" ? { unmeasured: true } : {}),
  });
  try {
    const settled = await recordTurnOnce(options.telemetry?.orgDir ?? options.root, record);
    if (!settled) {
      await events.append({
        type: "telemetry.settle_skipped",
        severity: "warn",
        detail: {
          providerTurnId: step.provider_turn_id,
          reason: "a ledger row with this app+providerTurnId already exists",
        },
      });
    }
  } catch (error) {
    await events.append({
      type: "telemetry.settle_failed",
      severity: "error",
      detail: {
        providerTurnId: step.provider_turn_id,
        executionStepId: step.execution_step_id,
        reason: error instanceof Error ? error.message : String(error),
      },
    });
    if (strict) {
      throw new EpisodePlannerRevisionDeferredError(
        `EpisodePlanner revision turn ${step.execution_step_id} is not settled: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}

async function finalizePlannerRun(
  options: ProviderEpisodePlannerOptions,
  result: TurnResult,
  runId: string,
  events: EventWriter,
  now: () => Date,
  internalError?: Error,
): Promise<void> {
  const status = envelopeStatus(result.status);
  const terminalEvent =
    status === "completed" ? "pass.completed" :
      status === "cancelled" ? "pass.cancelled" :
        status === "timed_out" ? "pass.timed_out" : "pass.failed";
  await events.append({
    type: terminalEvent,
    ...(result.errorCode === undefined ? {} : { errorCode: result.errorCode }),
    ...(status === "completed" ? {} : { severity: "error" }),
    ...(status === "completed"
      ? {}
      : {
          detail: {
            reason: result.summary,
            ...(internalError === undefined
              ? {}
              : {
                  detail: internalError.message,
                  stack: internalError.stack ?? `${internalError.name}: ${internalError.message}`,
                }),
          },
        }),
  });
  await events.append({ type: "run.completed" });
  await finalizeRun(options.root, options.app.name, runId, {
    status,
    verdictSummary: result.summary,
    usage: toEnvelopeUsage(result.usage),
    ...(result.errorCode === undefined ? {} : { errorCode: result.errorCode }),
    ...(status === "completed" ? {} : { reason: result.summary }),
  }, now());
}

function plannerEventWriter(
  options: ProviderEpisodePlannerOptions,
  runId: string,
  traceId: string,
  pass: string,
  model: string | undefined,
  now: () => Date,
): EventWriter {
  return createEventWriter(options.root, {
    runId,
    trace_id: traceId,
    span_id: pass,
    app: options.app.name,
    pipeline: EPISODE_PLANNER_PIPELINE,
    pass,
    role: "planner",
    ...(model === undefined ? {} : { model }),
  }, now);
}

function resultFromTerminal(step: ExecutionStepRecord): TurnResult {
  if (step.runtime === null) throw new Error("EpisodePlanner terminal step lacks runtime identity");
  return {
    status:
      step.status === "completed" ? "completed" :
        step.status === "blocked" ? "blocked_on_gate" :
          step.status === "cancelled" ? "cancelled" :
            step.status === "timed_out" ? "timed_out" : "failed",
    ...(step.error_code === null ? {} : { errorCode: step.error_code }),
    summary: step.reason,
    artifacts: [],
    session: { runtime: step.runtime, id: `recovered-${step.provider_turn_id ?? step.execution_step_id}` },
    usage: step.usage ?? unavailableUsage(),
    escalations: [],
  };
}

function evaluateInitialPlannerOutput(
  rawOutput: string,
  options: ProviderEpisodePlannerOptions,
  policy: EpisodePlanningPolicy,
  proposalCreatedAt: string,
): EpisodePlan {
  const proposal = parsePlannerOutput(rawOutput);
  if (proposal.createdAt !== proposalCreatedAt) {
    throw new EpisodePlanValidationError([{
      code: "plan_created_at_invalid",
      message: `createdAt must echo the orchestrator timestamp ${proposalCreatedAt}`,
    }]);
  }
  const materialized = materializeEpisodePlanAssignments(
    proposal,
    policy.materialization,
  );
  const plan: EpisodePlan = {
    ...materialized,
    derivedSafetyRoute: deriveEpisodeSafetyRoute(
      materialized.steps,
      options.intent.requiredSafetyFacts,
    ),
  };
  assertEpisodePlanValid(plan, options.intent, policy.validation);
  const supersessionIssues = validateInitialPlanSupersessions(plan);
  if (supersessionIssues.length > 0) {
    throw new EpisodePlanValidationError(supersessionIssues);
  }
  options.validateAcceptedPlan?.(structuredClone(plan));
  return plan;
}

function evaluateRevisionPlannerOutput(
  rawOutput: string,
  options: ProviderEpisodePlannerOptions,
  policy: EpisodePlanningPolicy,
  request: EpisodePlanRevisionProposalRequest,
  proposalCreatedAt: string,
  completedStepIds: readonly string[],
): EpisodePlan {
  const proposal = parsePlannerOutput(rawOutput);
  assertRevisionProposalIdentity(proposal, request, proposalCreatedAt);
  const materialized = materializeEpisodePlanAssignments(
    proposal,
    policy.materialization,
  );
  const plan: EpisodePlan = {
    ...materialized,
    derivedSafetyRoute: deriveEpisodeSafetyRoute(
      materialized.steps,
      request.intent.requiredSafetyFacts,
    ),
  };
  assertEpisodePlanValid(plan, request.intent, policy.validation);
  const revisionIssues = [
    ...validateForwardOnlyRevision(
      request.previousPlan,
      plan,
      completedStepIds,
    ),
    ...validateUnavailableAssignmentRevision(
      request.previousPlan,
      plan,
      request.replan,
      completedStepIds,
    ),
  ];
  if (revisionIssues.length > 0) {
    throw new EpisodePlanValidationError(revisionIssues);
  }
  options.validateAcceptedPlan?.(structuredClone(plan));
  return plan;
}

function evaluatePlannerOutput(
  rawOutput: string,
  evaluateOutput: PlannerOutputEvaluator,
): PlannerOutputEvaluation {
  try {
    return { kind: "accepted", plan: evaluateOutput(rawOutput) };
  } catch (error) {
    const diagnostics = diagnosticsFrom(error);
    return diagnostics === undefined
      ? { kind: "internal_error", error: normalizeError(error) }
      : { kind: "rejected", diagnostics };
  }
}

function rejectedPlannerResult(
  result: TurnResult,
  diagnostics: readonly EpisodePlanIssue[],
): TurnResult {
  const primary = diagnostics[0] ?? {
    code: "plan_structure_invalid" as const,
    message: "EpisodePlanner output did not satisfy the plan contract",
  };
  return {
    ...result,
    status: "failed",
    errorCode: primary.code,
    summary: diagnostics
      .map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`)
      .join("; "),
    artifacts: [],
  };
}

function internalPlannerResult(result: TurnResult, error: Error): TurnResult {
  return {
    ...result,
    status: "failed",
    errorCode: EPISODE_PLANNER_ACCEPTANCE_INTERNAL_ERROR,
    summary: `EpisodePlanner plan acceptance failed internally: ${error.message}`,
    artifacts: [],
  };
}

function shouldEvaluateRecoveredPlannerOutput(result: TurnResult): boolean {
  return result.status === "completed" ||
    result.errorCode === EPISODE_PLANNER_ACCEPTANCE_INTERNAL_ERROR ||
    (result.errorCode !== undefined && EPISODE_PLAN_REASON_CODE_SET.has(result.errorCode));
}

function parsePlannerOutput(raw: string) {
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    throw new EpisodePlanValidationError([{
      code: "plan_structure_invalid",
      message: "$: expected one strict JSON object; received invalid JSON text (json)",
      path: "$",
      constraint: "json",
      expected: "one strict JSON object",
      received: "invalid JSON text",
    }]);
  }
  return parseNormalizedProposedEpisodePlan(value);
}

function diagnosticsFrom(error: unknown): EpisodePlanIssue[] | undefined {
  if (error instanceof EpisodePlanValidationError) {
    return error.issues.map((issue) => ({ ...issue }));
  }
  if (hasIssueArray(error)) {
    return error.issues.map((entry) => ({
      code: "plan_structure_invalid",
      message: `${entry.code}: ${entry.message}`,
      ...(entry.stepId === undefined ? {} : { stepId: entry.stepId }),
      path: entry.stepId === undefined
        ? "$"
        : `$.steps[id=${JSON.stringify(entry.stepId)}]`,
      constraint: entry.code,
      // The violated invariant's stable id, when the domain names one. It is
      // what the repair brief lists as violated versus already satisfied.
      ...(entry.rule === undefined ? {} : { rule: entry.rule }),
      expected: entry.message,
      received: "policy-invalid proposal",
    }));
  }
  return undefined;
}

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
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

function hasActionableRepairDiagnostic(issues: readonly EpisodePlanIssue[]): boolean {
  return issues.some((entry) =>
    entry.code !== "plan_structure_invalid" ||
    (
      entry.path !== undefined &&
      entry.constraint !== undefined &&
      entry.constraint !== "internal_schema_consistency"
    ));
}

function assertRevisionProposalIdentity(
  proposal: ProposedEpisodePlan,
  request: EpisodePlanRevisionProposalRequest,
  proposalCreatedAt: string,
): void {
  const issues: EpisodePlanIssue[] = [];
  if (proposal.episodeId !== request.intent.episodeId) {
    issues.push({
      code: "plan_episode_identity_mismatch",
      message: `revision episodeId must be ${request.intent.episodeId}`,
    });
  }
  if (proposal.version !== request.previousPlan.version + 1) {
    issues.push({
      code: "plan_revision_version_invalid",
      message: `revision must be version ${request.previousPlan.version + 1}`,
    });
  }
  if (proposal.intentHash !== episodeIntentHash(request.intent)) {
    issues.push({
      code: "plan_intent_hash_mismatch",
      message: `revision intentHash must remain ${episodeIntentHash(request.intent)}`,
    });
  }
  if (proposal.createdAt !== proposalCreatedAt) {
    issues.push({
      code: "plan_created_at_invalid",
      message: `createdAt must echo the orchestrator timestamp ${proposalCreatedAt}`,
    });
  }
  if (proposal.planningSource !== request.previousPlan.planningSource) {
    issues.push({
      code: "plan_structure_invalid",
      message:
        `revision planningSource must preserve ${request.previousPlan.planningSource}; ` +
        "the typed replan journal records the revision author",
    });
  }
  if (!optionalFingerprintsEqual(
    proposal.creatorProvenance,
    request.previousPlan.creatorProvenance,
  )) {
    issues.push({
      code: "plan_creator_provenance_mismatch",
      message: "revision must preserve creator provenance exactly",
    });
  }
  if (issues.length > 0) throw new EpisodePlanValidationError(issues);
}

function optionalFingerprintsEqual(left: unknown, right: unknown): boolean {
  if (left === undefined || right === undefined) return left === right;
  return fingerprint(left) === fingerprint(right);
}

function validateUnavailableAssignmentRevision(
  previous: EpisodePlan,
  next: EpisodePlan,
  replan: EpisodeReplanRecord,
  completedStepIds: readonly string[],
): EpisodePlanIssue[] {
  if (replan.trigger.kind !== "assignment_unavailable") return [];
  const completed = new Set(completedStepIds);
  const unavailable = previous.steps.filter(
    (step): step is ProviderTurnStep =>
      step.kind === "provider_turn" &&
      replan.trigger.affectedStepIds.includes(step.id) &&
      !completed.has(step.id),
  );
  const issues: EpisodePlanIssue[] = [];
  for (const step of next.steps) {
    if (step.kind !== "provider_turn" || completed.has(step.id)) continue;
    if (unavailable.some((prior) =>
      prior.role === step.role &&
      turnAssignmentsEqual(prior.assignment, step.assignment))) {
      issues.push({
        code: "plan_assignment_unavailable",
        message:
          `revision retains the unavailable assignment for future ${step.role} step ${step.id}`,
        stepId: step.id,
      });
    }
  }
  return issues;
}

function revisionProposalTimestamp(previous: string, requested: string): string {
  const millis = Math.max(Date.parse(previous), Date.parse(requested));
  if (!Number.isFinite(millis)) {
    throw new Error("EpisodePlanner revision requires valid prior/request timestamps");
  }
  return new Date(millis).toISOString();
}

function validateRevisionPlannerLimits(
  limits: PlannerAdmissionLimits,
  plannerRole: RoleConfig,
  attempt: 1 | 2,
): void {
  if (attempt > limits.maxAttempts || attempt > limits.aggregate.providerTurns) {
    throw new Error(
      `EpisodePlanner revision attempt ${attempt} exceeds its admitted provider-turn allowance`,
    );
  }
  const values = [
    limits.perAttempt.equivalentCostUsd,
    limits.perAttempt.activeTimeMs,
  ];
  if (values.some((value) => !Number.isFinite(value) || value <= 0)) {
    throw new Error("EpisodePlanner revision per-attempt limits must be finite and positive");
  }
  if (limits.perAttempt.equivalentCostUsd > plannerRole.maxTurnBudgetUsd) {
    throw new Error(
      "EpisodePlanner revision per-attempt cost exceeds the configured Planner role ceiling",
    );
  }
  const aggregateChecks = [
    [
      "equivalent cost",
      limits.perAttempt.equivalentCostUsd * attempt,
      limits.aggregate.equivalentCostUsd,
    ],
    ["active time", limits.perAttempt.activeTimeMs * attempt, limits.aggregate.activeTimeMs],
  ] as const;
  const exceeded = aggregateChecks.find(([, required, cap]) => required > cap);
  if (exceeded !== undefined) {
    throw new Error(
      `EpisodePlanner revision attempt ${attempt} exceeds aggregate ${exceeded[0]} allowance`,
    );
  }
}

function planningPolicy(
  options: ProviderEpisodePlannerOptions,
  assignmentAuthority: "current_config" | "persisted_intent",
): EpisodePlanningPolicy {
  return createEpisodePlanningPolicy(options.app, {
    intent: options.intent,
    roles: options.roles,
    assignmentAuthority,
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
}

function preparedResult(
  plan: EpisodePlan,
  creatorScopeAssessment: CreatorScopeAssessment,
  plannerAttempts: number,
): PreparedEpisodePlan {
  return {
    plan,
    intentHash: plan.intentHash,
    planningTurnSkipped: plan.planningSource === "creator_scope",
    plannerAttempts,
    creatorScopeAssessment,
  };
}

async function terminalAttemptCount(options: ProviderEpisodePlannerOptions): Promise<number> {
  if (!existsSync(plannerAdmissionPath(options.root, options.intent.episodeId))) return 0;
  return (await readPlannerBudgetStatus(options.root, options.intent.episodeId)).terminalAttempts.length;
}

async function settleAcceptedPlannerAttempts(
  options: ProviderEpisodePlannerOptions,
  plannerRole: RoleConfig,
  now: () => Date,
): Promise<void> {
  const steps = (await readExecutionSteps(options.root, options.intent.episodeId))
    .filter((step) =>
      step.kind === "provider" &&
      (step.operation === "episode-planner/plan" || step.operation === "episode-planner/repair"));
  for (const step of steps) {
    const envelope = await readEnvelope(options.root, options.app.name, step.run_id);
    const pass = step.operation.endsWith("repair") ? "repair" : "plan";
    const events = plannerEventWriter(
      options,
      step.run_id,
      envelope.trace_id,
      pass,
      step.model ?? undefined,
      now,
    );
    const result = resultFromTerminal(step);
    if (envelope.status === "running") {
      await updateEnvelope(options.root, options.app.name, step.run_id, {
        usage: toEnvelopeUsage(result.usage),
        previews: { output: step.reason },
      });
      await finalizePlannerRun(options, result, step.run_id, events, now);
    }
    await settlePlannerTurn(options, plannerRole, result, step, events);
  }
}

function requirePlannerRole(roles: readonly RoleConfig[]): RoleConfig {
  const planner = roles.find((role) => role.name === "planner");
  if (planner === undefined) throw new Error("EpisodePlanner requires the configured planner role");
  return planner;
}

function assertOptions(options: ProviderEpisodePlannerOptions): void {
  if (options.intent.app !== options.app.name) {
    throw new Error(
      `episode intent app ${options.intent.app} does not match invocation ${options.app.name}`,
    );
  }
  if (options.intent.episodeId.length === 0) throw new Error("EpisodePlanner requires an episode id");
  if (options.policyVersion.trim().length === 0) throw new Error("EpisodePlanner policyVersion is required");
  if (
    options.contextBudgetBytes !== undefined &&
    (!Number.isSafeInteger(options.contextBudgetBytes) ||
      options.contextBudgetBytes <= 0 ||
      options.contextBudgetBytes > MAX_EPISODE_PLANNER_CONTEXT_BYTES)
  ) {
    throw new Error(
      `EpisodePlanner contextBudgetBytes must be a positive integer no greater than ${MAX_EPISODE_PLANNER_CONTEXT_BYTES}`,
    );
  }
  if (
    options.cancellationGraceMs !== undefined &&
    (!Number.isFinite(options.cancellationGraceMs) || options.cancellationGraceMs < 0)
  ) {
    throw new Error("EpisodePlanner cancellationGraceMs must be finite and non-negative");
  }
  if (episodeIntentHash(options.intent).length !== 64) throw new Error("invalid EpisodeIntent hash");
}

function assertPlannerPrompt(promptText: string): void {
  const promptBytes = Buffer.byteLength(promptText);
  if (promptBytes === 0 || promptBytes > MAX_EPISODE_PLANNER_PROMPT_BYTES) {
    throw new Error(
      `EpisodePlanner prompt must be 1-${MAX_EPISODE_PLANNER_PROMPT_BYTES} bytes; received ${promptBytes}`,
    );
  }
}

function uniqueSortedCapabilities(values: readonly RuntimeCapability[]): RuntimeCapability[] {
  return [...new Set(values)].sort();
}

function mergeProgress(
  previous: TurnProgress | undefined,
  next: TurnProgress,
): TurnProgress {
  return {
    ...(previous ?? {}),
    ...next,
    ...(next.usage === undefined ? {} : { usage: next.usage }),
    ...(next.session === undefined ? {} : { session: next.session }),
  };
}

async function runBoundedPlannerTurn(input: {
  runtime: Runtime;
  request: Omit<Parameters<Runtime["runTurn"]>[0], "signal">;
  hooks: TurnHooks;
  assignment: TurnAssignment;
  attempt: 1 | 2;
  activeTimeMs: number;
  cancellationGraceMs: number;
  parentSignal?: AbortSignal;
  latestProgress: () => TurnProgress | undefined;
}): Promise<TurnResult> {
  const controller = new AbortController();
  let stoppedBy: "timeout" | "cancelled" | undefined;
  const cancelFromParent = (): void => {
    stoppedBy = "cancelled";
    if (!controller.signal.aborted) controller.abort(input.parentSignal?.reason);
  };
  if (input.parentSignal?.aborted) cancelFromParent();
  else input.parentSignal?.addEventListener("abort", cancelFromParent, { once: true });

  const timeout = setTimeout(() => {
    stoppedBy = "timeout";
    if (!controller.signal.aborted) controller.abort("EpisodePlanner active-time ceiling reached");
  }, input.activeTimeMs);
  timeout.unref?.();
  if (controller.signal.aborted) {
    clearTimeout(timeout);
    input.parentSignal?.removeEventListener("abort", cancelFromParent);
    return stoppedPlannerResult(
      stoppedBy ?? "cancelled",
      input.assignment,
      input.attempt,
      input.latestProgress(),
    );
  }

  type Outcome = { result: TurnResult } | { error: unknown };
  const turn = Promise.resolve()
    .then(() => input.runtime.runTurn(
      { ...input.request, signal: controller.signal },
      input.hooks,
    ))
    .then(
      (result): Outcome => ({ result }),
      (error: unknown): Outcome => ({ error }),
    );
  const aborted = new Promise<{ aborted: true }>((resolve) => {
    controller.signal.addEventListener("abort", () => resolve({ aborted: true }), { once: true });
  });
  try {
    const first = await Promise.race([turn, aborted]);
    if ("result" in first) return first.result;
    if ("error" in first) throw first.error;

    const grace = await Promise.race([
      turn.then((outcome) => ({ outcome })),
      delay(input.cancellationGraceMs).then(() => ({ outcome: undefined })),
    ]);
    void turn.then(() => undefined);
    const settled = grace.outcome;
    if (settled !== undefined && "error" in settled) throw settled.error;
    return stoppedPlannerResult(
      stoppedBy ?? "cancelled",
      input.assignment,
      input.attempt,
      input.latestProgress(),
      settled?.result,
    );
  } finally {
    clearTimeout(timeout);
    input.parentSignal?.removeEventListener("abort", cancelFromParent);
  }
}

function stoppedPlannerResult(
  cause: "timeout" | "cancelled",
  assignment: TurnAssignment,
  attempt: number,
  progress: TurnProgress | undefined,
  settled?: TurnResult,
): TurnResult {
  const usage = settled?.usage ?? progress?.usage ?? unavailableUsage();
  const timedOut = cause === "timeout";
  return {
    status: timedOut ? "timed_out" : "cancelled",
    errorCode: timedOut
      ? "error_episode_planner_active_time_exceeded"
      : "error_episode_planner_cancelled",
    summary: timedOut
      ? "EpisodePlanner exceeded its admitted per-attempt active-time ceiling"
      : "EpisodePlanner was cancelled by its parent invocation",
    artifacts: settled?.artifacts ?? [],
    session: settled?.session ?? progress?.session ?? {
      runtime: assignment.harness,
      id: `${timedOut ? "timed-out" : "cancelled"}-episode-planner-${attempt}`,
    },
    usage: {
      ...usage,
      quality: usage.quality === "unavailable" ? "unavailable" : "partial",
    },
    escalations: settled?.escalations ?? [],
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function failedResult(
  error: unknown,
  assignment: TurnAssignment,
  attempt: number,
  progress: TurnProgress | undefined,
): TurnResult {
  const usage = progress?.usage ?? unavailableUsage();
  return {
    status: "failed",
    errorCode: "error_episode_planner_runtime_failed",
    summary: error instanceof Error ? error.message : String(error),
    artifacts: [],
    session: progress?.session ?? {
      runtime: assignment.harness,
      id: `failed-episode-planner-${attempt}`,
    },
    usage: {
      ...usage,
      quality: progress?.usage === undefined ? "unavailable" : "partial",
    },
    escalations: [],
  };
}

function unavailableUsage(): TurnUsage {
  return {
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
    subagentTurns: 0,
    wallClockMs: 0,
    quality: "unavailable",
  };
}

function toEnvelopeUsage(usage: TurnUsage, quality?: TurnUsage["quality"]): EnvelopeUsage {
  return {
    tokens_in: usage.tokensIn,
    tokens_out: usage.tokensOut,
    cost_usd: usage.costUsd,
    subagent_turns: usage.subagentTurns,
    quality: quality ?? usage.quality ?? (usage.costEstimated ? "estimated" : "complete"),
    ...(usage.costEstimated === true ? { cost_estimated: true } : {}),
    ...(usage.cacheReadTokens === undefined ? {} : { cache_read_tokens: usage.cacheReadTokens }),
    ...(usage.cacheCreationTokens === undefined
      ? {}
      : { cache_write_tokens: usage.cacheCreationTokens }),
  };
}

function sessionEvidence(session: TurnResult["session"]): SessionEvidence {
  if (session.runtime === "codex") {
    return {
      ...session,
      native_ref: `codex://threads/${encodeURIComponent(session.id)}`,
      transcript: "native_task",
      transcript_note: "Open the native Codex task for the full provider transcript.",
    };
  }
  if (session.runtime === "pi") {
    return {
      ...session,
      native_ref: session.id,
      transcript: "provider_session",
      transcript_note: "Provider session reference recorded; session.log is activity only.",
    };
  }
  return {
    ...session,
    transcript: "unavailable",
    transcript_note: "Claude SDK did not expose a full transcript reference; session.log is activity only.",
  };
}

function envelopeStatus(status: TurnResult["status"]): Exclude<EnvelopeStatus, "running"> {
  return status === "blocked_on_gate" ? "blocked" : status;
}
