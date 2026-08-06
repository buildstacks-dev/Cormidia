import type { EpisodePlan, EpisodeStep, ProposedEpisodePlan, ProposedEpisodeStep } from "./episode-plan.js";
import type { PipelinesFile, PipelineConfig } from "./pipelines.js";
import type { ProjectStage } from "./plan-tickets.js";

export interface PlanningProviderOperationDefinition {
  operation: string;
  role: "planner";
  pipeline: "plan-bootstrap" | "plan";
  pass: string;
  template: string;
  output: "artifact" | "ticket_plan";
}

/**
 * The only provider operations an accepted product-planning EpisodePlan may
 * select. Each entry binds one machine operation to one already-governed
 * pipeline pass and protected prompt template. The EpisodePlanner may choose
 * the smallest useful graph over these entries; it cannot invent a pass,
 * prompt, role, or terminal-output protocol.
 */
export const PLANNING_PROVIDER_OPERATION_CATALOG = {
  "plan/bootstrap": {
    operation: "plan/bootstrap",
    role: "planner",
    pipeline: "plan-bootstrap",
    pass: "bootstrap-plan",
    template: "plan/bootstrap.md",
    output: "ticket_plan",
  },
  "plan/vision": {
    operation: "plan/vision",
    role: "planner",
    pipeline: "plan",
    pass: "visionary",
    template: "plan/visionary.md",
    output: "artifact",
  },
  "plan/product-a": {
    operation: "plan/product-a",
    role: "planner",
    pipeline: "plan",
    pass: "pm-a",
    template: "plan/pm.md",
    output: "artifact",
  },
  "plan/product-b": {
    operation: "plan/product-b",
    role: "planner",
    pipeline: "plan",
    pass: "pm-b",
    template: "plan/pm-b.md",
    output: "artifact",
  },
  "plan/arbitrate": {
    operation: "plan/arbitrate",
    role: "planner",
    pipeline: "plan",
    pass: "arbitrator",
    template: "plan/arbitrator.md",
    output: "artifact",
  },
  "plan/decompose": {
    operation: "plan/decompose",
    role: "planner",
    pipeline: "plan",
    pass: "decomposer",
    template: "plan/decomposer.md",
    output: "ticket_plan",
  },
} as const satisfies Record<string, PlanningProviderOperationDefinition>;

export type PlanningProviderOperation = keyof typeof PLANNING_PROVIDER_OPERATION_CATALOG;
export const PLANNING_PROVIDER_OPERATIONS = Object.keys(
  PLANNING_PROVIDER_OPERATION_CATALOG,
).sort() as PlanningProviderOperation[];

export const PLANNING_EPISODE_PLAN_REASON_CODES = [
  "planning_provider_operation_unknown",
  "planning_provider_operation_role_mismatch",
  "planning_step_kind_unsupported",
  "planning_terminal_count_invalid",
  "planning_terminal_operation_invalid",
  "planning_ticket_plan_output_invalid",
  "planning_plan_output_ref_invalid",
] as const;

export type PlanningEpisodePlanReasonCode = (typeof PLANNING_EPISODE_PLAN_REASON_CODES)[number];

export interface PlanningEpisodePlanIssue {
  code: PlanningEpisodePlanReasonCode;
  message: string;
  stepId?: string;
  inputRef?: string;
}

export interface PlanningEpisodePlanValidationResult {
  ok: boolean;
  issues: PlanningEpisodePlanIssue[];
}

export class PlanningEpisodePlanValidationError extends Error {
  readonly code = "error_planning_episode_plan_invalid" as const;

  constructor(readonly issues: readonly PlanningEpisodePlanIssue[]) {
    super(issues.map((entry) => `${entry.code}: ${entry.message}`).join("; "));
    this.name = "PlanningEpisodePlanValidationError";
  }
}

type PlanningStep = EpisodeStep | ProposedEpisodeStep;
type PlanningPlanLike = Pick<EpisodePlan | ProposedEpisodePlan, "steps">;

export function planningProviderOperation(operation: string): PlanningProviderOperationDefinition | undefined {
  if (!Object.hasOwn(PLANNING_PROVIDER_OPERATION_CATALOG, operation)) return undefined;
  return PLANNING_PROVIDER_OPERATION_CATALOG[operation as PlanningProviderOperation];
}

/** Fail closed if a protected pipeline edit drifts from the code-owned bridge. */
export function assertPlanningOperationCatalogMatches(file: PipelinesFile): void {
  const bound = new Set<string>();
  for (const definition of Object.values(PLANNING_PROVIDER_OPERATION_CATALOG)) {
    const pipeline = file.pipelines.find((candidate) => candidate.name === definition.pipeline);
    if (pipeline === undefined) {
      throw new Error(`planning operation ${definition.operation} requires missing pipeline ${definition.pipeline}`);
    }
    const matches = pipeline.passes.filter((pass) => pass.id === definition.pass);
    if (matches.length !== 1) {
      throw new Error(
        `planning operation ${definition.operation} requires exactly one ` +
          `${definition.pipeline}/${definition.pass} pass`,
      );
    }
    const pass = matches[0]!;
    if (pass.role !== definition.role || pass.template !== definition.template) {
      throw new Error(
        `planning operation ${definition.operation} expected ` +
          `${definition.role}/${definition.template}, found ${pass.role}/${pass.template}`,
      );
    }
    bound.add(`${definition.pipeline}\0${definition.pass}`);
  }
  for (const pipelineName of ["plan-bootstrap", "plan"] as const) {
    const pipeline = file.pipelines.find((candidate) => candidate.name === pipelineName);
    if (pipeline === undefined) continue; // The missing required pipeline was reported above.
    for (const pass of pipeline.passes) {
      if (!bound.has(`${pipelineName}\0${pass.id}`)) {
        throw new Error(`governed planning pass ${pipelineName}/${pass.id} has no code-owned operation binding`);
      }
    }
  }
}

export function planningPipelineForOperation(operation: string, file: PipelinesFile): PipelineConfig {
  const definition = planningProviderOperation(operation);
  if (definition === undefined) throw new Error(`unknown planning provider operation ${operation}`);
  assertPlanningOperationCatalogMatches(file);
  const configured = file.pipelines.find((pipeline) => pipeline.name === definition.pipeline)!;
  const pass = configured.passes.find((candidate) => candidate.id === definition.pass)!;
  return {
    name: configured.name,
    mechanical: false,
    passes: [{ ...pass }],
  };
}

export function validatePlanningEpisodePlan(
  plan: PlanningPlanLike,
  stage: ProjectStage,
): PlanningEpisodePlanValidationResult {
  const issues: PlanningEpisodePlanIssue[] = [];
  const steps = plan.steps as readonly PlanningStep[];
  const byId = new Map(steps.map((step) => [step.id, step]));
  const dependents = new Map<string, string[]>();
  const outputOwners = new Map<string, string[]>();
  for (const step of steps) {
    for (const dependency of step.dependsOn) {
      dependents.set(dependency, [...(dependents.get(dependency) ?? []), step.id]);
    }
    for (const output of step.expectedOutputs) {
      outputOwners.set(output.id, [...(outputOwners.get(output.id) ?? []), step.id]);
    }
  }
  const ancestors = ancestorResolver(byId);

  for (const step of steps) {
    if (step.kind !== "provider_turn") {
      issues.push(
        issue(
          "planning_step_kind_unsupported",
          "product-planning episodes support provider operations only; publication remains outside the plan DAG",
          step.id,
        ),
      );
      continue;
    }
    const definition = planningProviderOperation(step.operation);
    if (definition === undefined) {
      issues.push(
        issue(
          "planning_provider_operation_unknown",
          `provider operation ${step.operation} is not in the planning operation catalog`,
          step.id,
        ),
      );
    } else if (step.role !== definition.role) {
      issues.push(
        issue(
          "planning_provider_operation_role_mismatch",
          `${step.operation} is owned by ${definition.role}, not ${step.role}`,
          step.id,
        ),
      );
    }
    validateOutputRefs(step, ancestors(step.id), outputOwners, issues);
  }

  const terminals = steps.filter((step) => (dependents.get(step.id)?.length ?? 0) === 0);
  if (terminals.length !== 1) {
    issues.push(
      issue(
        "planning_terminal_count_invalid",
        `planning workflow must have exactly one terminal TicketPlan step; found ${terminals.length}`,
      ),
    );
  }
  const terminal = terminals[0];
  if (terminal !== undefined) {
    const expectedOperation = stage === "bootstrap" ? "plan/bootstrap" : "plan/decompose";
    const definition = terminal.kind === "provider_turn" ? planningProviderOperation(terminal.operation) : undefined;
    if (
      definition?.output !== "ticket_plan" ||
      terminal.kind !== "provider_turn" ||
      terminal.operation !== expectedOperation
    ) {
      issues.push(
        issue(
          "planning_terminal_operation_invalid",
          `${stage} planning must terminate in ${expectedOperation}`,
          terminal.id,
        ),
      );
    }
    const ticketOutputs = terminal.expectedOutputs.filter((output) => output.id === "ticket-plan");
    if (ticketOutputs.length !== 1 || ticketOutputs[0]!.kind !== "TicketPlan" || ticketOutputs[0]!.required !== true) {
      issues.push(
        issue(
          "planning_ticket_plan_output_invalid",
          "terminal step must declare required output ticket-plan of kind TicketPlan",
          terminal.id,
        ),
      );
    }
    if (terminal.kind !== "provider_turn" || !terminal.requiredCapabilities.includes("structured_verdict")) {
      issues.push(
        issue(
          "planning_ticket_plan_output_invalid",
          "terminal TicketPlan operation must require structured_verdict capability",
          terminal.id,
        ),
      );
    }
  }
  for (const step of steps) {
    if (step !== terminal && step.expectedOutputs.some((output) => output.id === "ticket-plan")) {
      issues.push(
        issue(
          "planning_ticket_plan_output_invalid",
          "only the terminal governed planning operation may declare ticket-plan",
          step.id,
        ),
      );
    }
  }

  const unique = dedupe(issues);
  return { ok: unique.length === 0, issues: unique };
}

export function assertPlanningEpisodePlanValid(plan: PlanningPlanLike, stage: ProjectStage): void {
  const result = validatePlanningEpisodePlan(plan, stage);
  if (!result.ok) throw new PlanningEpisodePlanValidationError(result.issues);
}

function validateOutputRefs(
  step: PlanningStep,
  ancestors: ReadonlySet<string>,
  outputOwners: ReadonlyMap<string, readonly string[]>,
  issues: PlanningEpisodePlanIssue[],
): void {
  for (const input of step.inputRefs) {
    if (!input.ref.startsWith("plan-output:")) continue;
    const outputId = input.ref.slice("plan-output:".length);
    const owners = outputOwners.get(outputId) ?? [];
    if (owners.length !== 1 || !ancestors.has(owners[0]!)) {
      issues.push({
        code: "planning_plan_output_ref_invalid",
        message: `${input.ref} must resolve to exactly one dependency-ancestor output; ` + `found ${owners.length}`,
        stepId: step.id,
        inputRef: input.ref,
      });
    }
  }
}

function ancestorResolver(byId: ReadonlyMap<string, PlanningStep>): (stepId: string) => ReadonlySet<string> {
  const cache = new Map<string, ReadonlySet<string>>();
  const resolve = (stepId: string): ReadonlySet<string> => {
    const cached = cache.get(stepId);
    if (cached !== undefined) return cached;
    const result = new Set<string>();
    const visit = (id: string): void => {
      const step = byId.get(id);
      if (step === undefined) return;
      for (const dependency of step.dependsOn) {
        if (result.has(dependency)) continue;
        result.add(dependency);
        visit(dependency);
      }
    };
    visit(stepId);
    cache.set(stepId, result);
    return result;
  };
  return resolve;
}

function issue(code: PlanningEpisodePlanReasonCode, message: string, stepId?: string): PlanningEpisodePlanIssue {
  return stepId === undefined ? { code, message } : { code, message, stepId };
}

function dedupe(issues: readonly PlanningEpisodePlanIssue[]): PlanningEpisodePlanIssue[] {
  const seen = new Set<string>();
  return issues.filter((entry) => {
    const key = `${entry.code}\0${entry.stepId ?? ""}\0${entry.inputRef ?? ""}\0${entry.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
