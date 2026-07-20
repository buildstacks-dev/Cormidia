import { readFile } from "node:fs/promises";
import { isAbsolute, normalize } from "node:path";
import {
  fingerprint,
  readExecutionSteps,
  readRouteRecord,
  type AuthorizedPass,
  type ExecutionStepRecord,
} from "../loop/efficiency.js";
import {
  stableHash,
  readEpisodePlanVersion,
  type BudgetCeiling,
  type CreatorEpisodeScope,
  type CreatorScopeProvenance,
  type EpisodePlan,
  type JsonValue,
  type PlannedInputRef,
  type PlannedOutput,
  type ProposedEpisodeStep,
  type ProposedProviderTurnStep,
  type ProviderTurnStep,
  type SafetyFact,
} from "../loop/episode-plan.js";
import type {
  EpisodePlanExecutionResult,
  EpisodeStepCompletedOutcome,
  EpisodeStepExecutionContext,
  EpisodeStepFailedOutcome,
} from "../loop/episode-plan-executor.js";
import {
  EPISODE_PLAN_EXECUTION_PIPELINE,
  planRouteLabel,
} from "../loop/episode-route.js";
import {
  executePipeline,
  type ExecutePipelineOptions,
  type PassRunRecord,
  type VerdictRecordContext,
  type VerdictRecordOutcome,
} from "../loop/pipeline.js";
import {
  parallelStages,
  type PassConfig,
  type PipelineConfig,
} from "../loop/pipelines.js";
import { mintRunId, runPaths } from "../runtime/runlog/paths.js";
import {
  probeRuntimeReadiness,
  type RuntimeReadinessProbe,
} from "../runtime/readiness.js";
import {
  createEventWriter,
  readEvents,
} from "../runtime/runlog/events.js";
import {
  readEnvelope,
  type EnvelopeStatus,
} from "../runtime/runlog/envelope.js";
import {
  fixedAssignmentFromRole,
  turnAssignmentKey,
  turnAssignmentsEqual,
} from "../runtime/assignment.js";
import {
  isRuntimeCapability,
  resolvedRuntimeCapabilities,
  type RuntimeCapability,
} from "../runtime/capabilities.js";
import type {
  ContextBundle,
  RoleConfig,
  Runtime,
  TurnAssignment,
  TurnHooks,
  TurnResult,
} from "../runtime/types.js";
import type { AppEntry } from "./apps.js";
import { resolveAppAssignments } from "./execution-assignments.js";
import {
  executeAcceptedEpisodePlan,
} from "./episode-planner/execution.js";
import {
  orchestrateEpisode,
  type EpisodeOrchestrationFacts,
  type OrchestratedEpisode,
} from "./episode-planner/orchestrator.js";
import type { EpisodeSafetyFloorMapping } from "./episode-planner/policy.js";

export const GOVERNED_PIPELINE_EPISODE_POLICY_VERSION =
  "governed-pipeline-episode/v1" as const;

const IDENTIFIER = /^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*$/;
const EMPTY_CONTEXT: ContextBundle = { taste: [], memoryExcerpts: [] };
const BASELINE_PROVIDER_CAPABILITIES = [
  "tool_gate",
  "cancellation",
  "session_resume",
] as const satisfies readonly RuntimeCapability[];

export interface GovernedPipelineScopeOptions {
  app: AppEntry;
  roles: readonly RoleConfig[];
  /** The already-loaded, human-ratified pipeline. */
  pipeline: PipelineConfig;
  /** Exact configured passes selected by deterministic caller policy. */
  selectedPasses: readonly PassConfig[];
  provenance: CreatorScopeProvenance;
  objective: string;
  inScope: string[];
  outOfScope: string[];
  acceptanceCriteria: string[];
  declaredConstraints?: Record<string, JsonValue>;
  safetyFacts?: SafetyFact[];
  inputRefs?: PlannedInputRef[];
  requiredCapabilitiesByRole?: Readonly<Record<string, readonly string[]>>;
  /** Optional code-owned wording; keys must name selected pass ids exactly. */
  objectiveByPass?: Readonly<Record<string, string>>;
  /** Optional output vocabulary; keys must name selected pass ids exactly. */
  outputKindByPass?: Readonly<Record<string, string>>;
}

export interface GovernedPipelineBinding {
  stepId: string;
  operation: string;
  pass: PassConfig;
  proposedStep: ProposedProviderTurnStep;
  assignment: TurnAssignment;
}

/**
 * Immutable adapter view of one selected governed pipeline. `workflowTemplates`
 * is passed to EpisodePlanner normalization, so the creator scope names an
 * explicit governed template instead of smuggling a static workflow around
 * the planning boundary.
 */
export interface GovernedPipelineEpisodeDefinition {
  pipeline: PipelineConfig;
  selectedPasses: PassConfig[];
  templateRef: NonNullable<CreatorEpisodeScope["workflowTemplate"]>;
  templateHash: string;
  scope: CreatorEpisodeScope;
  steps: ProposedEpisodeStep[];
  bindings: GovernedPipelineBinding[];
  workflowTemplates: ReadonlyMap<string, readonly ProposedEpisodeStep[]>;
}

export class GovernedPipelineEpisodeError extends Error {
  readonly code = "error_governed_pipeline_episode_invalid" as const;
  constructor(message: string) {
    super(message);
    this.name = "GovernedPipelineEpisodeError";
  }
}

/** The only operation spelling accepted for a governed pipeline pass. */
export function governedPipelineOperation(pipelineName: string, passId: string): string {
  assertIdentifier("pipeline name", pipelineName);
  assertIdentifier("pipeline pass id", passId);
  return `pipeline/${pipelineName}/${passId}`;
}

/**
 * Normalize selected pipeline passes into an explicit execution-ready creator
 * scope. Fixed mode deliberately omits proposed assignments for ordinary
 * materialization; adaptive mode chooses the first exact tuple remaining in
 * the app-narrowed, org-approved catalog that supports the requested caps.
 */
export function buildGovernedPipelineEpisodeDefinition(
  options: GovernedPipelineScopeOptions,
): GovernedPipelineEpisodeDefinition {
  assertScopeInput(options);
  const pipeline = structuredClone(options.pipeline);
  const selectedPasses = exactSelectedPasses(options.pipeline, options.selectedPasses);
  const roles = new Map(options.roles.map((role) => [role.name, role]));
  const assignments = resolveAppAssignments(options.app, options.roles);
  const stages = parallelStages(selectedPasses);
  const lastStageIds = new Set(stages.at(-1)!.map((pass) => governedPipelineStepId(
    pipeline.name,
    pass.id,
  )));
  const bindings: GovernedPipelineBinding[] = [];
  let priorStageStepIds: string[] = [];

  for (const stage of stages) {
    const stageStepIds: string[] = [];
    for (const pass of stage) {
      const role = roles.get(pass.role);
      if (role === undefined) {
        throw new GovernedPipelineEpisodeError(
          `governed pipeline ${pipeline.name}/${pass.id} references unknown role ${pass.role}`,
        );
      }
      const stepId = governedPipelineStepId(pipeline.name, pass.id);
      const requiredCapabilities = uniqueSorted(
        options.requiredCapabilitiesByRole?.[pass.role] ?? [],
      );
      const assignment = assignmentForPass(
        assignments,
        role,
        requiredCapabilities,
      );
      const output: PlannedOutput = {
        id: governedPipelineOutputId(stepId),
        kind: options.outputKindByPass?.[pass.id] ?? role.outputs[0] ?? "governed-pass-result",
        required: true,
      };
      const dependencyInputs: PlannedInputRef[] = priorStageStepIds.map((dependencyId) => ({
        ref: `plan-output:${governedPipelineOutputId(dependencyId)}`,
        required: true,
      }));
      const proposedStep: ProposedProviderTurnStep = {
        kind: "provider_turn",
        id: stepId,
        operation: governedPipelineOperation(pipeline.name, pass.id),
        role: pass.role,
        objective: options.objectiveByPass?.[pass.id] ??
          `Execute governed pipeline pass ${pipeline.name}/${pass.id}`,
        dependsOn: [...priorStageStepIds],
        requiredCapabilities,
        inputRefs: dedupeInputRefs([
          ...(options.inputRefs ?? []),
          ...dependencyInputs,
        ]),
        expectedOutputs: [output],
        maxTurnBudgetUsd: assignmentBudgetCeiling(assignments, role, assignment),
        selectionReason:
          assignments.mode === "fixed"
            ? `Governed pass ${pipeline.name}/${pass.id}; assignment resolves from fixed role configuration`
            : `Governed pass ${pipeline.name}/${pass.id}; creator selected the first app-narrowed approved exact assignment`,
        ...(assignments.mode === "adaptive" ? { assignment: { ...assignment } } : {}),
      };
      bindings.push({
        stepId,
        operation: proposedStep.operation,
        pass: structuredClone(pass),
        proposedStep: structuredClone(proposedStep),
        assignment: { ...assignment },
      });
      stageStepIds.push(stepId);
    }
    priorStageStepIds = stageStepIds;
  }

  const steps = bindings.map((binding) => structuredClone(binding.proposedStep));
  const templateHash = stableHash({
    pipeline,
    selectedPassIds: selectedPasses.map((pass) => pass.id),
    steps,
  });
  const templateRef = {
    id: `pipeline/${pipeline.name}`,
    version: `sha256-${templateHash}`,
  };
  const templateEvidence = `governed-pipeline:${pipeline.name}@${templateHash}`;
  const terminalOutputs = bindings
    .filter((binding) => lastStageIds.has(binding.stepId))
    .flatMap((binding) => structuredClone(binding.proposedStep.expectedOutputs));
  const scope: CreatorEpisodeScope = {
    planningDisposition: "execution_ready",
    provenance: {
      ...structuredClone(options.provenance),
      evidenceRefs: uniqueSorted([...options.provenance.evidenceRefs, templateEvidence]),
    },
    workKind: `governed-pipeline:${pipeline.name}`,
    objective: options.objective,
    inScope: [...options.inScope],
    outOfScope: [...options.outOfScope],
    acceptanceCriteria: [...options.acceptanceCriteria],
    expectedArtifacts: terminalOutputs,
    declaredConstraints: {
      ...(options.declaredConstraints ?? {}),
      governedPipeline: {
        name: pipeline.name,
        templateHash,
        selectedPassIds: selectedPasses.map((pass) => pass.id),
        operationIds: bindings.map((binding) => binding.operation),
      },
    },
    safetyFacts: structuredClone(options.safetyFacts ?? []),
    workflowTemplate: templateRef,
  };
  const key = workflowTemplateKey(templateRef);
  return {
    pipeline,
    selectedPasses,
    templateRef,
    templateHash,
    scope,
    steps,
    bindings,
    workflowTemplates: new Map([[key, steps.map((step) => structuredClone(step))]]),
  };
}

/** Domain validation run before publication and again before execution. */
export function assertGovernedPipelineEpisodePlan(
  plan: EpisodePlan,
  definition: GovernedPipelineEpisodeDefinition,
): void {
  if (plan.planningSource !== "creator_scope") {
    throw new GovernedPipelineEpisodeError("governed pipeline plan must originate from creator scope");
  }
  if (plan.workflowClass !== definition.scope.workKind) {
    throw new GovernedPipelineEpisodeError("governed pipeline plan has the wrong workflow class");
  }
  if (plan.steps.length !== definition.bindings.length) {
    throw new GovernedPipelineEpisodeError(
      `governed pipeline plan has ${plan.steps.length} steps; expected ${definition.bindings.length}`,
    );
  }
  const roleAssignments = new Map(definition.bindings.map((binding) => [
    binding.stepId,
    binding.assignment,
  ]));
  for (const [index, binding] of definition.bindings.entries()) {
    const step = plan.steps[index];
    if (step?.kind !== "provider_turn") {
      throw new GovernedPipelineEpisodeError(
        `governed pipeline step ${binding.stepId} must be one provider turn`,
      );
    }
    const proposed = binding.proposedStep;
    if (
      step.id !== proposed.id ||
      step.operation !== binding.operation ||
      step.role !== proposed.role ||
      step.objective !== proposed.objective ||
      stableHash(step.dependsOn) !== stableHash(proposed.dependsOn) ||
      stableHash(step.requiredCapabilities) !== stableHash(proposed.requiredCapabilities) ||
      stableHash(step.inputRefs) !== stableHash(proposed.inputRefs) ||
      stableHash(step.expectedOutputs) !== stableHash(proposed.expectedOutputs) ||
      step.maxTurnBudgetUsd !== proposed.maxTurnBudgetUsd ||
      step.selectionReason !== proposed.selectionReason
    ) {
      throw new GovernedPipelineEpisodeError(
        `accepted step ${step.id} does not match governed operation ${binding.operation}`,
      );
    }
    const expectedAssignment = roleAssignments.get(step.id)!;
    if (!turnAssignmentsEqual(step.assignment, expectedAssignment)) {
      throw new GovernedPipelineEpisodeError(
        `accepted step ${step.id} changes its governed atomic assignment`,
      );
    }
    const expectedSource = binding.proposedStep.assignment === undefined ? "configured" : "creator";
    if (step.assignmentSource !== expectedSource) {
      throw new GovernedPipelineEpisodeError(
        `accepted step ${step.id} has assignment source ${step.assignmentSource}; expected ${expectedSource}`,
      );
    }
  }
}

export interface GovernedPipelineEpisodeFacts
  extends Omit<
    EpisodeOrchestrationFacts,
    | "goal"
    | "requestedConstraints"
    | "hardBudget"
    | "requiredSafetyFacts"
    | "creatorScope"
    | "requiredCapabilitiesByRole"
  > {
  requestedConstraints?: Record<string, JsonValue>;
  hardBudget?: BudgetCeiling;
}

interface GovernedPipelineOrchestrationBase extends GovernedPipelineScopeOptions {
  root: string;
  facts: GovernedPipelineEpisodeFacts;
  workdir: string;
  promptsDir: string;
  hooks: TurnHooks;
  runtimeForAssignment?: (assignment: TurnAssignment, role: RoleConfig) => Runtime;
  assignmentReadinessProbe?: RuntimeReadinessProbe;
  assignmentReadinessTimeoutMs?: number;
  gateForRole?: (role: RoleConfig) => TurnHooks["gate"];
  parentTaskId?: string;
  signal?: AbortSignal;
  networkAccess?: boolean;
  contextBudgetBytes?: number;
  telemetry?: ExecutePipelineOptions["telemetry"];
  /** A typed source event may describe work that already happened (for
   * example `release-shipped`). Such facts remain visible in EpisodeIntent,
   * while this mapping prevents observation-only protocols from inventing an
   * execution gate for the completed action. */
  safetyFloorMapping?: EpisodeSafetyFloorMapping;
  now?: () => Date;
}

export interface GovernedPipelineStepInput {
  definition: GovernedPipelineEpisodeDefinition;
  plan: EpisodePlan;
  step: ProviderTurnStep;
  pass: PassConfig;
  role: RoleConfig;
  execution: EpisodeStepExecutionContext;
  /**
   * Durable completed outputs for exactly `step.dependsOn`, in declared edge
   * order. A sequential executor must never make an unrelated ready step look
   * like a dependency merely because it happened to finish first.
   */
  dependencyOutputs: GovernedPipelineProviderEvidence[];
}

export interface GovernedPipelineProviderEvidence {
  stepId: string;
  operation: string;
  passId: string;
  role: string;
  assignment: TurnAssignment;
  record: ExecutionStepRecord;
  output: string;
  recovered: boolean;
  envelopeStatus: Exclude<EnvelopeStatus, "running">;
  envelopeErrorCode?: string;
  envelopeSummary?: string;
}

export interface GovernedPipelineDeliveryHooks {
  contextForStep(input: GovernedPipelineStepInput): ContextBundle | Promise<ContextBundle>;
  briefForStep(input: GovernedPipelineStepInput): string;
  verdictSchemaForStep?(input: GovernedPipelineStepInput): Record<string, unknown> | undefined;
  /** Parse and durably record the provider verdict. A crash can leave terminal
   * provider evidence before the orchestrator commit marker, so this callback
   * may be replayed from the same content and must be content-idempotent. */
  recordVerdictForStep?(input: GovernedPipelineStepInput):
    | ((context: VerdictRecordContext) => Promise<VerdictRecordOutcome>)
    | undefined;
  inputManifestForStep?(input: GovernedPipelineStepInput):
    | ExecutePipelineOptions["inputManifest"]
    | undefined;
  beforeProviderTurn?(input: GovernedPipelineStepInput & { resumed: boolean }): void | Promise<void>;
  afterPass?(input: GovernedPipelineStepInput & { record: PassRunRecord }): void | Promise<void>;
  /**
   * Runs for fresh and recovered terminal evidence. It may be retried after a
   * crash and therefore must be content-idempotent. Throwing leaves the plan
   * step started so the next invocation recovers output.md without spending.
   */
  afterProviderEvidence?(input: GovernedPipelineStepInput & {
    evidence: GovernedPipelineProviderEvidence;
  }): void | Promise<void>;
  authorityBrief?: ExecutePipelineOptions["authorityBrief"];
}

interface GovernedPipelineExecutionTransportOptions {
  root: string;
  app: AppEntry;
  roles: readonly RoleConfig[];
  workdir: string;
  promptsDir: string;
  hooks: TurnHooks;
  runtimeForAssignment: (assignment: TurnAssignment, role: RoleConfig) => Runtime;
  delivery: GovernedPipelineDeliveryHooks;
  gateForRole?: (role: RoleConfig) => TurnHooks["gate"];
  parentTaskId?: string;
  signal?: AbortSignal;
  networkAccess?: boolean;
  contextBudgetBytes?: number;
  telemetry?: ExecutePipelineOptions["telemetry"];
  now?: () => Date;
}

export type OrchestrateGovernedPipelineEpisodeOptions =
  | (GovernedPipelineOrchestrationBase & { mode: "plan_only"; delivery?: never })
  | (GovernedPipelineOrchestrationBase & {
      mode: "execute";
      runtimeForAssignment: (assignment: TurnAssignment, role: RoleConfig) => Runtime;
      delivery: GovernedPipelineDeliveryHooks;
    });

export interface GovernedPipelineOrchestrationResult extends OrchestratedEpisode {
  definition: GovernedPipelineEpisodeDefinition;
  /** Current durable provider evidence in governed plan order. */
  providerEvidence: GovernedPipelineProviderEvidence[];
}

/** Plan or execute one explicit creator-scoped governed protocol. */
export async function orchestrateGovernedPipelineEpisode(
  options: OrchestrateGovernedPipelineEpisodeOptions,
): Promise<GovernedPipelineOrchestrationResult> {
  const definition = buildGovernedPipelineEpisodeDefinition(options);
  const plannerRole = requireRole(options.roles, "planner");
  const runtimeForAssignment = options.runtimeForAssignment ?? (() => {
    throw new GovernedPipelineEpisodeError(
      "execution-ready governed creator scope unexpectedly invoked EpisodePlanner",
    );
  });
  const facts: EpisodeOrchestrationFacts = {
    ...options.facts,
    goal: definition.scope.objective,
    requestedConstraints: {
      ...(options.facts.requestedConstraints ?? {}),
      governedPipeline: definition.scope.declaredConstraints["governedPipeline"]!,
    },
    hardBudget: options.facts.hardBudget ?? defaultHardBudget(definition),
    requiredSafetyFacts: structuredClone(definition.scope.safetyFacts),
    requiredCapabilitiesByRole: cloneCapabilities(options.requiredCapabilitiesByRole),
    creatorScope: structuredClone(definition.scope),
  };
  const planner = {
    // A complete creator scope never reads or executes this protocol input.
    promptText: "",
    context: EMPTY_CONTEXT,
    workdir: options.workdir,
    hooks: options.hooks,
    runtimeForAssignment,
    policyVersion: GOVERNED_PIPELINE_EPISODE_POLICY_VERSION,
    limits: unusedPlannerLimits(plannerRole.maxTurnBudgetUsd),
    workflowTemplates: definition.workflowTemplates,
    ...(options.safetyFloorMapping === undefined
      ? {}
      : { safetyFloorMapping: options.safetyFloorMapping }),
    validateAcceptedPlan: (plan: EpisodePlan) =>
      assertGovernedPipelineEpisodePlan(plan, definition),
    ...(options.now === undefined ? {} : { now: options.now }),
  };

  if (options.mode === "plan_only") {
    const result = await orchestrateEpisode({
      root: options.root,
      app: options.app,
      roles: options.roles,
      facts,
      mode: "plan_only",
      ...(options.assignmentReadinessProbe === undefined
        ? {}
        : { assignmentReadinessProbe: options.assignmentReadinessProbe }),
      ...(options.assignmentReadinessTimeoutMs === undefined
        ? {}
        : { assignmentReadinessTimeoutMs: options.assignmentReadinessTimeoutMs }),
      planner,
    });
    const providerEvidence = await readGovernedPipelineProviderEvidence({
      root: options.root,
      app: options.app.name,
      plan: result.prepared.plan,
      definition,
    });
    return { ...result, definition, providerEvidence };
  }

  const result = await orchestrateEpisode({
    root: options.root,
    app: options.app,
    roles: options.roles,
    facts,
    mode: "execute",
    ...(options.assignmentReadinessProbe === undefined
      ? {}
      : { assignmentReadinessProbe: options.assignmentReadinessProbe }),
    ...(options.assignmentReadinessTimeoutMs === undefined
      ? {}
      : { assignmentReadinessTimeoutMs: options.assignmentReadinessTimeoutMs }),
    planner,
    execution: deliveryInput(options, definition),
  });
  const providerEvidence = await readGovernedPipelineProviderEvidence({
    root: options.root,
    app: options.app.name,
    plan: result.prepared.plan,
    definition,
  });
  return { ...result, definition, providerEvidence };
}

export interface ReadGovernedPipelineProviderEvidenceOptions {
  root: string;
  /** Runlog app namespace (normally the EpisodeIntent app). */
  app: string;
  plan: EpisodePlan;
  definition: GovernedPipelineEpisodeDefinition;
}

/**
 * Read every terminal provider record for the current governed plan in
 * governed step order. This is the restart-safe source for final summaries,
 * standing-role persistence, scorecards, and run-id/cost projection; callers
 * do not need fresh `afterPass` callbacks to reconstruct completed work.
 */
export async function readGovernedPipelineProviderEvidence(
  options: ReadGovernedPipelineProviderEvidenceOptions,
): Promise<GovernedPipelineProviderEvidence[]> {
  assertGovernedPipelineEpisodePlan(options.plan, options.definition);
  const records = (await readExecutionSteps(options.root, options.plan.episodeId))
    .filter((record) =>
      record.kind === "provider" && record.plan_version === options.plan.version,
    );
  const bindingByStep = new Map(
    options.definition.bindings.map((binding) => [binding.stepId, binding]),
  );
  const unknown = records.find((record) =>
    record.plan_step_id === undefined || !bindingByStep.has(record.plan_step_id),
  );
  if (unknown !== undefined) {
    throw new GovernedPipelineEpisodeError(
      `provider evidence ${unknown.execution_step_id} is not authorized by the governed template`,
    );
  }
  const recordsByStep = new Map<string, ExecutionStepRecord[]>();
  for (const record of records) {
    const current = recordsByStep.get(record.plan_step_id!) ?? [];
    current.push(record);
    recordsByStep.set(record.plan_step_id!, current);
  }
  const evidence: GovernedPipelineProviderEvidence[] = [];
  for (const binding of options.definition.bindings) {
    const matches = recordsByStep.get(binding.stepId) ?? [];
    if (matches.length > 1) {
      throw new GovernedPipelineEpisodeError(
        `governed step ${binding.stepId} has ${matches.length} terminal provider records`,
      );
    }
    const record = matches[0];
    if (record === undefined) continue;
    const step = options.plan.steps.find((candidate): candidate is ProviderTurnStep =>
      candidate.kind === "provider_turn" && candidate.id === binding.stepId,
    );
    if (step === undefined) {
      throw new GovernedPipelineEpisodeError(
        `governed plan no longer contains provider step ${binding.stepId}`,
      );
    }
    evidence.push(await loadGovernedProviderEvidence({
      root: options.root,
      app: options.app,
      plan: options.plan,
      step,
      binding,
      record,
      recovered: true,
    }));
  }
  return evidence;
}

export interface ExecuteGovernedPipelinePlanOptions
  extends Omit<GovernedPipelineOrchestrationBase, keyof GovernedPipelineScopeOptions | "facts" | "promptsDir"> {
  app: AppEntry;
  roles: readonly RoleConfig[];
  definition: GovernedPipelineEpisodeDefinition;
  intent: Parameters<typeof executeAcceptedEpisodePlan>[0]["intent"];
  plan: EpisodePlan;
  promptsDir: string;
  runtimeForAssignment: (assignment: TurnAssignment, role: RoleConfig) => Runtime;
  delivery: GovernedPipelineDeliveryHooks;
  /** A caller with a revision-capable planner protocol may supply the common
   * typed proposer. The default rejects instead of leaving an unowned pending
   * request because this exact governed template cannot mutate itself. */
  proposeRevision?: NonNullable<
    Parameters<typeof executeAcceptedEpisodePlan>[0]["proposeRevision"]
  >;
  maxSteps?: number;
}

/** Execute a previously accepted governed plan (used by durable entry points). */
export async function executeGovernedPipelinePlan(
  options: ExecuteGovernedPipelinePlanOptions,
): Promise<EpisodePlanExecutionResult> {
  if (options.intent.app !== options.app.name) {
    throw new GovernedPipelineEpisodeError(
      `governed execution app ${options.app.name} does not match intent ${options.intent.app}`,
    );
  }
  assertGovernedPipelineEpisodePlan(options.plan, options.definition);
  return executeAcceptedEpisodePlan({
    root: options.root,
    intent: options.intent,
    plan: options.plan,
    roles: options.roles,
    assignmentReadinessProbe: options.assignmentReadinessProbe ?? probeRuntimeReadiness,
    ...(options.assignmentReadinessTimeoutMs === undefined
      ? {}
      : { assignmentReadinessTimeoutMs: options.assignmentReadinessTimeoutMs }),
    proposeRevision: options.proposeRevision ?? (async () => {
      throw new GovernedPipelineEpisodeError(
        "governed pipeline revision requires a new validated creator scope or an explicit revision-capable proposer",
      );
    }),
    ...deliveryInput(options, options.definition),
    ...(options.maxSteps === undefined ? {} : { maxSteps: options.maxSteps }),
  });
}

function deliveryInput(
  options: GovernedPipelineExecutionTransportOptions,
  definition: GovernedPipelineEpisodeDefinition,
) {
  return {
    workdir: options.workdir,
    hooks: options.hooks,
    runtimeForAssignment: options.runtimeForAssignment,
    // The custom provider owns role-scoped context; this generic callback is
    // intentionally unreachable while domain validation admits provider-only
    // governed plans.
    contextForProviderStep: () => EMPTY_CONTEXT,
    provider: (step: ProviderTurnStep, execution: EpisodeStepExecutionContext) =>
      executeGovernedProviderStep(options, definition, step, execution),
    mechanical: async () => ({
      status: "failed" as const,
      reasonCode: "error_governed_pipeline_mechanical_step",
      summary: "governed pipeline templates contain provider passes only",
    }),
    approval: async () => ({
      status: "failed" as const,
      reasonCode: "error_governed_pipeline_approval_step",
      summary: "governed pipeline templates contain provider passes only",
    }),
    ...(options.gateForRole === undefined ? {} : { gateForRole: options.gateForRole }),
    ...(options.parentTaskId === undefined ? {} : { parentTaskId: options.parentTaskId }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(options.networkAccess === true ? { networkAccess: true } : {}),
    ...(options.contextBudgetBytes === undefined
      ? {}
      : { contextBudgetBytes: options.contextBudgetBytes }),
    ...(options.telemetry === undefined ? {} : { telemetry: options.telemetry }),
    ...(options.now === undefined ? {} : { now: options.now }),
  };
}

async function executeGovernedProviderStep(
  options: GovernedPipelineExecutionTransportOptions,
  definition: GovernedPipelineEpisodeDefinition,
  step: ProviderTurnStep,
  execution: EpisodeStepExecutionContext,
): Promise<EpisodeStepCompletedOutcome | EpisodeStepFailedOutcome> {
  const binding = definition.bindings.find((candidate) => candidate.stepId === step.id);
  if (binding === undefined || binding.operation !== step.operation) {
    throw new GovernedPipelineEpisodeError(
      `unknown governed operation ${step.operation} for plan step ${step.id}`,
    );
  }
  const role = requireRole(options.roles, step.role);
  const plan = await currentPlanForExecution(options.root, step, execution);
  const durableEvidence = await readGovernedPipelineProviderEvidence({
    root: options.root,
    app: options.app.name,
    plan,
    definition,
  });
  const dependencyOutputs = governedDependencyOutputs(durableEvidence, step);
  const input: GovernedPipelineStepInput = {
    definition,
    plan,
    step,
    pass: structuredClone(binding.pass),
    role,
    execution,
    dependencyOutputs,
  };
  const priorEvidence = durableEvidence.find((candidate) => candidate.stepId === step.id);
  const prior = priorEvidence === undefined
    ? undefined
    : { ...priorEvidence, recovered: execution.resume };
  if (prior !== undefined) {
    const verdictFailure = await recoverGovernedVerdictPersistence(
      options,
      input,
      prior,
    );
    return verdictFailure ?? evidenceOutcome(options.delivery, input, prior);
  }

  const authorization = await exactAuthorization(options.root, input);
  const context = await options.delivery.contextForStep(input);
  const transportPass = providerTransportPass(binding.pass, step);
  const recordVerdict = options.delivery.recordVerdictForStep?.(input);
  const inputManifest = options.delivery.inputManifestForStep?.(input);
  let transportError: unknown;
  try {
    await executePipeline({
      pipeline: {
        name: EPISODE_PLAN_EXECUTION_PIPELINE,
        mechanical: false,
        passes: [transportPass],
      },
      selection: { tier: planRouteLabel(input.plan) },
      roles: { [role.name]: role },
      runtimeFor: (selected) =>
        options.runtimeForAssignment(fixedAssignmentFromRole(selected), role),
      runtimeForAssignment: options.runtimeForAssignment,
      briefFor: () => options.delivery.briefForStep(input),
      promptsDir: options.promptsDir,
      context,
      ...(options.delivery.authorityBrief === undefined
        ? {}
        : { authorityBrief: options.delivery.authorityBrief }),
      workdir: options.workdir,
      hooks: options.hooks,
      ...(options.gateForRole === undefined ? {} : { gateForRole: options.gateForRole }),
      runlog: {
        root: options.root,
        app: options.app.name,
        traceId: execution.executionId,
      },
      runIdForPass: () => governedProviderRunId(input.plan, step, execution),
      episode: {
        id: input.plan.episodeId,
        route: planRouteLabel(input.plan),
        authorizedPasses: [authorization],
        finalize: false,
        nextTurnEstimate: { costUsd: step.maxTurnBudgetUsd },
      },
      requiredCapabilities: providerRuntimeCapabilities(step),
      ...(options.delivery.verdictSchemaForStep === undefined
        ? {}
        : { verdictSchemaFor: () => options.delivery.verdictSchemaForStep!(input) }),
      ...(recordVerdict === undefined
        ? {}
        : {
            recordVerdict: forbidVerdictRepair(
              recordVerdict,
              step,
            ),
          }),
      ...(inputManifest === undefined
        ? {}
        : { inputManifest }),
      ...(options.delivery.beforeProviderTurn === undefined
        ? {}
        : {
            beforeProviderTurn: ({ resumed }: { resumed: boolean }) =>
              options.delivery.beforeProviderTurn!({ ...input, resumed }),
          }),
      ...(options.delivery.afterPass === undefined
        ? {}
        : {
            afterPass: (record: PassRunRecord) =>
              options.delivery.afterPass!({ ...input, record }),
          }),
      ...(options.parentTaskId === undefined ? {} : { parentTaskId: options.parentTaskId }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      ...(options.networkAccess === true ? { networkAccess: true } : {}),
      ...(options.contextBudgetBytes === undefined
        ? {}
        : { contextBudgetBytes: options.contextBudgetBytes }),
      ...(options.telemetry === undefined ? {} : { telemetry: options.telemetry }),
      ...(options.now === undefined ? {} : { clock: options.now }),
    });
  } catch (error) {
    transportError = error;
  }
  const evidence = await governedProviderEvidence(options.root, options.app.name, input);
  if (evidence === undefined) {
    throw new GovernedPipelineEpisodeError(
      `governed provider step ${step.id} ended without terminal evidence` +
        (transportError instanceof Error ? `: ${transportError.message}` : ""),
    );
  }
  if (
    transportError !== undefined &&
    evidence.record.status === "completed" &&
    evidence.envelopeStatus === "completed"
  ) {
    throw transportError;
  }
  const verdictFailure = await recoverGovernedVerdictPersistence(
    options,
    input,
    evidence,
  );
  return verdictFailure ?? evidenceOutcome(options.delivery, input, evidence);
}

async function recoverGovernedVerdictPersistence(
  options: GovernedPipelineExecutionTransportOptions,
  input: GovernedPipelineStepInput,
  evidence: GovernedPipelineProviderEvidence,
): Promise<EpisodeStepFailedOutcome | undefined> {
  const recorder = options.delivery.recordVerdictForStep?.(input);
  if (
    recorder === undefined ||
    evidence.record.status !== "completed" ||
    evidence.envelopeStatus !== "completed" ||
    await hasVerdictPersistenceMarker(options.root, options.app.name, evidence.record.run_id)
  ) {
    return undefined;
  }

  // The provider turn is immutable and already settled. Recreate only the
  // deterministic verdict-persistence context from its durable run evidence;
  // a repair provider call would be a second invocation outside the plan and
  // remains structurally forbidden.
  const envelope = await readEnvelope(options.root, options.app.name, evidence.record.run_id);
  const events = createEventWriter(
    options.root,
    {
      runId: evidence.record.run_id,
      trace_id: envelope.trace_id,
      span_id: envelope.pass,
      app: envelope.app,
      ...(envelope.ticket === undefined ? {} : { ticket: envelope.ticket }),
      pipeline: envelope.pipeline,
      pass: envelope.pass,
      role: envelope.role,
      ...(envelope.model === undefined ? {} : { model: envelope.model }),
    },
    options.now ?? (() => new Date()),
  );
  const result = recoveredTurnResult(evidence, envelope);
  let outcome: VerdictRecordOutcome;
  try {
    outcome = await forbidVerdictRepair(recorder, input.step)({
      pass: input.pass,
      runId: evidence.record.run_id,
      result,
      role: input.role,
      assignment: { ...input.step.assignment },
      hooks: {
        ...options.hooks,
        gate: options.gateForRole?.(input.role) ?? options.hooks.gate,
      },
      workdir: options.workdir,
      context: await options.delivery.contextForStep(input),
      events,
      clock: options.now ?? (() => new Date()),
      runProviderTurn: async () => {
        throw new GovernedPipelineEpisodeError(
          `verdict repair for ${input.step.operation} requires an explicit future EpisodePlan step`,
        );
      },
    });
  } catch (error) {
    outcome = {
      ok: false,
      errorCode: "error_verdict_persist",
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
  const artifact = {
    runId: evidence.record.run_id,
    executionStepId: evidence.record.execution_step_id,
    outputSha256: fingerprint(evidence.output),
    artifactSha256: evidence.record.artifact_fingerprint,
  };
  if (!outcome.ok) {
    return {
      status: "failed",
      reasonCode: outcome.errorCode,
      summary: outcome.error.message,
      artifact,
    };
  }
  if (!(await hasRunlogEvent(
    options.root,
    options.app.name,
    evidence.record.run_id,
    "verdict.recorded",
  ))) {
    return {
      status: "failed",
      reasonCode: "error_verdict_persist",
      summary:
        `verdict recorder for ${input.step.operation} returned without durable verdict.recorded evidence`,
      artifact,
    };
  }
  await events.append({
    type: "verdict.persistence_completed",
    detail: { provider_turns: 1, recovered: true },
  });
  return undefined;
}

async function hasVerdictPersistenceMarker(
  root: string,
  app: string,
  runId: string,
): Promise<boolean> {
  return hasRunlogEvent(root, app, runId, "verdict.persistence_completed");
}

async function hasRunlogEvent(
  root: string,
  app: string,
  runId: string,
  eventType: "verdict.recorded" | "verdict.persistence_completed",
): Promise<boolean> {
  try {
    return (await readEvents(root, app, runId))
      .some((event) => event.event === eventType);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function recoveredTurnResult(
  evidence: GovernedPipelineProviderEvidence,
  envelope: Awaited<ReturnType<typeof readEnvelope>>,
): TurnResult {
  return {
    status: "completed",
    summary: evidence.output,
    artifacts: envelope.artifacts?.map((artifact) => ({ ...artifact })) ?? [],
    session: envelope.session === undefined
      ? {
          runtime: evidence.assignment.harness,
          id: `recovered-${evidence.record.run_id}`,
        }
      : { ...envelope.session },
    usage: evidence.record.usage === null
      ? {
          tokensIn: 0,
          tokensOut: 0,
          costUsd: 0,
          subagentTurns: 0,
          wallClockMs: 0,
          quality: "unavailable",
        }
      : { ...evidence.record.usage },
    escalations: [],
  };
}

async function evidenceOutcome(
  hooks: GovernedPipelineDeliveryHooks,
  input: GovernedPipelineStepInput,
  evidence: GovernedPipelineProviderEvidence,
): Promise<EpisodeStepCompletedOutcome | EpisodeStepFailedOutcome> {
  await hooks.afterProviderEvidence?.({ ...input, evidence });
  const artifact = {
    runId: evidence.record.run_id,
    executionStepId: evidence.record.execution_step_id,
    outputSha256: fingerprint(evidence.output),
    artifactSha256: evidence.record.artifact_fingerprint,
  };
  return evidence.record.status === "completed" && evidence.envelopeStatus === "completed"
    ? { status: "completed", artifact }
    : {
        status: "failed",
        reasonCode: evidence.envelopeErrorCode ?? evidence.record.error_code ??
          `error_governed_pipeline_provider_${evidence.envelopeStatus}`,
        summary: evidence.envelopeSummary ?? evidence.record.reason,
        artifact,
      };
}

async function governedProviderEvidence(
  root: string,
  app: string,
  input: GovernedPipelineStepInput,
): Promise<GovernedPipelineProviderEvidence | undefined> {
  const evidence = await readGovernedPipelineProviderEvidence({
    root,
    app,
    plan: input.plan,
    definition: input.definition,
  });
  const matching = evidence.find((candidate) => candidate.stepId === input.step.id);
  return matching === undefined
    ? undefined
    : { ...matching, recovered: input.execution.resume };
}

function governedDependencyOutputs(
  evidence: readonly GovernedPipelineProviderEvidence[],
  step: ProviderTurnStep,
): GovernedPipelineProviderEvidence[] {
  if (step.dependsOn.length === 0) return [];
  const byStep = new Map(evidence.map((entry) => [entry.stepId, entry]));
  return step.dependsOn.map((dependencyId) => {
    const dependency = byStep.get(dependencyId);
    if (dependency === undefined) {
      throw new GovernedPipelineEpisodeError(
        `governed step ${step.id} lacks durable output for dependency ${dependencyId}`,
      );
    }
    if (
      dependency.record.status !== "completed" ||
      dependency.envelopeStatus !== "completed"
    ) {
      throw new GovernedPipelineEpisodeError(
        `governed dependency ${dependencyId} is not durably completed`,
      );
    }
    return dependency;
  });
}

async function loadGovernedProviderEvidence(input: {
  root: string;
  app: string;
  plan: EpisodePlan;
  step: ProviderTurnStep;
  binding: GovernedPipelineBinding;
  record: ExecutionStepRecord;
  recovered: boolean;
}): Promise<GovernedPipelineProviderEvidence> {
  assertEvidenceMatches(input.plan.version, input.step, input.record);
  let output: string;
  try {
    output = await readFile(
      runPaths(input.root, input.app, input.record.run_id).output,
      "utf8",
    );
  } catch (error) {
    throw new GovernedPipelineEpisodeError(
      `terminal governed provider evidence for ${input.step.id} has no recoverable output.md: ` +
      (error instanceof Error ? error.message : String(error)),
    );
  }
  const envelope = await readEnvelope(input.root, input.app, input.record.run_id);
  if (envelope.status === "running") {
    throw new GovernedPipelineEpisodeError(
      `terminal provider evidence for ${input.step.id} has a non-terminal run envelope`,
    );
  }
  return {
    stepId: input.step.id,
    operation: input.step.operation,
    passId: input.binding.pass.id,
    role: input.step.role,
    assignment: { ...input.step.assignment },
    record: input.record,
    output,
    recovered: input.recovered,
    envelopeStatus: envelope.status,
    ...(envelope.error_code === undefined ? {} : { envelopeErrorCode: envelope.error_code }),
    ...(envelope.terminal_reason === undefined && envelope.verdict_summary === undefined
      ? {}
      : { envelopeSummary: envelope.terminal_reason ?? envelope.verdict_summary }),
  };
}

function assertEvidenceMatches(
  planVersion: number,
  step: ProviderTurnStep,
  record: ExecutionStepRecord,
): void {
  if (
    record.operation !== `${EPISODE_PLAN_EXECUTION_PIPELINE}/${step.id}` ||
    record.role !== step.role ||
    record.runtime === null ||
    record.model === null ||
    record.effort === null ||
    !turnAssignmentsEqual(
      { harness: record.runtime, model: record.model, effort: record.effort },
      step.assignment,
    ) ||
    record.assignment_source !== step.assignmentSource ||
    record.plan_version !== planVersion ||
    record.plan_step_id !== step.id
  ) {
    throw new GovernedPipelineEpisodeError(
      `terminal provider evidence for ${step.id} differs from its accepted plan`,
    );
  }
}

async function exactAuthorization(
  root: string,
  input: GovernedPipelineStepInput,
): Promise<AuthorizedPass> {
  const route = await readRouteRecord(root, input.plan.episodeId);
  const matches = route.authorized_passes.filter((pass) =>
    pass.pipeline === EPISODE_PLAN_EXECUTION_PIPELINE &&
    pass.pass === input.step.id &&
    pass.role === input.step.role &&
    pass.plan_version === input.execution.planVersion &&
    pass.plan_step_id === input.step.id &&
    pass.runtime === input.step.assignment.harness &&
    pass.model === input.step.assignment.model &&
    pass.effort === input.step.assignment.effort &&
    pass.assignment_source === input.step.assignmentSource,
  );
  if (matches.length !== 1) {
    throw new GovernedPipelineEpisodeError(
      `governed provider step ${input.step.id} requires exactly one route authorization`,
    );
  }
  return matches[0]!;
}

function forbidVerdictRepair(
  recorder: (context: VerdictRecordContext) => Promise<VerdictRecordOutcome>,
  step: ProviderTurnStep,
): (context: VerdictRecordContext) => Promise<VerdictRecordOutcome> {
  return (context) => recorder({
    ...context,
    runProviderTurn: async () => {
      throw new GovernedPipelineEpisodeError(
        `verdict repair for ${step.operation} requires an explicit future EpisodePlan step`,
      );
    },
  });
}

function providerTransportPass(pass: PassConfig, step: ProviderTurnStep): PassConfig {
  return {
    id: step.id,
    role: pass.role,
    template: pass.template,
    ...(pass.wallClockMinutes === undefined ? {} : { wallClockMinutes: pass.wallClockMinutes }),
    ...(pass.maxTurns === undefined ? {} : { maxTurns: pass.maxTurns }),
  };
}

function governedProviderRunId(
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

function providerRuntimeCapabilities(step: ProviderTurnStep): RuntimeCapability[] {
  return [...new Set([
    ...BASELINE_PROVIDER_CAPABILITIES,
    ...step.requiredCapabilities.filter(isRuntimeCapability),
  ])].sort();
}

function assignmentForPass(
  resolved: ReturnType<typeof resolveAppAssignments>,
  role: RoleConfig,
  requiredCapabilities: readonly string[],
): TurnAssignment {
  if (resolved.mode === "fixed") return fixedAssignmentFromRole(role);
  const catalog = resolved.roles.find((entry) => entry.role === role.name)?.assignments ?? [];
  const selected = catalog.find((candidate) => {
    const capabilities = new Set(resolvedRuntimeCapabilities(candidate.assignment.harness));
    return requiredCapabilities.every((capability) => capabilities.has(capability as RuntimeCapability));
  });
  if (selected === undefined) {
    throw new GovernedPipelineEpisodeError(
      `adaptive governed pipeline role ${role.name} has no approved assignment supporting ` +
        (requiredCapabilities.join(", ") || "its requested capabilities"),
    );
  }
  return { ...selected.assignment };
}

function assignmentBudgetCeiling(
  resolved: ReturnType<typeof resolveAppAssignments>,
  role: RoleConfig,
  assignment: TurnAssignment,
): number {
  if (resolved.mode === "fixed") return role.maxTurnBudgetUsd;
  const matches = resolved.roles
    .find((entry) => entry.role === role.name)
    ?.assignments.filter((candidate) => turnAssignmentsEqual(candidate.assignment, assignment)) ?? [];
  if (matches.length !== 1) {
    throw new GovernedPipelineEpisodeError(
      `adaptive assignment ${turnAssignmentKey(assignment)} is not unique for role ${role.name}`,
    );
  }
  return matches[0]!.maxTurnCostUsd;
}

function exactSelectedPasses(
  pipeline: PipelineConfig,
  selected: readonly PassConfig[],
): PassConfig[] {
  if (selected.length === 0) {
    throw new GovernedPipelineEpisodeError(
      `governed pipeline ${pipeline.name} requires at least one selected provider pass`,
    );
  }
  const selectedById = new Map<string, PassConfig>();
  for (const pass of selected) {
    if (selectedById.has(pass.id)) {
      throw new GovernedPipelineEpisodeError(`selected pass ${pass.id} is duplicated`);
    }
    selectedById.set(pass.id, pass);
  }
  const exact = pipeline.passes.filter((pass) => selectedById.has(pass.id));
  if (exact.length !== selected.length) {
    const unknown = selected.filter((pass) => !pipeline.passes.some((item) => item.id === pass.id));
    throw new GovernedPipelineEpisodeError(
      `selected pass does not belong to governed pipeline ${pipeline.name}: ` +
        unknown.map((pass) => pass.id).join(", "),
    );
  }
  for (const pass of exact) {
    const selectedPass = selectedById.get(pass.id)!;
    if (stableHash(pass) !== stableHash(selectedPass)) {
      throw new GovernedPipelineEpisodeError(
        `selected pass ${pipeline.name}/${pass.id} differs from governed configuration`,
      );
    }
  }
  if (selected.map((pass) => pass.id).join("\0") !== exact.map((pass) => pass.id).join("\0")) {
    throw new GovernedPipelineEpisodeError(
      `selected passes for ${pipeline.name} must retain governed pipeline order`,
    );
  }
  return exact.map((pass) => structuredClone(pass));
}

function governedPipelineStepId(pipelineName: string, passId: string): string {
  assertIdentifier("pipeline name", pipelineName);
  assertIdentifier("pipeline pass id", passId);
  return `gp-${pipelineName}-${passId}`;
}

function governedPipelineOutputId(stepId: string): string {
  return `result-${stepId}`;
}

function workflowTemplateKey(
  ref: NonNullable<CreatorEpisodeScope["workflowTemplate"]>,
): string {
  return `${ref.id}@${ref.version}`;
}

function defaultHardBudget(definition: GovernedPipelineEpisodeDefinition): BudgetCeiling {
  const providerTurnBudget = definition.bindings.reduce(
    (sum, binding) => sum + binding.proposedStep.maxTurnBudgetUsd,
    0,
  );
  return {
    maxProviderTurns: definition.bindings.length,
    maxEquivalentCostUsd: providerTurnBudget,
    maxMechanicalOverheadUsd: 0,
  };
}

function unusedPlannerLimits(roleBudgetUsd: number) {
  const equivalentCostUsd = Math.min(roleBudgetUsd, 0.01);
  return {
    maxAttempts: 1,
    perAttempt: { inputTokens: 1, equivalentCostUsd, activeTimeMs: 1 },
    aggregate: {
      providerTurns: 1,
      inputTokens: 1,
      equivalentCostUsd,
      activeTimeMs: 1,
    },
  };
}

function cloneCapabilities(
  value: GovernedPipelineScopeOptions["requiredCapabilitiesByRole"],
): Readonly<Record<string, readonly string[]>> {
  return Object.fromEntries(
    Object.entries(value ?? {}).map(([role, capabilities]) => [role, [...capabilities]]),
  );
}

function assertScopeInput(options: GovernedPipelineScopeOptions): void {
  assertIdentifier("pipeline name", options.pipeline.name);
  if (options.roles.length === 0) {
    throw new GovernedPipelineEpisodeError("governed pipeline requires configured roles");
  }
  const roleNames = new Set(options.roles.map((role) => role.name));
  if (roleNames.size !== options.roles.length) {
    throw new GovernedPipelineEpisodeError("governed pipeline roles contain duplicate names");
  }
  if (!roleNames.has("planner")) {
    throw new GovernedPipelineEpisodeError("governed creator scope requires a configured planner boot role");
  }
  assertNonEmpty("objective", options.objective);
  assertNonEmptyList("inScope", options.inScope);
  assertNonEmptyList("acceptanceCriteria", options.acceptanceCriteria);
  if (options.outOfScope.some((value) => value.trim().length === 0)) {
    throw new GovernedPipelineEpisodeError("outOfScope entries must be non-empty");
  }
  assertExactOptionalKeys("objectiveByPass", options.objectiveByPass, options.selectedPasses);
  assertExactOptionalKeys("outputKindByPass", options.outputKindByPass, options.selectedPasses);
  for (const pass of options.pipeline.passes) {
    assertIdentifier("pipeline pass id", pass.id);
    assertSafeTemplate(pass.template, options.pipeline.name, pass.id);
  }
}

function assertSafeTemplate(template: string, pipeline: string, pass: string): void {
  const normalized = normalize(template);
  if (
    template.length === 0 ||
    isAbsolute(template) ||
    normalized === ".." ||
    normalized.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)
  ) {
    throw new GovernedPipelineEpisodeError(
      `governed template for ${pipeline}/${pass} must remain under promptsDir`,
    );
  }
}

function assertExactOptionalKeys(
  label: string,
  value: Readonly<Record<string, string>> | undefined,
  selectedPasses: readonly PassConfig[],
): void {
  if (value === undefined) return;
  const selected = new Set(selectedPasses.map((pass) => pass.id));
  const unknown = Object.keys(value).filter((key) => !selected.has(key));
  if (unknown.length > 0) {
    throw new GovernedPipelineEpisodeError(`${label} names unselected pass(es): ${unknown.join(", ")}`);
  }
  for (const [key, text] of Object.entries(value)) assertNonEmpty(`${label}.${key}`, text);
}

function dedupeInputRefs(values: readonly PlannedInputRef[]): PlannedInputRef[] {
  const byRef = new Map<string, PlannedInputRef>();
  for (const value of values) {
    const existing = byRef.get(value.ref);
    byRef.set(value.ref, {
      ref: value.ref,
      required: value.required || existing?.required === true,
    });
  }
  return [...byRef.values()].sort((left, right) => left.ref.localeCompare(right.ref));
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function requireRole(roles: readonly RoleConfig[], name: string): RoleConfig {
  const role = roles.find((candidate) => candidate.name === name);
  if (role === undefined) {
    throw new GovernedPipelineEpisodeError(`governed pipeline requires configured role ${name}`);
  }
  return role;
}

function assertIdentifier(label: string, value: string): void {
  if (!IDENTIFIER.test(value)) {
    throw new GovernedPipelineEpisodeError(
      `${label} ${JSON.stringify(value)} is not a stable machine-readable identifier`,
    );
  }
}

function assertNonEmpty(label: string, value: string): void {
  if (value.trim().length === 0) throw new GovernedPipelineEpisodeError(`${label} is required`);
}

function assertNonEmptyList(label: string, values: readonly string[]): void {
  if (values.length === 0 || values.some((value) => value.trim().length === 0)) {
    throw new GovernedPipelineEpisodeError(`${label} requires non-empty values`);
  }
}

async function currentPlanForExecution(
  root: string,
  step: ProviderTurnStep,
  execution: EpisodeStepExecutionContext,
): Promise<EpisodePlan> {
  const plan = await readEpisodePlanVersion(root, execution.episodeId, execution.planVersion);
  if (plan === undefined || plan.steps.find((candidate) => candidate.id === step.id) === undefined) {
    throw new GovernedPipelineEpisodeError(
      `cannot recover accepted plan v${execution.planVersion} for ${step.id}`,
    );
  }
  return plan;
}
