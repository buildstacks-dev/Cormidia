import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, readlinkSync } from "node:fs";
import { lstat, mkdir, open, readFile, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Effort, RoleConfig, RuntimeKind, TurnResult, TurnUsage } from "../runtime/types.js";
import type { TurnRecord } from "../runtime/telemetry.js";
import { writeLoopFileAtomic, writeLoopFileOnce } from "./durable.js";
import type { TicketTier } from "./pipelines.js";
import {
  assertMonotonicRoute,
  executionBoundsFor,
  type RouteExecutionBounds,
} from "./route-policy.js";

export const EFFICIENCY_SCHEMA_VERSION = 1 as const;
export type EfficiencyRoute = "deterministic" | TicketTier;

export interface RouteBudget {
  provider_turns: number;
  input_tokens: number | null;
  equivalent_cost_usd: number;
  active_time_ms: number;
  human_decisions: number | null;
}

export const ROUTE_BUDGETS: Readonly<Record<EfficiencyRoute, RouteBudget>> = {
  deterministic: {
    provider_turns: 0,
    input_tokens: 0,
    equivalent_cost_usd: 0,
    active_time_ms: 5 * 60_000,
    human_decisions: null,
  },
  quick: {
    provider_turns: 3,
    input_tokens: 2_000_000,
    equivalent_cost_usd: 8,
    active_time_ms: 20 * 60_000,
    human_decisions: 1,
  },
  standard: {
    provider_turns: 5,
    input_tokens: 4_000_000,
    equivalent_cost_usd: 15,
    active_time_ms: 45 * 60_000,
    human_decisions: null,
  },
  deep: {
    provider_turns: 8,
    input_tokens: null,
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
  reassessments: RouteReassessment[];
  terminal: EpisodeTerminal | null;
}

export type ExecutionStatus =
  | "completed"
  | "failed"
  | "blocked"
  | "cancelled"
  | "timed_out"
  | "interrupted";

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

export interface StartedProviderStep {
  executionStepId: string;
  providerTurnId: string;
  startedAt: Date;
  inputFingerprint: string;
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
  started_at: string;
  input_fingerprint: string;
  context_manifest_ref: string | null;
  /** Conservative allowance reserved before runtime construction. Older
   * receipts may omit it and are treated as a zero-quantity reservation. */
  reservation?: {
    input_tokens: number;
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
  reason?: string;
}

export class ProviderBudgetRefusalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderBudgetRefusalError";
  }
}

export function episodeIdFor(input: { app: string; ticket?: string; traceId: string }): string {
  return input.ticket === undefined
    ? `trace:${input.app}:${input.traceId}`
    : `ticket:${input.app}:${input.ticket}`;
}

export function efficiencyEpisodeDir(root: string, episodeId: string): string {
  return join(root, "efficiency", "episodes", sha256(episodeId).slice(0, 32));
}

export function routeRecordPath(root: string, episodeId: string): string {
  return join(efficiencyEpisodeDir(root, episodeId), "route.json");
}

export function executionStepPath(root: string, episodeId: string, stepId: string): string {
  return join(efficiencyEpisodeDir(root, episodeId), "steps", `${sha256(stepId)}.json`);
}

/** First writer fixes planned_route. Subsequent passes may prove that their
 * predeclared pass authorization was already included, but cannot rewrite it. */
export async function admitEpisode(input: RouteAdmissionInput): Promise<RouteRecord> {
  const path = routeRecordPath(input.root, input.episodeId);
  const validateExisting = async (): Promise<RouteRecord> => {
    const existing = await readRouteRecord(input.root, input.episodeId);
    if (existing.app !== input.app || existing.current_route !== input.route) {
      throw new Error(
        `efficiency admission conflict for ${input.episodeId}: current route is ` +
          `${existing.current_route}, requested ${input.route}`,
      );
    }
    const authorized = new Set(existing.authorized_passes.map(passIdentity));
    const missing = input.passes.filter((pass) => !authorized.has(passIdentity(pass)));
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
  for (const pass of input.passes) {
    if (pass.factor_rules.length === 0 || pass.factor_rules.some((rule) => !knownRules.has(rule))) {
      throw new Error(
        `efficiency admission for ${input.episodeId}: ${pass.pipeline}/${pass.pass} ` +
          `must map only to recorded factor rules`,
      );
    }
  }
  const budget = { ...ROUTE_BUDGETS[input.route], ...input.budgetOverrides };
  if (input.route === "deep" && budget.input_tokens === null) {
    throw new Error(`efficiency admission for ${input.episodeId}: deep input budget must be declared`);
  }
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
    authorized_passes: [...input.passes].sort((a, b) => passIdentity(a).localeCompare(passIdentity(b))),
    budget,
    execution_bounds: input.route === "deterministic" ? null : executionBoundsFor(input.route),
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
  const record = await readRouteRecord(input.root, input.episodeId);
  if (record.terminal !== null) throw new Error(`episode ${input.episodeId} is terminal`);
  assertMonotonicRoute(record.current_route, input.toRoute);
  const counters = await deriveEpisodeCounters(input.root, input.episodeId);
  const budget = { ...ROUTE_BUDGETS[input.toRoute], ...input.budgetOverrides };
  if (input.toRoute === "deep" && budget.input_tokens === null) {
    throw new Error(`episode ${input.episodeId}: deep input budget must be declared`);
  }
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
  const record = await readRouteRecord(input.root, input.episodeId);
  if (record.terminal !== null) {
    const same =
      record.terminal.status === input.status &&
      record.terminal.reason === input.reason &&
      record.terminal.next_step === (input.nextStep ?? null);
    if (!same) throw new Error(`episode ${input.episodeId} already has a different terminal record`);
    return record;
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
  next?: { inputTokens?: number; costUsd?: number; activeTimeMs?: number };
}): Promise<BudgetCheck> {
  const route = await readRouteRecord(input.root, input.episodeId);
  const counters = await deriveEpisodeCounters(input.root, input.episodeId);
  const pending = await pendingProviderReservations(input.root, input.episodeId);
  counters.provider_turns += pending.receipts.length + pending.corrupt.length;
  counters.input_tokens += pending.receipts.reduce(
    (sum, receipt) => sum + (receipt.reservation?.input_tokens ?? 0),
    0,
  );
  counters.equivalent_cost_usd += pending.receipts.reduce(
    (sum, receipt) => sum + (receipt.reservation?.equivalent_cost_usd ?? 0),
    0,
  );
  counters.active_time_ms += pending.receipts.reduce(
    (sum, receipt) => sum + (receipt.reservation?.active_time_ms ?? 0),
    0,
  );
  counters.partial_or_unavailable_steps.push(
    ...pending.receipts.map((receipt) => receipt.execution_step_id),
    ...pending.corrupt,
  );
  const checked = budgetCheck(route, counters, input.next);
  return pending.corrupt.length === 0
    ? checked
    : {
        ...checked,
        allowed: false,
        reason: "corrupt provider reservation prevents safe admission",
      };
}

export async function remainingExecutionAllowance(
  root: string,
  episodeId: string,
): Promise<{ activeTimeMs: number; providerTurns: number; toolCalls: number | null }> {
  const [budget, route, steps] = await Promise.all([
    checkProviderBudget({ root, episodeId }),
    readRouteRecord(root, episodeId),
    readExecutionSteps(root, episodeId),
  ]);
  const usedToolCalls = steps.reduce((sum, step) => sum + (step.tool_call_count ?? 0), 0);
  return {
    activeTimeMs: Math.max(0, budget.remaining.active_time_ms),
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
  next: { inputTokens?: number; costUsd?: number; activeTimeMs?: number } = {},
): BudgetCheck {
  const remaining: RouteBudget = {
    provider_turns: route.budget.provider_turns - counters.provider_turns,
    input_tokens:
      route.budget.input_tokens === null ? null : route.budget.input_tokens - counters.input_tokens,
    equivalent_cost_usd: route.budget.equivalent_cost_usd - counters.equivalent_cost_usd,
    active_time_ms: route.budget.active_time_ms - counters.active_time_ms,
    human_decisions:
      route.budget.human_decisions === null
        ? null
        : route.budget.human_decisions - counters.human_decisions,
  };
  const refusal =
    remaining.provider_turns < 1
      ? "provider-turn budget exhausted"
      : remaining.input_tokens !== null && (next.inputTokens ?? 0) > remaining.input_tokens
        ? "declared input-token allowance is insufficient"
        : (next.costUsd ?? 0) > remaining.equivalent_cost_usd
          ? "declared equivalent-cost allowance is insufficient"
          : (next.activeTimeMs ?? 0) > remaining.active_time_ms
            ? "declared active-time allowance is insufficient"
            : undefined;
  return {
    allowed: refusal === undefined,
    counters,
    remaining,
    ...(refusal !== undefined ? { reason: refusal } : {}),
  };
}

export async function beginProviderStep(input: {
  root: string;
  episodeId: string;
  app: string;
  runId: string;
  ordinal: number;
  operation: string;
  role: RoleConfig;
  inputFingerprint: string;
  now: Date;
  next?: { inputTokens?: number; costUsd?: number; activeTimeMs?: number };
}): Promise<StartedProviderStep> {
  const release = await acquireEpisodeReservationLock(input.root, input.episodeId);
  try {
    const budget = await checkProviderBudget({
      root: input.root,
      episodeId: input.episodeId,
      ...(input.next !== undefined ? { next: input.next } : {}),
    });
    if (!budget.allowed) {
      throw new ProviderBudgetRefusalError(
        `episode ${input.episodeId} cannot start ${input.operation}: ${budget.reason ?? "route budget exhausted"}`,
      );
    }
    const executionStepId = `${input.runId}:provider:${input.ordinal}`;
    const providerTurnId = sha256(`${input.episodeId}\0${executionStepId}`);
    const path = executionStepPath(input.root, input.episodeId, executionStepId);
    if (existsSync(path) || existsSync(`${path}.started`)) {
      throw new Error(`execution step ${executionStepId} already started or finalized`);
    }
    // A started receipt is the atomic budget reservation and is replaced by
    // the terminal record. Concurrent processes count it before admission.
    await writeLoopFileAtomic(
      `${path}.started`,
      `${JSON.stringify({
        schema_version: EFFICIENCY_SCHEMA_VERSION,
        execution_step_id: executionStepId,
        provider_turn_id: providerTurnId,
        episode_id: input.episodeId,
        app: input.app,
        run_id: input.runId,
        kind: "provider",
        operation: input.operation,
        role: input.role.name,
        runtime: input.role.runtime,
        model: input.role.model,
        effort: input.role.effort,
        started_at: input.now.toISOString(),
        input_fingerprint: input.inputFingerprint,
        context_manifest_ref: "context-manifest.json",
        reservation: {
          input_tokens: input.next?.inputTokens ?? 0,
          equivalent_cost_usd: input.next?.costUsd ?? 0,
          active_time_ms: input.next?.activeTimeMs ?? 0,
        },
      }, null, 2)}\n`,
    );
    return {
      executionStepId,
      providerTurnId,
      startedAt: input.now,
      inputFingerprint: input.inputFingerprint,
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
  const record: ExecutionStepRecord = {
    schema_version: EFFICIENCY_SCHEMA_VERSION,
    execution_step_id: input.started.executionStepId,
    episode_id: input.episodeId,
    app: input.app,
    run_id: input.runId,
    kind: "provider",
    provider_turn_id: input.started.providerTurnId,
    operation: input.operation,
    role: input.role.name,
    runtime: input.role.runtime,
    model: input.role.model,
    effort: input.role.effort,
    started_at: input.started.startedAt.toISOString(),
    finished_at: input.finishedAt.toISOString(),
    status: executionStatus(input.result.status),
    error_code: input.result.errorCode ?? null,
    reason: input.result.summary,
    next_step: input.result.status === "completed" ? null : "resume from the last valid artifact boundary",
    context_manifest_ref: input.contextManifestRef,
    input_fingerprint: input.started.inputFingerprint,
    work_fingerprint_before: input.workFingerprintBefore ?? null,
    work_fingerprint_after: input.workFingerprintAfter ?? null,
    artifact_fingerprint: input.artifactFingerprint ?? null,
    productive,
    repeated_from_step_id: repeated?.execution_step_id ?? null,
    tool_call_count: input.toolCallCount ?? 0,
    usage: input.result.usage,
  };
  const path = executionStepPath(input.root, input.episodeId, input.started.executionStepId);
  const release = await acquireEpisodeReservationLock(input.root, input.episodeId);
  try {
    await writeLoopFileAtomic(path, `${JSON.stringify(record, null, 2)}\n`);
    await rm(`${path}.started`, { force: true });
  } finally {
    await release();
  }
  return record;
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
}): Promise<ExecutionStepRecord> {
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
  return records.sort((a, b) => a.started_at.localeCompare(b.started_at) || a.execution_step_id.localeCompare(b.execution_step_id));
}

/** Read every Phase-1 evidence directory deterministically. Corrupt and
 * pending identities are returned, never silently treated as absent. */
export async function readEfficiencyEvidence(root: string): Promise<EfficiencyEpisodeEvidence[]> {
  const episodesDir = join(root, "efficiency", "episodes");
  if (!existsSync(episodesDir)) return [];
  const evidence: EfficiencyEpisodeEvidence[] = [];
  const episodeEntries = (await readdir(episodesDir, { withFileTypes: true }))
    .sort((a, b) => a.name.localeCompare(b.name));
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
    try {
      const value: unknown = JSON.parse(await readFile(join(base, "route.json"), "utf8"));
      if (!isRouteRecord(value)) throw new Error("invalid route schema");
      route = value;
    } catch {
      corrupt.push(join("efficiency", "episodes", directory, "route.json"));
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
    for (const receipt of episode.pending_started) {
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
  }
  return {
    finalized,
    inFlight: inFlight.sort(),
    corrupt: evidence.flatMap((episode) => episode.corrupt_files).sort(),
  };
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
  const missing = provider.filter((step) => (counts.get(step.provider_turn_id!) ?? 0) === 0).map((step) => step.execution_step_id);
  const duplicate = provider.filter((step) => (counts.get(step.provider_turn_id!) ?? 0) > 1).map((step) => step.execution_step_id);
  const mechanicalIds = new Set(steps.filter((step) => step.kind === "mechanical").map((step) => step.execution_step_id));
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

/** Content fingerprint of the authoritative git worktree state, including
 * tracked and untracked path/status changes. Unknown is explicit. */
export function worktreeFingerprint(workdir: string): string | undefined {
  try {
    const status = execFileSync(
      "git",
      ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
      {
        cwd: workdir,
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 5_000,
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      },
    );
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
    const untracked = execFileSync("git", ["ls-files", "--others", "--exclude-standard", "-z"], {
      cwd: workdir,
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5_000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    }).toString("utf8").split("\0").filter(Boolean).sort();
    const hash = createHash("sha256").update(head).update(status).update(trackedDiff);
    for (const relativePath of untracked) {
      const path = join(workdir, relativePath);
      const info = lstatSync(path);
      hash.update("\0untracked\0").update(relativePath).update("\0");
      if (info.isSymbolicLink()) hash.update("symlink\0").update(readlinkSync(path));
      else hash.update("file\0").update(readFileSync(path));
    }
    return hash.digest("hex");
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

function passIdentity(pass: AuthorizedPass): string {
  return `${pass.pipeline}\0${pass.pass}\0${pass.role}\0${pass.runtime}\0${pass.model}\0${pass.effort}`;
}

function mergeAuthorizedPasses(
  existing: AuthorizedPass[],
  added: AuthorizedPass[],
): AuthorizedPass[] {
  const merged = new Map(existing.map((pass) => [passIdentity(pass), pass]));
  for (const pass of added) {
    if (pass.factor_rules.length === 0) {
      throw new Error(`reassessment pass ${pass.pipeline}/${pass.pass} requires a factor rule`);
    }
    merged.set(passIdentity(pass), pass);
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

function isRouteRecord(value: unknown): value is RouteRecord {
  if (!isRecord(value)) return false;
  const routes = new Set<EfficiencyRoute>(["deterministic", "quick", "standard", "deep"]);
  return value.schema_version === EFFICIENCY_SCHEMA_VERSION &&
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
    Array.isArray(value.reassessments) &&
    (value.terminal === null || isRecord(value.terminal));
}

function isExecutionStepRecord(value: unknown): value is ExecutionStepRecord {
  if (!isRecord(value)) return false;
  const kind = value.kind;
  const providerIdentityValid =
    kind === "provider"
      ? typeof value.provider_turn_id === "string"
      : kind === "mechanical" && value.provider_turn_id === null;
  return value.schema_version === EFFICIENCY_SCHEMA_VERSION &&
    typeof value.execution_step_id === "string" &&
    typeof value.episode_id === "string" &&
    typeof value.app === "string" &&
    typeof value.run_id === "string" &&
    providerIdentityValid &&
    typeof value.operation === "string" &&
    typeof value.started_at === "string" &&
    typeof value.finished_at === "string" &&
    typeof value.status === "string" &&
    typeof value.input_fingerprint === "string";
}

function isStartedProviderReceipt(value: unknown): value is StartedProviderReceipt {
  return isRecord(value) &&
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
    typeof value.input_fingerprint === "string";
}
