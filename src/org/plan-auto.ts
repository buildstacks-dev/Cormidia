// Non-interactive product planning. EpisodePlanner first selects the smallest
// sufficient graph over a code-owned catalog of governed planning passes; the
// accepted EpisodePlan then executes one exact provider turn per planned step.
// The terminal provider output is still the existing schema-validated
// TicketPlan, and publication remains deterministic orchestrator work.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  efficiencyEpisodeDir,
  finalizeEpisode,
  fingerprint,
  readExecutionSteps,
  readRouteRecord,
  type AuthorizedPass,
  type ExecutionStepRecord,
} from "../loop/efficiency.js";
import {
  EPISODE_PLAN_EXECUTION_PIPELINE,
  planRouteLabel,
} from "../loop/episode-route.js";
import type {
  EpisodePlan,
  JsonValue,
  ProviderTurnStep,
  CreatorEpisodeScope,
} from "../loop/episode-plan.js";
import {
  assessCreatorScope,
  episodePlanHash,
  readCurrentEpisodePlan,
  readEpisodePlanVersion,
  stableHash,
} from "../loop/episode-plan.js";
import type {
  EpisodePlanExecutionResult,
  EpisodeStepCompletedOutcome,
  EpisodeStepExecutionContext,
  EpisodeStepFailedOutcome,
} from "../loop/episode-plan-executor.js";
import { GhCliOps, type GhIssue, type GhOps } from "../loop/github.js";
import { issueContentHash } from "../loop/issue-snapshot.js";
import { parseDependsOn } from "../loop/scheduling.js";
import { executePipeline } from "../loop/pipeline.js";
import {
  assertPlanningEpisodePlanValid,
  assertPlanningOperationCatalogMatches,
  planningPipelineForOperation,
  planningProviderOperation,
  PLANNING_PROVIDER_OPERATION_CATALOG,
  PLANNING_PROVIDER_OPERATIONS,
  type PlanningProviderOperationDefinition,
} from "../loop/planning-episode-plan.js";
import { loadPipelines, type PipelinesFile, type PipelineConfig } from "../loop/pipelines.js";
import {
  finalizePlanForPublication,
  isTicketBudgetOnlyRefusal,
  PLAN_SCHEMA,
  publishPlanProjection,
  validatePlan,
  type FinalPlanProjection,
  type PlanProvenance,
  type PlanningSourceTicketEvidence,
  type ProjectStage,
  type PublishedTicket,
  type TicketPlan,
} from "../loop/plan-tickets.js";
import {
  ratifyTicketBudgetCommand,
  recordRefusedDecomposition,
  refusedDecompositionPath,
} from "./ticket-budget-ratification.js";
import {
  readPublishedTicketsRecord,
  writePublishedTicketsRecord,
} from "../loop/plan-publication-record.js";
import {
  readPlannerAdmission,
  type PlannerAdmissionLimits,
  type PlannerAdmissionRecord,
} from "../loop/planner-admission.js";
import { writeLoopFileOnce } from "../loop/durable.js";
import { defaultGate } from "../runtime/gate.js";
import {
  fixedAssignmentFromRole,
  turnAssignmentsEqual,
} from "../runtime/assignment.js";
import {
  isRuntimeCapability,
  type RuntimeCapability,
} from "../runtime/capabilities.js";
import { getRuntime } from "../runtime/registry.js";
import {
  probeRuntimeReadiness,
  type RuntimeReadinessProbe,
} from "../runtime/readiness.js";
import { hashedFileStem, mintRunId, runPaths } from "../runtime/runlog/paths.js";
import type {
  ContextBundle,
  RoleConfig,
  Runtime,
  TurnAssignment,
  TurnHooks,
} from "../runtime/types.js";
import { ApprovalStore } from "./approvals.js";
import {
  normalizeAppExecution,
  runtimePolicyForApp,
  type AppEntry,
  type AppsFile,
} from "./apps.js";
import { resolveAppRoles } from "./app-execution-policy.js";
import { isBudgetBlocking, rollupBudgets, type BudgetRow } from "./budget.js";
import { assembleContext } from "./context.js";
import {
  readPersistedEpisodeIntent,
} from "./episode-planner/coordinator.js";
import {
  buildEpisodeIntent,
  createEpisodePlanningPolicy,
  type EpisodeSafetyFloorMapping,
} from "./episode-planner/policy.js";
import {
  createProviderEpisodePlanRevisionProposer,
} from "./episode-planner/runtime.js";
import { probeApprovedAssignmentReadiness } from "./episode-planner/assignment-readiness.js";
import { orchestrateEpisode } from "./episode-planner/orchestrator.js";
import { safetyFactsFromPlanningRequest } from "./episode-safety-facts.js";
import { composeGate } from "./gate-compose.js";
import {
  consumedPlanningSourceManifest,
  planningSourceManifestJson,
  renderPlanningSourceBrief,
  resolvePlanningSources,
  type PlanningSourceManifest,
  type PlanningSourceRequest,
  type ResolvedPlanningSources,
} from "./planning-inputs.js";
import type { PlanningDepthInput } from "./planning-depth.js";
import {
  discoverPlanningStageCheckout,
  persistedPlanningStageResolution,
  resolvePlanningStage,
  type PlanningStageResolution,
} from "./planning-stage.js";
import { loadRoles } from "./roles.js";
import { ensureManagedClone, withAppGitLock } from "./managed-checkout.js";
import {
  ROADMAP_DELIVERY_SCHEMA_VERSION,
  acceptBacklogSnapshot,
  acceptRoadmapPlan,
  readBacklogSnapshotAuthority,
  readCurrentRoadmapPlan,
  listActiveExecutionUnits,
  type RoadmapDeliveryUnit,
  type RoadmapIssueMove,
  type RoadmapWorkstream,
} from "./roadmap-delivery.js";

export const PRODUCT_PLANNING_EPISODE_POLICY_VERSION =
  "product-planning/episode-planner-v1" as const;

const AUTO_PLAN_SOURCE_BUDGET_BYTES = 128 * 1024;
const MAX_PRODUCT_PLANNING_PROVIDER_TURNS =
  Object.keys(PLANNING_PROVIDER_OPERATION_CATALOG).length;
const DEFAULT_PLANNER_ACTIVE_TIME_MS = 5 * 60_000;
const BASELINE_PROVIDER_CAPABILITIES = [
  "tool_gate",
  "cancellation",
  "session_resume",
] as const satisfies readonly RuntimeCapability[];

/** Structured product-planning facts describe the child delivery work being
 * decomposed; this episode itself only performs governed planning provider
 * turns. Keep those facts in EpisodeIntent and the planner brief without
 * pretending the planning turn executed a rollout, migration, or review gate.
 * Child ticket/release episodes derive their own execution floors again. */
const PRODUCT_PLANNING_SUBJECT_SAFETY_MAPPING = {
  gateKinds: {
    authentication: [],
    security: [],
    secrets: [],
    privacy: [],
    payments: [],
    user_data: [],
    data_migration: [],
    production_deployment: [],
    performance_sensitive: [],
  },
  approvalKinds: {
    production_deployment: [],
  },
} as const satisfies EpisodeSafetyFloorMapping;

export interface AutoPlanOptions {
  orgHome: string;
  stateHome: string;
  app: AppEntry;
  appsFile: AppsFile;
  /** The bounded product goal the TicketPlan serves. */
  goal: string;
  /** Exact operator-supplied source checkout. It is never reset. */
  workdir?: string;
  stage?: ProjectStage;
  /** False executes and validates the plan but performs no GitHub mutation. */
  publish?: boolean;
  gh?: GhOps;
  /** Compatibility factory; assignment-aware execution supplies a tuple view. */
  runtimeFor?: (role: RoleConfig) => Runtime;
  now?: () => Date;
  signal?: AbortSignal;
  parentTaskId?: string;
  /** Compatibility/request facts only. They no longer select workflow shape. */
  planning?: Omit<PlanningDepthInput, "goal" | "stage">;
  sources?: readonly PlanningSourceRequest[];
  /** The only explicit zero-planner path. No scope is inferred from goal text. */
  creatorScope?: CreatorEpisodeScope;
  /** A caller that explicitly promises execution readiness must fail closed
   * instead of falling back to EpisodePlanner when the supplied scope is
   * incomplete. The CLI sets this only with --execution-ready. */
  requireExecutionReadyCreatorScope?: boolean;
  /** Stable identity for an explicit resume. Omission creates a new episode. */
  episodeId?: string;
  /** Test/embedded seam; production loads prompts/episode/plan.md. */
  episodePlannerPromptText?: string;
  plannerLimits?: PlannerAdmissionLimits;
  assignmentReadinessProbe?: RuntimeReadinessProbe;
  assignmentReadinessTimeoutMs?: number;
  /** Fault-injection checkpoint after terminal provider evidence. */
  afterPlanningProviderTurnFinalized?: (input: {
    plan: EpisodePlan;
    step: ProviderTurnStep;
    record: ExecutionStepRecord;
  }) => void | Promise<void>;
}

export interface AutoPlanResult {
  status: "completed" | "failed" | "cancelled" | "timed_out";
  summary: string;
  plan?: TicketPlan;
  problems?: string[];
  published?: PublishedTicket[];
  planProjection?: FinalPlanProjection;
  planningSources?: PlanningSourceManifest;
  episodeId?: string;
  episodePlan?: EpisodePlan;
  planningTurnSkipped?: boolean;
  planningExecution?: AutoPlanningExecutionResult;
  /** Exact explicit/inferred/persisted stage decision used by this episode. */
  stageResolution?: PlanningStageResolution;
  /** Present when the ONLY refusal was the stage ticket budget. The
   * decomposition the planner already paid for is preserved verbatim, so
   * ratification resumes from it instead of buying a different plan
   * (ENH-011). */
  refusedDecomposition?: RefusedDecompositionSummary;
}

export type AutoPlanningExecutionResult =
  | EpisodePlanExecutionResult
  | (Omit<EpisodePlanExecutionResult, "status" | "reasonCode"> & {
      status: "refused_ticket_budget";
      reasonCode: "refused_ticket_budget";
    });

export interface RefusedDecompositionSummary {
  decompositionId: string;
  stage: ProjectStage;
  stageTicketBudget: number;
  ticketCount: number;
  path: string;
  /** The exact ratification command — the remedy the refusal names. */
  ratifyCommand: string;
}

export async function runAutoPlan(options: AutoPlanOptions): Promise<AutoPlanResult> {
  const clock = options.now ?? (() => new Date());
  const startedAt = clock();

  const rolesFile = await loadRoles(join(options.orgHome, "roles.yaml"));
  const configuredRoles = resolveAppRoles(rolesFile.roles, runtimePolicyForApp(options.app));
  const planner = configuredRoles.find((role) => role.name === "planner");
  if (planner === undefined) return { status: "failed", summary: "roles.yaml has no planner role" };
  const pipelines = await loadPipelines(join(options.orgHome, "pipelines.yaml"), {
    roleNames: configuredRoles.map((role) => role.name),
    promptsDir: join(options.orgHome, "prompts"),
  });
  assertPlanningOperationCatalogMatches(pipelines);

  const budget = (await rollupBudgets(options.stateHome, options.appsFile, startedAt))
    .find((row) => row.app === options.app.name);
  if (budget === undefined) {
    return { status: "failed", summary: `no app budget exists for ${options.app.name}` };
  }
  if (isBudgetBlocking(budget.status)) {
    return {
      status: "failed",
      summary: `product planning is blocked by app budget status ${budget.status}`,
    };
  }
  const remainingBudgetUsd = Math.max(0, budget.budgetUsd - budget.spentUsd);
  if (remainingBudgetUsd <= 0) {
    return { status: "failed", summary: "product planning has no remaining app budget" };
  }

  const episodeId = options.episodeId ??
    `trace:${options.app.name}:product-plan:${startedAt.getTime()}`;
  const traceId = `plan-${options.app.name}-${fingerprint(episodeId).slice(0, 12)}`;
  const existingIntent = await readPersistedEpisodeIntent(options.stateHome, episodeId);
  if (existingIntent !== undefined && !isProjectStage(existingIntent.appStage)) {
    throw new Error(
      `product-planning episode ${episodeId} has unsupported persisted stage ` +
        `"${existingIntent.appStage}"`,
    );
  }
  const stageCheckout = discoverPlanningStageCheckout({
    app: options.app,
    orgHome: options.orgHome,
    stateHome: options.stateHome,
    ...(options.workdir === undefined ? {} : { explicitWorkdir: options.workdir }),
  });
  // Resolve before live clone synchronization. A dry-run and the immediately
  // following live command therefore see the same already-local evidence (or
  // the same explicit bootstrap fallback) instead of silently changing stage
  // merely because live execution created the managed clone.
  const stageResolution = existingIntent === undefined
    ? resolvePlanningStage({
        ...(options.stage === undefined ? {} : { requestedStage: options.stage }),
        checkout: stageCheckout.checkout,
        checkoutSource: stageCheckout.source,
      })
    : persistedPlanningStageResolution({
        stage: existingIntent.appStage as ProjectStage,
        stored: existingIntent.repositoryFacts["planningStageResolution"],
      });
  const stage = stageResolution.stage;
  const snapshot = await withAppGitLock(options.stateHome, options.app.name, async () => {
    const source = options.workdir !== undefined
      ? validateSourceCheckout(options.workdir)
      : (await ensureManagedClone(options.app, options.stateHome)).path;
    return createOrReusePlanningSnapshot(
      source,
      join(options.stateHome, "worktrees", options.app.name, traceId),
    );
  });
  const localRepo = snapshot.path;
  const resolvedSources = resolveAutoPlanSources(options, snapshot, traceId);
  const consumedSources = resolvedSources === undefined
    ? undefined
    : consumedPlanningSourceManifest(resolvedSources.manifest);
  const priorAdmission = await readPlannerAdmission(options.stateHome, episodeId);
  const limits = options.plannerLimits ??
    (priorAdmission === undefined
      ? defaultPlannerLimits(planner, remainingBudgetUsd)
      : limitsFromAdmission(priorAdmission));
  const explicitExecutionReadyCreatorPath =
    options.requireExecutionReadyCreatorScope === true &&
    options.creatorScope?.planningDisposition === "execution_ready";
  const deliveryBudgetUsd = existingIntent?.hardBudget.maxEquivalentCostUsd ??
    Math.max(
      0,
      remainingBudgetUsd -
        (explicitExecutionReadyCreatorPath ? 0 : limits.aggregate.equivalentCostUsd),
    );
  if (deliveryBudgetUsd <= 0) {
    return {
      status: "failed",
      summary: explicitExecutionReadyCreatorPath
        ? "remaining app budget cannot cover the creator-scoped planning workflow"
        : "remaining app budget cannot cover both the bounded EpisodePlanner admission " +
          "and one delivery-planning turn",
      episodeId,
      stageResolution,
    };
  }

  const legacyTriggerIdentity = {
    app: options.app.name,
    goal: options.goal,
    stage,
    planning: jsonValue(options.planning ?? {}, "planning request facts"),
    sourceManifestSha256: resolvedSources?.manifest.manifest_sha256 ?? null,
    creatorScope: options.creatorScope ?? null,
    catalog: planningCatalogForIntent(),
  };
  const legacyTriggerPayloadHash = stableHash(legacyTriggerIdentity);
  const triggerPayloadHash = stableHash({
    ...legacyTriggerIdentity,
    stageResolution,
  });
  if (
    existingIntent !== undefined &&
    (existingIntent.app !== options.app.name ||
      existingIntent.goal !== options.goal ||
      (options.stage !== undefined && options.stage !== stage) ||
      (existingIntent.trigger.payloadHash !== triggerPayloadHash &&
        existingIntent.trigger.payloadHash !== legacyTriggerPayloadHash))
  ) {
    throw new Error(`product-planning episode ${episodeId} resume facts differ from persisted intent`);
  }

  const assignmentReadinessProbe = options.assignmentReadinessProbe ?? probeRuntimeReadiness;
  const readiness = existingIntent === undefined &&
      normalizeAppExecution(options.app.execution).assignmentMode === "adaptive"
    ? await probeApprovedAssignmentReadiness({
        app: options.app,
        roles: configuredRoles,
        probe: assignmentReadinessProbe,
        ...(options.assignmentReadinessTimeoutMs === undefined
          ? {}
          : { timeoutMs: options.assignmentReadinessTimeoutMs }),
      })
    : undefined;
  if (readiness !== undefined && options.creatorScope === undefined) {
    const boot = readiness.resultFor(fixedAssignmentFromRole(planner));
    if (boot?.status !== "ready") {
      return {
        status: "failed",
        summary:
          `EpisodePlanner boot assignment is unavailable: ${boot?.status ?? "missing readiness evidence"}` +
          (boot?.detail === undefined ? "" : ` — ${boot.detail}`),
        episodeId,
        stageResolution,
      };
    }
  }
  const episodeFacts = {
    episodeId,
    trigger: {
      kind: "manual_product_planning",
      sourceRef: options.parentTaskId ?? `cli:plan:${options.app.name}`,
      payloadHash: triggerPayloadHash,
    },
    goal: options.goal,
    lifecycle: options.planning?.workLifecycle ?? "bounded-goal",
    appStage: stage,
    repositoryFacts: repositoryFacts(
      snapshot,
      stageResolution,
      stageCheckout.checkout,
    ),
    requestedConstraints: {
      workflowAuthority: "accepted_episode_plan_only",
      publicationAuthority: "deterministic_orchestrator",
      ticketPlanStage: stage,
      ticketPlanOutput: { id: "ticket-plan", kind: "TicketPlan", required: true },
      planningOperationCatalog: planningCatalogForIntent(),
      requestedPlanningFacts: jsonValue(options.planning ?? {}, "planning request facts"),
      ...(resolvedSources === undefined
        ? {}
        : {
            planningSources: jsonValue({
              manifest: resolvedSources.manifest,
              documents: resolvedSources.documents,
            }, "planning sources"),
          }),
    },
    hardBudget: {
      maxProviderTurns: MAX_PRODUCT_PLANNING_PROVIDER_TURNS,
      maxEquivalentCostUsd: deliveryBudgetUsd,
      maxMechanicalOverheadUsd: 0,
      maxActiveTimeMs: 30 * 60_000,
      maxHumanDecisions: 0,
    },
    requiredSafetyFacts: safetyFactsFromPlanningRequest(options.planning),
    responsibilityByRole: Object.fromEntries(configuredRoles.map((role) => [
      role.name,
      role.name === "planner"
        ? "Select and execute the smallest sufficient governed product-planning workflow"
        : `Configured ${role.name} responsibility; unavailable to product-planning operations`,
    ])),
    ...(options.creatorScope === undefined ? {} : { creatorScope: options.creatorScope }),
  };
  const intent = existingIntent ?? buildEpisodeIntent({
    ...episodeFacts,
    app: options.app,
    roles: configuredRoles,
    ...(readiness === undefined ? {} : { assignmentAvailable: readiness.available }),
  });

  if (options.requireExecutionReadyCreatorScope) {
    const policy = createEpisodePlanningPolicy(options.app, {
      intent,
      roles: configuredRoles,
      assignmentAuthority: existingIntent === undefined ? "current_config" : "persisted_intent",
      safetyFloorMapping: PRODUCT_PLANNING_SUBJECT_SAFETY_MAPPING,
    });
    const assessment = assessCreatorScope(intent.creatorScope, policy.creatorScope);
    if (!assessment.executionReady) {
      return {
        status: "failed",
        summary:
          "explicit execution-ready creator scope is incomplete or invalid; " +
          "EpisodePlanner was not invoked",
        problems: assessment.issues.map((entry) => `${entry.code}: ${entry.message}`),
        episodeId,
        stageResolution,
        ...(resolvedSources === undefined ? {} : { planningSources: resolvedSources.manifest }),
      };
    }
    try {
      assertPlanningEpisodePlanValid({ steps: assessment.resolvedSteps! }, stage);
    } catch (error) {
      return failedResult(error, {
        episodeId,
        stageResolution,
        ...(resolvedSources === undefined ? {} : { planningSources: resolvedSources.manifest }),
      });
    }
  }

  const store = new ApprovalStore(options.stateHome);
  const hooks: TurnHooks = {
    gate: composeGate(defaultGate, store, {
      app: options.app.name,
      role: planner.name,
      appRepo: options.app.repo,
      ...(options.app.networkAllowlist !== undefined
        ? { networkAllowlist: options.app.networkAllowlist }
        : {}),
      turnId: traceId,
      workdir: localRepo,
      now: clock,
    }),
  };
  const context = (
    await assembleContext({
      orgHome: options.orgHome,
      appWorkdir: localRepo,
      app: options.app.name,
      role: planner,
      taskText:
        `${stage} EpisodePlanner product plan for ${options.app.name}: ${options.goal}` +
        (resolvedSources === undefined
          ? ""
          : `; planning sources ${resolvedSources.manifest.manifest_sha256}`),
    })
  ).bundle;
  const promptText = options.episodePlannerPromptText ??
    (options.creatorScope?.planningDisposition === "execution_ready"
      ? ""
      : await readEpisodePlannerPrompt(options.orgHome));
  const runtimeForAssignment = assignmentRuntimeFactory(options);
  const baseBrief = await productPlanningBrief({
    options,
    snapshot,
    stage,
    stageResolution,
    stageEvidenceCheckout: stageCheckout.checkout,
    budget,
  });
  const sourceBrief = resolvedSources === undefined
    ? ""
    : renderPlanningSourceBrief(resolvedSources.manifest, resolvedSources.documents);

  let prepared: Awaited<ReturnType<typeof orchestrateEpisode>>["prepared"];
  let execution: EpisodePlanExecutionResult;
  try {
    const orchestrated = await orchestrateEpisode({
      mode: "execute",
      root: options.stateHome,
      app: options.app,
      roles: configuredRoles,
      facts: episodeFacts,
      assignmentReadinessProbe,
      ...(options.assignmentReadinessTimeoutMs === undefined
        ? {}
        : { assignmentReadinessTimeoutMs: options.assignmentReadinessTimeoutMs }),
      planner: {
        promptText,
        context,
        workdir: localRepo,
        hooks,
        runtimeForAssignment,
        policyVersion: PRODUCT_PLANNING_EPISODE_POLICY_VERSION,
        providerOperations: PLANNING_PROVIDER_OPERATIONS,
        limits,
        safetyFloorMapping: PRODUCT_PLANNING_SUBJECT_SAFETY_MAPPING,
        validateAcceptedPlan: (plan) => assertPlanningEpisodePlanValid(plan, stage),
        traceId,
        ...(options.parentTaskId === undefined ? {} : { parentTaskId: options.parentTaskId }),
        ...(options.signal === undefined ? {} : { signal: options.signal }),
        telemetry: { orgDir: options.stateHome, trigger: "manual" },
        now: clock,
      },
      execution: {
        workdir: localRepo,
        hooks,
        runtimeForAssignment,
        proposeRevision: createProviderEpisodePlanRevisionProposer({
          root: options.stateHome,
          app: options.app,
          roles: configuredRoles,
          promptText,
          context,
          workdir: localRepo,
          hooks,
          runtimeForAssignment,
          policyVersion: PRODUCT_PLANNING_EPISODE_POLICY_VERSION,
          providerOperations: PLANNING_PROVIDER_OPERATIONS,
          limits,
          safetyFloorMapping: PRODUCT_PLANNING_SUBJECT_SAFETY_MAPPING,
          validateAcceptedPlan: (plan) => assertPlanningEpisodePlanValid(plan, stage),
          traceId: `${traceId}:revision`,
          ...(options.parentTaskId === undefined ? {} : { parentTaskId: options.parentTaskId }),
          ...(options.signal === undefined ? {} : { signal: options.signal }),
          telemetry: { orgDir: options.stateHome, trigger: "manual" },
          now: clock,
        }),
        contextForProviderStep: () => context,
        provider: async (step, stepExecution) => {
          const executionPlan = await resolvePlanningExecutionPlan(
            options.stateHome,
            episodeId,
            stepExecution,
          );
          return executePlanningProviderStep({
            options,
            plan: executionPlan,
            step,
            execution: stepExecution,
            planner,
            pipelines,
            workdir: localRepo,
            context,
            hooks,
            runtimeForAssignment,
            baseBrief,
            sourceBrief,
            ...(resolvedSources === undefined ? {} : { resolvedSources }),
            ...(consumedSources === undefined ? {} : { consumedSources }),
            stage,
            clock,
          });
        },
        mechanical: async (step) => ({
          status: "failed",
          reasonCode: "error_product_planning_mechanical_step_unsupported",
          summary: `planning EpisodePlan unexpectedly contained mechanical step ${step.id}`,
        }),
        approval: async (step) => ({
          status: "failed",
          reasonCode: "error_product_planning_approval_step_unsupported",
          summary: `planning EpisodePlan unexpectedly contained approval step ${step.id}`,
        }),
        telemetry: { orgDir: options.stateHome, trigger: "manual" },
        ...(options.parentTaskId === undefined ? {} : { parentTaskId: options.parentTaskId }),
        ...(options.signal === undefined ? {} : { signal: options.signal }),
        now: clock,
      },
    });
    prepared = orchestrated.prepared;
    if (orchestrated.execution === null) {
      throw new Error("shared episode orchestrator returned no delivery result in execute mode");
    }
    execution = orchestrated.execution;
  } catch (error) {
    const persistedPlan = await readCurrentEpisodePlan(options.stateHome, episodeId);
    return failedResult(error, {
      episodeId,
      stageResolution,
      ...(persistedPlan === undefined
        ? {}
        : {
            episodePlan: persistedPlan,
            planningTurnSkipped: persistedPlan.planningSource === "creator_scope",
          }),
      ...(resolvedSources === undefined ? {} : { planningSources: resolvedSources.manifest }),
    });
  }

  const executedPlan = await resolvePlanningExecutionPlan(
    options.stateHome,
    episodeId,
    execution,
  );
  let planningExecution: AutoPlanningExecutionResult = execution;
  const resultBase: Pick<AutoPlanResult,
    "episodeId" | "episodePlan" | "planningTurnSkipped" | "planningExecution" |
      "planningSources" | "stageResolution"
  > = {
    episodeId,
    stageResolution,
    episodePlan: executedPlan,
    planningTurnSkipped: prepared.planningTurnSkipped,
    planningExecution,
    ...(resolvedSources === undefined
      ? {}
      : {
          planningSources: execution.status === "completed"
            ? consumedSources!
            : resolvedSources.manifest,
        }),
  };
  if (execution.status !== "completed") {
    const terminal = terminalProviderStep(executedPlan);
    const output = terminal === undefined
      ? undefined
      : await readPlanningStepOutput(options.stateHome, executedPlan, terminal.id);
    // A budget-only refusal used to throw away the decomposition the planner
    // was already paid for, so ratifying meant buying a different plan. Keep
    // it, and hand the operator the exact command that admits it (ENH-011).
    const refusedDecomposition = await preserveRefusedDecomposition({
      options,
      stage,
      output,
      traceId,
      episodeId,
      consumedSources,
      now: clock,
    });
    const refusedTicketBudget =
      output?.ticketPlan !== undefined && isTicketBudgetOnlyRefusal(output.ticketPlan);
    if (refusedTicketBudget) {
      const reason = output.problems.join("; ");
      planningExecution = {
        ...execution,
        status: "refused_ticket_budget",
        nextStepId: null,
        reasonCode: "refused_ticket_budget",
        summary: reason,
      };
      resultBase.planningExecution = planningExecution;
      await finalizeEpisode({
        root: options.stateHome,
        episodeId,
        status: "failed",
        reason: `refused_ticket_budget: ${reason}`,
        now: clock(),
      });
    }
    return {
      status: output?.providerStatus === "cancelled"
        ? "cancelled"
        : output?.providerStatus === "timed_out"
          ? "timed_out"
          : "failed",
      summary: planningExecution.summary ??
        `accepted product-planning workflow stopped at ${execution.nextStepId ?? "an unknown step"}`,
      ...(output?.problems.length ? { problems: output.problems } : {}),
      ...(refusedDecomposition === undefined ? {} : { refusedDecomposition }),
      ...resultBase,
    };
  }

  const terminal = terminalProviderStep(executedPlan);
  if (terminal === undefined) {
    return {
      status: "failed",
      summary: "accepted product-planning workflow has no terminal provider step",
      ...resultBase,
    };
  }
  const output = await readPlanningStepOutput(options.stateHome, executedPlan, terminal.id);
  if (output === undefined || output.status !== "completed" || output.ticketPlan === undefined) {
    return {
      status: "failed",
      summary: "terminal planning step has no durable validated TicketPlan output",
      ...(output?.problems.length ? { problems: output.problems } : {}),
      ...resultBase,
    };
  }
  const planProjection = finalizePlanForPublication(output.ticketPlan);

  if (options.publish === false) {
    return {
      status: "completed",
      summary:
        `EpisodePlan v${prepared.plan.version} completed ${execution.completedStepIds.length} ` +
        "planned provider step(s); TicketPlan validated; publication skipped (--no-publish)",
      plan: planProjection.plan,
      planProjection,
      ...resultBase,
    };
  }

  const provenance: PlanProvenance = {
    episodeId,
    runId: output.runId,
    traceId,
  };
  const priorPublication = await readPublishedTicketsRecord(
    options.stateHome,
    options.app.name,
    output.runId,
  );
  let published: PublishedTicket[];
  let recordNote = "";
  const publicationGh = options.gh ?? new GhCliOps(options.app.repo);
  if (priorPublication !== undefined) {
    if (
      priorPublication.episode_id !== provenance.episodeId ||
      priorPublication.trace_id !== provenance.traceId ||
      priorPublication.run_id !== provenance.runId
    ) {
      throw new Error("published TicketPlan provenance differs from the resumed planning episode");
    }
    published = priorPublication.published.map((ticket) => ({
      index: ticket.index,
      issueNumber: ticket.issue_number,
      title: ticket.title,
      ready: ticket.ready,
      labels: [...ticket.labels],
    }));
  } else {
    ({ published } = await publishPlanProjection(
      publicationGh,
      planProjection,
      consumedSources === undefined ? undefined : planningSourceTicketEvidence(consumedSources),
      provenance,
    ));
    // Ticket bodies remain the permanent half of provenance. A local record
    // failure must not report remote publication as failed and invite a blind
    // duplicate retry.
    try {
      await writePublishedTicketsRecord(
        options.stateHome,
        options.app.name,
        provenance,
        published,
        clock(),
      );
    } catch (error) {
      recordNote = `; published-tickets record write failed: ${(error as Error).message}`;
    }
  }
  await persistPublishedRoadmap({
    stateHome: options.stateHome,
    app: options.app,
    gh: publicationGh,
    plan: planProjection.plan,
    published,
    now: clock(),
  });
  return {
    status: "completed",
    summary:
      `EpisodePlan v${executedPlan.version} published ${published.length} ticket(s): ` +
      published.map((ticket) => `#${ticket.issueNumber}${ticket.ready ? " (ready)" : ""}`).join(", ") +
      recordNote,
    plan: planProjection.plan,
    planProjection,
    published,
    ...resultBase,
  };
}

/** Production projection from the Planner's structured TicketPlan into an
 * initial or predecessor-bound successor RoadmapPlan. Validation design is separate:
 * the roadmap frontier is only a planning candidate; the Builder consumer
 * still requires exact validation-contract and readiness authorities, so the
 * legacy op:ready labels cannot authorize execution by themselves. */
export async function persistPublishedRoadmap(input: {
  stateHome: string;
  app: AppEntry;
  gh: GhOps;
  plan: TicketPlan;
  published: PublishedTicket[];
  now: Date;
  /** Frozen complete-open-backlog read used by scheduled Planner publication.
   * Omitted callers retain the ordinary GitHub read. */
  issues?: readonly GhIssue[];
  /** The exact Planner-authorized candidate set. Labels remain necessary but
   * are not sufficient when this set is supplied. */
  readyIssueNumbers?: readonly number[];
  source?: string;
}): Promise<void> {
  const current = await readCurrentRoadmapPlan(input.stateHome, input.app.name);
  if (current !== undefined) {
    const active = await listActiveExecutionUnits(input.stateHome, input.app.name);
    if (active.length > 0) {
      throw new Error(
        `RoadmapPlan revision refused while active execution units exist: ${active.map((entry) => entry.unit.unitId).join(", ")}`,
      );
    }
  }
  const indexes = input.published.map((ticket) => ticket.index).sort((a, b) => a - b);
  if (
    input.published.length !== input.plan.tickets.length ||
    indexes.some((index, expected) => index !== expected) ||
    new Set(input.published.map((ticket) => ticket.issueNumber)).size !== input.published.length
  ) {
    throw new Error("published ticket projection does not exactly account for the Planner TicketPlan");
  }
  const limit = 10_001;
  const issues = input.issues === undefined
    ? await input.gh.listIssues({ state: "open", limit })
    : structuredClone(input.issues);
  if (issues.length >= limit) {
    throw new Error(`open backlog reached the ${limit - 1} issue completeness bound`);
  }
  const observedIssueNumbers = new Set(issues.map((issue) => issue.number));
  const capturedAt = input.now.toISOString();
  const snapshotIssues = issues.map((issue) => ({
    issueNumber: issue.number,
    contentHash: issueContentHash(issue),
    lifecycle: "open" as const,
    routing: issue.labels.includes("routing:human-only") ? "human_only" as const : "automated" as const,
    observedLabels: [...issue.labels],
    // An absent open dependency is already closed/satisfied. BacklogSnapshot
    // is complete over the OPEN backlog and therefore cannot name a member it
    // did not observe.
    dependencyIssues: parseDependsOn(issue.body).filter((number) => observedIssueNumbers.has(number)),
  }));
  if (current !== undefined) {
    const priorSnapshot = await readBacklogSnapshotAuthority(
      input.stateHome,
      input.app.name,
      current.value.backlogSnapshotRef,
    );
    const currentlyPlannedIssues = new Set(current.value.deliveryUnits
      .filter((unit) => unit.workstreamId !== "backlog-unplanned")
      .flatMap((unit) => unit.issueNumbers));
    if (
      input.published.every((ticket) => currentlyPlannedIssues.has(ticket.issueNumber)) &&
      stableHash(priorSnapshot.value.issues) === stableHash(snapshotIssues)
    ) return;
  }
  const snapshotId = `planner-${stableHash({ app: input.app.name, capturedAt, issues }).slice(0, 24)}`;
  const snapshot = await acceptBacklogSnapshot({
    root: input.stateHome,
    snapshot: {
      schemaVersion: ROADMAP_DELIVERY_SCHEMA_VERSION,
      snapshotId,
      version: 1,
      app: input.app.name,
      source: input.source ?? "github:complete-open-backlog-after-planner-publication",
      capturedAt,
      completeness: "complete",
      pagination: { pagesObserved: Math.max(1, Math.ceil(issues.length / 100)), hasNextPage: false, unavailablePages: [] },
      issues: snapshotIssues,
    },
  });
  const issueByNumber = new Map(issues.map((issue) => [issue.number, issue]));
  const openIssueNumbers = new Set(issueByNumber.keys());
  const allPlanTicketsByNumber = new Map(input.published.map((ticket) => [
    ticket.issueNumber,
    input.plan.tickets[ticket.index]!,
  ]));
  const preservedUnits: RoadmapDeliveryUnit[] = [];
  const displacedUnplanned: Array<{ issueNumber: number; fromUnitId: string }> = [];
  for (const prior of current?.value.deliveryUnits ?? []) {
    const openMembers = prior.issueNumbers.filter((number) => openIssueNumbers.has(number));
    if (openMembers.length > 0 && openMembers.length !== prior.issueNumbers.length) {
      throw new Error(
        `RoadmapPlan revision refused subset closure for ${prior.unitId}: ` +
          `${openMembers.length}/${prior.issueNumbers.length} members remain open`,
      );
    }
    if (openMembers.length === 0) continue;
    if (prior.workstreamId === "backlog-unplanned") {
      const newlyPlanned = openMembers.filter((number) => allPlanTicketsByNumber.has(number));
      if (newlyPlanned.length > 0) {
        displacedUnplanned.push(...newlyPlanned.map((issueNumber) => ({
          issueNumber,
          fromUnitId: prior.unitId,
        })));
        const stillUnplanned = openMembers.filter((number) => !allPlanTicketsByNumber.has(number));
        if (stillUnplanned.length > 0) {
          preservedUnits.push({ ...structuredClone(prior), issueNumbers: stillUnplanned });
        }
        continue;
      }
    }
    preservedUnits.push(structuredClone(prior));
  }
  const priorUnitByIssue = new Map(preservedUnits.flatMap((unit) =>
    unit.issueNumbers.map((number) => [number, unit.unitId] as const)));
  const planTicketByNumber = new Map([...allPlanTicketsByNumber]
    .filter(([number]) => !priorUnitByIssue.has(number)));
  const grouped = new Map<string, number[]>();
  for (const [number, ticket] of planTicketByNumber) {
    const members = grouped.get(ticket.executionGroup) ?? [];
    members.push(number);
    grouped.set(ticket.executionGroup, members);
  }
  const usedPriorWorkstreams = new Set(preservedUnits.map((unit) => unit.workstreamId));
  const workstreams: RoadmapWorkstream[] = (current?.value.workstreams ?? [])
    .filter((workstream) => usedPriorWorkstreams.has(workstream.workstreamId))
    .map((workstream) => structuredClone(workstream));
  let nextPriority = Math.max(0, ...workstreams.map((workstream) => workstream.priority)) + 1;
  for (const group of [...grouped.keys()].sort()) {
    const workstreamId = `planner-${stableHash(group).slice(0, 20)}`;
    if (!workstreams.some((workstream) => workstream.workstreamId === workstreamId)) {
      workstreams.push({
        workstreamId,
        outcome: `Deliver Planner execution group ${group}`,
        priority: nextPriority++,
      });
    }
  }
  const priorUnitIdByMembership = new Map((current?.value.deliveryUnits ?? []).map((unit) => [
    stableHash([...unit.issueNumbers].sort((a, b) => a - b)),
    unit.unitId,
  ]));
  const groupUnitIds = new Map([...grouped.keys()].map((group) => {
    const members = grouped.get(group)!;
    const stablePriorId = priorUnitIdByMembership.get(stableHash([...members].sort((a, b) => a - b)));
    return [group, stablePriorId ?? `unit-${stableHash({ group, members }).slice(0, 24)}`];
  }));
  const unitIdByIssue = new Map(priorUnitByIssue);
  for (const [group, members] of grouped) {
    for (const number of members) unitIdByIssue.set(number, groupUnitIds.get(group)!);
  }
  const deliveryUnits: RoadmapDeliveryUnit[] = preservedUnits.map((unit) => structuredClone(unit));
  for (const [group, members] of [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const dependencies = new Set<string>();
      for (const number of members) {
        for (const dependency of planTicketByNumber.get(number)!.dependsOn) {
          const dependencyPublished = input.published.find((ticket) => ticket.index === dependency);
          const dependencyUnit = dependencyPublished === undefined
            ? undefined
            : unitIdByIssue.get(dependencyPublished.issueNumber);
          if (dependencyUnit !== undefined && dependencyUnit !== groupUnitIds.get(group)) {
            dependencies.add(dependencyUnit);
          }
        }
      }
      const workstreamId = `planner-${stableHash(group).slice(0, 20)}`;
      deliveryUnits.push({
        unitId: groupUnitIds.get(group)!,
        workstreamId,
        issueNumbers: [...members].sort((a, b) => a - b),
        dependsOn: [...dependencies].sort(),
        priority: workstreams.find((workstream) => workstream.workstreamId === workstreamId)!.priority,
        objective: workstreams.find((workstream) => workstream.workstreamId === workstreamId)!.outcome,
      });
  }
  const accounted = new Set(deliveryUnits.flatMap((unit) => unit.issueNumbers));
  const legacy = issues.filter((issue) => !accounted.has(issue.number));
  if (legacy.length > 0) {
    const workstreamId = "backlog-unplanned";
    if (!workstreams.some((workstream) => workstream.workstreamId === workstreamId)) {
      workstreams.push({
        workstreamId,
        outcome: "Explicitly parked pre-existing backlog awaiting a later RoadmapPlan revision",
        priority: 999_999,
      });
    }
    for (const issue of legacy.sort((a, b) => a.number - b.number)) {
      deliveryUnits.push({
        unitId: `unplanned-${issue.number}`,
        workstreamId,
        issueNumbers: [issue.number],
        dependsOn: [],
        priority: 999_999,
        objective: `Unplanned backlog projection for #${issue.number}; not executable authority`,
      });
    }
  }
  const validUnitIds = new Set(deliveryUnits.map((unit) => unit.unitId));
  for (const unit of deliveryUnits) {
    unit.dependsOn = unit.dependsOn.filter((dependency) => validUnitIds.has(dependency));
  }
  const completedUnitIds = (current?.value.completedUnitIds ?? [])
    .filter((unitId) => validUnitIds.has(unitId));
  const newMoves: RoadmapIssueMove[] = displacedUnplanned.flatMap((move) => {
    const toUnitId = unitIdByIssue.get(move.issueNumber);
    if (toUnitId === undefined) {
      throw new Error(`RoadmapPlan revision lost newly planned issue #${move.issueNumber}`);
    }
    if (toUnitId === move.fromUnitId) return [];
    return [{
      issueNumber: move.issueNumber,
      fromUnitId: move.fromUnitId,
      toUnitId,
      reason: "scheduled Planner assigned previously unplanned backlog",
      movedAt: capturedAt,
    }];
  });
  const completed = new Set(completedUnitIds);
  const authorizedReady = input.readyIssueNumbers === undefined
    ? undefined
    : new Set(input.readyIssueNumbers);
  const wipLimit = current?.value.wipLimit ?? Math.max(1, Math.min(8, workstreams.length));
  const readyFrontier = deliveryUnits
    .filter((unit) =>
      !completed.has(unit.unitId) &&
      unit.workstreamId !== "backlog-unplanned" &&
      unit.dependsOn.every((dependency) => completed.has(dependency)) &&
      unit.issueNumbers.every((number) => {
        const issue = issueByNumber.get(number)!;
        return issue.labels.includes("op:ready") &&
          (authorizedReady === undefined || authorizedReady.has(number)) &&
          !issue.labels.includes("routing:human-only") && !issue.labels.includes("manual-review");
      }))
    .sort((left, right) => left.priority - right.priority || left.unitId.localeCompare(right.unitId))
    .slice(0, wipLimit)
    .map((unit) => unit.unitId);
  await acceptRoadmapPlan({
    root: input.stateHome,
    plan: {
      schemaVersion: ROADMAP_DELIVERY_SCHEMA_VERSION,
      planId: current?.value.planId ?? `roadmap-${snapshotId}`,
      version: (current?.value.version ?? 0) + 1,
      app: input.app.name,
      backlogSnapshotRef: snapshot.ref,
      predecessor: current?.ref ?? null,
      workstreams,
      deliveryUnits,
      completedUnitIds,
      readyFrontier,
      wipLimit,
      moves: [
        ...(current?.value.moves.map((move) => structuredClone(move)) ?? []),
        ...newMoves,
      ],
      acceptedAt: capturedAt,
    },
  });
}

/** Persist the refused decomposition when — and only when — the stage ticket
 * budget is the sole reason it cannot be published. Everything else stays a
 * plain failure: a structurally invalid plan is not something a human should
 * be invited to ratify, and preservation must never look like acceptance.
 * Preservation is best-effort evidence: it never converts a planning failure
 * into a different failure. */
async function preserveRefusedDecomposition(input: {
  options: AutoPlanOptions;
  stage: ProjectStage;
  output: PlanningStepOutputRecord | undefined;
  traceId: string;
  episodeId: string;
  consumedSources: PlanningSourceManifest | undefined;
  now: () => Date;
}): Promise<RefusedDecompositionSummary | undefined> {
  const plan = input.output?.ticketPlan;
  if (plan === undefined || input.output === undefined) return undefined;
  if (plan.stage !== input.stage) return undefined;
  if (!isTicketBudgetOnlyRefusal(plan)) return undefined;
  try {
    const record = await recordRefusedDecomposition({
      stateHome: input.options.stateHome,
      app: input.options.app.name,
      goal: input.options.goal,
      stage: input.stage,
      plan,
      problems: input.output.problems,
      provenance: {
        episode_id: input.episodeId,
        run_id: input.output.runId,
        trace_id: input.traceId,
      },
      ...(input.consumedSources === undefined
        ? {}
        : { planningSources: planningSourceTicketEvidence(input.consumedSources) }),
      now: input.now(),
    });
    return {
      decompositionId: record.decomposition_id,
      stage: record.stage,
      stageTicketBudget: record.stage_ticket_budget,
      ticketCount: record.ticket_count,
      path: refusedDecompositionPath(
        input.options.stateHome,
        input.options.app.name,
        record.decomposition_id,
      ),
      ratifyCommand: ratifyTicketBudgetCommand({
        app: input.options.app.name,
        decompositionId: record.decomposition_id,
        stageBudget: record.stage_ticket_budget,
        ticketCount: record.ticket_count,
      }),
    };
  } catch {
    return undefined;
  }
}

interface PlanningProviderExecutionInput {
  options: AutoPlanOptions;
  plan: EpisodePlan;
  step: ProviderTurnStep;
  execution: EpisodeStepExecutionContext;
  planner: RoleConfig;
  pipelines: PipelinesFile;
  workdir: string;
  context: ContextBundle;
  hooks: TurnHooks;
  runtimeForAssignment: (assignment: TurnAssignment, role: RoleConfig) => Runtime;
  baseBrief: string;
  sourceBrief: string;
  resolvedSources?: ResolvedPlanningSources;
  consumedSources?: PlanningSourceManifest;
  stage: ProjectStage;
  clock: () => Date;
}

async function executePlanningProviderStep(
  input: PlanningProviderExecutionInput,
): Promise<EpisodeStepCompletedOutcome | EpisodeStepFailedOutcome> {
  const definition = planningProviderOperation(input.step.operation);
  if (definition === undefined || definition.role !== input.step.role) {
    return {
      status: "failed",
      reasonCode: "error_planning_provider_operation_binding",
      summary: `accepted operation ${input.step.operation} is not owned by ${input.step.role}`,
    };
  }
  let evidence = await planningProviderEvidence(input);
  if (evidence === undefined) {
    const authorization = await exactProviderAuthorization(input);
    const governed = planningPipelineForOperation(input.step.operation, input.pipelines);
    const pipeline = executionTransportPipeline(input.step, governed);
    const brief = await renderPlanningProviderBrief(input, definition);
    try {
      await executePipeline({
        pipeline,
        selection: { tier: planRouteLabel(input.plan) },
        roles: { [input.planner.name]: input.planner },
        runtimeFor: (role) => input.runtimeForAssignment(fixedAssignmentFromRole(role), input.planner),
        runtimeForAssignment: input.runtimeForAssignment,
        briefFor: () => brief,
        promptsDir: join(input.options.orgHome, "prompts"),
        context: input.context,
        workdir: input.workdir,
        hooks: input.hooks,
        runlog: {
          root: input.options.stateHome,
          app: input.options.app.name,
          traceId: input.execution.executionId,
        },
        runIdForPass: () => planningProviderRunId(input.plan, input.step, input.execution),
        episode: {
          id: input.plan.episodeId,
          route: planRouteLabel(input.plan),
          authorizedPasses: [authorization],
          finalize: false,
          nextTurnEstimate: {
            costUsd: input.step.maxTurnBudgetUsd,
            activeTimeMs: DEFAULT_PLANNER_ACTIVE_TIME_MS,
          },
        },
        requiredCapabilities: planningRuntimeCapabilities(input.step),
        ...(definition.output === "ticket_plan"
          ? { verdictSchemaFor: () => PLAN_SCHEMA }
          : {}),
        ...(input.resolvedSources === undefined || input.consumedSources === undefined
          ? {}
          : {
              inputManifest: {
                fileName: "planning-sources.json",
                pendingContents: planningSourceManifestJson(input.resolvedSources.manifest),
                completedContents: planningSourceManifestJson(input.consumedSources),
              },
            }),
        telemetry: { orgDir: input.options.stateHome, trigger: "manual" },
        ...(input.options.parentTaskId === undefined
          ? {}
          : { parentTaskId: input.options.parentTaskId }),
        ...(input.options.signal === undefined ? {} : { signal: input.options.signal }),
        clock: input.clock,
      });
    } catch {
      // The pass boundary writes terminal provider evidence before surfacing a
      // later persistence error. Recovery below is authoritative.
    }
    evidence = await requirePlanningProviderEvidence(input);
    await input.options.afterPlanningProviderTurnFinalized?.({
      plan: structuredClone(input.plan),
      step: structuredClone(input.step),
      record: structuredClone(evidence.record),
    });
  }

  if (evidence.record.status !== "completed") {
    const persisted = await persistPlanningStepOutput({
      input,
      evidence,
      status: "failed",
      problems: [evidence.record.reason],
    });
    return {
      status: "failed",
      reasonCode: evidence.record.error_code ?? "error_product_planning_provider_failed",
      summary: evidence.record.reason,
      artifact: persisted.artifact,
    };
  }

  let ticketPlan: TicketPlan | undefined;
  let problems: string[] = [];
  if (definition.output === "ticket_plan") {
    const parsed = parseAndValidateTicketPlan(evidence.output, input.stage);
    ticketPlan = parsed.plan;
    problems = parsed.problems;
  }
  const status = problems.length === 0 ? "completed" : "failed";
  const persisted = await persistPlanningStepOutput({
    input,
    evidence,
    status,
    problems,
    ...(ticketPlan === undefined ? {} : { ticketPlan }),
  });
  if (status === "failed") {
    const refusedTicketBudget =
      ticketPlan !== undefined && isTicketBudgetOnlyRefusal(ticketPlan);
    return {
      status: "failed",
      reasonCode: refusedTicketBudget
        ? "refused_ticket_budget"
        : "error_ticket_plan_invalid",
      summary: refusedTicketBudget
        ? `terminal TicketPlan exceeds the stage ticket budget (${problems.join("; ")})`
        : `terminal TicketPlan failed validation (${problems.length} problem(s))`,
      artifact: persisted.artifact,
    };
  }
  return { status: "completed", artifact: persisted.artifact };
}

async function resolvePlanningExecutionPlan(
  root: string,
  episodeId: string,
  execution: Pick<EpisodeStepExecutionContext, "planVersion" | "planHash">,
): Promise<EpisodePlan> {
  const persisted = await readEpisodePlanVersion(
    root,
    episodeId,
    execution.planVersion,
  );
  if (persisted === undefined || episodePlanHash(persisted) !== execution.planHash) {
    throw new Error(
      `planning execution v${execution.planVersion} does not match immutable plan authority`,
    );
  }
  return persisted;
}

interface PlanningProviderEvidence {
  record: ExecutionStepRecord;
  output: string;
}

async function planningProviderEvidence(
  input: PlanningProviderExecutionInput,
): Promise<PlanningProviderEvidence | undefined> {
  const terminal = (await readExecutionSteps(input.options.stateHome, input.plan.episodeId))
    .filter((record) =>
      record.kind === "provider" &&
      record.plan_version === input.execution.planVersion &&
      record.plan_step_id === input.step.id,
    );
  if (terminal.length > 1) {
    throw new Error(`planning step ${input.step.id} has multiple terminal provider records`);
  }
  const record = terminal[0];
  if (record === undefined) return undefined;
  if (
    record.role !== input.step.role ||
    record.operation !== `${EPISODE_PLAN_EXECUTION_PIPELINE}/${input.step.id}` ||
    record.runtime === null ||
    record.model === null ||
    record.effort === null ||
    !turnAssignmentsEqual(
      { harness: record.runtime, model: record.model, effort: record.effort },
      input.step.assignment,
    ) ||
    record.assignment_source !== input.step.assignmentSource
  ) {
    throw new Error(`terminal provider evidence for ${input.step.id} differs from its accepted plan`);
  }
  let output: string;
  try {
    output = await readFile(
      runPaths(input.options.stateHome, input.options.app.name, record.run_id).output,
      "utf8",
    );
  } catch (error) {
    throw new Error(`terminal provider evidence for ${input.step.id} has no output.md`, {
      cause: error,
    });
  }
  return { record, output };
}

async function requirePlanningProviderEvidence(
  input: PlanningProviderExecutionInput,
): Promise<PlanningProviderEvidence> {
  const evidence = await planningProviderEvidence(input);
  if (evidence === undefined) {
    throw new Error(`planning provider step ${input.step.id} interrupted before terminal evidence`);
  }
  return evidence;
}

async function exactProviderAuthorization(
  input: PlanningProviderExecutionInput,
): Promise<AuthorizedPass> {
  const route = await readRouteRecord(input.options.stateHome, input.plan.episodeId);
  const matches = route.authorized_passes.filter((pass) =>
    pass.pipeline === EPISODE_PLAN_EXECUTION_PIPELINE &&
    pass.pass === input.step.id &&
    pass.role === input.step.role &&
    pass.plan_version === input.execution.planVersion &&
    pass.plan_step_id === input.step.id &&
    pass.runtime === input.step.assignment.harness &&
    pass.model === input.step.assignment.model &&
    pass.effort === input.step.assignment.effort &&
    pass.assignment_source === input.step.assignmentSource,
  );
  if (matches.length !== 1) {
    throw new Error(`planning provider step ${input.step.id} lacks one exact route authorization`);
  }
  return matches[0]!;
}

function executionTransportPipeline(
  step: ProviderTurnStep,
  governed: PipelineConfig,
): PipelineConfig {
  const pass = governed.passes[0]!;
  return {
    name: EPISODE_PLAN_EXECUTION_PIPELINE,
    mechanical: false,
    passes: [{
      id: step.id,
      role: pass.role,
      template: pass.template,
      ...(pass.effort === undefined ? {} : { effort: pass.effort }),
      ...(pass.maxTurns === undefined ? {} : { maxTurns: pass.maxTurns }),
      ...(pass.wallClockMinutes === undefined
        ? {}
        : { wallClockMinutes: pass.wallClockMinutes }),
    }],
  };
}

async function renderPlanningProviderBrief(
  input: PlanningProviderExecutionInput,
  definition: PlanningProviderOperationDefinition,
): Promise<string> {
  const outputOwners = new Map<string, ProviderTurnStep>();
  for (const step of input.plan.steps) {
    if (step.kind !== "provider_turn") continue;
    for (const output of step.expectedOutputs) outputOwners.set(output.id, step);
  }
  const referenced = new Map<string, PlanningStepOutputRecord>();
  for (const ref of input.step.inputRefs) {
    if (!ref.ref.startsWith("plan-output:")) continue;
    const owner = outputOwners.get(ref.ref.slice("plan-output:".length));
    if (owner === undefined) continue;
    const output = await readPlanningStepOutput(input.options.stateHome, input.plan, owner.id);
    if (output !== undefined) referenced.set(owner.id, output);
  }
  for (const dependency of input.step.dependsOn) {
    const output = await readPlanningStepOutput(input.options.stateHome, input.plan, dependency);
    if (output !== undefined) referenced.set(dependency, output);
  }
  const prior = referenced.size === 0
    ? "None. The accepted workflow deliberately selected this operation without an upstream provider artifact. Complete its bounded responsibility in this turn."
    : [...referenced.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([stepId, output]) => `### ${stepId} (${output.operation})\n\n${output.output}`)
        .join("\n\n");
  return [
    input.baseBrief,
    ...(input.sourceBrief === "" ? [] : ["", input.sourceBrief]),
    "",
    "## Accepted EpisodePlan step",
    `Plan version: ${input.plan.version}`,
    `Step: ${input.step.id}`,
    `Operation: ${input.step.operation}`,
    `Governed pipeline/pass: ${definition.pipeline}/${definition.pass}`,
    `Governed template: ${definition.template}`,
    `Objective: ${input.step.objective}`,
    `Dependencies: ${input.step.dependsOn.join(", ") || "none"}`,
    `Required inputs: ${JSON.stringify(input.step.inputRefs)}`,
    `Expected outputs: ${JSON.stringify(input.step.expectedOutputs)}`,
    "",
    "## Prior accepted-step outputs",
    prior,
    "",
    definition.output === "ticket_plan"
      ? `Emit exactly one TicketPlan JSON object with stage "${input.stage}" matching the provided schema. The orchestrator alone validates and publishes it.`
      : "Produce only this governed intermediate artifact. Do not publish issues or perform another planning operation implicitly.",
  ].join("\n");
}

function planningProviderRunId(
  plan: EpisodePlan,
  step: ProviderTurnStep,
  execution: EpisodeStepExecutionContext,
): string {
  return mintRunId(
    new Date(plan.createdAt),
    EPISODE_PLAN_EXECUTION_PIPELINE,
    `${step.id}-${fingerprint(plan.episodeId).slice(0, 12)}-v${execution.planVersion}-a${execution.attempt}`,
  );
}

function planningRuntimeCapabilities(step: ProviderTurnStep): RuntimeCapability[] {
  return [...new Set([
    ...BASELINE_PROVIDER_CAPABILITIES,
    ...step.requiredCapabilities.filter(isRuntimeCapability),
  ])].sort();
}

interface PlanningStepOutputRecord {
  schemaVersion: 1;
  episodeId: string;
  planVersion: number;
  planHash: string;
  stepId: string;
  stepHash: string;
  executionId: string;
  operation: string;
  runId: string;
  providerExecutionStepId: string;
  providerStatus: ExecutionStepRecord["status"];
  status: "completed" | "failed";
  output: string;
  outputSha256: string;
  problems: string[];
  ticketPlan?: TicketPlan;
}

async function persistPlanningStepOutput(input: {
  input: PlanningProviderExecutionInput;
  evidence: PlanningProviderEvidence;
  status: "completed" | "failed";
  problems: string[];
  ticketPlan?: TicketPlan;
}): Promise<{
  record: PlanningStepOutputRecord;
  artifact: { ref: string; sha256: string; runId: string };
}> {
  const record: PlanningStepOutputRecord = {
    schemaVersion: 1,
    episodeId: input.input.plan.episodeId,
    planVersion: input.input.plan.version,
    planHash: input.input.execution.planHash,
    stepId: input.input.step.id,
    stepHash: input.input.execution.stepHash,
    executionId: input.input.execution.executionId,
    operation: input.input.step.operation,
    runId: input.evidence.record.run_id,
    providerExecutionStepId: input.evidence.record.execution_step_id,
    providerStatus: input.evidence.record.status,
    status: input.status,
    output: input.evidence.output,
    outputSha256: fingerprint(input.evidence.output),
    problems: [...input.problems],
    ...(input.ticketPlan === undefined ? {} : { ticketPlan: structuredClone(input.ticketPlan) }),
  };
  const relative = planningStepOutputRelative(input.input.plan.version, input.input.step.id);
  const path = join(efficiencyEpisodeDir(input.input.options.stateHome, input.input.plan.episodeId), relative);
  const contents = `${JSON.stringify(record, null, 2)}\n`;
  const won = await writeLoopFileOnce(path, contents);
  if (!won && await readFile(path, "utf8") !== contents) {
    throw new Error(`planning step output conflict for ${input.input.step.id}`);
  }
  return {
    record,
    artifact: { ref: relative, sha256: stableHash(record), runId: record.runId },
  };
}

async function readPlanningStepOutput(
  root: string,
  plan: EpisodePlan,
  stepId: string,
): Promise<PlanningStepOutputRecord | undefined> {
  const path = join(
    efficiencyEpisodeDir(root, plan.episodeId),
    planningStepOutputRelative(plan.version, stepId),
  );
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  if (!isPlanningStepOutputRecord(value) ||
      value.episodeId !== plan.episodeId || value.planVersion !== plan.version ||
      value.stepId !== stepId || value.outputSha256 !== fingerprint(value.output)) {
    throw new Error(`planning step output ${stepId} is invalid or does not match its plan`);
  }
  return value;
}

function planningStepOutputRelative(planVersion: number, stepId: string): string {
  return join("planning-step-outputs", `v${planVersion}`, `${hashedFileStem(stepId)}.json`);
}

function isPlanningStepOutputRecord(value: unknown): value is PlanningStepOutputRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return record["schemaVersion"] === 1 &&
    typeof record["episodeId"] === "string" &&
    Number.isSafeInteger(record["planVersion"]) &&
    typeof record["planHash"] === "string" &&
    typeof record["stepId"] === "string" &&
    typeof record["stepHash"] === "string" &&
    typeof record["executionId"] === "string" &&
    typeof record["operation"] === "string" &&
    typeof record["runId"] === "string" &&
    typeof record["providerExecutionStepId"] === "string" &&
    ["completed", "failed", "blocked", "cancelled", "timed_out", "interrupted"]
      .includes(String(record["providerStatus"])) &&
    (record["status"] === "completed" || record["status"] === "failed") &&
    typeof record["output"] === "string" &&
    typeof record["outputSha256"] === "string" &&
    Array.isArray(record["problems"]) &&
    record["problems"].every((problem) => typeof problem === "string");
}

function terminalProviderStep(plan: EpisodePlan): ProviderTurnStep | undefined {
  const dependencyIds = new Set(plan.steps.flatMap((step) => step.dependsOn));
  const terminals = plan.steps.filter((step) => !dependencyIds.has(step.id));
  return terminals.length === 1 && terminals[0]?.kind === "provider_turn"
    ? terminals[0]
    : undefined;
}

function parseAndValidateTicketPlan(
  output: string,
  stage: ProjectStage,
): { plan?: TicketPlan; problems: string[] } {
  const plan = parsePlanJson(output);
  if (plan === undefined) {
    return { problems: ["planner output is not a parseable TicketPlan JSON object"] };
  }
  const validation = validatePlan(plan);
  if (plan.stage !== stage) {
    validation.problems.push(
      `planner returned stage "${plan.stage}" but the requested stage is "${stage}"`,
    );
    validation.ok = false;
  }
  return validation.ok ? { plan, problems: [] } : { plan, problems: validation.problems };
}

function assignmentRuntimeFactory(
  options: AutoPlanOptions,
): (assignment: TurnAssignment, role: RoleConfig) => Runtime {
  return (assignment, role) => options.runtimeFor?.({
    ...role,
    runtime: assignment.harness,
    model: assignment.model,
    effort: assignment.effort,
  }) ?? getRuntime(assignment.harness);
}

function defaultPlannerLimits(
  planner: RoleConfig,
  remainingBudgetUsd: number,
): PlannerAdmissionLimits {
  const maxAttempts = 2;
  // Reserve at most two thirds of a very small remaining allowance so a
  // successful EpisodePlanner can still propose at least one delivery turn.
  const perAttemptCost = Math.min(planner.maxTurnBudgetUsd, remainingBudgetUsd / 3);
  if (!Number.isFinite(perAttemptCost) || perAttemptCost <= 0) {
    throw new Error("EpisodePlanner has no positive admitted budget");
  }
  return {
    maxAttempts,
    perAttempt: {
      equivalentCostUsd: perAttemptCost,
      activeTimeMs: DEFAULT_PLANNER_ACTIVE_TIME_MS,
    },
    aggregate: {
      providerTurns: maxAttempts,
      equivalentCostUsd: perAttemptCost * maxAttempts,
      activeTimeMs: DEFAULT_PLANNER_ACTIVE_TIME_MS * maxAttempts,
    },
  };
}

function limitsFromAdmission(admission: PlannerAdmissionRecord): PlannerAdmissionLimits {
  return {
    maxAttempts: admission.budget.max_attempts,
    perAttempt: {
      equivalentCostUsd: admission.budget.per_attempt.equivalent_cost_usd,
      activeTimeMs: admission.budget.per_attempt.active_time_ms,
    },
    aggregate: {
      providerTurns: admission.budget.aggregate.provider_turns,
      equivalentCostUsd: admission.budget.aggregate.equivalent_cost_usd,
      activeTimeMs: admission.budget.aggregate.active_time_ms,
    },
  };
}

async function readEpisodePlannerPrompt(orgHome: string): Promise<string> {
  const path = join(orgHome, "prompts", "episode", "plan.md");
  try {
    const prompt = await readFile(path, "utf8");
    if (prompt.trim().length === 0) throw new Error("prompt is empty");
    return prompt;
  } catch (error) {
    throw new Error(
      `product planning requires the human-ratified EpisodePlanner prompt at ${path}`,
      { cause: error },
    );
  }
}

function planningCatalogForIntent(): JsonValue {
  return Object.values(PLANNING_PROVIDER_OPERATION_CATALOG)
    .map((definition) => ({ ...definition }))
    .sort((left, right) => left.operation.localeCompare(right.operation));
}

function repositoryFacts(
  snapshot: PlanningSnapshot,
  stageResolution: PlanningStageResolution,
  stageEvidenceCheckout: string,
): Record<string, JsonValue> {
  const entries = readdirSync(snapshot.path)
    .filter((name) => name !== ".git")
    .sort()
    .slice(0, 40);
  let recentCommits: string[] = [];
  try {
    recentCommits = execFileSync("git", ["log", "--oneline", "-5"], {
      cwd: snapshot.path,
      encoding: "utf8",
    }).trim().split("\n").filter(Boolean);
  } catch {
    // Empty repositories have no readable commit log.
  }
  return {
    sourceCheckout: snapshot.sourcePath,
    sourceBranch: snapshot.sourceBranch,
    sourceHead: snapshot.sourceHead,
    planningSnapshot: snapshot.path,
    stageEvidenceCheckout,
    planningStageResolution: jsonValue(stageResolution, "planning stage resolution"),
    topLevelEntries: entries,
    docsPresent: ["README.md", "docs"]
      .filter((path) => existsSync(join(snapshot.path, path))),
    recentCommits,
  };
}

async function productPlanningBrief(input: {
  options: AutoPlanOptions;
  snapshot: PlanningSnapshot;
  stage: ProjectStage;
  stageResolution: PlanningStageResolution;
  stageEvidenceCheckout: string;
  budget: BudgetRow;
}): Promise<string> {
  const facts = repositoryFacts(
    input.snapshot,
    input.stageResolution,
    input.stageEvidenceCheckout,
  );
  return [
    `# ${input.stage} product plan request: ${input.options.app.name}`,
    "",
    "## Product goal",
    input.options.goal,
    ...(input.options.creatorScope === undefined
      ? []
      : [
          "",
          "## Authoritative execution-ready creator scope",
          "Preserve these creator-authored boundaries, criteria, constraints, safety facts, and provenance exactly. " +
            "Do not redesign or widen them.",
          JSON.stringify(input.options.creatorScope, null, 2),
        ]),
    "",
    "## Accepted workflow boundary",
    "Execute only the current EpisodePlan step and its governed prompt. " +
      "Do not launch another provider planning pass implicitly.",
    `Available code-owned operations: ${Object.keys(PLANNING_PROVIDER_OPERATION_CATALOG).sort().join(", ")}`,
    "",
    "## Repository snapshot",
    JSON.stringify(facts, null, 2),
    "",
    "## App budget at episode creation",
    `Month-to-date spend $${input.budget.spentUsd.toFixed(2)} of ` +
      `$${input.budget.budgetUsd.toFixed(2)} (${input.budget.status}).`,
    "",
    "Plan the smallest shippable milestone supported by the accepted step.",
  ].join("\n");
}

function resolveAutoPlanSources(
  options: AutoPlanOptions,
  snapshot: PlanningSnapshot,
  traceId: string,
): ResolvedPlanningSources | undefined {
  if ((options.sources?.length ?? 0) === 0) return undefined;
  return resolvePlanningSources({
    app: options.app.name,
    traceId,
    sourceCheckout: snapshot.sourcePath,
    sourceCheckoutHead: snapshot.sourceHead,
    requests: options.sources ?? [],
    budgetBytes: AUTO_PLAN_SOURCE_BUDGET_BYTES,
  });
}

function planningSourceTicketEvidence(
  manifest: PlanningSourceManifest,
): PlanningSourceTicketEvidence {
  return {
    manifestSha256: manifest.manifest_sha256,
    sources: manifest.sources
      .filter((source) => source.selection === "selected" && source.consumption === "consumed")
      .map((source) => ({
        canonicalRef: source.canonical_ref,
        sourceSha256: source.source_sha256,
        sourceBytes: source.source_bytes,
        includedBytes: source.included_bytes,
        inclusion: source.inclusion === "truncated" ? "truncated" as const : "full" as const,
        trust: source.trust,
      })),
  };
}

interface PlanningSnapshot {
  path: string;
  sourcePath: string;
  sourceHead: string;
  sourceBranch: string;
}

function validateSourceCheckout(input: string): string {
  const source = resolve(input);
  if (!existsSync(join(source, ".git"))) {
    throw new Error(`plan: --workdir is not a git checkout: ${source}`);
  }
  gitText(source, "rev-parse", "--verify", "HEAD");
  return source;
}

function createOrReusePlanningSnapshot(source: string, target: string): PlanningSnapshot {
  const sourceHead = gitText(source, "rev-parse", "HEAD");
  const sourceBranch = gitText(source, "branch", "--show-current") || "(detached)";
  if (existsSync(target)) {
    if (!existsSync(join(target, ".git")) || gitText(target, "rev-parse", "HEAD") !== sourceHead) {
      throw new Error(`plan: existing planning snapshot differs from source HEAD: ${target}`);
    }
    return { path: target, sourcePath: source, sourceHead, sourceBranch };
  }
  mkdirSync(dirname(target), { recursive: true });
  execFileSync("git", ["-c", "core.hooksPath=/dev/null", "clone", "--quiet", "--no-hardlinks", source, target], {
    encoding: "utf8",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  gitText(target, "checkout", "--detach", sourceHead);
  return { path: target, sourcePath: source, sourceHead, sourceBranch };
}

function gitText(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "core.hooksPath=/dev/null", ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function failedResult(
  error: unknown,
  base: Partial<AutoPlanResult>,
): AutoPlanResult {
  const message = error instanceof Error ? error.message : String(error);
  const issues = error !== null && typeof error === "object" &&
      "issues" in error && Array.isArray((error as { issues?: unknown }).issues)
    ? (error as { issues: Array<{ code?: string; message?: string }> }).issues
        .map((entry) => `${entry.code ?? "invalid"}: ${entry.message ?? "unknown problem"}`)
    : undefined;
  return {
    status: "failed",
    summary: message,
    ...(issues === undefined ? {} : { problems: issues }),
    ...base,
  };
}

function jsonValue(value: unknown, name: string): JsonValue {
  try {
    return JSON.parse(JSON.stringify(value)) as JsonValue;
  } catch (error) {
    throw new Error(`${name} must be JSON-serializable`, { cause: error });
  }
}

function isProjectStage(value: unknown): value is ProjectStage {
  return value === "bootstrap" || value === "growth" || value === "mature";
}

/** Native structured output returns bare JSON; a degraded adapter may wrap it
 * in prose or a code fence. Extract the first complete top-level object. */
export function parsePlanJson(text: string): TicketPlan | undefined {
  const start = text.indexOf("{");
  if (start < 0) return undefined;
  for (let end = text.length; end > start; end -= 1) {
    const candidate = text.slice(start, end).trim();
    if (!candidate.endsWith("}")) continue;
    try {
      const parsed = JSON.parse(candidate) as TicketPlan;
      if (typeof parsed === "object" && parsed !== null && Array.isArray(parsed.tickets)) {
        return parsed;
      }
      return undefined;
    } catch {
      // Trailing prose after the JSON; shrink and retry.
    }
  }
  return undefined;
}
