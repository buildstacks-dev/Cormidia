import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { lstat, mkdir, open, readFile, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  fixedAssignmentFromRole,
  turnAssignmentsEqual,
  validateAssignmentCandidateId,
  validateProviderFamily,
  validateTurnAssignment,
} from "../runtime/assignment.js";
import type {
  Effort,
  RoleConfig,
  RuntimeKind,
  TurnAssignment,
  TurnAssignmentSource,
  TurnResult,
  TurnUsage,
} from "../runtime/types.js";
import type { TurnRecord } from "../runtime/telemetry.js";
import { ERROR_TURN_BUDGET_SUSPENDED } from "../runtime/turn-budget.js";
import { withFileLock } from "../runtime/file-lock.js";
import { writeLoopFileAtomic, writeLoopFileOnce } from "./durable.js";
import type { TicketTier } from "./pipelines.js";
import { assertMonotonicRoute, executionBoundsFor, type RouteExecutionBounds } from "./route-policy.js";

export const EFFICIENCY_SCHEMA_VERSION = 1 as const;
/** Floating-point comparison tolerance only. This is not a spend allowance:
 * any observable provider overrun beyond this arithmetic epsilon stops the
 * episode before another provider turn can be admitted. */
export const EQUIVALENT_COST_ARITHMETIC_TOLERANCE_USD = 1e-9;
const ROUTE_MUTATION_LOCK_OPTIONS = {
  staleMs: 30_000,
  maxWaitMs: 35_000,
  retryMinMs: 5,
  retryMaxMs: 15,
} as const;
export type EfficiencyRoute = "deterministic" | TicketTier;

/** Input tokens are deliberately absent. They were never a budget: they are a
 * byproduct of context assembly and caching, so a cached re-read inflated the
 * same number a ceiling was meant to restrain. Work is bounded by money, turns,
 * wall-clock, and human decisions — all of which scale from configuration. */
export interface RouteBudget {
  provider_turns: number;
  equivalent_cost_usd: number;
  active_time_ms: number;
  human_decisions: number | null;
}

export const ROUTE_BUDGETS: Readonly<Record<EfficiencyRoute, RouteBudget>> = {
  deterministic: {
    provider_turns: 0,
    equivalent_cost_usd: 0,
    active_time_ms: 5 * 60_000,
    human_decisions: null,
  },
  quick: {
    provider_turns: 3,
    equivalent_cost_usd: 8,
    active_time_ms: 20 * 60_000,
    human_decisions: 1,
  },
  standard: {
    provider_turns: 5,
    equivalent_cost_usd: 15,
    active_time_ms: 45 * 60_000,
    human_decisions: null,
  },
  deep: {
    provider_turns: 8,
    equivalent_cost_usd: 40,
    active_time_ms: 90 * 60_000,
    human_decisions: 5,
  },
};

export type AdmissionFactorKind =
  | "blast_radius"
  | "reversibility"
  | "sensitive_domain"
  | "uncertainty"
  | "component_count"
  | "external_system_count"
  | "release_consequence"
  | "novelty"
  | "evidence_quality";

export interface AdmissionFactor {
  kind: AdmissionFactorKind;
  evidence: string;
  policy_rule: string;
}

export interface AuthorizedPass {
  pipeline: string;
  pass: string;
  role: string;
  runtime: RuntimeKind;
  model: string;
  effort: Effort;
  factor_rules: string[];
  assignment_source?: TurnAssignmentSource;
  assignment_candidate_id?: string;
  plan_version?: number;
  plan_step_id?: string;
  selection_reason?: string;
  provider_family?: string;
  resolved_capabilities?: string[];
}

/** Additive durable evidence that links a provider execution to the accepted
 * plan and the approved assignment catalog. Snake-case matches the persisted
 * schema so callers cannot accidentally rely on a second translation shape. */
export interface ProviderStepPlanMetadata {
  assignment_source?: TurnAssignmentSource;
  assignment_candidate_id?: string;
  plan_version?: number;
  plan_step_id?: string;
  selection_reason?: string;
  provider_family?: string;
  resolved_capabilities?: string[];
}

/** Durable ledger attribution that must survive a crash after provider-step
 * finalization. It is evidence about why spend occurred, not role authority or
 * plan-selection metadata. */
export interface ProviderStepSettlementAttribution {
  experiment_ref?: string;
  candidate_ref?: string;
  learning_activity?: "distillation" | "review";
}

export interface RouteAdmissionInput {
  root: string;
  episodeId: string;
  app: string;
  route: EfficiencyRoute;
  policyVersion: string;
  factors: AdmissionFactor[];
  passes: AuthorizedPass[];
  now: Date;
  /** Deep input budget and standard human budget are policy-declared. */
  budgetOverrides?: Partial<RouteBudget>;
  /** Plan-DAG admission has no static pass-count/tool-count authority. Omit
   * for historical static routes; pass null for an accepted EpisodePlan. */
  executionBounds?: RouteExecutionBounds | null;
  /** Additive authority for plan-DAG routes. Both values must be supplied
   * together. Historical static routes omit them. */
  currentPlanVersion?: number;
  currentPlanHash?: string;
}

export interface RouteReassessment {
  reassessment_id: string;
  at: string;
  from_route: EfficiencyRoute;
  to_route: EfficiencyRoute;
  factor: AdmissionFactor;
  remaining_before: EpisodeCounters;
  newly_authorized_budget: RouteBudget;
}

export interface EpisodeTerminal {
  at: string;
  status: "completed" | "failed" | "blocked" | "cancelled" | "timed_out" | "interrupted";
  reason: string;
  final_route: EfficiencyRoute;
  next_step: string | null;
}

export interface RouteRecord {
  schema_version: typeof EFFICIENCY_SCHEMA_VERSION;
  episode_id: string;
  app: string;
  policy_version: string;
  admitted_at: string;
  planned_route: EfficiencyRoute;
  current_route: EfficiencyRoute;
  final_route: EfficiencyRoute | null;
  factors: AdmissionFactor[];
  authorized_passes: AuthorizedPass[];
  budget: RouteBudget;
  execution_bounds: RouteExecutionBounds | null;
  /** The only plan version whose plan-versioned authorizations may start new
   * work. Older authorizations remain immutable historical evidence. */
  current_plan_version?: number;
  current_plan_hash?: string;
  reassessments: RouteReassessment[];
  terminal: EpisodeTerminal | null;
}

export type ExecutionStatus = "completed" | "failed" | "blocked" | "cancelled" | "timed_out" | "interrupted";

export interface ExecutionStepRecord {
  schema_version: typeof EFFICIENCY_SCHEMA_VERSION;
  execution_step_id: string;
  episode_id: string;
  app: string;
  run_id: string;
  kind: "provider" | "mechanical";
  provider_turn_id: string | null;
  operation: string;
  role: string | null;
  runtime: RuntimeKind | null;
  model: string | null;
  effort: Effort | null;
  assignment_source?: TurnAssignmentSource;
  assignment_candidate_id?: string;
  plan_version?: number;
  plan_step_id?: string;
  selection_reason?: string;
  provider_family?: string;
  resolved_capabilities?: string[];
  experiment_ref?: string;
  candidate_ref?: string;
  learning_activity?: "distillation" | "review";
  started_at: string;
  finished_at: string;
  status: ExecutionStatus;
  error_code: string | null;
  reason: string;
  next_step: string | null;
  context_manifest_ref: string | null;
  input_fingerprint: string;
  work_fingerprint_before: string | null;
  work_fingerprint_after: string | null;
  artifact_fingerprint: string | null;
  productive: boolean | null;
  repeated_from_step_id: string | null;
  tool_call_count: number;
  usage: TurnUsage | null;
}

/** A provider record that PARKED its turn rather than settling its plan step:
 *  the per-turn (soft) budget ring fired while the episode still had headroom,
 *  so the turn is waiting on a budget decision (epic #236).
 *
 *  It is a fully terminal EXECUTION record — the turn ran, the money was spent,
 *  and every budget counter must keep counting it. What it is not is STEP
 *  evidence: the planned step did not settle, and asking "did this step settle?"
 *  must therefore skip it. Callers asking the settlement question route through
 *  `settledProviderSteps`; callers asking the accounting question do not. */
export function isSuspendedProviderStep(record: ExecutionStepRecord): boolean {
  return record.kind === "provider" && record.error_code === ERROR_TURN_BUDGET_SUSPENDED;
}

/** Records that answer "did this plan step settle?" — every terminal provider
 *  record except the parked ones. A step may accumulate several suspensions
 *  (one per budget grant) and still have at most one settlement. */
export function settledProviderSteps(records: readonly ExecutionStepRecord[]): ExecutionStepRecord[] {
  return records.filter((record) => !isSuspendedProviderStep(record));
}

export interface StartedProviderStep {
  executionStepId: string;
  providerTurnId: string;
  startedAt: Date;
  inputFingerprint: string;
  /** Present for receipts created by assignment-aware callers. Optional so
   * legacy reconstructed in-memory handles remain consumable. */
  assignment?: TurnAssignment;
  planMetadata?: ProviderStepPlanMetadata;
  reservation: {
    equivalentCostUsd: number;
    activeTimeMs: number;
  };
  budget: {
    capUsd: number;
    settledUsd: number;
    alreadyReservedUsd: number;
  };
}

export interface StartedProviderReceipt {
  schema_version: typeof EFFICIENCY_SCHEMA_VERSION;
  execution_step_id: string;
  provider_turn_id: string;
  episode_id: string;
  app: string;
  run_id: string;
  kind: "provider";
  operation: string;
  role: string;
  runtime: RuntimeKind;
  model: string;
  effort: Effort;
  assignment_source?: TurnAssignmentSource;
  assignment_candidate_id?: string;
  plan_version?: number;
  plan_step_id?: string;
  selection_reason?: string;
  provider_family?: string;
  resolved_capabilities?: string[];
  experiment_ref?: string;
  candidate_ref?: string;
  learning_activity?: "distillation" | "review";
  started_at: string;
  input_fingerprint: string;
  context_manifest_ref: string | null;
  /** Conservative allowance reserved before runtime construction. Older
   * in-flight receipts that omit it block further admission as unmeasured. */
  reservation?: {
    equivalent_cost_usd: number;
    active_time_ms: number;
  };
}

export interface EfficiencyEpisodeEvidence {
  directory: string;
  route: RouteRecord | null;
  steps: ExecutionStepRecord[];
  pending_started: StartedProviderReceipt[];
  corrupt_files: string[];
}

export interface EpisodeCounters {
  provider_turns: number;
  input_tokens: number;
  output_tokens: number;
  equivalent_cost_usd: number;
  active_time_ms: number;
  human_decisions: number;
  partial_or_unavailable_steps: string[];
}

export interface BudgetCheck {
  allowed: boolean;
  counters: EpisodeCounters;
  remaining: RouteBudget;
  exposure: {
    capUsd: number;
    settledUsd: number;
    reservedUsd: number;
    requestedUsd: number;
  };
  errorCode?: "error_route_budget_exhausted" | "error_route_budget_unmeasured";
  reason?: string;
}

export class ProviderBudgetRefusalError extends Error {
  readonly errorCode: NonNullable<BudgetCheck["errorCode"]>;
  readonly budget: BudgetCheck;

  constructor(episodeId: string, operation: string, budget: BudgetCheck) {
    const exposure = budget.exposure;
    super(
      `episode ${episodeId} cannot start ${operation}: ${budget.reason ?? "route budget exhausted"}; ` +
        `cap=$${formatUsd(exposure.capUsd)}, settled=$${formatUsd(exposure.settledUsd)}, ` +
        `reserved=$${formatUsd(exposure.reservedUsd)}, requested=$${formatUsd(exposure.requestedUsd)}, ` +
        `denied_step=${operation}`,
    );
    this.name = "ProviderBudgetRefusalError";
    this.errorCode = budget.errorCode ?? "error_route_budget_exhausted";
    this.budget = budget;
  }
}

export function episodeIdFor(input: { app: string; ticket?: string; traceId: string }): string {
  return input.ticket === undefined ? `trace:${input.app}:${input.traceId}` : `ticket:${input.app}:${input.ticket}`;
}

export function efficiencyEpisodeDir(root: string, episodeId: string): string {
  return join(root, "efficiency", "episodes", sha256(episodeId).slice(0, 32));
}

export function routeRecordPath(root: string, episodeId: string): string {
  return join(efficiencyEpisodeDir(root, episodeId), "route.json");
}

function routeMutationLockPath(root: string, episodeId: string): string {
  return join(efficiencyEpisodeDir(root, episodeId), ".route.lock");
}

export function executionStepPath(root: string, episodeId: string, stepId: string): string {
  return join(efficiencyEpisodeDir(root, episodeId), "steps", `${sha256(stepId)}.json`);
}

/** First writer fixes planned_route. Subsequent passes may prove that their
 * predeclared pass authorization was already included, but cannot rewrite it. */
export async function admitEpisode(input: RouteAdmissionInput): Promise<RouteRecord> {
  return withFileLock(routeMutationLockPath(input.root, input.episodeId), ROUTE_MUTATION_LOCK_OPTIONS, async () =>
    admitEpisodeLocked(input),
  );
}

async function admitEpisodeLocked(input: RouteAdmissionInput): Promise<RouteRecord> {
  const path = routeRecordPath(input.root, input.episodeId);
  const requestedPasses = input.passes.map((pass) => normalizeAuthorizedPass(pass));
  const requestedPlan = planAuthorityFromAdmission(input);
  if (requestedPlan !== undefined) {
    assertPlanVersionedAuthorizations(requestedPasses, requestedPlan.version);
  }
  const validateExisting = async (): Promise<RouteRecord> => {
    const existing = await readRouteRecord(input.root, input.episodeId);
    if (requestedPlan !== undefined) {
      return admitPlanRouteRevision(input, existing, requestedPasses, requestedPlan);
    }
    if (existing.app !== input.app || existing.current_route !== input.route) {
      throw new Error(
        `efficiency admission conflict for ${input.episodeId}: current route is ` +
          `${existing.current_route}, requested ${input.route}`,
      );
    }
    if (
      existing.current_plan_version !== undefined &&
      requestedPasses.some(
        (pass) => pass.plan_version !== undefined && pass.plan_version !== existing.current_plan_version,
      )
    ) {
      throw new Error(
        `efficiency admission conflict for ${input.episodeId}: requested authorization is not from ` +
          `current plan v${existing.current_plan_version}`,
      );
    }
    const authorized = new Set(existing.authorized_passes.map(passIdentity));
    const missing = requestedPasses.filter((pass) => !authorized.has(passIdentity(pass)));
    if (missing.length > 0) {
      throw new Error(
        `efficiency admission conflict for ${input.episodeId}: unrecorded pass authorization ` +
          missing.map((pass) => `${pass.pipeline}/${pass.pass}`).join(", "),
      );
    }
    return existing;
  };
  if (existsSync(path)) return validateExisting();
  if (input.factors.length === 0) {
    throw new Error(`efficiency admission for ${input.episodeId} requires an explicit factor`);
  }
  const knownRules = new Set(input.factors.map((factor) => factor.policy_rule));
  for (const pass of requestedPasses) {
    if (pass.factor_rules.length === 0 || pass.factor_rules.some((rule) => !knownRules.has(rule))) {
      throw new Error(
        `efficiency admission for ${input.episodeId}: ${pass.pipeline}/${pass.pass} ` +
          `must map only to recorded factor rules`,
      );
    }
  }
  const budget = { ...ROUTE_BUDGETS[input.route], ...input.budgetOverrides };
  const record: RouteRecord = {
    schema_version: EFFICIENCY_SCHEMA_VERSION,
    episode_id: input.episodeId,
    app: input.app,
    policy_version: input.policyVersion,
    admitted_at: input.now.toISOString(),
    planned_route: input.route,
    current_route: input.route,
    final_route: null,
    factors: sortedFactors(input.factors),
    authorized_passes: requestedPasses.sort((a, b) => passIdentity(a).localeCompare(passIdentity(b))),
    budget,
    execution_bounds:
      input.executionBounds !== undefined
        ? input.executionBounds
        : input.route === "deterministic"
          ? null
          : executionBoundsFor(input.route),
    ...(requestedPlan === undefined
      ? {}
      : {
          current_plan_version: requestedPlan.version,
          current_plan_hash: requestedPlan.hash,
        }),
    reassessments: [],
    terminal: null,
  };
  const won = await writeLoopFileOnce(path, `${JSON.stringify(record, null, 2)}\n`);
  return won ? record : validateExisting();
}

export async function readRouteRecord(root: string, episodeId: string): Promise<RouteRecord> {
  const value: unknown = JSON.parse(await readFile(routeRecordPath(root, episodeId), "utf8"));
  if (!isRouteRecord(value) || value.episode_id !== episodeId) {
    throw new Error(`invalid efficiency route record for ${episodeId}`);
  }
  return value;
}

export async function reassessEpisode(input: {
  root: string;
  episodeId: string;
  toRoute: EfficiencyRoute;
  factor: AdmissionFactor;
  now: Date;
  budgetOverrides?: Partial<RouteBudget>;
  authorizedPasses?: AuthorizedPass[];
}): Promise<RouteRecord> {
  return withFileLock(routeMutationLockPath(input.root, input.episodeId), ROUTE_MUTATION_LOCK_OPTIONS, async () =>
    reassessEpisodeLocked(input),
  );
}

async function reassessEpisodeLocked(input: {
  root: string;
  episodeId: string;
  toRoute: EfficiencyRoute;
  factor: AdmissionFactor;
  now: Date;
  budgetOverrides?: Partial<RouteBudget>;
  authorizedPasses?: AuthorizedPass[];
}): Promise<RouteRecord> {
  const record = await readRouteRecord(input.root, input.episodeId);
  if (record.terminal !== null) throw new Error(`episode ${input.episodeId} is terminal`);
  assertMonotonicRoute(record.current_route, input.toRoute);
  const counters = await deriveRouteBudgetCounters(input.root, input.episodeId);
  const budget = { ...ROUTE_BUDGETS[input.toRoute], ...input.budgetOverrides };
  const reassessment: RouteReassessment = {
    reassessment_id: sha256(
      `${input.episodeId}\0${record.reassessments.length}\0${input.toRoute}\0${input.factor.policy_rule}`,
    ),
    at: input.now.toISOString(),
    from_route: record.current_route,
    to_route: input.toRoute,
    factor: input.factor,
    remaining_before: counters,
    newly_authorized_budget: budget,
  };
  const updated: RouteRecord = {
    ...record,
    current_route: input.toRoute,
    budget,
    execution_bounds: input.toRoute === "deterministic" ? null : executionBoundsFor(input.toRoute),
    factors: sortedFactors([...record.factors, input.factor]),
    authorized_passes: mergeAuthorizedPasses(record.authorized_passes, input.authorizedPasses ?? []),
    reassessments: [...record.reassessments, reassessment],
  };
  await writeLoopFileAtomic(routeRecordPath(input.root, input.episodeId), `${JSON.stringify(updated, null, 2)}\n`);
  return updated;
}

export async function finalizeEpisode(input: {
  root: string;
  episodeId: string;
  status: EpisodeTerminal["status"];
  reason: string;
  nextStep?: string;
  now: Date;
}): Promise<RouteRecord> {
  return withFileLock(routeMutationLockPath(input.root, input.episodeId), ROUTE_MUTATION_LOCK_OPTIONS, async () =>
    finalizeEpisodeLocked(input),
  );
}

async function finalizeEpisodeLocked(input: {
  root: string;
  episodeId: string;
  status: EpisodeTerminal["status"];
  reason: string;
  nextStep?: string;
  now: Date;
}): Promise<RouteRecord> {
  const record = await readRouteRecord(input.root, input.episodeId);
  if (record.terminal !== null) {
    // The terminal STATUS is the episode's semantic outcome. `reason` and
    // `next_step` are human-readable annotations that two legitimate writers
    // — EpisodePlan `afterCompletion` and the loop driver's terminal
    // disposition — word differently for the very same outcome (e.g.
    // "EpisodePlan v1 completed" vs "ticket:app:#1 merged"). Same status is
    // therefore an idempotent no-op that keeps the first writer's record; only
    // a status change is a genuine conflict worth failing on (#167).
    if (record.terminal.status === input.status) return record;
    throw new Error(
      `episode ${input.episodeId} already has a different terminal record: ` +
        `existing ${record.terminal.status} (${record.terminal.reason}) != ` +
        `requested ${input.status} (${input.reason})`,
    );
  }
  const terminal: EpisodeTerminal = {
    at: input.now.toISOString(),
    status: input.status,
    reason: input.reason,
    final_route: record.current_route,
    next_step: input.nextStep ?? null,
  };
  const updated: RouteRecord = { ...record, final_route: record.current_route, terminal };
  await writeLoopFileAtomic(routeRecordPath(input.root, input.episodeId), `${JSON.stringify(updated, null, 2)}\n`);
  return updated;
}

export async function checkProviderBudget(input: {
  root: string;
  episodeId: string;
  next?: { costUsd?: number; activeTimeMs?: number };
}): Promise<BudgetCheck> {
  const route = await readRouteRecord(input.root, input.episodeId);
  const counters = await deriveRouteBudgetCounters(input.root, input.episodeId);
  const terminalUnmeasured = [...counters.partial_or_unavailable_steps];
  const settledUsd = counters.equivalent_cost_usd;
  const pending = await pendingProviderReservations(input.root, input.episodeId);
  const reservedUsd = pending.receipts.reduce(
    (sum, receipt) => sum + (receipt.reservation?.equivalent_cost_usd ?? 0),
    0,
  );
  counters.provider_turns += pending.receipts.length + pending.corrupt.length;
  counters.equivalent_cost_usd += reservedUsd;
  counters.active_time_ms += pending.receipts.reduce(
    (sum, receipt) => sum + (receipt.reservation?.active_time_ms ?? 0),
    0,
  );
  counters.partial_or_unavailable_steps.push(
    ...pending.receipts.map((receipt) => receipt.execution_step_id),
    ...pending.corrupt,
  );
  const checked = budgetCheck(route, counters, input.next, { settledUsd, reservedUsd });
  if (pending.corrupt.length > 0) {
    return {
      ...checked,
      allowed: false,
      errorCode: "error_route_budget_unmeasured",
      reason: "corrupt provider reservation prevents safe admission",
    };
  }
  if (pending.receipts.some((receipt) => receipt.reservation === undefined)) {
    return {
      ...checked,
      allowed: false,
      errorCode: "error_route_budget_unmeasured",
      reason: "an in-flight provider turn has no measurable cost reservation",
    };
  }
  if (terminalUnmeasured.length > 0) {
    return {
      ...checked,
      allowed: false,
      errorCode: "error_route_budget_unmeasured",
      reason: `provider usage is partial or unavailable for ${terminalUnmeasured.join(", ")}`,
    };
  }
  return checked;
}

export async function remainingExecutionAllowance(
  root: string,
  episodeId: string,
): Promise<{
  activeTimeMs: number;
  equivalentCostUsd: number;
  providerTurns: number;
  toolCalls: number | null;
}> {
  const [budget, route, steps] = await Promise.all([
    checkProviderBudget({ root, episodeId }),
    readRouteRecord(root, episodeId),
    readExecutionSteps(root, episodeId),
  ]);
  const usedToolCalls = steps.reduce((sum, step) => sum + (step.tool_call_count ?? 0), 0);
  return {
    activeTimeMs: Math.max(0, budget.remaining.active_time_ms),
    equivalentCostUsd: Math.max(0, budget.remaining.equivalent_cost_usd),
    providerTurns: Math.max(0, budget.remaining.provider_turns),
    toolCalls:
      route.execution_bounds === null || route.execution_bounds === undefined
        ? null
        : Math.max(0, route.execution_bounds.toolCalls - usedToolCalls),
  };
}

function budgetCheck(
  route: RouteRecord,
  counters: EpisodeCounters,
  next: { costUsd?: number; activeTimeMs?: number } = {},
  exposure: { settledUsd: number; reservedUsd: number } = {
    settledUsd: counters.equivalent_cost_usd,
    reservedUsd: 0,
  },
): BudgetCheck {
  assertNonNegativeFinite("declared equivalent-cost allowance", next.costUsd);
  assertNonNegativeFinite("declared active-time allowance", next.activeTimeMs);
  const remaining: RouteBudget = {
    provider_turns: route.budget.provider_turns - counters.provider_turns,
    equivalent_cost_usd: route.budget.equivalent_cost_usd - counters.equivalent_cost_usd,
    active_time_ms: route.budget.active_time_ms - counters.active_time_ms,
    human_decisions:
      route.budget.human_decisions === null ? null : route.budget.human_decisions - counters.human_decisions,
  };
  const refusal =
    remaining.provider_turns < 1
      ? "provider-turn budget exhausted"
      : remaining.equivalent_cost_usd <= EQUIVALENT_COST_ARITHMETIC_TOLERANCE_USD
        ? "equivalent-cost budget exhausted"
        : (next.costUsd ?? 0) > remaining.equivalent_cost_usd + EQUIVALENT_COST_ARITHMETIC_TOLERANCE_USD
          ? "declared equivalent-cost allowance is insufficient"
          : (next.activeTimeMs ?? 0) > remaining.active_time_ms
            ? "declared active-time allowance is insufficient"
            : undefined;
  return {
    allowed: refusal === undefined,
    counters,
    remaining,
    exposure: {
      capUsd: route.budget.equivalent_cost_usd,
      settledUsd: exposure.settledUsd,
      reservedUsd: exposure.reservedUsd,
      requestedUsd: next.costUsd ?? 0,
    },
    ...(refusal !== undefined ? { errorCode: "error_route_budget_exhausted" as const } : {}),
    ...(refusal !== undefined ? { reason: refusal } : {}),
  };
}

function assertNonNegativeFinite(label: string, value: number | undefined): void {
  if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
    throw new TypeError(`${label} must be a finite non-negative number`);
  }
}

function formatUsd(value: number): string {
  return value.toFixed(4);
}

export async function beginProviderStep(input: {
  root: string;
  episodeId: string;
  app: string;
  runId: string;
  ordinal: number;
  operation: string;
  role: RoleConfig;
  assignment?: TurnAssignment;
  planMetadata?: ProviderStepPlanMetadata;
  settlementAttribution?: ProviderStepSettlementAttribution;
  inputFingerprint: string;
  now: Date;
  next?: { costUsd?: number; activeTimeMs?: number };
}): Promise<StartedProviderStep> {
  const assignment =
    input.assignment === undefined
      ? fixedAssignmentFromRole(input.role)
      : validateTurnAssignment(input.assignment, `${input.operation} assignment`);
  const planMetadata = normalizeProviderStepPlanMetadata(input.planMetadata, `${input.operation} plan metadata`);
  const settlementAttribution = normalizeProviderStepSettlementAttribution(
    input.settlementAttribution,
    `${input.operation} settlement attribution`,
  );
  if (!Number.isFinite(input.role.maxTurnBudgetUsd) || input.role.maxTurnBudgetUsd <= 0) {
    throw new TypeError(`role ${input.role.name} has an invalid maxTurnBudgetUsd`);
  }
  if (
    input.next?.costUsd !== undefined &&
    input.next.costUsd > input.role.maxTurnBudgetUsd + EQUIVALENT_COST_ARITHMETIC_TOLERANCE_USD
  ) {
    throw new TypeError(
      `declared equivalent-cost allowance $${formatUsd(input.next.costUsd)} exceeds ` +
        `role ${input.role.name} maxTurnBudgetUsd $${formatUsd(input.role.maxTurnBudgetUsd)}`,
    );
  }
  const release = await acquireEpisodeReservationLock(input.root, input.episodeId);
  try {
    let budget = await checkProviderBudget({
      root: input.root,
      episodeId: input.episodeId,
      ...(input.next !== undefined ? { next: input.next } : {}),
    });
    if (!budget.allowed) {
      throw new ProviderBudgetRefusalError(input.episodeId, input.operation, budget);
    }
    const reservation = {
      equivalentCostUsd:
        input.next?.costUsd ?? Math.min(input.role.maxTurnBudgetUsd, Math.max(0, budget.remaining.equivalent_cost_usd)),
      activeTimeMs: input.next?.activeTimeMs ?? 0,
    };
    // Production callers normally omit an estimate. In that case the
    // enforceable adapter ceiling is the smaller of the role cap and the
    // episode's remaining cost; explicit estimates are checked as declared.
    if (input.next?.costUsd === undefined) {
      budget = await checkProviderBudget({
        root: input.root,
        episodeId: input.episodeId,
        next: {
          ...(input.next ?? {}),
          costUsd: reservation.equivalentCostUsd,
        },
      });
      if (!budget.allowed) {
        throw new ProviderBudgetRefusalError(input.episodeId, input.operation, budget);
      }
    }
    const executionStepId = `${input.runId}:provider:${input.ordinal}`;
    const providerTurnId = sha256(`${input.episodeId}\0${executionStepId}`);
    const path = executionStepPath(input.root, input.episodeId, executionStepId);
    if (existsSync(path) || existsSync(`${path}.started`)) {
      throw new Error(`execution step ${executionStepId} already started or finalized`);
    }
    // A started receipt is the atomic budget reservation and is replaced by
    // the terminal record. Concurrent processes count it before admission.
    const receipt: StartedProviderReceipt = {
      schema_version: EFFICIENCY_SCHEMA_VERSION,
      execution_step_id: executionStepId,
      provider_turn_id: providerTurnId,
      episode_id: input.episodeId,
      app: input.app,
      run_id: input.runId,
      kind: "provider",
      operation: input.operation,
      role: input.role.name,
      runtime: assignment.harness,
      model: assignment.model,
      effort: assignment.effort,
      ...planMetadata,
      ...settlementAttribution,
      started_at: input.now.toISOString(),
      input_fingerprint: input.inputFingerprint,
      context_manifest_ref: "context-manifest.json",
      reservation: {
        equivalent_cost_usd: reservation.equivalentCostUsd,
        active_time_ms: reservation.activeTimeMs,
      },
    };
    await writeLoopFileAtomic(`${path}.started`, `${JSON.stringify(receipt, null, 2)}\n`);
    return {
      executionStepId,
      providerTurnId,
      startedAt: input.now,
      inputFingerprint: input.inputFingerprint,
      assignment,
      ...(Object.keys(planMetadata).length > 0 ? { planMetadata } : {}),
      reservation,
      budget: {
        capUsd: budget.exposure.capUsd,
        settledUsd: budget.exposure.settledUsd,
        alreadyReservedUsd: budget.exposure.reservedUsd,
      },
    };
  } finally {
    await release();
  }
}

export async function finalizeProviderStep(input: {
  root: string;
  episodeId: string;
  app: string;
  runId: string;
  started: StartedProviderStep;
  operation: string;
  role: RoleConfig;
  assignment?: TurnAssignment;
  planMetadata?: ProviderStepPlanMetadata;
  result: TurnResult;
  finishedAt: Date;
  contextManifestRef: string;
  workFingerprintBefore?: string;
  workFingerprintAfter?: string;
  artifactFingerprint?: string;
  toolCallCount?: number;
}): Promise<ExecutionStepRecord> {
  const prior = await readExecutionSteps(input.root, input.episodeId);
  const repeated = prior.find(
    (step) => step.kind === "provider" && step.input_fingerprint === input.started.inputFingerprint,
  );
  const changedWork =
    input.workFingerprintBefore !== undefined &&
    input.workFingerprintAfter !== undefined &&
    input.workFingerprintBefore !== input.workFingerprintAfter;
  const independentVerification =
    input.result.status === "completed" && /review|verify|ship-check/i.test(input.operation);
  const productive =
    input.result.status === "completed"
      ? repeated === undefined && (changedWork || input.artifactFingerprint !== undefined || independentVerification)
      : false;
  const path = executionStepPath(input.root, input.episodeId, input.started.executionStepId);
  const release = await acquireEpisodeReservationLock(input.root, input.episodeId);
  try {
    const receipt = await readStartedProviderReceipt(`${path}.started`);
    assertStartedProviderIdentity(receipt, input);
    const receiptAssignment = validateTurnAssignment(
      { harness: receipt.runtime, model: receipt.model, effort: receipt.effort },
      `${input.operation} started receipt assignment`,
    );
    const assertedAssignment = input.assignment ?? input.started.assignment;
    if (
      assertedAssignment !== undefined &&
      !turnAssignmentsEqual(
        validateTurnAssignment(assertedAssignment, `${input.operation} final assignment`),
        receiptAssignment,
      )
    ) {
      throw new Error(`provider step ${input.started.executionStepId} assignment disagrees with its started receipt`);
    }
    const receiptMetadata = metadataFromProviderReceipt(receipt);
    const assertedMetadata = input.planMetadata ?? input.started.planMetadata;
    if (
      assertedMetadata !== undefined &&
      !providerStepPlanMetadataEqual(
        normalizeProviderStepPlanMetadata(assertedMetadata, `${input.operation} final plan metadata`),
        receiptMetadata,
      )
    ) {
      throw new Error(
        `provider step ${input.started.executionStepId} plan metadata disagrees with its started receipt`,
      );
    }
    const record: ExecutionStepRecord = {
      schema_version: EFFICIENCY_SCHEMA_VERSION,
      execution_step_id: receipt.execution_step_id,
      episode_id: receipt.episode_id,
      app: receipt.app,
      run_id: receipt.run_id,
      kind: "provider",
      provider_turn_id: receipt.provider_turn_id,
      operation: receipt.operation,
      role: receipt.role,
      runtime: receiptAssignment.harness,
      model: receiptAssignment.model,
      effort: receiptAssignment.effort,
      ...receiptMetadata,
      ...settlementAttributionFromProviderReceipt(receipt),
      started_at: receipt.started_at,
      finished_at: input.finishedAt.toISOString(),
      status: executionStatus(input.result.status),
      error_code: input.result.errorCode ?? null,
      reason: input.result.summary,
      next_step: input.result.status === "completed" ? null : "resume from the last valid artifact boundary",
      context_manifest_ref: input.contextManifestRef,
      input_fingerprint: receipt.input_fingerprint,
      work_fingerprint_before: input.workFingerprintBefore ?? null,
      work_fingerprint_after: input.workFingerprintAfter ?? null,
      artifact_fingerprint: input.artifactFingerprint ?? null,
      productive,
      repeated_from_step_id: repeated?.execution_step_id ?? null,
      tool_call_count: input.toolCallCount ?? 0,
      usage: input.result.usage,
    };
    await writeLoopFileAtomic(path, `${JSON.stringify(record, null, 2)}\n`);
    await rm(`${path}.started`, { force: true });
    return record;
  } finally {
    await release();
  }
}

export async function recordMechanicalStep(input: {
  root: string;
  episodeId: string;
  app: string;
  runId: string;
  operation: string;
  startedAt: Date;
  finishedAt: Date;
  status: ExecutionStatus;
  reason: string;
  nextStep?: string;
  inputFingerprint: string;
  planMetadata?: Pick<ProviderStepPlanMetadata, "plan_version" | "plan_step_id">;
}): Promise<ExecutionStepRecord> {
  const planMetadata = normalizeProviderStepPlanMetadata(input.planMetadata, `${input.operation} plan metadata`);
  const stepId = `${input.runId}:mechanical:${sha256(input.operation).slice(0, 12)}`;
  const path = executionStepPath(input.root, input.episodeId, stepId);
  if (existsSync(path)) return JSON.parse(await readFile(path, "utf8")) as ExecutionStepRecord;
  const record: ExecutionStepRecord = {
    schema_version: EFFICIENCY_SCHEMA_VERSION,
    execution_step_id: stepId,
    episode_id: input.episodeId,
    app: input.app,
    run_id: input.runId,
    kind: "mechanical",
    provider_turn_id: null,
    operation: input.operation,
    role: null,
    runtime: null,
    model: null,
    effort: null,
    ...(planMetadata.plan_version !== undefined
      ? {
          plan_version: planMetadata.plan_version,
          plan_step_id: planMetadata.plan_step_id,
        }
      : {}),
    started_at: input.startedAt.toISOString(),
    finished_at: input.finishedAt.toISOString(),
    status: input.status,
    error_code: null,
    reason: input.reason,
    next_step: input.nextStep ?? null,
    context_manifest_ref: null,
    input_fingerprint: input.inputFingerprint,
    work_fingerprint_before: null,
    work_fingerprint_after: null,
    artifact_fingerprint: null,
    productive: null,
    repeated_from_step_id: null,
    tool_call_count: 0,
    usage: null,
  };
  await writeLoopFileAtomic(path, `${JSON.stringify(record, null, 2)}\n`);
  return record;
}

export async function readExecutionSteps(root: string, episodeId: string): Promise<ExecutionStepRecord[]> {
  const dir = join(efficiencyEpisodeDir(root, episodeId), "steps");
  if (!existsSync(dir)) return [];
  const records: ExecutionStepRecord[] = [];
  for (const file of (await readdir(dir)).filter((name) => name.endsWith(".json")).sort()) {
    try {
      const record: unknown = JSON.parse(await readFile(join(dir, file), "utf8"));
      if (!isExecutionStepRecord(record)) continue;
      if (record.episode_id === episodeId) records.push(record);
    } catch {
      // Atomic writers leave no torn target. A corrupt foreign/manual file is
      // omitted here and named by the report's directory diagnostics.
    }
  }
  return records.sort(
    (a, b) => a.started_at.localeCompare(b.started_at) || a.execution_step_id.localeCompare(b.execution_step_id),
  );
}

/** Pending reservations for one episode, exposed for outer durable-step
 * reconciliation. Corruption is a hard error; a caller must never mistake an
 * unreadable reservation for permission to start another provider turn. */
export async function readPendingProviderSteps(root: string, episodeId: string): Promise<StartedProviderReceipt[]> {
  const pending = await pendingProviderReservations(root, episodeId);
  if (pending.corrupt.length > 0) {
    throw new Error(`episode ${episodeId} has corrupt provider reservation(s): ${pending.corrupt.join(", ")}`);
  }
  return pending.receipts.map((receipt) => structuredClone(receipt));
}

/** Read every Phase-1 evidence directory deterministically. Corrupt and
 * pending identities are returned, never silently treated as absent. */
export async function readEfficiencyEvidence(root: string): Promise<EfficiencyEpisodeEvidence[]> {
  const episodesDir = join(root, "efficiency", "episodes");
  if (!existsSync(episodesDir)) return [];
  const evidence: EfficiencyEpisodeEvidence[] = [];
  const episodeEntries = (await readdir(episodesDir, { withFileTypes: true })).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  for (const entry of episodeEntries) {
    const directory = entry.name;
    const base = join(episodesDir, directory);
    const corrupt: string[] = [];
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      evidence.push({
        directory,
        route: null,
        steps: [],
        pending_started: [],
        corrupt_files: [join("efficiency", "episodes", directory, "invalid_or_symlinked_episode_entry")],
      });
      continue;
    }
    let route: RouteRecord | null = null;
    // Episode planning intentionally persists its fixed boot admission (or an
    // accepted creator-scoped plan pointer) before a derived route exists.
    // Historical readers still receive `route: null`, but that bounded
    // pre-route state is not reported as corruption merely because route.json
    // has not been authorized yet.
    const validPreRouteMarker = await hasValidPreRouteEpisodeMarker(base);
    try {
      const value: unknown = JSON.parse(await readFile(join(base, "route.json"), "utf8"));
      if (!isRouteRecord(value)) throw new Error("invalid route schema");
      route = value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" || !validPreRouteMarker) {
        corrupt.push(join("efficiency", "episodes", directory, "route.json"));
      }
    }
    const steps: ExecutionStepRecord[] = [];
    const pending: StartedProviderReceipt[] = [];
    const stepsDir = join(base, "steps");
    if (existsSync(stepsDir)) {
      const info = await lstat(stepsDir);
      if (!info.isDirectory() || info.isSymbolicLink()) {
        corrupt.push(join("efficiency", "episodes", directory, "steps", "invalid_or_symlinked_steps_entry"));
      } else {
        for (const file of (await readdir(stepsDir)).sort()) {
          const path = join(stepsDir, file);
          if (!file.endsWith(".json") && !file.endsWith(".json.started")) continue;
          try {
            const value: unknown = JSON.parse(await readFile(path, "utf8"));
            if (file.endsWith(".started")) {
              if (!isStartedProviderReceipt(value)) throw new Error("invalid started receipt schema");
              pending.push(value);
            } else {
              if (!isExecutionStepRecord(value)) throw new Error("invalid execution step schema");
              steps.push(value);
            }
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT" && file.endsWith(".started")) continue;
            corrupt.push(join("efficiency", "episodes", directory, "steps", file));
          }
        }
      }
    }
    evidence.push({ directory, route, steps, pending_started: pending, corrupt_files: corrupt });
  }
  return evidence;
}

/** Convert abandoned started receipts to typed resumable terminal steps. */
export async function reconcileStaleProviderSteps(
  root: string,
  now: Date,
  staleAfterMs: number,
  recoverUsage?: (receipt: StartedProviderReceipt) => Promise<TurnUsage | undefined>,
): Promise<{ finalized: ExecutionStepRecord[]; inFlight: string[]; corrupt: string[] }> {
  const finalized: ExecutionStepRecord[] = [];
  const inFlight: string[] = [];
  const evidence = await readEfficiencyEvidence(root);
  for (const episode of evidence) {
    const reconciled = await reconcileProviderReceipts(root, episode.pending_started, now, staleAfterMs, recoverUsage);
    finalized.push(...reconciled.finalized);
    inFlight.push(...reconciled.inFlight);
  }
  return {
    finalized,
    inFlight: inFlight.sort(),
    corrupt: evidence.flatMap((episode) => episode.corrupt_files).sort(),
  };
}

/** Reconcile only one accepted episode before resuming its plan DAG. This is
 * deliberately narrower than ledger-wide repair: resuming episode A must not
 * mutate unrelated episode B merely because both have old receipts. Fresh
 * receipts remain typed in-flight evidence and are never retried. */
export async function reconcileEpisodeProviderSteps(
  root: string,
  episodeId: string,
  now: Date,
  staleAfterMs: number,
  recoverUsage?: (receipt: StartedProviderReceipt) => Promise<TurnUsage | undefined>,
): Promise<{ finalized: ExecutionStepRecord[]; inFlight: string[] }> {
  if (!Number.isFinite(staleAfterMs) || staleAfterMs < 0) {
    throw new TypeError("provider reconciliation staleAfterMs must be finite and non-negative");
  }
  const receipts = await readPendingProviderSteps(root, episodeId);
  return reconcileProviderReceipts(root, receipts, now, staleAfterMs, recoverUsage);
}

async function reconcileProviderReceipts(
  root: string,
  receipts: readonly StartedProviderReceipt[],
  now: Date,
  staleAfterMs: number,
  recoverUsage?: (receipt: StartedProviderReceipt) => Promise<TurnUsage | undefined>,
): Promise<{ finalized: ExecutionStepRecord[]; inFlight: string[] }> {
  const finalized: ExecutionStepRecord[] = [];
  const inFlight: string[] = [];
  for (const receipt of receipts) {
    const target = executionStepPath(root, receipt.episode_id, receipt.execution_step_id);
    const release = await acquireEpisodeReservationLock(root, receipt.episode_id);
    try {
      if (!existsSync(`${target}.started`)) continue;
      if (existsSync(target)) {
        // Crash after atomic terminal-step replacement but before the started
        // receipt unlink: preserve the terminal truth and finish the unlink.
        await rm(`${target}.started`, { force: true });
        continue;
      }
      if (now.getTime() - new Date(receipt.started_at).getTime() < staleAfterMs) {
        inFlight.push(receipt.execution_step_id);
        continue;
      }
      const recoveredUsage = await recoverUsage?.(receipt);
      const record: ExecutionStepRecord = {
        schema_version: EFFICIENCY_SCHEMA_VERSION,
        execution_step_id: receipt.execution_step_id,
        episode_id: receipt.episode_id,
        app: receipt.app,
        run_id: receipt.run_id,
        kind: "provider",
        provider_turn_id: receipt.provider_turn_id,
        operation: receipt.operation,
        role: receipt.role,
        runtime: receipt.runtime,
        model: receipt.model,
        effort: receipt.effort,
        ...metadataFromProviderReceipt(receipt),
        ...settlementAttributionFromProviderReceipt(receipt),
        started_at: receipt.started_at,
        finished_at: now.toISOString(),
        status: "interrupted",
        error_code: "error_stale_missing_finalization",
        reason: "provider execution lost its owner heartbeat before finalization",
        next_step: "resume from the last valid artifact boundary",
        context_manifest_ref: receipt.context_manifest_ref,
        tool_call_count: 0,
        input_fingerprint: receipt.input_fingerprint,
        work_fingerprint_before: null,
        work_fingerprint_after: null,
        artifact_fingerprint: null,
        productive: false,
        repeated_from_step_id: null,
        usage: recoveredUsage ?? {
          tokensIn: 0,
          tokensOut: 0,
          costUsd: 0,
          subagentTurns: 0,
          wallClockMs: Math.max(0, now.getTime() - new Date(receipt.started_at).getTime()),
          quality: "unavailable",
        },
      };
      await writeLoopFileAtomic(target, `${JSON.stringify(record, null, 2)}\n`);
      await rm(`${target}.started`, { force: true });
      finalized.push(record);
    } finally {
      await release();
    }
  }
  return { finalized, inFlight: inFlight.sort() };
}

export async function deriveEpisodeCounters(root: string, episodeId: string): Promise<EpisodeCounters> {
  const steps = await readExecutionSteps(root, episodeId);
  const provider = steps.filter((step) => step.kind === "provider");
  return {
    provider_turns: new Set(provider.map((step) => step.provider_turn_id)).size,
    input_tokens: provider.reduce((sum, step) => sum + (step.usage?.tokensIn ?? 0), 0),
    output_tokens: provider.reduce((sum, step) => sum + (step.usage?.tokensOut ?? 0), 0),
    equivalent_cost_usd: provider.reduce((sum, step) => sum + (step.usage?.costUsd ?? 0), 0),
    active_time_ms: unionDurationMs(steps.map((step) => ({ start: step.started_at, end: step.finished_at }))),
    human_decisions: 0,
    partial_or_unavailable_steps: provider
      .filter((step) => step.usage === null || step.usage.quality === "partial" || step.usage.quality === "unavailable")
      .map((step) => step.execution_step_id),
  };
}

/** Counters used specifically for route admission and enforcement.
 *
 * EpisodePlanner structural repair is one bounded planning workflow: the
 * invalid proposal is replaced by its repair before any route is selected.
 * Both attempts remain separate provider settlements and both retain their
 * actual cost, time, token, and quality evidence. Only the provider-turn route
 * slot treats the initial `episode-planner:attempt:N` sequence as one effective
 * planning result, matching the preview calculation that reserves one planner
 * slot before the accepted delivery graph.
 */
export async function deriveRouteBudgetCounters(root: string, episodeId: string): Promise<EpisodeCounters> {
  const steps = await readExecutionSteps(root, episodeId);
  const counters = await deriveEpisodeCounters(root, episodeId);
  const provider = steps.filter((step) => step.kind === "provider");
  const initialPlanner = provider.filter((step) => /^episode-planner:attempt:\d+$/.test(step.execution_step_id));
  if (initialPlanner.length === 0) return counters;
  const otherProviderTurnIds = new Set(
    provider
      .filter((step) => !/^episode-planner:attempt:\d+$/.test(step.execution_step_id))
      .map((step) => step.provider_turn_id),
  );
  return {
    ...counters,
    provider_turns: otherProviderTurnIds.size + 1,
  };
}

export function unionDurationMs(intervals: Array<{ start: string; end: string }>): number {
  const sorted = intervals
    .map(({ start, end }) => [new Date(start).getTime(), new Date(end).getTime()] as const)
    .filter(([start, end]) => Number.isFinite(start) && Number.isFinite(end) && end >= start)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let total = 0;
  let currentStart: number | undefined;
  let currentEnd: number | undefined;
  for (const [start, end] of sorted) {
    if (currentStart === undefined || currentEnd === undefined) {
      currentStart = start;
      currentEnd = end;
    } else if (start <= currentEnd) {
      currentEnd = Math.max(currentEnd, end);
    } else {
      total += currentEnd - currentStart;
      currentStart = start;
      currentEnd = end;
    }
  }
  return total + (currentStart === undefined || currentEnd === undefined ? 0 : currentEnd - currentStart);
}

export function settlementCoverage(
  steps: readonly ExecutionStepRecord[],
  settlements: readonly TurnRecord[],
): {
  numerator: number;
  denominator: number;
  missing: string[];
  duplicate: string[];
  mechanical_with_settlement: string[];
} {
  const counts = new Map<string, number>();
  for (const row of settlements) {
    if (row.providerTurnId !== undefined) counts.set(row.providerTurnId, (counts.get(row.providerTurnId) ?? 0) + 1);
  }
  const provider = steps.filter((step) => step.kind === "provider");
  const missing = provider
    .filter((step) => (counts.get(step.provider_turn_id!) ?? 0) === 0)
    .map((step) => step.execution_step_id);
  const duplicate = provider
    .filter((step) => (counts.get(step.provider_turn_id!) ?? 0) > 1)
    .map((step) => step.execution_step_id);
  const mechanicalIds = new Set(
    steps.filter((step) => step.kind === "mechanical").map((step) => step.execution_step_id),
  );
  const mechanicalWithSettlement = settlements
    .filter((row) => row.executionStepId !== undefined && mechanicalIds.has(row.executionStepId))
    .map((row) => row.executionStepId!);
  return {
    numerator: provider.length - missing.length - duplicate.length,
    denominator: provider.length,
    missing,
    duplicate,
    mechanical_with_settlement: [...new Set(mechanicalWithSettlement)].sort(),
  };
}

export function fingerprint(value: unknown): string {
  return sha256(stableJson(value));
}

/** Content fingerprint of the authoritative tracked git state. Read-only
 * provider work may create ignored or other untracked build artifacts while
 * verifying the product; those files are not evidence of source mutation.
 * Unknown is explicit. */
export function worktreeFingerprint(workdir: string): string | undefined {
  try {
    const head = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: workdir,
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5_000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    const trackedDiff = execFileSync("git", ["diff", "--no-ext-diff", "--binary", "HEAD", "--"], {
      cwd: workdir,
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5_000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      maxBuffer: 64 * 1024 * 1024,
    });
    return createHash("sha256").update(head).update(trackedDiff).digest("hex");
  } catch {
    return undefined;
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

const PROVIDER_PLAN_METADATA_FIELDS = [
  "assignment_source",
  "assignment_candidate_id",
  "plan_version",
  "plan_step_id",
  "selection_reason",
  "provider_family",
  "resolved_capabilities",
] as const;

function normalizeProviderStepPlanMetadata(value: unknown, context: string): ProviderStepPlanMetadata {
  if (value === undefined) return {};
  if (!isRecord(value)) throw new Error(`${context} must be a mapping`);
  const unknown = Object.keys(value).filter(
    (key) => !(PROVIDER_PLAN_METADATA_FIELDS as readonly string[]).includes(key),
  );
  if (unknown.length > 0) {
    throw new Error(`${context} has unknown field(s): ${unknown.sort().join(", ")}`);
  }

  const normalized: ProviderStepPlanMetadata = {};
  const assignmentSource = value["assignment_source"];
  if (assignmentSource !== undefined) {
    if (
      typeof assignmentSource !== "string" ||
      !(["configured", "episode_planner", "creator"] as readonly string[]).includes(assignmentSource)
    ) {
      throw new Error(`${context}.assignment_source is invalid`);
    }
    normalized.assignment_source = assignmentSource as TurnAssignmentSource;
  }
  if (value["assignment_candidate_id"] !== undefined) {
    normalized.assignment_candidate_id = validateAssignmentCandidateId(
      value["assignment_candidate_id"],
      `${context}.assignment_candidate_id`,
    );
  }

  const planVersion = value["plan_version"];
  const planStepId = value["plan_step_id"];
  const hasPlanVersion = planVersion !== undefined;
  const hasPlanStep = planStepId !== undefined;
  if (hasPlanVersion !== hasPlanStep) {
    throw new Error(`${context}.plan_version and plan_step_id must be supplied together`);
  }
  if (hasPlanVersion) {
    if (typeof planVersion !== "number" || !Number.isInteger(planVersion) || planVersion < 1) {
      throw new Error(`${context}.plan_version must be a positive integer`);
    }
    normalized.plan_version = planVersion;
    normalized.plan_step_id = validateEvidenceText(planStepId, `${context}.plan_step_id`);
  }
  if (value["selection_reason"] !== undefined) {
    normalized.selection_reason = validateEvidenceText(value["selection_reason"], `${context}.selection_reason`);
  }
  if (value["provider_family"] !== undefined) {
    normalized.provider_family = validateProviderFamily(value["provider_family"], `${context}.provider_family`);
  }
  const resolvedCapabilities = value["resolved_capabilities"];
  if (resolvedCapabilities !== undefined) {
    if (!Array.isArray(resolvedCapabilities)) {
      throw new Error(`${context}.resolved_capabilities must be an array`);
    }
    const capabilities = resolvedCapabilities.map((capability, index) =>
      validateEvidenceText(capability, `${context}.resolved_capabilities[${index}]`),
    );
    if (new Set(capabilities).size !== capabilities.length) {
      throw new Error(`${context}.resolved_capabilities must not contain duplicates`);
    }
    normalized.resolved_capabilities = capabilities.sort();
  }
  return normalized;
}

function validateEvidenceText(value: unknown, context: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value !== value.trim() ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new Error(`${context} must be non-empty text without surrounding whitespace or controls`);
  }
  return value;
}

function metadataFromAuthorizedPass(pass: AuthorizedPass): ProviderStepPlanMetadata {
  return normalizeProviderStepPlanMetadata(
    {
      ...(pass.assignment_source !== undefined ? { assignment_source: pass.assignment_source } : {}),
      ...(pass.assignment_candidate_id !== undefined ? { assignment_candidate_id: pass.assignment_candidate_id } : {}),
      ...(pass.plan_version !== undefined ? { plan_version: pass.plan_version } : {}),
      ...(pass.plan_step_id !== undefined ? { plan_step_id: pass.plan_step_id } : {}),
      ...(pass.selection_reason !== undefined ? { selection_reason: pass.selection_reason } : {}),
      ...(pass.provider_family !== undefined ? { provider_family: pass.provider_family } : {}),
      ...(pass.resolved_capabilities !== undefined ? { resolved_capabilities: pass.resolved_capabilities } : {}),
    },
    `${pass.pipeline}/${pass.pass} authorization metadata`,
  );
}

function normalizeAuthorizedPass(pass: AuthorizedPass): AuthorizedPass {
  const metadata = metadataFromAuthorizedPass(pass);
  return {
    pipeline: pass.pipeline,
    pass: pass.pass,
    role: pass.role,
    runtime: pass.runtime,
    model: pass.model,
    effort: pass.effort,
    factor_rules: [...pass.factor_rules],
    ...metadata,
  };
}

function metadataFromProviderReceipt(receipt: StartedProviderReceipt): ProviderStepPlanMetadata {
  return normalizeProviderStepPlanMetadata(
    {
      ...(receipt.assignment_source !== undefined ? { assignment_source: receipt.assignment_source } : {}),
      ...(receipt.assignment_candidate_id !== undefined
        ? { assignment_candidate_id: receipt.assignment_candidate_id }
        : {}),
      ...(receipt.plan_version !== undefined ? { plan_version: receipt.plan_version } : {}),
      ...(receipt.plan_step_id !== undefined ? { plan_step_id: receipt.plan_step_id } : {}),
      ...(receipt.selection_reason !== undefined ? { selection_reason: receipt.selection_reason } : {}),
      ...(receipt.provider_family !== undefined ? { provider_family: receipt.provider_family } : {}),
      ...(receipt.resolved_capabilities !== undefined ? { resolved_capabilities: receipt.resolved_capabilities } : {}),
    },
    `provider step ${receipt.execution_step_id} receipt metadata`,
  );
}

const PROVIDER_SETTLEMENT_ATTRIBUTION_FIELDS = ["experiment_ref", "candidate_ref", "learning_activity"] as const;

function normalizeProviderStepSettlementAttribution(
  value: unknown,
  context: string,
): ProviderStepSettlementAttribution {
  if (value === undefined) return {};
  if (!isRecord(value)) throw new Error(`${context} must be a mapping`);
  const unknown = Object.keys(value).filter(
    (key) => !(PROVIDER_SETTLEMENT_ATTRIBUTION_FIELDS as readonly string[]).includes(key),
  );
  if (unknown.length > 0) {
    throw new Error(`${context} has unknown field(s): ${unknown.sort().join(", ")}`);
  }
  const normalized: ProviderStepSettlementAttribution = {};
  if (value["experiment_ref"] !== undefined) {
    normalized.experiment_ref = validateEvidenceText(value["experiment_ref"], `${context}.experiment_ref`);
  }
  if (value["candidate_ref"] !== undefined) {
    normalized.candidate_ref = validateEvidenceText(value["candidate_ref"], `${context}.candidate_ref`);
  }
  const learningActivity = value["learning_activity"];
  if (learningActivity !== undefined) {
    if (learningActivity !== "distillation" && learningActivity !== "review") {
      throw new Error(`${context}.learning_activity is invalid`);
    }
    normalized.learning_activity = learningActivity;
  }
  return normalized;
}

function settlementAttributionFromProviderReceipt(receipt: StartedProviderReceipt): ProviderStepSettlementAttribution {
  return normalizeProviderStepSettlementAttribution(
    Object.fromEntries(
      PROVIDER_SETTLEMENT_ATTRIBUTION_FIELDS.filter((field) => receipt[field] !== undefined).map((field) => [
        field,
        receipt[field],
      ]),
    ),
    `provider step ${receipt.execution_step_id} settlement attribution`,
  );
}

function providerStepPlanMetadataEqual(left: ProviderStepPlanMetadata, right: ProviderStepPlanMetadata): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function readStartedProviderReceipt(path: string): Promise<StartedProviderReceipt> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`provider started receipt is unavailable: ${(error as Error).message}`);
  }
  if (!isStartedProviderReceipt(value)) throw new Error("invalid provider started receipt");
  return value;
}

function assertStartedProviderIdentity(
  receipt: StartedProviderReceipt,
  input: {
    episodeId: string;
    app: string;
    runId: string;
    operation: string;
    role: Pick<RoleConfig, "name">;
    started: StartedProviderStep;
  },
): void {
  const same =
    receipt.execution_step_id === input.started.executionStepId &&
    receipt.provider_turn_id === input.started.providerTurnId &&
    receipt.episode_id === input.episodeId &&
    receipt.app === input.app &&
    receipt.run_id === input.runId &&
    receipt.operation === input.operation &&
    receipt.role === input.role.name &&
    receipt.started_at === input.started.startedAt.toISOString() &&
    receipt.input_fingerprint === input.started.inputFingerprint;
  if (!same) {
    throw new Error(`provider step ${input.started.executionStepId} identity disagrees with its started receipt`);
  }
}

interface PlanRouteAuthority {
  version: number;
  hash: string;
}

function planAuthorityFromAdmission(input: RouteAdmissionInput): PlanRouteAuthority | undefined {
  const version = input.currentPlanVersion;
  const hash = input.currentPlanHash;
  if (version === undefined && hash === undefined) return undefined;
  if (version === undefined || hash === undefined) {
    throw new TypeError("current plan version and hash must be supplied together");
  }
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new TypeError("current plan version must be a positive safe integer");
  }
  if (!/^[a-f0-9]{64}$/u.test(hash)) {
    throw new TypeError("current plan hash must be a lowercase sha256 digest");
  }
  return { version, hash };
}

function planAuthorityFromRoute(record: RouteRecord): PlanRouteAuthority | undefined {
  const version = record.current_plan_version;
  const hash = record.current_plan_hash;
  if (version === undefined && hash === undefined) return undefined;
  if (
    version === undefined ||
    hash === undefined ||
    !Number.isSafeInteger(version) ||
    version < 1 ||
    !/^[a-f0-9]{64}$/u.test(hash)
  ) {
    throw new Error(`efficiency route ${record.episode_id} has invalid current-plan authority`);
  }
  return { version, hash };
}

async function admitPlanRouteRevision(
  input: RouteAdmissionInput,
  existing: RouteRecord,
  requestedPasses: AuthorizedPass[],
  requestedPlan: PlanRouteAuthority,
): Promise<RouteRecord> {
  if (existing.app !== input.app || existing.policy_version !== input.policyVersion) {
    throw new Error(
      `efficiency admission conflict for ${input.episodeId}: existing plan route belongs to ` +
        `${existing.app}/${existing.policy_version}, requested ${input.app}/${input.policyVersion}`,
    );
  }
  const requestedBudget = { ...ROUTE_BUDGETS[input.route], ...input.budgetOverrides };
  const requestedBounds =
    input.executionBounds !== undefined
      ? input.executionBounds
      : input.route === "deterministic"
        ? null
        : executionBoundsFor(input.route);
  if (requestedBounds !== null || existing.execution_bounds !== null) {
    throw new Error(
      `efficiency admission conflict for ${input.episodeId}: plan-DAG route revisions require null static execution bounds`,
    );
  }

  const existingPlan = planAuthorityFromRoute(existing);
  const inferredVersion = existingPlan?.version ?? latestPlanAuthorizationVersion(existing.authorized_passes);
  if (inferredVersion === undefined) {
    throw new Error(
      `efficiency admission conflict for ${input.episodeId}: an authority-free historical route cannot be adopted by a plan`,
    );
  }
  if (requestedPlan.version < inferredVersion || requestedPlan.version > inferredVersion + 1) {
    throw new Error(
      `efficiency admission conflict for ${input.episodeId}: current plan is v${inferredVersion}, ` +
        `requested v${requestedPlan.version}`,
    );
  }

  const existingCurrent = existing.authorized_passes.filter((pass) => pass.plan_version === requestedPlan.version);
  if (requestedPlan.version === inferredVersion) {
    if (existingPlan !== undefined && existingPlan.hash !== requestedPlan.hash) {
      throw new Error(
        `efficiency admission conflict for ${input.episodeId}: plan v${requestedPlan.version} has a different hash`,
      );
    }
    if (
      existing.current_route !== input.route ||
      !routeBudgetsEqual(existing.budget, requestedBudget) ||
      !samePassSet(existingCurrent, requestedPasses)
    ) {
      throw new Error(
        `efficiency admission conflict for ${input.episodeId}: plan v${requestedPlan.version} ` +
          `does not match its durable route authority`,
      );
    }
    const existingFactors = new Set(existing.factors.map(factorIdentity));
    if (input.factors.some((factor) => !existingFactors.has(factorIdentity(factor)))) {
      throw new Error(
        `efficiency admission conflict for ${input.episodeId}: plan v${requestedPlan.version} has unrecorded factors`,
      );
    }
    if (existingPlan !== undefined) return existing;
    const migrated: RouteRecord = {
      ...existing,
      current_plan_version: requestedPlan.version,
      current_plan_hash: requestedPlan.hash,
    };
    await writeLoopFileAtomic(routeRecordPath(input.root, input.episodeId), `${JSON.stringify(migrated, null, 2)}\n`);
    return migrated;
  }

  if (existing.terminal !== null) {
    throw new Error(
      `efficiency admission conflict for ${input.episodeId}: terminal route cannot adopt a plan revision`,
    );
  }
  assertMonotonicRoute(existing.current_route, input.route);
  assertRouteBudgetMonotonic(existing.budget, requestedBudget, input.episodeId);
  const factors = mergeAdmissionFactors(existing.factors, input.factors);
  assertAuthorizedPassFactors(requestedPasses, factors, input.episodeId);
  const counters = await deriveRouteBudgetCounters(input.root, input.episodeId);
  const revisionFactor = input.factors[0];
  if (revisionFactor === undefined) {
    throw new Error(`efficiency admission for ${input.episodeId} requires an explicit plan revision factor`);
  }
  const reassessment: RouteReassessment = {
    reassessment_id: sha256(
      `${input.episodeId}\0plan-v${requestedPlan.version}\0${requestedPlan.hash}\0${revisionFactor.policy_rule}`,
    ),
    at: input.now.toISOString(),
    from_route: existing.current_route,
    to_route: input.route,
    factor: revisionFactor,
    remaining_before: counters,
    newly_authorized_budget: requestedBudget,
  };
  const updated: RouteRecord = {
    ...existing,
    current_route: input.route,
    factors,
    authorized_passes: mergeAuthorizedPasses(existing.authorized_passes, requestedPasses),
    budget: requestedBudget,
    execution_bounds: null,
    current_plan_version: requestedPlan.version,
    current_plan_hash: requestedPlan.hash,
    reassessments: [...existing.reassessments, reassessment],
  };
  await writeLoopFileAtomic(routeRecordPath(input.root, input.episodeId), `${JSON.stringify(updated, null, 2)}\n`);
  return updated;
}

function assertPlanVersionedAuthorizations(passes: AuthorizedPass[], planVersion: number): void {
  const stepKeys = new Set<string>();
  for (const pass of passes) {
    if (pass.plan_version !== planVersion || pass.plan_step_id === undefined) {
      throw new Error(
        `plan v${planVersion} route authorization ${pass.pipeline}/${pass.pass} must carry matching plan metadata`,
      );
    }
    const key = `${pass.pipeline}\0${pass.pass}\0${pass.plan_step_id}`;
    if (stepKeys.has(key)) {
      throw new Error(`plan v${planVersion} contains duplicate route authorization ${pass.pipeline}/${pass.pass}`);
    }
    stepKeys.add(key);
  }
}

function latestPlanAuthorizationVersion(passes: AuthorizedPass[]): number | undefined {
  const versions = passes
    .map((pass) => pass.plan_version)
    .filter((version): version is number => version !== undefined);
  return versions.length === 0 ? undefined : Math.max(...versions);
}

function samePassSet(left: AuthorizedPass[], right: AuthorizedPass[]): boolean {
  if (left.length !== right.length) return false;
  const identities = new Set(left.map(passIdentity));
  return identities.size === left.length && right.every((pass) => identities.has(passIdentity(pass)));
}

function routeBudgetsEqual(left: RouteBudget, right: RouteBudget): boolean {
  return (
    left.provider_turns === right.provider_turns &&
    left.equivalent_cost_usd === right.equivalent_cost_usd &&
    left.active_time_ms === right.active_time_ms &&
    left.human_decisions === right.human_decisions
  );
}

function assertRouteBudgetMonotonic(previous: RouteBudget, next: RouteBudget, episodeId: string): void {
  const decreased =
    next.provider_turns < previous.provider_turns ||
    next.equivalent_cost_usd + EQUIVALENT_COST_ARITHMETIC_TOLERANCE_USD < previous.equivalent_cost_usd ||
    next.active_time_ms < previous.active_time_ms ||
    nullableBudgetDecreased(previous.human_decisions, next.human_decisions);
  if (decreased) {
    throw new Error(
      `efficiency admission conflict for ${episodeId}: a plan revision cannot reduce route budget authority`,
    );
  }
}

function nullableBudgetDecreased(previous: number | null, next: number | null): boolean {
  if (previous === null) return next !== null;
  return next !== null && next < previous;
}

function factorIdentity(factor: AdmissionFactor): string {
  return `${factor.kind}\0${factor.policy_rule}\0${factor.evidence}`;
}

function mergeAdmissionFactors(existing: AdmissionFactor[], added: AdmissionFactor[]): AdmissionFactor[] {
  const merged = new Map(existing.map((factor) => [factorIdentity(factor), factor]));
  for (const factor of added) merged.set(factorIdentity(factor), factor);
  return sortedFactors([...merged.values()]);
}

function assertAuthorizedPassFactors(passes: AuthorizedPass[], factors: AdmissionFactor[], episodeId: string): void {
  const knownRules = new Set(factors.map((factor) => factor.policy_rule));
  for (const pass of passes) {
    if (pass.factor_rules.length === 0 || pass.factor_rules.some((rule) => !knownRules.has(rule))) {
      throw new Error(
        `efficiency admission for ${episodeId}: ${pass.pipeline}/${pass.pass} ` +
          `must map only to recorded factor rules`,
      );
    }
  }
}

function passIdentity(pass: AuthorizedPass): string {
  const normalized = normalizeAuthorizedPass(pass);
  return (
    `${normalized.pipeline}\0${normalized.pass}\0${normalized.role}\0${normalized.runtime}\0` +
    `${normalized.model}\0${normalized.effort}\0${JSON.stringify(metadataFromAuthorizedPass(normalized))}`
  );
}

function mergeAuthorizedPasses(existing: AuthorizedPass[], added: AuthorizedPass[]): AuthorizedPass[] {
  const merged = new Map(existing.map((pass) => [passIdentity(pass), pass]));
  for (const pass of added) {
    if (pass.factor_rules.length === 0) {
      throw new Error(`reassessment pass ${pass.pipeline}/${pass.pass} requires a factor rule`);
    }
    const normalized = normalizeAuthorizedPass(pass);
    merged.set(passIdentity(normalized), normalized);
  }
  return [...merged.values()].sort((a, b) => passIdentity(a).localeCompare(passIdentity(b)));
}

function sortedFactors(factors: AdmissionFactor[]): AdmissionFactor[] {
  return [...factors].sort((a, b) =>
    `${a.kind}\0${a.policy_rule}\0${a.evidence}`.localeCompare(`${b.kind}\0${b.policy_rule}\0${b.evidence}`),
  );
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function pendingProviderReservations(
  root: string,
  episodeId: string,
): Promise<{ receipts: StartedProviderReceipt[]; corrupt: string[] }> {
  const dir = join(efficiencyEpisodeDir(root, episodeId), "steps");
  if (!existsSync(dir)) return { receipts: [], corrupt: [] };
  const receipts: StartedProviderReceipt[] = [];
  const corrupt: string[] = [];
  for (const file of (await readdir(dir))
    .filter((name) => name.endsWith(".json.started") || name.endsWith(".json"))
    .sort()) {
    try {
      const value: unknown = JSON.parse(await readFile(join(dir, file), "utf8"));
      if (file.endsWith(".started")) {
        if (!isStartedProviderReceipt(value) || value.episode_id !== episodeId) {
          throw new Error("invalid provider reservation");
        }
        receipts.push(value);
      } else if (!isExecutionStepRecord(value) || value.episode_id !== episodeId) {
        throw new Error("invalid execution step");
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT" && file.endsWith(".started")) continue;
      corrupt.push(`corrupt:${file}`);
    }
  }
  return { receipts, corrupt };
}

async function acquireEpisodeReservationLock(root: string, episodeId: string): Promise<() => Promise<void>> {
  const path = join(efficiencyEpisodeDir(root, episodeId), ".provider-reservation.lock");
  await mkdir(join(efficiencyEpisodeDir(root, episodeId)), { recursive: true });
  const started = Date.now();
  while (true) {
    try {
      const handle = await open(path, "wx");
      try {
        await handle.writeFile(`${process.pid}\n${new Date().toISOString()}\n`, "utf8");
        await handle.close();
      } catch (error) {
        await handle.close().catch(() => {});
        await rm(path, { force: true }).catch(() => {});
        throw error;
      }
      return async () => rm(path, { force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (await reservationLockIsStale(path)) {
        await rm(path, { force: true }).catch(() => {});
        continue;
      }
      if (Date.now() - started >= 5_000) throw new Error(`provider reservation lock timed out: ${path}`);
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }
  }
}

async function reservationLockIsStale(path: string): Promise<boolean> {
  try {
    const [metadata, contents] = await Promise.all([stat(path), readFile(path, "utf8")]);
    const old = Date.now() - metadata.mtimeMs > 30_000;
    const pid = Number(contents.split("\n", 1)[0]);
    if (!Number.isInteger(pid) || pid <= 0) return old;
    try {
      process.kill(pid, 0);
      return false;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      return code === "ESRCH" || (code !== "EPERM" && old);
    }
  } catch {
    // Release can race this observation. A vanished/unreadable path means
    // retry O_EXCL acquisition; it does not authorize unlinking a successor's
    // newly-created lock.
    return false;
  }
}

function executionStatus(status: TurnResult["status"]): ExecutionStatus {
  return status === "blocked_on_gate" ? "blocked" : status;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function hasValidPreRouteEpisodeMarker(base: string): Promise<boolean> {
  for (const [file, valid] of [
    ["planner-admission.json", isValidPlannerAdmissionMarker],
    [
      "plan-current.json",
      (value: Record<string, unknown>) =>
        value.schemaVersion === 1 &&
        typeof value.episodeId === "string" &&
        Number.isSafeInteger(value.version) &&
        (value.version as number) > 0 &&
        typeof value.planHash === "string" &&
        /^[a-f0-9]{64}$/u.test(value.planHash) &&
        value.file === `plan-v${value.version as number}.json`,
    ],
  ] as const) {
    try {
      const value: unknown = JSON.parse(await readFile(join(base, file), "utf8"));
      if (isRecord(value) && valid(value)) return true;
    } catch {
      // A missing or malformed marker grants no exception from the historical
      // missing-route diagnostic. The marker's owning reader provides the
      // detailed corruption reason when the episode is resumed.
    }
  }
  return false;
}

function isValidPlannerAdmissionMarker(value: Record<string, unknown>): boolean {
  try {
    validateTurnAssignment(value.boot_assignment, "pre-route planner assignment");
  } catch {
    return false;
  }
  return (
    value.schema_version === 1 &&
    typeof value.episode_id === "string" &&
    value.episode_id.length > 0 &&
    typeof value.app === "string" &&
    value.app.length > 0 &&
    typeof value.admitted_at === "string" &&
    Number.isFinite(Date.parse(value.admitted_at)) &&
    typeof value.intent_hash === "string" &&
    /^[a-f0-9]{64}$/u.test(value.intent_hash) &&
    value.assignment_source === "configured" &&
    value.assignment_candidate_id === "configured" &&
    isRecord(value.budget)
  );
}

function isRouteRecord(value: unknown): value is RouteRecord {
  if (!isRecord(value)) return false;
  const routes = new Set<EfficiencyRoute>(["deterministic", "quick", "standard", "deep"]);
  const planAuthorityValid =
    (value.current_plan_version === undefined && value.current_plan_hash === undefined) ||
    (Number.isSafeInteger(value.current_plan_version) &&
      (value.current_plan_version as number) > 0 &&
      typeof value.current_plan_hash === "string" &&
      /^[a-f0-9]{64}$/u.test(value.current_plan_hash));
  return (
    value.schema_version === EFFICIENCY_SCHEMA_VERSION &&
    typeof value.episode_id === "string" &&
    typeof value.app === "string" &&
    typeof value.policy_version === "string" &&
    typeof value.admitted_at === "string" &&
    routes.has(value.planned_route as EfficiencyRoute) &&
    routes.has(value.current_route as EfficiencyRoute) &&
    (value.final_route === null || routes.has(value.final_route as EfficiencyRoute)) &&
    Array.isArray(value.factors) &&
    Array.isArray(value.authorized_passes) &&
    isRecord(value.budget) &&
    planAuthorityValid &&
    Array.isArray(value.reassessments) &&
    (value.terminal === null || isRecord(value.terminal))
  );
}

function isExecutionStepRecord(value: unknown): value is ExecutionStepRecord {
  if (!isRecord(value)) return false;
  const kind = value.kind;
  const providerIdentityValid =
    kind === "provider"
      ? typeof value.provider_turn_id === "string"
      : kind === "mechanical" && value.provider_turn_id === null;
  return (
    value.schema_version === EFFICIENCY_SCHEMA_VERSION &&
    typeof value.execution_step_id === "string" &&
    typeof value.episode_id === "string" &&
    typeof value.app === "string" &&
    typeof value.run_id === "string" &&
    providerIdentityValid &&
    typeof value.operation === "string" &&
    typeof value.started_at === "string" &&
    typeof value.finished_at === "string" &&
    typeof value.status === "string" &&
    typeof value.input_fingerprint === "string" &&
    hasValidOptionalProviderMetadata(value)
  );
}

function isStartedProviderReceipt(value: unknown): value is StartedProviderReceipt {
  return (
    isRecord(value) &&
    value.schema_version === EFFICIENCY_SCHEMA_VERSION &&
    value.kind === "provider" &&
    typeof value.execution_step_id === "string" &&
    typeof value.provider_turn_id === "string" &&
    typeof value.episode_id === "string" &&
    typeof value.app === "string" &&
    typeof value.run_id === "string" &&
    typeof value.operation === "string" &&
    typeof value.role === "string" &&
    typeof value.runtime === "string" &&
    typeof value.model === "string" &&
    typeof value.effort === "string" &&
    typeof value.started_at === "string" &&
    typeof value.input_fingerprint === "string" &&
    hasValidOptionalProviderMetadata(value)
  );
}

function hasValidOptionalProviderMetadata(value: Record<string, unknown>): boolean {
  try {
    normalizeProviderStepPlanMetadata(
      Object.fromEntries(
        PROVIDER_PLAN_METADATA_FIELDS.filter((field) => value[field] !== undefined).map((field) => [
          field,
          value[field],
        ]),
      ) as ProviderStepPlanMetadata,
      "persisted provider metadata",
    );
    normalizeProviderStepSettlementAttribution(
      Object.fromEntries(
        PROVIDER_SETTLEMENT_ATTRIBUTION_FIELDS.filter((field) => value[field] !== undefined).map((field) => [
          field,
          value[field],
        ]),
      ),
      "persisted provider settlement attribution",
    );
    return true;
  } catch {
    return false;
  }
}
