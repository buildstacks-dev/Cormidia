import { existsSync } from "node:fs";
import {
  readRouteRecord,
  routeRecordPath,
  type AuthorizedPass,
  type RouteRecord,
} from "../../loop/efficiency.js";
import {
  episodePlanExecutionJournalPath,
  readEpisodePlanExecutionJournal,
  type EpisodePlanExecutionEvent,
  type EpisodePlanExecutionJournal,
  type EpisodePlanExecutionResult,
} from "../../loop/episode-plan-executor.js";
import {
  episodeIntentHash,
  episodePlanHash,
  readCurrentEpisodePlan,
  type CreatorScopeAssessment,
  type EpisodeIntent,
  type EpisodePlan,
  type EpisodeStep,
  type ProviderTurnStep,
} from "../../loop/episode-plan.js";
import { routeAdmissionForEpisodePlan } from "../../loop/episode-route.js";
import { admitPlannedEpisodeRoute, type PlannerAdmissionLimits } from "../../loop/planner-admission.js";
import { configuredProviderFamily, turnAssignmentsEqual } from "../../runtime/assignment.js";
import {
  probeRuntimeReadiness,
  type RuntimeReadinessProbe,
} from "../../runtime/readiness.js";
import type { RoleConfig, TurnAssignment } from "../../runtime/types.js";
import { normalizeAppExecution, type AppEntry } from "../apps.js";
import {
  readPersistedEpisodeIntent,
  type PreparedEpisodePlan,
} from "./coordinator.js";
import {
  executeAcceptedEpisodePlan,
  type ExecuteAcceptedEpisodePlanOptions,
} from "./execution.js";
import {
  assertEpisodeIntentMatchesInvocationFacts,
  buildEpisodeIntent,
  createEpisodePlanningPolicy,
  type EpisodeIntentFacts,
  type EpisodePlanningPolicyOptions,
} from "./policy.js";
import {
  createProviderEpisodePlanRevisionProposer,
  prepareEpisodePlanWithRuntime,
  type ProviderEpisodePlannerOptions,
} from "./runtime.js";
import { assessCreatorScope } from "../../loop/episode-plan.js";
import {
  probeApprovedAssignmentReadiness,
  type AssignmentReadinessSnapshot,
} from "./assignment-readiness.js";

export const EPISODE_ORCHESTRATOR_PREVIEW_VERSION = 1 as const;
export const EPISODE_ORCHESTRATOR_EXPLAIN_VERSION = 1 as const;

export type EpisodeOrchestrationMode = "plan_only" | "execute";

export type EpisodeOrchestrationFacts = Omit<EpisodeIntentFacts, "app" | "roles">;

export type EpisodePlannerRuntimeInput = Omit<
  ProviderEpisodePlannerOptions,
  "root" | "app" | "roles" | "intent"
>;

export type EpisodeDeliveryInput = Omit<
  ExecuteAcceptedEpisodePlanOptions,
  "root" | "intent" | "plan" | "roles"
>;

interface EpisodeOrchestrationBase {
  root: string;
  app: AppEntry;
  roles: readonly RoleConfig[];
  facts: EpisodeOrchestrationFacts;
  planner: EpisodePlannerRuntimeInput;
  /** Required for adaptive live planning/execution. This is the existing
   * non-billable adapter probe; deterministic previews never invoke it. */
  assignmentReadinessProbe?: RuntimeReadinessProbe;
  assignmentReadinessTimeoutMs?: number;
}

export type OrchestrateEpisodeOptions = EpisodeOrchestrationBase & (
  | { mode: "plan_only"; execution?: never }
  | { mode: "execute"; execution: EpisodeDeliveryInput }
);

export interface OrchestratedEpisode {
  mode: EpisodeOrchestrationMode;
  intent: EpisodeIntent;
  prepared: PreparedEpisodePlan;
  /** Current durable route state (terminal when delivery completed). */
  route: RouteRecord;
  execution: EpisodePlanExecutionResult | null;
}

export interface InspectEpisodeInvocationOptions {
  root: string;
  app: AppEntry;
  roles: readonly RoleConfig[];
  facts: EpisodeOrchestrationFacts;
}

export interface EpisodeInvocationInspection {
  persistedIntent: EpisodeIntent | undefined;
  persistedPlan: EpisodePlan | undefined;
}

/**
 * Read-only counterpart to the live orchestration entry boundary. It joins
 * the caller's deterministic facts to any durable intent/plan and applies the
 * exact same immutable-resume checks without probing readiness, constructing
 * a provider, or writing state.
 */
export async function inspectEpisodeInvocation(
  options: InspectEpisodeInvocationOptions,
): Promise<EpisodeInvocationInspection> {
  const persistedIntent = await readPersistedEpisodeIntent(
    options.root,
    options.facts.episodeId,
  );
  const persistedPlan = persistedIntent === undefined
    ? undefined
    : await readCurrentEpisodePlan(options.root, options.facts.episodeId);
  if (persistedIntent !== undefined && persistedPlan !== undefined) {
    assertEpisodeIntentMatchesInvocationFacts(persistedIntent, {
      ...options.facts,
      app: options.app,
      roles: options.roles,
    });
  } else if (persistedIntent !== undefined) {
    persistedInvocationIntent(options, persistedIntent);
  }
  return {
    persistedIntent: persistedIntent === undefined
      ? undefined
      : structuredClone(persistedIntent),
    persistedPlan: persistedPlan === undefined
      ? undefined
      : structuredClone(persistedPlan),
  };
}

/**
 * The single org-layer episode entry boundary. It always constructs the same
 * bounded intent and enters the same planner/creator-scope decision. The
 * accepted plan is route-admitted before plan-only return or delivery.
 */
export async function orchestrateEpisode(
  options: OrchestrateEpisodeOptions,
): Promise<OrchestratedEpisode> {
  const { persistedIntent, persistedPlan } = await inspectEpisodeInvocation(options);
  const assignmentMode = persistedPlan === undefined
    ? normalizeAppExecution(options.app.execution).assignmentMode
    : persistedIntent!.assignmentMode;
  const assignmentReadinessProbe = assignmentMode === "adaptive"
    ? options.assignmentReadinessProbe ?? probeRuntimeReadiness
    : undefined;
  const readiness = assignmentMode === "adaptive" && persistedPlan === undefined
    ? await requireAdaptiveReadiness(options, assignmentReadinessProbe!)
    : undefined;
  const intent = persistedPlan === undefined
    ? (() => {
        const candidateIntent = buildEpisodeIntent({
          ...options.facts,
          app: options.app,
          roles: options.roles,
          ...(readiness === undefined
            ? {}
            : { assignmentAvailable: readiness.available }),
        });
        return persistedIntent === undefined
          ? candidateIntent
          : persistedInvocationIntent(options, persistedIntent);
      })()
    : structuredClone(persistedIntent!);
  if (readiness !== undefined) {
    assertPlannerBootReadyWhenRequired(options, intent, readiness);
  }
  const prepared = await prepareEpisodePlanWithRuntime({
    ...options.planner,
    root: options.root,
    app: options.app,
    roles: options.roles,
    intent,
  });
  let execution: EpisodePlanExecutionResult | null = null;
  if (options.mode === "execute") {
    const proposeRevision = options.execution.proposeRevision ??
      (options.planner.promptText.trim().length === 0
        ? async () => {
            throw new Error(
              "this execution-ready governed protocol has no revision-capable EpisodePlanner prompt; provide a new validated creator scope",
            );
          }
        : createProviderEpisodePlanRevisionProposer({
            ...options.planner,
            root: options.root,
            app: options.app,
            roles: options.roles,
          }));
    // The accepted-plan executor owns this same route-admission boundary so
    // provider work cannot slip between admission and its first durable DAG
    // event. Avoid a redundant second lock/read here.
    execution = await executeAcceptedEpisodePlan({
      ...options.execution,
      root: options.root,
      intent,
      plan: prepared.plan,
      roles: options.roles,
      proposeRevision,
      ...(assignmentReadinessProbe === undefined
        ? {}
        : { assignmentReadinessProbe }),
      ...(options.assignmentReadinessTimeoutMs === undefined
        ? {}
        : { assignmentReadinessTimeoutMs: options.assignmentReadinessTimeoutMs }),
    });
  } else {
    const clock = options.planner.now ?? (() => new Date());
    await admitPlannedEpisodeRoute(routeAdmissionForEpisodePlan({
      root: options.root,
      intent,
      plan: prepared.plan,
      now: clock(),
    }));
  }
  const route = await readRouteRecord(options.root, intent.episodeId);
  return { mode: options.mode, intent, prepared, route, execution };
}

export class EpisodeAssignmentReadinessError extends Error {
  readonly code = "plan_assignment_unavailable" as const;
  constructor(message: string) {
    super(message);
    this.name = "EpisodeAssignmentReadinessError";
  }
}

async function requireAdaptiveReadiness(
  options: OrchestrateEpisodeOptions,
  probe: RuntimeReadinessProbe,
): Promise<AssignmentReadinessSnapshot> {
  return probeApprovedAssignmentReadiness({
    app: options.app,
    roles: options.roles,
    probe,
    ...(options.assignmentReadinessTimeoutMs === undefined
      ? {}
      : { timeoutMs: options.assignmentReadinessTimeoutMs }),
  });
}

/** Keep temporal readiness from changing the immutable intent on resume.
 * Other invocation facts still have to reproduce the persisted hash exactly. */
function persistedInvocationIntent(
  options: InspectEpisodeInvocationOptions,
  persisted: EpisodeIntent,
): EpisodeIntent {
  const persistedAvailability = new Map(
    persisted.allowedAssignments.map((candidate) => [
      `${candidate.role}\0${candidate.candidateId}\0${JSON.stringify(candidate.assignment)}`,
      candidate.available,
    ]),
  );
  const reproduced = buildEpisodeIntent({
    ...options.facts,
    app: options.app,
    roles: options.roles,
    assignmentAvailable: ({ role, candidateId, assignment }) =>
      persistedAvailability.get(
        `${role.name}\0${candidateId}\0${JSON.stringify(assignment)}`,
      ) ?? false,
  });
  if (episodeIntentHash(reproduced) !== episodeIntentHash(persisted)) {
    throw new Error(
      `episode ${persisted.episodeId} resume facts differ from persisted immutable intent`,
    );
  }
  return structuredClone(persisted);
}

function assertPlannerBootReadyWhenRequired(
  options: OrchestrateEpisodeOptions,
  intent: EpisodeIntent,
  readiness: AssignmentReadinessSnapshot,
): void {
  const policy = createEpisodePlanningPolicy(options.app, {
    intent,
    roles: options.roles,
    ...(options.planner.workflowTemplates === undefined
      ? {}
      : { workflowTemplates: options.planner.workflowTemplates }),
    ...(options.planner.additionalCapabilitiesByRole === undefined
      ? {}
      : { additionalCapabilitiesByRole: options.planner.additionalCapabilitiesByRole }),
    ...(options.planner.independentReview === undefined
      ? {}
      : { independentReview: options.planner.independentReview }),
    ...(options.planner.safetyFloorMapping === undefined
      ? {}
      : { safetyFloorMapping: options.planner.safetyFloorMapping }),
  });
  if (assessCreatorScope(intent.creatorScope, policy.creatorScope).executionReady) return;
  const result = readiness.resultFor(policy.plannerBootAssignment);
  if (result?.status === "ready") return;
  throw new EpisodeAssignmentReadinessError(
    `EpisodePlanner boot assignment is unavailable: ${result?.status ?? "missing readiness evidence"}` +
      (result?.detail === undefined ? "" : ` — ${result.detail}`),
  );
}

export interface PreviewEpisodeOptions {
  app: AppEntry;
  roles: readonly RoleConfig[];
  facts: EpisodeOrchestrationFacts;
  planner: {
    limits: PlannerAdmissionLimits;
    requiredCapabilities?: ProviderEpisodePlannerOptions["requiredCapabilities"];
    workflowTemplates?: EpisodePlanningPolicyOptions["workflowTemplates"];
    additionalCapabilitiesByRole?: EpisodePlanningPolicyOptions["additionalCapabilitiesByRole"];
    independentReview?: EpisodePlanningPolicyOptions["independentReview"];
    safetyFloorMapping?: EpisodePlanningPolicyOptions["safetyFloorMapping"];
  };
}

export interface EpisodePlanningPreview {
  schemaVersion: typeof EPISODE_ORCHESTRATOR_PREVIEW_VERSION;
  previewKind: "deterministic_intent_only";
  providerRuntimeCalled: false;
  durableStateWritten: false;
  /** Deliberately null: only a provider call (or complete creator scope) can
   * establish the exact accepted plan. */
  exactProviderAuthoredPlan: null;
  disclaimer: string;
  intent: EpisodeIntent;
  intentHash: string;
  assignmentMode: EpisodeIntent["assignmentMode"];
  allowedAssignments: EpisodeIntent["allowedAssignments"];
  requiredSafetyFacts: EpisodeIntent["requiredSafetyFacts"];
  creatorScope: CreatorScopeAssessment;
  planningPath: "creator_scope_normalization" | "episode_planner_provider_turn";
  plannerBoot: {
    role: "planner";
    assignment: TurnAssignment;
    providerFamily: string;
    limits: PlannerAdmissionLimits;
    requiredCapabilities: string[];
    providerTurnRequired: boolean;
  };
}

/** Token-free, side-effect-free preview of facts and authorities. */
export function previewEpisode(options: PreviewEpisodeOptions): EpisodePlanningPreview {
  const intent = buildEpisodeIntent({
    ...options.facts,
    app: options.app,
    roles: options.roles,
  });
  const policy = createEpisodePlanningPolicy(options.app, {
    intent,
    roles: options.roles,
    ...(options.planner.workflowTemplates === undefined
      ? {}
      : { workflowTemplates: options.planner.workflowTemplates }),
    ...(options.planner.additionalCapabilitiesByRole === undefined
      ? {}
      : { additionalCapabilitiesByRole: options.planner.additionalCapabilitiesByRole }),
    ...(options.planner.independentReview === undefined
      ? {}
      : { independentReview: options.planner.independentReview }),
    ...(options.planner.safetyFloorMapping === undefined
      ? {}
      : { safetyFloorMapping: options.planner.safetyFloorMapping }),
  });
  const creatorScope = assessCreatorScope(intent.creatorScope, policy.creatorScope);
  const bootAssignment = structuredClone(policy.plannerBootAssignment);
  return {
    schemaVersion: EPISODE_ORCHESTRATOR_PREVIEW_VERSION,
    previewKind: "deterministic_intent_only",
    providerRuntimeCalled: false,
    durableStateWritten: false,
    exactProviderAuthoredPlan: null,
    disclaimer:
      "This token-free preview resolves deterministic intent and authority only; " +
      "it cannot claim the exact provider-authored EpisodePlan before EpisodePlanner runs.",
    intent,
    intentHash: episodeIntentHash(intent),
    assignmentMode: intent.assignmentMode,
    allowedAssignments: structuredClone(intent.allowedAssignments),
    requiredSafetyFacts: structuredClone(intent.requiredSafetyFacts),
    creatorScope,
    planningPath: creatorScope.executionReady
      ? "creator_scope_normalization"
      : "episode_planner_provider_turn",
    plannerBoot: {
      role: "planner",
      assignment: bootAssignment,
      providerFamily: configuredProviderFamily(bootAssignment),
      limits: structuredClone(options.planner.limits),
      requiredCapabilities: [...(options.planner.requiredCapabilities ?? [])].sort(),
      providerTurnRequired: !creatorScope.executionReady,
    },
  };
}

export type ExplainedStepStatus =
  | "pending"
  | "running"
  | "waiting_approval"
  | "denied"
  | "failed"
  | "completed";

interface ExplainedStepBase {
  id: string;
  kind: EpisodeStep["kind"];
  objective: string;
  dependsOn: string[];
  status: ExplainedStepStatus;
}

export interface ExplainedProviderStep extends ExplainedStepBase {
  kind: "provider_turn";
  operation: string;
  role: string;
  assignment: TurnAssignment;
  assignmentSource: ProviderTurnStep["assignmentSource"];
  selectionReason: string;
  assignmentCandidateId: string | null;
  providerFamily: string | null;
  resolvedCapabilities: string[];
  routeAuthorized: boolean;
}

export interface ExplainedMechanicalStep extends ExplainedStepBase {
  kind: "mechanical_gate";
  gate: string;
}

export interface ExplainedApprovalStep extends ExplainedStepBase {
  kind: "approval";
  approvalKind: string;
  actionRef: string;
}

export type ExplainedEpisodeStep =
  | ExplainedProviderStep
  | ExplainedMechanicalStep
  | ExplainedApprovalStep;

export interface EpisodeExplanation {
  schemaVersion: typeof EPISODE_ORCHESTRATOR_EXPLAIN_VERSION;
  episodeId: string;
  intent: EpisodeIntent;
  intentHash: string;
  plan: EpisodePlan;
  planHash: string;
  route: RouteRecord | null;
  journal: EpisodePlanExecutionJournal | null;
  planningSource: EpisodePlan["planningSource"];
  planningTurnSkipped: boolean;
  steps: ExplainedEpisodeStep[];
}

/** Read-only explanation from durable episode evidence. */
export async function explainEpisode(
  root: string,
  episodeId: string,
): Promise<EpisodeExplanation> {
  const intent = await readPersistedEpisodeIntent(root, episodeId);
  if (intent === undefined) throw new Error(`episode ${episodeId} has no persisted intent`);
  const plan = await readCurrentEpisodePlan(root, episodeId);
  if (plan === undefined) throw new Error(`episode ${episodeId} has no accepted plan`);
  const intentHash = episodeIntentHash(intent);
  if (plan.intentHash !== intentHash) {
    throw new Error(`episode ${episodeId} plan does not match its persisted intent`);
  }
  const route = existsSync(routeRecordPath(root, episodeId))
    ? await readRouteRecord(root, episodeId)
    : null;
  const journal = existsSync(episodePlanExecutionJournalPath(root, episodeId))
    ? await readEpisodePlanExecutionJournal(root, episodeId) ?? null
    : null;
  const steps = plan.steps.map((step) => explainStep(step, plan, route, journal));
  return {
    schemaVersion: EPISODE_ORCHESTRATOR_EXPLAIN_VERSION,
    episodeId,
    intent,
    intentHash,
    plan,
    planHash: episodePlanHash(plan),
    route,
    journal,
    planningSource: plan.planningSource,
    planningTurnSkipped: plan.planningSource === "creator_scope",
    steps,
  };
}

function explainStep(
  step: EpisodeStep,
  plan: EpisodePlan,
  route: RouteRecord | null,
  journal: EpisodePlanExecutionJournal | null,
): ExplainedEpisodeStep {
  const base = {
    id: step.id,
    kind: step.kind,
    objective: step.objective,
    dependsOn: [...step.dependsOn],
    status: explainedStepStatus(step.id, journal),
  };
  if (step.kind === "mechanical_gate") return { ...base, kind: step.kind, gate: step.gate };
  if (step.kind === "approval") {
    return {
      ...base,
      kind: step.kind,
      approvalKind: step.approvalKind,
      actionRef: step.actionRef,
    };
  }
  const authorization = route === null ? undefined : exactStepAuthorization(route, step, plan);
  return {
    ...base,
    kind: step.kind,
    operation: step.operation,
    role: step.role,
    assignment: structuredClone(step.assignment),
    assignmentSource: step.assignmentSource,
    selectionReason: step.selectionReason,
    assignmentCandidateId: authorization?.assignment_candidate_id ?? null,
    providerFamily: authorization?.provider_family ?? null,
    resolvedCapabilities: [...(authorization?.resolved_capabilities ?? [])],
    routeAuthorized: authorization !== undefined,
  };
}

function exactStepAuthorization(
  route: RouteRecord,
  step: ProviderTurnStep,
  plan: EpisodePlan,
): AuthorizedPass {
  const matches = route.authorized_passes.filter((pass) =>
    pass.plan_version === plan.version &&
    pass.plan_step_id === step.id &&
    pass.pass === step.id &&
    pass.role === step.role &&
    pass.runtime === step.assignment.harness &&
    pass.model === step.assignment.model &&
    pass.effort === step.assignment.effort &&
    pass.assignment_source === step.assignmentSource &&
    turnAssignmentsEqual(
      { harness: pass.runtime, model: pass.model, effort: pass.effort },
      step.assignment,
    )
  );
  if (matches.length !== 1) {
    throw new Error(
      `episode ${plan.episodeId} step ${step.id} has ${matches.length} matching route authorizations`,
    );
  }
  return matches[0]!;
}

function explainedStepStatus(
  stepId: string,
  journal: EpisodePlanExecutionJournal | null,
): ExplainedStepStatus {
  if (journal === null) return "pending";
  const events = journal.events.filter((event) => "step_id" in event && event.step_id === stepId);
  const event = events.at(-1);
  if (event === undefined) return "pending";
  return statusForEvent(event);
}

function statusForEvent(event: EpisodePlanExecutionEvent): ExplainedStepStatus {
  if (event.kind === "step_completed") return "completed";
  if (event.kind === "step_failed") return "failed";
  if (event.kind === "approval_pending") return "waiting_approval";
  if (event.kind === "approval_denied") return "denied";
  if (event.kind === "step_started") return "running";
  return "pending";
}
