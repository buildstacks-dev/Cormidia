// Pass executor (build plan M2.8; docs/loop/design.md §2, §4, §9, §10).
//
// Executes a loaded pipeline against a Runtime: fresh session per pass during
// ordinary execution; an approval decision may resume ONLY that same pass's
// content-bound native session (completed passes still communicate through
// durable artifacts and are never repeated); task = assembled brief + versioned pass template
// (§2); each provider pass resolves one atomic harness/model/effort assignment
// while the base RoleConfig remains the sole source of role identity and
// authority. Same-parallel_group passes run concurrently (§2 rule 4); the
// caller's role-shaped gate propagates unchanged to every call.
//
// Every pass leaves its full run record (§9 — "if something executes, its
// logs exist"): L1 envelope opened → updated → finalized, L2 pass events,
// L3 brief/output verbatim plus session.log fed by onEvent. This is what
// closes the "library nobody calls" gap: the writers aren't optional
// utilities, they are the executor's own discipline.
//
// The loop layer never imports src/org (one-way imports): role resolution
// arrives as a plain name→RoleConfig map, runtimes as a factory.

import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  buildTurnExecutionFacts,
  configuredProviderFamily,
  turnAssignmentsEqual,
  validateTurnAssignment,
  validateTurnExecutionFacts,
} from "../runtime/assignment.js";
import {
  hasRuntimeCapability,
  resolvedRuntimeCapabilities,
  runtimeCapabilityProfile,
  type RuntimeCapability,
  type RuntimeCapabilityProfile,
} from "../runtime/capabilities.js";
import { worstUsageQuality } from "../runtime/cost.js";
import { gitSnapshotOf } from "../runtime/git.js";
import { permissionModeFor } from "../runtime/permission-mode.js";
import {
  finalizeRun,
  startRun,
  updateEnvelope,
  type EnvelopeStatus,
  type EnvelopeUsage,
  type PlanningRouteEvidence,
  type SessionEvidence,
} from "../runtime/runlog/envelope.js";
import { createEventWriter, readEvents, type EventWriter } from "../runtime/runlog/events.js";
import { createSessionLogSink, writeBrief, writeOutput, writePrompt } from "../runtime/runlog/forensics.js";
import { mintRunId, RUN_ID_RE, runPaths } from "../runtime/runlog/paths.js";
import { recordTurnOnce, toRecord, type TriggerKind } from "../runtime/telemetry.js";
import { ZERO_USAGE } from "../runtime/turn-usage.js";
import {
  costEnforcementFor,
  ERROR_TURN_BUDGET_EXHAUSTED,
  ERROR_TURN_BUDGET_SUSPENDED,
  HardTurnBudget,
  type EpisodeAllowance,
  type TurnBudgetStop,
} from "../runtime/turn-budget.js";
import type {
  ContextBundle,
  RoleConfig,
  Runtime,
  TurnAssignment,
  TurnEvent,
  TurnHooks,
  TurnProgress,
  TurnResult,
  TurnUsage,
} from "../runtime/types.js";
import { withAuthorityBrief } from "./brief.js";
import { writeContextManifest } from "./context-manifest.js";
import { writeLoopFileAtomic } from "./durable.js";
import {
  admitEpisode,
  beginProviderStep,
  episodeIdFor,
  EQUIVALENT_COST_ARITHMETIC_TOLERANCE_USD,
  finalizeEpisode,
  finalizeProviderStep,
  fingerprint,
  ProviderBudgetRefusalError,
  remainingExecutionAllowance,
  worktreeFingerprint,
  type AdmissionFactor,
  type AuthorizedPass,
  type ProviderStepPlanMetadata,
  type RouteBudget,
  type StartedProviderStep,
} from "./efficiency.js";
import {
  parallelStages,
  selectPasses,
  type PassConfig,
  type PassSelection,
  type PipelineConfig,
  type TicketTier,
} from "./pipelines.js";
import { runPipelinePreflight, type PipelineArtifactExpectation } from "./preflight.js";
import type { LoopContinuation } from "./types.js";
import { definedProps } from "../runtime/optional-properties.js";

interface RunlogTarget {
  /** Org runtime home the runs/ tree lives under. */
  root: string;
  app: string;
  ticket?: string;
  /** turnId — one per pipeline execution; every pass's L2 trace_id. */
  traceId: string;
}

export interface ExecutePipelineOptions {
  pipeline: PipelineConfig;
  selection: PassSelection;
  /** Resolved role configs by name (the org layer resolves; loop consumes). */
  roles: Record<string, RoleConfig>;
  /** Legacy factory retained while callers migrate. The executor supplies a
   * selection-only RoleConfig whose runtime/model/effort equal the validated
   * atomic assignment; the TurnRequest still receives the base role. */
  runtimeFor: (role: RoleConfig) => Runtime;
  /** Assignment-aware factory. New adaptive callers should use this seam so
   * harness selection is explicit and cannot be inferred from a model id. */
  runtimeForAssignment?: (assignment: TurnAssignment, role: RoleConfig) => Runtime;
  /** Assembled brief per pass (src/loop/brief.ts is the usual producer). */
  briefFor: (pass: PassConfig) => string;
  /** Directory the pass templates live under (pipelines.yaml's sibling). */
  promptsDir: string;
  context: ContextBundle;
  /** Offline learning replay keeps the independently validated fixture brief
   * byte-exact; authority still arrives through native context and envelope.
   * Every live pipeline uses the default append behavior. */
  authorityBrief?: "append" | "context-only";
  workdir: string;
  /** Parent cancellation for the whole pipeline. */
  signal?: AbortSignal;
  /** Grace after abort for an adapter to return its final partial usage. */
  cancellationGraceMs?: number;
  /** Deadline for the first provider progress/event. Distinct from the full
   * pass wall-clock cap so auth/transport startup stalls fail quickly. */
  adapterStartTimeoutMs?: number;
  /** gate propagates unchanged to every pass; onEvent (when present) still
   *  fires after the executor's own session-log sink. */
  hooks: TurnHooks;
  /** Optional role-aware gate factory. Manual build-loop ticks use this to
   *  compose the critical-op gate with the durable approval store for the
   *  actual role running each pass. */
  /** The turn's gate, built per role AND per sandbox cwd. The cwd is passed
   *  by the executor that actually runs the pass, because a builder ticket
   *  pass runs in the per-ticket worktree while the caller that wires this
   *  callback only knows the managed clone — and an approval raised in one
   *  tree must never be executed in the other. */
  gateForRole?: (role: RoleConfig, workdir?: string) => TurnHooks["gate"];
  runlog: RunlogTarget;
  /** Stable caller-owned identity for a durable outer step. A retry may reuse
   * it only after reconciling prior terminal/pending evidence. */
  runIdForPass?: (pass: PassConfig) => string;
  /** Broader delegated task registered by the top-level operator harness. */
  parentTaskId?: string;
  planningRoute?: PlanningRouteEvidence;
  /** Optional caller-owned manifest written into every pass run before the
   * Runtime is constructed. A completed pass atomically advances the same
   * file to `completedContents`; failed/blocked passes retain the pending
   * selection so a reader never mistakes attempted context for consumption. */
  inputManifest?: {
    fileName: string;
    pendingContents: string;
    completedContents: string;
  };
  /** End-to-end route authority. Omitted callers get an explicit trace-scoped
   * admission; build-loop callers pass a ticket episode admitted by the
   * driver and keep it open across build/review/ship pipelines. */
  episode?: {
    id?: string;
    route?: PassSelection["tier"];
    policyVersion?: string;
    factors?: AdmissionFactor[];
    authorizedPasses?: AuthorizedPass[];
    budgetOverrides?: Partial<RouteBudget>;
    /** App-resolved static-route bounds. Accepted EpisodePlan routes use null
     * because the validated step DAG is their execution authority. */
    executionBounds?: import("./route-policy.js").RouteExecutionBounds | null;
    finalize?: boolean;
    nextTurnEstimate?: { costUsd?: number; activeTimeMs?: number };
    artifactExpectations?: PipelineArtifactExpectation[];
  };
  /** Token-free static adapter capability contract. Tests/isolated hosts may
   * inject narrower profiles; no runtime is constructed to answer it. */
  requiredCapabilities?: RuntimeCapability[];
  capabilityProfiles?: Partial<Record<RoleConfig["runtime"], RuntimeCapabilityProfile>>;
  /** Explicit, caller-owned context allowance. This is reserved for bounded
   * protocol probes whose payload size is itself the tested contract; normal
   * product episodes use the route cap. The chosen value remains visible in
   * the durable context manifest. */
  contextBudgetBytes?: number;
  /** Injected clock (FakeClock-compatible); defaults to the wall clock. */
  clock?: () => Date;
  /** Optional native structured-output schema per pass. */
  verdictSchemaFor?: (pass: PassConfig) => Record<string, unknown> | undefined;
  /** Explicit per-turn network grant; omitted/false keeps the sandbox offline. */
  networkAccess?: boolean;
  /** Ledger settlement target. Every provider invocation settles measured
   *  usage into `<orgDir>/telemetry/` exactly once, keyed by providerTurnId,
   *  when it returns — regardless of the parent pass/pipeline status. Failed,
   *  blocked, and aborted invocations consume budget too. Callers MUST NOT sum
   *  the pass envelope's aggregate usage into a second ledger row. */
  telemetry?: {
    orgDir: string;
    trigger?: TriggerKind;
    /** Learning-loop attribution (M5): stamped on every settled row so the
     *  learning budget overlay can roll replay spend up per experiment and
     *  per candidate. */
    experimentRef?: string;
    candidateRef?: string;
    learningActivity?: "distillation" | "review";
  };
  /** Runs after a pass completes and before the next sequential stage starts. */
  afterPass?: (record: PassRunRecord) => void | Promise<void>;
  /** Exact same-pass provider continuation after a durable approval decision.
   * Completed passes are not repeated; the paused pass resumes natively after
   * role/runtime/context/work fingerprints are revalidated. */
  continuation?: LoopContinuation;
  /** Claim-accounting commit point. Called after route admission and runtime
   * construction, immediately before the provider invocation (including a
   * resumed turn), never during selection/preflight. */
  beforeProviderTurn?: (input: { pipeline: string; pass: string; resumed: boolean }) => void | Promise<void>;
  /** Parse + record the pass's typed verdict, AFTER the turn and BEFORE the
   *  envelope is finalized. The loop layer owns verdict semantics (kinds,
   *  reformat retry, side effects); the executor only needs the ok/failed
   *  outcome so an unparseable verdict finalizes the pass as an infra failure
   *  (distinct error_code), never a merit outcome (docs/loop/design.md §6, §13 row
   *  11). `verdict.recorded` (§9) is emitted by the callback into the pass's
   *  own L2 writer. Never throws for a parse failure — it returns
   *  `{ok:false,…}` and the executor rethrows the typed error once the record
   *  is durable. */
  recordVerdict?: (ctx: VerdictRecordContext) => Promise<VerdictRecordOutcome>;
}

/** Everything the loop's verdict recorder needs, handed to it by the executor
 *  once the turn is done: the pass's run context plus the SAME runtime and
 *  hooks the turn used, so a reformat retry can resume the just-finished
 *  session (docs/loop/design.md §6). */
export interface VerdictRecordContext {
  pass: PassConfig;
  runId: string;
  result: TurnResult;
  /** The unchanged organizational role whose authority governs the turn. */
  role: RoleConfig;
  /** The exact indivisible tuple used by the parent and every repair turn. */
  assignment: TurnAssignment;
  /** The pass hooks (the conformance gate is preserved) for the reformat turn. */
  hooks: TurnHooks;
  workdir: string;
  context: ContextBundle;
  /** The pass's own L2 writer — `verdict.recorded` lands in this run record. */
  events: EventWriter;
  clock: () => Date;
  /** Any repair/reformat adapter invocation MUST use this wrapper so it gets
   * its own execution step, route-budget precheck, and exactly-one ledger
   * settlement instead of disappearing into the parent pass. */
  runProviderTurn: (request: {
    operation: string;
    task: string;
    session?: TurnResult["session"];
    verdictSchema?: Record<string, unknown>;
  }) => Promise<TurnResult>;
}

export type VerdictRecordOutcome =
  | {
      ok: true;
      extraUsage?: TurnUsage;
      /** Parsed merit outcome that is distinct from provider completion. */
      terminalStatus?: "blocked";
    }
  | { ok: false; errorCode: string; error: Error };

export interface PassRunRecord {
  pass: PassConfig;
  runId: string;
  result: TurnResult;
  assignment: TurnAssignment;
  planMetadata: ProviderStepPlanMetadata;
  contextFingerprint: string;
  workFingerprint: string | null;
}

export interface PipelineRunResult {
  /** Executed passes in completion-stage order. When a stage ends with any
   *  non-completed pass, later stages do not run (bounded, never silent —
   *  the ticket state machine owns remediation, §7). */
  passes: PassRunRecord[];
  aborted: boolean;
}

function remainingPasses(options: ExecutePipelineOptions, selected: PassConfig[]): PassConfig[] {
  const continuation = options.continuation;
  if (continuation === undefined) return selected;
  if (continuation.pipeline !== options.pipeline.name) {
    throw new Error(
      `pipeline continuation targets ${continuation.pipeline}/${continuation.pass}, not ${options.pipeline.name}`,
    );
  }
  const selectedIds = new Set(selected.map((pass) => pass.id));
  const pipelineIds = new Set(options.pipeline.passes.map((pass) => pass.id));
  if (!selectedIds.has(continuation.pass)) {
    throw new Error(`pipeline continuation pass ${continuation.pass} is not selected by the current route`);
  }
  for (const completed of continuation.completedPasses) {
    if (!pipelineIds.has(completed)) {
      throw new Error(`pipeline continuation completed-pass ${completed} is not in pipeline ${options.pipeline.name}`);
    }
  }
  const completed = new Set(continuation.completedPasses);
  const remaining = selected.filter((pass) => !completed.has(pass.id));
  if (remaining[0]?.id !== continuation.pass) {
    throw new Error(
      `pipeline continuation is not the next pass: expected ${remaining[0]?.id ?? "none"}, got ${continuation.pass}`,
    );
  }
  return remaining;
}

function continuationTask(continuation: LoopContinuation): string {
  const decisions = continuation.decisions.map((decision) => ({
    approval_id: decision.approvalId,
    decision: decision.decision,
    ...definedProps({ reason: decision.reason }),
    decided_at: decision.decidedAt,
  }));
  return [
    `Continue the existing ${continuation.pipeline}/${continuation.pass} provider session from its approval boundary.`,
    "Do not repeat completed analysis, setup, or implementation. Apply the recorded decision to the pending action,",
    "then finish the same pass and return its required structured verdict.",
    "",
    "Approval decisions (orchestrator-owned, exact):",
    JSON.stringify(decisions, null, 2),
  ].join("\n");
}

export async function executePipeline(options: ExecutePipelineOptions): Promise<PipelineRunResult> {
  if (
    options.adapterStartTimeoutMs !== undefined &&
    (!Number.isFinite(options.adapterStartTimeoutMs) || options.adapterStartTimeoutMs <= 0)
  ) {
    throw new Error(
      `executePipeline: adapterStartTimeoutMs must be positive; received ${options.adapterStartTimeoutMs}`,
    );
  }
  const clock = options.clock ?? ((): Date => new Date());
  const originallySelected = selectPasses(options.pipeline, options.selection);
  const selected = remainingPasses(options, originallySelected);
  const preflight = runPipelinePreflight({
    workdir: options.workdir,
    route: options.episode?.route ?? options.selection.tier,
    selectedPasses: selected,
    roles: options.roles,
    ...(options.pipeline.mechanical ? { allowNoProviderTurns: true } : {}),
    ...(options.episode?.authorizedPasses !== undefined
      ? {
          authorizedPasses: options.episode.authorizedPasses.filter((pass) => pass.pipeline === options.pipeline.name),
        }
      : {}),
    ...(options.episode?.budgetOverrides !== undefined ? { budgetOverrides: options.episode.budgetOverrides } : {}),
    requiredCapabilities: options.requiredCapabilities ?? ["tool_gate", "cancellation", "session_resume"],
    ...definedProps({ capabilityProfiles: options.capabilityProfiles }),
    ...(options.episode?.artifactExpectations !== undefined ? { artifacts: options.episode.artifactExpectations } : {}),
  });
  if (
    options.contextBudgetBytes !== undefined &&
    (!Number.isFinite(options.contextBudgetBytes) || options.contextBudgetBytes <= 0)
  ) {
    preflight.problems.push("explicit context budget is invalid");
    preflight.ok = false;
  }
  if (!preflight.ok) {
    throw new Error(`pipeline preflight failed before runtime construction: ${preflight.problems.join("; ")}`);
  }
  const stages = parallelStages(selected);
  const admission = await admitPipelineEpisode(options, clock(), stages.flat());
  const admittedOptions: ExecutePipelineOptions = {
    ...options,
    // Execute only the durable authorization returned by admission. This also
    // upgrades legacy implicit callers to one explicit atomic tuple per pass
    // without changing their public call shape.
    episode: {
      ...options.episode,
      id: admission.episode_id,
      // A reassessed route retains historical authorizations additively. Use
      // the caller's current-plan slice when supplied (admission just proved
      // every entry is durable); implicit callers use the newly admitted set.
      authorizedPasses: options.episode?.authorizedPasses ?? admission.authorized_passes,
    },
  };

  const records: PassRunRecord[] = [];
  try {
    for (const stage of stages) {
      if (options.signal?.aborted) {
        const stopped = { passes: records, aborted: true };
        await finalizePipelineEpisode(admittedOptions, stopped, clock());
        return stopped;
      }
      const stageController = new AbortController();
      const unlink = forwardAbort(options.signal, stageController);
      const stageOptions = { ...admittedOptions, signal: stageController.signal };
      const results = await Promise.all(
        stage.map(async (pass) => {
          const result = await runPass(pass, stageOptions, clock);
          if (result.result.status !== "completed" && !stageController.signal.aborted) {
            stageController.abort(`parallel stage stopped by ${pass.id}=${result.result.status}`);
          }
          return result;
        }),
      ).finally(unlink);
      records.push(...results);
      for (const record of results) await options.afterPass?.(record);
      if (results.some((r) => r.result.status !== "completed")) {
        const stopped = { passes: records, aborted: true };
        await finalizePipelineEpisode(admittedOptions, stopped, clock());
        return stopped;
      }
    }
    const completed = { passes: records, aborted: false };
    await finalizePipelineEpisode(admittedOptions, completed, clock());
    return completed;
  } catch (error) {
    if (admittedOptions.episode?.finalize !== false) {
      await finalizeEpisode({
        root: options.runlog.root,
        episodeId: admission.episode_id,
        status: "failed",
        reason: error instanceof Error ? error.message : String(error),
        nextStep: "resume from the last valid artifact boundary",
        now: clock(),
      });
    }
    throw error;
  }
}

async function admitPipelineEpisode(options: ExecutePipelineOptions, now: Date, selected: PassConfig[]) {
  const episodeId =
    options.episode?.id ??
    episodeIdFor({
      app: options.runlog.app,
      traceId:
        `${options.runlog.traceId}:${options.pipeline.name}:` +
        fingerprint(selected.map((pass) => pass.id)).slice(0, 12),
    });
  const route = options.episode?.route ?? options.selection.tier;
  const factors = options.episode?.factors ?? [
    {
      kind: "uncertainty" as const,
      evidence: `explicit ${route} route supplied by the invoking workflow`,
      policy_rule: "explicit_invocation_route",
    },
  ];
  const factorRules = factors.map((factor) => factor.policy_rule);
  const passes =
    options.episode?.authorizedPasses ??
    selected.map((pass): AuthorizedPass => {
      const role = options.roles[pass.role];
      if (role === undefined) throw new Error(`executePipeline: missing role ${pass.role}`);
      const assignment = validateTurnAssignment(
        {
          harness: role.runtime,
          model: role.model,
          effort: role.effort,
        },
        `${options.pipeline.name}/${pass.id} configured assignment`,
      );
      return {
        pipeline: options.pipeline.name,
        pass: pass.id,
        role: role.name,
        runtime: assignment.harness,
        model: assignment.model,
        effort: assignment.effort,
        factor_rules: factorRules,
      };
    });
  const configuredExecutionBounds = resolvedStaticExecutionBounds(options, route);
  return admitEpisode({
    root: options.runlog.root,
    episodeId,
    app: options.runlog.app,
    route,
    policyVersion: options.episode?.policyVersion ?? "efficiency/v1-explicit-route",
    factors,
    passes,
    now,
    ...(options.episode?.budgetOverrides !== undefined ? { budgetOverrides: options.episode.budgetOverrides } : {}),
    ...definedProps({ executionBounds: configuredExecutionBounds }),
  });
}

function resolvedStaticExecutionBounds(
  options: ExecutePipelineOptions,
  route: TicketTier,
): import("./route-policy.js").RouteExecutionBounds | null | undefined {
  if (options.episode?.executionBounds !== undefined) return options.episode.executionBounds;
  if (options.episode?.authorizedPasses?.some((pass) => pass.plan_version !== undefined)) {
    return undefined;
  }
  const configured = Object.values(options.roles)
    .map((role) => role.routeExecutionLimits?.[route])
    .filter((value): value is import("./route-policy.js").RouteExecutionBounds => value !== undefined);
  if (configured.length === 0) return undefined;
  const canonical = JSON.stringify(configured[0]);
  if (configured.some((value) => JSON.stringify(value) !== canonical)) {
    throw new Error("pipeline roles resolved inconsistent app route-execution limits");
  }
  return { ...configured[0]! };
}

async function finalizePipelineEpisode(
  options: ExecutePipelineOptions,
  result: PipelineRunResult,
  now: Date,
): Promise<void> {
  if (options.episode?.finalize === false || options.episode?.id === undefined) return;
  const last = result.passes.at(-1)?.result;
  const status =
    !result.aborted && result.passes.every((pass) => pass.result.status === "completed")
      ? "completed"
      : last?.status === "cancelled"
        ? "cancelled"
        : last?.status === "timed_out"
          ? "timed_out"
          : last?.status === "blocked_on_gate"
            ? "blocked"
            : "failed";
  await finalizeEpisode({
    root: options.runlog.root,
    episodeId: options.episode.id,
    status,
    reason: last?.summary ?? (status === "completed" ? "pipeline completed" : "pipeline stopped"),
    ...(status === "completed" ? {} : { nextStep: "resume from the last valid artifact boundary" }),
    now,
  });
}

const HEARTBEAT_INTERVAL_MS = 30_000;
/** Default per-pass wall-clock cap when pipelines.yaml sets none — matches
 *  the dispatcher's hung-turn default. */
const DEFAULT_PASS_WALL_CLOCK_MINUTES = 60;
const ERROR_WALL_CLOCK_EXCEEDED = "error_wall_clock_exceeded";
const ERROR_ADAPTER_START_TIMEOUT = "error_adapter_start_timeout";
const DEFAULT_ADAPTER_START_TIMEOUT_MS = 30_000;

// Long enough for adapters to terminate their owned process/session tree and
// return the last provider checkpoint; still bounded so a broken adapter
// cannot hold finalization indefinitely.
const DEFAULT_CANCELLATION_GRACE_MS = 2_000;

interface AbortDescriptor {
  status: "cancelled" | "timed_out" | "failed";
  errorCode: string;
  reason: string;
}

interface TurnOutcome {
  result?: TurnResult;
  error?: unknown;
}

async function runOwnedTurn(options: {
  runtime: Runtime;
  request: Parameters<Runtime["runTurn"]>[0];
  hooks: TurnHooks;
  signal: AbortSignal;
  assignment: TurnAssignment;
  passId: string;
  graceMs: number;
  latestProgress: () => TurnProgress | undefined;
}): Promise<TurnResult> {
  if (options.signal.aborted) {
    return stoppedResult(
      abortDescriptor(options.signal.reason),
      options.assignment.harness,
      options.passId,
      options.latestProgress(),
    );
  }

  const outcome: Promise<TurnOutcome> = Promise.resolve()
    .then(() => options.runtime.runTurn(options.request, options.hooks))
    .then(
      (result): TurnOutcome => ({ result }),
      (error: unknown): TurnOutcome => ({ error }),
    );
  const aborted = abortPromise(options.signal);
  const first = await Promise.race([outcome, aborted]);
  if ("result" in first && first.result !== undefined) return first.result;
  if ("error" in first) {
    return failedResult(first.error, options.assignment.harness, options.passId, options.latestProgress());
  }

  const descriptor = abortDescriptor(options.signal.reason);
  const settledDuringGrace = await Promise.race([
    outcome.then((value) => ({ value })),
    delay(options.graceMs).then(() => ({ value: undefined })),
  ]);
  void outcome.then(() => {});
  return stoppedResult(
    descriptor,
    options.assignment.harness,
    options.passId,
    options.latestProgress(),
    settledDuringGrace.value?.result,
  );
}

function capabilityProfileFor(options: ExecutePipelineOptions, assignment: TurnAssignment): RuntimeCapabilityProfile {
  const profile = options.capabilityProfiles?.[assignment.harness] ?? runtimeCapabilityProfile(assignment.harness);
  if (profile.runtime !== assignment.harness) {
    throw new Error(
      `executePipeline: capability profile ${profile.runtime} does not match ` + `${assignment.harness} assignment`,
    );
  }
  for (const capability of options.requiredCapabilities ?? []) {
    if (!hasRuntimeCapability(profile, capability)) {
      throw new Error(`executePipeline: ${assignment.harness} assignment lacks required capability ${capability}`);
    }
  }
  return profile;
}

function contextWithExecution(
  context: ContextBundle,
  assignment: TurnAssignment,
  role: RoleConfig,
  requiredCapabilities: RuntimeCapability[],
): ContextBundle {
  const execution = buildTurnExecutionFacts(assignment, role, requiredCapabilities);
  if (context.execution !== undefined) {
    const supplied = validateTurnExecutionFacts(context.execution, "pipeline context execution facts");
    if (JSON.stringify(supplied) !== JSON.stringify(execution)) {
      throw new Error("executePipeline: caller-supplied execution facts disagree with the authorized assignment");
    }
  }
  return {
    ...context,
    execution,
  };
}

function validateContinuationAssignment(
  continuation: LoopContinuation,
  role: RoleConfig,
  assignment: TurnAssignment,
  planMetadata: ProviderStepPlanMetadata,
): void {
  if (continuation.role !== role.name || continuation.session.runtime !== assignment.harness) {
    throw new Error(
      `pipeline continuation role/runtime changed: ${continuation.role}/${continuation.session.runtime} ` +
        `-> ${role.name}/${assignment.harness}`,
    );
  }

  if (continuation.assignment !== undefined) {
    const persisted = validateTurnAssignment(continuation.assignment, "pipeline continuation assignment");
    if (!turnAssignmentsEqual(persisted, assignment)) {
      throw new Error("pipeline continuation assignment changed; resume the persisted tuple or create a plan revision");
    }
  }

  const persistedHasPlan = continuation.planVersion !== undefined || continuation.planStepId !== undefined;
  const currentHasPlan = planMetadata.plan_version !== undefined || planMetadata.plan_step_id !== undefined;
  if (
    (persistedHasPlan && (continuation.planVersion === undefined || continuation.planStepId === undefined)) ||
    (currentHasPlan && (planMetadata.plan_version === undefined || planMetadata.plan_step_id === undefined))
  ) {
    throw new Error("pipeline continuation has incomplete plan identity");
  }
  if (
    persistedHasPlan !== currentHasPlan ||
    (persistedHasPlan &&
      (continuation.planVersion !== planMetadata.plan_version || continuation.planStepId !== planMetadata.plan_step_id))
  ) {
    throw new Error("pipeline continuation plan version/step changed; resume from the persisted accepted plan");
  }
}

function constructRuntimeForAssignment(
  options: ExecutePipelineOptions,
  assignment: TurnAssignment,
  role: RoleConfig,
): Runtime {
  if (options.runtimeForAssignment !== undefined) {
    return options.runtimeForAssignment(assignment, role);
  }
  // Compatibility only: use the tuple as a selection view for existing
  // `getRuntime(role.runtime)` factories. It is never passed to the adapter,
  // gate, tool shaper, or verdict recorder as the role's authority.
  return options.runtimeFor({
    ...role,
    runtime: assignment.harness,
    model: assignment.model,
    effort: assignment.effort,
  });
}

async function runPass(pass: PassConfig, options: ExecutePipelineOptions, clock: () => Date): Promise<PassRunRecord> {
  const base = options.roles[pass.role];
  if (base === undefined) {
    throw new Error(
      `executePipeline: pass "${pass.id}" needs role "${pass.role}" but the roles map ` +
        `defines: ${Object.keys(options.roles).join(", ")}`,
    );
  }
  const authorizedMatches = options.episode?.authorizedPasses?.filter(
    (candidate) => candidate.pipeline === options.pipeline.name && candidate.pass === pass.id,
  );
  if (authorizedMatches !== undefined && authorizedMatches.length !== 1) {
    throw new Error(
      `executePipeline: ${options.pipeline.name}/${pass.id} requires exactly one route authorization; ` +
        `found ${authorizedMatches.length}`,
    );
  }
  const authorized = authorizedMatches?.[0];
  if (authorized !== undefined && authorized.role !== base.name) {
    throw new Error(
      `executePipeline: route authorization for ${options.pipeline.name}/${pass.id} changes role ` +
        `${base.name} -> ${authorized.role}`,
    );
  }
  const assignment = validateTurnAssignment(
    authorized === undefined
      ? {
          harness: base.runtime,
          model: base.model,
          effort: base.effort,
        }
      : {
          harness: authorized.runtime,
          model: authorized.model,
          effort: authorized.effort,
        },
    `${options.pipeline.name}/${pass.id} authorized assignment`,
  );
  // Responsibility and authority remain bound to this unchanged role. Model,
  // effort, and harness travel separately as one TurnAssignment.
  const role = base;
  capabilityProfileFor(options, assignment);
  const resolvedCapabilities = resolvedRuntimeCapabilities(assignment.harness);
  if (authorized?.resolved_capabilities !== undefined) {
    const claimed = [...authorized.resolved_capabilities].sort();
    if (JSON.stringify(claimed) !== JSON.stringify(resolvedCapabilities)) {
      throw new Error(
        `executePipeline: resolved capabilities for ${options.pipeline.name}/${pass.id} changed; ` +
          "persist a plan revision before execution",
      );
    }
  }
  const planMetadata: ProviderStepPlanMetadata = {
    assignment_source: authorized?.assignment_source ?? "configured",
    ...(authorized?.assignment_candidate_id !== undefined
      ? { assignment_candidate_id: authorized.assignment_candidate_id }
      : {}),
    ...(authorized?.plan_version !== undefined
      ? { plan_version: authorized.plan_version, plan_step_id: authorized.plan_step_id }
      : {}),
    selection_reason: authorized?.selection_reason ?? "resolved from the configured pipeline pass and role",
    provider_family: authorized?.provider_family ?? configuredProviderFamily(assignment),
    resolved_capabilities: resolvedCapabilities,
  };
  const continuation = options.continuation?.pass === pass.id ? options.continuation : undefined;
  if (continuation !== undefined) {
    validateContinuationAssignment(continuation, role, assignment, planMetadata);
  }
  const requiredCapabilities = options.requiredCapabilities ?? ["tool_gate", "cancellation", "session_resume"];
  const executionContext = contextWithExecution(options.context, assignment, role, requiredCapabilities);
  const selectedPasses = selectPasses(options.pipeline, options.selection);
  const selectedIds = new Set(selectedPasses.map((candidate) => candidate.id));

  const { root, app, ticket, traceId } = options.runlog;
  const episodeId = options.episode?.id;
  if (episodeId === undefined) throw new Error("executePipeline: episode admission missing");
  const runId =
    options.runIdForPass?.(pass) ??
    mintRunId(
      clock(),
      options.pipeline.name,
      continuation === undefined
        ? pass.id
        : `${pass.id}-resume-${fingerprint({
            session: continuation.session,
            decisions: continuation.decisions,
          }).slice(0, 10)}`,
    );
  if (!RUN_ID_RE.test(runId)) {
    throw new Error(`executePipeline: caller-owned run id ${JSON.stringify(runId)} is not a valid runlog id`);
  }
  const rawBrief = options.briefFor(pass);
  const brief = options.authorityBrief === "context-only" ? rawBrief : withAuthorityBrief(rawBrief, executionContext);
  // template "" = brief-only task. Only a synthesized pipeline can carry it
  // (runRole's plain turn) — the loader rejects empty templates in config.
  const template = pass.template === "" ? undefined : await readFile(join(options.promptsDir, pass.template), "utf8");
  const inputManifestRef =
    options.inputManifest === undefined ? undefined : validateInputManifestFileName(options.inputManifest.fileName);

  // Replay seed (learning design §9.4): captured while the episode runs,
  // never reconstructed from logs afterward. Absent for non-git workdirs.
  const git = gitSnapshotOf(options.workdir);
  await startRun(
    root,
    {
      runId,
      traceId,
      episodeId,
      providerTurnIds: [],
      executionStepIds: [],
      ...definedProps({ parentTaskId: options.parentTaskId }),
      app,
      ...definedProps({ ticket }),
      pipeline: options.pipeline.name,
      pass: pass.id,
      role: role.name,
      runtime: assignment.harness,
      model: assignment.model,
      effort: assignment.effort,
      ...definedProps({ assignmentSource: planMetadata.assignment_source }),
      ...definedProps({ assignmentCandidateId: planMetadata.assignment_candidate_id }),
      ...(planMetadata.plan_version !== undefined
        ? {
            planVersion: planMetadata.plan_version,
            planStepId: planMetadata.plan_step_id,
          }
        : {}),
      ...definedProps({ selectionReason: planMetadata.selection_reason }),
      resolvedCapabilities,
      workdir: resolve(options.workdir),
      ...(git !== undefined ? { gitHead: git.head, gitBranch: git.branch } : {}),
      tracePlan: {
        required_passes: selectedPasses.map((candidate) => candidate.id),
        skipped_passes: options.pipeline.passes
          .filter((candidate) => !selectedIds.has(candidate.id))
          .map((candidate) => ({
            pass: candidate.id,
            reason: "not selected by the active tier/trigger routing policy",
          })),
      },
      ...definedProps({ planningRoute: options.planningRoute }),
      ...definedProps({ inputManifestRef }),
      ...(executionContext.authority !== undefined
        ? {
            authority: {
              profile: executionContext.authority.profile,
              version: executionContext.authority.version,
              sha256: executionContext.authority.sha256,
              sources: [...executionContext.authority.sources],
            },
          }
        : {}),
    },
    clock(),
  );
  let runFinalized = false;
  try {
    if (options.inputManifest !== undefined && inputManifestRef !== undefined) {
      await writeLoopFileAtomic(
        join(runPaths(root, app, runId).dir, inputManifestRef),
        options.inputManifest.pendingContents,
      );
    }
    const contextManifest = await writeContextManifest({
      root,
      episodeId,
      app,
      runId,
      context: executionContext,
      brief,
      ...definedProps({ template }),
      route: options.episode?.route ?? options.selection.tier,
      runtime: assignment.harness,
      ...(planMetadata.plan_version !== undefined
        ? {
            planVersion: planMetadata.plan_version,
            planStepId: planMetadata.plan_step_id,
          }
        : {}),
      ...definedProps({ capBytes: options.contextBudgetBytes }),
    });
    const executableContext = contextManifest.context;
    const executableBrief = contextManifest.brief;
    const executableTemplate = contextManifest.template;
    const originalTask =
      executableTemplate === undefined ? executableBrief : `${executableBrief}\n\n---\n\n${executableTemplate}`;
    const currentWorkFingerprint = worktreeFingerprint(options.workdir) ?? null;
    if (continuation !== undefined && continuation.contextFingerprint !== contextManifest.manifest.render_sha256) {
      throw new Error(
        `pipeline continuation context changed for ${options.pipeline.name}/${pass.id}; ` +
          "start a new explicitly authorized claim instead of resuming the old session",
      );
    }
    if (continuation !== undefined && continuation.workFingerprint !== currentWorkFingerprint) {
      throw new Error(
        `pipeline continuation worktree changed for ${options.pipeline.name}/${pass.id}; ` +
          "inspect the durable work and explicitly re-arm",
      );
    }
    const task = continuation === undefined ? originalTask : continuationTask(continuation);
    await Promise.all([writeBrief(root, app, runId, executableBrief), writePrompt(root, app, runId, task)]);
    await updateEnvelope(root, app, runId, {
      contextManifestRef: contextManifest.relativeRef,
    });

    const events = createEventWriter(
      root,
      {
        runId,
        trace_id: traceId,
        span_id: pass.id,
        app,
        ...definedProps({ ticket }),
        pipeline: options.pipeline.name,
        pass: pass.id,
        role: role.name,
        model: assignment.model,
      },
      clock,
    );
    await events.append({ type: "run.started" });
    await events.append({ type: "pass.started" });

    const sessionLog = createSessionLogSink(root, app, runId);
    // The harness fires TurnEvents synchronously via onEvent; L2 appends are
    // async. We buffer the tool/subagent events during the turn and flush them
    // to L2 in order afterward (§9: fan-out trees reconstruct without opening
    // transcripts). session.log still receives every event live.
    const bridged: TurnEvent[] = [];
    let latestProgress: TurnProgress | undefined;
    let checkpointWrites = Promise.resolve();
    let adapterStarted = false;
    let adapterStartTimer: NodeJS.Timeout | undefined;
    const markAdapterStarted = (): void => {
      if (adapterStarted) return;
      adapterStarted = true;
      if (adapterStartTimer !== undefined) clearTimeout(adapterStartTimer);
      adapterStartTimer = undefined;
    };
    const passController = new AbortController();
    let providerToolCalls = 0;
    let toolCallAllowance: number | null = null;
    let activeBudget: HardTurnBudget | undefined;
    let queuedBudgetStop: TurnBudgetStop | undefined;
    const baseGate = options.gateForRole?.(role, options.workdir) ?? options.hooks.gate;
    const queueBudgetStop = (stop: TurnBudgetStop | undefined): void => {
      if (stop === undefined || queuedBudgetStop !== undefined) return;
      queuedBudgetStop = stop;
      checkpointWrites = checkpointWrites.then(async () => {
        await Promise.all([
          updateEnvelope(root, app, runId, { budgetStop: stop }),
          events.append({
            type: "turn.budget_stopped",
            severity: "warn",
            errorCode: stop.ring === "per_turn" ? ERROR_TURN_BUDGET_SUSPENDED : ERROR_TURN_BUDGET_EXHAUSTED,
            detail: {
              dimension: stop.dimension,
              cap: stop.cap,
              observed: stop.observed,
              prevented_next_action: stop.prevented_next_action,
              cost_measurement: stop.cost_measurement,
              ring: stop.ring,
              ...(stop.episode_remaining === null ? {} : { episode_remaining: stop.episode_remaining }),
            },
          }),
        ]);
      });
    };
    const passHooks: TurnHooks = {
      // The pass runs in options.workdir — for a builder ticket pass that is
      // the per-ticket worktree, not the managed clone. The gate records this
      // cwd on any approval it raises, so a later orchestrator execution runs
      // in the tree the human approved the action for.
      gate: (action) => {
        if (activeBudget === undefined) {
          return {
            allow: false,
            escalate: false,
            reason: "hard turn budget is not initialized before tool admission",
          };
        }
        const decision = activeBudget.admitTool(action, baseGate);
        providerToolCalls = activeBudget.toolActions;
        queueBudgetStop(activeBudget.stop);
        return decision;
      },
      onEvent: (e) => {
        markAdapterStarted();
        sessionLog(e);
        if (e.type === "tool_use" || e.type === "subagent") bridged.push(e);
        options.hooks.onEvent?.(e);
      },
      onProgress: (progress) => {
        markAdapterStarted();
        latestProgress = mergeProgress(latestProgress, progress);
        if (progress.usage !== undefined) {
          queueBudgetStop(activeBudget?.observeUsage(progress.usage));
        }
        if (latestProgress.usage !== undefined || latestProgress.session !== undefined) {
          const usage =
            latestProgress.usage !== undefined
              ? toEnvelopeUsage(latestProgress.usage, latestProgress.usage.quality ?? "partial")
              : undefined;
          checkpointWrites = checkpointWrites.then(() =>
            updateEnvelope(root, app, runId, {
              ...definedProps({ usage }),
              ...(latestProgress?.session !== undefined ? { session: sessionEvidence(latestProgress.session) } : {}),
              lastSeenAt: progress.at ?? clock().toISOString(),
            }).then(() => undefined),
          );
        }
        options.hooks.onProgress?.(progress);
      },
    };

    // Runtime construction is lazy inside runProviderTurn, after durable route
    // admission, a context manifest, and the per-turn remaining-budget check.
    let runtime: Runtime | undefined;
    let providerOrdinal = 0;
    const providerResults: TurnResult[] = [];
    const verdictSchema = options.verdictSchemaFor?.(pass);

    // Heartbeat: stamp both the envelope and the append-only event stream while
    // the provider turn runs. Status readers use last_seen_at; a live tail uses
    // pass.heartbeat. Failures are swallowed: observability must never kill the
    // turn it observes.
    const heartbeat = setInterval(() => {
      checkpointWrites = checkpointWrites.then(async () => {
        const observedAt = clock().toISOString();
        await Promise.allSettled([
          updateEnvelope(root, app, runId, { lastSeenAt: observedAt }),
          events.append({ type: "pass.heartbeat", detail: { observed_at: observedAt } }),
        ]);
      });
    }, HEARTBEAT_INTERVAL_MS);
    heartbeat.unref?.();

    // Wall-clock watchdog now aborts the owned provider session instead of
    // abandoning it. The adapter receives the same signal and has a bounded
    // grace period to return partial usage before finalization.
    const allowance = await remainingExecutionAllowance(root, episodeId);
    toolCallAllowance = minNullable(allowance.toolCalls, role.turnExecutionLimits?.toolCalls ?? null);
    const configuredCapMs = Math.min(
      (pass.wallClockMinutes ?? DEFAULT_PASS_WALL_CLOCK_MINUTES) * 60_000,
      role.turnExecutionLimits?.activeTimeMs ?? Number.POSITIVE_INFINITY,
    );
    const capMs = Math.min(configuredCapMs, allowance.activeTimeMs);
    const modelTurns = minNullable(pass.maxTurns ?? null, role.turnExecutionLimits?.modelTurns ?? null);
    const unlinkParent = forwardAbort(options.signal, passController);
    const timeout =
      capMs <= 0
        ? undefined
        : setTimeout(() => {
            if (activeBudget !== undefined) {
              queueBudgetStop(activeBudget.stopActiveTime(capMs));
            } else {
              passController.abort({
                status: "timed_out",
                errorCode: ERROR_WALL_CLOCK_EXCEEDED,
                reason: `pass "${pass.id}" exceeded its ${Math.round(capMs / 60_000)}-minute wall-clock cap`,
              } satisfies AbortDescriptor);
            }
          }, capMs);
    timeout?.unref?.();
    const adapterStartTimeoutMs = options.adapterStartTimeoutMs ?? DEFAULT_ADAPTER_START_TIMEOUT_MS;
    const runProviderTurn = async (request: {
      operation: string;
      task: string;
      session?: TurnResult["session"];
      verdictSchema?: Record<string, unknown>;
    }): Promise<TurnResult> => {
      if (capMs <= 0) {
        const effectiveBounds = {
          provider_turns: allowance.providerTurns,
          equivalent_cost_usd: allowance.equivalentCostUsd,
          tool_calls: toolCallAllowance,
          active_time_ms: 0,
          model_turns: modelTurns,
          cost_enforcement: costEnforcementFor(assignment.harness),
          equivalent_cost_reserve_usd: 0,
          permission_mode: permissionModeFor(assignment.harness, role.permissionModes),
          configuration_ref: `apps.yaml#apps.${app}.execution`,
        } as const;
        activeBudget = new HardTurnBudget({
          bounds: effectiveBounds,
          abort: (reason) => {
            if (!passController.signal.aborted) passController.abort(reason);
          },
          now: clock,
          initialToolActions: providerToolCalls,
          episodeAllowance: episodeAllowanceFor(allowance),
        });
        await updateEnvelope(root, app, runId, { effectiveBounds });
        queueBudgetStop(activeBudget.stopActiveTime(0));
        await checkpointWrites;
        return activeBudget.normalizeResult({
          status: "failed",
          summary: "Hard turn budget refused provider construction: no active-time allowance remains.",
          artifacts: [],
          session: { runtime: assignment.harness, id: `turn-budget-${pass.id}` },
          usage: unavailableUsage(),
          escalations: [],
        });
      }
      if (providerOrdinal > 0 && planMetadata.plan_version !== undefined) {
        throw new Error(
          `accepted EpisodePlan step ${planMetadata.plan_step_id ?? pass.id} authorizes one provider turn; ` +
            `operation ${request.operation} requires an explicit future step or plan revision`,
        );
      }
      const ordinal = (providerOrdinal += 1);
      const toolCallStart = providerToolCalls;
      const inputFingerprint = fingerprint({
        operation: request.operation,
        role: { name: role.name },
        assignment,
        plan: {
          version: planMetadata.plan_version ?? null,
          step: planMetadata.plan_step_id ?? null,
        },
        task: request.task,
        context: contextManifest.manifest.render_sha256,
        session: request.session?.id ?? null,
      });
      const started = await beginProviderStep({
        root,
        episodeId,
        app,
        runId,
        ordinal,
        operation: request.operation,
        role,
        assignment,
        planMetadata,
        settlementAttribution: {
          ...(options.telemetry?.experimentRef === undefined
            ? {}
            : { experiment_ref: options.telemetry.experimentRef }),
          ...(options.telemetry?.candidateRef === undefined ? {} : { candidate_ref: options.telemetry.candidateRef }),
          ...(options.telemetry?.learningActivity === undefined
            ? {}
            : { learning_activity: options.telemetry.learningActivity }),
        },
        inputFingerprint,
        now: clock(),
        ...(options.episode?.nextTurnEstimate !== undefined ? { next: options.episode.nextTurnEstimate } : {}),
      });
      const admittedRole: RoleConfig =
        started.reservation.equivalentCostUsd === role.maxTurnBudgetUsd
          ? role
          : { ...role, maxTurnBudgetUsd: started.reservation.equivalentCostUsd };
      const effectiveBounds = {
        provider_turns: allowance.providerTurns,
        equivalent_cost_usd: started.reservation.equivalentCostUsd,
        tool_calls: toolCallAllowance,
        active_time_ms: capMs,
        model_turns: modelTurns,
        cost_enforcement: costEnforcementFor(assignment.harness),
        equivalent_cost_reserve_usd: started.reservation.equivalentCostUsd,
        permission_mode: permissionModeFor(assignment.harness, role.permissionModes),
        configuration_ref: `apps.yaml#apps.${app}.execution`,
      } as const;
      activeBudget = new HardTurnBudget({
        bounds: effectiveBounds,
        abort: (reason) => {
          if (!passController.signal.aborted) passController.abort(reason);
        },
        now: clock,
        initialToolActions: providerToolCalls,
        episodeAllowance: episodeAllowanceFor(allowance),
      });
      await updateEnvelope(root, app, runId, {
        providerTurnIds: [started.providerTurnId],
        executionStepIds: [started.executionStepId],
        effectiveBounds,
      });
      const before = worktreeFingerprint(options.workdir);
      let turnResult: TurnResult;
      adapterStarted = false;
      adapterStartTimer = setTimeout(() => {
        passController.abort({
          status: "failed",
          errorCode: ERROR_ADAPTER_START_TIMEOUT,
          reason:
            `pass "${pass.id}" received no provider progress or event within ` +
            `${adapterStartTimeoutMs}ms of adapter start`,
        } satisfies AbortDescriptor);
      }, adapterStartTimeoutMs);
      adapterStartTimer.unref?.();
      try {
        runtime ??= constructRuntimeForAssignment(options, assignment, admittedRole);
        if (runtime.kind !== assignment.harness) {
          throw new Error(
            `executePipeline: runtime factory returned ${runtime.kind} for ${assignment.harness} assignment; ` +
              "no provider turn was started",
          );
        }
        if (!passController.signal.aborted) {
          await options.beforeProviderTurn?.({
            pipeline: options.pipeline.name,
            pass: pass.id,
            resumed: request.session !== undefined,
          });
        }
        turnResult = await runOwnedTurn({
          runtime,
          request: {
            role: admittedRole,
            assignment,
            workdir: options.workdir,
            task: request.task,
            context: executableContext,
            signal: passController.signal,
            ...definedProps({ session: request.session }),
            ...definedProps({ verdictSchema: request.verdictSchema }),
            ...(modelTurns !== null ? { maxTurns: modelTurns } : {}),
            ...(options.networkAccess === true ? { networkAccess: true } : {}),
          },
          hooks: passHooks,
          signal: passController.signal,
          assignment,
          passId: pass.id,
          graceMs: options.cancellationGraceMs ?? DEFAULT_CANCELLATION_GRACE_MS,
          latestProgress: () => latestProgress,
        });
      } catch (error) {
        turnResult = failedResult(error, assignment.harness, pass.id, latestProgress);
      } finally {
        if (adapterStartTimer !== undefined) clearTimeout(adapterStartTimer);
        adapterStartTimer = undefined;
      }
      if (turnResult.errorCode === "error_max_budget_usd") {
        queueBudgetStop(activeBudget.observeUsage(turnResult.usage));
      }
      turnResult = activeBudget.normalizeResult(turnResult);
      queueBudgetStop(activeBudget.stop);
      turnResult = enforceEquivalentCostReservation({
        episodeId,
        operation: request.operation,
        started,
        result: turnResult,
      });
      // Persist the provider result on the parent run before publishing the
      // terminal execution record. That record is the resume authority for an
      // accepted EpisodePlan step, so once it exists a restart must also have
      // enough durable run evidence to recover output, session, usage, and
      // settlement without invoking the provider again.
      await checkpointWrites;
      const durableUsage = providerResults.reduce((sum, prior) => sumTurnUsage(sum, prior.usage), turnResult.usage);
      if (ordinal === 1) {
        await writeOutput(root, app, runId, turnResult.summary);
      }
      await updateEnvelope(root, app, runId, {
        usage: toEnvelopeUsage(durableUsage),
        session: sessionEvidence(turnResult.session),
        ...(turnResult.artifacts.length > 0 ? { artifacts: turnResult.artifacts } : {}),
        ...(ordinal === 1 ? { previews: { task: request.task, output: turnResult.summary } } : {}),
      });
      const artifactFingerprint = turnResult.artifacts.length === 0 ? undefined : fingerprint(turnResult.artifacts);
      const after = worktreeFingerprint(options.workdir);
      await finalizeProviderStep({
        root,
        episodeId,
        app,
        runId,
        started,
        operation: request.operation,
        role: admittedRole,
        assignment,
        planMetadata,
        result: turnResult,
        finishedAt: clock(),
        contextManifestRef: contextManifest.relativeRef,
        ...definedProps({ workFingerprintBefore: before }),
        ...definedProps({ workFingerprintAfter: after }),
        ...definedProps({ artifactFingerprint }),
        toolCallCount: providerToolCalls - toolCallStart,
      });
      const settlementRole: RoleConfig = {
        ...admittedRole,
        runtime: assignment.harness,
        model: assignment.model,
        effort: assignment.effort,
      };
      const settlement = toRecord(settlementRole, turnResult, clock(), {
        app,
        ...(options.telemetry?.trigger !== undefined ? { trigger: options.telemetry.trigger } : {}),
        runId,
        providerTurnId: started.providerTurnId,
        executionStepId: started.executionStepId,
        episodeId,
        effort: assignment.effort,
        ...(planMetadata.plan_version !== undefined
          ? {
              planVersion: planMetadata.plan_version,
              planStepId: planMetadata.plan_step_id,
            }
          : {}),
        ...definedProps({ assignmentSource: planMetadata.assignment_source }),
        ...definedProps({ assignmentCandidateId: planMetadata.assignment_candidate_id }),
        ...definedProps({ selectionReason: planMetadata.selection_reason }),
        resolvedCapabilities,
        traceId,
        ...definedProps({ parentTaskId: options.parentTaskId }),
        pipeline: options.pipeline.name,
        pass: pass.id,
        ...(turnResult.usage.quality === "unavailable" ? { unmeasured: true } : {}),
        ...(options.telemetry?.experimentRef !== undefined ? { experimentRef: options.telemetry.experimentRef } : {}),
        ...(options.telemetry?.candidateRef !== undefined ? { candidateRef: options.telemetry.candidateRef } : {}),
        ...(options.telemetry?.learningActivity !== undefined
          ? { learningActivity: options.telemetry.learningActivity }
          : {}),
      });
      // P1-13 / F-002 / L-005: a settlement failure (e.g. a lock timeout at
      // scale, or an abort unwinding through here) must NOT discard a paid-for
      // provider turn. The execution step above (finalizeProviderStep) is already
      // durable — it is written BEFORE settlement precisely so this ordering
      // holds — so `cormidia budget --reconcile` back-fills the ledger row. Record a
      // durable settle-failure marker and let the completed turn survive rather
      // than unwinding the whole pipeline past money already spent. Do NOT reorder
      // the durable step write after this point.
      let settled = false;
      let settleFailed = false;
      try {
        settled = await recordTurnOnce(options.telemetry?.orgDir ?? root, settlement);
      } catch (error) {
        settleFailed = true;
        await events.append({
          type: "telemetry.settle_failed",
          severity: "error",
          detail: {
            providerTurnId: started.providerTurnId,
            executionStepId: started.executionStepId,
            reason: error instanceof Error ? error.message : String(error),
          },
        });
      }
      if (!settled && !settleFailed) {
        await events.append({
          type: "telemetry.settle_skipped",
          severity: "warn",
          detail: {
            providerTurnId: started.providerTurnId,
            reason: "a ledger row with this app+providerTurnId already exists",
          },
        });
      }
      providerResults.push(turnResult);
      return turnResult;
    };
    let result: TurnResult;
    try {
      result = await runProviderTurn({
        operation: `${options.pipeline.name}/${pass.id}`,
        task,
        ...(continuation !== undefined ? { session: continuation.session } : {}),
        ...definedProps({ verdictSchema }),
      });
    } catch (error) {
      if (!(error instanceof ProviderBudgetRefusalError)) throw error;
      result = {
        status: "blocked_on_gate",
        errorCode: error.errorCode,
        summary: error.message,
        artifacts: [],
        session: { runtime: assignment.harness, id: `route-budget-${pass.id}` },
        usage: unavailableUsage(),
        escalations: [],
      };
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
      if (adapterStartTimer !== undefined) clearTimeout(adapterStartTimer);
      unlinkParent();
      clearInterval(heartbeat);
    }

    await checkpointWrites;

    await writeOutput(root, app, runId, result.summary);
    const toolCounts = await flushBridgedEvents(bridged, events, pass.id);
    await updateEnvelope(root, app, runId, {
      usage: toEnvelopeUsage(result.usage),
      session: sessionEvidence(result.session),
      ...(result.artifacts.length > 0 ? { artifacts: result.artifacts } : {}),
      previews: { task, output: result.summary },
      ...(Object.keys(toolCounts).length > 0 ? { tool_counts: toolCounts } : {}),
    });

    for (const escalation of result.escalations) {
      await events.append({
        type: "escalation.raised",
        severity: "warn",
        detail: { tool: escalation.action.tool, reason: escalation.reason },
      });
    }

    // Verdict recording runs before finalize so an unparseable verdict finalizes
    // the pass as an infra failure, not a completed pass (§6, §13 row 11).
    let settledUsage = result.usage;
    let verdictOutcome: VerdictRecordOutcome = { ok: true };
    if (options.recordVerdict !== undefined && result.status === "completed") {
      try {
        verdictOutcome = await options.recordVerdict({
          pass,
          runId,
          result,
          role,
          assignment,
          hooks: passHooks,
          workdir: options.workdir,
          context: executableContext,
          events,
          clock,
          runProviderTurn,
        });
        if (
          verdictOutcome.ok &&
          !(await readEvents(root, app, runId)).some((event) => event.event === "verdict.recorded")
        ) {
          verdictOutcome = {
            ok: false,
            errorCode: "error_verdict_persist",
            error: new Error(
              `verdict recorder for ${options.pipeline.name}/${pass.id} returned without durable verdict.recorded evidence`,
            ),
          };
        }
        if (verdictOutcome.ok) {
          // The provider execution record is intentionally durable before this
          // callback. This separate orchestrator-owned marker closes the crash
          // window: a governed resume may trust terminal provider output only
          // after verdict parsing/persistence has also committed.
          await events.append({
            type: "verdict.persistence_completed",
            detail: { provider_turns: providerResults.length },
          });
        }
      } catch (error) {
        verdictOutcome = {
          ok: false,
          errorCode: error instanceof ProviderBudgetRefusalError ? error.errorCode : "error_verdict_persist",
          error: error instanceof Error ? error : new Error(String(error)),
        };
      }
      // Each reformat/recovery call is already settled independently; the pass
      // envelope retains an aggregate parent summary for legacy readers.
      if (providerResults.length > 1) {
        settledUsage = providerResults
          .slice(1)
          .reduce((sum, providerResult) => sumTurnUsage(sum, providerResult.usage), result.usage);
        await updateEnvelope(root, app, runId, {
          usage: toEnvelopeUsage(settledUsage),
        });
      }
    }

    const status = verdictOutcome.ok ? (verdictOutcome.terminalStatus ?? envelopeStatus(result)) : "failed";
    if (status === "completed" && options.inputManifest !== undefined && inputManifestRef !== undefined) {
      await writeLoopFileAtomic(
        join(runPaths(root, app, runId).dir, inputManifestRef),
        options.inputManifest.completedContents,
      );
    }
    if (status === "failed") {
      // Infra failure — machine code, distinct population from merit (§9). The
      // adapter's own code (budget overrun, watchdog) beats the generic one:
      // budget exhaustion must read as budget exhaustion.
      await events.append({
        type: "pass.failed",
        severity: "error",
        errorCode: verdictOutcome.ok ? (result.errorCode ?? "error_turn_failed") : verdictOutcome.errorCode,
        detail: { reason: result.summary },
      });
    } else if (status === "cancelled" || status === "timed_out") {
      await events.append({
        type: status === "cancelled" ? "pass.cancelled" : "pass.timed_out",
        severity: "warn",
        errorCode: result.errorCode ?? (status === "cancelled" ? "error_cancelled" : ERROR_WALL_CLOCK_EXCEEDED),
        detail: { reason: result.summary },
      });
    } else {
      await events.append({
        type: "pass.completed",
        ...(status === "blocked" || result.status === "blocked_on_gate"
          ? {
              detail: {
                outcome: status === "blocked" ? "blocked_verdict" : "blocked_on_gate",
                reason: result.summary,
              },
            }
          : {}),
      });
    }
    await events.append({ type: "run.completed" });
    await finalizeRun(
      root,
      app,
      runId,
      {
        status,
        verdictSummary: result.summary,
        ...(verdictOutcome.ok
          ? status === "failed"
            ? { errorCode: result.errorCode ?? "error_turn_failed" }
            : status === "cancelled"
              ? { errorCode: result.errorCode ?? "error_cancelled" }
              : status === "timed_out"
                ? { errorCode: result.errorCode ?? ERROR_WALL_CLOCK_EXCEEDED }
                : result.status !== "completed" && result.errorCode !== undefined
                  ? { errorCode: result.errorCode }
                  : {}
          : { errorCode: verdictOutcome.errorCode }),
        ...(status === "completed" ? {} : { reason: result.summary }),
      },
      clock(),
    );
    runFinalized = true;

    // The record is durable; NOW surface the loud typed failure to the caller.
    if (!verdictOutcome.ok) throw verdictOutcome.error;

    return {
      pass,
      runId,
      result,
      assignment,
      planMetadata,
      contextFingerprint: contextManifest.manifest.render_sha256,
      workFingerprint: worktreeFingerprint(options.workdir) ?? null,
    };
  } catch (error) {
    if (!runFinalized) {
      await finalizeRun(
        root,
        app,
        runId,
        {
          status: "failed",
          errorCode: "error_pass_executor",
          reason: error instanceof Error ? error.message : String(error),
        },
        clock(),
      );
    }
    throw error;
  }
}

function validateInputManifestFileName(fileName: string): string {
  if (!/^[a-z0-9][a-z0-9._-]*\.json$/.test(fileName)) {
    throw new Error(`executePipeline: invalid input manifest file name ${JSON.stringify(fileName)}`);
  }
  return fileName;
}

/** Drain the buffered tool/subagent TurnEvents into L2 (§9): `tool.called`
 *  with name/duration/success/args-hash (+ optional category tag) and a tally
 *  of tool counts for the envelope; `subagent.started`/`.completed` nested
 *  under the pass span. Structured fields are used when the adapter set them;
 *  otherwise phase is inferred from the detail text and a span id synthesized,
 *  so today's detail-only adapters still produce a fan-out tree. */
async function flushBridgedEvents(
  bridged: readonly TurnEvent[],
  events: EventWriter,
  passSpanId: string,
): Promise<Record<string, number>> {
  const toolCounts: Record<string, number> = {};
  let subCounter = 0;
  let lastSubSpan: string | undefined;

  for (const e of bridged) {
    if (e.type === "tool_use") {
      const tool = e.name ?? toolNameFromDetail(e.detail);
      toolCounts[tool] = (toolCounts[tool] ?? 0) + 1;
      await events.toolCalled({
        tool,
        durationMs: e.durationMs ?? 0,
        success: e.success ?? true,
        ...definedProps({ args: e.args }),
        ...definedProps({ category: e.category }),
        // A subagent-issued tool call nests under its subagent span.
        ...(e.spanId !== undefined ? { spanId: e.spanId, parentSpanId: passSpanId } : {}),
      });
    } else {
      const phase: "started" | "completed" =
        e.phase ??
        (/\b(complete|completed|finish|finished|end|ended|done)\b/i.test(e.detail) ? "completed" : "started");
      let spanId: string;
      if (e.spanId !== undefined) {
        spanId = e.spanId;
        if (phase === "started") lastSubSpan = spanId;
      } else if (phase === "completed" && lastSubSpan !== undefined) {
        spanId = lastSubSpan;
      } else {
        spanId = `${passSpanId}/sub-${(subCounter += 1)}`;
        lastSubSpan = spanId;
      }
      await events.append({
        type: phase === "completed" ? "subagent.completed" : "subagent.started",
        spanId,
        parentSpanId: passSpanId,
        ...(e.name !== undefined ? { detail: { subagent: e.name } } : {}),
      });
    }
  }
  return toolCounts;
}

/** Best-effort tool name when the adapter only gave us a detail string. */
function toolNameFromDetail(detail: string): string {
  const token = detail.trim().split(/[\s:(]/, 1)[0];
  return token !== undefined && token.length > 0 ? token : "unknown";
}

/** Project the episode's remaining allowance into the shape HardTurnBudget
 * derives a stop's ring from. One projection, both construction sites: the two
 * rings must never disagree about what the episode still allows. */
function episodeAllowanceFor(allowance: {
  activeTimeMs: number;
  equivalentCostUsd: number;
  providerTurns: number;
  toolCalls: number | null;
}): EpisodeAllowance {
  return {
    equivalent_cost_usd: allowance.equivalentCostUsd,
    active_time_ms: allowance.activeTimeMs,
    tool_calls: allowance.toolCalls,
    provider_turns: allowance.providerTurns,
  };
}

function envelopeStatus(result: TurnResult): Exclude<EnvelopeStatus, "running"> {
  if (result.status === "completed") return "completed";
  if (result.status === "blocked_on_gate") return "blocked";
  if (result.status === "cancelled") return "cancelled";
  if (result.status === "timed_out") return "timed_out";
  return "failed";
}

/** The reservation is also the adapter's hard per-turn ceiling. Providers can
 * report a final amount just beyond a streaming stop boundary, so any observed
 * overrun beyond floating-point epsilon blocks the episode and preserves the
 * paid turn's evidence; it never authorizes another provider turn. */
function enforceEquivalentCostReservation(input: {
  episodeId: string;
  operation: string;
  started: StartedProviderStep;
  result: TurnResult;
}): TurnResult {
  const { result, started } = input;
  const observed = result.usage.costUsd;
  const details =
    `cap=$${formatCost(started.budget.capUsd)}, ` +
    `settled=$${formatCost(started.budget.settledUsd)}, ` +
    `other_reserved=$${formatCost(started.budget.alreadyReservedUsd)}, ` +
    `reserved_exposure=$${formatCost(started.reservation.equivalentCostUsd)}, ` +
    `denied_step=${input.operation}`;
  if (!Number.isFinite(observed) || observed < 0) {
    return {
      ...result,
      status: "blocked_on_gate",
      errorCode: "error_route_budget_unmeasured",
      summary:
        `episode ${input.episodeId} stopped after ${input.operation}: provider cost is invalid or unavailable; ` +
        `${details}`,
    };
  }
  if (observed > started.reservation.equivalentCostUsd + EQUIVALENT_COST_ARITHMETIC_TOLERANCE_USD) {
    if (result.status === "failed" && result.errorCode?.includes("budget") === true) {
      return {
        ...result,
        summary: `${result.summary}; ${details}; observed=$${formatCost(observed)}`,
      };
    }
    return {
      ...result,
      status: "blocked_on_gate",
      errorCode: "error_route_budget_exhausted",
      summary:
        `episode ${input.episodeId} stopped after ${input.operation}: observed cost ` +
        `$${formatCost(observed)} exceeded the reserved exposure; ${details}`,
    };
  }
  if (result.status === "completed" && (result.usage.quality === "partial" || result.usage.quality === "unavailable")) {
    return {
      ...result,
      status: "blocked_on_gate",
      errorCode: "error_route_budget_unmeasured",
      summary:
        `episode ${input.episodeId} stopped after ${input.operation}: provider usage is ` +
        `${result.usage.quality}, so safe remaining cost cannot be proven; ${details}`,
    };
  }
  return result;
}

function formatCost(value: number): string {
  return value.toFixed(4);
}

/** Sum two turn usages (base + a verdict reformat retry). Optional split
 *  fields are added only when either side reports them; `costEstimated` is
 *  sticky (an estimate anywhere makes the total an estimate). */
function sumTurnUsage(base: TurnUsage, extra: TurnUsage): TurnUsage {
  const sum: TurnUsage = {
    tokensIn: base.tokensIn + extra.tokensIn,
    tokensOut: base.tokensOut + extra.tokensOut,
    costUsd: base.costUsd + extra.costUsd,
    subagentTurns: base.subagentTurns + extra.subagentTurns,
    wallClockMs: base.wallClockMs + extra.wallClockMs,
    quality: leastCompleteUsageQuality(base.quality, extra.quality),
  };
  if (base.tokensInUncached !== undefined || extra.tokensInUncached !== undefined) {
    sum.tokensInUncached = (base.tokensInUncached ?? 0) + (extra.tokensInUncached ?? 0);
  }
  if (base.cacheCreationTokens !== undefined || extra.cacheCreationTokens !== undefined) {
    sum.cacheCreationTokens = (base.cacheCreationTokens ?? 0) + (extra.cacheCreationTokens ?? 0);
  }
  if (base.cacheReadTokens !== undefined || extra.cacheReadTokens !== undefined) {
    sum.cacheReadTokens = (base.cacheReadTokens ?? 0) + (extra.cacheReadTokens ?? 0);
  }
  if (base.costEstimated || extra.costEstimated) sum.costEstimated = true;
  return sum;
}

/** Worst-wins over the shared ranking (src/runtime/cost.ts) so every surface
 *  degrades usage quality identically. An absent quality means "complete" here:
 *  this merges snapshots of one turn that did run a provider. */
function leastCompleteUsageQuality(
  left: TurnUsage["quality"],
  right: TurnUsage["quality"],
): NonNullable<TurnUsage["quality"]> {
  return worstUsageQuality(left ?? "complete", right ?? "complete");
}

function toEnvelopeUsage(usage: TurnUsage, quality?: TurnUsage["quality"]): EnvelopeUsage {
  const envelope: EnvelopeUsage = {
    tokens_in: usage.tokensIn,
    tokens_out: usage.tokensOut,
    cost_usd: usage.costUsd,
    subagent_turns: usage.subagentTurns,
  };
  if (usage.costEstimated) envelope.cost_estimated = true;
  if (usage.cacheReadTokens !== undefined) envelope.cache_read_tokens = usage.cacheReadTokens;
  if (usage.cacheCreationTokens !== undefined) envelope.cache_write_tokens = usage.cacheCreationTokens;
  envelope.quality = quality ?? usage.quality ?? (usage.costEstimated ? "estimated" : "complete");
  return envelope;
}

function forwardAbort(parent: AbortSignal | undefined, child: AbortController): () => void {
  if (parent === undefined) return () => {};
  const abort = (): void => {
    if (!child.signal.aborted) child.abort(parent.reason);
  };
  if (parent.aborted) abort();
  else parent.addEventListener("abort", abort, { once: true });
  return () => parent.removeEventListener("abort", abort);
}

function abortPromise(signal: AbortSignal): Promise<TurnOutcome> {
  return new Promise((resolve) => {
    const done = (): void => resolve({});
    if (signal.aborted) done();
    else signal.addEventListener("abort", done, { once: true });
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function abortDescriptor(reason: unknown): AbortDescriptor {
  if (isAbortDescriptor(reason)) return reason;
  return {
    status: "cancelled",
    errorCode: "error_cancelled",
    reason: typeof reason === "string" && reason.length > 0 ? reason : "operator cancellation",
  };
}

function isAbortDescriptor(value: unknown): value is AbortDescriptor {
  if (value === null || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    (record["status"] === "cancelled" || record["status"] === "timed_out" || record["status"] === "failed") &&
    typeof record["errorCode"] === "string" &&
    typeof record["reason"] === "string"
  );
}

function stoppedResult(
  descriptor: AbortDescriptor,
  runtime: TurnAssignment["harness"],
  passId: string,
  progress: TurnProgress | undefined,
  settled?: TurnResult,
): TurnResult {
  const usage = settled?.usage ?? progress?.usage ?? unavailableUsage();
  return {
    status: descriptor.status,
    errorCode: descriptor.errorCode,
    summary: descriptor.reason,
    artifacts: settled?.artifacts ?? [],
    session: settled?.session ?? progress?.session ?? { runtime, id: `${descriptor.status}-${passId}` },
    usage: {
      ...usage,
      quality: usage.quality === "unavailable" ? "unavailable" : "partial",
    },
    escalations: settled?.escalations ?? [],
  };
}

function failedResult(
  error: unknown,
  runtime: TurnAssignment["harness"],
  passId: string,
  progress: TurnProgress | undefined,
): TurnResult {
  const message = error instanceof Error ? error.message : String(error);
  const usage = progress?.usage ?? unavailableUsage();
  return {
    status: "failed",
    errorCode: "error_runtime_failed",
    summary: message,
    artifacts: [],
    session: progress?.session ?? { runtime, id: `failed-${passId}` },
    usage: {
      ...usage,
      quality: progress?.usage === undefined ? "unavailable" : "partial",
    },
    escalations: [],
  };
}

function unavailableUsage(): TurnUsage {
  return {
    ...ZERO_USAGE,
    quality: "unavailable",
  };
}

function minNullable(left: number | null, right: number | null): number | null {
  if (left === null) return right;
  if (right === null) return left;
  return Math.min(left, right);
}

function mergeProgress(previous: TurnProgress | undefined, next: TurnProgress): TurnProgress {
  return {
    ...(previous ?? {}),
    ...next,
    ...definedProps({ usage: next.usage }),
    ...definedProps({ session: next.session }),
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
  if (session.runtime === "cursor") {
    return {
      ...session,
      native_ref: session.id,
      transcript: "provider_session",
      transcript_note: "Resume the chat with `cursor-agent --resume <id>`; session.log is activity only.",
    };
  }
  if (session.runtime === "opencode") {
    // OpenCode sessions are first-class server objects the operator can reopen,
    // so the id is a real transcript reference. Falling through would have
    // recorded an opencode turn as transcript-less AND blamed the Claude SDK.
    return {
      ...session,
      native_ref: session.id,
      transcript: "provider_session",
      transcript_note: "Provider session reference recorded; session.log is activity only.",
    };
  }
  if (session.runtime === "muse") {
    // `--session-id <uuid>` is muse's own session identity and the durable
    // session log is the real transcript. Falling through to the final branch
    // would have blamed the Claude SDK for a muse turn having no transcript.
    return {
      ...session,
      native_ref: session.id,
      transcript: "provider_session",
      transcript_note:
        "Provider session reference recorded; the durable muse session log is the transcript " +
        "and session.log is activity only.",
    };
  }
  if (session.runtime === "grok") {
    // Grok resumes the exact id over ACP `session/load` and keeps the real
    // transcript under the turn's isolated `$GROK_HOME/sessions`. Falling
    // through to the final branch would have recorded a grok turn as having no
    // provider transcript AND attributed the absence to the Claude SDK.
    return {
      ...session,
      native_ref: session.id,
      transcript: "provider_session",
      transcript_note:
        "Provider session reference recorded; the transcript lives under the turn's " +
        "isolated $GROK_HOME/sessions and session.log is activity only.",
    };
  }
  return {
    ...session,
    transcript: "unavailable",
    transcript_note: "Claude SDK did not expose a full transcript reference; session.log is activity only.",
  };
}
