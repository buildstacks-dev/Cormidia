import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  turnAssignmentsEqual,
  validateAssignmentProviderFamily,
  validateTurnAssignment,
} from "../runtime/assignment.js";
import type {
  TurnAssignment,
  TurnAssignmentSource,
} from "../runtime/types.js";
import { withFileLock, type FileLockOptions } from "../runtime/file-lock.js";
import { writeLoopFileAtomic, writeLoopFileOnce } from "./durable.js";
import {
  efficiencyEpisodeDir,
  readRouteRecord,
  routeRecordPath,
} from "./efficiency.js";

export const EPISODE_PLAN_SCHEMA_VERSION = 1 as const;
export const EPISODE_PLAN_POINTER_SCHEMA_VERSION = 1 as const;
export const ASSIGNMENT_MODES = ["fixed", "adaptive"] as const;
export type AssignmentMode = (typeof ASSIGNMENT_MODES)[number];
export const SAFETY_FACT_KINDS = [
  "authentication",
  "security",
  "secrets",
  "privacy",
  "payments",
  "user_data",
  "data_migration",
  "production_deployment",
  "incident_response",
  "critical_operation",
  "independent_review",
  "release",
  "external_publication",
  "performance_sensitive",
] as const;
export type SafetyFactKind = (typeof SAFETY_FACT_KINDS)[number];

export interface SafetyFact {
  kind: SafetyFactKind;
  evidenceRefs: string[];
}

const STEP_ID_PATTERN = "^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*$";
const OPERATION_PATTERN = "^[a-z][a-z0-9]*(?:[-_/][a-z0-9]+)*$";
const HASH_PATTERN = "^[a-f0-9]{64}$";
const PLANNED_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["ref", "required"],
  properties: { ref: { type: "string", minLength: 1 }, required: { type: "boolean" } },
} as const;
const PLANNED_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["id", "kind", "required"],
  properties: {
    id: { type: "string", pattern: STEP_ID_PATTERN },
    kind: { type: "string", minLength: 1 },
    required: { type: "boolean" },
  },
} as const;
const STEP_BASE_PROPERTIES = {
  id: { type: "string", pattern: STEP_ID_PATTERN },
  objective: { type: "string", minLength: 1 },
  dependsOn: { type: "array", items: { type: "string", pattern: STEP_ID_PATTERN } },
  inputRefs: { type: "array", items: PLANNED_INPUT_SCHEMA },
  expectedOutputs: { type: "array", items: PLANNED_OUTPUT_SCHEMA },
} as const;
const STEP_BASE_REQUIRED = ["kind", "id", "objective", "dependsOn", "inputRefs", "expectedOutputs"] as const;

/** Native structured-output schema for the provider-authored proposal. */
export const EPISODE_PLAN_PROPOSAL_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  additionalProperties: false,
  required: [
    "schemaVersion", "episodeId", "version", "intentHash", "summary", "workflowClass",
    "planningSource", "steps", "estimatedBudget", "derivedSafetyRoute", "createdAt",
  ],
  properties: {
    schemaVersion: { const: EPISODE_PLAN_SCHEMA_VERSION },
    episodeId: { type: "string", minLength: 1 },
    version: { type: "integer", minimum: 1 },
    intentHash: { type: "string", pattern: HASH_PATTERN },
    summary: { type: "string", minLength: 1 },
    workflowClass: { type: "string", minLength: 1 },
    planningSource: { enum: ["episode_planner", "creator_scope"] },
    creatorProvenance: {
      type: "object",
      additionalProperties: false,
      required: ["source", "creatorId", "createdAt", "evidenceRefs"],
      properties: {
        source: { enum: ["human", "agent"] },
        creatorId: { type: "string", minLength: 1 },
        createdAt: { type: "string", format: "date-time" },
        evidenceRefs: { type: "array", minItems: 1, items: { type: "string", minLength: 1 } },
      },
    },
    steps: {
      type: "array",
      minItems: 1,
      items: {
        oneOf: [
          {
            type: "object",
            additionalProperties: false,
            required: [...STEP_BASE_REQUIRED, "operation", "role", "requiredCapabilities", "maxTurnBudgetUsd", "selectionReason"],
            properties: {
              ...STEP_BASE_PROPERTIES,
              kind: { const: "provider_turn" },
              operation: { type: "string", pattern: OPERATION_PATTERN },
              role: { type: "string", minLength: 1 },
              requiredCapabilities: { type: "array", items: { type: "string", minLength: 1 } },
              assignment: {
                type: "object",
                additionalProperties: false,
                required: ["harness", "model", "effort"],
                properties: {
                  harness: { enum: ["claude", "codex", "pi"] },
                  model: { type: "string", minLength: 1 },
                  effort: { enum: ["low", "medium", "high", "xhigh", "max"] },
                },
              },
              maxTurnBudgetUsd: { type: "number", exclusiveMinimum: 0 },
              selectionReason: { type: "string", minLength: 1 },
            },
          },
          {
            type: "object",
            additionalProperties: false,
            required: [...STEP_BASE_REQUIRED, "gate"],
            properties: {
              ...STEP_BASE_PROPERTIES,
              kind: { const: "mechanical_gate" },
              gate: { type: "string", minLength: 1 },
            },
          },
          {
            type: "object",
            additionalProperties: false,
            required: [...STEP_BASE_REQUIRED, "approvalKind", "actionRef"],
            properties: {
              ...STEP_BASE_PROPERTIES,
              kind: { const: "approval" },
              approvalKind: { type: "string", minLength: 1 },
              actionRef: { type: "string", minLength: 1 },
            },
          },
        ],
      },
    },
    estimatedBudget: {
      type: "object",
      additionalProperties: false,
      required: ["providerTurns", "providerTurnBudgetUsd", "mechanicalOverheadUsd", "totalBudgetUsd"],
      properties: {
        providerTurns: { type: "integer", minimum: 0 },
        providerTurnBudgetUsd: { type: "number", minimum: 0 },
        mechanicalOverheadUsd: { type: "number", minimum: 0 },
        totalBudgetUsd: { type: "number", minimum: 0 },
      },
    },
    derivedSafetyRoute: {
      type: "object",
      additionalProperties: false,
      required: ["label", "reasons", "gateStepIds", "approvalStepIds"],
      properties: {
        label: { type: "string", minLength: 1 },
        reasons: { type: "array", items: { type: "string" } },
        gateStepIds: { type: "array", items: { type: "string", pattern: STEP_ID_PATTERN } },
        approvalStepIds: { type: "array", items: { type: "string", pattern: STEP_ID_PATTERN } },
      },
    },
    createdAt: { type: "string", format: "date-time" },
  },
} as const satisfies Record<string, unknown>;

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface CreatorScopeProvenance {
  source: "human" | "agent";
  creatorId: string;
  createdAt: string;
  evidenceRefs: string[];
}

/**
 * `planningDisposition` is the explicit, auditable bypass decision. Merely
 * supplying fields that happen to look complete never sets it.
 */
export interface CreatorEpisodeScope {
  planningDisposition: "planner_input" | "execution_ready";
  provenance: CreatorScopeProvenance;
  workKind?: string;
  objective: string;
  inScope: string[];
  outOfScope: string[];
  acceptanceCriteria: string[];
  expectedArtifacts: PlannedOutput[];
  declaredConstraints: Record<string, JsonValue>;
  safetyFacts: SafetyFact[];
  steps?: ProposedEpisodeStep[];
  workflowTemplate?: GovernedWorkflowTemplateRef;
}

export interface GovernedWorkflowTemplateRef {
  id: string;
  version: string;
}

export interface TriggerDescriptor {
  kind: string;
  sourceRef?: string;
  payloadHash?: string;
}

export interface BudgetCeiling {
  maxProviderTurns: number;
  maxEquivalentCostUsd: number;
  maxMechanicalOverheadUsd?: number;
  maxInputTokens?: number;
  maxActiveTimeMs?: number;
  maxHumanDecisions?: number;
}

export interface RolePlanningView {
  role: string;
  responsibility: string;
  requiredCapabilities: string[];
  expectedOutputs: string[];
  configuredAssignment?: TurnAssignment;
}

export interface AllowedTurnAssignment {
  candidateId: string;
  role: string;
  assignment: TurnAssignment;
  providerFamily: string;
  capabilities: string[];
  qualificationRef: string;
  priceRef: string;
  /** Conservative per-turn ceiling from the approved operational catalog. */
  maxTurnCostUsd: number;
  available: boolean;
}

export interface EpisodeIntent {
  episodeId: string;
  app: string;
  assignmentMode: AssignmentMode;
  trigger: TriggerDescriptor;
  goal: string;
  lifecycle: string;
  appStage: string;
  repositoryFacts: Record<string, JsonValue>;
  changeFacts?: Record<string, JsonValue>;
  requestedConstraints: Record<string, JsonValue>;
  hardBudget: BudgetCeiling;
  availableRoles: RolePlanningView[];
  allowedAssignments: AllowedTurnAssignment[];
  requiredSafetyFacts: SafetyFact[];
  creatorScope?: CreatorEpisodeScope;
}

export interface PlannedInputRef {
  ref: string;
  required: boolean;
}

export interface PlannedOutput {
  id: string;
  kind: string;
  required: boolean;
}

interface EpisodeStepBase {
  id: string;
  objective: string;
  dependsOn: string[];
  inputRefs: PlannedInputRef[];
  expectedOutputs: PlannedOutput[];
}

export interface ProviderTurnStep extends EpisodeStepBase {
  kind: "provider_turn";
  /** Stable machine-readable operation selected by the plan. */
  operation: string;
  role: string;
  requiredCapabilities: string[];
  assignment: TurnAssignment;
  assignmentSource: TurnAssignmentSource;
  maxTurnBudgetUsd: number;
  selectionReason: string;
}

export interface MechanicalGateStep extends EpisodeStepBase {
  kind: "mechanical_gate";
  gate: string;
}

export interface ApprovalStep extends EpisodeStepBase {
  kind: "approval";
  approvalKind: string;
  actionRef: string;
}

export type EpisodeStep = ProviderTurnStep | MechanicalGateStep | ApprovalStep;

export interface ProposedProviderTurnStep extends EpisodeStepBase {
  kind: "provider_turn";
  /** Stable machine-readable operation selected by the planner or creator. */
  operation: string;
  role: string;
  requiredCapabilities: string[];
  assignment?: TurnAssignment;
  maxTurnBudgetUsd: number;
  selectionReason: string;
}

export type ProposedEpisodeStep =
  | ProposedProviderTurnStep
  | MechanicalGateStep
  | ApprovalStep;

export interface EpisodeBudgetEstimate {
  providerTurns: number;
  providerTurnBudgetUsd: number;
  mechanicalOverheadUsd: number;
  totalBudgetUsd: number;
}

export interface DerivedSafetyRoute {
  label: string;
  reasons: string[];
  gateStepIds: string[];
  approvalStepIds: string[];
}

export interface EpisodePlan {
  schemaVersion: typeof EPISODE_PLAN_SCHEMA_VERSION;
  episodeId: string;
  version: number;
  intentHash: string;
  summary: string;
  workflowClass: string;
  planningSource: "episode_planner" | "creator_scope";
  creatorProvenance?: CreatorScopeProvenance;
  steps: EpisodeStep[];
  estimatedBudget: EpisodeBudgetEstimate;
  derivedSafetyRoute: DerivedSafetyRoute;
  createdAt: string;
}

export interface ProposedEpisodePlan extends Omit<EpisodePlan, "steps"> {
  steps: ProposedEpisodeStep[];
}

export const EPISODE_PLAN_REASON_CODES = [
  "plan_structure_invalid",
  "episode_intent_structure_invalid",
  "plan_schema_version_invalid",
  "plan_episode_identity_mismatch",
  "plan_version_invalid",
  "plan_intent_hash_mismatch",
  "plan_assignment_mode_mismatch",
  "plan_summary_required",
  "plan_workflow_class_required",
  "plan_created_at_invalid",
  "plan_creator_scope_not_execution_ready",
  "plan_creator_provenance_mismatch",
  "plan_unexpected_creator_provenance",
  "plan_steps_empty",
  "plan_step_id_invalid",
  "plan_step_id_duplicate",
  "plan_step_objective_required",
  "plan_step_dependency_missing",
  "plan_step_self_dependency",
  "plan_step_dependency_cycle",
  "plan_step_unreachable",
  "plan_role_unknown",
  "plan_operation_invalid",
  "plan_assignment_invalid",
  "plan_assignment_not_allowed",
  "plan_assignment_catalog_duplicate",
  "plan_assignment_candidate_invalid",
  "plan_assignment_unavailable",
  "plan_assignment_price_invalid",
  "plan_assignment_source_invalid",
  "plan_capability_missing",
  "plan_selection_reason_required",
  "plan_turn_budget_invalid",
  "plan_turn_budget_exceeds_assignment",
  "plan_expected_output_invalid",
  "plan_expected_output_duplicate",
  "plan_terminal_output_missing",
  "plan_terminal_output_not_terminal",
  "plan_budget_arithmetic_invalid",
  "plan_budget_ceiling_invalid",
  "plan_budget_provider_turns_exceeded",
  "plan_budget_cost_exceeded",
  "plan_budget_mechanical_overhead_exceeded",
  "plan_budget_human_decisions_exceeded",
  "plan_safety_route_invalid",
  "plan_safety_fact_invalid",
  "plan_creator_safety_fact_missing",
  "plan_safety_provider_missing",
  "plan_safety_gate_missing",
  "plan_safety_approval_missing",
  "plan_independent_review_missing",
  "plan_independent_review_invalid",
  "creator_scope_absent",
  "creator_scope_structure_invalid",
  "creator_scope_bypass_not_requested",
  "creator_scope_provenance_invalid",
  "creator_scope_objective_required",
  "creator_scope_in_scope_required",
  "creator_scope_acceptance_required",
  "creator_scope_artifacts_required",
  "creator_scope_out_of_scope_invalid",
  "creator_scope_constraints_invalid",
  "creator_scope_safety_facts_invalid",
  "creator_scope_workflow_missing",
  "creator_scope_workflow_ambiguous",
  "creator_scope_template_unresolved",
  "creator_scope_assignment_unresolved",
  "creator_scope_assignment_not_allowed",
  "plan_fixed_assignment_missing",
  "plan_adaptive_assignment_missing",
  "plan_revision_version_invalid",
  "plan_revision_episode_mismatch",
  "plan_revision_created_at_invalid",
  "plan_revision_completed_step_missing",
  "plan_revision_completed_step_changed",
  "plan_revision_unknown_completed_step",
] as const;

export type EpisodePlanReasonCode = (typeof EPISODE_PLAN_REASON_CODES)[number];

export interface EpisodePlanIssue {
  code: EpisodePlanReasonCode;
  message: string;
  stepId?: string;
}

export interface EpisodePlanValidationResult {
  ok: boolean;
  issues: EpisodePlanIssue[];
  planHash?: string;
}

export interface IndependentReviewPolicy {
  subjectRoles: readonly string[];
  reviewerRoles: readonly string[];
  isIndependent(subject: ProviderTurnStep, reviewer: ProviderTurnStep): boolean;
}

export interface EpisodePlanValidationPolicy extends AssignmentMaterializationPolicy {
  isKnownRole(role: string): boolean;
  capabilitiesFor(role: string, assignment: TurnAssignment): readonly string[];
  requiredTerminalOutputIds: readonly string[];
  /** Provider ownership floors validate the proposed graph. They never add a
   * turn or substitute another organizational role. */
  requiredProviderRoles?: readonly string[];
  requiredGateKinds?: readonly string[];
  requiredApprovalKinds?: readonly string[];
  independentReview?: IndependentReviewPolicy;
}

export interface AssignmentMaterializationPolicy {
  mode: AssignmentMode;
  configuredAssignmentFor(role: string): TurnAssignment | undefined;
  /** True when the exact tuple is org/app approved. Current availability is
   * carried separately by AllowedTurnAssignment and checked only if selected. */
  isAssignmentAllowed(role: string, assignment: TurnAssignment): boolean;
}

export interface CreatorScopePolicy extends AssignmentMaterializationPolicy {
  isKnownRole(role: string): boolean;
  maxTurnCostUsdFor(role: string, assignment: TurnAssignment): number | undefined;
  resolveWorkflowTemplate(ref: GovernedWorkflowTemplateRef): readonly ProposedEpisodeStep[] | undefined;
}

export interface CreatorScopeAssessment {
  executionReady: boolean;
  runEpisodePlanner: boolean;
  issues: EpisodePlanIssue[];
  resolvedSteps?: ProposedEpisodeStep[];
}

export interface CurrentEpisodePlanPointer {
  schemaVersion: typeof EPISODE_PLAN_POINTER_SCHEMA_VERSION;
  episodeId: string;
  version: number;
  planHash: string;
  file: string;
  updatedAt: string;
}

export class EpisodePlanValidationError extends Error {
  readonly code = "error_episode_plan_invalid" as const;
  constructor(readonly issues: readonly EpisodePlanIssue[]) {
    super(issues.map((issue) => `${issue.code}: ${issue.message}`).join("; "));
    this.name = "EpisodePlanValidationError";
  }
}

export class EpisodePlanPersistenceError extends Error {
  constructor(
    readonly code:
      | "error_episode_plan_version_conflict"
      | "error_episode_plan_pointer_conflict"
      | "error_episode_plan_revision_authority_required"
      | "error_episode_plan_revision_execution_active"
      | "error_episode_plan_revision_terminal"
      | "error_episode_plan_corrupt",
    message: string,
  ) {
    super(message);
    this.name = "EpisodePlanPersistenceError";
  }
}

const STEP_ID = /^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*$/;
const OPERATION = /^[a-z][a-z0-9]*(?:[-_/][a-z0-9]+)*$/;
const HASH = /^[a-f0-9]{64}$/;
const EPSILON = 1e-9;
const PLAN_MUTATION_LOCK_OPTIONS: FileLockOptions = {
  staleMs: 6 * 60 * 60_000,
  maxWaitMs: 2_000,
  retryMinMs: 20,
  retryMaxMs: 60,
};

export function episodeIntentHash(intent: EpisodeIntent): string {
  return stableHash(intent);
}

export function episodePlanHash(plan: EpisodePlan): string {
  return stableHash(plan);
}

export function stableHash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

/** Canonical JSON sorts object keys recursively while preserving array order. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

/** Strict provider-output boundary. Unknown fields and malformed nested data fail closed. */
export function parseProposedEpisodePlan(value: unknown): ProposedEpisodePlan {
  if (!isProposedEpisodePlan(value)) {
    throw new EpisodePlanValidationError([
      issue("plan_structure_invalid", "proposed EpisodePlan is not a strict schema-v1 plan"),
    ]);
  }
  return structuredClone(value);
}

/** Strict episode-envelope boundary. Incomplete values remain representable
 * (empty objective/lists) so the planner can complete them, but provenance,
 * field spelling, and value kinds must be explicit and auditable. */
export function parseCreatorEpisodeScope(value: unknown): CreatorEpisodeScope {
  if (!isCreatorEpisodeScopeStrict(value)) {
    throw new EpisodePlanValidationError([
      issue("creator_scope_structure_invalid", "creator scope is not a strict explicit envelope"),
    ]);
  }
  return structuredClone(value);
}

/** Strict durable/provider boundary for the bounded deterministic intent. */
export function parseEpisodeIntent(value: unknown): EpisodeIntent {
  if (!isEpisodeIntentStrict(value)) {
    throw new EpisodePlanValidationError([
      issue("episode_intent_structure_invalid", "EpisodeIntent is not a strict bounded schema-v1 value"),
    ]);
  }
  return structuredClone(value);
}

export function estimateEpisodePlanBudget(
  steps: readonly EpisodeStep[],
  mechanicalOverheadUsd: number,
): EpisodeBudgetEstimate {
  const provider = steps.filter((step): step is ProviderTurnStep => step.kind === "provider_turn");
  const providerTurnBudgetUsd = provider.reduce((sum, step) => sum + step.maxTurnBudgetUsd, 0);
  return {
    providerTurns: provider.length,
    providerTurnBudgetUsd,
    mechanicalOverheadUsd,
    totalBudgetUsd: providerTurnBudgetUsd + mechanicalOverheadUsd,
  };
}

/** Deterministic compatibility/safety projection from the accepted workflow.
 * It reports the plan; it never selects steps or assignments. */
export function deriveEpisodeSafetyRoute(
  steps: readonly ProposedEpisodeStep[] | readonly EpisodeStep[],
  safetyFacts: readonly SafetyFact[],
): DerivedSafetyRoute {
  const providerTurns = steps.filter((step) => step.kind === "provider_turn").length;
  const gates = steps
    .filter((step) => step.kind === "mechanical_gate")
    .map((step) => step.id)
    .sort();
  const approvals = steps
    .filter((step) => step.kind === "approval")
    .map((step) => step.id)
    .sort();
  const highFloorKinds = new Set<SafetyFactKind>([
    "authentication",
    "security",
    "secrets",
    "privacy",
    "payments",
    "user_data",
    "data_migration",
    "production_deployment",
    "incident_response",
    "critical_operation",
  ]);
  const highFloor = safetyFacts.some((fact) => highFloorKinds.has(fact.kind));
  const label = highFloor || providerTurns >= 4
    ? "deep"
    : providerTurns >= 2 || gates.length > 0 || approvals.length > 0
      ? "standard"
      : "quick";
  return {
    label,
    reasons: [...new Set([
      `derived-from-${providerTurns}-provider-turns`,
      ...safetyFacts.map((fact) => `safety:${fact.kind}`),
    ])].sort(),
    gateStepIds: gates,
    approvalStepIds: approvals,
  };
}

/**
 * Populates the atomic assignment after workflow design. Fixed mode ignores
 * proposal assignment fields and uses configuration; adaptive mode requires
 * an exact approved tuple and never repairs or substitutes one member.
 */
export function materializeEpisodePlanAssignments(
  proposal: ProposedEpisodePlan,
  policy: AssignmentMaterializationPolicy,
): EpisodePlan {
  const issues: EpisodePlanIssue[] = [];
  const steps: EpisodeStep[] = [];
  for (const step of proposal.steps) {
    if (step.kind !== "provider_turn") {
      steps.push(cloneStep(step));
      continue;
    }
    if (policy.mode === "fixed") {
      const configured = policy.configuredAssignmentFor(step.role);
      if (configured === undefined) {
        issues.push(issue("plan_fixed_assignment_missing", `role ${step.role} has no configured assignment`, step.id));
        continue;
      }
      let assignment: TurnAssignment;
      try {
        assignment = validateTurnAssignment(configured, `configured assignment for ${step.role}`);
      } catch (error) {
        issues.push(issue("plan_assignment_invalid", errorMessage(error), step.id));
        continue;
      }
      steps.push({ ...cloneProviderProposal(step), assignment, assignmentSource: "configured" });
      continue;
    }
    if (step.assignment === undefined) {
      issues.push(issue("plan_adaptive_assignment_missing", `adaptive step ${step.id} requires an assignment`, step.id));
      continue;
    }
    let assignment: TurnAssignment;
    try {
      assignment = validateTurnAssignment(step.assignment, `assignment for ${step.id}`);
    } catch (error) {
      issues.push(issue("plan_assignment_invalid", errorMessage(error), step.id));
      continue;
    }
    if (!policy.isAssignmentAllowed(step.role, assignment)) {
      issues.push(issue("plan_assignment_not_allowed", `assignment for ${step.id} is not approved for ${step.role}`, step.id));
      continue;
    }
    const assignmentSource: TurnAssignmentSource = proposal.planningSource === "creator_scope"
      ? "creator"
      : "episode_planner";
    steps.push({ ...cloneProviderProposal(step), assignment, assignmentSource });
  }
  if (issues.length > 0) throw new EpisodePlanValidationError(issues);
  return { ...proposal, steps };
}

export function assessCreatorScope(
  scope: CreatorEpisodeScope | undefined,
  policy: CreatorScopePolicy,
): CreatorScopeAssessment {
  if (scope === undefined) {
    return {
      executionReady: false,
      runEpisodePlanner: true,
      issues: [issue("creator_scope_absent", "episode has no explicit creator scope")],
    };
  }
  if (scope.planningDisposition !== "execution_ready") {
    return {
      executionReady: false,
      runEpisodePlanner: true,
      issues: [issue("creator_scope_bypass_not_requested", "creator scope is authoritative planner input, not an execution-ready bypass")],
    };
  }

  const issues: EpisodePlanIssue[] = [];
  validateCreatorProvenance(scope.provenance, issues);
  if (!nonEmpty(scope.objective)) issues.push(issue("creator_scope_objective_required", "creator objective is required"));
  if (!nonEmptyStrings(scope.inScope)) issues.push(issue("creator_scope_in_scope_required", "creator scope must name in-scope work"));
  if (!Array.isArray(scope.outOfScope) || scope.outOfScope.some((entry) => !nonEmpty(entry))) {
    issues.push(issue("creator_scope_out_of_scope_invalid", "creator scope must explicitly provide valid out-of-scope work"));
  }
  if (!nonEmptyStrings(scope.acceptanceCriteria)) issues.push(issue("creator_scope_acceptance_required", "creator scope must name acceptance criteria"));
  validateCreatorExpectedArtifacts(scope.expectedArtifacts, issues);
  if (!isRecord(scope.declaredConstraints)) {
    issues.push(issue("creator_scope_constraints_invalid", "creator scope must explicitly provide declared constraints"));
  }
  if (!Array.isArray(scope.safetyFacts) || scope.safetyFacts.some((entry) => !validSafetyFact(entry))) {
    issues.push(issue("creator_scope_safety_facts_invalid", "creator scope must explicitly provide typed safety facts with evidence references"));
  }

  const hasSteps = scope.steps !== undefined;
  const hasTemplate = scope.workflowTemplate !== undefined;
  if (!hasSteps && !hasTemplate) {
    issues.push(issue("creator_scope_workflow_missing", "creator scope requires explicit steps or one governed workflow template"));
  }
  if (hasSteps && hasTemplate) {
    issues.push(issue("creator_scope_workflow_ambiguous", "creator scope cannot specify both steps and a workflow template"));
  }

  let resolvedSteps: ProposedEpisodeStep[] | undefined;
  if (hasSteps) resolvedSteps = scope.steps?.map(cloneProposedStep);
  if (hasTemplate) {
    const resolved = policy.resolveWorkflowTemplate(scope.workflowTemplate!);
    if (resolved === undefined || resolved.length === 0) {
      issues.push(issue("creator_scope_template_unresolved", `workflow template ${scope.workflowTemplate!.id}@${scope.workflowTemplate!.version} did not resolve unambiguously`));
    } else {
      resolvedSteps = resolved.map(cloneProposedStep);
    }
  }

  if (resolvedSteps !== undefined) {
    for (const step of resolvedSteps) {
      if (step.kind !== "provider_turn") continue;
      if (!policy.isKnownRole(step.role)) {
        issues.push(issue("plan_role_unknown", `unknown role ${step.role}`, step.id));
        continue;
      }
      if (policy.mode === "fixed") {
        const configured = policy.configuredAssignmentFor(step.role);
        if (configured === undefined) {
          issues.push(issue("creator_scope_assignment_unresolved", `fixed assignment for ${step.role} does not resolve`, step.id));
          continue;
        }
        try {
          const assignment = validateTurnAssignment(configured, `configured assignment for ${step.role}`);
          validateCreatorTurnCeiling(step, assignment, policy, issues);
        } catch (error) {
          issues.push(issue("creator_scope_assignment_unresolved", errorMessage(error), step.id));
        }
        continue;
      }
      if (step.assignment === undefined) {
        issues.push(issue("creator_scope_assignment_unresolved", `adaptive creator step ${step.id} requires an exact assignment`, step.id));
        continue;
      }
      try {
        const assignment = validateTurnAssignment(step.assignment, `creator assignment for ${step.id}`);
        if (!policy.isAssignmentAllowed(step.role, assignment)) {
          issues.push(issue("creator_scope_assignment_not_allowed", `creator assignment for ${step.id} is not approved`, step.id));
        }
        validateCreatorTurnCeiling(step, assignment, policy, issues);
      } catch (error) {
        issues.push(issue("creator_scope_assignment_unresolved", errorMessage(error), step.id));
      }
    }
    const graphIssues = validateGraph(
      resolvedSteps,
      scope.expectedArtifacts.filter((artifact) => artifact.required).map((artifact) => artifact.id),
    );
    issues.push(...graphIssues);
  }

  if (issues.length > 0) return { executionReady: false, runEpisodePlanner: true, issues };
  return {
    executionReady: true,
    runEpisodePlanner: false,
    issues: [],
    resolvedSteps: resolvedSteps!,
  };
}

export function validateEpisodePlan(
  plan: EpisodePlan,
  intent: EpisodeIntent,
  policy: EpisodePlanValidationPolicy,
): EpisodePlanValidationResult {
  const issues: EpisodePlanIssue[] = [];
  if (plan.schemaVersion !== EPISODE_PLAN_SCHEMA_VERSION) {
    issues.push(issue("plan_schema_version_invalid", `schema version must be ${EPISODE_PLAN_SCHEMA_VERSION}`));
  }
  if (plan.episodeId !== intent.episodeId || !nonEmpty(plan.episodeId)) {
    issues.push(issue("plan_episode_identity_mismatch", `plan episode ${plan.episodeId} does not match intent ${intent.episodeId}`));
  }
  if (!Number.isSafeInteger(plan.version) || plan.version < 1) {
    issues.push(issue("plan_version_invalid", "plan version must be a positive safe integer"));
  }
  const expectedIntentHash = episodeIntentHash(intent);
  if (plan.intentHash !== expectedIntentHash) {
    issues.push(issue("plan_intent_hash_mismatch", `intent hash must be ${expectedIntentHash}`));
  }
  if (intent.assignmentMode !== policy.mode) {
    issues.push(issue("plan_assignment_mode_mismatch", `intent mode ${intent.assignmentMode} does not match validation mode ${policy.mode}`));
  }
  if (!nonEmpty(plan.summary)) issues.push(issue("plan_summary_required", "plan summary is required"));
  if (!nonEmpty(plan.workflowClass)) issues.push(issue("plan_workflow_class_required", "workflow class is required"));
  if (!validTimestamp(plan.createdAt)) issues.push(issue("plan_created_at_invalid", "createdAt must be an ISO-8601 timestamp"));
  validatePlanningSource(plan, intent, issues);
  validateIntentAssignmentCatalog(intent, policy, issues);
  if (!Array.isArray(intent.requiredSafetyFacts) || intent.requiredSafetyFacts.some((fact) => !validSafetyFact(fact))) {
    issues.push(issue("plan_safety_fact_invalid", "episode intent contains an invalid typed safety fact"));
  } else {
    const required = new Set(intent.requiredSafetyFacts.map(safetyFactIdentity));
    for (const creatorFact of intent.creatorScope?.safetyFacts ?? []) {
      if (!required.has(safetyFactIdentity(creatorFact))) {
        issues.push(issue(
          "plan_creator_safety_fact_missing",
          `episode intent dropped creator-declared safety fact ${creatorFact.kind}`,
        ));
      }
    }
  }

  if (plan.steps.length === 0) issues.push(issue("plan_steps_empty", "plan must contain at least one step"));
  const ids = new Set<string>();
  for (const step of plan.steps) {
    if (!STEP_ID.test(step.id)) issues.push(issue("plan_step_id_invalid", `invalid stable step id ${step.id}`, step.id));
    if (ids.has(step.id)) issues.push(issue("plan_step_id_duplicate", `duplicate step id ${step.id}`, step.id));
    ids.add(step.id);
    if (!nonEmpty(step.objective)) issues.push(issue("plan_step_objective_required", "step objective is required", step.id));
    if (step.expectedOutputs.some((output) => !validOutput(output))) {
      issues.push(issue("plan_expected_output_invalid", "expected outputs require stable ids and non-empty kinds", step.id));
    }
    if (step.kind === "provider_turn") validateProviderStep(step, plan.planningSource, intent, policy, issues);
  }
  issues.push(...validateGraph(plan.steps, policy.requiredTerminalOutputIds));
  validateBudget(plan, intent.hardBudget, issues);
  validateSafetyRoute(plan, intent, policy, issues);
  validateIndependentReview(plan, policy.independentReview, issues);

  const uniqueIssues = dedupeIssues(issues);
  return uniqueIssues.length === 0
    ? { ok: true, issues: [], planHash: episodePlanHash(plan) }
    : { ok: false, issues: uniqueIssues };
}

export function assertEpisodePlanValid(
  plan: EpisodePlan,
  intent: EpisodeIntent,
  policy: EpisodePlanValidationPolicy,
): string {
  const result = validateEpisodePlan(plan, intent, policy);
  if (!result.ok) throw new EpisodePlanValidationError(result.issues);
  return result.planHash!;
}

export function validateForwardOnlyRevision(
  previous: EpisodePlan,
  next: EpisodePlan,
  completedStepIds: readonly string[],
): EpisodePlanIssue[] {
  const issues: EpisodePlanIssue[] = [];
  if (next.episodeId !== previous.episodeId) {
    issues.push(issue("plan_revision_episode_mismatch", "a revision cannot change episode identity"));
  }
  if (next.version !== previous.version + 1) {
    issues.push(issue("plan_revision_version_invalid", `revision must be version ${previous.version + 1}`));
  }
  if (!validTimestamp(next.createdAt) || Date.parse(next.createdAt) < Date.parse(previous.createdAt)) {
    issues.push(issue("plan_revision_created_at_invalid", "revision timestamp cannot precede the prior plan"));
  }
  const priorById = new Map(previous.steps.map((step) => [step.id, step]));
  const nextById = new Map(next.steps.map((step) => [step.id, step]));
  for (const stepId of new Set(completedStepIds)) {
    const prior = priorById.get(stepId);
    if (prior === undefined) {
      issues.push(issue("plan_revision_unknown_completed_step", `completed step ${stepId} is absent from the prior plan`, stepId));
      continue;
    }
    const replacement = nextById.get(stepId);
    if (replacement === undefined) {
      issues.push(issue("plan_revision_completed_step_missing", `completed step ${stepId} must remain in the revision`, stepId));
      continue;
    }
    if (stableHash(prior) !== stableHash(replacement)) {
      issues.push(issue("plan_revision_completed_step_changed", `completed step ${stepId} is immutable`, stepId));
    }
  }
  return issues;
}

/** Ready sets are sorted by stable id, never proposal array order. */
export function selectReadyEpisodeSteps(
  plan: EpisodePlan,
  completedStepIds: readonly string[],
  inFlightStepIds: readonly string[] = [],
): EpisodeStep[] {
  const known = new Set(plan.steps.map((step) => step.id));
  for (const id of [...completedStepIds, ...inFlightStepIds]) {
    if (!known.has(id)) throw new Error(`unknown episode plan step ${id}`);
  }
  const completed = new Set(completedStepIds);
  const inFlight = new Set(inFlightStepIds);
  return plan.steps
    .filter((step) => !completed.has(step.id) && !inFlight.has(step.id) && step.dependsOn.every((id) => completed.has(id)))
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function episodePlanVersionPath(root: string, episodeId: string, version: number): string {
  return join(efficiencyEpisodeDir(root, episodeId), `plan-v${version}.json`);
}

export function episodeIntentPath(root: string, episodeId: string): string {
  return join(efficiencyEpisodeDir(root, episodeId), "intent.json");
}

/** Persist the bounded EpisodeIntent once. Every revision validates against
 * these immutable bytes rather than a caller-supplied replacement object. */
export async function persistEpisodeIntent(
  root: string,
  intent: EpisodeIntent,
): Promise<string> {
  const validated = parseEpisodeIntent(intent);
  const hash = episodeIntentHash(validated);
  const path = episodeIntentPath(root, intent.episodeId);
  const contents = `${JSON.stringify(validated, null, 2)}\n`;
  const won = await writeLoopFileOnce(path, contents);
  if (!won) {
    const existing = await readPersistedEpisodeIntent(root, intent.episodeId);
    if (existing === undefined || episodeIntentHash(existing) !== hash) {
      throw new EpisodePlanPersistenceError(
        "error_episode_plan_pointer_conflict",
        `episode intent conflict for ${intent.episodeId}`,
      );
    }
  }
  return hash;
}

export async function readPersistedEpisodeIntent(
  root: string,
  episodeId: string,
): Promise<EpisodeIntent | undefined> {
  const raw = await readOptionalFile(episodeIntentPath(root, episodeId));
  if (raw === undefined) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    throw new EpisodePlanPersistenceError(
      "error_episode_plan_corrupt",
      `episode intent ${episodeId} is not valid JSON`,
    );
  }
  const intent = parseEpisodeIntent(value);
  if (intent.episodeId !== episodeId) {
    throw new EpisodePlanPersistenceError(
      "error_episode_plan_corrupt",
      `episode intent ${episodeId} has a different identity`,
    );
  }
  return intent;
}

export function currentEpisodePlanPointerPath(root: string, episodeId: string): string {
  return join(efficiencyEpisodeDir(root, episodeId), "plan-current.json");
}

/** Shared by plan publication and execution so a forward-only revision can
 * never race a provider/mechanical side effect. */
export function episodePlanMutationLockPath(root: string, episodeId: string): string {
  return join(efficiencyEpisodeDir(root, episodeId), "plan-execution.lock");
}

export async function readEpisodePlanVersion(
  root: string,
  episodeId: string,
  version: number,
): Promise<EpisodePlan | undefined> {
  const raw = await readOptionalFile(episodePlanVersionPath(root, episodeId, version));
  if (raw === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new EpisodePlanPersistenceError("error_episode_plan_corrupt", `plan v${version} for ${episodeId} is not valid JSON`);
  }
  if (!isEpisodePlan(parsed) || parsed.episodeId !== episodeId || parsed.version !== version) {
    throw new EpisodePlanPersistenceError("error_episode_plan_corrupt", `plan v${version} for ${episodeId} is not a valid matching v1 plan`);
  }
  return parsed;
}

export async function readCurrentEpisodePlanPointer(
  root: string,
  episodeId: string,
): Promise<CurrentEpisodePlanPointer | undefined> {
  const raw = await readOptionalFile(currentEpisodePlanPointerPath(root, episodeId));
  if (raw === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new EpisodePlanPersistenceError("error_episode_plan_corrupt", `current plan pointer for ${episodeId} is not valid JSON`);
  }
  if (!isCurrentPointer(parsed) || parsed.episodeId !== episodeId) {
    throw new EpisodePlanPersistenceError("error_episode_plan_corrupt", `current plan pointer for ${episodeId} is invalid`);
  }
  return parsed;
}

export async function readCurrentEpisodePlan(root: string, episodeId: string): Promise<EpisodePlan | undefined> {
  const pointer = await readCurrentEpisodePlanPointer(root, episodeId);
  if (pointer === undefined) return undefined;
  const plan = await readEpisodePlanVersion(root, episodeId, pointer.version);
  if (plan === undefined || episodePlanHash(plan) !== pointer.planHash || pointer.file !== `plan-v${pointer.version}.json`) {
    throw new EpisodePlanPersistenceError("error_episode_plan_corrupt", `current plan pointer for ${episodeId} does not match its immutable plan`);
  }
  return plan;
}

export async function persistEpisodePlan(input: {
  root: string;
  plan: EpisodePlan;
  intent: EpisodeIntent;
  policy: EpisodePlanValidationPolicy;
}): Promise<CurrentEpisodePlanPointer> {
  if (input.plan.version !== 1) {
    throw new EpisodePlanPersistenceError(
      "error_episode_plan_revision_authority_required",
      "persistEpisodePlan accepts only initial version 1 plans; revisions require a pending typed replan request",
    );
  }
  await persistEpisodeIntent(input.root, input.intent);
  return withFileLock(
    episodePlanMutationLockPath(input.root, input.plan.episodeId),
    PLAN_MUTATION_LOCK_OPTIONS,
    async () => persistEpisodePlanLocked(input, undefined),
  );
}

interface EpisodePlanRevisionAuthority {
  requestId: string;
  expectedCurrentVersion: number;
  expectedCurrentPlanHash: string;
}

/** @internal Revision storage primitive for publishEpisodePlanRevision. The
 * durable pending typed request and current-plan CAS are rechecked under the
 * shared plan/execution lock, so calling this function without the replan
 * protocol cannot advance the pointer. */
export async function persistEpisodePlanRevisionFromReplan(input: {
  root: string;
  plan: EpisodePlan;
  intent: EpisodeIntent;
  policy: EpisodePlanValidationPolicy;
  authority: EpisodePlanRevisionAuthority;
}): Promise<CurrentEpisodePlanPointer> {
  return withFileLock(
    episodePlanMutationLockPath(input.root, input.plan.episodeId),
    PLAN_MUTATION_LOCK_OPTIONS,
    async () => persistEpisodePlanLocked(input, input.authority),
  );
}

async function persistEpisodePlanLocked(input: {
  root: string;
  plan: EpisodePlan;
  intent: EpisodeIntent;
  policy: EpisodePlanValidationPolicy;
}, authority: EpisodePlanRevisionAuthority | undefined): Promise<CurrentEpisodePlanPointer> {
  const current = await readCurrentEpisodePlan(input.root, input.plan.episodeId);
  const validationIntent = authority === undefined
    ? input.intent
    : await requireImmutableRevisionIntent(input.root, input.intent, current, input.plan);
  const validationPolicy = immutableIntentPolicy(input.policy, validationIntent);
  const planHash = assertEpisodePlanValid(input.plan, validationIntent, validationPolicy);
  if (authority === undefined) {
    if (current !== undefined && current.version !== 1) {
      throw new EpisodePlanPersistenceError(
        "error_episode_plan_pointer_conflict",
        `initial plan persistence cannot replace current plan v${current.version}`,
      );
    }
  } else {
    if (current === undefined) {
      throw new EpisodePlanPersistenceError(
        "error_episode_plan_pointer_conflict",
        "a plan revision requires an existing current plan",
      );
    }
    if (
      current.version !== authority.expectedCurrentVersion ||
      episodePlanHash(current) !== authority.expectedCurrentPlanHash ||
      input.plan.version !== current.version + 1
    ) {
      throw new EpisodePlanPersistenceError(
        "error_episode_plan_pointer_conflict",
        `revision CAS expected current v${authority.expectedCurrentVersion} and proposal v${authority.expectedCurrentVersion + 1}`,
      );
    }
    await assertPendingReplanAuthority(input.root, current, authority.requestId);
    await assertEpisodeRevisionOpen(input.root, current.episodeId);
  }

  if (current !== undefined && current.version === input.plan.version) {
    if (episodePlanHash(current) !== planHash) {
      throw new EpisodePlanPersistenceError(
        "error_episode_plan_version_conflict",
        `plan v${input.plan.version} for ${input.plan.episodeId} is already current with different content`,
      );
    }
    return (await readCurrentEpisodePlanPointer(input.root, input.plan.episodeId))!;
  }
  if (current !== undefined) {
    const completedStepIds = await journalDerivedCompletedStepIds(input.root, current);
    const revisionIssues = validateForwardOnlyRevision(current, input.plan, completedStepIds);
    if (revisionIssues.length > 0) throw new EpisodePlanValidationError(revisionIssues);
  }

  const planPath = episodePlanVersionPath(input.root, input.plan.episodeId, input.plan.version);
  const contents = `${JSON.stringify(input.plan, null, 2)}\n`;
  const won = await writeLoopFileOnce(planPath, contents);
  if (!won) {
    const existing = await readEpisodePlanVersion(input.root, input.plan.episodeId, input.plan.version);
    if (existing === undefined || episodePlanHash(existing) !== planHash) {
      throw new EpisodePlanPersistenceError(
        "error_episode_plan_version_conflict",
        `plan v${input.plan.version} for ${input.plan.episodeId} already contains different content`,
      );
    }
  }

  // Re-read after immutable publication so the pointer can never lead it.
  const persisted = await readEpisodePlanVersion(input.root, input.plan.episodeId, input.plan.version);
  if (persisted === undefined || episodePlanHash(persisted) !== planHash) {
    throw new EpisodePlanPersistenceError("error_episode_plan_corrupt", `persisted plan v${input.plan.version} failed hash verification`);
  }
  const pointer: CurrentEpisodePlanPointer = {
    schemaVersion: EPISODE_PLAN_POINTER_SCHEMA_VERSION,
    episodeId: input.plan.episodeId,
    version: input.plan.version,
    planHash,
    file: `plan-v${input.plan.version}.json`,
    updatedAt: input.plan.createdAt,
  };
  await writeLoopFileAtomic(
    currentEpisodePlanPointerPath(input.root, input.plan.episodeId),
    `${JSON.stringify(pointer, null, 2)}\n`,
  );
  return pointer;
}

async function requireImmutableRevisionIntent(
  root: string,
  supplied: EpisodeIntent,
  current: EpisodePlan | undefined,
  next: EpisodePlan,
): Promise<EpisodeIntent> {
  const persisted = await readPersistedEpisodeIntent(root, next.episodeId);
  if (persisted === undefined || current === undefined) {
    throw new EpisodePlanPersistenceError(
      "error_episode_plan_corrupt",
      `episode ${next.episodeId} is missing immutable intent or current-plan evidence`,
    );
  }
  const persistedHash = episodeIntentHash(persisted);
  if (
    current.intentHash !== persistedHash ||
    next.intentHash !== persistedHash ||
    episodeIntentHash(supplied) !== persistedHash
  ) {
    throw new EpisodePlanValidationError([issue(
      "plan_intent_hash_mismatch",
      `revision intent must remain ${persistedHash}`,
    )]);
  }
  return persisted;
}

/** Narrow policy callbacks to the immutable intent catalog. A caller may
 * enforce stricter current policy, but cannot widen roles, assignments, or
 * capabilities beyond the authority captured at episode creation. */
function immutableIntentPolicy(
  policy: EpisodePlanValidationPolicy,
  intent: EpisodeIntent,
): EpisodePlanValidationPolicy {
  const roles = new Map(intent.availableRoles.map((role) => [role.role, role]));
  const candidates = intent.allowedAssignments;
  const candidateFor = (role: string, assignment: TurnAssignment): AllowedTurnAssignment | undefined =>
    candidates.find((candidate) =>
      candidate.role === role && assignmentsEqualSafe(candidate.assignment, assignment));
  return {
    ...policy,
    configuredAssignmentFor: (role) => roles.get(role)?.configuredAssignment,
    isKnownRole: (role) => roles.has(role) && policy.isKnownRole(role),
    isAssignmentAllowed: (role, assignment) =>
      candidateFor(role, assignment) !== undefined && policy.isAssignmentAllowed(role, assignment),
    capabilitiesFor: (role, assignment) => {
      const immutable = new Set(candidateFor(role, assignment)?.capabilities ?? []);
      return policy.capabilitiesFor(role, assignment).filter((capability) => immutable.has(capability));
    },
  };
}

async function assertEpisodeRevisionOpen(root: string, episodeId: string): Promise<void> {
  if (existsSync(routeRecordPath(root, episodeId))) {
    const route = await readRouteRecord(root, episodeId);
    if (route.terminal !== null) {
      throw new EpisodePlanPersistenceError(
        "error_episode_plan_revision_terminal",
        `terminal episode ${episodeId} cannot publish a plan revision`,
      );
    }
  }
  const execution = await import("./episode-plan-executor.js");
  const journal = await execution.readEpisodePlanExecutionJournal(root, episodeId);
  if (journal?.status === "completed") {
    throw new EpisodePlanPersistenceError(
      "error_episode_plan_revision_terminal",
      `completed episode ${episodeId} cannot publish a plan revision`,
    );
  }
}

async function assertPendingReplanAuthority(
  root: string,
  current: EpisodePlan,
  requestId: string,
): Promise<void> {
  try {
    const replan = await import("./episode-replan.js");
    const journal = await replan.readEpisodeReplanJournal(root, current.episodeId);
    const request = journal?.records.find((record) => record.trigger.id === requestId);
    if (
      request === undefined ||
      request.status !== "pending" ||
      request.trigger.planVersion !== current.version
    ) {
      throw new EpisodePlanPersistenceError(
        "error_episode_plan_revision_authority_required",
        `plan revision requires pending replan request ${requestId} for current v${current.version}`,
      );
    }
  } catch (error) {
    if (error instanceof EpisodePlanPersistenceError) throw error;
    throw new EpisodePlanPersistenceError(
      "error_episode_plan_revision_authority_required",
      `plan revision authority ${requestId} could not be verified: ${errorMessage(error)}`,
    );
  }
}

/**
 * Reads revision authority while the caller holds plan-execution.lock. The
 * executor owns the strict journal grammar and lifecycle checks; this boundary
 * additionally binds every execution event back to the immutable plan version
 * that authorized it. A caller-provided list can therefore never manufacture
 * or omit completed work.
 *
 * The executor is loaded lazily to avoid a static module cycle: it imports the
 * plan contract in order to execute it, while revisions need only its durable
 * journal reader after both modules have initialized.
 */
async function journalDerivedCompletedStepIds(
  root: string,
  current: EpisodePlan,
): Promise<string[]> {
  let journal: import("./episode-plan-executor.js").EpisodePlanExecutionJournal | undefined;
  let completedStepIds: string[];
  try {
    const execution = await import("./episode-plan-executor.js");
    journal = await execution.readEpisodePlanExecutionJournal(root, current.episodeId);
    if (journal === undefined) return [];
    completedStepIds = execution.completedEpisodePlanStepIds(journal);
  } catch (error) {
    if (error instanceof EpisodePlanPersistenceError) throw error;
    throw new EpisodePlanPersistenceError(
      "error_episode_plan_corrupt",
      `execution journal for ${current.episodeId} cannot authorize a plan revision: ${errorMessage(error)}`,
    );
  }

  if (journal.current_plan_version > current.version) {
    throw new EpisodePlanPersistenceError(
      "error_episode_plan_corrupt",
      `execution journal for ${current.episodeId} references future plan v${journal.current_plan_version}`,
    );
  }

  const terminalExecutionIds = new Set(journal.events.flatMap((event) =>
    event.kind === "step_completed" || event.kind === "step_failed" ||
      event.kind === "approval_pending" || event.kind === "approval_denied"
      ? [event.execution_id]
      : []));
  const active = journal.events.find((event): event is import("./episode-plan-executor.js").StepStartedEvent =>
    event.kind === "step_started" && !terminalExecutionIds.has(event.execution_id));
  if (active !== undefined) {
    throw new EpisodePlanPersistenceError(
      "error_episode_plan_revision_execution_active",
      `cannot revise ${current.episodeId} while execution ${active.execution_id} is unterminated`,
    );
  }

  const plansByVersion = new Map<number, EpisodePlan>();
  for (const event of journal.events) {
    const persisted = plansByVersion.get(event.plan_version) ??
      await readEpisodePlanVersion(root, current.episodeId, event.plan_version);
    if (persisted === undefined || episodePlanHash(persisted) !== event.plan_sha256) {
      throw new EpisodePlanPersistenceError(
        "error_episode_plan_corrupt",
        `execution journal event for ${current.episodeId} does not match immutable plan v${event.plan_version}`,
      );
    }
    plansByVersion.set(event.plan_version, persisted);
    if (event.kind === "plan_adopted") continue;
    const authorizedStep = persisted.steps.find((step) => step.id === event.step_id);
    if (
      authorizedStep === undefined ||
      authorizedStep.kind !== event.step_kind ||
      stableHash(authorizedStep) !== event.step_sha256
    ) {
      throw new EpisodePlanPersistenceError(
        "error_episode_plan_corrupt",
        `execution journal step ${event.step_id} is not authorized by immutable plan v${event.plan_version}`,
      );
    }
    if (event.kind === "step_completed" && event.output_artifacts !== undefined) {
      const expected = authorizedStep.expectedOutputs
        .filter((output) => output.required)
        .map((output) => `${output.id}\0${output.kind}\0${event.artifact_sha256}`)
        .sort();
      const observed = event.output_artifacts
        .map((output) => `${output.output_id}\0${output.output_kind}\0${output.artifact_sha256}`)
        .sort();
      if (stableHash(expected) !== stableHash(observed)) {
        throw new EpisodePlanPersistenceError(
          "error_episode_plan_corrupt",
          `execution journal step ${event.step_id} does not evidence every required output`,
        );
      }
    }
  }

  return completedStepIds;
}

function validatePlanningSource(plan: EpisodePlan, intent: EpisodeIntent, issues: EpisodePlanIssue[]): void {
  if (plan.planningSource === "creator_scope") {
    const assessmentScope = intent.creatorScope;
    if (assessmentScope?.planningDisposition !== "execution_ready") {
      issues.push(issue("plan_creator_scope_not_execution_ready", "creator-authored plan requires explicit execution-ready scope"));
      return;
    }
    validateCreatorProvenance(assessmentScope.provenance, issues);
    validateCreatorExpectedArtifacts(assessmentScope.expectedArtifacts, issues);
    if (plan.creatorProvenance === undefined || stableHash(plan.creatorProvenance) !== stableHash(assessmentScope.provenance)) {
      issues.push(issue("plan_creator_provenance_mismatch", "plan creator provenance must exactly match the episode intent"));
    }
    return;
  }
  if (plan.creatorProvenance !== undefined) {
    issues.push(issue("plan_unexpected_creator_provenance", "EpisodePlanner-authored plans cannot claim creator-scope provenance"));
  }
}

function validateProviderStep(
  step: ProviderTurnStep,
  planningSource: EpisodePlan["planningSource"],
  intent: EpisodeIntent,
  policy: EpisodePlanValidationPolicy,
  issues: EpisodePlanIssue[],
): void {
  if (!machineReadableOperation(step.operation)) {
    issues.push(issue("plan_operation_invalid", "provider operation must be a stable machine-readable identifier", step.id));
  }
  if (!policy.isKnownRole(step.role)) issues.push(issue("plan_role_unknown", `unknown role ${step.role}`, step.id));
  let assignment: TurnAssignment;
  try {
    assignment = validateTurnAssignment(step.assignment, `assignment for ${step.id}`);
  } catch (error) {
    issues.push(issue("plan_assignment_invalid", errorMessage(error), step.id));
    return;
  }
  if (!policy.isAssignmentAllowed(step.role, assignment)) {
    issues.push(issue("plan_assignment_not_allowed", `assignment is not approved for role ${step.role}`, step.id));
  }
  if (!(["configured", "episode_planner", "creator"] as const).includes(step.assignmentSource)) {
    issues.push(issue("plan_assignment_source_invalid", "assignment source is invalid", step.id));
  }
  const expectedSource: TurnAssignmentSource = policy.mode === "fixed"
    ? "configured"
    : planningSource === "creator_scope" ? "creator" : "episode_planner";
  if (step.assignmentSource !== expectedSource) {
    issues.push(issue("plan_assignment_source_invalid", `assignment source must be ${expectedSource}`, step.id));
  }
  if (policy.mode === "fixed") {
    const configured = policy.configuredAssignmentFor(step.role);
    if (configured === undefined || !turnAssignmentsEqual(configured, assignment)) {
      issues.push(issue("plan_assignment_not_allowed", `fixed step must use the configured assignment for ${step.role}`, step.id));
    }
  }
  const capabilities = new Set(policy.capabilitiesFor(step.role, assignment));
  const declaredCapabilities = new Set(step.requiredCapabilities);
  const roleRequirements = new Set(
    intent.availableRoles
      .filter((view) => view.role === step.role)
      .flatMap((view) => view.requiredCapabilities),
  );
  for (const capability of roleRequirements) {
    if (!declaredCapabilities.has(capability)) {
      issues.push(issue(
        "plan_capability_missing",
        `provider step omits role-required capability ${capability}`,
        step.id,
      ));
    }
    if (!capabilities.has(capability)) {
      issues.push(issue(
        "plan_capability_missing",
        `assignment lacks role-required capability ${capability}`,
        step.id,
      ));
    }
  }
  for (const capability of declaredCapabilities) {
    if (roleRequirements.has(capability)) continue;
    if (!capabilities.has(capability)) {
      issues.push(issue("plan_capability_missing", `assignment lacks required capability ${capability}`, step.id));
    }
  }
  if (!nonEmpty(step.selectionReason)) issues.push(issue("plan_selection_reason_required", "selectionReason is required", step.id));
  if (!finiteNonNegative(step.maxTurnBudgetUsd) || step.maxTurnBudgetUsd === 0) {
    issues.push(issue("plan_turn_budget_invalid", "provider turn budget must be finite and positive", step.id));
  }
  const candidates = intent.allowedAssignments.filter(
    (candidate) => candidate.role === step.role && assignmentsEqualSafe(candidate.assignment, assignment),
  );
  if (candidates.length !== 1) {
    issues.push(issue("plan_assignment_not_allowed", `step assignment must resolve to exactly one intent candidate`, step.id));
  } else if (!candidates[0]!.available) {
    issues.push(issue("plan_assignment_unavailable", `step assignment is not currently available`, step.id));
  } else if (step.maxTurnBudgetUsd > candidates[0]!.maxTurnCostUsd + EPSILON) {
    issues.push(issue(
      "plan_turn_budget_exceeds_assignment",
      `step budget $${step.maxTurnBudgetUsd} exceeds approved assignment ceiling $${candidates[0]!.maxTurnCostUsd}`,
      step.id,
    ));
  }
}

function validateIntentAssignmentCatalog(
  intent: EpisodeIntent,
  policy: EpisodePlanValidationPolicy,
  issues: EpisodePlanIssue[],
): void {
  const seen = new Set<string>();
  for (const candidate of intent.allowedAssignments) {
    let assignment: TurnAssignment;
    try {
      assignment = validateTurnAssignment(candidate.assignment, `allowed assignment ${candidate.candidateId}`);
    } catch (error) {
      issues.push(issue("plan_assignment_invalid", errorMessage(error)));
      continue;
    }
    const key = `${candidate.role}\0${stableHash(assignment)}`;
    if (seen.has(key)) {
      issues.push(issue("plan_assignment_catalog_duplicate", `role ${candidate.role} contains a duplicate atomic assignment`));
    }
    seen.add(key);
    if (!nonEmpty(candidate.candidateId) || !nonEmpty(candidate.role) || !nonEmpty(candidate.providerFamily) ||
        !nonEmpty(candidate.qualificationRef) || !nonEmpty(candidate.priceRef) ||
        !Array.isArray(candidate.capabilities) || candidate.capabilities.some((capability) => !nonEmpty(capability))) {
      issues.push(issue("plan_assignment_candidate_invalid", "allowed assignment metadata must be complete and provenance-bearing"));
    }
    try {
      validateAssignmentProviderFamily(
        assignment,
        candidate.providerFamily,
        `allowed assignment ${candidate.candidateId}.providerFamily`,
      );
    } catch (error) {
      issues.push(issue("plan_assignment_candidate_invalid", errorMessage(error)));
    }
    if (!finiteNonNegative(candidate.maxTurnCostUsd) || candidate.maxTurnCostUsd === 0) {
      issues.push(issue("plan_assignment_price_invalid", `allowed assignment ${candidate.candidateId} requires a finite positive maxTurnCostUsd`));
    }
    if (!policy.isKnownRole(candidate.role) || !policy.isAssignmentAllowed(candidate.role, assignment)) {
      issues.push(issue("plan_assignment_not_allowed", `intent assignment ${candidate.candidateId} is not allowed by current policy`));
    }
  }
}

function validateCreatorTurnCeiling(
  step: ProposedProviderTurnStep,
  assignment: TurnAssignment,
  policy: CreatorScopePolicy,
  issues: EpisodePlanIssue[],
): void {
  if (!finiteNonNegative(step.maxTurnBudgetUsd) || step.maxTurnBudgetUsd === 0) {
    issues.push(issue("plan_turn_budget_invalid", "creator provider turn budget must be finite and positive", step.id));
    return;
  }
  const ceiling = policy.maxTurnCostUsdFor(step.role, assignment);
  if (ceiling === undefined || !finiteNonNegative(ceiling) || ceiling === 0) {
    issues.push(issue("plan_assignment_price_invalid", `creator assignment for ${step.id} has no valid approved cost ceiling`, step.id));
  } else if (step.maxTurnBudgetUsd > ceiling + EPSILON) {
    issues.push(issue("plan_turn_budget_exceeds_assignment", `creator step budget exceeds its approved assignment ceiling`, step.id));
  }
}

function validateGraph(
  steps: readonly ProposedEpisodeStep[] | readonly EpisodeStep[],
  requiredTerminalOutputIds: readonly string[],
): EpisodePlanIssue[] {
  const issues: EpisodePlanIssue[] = [];
  const byId = new Map<string, ProposedEpisodeStep | EpisodeStep>();
  for (const step of steps) {
    if (!STEP_ID.test(step.id)) issues.push(issue("plan_step_id_invalid", `invalid stable step id ${step.id}`, step.id));
    if (byId.has(step.id)) {
      issues.push(issue("plan_step_id_duplicate", `duplicate step id ${step.id}`, step.id));
      continue;
    }
    byId.set(step.id, step);
    if (!nonEmpty(step.objective)) issues.push(issue("plan_step_objective_required", "step objective is required", step.id));
    if (step.expectedOutputs.some((output) => !validOutput(output))) {
      issues.push(issue("plan_expected_output_invalid", "expected outputs require stable ids and non-empty kinds", step.id));
    }
    if (step.kind === "provider_turn" && !machineReadableOperation(step.operation)) {
      issues.push(issue("plan_operation_invalid", "provider operation must be a stable machine-readable identifier", step.id));
    }
  }
  for (const step of steps) {
    for (const dependency of step.dependsOn) {
      if (dependency === step.id) issues.push(issue("plan_step_self_dependency", "step cannot depend on itself", step.id));
      else if (!byId.has(dependency)) issues.push(issue("plan_step_dependency_missing", `missing dependency ${dependency}`, step.id));
    }
  }
  const colors = new Map<string, 0 | 1 | 2>();
  const visit = (id: string): void => {
    const color = colors.get(id) ?? 0;
    if (color === 1) {
      issues.push(issue("plan_step_dependency_cycle", `dependency cycle includes ${id}`, id));
      return;
    }
    if (color === 2) return;
    colors.set(id, 1);
    for (const dependency of byId.get(id)?.dependsOn ?? []) if (byId.has(dependency)) visit(dependency);
    colors.set(id, 2);
  };
  for (const id of byId.keys()) visit(id);

  const dependents = new Map<string, string[]>();
  const outputOwners = new Map<string, string>();
  for (const step of steps) {
    for (const output of step.expectedOutputs) {
      const prior = outputOwners.get(output.id);
      if (prior !== undefined) {
        issues.push(issue("plan_expected_output_duplicate", `output ${output.id} is already produced by ${prior}`, step.id));
      } else {
        outputOwners.set(output.id, step.id);
      }
    }
    for (const dependency of step.dependsOn) {
      const current = dependents.get(dependency) ?? [];
      current.push(step.id);
      dependents.set(dependency, current);
    }
  }
  const terminals = steps.filter((step) => (dependents.get(step.id)?.length ?? 0) === 0);
  const terminalIds = new Set(terminals.map((step) => step.id));
  const terminalOutputOwners = new Map<string, string>();
  for (const step of terminals) {
    for (const output of step.expectedOutputs) if (output.required) terminalOutputOwners.set(output.id, step.id);
  }
  if (terminalOutputOwners.size === 0) {
    issues.push(issue(
      "plan_terminal_output_missing",
      "plan requires at least one terminal step with a required output",
    ));
  }

  const requiredOutputIds = new Set(requiredTerminalOutputIds);
  const validTerminalIds = new Set<string>();
  if (requiredOutputIds.size === 0) {
    for (const owner of terminalOutputOwners.values()) validTerminalIds.add(owner);
  } else {
    for (const outputId of requiredOutputIds) {
      const owner = outputOwners.get(outputId);
      if (owner === undefined) {
        issues.push(issue("plan_terminal_output_missing", `required terminal output ${outputId} is missing`));
        continue;
      }
      const output = byId.get(owner)?.expectedOutputs.find((candidate) => candidate.id === outputId);
      if (output?.required !== true) {
        issues.push(issue(
          "plan_terminal_output_missing",
          `required terminal output ${outputId} must be marked required`,
          owner,
        ));
        continue;
      }
      if (!terminalIds.has(owner)) {
        issues.push(issue(
          "plan_terminal_output_not_terminal",
          `required output ${outputId} is produced before a dependent step`,
          owner,
        ));
        continue;
      }
      validTerminalIds.add(owner);
    }
  }

  const reachable = new Set<string>();
  const markDependencies = (id: string): void => {
    if (reachable.has(id)) return;
    reachable.add(id);
    for (const dependency of byId.get(id)?.dependsOn ?? []) markDependencies(dependency);
  };
  for (const terminalId of validTerminalIds) markDependencies(terminalId);
  for (const step of steps) {
    if (!reachable.has(step.id)) {
      issues.push(issue("plan_step_unreachable", "step is not on a path to a valid terminal outcome", step.id));
    }
  }
  return dedupeIssues(issues);
}

function validateBudget(plan: EpisodePlan, ceiling: BudgetCeiling, issues: EpisodePlanIssue[]): void {
  const estimate = plan.estimatedBudget;
  const actualProvider = plan.steps.filter((step): step is ProviderTurnStep => step.kind === "provider_turn");
  const actualUsd = actualProvider.reduce((sum, step) => sum + step.maxTurnBudgetUsd, 0);
  // Mechanical gates and approval checkpoints are local deterministic work;
  // they do not construct a provider runtime and therefore have zero
  // equivalent-provider monetary cost in the current budget model. Keep this
  // code-owned instead of accepting planner-authored overhead.
  const actualMechanicalOverheadUsd = 0;
  const arithmeticValid = Number.isSafeInteger(estimate.providerTurns) &&
    estimate.providerTurns === actualProvider.length &&
    finiteNonNegative(estimate.providerTurnBudgetUsd) &&
    near(estimate.providerTurnBudgetUsd, actualUsd) &&
    finiteNonNegative(estimate.mechanicalOverheadUsd) &&
    near(estimate.mechanicalOverheadUsd, actualMechanicalOverheadUsd) &&
    finiteNonNegative(estimate.totalBudgetUsd) &&
    near(estimate.totalBudgetUsd, estimate.providerTurnBudgetUsd + estimate.mechanicalOverheadUsd);
  if (!arithmeticValid) issues.push(issue("plan_budget_arithmetic_invalid", "estimated budget does not equal the plan's exact turn budgets plus overhead"));
  const optionalCeilings = [
    ceiling.maxMechanicalOverheadUsd,
    ceiling.maxInputTokens,
    ceiling.maxActiveTimeMs,
    ceiling.maxHumanDecisions,
  ].filter((value): value is number => value !== undefined);
  if (!Number.isSafeInteger(ceiling.maxProviderTurns) || ceiling.maxProviderTurns < 0 ||
      !finiteNonNegative(ceiling.maxEquivalentCostUsd) ||
      optionalCeilings.some((value) => !finiteNonNegative(value))) {
    issues.push(issue("plan_budget_ceiling_invalid", "hard budget ceilings must be finite and non-negative"));
  }
  if (actualProvider.length > ceiling.maxProviderTurns) {
    issues.push(issue("plan_budget_provider_turns_exceeded", `plan requires ${actualProvider.length} provider turns; ceiling is ${ceiling.maxProviderTurns}`));
  }
  if (!finiteNonNegative(ceiling.maxEquivalentCostUsd) || estimate.totalBudgetUsd > ceiling.maxEquivalentCostUsd + EPSILON) {
    issues.push(issue("plan_budget_cost_exceeded", `plan total $${estimate.totalBudgetUsd} exceeds hard ceiling $${ceiling.maxEquivalentCostUsd}`));
  }
  if (ceiling.maxMechanicalOverheadUsd !== undefined && estimate.mechanicalOverheadUsd > ceiling.maxMechanicalOverheadUsd + EPSILON) {
    issues.push(issue("plan_budget_mechanical_overhead_exceeded", "mechanical overhead exceeds its hard ceiling"));
  }
  const humanDecisions = plan.steps.filter((step) => step.kind === "approval").length;
  if (ceiling.maxHumanDecisions !== undefined && humanDecisions > ceiling.maxHumanDecisions) {
    issues.push(issue("plan_budget_human_decisions_exceeded", `plan requires ${humanDecisions} approval decisions; ceiling is ${ceiling.maxHumanDecisions}`));
  }
}

function validateSafetyRoute(
  plan: EpisodePlan,
  intent: EpisodeIntent,
  policy: EpisodePlanValidationPolicy,
  issues: EpisodePlanIssue[],
): void {
  const gates = new Set(plan.steps.filter((step) => step.kind === "mechanical_gate").map((step) => step.id));
  const approvals = new Set(plan.steps.filter((step) => step.kind === "approval").map((step) => step.id));
  const expected = deriveEpisodeSafetyRoute(plan.steps, intent.requiredSafetyFacts);
  if (!new Set(["quick", "standard", "deep"]).has(plan.derivedSafetyRoute.label) ||
      plan.derivedSafetyRoute.gateStepIds.some((id) => !gates.has(id)) ||
      plan.derivedSafetyRoute.approvalStepIds.some((id) => !approvals.has(id)) ||
      stableHash(plan.derivedSafetyRoute) !== stableHash(expected)) {
    issues.push(issue("plan_safety_route_invalid", "derived safety route must reference only typed plan gates and approvals"));
  }
  const byId = new Map(plan.steps.map((step) => [step.id, step]));
  const terminals = terminalSteps(plan.steps);
  const providerSteps = plan.steps.filter(
    (step): step is ProviderTurnStep => step.kind === "provider_turn",
  );
  for (const required of new Set(policy.requiredProviderRoles ?? [])) {
    const matching = providerSteps.filter((step) => step.role === required);
    if (matching.length === 0) {
      issues.push(issue(
        "plan_safety_provider_missing",
        `safety policy requires ${required}-owned provider work`,
      ));
      continue;
    }
    for (const terminal of terminals) {
      if (!matching.some((step) => stepIsAncestorOrSelf(step.id, terminal, byId))) {
        issues.push(issue(
          "plan_safety_provider_missing",
          `terminal outcome ${terminal.id} bypasses required ${required}-owned provider work`,
          terminal.id,
        ));
      }
    }
  }
  const gateSteps = plan.steps.filter(
    (step): step is MechanicalGateStep => step.kind === "mechanical_gate",
  );
  for (const required of new Set(policy.requiredGateKinds ?? [])) {
    const matching = gateSteps.filter((step) => step.gate === required);
    if (matching.length === 0) {
      issues.push(issue("plan_safety_gate_missing", `safety policy requires mechanical gate ${required}`));
      continue;
    }
    for (const terminal of terminals) {
      if (!matching.some((step) => stepIsAncestorOrSelf(step.id, terminal, byId))) {
        issues.push(issue(
          "plan_safety_gate_missing",
          `terminal outcome ${terminal.id} bypasses required mechanical gate ${required}`,
          terminal.id,
        ));
      }
    }
  }
  const approvalSteps = plan.steps.filter(
    (step): step is ApprovalStep => step.kind === "approval",
  );
  for (const required of new Set(policy.requiredApprovalKinds ?? [])) {
    const matching = approvalSteps.filter((step) => step.approvalKind === required);
    if (matching.length === 0) {
      issues.push(issue("plan_safety_approval_missing", `safety policy requires approval ${required}`));
      continue;
    }
    for (const terminal of terminals) {
      if (!matching.some((step) => stepIsAncestorOrSelf(step.id, terminal, byId))) {
        issues.push(issue(
          "plan_safety_approval_missing",
          `terminal outcome ${terminal.id} bypasses required approval ${required}`,
          terminal.id,
        ));
      }
    }
  }
}

function validateIndependentReview(
  plan: EpisodePlan,
  reviewPolicy: IndependentReviewPolicy | undefined,
  issues: EpisodePlanIssue[],
): void {
  if (reviewPolicy === undefined) return;
  const providers = plan.steps.filter((step): step is ProviderTurnStep => step.kind === "provider_turn");
  const subjects = providers.filter((step) => reviewPolicy.subjectRoles.includes(step.role));
  const reviewers = providers.filter((step) => reviewPolicy.reviewerRoles.includes(step.role));
  const byId = new Map(plan.steps.map((step) => [step.id, step]));
  for (const subject of subjects) {
    const covering = reviewers.filter((reviewer) => stepIsAncestorOrSelf(subject.id, reviewer, byId));
    if (covering.length === 0) {
      issues.push(issue("plan_independent_review_missing", `provider step ${subject.id} has no dependent review`, subject.id));
    } else if (!covering.some((reviewer) => reviewPolicy.isIndependent(subject, reviewer))) {
      issues.push(issue("plan_independent_review_invalid", `review of ${subject.id} is not independent`, subject.id));
    }
  }
}

function terminalSteps(steps: readonly EpisodeStep[]): EpisodeStep[] {
  const dependencyIds = new Set(steps.flatMap((step) => step.dependsOn));
  return steps.filter((step) => !dependencyIds.has(step.id));
}

function stepIsAncestorOrSelf(
  ancestorId: string,
  step: EpisodeStep,
  byId: ReadonlyMap<string, EpisodeStep>,
): boolean {
  if (step.id === ancestorId) return true;
  const seen = new Set<string>();
  const visit = (candidate: EpisodeStep): boolean => {
    if (seen.has(candidate.id)) return false;
    seen.add(candidate.id);
    if (candidate.dependsOn.includes(ancestorId)) return true;
    return candidate.dependsOn.some((dependencyId) => {
      const dependency = byId.get(dependencyId);
      return dependency !== undefined && visit(dependency);
    });
  };
  return visit(step);
}

function validateCreatorProvenance(provenance: CreatorScopeProvenance, issues: EpisodePlanIssue[]): void {
  if (!(["human", "agent"] as const).includes(provenance.source) ||
      !nonEmpty(provenance.creatorId) || !validTimestamp(provenance.createdAt) ||
      !Array.isArray(provenance.evidenceRefs) || provenance.evidenceRefs.length === 0 ||
      provenance.evidenceRefs.some((ref) => !nonEmpty(ref))) {
    issues.push(issue("creator_scope_provenance_invalid", "creator scope requires typed source, identity, timestamp, and valid evidence references"));
  }
}

function validateCreatorExpectedArtifacts(
  artifacts: readonly PlannedOutput[],
  issues: EpisodePlanIssue[],
): void {
  if (artifacts.length === 0 || artifacts.some((output) => !validOutput(output)) ||
      !artifacts.some((output) => output.required)) {
    issues.push(issue(
      "creator_scope_artifacts_required",
      "creator scope must name valid expected artifacts and mark at least one as required",
    ));
  }
}

function canonicalize(value: unknown, ancestors = new Set<object>()): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("canonical JSON cannot contain non-finite numbers");
    return value;
  }
  if (Array.isArray(value)) {
    if (ancestors.has(value)) throw new TypeError("canonical JSON cannot contain cycles");
    const nested = new Set(ancestors).add(value);
    return value.map((entry) => canonicalize(entry, nested));
  }
  if (typeof value === "object") {
    if (ancestors.has(value)) throw new TypeError("canonical JSON cannot contain cycles");
    const nested = new Set(ancestors).add(value);
    const result: Record<string, JsonValue> = {};
    for (const key of Object.keys(value).sort()) {
      const entry = (value as Record<string, unknown>)[key];
      if (entry === undefined) continue;
      result[key] = canonicalize(entry, nested);
    }
    return result;
  }
  throw new TypeError(`canonical JSON cannot contain ${typeof value}`);
}

function cloneStep<T extends EpisodeStep>(step: T): T {
  return structuredClone(step);
}

function cloneProposedStep<T extends ProposedEpisodeStep>(step: T): T {
  return structuredClone(step);
}

function cloneProviderProposal(step: ProposedProviderTurnStep): Omit<ProviderTurnStep, "assignment" | "assignmentSource"> {
  const { assignment: _assignment, ...base } = structuredClone(step);
  return base;
}

function issue(code: EpisodePlanReasonCode, message: string, stepId?: string): EpisodePlanIssue {
  return stepId === undefined ? { code, message } : { code, message, stepId };
}

function safetyFactIdentity(fact: SafetyFact): string {
  return `${fact.kind}\0${[...fact.evidenceRefs].sort().join("\0")}`;
}

function dedupeIssues(issues: EpisodePlanIssue[]): EpisodePlanIssue[] {
  const seen = new Set<string>();
  return issues.filter((entry) => {
    const key = `${entry.code}\0${entry.stepId ?? ""}\0${entry.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function machineReadableOperation(value: unknown): value is string {
  return typeof value === "string" && OPERATION.test(value);
}

function nonEmptyStrings(values: unknown): values is string[] {
  return Array.isArray(values) && values.length > 0 && values.every(nonEmpty);
}

function finiteNonNegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function near(left: number, right: number): boolean {
  return Math.abs(left - right) <= EPSILON;
}

function validTimestamp(value: string): boolean {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed);
}

function validOutput(output: PlannedOutput): boolean {
  return STEP_ID.test(output.id) && nonEmpty(output.kind) && typeof output.required === "boolean";
}

function validSafetyFact(value: unknown): value is SafetyFact {
  if (!isRecord(value) || !SAFETY_FACT_KINDS.includes(value["kind"] as SafetyFactKind)) return false;
  const evidenceRefs = value["evidenceRefs"];
  return Array.isArray(evidenceRefs) && evidenceRefs.length > 0 && evidenceRefs.every(nonEmpty);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function assignmentsEqualSafe(left: unknown, right: TurnAssignment): boolean {
  try {
    return turnAssignmentsEqual(validateTurnAssignment(left), right);
  } catch {
    return false;
  }
}

async function readOptionalFile(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function isCreatorEpisodeScopeStrict(value: unknown): value is CreatorEpisodeScope {
  if (!isRecord(value) || !exactKeys(
    value,
    [
      "planningDisposition", "provenance", "workKind", "objective", "inScope", "outOfScope",
      "acceptanceCriteria", "expectedArtifacts", "declaredConstraints", "safetyFacts", "steps",
      "workflowTemplate",
    ],
    [
      "planningDisposition", "provenance", "objective", "inScope", "outOfScope",
      "acceptanceCriteria", "expectedArtifacts", "declaredConstraints", "safetyFacts",
    ],
  )) return false;
  if ((value["planningDisposition"] !== "planner_input" && value["planningDisposition"] !== "execution_ready") ||
      !isCreatorProvenanceStrict(value["provenance"]) ||
      (value["workKind"] !== undefined && typeof value["workKind"] !== "string") ||
      typeof value["objective"] !== "string" || !stringArray(value["inScope"]) ||
      !stringArray(value["outOfScope"]) || !stringArray(value["acceptanceCriteria"]) ||
      !Array.isArray(value["expectedArtifacts"]) || !value["expectedArtifacts"].every(isPlannedOutput) ||
      !isJsonValue(value["declaredConstraints"]) ||
      !Array.isArray(value["safetyFacts"]) || !value["safetyFacts"].every(validSafetyFact) ||
      (value["steps"] !== undefined &&
        (!Array.isArray(value["steps"]) || !value["steps"].every(isProposedEpisodeStep)))) return false;
  const template = value["workflowTemplate"];
  return template === undefined || (
    isRecord(template) && exactKeys(template, ["id", "version"], ["id", "version"]) &&
    nonEmpty(template["id"]) && nonEmpty(template["version"])
  );
}

function isEpisodeIntentStrict(value: unknown): value is EpisodeIntent {
  if (!isRecord(value) || !exactKeys(
    value,
    [
      "episodeId", "app", "assignmentMode", "trigger", "goal", "lifecycle", "appStage",
      "repositoryFacts", "changeFacts", "requestedConstraints", "hardBudget", "availableRoles",
      "allowedAssignments", "requiredSafetyFacts", "creatorScope",
    ],
    [
      "episodeId", "app", "assignmentMode", "trigger", "goal", "lifecycle", "appStage",
      "repositoryFacts", "requestedConstraints", "hardBudget", "availableRoles",
      "allowedAssignments", "requiredSafetyFacts",
    ],
  )) return false;
  if (!nonEmpty(value["episodeId"]) || !nonEmpty(value["app"]) ||
      !ASSIGNMENT_MODES.includes(value["assignmentMode"] as AssignmentMode) ||
      !isTriggerDescriptor(value["trigger"]) || !nonEmpty(value["goal"]) ||
      !nonEmpty(value["lifecycle"]) || !nonEmpty(value["appStage"]) ||
      !isRecord(value["repositoryFacts"]) || !isJsonValue(value["repositoryFacts"]) ||
      (value["changeFacts"] !== undefined &&
        (!isRecord(value["changeFacts"]) || !isJsonValue(value["changeFacts"]))) ||
      !isRecord(value["requestedConstraints"]) || !isJsonValue(value["requestedConstraints"]) ||
      !isBudgetCeilingStrict(value["hardBudget"]) ||
      !Array.isArray(value["availableRoles"]) || value["availableRoles"].length === 0 ||
      !value["availableRoles"].every(isRolePlanningViewStrict) ||
      !Array.isArray(value["allowedAssignments"]) || value["allowedAssignments"].length === 0 ||
      !value["allowedAssignments"].every(isAllowedAssignmentStrict) ||
      !Array.isArray(value["requiredSafetyFacts"]) || !value["requiredSafetyFacts"].every(validSafetyFact)) return false;
  return value["creatorScope"] === undefined || isCreatorEpisodeScopeStrict(value["creatorScope"]);
}

function isTriggerDescriptor(value: unknown): value is TriggerDescriptor {
  return isRecord(value) && exactKeys(
    value,
    ["kind", "sourceRef", "payloadHash"],
    ["kind"],
  ) && nonEmpty(value["kind"]) &&
    (value["sourceRef"] === undefined || nonEmpty(value["sourceRef"])) &&
    (value["payloadHash"] === undefined || nonEmpty(value["payloadHash"]));
}

function isBudgetCeilingStrict(value: unknown): value is BudgetCeiling {
  if (!isRecord(value) || !exactKeys(
    value,
    [
      "maxProviderTurns", "maxEquivalentCostUsd", "maxMechanicalOverheadUsd",
      "maxInputTokens", "maxActiveTimeMs", "maxHumanDecisions",
    ],
    ["maxProviderTurns", "maxEquivalentCostUsd"],
  )) return false;
  if (!Number.isSafeInteger(value["maxProviderTurns"]) || (value["maxProviderTurns"] as number) < 0 ||
      typeof value["maxEquivalentCostUsd"] !== "number" || !finiteNonNegative(value["maxEquivalentCostUsd"])) return false;
  return ["maxMechanicalOverheadUsd", "maxInputTokens", "maxActiveTimeMs", "maxHumanDecisions"]
    .every((key) => value[key] === undefined ||
      (typeof value[key] === "number" && finiteNonNegative(value[key] as number)));
}

function isRolePlanningViewStrict(value: unknown): value is RolePlanningView {
  if (!isRecord(value) || !exactKeys(
    value,
    ["role", "responsibility", "requiredCapabilities", "expectedOutputs", "configuredAssignment"],
    ["role", "responsibility", "requiredCapabilities", "expectedOutputs"],
  ) || !nonEmpty(value["role"]) || !nonEmpty(value["responsibility"]) ||
      !stringArray(value["requiredCapabilities"]) || !stringArray(value["expectedOutputs"])) return false;
  if (value["configuredAssignment"] === undefined) return true;
  try {
    validateTurnAssignment(value["configuredAssignment"]);
    return true;
  } catch {
    return false;
  }
}

function isAllowedAssignmentStrict(value: unknown): value is AllowedTurnAssignment {
  if (!isRecord(value) || !exactKeys(
    value,
    [
      "candidateId", "role", "assignment", "providerFamily", "capabilities", "qualificationRef",
      "priceRef", "maxTurnCostUsd", "available",
    ],
    [
      "candidateId", "role", "assignment", "providerFamily", "capabilities", "qualificationRef",
      "priceRef", "maxTurnCostUsd", "available",
    ],
  ) || !nonEmpty(value["candidateId"]) || !nonEmpty(value["role"]) ||
      !nonEmpty(value["providerFamily"]) || !stringArray(value["capabilities"]) ||
      !nonEmpty(value["qualificationRef"]) || !nonEmpty(value["priceRef"]) ||
      typeof value["maxTurnCostUsd"] !== "number" || !finiteNonNegative(value["maxTurnCostUsd"]) ||
      value["maxTurnCostUsd"] === 0 || typeof value["available"] !== "boolean") return false;
  try {
    validateTurnAssignment(value["assignment"]);
    return true;
  } catch {
    return false;
  }
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isRecord(value) && Object.values(value).every(isJsonValue);
}

function isProposedEpisodePlan(value: unknown): value is ProposedEpisodePlan {
  if (!isRecord(value) || !exactKeys(
    value,
    [
      "schemaVersion", "episodeId", "version", "intentHash", "summary", "workflowClass",
      "planningSource", "creatorProvenance", "steps", "estimatedBudget", "derivedSafetyRoute", "createdAt",
    ],
    [
      "schemaVersion", "episodeId", "version", "intentHash", "summary", "workflowClass",
      "planningSource", "steps", "estimatedBudget", "derivedSafetyRoute", "createdAt",
    ],
  )) return false;
  if (value["schemaVersion"] !== EPISODE_PLAN_SCHEMA_VERSION || !nonEmpty(value["episodeId"]) ||
      !Number.isSafeInteger(value["version"]) || (value["version"] as number) < 1 ||
      typeof value["intentHash"] !== "string" || !HASH.test(value["intentHash"]) ||
      !nonEmpty(value["summary"]) || !nonEmpty(value["workflowClass"]) ||
      (value["planningSource"] !== "episode_planner" && value["planningSource"] !== "creator_scope") ||
      !Array.isArray(value["steps"]) || value["steps"].length === 0 || !value["steps"].every(isProposedEpisodeStep) ||
      !isBudgetEstimateStrict(value["estimatedBudget"]) || !isSafetyRouteStrict(value["derivedSafetyRoute"]) ||
      typeof value["createdAt"] !== "string" || !validTimestamp(value["createdAt"])) return false;
  const provenance = value["creatorProvenance"];
  return provenance === undefined || isCreatorProvenanceStrict(provenance);
}

function isProposedEpisodeStep(value: unknown): value is ProposedEpisodeStep {
  if (!isRecord(value)) return false;
  const commonRequired = ["kind", "id", "objective", "dependsOn", "inputRefs", "expectedOutputs"];
  const baseValid = STEP_ID.test(String(value["id"] ?? "")) && nonEmpty(value["objective"]) &&
    stringArray(value["dependsOn"]) && Array.isArray(value["inputRefs"]) && value["inputRefs"].every(isPlannedInputRef) &&
    Array.isArray(value["expectedOutputs"]) && value["expectedOutputs"].every(isPlannedOutput);
  if (!baseValid) return false;
  if (value["kind"] === "mechanical_gate") {
    return exactKeys(value, [...commonRequired, "gate"], [...commonRequired, "gate"]) && nonEmpty(value["gate"]);
  }
  if (value["kind"] === "approval") {
    return exactKeys(value, [...commonRequired, "approvalKind", "actionRef"], [...commonRequired, "approvalKind", "actionRef"]) &&
      nonEmpty(value["approvalKind"]) && nonEmpty(value["actionRef"]);
  }
  if (value["kind"] !== "provider_turn" || !exactKeys(
    value,
    [...commonRequired, "operation", "role", "requiredCapabilities", "assignment", "maxTurnBudgetUsd", "selectionReason"],
    [...commonRequired, "operation", "role", "requiredCapabilities", "maxTurnBudgetUsd", "selectionReason"],
  )) return false;
  if (!machineReadableOperation(value["operation"]) || !nonEmpty(value["role"]) || !stringArray(value["requiredCapabilities"]) ||
      typeof value["maxTurnBudgetUsd"] !== "number" || !finiteNonNegative(value["maxTurnBudgetUsd"]) ||
      value["maxTurnBudgetUsd"] === 0 || !nonEmpty(value["selectionReason"])) return false;
  if (value["assignment"] === undefined) return true;
  try {
    validateTurnAssignment(value["assignment"]);
    return true;
  } catch {
    return false;
  }
}

function isPlannedInputRef(value: unknown): value is PlannedInputRef {
  return isRecord(value) && exactKeys(value, ["ref", "required"], ["ref", "required"]) &&
    nonEmpty(value["ref"]) && typeof value["required"] === "boolean";
}

function isPlannedOutput(value: unknown): value is PlannedOutput {
  return isRecord(value) && exactKeys(value, ["id", "kind", "required"], ["id", "kind", "required"]) &&
    validOutput(value as unknown as PlannedOutput);
}

function isBudgetEstimateStrict(value: unknown): value is EpisodeBudgetEstimate {
  return isRecord(value) && exactKeys(
    value,
    ["providerTurns", "providerTurnBudgetUsd", "mechanicalOverheadUsd", "totalBudgetUsd"],
    ["providerTurns", "providerTurnBudgetUsd", "mechanicalOverheadUsd", "totalBudgetUsd"],
  ) && Number.isSafeInteger(value["providerTurns"]) && (value["providerTurns"] as number) >= 0 &&
    typeof value["providerTurnBudgetUsd"] === "number" && finiteNonNegative(value["providerTurnBudgetUsd"]) &&
    typeof value["mechanicalOverheadUsd"] === "number" && finiteNonNegative(value["mechanicalOverheadUsd"]) &&
    typeof value["totalBudgetUsd"] === "number" && finiteNonNegative(value["totalBudgetUsd"]);
}

function isSafetyRouteStrict(value: unknown): value is DerivedSafetyRoute {
  return isRecord(value) && exactKeys(
    value,
    ["label", "reasons", "gateStepIds", "approvalStepIds"],
    ["label", "reasons", "gateStepIds", "approvalStepIds"],
  ) && nonEmpty(value["label"]) && stringArray(value["reasons"]) &&
    stringArray(value["gateStepIds"]) && stringArray(value["approvalStepIds"]);
}

function isCreatorProvenanceStrict(value: unknown): value is CreatorScopeProvenance {
  return isRecord(value) && exactKeys(
    value,
    ["source", "creatorId", "createdAt", "evidenceRefs"],
    ["source", "creatorId", "createdAt", "evidenceRefs"],
  ) && (value["source"] === "human" || value["source"] === "agent") && nonEmpty(value["creatorId"]) &&
    typeof value["createdAt"] === "string" && validTimestamp(value["createdAt"]) && stringArray(value["evidenceRefs"]);
}

function exactKeys(record: Record<string, unknown>, allowed: readonly string[], required: readonly string[]): boolean {
  const allowedSet = new Set(allowed);
  return Object.keys(record).every((key) => allowedSet.has(key)) && required.every((key) => Object.hasOwn(record, key));
}

function isEpisodePlan(value: unknown): value is EpisodePlan {
  if (!isRecord(value) || value["schemaVersion"] !== EPISODE_PLAN_SCHEMA_VERSION) return false;
  if (!nonEmpty(value["episodeId"]) || !Number.isSafeInteger(value["version"]) ||
      typeof value["intentHash"] !== "string" || !HASH.test(value["intentHash"]) ||
      !nonEmpty(value["summary"]) || !nonEmpty(value["workflowClass"]) ||
      !(["episode_planner", "creator_scope"] as const).includes(value["planningSource"] as "episode_planner") ||
      !Array.isArray(value["steps"]) || !value["steps"].every(isEpisodeStep) ||
      !isBudgetEstimate(value["estimatedBudget"]) || !isSafetyRoute(value["derivedSafetyRoute"]) ||
      typeof value["createdAt"] !== "string") return false;
  const provenance = value["creatorProvenance"];
  return provenance === undefined || isCreatorProvenance(provenance);
}

function isEpisodeStep(value: unknown): value is EpisodeStep {
  if (!isRecord(value) || !nonEmpty(value["id"]) || !nonEmpty(value["objective"]) ||
      !stringArray(value["dependsOn"]) || !Array.isArray(value["inputRefs"]) ||
      !value["inputRefs"].every((entry) => isRecord(entry) && nonEmpty(entry["ref"]) && typeof entry["required"] === "boolean") ||
      !Array.isArray(value["expectedOutputs"]) || !value["expectedOutputs"].every((entry) => isRecord(entry) && validOutput(entry as unknown as PlannedOutput))) return false;
  const commonRequired = ["kind", "id", "objective", "dependsOn", "inputRefs", "expectedOutputs"];
  if (value["kind"] === "mechanical_gate") {
    return exactKeys(value, [...commonRequired, "gate"], [...commonRequired, "gate"]) && nonEmpty(value["gate"]);
  }
  if (value["kind"] === "approval") {
    return exactKeys(
      value,
      [...commonRequired, "approvalKind", "actionRef"],
      [...commonRequired, "approvalKind", "actionRef"],
    ) && nonEmpty(value["approvalKind"]) && nonEmpty(value["actionRef"]);
  }
  if (value["kind"] !== "provider_turn") return false;
  if (!exactKeys(
    value,
    [
      ...commonRequired, "operation", "role", "requiredCapabilities", "assignment",
      "assignmentSource", "maxTurnBudgetUsd", "selectionReason",
    ],
    [
      ...commonRequired, "operation", "role", "requiredCapabilities", "assignment",
      "assignmentSource", "maxTurnBudgetUsd", "selectionReason",
    ],
  )) return false;
  try {
    validateTurnAssignment(value["assignment"]);
  } catch {
    return false;
  }
  return machineReadableOperation(value["operation"]) && nonEmpty(value["role"]) && stringArray(value["requiredCapabilities"]) &&
    (["configured", "episode_planner", "creator"] as const).includes(value["assignmentSource"] as "configured") &&
    typeof value["maxTurnBudgetUsd"] === "number" && nonEmpty(value["selectionReason"]);
}

function isBudgetEstimate(value: unknown): value is EpisodeBudgetEstimate {
  return isRecord(value) && Number.isSafeInteger(value["providerTurns"]) &&
    typeof value["providerTurnBudgetUsd"] === "number" &&
    typeof value["mechanicalOverheadUsd"] === "number" && typeof value["totalBudgetUsd"] === "number";
}

function isSafetyRoute(value: unknown): value is DerivedSafetyRoute {
  return isRecord(value) && nonEmpty(value["label"]) && stringArray(value["reasons"]) &&
    stringArray(value["gateStepIds"]) && stringArray(value["approvalStepIds"]);
}

function isCreatorProvenance(value: unknown): value is CreatorScopeProvenance {
  return isRecord(value) && (value["source"] === "human" || value["source"] === "agent") &&
    nonEmpty(value["creatorId"]) && typeof value["createdAt"] === "string" && stringArray(value["evidenceRefs"]);
}

function isCurrentPointer(value: unknown): value is CurrentEpisodePlanPointer {
  return isRecord(value) && value["schemaVersion"] === EPISODE_PLAN_POINTER_SCHEMA_VERSION &&
    nonEmpty(value["episodeId"]) && Number.isSafeInteger(value["version"]) &&
    typeof value["planHash"] === "string" && HASH.test(value["planHash"]) &&
    nonEmpty(value["file"]) && typeof value["updatedAt"] === "string";
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
