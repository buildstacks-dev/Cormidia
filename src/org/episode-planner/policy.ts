import {
  runtimeCapabilityProfile,
  type RuntimeCapability,
} from "../../runtime/capabilities.js";
import {
  fixedAssignmentFromRole,
  turnAssignmentKey,
  turnAssignmentsEqual,
} from "../../runtime/assignment.js";
import type { RoleConfig, TurnAssignment } from "../../runtime/types.js";
import { stableHash } from "../../loop/episode-plan.js";
import type {
  AllowedTurnAssignment,
  AssignmentMaterializationPolicy,
  CreatorEpisodeScope,
  CreatorScopePolicy,
  EpisodeIntent,
  EpisodePlanValidationPolicy,
  GovernedWorkflowTemplateRef,
  JsonValue,
  ProposedEpisodeStep,
  SafetyFact,
  SafetyFactKind,
  TriggerDescriptor,
  BudgetCeiling,
} from "../../loop/episode-plan.js";
import type { AppEntry } from "../apps.js";
import {
  resolveAppAssignments,
  type ResolvedAppAssignments,
} from "../execution-assignments.js";

export interface EpisodeIntentFacts {
  episodeId: string;
  app: AppEntry;
  roles: readonly RoleConfig[];
  trigger: TriggerDescriptor;
  goal: string;
  lifecycle: string;
  appStage: string;
  repositoryFacts: Record<string, JsonValue>;
  changeFacts?: Record<string, JsonValue>;
  requestedConstraints: Record<string, JsonValue>;
  hardBudget: BudgetCeiling;
  requiredSafetyFacts: SafetyFact[];
  creatorScope?: CreatorEpisodeScope;
  responsibilityByRole?: Readonly<Record<string, string>>;
  requiredCapabilitiesByRole?: Readonly<Record<string, readonly string[]>>;
  /** Readiness/qualification is gathered outside the plan. Omission means the
   * already-loaded, org-approved config is available; callers with fresher
   * readiness evidence can narrow individual exact tuples to unavailable. */
  assignmentAvailable?: (input: {
    role: RoleConfig;
    candidateId: string;
    assignment: TurnAssignment;
  }) => boolean;
}

export interface EpisodePlanningPolicyOptions {
  intent: EpisodeIntent;
  roles: readonly RoleConfig[];
  /** A persisted accepted plan remains authorized by its immutable intent.
   * This mode is only for resume/revision validation; new plans must join the
   * current org/app configuration before persistence. */
  assignmentAuthority?: "current_config" | "persisted_intent";
  workflowTemplates?: ReadonlyMap<string, readonly ProposedEpisodeStep[]>;
  /**
   * Retained as an input-compatibility field while callers migrate. Adapter
   * capability support is canonical runtime metadata and this value is never
   * used to authorize a plan.
   */
  additionalCapabilitiesByRole?: Readonly<Record<string, readonly string[]>>;
  independentReview?: {
    subjectRoles: readonly string[];
    reviewerRoles: readonly string[];
  };
  /** Workflow-specific realization of semantic safety floors. Omitted kinds
   * retain the core gate/approval vocabulary; an explicit mapping lets a
   * governed protocol name its deterministic equivalent without asking the
   * planner to invent an unexecutable generic gate. */
  safetyFloorMapping?: EpisodeSafetyFloorMapping;
}

export interface EpisodeSafetyFloorMapping {
  gateKinds?: Partial<Record<SafetyFactKind, readonly string[]>>;
  approvalKinds?: Partial<Record<SafetyFactKind, readonly string[]>>;
}

export interface EpisodePlanningPolicy {
  plannerBootAssignment: TurnAssignment;
  materialization: AssignmentMaterializationPolicy;
  creatorScope: CreatorScopePolicy;
  validation: EpisodePlanValidationPolicy;
  metadataFor(role: string, assignment: TurnAssignment): AllowedTurnAssignment | undefined;
}

/** Build the bounded, hashable planner input from deterministic config facts. */
export function buildEpisodeIntent(input: EpisodeIntentFacts): EpisodeIntent {
  const resolved = resolveAppAssignments(input.app, input.roles);
  const roleByName = new Map(input.roles.map((role) => [role.name, role]));
  const allowedAssignments: AllowedTurnAssignment[] = resolved.roles.flatMap((entry) => {
    const role = roleByName.get(entry.role);
    if (role === undefined) throw new Error(`episode intent: unknown resolved role ${entry.role}`);
    return entry.assignments.map((candidate): AllowedTurnAssignment => {
      return {
        candidateId: candidate.candidateId,
        role: entry.role,
        assignment: { ...candidate.assignment },
        providerFamily: candidate.providerFamily,
        // Capability support is an adapter fact. Role requirements are kept
        // separately in availableRoles and must never manufacture support a
        // selected harness does not actually provide.
        capabilities: adapterCapabilities(candidate.assignment.harness),
        qualificationRef:
          candidate.qualificationRef ??
          `configured-role-assignment:${entry.role}`,
        priceRef:
          candidate.pricing.kind === "catalog_ref"
            ? candidate.pricing.ref
            : candidate.pricing.sourceRef,
        maxTurnCostUsd: candidate.maxTurnCostUsd,
        available: input.assignmentAvailable?.({
          role,
          candidateId: candidate.candidateId,
          assignment: candidate.assignment,
        }) ?? true,
      };
    });
  });

  return {
    episodeId: input.episodeId,
    app: input.app.name,
    assignmentMode: resolved.mode,
    trigger: structuredClone(input.trigger),
    goal: input.goal,
    lifecycle: input.lifecycle,
    appStage: input.appStage,
    repositoryFacts: structuredClone(input.repositoryFacts),
    ...(input.changeFacts === undefined
      ? {}
      : { changeFacts: structuredClone(input.changeFacts) }),
    requestedConstraints: structuredClone(input.requestedConstraints),
    hardBudget: structuredClone(input.hardBudget),
    availableRoles: input.roles
      .map((role) => ({
        role: role.name,
        responsibility: input.responsibilityByRole?.[role.name] ?? role.name,
        requiredCapabilities: uniqueSorted(input.requiredCapabilitiesByRole?.[role.name] ?? []),
        expectedOutputs: [...role.outputs].sort(),
        configuredAssignment: fixedAssignmentFromRole(role),
      }))
      .sort((left, right) => left.role.localeCompare(right.role)),
    allowedAssignments: allowedAssignments.sort(compareAllowedAssignments),
    // Creator-declared facts are authoritative scope input. Callers may add
    // independently discovered floors, but they cannot erase a floor by
    // forgetting to copy it into requiredSafetyFacts.
    requiredSafetyFacts: normalizeSafetyFacts([
      ...input.requiredSafetyFacts,
      ...(input.creatorScope?.safetyFacts ?? []),
    ]),
    ...(input.creatorScope === undefined
      ? {}
      : { creatorScope: structuredClone(input.creatorScope) }),
  };
}

/** Join current deterministic policy to one already-hashed EpisodeIntent. */
export function createEpisodePlanningPolicy(
  app: AppEntry,
  options: EpisodePlanningPolicyOptions,
): EpisodePlanningPolicy {
  const persistedAuthority = options.assignmentAuthority === "persisted_intent";
  const resolvedAssignments = persistedAuthority
    ? undefined
    : resolveAppAssignments(app, options.roles);
  if (resolvedAssignments !== undefined) {
    if (resolvedAssignments.mode !== options.intent.assignmentMode) {
      throw new Error(
        `episode planning policy mode changed: intent ${options.intent.assignmentMode}, config ${resolvedAssignments.mode}`,
      );
    }
    assertIntentAssignmentsMatchResolved(options.intent, resolvedAssignments, options.roles);
  }
  const roleByName = new Map(options.roles.map((role) => [role.name, role]));
  const persistedRoleByName = new Map(
    options.intent.availableRoles.map((role) => [role.role, role]),
  );
  const plannerBootAssignment = resolvedAssignments?.plannerBootAssignment ??
    persistedRoleByName.get("planner")?.configuredAssignment;
  if (plannerBootAssignment === undefined) {
    throw new Error("episode planning policy has no persisted Planner boot assignment");
  }
  const intentByRoleAndTuple = new Map<string, AllowedTurnAssignment>();
  for (const candidate of options.intent.allowedAssignments) {
    const key = roleAssignmentKey(candidate.role, candidate.assignment);
    if (intentByRoleAndTuple.has(key)) {
      throw new Error(`episode intent contains duplicate assignment for ${candidate.role}`);
    }
    intentByRoleAndTuple.set(key, structuredClone(candidate));
  }

  const configuredAssignmentFor = (roleName: string): TurnAssignment | undefined => {
    if (persistedAuthority) {
      const assignment = persistedRoleByName.get(roleName)?.configuredAssignment;
      return assignment === undefined ? undefined : structuredClone(assignment);
    }
    const role = roleByName.get(roleName);
    return role === undefined ? undefined : fixedAssignmentFromRole(role);
  };
  const metadataFor = (
    roleName: string,
    assignment: TurnAssignment,
  ): AllowedTurnAssignment | undefined => {
    const metadata = intentByRoleAndTuple.get(roleAssignmentKey(roleName, assignment));
    return metadata === undefined ? undefined : structuredClone(metadata);
  };
  const isAssignmentAllowed = (roleName: string, assignment: TurnAssignment): boolean => {
    const metadata = metadataFor(roleName, assignment);
    // Approval and readiness are separate facts. The durable intent catalog
    // remains valid when an approved candidate is temporarily unavailable;
    // validation rejects only a plan step that actually selects it.
    return metadata !== undefined;
  };
  const materialization: AssignmentMaterializationPolicy = {
    mode: options.intent.assignmentMode,
    configuredAssignmentFor,
    isAssignmentAllowed,
  };
  const templateKey = (ref: GovernedWorkflowTemplateRef): string => `${ref.id}@${ref.version}`;
  const creatorScope: CreatorScopePolicy = {
    ...materialization,
    isKnownRole: (roleName) => roleByName.has(roleName),
    maxTurnCostUsdFor: (roleName, assignment) => metadataFor(roleName, assignment)?.maxTurnCostUsd,
    resolveWorkflowTemplate: (ref) => {
      const steps = options.workflowTemplates?.get(templateKey(ref));
      return steps === undefined ? undefined : structuredClone(steps);
    },
  };
  const requiredOutputs = options.intent.creatorScope?.expectedArtifacts
    .filter((output) => output.required)
    .map((output) => output.id) ?? [];
  const safetyKinds = new Set(options.intent.requiredSafetyFacts.map((fact) => fact.kind));
  const requiredGateKinds = requirementsForSafetyFacts(
    safetyKinds,
    CORE_SAFETY_GATE_KINDS,
    options.safetyFloorMapping?.gateKinds,
  );
  const requiredApprovalKinds = requirementsForSafetyFacts(
    safetyKinds,
    CORE_SAFETY_APPROVAL_KINDS,
    options.safetyFloorMapping?.approvalKinds,
  );
  // workflowClass is descriptive and must not become a safety-control input.
  // The typed incident fact requires the configured SRE role to own provider
  // work on every terminal path through the accepted plan.
  const requiredProviderRoles = safetyKinds.has("incident_response")
    ? [options.roles.find((role) => role.name.toLowerCase() === "sre")?.name ?? "sre"]
    : [];
  const defaultReview = safetyKinds.has("independent_review")
    ? defaultBuilderReviewerPolicy(options.roles)
    : undefined;
  const review = options.independentReview ?? defaultReview;
  const validation: EpisodePlanValidationPolicy = {
    ...materialization,
    isKnownRole: (roleName) => roleByName.has(roleName),
    capabilitiesFor: (roleName, assignment) => {
      const metadata = metadataFor(roleName, assignment);
      if (metadata === undefined) return [];
      return uniqueSorted(metadata.capabilities);
    },
    requiredTerminalOutputIds: requiredOutputs,
    requiredProviderRoles,
    requiredGateKinds,
    requiredApprovalKinds,
    ...(review === undefined
      ? {}
      : {
          independentReview: {
            subjectRoles: [...review.subjectRoles],
            reviewerRoles: [...review.reviewerRoles],
            isIndependent: (subject, reviewer) => {
              const subjectMetadata = metadataFor(subject.role, subject.assignment);
              const reviewerMetadata = metadataFor(reviewer.role, reviewer.assignment);
              return subjectMetadata !== undefined && reviewerMetadata !== undefined &&
                subjectMetadata.providerFamily !== reviewerMetadata.providerFamily;
            },
          },
        }),
  };
  return {
    plannerBootAssignment: structuredClone(plannerBootAssignment),
    materialization,
    creatorScope,
    validation,
    metadataFor,
  };
}

/** Verify caller-owned episode facts without re-resolving mutable assignment
 * defaults. Accepted plans resume from the content-addressed intent/plan; a
 * later role model edit must not rewrite that persisted tuple. */
export function assertEpisodeIntentMatchesInvocationFacts(
  intent: EpisodeIntent,
  input: EpisodeIntentFacts,
): void {
  const expected = {
    episodeId: input.episodeId,
    app: input.app.name,
    trigger: input.trigger,
    goal: input.goal,
    lifecycle: input.lifecycle,
    appStage: input.appStage,
    repositoryFacts: input.repositoryFacts,
    changeFacts: input.changeFacts ?? null,
    requestedConstraints: input.requestedConstraints,
    hardBudget: input.hardBudget,
    requiredSafetyFacts: normalizeSafetyFacts([
      ...input.requiredSafetyFacts,
      ...(input.creatorScope?.safetyFacts ?? []),
    ]),
    creatorScope: input.creatorScope ?? null,
  };
  const persisted = {
    episodeId: intent.episodeId,
    app: intent.app,
    trigger: intent.trigger,
    goal: intent.goal,
    lifecycle: intent.lifecycle,
    appStage: intent.appStage,
    repositoryFacts: intent.repositoryFacts,
    changeFacts: intent.changeFacts ?? null,
    requestedConstraints: intent.requestedConstraints,
    hardBudget: intent.hardBudget,
    requiredSafetyFacts: intent.requiredSafetyFacts,
    creatorScope: intent.creatorScope ?? null,
  };
  if (stableHash(expected) !== stableHash(persisted)) {
    throw new Error(
      `episode ${intent.episodeId} resume facts differ from persisted immutable intent`,
    );
  }
}

function defaultBuilderReviewerPolicy(
  roles: readonly RoleConfig[],
): EpisodePlanningPolicyOptions["independentReview"] {
  const builder = roles.find((role) => role.name.toLowerCase() === "builder");
  const reviewer = roles.find((role) => role.name.toLowerCase() === "reviewer");
  if (builder === undefined || reviewer === undefined) return undefined;
  return {
    subjectRoles: [builder.name],
    reviewerRoles: [reviewer.name],
  };
}

/**
 * An EpisodeIntent is durable input, not a bearer token that may invent its
 * own candidate catalog. Re-join every row to the currently loaded org/app
 * authority before using it for materialization or validation. Availability
 * may only have been narrowed by the caller's readiness probe, so it is the
 * one field intentionally not reconstructed here.
 */
function assertIntentAssignmentsMatchResolved(
  intent: EpisodeIntent,
  resolved: ResolvedAppAssignments,
  roles: readonly RoleConfig[],
): void {
  const roleByName = new Map(roles.map((role) => [role.name, role]));
  const expected = new Map<string, Omit<AllowedTurnAssignment, "available">>();
  for (const entry of resolved.roles) {
    const role = roleByName.get(entry.role);
    if (role === undefined) throw new Error(`assignment policy has unknown role ${entry.role}`);
    for (const candidate of entry.assignments) {
      const row: Omit<AllowedTurnAssignment, "available"> = {
        candidateId: candidate.candidateId,
        role: entry.role,
        assignment: { ...candidate.assignment },
        providerFamily: candidate.providerFamily,
        capabilities: adapterCapabilities(candidate.assignment.harness),
        qualificationRef:
          candidate.qualificationRef ?? `configured-role-assignment:${entry.role}`,
        priceRef:
          candidate.pricing.kind === "catalog_ref"
            ? candidate.pricing.ref
            : candidate.pricing.sourceRef,
        maxTurnCostUsd: candidate.maxTurnCostUsd,
      };
      expected.set(intentAssignmentIdentity(row), row);
    }
  }
  if (intent.allowedAssignments.length !== expected.size) {
    throw new Error(
      `episode intent assignment catalog has ${intent.allowedAssignments.length} rows; ` +
        `current org/app authority resolves ${expected.size}`,
    );
  }
  const seen = new Set<string>();
  for (const actual of intent.allowedAssignments) {
    const identity = intentAssignmentIdentity(actual);
    if (seen.has(identity)) throw new Error(`episode intent duplicates assignment candidate ${identity}`);
    seen.add(identity);
    const authorized = expected.get(identity);
    if (authorized === undefined || stableAssignmentMetadata(actual) !== stableAssignmentMetadata(authorized)) {
      throw new Error(
        `episode intent assignment ${actual.role}/${actual.candidateId} is not an exact projection of current org/app authority`,
      );
    }
  }
}

function intentAssignmentIdentity(
  assignment: Pick<AllowedTurnAssignment, "role" | "candidateId" | "assignment">,
): string {
  return `${assignment.role}\0${assignment.candidateId}\0${turnAssignmentKey(assignment.assignment)}`;
}

function stableAssignmentMetadata(
  assignment: Omit<AllowedTurnAssignment, "available"> | AllowedTurnAssignment,
): string {
  return JSON.stringify({
    candidateId: assignment.candidateId,
    role: assignment.role,
    assignment: assignment.assignment,
    providerFamily: assignment.providerFamily,
    capabilities: [...assignment.capabilities].sort(),
    qualificationRef: assignment.qualificationRef,
    priceRef: assignment.priceRef,
    maxTurnCostUsd: assignment.maxTurnCostUsd,
  });
}

export function providerFamilyFor(
  policy: EpisodePlanningPolicy,
  role: string,
  assignment: TurnAssignment,
): string | undefined {
  return policy.metadataFor(role, assignment)?.providerFamily;
}

function adapterCapabilities(harness: TurnAssignment["harness"]): string[] {
  const profile = runtimeCapabilityProfile(harness);
  return (Object.entries(profile.capabilities) as Array<[
    RuntimeCapability,
    (typeof profile.capabilities)[RuntimeCapability],
  ]>)
    .filter(([, support]) => support !== "unsupported")
    .map(([capability]) => capability)
    .sort();
}

function roleAssignmentKey(role: string, assignment: TurnAssignment): string {
  return `${role}\0${turnAssignmentKey(assignment)}`;
}

function compareAllowedAssignments(
  left: AllowedTurnAssignment,
  right: AllowedTurnAssignment,
): number {
  return left.role.localeCompare(right.role) ||
    left.candidateId.localeCompare(right.candidateId) ||
    turnAssignmentKey(left.assignment).localeCompare(turnAssignmentKey(right.assignment));
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

const CORE_SAFETY_GATE_KINDS: Partial<Record<SafetyFactKind, readonly string[]>> = {
  authentication: ["security"],
  security: ["security"],
  secrets: ["security"],
  privacy: ["security"],
  payments: ["security"],
  user_data: ["data-integrity"],
  data_migration: ["data-integrity", "rollback"],
  production_deployment: ["rollout", "rollback"],
  release: ["release"],
  performance_sensitive: ["performance"],
};

const CORE_SAFETY_APPROVAL_KINDS: Partial<Record<SafetyFactKind, readonly string[]>> = {
  critical_operation: ["critical-operation"],
  production_deployment: ["critical-operation"],
  external_publication: ["external-publication"],
};

function requirementsForSafetyFacts(
  facts: ReadonlySet<SafetyFactKind>,
  defaults: Partial<Record<SafetyFactKind, readonly string[]>>,
  overrides: Partial<Record<SafetyFactKind, readonly string[]>> | undefined,
): string[] {
  const requirements: string[] = [];
  for (const kind of [...facts].sort()) {
    const mapped = overrides !== undefined && Object.hasOwn(overrides, kind)
      ? overrides[kind]
      : defaults[kind];
    for (const value of mapped ?? []) {
      if (value.trim().length === 0) {
        throw new Error(`safety floor mapping for ${kind} contains an empty requirement`);
      }
      requirements.push(value);
    }
  }
  return uniqueSorted(requirements);
}

function normalizeSafetyFacts(facts: readonly SafetyFact[]): SafetyFact[] {
  const byIdentity = new Map<string, SafetyFact>();
  for (const fact of facts) {
    const normalized = {
      kind: fact.kind,
      evidenceRefs: uniqueSorted(fact.evidenceRefs),
    };
    byIdentity.set(`${normalized.kind}\0${normalized.evidenceRefs.join("\0")}`, normalized);
  }
  return [...byIdentity.values()].sort((left, right) =>
    left.kind.localeCompare(right.kind) || left.evidenceRefs.join("\0").localeCompare(right.evidenceRefs.join("\0")));
}

/** Exported for tests and policy joins without exposing mutable catalog rows. */
export function assignmentIsConfiguredForRole(
  role: RoleConfig,
  assignment: TurnAssignment,
): boolean {
  return turnAssignmentsEqual(fixedAssignmentFromRole(role), assignment);
}
