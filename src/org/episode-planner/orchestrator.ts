import { existsSync } from "node:fs";
import {
  efficiencyEpisodeDir,
  readExecutionSteps,
  readRouteRecord,
  routeRecordPath,
  type AuthorizedPass,
  type ExecutionStepRecord,
  type RouteRecord,
} from "../../loop/efficiency.js";
import {
  episodePlanExecutionJournalPath,
  readEpisodePlanExecutionJournal,
  type EpisodePlanExecutionEvent,
  type EpisodePlanExecutionJournal,
} from "../../loop/episode-plan-executor.js";
import {
  assessCreatorScope,
  episodeIntentHash,
  episodePlanHash,
  readCurrentEpisodePlan,
  type CreatorScopeAssessment,
  type EpisodeIntent,
  type EpisodePlan,
  type EpisodeStep,
  type ProviderTurnStep,
} from "../../loop/episode-plan.js";
import {
  episodeReplanJournalPath,
  readEpisodeReplanJournal,
  type EpisodeReplanJournal,
} from "../../loop/episode-replan.js";
import { routeAdmissionForEpisodePlan } from "../../loop/episode-route.js";
import { admitPlannedEpisodeRoute, type PlannerAdmissionLimits } from "../../loop/planner-admission.js";
import { configuredProviderFamily, turnAssignmentsEqual } from "../../runtime/assignment.js";
import { toErrorMessage as describe } from "../../runtime/error-message.js";
import { probeRuntimeReadiness, type RuntimeReadinessProbe } from "../../runtime/readiness.js";
import type { RoleConfig, TurnAssignment } from "../../runtime/types.js";
import { normalizeAppExecution, type AppEntry } from "../apps.js";
import { probeApprovedAssignmentReadiness, type AssignmentReadinessSnapshot } from "./assignment-readiness.js";
import { readPersistedEpisodeIntent, type PreparedEpisodePlan } from "./coordinator.js";
import {
  executeAcceptedEpisodePlan,
  type AcceptedEpisodePlanExecutionResult,
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

const EPISODE_ORCHESTRATOR_PREVIEW_VERSION = 1 as const;
/** v2 makes the explanation total: every field is nullable, every unresolved
 * lookup becomes an inline annotation, and nothing throws. */
const EPISODE_ORCHESTRATOR_EXPLAIN_VERSION = 2 as const;

type EpisodeOrchestrationMode = "plan_only" | "execute";

export type EpisodeOrchestrationFacts = Omit<EpisodeIntentFacts, "app" | "roles">;

type EpisodePlannerRuntimeInput = Omit<ProviderEpisodePlannerOptions, "root" | "app" | "roles" | "intent">;

type EpisodeDeliveryInput = Omit<ExecuteAcceptedEpisodePlanOptions, "root" | "intent" | "plan" | "roles">;

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

type OrchestrateEpisodeOptions = EpisodeOrchestrationBase &
  ({ mode: "plan_only"; execution?: never } | { mode: "execute"; execution: EpisodeDeliveryInput });

export interface OrchestratedEpisode {
  mode: EpisodeOrchestrationMode;
  intent: EpisodeIntent;
  prepared: PreparedEpisodePlan;
  /** Current durable route state (terminal when delivery completed). */
  route: RouteRecord;
  execution: AcceptedEpisodePlanExecutionResult | null;
}

interface InspectEpisodeInvocationOptions {
  root: string;
  app: AppEntry;
  roles: readonly RoleConfig[];
  facts: EpisodeOrchestrationFacts;
}

interface EpisodeInvocationInspection {
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
  const persistedIntent = await readPersistedEpisodeIntent(options.root, options.facts.episodeId);
  const persistedPlan =
    persistedIntent === undefined ? undefined : await readCurrentEpisodePlan(options.root, options.facts.episodeId);
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
    persistedIntent: persistedIntent === undefined ? undefined : structuredClone(persistedIntent),
    persistedPlan: persistedPlan === undefined ? undefined : structuredClone(persistedPlan),
  };
}

/**
 * The single org-layer episode entry boundary. It always constructs the same
 * bounded intent and enters the same planner/creator-scope decision. The
 * accepted plan is route-admitted before plan-only return or delivery.
 */
export async function orchestrateEpisode(options: OrchestrateEpisodeOptions): Promise<OrchestratedEpisode> {
  const { persistedIntent, persistedPlan } = await inspectEpisodeInvocation(options);
  const assignmentMode =
    persistedPlan === undefined
      ? normalizeAppExecution(options.app.execution).assignmentMode
      : persistedIntent!.assignmentMode;
  const assignmentReadinessProbe =
    assignmentMode === "adaptive" ? (options.assignmentReadinessProbe ?? probeRuntimeReadiness) : undefined;
  const readiness =
    assignmentMode === "adaptive" && persistedPlan === undefined
      ? await requireAdaptiveReadiness(options, assignmentReadinessProbe!)
      : undefined;
  const intent =
    persistedPlan === undefined
      ? (() => {
          const candidateIntent = buildEpisodeIntent({
            ...options.facts,
            app: options.app,
            roles: options.roles,
            ...(readiness === undefined ? {} : { assignmentAvailable: readiness.available }),
          });
          return persistedIntent === undefined ? candidateIntent : persistedInvocationIntent(options, persistedIntent);
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
  let execution: AcceptedEpisodePlanExecutionResult | null = null;
  if (options.mode === "execute") {
    const proposeRevision =
      options.execution.proposeRevision ??
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
      ...(assignmentReadinessProbe === undefined ? {} : { assignmentReadinessProbe }),
      ...(options.assignmentReadinessTimeoutMs === undefined
        ? {}
        : { assignmentReadinessTimeoutMs: options.assignmentReadinessTimeoutMs }),
    });
  } else {
    const clock = options.planner.now ?? (() => new Date());
    await admitPlannedEpisodeRoute(
      routeAdmissionForEpisodePlan({
        root: options.root,
        intent,
        plan: prepared.plan,
        now: clock(),
      }),
    );
  }
  const route = await readRouteRecord(options.root, intent.episodeId);
  return { mode: options.mode, intent, prepared, route, execution };
}

class EpisodeAssignmentReadinessError extends Error {
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
    ...(options.assignmentReadinessTimeoutMs === undefined ? {} : { timeoutMs: options.assignmentReadinessTimeoutMs }),
  });
}

/** Keep temporal readiness from changing the immutable intent on resume.
 * Other invocation facts still have to reproduce the persisted hash exactly. */
function persistedInvocationIntent(options: InspectEpisodeInvocationOptions, persisted: EpisodeIntent): EpisodeIntent {
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
      persistedAvailability.get(`${role.name}\0${candidateId}\0${JSON.stringify(assignment)}`) ?? false,
  });
  if (episodeIntentHash(reproduced) !== episodeIntentHash(persisted)) {
    throw new Error(`episode ${persisted.episodeId} resume facts differ from persisted immutable intent`);
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

interface PreviewEpisodeOptions {
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
    planningPath: creatorScope.executionReady ? "creator_scope_normalization" : "episode_planner_provider_turn",
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

type ExplainedStepStatus = "pending" | "running" | "waiting_approval" | "denied" | "failed" | "completed";

interface ExplainedStepBase {
  id: string;
  kind: EpisodeStep["kind"];
  objective: string;
  dependsOn: string[];
  status: ExplainedStepStatus;
}

/**
 * How the durable route record explains this step's assignment.
 *
 * `authorized_at_prior_plan_version` is the ordinary shape after a plan
 * revision: {@link admitPlannedEpisodeRoute} deliberately does not re-authorize
 * (and re-budget) a step that already completed under an earlier version, so
 * its only authorization stays filed at the version that actually paid for it.
 */
type StepAuthorizationStatus = "authorized" | "authorized_at_prior_plan_version" | "route_missing" | "unresolved";

interface ExplainedProviderStep extends ExplainedStepBase {
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
  authorizationStatus: StepAuthorizationStatus;
  /** Plan version the matched authorization was filed under, when resolved. */
  authorizedPlanVersion: number | null;
  /** Human-readable annotation whenever the status is not plain `authorized`. */
  authorizationDetail: string | null;
}

interface ExplainedMechanicalStep extends ExplainedStepBase {
  kind: "mechanical_gate";
  gate: string;
}

interface ExplainedApprovalStep extends ExplainedStepBase {
  kind: "approval";
  approvalKind: string;
  actionRef: string;
}

export type ExplainedEpisodeStep = ExplainedProviderStep | ExplainedMechanicalStep | ExplainedApprovalStep;

/** Every way durable episode evidence can be missing, unreadable, or
 * internally inconsistent. Each one degrades the explanation; none aborts it. */
type EpisodeExplanationProblemCode =
  | "episode_evidence_missing"
  | "intent_missing"
  | "intent_unreadable"
  | "plan_missing"
  | "plan_unreadable"
  | "plan_intent_mismatch"
  | "route_unreadable"
  | "journal_unreadable"
  | "replan_journal_unreadable"
  | "execution_steps_unreadable"
  | "episode_execution_missing"
  | "episode_execution_incomplete"
  | "step_failed"
  | "step_waiting_approval"
  | "step_denied"
  | "step_authorization_unresolved"
  | "step_authorization_stale";

interface EpisodeExplanationProblem {
  code: EpisodeExplanationProblemCode;
  message: string;
  /** Plan step the problem is about, when it is about one. */
  stepId: string | null;
}

/** Durable execution-step evidence, projected for a diagnostic reader. It is
 * the only step evidence a route-only episode (deterministic lifecycle work,
 * or an episode that never reached an accepted plan) has. */
interface ExplainedExecutionStep {
  executionStepId: string;
  kind: ExecutionStepRecord["kind"];
  operation: string;
  role: string | null;
  assignment: TurnAssignment | null;
  status: ExecutionStepRecord["status"];
  startedAt: string;
  finishedAt: string;
  errorCode: string | null;
  reason: string;
  planVersion: number | null;
  planStepId: string | null;
}

export interface EpisodeExplanation {
  schemaVersion: typeof EPISODE_ORCHESTRATOR_EXPLAIN_VERSION;
  episodeId: string;
  /** Absolute directory every durable artifact below was read from. Printed so
   * an operator never has to reverse-engineer the state-home layout. */
  evidenceDir: string;
  /** True only when no {@link problems} entry was recorded. */
  complete: boolean;
  problems: EpisodeExplanationProblem[];
  intent: EpisodeIntent | null;
  intentHash: string | null;
  plan: EpisodePlan | null;
  planHash: string | null;
  route: RouteRecord | null;
  journal: EpisodePlanExecutionJournal | null;
  replanJournal: EpisodeReplanJournal | null;
  planningSource: EpisodePlan["planningSource"] | null;
  planningTurnSkipped: boolean;
  steps: ExplainedEpisodeStep[];
  executionSteps: ExplainedExecutionStep[];
}

/**
 * Read-only explanation from durable episode evidence.
 *
 * This is the primary operator diagnostic, so it is total by construction: a
 * missing, corrupt, or internally inconsistent artifact is recorded in
 * {@link EpisodeExplanation.problems} and annotated inline, never thrown. A
 * diagnostic that refuses to print anything when one lookup fails is the exact
 * opposite of a diagnostic (ISSUE-025).
 */
export async function explainEpisode(root: string, episodeId: string): Promise<EpisodeExplanation> {
  const problems: EpisodeExplanationProblem[] = [];
  const fail = (code: EpisodeExplanationProblemCode, message: string, stepId: string | null = null): void => {
    problems.push({ code, message, stepId });
  };

  const evidenceDir = efficiencyEpisodeDir(root, episodeId);
  const intent = await readOrAnnotate(
    () => readPersistedEpisodeIntent(root, episodeId),
    (error) => fail("intent_unreadable", `persisted intent is unreadable: ${describe(error)}`),
  );
  const plan = await readOrAnnotate(
    () => readCurrentEpisodePlan(root, episodeId),
    (error) => fail("plan_unreadable", `accepted plan is unreadable: ${describe(error)}`),
  );
  const route = existsSync(routeRecordPath(root, episodeId))
    ? await readOrAnnotate(
        () => readRouteRecord(root, episodeId),
        (error) => fail("route_unreadable", `route record is unreadable: ${describe(error)}`),
      )
    : undefined;
  const journal = existsSync(episodePlanExecutionJournalPath(root, episodeId))
    ? await readOrAnnotate(
        () => readEpisodePlanExecutionJournal(root, episodeId),
        (error) => fail("journal_unreadable", `execution journal is unreadable: ${describe(error)}`),
      )
    : undefined;
  const replanJournal = existsSync(episodeReplanJournalPath(root, episodeId))
    ? await readOrAnnotate(
        () => readEpisodeReplanJournal(root, episodeId),
        (error) => fail("replan_journal_unreadable", `replan journal is unreadable: ${describe(error)}`),
      )
    : undefined;
  const executionSteps =
    (await readOrAnnotate(
      () => readExecutionSteps(root, episodeId),
      (error) => fail("execution_steps_unreadable", `durable execution steps are unreadable: ${describe(error)}`),
    )) ?? [];

  if (
    intent === undefined &&
    plan === undefined &&
    route === undefined &&
    journal === undefined &&
    executionSteps.length === 0
  ) {
    fail("episode_evidence_missing", `no durable evidence for episode ${episodeId} under ${evidenceDir}`);
  } else {
    if (intent === undefined && !problems.some((problem) => problem.code === "intent_unreadable")) {
      fail("intent_missing", "episode has no persisted immutable intent");
    }
    if (plan === undefined && !problems.some((problem) => problem.code === "plan_unreadable")) {
      fail("plan_missing", "episode has no accepted durable EpisodePlan");
    }
  }

  const intentHash = intent === undefined ? null : episodeIntentHash(intent);
  if (plan !== undefined && intentHash !== null && plan.intentHash !== intentHash) {
    fail(
      "plan_intent_mismatch",
      `plan v${plan.version} declares intent hash ${plan.intentHash} but the persisted intent hashes to ${intentHash}`,
    );
  }

  const steps =
    plan === undefined
      ? []
      : plan.steps.map((step) => {
          const explained = explainStep(step, plan, route ?? null, journal ?? null);
          if (explained.kind !== "provider_turn") return explained;
          if (explained.authorizationStatus === "unresolved") {
            fail(
              "step_authorization_unresolved",
              explained.authorizationDetail ?? "route authorization could not be resolved",
              step.id,
            );
          } else if (
            explained.authorizationStatus === "authorized_at_prior_plan_version" &&
            explained.status !== "completed"
          ) {
            // Carrying a prior version forward only explains a turn that was
            // already paid for. A step still waiting to run needs a current
            // authorization, and executing it would refuse without one.
            fail(
              "step_authorization_stale",
              explained.authorizationDetail ?? "authorization predates the current plan version",
              step.id,
            );
          }
          return explained;
        });
  if (plan !== undefined) {
    if (journal === undefined) {
      fail("episode_execution_missing", `accepted plan v${plan.version} has no durable execution journal`);
    } else if (journal.status !== "completed" || steps.some((step) => step.status !== "completed")) {
      const latestReplan = replanJournal?.records.at(-1);
      const recovery =
        latestReplan === undefined
          ? journal.current_plan_version > 1
            ? `; plan revision v${journal.current_plan_version} is active`
            : ""
          : `; replan ${latestReplan.trigger.id} is ${latestReplan.status}` +
            (latestReplan.reason === null ? "" : ` (${latestReplan.reason})`);
      fail(
        "episode_execution_incomplete",
        `execution is ${journal.status}; ` +
          `${steps.filter((step) => step.status === "completed").length}/${steps.length} ` +
          `accepted-plan steps are complete${recovery}`,
      );
      for (const step of steps) {
        if (step.status !== "failed" && step.status !== "waiting_approval" && step.status !== "denied") continue;
        const event = latestTerminalEvent(journal, step.id);
        const detail =
          event === undefined
            ? `step ${step.id} is ${step.status}`
            : event.kind === "step_failed" || event.kind === "approval_denied" || event.kind === "approval_pending"
              ? `${event.reason_code}: ${event.summary}`
              : `step ${step.id} is ${step.status}`;
        fail(
          step.status === "failed"
            ? "step_failed"
            : step.status === "waiting_approval"
              ? "step_waiting_approval"
              : "step_denied",
          detail,
          step.id,
        );
      }
    }
  }

  return {
    schemaVersion: EPISODE_ORCHESTRATOR_EXPLAIN_VERSION,
    episodeId,
    evidenceDir,
    complete:
      problems.length === 0 &&
      (plan === undefined || (journal?.status === "completed" && steps.every((step) => step.status === "completed"))),
    problems,
    intent: intent ?? null,
    intentHash,
    plan: plan ?? null,
    planHash: plan === undefined ? null : episodePlanHash(plan),
    route: route ?? null,
    journal: journal ?? null,
    replanJournal: replanJournal ?? null,
    planningSource: plan?.planningSource ?? null,
    planningTurnSkipped: plan?.planningSource === "creator_scope",
    steps,
    executionSteps: executionSteps.map(explainExecutionStep),
  };
}

function latestTerminalEvent(
  journal: EpisodePlanExecutionJournal,
  stepId: string,
): EpisodePlanExecutionEvent | undefined {
  return journal.events.findLast(
    (event) =>
      "step_id" in event &&
      event.step_id === stepId &&
      (event.kind === "step_failed" || event.kind === "approval_pending" || event.kind === "approval_denied"),
  );
}

/** Run one durable read, converting a throw into an annotation. `undefined`
 * therefore means "absent or unreadable", and the problem list says which. */
async function readOrAnnotate<T>(
  read: () => Promise<T | undefined>,
  onError: (error: unknown) => void,
): Promise<T | undefined> {
  try {
    return await read();
  } catch (error) {
    onError(error);
    return undefined;
  }
}

function explainExecutionStep(record: ExecutionStepRecord): ExplainedExecutionStep {
  const assignment =
    record.runtime !== null && record.model !== null && record.effort !== null
      ? { harness: record.runtime, model: record.model, effort: record.effort }
      : null;
  return {
    executionStepId: record.execution_step_id,
    kind: record.kind,
    operation: record.operation,
    role: record.role,
    assignment,
    status: record.status,
    startedAt: record.started_at,
    finishedAt: record.finished_at,
    errorCode: record.error_code,
    reason: record.reason,
    planVersion: record.plan_version ?? null,
    planStepId: record.plan_step_id ?? null,
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
  const resolution = resolveStepAuthorization(route, step, plan, base.status);
  const authorization = resolution.pass;
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
    authorizationStatus: resolution.status,
    authorizedPlanVersion: authorization?.plan_version ?? null,
    authorizationDetail: resolution.detail,
  };
}

interface StepAuthorizationResolution {
  status: StepAuthorizationStatus;
  pass: AuthorizedPass | undefined;
  detail: string | null;
}

/**
 * Resolve the durable authorization that actually paid for one planned step.
 *
 * Matching only the *current* plan version is wrong for any revised plan: a
 * step that completed under v1 is deliberately not re-authorized at v2
 * (`admitPlannedEpisodeRoute` filters completed steps out of the revision's
 * passes), so the current version has zero matches for it. Fall back to the
 * highest earlier version whose authorization is identical in every identity
 * field, and label the difference instead of hiding it. A revision that
 * genuinely changed the step's role or tuple still resolves to nothing, which
 * is exactly the case an operator needs told — and a carried-forward
 * authorization for a step that has *not* completed is reported as stale,
 * because only an already-paid turn can be explained by an older version.
 */
function resolveStepAuthorization(
  route: RouteRecord | null,
  step: ProviderTurnStep,
  plan: EpisodePlan,
  status: ExplainedStepStatus,
): StepAuthorizationResolution {
  if (route === null) {
    return {
      status: "route_missing",
      pass: undefined,
      detail: "no durable route record; assignment shown from the plan only",
    };
  }
  const identical = route.authorized_passes.filter((pass) => authorizesStep(pass, step));
  const current = identical.filter((pass) => pass.plan_version === plan.version);
  if (current.length === 1) return { status: "authorized", pass: current[0]!, detail: null };
  if (current.length > 1) {
    return {
      status: "unresolved",
      pass: undefined,
      detail: `${current.length} matching route authorizations for plan v${plan.version}` + " (expected exactly one)",
    };
  }
  const prior = identical
    .flatMap((pass) =>
      pass.plan_version !== undefined && pass.plan_version < plan.version ? [{ pass, version: pass.plan_version }] : [],
    )
    .sort((left, right) => right.version - left.version);
  const carried = prior[0];
  if (carried !== undefined) {
    return {
      status: "authorized_at_prior_plan_version",
      pass: carried.pass,
      detail:
        status === "completed"
          ? `authorized under plan v${carried.version}; plan v${plan.version} did not ` +
            "re-authorize an already-completed step"
          : `authorized under plan v${carried.version} only, but the step is ${status}; ` +
            `plan v${plan.version} must re-authorize it before it can run`,
    };
  }
  return {
    status: "unresolved",
    pass: undefined,
    detail:
      `0 matching route authorizations for plan v${plan.version}` +
      (identical.length === 0 ? "" : ` (${identical.length} at another version were also rejected)`),
  };
}

function authorizesStep(pass: AuthorizedPass, step: ProviderTurnStep): boolean {
  return (
    pass.plan_step_id === step.id &&
    pass.pass === step.id &&
    pass.role === step.role &&
    pass.runtime === step.assignment.harness &&
    pass.model === step.assignment.model &&
    pass.effort === step.assignment.effort &&
    pass.assignment_source === step.assignmentSource &&
    turnAssignmentsEqual({ harness: pass.runtime, model: pass.model, effort: pass.effort }, step.assignment)
  );
}

function explainedStepStatus(stepId: string, journal: EpisodePlanExecutionJournal | null): ExplainedStepStatus {
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
