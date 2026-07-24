import { existsSync } from "node:fs";
import {
  fixedAssignmentFromRole,
  turnAssignmentsEqual,
} from "../../runtime/assignment.js";
import {
  isRuntimeCapability,
  type RuntimeCapability,
} from "../../runtime/capabilities.js";
import { writeOutput } from "../../runtime/runlog/forensics.js";
import { mintRunId, runPaths } from "../../runtime/runlog/paths.js";
import {
  finalizeRun,
  readEnvelope,
  updateEnvelope,
  type EnvelopeStatus,
  type EnvelopeUsage,
  type RunEnvelope,
} from "../../runtime/runlog/envelope.js";
import type {
  ContextBundle,
  RoleConfig,
  Runtime,
  TurnAssignment,
  TurnHooks,
  TurnUsage,
} from "../../runtime/types.js";
import {
  finalizeEpisode,
  fingerprint,
  reconcileEpisodeProviderSteps,
  readExecutionSteps,
  readPendingProviderSteps,
  readRouteRecord,
  type AuthorizedPass,
  type ExecutionStepRecord,
  type StartedProviderReceipt,
} from "../../loop/efficiency.js";
import {
  executeEpisodePlan,
  readEpisodePlanExecutionJournal,
  type ApprovalStepOutcome,
  type EpisodePlanExecutionResult,
  type EpisodeStepCompletedOutcome,
  type EpisodeStepExecutionContext,
  type EpisodeStepFailedOutcome,
} from "../../loop/episode-plan-executor.js";
import {
  publishEpisodePlanRevision,
  rejectEpisodeReplan,
  requestEpisodeReplan,
  type EpisodeReplanEventKind,
  type EpisodeReplanRecord,
} from "../../loop/episode-replan.js";
import {
  episodeIntentHash,
  readPersistedEpisodeIntent,
  type EpisodePlanValidationPolicy,
  type ApprovalStep,
  type EpisodeIntent,
  type EpisodePlan,
  type EpisodeStep,
  type MechanicalGateStep,
  type ProviderTurnStep,
} from "../../loop/episode-plan.js";
import {
  EPISODE_PLAN_EXECUTION_PIPELINE,
  planRouteLabel,
  routeAdmissionForEpisodePlan,
} from "../../loop/episode-route.js";
import {
  admitPlannedEpisodeRoute,
  assertPlannedEpisodeRevisionBudgetHeadroom,
} from "../../loop/planner-admission.js";
import { executePipeline } from "../../loop/pipeline.js";
import type { PipelineConfig } from "../../loop/pipelines.js";
import type { TriggerKind } from "../../runtime/telemetry.js";
import type { RuntimeReadinessProbe } from "../../runtime/readiness.js";
import { recordTurnOnce } from "../../runtime/telemetry.js";
import { turnRecordFromExecutionStep } from "../budget.js";
import { probeSelectedAssignmentReadiness } from "./assignment-readiness.js";

const BASELINE_PROVIDER_CAPABILITIES = [
  "tool_gate",
  "cancellation",
  "session_resume",
] as const satisfies readonly RuntimeCapability[];

export interface ExecuteAcceptedEpisodePlanOptions {
  root: string;
  intent: EpisodeIntent;
  plan: EpisodePlan;
  roles: readonly RoleConfig[];
  workdir: string;
  hooks: TurnHooks;
  runtimeForAssignment: (assignment: TurnAssignment, role: RoleConfig) => Runtime;
  /** Adaptive execution must re-prove the persisted exact tuple immediately
   * before adapter construction. Missing/negative evidence fails the step and
   * enters typed replanning; fixed mode retains its migration behavior. */
  assignmentReadinessProbe?: RuntimeReadinessProbe;
  assignmentReadinessTimeoutMs?: number;
  contextForProviderStep: (input: {
    step: ProviderTurnStep;
    execution: EpisodeStepExecutionContext;
  }) => ContextBundle | Promise<ContextBundle>;
  /** Domain-specific operation adapter. Ticket episodes inject the code-owned
   * operation/template/verdict bridge; generic episodes use the executor below. */
  provider?: (
    step: ProviderTurnStep,
    execution: EpisodeStepExecutionContext,
  ) => Promise<EpisodeStepCompletedOutcome | EpisodeStepFailedOutcome>;
  /** Domain answer to "can this provider step reach a terminal outcome from
   * durable evidence, without spending a new turn?" Consulted only by the
   * adopted-revision halt below: a step whose preserved prior material event
   * can be reconciled must be entered, not withheld (#175). The generic
   * executor already knows about its own terminal execution records; a domain
   * that reconciles more than that (for example a blocked transport carrying a
   * done build verdict) declares it here from the same code the step handler
   * uses, so there is one source of truth. */
  providerStepCompletableWithoutNewTurn?: (
    step: ProviderTurnStep,
    plan: EpisodePlan,
  ) => Promise<boolean>;
  mechanical: (
    step: MechanicalGateStep,
    execution: EpisodeStepExecutionContext,
  ) => Promise<EpisodeStepCompletedOutcome | EpisodeStepFailedOutcome>;
  approval: (
    step: ApprovalStep,
    execution: EpisodeStepExecutionContext,
  ) => Promise<ApprovalStepOutcome>;
  /** The turn's gate, built per role AND per sandbox cwd. The cwd is passed
   *  by the executor that actually runs the pass, because a builder ticket
   *  pass runs in the per-ticket worktree while the caller that wires this
   *  callback only knows the managed clone — and an approval raised in one
   *  tree must never be executed in the other. */
  gateForRole?: (role: RoleConfig, workdir?: string) => TurnHooks["gate"];
  parentTaskId?: string;
  signal?: AbortSignal;
  networkAccess?: boolean;
  contextBudgetBytes?: number;
  maxSteps?: number;
  /** Bounded forward-only revision allowance for typed material failures. */
  maxRevisions?: number;
  /** Optional bounded coordinator for an actual future-only revision. The
   * common executor never manufactures a retry plan. Without this callback it
   * returns the durable pending request explicitly to its caller. */
  proposeRevision?: (
    input: EpisodePlanRevisionProposalRequest,
  ) => Promise<EpisodePlanRevisionProposal>;
  /** A domain with its own typed request/publication transaction may retain
   * that authority; every other execution uses the common failure handoff. */
  replanAuthority?: "executor" | "caller";
  providerReceiptStaleAfterMs?: number;
  telemetry?: { orgDir: string; trigger?: TriggerKind };
  now?: () => Date;
}

export interface EpisodePlanRevisionProposalRequest {
  intent: EpisodeIntent;
  previousPlan: EpisodePlan;
  replan: EpisodeReplanRecord;
}

export interface EpisodePlanRevisionProposal {
  plan: EpisodePlan;
  policy: EpisodePlanValidationPolicy;
}

export interface EpisodeReplanHandoff {
  requestId: string;
  kind: EpisodeReplanEventKind;
  status: EpisodeReplanRecord["status"];
  revisionVersion: number | null;
  reason: string | null;
}

export type AcceptedEpisodePlanExecutionResult = EpisodePlanExecutionResult & {
  replan?: EpisodeReplanHandoff;
};

export class EpisodeProviderReconciliationRequiredError extends Error {
  readonly code = "error_episode_provider_reconciliation_required" as const;
  constructor(
    readonly episodeId: string,
    readonly executionStepIds: readonly string[],
  ) {
    super(
      `episode ${episodeId} still has live provider reservation(s): ` +
        executionStepIds.join(", "),
    );
    this.name = "EpisodeProviderReconciliationRequiredError";
  }
}

/** Admit the one-way route projection and execute the persisted plan DAG.
 * Static pipelines are used only as the provider transport for one exact
 * planned step at a time; they never select workflow shape. */
export async function executeAcceptedEpisodePlan(
  options: ExecuteAcceptedEpisodePlanOptions,
): Promise<AcceptedEpisodePlanExecutionResult> {
  assertInvocation(options);
  const persistedIntent = await readPersistedEpisodeIntent(
    options.root,
    options.plan.episodeId,
  );
  if (persistedIntent === undefined) {
    throw new Error(`episode ${options.plan.episodeId} has no immutable intent`);
  }
  if (
    episodeIntentHash(persistedIntent) !== options.plan.intentHash ||
    episodeIntentHash(options.intent) !== options.plan.intentHash
  ) {
    throw new Error(`episode ${options.plan.episodeId} execution intent differs from immutable authority`);
  }
  const boundOptions: ExecuteAcceptedEpisodePlanOptions = {
    ...options,
    intent: persistedIntent,
  };
  const clock = options.now ?? (() => new Date());
  const result = await executePlanVersion(boundOptions, options.plan, clock);
  const replan = await requestMaterialFailureReplan(boundOptions, result, clock);
  if (replan === undefined) return result;
  if (replan.plan === undefined) {
    return { ...result, replan: replanHandoff(replan.record) };
  }
  // The revision is already accepted durable authority. Continue it in this
  // invocation so a valid preserve-and-continue plan actually reaches its
  // gates and PR instead of stranding completed work behind a synthetic
  // `running` result (#175). The one step held back is the exact provider step
  // whose failure authorized the revision: re-entering it here would spend a
  // second turn repeating the failure that caused the replan (typically an
  // unavailable assignment). It is held back only when it would genuinely
  // spend that turn — a repaired step whose durable evidence can be
  // reconciled runs now, and every never-attempted downstream step is ordinary
  // forward progress. Anything withheld is returned as `nextStepId`.
  const adopted = await executePlanVersion(
    boundOptions,
    replan.plan,
    clock,
    options.maxSteps,
    replan.record.trigger.affectedStepIds,
  );
  return { ...adopted, replan: replanHandoff(replan.record) };
}

async function executePlanVersion(
  options: ExecuteAcceptedEpisodePlanOptions,
  plan: EpisodePlan,
  clock: () => Date,
  maxSteps = options.maxSteps,
  /** Set only when `plan` is a freshly adopted revision: the step ids that
   * revision was authored to repair. Undefined means no step is withheld. */
  repairedStepIds?: readonly string[],
): Promise<EpisodePlanExecutionResult> {
  const versionOptions: ExecuteAcceptedEpisodePlanOptions = { ...options, plan };
  return executeEpisodePlan({
    root: options.root,
    plan,
    beforeExecution: async () => {
      const reconciled = await reconcileEpisodeProviderSteps(
        options.root,
        plan.episodeId,
        clock(),
        options.providerReceiptStaleAfterMs ?? 2 * 60_000,
        (receipt) => recoverProviderUsage(options.root, receipt, clock),
      );
      if (reconciled.inFlight.length > 0) {
        throw new EpisodeProviderReconciliationRequiredError(
          plan.episodeId,
          reconciled.inFlight,
        );
      }
      await repairTerminalProviderEvidence(versionOptions, clock());
      await admitPlannedEpisodeRoute(routeAdmissionForEpisodePlan({
        root: options.root,
        intent: options.intent,
        plan,
        now: clock(),
      }));
    },
    afterCompletion: async () => {
      await finalizeEpisode({
        root: options.root,
        episodeId: plan.episodeId,
        status: "completed",
        reason: `EpisodePlan v${plan.version} completed`,
        now: clock(),
      });
    },
    handlers: {
      provider: async (step, execution) => {
        const prior = await priorProviderEvidence(versionOptions, step, execution);
        if (options.provider !== undefined) {
          // A domain adapter may have deterministic work after the terminal
          // provider boundary (for example verdict persistence, output
          // normalization, or a caller-owned recovery hook). Generic evidence
          // is enough to avoid another provider turn, but it is not enough to
          // declare that domain tail complete. Invoke the adapter on recovery
          // so it can replay that idempotent work from durable output.
          if (prior === undefined) {
            const unavailable = await adaptiveAssignmentReadinessFailure(versionOptions, step);
            if (unavailable !== undefined) return unavailable;
          }
          return options.provider(step, execution);
        }
        if (prior !== undefined) return prior;
        const unavailable = await adaptiveAssignmentReadinessFailure(versionOptions, step);
        if (unavailable !== undefined) return unavailable;
        return executeProviderStep(versionOptions, step, execution, clock);
      },
      mechanical: options.mechanical,
      approval: options.approval,
    },
    ...(maxSteps === undefined ? {} : { maxSteps }),
    ...(repairedStepIds === undefined
      ? {}
      : {
        haltBeforeNewProviderTurn: async (step: EpisodeStep) =>
          step.kind === "provider_turn" &&
          repairedStepIds.includes(step.id) &&
          !(await completableWithoutNewProviderTurn(versionOptions, plan, step)),
      }),
    now: clock,
  });
}

const FAILED_GATE_REASONS = new Set([
  "error_verdict_unparseable",
  "ticket_data_integrity_evidence_missing",
  "ticket_provision_failed",
  "ticket_quality_gate_failed",
  "ticket_review_findings",
  "ticket_ship_check_findings",
]);

const ESTIMATE_EXHAUSTED_REASONS = new Set([
  "error_route_budget_exhausted",
  "error_route_budget_unmeasured",
]);

const ASSIGNMENT_UNAVAILABLE_REASONS = new Set([
  "error_adapter_transport_unavailable",
  "plan_assignment_unavailable",
]);

async function requestMaterialFailureReplan(
  options: ExecuteAcceptedEpisodePlanOptions,
  result: EpisodePlanExecutionResult,
  clock: () => Date,
): Promise<{ record: EpisodeReplanRecord; plan?: EpisodePlan } | undefined> {
  if (options.replanAuthority === "caller") return undefined;
  if (result.status !== "failed" && result.status !== "denied") return undefined;
  // A ticket-budget refusal is a terminal policy decision about an otherwise
  // preserved decomposition, not a failed execution assumption. Replanning
  // here would manufacture a new accepted plan that cannot lawfully execute
  // and would obscure the exact ratification path.
  if (result.reasonCode === "refused_ticket_budget") return undefined;
  const journal = await readEpisodePlanExecutionJournal(
    options.root,
    options.plan.episodeId,
  );
  const terminal = journal?.events.findLast((event) =>
    event.plan_version === options.plan.version &&
    event.kind !== "plan_adopted" &&
    event.step_id === result.nextStepId &&
    (event.kind === "step_failed" || event.kind === "approval_denied"),
  );
  if (terminal === undefined ||
      (terminal.kind !== "step_failed" && terminal.kind !== "approval_denied")) {
    throw new Error(
      `failed EpisodePlan v${options.plan.version} has no durable typed terminal event`,
    );
  }
  const kind = replanKindForFailure(result.status, terminal.reason_code);
  const requestId = `execution-${fingerprint({
    episodeId: options.plan.episodeId,
    planVersion: options.plan.version,
    executionId: terminal.execution_id,
    kind,
  }).slice(0, 24)}`;
  const request = await requestEpisodeReplan({
    root: options.root,
    episodeId: options.plan.episodeId,
    maxRevisions: options.maxRevisions ?? 2,
    trigger: {
      id: requestId,
      kind,
      planVersion: options.plan.version,
      detectedAt: terminal.at,
      summary: terminal.summary,
      evidenceRefs: [`plan-execution:${terminal.execution_id}`],
      affectedStepIds: [terminal.step_id],
    },
    now: new Date(terminal.at),
  });
  if (options.proposeRevision === undefined) return { record: request };

  const persistedIntent = await readPersistedEpisodeIntent(
    options.root,
    options.plan.episodeId,
  );
  if (persistedIntent === undefined) {
    throw new Error(`episode ${options.plan.episodeId} has no immutable intent for replanning`);
  }
  try {
    const proposal = await options.proposeRevision({
      intent: structuredClone(persistedIntent),
      previousPlan: structuredClone(options.plan),
      replan: structuredClone(request),
    });
    if (
      proposal.plan.episodeId !== options.plan.episodeId ||
      proposal.plan.version !== options.plan.version + 1
    ) {
      throw new Error(
        `revision proposal must target ${options.plan.episodeId} v${options.plan.version + 1}`,
      );
    }
    await assertPlannedEpisodeRevisionBudgetHeadroom({
      root: options.root,
      plan: proposal.plan,
    });
    const accepted = await publishEpisodePlanRevision({
      root: options.root,
      requestId: request.trigger.id,
      intent: persistedIntent,
      plan: proposal.plan,
      policy: proposal.policy,
      now: clock(),
    });
    return { record: accepted, plan: structuredClone(proposal.plan) };
  } catch (error) {
    if (
      error !== null &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "error_episode_replan_provider_in_flight"
    ) {
      // The exact revision-planner turn has a durable live/terminal receipt
      // whose settlement tail is not yet complete. Preserve the request as
      // pending so restart reconciliation can finish it without another turn.
      return { record: request };
    }
    const reason = error instanceof Error ? error.message : String(error);
    const rejected = await rejectEpisodeReplan({
      root: options.root,
      episodeId: options.plan.episodeId,
      requestId: request.trigger.id,
      reason: `revision proposal rejected: ${reason}`,
      now: clock(),
    });
    return { record: rejected };
  }
}

function replanHandoff(record: EpisodeReplanRecord): EpisodeReplanHandoff {
  return {
    requestId: record.trigger.id,
    kind: record.trigger.kind,
    status: record.status,
    revisionVersion: record.revisionVersion,
    reason: record.reason,
  };
}

function replanKindForFailure(
  status: EpisodePlanExecutionResult["status"],
  reasonCode: string,
): EpisodeReplanEventKind {
  if (status === "denied") return "approval_constraint";
  if (FAILED_GATE_REASONS.has(reasonCode)) return "failed_gate";
  if (ESTIMATE_EXHAUSTED_REASONS.has(reasonCode)) return "estimate_exhausted";
  if (ASSIGNMENT_UNAVAILABLE_REASONS.has(reasonCode)) return "assignment_unavailable";
  return "failed_assumption";
}

/** Complete the durable tail of a provider turn that already published its
 * terminal execution record but whose process died before the parent run and
 * ledger were finalized. The provider execution record is authoritative; no
 * adapter is reconstructed and no assignment substitution is possible. */
async function repairTerminalProviderEvidence(
  options: ExecuteAcceptedEpisodePlanOptions,
  now: Date,
): Promise<void> {
  const providerSteps = new Map(
    options.plan.steps
      .filter((step): step is ProviderTurnStep => step.kind === "provider_turn")
      .map((step) => [step.id, step]),
  );
  const records = (await readExecutionSteps(options.root, options.plan.episodeId))
    .filter((record) =>
      record.kind === "provider" &&
      record.plan_version === options.plan.version &&
      record.plan_step_id !== undefined &&
      providerSteps.has(record.plan_step_id),
    );
  for (const record of records) {
    const step = providerSteps.get(record.plan_step_id!);
    if (step === undefined) continue;
    // Reuse the execution-boundary identity check before touching run or
    // settlement evidence. A forged/stale terminal record fails closed.
    outcomeFromEvidence(record, step);

    const outputPath = runPaths(options.root, record.app, record.run_id).output;
    if (!existsSync(outputPath)) {
      await writeOutput(options.root, record.app, record.run_id, record.reason);
    }

    const envelope = await readEnvelopeIfPresent(options.root, record.app, record.run_id);
    if (envelope !== undefined) {
      assertEnvelopeMatchesTerminalProvider(envelope, record, step);
      if (envelope.status === "running") {
        await updateEnvelope(options.root, record.app, record.run_id, {
          ...(record.usage === null ? {} : { usage: envelopeUsage(record.usage) }),
          ...(record.provider_turn_id === null
            ? {}
            : { providerTurnIds: [record.provider_turn_id] }),
          executionStepIds: [record.execution_step_id],
          previews: { output: record.reason },
        });
        await finalizeRun(
          options.root,
          record.app,
          record.run_id,
          {
            status: envelopeStatusForExecution(record.status),
            verdictSummary: record.reason,
            ...(record.error_code === null ? {} : { errorCode: record.error_code }),
            ...(record.status === "completed" ? {} : { reason: record.reason }),
            ...(record.usage === null ? {} : { usage: envelopeUsage(record.usage) }),
          },
          now,
        );
      }
    }

    const settlement = turnRecordFromExecutionStep(record);
    if (envelope !== undefined) {
      settlement.traceId = envelope.trace_id;
      if (envelope.parent_task_id !== undefined) {
        settlement.parentTaskId = envelope.parent_task_id;
      }
    }
    if (options.telemetry?.trigger !== undefined) {
      settlement.trigger = options.telemetry.trigger;
    }
    await recordTurnOnce(options.telemetry?.orgDir ?? options.root, settlement);
  }
}

async function readEnvelopeIfPresent(
  root: string,
  app: string,
  runId: string,
): Promise<RunEnvelope | undefined> {
  try {
    return await readEnvelope(root, app, runId);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function assertEnvelopeMatchesTerminalProvider(
  envelope: RunEnvelope,
  record: ExecutionStepRecord,
  step: ProviderTurnStep,
): void {
  if (
    envelope.episode_id !== record.episode_id ||
    envelope.plan_version !== record.plan_version ||
    envelope.plan_step_id !== record.plan_step_id ||
    envelope.role !== step.role ||
    envelope.runtime !== step.assignment.harness ||
    envelope.model !== step.assignment.model ||
    envelope.effort !== step.assignment.effort ||
    envelope.assignment_source !== step.assignmentSource
  ) {
    throw new Error(
      `run envelope ${record.run_id} differs from terminal provider evidence for ${step.id}`,
    );
  }
}

function envelopeStatusForExecution(
  status: ExecutionStepRecord["status"],
): Exclude<EnvelopeStatus, "running"> {
  if (status === "completed") return "completed";
  if (status === "blocked") return "blocked";
  if (status === "cancelled") return "cancelled";
  if (status === "timed_out") return "timed_out";
  return "failed";
}

function envelopeUsage(usage: TurnUsage): EnvelopeUsage {
  return {
    tokens_in: usage.tokensIn,
    tokens_out: usage.tokensOut,
    cost_usd: usage.costUsd,
    subagent_turns: usage.subagentTurns,
    quality: usage.quality ?? (usage.costEstimated === true ? "estimated" : "complete"),
    ...(usage.costEstimated === true ? { cost_estimated: true } : {}),
    ...(usage.cacheReadTokens === undefined
      ? {}
      : { cache_read_tokens: usage.cacheReadTokens }),
    ...(usage.cacheCreationTokens === undefined
      ? {}
      : { cache_write_tokens: usage.cacheCreationTokens }),
  };
}

async function recoverProviderUsage(
  root: string,
  receipt: StartedProviderReceipt,
  clock: () => Date,
): Promise<TurnUsage | undefined> {
  try {
    const envelope = await readEnvelope(root, receipt.app, receipt.run_id);
    if (
      !envelope.provider_turn_ids?.includes(receipt.provider_turn_id) ||
      envelope.usage === undefined
    ) return undefined;
    const observedAt = envelope.last_seen_at ?? envelope.finished_at ?? clock().toISOString();
    return {
      tokensIn: envelope.usage.tokens_in,
      tokensOut: envelope.usage.tokens_out,
      costUsd: envelope.usage.cost_usd,
      subagentTurns: envelope.usage.subagent_turns ?? 0,
      wallClockMs: Math.max(
        0,
        new Date(observedAt).getTime() - new Date(receipt.started_at).getTime(),
      ),
      quality: envelope.usage.quality ??
        (envelope.usage.cost_estimated ? "estimated" : "partial"),
      ...(envelope.usage.cost_estimated === true ? { costEstimated: true } : {}),
      ...(envelope.usage.cache_read_tokens === undefined
        ? {}
        : { cacheReadTokens: envelope.usage.cache_read_tokens }),
      ...(envelope.usage.cache_write_tokens === undefined
        ? {}
        : { cacheCreationTokens: envelope.usage.cache_write_tokens }),
    };
  } catch {
    return undefined;
  }
}

async function executeProviderStep(
  options: ExecuteAcceptedEpisodePlanOptions,
  step: ProviderTurnStep,
  execution: EpisodeStepExecutionContext,
  clock: () => Date,
): Promise<EpisodeStepCompletedOutcome | EpisodeStepFailedOutcome> {
  const route = await readRouteRecord(options.root, options.plan.episodeId);
  const authorization = exactAuthorization(route.authorized_passes, step, execution);
  const role = options.roles.find((candidate) => candidate.name === step.role);
  if (role === undefined) throw new Error(`planned provider step ${step.id} has unknown role ${step.role}`);
  const pipeline: PipelineConfig = {
    name: EPISODE_PLAN_EXECUTION_PIPELINE,
    mechanical: false,
    passes: [{ id: step.id, role: step.role, template: "" }],
  };
  const context = await options.contextForProviderStep({ step, execution });
  const result = await executePipeline({
    pipeline,
    selection: { tier: planRouteLabel(options.plan) },
    roles: { [role.name]: role },
    runtimeFor: (selected) =>
      options.runtimeForAssignment(fixedAssignmentFromRole(selected), role),
    runtimeForAssignment: options.runtimeForAssignment,
    briefFor: () => renderProviderStepBrief(options.plan, step),
    promptsDir: ".",
    context,
    workdir: options.workdir,
    hooks: options.hooks,
    ...(options.gateForRole === undefined ? {} : { gateForRole: options.gateForRole }),
    runlog: {
      root: options.root,
      app: options.intent.app,
      traceId: execution.executionId,
    },
    runIdForPass: () => stableRunId(options.plan, step, execution),
    episode: {
      id: options.plan.episodeId,
      route: planRouteLabel(options.plan),
      authorizedPasses: [authorization],
      finalize: false,
      // Pipeline preflight is intentionally provider-free and cannot infer
      // the accepted plan's hard ceilings from the durable route record. Give
      // it the same one-way projection used at route admission; this is not a
      // second source of authority, and execution reservations still settle
      // against the persisted route.
      budgetOverrides: {
        provider_turns: options.intent.hardBudget.maxProviderTurns,
        equivalent_cost_usd: options.intent.hardBudget.maxEquivalentCostUsd,
        ...(options.intent.hardBudget.maxActiveTimeMs === undefined
          ? {}
          : { active_time_ms: options.intent.hardBudget.maxActiveTimeMs }),
        ...(options.intent.hardBudget.maxHumanDecisions === undefined
          ? {}
          : { human_decisions: options.intent.hardBudget.maxHumanDecisions }),
      },
      nextTurnEstimate: { costUsd: step.maxTurnBudgetUsd },
    },
    requiredCapabilities: providerRuntimeCapabilities(step),
    ...(options.parentTaskId === undefined ? {} : { parentTaskId: options.parentTaskId }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(options.networkAccess === true ? { networkAccess: true } : {}),
    ...(options.contextBudgetBytes === undefined
      ? {}
      : { contextBudgetBytes: options.contextBudgetBytes }),
    ...(options.telemetry === undefined ? {} : { telemetry: options.telemetry }),
    clock,
  });
  const record = result.passes[0];
  if (record === undefined) {
    return {
      status: "failed",
      reasonCode: "error_episode_plan_provider_missing_result",
      summary: `provider step ${step.id} produced no pass record`,
    };
  }
  if (!turnAssignmentsEqual(record.assignment, step.assignment)) {
    throw new Error(`provider step ${step.id} executed a different atomic assignment`);
  }
  if (record.result.status !== "completed") {
    return {
      status: "failed",
      reasonCode: record.result.errorCode ?? `error_episode_plan_provider_${record.result.status}`,
      summary: record.result.summary,
      artifact: { runId: record.runId },
    };
  }
  return {
    status: "completed",
    artifact: {
      runId: record.runId,
      outputSha256: fingerprint(record.result.summary),
      artifactSha256: fingerprint(record.result.artifacts),
    },
  };
}

async function adaptiveAssignmentReadinessFailure(
  options: ExecuteAcceptedEpisodePlanOptions,
  step: ProviderTurnStep,
): Promise<EpisodeStepFailedOutcome | undefined> {
  if (options.intent.assignmentMode !== "adaptive") return undefined;
  if (options.assignmentReadinessProbe === undefined) {
    return {
      status: "failed",
      reasonCode: "plan_assignment_unavailable",
      summary:
        `adaptive provider step ${step.id} has no current non-billable readiness evidence; ` +
        "the persisted assignment was not executed or substituted",
    };
  }
  const readiness = await probeSelectedAssignmentReadiness({
    assignment: step.assignment,
    probe: options.assignmentReadinessProbe,
    ...(options.assignmentReadinessTimeoutMs === undefined
      ? {}
      : { timeoutMs: options.assignmentReadinessTimeoutMs }),
  });
  if (readiness.status === "ready") return undefined;
  return {
    status: "failed",
    reasonCode: "plan_assignment_unavailable",
    summary:
      `adaptive provider step ${step.id} assignment ` +
      `${step.assignment.harness}/${step.assignment.model}/${step.assignment.effort} is unavailable: ` +
      `${readiness.status}` +
      (readiness.errorCode === undefined ? "" : ` (${readiness.errorCode})`) +
      ` — ${readiness.detail}; the persisted assignment was not executed or substituted`,
  };
}

/** Durable terminal provider evidence for one step at one plan version.
 *  Shared by the recovery path and by the adopted-revision halt predicate so
 *  both answer "has this turn already happened?" from the same source. */
async function terminalProviderEvidence(
  root: string,
  episodeId: string,
  planVersion: number,
  stepId: string,
): Promise<Awaited<ReturnType<typeof readExecutionSteps>>[number] | undefined> {
  const terminal = (await readExecutionSteps(root, episodeId))
    .filter((record) =>
      record.kind === "provider" &&
      record.plan_version === planVersion &&
      record.plan_step_id === stepId,
    );
  if (terminal.length > 1) {
    throw new Error(`plan step ${stepId} has ${terminal.length} terminal provider executions`);
  }
  return terminal[0];
}

/** Can this provider step reach a terminal outcome without spending a new
 *  turn? A terminal execution record for this exact plan version is always
 *  enough; beyond that only the domain knows, because a preserved prior
 *  material event is reconciled inside its adapter. Default: no. */
async function completableWithoutNewProviderTurn(
  options: ExecuteAcceptedEpisodePlanOptions,
  plan: EpisodePlan,
  step: ProviderTurnStep,
): Promise<boolean> {
  const terminal = await terminalProviderEvidence(
    options.root,
    plan.episodeId,
    plan.version,
    step.id,
  );
  if (terminal !== undefined) return true;
  if (options.providerStepCompletableWithoutNewTurn === undefined) return false;
  return options.providerStepCompletableWithoutNewTurn(step, plan);
}

async function priorProviderEvidence(
  options: ExecuteAcceptedEpisodePlanOptions,
  step: ProviderTurnStep,
  execution: EpisodeStepExecutionContext,
): Promise<EpisodeStepCompletedOutcome | EpisodeStepFailedOutcome | undefined> {
  const prior = await terminalProviderEvidence(
    options.root,
    options.plan.episodeId,
    execution.planVersion,
    step.id,
  );
  if (prior !== undefined) return outcomeFromEvidence(prior, step);

  const pending = (await readPendingProviderSteps(options.root, options.plan.episodeId))
    .filter((receipt) =>
      receipt.plan_version === execution.planVersion &&
      receipt.plan_step_id === step.id,
    );
  if (pending.length > 0) {
    throw new Error(
      `plan step ${step.id} has an in-flight provider reservation; reconcile or resume it before retry`,
    );
  }
  return undefined;
}

function outcomeFromEvidence(
  record: ExecutionStepRecord,
  step: ProviderTurnStep,
): EpisodeStepCompletedOutcome | EpisodeStepFailedOutcome {
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
    throw new Error(`terminal provider evidence for ${step.id} differs from its accepted plan`);
  }
  const artifact = {
    executionStepId: record.execution_step_id,
    runId: record.run_id,
    artifactSha256: record.artifact_fingerprint,
  };
  return record.status === "completed"
    ? { status: "completed", artifact }
    : {
        status: "failed",
        reasonCode: record.error_code ?? `error_episode_plan_provider_${record.status}`,
        summary: record.reason,
        artifact,
      };
}

function exactAuthorization(
  passes: readonly AuthorizedPass[],
  step: ProviderTurnStep,
  execution: EpisodeStepExecutionContext,
): AuthorizedPass {
  const matches = passes.filter((pass) =>
    pass.pipeline === EPISODE_PLAN_EXECUTION_PIPELINE &&
    pass.pass === step.id &&
    pass.role === step.role &&
    pass.plan_version === execution.planVersion &&
    pass.plan_step_id === step.id &&
    pass.runtime === step.assignment.harness &&
    pass.model === step.assignment.model &&
    pass.effort === step.assignment.effort &&
    pass.assignment_source === step.assignmentSource,
  );
  if (matches.length !== 1) {
    throw new Error(`provider step ${step.id} must have exactly one durable route authorization`);
  }
  return matches[0]!;
}

function providerRuntimeCapabilities(step: ProviderTurnStep): RuntimeCapability[] {
  return [...new Set([
    ...BASELINE_PROVIDER_CAPABILITIES,
    ...step.requiredCapabilities.filter(isRuntimeCapability),
  ])].sort();
}

function renderProviderStepBrief(plan: EpisodePlan, step: ProviderTurnStep): string {
  return [
    `Execute accepted EpisodePlan v${plan.version}, step ${step.id}.`,
    `Objective: ${step.objective}`,
    `Role: ${step.role}`,
    `Dependencies: ${step.dependsOn.join(", ") || "none"}`,
    "Required input references:",
    JSON.stringify(step.inputRefs, null, 2),
    "Expected outputs:",
    JSON.stringify(step.expectedOutputs, null, 2),
    `Assignment rationale: ${step.selectionReason}`,
    "Do only this bounded step. Preserve role authority and return a concise result with artifact references.",
  ].join("\n");
}

function stableRunId(
  plan: EpisodePlan,
  step: ProviderTurnStep,
  execution: EpisodeStepExecutionContext,
): string {
  return mintRunId(
    new Date(plan.createdAt),
    EPISODE_PLAN_EXECUTION_PIPELINE,
    // Plan timestamps and step ids are intentionally deterministic, so two
    // episodes for the same app can legitimately start the same step in the
    // same second. Bind the efficiency-episode identity into the run id or the
    // second episode would reuse/overwrite the first episode's run directory.
    `${step.id}-${fingerprint(plan.episodeId).slice(0, 12)}-v${execution.planVersion}-a${execution.attempt}`,
  );
}

function assertInvocation(options: ExecuteAcceptedEpisodePlanOptions): void {
  if (options.intent.episodeId !== options.plan.episodeId) {
    throw new Error("episode execution intent and plan identities differ");
  }
  if (options.intent.app.length === 0) throw new Error("episode execution app is required");
  if (options.roles.length === 0) throw new Error("episode execution requires configured roles");
}
