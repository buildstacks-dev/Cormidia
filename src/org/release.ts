// Release handoff (docs/approvals/design.md A4): queue the exact
// declared command as a critical op, then execute it only on a later dispatch
// after the human-approved single-use grant exists. Execution is crash-safe
// and idempotent: an in-flight/terminal record prevents a deploy from being
// guessed-and-retried after an ambiguous process death.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  readExecutionSteps,
} from "../loop/efficiency.js";
import type {
  ApprovalStep,
  CreatorEpisodeScope,
  EpisodePlan,
  EpisodeStep,
  MechanicalGateStep,
  PlannedOutput,
  ProposedEpisodeStep,
  ProviderTurnStep,
  SafetyFact,
} from "../loop/episode-plan.js";
import { stableHash } from "../loop/episode-plan.js";
import type {
  ApprovalStepOutcome,
  EpisodePlanExecutionResult,
  EpisodeStepFailedOutcome,
} from "../loop/episode-plan-executor.js";
import type { LoopItem } from "../loop/types.js";
import { GhCliOps, type GhOps } from "../loop/github.js";
import { actionEffectFields, classifyWithEvidence, defaultGate } from "../runtime/gate.js";
import { getRuntime } from "../runtime/registry.js";
import { readEnvelope } from "../runtime/runlog/envelope.js";
import type { RuntimeReadinessProbe } from "../runtime/readiness.js";
import { runPaths } from "../runtime/runlog/paths.js";
import { recordInvocation } from "../runtime/telemetry.js";
import type {
  ContextBundle,
  GateFn,
  RoleConfig,
  Runtime,
  ToolAction,
  TurnAssignment,
} from "../runtime/types.js";
import { ApprovalStore, actionHash, type ApprovalItem } from "./approvals.js";
import type { AppEntry, AppsFile } from "./apps.js";
import { writeFileAtomic } from "./atomic.js";
import { isBudgetBlocking, rollupBudgets } from "./budget.js";
import { assembleContext } from "./context.js";
import {
  assignmentsForRole,
  resolveAppAssignments,
} from "./execution-assignments.js";
import { composeGate, grantScopeText } from "./gate-compose.js";
import {
  orchestrateEpisode,
  type EpisodeOrchestrationFacts,
} from "./episode-planner/orchestrator.js";
import { loadRoles } from "./roles.js";

const RELEASE_EPISODE_POLICY_VERSION = "approved-release/episode-plan-v1";
const RELEASE_OPERATION = "release/sre-approved-command";
const RELEASE_APPROVAL_STEP = "approve-release";
const RELEASE_PREFLIGHT_STEP = "release-preflight";
const RELEASE_EXECUTION_STEP = "execute-release";
const RELEASE_CONFIRM_STEP = "confirm-release-command";
const EMPTY_CONTEXT: ContextBundle = { taste: [], memoryExcerpts: [] };

export interface QueuedRelease {
  approvalId: string;
  ticketRef: string;
  kind: string;
  owner: string;
}

/** Raise one `production-deploy` approval item per merged loop item that
 *  carries a releaseTrigger. Attributed to the declared owner (orchestrator
 *  or sre) so the audit trail names who is accountable for the action. */
export async function queueReleaseApprovals(
  stateHome: string,
  app: string,
  items: readonly LoopItem[],
  now?: () => Date,
): Promise<QueuedRelease[]> {
  const queued: QueuedRelease[] = [];
  const store = new ApprovalStore(stateHome);
  for (const item of items) {
    if (item.phase !== "merged" || item.releaseTrigger === undefined) continue;
    const trigger = item.releaseTrigger;
    const action: ToolAction = {
      // Make the approval bind the executable action itself. A synthetic
      // `release` tool would mint a hash no bash action could consume.
      tool: "bash",
      input: { command: trigger.command },
    };
    const classification = classifyWithEvidence(action);
    const raised = await store.raise({
      app,
      role: trigger.owner,
      rule: "production-deploy",
      action,
      classification: classification.cls === "critical"
        ? classification.evidence
        : {
            schemaVersion: 1,
            rule: "production-deploy",
            reason: "merged release trigger declares a production delivery effect",
            matchedAction: actionEffectFields(action),
          },
      ticketRef: item.ticketRef,
      justification:
        `milestone ${item.ticketRef} merged with a declared ${trigger.kind} disposition; ` +
        `the app's release mechanism is owned by ${trigger.owner}`,
      ...(now !== undefined ? { now: now() } : {}),
    });
    queued.push({
      approvalId: raised.id,
      ticketRef: item.ticketRef,
      kind: trigger.kind,
      owner: trigger.owner,
    });
  }
  return queued;
}

export interface ReleaseCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface ReleaseExecutionRecord {
  schemaVersion: 1;
  approvalId: string;
  app: string;
  ticketRef: string;
  owner: "orchestrator" | "sre";
  command: string;
  status: "running" | "completed" | "failed";
  startedAt: string;
  finishedAt?: string;
  exitCode?: number;
  summary?: string;
  commentedAt?: string;
  commentError?: string;
}

export interface ExecuteApprovedReleasesOptions {
  stateHome: string;
  orgHome: string;
  appsFile: AppsFile;
  now?: () => Date;
  commandRunner?: (command: string, cwd: string, env: NodeJS.ProcessEnv) => Promise<ReleaseCommandResult>;
  ghFor?: (app: AppEntry) => GhOps;
  /** Exact assignment-aware factory. The legacy role-only seam remains for
   * existing callers, but it receives a role view carrying the persisted
   * assignment and may not return a different harness. */
  runtimeForAssignment?: (assignment: TurnAssignment, role: RoleConfig) => Runtime;
  runtimeFor?: (role: RoleConfig) => Runtime;
  assignmentReadinessProbe?: RuntimeReadinessProbe;
  assignmentReadinessTimeoutMs?: number;
}

export interface ReleaseExecutionOutcome {
  approvalId: string;
  app: string;
  status: "completed" | "failed" | "skipped";
  summary: string;
}

/** Stable durable EpisodePlan identity for one single-use approved release. */
export function approvedReleaseEpisodeId(app: string, approvalId: string): string {
  return `approved-release:${app}:${approvalId}`;
}

/** Execute every approved, unconsumed production release exactly once. This
 * is called by a later dispatch tick, never by the approval decision path. */
export async function executeApprovedReleases(
  options: ExecuteApprovedReleasesOptions,
): Promise<ReleaseExecutionOutcome[]> {
  const clock = options.now ?? (() => new Date());
  const store = new ApprovalStore(options.stateHome);
  const outcomes: ReleaseExecutionOutcome[] = [];
  for (const item of (await store.listDecided()).filter(isApprovedRelease)) {
    const existing = await readExecution(options.stateHome, item.id);
    if (existing !== undefined) {
      if (existing.status !== "running" && existing.commentedAt === undefined) {
        await commentOutcome(options, existing, clock);
      }
      // A running record is intentionally loud: the prior process may have
      // deployed and died before finalization, so automatic retry is unsafe.
      // Completed/failed history is quiet after any pending comment retry.
      if (existing.status === "running") {
        if (item.execution?.state === "executing") {
          await store.finishExecution({
            id: item.id,
            state: "ambiguous",
            actor: "orchestrator/release-reconcile",
            result: "release process stopped before acknowledgement; inspect before retrying",
            failureCause: "ambiguous_release_result",
            now: clock(),
          });
        }
        outcomes.push({
          approvalId: item.id,
          app: item.app,
          status: "skipped",
          summary: `release ${item.id} has an ambiguous running record; inspect before retrying`,
        });
      } else if (item.execution?.state === "executing" || item.execution?.state === "ambiguous") {
        await store.finishExecution({
          id: item.id,
          state: existing.status === "completed" ? "executed" : "failed",
          actor: "orchestrator/release-reconcile",
          result: existing.summary ?? existing.status,
          ...(existing.status === "failed" ? { failureCause: "release_failed" } : {}),
          now: clock(),
        });
      }
      continue;
    }

    // A process can stop after claiming the generic approval lifecycle but
    // before the specialized release record reaches disk. There is no safe
    // evidence that the remote command did or did not start, so make the
    // uncertainty durable and require reconciliation/human disposition. A
    // later dispatch must never treat the missing record as permission to run.
    if (item.execution?.state === "executing") {
      await store.finishExecution({
        id: item.id,
        state: "ambiguous",
        actor: "orchestrator/release-reconcile",
        result: "release claim exists without an execution record; inspect before retrying",
        failureCause: "ambiguous_release_result",
        now: clock(),
      });
      outcomes.push({
        approvalId: item.id,
        app: item.app,
        status: "skipped",
        summary: `release ${item.id} has a claim without an execution record; inspect before retrying`,
      });
      continue;
    }
    if (item.execution?.state === "ambiguous") {
      outcomes.push({
        approvalId: item.id,
        app: item.app,
        status: "skipped",
        summary: `release ${item.id} remains ambiguous; inspect before retrying`,
      });
      continue;
    }
    if (item.execution?.state === "executed" || item.execution?.state === "failed") continue;

    const shown = await store.show(item.id);
    if (shown.grant === undefined || shown.grant.uses <= 0 || shown.grant.revokedAt !== undefined) {
      continue;
    }
    if (new Date(shown.grant.expiresAt).getTime() <= clock().getTime()) continue;

    if (item.execution?.executor === "release") {
      const claimed = await store.beginExecution(item.id, "orchestrator/release", clock());
      if (claimed === undefined) continue;
    }

    const app = options.appsFile.apps.find((entry) => entry.name === item.app);
    const command = releaseCommand(item);
    const ticketRef = item.ticketRef;
    const owner = item.role;
    if (app === undefined || command === undefined || ticketRef === undefined || !isReleaseOwner(owner)) {
      if (item.execution?.executor === "release") {
        await store.finishExecution({
          id: item.id,
          state: "failed",
          actor: "orchestrator/release",
          result: `approved release ${item.id} has invalid app/owner/command/ticket metadata`,
          failureCause: "invalid_release_metadata",
          now: clock(),
        });
      }
      outcomes.push({
        approvalId: item.id,
        app: item.app,
        status: "failed",
        summary: `approved release ${item.id} has invalid app/owner/command/ticket metadata`,
      });
      continue;
    }

    const started = clock();
    let record: ReleaseExecutionRecord = {
      schemaVersion: 1,
      approvalId: item.id,
      app: item.app,
      ticketRef,
      owner,
      command,
      status: "running",
      startedAt: started.toISOString(),
    };
    await writeExecution(options.stateHome, record);

    try {
      const result = await executeReleaseEpisode(options, store, item, app, command);
      record = {
        ...record,
        status: result.exitCode === 0 ? "completed" : "failed",
        finishedAt: clock().toISOString(),
        exitCode: result.exitCode,
        summary: releaseSummary(result),
      };
    } catch (error) {
      record = {
        ...record,
        status: "failed",
        finishedAt: clock().toISOString(),
        summary: releaseErrorSummary(error),
      };
    }
    await writeExecution(options.stateHome, record);
    if (item.execution?.executor === "release") {
      await store.finishExecution({
        id: item.id,
        state: record.status === "completed" ? "executed" : "failed",
        actor: "orchestrator/release",
        result: record.summary ?? record.status,
        ...(record.status === "failed" ? { failureCause: "release_failed" } : {}),
        now: clock(),
      });
    }
    await recordInvocation(options.stateHome, {
      at: record.finishedAt ?? clock().toISOString(),
      kind: "release",
      app: record.app,
      outcome: `${record.approvalId} ${record.status}: ${record.summary ?? "no summary"}`,
      wallClockMs: Math.max(0, clock().getTime() - started.getTime()),
    });
    await commentOutcome(options, record, clock);
    const persisted = (await readExecution(options.stateHome, item.id)) ?? record;
    outcomes.push({
      approvalId: item.id,
      app: item.app,
      status: record.status === "completed" ? "completed" : "failed",
      summary:
        persisted.commentError === undefined
          ? record.summary ?? record.status
          : `${record.summary ?? record.status}; ticket comment failed: ${persisted.commentError}`,
    });
  }
  return outcomes;
}

interface ReleaseEpisodeDefinition {
  episodeId: string;
  scope: CreatorEpisodeScope;
  safetyFacts: SafetyFact[];
  expectedSteps: EpisodeStep[];
  providerBudgetUsd: number;
}

/**
 * Execute an approved release through the same durable plan boundary as every
 * other episode. The ApprovalStore remains the authority: the plan approval
 * step observes the already-approved single-use grant but does not consume it;
 * only the exact command gate/mechanical command consumes that grant.
 */
async function executeReleaseEpisode(
  options: ExecuteApprovedReleasesOptions,
  store: ApprovalStore,
  item: ApprovalItem,
  app: AppEntry,
  command: string,
): Promise<ReleaseCommandResult> {
  const roles = await loadRoles(join(options.orgHome, "roles.yaml"));
  const cwd = managedClone(options.stateHome, app);
  const plannerRole = requireReleaseRole(roles.roles, "planner");
  const sreRole = item.role === "sre" ? requireReleaseRole(roles.roles, "sre") : undefined;
  const definition = await buildReleaseEpisodeDefinition(
    options,
    item,
    app,
    roles.roles,
    command,
    sreRole,
  );
  const runtimeForAssignment = releaseRuntimeFactory(options);
  const context = sreRole === undefined
    ? EMPTY_CONTEXT
    : (
        await assembleContext({
          orgHome: options.orgHome,
          appWorkdir: cwd,
          app: app.name,
          role: sreRole,
          taskText: `execute approved release ${item.id} for ${item.ticketRef ?? "unknown ticket"}`,
        })
      ).bundle;
  let attempted = false;
  let commandResult: ReleaseCommandResult | undefined;
  const gate = sreRole === undefined
    ? defaultGate
    : sreReleaseGate(options, store, item, command, () => attempted, () => {
        attempted = true;
      });
  const facts: EpisodeOrchestrationFacts = releaseEpisodeFacts(
    definition,
    item,
    app,
    command,
  );
  const orchestrated = await orchestrateEpisode({
    root: options.stateHome,
    app,
    roles: roles.roles,
    facts,
    mode: "execute",
    ...(options.assignmentReadinessProbe === undefined
      ? {}
      : { assignmentReadinessProbe: options.assignmentReadinessProbe }),
    ...(options.assignmentReadinessTimeoutMs === undefined
      ? {}
      : { assignmentReadinessTimeoutMs: options.assignmentReadinessTimeoutMs }),
    planner: {
      // This creator scope is deliberately execution-ready. Any provider call
      // here would be recursive/redundant planning and is a closed failure.
      promptText: "",
      context: EMPTY_CONTEXT,
      workdir: cwd,
      hooks: { gate: defaultGate },
      runtimeForAssignment,
      policyVersion: RELEASE_EPISODE_POLICY_VERSION,
      limits: unusedReleasePlannerLimits(plannerRole.maxTurnBudgetUsd),
      validateAcceptedPlan: (plan) => assertReleaseEpisodePlan(plan, definition),
      ...(options.now === undefined ? {} : { now: options.now }),
    },
    execution: {
      workdir: cwd,
      hooks: { gate },
      runtimeForAssignment,
      contextForProviderStep: () => context,
      mechanical: async (step) => {
        if (step.id === RELEASE_PREFLIGHT_STEP && step.gate === "release") {
          const problem = await releaseApprovalProblem(options, store, item);
          return problem === undefined
            ? {
                status: "completed",
                artifact: { approvalId: item.id, actionHash: actionHash(item.action) },
              }
            : releaseStepFailure("error_release_preflight", problem);
        }
        if (
          item.role === "orchestrator" &&
          step.id === RELEASE_EXECUTION_STEP &&
          step.gate === "release-command"
        ) {
          commandResult = await runApprovedOrchestratorCommand(
            options,
            store,
            item,
            app,
            command,
          );
          return commandResult.exitCode === 0
            ? { status: "completed", artifact: releaseCommandArtifact(commandResult) }
            : releaseStepFailure(
                "error_release_command_failed",
                releaseSummary(commandResult),
                releaseCommandArtifact(commandResult),
              );
        }
        if (
          item.role === "sre" &&
          step.id === RELEASE_CONFIRM_STEP &&
          step.gate === "release-command-attempted"
        ) {
          return attempted
            ? {
                status: "completed",
                artifact: { approvalId: item.id, exactCommandAttempted: true },
              }
            : releaseStepFailure(
                "error_release_command_not_attempted",
                "SRE release turn completed without attempting the approved command",
              );
        }
        return releaseStepFailure(
          "error_release_plan_operation_unknown",
          `release plan contains unknown mechanical operation ${step.id}/${step.gate}`,
        );
      },
      approval: (step) => executeReleaseApprovalStep(options, store, item, step),
      telemetry: { orgDir: options.stateHome, trigger: "manual" },
      ...(options.now === undefined ? {} : { now: options.now }),
    },
  });
  if (orchestrated.prepared.planningTurnSkipped !== true || orchestrated.prepared.plannerAttempts !== 0) {
    throw new Error("approved release unexpectedly invoked EpisodePlanner");
  }
  assertReleaseEpisodePlan(orchestrated.prepared.plan, definition);

  if (item.role === "orchestrator") {
    return commandResult ?? releaseFailureResult(orchestrated.execution);
  }
  if (!attempted) {
    throw new Error("SRE release turn completed without attempting the approved command");
  }
  return releaseProviderResult(
    options.stateHome,
    app.name,
    orchestrated.prepared.plan,
    orchestrated.execution,
  );
}

async function buildReleaseEpisodeDefinition(
  options: ExecuteApprovedReleasesOptions,
  item: ApprovalItem,
  app: AppEntry,
  roles: readonly RoleConfig[],
  command: string,
  sreRole: RoleConfig | undefined,
): Promise<ReleaseEpisodeDefinition> {
  const resolved = resolveAppAssignments(app, roles);
  let providerAssignment: TurnAssignment | undefined;
  let providerBudgetUsd = 0;
  if (sreRole !== undefined) {
    const budget = (await rollupBudgets(
      options.stateHome,
      options.appsFile,
      options.now?.() ?? new Date(),
    )).find((entry) => entry.app === app.name);
    if (budget === undefined) throw new Error(`release: no budget policy for ${app.name}`);
    if (isBudgetBlocking(budget.status)) {
      throw new Error(
        budget.status === "unknown"
          ? `release: ${app.name} budget is unverifiable; reconcile before an SRE provider turn`
          : `release: ${app.name} has exhausted its provider budget`,
      );
    }
    const remaining = Math.max(0, budget.budgetUsd - budget.spentUsd);
    const selected = assignmentsForRole(resolved, "sre")[0];
    if (selected === undefined) throw new Error("release: no approved assignment for sre");
    providerAssignment = { ...selected.assignment };
    providerBudgetUsd = Math.min(
      remaining,
      sreRole.maxTurnBudgetUsd,
      selected.maxTurnCostUsd,
    );
    if (!Number.isFinite(providerBudgetUsd) || providerBudgetUsd <= 0) {
      throw new Error("release: no positive app/role budget remains for the SRE provider turn");
    }
  }

  const episodeId = approvedReleaseEpisodeId(app.name, item.id);
  const actionRef = releaseActionRef(item);
  const finalOutput: PlannedOutput = {
    id: "release-outcome",
    kind: "approved-release-outcome",
    required: true,
  };
  const approval: ApprovalStep = {
    kind: "approval",
    id: RELEASE_APPROVAL_STEP,
    objective: `Confirm the existing human approval and exact single-use grant for ${item.id}`,
    dependsOn: [],
    inputRefs: [{ ref: actionRef, required: true }],
    expectedOutputs: [],
    approvalKind: "critical-operation",
    actionRef,
  };
  const preflight: MechanicalGateStep = {
    kind: "mechanical_gate",
    id: RELEASE_PREFLIGHT_STEP,
    objective: "Validate that the approved release command still has an exact unconsumed grant",
    dependsOn: [RELEASE_APPROVAL_STEP],
    inputRefs: [{ ref: actionRef, required: true }],
    expectedOutputs: [],
    gate: "release",
  };
  const proposedSteps: ProposedEpisodeStep[] = [approval, preflight];
  const expectedSteps: EpisodeStep[] = [approval, preflight];

  if (item.role === "sre") {
    if (providerAssignment === undefined || sreRole === undefined) {
      throw new Error("release: SRE plan lacks an exact approved assignment");
    }
    const providerProposal = {
      kind: "provider_turn" as const,
      id: RELEASE_EXECUTION_STEP,
      operation: RELEASE_OPERATION,
      role: "sre",
      objective: approvedReleaseObjective(item, app, command),
      dependsOn: [RELEASE_PREFLIGHT_STEP],
      requiredCapabilities: ["tool_gate"],
      inputRefs: [{ ref: actionRef, required: true }],
      expectedOutputs: [{ id: "sre-release-report", kind: "release-report", required: false }],
      maxTurnBudgetUsd: providerBudgetUsd,
      selectionReason:
        resolved.mode === "fixed"
          ? "Approved SRE release; exact assignment resolves from fixed role configuration"
          : "Approved SRE release; creator selected an exact app-narrowed approved assignment",
      ...(resolved.mode === "adaptive" ? { assignment: { ...providerAssignment } } : {}),
    };
    const providerStep: ProviderTurnStep = {
      ...providerProposal,
      assignment: { ...providerAssignment },
      assignmentSource: resolved.mode === "fixed" ? "configured" : "creator",
    };
    const confirmation: MechanicalGateStep = {
      kind: "mechanical_gate",
      id: RELEASE_CONFIRM_STEP,
      objective: "Confirm that the SRE turn attempted the one exact approved command",
      dependsOn: [RELEASE_EXECUTION_STEP],
      inputRefs: [{ ref: actionRef, required: true }],
      expectedOutputs: [finalOutput],
      gate: "release-command-attempted",
    };
    proposedSteps.push(providerProposal, confirmation);
    expectedSteps.push(providerStep, confirmation);
  } else {
    const commandStep: MechanicalGateStep = {
      kind: "mechanical_gate",
      id: RELEASE_EXECUTION_STEP,
      objective: "Execute the exact approved orchestrator-owned release command once",
      dependsOn: [RELEASE_PREFLIGHT_STEP],
      inputRefs: [{ ref: actionRef, required: true }],
      expectedOutputs: [finalOutput],
      gate: "release-command",
    };
    proposedSteps.push(commandStep);
    expectedSteps.push(commandStep);
  }

  const evidenceRefs = [
    `approval:${item.id}`,
    `release-action:${actionHash(item.action)}`,
    ...(item.ticketRef === undefined ? [] : [`ticket:${item.ticketRef}`]),
  ];
  const safetyFacts: SafetyFact[] = [
    { kind: "critical_operation", evidenceRefs: [...evidenceRefs] },
    { kind: "release", evidenceRefs: [...evidenceRefs] },
  ];
  const scope: CreatorEpisodeScope = {
    planningDisposition: "execution_ready",
    provenance: {
      source: "agent",
      creatorId: "orchestrator/release",
      createdAt: item.decidedAt ?? item.raisedAt,
      evidenceRefs,
    },
    workKind: `approved-release:${item.role}`,
    objective: `Execute approved release ${item.id} for ${app.name}`,
    inScope: ["The exact approved release command and its single-use grant"],
    outOfScope: ["Command substitutions", "additional smoke checks", "rollback actions", "unapproved follow-up work"],
    acceptanceCriteria: [
      "The persisted plan observes the existing approval before execution",
      "Only the exact approved command may consume the single-use grant",
      "The command outcome is durably journaled without an implicit retry",
    ],
    expectedArtifacts: [finalOutput],
    declaredConstraints: {
      approvalId: item.id,
      actionHash: actionHash(item.action),
      app: app.name,
      owner: item.role,
      command,
      ticketRef: item.ticketRef ?? null,
      grantConsumptionBoundary: "exact-release-command-only",
    },
    safetyFacts,
    steps: proposedSteps,
  };
  return {
    episodeId,
    scope,
    safetyFacts,
    expectedSteps,
    providerBudgetUsd,
  };
}

function releaseEpisodeFacts(
  definition: ReleaseEpisodeDefinition,
  item: ApprovalItem,
  app: AppEntry,
  command: string,
): EpisodeOrchestrationFacts {
  return {
    episodeId: definition.episodeId,
    trigger: {
      kind: "approved_release",
      sourceRef: `approval:${item.id}`,
      payloadHash: stableHash({
        approvalId: item.id,
        actionHash: actionHash(item.action),
        app: app.name,
        owner: item.role,
        ticketRef: item.ticketRef ?? null,
      }),
    },
    goal: definition.scope.objective,
    lifecycle: "approved-release",
    appStage: app.status,
    repositoryFacts: {
      targetRepo: app.repo,
      managedClonePresent: true,
    },
    requestedConstraints: {
      approvalId: item.id,
      actionHash: actionHash(item.action),
      owner: item.role,
      command,
      commandSubstitutionAllowed: false,
      retryAmbiguousExecution: false,
    },
    hardBudget: {
      maxProviderTurns: item.role === "sre" ? 1 : 0,
      maxEquivalentCostUsd: definition.providerBudgetUsd,
      maxMechanicalOverheadUsd: 0,
      maxActiveTimeMs: item.role === "sre" ? 30 * 60_000 : 60_000,
      maxHumanDecisions: 1,
    },
    requiredSafetyFacts: structuredClone(definition.safetyFacts),
    responsibilityByRole: item.role === "sre"
      ? { sre: "Own only the exact already-approved release command" }
      : {},
    creatorScope: structuredClone(definition.scope),
  };
}

function assertReleaseEpisodePlan(plan: EpisodePlan, definition: ReleaseEpisodeDefinition): void {
  if (plan.episodeId !== definition.episodeId) {
    throw new Error(`release EpisodePlan identity changed from ${definition.episodeId}`);
  }
  if (plan.planningSource !== "creator_scope") {
    throw new Error("approved release must use its explicit creator scope");
  }
  if (stableHash(plan.steps) !== stableHash(definition.expectedSteps)) {
    throw new Error("approved release EpisodePlan differs from the code-owned operation graph or assignment");
  }
}

async function executeReleaseApprovalStep(
  options: ExecuteApprovedReleasesOptions,
  store: ApprovalStore,
  item: ApprovalItem,
  step: ApprovalStep,
): Promise<ApprovalStepOutcome> {
  if (
    step.id !== RELEASE_APPROVAL_STEP ||
    step.approvalKind !== "critical-operation" ||
    step.actionRef !== releaseActionRef(item)
  ) {
    return releaseStepFailure(
      "error_release_approval_binding",
      "release approval step is not bound to the approved action",
    );
  }
  const problem = await releaseApprovalProblem(options, store, item);
  return problem === undefined
    ? {
        status: "completed",
        artifact: { approvalId: item.id, actionHash: actionHash(item.action) },
      }
    : releaseStepFailure("error_release_approval_unavailable", problem);
}

async function releaseApprovalProblem(
  options: ExecuteApprovedReleasesOptions,
  store: ApprovalStore,
  item: ApprovalItem,
): Promise<string | undefined> {
  try {
    const shown = await store.show(item.id);
    if (
      shown.item.status !== "approved" ||
      shown.item.decision !== "approved" ||
      shown.item.rule !== "production-deploy" ||
      shown.item.app !== item.app ||
      shown.item.role !== item.role ||
      actionHash(shown.item.action) !== actionHash(item.action)
    ) {
      return `release ${item.id}: approval metadata changed before execution`;
    }
    if (findReleaseGrant(options, store, item) === undefined) {
      return `release ${item.id}: approved grant does not match the command`;
    }
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function findReleaseGrant(
  options: ExecuteApprovedReleasesOptions,
  store: ApprovalStore,
  item: ApprovalItem,
) {
  const common = {
    app: item.app,
    role: item.role,
    actionHash: actionHash(item.action),
    // A-005/P0-04b: the matcher sees normalized semantic target text, never
    // raw JSON containing agent-influenceable shell comments.
    actionText: grantScopeText(item.action),
    now: options.now?.() ?? new Date(),
  };
  return item.role === "orchestrator"
    ? store.findMatchingGrantSync({
        ...common,
        rule: item.rule,
        ...(item.ticketRef === undefined ? {} : { ticketRef: item.ticketRef }),
      })
    : store.findMatchingGrantSync(common);
}

async function runApprovedOrchestratorCommand(
  options: ExecuteApprovedReleasesOptions,
  store: ApprovalStore,
  item: ApprovalItem,
  app: AppEntry,
  command: string,
): Promise<ReleaseCommandResult> {
  const grant = findReleaseGrant(options, store, item);
  if (grant === undefined) throw new Error(`release ${item.id}: approved grant does not match the command`);
  // This is deliberately the first grant consumption in the plan. The prior
  // approval and release-preflight steps only observe the grant.
  store.consumeGrantSync(grant.grantId, options.now?.() ?? new Date());
  const cwd = managedClone(options.stateHome, app);
  return (options.commandRunner ?? runReleaseCommand)(command, cwd, { ...process.env, CI: "1" });
}

function sreReleaseGate(
  options: ExecuteApprovedReleasesOptions,
  store: ApprovalStore,
  item: ApprovalItem,
  command: string,
  attempted: () => boolean,
  markAttempted: () => void,
): GateFn {
  const baseGate = composeGate(defaultGate, store, {
    app: item.app,
    role: item.role,
    ...(item.ticketRef !== undefined ? { ticketRef: item.ticketRef } : {}),
    orgHome: options.orgHome,
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  return (action) => {
    if (!attempted() && sameReleaseCommand(action, command)) {
      const grant = findReleaseGrant(options, store, item);
      if (grant === undefined) {
        return {
          allow: false,
          reason: "approved release grant is unavailable",
          escalate: false,
        };
      }
      // The exact approved command is the sole SRE consumption boundary.
      store.consumeGrantSync(grant.grantId, options.now?.() ?? new Date());
      markAttempted();
      return { allow: true };
    }
    return baseGate(action);
  };
}

function releaseRuntimeFactory(options: ExecuteApprovedReleasesOptions) {
  return (assignment: TurnAssignment, role: RoleConfig): Runtime => {
    const effectiveRole: RoleConfig = {
      ...role,
      runtime: assignment.harness,
      model: assignment.model,
      effort: assignment.effort,
    };
    const runtime = options.runtimeForAssignment?.(assignment, role) ??
      options.runtimeFor?.(effectiveRole) ??
      getRuntime(assignment.harness);
    if (runtime.kind !== assignment.harness) {
      throw new Error(
        `release runtime factory returned ${runtime.kind} for persisted ${assignment.harness} assignment`,
      );
    }
    return runtime;
  };
}

async function releaseProviderResult(
  root: string,
  app: string,
  plan: EpisodePlan,
  execution: EpisodePlanExecutionResult | null,
): Promise<ReleaseCommandResult> {
  const evidence = (await readExecutionSteps(root, plan.episodeId)).filter((step) =>
    step.kind === "provider" &&
    step.plan_version === plan.version &&
    step.plan_step_id === RELEASE_EXECUTION_STEP,
  );
  if (evidence.length !== 1) {
    throw new Error(`SRE release turn has ${evidence.length} terminal provider records`);
  }
  const record = evidence[0]!;
  const envelope = await readEnvelope(root, app, record.run_id);
  let output = record.reason;
  try {
    output = await readFile(runPaths(root, app, record.run_id).output, "utf8");
  } catch {
    // The terminal execution step remains the authoritative fallback.
  }
  const completed =
    execution?.status === "completed" &&
    record.status === "completed" &&
    envelope.status === "completed";
  return {
    exitCode: completed ? 0 : 1,
    stdout: completed ? output : "",
    stderr: completed ? "" : execution?.summary ?? output,
  };
}

function releaseFailureResult(execution: EpisodePlanExecutionResult | null): ReleaseCommandResult {
  const summary = execution?.summary ?? "approved release EpisodePlan did not complete";
  return { exitCode: 1, stdout: "", stderr: summary };
}

function releaseStepFailure(
  reasonCode: string,
  summary: string,
  artifact?: unknown,
): EpisodeStepFailedOutcome {
  return {
    status: "failed",
    reasonCode,
    summary,
    ...(artifact === undefined ? {} : { artifact }),
  };
}

function releaseCommandArtifact(result: ReleaseCommandResult): Record<string, string | number> {
  return {
    exitCode: result.exitCode,
    stdoutSha256: stableHash(result.stdout),
    stderrSha256: stableHash(result.stderr),
  };
}

function releaseActionRef(item: ApprovalItem): string {
  return `approval:${item.id}:action-sha256:${actionHash(item.action)}`;
}

function approvedReleaseObjective(item: ApprovalItem, app: AppEntry, command: string): string {
  return [
    `Approved production release ${item.id} for ${app.name}.`,
    `Run exactly this already-approved command once: ${command}`,
    "Do not add prefixes, suffixes, substitutions, smoke checks, rollback, or follow-up actions.",
    "Report the command outcome only.",
  ].join(" ");
}

function requireReleaseRole(roles: readonly RoleConfig[], name: string): RoleConfig {
  const role = roles.find((entry) => entry.name === name);
  if (role === undefined) throw new Error(`release: requires ${name} in roles.yaml`);
  return role;
}

function unusedReleasePlannerLimits(roleBudgetUsd: number) {
  const equivalentCostUsd = Math.min(roleBudgetUsd, 0.01);
  return {
    maxAttempts: 1,
    perAttempt: { equivalentCostUsd, activeTimeMs: 1 },
    aggregate: {
      providerTurns: 1,
      equivalentCostUsd,
      activeTimeMs: 1,
    },
  };
}

function managedClone(stateHome: string, app: AppEntry): string {
  const path = join(stateHome, "repos", app.name);
  if (!existsSync(path)) {
    throw new Error(`release: managed clone missing for ${app.name}: ${path}`);
  }
  return path;
}

function isApprovedRelease(item: ApprovalItem): boolean {
  return item.rule === "production-deploy" && item.status === "approved" && item.decision === "approved";
}

function isReleaseOwner(value: string): value is "orchestrator" | "sre" {
  return value === "orchestrator" || value === "sre";
}

function releaseCommand(item: ApprovalItem): string | undefined {
  if (item.action.tool === "bash" && isRecord(item.action.input) && typeof item.action.input.command === "string") {
    return item.action.input.command;
  }
  // Backward compatibility for approvals queued before issue #18 landed.
  if (item.action.tool === "release" && isRecord(item.action.input) && typeof item.action.input.command === "string") {
    return item.action.input.command;
  }
  return undefined;
}

function sameReleaseCommand(action: ToolAction, expected: string): boolean {
  if (action.tool !== "bash" || !isRecord(action.input) || typeof action.input.command !== "string") return false;
  const actual = action.input.command.trim();
  if (actual === expected.trim()) return true;
  const wrapped = /^(?:\/bin\/)?(?:zsh|bash|sh)\s+-lc\s+(.+)$/.exec(actual)?.[1];
  return wrapped !== undefined && decodeShellWord(wrapped) === expected.trim();
}

function decodeShellWord(value: string): string {
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/'\\''/g, "'");
  }
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value) as string;
    } catch {
      return value;
    }
  }
  return value;
}

async function commentOutcome(
  options: ExecuteApprovedReleasesOptions,
  record: ReleaseExecutionRecord,
  clock: () => Date,
): Promise<void> {
  const issueNumber = Number(/^#(\d+)$/.exec(record.ticketRef)?.[1]);
  const app = options.appsFile.apps.find((entry) => entry.name === record.app);
  if (!Number.isInteger(issueNumber) || app === undefined) return;
  try {
    await (options.ghFor?.(app) ?? new GhCliOps(app.repo)).commentIssue(
      issueNumber,
      [
        "## Cormidia release outcome",
        "",
        `- Approval: \`${record.approvalId}\``,
        `- Owner: \`${record.owner}\``,
        `- Status: **${record.status}**`,
        `- Command: \`${record.command.replace(/`/g, "\\`")}\``,
        ...(record.exitCode !== undefined ? [`- Exit code: \`${record.exitCode}\``] : []),
        "",
        record.summary ?? "No command summary was captured.",
      ].join("\n"),
    );
    const { commentError: _commentError, ...withoutCommentError } = record;
    await writeExecution(options.stateHome, { ...withoutCommentError, commentedAt: clock().toISOString() });
  } catch (error) {
    await writeExecution(options.stateHome, {
      ...record,
      commentError: error instanceof Error ? error.message : String(error),
    });
  }
}

async function readExecution(stateHome: string, approvalId: string): Promise<ReleaseExecutionRecord | undefined> {
  const path = executionPath(stateHome, approvalId);
  if (!existsSync(path)) return undefined;
  return JSON.parse(await readFile(path, "utf8")) as ReleaseExecutionRecord;
}

async function writeExecution(stateHome: string, record: ReleaseExecutionRecord): Promise<void> {
  const path = executionPath(stateHome, record.approvalId);
  await mkdir(join(stateHome, "releases"), { recursive: true });
  await writeFileAtomic(path, `${JSON.stringify(record, null, 2)}\n`);
}

function executionPath(stateHome: string, approvalId: string): string {
  return join(stateHome, "releases", `${approvalId}.json`);
}

function releaseSummary(result: ReleaseCommandResult): string {
  const detail = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n");
  return `command exited ${result.exitCode}${detail.length > 0 ? `\n${tail(detail, 4000)}` : ""}`;
}

function tail(value: string, max: number): string {
  return value.length <= max ? value : value.slice(value.length - max);
}

function releaseErrorSummary(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  return error.cause instanceof Error
    ? `${error.message}: ${error.cause.message}`
    : error.message;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function runReleaseCommand(
  command: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<ReleaseCommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, { cwd, env, shell: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => { stdout = tail(stdout + chunk.toString("utf8"), 16_000); });
    child.stderr?.on("data", (chunk: Buffer) => { stderr = tail(stderr + chunk.toString("utf8"), 16_000); });
    child.once("error", reject);
    child.once("close", (code) => resolve({ exitCode: code ?? 1, stdout, stderr }));
  });
}
