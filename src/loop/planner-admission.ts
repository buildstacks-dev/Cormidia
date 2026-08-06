import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  CONFIGURED_ASSIGNMENT_CANDIDATE_ID,
  buildTurnExecutionFacts,
  configuredProviderFamily,
  fixedAssignmentFromRole,
  turnAssignmentsEqual,
  validateTurnAssignment,
} from "../runtime/assignment.js";
import {
  resolvedRuntimeCapabilities,
  validateRuntimeCapabilities,
  type RuntimeCapability,
} from "../runtime/capabilities.js";
import { withFileLock } from "../runtime/file-lock.js";
import type { RoleConfig, TurnAssignment, TurnResult } from "../runtime/types.js";
import { runPaths } from "../runtime/runlog/paths.js";
import { writeLoopFileAtomic, writeLoopFileOnce } from "./durable.js";
import {
  admitEpisode,
  checkProviderBudget,
  deriveRouteBudgetCounters,
  EFFICIENCY_SCHEMA_VERSION,
  EQUIVALENT_COST_ARITHMETIC_TOLERANCE_USD,
  efficiencyEpisodeDir,
  executionStepPath,
  finalizeProviderStep,
  readExecutionSteps,
  readRouteRecord,
  routeRecordPath,
  ROUTE_BUDGETS,
  type AuthorizedPass,
  type ExecutionStepRecord,
  type ProviderStepPlanMetadata,
  type RouteAdmissionInput,
  type RouteRecord,
  type StartedProviderReceipt,
  type StartedProviderStep,
} from "./efficiency.js";
import {
  EPISODE_PLAN_REASON_CODES,
  assertEpisodePlanValid,
  deriveEpisodeSafetyRoute,
  episodePlanHash,
  materializeEpisodePlanAssignments,
  parseNormalizedProposedEpisodePlan,
  persistEpisodePlan,
  readCurrentEpisodePlan,
  readCurrentEpisodePlanPointer,
  type CurrentEpisodePlanPointer,
  type EpisodeIntent,
  type EpisodePlan,
  type EpisodePlanValidationPolicy,
  type ProviderTurnStep,
} from "./episode-plan.js";
import { completedEpisodePlanStepIds, readEpisodePlanExecutionJournal } from "./episode-plan-executor.js";
import { EPISODE_PLAN_EXECUTION_PIPELINE } from "./episode-route.js";

export const PLANNER_ADMISSION_SCHEMA_VERSION = 1 as const;
export const PLANNER_PLAN_ACCEPTANCE_SCHEMA_VERSION = 1 as const;
export const MAX_EPISODE_PLANNER_ATTEMPTS = 2 as const;
export const EPISODE_PLANNER_OPERATION = "episode-planner/plan" as const;
export const EPISODE_PLANNER_REPAIR_OPERATION = "episode-planner/repair" as const;

const HASH = /^[a-f0-9]{64}$/;
const EPISODE_PLAN_REASON_CODE_SET = new Set<string>(EPISODE_PLAN_REASON_CODES);
const LOCK_OPTIONS = {
  staleMs: 30_000,
  maxWaitMs: 35_000,
  retryMinMs: 5,
  retryMaxMs: 15,
} as const;

export interface PlannerAttemptCeiling {
  equivalentCostUsd: number;
  activeTimeMs: number;
}

export interface PlannerAggregateCeiling extends PlannerAttemptCeiling {
  providerTurns: number;
}

/** Both the reservation for every attempt and the episode-wide planning cap
 * are explicit. A lower aggregate ceiling may deliberately leave less than
 * two full attempts, but it must always admit at least the first attempt. */
export interface PlannerAdmissionLimits {
  maxAttempts: number;
  perAttempt: PlannerAttemptCeiling;
  aggregate: PlannerAggregateCeiling;
}

interface PersistedPlannerAttemptCeiling {
  equivalent_cost_usd: number;
  active_time_ms: number;
}

interface PersistedPlannerAggregateCeiling extends PersistedPlannerAttemptCeiling {
  provider_turns: number;
}

export interface PlannerAdmissionRecord {
  schema_version: typeof PLANNER_ADMISSION_SCHEMA_VERSION;
  episode_id: string;
  app: string;
  policy_version: string;
  admitted_at: string;
  intent_hash: string;
  planner_role: string;
  boot_assignment: TurnAssignment;
  assignment_source: "configured";
  assignment_candidate_id: typeof CONFIGURED_ASSIGNMENT_CANDIDATE_ID;
  provider_family: string;
  resolved_capabilities: RuntimeCapability[];
  role_max_turn_budget_usd: number;
  budget: {
    max_attempts: number;
    per_attempt: PersistedPlannerAttemptCeiling;
    aggregate: PersistedPlannerAggregateCeiling;
  };
}

export interface PlannerPlanAcceptanceRecord {
  schema_version: typeof PLANNER_PLAN_ACCEPTANCE_SCHEMA_VERSION;
  episode_id: string;
  plan_version: number;
  plan_hash: string;
  accepted_at: string;
}

interface PlannerPlanPublicationRecord {
  schema_version: typeof PLANNER_PLAN_ACCEPTANCE_SCHEMA_VERSION;
  episode_id: string;
  plan_version: number;
  plan_hash: string;
  started_at: string;
}

export interface PlannerBudgetQuantity {
  providerTurns: number;
  equivalentCostUsd: number;
  activeTimeMs: number;
}

export interface PlannerBudgetStatus {
  settled: PlannerBudgetQuantity;
  reserved: PlannerBudgetQuantity;
  remaining: PlannerBudgetQuantity;
  terminalAttempts: number[];
  pendingAttempts: number[];
  unmeasuredAttempts: number[];
  limitViolations: string[];
}

export type PlannerAttemptDecision =
  | {
      kind: "start";
      attempt: number;
      assignment: TurnAssignment;
      planMetadata: ProviderStepPlanMetadata;
      started: StartedProviderStep;
      maxTurnBudgetUsd: number;
    }
  | {
      kind: "resume_terminal";
      attempt: number;
      step: ExecutionStepRecord;
    }
  | {
      kind: "plan_accepted";
      plan: EpisodePlan;
    };

export type PlannerAdmissionErrorCode =
  | "error_episode_planner_admission_conflict"
  | "error_episode_planner_admission_corrupt"
  | "error_episode_planner_route_already_admitted"
  | "error_episode_planner_plan_already_accepted"
  | "error_episode_planner_attempt_invalid"
  | "error_episode_planner_attempt_in_flight"
  | "error_episode_planner_attempt_out_of_order"
  | "error_episode_planner_attempt_limit"
  | "error_episode_planner_budget_exhausted"
  | "error_episode_planner_budget_unmeasured"
  | "error_episode_planner_plan_missing"
  | "error_episode_planner_plan_source"
  | "error_episode_planner_derived_route_budget";

export class PlannerAdmissionError extends Error {
  constructor(
    readonly code: PlannerAdmissionErrorCode,
    message: string,
    readonly terminalStep?: ExecutionStepRecord,
  ) {
    super(message);
    this.name = "PlannerAdmissionError";
  }
}

export function plannerAdmissionPath(root: string, episodeId: string): string {
  return join(efficiencyEpisodeDir(root, episodeId), "planner-admission.json");
}

export function plannerPlanAcceptancePath(root: string, episodeId: string, version?: number): string {
  return join(
    efficiencyEpisodeDir(root, episodeId),
    version === undefined ? "planner-plan-accepted.json" : `planner-plan-accepted-v${version}.json`,
  );
}

export function plannerPlanPublicationPath(root: string, episodeId: string): string {
  return join(efficiencyEpisodeDir(root, episodeId), "planner-plan-publication.json");
}

export function plannerAttemptExecutionStepId(attempt: number): string {
  return `episode-planner:attempt:${attempt}`;
}

/** Atomically fixes the only assignment the EpisodePlanner may use. This
 * record deliberately precedes both runtime construction and route.json. */
export async function admitEpisodePlanner(input: {
  root: string;
  episodeId: string;
  app: string;
  policyVersion: string;
  intentHash: string;
  plannerRole: RoleConfig;
  requiredCapabilities: readonly RuntimeCapability[];
  limits: PlannerAdmissionLimits;
  now: Date;
}): Promise<PlannerAdmissionRecord> {
  return withPlannerLock(input.root, input.episodeId, async () => {
    if (existsSync(routeRecordPath(input.root, input.episodeId))) {
      throw new PlannerAdmissionError(
        "error_episode_planner_route_already_admitted",
        `episode ${input.episodeId} already has a derived route; planner boot admission must precede route admission`,
      );
    }
    if ((await readCurrentEpisodePlan(input.root, input.episodeId)) !== undefined) {
      throw new PlannerAdmissionError(
        "error_episode_planner_plan_already_accepted",
        `episode ${input.episodeId} already has an accepted plan`,
      );
    }
    requireStableText(input.episodeId, "episode id");
    requireStableText(input.app, "app");
    requireStableText(input.policyVersion, "planner policy version");
    if (!HASH.test(input.intentHash)) {
      throw new TypeError("EpisodePlanner admission intentHash must be a lowercase sha256 digest");
    }
    const assignment = fixedAssignmentFromRole(input.plannerRole);
    const executionFacts = buildTurnExecutionFacts(assignment, input.plannerRole, input.requiredCapabilities);
    const limits = validatePlannerLimits(input.limits, input.plannerRole.maxTurnBudgetUsd);
    const record: PlannerAdmissionRecord = {
      schema_version: PLANNER_ADMISSION_SCHEMA_VERSION,
      episode_id: input.episodeId,
      app: input.app,
      policy_version: input.policyVersion,
      admitted_at: validDate(input.now, "EpisodePlanner admission time").toISOString(),
      intent_hash: input.intentHash,
      planner_role: input.plannerRole.name,
      boot_assignment: executionFacts.assignment,
      assignment_source: "configured",
      assignment_candidate_id: CONFIGURED_ASSIGNMENT_CANDIDATE_ID,
      provider_family: configuredProviderFamily(executionFacts.assignment),
      resolved_capabilities: [...executionFacts.resolvedCapabilities].sort(),
      role_max_turn_budget_usd: input.plannerRole.maxTurnBudgetUsd,
      budget: persistedLimits(limits),
    };
    const path = plannerAdmissionPath(input.root, input.episodeId);
    const won = await writeLoopFileOnce(path, `${JSON.stringify(record, null, 2)}\n`);
    if (won) return record;
    const existing = await readPlannerAdmission(input.root, input.episodeId);
    if (existing !== undefined && sameAdmission(existing, record)) return existing;
    throw new PlannerAdmissionError(
      "error_episode_planner_admission_conflict",
      `episode ${input.episodeId} already has a different EpisodePlanner boot admission`,
    );
  });
}

export async function readPlannerAdmission(
  root: string,
  episodeId: string,
): Promise<PlannerAdmissionRecord | undefined> {
  const value = await readOptionalJson(plannerAdmissionPath(root, episodeId));
  if (value === undefined) return undefined;
  if (!isPlannerAdmissionRecord(value) || value.episode_id !== episodeId) {
    throw new PlannerAdmissionError(
      "error_episode_planner_admission_corrupt",
      `invalid EpisodePlanner admission for ${episodeId}`,
    );
  }
  return value;
}

/** Reserve one deterministic provider attempt. The terminal branch is the
 * restart contract: callers consume the already-written output/run evidence
 * and never construct another runtime for that attempt. */
export async function beginEpisodePlannerAttempt(input: {
  root: string;
  episodeId: string;
  app: string;
  runId: string;
  attempt: number;
  inputFingerprint: string;
  now: Date;
}): Promise<PlannerAttemptDecision> {
  return withPlannerLock(input.root, input.episodeId, async () => {
    const admission = await requirePlannerAdmission(input.root, input.episodeId);
    assertAdmissionApp(admission, input.app);
    const accepted = await readCurrentEpisodePlan(input.root, input.episodeId);
    if (accepted !== undefined) return { kind: "plan_accepted", plan: accepted };
    const publication = await readPlanPublication(input.root, input.episodeId);
    if (publication !== undefined) {
      throw new PlannerAdmissionError(
        "error_episode_planner_plan_already_accepted",
        `EpisodePlanner plan v${publication.plan_version} is being durably published`,
      );
    }
    if (existsSync(routeRecordPath(input.root, input.episodeId))) {
      throw new PlannerAdmissionError(
        "error_episode_planner_route_already_admitted",
        `episode ${input.episodeId} has a route but no readable accepted plan`,
      );
    }
    validateAttemptNumber(input.attempt, admission.budget.max_attempts);
    requireStableText(input.runId, "planner run id");
    if (!HASH.test(input.inputFingerprint)) {
      throw new TypeError("EpisodePlanner attempt inputFingerprint must be a lowercase sha256 digest");
    }

    const terminal = await readPlannerAttemptTerminal(input.root, admission, input.attempt);
    if (terminal !== undefined) {
      await rm(`${attemptPath(input.root, input.episodeId, input.attempt)}.started`, { force: true });
      return { kind: "resume_terminal", attempt: input.attempt, step: terminal };
    }
    const status = await plannerBudgetStatusInternal(input.root, admission);
    if (status.pendingAttempts.length > 0) {
      throw new PlannerAdmissionError(
        "error_episode_planner_attempt_in_flight",
        `EpisodePlanner attempt ${status.pendingAttempts.join(", ")} is already in flight`,
      );
    }
    for (let prior = 1; prior < input.attempt; prior += 1) {
      if (!status.terminalAttempts.includes(prior)) {
        throw new PlannerAdmissionError(
          "error_episode_planner_attempt_out_of_order",
          `EpisodePlanner attempt ${input.attempt} cannot start before attempt ${prior} is terminal`,
        );
      }
    }
    if (status.terminalAttempts.some((attempt) => attempt > input.attempt)) {
      throw new PlannerAdmissionError(
        "error_episode_planner_admission_corrupt",
        `EpisodePlanner evidence contains a future attempt before attempt ${input.attempt}`,
      );
    }
    assertPlannerBudgetMeasurable(input.episodeId, status);
    assertAttemptFits(admission, status, input.attempt);

    const executionStepId = plannerAttemptExecutionStepId(input.attempt);
    const providerTurnId = sha256(`${input.episodeId}\0${executionStepId}`);
    const operation = plannerOperation(input.attempt);
    const startedAt = validDate(input.now, "EpisodePlanner attempt start time");
    const planMetadata = plannerPlanMetadata(admission);
    const receipt: StartedProviderReceipt = {
      schema_version: EFFICIENCY_SCHEMA_VERSION,
      execution_step_id: executionStepId,
      provider_turn_id: providerTurnId,
      episode_id: input.episodeId,
      app: input.app,
      run_id: input.runId,
      kind: "provider",
      operation,
      role: admission.planner_role,
      runtime: admission.boot_assignment.harness,
      model: admission.boot_assignment.model,
      effort: admission.boot_assignment.effort,
      ...planMetadata,
      started_at: startedAt.toISOString(),
      input_fingerprint: input.inputFingerprint,
      context_manifest_ref: "context-manifest.json",
      reservation: {
        equivalent_cost_usd: admission.budget.per_attempt.equivalent_cost_usd,
        active_time_ms: admission.budget.per_attempt.active_time_ms,
      },
    };
    const path = attemptPath(input.root, input.episodeId, input.attempt);
    const won = await writeLoopFileOnce(`${path}.started`, `${JSON.stringify(receipt, null, 2)}\n`);
    if (!won) {
      const completed = await readPlannerAttemptTerminal(input.root, admission, input.attempt);
      if (completed !== undefined) {
        return { kind: "resume_terminal", attempt: input.attempt, step: completed };
      }
      throw new PlannerAdmissionError(
        "error_episode_planner_attempt_in_flight",
        `EpisodePlanner attempt ${input.attempt} was reserved concurrently`,
      );
    }
    const reservation = {
      equivalentCostUsd: admission.budget.per_attempt.equivalent_cost_usd,
      activeTimeMs: admission.budget.per_attempt.active_time_ms,
    };
    const started: StartedProviderStep = {
      executionStepId,
      providerTurnId,
      startedAt,
      inputFingerprint: input.inputFingerprint,
      assignment: admission.boot_assignment,
      planMetadata,
      reservation,
      budget: {
        capUsd: admission.budget.aggregate.equivalent_cost_usd,
        settledUsd: status.settled.equivalentCostUsd,
        alreadyReservedUsd: status.reserved.equivalentCostUsd,
      },
    };
    return {
      kind: "start",
      attempt: input.attempt,
      assignment: admission.boot_assignment,
      planMetadata,
      started,
      maxTurnBudgetUsd: reservation.equivalentCostUsd,
    };
  });
}

/** Finalize through the ordinary provider-step writer. If the provider reports
 * an overrun, its terminal evidence remains durable and the typed error stops
 * all later attempts; spend is never hidden merely because it violated a cap. */
export async function finalizeEpisodePlannerAttempt(input: {
  root: string;
  episodeId: string;
  app: string;
  runId: string;
  attempt: number;
  plannerRole: RoleConfig;
  started: StartedProviderStep;
  result: TurnResult;
  finishedAt: Date;
  contextManifestRef: string;
  artifactFingerprint?: string;
  toolCallCount?: number;
}): Promise<ExecutionStepRecord> {
  return withPlannerLock(input.root, input.episodeId, async () => {
    const admission = await requirePlannerAdmission(input.root, input.episodeId);
    assertAdmissionApp(admission, input.app);
    validateAttemptNumber(input.attempt, admission.budget.max_attempts);
    if (input.plannerRole.name !== admission.planner_role) {
      throw new PlannerAdmissionError(
        "error_episode_planner_admission_conflict",
        `planner role ${input.plannerRole.name} does not match admitted role ${admission.planner_role}`,
      );
    }
    const expectedStepId = plannerAttemptExecutionStepId(input.attempt);
    if (input.started.executionStepId !== expectedStepId) {
      throw new PlannerAdmissionError(
        "error_episode_planner_attempt_invalid",
        `started step ${input.started.executionStepId} is not EpisodePlanner attempt ${input.attempt}`,
      );
    }
    const alreadyTerminal = await readPlannerAttemptTerminal(input.root, admission, input.attempt);
    if (alreadyTerminal !== undefined) {
      await rm(`${attemptPath(input.root, input.episodeId, input.attempt)}.started`, { force: true });
      return alreadyTerminal;
    }
    const record = await finalizeProviderStep({
      root: input.root,
      episodeId: input.episodeId,
      app: input.app,
      runId: input.runId,
      started: input.started,
      operation: plannerOperation(input.attempt),
      role: input.plannerRole,
      assignment: admission.boot_assignment,
      planMetadata: plannerPlanMetadata(admission),
      result: input.result,
      finishedAt: input.finishedAt,
      contextManifestRef: input.contextManifestRef,
      ...(input.artifactFingerprint !== undefined ? { artifactFingerprint: input.artifactFingerprint } : {}),
      ...(input.toolCallCount !== undefined ? { toolCallCount: input.toolCallCount } : {}),
    });
    const status = await plannerBudgetStatusInternal(input.root, admission);
    if (status.unmeasuredAttempts.length > 0) {
      throw new PlannerAdmissionError(
        "error_episode_planner_budget_unmeasured",
        `EpisodePlanner usage is unavailable for attempt ${status.unmeasuredAttempts.join(", ")}`,
        record,
      );
    }
    if (status.limitViolations.length > 0) {
      throw new PlannerAdmissionError(
        "error_episode_planner_budget_exhausted",
        `EpisodePlanner budget exceeded: ${status.limitViolations.join("; ")}`,
        record,
      );
    }
    return record;
  });
}

export async function readPlannerBudgetStatus(root: string, episodeId: string): Promise<PlannerBudgetStatus> {
  const admission = await requirePlannerAdmission(root, episodeId);
  return plannerBudgetStatusInternal(root, admission);
}

/** Persist and seal an EpisodePlanner-authored plan without ever acquiring the
 * plan lock underneath the planner lock. A durable planner-locked publication
 * claim prevents a repair attempt during the short unlocked handoff. The plan
 * is then published under its own lock and acceptance is finalized under the
 * planner lock, giving execution one global plan -> planner lock order. */
export async function persistAcceptedEpisodePlannerPlan(input: {
  root: string;
  plan: EpisodePlan;
  intent: EpisodeIntent;
  policy: EpisodePlanValidationPolicy;
  now: Date;
}): Promise<CurrentEpisodePlanPointer> {
  if (input.plan.planningSource !== "episode_planner") {
    throw new PlannerAdmissionError(
      "error_episode_planner_plan_source",
      "the EpisodePlanner acceptance boundary only accepts EpisodePlanner-authored plans",
    );
  }
  const expected = {
    version: input.plan.version,
    planHash: episodePlanHash(input.plan),
  };
  const alreadyPersisted = await readCurrentEpisodePlan(input.root, input.plan.episodeId);
  const matchesCurrent =
    alreadyPersisted !== undefined &&
    alreadyPersisted.version === expected.version &&
    episodePlanHash(alreadyPersisted) === expected.planHash;
  if (!matchesCurrent && input.plan.version !== 1) {
    throw new PlannerAdmissionError(
      "error_episode_planner_admission_conflict",
      "EpisodePlanner revisions must be published through the typed replan boundary before acceptance evidence is sealed",
    );
  }
  await withPlannerLock(input.root, input.plan.episodeId, async () => {
    await assertPlanAcceptanceReady(input.root, input.plan, input.intent, input.policy);
    await claimPlanPublication(input.root, input.plan.episodeId, expected, input.now);
  });

  const pointer = matchesCurrent
    ? await readCurrentEpisodePlanPointer(input.root, input.plan.episodeId)
    : await persistEpisodePlan({
        root: input.root,
        plan: input.plan,
        intent: input.intent,
        policy: input.policy,
      });
  if (pointer === undefined) {
    throw new PlannerAdmissionError(
      "error_episode_planner_admission_conflict",
      "current EpisodePlanner plan pointer disappeared before acceptance",
    );
  }
  if (pointer.version !== expected.version || pointer.planHash !== expected.planHash) {
    throw new PlannerAdmissionError(
      "error_episode_planner_admission_conflict",
      "persisted EpisodePlanner plan does not match its publication claim",
    );
  }

  return withPlannerLock(input.root, input.plan.episodeId, async () => {
    const claim = await readPlanPublication(input.root, input.plan.episodeId);
    if (claim !== undefined && (claim.plan_version !== pointer.version || claim.plan_hash !== pointer.planHash)) {
      throw new PlannerAdmissionError(
        "error_episode_planner_admission_conflict",
        "EpisodePlanner plan publication claim changed before acceptance",
      );
    }
    await assertPlanAcceptanceReady(input.root, input.plan, input.intent, input.policy);
    const current = await readCurrentEpisodePlan(input.root, input.plan.episodeId);
    if (current === undefined || current.version !== pointer.version || episodePlanHash(current) !== pointer.planHash) {
      throw new PlannerAdmissionError(
        "error_episode_planner_admission_conflict",
        "current EpisodePlanner plan changed before acceptance",
      );
    }
    await writePlanAcceptance(input.root, input.plan.episodeId, pointer, input.now);
    await rm(plannerPlanPublicationPath(input.root, input.plan.episodeId), { force: true });
    return pointer;
  });
}

/** Admit the derived delivery route only after one validated durable plan
 * exists. Existing planner attempts stay in the same episode journal with
 * their actual settlements; structural repair replaces the invalid proposal
 * for the provider-turn route slot only. */
export async function admitPlannedEpisodeRoute(
  input: RouteAdmissionInput,
): Promise<{ route: RouteRecord; consumedBeforeRoute: PlannerBudgetQuantity }> {
  return withPlannerLock(input.root, input.episodeId, async () => {
    const plan = await readCurrentEpisodePlan(input.root, input.episodeId);
    if (plan === undefined) {
      throw new PlannerAdmissionError(
        "error_episode_planner_plan_missing",
        `episode ${input.episodeId} has no accepted durable plan`,
      );
    }
    const planHash = episodePlanHash(plan);
    if ((input.currentPlanVersion === undefined) !== (input.currentPlanHash === undefined)) {
      throw new PlannerAdmissionError(
        "error_episode_planner_admission_conflict",
        "route request must supply current plan version and hash together",
      );
    }
    if (
      (input.currentPlanVersion !== undefined && input.currentPlanVersion !== plan.version) ||
      (input.currentPlanHash !== undefined && input.currentPlanHash !== planHash)
    ) {
      throw new PlannerAdmissionError(
        "error_episode_planner_admission_conflict",
        `route request does not match current EpisodePlan v${plan.version}`,
      );
    }
    const projectedInput: RouteAdmissionInput = {
      ...input,
      currentPlanVersion: plan.version,
      currentPlanHash: planHash,
    };
    assertRouteMatchesCurrentPlan(projectedInput, plan);
    const routeExists = existsSync(routeRecordPath(input.root, input.episodeId));
    const existingRoute = routeExists ? await readRouteRecord(input.root, input.episodeId) : undefined;
    const completedStepIds = await completedPlanStepSet(input.root, plan.episodeId);
    const priorRoutePlanVersion =
      existingRoute === undefined
        ? undefined
        : (existingRoute.current_plan_version ?? latestAuthorizedPlanVersion(existingRoute.authorized_passes));
    const routePasses =
      existingRoute !== undefined && priorRoutePlanVersion === plan.version
        ? existingRoute.authorized_passes.filter((pass) => pass.plan_version === plan.version)
        : priorRoutePlanVersion !== undefined && priorRoutePlanVersion < plan.version
          ? input.passes.filter((pass) => !completedStepIds.has(pass.plan_step_id!))
          : input.passes;
    const authoritativeInput: RouteAdmissionInput = {
      ...projectedInput,
      passes: routePasses,
    };
    const admission = await readPlannerAdmission(input.root, input.episodeId);
    let plannerConsumed = zeroQuantity();
    if (plan.planningSource === "episode_planner") {
      if (admission === undefined) {
        throw new PlannerAdmissionError(
          "error_episode_planner_plan_missing",
          "EpisodePlanner-authored plan has no fixed boot admission evidence",
        );
      }
      assertAdmissionApp(admission, input.app);
      const status = await plannerBudgetStatusInternal(input.root, admission);
      assertPlannerBudgetMeasurable(input.episodeId, status);
      if (status.pendingAttempts.length > 0) {
        throw new PlannerAdmissionError(
          "error_episode_planner_attempt_in_flight",
          `cannot derive a route while EpisodePlanner attempt ${status.pendingAttempts.join(", ")} is in flight`,
        );
      }
      const terminal = await plannerTerminalSteps(input.root, admission);
      const accepted = await readOptionalJson(plannerPlanAcceptancePath(input.root, input.episodeId));
      const acceptedCurrent =
        isPlanAcceptanceRecord(accepted, input.episodeId) &&
        accepted.plan_version === plan.version &&
        accepted.plan_hash === planHash;
      if (!terminal.some((step) => step.status === "completed") && !acceptedCurrent) {
        throw new PlannerAdmissionError(
          "error_episode_planner_plan_missing",
          "EpisodePlanner route admission requires completed evidence or a matching accepted-plan marker",
        );
      }
      plannerConsumed = { ...status.settled };
      const pointer = {
        version: plan.version,
        planHash,
      };
      await writePlanAcceptance(input.root, input.episodeId, pointer, input.now);
    } else if (admission !== undefined) {
      throw new PlannerAdmissionError(
        "error_episode_planner_plan_source",
        "creator-scoped plan cannot claim an EpisodePlanner provider admission",
      );
    }

    if (!routeExists) {
      const steps = await readExecutionSteps(input.root, input.episodeId);
      const plannerStepIds = new Set(
        Array.from({ length: admission?.budget.max_attempts ?? 0 }, (_, index) =>
          plannerAttemptExecutionStepId(index + 1),
        ),
      );
      const foreignProvider = steps.find(
        (step) => step.kind === "provider" && !plannerStepIds.has(step.execution_step_id),
      );
      if (foreignProvider !== undefined) {
        throw new PlannerAdmissionError(
          "error_episode_planner_admission_corrupt",
          `provider step ${foreignProvider.execution_step_id} ran before the episode route was admitted`,
        );
      }
    }
    const counters = await deriveRouteBudgetCounters(input.root, input.episodeId);
    if (counters.partial_or_unavailable_steps.length > 0) {
      throw new PlannerAdmissionError(
        "error_episode_planner_budget_unmeasured",
        `pre-route provider usage is unavailable for ${counters.partial_or_unavailable_steps.join(", ")}`,
      );
    }
    const budget = { ...ROUTE_BUDGETS[input.route], ...input.budgetOverrides };
    const remaining = await remainingPlanBudget(input.root, plan);
    const requiredTurns = counters.provider_turns + remaining.providerTurns;
    const requiredCost = counters.equivalent_cost_usd + remaining.totalBudgetUsd;
    const conflict =
      requiredTurns > budget.provider_turns
        ? `route allows ${budget.provider_turns} provider turns but planning plus the accepted plan require ${requiredTurns}`
        : requiredCost > budget.equivalent_cost_usd + EQUIVALENT_COST_ARITHMETIC_TOLERANCE_USD
          ? `route allows $${budget.equivalent_cost_usd} but planning plus the accepted plan require $${requiredCost}`
          : counters.active_time_ms > budget.active_time_ms
            ? `planner consumed ${counters.active_time_ms}ms but route allows ${budget.active_time_ms}ms`
            : undefined;
    if (conflict !== undefined) {
      throw new PlannerAdmissionError(
        "error_episode_planner_derived_route_budget",
        `episode ${input.episodeId} cannot admit its derived route: ${conflict}`,
      );
    }
    const route = await admitEpisode(authoritativeInput);
    return routeExists
      ? { route, consumedBeforeRoute: plannerConsumed }
      : {
          route,
          consumedBeforeRoute: {
            providerTurns: counters.provider_turns,
            equivalentCostUsd: counters.equivalent_cost_usd,
            activeTimeMs: counters.active_time_ms,
          },
        };
  });
}

/** Pre-publication guard for a proposed forward revision. Unlike initial route
 * admission, the parent route already exists and may have spent or reserved
 * budget on completed delivery plus the revision-planner turn itself. Check
 * that live exposure and all still-future proposed work fit before the current
 * plan pointer can advance. Route admission repeats the check after publish. */
export async function assertPlannedEpisodeRevisionBudgetHeadroom(input: {
  root: string;
  plan: EpisodePlan;
}): Promise<void> {
  const exposure = await checkProviderBudget({
    root: input.root,
    episodeId: input.plan.episodeId,
  });
  if (!exposure.allowed) {
    throw new PlannerAdmissionError(
      "error_episode_planner_derived_route_budget",
      `episode ${input.plan.episodeId} cannot publish EpisodePlan v${input.plan.version}: ` +
        (exposure.reason ?? "current route exposure is not safely measurable"),
    );
  }
  const future = await remainingPlanBudget(input.root, input.plan);
  const conflict =
    future.providerTurns > exposure.remaining.provider_turns
      ? `route has ${exposure.remaining.provider_turns} provider turn(s) remaining but revision requires ${future.providerTurns}`
      : future.totalBudgetUsd > exposure.remaining.equivalent_cost_usd + EQUIVALENT_COST_ARITHMETIC_TOLERANCE_USD
        ? `route has $${exposure.remaining.equivalent_cost_usd} remaining but revision requires $${future.totalBudgetUsd}`
        : undefined;
  if (conflict !== undefined) {
    throw new PlannerAdmissionError(
      "error_episode_planner_derived_route_budget",
      `episode ${input.plan.episodeId} cannot publish EpisodePlan v${input.plan.version}: ${conflict}`,
    );
  }
}

async function remainingPlanBudget(
  root: string,
  plan: EpisodePlan,
): Promise<{ providerTurns: number; totalBudgetUsd: number }> {
  const completed = await completedPlanStepSet(root, plan.episodeId);
  // A provider transport terminalizes its execution-step receipt before the
  // outer plan journal appends `step_completed`/`step_failed`. If the process
  // stops in that narrow window, the next invocation must recover the durable
  // receipt rather than reserve the same planned turn a second time. Counters
  // already include that receipt, so treating the still-active journal step as
  // remaining would double-count both one provider turn and its full ceiling.
  const terminalProviderSteps = new Set<string>();
  for (const record of await readExecutionSteps(root, plan.episodeId)) {
    if (record.kind !== "provider" || record.plan_version !== plan.version || record.plan_step_id === undefined) {
      continue;
    }
    if (terminalProviderSteps.has(record.plan_step_id)) {
      throw new PlannerAdmissionError(
        "error_episode_planner_admission_corrupt",
        `plan v${plan.version} step ${record.plan_step_id} has multiple terminal provider receipts`,
      );
    }
    terminalProviderSteps.add(record.plan_step_id);
  }
  const remainingProvider = plan.steps.filter(
    (step): step is ProviderTurnStep =>
      step.kind === "provider_turn" && !completed.has(step.id) && !terminalProviderSteps.has(step.id),
  );
  return {
    providerTurns: remainingProvider.length,
    totalBudgetUsd:
      remainingProvider.reduce((sum, step) => sum + step.maxTurnBudgetUsd, 0) +
      plan.estimatedBudget.mechanicalOverheadUsd,
  };
}

async function completedPlanStepSet(root: string, episodeId: string): Promise<Set<string>> {
  const journal = await readEpisodePlanExecutionJournal(root, episodeId);
  return new Set(journal === undefined ? [] : completedEpisodePlanStepIds(journal));
}

function latestAuthorizedPlanVersion(passes: readonly AuthorizedPass[]): number | undefined {
  const versions = passes
    .map((pass) => pass.plan_version)
    .filter((version): version is number => version !== undefined);
  return versions.length === 0 ? undefined : Math.max(...versions);
}

function assertRouteMatchesCurrentPlan(input: RouteAdmissionInput, plan: EpisodePlan): void {
  if (input.route !== plan.derivedSafetyRoute.label) {
    throw new PlannerAdmissionError(
      "error_episode_planner_admission_conflict",
      `route ${input.route} does not match EpisodePlan v${plan.version} derived route ${plan.derivedSafetyRoute.label}`,
    );
  }
  const providerSteps = plan.steps.filter((step): step is ProviderTurnStep => step.kind === "provider_turn");
  if (input.passes.length !== providerSteps.length) {
    throw new PlannerAdmissionError(
      "error_episode_planner_admission_conflict",
      `route request must authorize exactly ${providerSteps.length} provider steps from EpisodePlan v${plan.version}`,
    );
  }
  for (const step of providerSteps) {
    const matches = input.passes.filter((pass) => pass.plan_step_id === step.id);
    const pass = matches[0];
    if (
      matches.length !== 1 ||
      pass === undefined ||
      pass.pipeline !== EPISODE_PLAN_EXECUTION_PIPELINE ||
      pass.pass !== step.id ||
      pass.role !== step.role ||
      !turnAssignmentsEqual({ harness: pass.runtime, model: pass.model, effort: pass.effort }, step.assignment) ||
      pass.assignment_source !== step.assignmentSource ||
      pass.plan_version !== plan.version ||
      pass.selection_reason !== step.selectionReason
    ) {
      throw new PlannerAdmissionError(
        "error_episode_planner_admission_conflict",
        `route authorization for ${step.id} does not exactly match EpisodePlan v${plan.version}`,
      );
    }
  }
}

async function plannerBudgetStatusInternal(
  root: string,
  admission: PlannerAdmissionRecord,
): Promise<PlannerBudgetStatus> {
  const settled = zeroQuantity();
  const reserved = zeroQuantity();
  const terminalAttempts: number[] = [];
  const pendingAttempts: number[] = [];
  const unmeasuredAttempts: number[] = [];
  const limitViolations: string[] = [];
  for (let attempt = 1; attempt <= admission.budget.max_attempts; attempt += 1) {
    const terminal = await readPlannerAttemptTerminal(root, admission, attempt);
    if (terminal !== undefined) {
      terminalAttempts.push(attempt);
      settled.providerTurns += 1;
      const usage = terminal.usage;
      if (
        usage === null ||
        usage.quality === "partial" ||
        usage.quality === "unavailable" ||
        !validUsageNumber(usage.tokensIn) ||
        !validUsageNumber(usage.costUsd) ||
        !validUsageNumber(usage.wallClockMs)
      ) {
        unmeasuredAttempts.push(attempt);
        continue;
      }
      settled.equivalentCostUsd += usage.costUsd;
      settled.activeTimeMs += usage.wallClockMs;
      const ceiling = admission.budget.per_attempt;
      if (usage.costUsd > ceiling.equivalent_cost_usd + EQUIVALENT_COST_ARITHMETIC_TOLERANCE_USD) {
        limitViolations.push(`attempt ${attempt} cost $${usage.costUsd} exceeds $${ceiling.equivalent_cost_usd}`);
      }
      if (usage.wallClockMs > ceiling.active_time_ms) {
        limitViolations.push(
          `attempt ${attempt} active time ${usage.wallClockMs}ms exceeds ${ceiling.active_time_ms}ms`,
        );
      }
      continue;
    }
    const receipt = await readPlannerAttemptReceipt(root, admission, attempt);
    if (receipt === undefined) continue;
    pendingAttempts.push(attempt);
    reserved.providerTurns += 1;
    reserved.equivalentCostUsd += receipt.reservation!.equivalent_cost_usd;
    reserved.activeTimeMs += receipt.reservation!.active_time_ms;
  }
  const aggregate = admission.budget.aggregate;
  if (settled.providerTurns + reserved.providerTurns > aggregate.provider_turns) {
    limitViolations.push("aggregate provider-turn ceiling exceeded");
  }
  if (
    settled.equivalentCostUsd + reserved.equivalentCostUsd >
    aggregate.equivalent_cost_usd + EQUIVALENT_COST_ARITHMETIC_TOLERANCE_USD
  ) {
    limitViolations.push("aggregate equivalent-cost ceiling exceeded");
  }
  if (settled.activeTimeMs + reserved.activeTimeMs > aggregate.active_time_ms) {
    limitViolations.push("aggregate active-time ceiling exceeded");
  }
  return {
    settled,
    reserved,
    remaining: {
      providerTurns: aggregate.provider_turns - settled.providerTurns - reserved.providerTurns,
      equivalentCostUsd: aggregate.equivalent_cost_usd - settled.equivalentCostUsd - reserved.equivalentCostUsd,
      activeTimeMs: aggregate.active_time_ms - settled.activeTimeMs - reserved.activeTimeMs,
    },
    terminalAttempts,
    pendingAttempts,
    unmeasuredAttempts,
    limitViolations: [...new Set(limitViolations)],
  };
}

async function plannerTerminalSteps(root: string, admission: PlannerAdmissionRecord): Promise<ExecutionStepRecord[]> {
  const steps: ExecutionStepRecord[] = [];
  for (let attempt = 1; attempt <= admission.budget.max_attempts; attempt += 1) {
    const step = await readPlannerAttemptTerminal(root, admission, attempt);
    if (step !== undefined) steps.push(step);
  }
  return steps;
}

async function readPlannerAttemptTerminal(
  root: string,
  admission: PlannerAdmissionRecord,
  attempt: number,
): Promise<ExecutionStepRecord | undefined> {
  const value = await readOptionalJson(attemptPath(root, admission.episode_id, attempt));
  if (value === undefined) return undefined;
  if (!isRecord(value) || value.kind !== "provider" || value.provider_turn_id === null) {
    throw corruptAttempt(admission.episode_id, attempt, "terminal record is not a provider step");
  }
  const record = value as unknown as ExecutionStepRecord;
  assertPlannerEvidenceIdentity(record, admission, attempt);
  if (
    !stablePersistedText(record.run_id) ||
    !HASH.test(record.input_fingerprint) ||
    !validTimestamp(record.started_at) ||
    !validTimestamp(record.finished_at) ||
    !(["completed", "failed", "blocked", "cancelled", "timed_out", "interrupted"] as const).includes(record.status) ||
    (record.usage !== null && !isRecord(record.usage))
  ) {
    throw corruptAttempt(admission.episode_id, attempt, "terminal record is malformed");
  }
  return record;
}

async function readPlannerAttemptReceipt(
  root: string,
  admission: PlannerAdmissionRecord,
  attempt: number,
): Promise<StartedProviderReceipt | undefined> {
  const value = await readOptionalJson(`${attemptPath(root, admission.episode_id, attempt)}.started`);
  if (value === undefined) return undefined;
  if (!isRecord(value) || value.kind !== "provider") {
    throw corruptAttempt(admission.episode_id, attempt, "started receipt is not a provider receipt");
  }
  const receipt = value as unknown as StartedProviderReceipt;
  assertPlannerEvidenceIdentity(receipt, admission, attempt);
  if (
    !stablePersistedText(receipt.run_id) ||
    !HASH.test(receipt.input_fingerprint) ||
    !validTimestamp(receipt.started_at)
  ) {
    throw corruptAttempt(admission.episode_id, attempt, "started receipt is malformed");
  }
  const reservation = receipt.reservation;
  const ceiling = admission.budget.per_attempt;
  if (
    reservation === undefined ||
    reservation.equivalent_cost_usd !== ceiling.equivalent_cost_usd ||
    reservation.active_time_ms !== ceiling.active_time_ms
  ) {
    throw corruptAttempt(admission.episode_id, attempt, "started receipt reservation differs from admission");
  }
  return receipt;
}

function assertPlannerEvidenceIdentity(
  evidence: ExecutionStepRecord | StartedProviderReceipt,
  admission: PlannerAdmissionRecord,
  attempt: number,
): void {
  const assignment = validateTurnAssignment(
    {
      harness: evidence.runtime,
      model: evidence.model,
      effort: evidence.effort,
    },
    `EpisodePlanner attempt ${attempt} persisted assignment`,
  );
  const expectedStepId = plannerAttemptExecutionStepId(attempt);
  const expectedTurnId = sha256(`${admission.episode_id}\0${expectedStepId}`);
  const same =
    evidence.schema_version === EFFICIENCY_SCHEMA_VERSION &&
    evidence.execution_step_id === expectedStepId &&
    evidence.provider_turn_id === expectedTurnId &&
    evidence.episode_id === admission.episode_id &&
    evidence.app === admission.app &&
    evidence.operation === plannerOperation(attempt) &&
    evidence.role === admission.planner_role &&
    turnAssignmentsEqual(assignment, admission.boot_assignment) &&
    evidence.assignment_source === "configured" &&
    evidence.assignment_candidate_id === CONFIGURED_ASSIGNMENT_CANDIDATE_ID &&
    evidence.selection_reason === "Fixed EpisodePlanner boot assignment" &&
    evidence.provider_family === admission.provider_family &&
    JSON.stringify(evidence.resolved_capabilities) === JSON.stringify(admission.resolved_capabilities);
  if (!same) {
    throw corruptAttempt(admission.episode_id, attempt, "provider identity differs from admission");
  }
}

function assertAttemptFits(admission: PlannerAdmissionRecord, status: PlannerBudgetStatus, attempt: number): void {
  if (status.terminalAttempts.length >= admission.budget.max_attempts) {
    throw new PlannerAdmissionError(
      "error_episode_planner_attempt_limit",
      `EpisodePlanner already consumed its ${admission.budget.max_attempts} allowed attempts`,
    );
  }
  const ceiling = admission.budget.per_attempt;
  const fits =
    status.remaining.providerTurns >= 1 &&
    status.remaining.equivalentCostUsd + EQUIVALENT_COST_ARITHMETIC_TOLERANCE_USD >= ceiling.equivalent_cost_usd &&
    status.remaining.activeTimeMs >= ceiling.active_time_ms;
  if (!fits) {
    throw new PlannerAdmissionError(
      "error_episode_planner_budget_exhausted",
      `EpisodePlanner attempt ${attempt} does not fit the remaining aggregate planning budget`,
    );
  }
}

function assertPlannerBudgetMeasurable(episodeId: string, status: PlannerBudgetStatus): void {
  if (status.unmeasuredAttempts.length > 0) {
    throw new PlannerAdmissionError(
      "error_episode_planner_budget_unmeasured",
      `EpisodePlanner usage is unavailable for attempt ${status.unmeasuredAttempts.join(", ")} in ${episodeId}`,
    );
  }
  if (status.limitViolations.length > 0) {
    throw new PlannerAdmissionError(
      "error_episode_planner_budget_exhausted",
      `EpisodePlanner budget exceeded: ${status.limitViolations.join("; ")}`,
    );
  }
}

async function assertPlanAcceptanceReady(
  root: string,
  plan: EpisodePlan,
  intent: EpisodeIntent,
  policy: EpisodePlanValidationPolicy,
): Promise<void> {
  const admission = await requirePlannerAdmission(root, plan.episodeId);
  assertAdmissionApp(admission, intent.app);
  if (plan.intentHash !== admission.intent_hash) {
    throw new PlannerAdmissionError(
      "error_episode_planner_admission_conflict",
      "accepted plan intent hash does not match the fixed planner admission",
    );
  }
  const status = await plannerBudgetStatusInternal(root, admission);
  assertPlannerBudgetMeasurable(plan.episodeId, status);
  if (status.pendingAttempts.length > 0) {
    throw new PlannerAdmissionError(
      "error_episode_planner_attempt_in_flight",
      `cannot accept a plan while EpisodePlanner attempt ${status.pendingAttempts.join(", ")} is in flight`,
    );
  }
  const terminal = await plannerTerminalSteps(root, admission);
  if (!(await plannerEvidenceBacksPlan(root, terminal, plan, intent, policy))) {
    throw new PlannerAdmissionError(
      "error_episode_planner_plan_missing",
      "an EpisodePlanner-authored plan requires a completed attempt or exact revalidated terminal output",
    );
  }
}

/** A deterministic parser/validator repair may make already-settled provider
 * bytes valid without changing what the provider said. Preserve the original
 * failed step, envelope, and ledger row; acceptance is authorized only when
 * those exact output bytes now materialize to the exact validated plan. */
async function plannerEvidenceBacksPlan(
  root: string,
  terminal: readonly ExecutionStepRecord[],
  plan: EpisodePlan,
  intent: EpisodeIntent,
  policy: EpisodePlanValidationPolicy,
): Promise<boolean> {
  if (terminal.some((step) => step.status === "completed")) return true;
  for (const step of terminal) {
    if (step.status !== "failed" || step.error_code === null || !EPISODE_PLAN_REASON_CODE_SET.has(step.error_code)) {
      continue;
    }
    try {
      const raw = await readFile(runPaths(root, intent.app, step.run_id).output, "utf8");
      const proposal = parseNormalizedProposedEpisodePlan(JSON.parse(raw) as unknown);
      const materialized = materializeEpisodePlanAssignments(proposal, policy);
      const candidate: EpisodePlan = {
        ...materialized,
        derivedSafetyRoute: deriveEpisodeSafetyRoute(materialized.steps, intent.requiredSafetyFacts),
      };
      assertEpisodePlanValid(candidate, intent, policy);
      if (episodePlanHash(candidate) === episodePlanHash(plan)) return true;
    } catch {
      // The caller reports the actionable validation error. This durable
      // admission boundary only answers whether exact evidence backs `plan`.
    }
  }
  return false;
}

async function claimPlanPublication(
  root: string,
  episodeId: string,
  pointer: Pick<CurrentEpisodePlanPointer, "version" | "planHash">,
  now: Date,
): Promise<PlannerPlanPublicationRecord> {
  const record: PlannerPlanPublicationRecord = {
    schema_version: PLANNER_PLAN_ACCEPTANCE_SCHEMA_VERSION,
    episode_id: episodeId,
    plan_version: pointer.version,
    plan_hash: pointer.planHash,
    started_at: validDate(now, "plan publication time").toISOString(),
  };
  const path = plannerPlanPublicationPath(root, episodeId);
  const won = await writeLoopFileOnce(path, `${JSON.stringify(record, null, 2)}\n`);
  if (won) return record;
  const existing = await readPlanPublication(root, episodeId);
  if (existing !== undefined && existing.plan_version === pointer.version && existing.plan_hash === pointer.planHash) {
    return existing;
  }
  throw new PlannerAdmissionError(
    "error_episode_planner_admission_conflict",
    `episode ${episodeId} has a different plan publication in flight`,
  );
}

async function readPlanPublication(root: string, episodeId: string): Promise<PlannerPlanPublicationRecord | undefined> {
  const value = await readOptionalJson(plannerPlanPublicationPath(root, episodeId));
  if (value === undefined) return undefined;
  if (
    !isRecord(value) ||
    value.schema_version !== PLANNER_PLAN_ACCEPTANCE_SCHEMA_VERSION ||
    value.episode_id !== episodeId ||
    !Number.isSafeInteger(value.plan_version) ||
    (value.plan_version as number) < 1 ||
    typeof value.plan_hash !== "string" ||
    !HASH.test(value.plan_hash) ||
    typeof value.started_at !== "string" ||
    !Number.isFinite(Date.parse(value.started_at))
  ) {
    throw new PlannerAdmissionError(
      "error_episode_planner_admission_corrupt",
      `invalid EpisodePlanner plan publication for ${episodeId}`,
    );
  }
  return value as unknown as PlannerPlanPublicationRecord;
}

function isPlanAcceptanceRecord(value: unknown, episodeId: string): value is PlannerPlanAcceptanceRecord {
  return (
    isRecord(value) &&
    value.schema_version === PLANNER_PLAN_ACCEPTANCE_SCHEMA_VERSION &&
    value.episode_id === episodeId &&
    Number.isSafeInteger(value.plan_version) &&
    (value.plan_version as number) > 0 &&
    typeof value.plan_hash === "string" &&
    HASH.test(value.plan_hash) &&
    typeof value.accepted_at === "string" &&
    Number.isFinite(Date.parse(value.accepted_at))
  );
}

async function writePlanAcceptance(
  root: string,
  episodeId: string,
  pointer: Pick<CurrentEpisodePlanPointer, "version" | "planHash">,
  now: Date,
): Promise<PlannerPlanAcceptanceRecord> {
  const record: PlannerPlanAcceptanceRecord = {
    schema_version: PLANNER_PLAN_ACCEPTANCE_SCHEMA_VERSION,
    episode_id: episodeId,
    plan_version: pointer.version,
    plan_hash: pointer.planHash,
    accepted_at: validDate(now, "plan acceptance time").toISOString(),
  };
  const currentPath = plannerPlanAcceptancePath(root, episodeId);
  const existing = await readOptionalJson(currentPath);
  if (existing !== undefined && !isPlanAcceptanceRecord(existing, episodeId)) {
    throw new PlannerAdmissionError(
      "error_episode_planner_admission_conflict",
      `episode ${episodeId} has an invalid accepted-plan marker`,
    );
  }
  if (isPlanAcceptanceRecord(existing, episodeId)) {
    if (existing.plan_version > pointer.version) {
      throw new PlannerAdmissionError(
        "error_episode_planner_admission_conflict",
        `episode ${episodeId} already accepted newer plan v${existing.plan_version}`,
      );
    }
    await writeVersionedPlanAcceptance(root, episodeId, existing);
    if (existing.plan_version === pointer.version && existing.plan_hash === pointer.planHash) {
      return existing;
    }
  }
  const accepted = await writeVersionedPlanAcceptance(root, episodeId, record);
  await writeLoopFileAtomic(currentPath, `${JSON.stringify(accepted, null, 2)}\n`);
  return accepted;
}

async function writeVersionedPlanAcceptance(
  root: string,
  episodeId: string,
  record: PlannerPlanAcceptanceRecord,
): Promise<PlannerPlanAcceptanceRecord> {
  const path = plannerPlanAcceptancePath(root, episodeId, record.plan_version);
  const won = await writeLoopFileOnce(path, `${JSON.stringify(record, null, 2)}\n`);
  if (won) return record;
  const existing = await readOptionalJson(path);
  if (
    isPlanAcceptanceRecord(existing, episodeId) &&
    existing.plan_version === record.plan_version &&
    existing.plan_hash === record.plan_hash
  ) {
    return existing;
  }
  throw new PlannerAdmissionError(
    "error_episode_planner_admission_conflict",
    `episode ${episodeId} has a different accepted-plan marker for v${record.plan_version}`,
  );
}

function validatePlannerLimits(value: PlannerAdmissionLimits, roleMaxTurnBudgetUsd: number): PlannerAdmissionLimits {
  if (
    !Number.isSafeInteger(value.maxAttempts) ||
    value.maxAttempts < 1 ||
    value.maxAttempts > MAX_EPISODE_PLANNER_ATTEMPTS
  ) {
    throw new TypeError(`EpisodePlanner maxAttempts must be between 1 and ${MAX_EPISODE_PLANNER_ATTEMPTS}`);
  }
  if (!finitePositive(roleMaxTurnBudgetUsd)) {
    throw new TypeError("EpisodePlanner role maxTurnBudgetUsd must be finite and positive");
  }
  validateAttemptCeiling(value.perAttempt, "EpisodePlanner per-attempt ceiling");
  validateAttemptCeiling(value.aggregate, "EpisodePlanner aggregate ceiling");
  if (!Number.isSafeInteger(value.aggregate.providerTurns) || value.aggregate.providerTurns !== value.maxAttempts) {
    throw new TypeError("EpisodePlanner aggregate providerTurns must equal maxAttempts");
  }
  if (value.perAttempt.equivalentCostUsd > roleMaxTurnBudgetUsd + EQUIVALENT_COST_ARITHMETIC_TOLERANCE_USD) {
    throw new TypeError("EpisodePlanner per-attempt cost exceeds the fixed Planner role cap");
  }
  for (const field of ["equivalentCostUsd", "activeTimeMs"] as const) {
    if (value.aggregate[field] < value.perAttempt[field]) {
      throw new TypeError(`EpisodePlanner aggregate ${field} cannot admit the first attempt`);
    }
    if (value.aggregate[field] > value.perAttempt[field] * value.maxAttempts) {
      throw new TypeError(`EpisodePlanner aggregate ${field} exceeds the sum of per-attempt ceilings`);
    }
  }
  return {
    maxAttempts: value.maxAttempts,
    perAttempt: { ...value.perAttempt },
    aggregate: { ...value.aggregate },
  };
}

function validateAttemptCeiling(value: PlannerAttemptCeiling, label: string): void {
  if (!finitePositive(value.equivalentCostUsd)) {
    throw new TypeError(`${label} equivalentCostUsd must be finite and positive`);
  }
  if (!Number.isSafeInteger(value.activeTimeMs) || value.activeTimeMs <= 0) {
    throw new TypeError(`${label} activeTimeMs must be a positive safe integer`);
  }
}

function persistedLimits(value: PlannerAdmissionLimits): PlannerAdmissionRecord["budget"] {
  return {
    max_attempts: value.maxAttempts,
    per_attempt: {
      equivalent_cost_usd: value.perAttempt.equivalentCostUsd,
      active_time_ms: value.perAttempt.activeTimeMs,
    },
    aggregate: {
      provider_turns: value.aggregate.providerTurns,
      equivalent_cost_usd: value.aggregate.equivalentCostUsd,
      active_time_ms: value.aggregate.activeTimeMs,
    },
  };
}

function plannerPlanMetadata(admission: PlannerAdmissionRecord): ProviderStepPlanMetadata {
  return {
    assignment_source: "configured",
    assignment_candidate_id: CONFIGURED_ASSIGNMENT_CANDIDATE_ID,
    selection_reason: "Fixed EpisodePlanner boot assignment",
    provider_family: admission.provider_family,
    resolved_capabilities: [...admission.resolved_capabilities],
  };
}

function plannerOperation(attempt: number): string {
  return attempt === 1 ? EPISODE_PLANNER_OPERATION : EPISODE_PLANNER_REPAIR_OPERATION;
}

function attemptPath(root: string, episodeId: string, attempt: number): string {
  return executionStepPath(root, episodeId, plannerAttemptExecutionStepId(attempt));
}

function plannerLockPath(root: string, episodeId: string): string {
  return join(efficiencyEpisodeDir(root, episodeId), ".planner-admission.lock");
}

function withPlannerLock<T>(root: string, episodeId: string, work: () => Promise<T>): Promise<T> {
  return withFileLock(plannerLockPath(root, episodeId), LOCK_OPTIONS, work);
}

function isPlannerAdmissionRecord(value: unknown): value is PlannerAdmissionRecord {
  if (!isRecord(value) || value.schema_version !== PLANNER_ADMISSION_SCHEMA_VERSION) return false;
  try {
    if (
      !hasOnlyKeys(value, [
        "schema_version",
        "episode_id",
        "app",
        "policy_version",
        "admitted_at",
        "intent_hash",
        "planner_role",
        "boot_assignment",
        "assignment_source",
        "assignment_candidate_id",
        "provider_family",
        "resolved_capabilities",
        "role_max_turn_budget_usd",
        "budget",
      ])
    )
      return false;
    const assignment = validateTurnAssignment(value.boot_assignment, "persisted EpisodePlanner boot assignment");
    const limits = persistedRecordLimits(value);
    validatePlannerLimits(limits, value.role_max_turn_budget_usd as number);
    const resolvedCapabilities = validateRuntimeCapabilities(
      value.resolved_capabilities,
      "persisted EpisodePlanner resolved capabilities",
    );
    return (
      typeof value.episode_id === "string" &&
      typeof value.app === "string" &&
      typeof value.policy_version === "string" &&
      typeof value.admitted_at === "string" &&
      Number.isFinite(Date.parse(value.admitted_at)) &&
      typeof value.intent_hash === "string" &&
      HASH.test(value.intent_hash) &&
      typeof value.planner_role === "string" &&
      value.assignment_source === "configured" &&
      value.assignment_candidate_id === CONFIGURED_ASSIGNMENT_CANDIDATE_ID &&
      value.provider_family === configuredProviderFamily(assignment) &&
      Array.isArray(value.resolved_capabilities) &&
      JSON.stringify(resolvedCapabilities) === JSON.stringify(resolvedRuntimeCapabilities(assignment.harness)) &&
      turnAssignmentsEqual(assignment, value.boot_assignment as TurnAssignment)
    );
  } catch {
    return false;
  }
}

function persistedRecordLimits(value: Record<string, unknown>): PlannerAdmissionLimits {
  if (!isRecord(value.budget) || !isRecord(value.budget.per_attempt) || !isRecord(value.budget.aggregate)) {
    throw new TypeError("persisted EpisodePlanner budget is malformed");
  }
  if (
    !hasOnlyKeys(value.budget, ["max_attempts", "per_attempt", "aggregate"]) ||
    !hasBudgetKeys(value.budget.per_attempt, ["equivalent_cost_usd", "active_time_ms"]) ||
    !hasBudgetKeys(value.budget.aggregate, ["provider_turns", "equivalent_cost_usd", "active_time_ms"])
  ) {
    throw new TypeError("persisted EpisodePlanner budget has unknown fields");
  }
  return {
    maxAttempts: value.budget.max_attempts as number,
    perAttempt: {
      equivalentCostUsd: value.budget.per_attempt.equivalent_cost_usd as number,
      activeTimeMs: value.budget.per_attempt.active_time_ms as number,
    },
    aggregate: {
      providerTurns: value.budget.aggregate.provider_turns as number,
      equivalentCostUsd: value.budget.aggregate.equivalent_cost_usd as number,
      activeTimeMs: value.budget.aggregate.active_time_ms as number,
    },
  };
}

function sameAdmission(left: PlannerAdmissionRecord, right: PlannerAdmissionRecord): boolean {
  return JSON.stringify({ ...left, admitted_at: "" }) === JSON.stringify({ ...right, admitted_at: "" });
}

async function requirePlannerAdmission(root: string, episodeId: string): Promise<PlannerAdmissionRecord> {
  const admission = await readPlannerAdmission(root, episodeId);
  if (admission === undefined) {
    throw new PlannerAdmissionError(
      "error_episode_planner_plan_missing",
      `episode ${episodeId} has no EpisodePlanner boot admission`,
    );
  }
  return admission;
}

function assertAdmissionApp(admission: PlannerAdmissionRecord, app: string): void {
  if (admission.app !== app) {
    throw new PlannerAdmissionError(
      "error_episode_planner_admission_conflict",
      `EpisodePlanner admission app ${admission.app} does not match ${app}`,
    );
  }
}

function validateAttemptNumber(attempt: number, maxAttempts: number): void {
  if (!Number.isSafeInteger(attempt) || attempt < 1) {
    throw new PlannerAdmissionError(
      "error_episode_planner_attempt_invalid",
      "EpisodePlanner attempt must be a positive safe integer",
    );
  }
  if (attempt > maxAttempts) {
    throw new PlannerAdmissionError(
      "error_episode_planner_attempt_limit",
      `EpisodePlanner attempt ${attempt} exceeds the admitted maximum ${maxAttempts}`,
    );
  }
}

function corruptAttempt(episodeId: string, attempt: number, reason: string): PlannerAdmissionError {
  return new PlannerAdmissionError(
    "error_episode_planner_admission_corrupt",
    `EpisodePlanner attempt ${attempt} for ${episodeId} is corrupt: ${reason}`,
  );
}

async function readOptionalJson(path: string): Promise<unknown | undefined> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new PlannerAdmissionError("error_episode_planner_admission_corrupt", `invalid JSON in ${path}`);
  }
}

function zeroQuantity(): PlannerBudgetQuantity {
  return { providerTurns: 0, equivalentCostUsd: 0, activeTimeMs: 0 };
}

function validUsageNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function stablePersistedText(value: unknown): value is string {
  return (
    typeof value === "string" && value.length > 0 && value === value.trim() && !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

function finitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function requireStableText(value: string, label: string): void {
  if (value.length === 0 || value !== value.trim() || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new TypeError(`${label} must be non-empty text without surrounding whitespace or controls`);
  }
}

function validDate(value: Date, label: string): Date {
  if (!Number.isFinite(value.getTime())) throw new TypeError(`${label} must be valid`);
  return value;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === allowed.length && keys.every((key) => allowed.includes(key));
}

/** Budget sub-objects must carry exactly the live dimensions, except that a
 * stale `input_tokens` is tolerated so admissions persisted before the ceiling
 * was removed still parse. Nothing reads it and nothing writes it again. */
function hasBudgetKeys(value: Record<string, unknown>, required: readonly string[]): boolean {
  const keys = Object.keys(value);
  return (
    required.every((key) => keys.includes(key)) && keys.every((key) => required.includes(key) || key === "input_tokens")
  );
}
