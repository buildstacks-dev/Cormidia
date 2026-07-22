import type {
  EpisodePlan,
  EpisodeStep,
  ProposedEpisodePlan,
  ProposedEpisodeStep,
} from "./episode-plan.js";
import type { VerdictKind } from "./verdicts.js";

export interface TicketProviderOperationDefinition {
  operation: string;
  role: "builder" | "reviewer";
  execution: "pipeline_pass" | "diagnostic_brief";
  pipeline: "build" | "fix" | "review" | "ship" | null;
  pass: string | null;
  template: string | null;
  verdictKind: Extract<VerdictKind, "contract" | "build" | "review"> | null;
  worktreeAccess: "read" | "write";
}

/**
 * Code-owned bridge from an accepted ticket plan to the already-governed
 * ticket pass semantics. The planner selects only the `operation`; it cannot
 * invent a prompt, verdict parser, role, or pipeline/pass pairing.
 *
 * `ticket/diagnose` is deliberately brief-only and read-only. It provides a
 * bounded reproduction/diagnostic turn for ambiguous bugs without claiming a
 * protected prompt or a typed mutation verdict that does not exist.
 */
export const TICKET_PROVIDER_OPERATION_CATALOG = {
  "ticket/diagnose": {
    operation: "ticket/diagnose",
    role: "builder",
    execution: "diagnostic_brief",
    pipeline: null,
    pass: null,
    template: null,
    verdictKind: null,
    worktreeAccess: "read",
  },
  "build/contract": {
    operation: "build/contract",
    role: "builder",
    execution: "pipeline_pass",
    pipeline: "build",
    pass: "contract",
    template: "build/contract.md",
    verdictKind: "contract",
    worktreeAccess: "read",
  },
  "build/implement": {
    operation: "build/implement",
    role: "builder",
    execution: "pipeline_pass",
    pipeline: "build",
    pass: "implement",
    template: "build/implement.md",
    verdictKind: "build",
    worktreeAccess: "write",
  },
  "fix/fix": {
    operation: "fix/fix",
    role: "builder",
    execution: "pipeline_pass",
    pipeline: "fix",
    pass: "fix",
    template: "build/fix.md",
    verdictKind: "build",
    worktreeAccess: "write",
  },
  "review/verify": {
    operation: "review/verify",
    role: "reviewer",
    execution: "pipeline_pass",
    pipeline: "review",
    pass: "verify",
    template: "review/verify.md",
    verdictKind: "review",
    worktreeAccess: "read",
  },
  "review/security-deep": {
    operation: "review/security-deep",
    role: "reviewer",
    execution: "pipeline_pass",
    pipeline: "review",
    pass: "security-deep",
    template: "review/security.md",
    verdictKind: "review",
    worktreeAccess: "read",
  },
  "review/perf-scale": {
    operation: "review/perf-scale",
    role: "reviewer",
    execution: "pipeline_pass",
    pipeline: "review",
    pass: "perf-scale",
    template: "review/perf.md",
    verdictKind: "review",
    worktreeAccess: "read",
  },
  "ship/ship-check": {
    operation: "ship/ship-check",
    role: "reviewer",
    execution: "pipeline_pass",
    pipeline: "ship",
    pass: "ship-check",
    template: "ship/check.md",
    verdictKind: "review",
    worktreeAccess: "read",
  },
} as const satisfies Record<string, TicketProviderOperationDefinition>;

export type TicketProviderOperation = keyof typeof TICKET_PROVIDER_OPERATION_CATALOG;
export const TICKET_PROVIDER_OPERATIONS = Object.keys(
  TICKET_PROVIDER_OPERATION_CATALOG,
).sort() as TicketProviderOperation[];

/**
 * A durable input a mechanical gate handler reads but never produces. The
 * gate cannot pass unless the named provider operation ran earlier on the
 * same dependency path, so its absence is a planning defect that a builder
 * turn can never repair. Declaring it here makes the requirement both
 * teachable (it is rendered into the planner's bounded brief) and checkable
 * (`validateTicketEpisodePlan` proves it as a pure graph property).
 */
export interface TicketMechanicalGateInputRequirement {
  /** Stable machine identity of the evidence the handler reads. */
  input: string;
  /** The exact provider operation whose durable output produces it. */
  producedBy: TicketProviderOperation;
  /** The named consumer, so the failure message points at the real cause. */
  consumedBy: string;
}

export interface TicketMechanicalGateDefinition {
  handler: string;
  requiredPlanInputs: readonly TicketMechanicalGateInputRequirement[];
}

/**
 * `build/contract` publishes the criterion→test mapping; the `completeness`
 * quality gate is scored against it. `ticket/gates-and-pr` and `ticket/ship`
 * both run that gate (`advanceGates` / `advanceShipping` in the ticket state
 * machine), so both consume the mapping and neither produces it.
 */
const CRITERION_TEST_CONTRACT_MAPPING = {
  input: "criterion_test_contract_mapping",
  producedBy: "build/contract",
  consumedBy: "the completeness quality gate",
} as const satisfies TicketMechanicalGateInputRequirement;

export const TICKET_MECHANICAL_GATE_CATALOG = {
  "ticket/provision": { handler: "provision", requiredPlanInputs: [] },
  "ticket/gates-and-pr": {
    handler: "gates_and_pr",
    requiredPlanInputs: [CRITERION_TEST_CONTRACT_MAPPING],
  },
  /** Workflow-specific realizations of semantic safety floors. These gates
   * are structural joins over durable provider/mechanical evidence; they do
   * not infer safety from issue prose. */
  "ticket/security": { handler: "security_evidence", requiredPlanInputs: [] },
  "ticket/data-integrity": { handler: "data_integrity_evidence", requiredPlanInputs: [] },
  "ticket/rollback": { handler: "rollback_evidence", requiredPlanInputs: [] },
  "ticket/performance": { handler: "performance_evidence", requiredPlanInputs: [] },
  "ticket/review-authorization": { handler: "review_authorization", requiredPlanInputs: [] },
  "ticket/ship": { handler: "ship", requiredPlanInputs: [CRITERION_TEST_CONTRACT_MAPPING] },
  "release/handoff": { handler: "release_handoff", requiredPlanInputs: [] },
} as const satisfies Record<string, TicketMechanicalGateDefinition>;

export type TicketMechanicalGateKind = keyof typeof TICKET_MECHANICAL_GATE_CATALOG;
export const TICKET_MECHANICAL_GATE_KINDS = Object.keys(
  TICKET_MECHANICAL_GATE_CATALOG,
).sort() as TicketMechanicalGateKind[];

/**
 * The closed, enumerable topology contract. Each entry is one rule the
 * accepted plan must satisfy, with the stable id the validator stamps onto
 * every violation. The planner is given this list verbatim; validation is the
 * backstop, not the teacher (ISSUE-023).
 */
export const TICKET_TOPOLOGY_RULES = [
  {
    id: "provision_precedes_write",
    statement:
      "every provider operation with write worktree access must have a ticket/provision ancestor",
  },
  {
    id: "write_feeds_gates_and_pr",
    statement:
      "every provider operation with write worktree access must feed a later ticket/gates-and-pr step",
  },
  {
    id: "gates_and_pr_requires_write",
    statement:
      "ticket/gates-and-pr requires an implementation or fix ancestor that wrote to the worktree",
  },
  {
    id: "gate_inputs_produced_by_ancestor",
    statement:
      "every mechanical gate input listed in mechanicalGateRegistry[].requiredPlanInputs must be " +
      "produced by an ancestor provider step in the same plan",
  },
  {
    id: "review_authorization_joins_review_lenses",
    statement:
      "ticket/review-authorization must follow every review lens for its gated revision",
  },
  {
    id: "review_lens_requires_gates_and_pr",
    statement: "every review lens requires a ticket/gates-and-pr ancestor",
  },
  {
    id: "review_lens_feeds_review_authorization",
    statement:
      "every review lens must feed a later ticket/review-authorization step; " +
      "authorization may never precede the review it authorizes",
  },
  {
    id: "security_gate_requires_security_review",
    statement: "ticket/security requires a completed review/security-deep provider ancestor",
  },
  {
    id: "performance_gate_requires_performance_review",
    statement: "ticket/performance requires a completed review/perf-scale provider ancestor",
  },
  {
    id: "data_integrity_gate_requires_quality_gates",
    statement: "ticket/data-integrity requires a ticket/gates-and-pr ancestor",
  },
  {
    id: "rollback_gate_requires_rollback_plan",
    statement:
      "ticket/rollback requires a required rollback_plan expected output from an ancestor provider step",
  },
  {
    id: "ship_requires_review_authorization",
    statement: "ticket/ship requires a ticket/review-authorization ancestor",
  },
  {
    id: "ship_check_requires_review_authorization",
    statement: "ship/ship-check requires a ticket/review-authorization ancestor",
  },
  {
    id: "ship_follows_every_ship_check",
    statement:
      "when the plan contains any ship/ship-check step, ticket/ship must follow every one of them",
  },
  {
    id: "release_handoff_requires_ship",
    statement: "release/handoff requires a ticket/ship ancestor",
  },
  {
    id: "plan_output_refs_resolve_to_ancestors",
    statement:
      "every plan-output:<output-id> input must resolve to exactly one expectedOutputs entry " +
      "declared by a dependency ancestor of the consuming step",
  },
] as const;

export type TicketTopologyRuleId = (typeof TICKET_TOPOLOGY_RULES)[number]["id"];

export const TICKET_EPISODE_PLAN_REASON_CODES = [
  "ticket_provider_operation_unknown",
  "ticket_provider_operation_role_mismatch",
  "ticket_mechanical_gate_unknown",
  "ticket_topology_invalid",
  "ticket_gate_input_unavailable",
  "ticket_plan_output_ref_invalid",
] as const;

export type TicketEpisodePlanReasonCode = (typeof TICKET_EPISODE_PLAN_REASON_CODES)[number];

export interface TicketEpisodePlanIssue {
  code: TicketEpisodePlanReasonCode;
  message: string;
  stepId?: string;
  inputRef?: string;
  /** Stable id of the violated topology rule, so a repair pass can be told
   * which invariants the rejected proposal already satisfied. */
  rule?: TicketTopologyRuleId;
}

export interface TicketEpisodePlanValidationResult {
  ok: boolean;
  issues: TicketEpisodePlanIssue[];
}

type TicketPlanStep = EpisodeStep | ProposedEpisodeStep;
type TicketPlanLike = Pick<EpisodePlan | ProposedEpisodePlan, "steps">;

export class TicketEpisodePlanValidationError extends Error {
  readonly code = "error_ticket_episode_plan_invalid" as const;

  constructor(readonly issues: readonly TicketEpisodePlanIssue[]) {
    super(issues.map((entry) => `${entry.code}: ${entry.message}`).join("; "));
    this.name = "TicketEpisodePlanValidationError";
  }
}

export function ticketProviderOperation(
  operation: string,
): TicketProviderOperationDefinition | undefined {
  if (!Object.hasOwn(TICKET_PROVIDER_OPERATION_CATALOG, operation)) return undefined;
  return TICKET_PROVIDER_OPERATION_CATALOG[operation as TicketProviderOperation];
}

export function isTicketMechanicalGateKind(value: string): value is TicketMechanicalGateKind {
  return Object.hasOwn(TICKET_MECHANICAL_GATE_CATALOG, value);
}

export function ticketMechanicalGate(
  gate: string,
): TicketMechanicalGateDefinition | undefined {
  if (!isTicketMechanicalGateKind(gate)) return undefined;
  return TICKET_MECHANICAL_GATE_CATALOG[gate];
}

/**
 * The exact accepted plan-v1 topology of the one ticket in this project's
 * history that planned, built, reviewed, opened a pull request, and merged
 * without human intervention (run 3, ticket #9). It is shipped to the planner
 * as a known-good worked example, not as a template it must copy verbatim.
 */
const TICKET_CANONICAL_REFERENCE_TOPOLOGY = {
  provenance:
    "accepted ticket plan that planned, built, reviewed, opened a PR, and merged autonomously",
  workflowClass: "ticket-build-review-ship",
  steps: [
    {
      kind: "mechanical_gate",
      id: "provision",
      gate: "ticket/provision",
      dependsOn: [],
      inputRefs: [],
      expectedOutputs: ["worktree"],
    },
    {
      kind: "provider_turn",
      id: "build-contract",
      operation: "build/contract",
      role: "builder",
      dependsOn: ["provision"],
      inputRefs: [],
      expectedOutputs: ["contract"],
    },
    {
      kind: "provider_turn",
      id: "build-implement",
      operation: "build/implement",
      role: "builder",
      dependsOn: ["build-contract"],
      inputRefs: ["plan-output:contract"],
      expectedOutputs: ["implementation"],
    },
    {
      kind: "mechanical_gate",
      id: "gates-and-pr",
      gate: "ticket/gates-and-pr",
      dependsOn: ["build-implement"],
      inputRefs: ["plan-output:implementation"],
      expectedOutputs: ["pr"],
    },
    {
      kind: "provider_turn",
      id: "review-verify",
      operation: "review/verify",
      role: "reviewer",
      dependsOn: ["gates-and-pr"],
      inputRefs: ["plan-output:pr"],
      expectedOutputs: ["review-verdict"],
    },
    {
      kind: "mechanical_gate",
      id: "review-authorization",
      gate: "ticket/review-authorization",
      dependsOn: ["review-verify"],
      inputRefs: ["plan-output:review-verdict"],
      expectedOutputs: ["authorization"],
    },
    {
      kind: "mechanical_gate",
      id: "ship",
      gate: "ticket/ship",
      dependsOn: ["review-authorization"],
      inputRefs: ["plan-output:authorization"],
      expectedOutputs: ["ship-result"],
    },
  ],
} as const;

/**
 * Closed machine-readable statement of everything `validateTicketEpisodePlan`
 * enforces. Rendered into the EpisodePlanner's bounded brief so the contract
 * is stated before generation instead of discovered by rejection (ISSUE-023).
 */
export const TICKET_EPISODE_TOPOLOGY_CONTRACT = {
  schemaVersion: 1,
  kind: "ticket-episode-topology-contract",
  mechanicalGateRegistry: Object.entries(TICKET_MECHANICAL_GATE_CATALOG)
    .map(([gate, definition]) => ({
      gate,
      handler: definition.handler,
      requiredPlanInputs: definition.requiredPlanInputs.map((requirement) => ({ ...requirement })),
    }))
    .sort((left, right) => left.gate.localeCompare(right.gate)),
  providerOperationRegistry: Object.values(TICKET_PROVIDER_OPERATION_CATALOG)
    .map((definition) => ({
      operation: definition.operation,
      role: definition.role,
      worktreeAccess: definition.worktreeAccess,
      producesVerdict: definition.verdictKind,
    }))
    .sort((left, right) => left.operation.localeCompare(right.operation)),
  planStructureRules: [
    {
      id: "terminal_step_with_required_output",
      statement:
        "the plan must contain at least one terminal step (no dependents) declaring a required " +
        "expectedOutputs entry, and every step must lie on a path to such a terminal step",
    },
  ],
  topologyRules: TICKET_TOPOLOGY_RULES.map((rule) => ({ ...rule })),
  canonicalReferenceTopology: TICKET_CANONICAL_REFERENCE_TOPOLOGY,
} as const;

/** Pure ticket-protocol validation, applied after the core EpisodePlan DAG
 * validator. It authorizes no execution or mutation. */
export function validateTicketEpisodePlan(plan: TicketPlanLike): TicketEpisodePlanValidationResult {
  const issues: TicketEpisodePlanIssue[] = [];
  const steps = plan.steps as readonly TicketPlanStep[];
  const byId = new Map(steps.map((step) => [step.id, step]));
  const ancestors = ancestorResolver(byId);
  const outputOwners = outputOwnerIndex(steps);

  for (const step of steps) {
    validatePlanOutputRefs(step, ancestors(step.id), outputOwners, issues);
    if (step.kind === "provider_turn") {
      const definition = ticketProviderOperation(step.operation);
      if (definition === undefined) {
        issues.push(ticketIssue(
          "ticket_provider_operation_unknown",
          `unknown provider operation ${JSON.stringify(step.operation)}; ` +
            `valid operations are: ${TICKET_PROVIDER_OPERATIONS.join(", ")}`,
          step.id,
        ));
      } else if (step.role !== definition.role) {
        issues.push(ticketIssue(
          "ticket_provider_operation_role_mismatch",
          `${step.operation} is owned by ${definition.role}, not ${step.role}`,
          step.id,
        ));
      }
      continue;
    }
    if (step.kind === "mechanical_gate" && !isTicketMechanicalGateKind(step.gate)) {
      issues.push(ticketIssue(
        "ticket_mechanical_gate_unknown",
        `mechanical gate ${step.gate} has no ticket execution handler`,
        step.id,
      ));
    }
  }

  validateTicketTopology(steps, ancestors, issues);
  const unique = dedupeTicketIssues(issues);
  return { ok: unique.length === 0, issues: unique };
}

export function assertTicketEpisodePlanValid(plan: TicketPlanLike): void {
  const result = validateTicketEpisodePlan(plan);
  if (!result.ok) throw new TicketEpisodePlanValidationError(result.issues);
}

function validateTicketTopology(
  steps: readonly TicketPlanStep[],
  ancestors: (stepId: string) => ReadonlySet<string>,
  issues: TicketEpisodePlanIssue[],
): void {
  const providers = steps.filter((step) => step.kind === "provider_turn");
  const gates = steps.filter((step) => step.kind === "mechanical_gate");
  const writes = providers.filter((step) =>
    ticketProviderOperation(step.operation)?.worktreeAccess === "write"
  );
  const reviews = providers.filter((step) => step.operation.startsWith("review/"));
  const shipChecks = providers.filter((step) => step.operation === "ship/ship-check");
  const securityReviews = providers.filter((step) => step.operation === "review/security-deep");
  const performanceReviews = providers.filter((step) => step.operation === "review/perf-scale");

  for (const step of writes) {
    requireAncestorKind(
      step,
      ancestors(step.id),
      gates,
      (gate) => gate.gate === "ticket/provision",
      "write operations require ticket/provision first",
      "provision_precedes_write",
      issues,
    );
    const gated = gates.some((gate) =>
      gate.gate === "ticket/gates-and-pr" && ancestors(gate.id).has(step.id)
    );
    if (!gated) {
      issues.push(ticketIssue(
        "ticket_topology_invalid",
        `${step.operation} must feed a later ticket/gates-and-pr step`,
        step.id,
        "write_feeds_gates_and_pr",
      ));
    }
  }

  for (const gate of gates) {
    const gateAncestors = ancestors(gate.id);
    validateGateInputAvailability(gate, gateAncestors, providers, issues);
    if (gate.gate === "ticket/gates-and-pr") {
      const hasWrite = writes.some((step) => gateAncestors.has(step.id));
      if (!hasWrite) {
        issues.push(ticketIssue(
          "ticket_topology_invalid",
          "ticket/gates-and-pr requires an implementation or fix ancestor",
          gate.id,
          "gates_and_pr_requires_write",
        ));
      }
    }
    if (gate.gate === "ticket/review-authorization") {
      const precedingReviews = reviews.filter((review) => gateAncestors.has(review.id));
      // When review lenses are present on this authorization path, the gate
      // must join them all rather than race the first completed lens.
      const relatedReviews = reviews.filter((review) =>
        sharesGatesAndPrAncestor(review, gate, ancestors, gates)
      );
      if (relatedReviews.some((review) => !precedingReviews.includes(review))) {
        issues.push(ticketIssue(
          "ticket_topology_invalid",
          "ticket/review-authorization must follow every review lens for its gated revision",
          gate.id,
          "review_authorization_joins_review_lenses",
        ));
      }
    }
    if (gate.gate === "ticket/security") {
      requireAncestorKind(
        gate,
        gateAncestors,
        securityReviews,
        () => true,
        "ticket/security requires a completed review/security-deep provider step",
        "security_gate_requires_security_review",
        issues,
      );
    }
    if (gate.gate === "ticket/performance") {
      requireAncestorKind(
        gate,
        gateAncestors,
        performanceReviews,
        () => true,
        "ticket/performance requires a completed review/perf-scale provider step",
        "performance_gate_requires_performance_review",
        issues,
      );
    }
    if (gate.gate === "ticket/data-integrity") {
      requireAncestorKind(
        gate,
        gateAncestors,
        gates,
        (candidate) => candidate.gate === "ticket/gates-and-pr",
        "ticket/data-integrity requires the deterministic quality-gate result",
        "data_integrity_gate_requires_quality_gates",
        issues,
      );
    }
    if (gate.gate === "ticket/rollback") {
      const hasRollbackPlan = providers.some((provider) =>
        gateAncestors.has(provider.id) &&
        provider.expectedOutputs.some((output) => output.required && output.kind === "rollback_plan")
      );
      if (!hasRollbackPlan) {
        issues.push(ticketIssue(
          "ticket_topology_invalid",
          "ticket/rollback requires a required rollback_plan output from an ancestor provider step",
          gate.id,
          "rollback_gate_requires_rollback_plan",
        ));
      }
    }
    if (gate.gate === "ticket/ship") {
      requireAncestorKind(
        gate,
        gateAncestors,
        gates,
        (candidate) => candidate.gate === "ticket/review-authorization",
        "ticket/ship requires ticket/review-authorization first",
        "ship_requires_review_authorization",
        issues,
      );
      for (const shipCheck of shipChecks) {
        if (!gateAncestors.has(shipCheck.id)) {
          issues.push(ticketIssue(
            "ticket_topology_invalid",
            `ticket/ship must follow ship-check ${shipCheck.id}`,
            gate.id,
            "ship_follows_every_ship_check",
          ));
        }
      }
    }
    if (gate.gate === "release/handoff") {
      requireAncestorKind(
        gate,
        gateAncestors,
        gates,
        (candidate) => candidate.gate === "ticket/ship",
        "release/handoff requires ticket/ship first",
        "release_handoff_requires_ship",
        issues,
      );
    }
  }

  for (const review of reviews) {
    requireAncestorKind(
      review,
      ancestors(review.id),
      gates,
      (gate) => gate.gate === "ticket/gates-and-pr",
      "review lenses require ticket/gates-and-pr first",
      "review_lens_requires_gates_and_pr",
      issues,
    );
    const authorized = gates.some((gate) =>
      gate.gate === "ticket/review-authorization" && ancestors(gate.id).has(review.id)
    );
    if (!authorized) {
      issues.push(ticketIssue(
        "ticket_topology_invalid",
        `review lens ${review.id} must feed a later ticket/review-authorization step`,
        review.id,
        "review_lens_feeds_review_authorization",
      ));
    }
  }

  for (const shipCheck of shipChecks) {
    requireAncestorKind(
      shipCheck,
      ancestors(shipCheck.id),
      gates,
      (gate) => gate.gate === "ticket/review-authorization",
      "ship-check requires ticket/review-authorization first",
      "ship_check_requires_review_authorization",
      issues,
    );
  }
}

/**
 * Pure graph proof that every mechanical gate's declared durable inputs are
 * produced by an ancestor step of the same plan. This is the check that costs
 * nothing at acceptance and $18.61 of stranded builder work when it is missing
 * (ISSUE-024): `ticket/gates-and-pr` scores the `completeness` gate against the
 * `build/contract` criterion→test mapping, so a plan holding the gate without
 * the contract step is unsatisfiable no matter what the builder writes.
 */
function validateGateInputAvailability(
  gate: Extract<TicketPlanStep, { kind: "mechanical_gate" }>,
  gateAncestors: ReadonlySet<string>,
  providers: readonly Extract<TicketPlanStep, { kind: "provider_turn" }>[],
  issues: TicketEpisodePlanIssue[],
): void {
  const definition = ticketMechanicalGate(gate.gate);
  if (definition === undefined) return;
  for (const requirement of definition.requiredPlanInputs) {
    const produced = providers.some((provider) =>
      provider.operation === requirement.producedBy && gateAncestors.has(provider.id)
    );
    if (produced) continue;
    issues.push({
      code: "ticket_gate_input_unavailable",
      rule: "gate_inputs_produced_by_ancestor",
      stepId: gate.id,
      message:
        `${gate.gate} consumes ${requirement.input}, which only ${requirement.producedBy} ` +
        `produces, but no ${requirement.producedBy} step is an ancestor of ${gate.id}; ` +
        `add a ${requirement.producedBy} provider step before it — ${requirement.consumedBy} ` +
        "reads that mapping and can never pass while it is absent",
    });
  }
}

function validatePlanOutputRefs(
  step: TicketPlanStep,
  stepAncestors: ReadonlySet<string>,
  outputOwners: ReadonlyMap<string, readonly string[]>,
  issues: TicketEpisodePlanIssue[],
): void {
  for (const input of step.inputRefs) {
    if (!input.ref.startsWith("plan-output:")) continue;
    const outputId = input.ref.slice("plan-output:".length);
    if (!/^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*$/.test(outputId)) {
      issues.push(ticketInputIssue(
        "ticket_plan_output_ref_invalid",
        `${input.ref} is not a valid plan output reference`,
        step.id,
        input.ref,
      ));
      continue;
    }
    const owners = outputOwners.get(outputId) ?? [];
    if (owners.length !== 1) {
      issues.push(ticketInputIssue(
        "ticket_plan_output_ref_invalid",
        `${input.ref} must resolve to exactly one plan output`,
        step.id,
        input.ref,
      ));
      continue;
    }
    if (!stepAncestors.has(owners[0]!)) {
      issues.push(ticketInputIssue(
        "ticket_plan_output_ref_invalid",
        `${input.ref} is not produced by a dependency ancestor of ${step.id}`,
        step.id,
        input.ref,
      ));
    }
  }
}

function ancestorResolver(
  byId: ReadonlyMap<string, TicketPlanStep>,
): (stepId: string) => ReadonlySet<string> {
  const cache = new Map<string, ReadonlySet<string>>();
  const resolve = (stepId: string, visiting = new Set<string>()): ReadonlySet<string> => {
    const cached = cache.get(stepId);
    if (cached !== undefined) return cached;
    if (visiting.has(stepId)) return new Set();
    const nested = new Set(visiting).add(stepId);
    const result = new Set<string>();
    for (const dependency of byId.get(stepId)?.dependsOn ?? []) {
      if (!byId.has(dependency)) continue;
      result.add(dependency);
      for (const ancestor of resolve(dependency, nested)) result.add(ancestor);
    }
    cache.set(stepId, result);
    return result;
  };
  return (stepId) => resolve(stepId);
}

function outputOwnerIndex(
  steps: readonly TicketPlanStep[],
): ReadonlyMap<string, readonly string[]> {
  const owners = new Map<string, string[]>();
  for (const step of steps) {
    for (const output of step.expectedOutputs) {
      owners.set(output.id, [...(owners.get(output.id) ?? []), step.id]);
    }
  }
  return owners;
}

function requireAncestorKind<T extends TicketPlanStep>(
  step: TicketPlanStep,
  stepAncestors: ReadonlySet<string>,
  candidates: readonly T[],
  predicate: (candidate: T) => boolean,
  message: string,
  rule: TicketTopologyRuleId,
  issues: TicketEpisodePlanIssue[],
): void {
  if (candidates.some((candidate) => predicate(candidate) && stepAncestors.has(candidate.id))) return;
  issues.push(ticketIssue("ticket_topology_invalid", message, step.id, rule));
}

function sharesGatesAndPrAncestor(
  review: TicketPlanStep,
  authorization: TicketPlanStep,
  ancestors: (stepId: string) => ReadonlySet<string>,
  gates: readonly Extract<TicketPlanStep, { kind: "mechanical_gate" }>[],
): boolean {
  const reviewFrontier = latestGatesAndPrAncestors(review, ancestors, gates);
  const authorizationFrontier = latestGatesAndPrAncestors(authorization, ancestors, gates);
  return [...reviewFrontier].some((gateId) => authorizationFrontier.has(gateId));
}

/** Latest gate frontier scopes a review generation across forward-only plan
 * revisions. A retained completed authorization from vN does not become
 * invalid merely because vN+1 adds another gates/review/authorization chain. */
function latestGatesAndPrAncestors(
  step: TicketPlanStep,
  ancestors: (stepId: string) => ReadonlySet<string>,
  gates: readonly Extract<TicketPlanStep, { kind: "mechanical_gate" }>[],
): ReadonlySet<string> {
  const stepAncestors = ancestors(step.id);
  const candidates = gates.filter((gate) =>
    gate.gate === "ticket/gates-and-pr" && stepAncestors.has(gate.id)
  );
  return new Set(candidates
    .filter((candidate) => !candidates.some((later) =>
      later.id !== candidate.id && ancestors(later.id).has(candidate.id)
    ))
    .map((gate) => gate.id));
}

function ticketIssue(
  code: TicketEpisodePlanReasonCode,
  message: string,
  stepId?: string,
  rule?: TicketTopologyRuleId,
): TicketEpisodePlanIssue {
  return {
    code,
    message,
    ...(stepId === undefined ? {} : { stepId }),
    ...(rule === undefined ? {} : { rule }),
  };
}

function ticketInputIssue(
  code: TicketEpisodePlanReasonCode,
  message: string,
  stepId: string,
  inputRef: string,
): TicketEpisodePlanIssue {
  return { code, message, stepId, inputRef, rule: "plan_output_refs_resolve_to_ancestors" };
}

function dedupeTicketIssues(issues: TicketEpisodePlanIssue[]): TicketEpisodePlanIssue[] {
  const seen = new Set<string>();
  return issues.filter((entry) => {
    const key = `${entry.code}\0${entry.stepId ?? ""}\0${entry.inputRef ?? ""}\0${entry.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
