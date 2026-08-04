import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type {
  ContextBundle,
  RoleConfig,
  Runtime,
  TurnAssignment,
  TurnHooks,
} from "../runtime/types.js";
import {
  isRuntimeCapability,
  type RuntimeCapability,
} from "../runtime/capabilities.js";
import {
  fixedAssignmentFromRole,
  turnAssignmentsEqual,
} from "../runtime/assignment.js";
import { mintRunId, hashedFileStem, runPaths } from "../runtime/runlog/paths.js";
import type {
  AcceptedTicketEpisodePlan,
  TicketEpisodeExecutionRequest,
  TicketEpisodeExecutor,
  TicketEpisodePlanner,
  TicketEpisodePlanningRequest,
  DeliveryUnitRuntime,
} from "../loop/driver.js";
import { gateCommandsForWorktree } from "../loop/driver.js";
import {
  advanceGates,
  advanceProvisionSetup,
  advanceReviewing,
  advanceShipping,
  criterionTestMapFromContract,
  parseAcceptanceCriteria,
  recoverAlreadyMergedTicket,
  repairPrGateEvidence,
  renderBuildBlockedComment,
  renderContractComment,
  renderReviewBody,
  isPrGateEvidenceOnlyFinding,
  latestActionableReview,
  deliveryUnitIssueNumbers,
  swapDeliveryUnitLabel,
  type ReviewAuthorization,
} from "../loop/loop.js";
import type { GhOps, GhReview } from "../loop/github.js";
import type { Policy } from "../loop/policy.js";
import type { GateCommands } from "../loop/qgates.js";
import type { LoopItem, ReleaseConfig, SuppressedOperation } from "../loop/types.js";
import { resolveReleaseCommand } from "../loop/plan-tickets.js";
import { createRoadmapLoopRuntime } from "./roadmap-loop-runtime.js";
import {
  EPISODE_PLAN_EXECUTION_PIPELINE,
  planRouteLabel,
} from "../loop/episode-route.js";
import {
  assertTicketEpisodePlanValid,
  isTicketMechanicalGateKind,
  ticketProviderOperation,
  ticketGovernedWorkflowTemplates,
  TICKET_EPISODE_TOPOLOGY_CONTRACT,
  TICKET_MECHANICAL_GATE_CATALOG,
  TICKET_MECHANICAL_GATE_KINDS,
  TICKET_PROVIDER_OPERATION_CATALOG,
  TICKET_PROVIDER_OPERATIONS,
  type TicketMechanicalGateKind,
  type TicketProviderOperationDefinition,
} from "../loop/ticket-episode-plan.js";
import {
  executeAcceptedEpisodePlan,
} from "./episode-planner/execution.js";
import {
  createProviderEpisodePlanRevisionProposer,
} from "./episode-planner/runtime.js";
import {
  inspectEpisodeInvocation,
  orchestrateEpisode,
  previewEpisode,
  type EpisodeOrchestrationFacts,
} from "./episode-planner/orchestrator.js";
import { readPersistedEpisodeIntent } from "./episode-planner/coordinator.js";
import type { EpisodeSafetyFloorMapping } from "./episode-planner/policy.js";
import { inspectEpisodeRepository } from "./episode-planner/repository-facts.js";
import type { AppEntry } from "./apps.js";
import {
  efficiencyEpisodeDir,
  fingerprint,
  readExecutionSteps,
  readRouteRecord,
  settledProviderSteps,
  worktreeFingerprint,
  type AuthorizedPass,
  type ExecutionStepRecord,
  type RouteBudget,
} from "../loop/efficiency.js";
import {
  episodeIntentHash,
  episodePlanHash,
  readEpisodePlanVersion,
  stableHash,
  type BudgetCeiling,
  type CreatorEpisodeScope,
  type EpisodePlan,
  type JsonValue,
  type MechanicalGateStep,
  type ProviderTurnStep,
  type SafetyFact,
} from "../loop/episode-plan.js";
import { readEpisodeReplanJournal } from "../loop/episode-replan.js";
import type {
  EpisodeStepCompletedOutcome,
  EpisodeStepExecutionContext,
  EpisodeStepFailedOutcome,
  ProviderStepOutcome,
} from "../loop/episode-plan-executor.js";
import type { PlannerAdmissionLimits } from "../loop/planner-admission.js";
import {
  executePipeline,
  type PassRunRecord,
  type PipelineRunResult,
  type VerdictRecordOutcome,
} from "../loop/pipeline.js";
import {
  ERROR_TURN_BUDGET_SUSPENDED,
  type TurnBudgetStop,
} from "../runtime/turn-budget.js";
import { readEnvelope } from "../runtime/runlog/envelope.js";
import {
  resumeCostEstimate,
  type ResumeCostEstimate,
  type TurnBudgetEscalationInput,
} from "./budget.js";
import type { ApprovalItem } from "./approvals.js";
import type { PipelineConfig } from "../loop/pipelines.js";
import {
  parseVerdictEither,
  VERDICT_SCHEMAS,
  VerdictParseError,
  type BuildVerdict,
  type ContractVerdict,
  type ReviewVerdict,
  type VerdictTypes,
} from "../loop/verdicts.js";
import {
  contractMarker,
  hashTicketBody,
  readTicketClaimState,
  renderFixResolutionsComment,
} from "../loop/rehydrate.js";
import { writeLoopFileOnce } from "../loop/durable.js";
import type { TriggerKind } from "../runtime/telemetry.js";
import {
  probeRuntimeReadiness,
  type RuntimeReadinessProbe,
} from "../runtime/readiness.js";
import type { TicketEpisodeApprovalHandler } from "./ticket-episode-approval.js";
import {
  mergeEpisodeSafetyFacts,
  safetyFactsFromTicketLabels,
} from "./episode-safety-facts.js";

export const TICKET_EPISODE_PLANNER_POLICY_VERSION =
  "ticket-episode/episode-planner-v1" as const;

const MAX_TICKET_BODY_BYTES = 128 * 1024;
const MAX_TICKET_PROVIDER_TURNS = 12;
const DEFAULT_PLANNER_ACTIVE_TIME_MS = 5 * 60_000;
const TICKET_SAFETY_FLOOR_MAPPING = {
  gateKinds: {
    authentication: ["ticket/security"],
    security: ["ticket/security"],
    secrets: ["ticket/security"],
    privacy: ["ticket/security"],
    payments: ["ticket/security"],
    user_data: ["ticket/data-integrity"],
    data_migration: ["ticket/data-integrity", "ticket/rollback"],
    production_deployment: ["ticket/rollback", "release/handoff"],
    release: ["release/handoff"],
    performance_sensitive: ["ticket/performance"],
  },
} as const satisfies EpisodeSafetyFloorMapping;

export interface TicketEpisodeRuntimeOptions {
  /** Durable org state home (`efficiency/`, `runs/`, and telemetry live here). */
  root: string;
  /** Committed org home containing the protected prompt/template surfaces. */
  orgRoot: string;
  app: AppEntry;
  roles: readonly RoleConfig[];
  gh: GhOps;
  policy: Policy;
  commands: GateCommands;
  hooks: TurnHooks;
  runtimeForAssignment: (assignment: TurnAssignment, role: RoleConfig) => Runtime;
  assignmentReadinessProbe?: RuntimeReadinessProbe;
  assignmentReadinessTimeoutMs?: number;
  /** Context for the fixed EpisodePlanner boot turn. */
  plannerContext: ContextBundle;
  /** Role-scoped delivery context; omission deliberately reuses plannerContext. */
  contextForProviderStep?: (input: {
    request: TicketEpisodePlanningRequest;
    item: LoopItem;
    step: ProviderTurnStep;
    role: RoleConfig;
  }) => ContextBundle | Promise<ContextBundle>;
  /** Current app allowance after ledger spend. The ledger remains authoritative. */
  remainingBudgetUsd: number;
  hardBudget?: Partial<BudgetCeiling>;
  plannerLimits?: PlannerAdmissionLimits;
  plannerPromptText?: string;
  creatorScopeForTicket?: (
    request: TicketEpisodePlanningRequest,
  ) => CreatorEpisodeScope | undefined | Promise<CreatorEpisodeScope | undefined>;
  /** The turn's gate, built per role AND per sandbox cwd. The cwd is passed
   *  by the executor that actually runs the pass, because a builder ticket
   *  pass runs in the per-ticket worktree while the caller that wires this
   *  callback only knows the managed clone — and an approval raised in one
   *  tree must never be executed in the other. */
  gateForRole?: (role: RoleConfig, workdir?: string) => TurnHooks["gate"];
  approval?: TicketEpisodeApprovalHandler;
  /** Raises the ONE queue item whose decision releases a soft-ring budget
   *  pause. The org owns it because the approval store is org state and this
   *  module must stay on the loop-facing side of that boundary. Absent (pure
   *  state-machine harnesses) still suspends and still preserves the session —
   *  it just leaves the pause for a human to notice, never silently returns
   *  the ticket. */
  raiseTurnBudgetEscalation?: (input: TurnBudgetEscalationInput) => Promise<ApprovalItem>;
  authorization?: ReviewAuthorization;
  release?: ReleaseConfig;
  telemetry?: { orgDir: string; trigger?: TriggerKind };
  parentTaskId?: string;
  signal?: AbortSignal;
  networkAccess?: boolean;
  now?: () => Date;
}

export interface TicketEpisodeRuntime {
  planTicket: TicketEpisodePlanner;
  executeTicketPlan: TicketEpisodeExecutor;
  deliveryUnits: DeliveryUnitRuntime;
}

export interface TicketEpisodeInspectionOptions {
  root: string;
  app: AppEntry;
  roles: readonly RoleConfig[];
  remainingBudgetUsd: number;
  hardBudget?: Partial<BudgetCeiling>;
  plannerLimits?: PlannerAdmissionLimits;
  creatorScopeForTicket?: (
    request: TicketEpisodePlanningRequest,
  ) => CreatorEpisodeScope | undefined | Promise<CreatorEpisodeScope | undefined>;
}

export interface TicketEpisodeInvocationInspection {
  facts: EpisodeOrchestrationFacts;
  intent: ReturnType<typeof previewEpisode>["intent"];
  planningPath: ReturnType<typeof previewEpisode>["planningPath"];
  plannerLimits: PlannerAdmissionLimits;
}

/**
 * Construct the two org-owned callbacks consumed by the provider-backed loop.
 * Both autonomous dispatch and `cormidia loop` use this factory so ticket
 * planning/execution cannot drift between entry points.
 */
export function createTicketEpisodeRuntime(
  options: TicketEpisodeRuntimeOptions,
): TicketEpisodeRuntime {
  assertFactoryOptions(options);
  return {
    planTicket: (request) => planTicketEpisode(options, request),
    executeTicketPlan: (request) => executeTicketEpisode(options, request),
    deliveryUnits: createRoadmapLoopRuntime({
      root: options.root,
      app: options.app,
      gh: options.gh,
    }),
  };
}

async function planTicketEpisode(
  options: TicketEpisodeRuntimeOptions,
  request: TicketEpisodePlanningRequest,
): Promise<AcceptedTicketEpisodePlan> {
  const clock = options.now ?? (() => new Date());
  const inspected = await inspectTicketEpisodeInvocation(options, request);
  const plannerRole = requireRole(options.roles, "planner");
  const plannerLimits = inspected.plannerLimits;
  const workflowTemplates = ticketWorkflowTemplates(options);
  const promptText = inspected.planningPath === "creator_scope_normalization"
    ? "Creator scope normalization path: no provider prompt is executed."
    : await resolvePlannerPrompt(options);
  const result = await orchestrateEpisode({
    root: options.root,
    app: options.app,
    roles: options.roles,
    mode: "plan_only",
    ...(options.assignmentReadinessProbe === undefined
      ? {}
      : { assignmentReadinessProbe: options.assignmentReadinessProbe }),
    ...(options.assignmentReadinessTimeoutMs === undefined
      ? {}
      : { assignmentReadinessTimeoutMs: options.assignmentReadinessTimeoutMs }),
    facts: inspected.facts,
    planner: {
      promptText,
      context: options.plannerContext,
      workdir: request.localRepo,
      hooks: plannerHooks(options, plannerRole),
      runtimeForAssignment: options.runtimeForAssignment,
      policyVersion: TICKET_EPISODE_PLANNER_POLICY_VERSION,
      providerOperations: TICKET_PROVIDER_OPERATIONS,
      mechanicalGates: TICKET_MECHANICAL_GATE_KINDS,
      topologyContract: TICKET_EPISODE_TOPOLOGY_CONTRACT,
      workflowTemplates,
      limits: plannerLimits,
      independentReview: {
        subjectRoles: ["builder"],
        reviewerRoles: ["reviewer"],
      },
      safetyFloorMapping: TICKET_SAFETY_FLOOR_MAPPING,
      validateAcceptedPlan: assertTicketEpisodePlanValid,
      traceId: `${request.ticket.ticketRef}:episode-planner`,
      ...(options.telemetry === undefined ? {} : { telemetry: options.telemetry }),
      ...(options.parentTaskId === undefined ? {} : { parentTaskId: options.parentTaskId }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      ...(options.networkAccess === true ? { networkAccess: true } : {}),
      now: clock,
    },
  });
  assertTicketEpisodePlanValid(result.prepared.plan);
  return {
    intent: structuredClone(result.intent),
    plan: structuredClone(result.prepared.plan),
  };
}

/**
 * Build and validate the deterministic ticket invocation facts used by the
 * live EpisodePlanner boundary. A persisted episode keeps its original hard
 * budget: current ledger spend is admission state, not a reason to rewrite an
 * immutable episode ceiling on every resume.
 */
export async function inspectTicketEpisodeInvocation(
  options: TicketEpisodeInspectionOptions,
  request: TicketEpisodePlanningRequest,
): Promise<TicketEpisodeInvocationInspection> {
  assertInspectionOptions(options);
  assertRequest(options, request);
  assertBoundedTicket(request);
  const plannerRole = requireRole(options.roles, "planner");
  const repository = inspectEpisodeRepository({
    workdir: request.localRepo,
    baseRevision: request.base,
  });
  const resolvedCreatorScope = await options.creatorScopeForTicket?.(structuredClone(request));
  if (
    resolvedCreatorScope !== undefined &&
    request.creatorScope !== undefined &&
    stableHash(resolvedCreatorScope) !== stableHash(request.creatorScope)
  ) {
    throw new Error("ticket episode has conflicting creator-scope envelopes");
  }
  const creatorScope = resolvedCreatorScope ?? request.creatorScope;
  const persistedIntent = await readPersistedEpisodeIntent(options.root, request.episodeId);
  let hardBudget = persistedIntent === undefined
    ? ticketHardBudget(options, 0)
    : structuredClone(persistedIntent.hardBudget);
  const catalog = ticketPlanningCatalog();
  const plannerLimits = options.plannerLimits ?? defaultPlannerLimits(
    plannerRole,
    options.remainingBudgetUsd,
  );
  const requiredSafetyFacts = mergeTicketSafetyFacts(
    request.deliveryUnit?.members.flatMap((member) => member.labels) ?? request.ticket.labels,
    request.deliveryUnit?.members.map((member) => member.ticketRef).join(",") ?? request.ticket.ticketRef,
    creatorScope,
  );
  let facts = {
    episodeId: request.episodeId,
    trigger: {
      kind: "github_issue",
      sourceRef: request.deliveryUnit === undefined
        ? `${request.targetRepo}${request.ticket.ticketRef}`
        : `${request.targetRepo}:delivery-unit:${request.deliveryUnit.unitId}`,
      payloadHash: stableHash(request.deliveryUnit ?? request.ticket),
    },
    goal: creatorScope?.objective ?? (request.deliveryUnit === undefined
      ? `Deliver ${request.ticket.ticketRef}: ${request.ticket.title}`
      : `Deliver ${request.deliveryUnit.unitId}: ` +
        request.deliveryUnit.members.map((member) => member.ticketRef).join(", ")),
    lifecycle: "existing-ticket",
    appStage: options.app.status,
    repositoryFacts: repository.repositoryFacts,
    changeFacts: repository.changeFacts,
    requestedConstraints: {
      ticket: {
        ref: request.ticket.ticketRef,
        title: request.ticket.title,
        body: request.ticket.body,
        labels: [...request.ticket.labels].sort(),
        acceptanceCriteria: parseAcceptanceCriteria(request.ticket.body).map((entry) => ({
          id: entry.id,
          text: entry.text,
          checked: entry.checked,
        })),
      },
      ...(request.deliveryUnit === undefined ? {} : {
        deliveryUnit: {
          unitId: request.deliveryUnit.unitId,
          membershipHash: request.deliveryUnit.membershipHash,
          members: request.deliveryUnit.members.map((member) => ({
            issueNumber: member.issueNumber,
            ticketRef: member.ticketRef,
            title: member.title,
            body: member.body,
            labels: [...member.labels].sort(),
            acceptanceCriteria: parseAcceptanceCriteria(member.body).map((entry) => ({
              id: entry.id,
              text: entry.text,
              checked: entry.checked,
            })),
          })),
        },
      }),
      baseRevision: {
        ref: request.base.ref,
        defaultBranch: request.base.defaultBranch,
      },
      ticketExecutionCatalog: catalog,
      workflowAuthority: "accepted_episode_plan_only",
      implicitRemediation: false,
    },
    hardBudget,
    requiredSafetyFacts,
    responsibilityByRole: Object.fromEntries(options.roles.map((role) => [
      role.name,
      role.name === "builder"
        ? "Own bounded diagnosis, contract, implementation, and fixes for this ticket"
        : role.name === "reviewer"
          ? "Independently verify the exact delivered revision and release readiness"
          : role.name === "planner"
            ? "Design the smallest sufficient ticket workflow from the code-owned operation catalog"
            : `Configured ${role.name} responsibility`,
    ])),
    ...(creatorScope === undefined ? {} : { creatorScope }),
  } as const;
  // Assess the creator path without touching the protected prompt. A complete
  // creator scope is normalized with a deliberately-unused in-memory sentinel;
  // absent/incomplete scope must load the ratified production prompt or fail.
  let preview = previewEpisode({
    app: options.app,
    roles: options.roles,
    facts,
    planner: {
      limits: plannerLimits,
      independentReview: {
        subjectRoles: ["builder"],
        reviewerRoles: ["reviewer"],
      },
      safetyFloorMapping: TICKET_SAFETY_FLOOR_MAPPING,
      workflowTemplates: ticketWorkflowTemplates(options),
    },
  });
  if (preview.planningPath === "episode_planner_provider_turn") {
    assertPlannerFitsCombinedBudget(plannerLimits, options.remainingBudgetUsd);
    if (persistedIntent === undefined) {
      hardBudget = ticketHardBudget(
        options,
        plannerLimits.aggregate.equivalentCostUsd,
      );
      facts = { ...facts, hardBudget };
      preview = previewEpisode({
        app: options.app,
        roles: options.roles,
        facts,
        planner: {
          limits: plannerLimits,
          independentReview: {
            subjectRoles: ["builder"],
            reviewerRoles: ["reviewer"],
          },
          safetyFloorMapping: TICKET_SAFETY_FLOOR_MAPPING,
        },
      });
    }
  }
  const episodeInspection = await inspectEpisodeInvocation({
    root: options.root,
    app: options.app,
    roles: options.roles,
    facts,
  });
  return {
    facts: structuredClone(facts),
    intent: structuredClone(episodeInspection.persistedIntent ?? preview.intent),
    planningPath: preview.planningPath,
    plannerLimits: structuredClone(plannerLimits),
  };
}

function ticketWorkflowTemplates(
  options: Pick<TicketEpisodeInspectionOptions, "roles" | "remainingBudgetUsd" | "hardBudget">,
): ReturnType<typeof ticketGovernedWorkflowTemplates> {
  const availableUsd = Math.min(
    100,
    options.remainingBudgetUsd,
    options.hardBudget?.maxEquivalentCostUsd ?? Number.POSITIVE_INFINITY,
  );
  if (!Number.isFinite(availableUsd) || availableUsd <= 0) {
    throw new Error("ticket governed workflow has no positive unit budget");
  }
  const builder = requireRole(options.roles, "builder");
  const reviewer = requireRole(options.roles, "reviewer");
  return ticketGovernedWorkflowTemplates({
    contractUsd: Math.min(builder.maxTurnBudgetUsd, availableUsd * 0.15),
    implementationUsd: Math.min(builder.maxTurnBudgetUsd, availableUsd * 0.5),
    reviewUsd: Math.min(reviewer.maxTurnBudgetUsd, availableUsd * 0.35),
  });
}

async function executeTicketEpisode(
  options: TicketEpisodeRuntimeOptions,
  input: TicketEpisodeExecutionRequest,
): Promise<LoopItem> {
  assertRequest(options, input.request);
  assertAcceptedIdentity(input);
  assertTicketEpisodePlanValid(input.accepted.plan);
  const plannerRole = requireRole(options.roles, "planner");
  const clock = options.now ?? (() => new Date());
  const workdir = requireWorktree(input.item);
  const plannerLimits = options.plannerLimits ?? defaultPlannerLimits(
    plannerRole,
    options.remainingBudgetUsd,
  );
  let item = structuredClone(input.item);
  const execution = await executeAcceptedEpisodePlan({
    root: options.root,
    intent: input.accepted.intent,
    plan: input.accepted.plan,
    roles: options.roles,
    workdir,
    hooks: options.hooks,
    runtimeForAssignment: options.runtimeForAssignment,
    assignmentReadinessProbe: options.assignmentReadinessProbe ?? probeRuntimeReadiness,
    ...(options.assignmentReadinessTimeoutMs === undefined
      ? {}
      : { assignmentReadinessTimeoutMs: options.assignmentReadinessTimeoutMs }),
    proposeRevision: async (request) => createProviderEpisodePlanRevisionProposer({
      root: options.root,
      app: options.app,
      roles: options.roles,
      promptText: await resolvePlannerPrompt(options),
      context: options.plannerContext,
      workdir,
      hooks: plannerHooks(options, plannerRole),
      runtimeForAssignment: options.runtimeForAssignment,
      policyVersion: TICKET_EPISODE_PLANNER_POLICY_VERSION,
      providerOperations: TICKET_PROVIDER_OPERATIONS,
      mechanicalGates: TICKET_MECHANICAL_GATE_KINDS,
      topologyContract: TICKET_EPISODE_TOPOLOGY_CONTRACT,
      limits: plannerLimits,
      independentReview: {
        subjectRoles: ["builder"],
        reviewerRoles: ["reviewer"],
      },
      safetyFloorMapping: TICKET_SAFETY_FLOOR_MAPPING,
      validateAcceptedPlan: assertTicketEpisodePlanValid,
      traceId: `${input.request.ticket.ticketRef}:episode-planner-revision`,
      ...(options.telemetry === undefined ? {} : { telemetry: options.telemetry }),
      ...(options.parentTaskId === undefined ? {} : { parentTaskId: options.parentTaskId }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      now: clock,
    })(request),
    contextForProviderStep: async ({ step }) => {
      const role = requireRole(options.roles, step.role);
      return options.contextForProviderStep?.({
        request: input.request,
        item: structuredClone(item),
        step: structuredClone(step),
        role,
      }) ?? options.plannerContext;
    },
    // Asked before an adopted revision would re-enter the exact step it was
    // authored to repair. The ticket domain can settle such a step from a
    // preserved prior material event, so it answers from the same evidence
    // code the handler below uses instead of spending a second turn (#175).
    // Evidence that fails its own integrity checks is not "completable": the
    // step is withheld here and enters normally on the next tick, where the
    // executor turns the same error into that step's typed failure.
    providerStepCompletableWithoutNewTurn: async (step, plan) => {
      const definition = ticketProviderOperation(step.operation);
      if (definition === undefined || definition.role !== step.role) return false;
      try {
        return (await completableProviderEvidence({ options, plan, step }, definition)) !== undefined;
      } catch {
        return false;
      }
    },
    provider: async (step, context) => {
      const plan = await ticketExecutionPlan(
        options.root,
        input.accepted.plan.episodeId,
        context,
      );
      const outcome = await executeTicketProviderStep({
        options,
        input,
        item,
        plan,
        step,
        context,
      });
      item = outcome.item;
      return outcome.outcome;
    },
    mechanical: async (step, context) => {
      const plan = await ticketExecutionPlan(
        options.root,
        input.accepted.plan.episodeId,
        context,
      );
      const outcome = await executeTicketMechanicalStep({
        options,
        input,
        item,
        plan,
        step,
        context,
      });
      item = outcome.item;
      return outcome.outcome;
    },
    approval: async (step, context) => {
      if (options.approval === undefined) {
        return {
          status: "failed",
          reasonCode: "error_ticket_episode_approval_handler_missing",
          summary: `ticket plan approval ${step.approvalKind} has no registered org handler`,
        };
      }
      return options.approval(
        step,
        context,
        structuredClone(item),
        structuredClone(input.accepted),
      );
    },
    ...(options.gateForRole === undefined ? {} : { gateForRole: options.gateForRole }),
    ...(options.telemetry === undefined ? {} : { telemetry: options.telemetry }),
    ...(options.parentTaskId === undefined ? {} : { parentTaskId: options.parentTaskId }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(options.networkAccess === true ? { networkAccess: true } : {}),
    now: clock,
  });
  if (execution.replan !== undefined) {
    item = {
      ...item,
      episodeReplan: {
        kind: execution.replan.kind,
        status: execution.replan.status,
        revisionVersion: execution.replan.revisionVersion,
        reason: execution.replan.reason,
      },
    };
  }
  if (execution.status !== "completed" && !isTerminalTicketPhase(item.phase)) {
    item = await returnTicket(options.gh, item);
  }
  return item;
}

async function ticketExecutionPlan(
  root: string,
  episodeId: string,
  context: EpisodeStepExecutionContext,
): Promise<EpisodePlan> {
  const plan = await readEpisodePlanVersion(root, episodeId, context.planVersion);
  if (plan === undefined || episodePlanHash(plan) !== context.planHash) {
    throw new Error(
      `ticket execution ${context.executionId} cannot resolve its immutable plan v${context.planVersion}`,
    );
  }
  return plan;
}

/** Everything needed to resolve one planned provider step's durable evidence.
 *  Deliberately narrower than a step execution: the adopted-revision halt asks
 *  the same evidence question before any execution context exists. `plan` is
 *  the immutable plan the step belongs to, so `plan.version` is the version
 *  the evidence must be bound to. */
export interface TicketProviderEvidenceInput {
  /** Deliberately narrower than the full runtime options: resolving durable
   *  evidence reads state-home files and nothing else. Keeping the type honest
   *  is what lets the #202 detector construct this input without inventing a
   *  GitHub client, an adapter, or a role table it would never touch. */
  options: { root: string; app: Pick<AppEntry, "name"> };
  plan: EpisodePlan;
  step: ProviderTurnStep;
}

export interface TicketProviderExecutionInput extends Omit<TicketProviderEvidenceInput, "options"> {
  options: TicketEpisodeRuntimeOptions;
  input: TicketEpisodeExecutionRequest;
  item: LoopItem;
  context: EpisodeStepExecutionContext;
}

interface TicketStepResult {
  item: LoopItem;
  outcome: EpisodeStepCompletedOutcome | EpisodeStepFailedOutcome;
}

/** Provider steps alone can park: only they hold a per-turn budget. */
interface TicketProviderStepResult {
  item: LoopItem;
  outcome: ProviderStepOutcome;
}

async function executeTicketProviderStep(
  input: TicketProviderExecutionInput,
): Promise<TicketProviderStepResult> {
  const definition = ticketProviderOperation(input.step.operation);
  if (definition === undefined || definition.role !== input.step.role) {
    return failedTicketProvider(
      input,
      "error_ticket_provider_operation_binding",
      `accepted operation ${input.step.operation} is not owned by role ${input.step.role}`,
    );
  }
  const role = requireRole(input.options.roles, input.step.role);
  let evidence = await completableProviderEvidence(input, definition);
  if (evidence === undefined) {
    const routeAuthority = await exactProviderAuthorization(input, role);
    const context = await providerContext(input, role);
    const pipeline: PipelineConfig = {
      name: EPISODE_PLAN_EXECUTION_PIPELINE,
      mechanical: false,
      passes: [{
        id: input.step.id,
        role: input.step.role,
        template: definition.template ?? "",
      }],
    };
    const dependencyOutputs = await requiredPlanOutputs(input);
    let pipelineError: unknown;
    let run: PipelineRunResult | undefined;
    // A continuation is consumed only by the exact step that parked. The
    // driver hands the ticket its durable continuation; if it targets a
    // different pass, this step starts a fresh session as usual.
    const continuation =
      input.item.continuation?.pass === input.step.id ? input.item.continuation : undefined;
    try {
      run = await executePipeline({
        pipeline,
        selection: { tier: planRouteLabel(input.plan) },
        roles: { [role.name]: role },
        runtimeFor: (selected) =>
          input.options.runtimeForAssignment(fixedAssignmentFromRole(selected), role),
        runtimeForAssignment: input.options.runtimeForAssignment,
        briefFor: () => renderTicketProviderBrief(input, definition, dependencyOutputs),
        promptsDir: join(input.options.orgRoot, "prompts"),
        context,
        workdir: requireWorktree(input.item),
        hooks: input.options.hooks,
        ...(input.options.gateForRole === undefined
          ? {}
          : { gateForRole: input.options.gateForRole }),
        runlog: {
          root: input.options.root,
          app: input.options.app.name,
          ticket: input.item.ticketRef,
          traceId: input.context.executionId,
        },
        runIdForPass: () => ticketProviderRunId(
          input.plan,
          input.step,
          input.context,
        ),
        episode: {
          id: input.plan.episodeId,
          route: planRouteLabel(input.plan),
          authorizedPasses: [routeAuthority.pass],
          budgetOverrides: routeAuthority.budget,
          finalize: false,
          nextTurnEstimate: { costUsd: input.step.maxTurnBudgetUsd },
        },
        requiredCapabilities: ticketRuntimeCapabilities(input.step),
        ...(definition.verdictKind === null
          ? {}
          : {
              verdictSchemaFor: () => VERDICT_SCHEMAS[definition.verdictKind!],
              recordVerdict: async (ctx): Promise<VerdictRecordOutcome> => {
                const parsed = parseVerdictEither(definition.verdictKind!, ctx.result.summary);
                if (!parsed.ok) {
                  return {
                    ok: false,
                    errorCode: "error_verdict_unparseable",
                    error: new VerdictParseError(definition.verdictKind!, [{
                      text: ctx.result.summary,
                      reason: parsed.reason,
                    }]),
                  };
                }
                await ctx.events.append({
                  type: "verdict.recorded",
                  detail: {
                    kind: definition.verdictKind ?? "none",
                    retry_count: 0,
                    // #244: always present, zero included. A missing field
                    // reads as "this verdict never checked"; `0` reads as
                    // "nothing was suppressed" — different facts.
                    suppressed_operations: ticketSuppressions(input).length,
                  },
                });
                return {
                  ok: true,
                  ...(definition.verdictKind === "build" &&
                    (parsed.verdict as BuildVerdict).status === "blocked"
                    ? { terminalStatus: "blocked" as const }
                    : {}),
                };
              },
            }),
        ...(continuation === undefined ? {} : { continuation }),
        beforeProviderTurn: async () => input.input.beforeProviderTurn(input.step),
        ...(input.options.telemetry === undefined ? {} : { telemetry: input.options.telemetry }),
        ...(input.options.parentTaskId === undefined
          ? {}
          : { parentTaskId: input.options.parentTaskId }),
        ...(input.options.signal === undefined ? {} : { signal: input.options.signal }),
        ...(input.options.networkAccess === true ? { networkAccess: true } : {}),
        ...(input.options.now === undefined ? {} : { clock: input.options.now }),
      });
    } catch (error) {
      // The pass executor terminalizes provider evidence before surfacing a
      // typed verdict/persistence error. Recover that exact evidence below;
      // absence means the failure happened before provider admission, so keep
      // the original actionable diagnostic rather than hiding it behind a
      // generic interruption.
      pipelineError = error;
    }
    // Soft-ring budget suspension: the turn is parked, not finished. Handle it
    // BEFORE evidence resolution — its execution record is deliberately not
    // step evidence, so `ticketProviderEvidence` would report "no evidence" and
    // `requireTicketProviderEvidence` would raise a misleading hard failure.
    const parked = suspendedPass(run);
    if (parked !== undefined) {
      return suspendTicketProvider(input, parked);
    }
    evidence = await ticketProviderEvidence(input, definition);
    if (evidence === undefined) {
      if (pipelineError !== undefined) throw pipelineError;
      evidence = await requireTicketProviderEvidence(input, definition);
    }
  }

  if (
    evidence.record.status !== "completed" &&
    evidence.reconciledFromPlanVersion === undefined
  ) {
    return failedTicketProvider(
      input,
      evidence.record.error_code ?? "error_ticket_provider_turn_failed",
      evidence.record.reason,
      evidence,
    );
  }
  if (definition.worktreeAccess === "read") {
    if (
      evidence.record.work_fingerprint_before === null ||
      evidence.record.work_fingerprint_after === null ||
      evidence.record.work_fingerprint_before !== evidence.record.work_fingerprint_after
    ) {
      return failedTicketProvider(
        input,
        "error_ticket_read_only_operation_modified_worktree",
        `${input.step.operation} did not preserve the worktree fingerprint`,
        evidence,
      );
    }
  }

  let verdict: ContractVerdict | BuildVerdict | ReviewVerdict | undefined;
  try {
    verdict = definition.verdictKind === null
      ? undefined
      : parseStoredVerdict(definition.verdictKind, evidence.output);
  } catch (error) {
    if (error instanceof VerdictParseError) {
      return failedTicketProvider(
        input,
        "error_verdict_unparseable",
        error.message,
        evidence,
      );
    }
    throw error;
  }
  const applied = await applyProviderOutcome(input, definition, evidence, verdict);
  const output = await persistTicketStepOutput({
    root: input.options.root,
    plan: input.plan,
    step: input.step,
    execution: input.context,
    status: applied.failure === undefined ? "completed" : "failed",
    payload: {
      operation: input.step.operation,
      runId: evidence.record.run_id,
      providerExecutionStepId: evidence.record.execution_step_id,
      providerOutput: evidence.output,
      ...(evidence.reconciledFromPlanVersion === undefined
        ? {}
        : { reconciledFromPlanVersion: evidence.reconciledFromPlanVersion }),
      verdict: verdict as JsonValue | undefined,
      item: itemOutput(applied.item),
      ...(applied.failure === undefined ? {} : applied.failure),
    },
  });
  if (applied.failure !== undefined) {
    return {
      item: applied.item,
      outcome: {
        status: "failed",
        reasonCode: applied.failure.reasonCode,
        summary: applied.failure.summary,
        artifact: output,
      },
    };
  }
  return { item: applied.item, outcome: { status: "completed", artifact: output } };
}

export interface ProviderEvidence {
  record: ExecutionStepRecord;
  output: string;
  /** The step was settled from a PRIOR plan version's terminal evidence,
   * preserved through an accepted revision (see `reconcilablePriorEvidence`).
   * Every side effect that evidence already produced has been performed; the
   * step must not perform them again. */
  reconciledFromPlanVersion?: number;
}

/** Durable evidence that completes this provider step without spending a new
 *  turn: this plan version's own terminal record, or a prior version's
 *  terminal record preserved through an accepted revision. Single source of
 *  truth for both the step handler and the adopted-revision halt (#175/#202). */
export async function completableProviderEvidence(
  input: TicketProviderEvidenceInput,
  definition: TicketProviderOperationDefinition,
): Promise<ProviderEvidence | undefined> {
  return await ticketProviderEvidence(input, definition)
    ?? await reconciledPriorPlanEvidence(input, definition);
}

/** The facts an accepted revision's repaired provider step is judged on. Split
 *  out from the file reads so the rule itself is one readable, exhaustively
 *  testable decision rather than a shape duplicated per verdict kind — the
 *  duplication is precisely what left the review path uncovered when the build
 *  path was fixed (#175 fixed one half; #202 was the other). */
export interface PriorPlanEvidenceFacts {
  /** Version of the plan now executing. A v1 plan has no prior to reconcile. */
  planVersion: number;
  /** Prior plan version an accepted revision at `planVersion` named this step
   *  in its `affectedStepIds`, or undefined when no such revision exists. */
  repairedFromPlanVersion: number | undefined;
  /** The step is byte-identical to its counterpart in the prior plan. A
   *  revision that changed the step authored NEW work; its evidence is not
   *  this step's evidence. */
  stepPreserved: boolean;
  /** Transport status of the prior version's terminal provider record. */
  priorRecordStatus: ExecutionStepRecord["status"] | undefined;
  /** The prior record's content-bound verdict, already parsed. */
  priorVerdict:
    | { kind: "build"; status: BuildVerdict["status"] }
    | { kind: "review"; findings: number }
    | undefined;
}

/** The prior plan version this step may be settled from, or undefined.
 *
 *  Two shapes qualify, and they are mirror images — which is the point of
 *  stating them together:
 *
 *  - **build** (#175): the transport said `blocked`, but the content-bound
 *    build verdict said `done`. The work happened; only the transport's
 *    terminal was pessimistic.
 *  - **review** (#202): the transport said `completed` and the review verdict
 *    carried findings. The review happened and published its verdict; the
 *    findings are what authorized the revision, and the revision's new `fix`
 *    step is the answer to them. Re-entering the review would re-review an
 *    unchanged commit, produce the same findings, and burn the ticket's whole
 *    revision allowance one turn at a time.
 *
 *  A review verdict with NO findings is deliberately not reconcilable: such a
 *  step would not have failed, so there is nothing for a revision to repair
 *  and evidence claiming otherwise is not trustworthy. */
export function reconcilablePriorEvidence(facts: PriorPlanEvidenceFacts): number | undefined {
  if (facts.planVersion <= 1) return undefined;
  if (facts.repairedFromPlanVersion === undefined) return undefined;
  if (!facts.stepPreserved) return undefined;
  const verdict = facts.priorVerdict;
  if (verdict === undefined) return undefined;
  if (verdict.kind === "build") {
    return facts.priorRecordStatus === "blocked" && verdict.status === "done"
      ? facts.repairedFromPlanVersion
      : undefined;
  }
  return facts.priorRecordStatus === "completed" && verdict.findings > 0
    ? facts.repairedFromPlanVersion
    : undefined;
}

async function ticketProviderEvidence(
  input: TicketProviderEvidenceInput,
  definition: TicketProviderOperationDefinition,
): Promise<ProviderEvidence | undefined> {
  // Budget-suspended records are terminal executions but not step evidence
  // (`settledProviderSteps`). A step legitimately holds one per budget grant,
  // and settling from one would report a parked turn as a finished step.
  const terminal = settledProviderSteps(await readExecutionSteps(
    input.options.root,
    input.plan.episodeId,
  )).filter((record) =>
    record.kind === "provider" &&
    record.plan_version === input.plan.version &&
    record.plan_step_id === input.step.id,
  );
  if (terminal.length > 1) {
    throw new Error(`ticket plan step ${input.step.id} has multiple terminal provider records`);
  }
  const record = terminal[0];
  if (record === undefined) return undefined;
  assertProviderEvidenceMatches(input, definition, record);
  return { record, output: await providerOutput(input, record) };
}

/** Settle a repaired provider step from the prior plan version's preserved
 *  terminal evidence, per `reconcilablePriorEvidence`. Reads the durable facts;
 *  the decision itself lives in that one rule so the build and review halves
 *  can never drift apart again (#175 fixed build; #202 was review). */
async function reconciledPriorPlanEvidence(
  input: TicketProviderEvidenceInput,
  definition: TicketProviderOperationDefinition,
): Promise<ProviderEvidence | undefined> {
  if (input.plan.version <= 1) return undefined;
  if (definition.verdictKind !== "build" && definition.verdictKind !== "review") return undefined;
  const journal = await readEpisodeReplanJournal(input.options.root, input.plan.episodeId);
  const accepted = journal?.records.findLast((record) =>
    record.status === "accepted" &&
    record.revisionVersion === input.plan.version &&
    record.trigger.affectedStepIds.includes(input.step.id));
  if (accepted === undefined) return undefined;
  const priorPlan = await readEpisodePlanVersion(
    input.options.root,
    input.plan.episodeId,
    accepted.trigger.planVersion,
  );
  const priorStep = priorPlan?.steps.find((step): step is ProviderTurnStep =>
    step.kind === "provider_turn" && step.id === input.step.id);
  const stepPreserved =
    priorStep !== undefined && stableHash(priorStep) === stableHash(input.step);
  const terminal = (await readExecutionSteps(input.options.root, input.plan.episodeId))
    .filter((record) =>
      record.kind === "provider" &&
      record.plan_version === accepted.trigger.planVersion &&
      record.plan_step_id === input.step.id);
  if (terminal.length > 1) {
    throw new Error(
      `ticket plan step ${input.step.id} has multiple prior terminal provider records`,
    );
  }
  const record = terminal[0];
  if (!stepPreserved || record === undefined) return undefined;
  assertProviderEvidenceMatches(input, definition, record, accepted.trigger.planVersion);
  const output = await providerOutput(input, record);
  let priorVerdict: PriorPlanEvidenceFacts["priorVerdict"];
  try {
    priorVerdict = definition.verdictKind === "build"
      ? { kind: "build", status: parseStoredVerdict("build", output).status }
      : { kind: "review", findings: parseStoredVerdict("review", output).findings.length };
  } catch {
    // Unparseable stored evidence is not evidence. The step is withheld here
    // and enters normally on the next tick, where the executor turns the same
    // parse error into that step's typed failure.
    return undefined;
  }
  const reconciledFromPlanVersion = reconcilablePriorEvidence({
    planVersion: input.plan.version,
    repairedFromPlanVersion: accepted.trigger.planVersion,
    stepPreserved,
    priorRecordStatus: record.status,
    priorVerdict,
  });
  if (reconciledFromPlanVersion === undefined) return undefined;
  return { record, output, reconciledFromPlanVersion };
}

async function providerOutput(
  input: TicketProviderEvidenceInput,
  record: ExecutionStepRecord,
): Promise<string> {
  let output: string;
  try {
    output = await readFile(
      runPaths(input.options.root, input.options.app.name, record.run_id).output,
      "utf8",
    );
  } catch (error) {
    throw new Error(
      `terminal provider evidence for ${input.step.id} has no recoverable output.md`,
      { cause: error },
    );
  }
  return output;
}

async function requireTicketProviderEvidence(
  input: TicketProviderEvidenceInput,
  definition: TicketProviderOperationDefinition,
): Promise<ProviderEvidence> {
  const evidence = await ticketProviderEvidence(input, definition);
  if (evidence === undefined) {
    throw new Error(`ticket provider step ${input.step.id} interrupted before terminal evidence`);
  }
  return evidence;
}

function assertProviderEvidenceMatches(
  input: TicketProviderEvidenceInput,
  _definition: TicketProviderOperationDefinition,
  record: ExecutionStepRecord,
  expectedPlanVersion = input.plan.version,
): void {
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
    record.assignment_source !== input.step.assignmentSource ||
    record.plan_version !== expectedPlanVersion ||
    record.plan_step_id !== input.step.id
  ) {
    throw new Error(`terminal provider evidence for ${input.step.id} differs from the accepted plan`);
  }
}

async function exactProviderAuthorization(
  input: TicketProviderExecutionInput,
  role: RoleConfig,
): Promise<{ pass: AuthorizedPass; budget: RouteBudget }> {
  const route = await readRouteRecord(input.options.root, input.plan.episodeId);
  const matches = route.authorized_passes.filter((pass) =>
    pass.pipeline === EPISODE_PLAN_EXECUTION_PIPELINE &&
    pass.pass === input.step.id &&
    pass.role === role.name &&
    pass.plan_version === input.context.planVersion &&
    pass.plan_step_id === input.step.id &&
    pass.runtime === input.step.assignment.harness &&
    pass.model === input.step.assignment.model &&
    pass.effort === input.step.assignment.effort &&
    pass.assignment_source === input.step.assignmentSource,
  );
  if (matches.length !== 1) {
    throw new Error(`ticket provider step ${input.step.id} lacks one exact route authorization`);
  }
  return { pass: matches[0]!, budget: { ...route.budget } };
}

async function providerContext(
  input: TicketProviderExecutionInput,
  role: RoleConfig,
): Promise<ContextBundle> {
  return input.options.contextForProviderStep?.({
    request: input.input.request,
    item: structuredClone(input.item),
    step: structuredClone(input.step),
    role,
  }) ?? input.options.plannerContext;
}

function parseStoredVerdict<K extends "contract" | "build" | "review">(
  kind: K,
  output: string,
): VerdictTypes[K] {
  const parsed = parseVerdictEither(kind, output);
  if (parsed.ok) return parsed.verdict;
  throw new VerdictParseError(kind, [{ text: output, reason: parsed.reason }]);
}

/** Apply one provider step's parsed verdict to the ticket: publish what the
 *  verdict requires, move the ticket, and report a typed failure when the
 *  verdict is not a pass. Exported so the #202 detector can assert the
 *  reconciled-review branch performs NO side effect a prior plan version
 *  already performed — the property that keeps an accepted revision from
 *  re-publishing its own findings and bouncing the ticket. */
export async function applyProviderOutcome(
  input: TicketProviderExecutionInput,
  definition: TicketProviderOperationDefinition,
  evidence: ProviderEvidence,
  verdict: ContractVerdict | BuildVerdict | ReviewVerdict | undefined,
): Promise<{
  item: LoopItem;
  failure?: { reasonCode: string; summary: string };
}> {
  const marker = ticketStepMarker(input.context);
  if (definition.verdictKind === "contract") {
    const contractVerdict = verdict as ContractVerdict;
    const contract = [
      renderContractComment(contractVerdict),
      contractMarker(hashTicketBody(input.item.body)),
      marker,
    ].join("\n\n");
    await ensureIssueComment(input.options.gh, input.item.issueNumber, marker, contract);
    return {
      item: {
        ...input.item,
        contract,
        criterionTests: criterionTestMapFromContract(contractVerdict),
      },
    };
  }
  if (definition.verdictKind === "build") {
    const build = verdict as BuildVerdict;
    if (definition.operation === "fix/fix" && build.resolutions !== undefined) {
      await ensureIssueComment(
        input.options.gh,
        input.item.issueNumber,
        marker,
        `${renderFixResolutionsComment(build.resolutions)}\n\n${marker}`,
      );
    }
    if (build.status === "blocked") {
      await ensureIssueComment(
        input.options.gh,
        input.item.issueNumber,
        marker,
        `${renderBuildBlockedComment(build)}\n\n${marker}`,
      );
      const returned = await returnTicket(input.options.gh, input.item);
      return {
        item: returned,
        failure: {
          reasonCode: "ticket_build_blocked",
          summary: `${definition.operation} returned a typed blocked verdict`,
        },
      };
    }
    const resumed = evidence.reconciledFromPlanVersion === undefined
      ? input.item
      : await resumeReconciledTicket(input.options.gh, input.item);
    return { item: { ...resumed, phase: "gates" } };
  }
  if (definition.verdictKind === "review") {
    let review = verdict as ReviewVerdict;
    if (evidence.reconciledFromPlanVersion !== undefined) {
      // #202: this review already ran at the prior plan version. It published
      // its comment, submitted its GitHub review, and returned the ticket —
      // and those findings are exactly what authorized the revision now
      // executing. Re-performing any of it would duplicate the published
      // verdict under a new marker and bounce the ticket back to op:returned,
      // and re-entering the provider turn would re-review an unchanged commit
      // for the same findings. So settle the step from that evidence and hand
      // the findings forward to the revision's repair step.
      //
      // This is the review mirror of the build reconciliation #175 added; the
      // shared rule is `reconcilablePriorEvidence`.
      const resumed = await resumeReconciledTicket(input.options.gh, input.item);
      return { item: { ...resumed, findings: review.findings } };
    }
    const prNumber = requirePrNumber(input.item);
    const reviewedCommit = (await input.options.gh.readPR(prNumber)).headRefOid;
    if (reviewedCommit === undefined) {
      throw new Error(`cannot publish ${definition.operation}: PR #${prNumber} head is unresolved`);
    }
    if (
      definition.operation === "review/verify" &&
      review.findings.length > 0 &&
      review.findings.every(isPrGateEvidenceOnlyFinding)
    ) {
      const repair = await repairPrGateEvidence(input.item, input.options.gh);
      if (repair.satisfied && repair.headRefOid === reviewedCommit) {
        review = resolvePrGateEvidenceFindings(review, repair.artifactReferences);
      }
    }
    const reviewMarker = ticketReviewMarker(
      input.context,
      evidence.record.run_id,
      reviewedCommit,
      review,
    );
    const body =
      `${reviewMarker}\n\n` +
      renderReviewBody([{ pass: input.step.id, verdict: review }], ticketSuppressions(input));
    await ensureIssueComment(
      input.options.gh,
      input.item.issueNumber,
      reviewMarker,
      `${definition.operation === "ship/ship-check" ? "## Ship-check verdict" : "## Structured review verdict"}\n\n${body}`,
    );
    const published = await ensureReview(
      input.options.gh,
      prNumber,
      reviewMarker,
      review.findings.length === 0 ? "approve" : "request_changes",
      body,
      reviewedCommit,
    );
    if (review.findings.length === 0) {
      const authorized = latestActionableReview(
        [published],
        prNumber,
        input.options.authorization,
      );
      if (authorized?.state !== "APPROVED" || authorized.commitId !== reviewedCommit) {
        throw new Error(
          `${definition.operation} review was published but did not authorize exact commit ${reviewedCommit}`,
        );
      }
    }
    if (review.findings.length > 0) {
      const returned = await returnTicket(input.options.gh, {
        ...input.item,
        findings: review.findings,
        cycles: input.item.cycles + 1,
      });
      return {
        item: returned,
        failure: {
          reasonCode: definition.operation === "ship/ship-check"
            ? "ticket_ship_check_findings"
            : "ticket_review_findings",
          summary: `${definition.operation} produced ${review.findings.length} finding(s); a plan revision is required`,
        },
      };
    }
    return { item: input.item };
  }
  // Diagnostic output is deliberately artifact-only. Its read-only property
  // was verified against durable before/after worktree fingerprints above.
  return { item: input.item };
}

/** Critical operations this ticket asked for and did not get (#244).
 *
 *  Read at PUBLICATION time rather than carried on the turn, because the turn
 *  that asked and the turn that reports are different turns: the approval is
 *  decided (or expires) while the asking turn is parked, and the RESUMED turn
 *  is the one that publishes a verdict. Reading the ticket's durable record is
 *  what joins them. Unreadable state is never fatal here — a verdict must
 *  still publish — but it also must not silently claim "none", so the read
 *  failure surfaces as its own row. */
function ticketSuppressions(input: {
  options: { root: string; app: Pick<AppEntry, "name"> };
  item: LoopItem;
}): SuppressedOperation[] {
  try {
    return readTicketClaimState(
      input.options.root,
      input.options.app.name,
      input.item.issueNumber,
    ).suppressed ?? [];
  } catch {
    return [{
      approvalId: "unreadable",
      rule: "suppression-record-unreadable",
      actionSha256: "0".repeat(64),
      tool: "cormidia.ticket-claim-state",
      disposition: "denied",
      reason:
        "the ticket's suppression record could not be read; treat this verdict as unverified " +
        "for suppressed critical operations",
      at: (input as { options: { now?: () => Date } }).options.now?.().toISOString()
        ?? new Date().toISOString(),
    }];
  }
}

/** The parked pass of a run whose per-turn budget ring fired, or undefined. */
function suspendedPass(run: PipelineRunResult | undefined): PassRunRecord | undefined {
  const last = run?.passes.at(-1);
  return last?.result.errorCode === ERROR_TURN_BUDGET_SUSPENDED ? last : undefined;
}

/**
 * Park a ticket on a soft-ring budget stop.
 *
 * The current outcome for `cap_stop` was the harshest of the loop's three —
 * `op:returned`, which burns a claim — and that is backwards for a turn whose
 * only problem is that its next step is unfunded while the episode can still
 * afford one. This routes it to the SAME pause `blockedOnApproval` uses for a
 * gate escalation (#104's machinery, PURPOSE v2.15 (1): one mechanism, two
 * triggers):
 *
 *  - the exact native session and both fingerprints are checkpointed, so the
 *    resumed turn continues rather than repeating a completed pass;
 *  - one item enters the existing approvals queue, carrying what resuming costs
 *    before any new work happens;
 *  - `op:blocked`, and `finishTicketClaim` records an approval pause — which is
 *    what keeps the claim: a pause is not a merit failure (#104).
 *
 * Ordering is deliberate and mirrors F-PT-003: the pause is made durable on the
 * item BEFORE the queue item exists. A crash in between leaves a parked ticket
 * with no item, which the next tick re-raises idempotently by
 * `turnBudgetEscalationKey`; the reverse order would leave a decidable item for
 * a turn nothing can resume.
 */
async function suspendTicketProvider(
  input: TicketProviderExecutionInput,
  parked: PassRunRecord,
): Promise<TicketProviderStepResult> {
  // Presentation detail only: the stop record enriches the operator comment and
  // the queue item. Losing it must never cost the PAUSE itself, which is the
  // one thing standing between a parked paid session and re-running that work.
  let stop: TurnBudgetStop | undefined;
  try {
    stop = (await readEnvelope(
      input.options.root,
      input.options.app.name,
      parked.runId,
    )).budget_stop;
  } catch {
    stop = undefined;
  }
  const usage = parked.result.usage;
  const resume = resumeCostEstimate(usage);
  const continuation: NonNullable<LoopItem["continuation"]> = {
    pipeline: EPISODE_PLAN_EXECUTION_PIPELINE,
    pass: input.step.id,
    role: input.step.role,
    assignment: parked.assignment,
    ...(parked.planMetadata.plan_version === undefined
      ? {}
      : {
          planVersion: parked.planMetadata.plan_version,
          planStepId: parked.planMetadata.plan_step_id,
        }),
    session: parked.result.session,
    completedPasses: [],
    contextFingerprint: parked.contextFingerprint,
    workFingerprint: parked.workFingerprint,
    runId: parked.runId,
    pausedAt: (input.options.now?.() ?? new Date()).toISOString(),
    decisions: [],
    pauseCostUsd: usage.costUsd,
    pauseKind: "budget",
  };
  const blocked = await blockTicket(input.options.gh, {
    ...input.item,
    continuation,
  });

  // The queue write is best-effort BY DESIGN, and the ordering above is why:
  // the pause is durable first, so a failure here leaves a parked ticket with
  // no item — which the next tick re-raises idempotently by
  // `turnBudgetEscalationKey`. Letting this throw would unwind the pause and
  // hand the ticket to the return path, discarding the session it just paid
  // for. The reverse ordering would be worse still: a decidable item for a turn
  // nothing can resume.
  const escalation = await raiseEscalationBestEffort(input, {
    app: input.options.app.name,
    role: input.step.role,
    ticketRef: input.item.ticketRef,
    ...(input.item.turnId === undefined ? {} : { turnId: input.item.turnId }),
    episodeId: input.plan.episodeId,
    runId: parked.runId,
    pipeline: EPISODE_PLAN_EXECUTION_PIPELINE,
    pass: input.step.id,
    workdir: requireWorktree(input.item),
    stop: {
      dimension: stop?.dimension ?? "equivalent_cost_usd",
      cap: stop?.cap ?? input.step.maxTurnBudgetUsd,
      observed: stop?.observed ?? usage.costUsd,
      costMeasurement: stop?.cost_measurement ?? "unavailable",
      episodeRemaining: stop?.episode_remaining ?? null,
    },
    spentUsd: usage.costUsd,
    resume,
  });

  const item: LoopItem = {
    ...blocked,
    continuation: {
      ...continuation,
      ...(escalation === undefined ? {} : { pauseApprovalId: escalation.id }),
    },
  };
  const summary =
    `${input.step.operation} suspended on its per-turn budget ` +
    `(${stop?.dimension ?? "equivalent_cost_usd"} ${stop?.observed ?? usage.costUsd}/` +
    `${stop?.cap ?? input.step.maxTurnBudgetUsd}); session ${parked.result.session.id} preserved. ` +
    (escalation === undefined
      ? "No queue item is recorded for this pause yet; the next tick converges it."
      : `Approval ${escalation.id} authorizes the next turn; resuming re-establishes context first ` +
        `(${resume.basis === "unavailable" ? "resume cost unavailable" : `~$${resume.usd?.toFixed(4)}`}).`);
  await input.options.gh.commentIssue(
    input.item.issueNumber,
    ticketBudgetSuspensionComment({
      operation: input.step.operation,
      summary,
      resume,
      ...(escalation === undefined ? {} : { approvalId: escalation.id }),
    }),
  );
  return {
    item,
    outcome: {
      status: "suspended",
      reasonCode: ERROR_TURN_BUDGET_SUSPENDED,
      summary,
    },
  };
}

/** The pause is already durable; this only converges the queue. A store write
 * that fails is retried by the next tick against the same idempotency key. */
async function raiseEscalationBestEffort(
  input: TicketProviderExecutionInput,
  escalation: TurnBudgetEscalationInput,
): Promise<ApprovalItem | undefined> {
  if (input.options.raiseTurnBudgetEscalation === undefined) return undefined;
  try {
    return await input.options.raiseTurnBudgetEscalation(escalation);
  } catch {
    return undefined;
  }
}

function ticketBudgetSuspensionComment(input: {
  operation: string;
  summary: string;
  resume: ResumeCostEstimate;
  approvalId?: string;
}): string {
  return [
    "## Turn suspended: per-turn budget",
    "",
    input.summary,
    "",
    "**Durable work and the exact provider session are preserved.** No claim was consumed —",
    "a budget pause is not a merit failure.",
    "",
    "**Resume cost before any new work:** " +
      (input.resume.basis === "unavailable"
        ? "unavailable (the parked turn reported no cache split)"
        : `~$${input.resume.usd?.toFixed(4)} to re-establish context ` +
          `(${input.resume.cacheReadTokens} cache-read + ${input.resume.cacheCreationTokens} cache-write tokens)`),
    "",
    input.approvalId === undefined
      ? "Decide it with `cormidia approvals review`."
      : `Decide approval \`${input.approvalId}\` with \`cormidia approvals review\`. ` +
        "Approving resumes this exact session; denying returns the ticket.",
  ].join("\n");
}

/** Project the pause onto the ticket's labels. Idempotent, and it never
 * touches a ticket already parked terminal. */
async function blockTicket(gh: GhOps, item: LoopItem): Promise<LoopItem> {
  const durable = await Promise.all(deliveryUnitIssueNumbers(item).map((number) => gh.readIssue(number)));
  const transitions = durable.map((issue) => issue.labels.find((label) =>
    ["op:ready", "op:building", "op:in-review"].includes(label)));
  const distinct = [...new Set(transitions.filter((value): value is string => value !== undefined))];
  if (distinct.length > 1) throw new Error("delivery unit has divergent labels before block");
  if (distinct[0] !== undefined) {
    await swapDeliveryUnitLabel(item, gh, distinct[0], "op:blocked");
  } else {
    for (const issue of durable) {
      if (!issue.labels.includes("op:blocked")) await gh.addLabel(issue.number, "op:blocked");
    }
  }
  const labels = (await gh.readIssue(item.issueNumber)).labels;
  return { ...item, labels, phase: "blocked" };
}

async function failedTicketProvider(
  input: TicketProviderExecutionInput,
  reasonCode: string,
  summary: string,
  evidence?: ProviderEvidence,
): Promise<TicketStepResult> {
  const item = await returnTicket(input.options.gh, input.item);
  const artifact = await persistTicketStepOutput({
    root: input.options.root,
    plan: input.plan,
    step: input.step,
    execution: input.context,
    status: "failed",
    payload: {
      operation: input.step.operation,
      reasonCode,
      summary,
      ...(evidence === undefined
        ? {}
        : {
            runId: evidence.record.run_id,
            providerExecutionStepId: evidence.record.execution_step_id,
            providerOutput: evidence.output,
          }),
      item: itemOutput(item),
    },
  });
  return {
    item,
    outcome: { status: "failed", reasonCode, summary, artifact },
  };
}

async function executeTicketMechanicalStep(input: {
  options: TicketEpisodeRuntimeOptions;
  input: TicketEpisodeExecutionRequest;
  item: LoopItem;
  plan: EpisodePlan;
  step: MechanicalGateStep;
  context: EpisodeStepExecutionContext;
}): Promise<TicketStepResult> {
  if (!isTicketMechanicalGateKind(input.step.gate)) {
    const returned = await returnTicket(input.options.gh, input.item);
    return {
      item: returned,
      outcome: {
        status: "failed",
        reasonCode: "ticket_mechanical_gate_unknown",
        summary: `ticket mechanical gate ${input.step.gate} is not registered`,
      },
    };
  }
  const priorOutput = await readTicketStepOutput({
    root: input.options.root,
    plan: input.plan,
    step: input.step,
    execution: input.context,
  });
  if (priorOutput !== undefined) {
    const restored = restoreItemFromStepOutput(
      input.item,
      priorOutput,
      input.options.release,
    );
    const artifact = ticketStepOutputArtifact(
      input.options.root,
      input.plan,
      input.step,
      priorOutput,
    );
    if (priorOutput.status === "completed") {
      return { item: restored, outcome: { status: "completed", artifact } };
    }
    const failure = failureFromStepOutput(priorOutput);
    return {
      item: restored,
      outcome: { status: "failed", ...failure, artifact },
    };
  }
  const before = structuredClone(input.item);
  let item = input.item;
  let failure: { reasonCode: string; summary: string } | undefined;
  const commands = gateCommandsForWorktree(input.options.commands, item.worktree);
  const runlog = {
    root: input.options.root,
    app: input.options.app.name,
    ticket: input.item.ticketRef,
    traceId: input.context.executionId,
    episodeId: input.plan.episodeId,
    ...(input.options.now === undefined ? {} : { clock: input.options.now }),
  };
  const recovered = await recoverTicketMechanicalBoundary(input);
  if (recovered !== undefined) {
    item = recovered.item;
    failure = recovered.failure;
  } else switch (input.step.gate) {
    case "ticket/provision":
      item = await advanceProvisionSetup(item, {
        gh: input.options.gh,
        commands,
        runlog,
      });
      if (item.phase === "returned") {
        failure = {
          reasonCode: "ticket_provision_failed",
          summary: "worktree provision setup failed; no provider remediation was launched",
        };
      }
      break;
    case "ticket/gates-and-pr": {
      item = await advanceGates(item, {
        gh: input.options.gh,
        policy: input.options.policy,
        commands,
        base: input.input.request.base,
        criteria: parseAcceptanceCriteria(item.body),
        criterionTests: item.criterionTests ?? {},
        runlog,
        // A failed gate is a typed plan failure. The old hidden fix callback is
        // intentionally absent and the explicit cap is zero.
        maxRemediationAttempts: 0,
      });
      if (item.phase !== "reviewing") {
        failure = {
          reasonCode: "ticket_quality_gate_failed",
          summary: "quality gates failed; an explicit fix step or plan revision is required",
        };
      } else {
        await input.input.deliveryLifecycle?.afterGates(structuredClone(item), input.plan);
      }
      break;
    }
    case "ticket/security":
    case "ticket/rollback":
    case "ticket/performance":
      // The ticket-plan validator proves the required typed provider evidence
      // is on this dependency path. The DAG executor proves those ancestors
      // completed before this durable join is recorded.
      break;
    case "ticket/data-integrity": {
      const lastGateRun = item.gateResults.at(-1);
      if (lastGateRun?.status !== "pass") {
        failure = {
          reasonCode: "ticket_data_integrity_evidence_missing",
          summary: "data-integrity floor requires a completed passing ticket quality-gate run",
        };
      }
      break;
    }
    case "ticket/review-authorization":
      item = await advanceReviewing(item, {
        gh: input.options.gh,
        maxCycles: 0,
        ...(input.options.authorization === undefined
          ? {}
          : { authorization: input.options.authorization }),
      });
      if (item.phase !== "shipping") {
        item = await returnTicket(input.options.gh, item);
        failure = {
          reasonCode: "ticket_review_not_authorized",
          summary: "independent review did not authorize the exact current revision",
        };
      } else {
        await input.input.deliveryLifecycle?.afterReview(structuredClone(item), input.plan);
      }
      break;
    case "ticket/ship":
      await input.input.deliveryLifecycle?.beforeShip(structuredClone(item), input.plan);
      item = await advanceShipping(item, {
        gh: input.options.gh,
        localRepo: input.input.request.localRepo,
        policy: input.options.policy,
        commands,
        base: input.input.request.base,
        criteria: parseAcceptanceCriteria(item.body),
        criterionTests: item.criterionTests ?? {},
        ...(input.options.release === undefined ? {} : { release: input.options.release }),
      });
      if (item.phase !== "merged") {
        item = await returnTicket(input.options.gh, item);
        failure = {
          reasonCode: "ticket_ship_failed",
          summary: "ship gate or merge failed; no implicit provider remediation was launched",
        };
      }
      break;
    case "release/handoff":
      if (item.phase !== "merged") {
        failure = {
          reasonCode: "ticket_release_handoff_before_merge",
          summary: "release handoff requires a durably merged ticket",
        };
      }
      break;
    default:
      return assertNeverTicketGate(input.step.gate);
  }
  const output = await persistTicketStepOutput({
    root: input.options.root,
    plan: input.plan,
    step: input.step,
    execution: input.context,
    status: failure === undefined ? "completed" : "failed",
    payload: {
      gate: input.step.gate,
      before: itemOutput(before),
      after: itemOutput(item),
      ...(failure === undefined ? {} : failure),
    },
  });
  return failure === undefined
    ? { item, outcome: { status: "completed", artifact: output } }
    : {
        item,
        outcome: {
          status: "failed",
          reasonCode: failure.reasonCode,
          summary: failure.summary,
          artifact: output,
        },
      };
}

async function recoverTicketMechanicalBoundary(input: {
  options: TicketEpisodeRuntimeOptions;
  input: TicketEpisodeExecutionRequest;
  item: LoopItem;
  plan: EpisodePlan;
  step: MechanicalGateStep;
  context: EpisodeStepExecutionContext;
}): Promise<{
  item: LoopItem;
  failure?: { reasonCode: string; summary: string };
} | undefined> {
  const durableIssue = await input.options.gh.readIssue(input.item.issueNumber);
  if (
    input.step.gate === "ticket/provision" &&
    durableIssue.labels.includes("op:returned")
  ) {
    return {
      item: { ...input.item, labels: durableIssue.labels, phase: "returned" },
      failure: {
        reasonCode: "ticket_provision_failed",
        summary: "worktree provision setup previously failed; recovered without rerunning setup",
      },
    };
  }
  const branch = input.item.branch;
  if (branch === undefined) return undefined;
  if (
    input.step.gate === "ticket/gates-and-pr" &&
    durableIssue.labels.includes("op:in-review")
  ) {
    const pull = (await input.options.gh.listPRsForBranch(branch, { state: "open" }))[0];
    if (pull !== undefined) {
      return {
        item: {
          ...input.item,
          labels: durableIssue.labels,
          phase: "reviewing",
          prNumber: pull.number,
        },
      };
    }
  }
  if (input.step.gate === "ticket/ship") {
    const merged = (await input.options.gh.listPRsForBranch(branch, { state: "merged" }))
      .find((pull) => input.item.prNumber === undefined || pull.number === input.item.prNumber);
    if (merged !== undefined) {
      return {
        item: await recoverAlreadyMergedTicket(
          { ...input.item, prNumber: merged.number },
          {
            gh: input.options.gh,
            localRepo: input.input.request.localRepo,
            ...(input.options.release === undefined ? {} : { release: input.options.release }),
          },
        ),
      };
    }
  }
  return undefined;
}

function assertNeverTicketGate(value: never): never {
  throw new Error(`unreachable ticket gate ${String(value)}`);
}

interface TicketStepOutputRecord {
  schemaVersion: 1;
  episodeId: string;
  planVersion: number;
  planHash: string;
  stepId: string;
  stepHash: string;
  executionId: string;
  status: "completed" | "failed";
  expectedOutputs: Array<{ id: string; kind: string; required: boolean }>;
  payload: JsonValue;
  payloadSha256: string;
}

async function readTicketStepOutput(input: {
  root: string;
  plan: EpisodePlan;
  step: ProviderTurnStep | MechanicalGateStep;
  execution: EpisodeStepExecutionContext;
}): Promise<TicketStepOutputRecord | undefined> {
  const path = ticketStepOutputPath(input.root, input.plan, input.step.id);
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new Error(`ticket step output ${input.step.id} is unreadable`, { cause: error });
  }
  if (!isTicketStepOutputRecord(value)) {
    throw new Error(`ticket step output ${input.step.id} has invalid structure`);
  }
  if (
    value.episodeId !== input.plan.episodeId ||
    value.planVersion !== input.plan.version ||
    value.planHash !== input.execution.planHash ||
    value.stepId !== input.step.id ||
    value.stepHash !== input.execution.stepHash ||
    value.executionId !== input.execution.executionId ||
    value.payloadSha256 !== stableHash(value.payload)
  ) {
    throw new Error(`ticket step output ${input.step.id} differs from its durable execution`);
  }
  return value;
}

async function persistTicketStepOutput(input: {
  root: string;
  plan: EpisodePlan;
  step: ProviderTurnStep | MechanicalGateStep;
  execution: EpisodeStepExecutionContext;
  status: "completed" | "failed";
  payload: Record<string, unknown>;
}): Promise<{ ref: string; sha256: string }> {
  const payload = jsonValue(input.payload, `ticket step ${input.step.id} output`);
  const record: TicketStepOutputRecord = {
    schemaVersion: 1,
    episodeId: input.plan.episodeId,
    planVersion: input.plan.version,
    planHash: input.execution.planHash,
    stepId: input.step.id,
    stepHash: input.execution.stepHash,
    executionId: input.execution.executionId,
    status: input.status,
    expectedOutputs: input.step.expectedOutputs.map((entry) => ({ ...entry })),
    payload,
    payloadSha256: stableHash(payload),
  };
  const relative = join(
    "ticket-step-outputs",
    `v${input.plan.version}`,
    `${hashedFileStem(input.step.id)}.json`,
  );
  const path = join(efficiencyEpisodeDir(input.root, input.plan.episodeId), relative);
  const contents = `${JSON.stringify(record, null, 2)}\n`;
  const won = await writeLoopFileOnce(path, contents);
  if (!won) {
    const existing = await readFile(path, "utf8");
    if (existing !== contents) {
      throw new Error(`ticket step output conflict for ${input.step.id}`);
    }
  }
  return { ref: relative, sha256: stableHash(record) };
}

function ticketStepOutputPath(root: string, plan: EpisodePlan, stepId: string): string {
  return join(
    efficiencyEpisodeDir(root, plan.episodeId),
    "ticket-step-outputs",
    `v${plan.version}`,
    `${hashedFileStem(stepId)}.json`,
  );
}

function ticketStepOutputArtifact(
  root: string,
  plan: EpisodePlan,
  step: ProviderTurnStep | MechanicalGateStep,
  record: TicketStepOutputRecord,
): { ref: string; sha256: string } {
  const path = ticketStepOutputPath(root, plan, step.id);
  const prefix = `${efficiencyEpisodeDir(root, plan.episodeId)}/`;
  return {
    ref: path.startsWith(prefix) ? path.slice(prefix.length) : path,
    sha256: stableHash(record),
  };
}

function isTicketStepOutputRecord(value: unknown): value is TicketStepOutputRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record["schemaVersion"] === 1 &&
    typeof record["episodeId"] === "string" &&
    Number.isInteger(record["planVersion"]) &&
    typeof record["planHash"] === "string" &&
    typeof record["stepId"] === "string" &&
    typeof record["stepHash"] === "string" &&
    typeof record["executionId"] === "string" &&
    (record["status"] === "completed" || record["status"] === "failed") &&
    Array.isArray(record["expectedOutputs"]) &&
    typeof record["payloadSha256"] === "string" &&
    record["payload"] !== undefined;
}

function failureFromStepOutput(
  output: TicketStepOutputRecord,
): { reasonCode: string; summary: string } {
  const payload = output.payload;
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error(`failed ticket step output ${output.stepId} has no typed failure payload`);
  }
  const reasonCode = payload["reasonCode"];
  const summary = payload["summary"];
  if (typeof reasonCode !== "string" || typeof summary !== "string") {
    throw new Error(`failed ticket step output ${output.stepId} has no typed reason`);
  }
  return { reasonCode, summary };
}

function restoreItemFromStepOutput(
  item: LoopItem,
  output: TicketStepOutputRecord,
  release: ReleaseConfig | undefined,
): LoopItem {
  const payload = output.payload;
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return item;
  const candidate = payload["after"] ?? payload["item"];
  if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) return item;
  const snapshot = candidate as Record<string, JsonValue>;
  const phase = snapshot["phase"];
  const labels = snapshot["labels"];
  const prNumber = snapshot["prNumber"];
  const approvedCommitId = snapshot["approvedCommitId"];
  const cycles = snapshot["cycles"];
  const remediationAttempts = snapshot["remediationAttempts"];
  const releaseSnapshot = snapshot["releaseTrigger"];
  const restored: LoopItem = {
    ...item,
    ...(typeof phase === "string" && [
      "ready", "building", "gates", "reviewing", "shipping", "merged", "returned", "blocked",
    ].includes(phase)
      ? { phase: phase as LoopItem["phase"] }
      : {}),
    ...(Array.isArray(labels) && labels.every((entry) => typeof entry === "string")
      ? { labels: labels as string[] }
      : {}),
    ...(typeof prNumber === "number" ? { prNumber } : {}),
    ...(typeof approvedCommitId === "string" ? { approvedCommitId } : {}),
    ...(typeof cycles === "number" ? { cycles } : {}),
    ...(typeof remediationAttempts === "number" ? { remediationAttempts } : {}),
  };
  // Re-derive the app's current release command the same way the loop built it
  // (app-declared for `command`, the git tag push for `trigger: tag`) so a
  // durable trigger only restores when it still matches the app's mechanism
  // and the milestone's declared version.
  const expectedCommand = release !== undefined ? resolveReleaseCommand(release, item.body) : undefined;
  if (
    releaseSnapshot !== null &&
    typeof releaseSnapshot === "object" &&
    !Array.isArray(releaseSnapshot) &&
    release !== undefined &&
    expectedCommand !== undefined &&
    releaseSnapshot["kind"] === release.kind &&
    releaseSnapshot["owner"] === release.owner &&
    releaseSnapshot["commandSha256"] === fingerprint(expectedCommand)
  ) {
    restored.releaseTrigger = {
      kind: release.kind,
      owner: release.owner,
      command: expectedCommand,
    };
  }
  return restored;
}

async function readPlanOutput(
  root: string,
  plan: EpisodePlan,
  outputId: string,
): Promise<TicketStepOutputRecord> {
  const owners = plan.steps.filter((step) =>
    step.expectedOutputs.some((output) => output.id === outputId),
  );
  if (owners.length !== 1) throw new Error(`plan-output:${outputId} does not have one owner`);
  const owner = owners[0]!;
  const path = join(
    efficiencyEpisodeDir(root, plan.episodeId),
    "ticket-step-outputs",
    `v${plan.version}`,
    `${hashedFileStem(owner.id)}.json`,
  );
  const value = JSON.parse(await readFile(path, "utf8")) as TicketStepOutputRecord;
  if (
    value.schemaVersion !== 1 ||
    value.episodeId !== plan.episodeId ||
    value.planVersion !== plan.version ||
    value.planHash !== episodePlanHash(plan) ||
    value.stepId !== owner.id ||
    value.status !== "completed" ||
    value.payloadSha256 !== stableHash(value.payload)
  ) {
    throw new Error(`plan-output:${outputId} has invalid durable evidence`);
  }
  return value;
}

function renderTicketProviderBrief(
  input: TicketProviderExecutionInput,
  definition: TicketProviderOperationDefinition,
  dependencyOutputs: readonly TicketStepOutputRecord[],
): string {
  return [
    `# Ticket EpisodePlan step ${input.step.id}`,
    "",
    `Operation: ${input.step.operation}`,
    `Governed pipeline/pass: ${definition.pipeline ?? "diagnostic"}/${definition.pass ?? "brief-only"}`,
    `Access: ${definition.worktreeAccess}`,
    `Ticket: ${input.item.ticketRef} ${input.item.title}`,
    `Target repo: ${input.item.targetRepo}`,
    `Worktree: ${requireWorktree(input.item)}`,
    `Base revision: ${input.input.request.base.ref}`,
    "",
    "## Step objective",
    input.step.objective,
    "",
    "## Ticket body",
    input.item.body,
    "",
    "## Accepted dependencies",
    input.step.dependsOn.join(", ") || "None.",
    "",
    "## Required input references",
    JSON.stringify(input.step.inputRefs, null, 2),
    ...(dependencyOutputs.length === 0
      ? []
      : [
          "",
          "## Durable dependency outputs",
          JSON.stringify(dependencyOutputs, null, 2),
        ]),
    "",
    "## Expected outputs",
    JSON.stringify(input.step.expectedOutputs, null, 2),
    "",
    definition.worktreeAccess === "read"
      ? "This is read-only: do not change tracked or untracked worktree state."
      : "Change only what this bounded operation requires; do not broaden scope.",
  ].join("\n");
}

async function requiredPlanOutputs(
  input: TicketProviderExecutionInput,
): Promise<TicketStepOutputRecord[]> {
  const outputs: TicketStepOutputRecord[] = [];
  let bytes = 0;
  for (const ref of input.step.inputRefs) {
    if (!ref.ref.startsWith("plan-output:")) continue;
    const output = await readPlanOutput(
      input.options.root,
      input.plan,
      ref.ref.slice("plan-output:".length),
    );
    const rendered = JSON.stringify(output);
    bytes += Buffer.byteLength(rendered);
    if (bytes > 512 * 1024) {
      throw new Error(`ticket step ${input.step.id} dependency outputs exceed 512 KiB`);
    }
    outputs.push(output);
  }
  return outputs;
}

function ticketProviderRunId(
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

function ticketRuntimeCapabilities(step: ProviderTurnStep): RuntimeCapability[] {
  return [...new Set<RuntimeCapability>([
    "tool_gate",
    "cancellation",
    "session_resume",
    ...step.requiredCapabilities.filter(isRuntimeCapability),
  ])].sort();
}

function ticketStepMarker(execution: EpisodeStepExecutionContext): string {
  return `<!-- cormidia:ticket-episode-step execution-id=${execution.executionId} plan-version=${execution.planVersion} step-id=${execution.stepId} -->`;
}

function ticketReviewMarker(
  execution: EpisodeStepExecutionContext,
  providerRunId: string,
  reviewedCommit: string,
  verdict: ReviewVerdict,
): string {
  const contentSha256 = stableHash({
    executionId: execution.executionId,
    providerRunId,
    reviewedCommit,
    verdict,
  });
  return `<!-- cormidia:ticket-review execution-id=${execution.executionId} reviewed-commit=${reviewedCommit} content-sha256=${contentSha256} -->`;
}

function resolvePrGateEvidenceFindings(
  review: ReviewVerdict,
  artifactReferences: readonly string[],
): ReviewVerdict {
  const resolved = review.findings.map((finding) =>
    `${finding.location}: ${finding.description} -> ${finding.action}`
  );
  return {
    verdict: "approve",
    findings: [],
    review: {
      rationale: [
        review.review.rationale,
        `Cormidia deterministically resolved ${review.findings.length} PR-evidence-only finding(s) ` +
          "by attaching the already-green gate capture; no command reran and the reviewed commit did not change.",
      ].join(" "),
      evidence: [
        ...review.review.evidence,
        {
          claim: "Original evidence-only findings resolved",
          evidence: resolved.join(" | "),
        },
        {
          claim: "Content-addressed green-gate evidence attached to the PR description",
          evidence: artifactReferences.join(", "),
        },
      ],
      notReviewed: review.review.notReviewed,
    },
  };
}

async function ensureIssueComment(
  gh: GhOps,
  issueNumber: number,
  marker: string,
  body: string,
): Promise<void> {
  const comments = await gh.listIssueComments(issueNumber);
  if (comments.some((comment) => comment.body.includes(marker))) return;
  await gh.commentIssue(issueNumber, body);
}

async function ensureReview(
  gh: GhOps,
  prNumber: number,
  marker: string,
  state: "approve" | "request_changes",
  body: string,
  expectedCommit: string,
): Promise<GhReview> {
  const reviews = await gh.listReviews(prNumber);
  const existing = reviews.filter((review) => review.body.includes(marker));
  if (existing.length > 1) {
    throw new Error(`review delivery ${marker} is duplicated on PR #${prNumber}`);
  }
  if (existing.length === 0) {
    await gh.createReview(prNumber, { state, body, expectedCommit });
  }
  // The create call can only acknowledge what the client attempted. Re-read
  // GitHub's review record so a concurrent head advance is caught from the
  // commit GitHub actually stamped, never a synthesized expected commit.
  const delivered = (await gh.listReviews(prNumber)).filter((review) =>
    review.body.includes(marker),
  );
  if (delivered.length !== 1) {
    throw new Error(
      `review delivery ${marker} has ${delivered.length} remote effects on PR #${prNumber}; expected exactly one`,
    );
  }
  const review = delivered[0]!;
  if (review.commitId !== expectedCommit) {
    throw new Error(
      `review delivery on PR #${prNumber} is bound to ${review.commitId ?? "an unresolved commit"}, expected ${expectedCommit}`,
    );
  }
  if (!publishedReviewBodyMatches(review.body, body)) {
    throw new Error(`review delivery on PR #${prNumber} does not match its content-bound verdict`);
  }
  return review;
}

function publishedReviewBodyMatches(actual: string, expected: string): boolean {
  if (actual === expected) return true;
  const prefix = expected.trimEnd();
  if (!actual.startsWith(prefix)) return false;
  const suffix = actual.slice(prefix.length);
  return /^\n\n<!-- cormidia:self-(?:approval|changes-requested)-fallback(?: sig=[a-f0-9]{64})? -->\n$/.test(suffix);
}

async function returnTicket(gh: GhOps, item: LoopItem): Promise<LoopItem> {
  if (item.phase === "merged" || item.phase === "returned") return item;
  const durable = await Promise.all(deliveryUnitIssueNumbers(item).map((number) => gh.readIssue(number)));
  const transitions = durable.map((issue) => issue.labels.find((label) =>
    ["op:ready", "op:building", "op:in-review", "op:blocked"].includes(label)));
  const distinct = [...new Set(transitions.filter((value): value is string => value !== undefined))];
  if (distinct.length > 1) throw new Error("delivery unit has divergent labels before return");
  if (distinct[0] !== undefined) {
    await swapDeliveryUnitLabel(item, gh, distinct[0], "op:returned");
  } else {
    for (const issue of durable) {
      if (!issue.labels.includes("op:returned")) await gh.addLabel(issue.number, "op:returned");
    }
  }
  const labels = (await gh.readIssue(item.issueNumber)).labels;
  return { ...item, labels, phase: "returned" };
}

async function resumeReconciledTicket(gh: GhOps, item: LoopItem): Promise<LoopItem> {
  if (item.phase === "merged" || item.phase === "blocked") {
    throw new Error(
      `accepted revision cannot resume terminal ticket ${item.ticketRef} from ${item.phase}`,
    );
  }
  const durable = await Promise.all(deliveryUnitIssueNumbers(item).map((number) => gh.readIssue(number)));
  if (durable.every((issue) => issue.labels.includes("op:returned"))) {
    await swapDeliveryUnitLabel(item, gh, "op:returned", "op:building");
  } else if (!durable.every((issue) => issue.labels.includes("op:building"))) {
    throw new Error(
      `accepted revision cannot resume ticket ${item.ticketRef} from labels ` +
      durable.map((issue) => `#${issue.number}:${issue.labels.join(",")}`).join("; "),
    );
  }
  const labels = (await gh.readIssue(item.issueNumber)).labels;
  return { ...item, labels, phase: "building" };
}

function ticketPlanningCatalog(): JsonValue {
  return {
    providerOperations: Object.values(TICKET_PROVIDER_OPERATION_CATALOG).map((entry) => ({
      operation: entry.operation,
      role: entry.role,
      execution: entry.execution,
      pipeline: entry.pipeline,
      pass: entry.pass,
      template: entry.template,
      verdictKind: entry.verdictKind,
      worktreeAccess: entry.worktreeAccess,
    })),
    mechanicalGates: Object.entries(TICKET_MECHANICAL_GATE_CATALOG).map(([gate, entry]) => ({
      gate,
      handler: entry.handler,
      // Durable inputs the handler reads but never produces. A plan holding
      // the gate without an ancestor producing them is unsatisfiable, so the
      // executable catalog states them alongside the handler (ISSUE-024).
      requiredPlanInputs: entry.requiredPlanInputs.map((requirement) => ({
        input: requirement.input,
        producedBy: requirement.producedBy,
        consumedBy: requirement.consumedBy,
      })),
    })),
    planOutputRefPrefix: "plan-output:",
    providerTransportPipeline: EPISODE_PLAN_EXECUTION_PIPELINE,
  };
}

function mergeTicketSafetyFacts(
  labels: readonly string[],
  ticketRef: string,
  creatorScope: CreatorEpisodeScope | undefined,
): SafetyFact[] {
  return mergeEpisodeSafetyFacts(
    [{
      kind: "independent_review" as const,
      evidenceRefs: ["ticket:independent-delivery-review"],
    }],
    safetyFactsFromTicketLabels(labels, ticketRef),
    creatorScope?.safetyFacts ?? [],
  );
}

function ticketHardBudget(
  options: TicketEpisodeInspectionOptions,
  plannerReserveUsd: number,
): BudgetCeiling {
  const remaining = Math.max(0, options.remainingBudgetUsd - plannerReserveUsd);
  if (remaining <= 0) {
    throw new Error(
      `ticket episode cannot fit delivery after the EpisodePlanner reserve: ` +
        `$${options.remainingBudgetUsd.toFixed(6)} remaining, ` +
        `$${plannerReserveUsd.toFixed(6)} reserved for planning`,
    );
  }
  const requested = options.hardBudget ?? {};
  return {
    maxProviderTurns: Math.min(
      requested.maxProviderTurns ?? MAX_TICKET_PROVIDER_TURNS,
      MAX_TICKET_PROVIDER_TURNS,
    ),
    maxEquivalentCostUsd: Math.min(
      requested.maxEquivalentCostUsd ?? remaining,
      remaining,
    ),
    maxMechanicalOverheadUsd: Math.min(
      requested.maxMechanicalOverheadUsd ?? remaining,
      remaining,
    ),
    maxActiveTimeMs: requested.maxActiveTimeMs ?? 2 * 60 * 60_000,
    maxHumanDecisions: requested.maxHumanDecisions ?? 2,
  };
}

function defaultPlannerLimits(
  planner: RoleConfig,
  remainingBudgetUsd: number,
): PlannerAdmissionLimits {
  const maxAttempts = 2;
  const perAttemptCost = Math.min(
    planner.maxTurnBudgetUsd,
    remainingBudgetUsd / (maxAttempts * 4),
  );
  if (!Number.isFinite(perAttemptCost) || perAttemptCost <= 0) {
    throw new Error("ticket EpisodePlanner has no positive admitted budget");
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

function assertPlannerFitsCombinedBudget(
  limits: PlannerAdmissionLimits,
  remainingBudgetUsd: number,
): void {
  if (
    !Number.isFinite(limits.aggregate.equivalentCostUsd) ||
    limits.aggregate.equivalentCostUsd <= 0 ||
    limits.aggregate.equivalentCostUsd >= remainingBudgetUsd
  ) {
    throw new Error(
      `EpisodePlanner aggregate allowance $${limits.aggregate.equivalentCostUsd} ` +
        `must be positive and leave delivery budget inside the $${remainingBudgetUsd} combined ceiling`,
    );
  }
}

async function resolvePlannerPrompt(options: TicketEpisodeRuntimeOptions): Promise<string> {
  if (options.plannerPromptText !== undefined) {
    if (options.plannerPromptText.trim().length === 0) {
      throw new Error("injected ticket EpisodePlanner prompt must not be empty");
    }
    return options.plannerPromptText;
  }
  const path = join(options.orgRoot, "prompts", "episode", "plan.md");
  try {
    const prompt = await readFile(path, "utf8");
    if (prompt.trim().length === 0) throw new Error("prompt is empty");
    return prompt;
  } catch (error) {
    throw new Error(
      `ticket episode requires the human-ratified EpisodePlanner prompt at ${path}`,
      { cause: error },
    );
  }
}

function plannerHooks(
  options: TicketEpisodeRuntimeOptions,
  planner: RoleConfig,
): TurnHooks {
  return options.gateForRole === undefined
    ? options.hooks
    : { ...options.hooks, gate: options.gateForRole(planner) };
}

function assertFactoryOptions(options: TicketEpisodeRuntimeOptions): void {
  if (resolve(options.root).length === 0 || resolve(options.orgRoot).length === 0) {
    throw new Error("ticket episode runtime roots are required");
  }
  assertInspectionOptions(options);
}

function assertInspectionOptions(options: TicketEpisodeInspectionOptions): void {
  if (resolve(options.root).length === 0) {
    throw new Error("ticket episode inspection root is required");
  }
  if (options.roles.length === 0) throw new Error("ticket episode runtime requires roles");
  requireRole(options.roles, "planner");
  requireRole(options.roles, "builder");
  requireRole(options.roles, "reviewer");
  if (!Number.isFinite(options.remainingBudgetUsd) || options.remainingBudgetUsd < 0) {
    throw new Error("ticket episode runtime requires a non-negative remaining budget");
  }
}

function assertRequest(
  options: Pick<TicketEpisodeInspectionOptions, "root" | "app">,
  request: TicketEpisodePlanningRequest,
): void {
  if (resolve(request.root) !== resolve(options.root)) {
    throw new Error("ticket episode request state root differs from its runtime factory");
  }
  if (request.app !== options.app.name || request.targetRepo !== options.app.repo) {
    throw new Error("ticket episode request app/repository differs from configured authority");
  }
}

function assertBoundedTicket(request: TicketEpisodePlanningRequest): void {
  const bytes = Buffer.byteLength(
    request.deliveryUnit?.members.map((member) => member.body).join("\n\n") ?? request.ticket.body,
  );
  if (bytes > MAX_TICKET_BODY_BYTES) {
    throw new Error(
      `${request.deliveryUnit === undefined ? "ticket" : "delivery unit"} ` +
        `${request.deliveryUnit?.unitId ?? request.ticket.ticketRef} input is ${bytes} bytes; ` +
        `bounded planner input allows ${MAX_TICKET_BODY_BYTES}`,
    );
  }
}

function assertAcceptedIdentity(input: TicketEpisodeExecutionRequest): void {
  if (
    input.accepted.intent.episodeId !== input.request.episodeId ||
    input.accepted.plan.episodeId !== input.request.episodeId ||
    input.accepted.intent.app !== input.request.app ||
    input.accepted.plan.intentHash !== episodeIntentHash(input.accepted.intent)
  ) {
    throw new Error("accepted ticket intent/plan identity differs from its execution request");
  }
}

function requireRole(roles: readonly RoleConfig[], name: string): RoleConfig {
  const role = roles.find((candidate) => candidate.name === name);
  if (role === undefined) throw new Error(`ticket episode runtime requires configured role ${name}`);
  return role;
}

function requireWorktree(item: LoopItem): string {
  if (item.worktree === undefined) throw new Error(`ticket ${item.ticketRef} has no claimed worktree`);
  return item.worktree;
}

function requirePrNumber(item: LoopItem): number {
  if (item.prNumber === undefined) throw new Error(`ticket ${item.ticketRef} has no pull request`);
  return item.prNumber;
}

function itemOutput(item: LoopItem): JsonValue {
  return {
    ticketRef: item.ticketRef,
    phase: item.phase,
    labels: [...item.labels],
    cycles: item.cycles,
    remediationAttempts: item.remediationAttempts,
    prNumber: item.prNumber ?? null,
    approvedCommitId: item.approvedCommitId ?? null,
    worktreeFingerprint: item.worktree === undefined
      ? null
      : worktreeFingerprint(item.worktree) ?? null,
    releaseTrigger: item.releaseTrigger === undefined
      ? null
      : {
          kind: item.releaseTrigger.kind,
          commandSha256: fingerprint(item.releaseTrigger.command),
          owner: item.releaseTrigger.owner,
        },
  };
}

function jsonValue(value: unknown, context: string): JsonValue {
  try {
    return JSON.parse(JSON.stringify(value)) as JsonValue;
  } catch (error) {
    throw new Error(`${context} is not JSON-serializable`, { cause: error });
  }
}

function isTerminalTicketPhase(phase: LoopItem["phase"]): boolean {
  return phase === "merged" || phase === "returned" || phase === "blocked";
}
