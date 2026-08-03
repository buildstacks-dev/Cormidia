import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { withFileLock, type FileLockOptions } from "../runtime/file-lock.js";
import { turnAssignmentsEqual } from "../runtime/assignment.js";
import { writeLoopFileAtomic } from "./durable.js";
import {
  efficiencyEpisodeDir,
  readExecutionSteps,
  settledProviderSteps,
} from "./efficiency.js";
import {
  episodePlanHash,
  episodePlanMutationLockPath,
  readCurrentEpisodePlan,
  readEpisodePlanVersion,
  selectReadyEpisodeSteps,
  stableHash,
  type ApprovalStep,
  type EpisodePlan,
  type EpisodeStep,
  type MechanicalGateStep,
  type ProviderTurnStep,
} from "./episode-plan.js";

/**
 * This journal is an execution projection of the accepted EpisodePlan. It is
 * deliberately not a workflow definition: step shape, dependencies, role,
 * assignment, and authority always come from the immutable plan version.
 */
export const EPISODE_PLAN_EXECUTION_JOURNAL_VERSION = 1 as const;

const HASH = /^[a-f0-9]{64}$/;
const DEFAULT_LOCK_OPTIONS: FileLockOptions = {
  staleMs: 6 * 60 * 60_000,
  maxWaitMs: 2_000,
  retryMinMs: 20,
  retryMaxMs: 60,
};

export type EpisodePlanExecutionStatus =
  | "running"
  | "waiting_approval"
  | "denied"
  | "failed"
  | "completed";

export type EpisodeStepKind = EpisodeStep["kind"];

export interface PlanAdoptedEvent {
  kind: "plan_adopted";
  plan_version: number;
  plan_sha256: string;
  at: string;
}

export interface StepStartedEvent {
  kind: "step_started";
  plan_version: number;
  plan_sha256: string;
  step_id: string;
  step_kind: EpisodeStepKind;
  step_sha256: string;
  attempt: number;
  execution_id: string;
  at: string;
}

export interface StepCompletedEvent {
  kind: "step_completed";
  plan_version: number;
  plan_sha256: string;
  step_id: string;
  step_kind: EpisodeStepKind;
  step_sha256: string;
  attempt: number;
  execution_id: string;
  artifact_sha256: string;
  /** Present on all newly written completions. Omitted only by historical v1
   * journals written before output evidence became content-bound. */
  output_artifacts?: CompletedOutputArtifact[];
  at: string;
}

export interface CompletedOutputArtifact {
  output_id: string;
  output_kind: string;
  artifact_sha256: string;
}

export interface StepFailedEvent {
  kind: "step_failed";
  plan_version: number;
  plan_sha256: string;
  step_id: string;
  step_kind: EpisodeStepKind;
  step_sha256: string;
  attempt: number;
  execution_id: string;
  reason_code: string;
  summary: string;
  artifact_sha256: string;
  at: string;
}

export interface ApprovalPendingEvent {
  kind: "approval_pending";
  plan_version: number;
  plan_sha256: string;
  step_id: string;
  step_kind: "approval";
  step_sha256: string;
  attempt: number;
  execution_id: string;
  reason_code: string;
  summary: string;
  at: string;
}

export interface ApprovalDeniedEvent {
  kind: "approval_denied";
  plan_version: number;
  plan_sha256: string;
  step_id: string;
  step_kind: "approval";
  step_sha256: string;
  attempt: number;
  execution_id: string;
  reason_code: string;
  summary: string;
  at: string;
}

/** A provider step that parked instead of settling: its per-turn budget ran out
 * while the episode still had headroom, so the turn waits on a budget decision
 * rather than having failed (epic #236).
 *
 * Deliberately NOT a `step_failed`: a failure is sticky for its plan version
 * (`blockingResult` short-circuits every later invocation), which is right for
 * a step that cannot succeed and wrong for one that is merely unfunded. Like
 * `approval_pending` it parks the journal at `waiting_approval`, so a later
 * invocation re-enters the SAME step under a new attempt — carrying the parked
 * provider session, so no completed work is repeated. */
export interface StepSuspendedEvent {
  kind: "step_suspended";
  plan_version: number;
  plan_sha256: string;
  step_id: string;
  step_kind: "provider_turn";
  step_sha256: string;
  attempt: number;
  execution_id: string;
  reason_code: string;
  summary: string;
  at: string;
}

export type EpisodePlanExecutionEvent =
  | PlanAdoptedEvent
  | StepStartedEvent
  | StepCompletedEvent
  | StepFailedEvent
  | ApprovalPendingEvent
  | ApprovalDeniedEvent
  | StepSuspendedEvent;

export interface EpisodePlanExecutionJournal {
  schema_version: typeof EPISODE_PLAN_EXECUTION_JOURNAL_VERSION;
  episode_id: string;
  current_plan_version: number;
  current_plan_sha256: string;
  status: EpisodePlanExecutionStatus;
  blocked_step_id: string | null;
  events: EpisodePlanExecutionEvent[];
  created_at: string;
  updated_at: string;
}

export interface EpisodeStepExecutionContext {
  episodeId: string;
  planVersion: number;
  planHash: string;
  stepId: string;
  stepHash: string;
  attempt: number;
  /** Stable across a crash/restart of the same attempt. */
  executionId: string;
  resume: boolean;
}

export type EpisodeStepCompletedOutcome = {
  status: "completed";
  /** Content that proves the planned step completed. The executor binds this
   * exact hash to every required expected output in durable evidence. */
  artifact: unknown;
};

export type EpisodeStepFailedOutcome = {
  status: "failed";
  reasonCode: string;
  summary: string;
  artifact?: unknown;
};

/** Provider-step counterpart of an approval `pending`: parked, resumable, and
 * explicitly not terminal. Only a provider step may return it — a mechanical
 * gate spends nothing and has no per-turn budget to exhaust. */
export type EpisodeStepSuspendedOutcome = {
  status: "suspended";
  reasonCode: string;
  summary: string;
};

export type ProviderStepOutcome =
  | EpisodeStepCompletedOutcome
  | EpisodeStepFailedOutcome
  | EpisodeStepSuspendedOutcome;

export type ApprovalStepOutcome =
  | EpisodeStepCompletedOutcome
  | EpisodeStepFailedOutcome
  | {
      status: "pending";
      reasonCode: string;
      summary: string;
    }
  | {
      status: "denied";
      reasonCode: string;
      summary: string;
    };

/** Every shape a handler may return, across all step kinds. `validateOutcome`
 * is what rejects a shape a given kind is not allowed to produce. */
type StepOutcome = ApprovalStepOutcome | EpisodeStepSuspendedOutcome;

export interface EpisodePlanStepHandlers {
  provider(
    step: ProviderTurnStep,
    context: EpisodeStepExecutionContext,
  ): Promise<ProviderStepOutcome>;
  mechanical(
    step: MechanicalGateStep,
    context: EpisodeStepExecutionContext,
  ): Promise<EpisodeStepCompletedOutcome | EpisodeStepFailedOutcome>;
  approval(
    step: ApprovalStep,
    context: EpisodeStepExecutionContext,
  ): Promise<ApprovalStepOutcome>;
}

export interface ExecuteEpisodePlanOptions {
  root: string;
  plan: EpisodePlan;
  handlers: EpisodePlanStepHandlers;
  /** Runs under the same plan/execution lock after the current plan identity
   * is verified and before the first handler. Use this for derived route
   * admission so a stale plan can never win first-writer authority. */
  beforeExecution?: (input: { plan: EpisodePlan; planHash: string }) => Promise<void>;
  /** Runs under the same lock only when every current-plan step is complete.
   * Terminal route state therefore cannot race a forward-only revision. */
  afterCompletion?: (input: { plan: EpisodePlan; planHash: string }) => Promise<void>;
  /** Limits provider/mechanical/approval handler calls in this invocation. */
  maxSteps?: number;
  /** Asked before a provider step is STARTED; returning true stops the
   * invocation and returns `running` with that step queued as `nextStepId`.
   * An adopted revision uses this: its accepted plan must reach gates and PR
   * in the same invocation (#175), but it must not spend a second provider
   * turn re-entering the exact step whose failure authorized the revision —
   * that failure is often an unavailable assignment. The predicate owns the
   * whole policy, including whether a step merely replays durable evidence
   * (not a new turn) and which steps the revision repairs. Steps already
   * started stay recoverable; only an unstarted one is withheld. */
  haltBeforeNewProviderTurn?: (step: EpisodeStep) => Promise<boolean>;
  now?: () => Date;
  lockOptions?: FileLockOptions;
}

export interface EpisodePlanExecutionResult {
  status: EpisodePlanExecutionStatus;
  episodeId: string;
  planVersion: number;
  planHash: string;
  completedStepIds: string[];
  nextStepId: string | null;
  lastStepId: string | null;
  reasonCode?: string;
  summary?: string;
}

export type EpisodePlanExecutionErrorCode =
  | "error_episode_plan_not_persisted"
  | "error_episode_plan_execution_plan_mismatch"
  | "error_episode_plan_execution_journal_corrupt"
  | "error_episode_plan_execution_identity_conflict"
  | "error_episode_plan_execution_revision_active"
  | "error_episode_plan_execution_completed_step_changed"
  | "error_episode_plan_execution_dependency_failed"
  | "error_episode_plan_execution_no_ready_step"
  | "error_episode_plan_execution_outcome_invalid"
  | "error_episode_plan_step_interrupted";

export class EpisodePlanExecutionError extends Error {
  constructor(
    readonly code: EpisodePlanExecutionErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "EpisodePlanExecutionError";
  }
}

export function episodePlanExecutionJournalPath(root: string, episodeId: string): string {
  return join(efficiencyEpisodeDir(root, episodeId), "plan-execution-journal.json");
}

export function episodePlanExecutionLockPath(root: string, episodeId: string): string {
  return episodePlanMutationLockPath(root, episodeId);
}

export async function readEpisodePlanExecutionJournal(
  root: string,
  episodeId: string,
): Promise<EpisodePlanExecutionJournal | undefined> {
  const path = episodePlanExecutionJournalPath(root, episodeId);
  if (!existsSync(path)) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw executionError(
      "error_episode_plan_execution_journal_corrupt",
      `plan execution journal for ${episodeId} is not valid JSON`,
      error,
    );
  }
  if (!isExecutionJournal(value) || value.episode_id !== episodeId) {
    throw new EpisodePlanExecutionError(
      "error_episode_plan_execution_journal_corrupt",
      `plan execution journal for ${episodeId} is not a strict matching v1 journal`,
    );
  }
  assertJournalLifecycle(value);
  return value;
}

/** Completed ids are derived only from durable terminal events. */
export function completedEpisodePlanStepIds(
  journal: EpisodePlanExecutionJournal,
): string[] {
  assertJournalLifecycle(journal);
  return [...completedEvents(journal).keys()].sort((left, right) => left.localeCompare(right));
}

/**
 * Executes the accepted DAG serially in stable ready-step order. Parallel-ready
 * work is intentionally deterministic here; parallelism can be added above
 * this boundary only with a separate, explicit concurrency policy.
 */
export async function executeEpisodePlan(
  options: ExecuteEpisodePlanOptions,
): Promise<EpisodePlanExecutionResult> {
  const maxSteps = options.maxSteps ?? Number.MAX_SAFE_INTEGER;
  if (!Number.isSafeInteger(maxSteps) || maxSteps < 0) {
    throw new EpisodePlanExecutionError(
      "error_episode_plan_execution_outcome_invalid",
      "maxSteps must be a non-negative safe integer",
    );
  }
  return withFileLock(
    episodePlanExecutionLockPath(options.root, options.plan.episodeId),
    options.lockOptions ?? DEFAULT_LOCK_OPTIONS,
    async () => executeLocked(options, maxSteps),
  );
}

async function executeLocked(
  options: ExecuteEpisodePlanOptions,
  maxSteps: number,
): Promise<EpisodePlanExecutionResult> {
  const clock = options.now ?? (() => new Date());
  const planHash = await assertPersistedCurrentPlan(options.root, options.plan);
  await options.beforeExecution?.({ plan: options.plan, planHash });
  let journal = await readEpisodePlanExecutionJournal(options.root, options.plan.episodeId);
  if (journal === undefined) {
    journal = newJournal(options.plan, planHash, clock());
    await writeJournal(options.root, journal);
  } else {
    journal = await adoptCurrentPlan(options.root, journal, options.plan, planHash, clock());
  }

  let calls = 0;
  let lastStepId: string | null = null;
  for (;;) {
    // A plan revision is allowed only between handler calls. If another writer
    // advances the pointer during execution, the next side effect fails closed.
    await assertPersistedCurrentPlan(options.root, options.plan);
    assertJournalMatchesPlan(journal, options.plan, planHash);

    const blocked = blockingResult(journal, options.plan, planHash, lastStepId);
    if (blocked !== undefined) return blocked;

    const completed = completedEvents(journal);
    if (journal.status === "completed" && completed.size !== options.plan.steps.length) {
      throw new EpisodePlanExecutionError(
        "error_episode_plan_execution_journal_corrupt",
        "execution journal is terminal but not every current-plan step is durably completed",
      );
    }
    if (completed.size === options.plan.steps.length) {
      journal = {
        ...journal,
        status: "completed",
        blocked_step_id: null,
        updated_at: clock().toISOString(),
      };
      await writeJournal(options.root, journal);
      await options.afterCompletion?.({ plan: options.plan, planHash });
      return result(journal, options.plan, planHash, null, lastStepId);
    }

    if (calls >= maxSteps) {
      const next = nextStep(journal, options.plan, completed);
      return result(journal, options.plan, planHash, next.id, lastStepId);
    }

    const active = activeStartedEvent(journal);
    const step = active === undefined
      ? nextStep(journal, options.plan, completed)
      : currentStepForActive(options.plan, planHash, active, completed);
    if (
      options.haltBeforeNewProviderTurn !== undefined &&
      active === undefined &&
      step.kind === "provider_turn" &&
      await options.haltBeforeNewProviderTurn(step)
    ) {
      return result(journal, options.plan, planHash, step.id, lastStepId);
    }
    const handler = handlerFor(step, options.handlers);
    let started = active;
    if (started === undefined) {
      const attempt = attemptsFor(journal, options.plan.version, step.id) + 1;
      started = startEvent(options.plan, planHash, step, attempt, clock());
      journal = {
        ...journal,
        status: "running",
        blocked_step_id: null,
        events: [...journal.events, started],
        updated_at: started.at,
      };
      await writeJournal(options.root, journal);
    }

    const context: EpisodeStepExecutionContext = {
      episodeId: options.plan.episodeId,
      planVersion: options.plan.version,
      planHash,
      stepId: step.id,
      stepHash: started.step_sha256,
      attempt: started.attempt,
      executionId: started.execution_id,
      resume: active !== undefined,
    };
    let outcome: StepOutcome;
    try {
      outcome = await handler(context);
    } catch (error) {
      if (await hasMatchingTerminalProviderEvidence(options.root, options.plan, step)) {
        // A process may die after the paid provider boundary is immutable but
        // before a domain handler finishes its deterministic tail (for
        // example, governed verdict persistence). Keep that one started event
        // active so a later invocation can recover the terminal provider
        // evidence without another model turn.
        throw executionError(
          "error_episode_plan_step_interrupted",
          `step ${step.id} was interrupted after durable start with terminal provider evidence`,
          error,
        );
      }
      // A caught handler exception before any matching terminal provider
      // evidence is not an exactly-once continuation boundary. Leaving the
      // started event active would wedge forward-only revision forever. Make
      // the failed attempt durable so the caller can request a typed replan.
      outcome = {
        status: "failed",
        reasonCode: handlerFailureReasonCode(error),
        summary: error instanceof Error ? error.message : String(error),
      };
    }
    validateOutcome(step, outcome);

    // Plan publication shares this execution lock. Re-check the durable pointer
    // before terminal evidence anyway, so lock/pointer corruption can never
    // join one side effect silently to a superseding plan.
    await assertPersistedCurrentPlan(options.root, options.plan);
    calls += 1;
    lastStepId = step.id;
    const terminal = terminalEvent(options.plan, planHash, step, started, outcome, clock());
    journal = applyTerminalEvent(journal, terminal);
    await writeJournal(options.root, journal);
    if (terminal.kind !== "step_completed") {
      return result(
        journal,
        options.plan,
        planHash,
        terminal.step_id,
        lastStepId,
        terminal.reason_code,
        terminal.summary,
      );
    }
  }
}

async function hasMatchingTerminalProviderEvidence(
  root: string,
  plan: EpisodePlan,
  step: EpisodeStep,
): Promise<boolean> {
  if (step.kind !== "provider_turn") return false;
  // Parked turns are excluded: they are terminal EXECUTION records but not
  // step evidence, and a step legitimately accumulates one per budget grant.
  const matching = settledProviderSteps(await readExecutionSteps(root, plan.episodeId)).filter(
    (record) =>
      record.kind === "provider" &&
      record.plan_version === plan.version &&
      record.plan_step_id === step.id,
  );
  if (matching.length > 1) {
    throw new EpisodePlanExecutionError(
      "error_episode_plan_execution_journal_corrupt",
      `provider step ${step.id} has ${matching.length} terminal execution records`,
    );
  }
  const record = matching[0];
  if (record === undefined) return false;
  if (
    record.role !== step.role ||
    record.runtime === null ||
    record.model === null ||
    record.effort === null ||
    !turnAssignmentsEqual(
      { harness: record.runtime, model: record.model, effort: record.effort },
      step.assignment,
    ) ||
    record.assignment_source !== step.assignmentSource
  ) {
    throw new EpisodePlanExecutionError(
      "error_episode_plan_execution_journal_corrupt",
      `terminal provider evidence for ${step.id} differs from the accepted plan`,
    );
  }
  return true;
}

function handlerFailureReasonCode(error: unknown): string {
  if (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string" &&
    nonEmpty(error.code)
  ) {
    return error.code;
  }
  return "error_episode_plan_step_handler_failed";
}

async function assertPersistedCurrentPlan(root: string, plan: EpisodePlan): Promise<string> {
  const persisted = await readCurrentEpisodePlan(root, plan.episodeId);
  if (persisted === undefined) {
    throw new EpisodePlanExecutionError(
      "error_episode_plan_not_persisted",
      `episode ${plan.episodeId} has no accepted persisted plan`,
    );
  }
  const suppliedHash = episodePlanHash(plan);
  if (persisted.version !== plan.version || episodePlanHash(persisted) !== suppliedHash) {
    throw new EpisodePlanExecutionError(
      "error_episode_plan_execution_plan_mismatch",
      `supplied plan v${plan.version} is not the current persisted plan for ${plan.episodeId}`,
    );
  }
  return suppliedHash;
}

async function adoptCurrentPlan(
  root: string,
  journal: EpisodePlanExecutionJournal,
  plan: EpisodePlan,
  planHash: string,
  now: Date,
): Promise<EpisodePlanExecutionJournal> {
  assertJournalLifecycle(journal);
  if (journal.episode_id !== plan.episodeId) {
    throw new EpisodePlanExecutionError(
      "error_episode_plan_execution_identity_conflict",
      `execution journal episode ${journal.episode_id} does not match ${plan.episodeId}`,
    );
  }
  if (journal.current_plan_version === plan.version) {
    if (journal.current_plan_sha256 !== planHash) {
      throw new EpisodePlanExecutionError(
        "error_episode_plan_execution_plan_mismatch",
        `execution journal plan hash does not match persisted plan v${plan.version}`,
      );
    }
    assertCompletedStepsPreserved(journal, plan);
    return journal;
  }
  if (journal.current_plan_version > plan.version) {
    throw new EpisodePlanExecutionError(
      "error_episode_plan_execution_plan_mismatch",
      `execution journal is already on plan v${journal.current_plan_version}, not v${plan.version}`,
    );
  }
  if (activeStartedEvent(journal) !== undefined) {
    throw new EpisodePlanExecutionError(
      "error_episode_plan_execution_revision_active",
      "cannot adopt a plan revision while a prior-version step has an unterminated execution",
    );
  }
  const priorPlan = await readEpisodePlanVersion(root, plan.episodeId, journal.current_plan_version);
  if (priorPlan === undefined || episodePlanHash(priorPlan) !== journal.current_plan_sha256) {
    throw new EpisodePlanExecutionError(
      "error_episode_plan_execution_journal_corrupt",
      `journal plan v${journal.current_plan_version} does not match immutable persisted evidence`,
    );
  }
  assertCompletedStepsPreserved(journal, plan);
  const adopted: PlanAdoptedEvent = {
    kind: "plan_adopted",
    plan_version: plan.version,
    plan_sha256: planHash,
    at: now.toISOString(),
  };
  const updated: EpisodePlanExecutionJournal = {
    ...journal,
    current_plan_version: plan.version,
    current_plan_sha256: planHash,
    status: "running",
    blocked_step_id: null,
    events: [...journal.events, adopted],
    updated_at: adopted.at,
  };
  await writeJournal(root, updated);
  return updated;
}

function assertCompletedStepsPreserved(
  journal: EpisodePlanExecutionJournal,
  plan: EpisodePlan,
): void {
  const byId = new Map(plan.steps.map((step) => [step.id, step]));
  for (const [stepId, event] of completedEvents(journal)) {
    const step = byId.get(stepId);
    if (step === undefined || stableHash(step) !== event.step_sha256) {
      throw new EpisodePlanExecutionError(
        "error_episode_plan_execution_completed_step_changed",
        `completed step ${stepId} is absent or changed in plan v${plan.version}`,
      );
    }
    assertCompletedOutputArtifacts(step, event);
  }
}

function assertCompletedOutputArtifacts(step: EpisodeStep, event: StepCompletedEvent): void {
  // Absence is the compatibility shape for historical v1 journals. New
  // completions always carry this field and are checked exactly.
  if (event.output_artifacts === undefined) return;
  const expected = step.expectedOutputs
    .filter((output) => output.required)
    .map((output) => `${output.id}\0${output.kind}\0${event.artifact_sha256}`)
    .sort();
  const observed = event.output_artifacts
    .map((output) => `${output.output_id}\0${output.output_kind}\0${output.artifact_sha256}`)
    .sort();
  if (stableHash(expected) !== stableHash(observed)) {
    throw new EpisodePlanExecutionError(
      "error_episode_plan_execution_journal_corrupt",
      `completed step ${step.id} output artifacts do not match its required expected outputs`,
    );
  }
}

function assertJournalMatchesPlan(
  journal: EpisodePlanExecutionJournal,
  plan: EpisodePlan,
  planHash: string,
): void {
  if (
    journal.episode_id !== plan.episodeId ||
    journal.current_plan_version !== plan.version ||
    journal.current_plan_sha256 !== planHash
  ) {
    throw new EpisodePlanExecutionError(
      "error_episode_plan_execution_plan_mismatch",
      "execution journal is not bound to the supplied current plan",
    );
  }
  assertCompletedStepsPreserved(journal, plan);
}

function nextStep(
  journal: EpisodePlanExecutionJournal,
  plan: EpisodePlan,
  completed: Map<string, StepCompletedEvent>,
): EpisodeStep {
  if (journal.status === "waiting_approval" && journal.blocked_step_id !== null) {
    const parked = plan.steps.find((step) => step.id === journal.blocked_step_id);
    // `waiting_approval` is reachable two ways, and the parked step's kind must
    // match the event that parked it: a provider step may only be waiting
    // because it was suspended, never because an approval step went pending.
    const parkedBy = latestPlanEventFor(journal, plan.version, journal.blocked_step_id);
    const expectedKind = parkedBy?.kind === "step_suspended" ? "provider_turn" : "approval";
    if (
      parked?.kind !== expectedKind ||
      !parked.dependsOn.every((id) => completed.has(id))
    ) {
      throw new EpisodePlanExecutionError(
        "error_episode_plan_execution_dependency_failed",
        `parked step ${journal.blocked_step_id} no longer has a valid completed dependency set`,
      );
    }
    return parked;
  }
  const ready = selectReadyEpisodeSteps(plan, [...completed.keys()]);
  const step = ready[0];
  if (step === undefined) {
    throw new EpisodePlanExecutionError(
      "error_episode_plan_execution_no_ready_step",
      "episode is incomplete but no plan step is ready",
    );
  }
  return step;
}

function currentStepForActive(
  plan: EpisodePlan,
  planHash: string,
  active: StepStartedEvent,
  completed: Map<string, StepCompletedEvent>,
): EpisodeStep {
  const step = plan.steps.find((candidate) => candidate.id === active.step_id);
  if (
    step === undefined ||
    active.plan_version !== plan.version ||
    active.plan_sha256 !== planHash ||
    active.step_kind !== step.kind ||
    active.step_sha256 !== stableHash(step)
  ) {
    throw new EpisodePlanExecutionError(
      "error_episode_plan_execution_plan_mismatch",
      `unterminated execution ${active.execution_id} is not authorized by current plan v${plan.version}`,
    );
  }
  if (!step.dependsOn.every((dependency) => completed.has(dependency))) {
    throw new EpisodePlanExecutionError(
      "error_episode_plan_execution_dependency_failed",
      `unterminated execution ${active.execution_id} has an incomplete dependency`,
    );
  }
  return step;
}

function handlerFor(
  step: EpisodeStep,
  handlers: EpisodePlanStepHandlers,
): (context: EpisodeStepExecutionContext) => Promise<StepOutcome> {
  if (step.kind === "provider_turn") return (context) => handlers.provider(step, context);
  if (step.kind === "mechanical_gate") return (context) => handlers.mechanical(step, context);
  return (context) => handlers.approval(step, context);
}

function startEvent(
  plan: EpisodePlan,
  planHash: string,
  step: EpisodeStep,
  attempt: number,
  now: Date,
): StepStartedEvent {
  const executionId = `${plan.episodeId}:plan-v${plan.version}:${step.id}:attempt-${attempt}`;
  return {
    kind: "step_started",
    plan_version: plan.version,
    plan_sha256: planHash,
    step_id: step.id,
    step_kind: step.kind,
    step_sha256: stableHash(step),
    attempt,
    execution_id: executionId,
    at: now.toISOString(),
  };
}

function terminalEvent(
  plan: EpisodePlan,
  planHash: string,
  step: EpisodeStep,
  started: StepStartedEvent,
  outcome: StepOutcome,
  now: Date,
): TerminalStepEvent {
  const base = {
    plan_version: plan.version,
    plan_sha256: planHash,
    step_id: step.id,
    step_kind: step.kind,
    step_sha256: started.step_sha256,
    attempt: started.attempt,
    execution_id: started.execution_id,
    at: now.toISOString(),
  };
  if (outcome.status === "completed") {
    const artifactSha256 = stableHash(outcome.artifact);
    return {
      ...base,
      kind: "step_completed",
      artifact_sha256: artifactSha256,
      output_artifacts: step.expectedOutputs
        .filter((output) => output.required)
        .map((output) => ({
          output_id: output.id,
          output_kind: output.kind,
          artifact_sha256: artifactSha256,
        })),
    };
  }
  if (outcome.status === "failed") {
    return {
      ...base,
      kind: "step_failed",
      reason_code: outcome.reasonCode,
      summary: outcome.summary,
      artifact_sha256: stableHash(outcome.artifact ?? null),
    };
  }
  if (outcome.status === "suspended") {
    if (step.kind !== "provider_turn") throw invalidOutcome(step, outcome.status);
    return {
      ...base,
      kind: "step_suspended",
      step_kind: "provider_turn",
      reason_code: outcome.reasonCode,
      summary: outcome.summary,
    };
  }
  if (outcome.status === "pending") {
    if (step.kind !== "approval") throw invalidOutcome(step, outcome.status);
    return {
      ...base,
      kind: "approval_pending",
      step_kind: "approval",
      reason_code: outcome.reasonCode,
      summary: outcome.summary,
    };
  }
  if (step.kind !== "approval") throw invalidOutcome(step, outcome.status);
  return {
    ...base,
    kind: "approval_denied",
    step_kind: "approval",
    reason_code: outcome.reasonCode,
    summary: outcome.summary,
  };
}

/** Every event that terminates one step ATTEMPT. `step_suspended` terminates
 * an attempt without terminating the step: the step itself stays open. */
type TerminalStepEvent =
  | StepCompletedEvent
  | StepFailedEvent
  | ApprovalPendingEvent
  | ApprovalDeniedEvent
  | StepSuspendedEvent;

function applyTerminalEvent(
  journal: EpisodePlanExecutionJournal,
  event: TerminalStepEvent,
): EpisodePlanExecutionJournal {
  const status: EpisodePlanExecutionStatus = event.kind === "step_completed"
    ? "running"
    : event.kind === "step_failed"
      ? "failed"
      // A budget suspension parks exactly like a pending approval: both are
      // "this step is open and waiting on a human decision".
      : event.kind === "approval_pending" || event.kind === "step_suspended"
        ? "waiting_approval"
        : "denied";
  return {
    ...journal,
    status,
    blocked_step_id: event.kind === "step_completed" ? null : event.step_id,
    events: [...journal.events, event],
    updated_at: event.at,
  };
}

function validateOutcome(step: EpisodeStep, outcome: StepOutcome): void {
  if (outcome === null || typeof outcome !== "object") throw invalidOutcome(step, "non-object");
  if (outcome.status === "completed") {
    if (!("artifact" in outcome) || outcome.artifact === undefined || outcome.artifact === null) {
      throw invalidOutcome(step, "completed-without-artifact");
    }
    try {
      stableHash(outcome.artifact);
    } catch {
      throw invalidOutcome(step, "completed-with-non-durable-artifact");
    }
    return;
  }
  if (outcome.status === "failed") {
    if (nonEmpty(outcome.reasonCode) && nonEmpty(outcome.summary)) return;
    throw invalidOutcome(step, "failed-without-reason");
  }
  if (step.kind === "approval" && (outcome.status === "pending" || outcome.status === "denied")) {
    if (nonEmpty(outcome.reasonCode) && nonEmpty(outcome.summary)) return;
  }
  if (step.kind === "provider_turn" && outcome.status === "suspended") {
    if (nonEmpty(outcome.reasonCode) && nonEmpty(outcome.summary)) return;
  }
  throw invalidOutcome(step, "unsupported-status");
}

function invalidOutcome(step: EpisodeStep, status: string): EpisodePlanExecutionError {
  return new EpisodePlanExecutionError(
    "error_episode_plan_execution_outcome_invalid",
    `handler returned ${status} for ${step.kind} step ${step.id}`,
  );
}

function blockingResult(
  journal: EpisodePlanExecutionJournal,
  plan: EpisodePlan,
  planHash: string,
  lastStepId: string | null,
): EpisodePlanExecutionResult | undefined {
  if (journal.status !== "failed" && journal.status !== "denied") return undefined;
  const stepId = journal.blocked_step_id;
  if (stepId === null) {
    throw new EpisodePlanExecutionError(
      "error_episode_plan_execution_journal_corrupt",
      `${journal.status} journal has no blocked step`,
    );
  }
  const event = [...journal.events].reverse().find((candidate) =>
    candidate.kind !== "plan_adopted" &&
    candidate.plan_version === plan.version &&
    candidate.step_id === stepId &&
    (candidate.kind === "step_failed" || candidate.kind === "approval_denied"));
  if (event === undefined || (event.kind !== "step_failed" && event.kind !== "approval_denied")) {
    throw new EpisodePlanExecutionError(
      "error_episode_plan_execution_dependency_failed",
      `blocked step ${stepId} has no matching terminal failure`,
    );
  }
  return result(journal, plan, planHash, stepId, lastStepId, event.reason_code, event.summary);
}

function result(
  journal: EpisodePlanExecutionJournal,
  plan: EpisodePlan,
  planHash: string,
  nextStepId: string | null,
  lastStepId: string | null,
  reasonCode?: string,
  summary?: string,
): EpisodePlanExecutionResult {
  return {
    status: journal.status,
    episodeId: plan.episodeId,
    planVersion: plan.version,
    planHash,
    completedStepIds: completedEpisodePlanStepIds(journal),
    nextStepId,
    lastStepId,
    ...(reasonCode !== undefined ? { reasonCode } : {}),
    ...(summary !== undefined ? { summary } : {}),
  };
}

function newJournal(plan: EpisodePlan, planHash: string, now: Date): EpisodePlanExecutionJournal {
  const at = now.toISOString();
  return {
    schema_version: EPISODE_PLAN_EXECUTION_JOURNAL_VERSION,
    episode_id: plan.episodeId,
    current_plan_version: plan.version,
    current_plan_sha256: planHash,
    status: "running",
    blocked_step_id: null,
    events: [{ kind: "plan_adopted", plan_version: plan.version, plan_sha256: planHash, at }],
    created_at: at,
    updated_at: at,
  };
}

function attemptsFor(journal: EpisodePlanExecutionJournal, planVersion: number, stepId: string): number {
  return journal.events.filter((event) =>
    event.kind === "step_started" && event.plan_version === planVersion && event.step_id === stepId).length;
}

function completedEvents(journal: EpisodePlanExecutionJournal): Map<string, StepCompletedEvent> {
  const completed = new Map<string, StepCompletedEvent>();
  for (const event of journal.events) {
    if (event.kind !== "step_completed") continue;
    const prior = completed.get(event.step_id);
    if (prior !== undefined) {
      throw new EpisodePlanExecutionError(
        "error_episode_plan_execution_journal_corrupt",
        `completed step ${event.step_id} has more than one terminal completion`,
      );
    }
    completed.set(event.step_id, event);
  }
  return completed;
}

/** Latest terminal event for one step within one plan version — what parked
 * the journal, when it is parked. */
function latestPlanEventFor(
  journal: EpisodePlanExecutionJournal,
  planVersion: number,
  stepId: string,
): TerminalStepEvent | undefined {
  return [...journal.events].reverse().find((event): event is TerminalStepEvent =>
    event.kind !== "plan_adopted" &&
    event.kind !== "step_started" &&
    event.plan_version === planVersion &&
    event.step_id === stepId);
}

function activeStartedEvent(journal: EpisodePlanExecutionJournal): StepStartedEvent | undefined {
  const terminalIds = new Set(journal.events.flatMap((event) =>
    event.kind === "step_completed" || event.kind === "step_failed" ||
    event.kind === "approval_pending" || event.kind === "approval_denied" ||
    event.kind === "step_suspended"
      ? [event.execution_id]
      : []));
  const active = journal.events.filter(
    (event): event is StepStartedEvent => event.kind === "step_started" && !terminalIds.has(event.execution_id),
  );
  if (active.length > 1) {
    throw new EpisodePlanExecutionError(
      "error_episode_plan_execution_journal_corrupt",
      "execution journal has multiple unterminated steps",
    );
  }
  return active[0];
}

function assertJournalLifecycle(journal: EpisodePlanExecutionJournal): void {
  const starts = new Map<string, StepStartedEvent>();
  const terminals = new Set<string>();
  const completed = new Set<string>();
  const attempts = new Map<string, number>();
  const adoptions = new Map<number, string>();
  let adoptedVersion = 0;
  for (const event of journal.events) {
    if (event.kind === "plan_adopted") {
      if (event.plan_version <= adoptedVersion) {
        corrupt(`plan adoption is not forward-only at v${event.plan_version}`);
      }
      adoptedVersion = event.plan_version;
      adoptions.set(event.plan_version, event.plan_sha256);
      continue;
    }
    if (adoptions.get(event.plan_version) !== event.plan_sha256) {
      corrupt(`execution ${event.execution_id} is not linked to an adopted plan version`);
    }
    if (event.kind === "step_started") {
      if (starts.has(event.execution_id)) corrupt(`duplicate start ${event.execution_id}`);
      const stepKey = `${event.plan_version}\0${event.step_id}`;
      if (completed.has(stepKey)) corrupt(`completed step ${event.step_id} was started again in plan v${event.plan_version}`);
      const expectedAttempt = (attempts.get(stepKey) ?? 0) + 1;
      if (event.attempt !== expectedAttempt) {
        corrupt(`step ${event.step_id} attempt ${event.attempt} is not contiguous; expected ${expectedAttempt}`);
      }
      attempts.set(stepKey, event.attempt);
      starts.set(event.execution_id, event);
      continue;
    }
    const started = starts.get(event.execution_id);
    if (started === undefined) corrupt(`terminal event ${event.execution_id} has no durable start`);
    if (terminals.has(event.execution_id)) corrupt(`execution ${event.execution_id} has multiple terminal events`);
    if (
      started.plan_version !== event.plan_version ||
      started.plan_sha256 !== event.plan_sha256 ||
      started.step_id !== event.step_id ||
      started.step_kind !== event.step_kind ||
      started.step_sha256 !== event.step_sha256 ||
      started.attempt !== event.attempt
    ) {
      corrupt(`terminal event ${event.execution_id} does not match its durable start`);
    }
    terminals.add(event.execution_id);
    if (event.kind === "step_completed") completed.add(`${event.plan_version}\0${event.step_id}`);
  }
  const active = activeStartedEvent(journal);
  completedEvents(journal);
  if ((journal.status === "running" || journal.status === "completed") && journal.blocked_step_id !== null) {
    corrupt(`${journal.status} journal cannot name a blocked step`);
  }
  if (
    (journal.status === "waiting_approval" || journal.status === "failed" || journal.status === "denied") &&
    journal.blocked_step_id === null
  ) {
    corrupt(`${journal.status} journal must name its blocked step`);
  }
  if (active !== undefined && (journal.status !== "running" || journal.blocked_step_id !== null)) {
    corrupt(`unterminated execution ${active.execution_id} has inconsistent journal status`);
  }
  const currentEvents = journal.events.filter((event) =>
    event.kind !== "plan_adopted" && event.plan_version === journal.current_plan_version);
  const latest = currentEvents.at(-1);
  if (journal.status === "waiting_approval" &&
      ((latest?.kind !== "approval_pending" && latest?.kind !== "step_suspended") ||
        latest.step_id !== journal.blocked_step_id)) {
    corrupt(`parked step ${journal.blocked_step_id ?? "<missing>"} lacks a matching current-plan event`);
  }
  if (journal.status === "failed" &&
      (latest?.kind !== "step_failed" || latest.step_id !== journal.blocked_step_id)) {
    corrupt(`failed step ${journal.blocked_step_id ?? "<missing>"} lacks a matching current-plan event`);
  }
  if (journal.status === "denied" &&
      (latest?.kind !== "approval_denied" || latest.step_id !== journal.blocked_step_id)) {
    corrupt(`denied approval ${journal.blocked_step_id ?? "<missing>"} lacks a matching current-plan event`);
  }
  if (journal.status === "running" && active === undefined &&
      latest !== undefined && latest.kind !== "step_completed") {
    corrupt(`running journal has inconsistent latest event ${latest.kind}`);
  }
}

async function writeJournal(root: string, journal: EpisodePlanExecutionJournal): Promise<void> {
  assertJournalLifecycle(journal);
  await writeLoopFileAtomic(
    episodePlanExecutionJournalPath(root, journal.episode_id),
    `${JSON.stringify(journal, null, 2)}\n`,
  );
}

function isExecutionJournal(value: unknown): value is EpisodePlanExecutionJournal {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    "schema_version", "episode_id", "current_plan_version", "current_plan_sha256",
    "status", "blocked_step_id", "events", "created_at", "updated_at",
  ])) return false;
  if (
    value.schema_version !== EPISODE_PLAN_EXECUTION_JOURNAL_VERSION ||
    !nonEmpty(value.episode_id) ||
    !positiveInteger(value.current_plan_version) ||
    typeof value.current_plan_sha256 !== "string" || !HASH.test(value.current_plan_sha256) ||
    !["running", "waiting_approval", "denied", "failed", "completed"].includes(String(value.status)) ||
    !(value.blocked_step_id === null || nonEmpty(value.blocked_step_id)) ||
    !Array.isArray(value.events) || value.events.length === 0 || value.events.some((event) => !isExecutionEvent(event)) ||
    !validTimestamp(value.created_at) || !validTimestamp(value.updated_at)
  ) return false;
  const lastAdopted = [...value.events].reverse().find((event) => event.kind === "plan_adopted");
  return lastAdopted?.plan_version === value.current_plan_version &&
    lastAdopted.plan_sha256 === value.current_plan_sha256;
}

function isExecutionEvent(value: unknown): value is EpisodePlanExecutionEvent {
  if (!isRecord(value) || typeof value.kind !== "string") return false;
  if (value.kind === "plan_adopted") {
    return hasOnlyKeys(value, ["kind", "plan_version", "plan_sha256", "at"]) &&
      validEventPlan(value) && validTimestamp(value.at);
  }
  const commonKeys = [
    "kind", "plan_version", "plan_sha256", "step_id", "step_kind", "step_sha256",
    "attempt", "execution_id", "at",
  ];
  if (
    !validEventPlan(value) || !nonEmpty(value.step_id) ||
    !["provider_turn", "mechanical_gate", "approval"].includes(String(value.step_kind)) ||
    typeof value.step_sha256 !== "string" || !HASH.test(value.step_sha256) ||
    !positiveInteger(value.attempt) || !nonEmpty(value.execution_id) || !validTimestamp(value.at)
  ) return false;
  if (value.kind === "step_started") return hasOnlyKeys(value, commonKeys);
  if (value.kind === "step_completed") {
    return hasOnlyOptionalKeys(
      value,
      [...commonKeys, "artifact_sha256", "output_artifacts"],
      [...commonKeys, "artifact_sha256"],
    ) && typeof value.artifact_sha256 === "string" && HASH.test(value.artifact_sha256) &&
      (value.output_artifacts === undefined ||
        validCompletedOutputArtifacts(value.output_artifacts, value.artifact_sha256));
  }
  if (value.kind === "step_failed") {
    return hasOnlyKeys(value, [...commonKeys, "reason_code", "summary", "artifact_sha256"]) &&
      nonEmpty(value.reason_code) && nonEmpty(value.summary) &&
      typeof value.artifact_sha256 === "string" && HASH.test(value.artifact_sha256);
  }
  if (value.kind === "approval_pending" || value.kind === "approval_denied") {
    return hasOnlyKeys(value, [...commonKeys, "reason_code", "summary"]) &&
      value.step_kind === "approval" && nonEmpty(value.reason_code) && nonEmpty(value.summary);
  }
  if (value.kind === "step_suspended") {
    return hasOnlyKeys(value, [...commonKeys, "reason_code", "summary"]) &&
      value.step_kind === "provider_turn" && nonEmpty(value.reason_code) && nonEmpty(value.summary);
  }
  return false;
}

function validEventPlan(value: Record<string, unknown>): boolean {
  return positiveInteger(value.plan_version) &&
    typeof value.plan_sha256 === "string" && HASH.test(value.plan_sha256);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key)) && keys.every((key) => key in value);
}

function hasOnlyOptionalKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
  requiredKeys: readonly string[],
): boolean {
  const allowed = new Set(allowedKeys);
  return Object.keys(value).every((key) => allowed.has(key)) &&
    requiredKeys.every((key) => key in value);
}

function isCompletedOutputArtifact(value: unknown): value is CompletedOutputArtifact {
  return isRecord(value) &&
    hasOnlyKeys(value, ["output_id", "output_kind", "artifact_sha256"]) &&
    nonEmpty(value.output_id) && nonEmpty(value.output_kind) &&
    typeof value.artifact_sha256 === "string" && HASH.test(value.artifact_sha256);
}

function validCompletedOutputArtifacts(value: unknown, artifactSha256: string): boolean {
  if (!Array.isArray(value) || !value.every(isCompletedOutputArtifact)) return false;
  const identities = value.map((output) => `${output.output_id}\0${output.output_kind}`);
  return new Set(identities).size === identities.length &&
    value.every((output) => output.artifact_sha256 === artifactSha256);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "" && Number.isFinite(Date.parse(value));
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function corrupt(message: string): never {
  throw new EpisodePlanExecutionError("error_episode_plan_execution_journal_corrupt", message);
}

function executionError(
  code: EpisodePlanExecutionErrorCode,
  message: string,
  cause: unknown,
): EpisodePlanExecutionError {
  return new EpisodePlanExecutionError(code, message, { cause });
}
