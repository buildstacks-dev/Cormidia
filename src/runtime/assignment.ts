import {
  hasRuntimeCapability,
  resolvedRuntimeCapabilities,
  runtimeCapabilityProfile,
  validateRuntimeCapabilities,
  type RuntimeCapability,
} from "./capabilities.js";
import type { Effort, RoleConfig, RuntimeKind, TurnAssignment, TurnExecutionFacts, TurnRequest } from "./types.js";

export const TURN_ASSIGNMENT_HARNESSES = [
  "claude",
  "codex",
  "cursor",
  "pi",
  "grok",
  "opencode",
] as const satisfies readonly RuntimeKind[];
export const TURN_ASSIGNMENT_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const satisfies readonly Effort[];

/** Reserved role-local id for the explicit fixed assignment on RoleConfig. */
export const CONFIGURED_ASSIGNMENT_CANDIDATE_ID = "configured";

const CANDIDATE_ID = /^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/;
const PROVIDER_FAMILY = /^[a-z0-9](?:[a-z0-9._/-]{0,126}[a-z0-9])?$/;

export function isAssignmentCandidateId(value: unknown): value is string {
  return typeof value === "string" && CANDIDATE_ID.test(value);
}

export function validateAssignmentCandidateId(value: unknown, context = "assignment candidate id"): string {
  if (!isAssignmentCandidateId(value)) {
    throw new Error(
      `${context} must be a lowercase stable id (1-128 alphanumeric, dot, underscore, or hyphen characters)`,
    );
  }
  return value;
}

export function validateProviderFamily(value: unknown, context = "provider family"): string {
  if (typeof value !== "string" || !PROVIDER_FAMILY.test(value)) {
    throw new Error(`${context} must be a lowercase stable provider identifier`);
  }
  return value;
}

/**
 * Strict structural validation at every config/plan boundary. Unknown fields
 * are rejected so a legacy `runtime` key cannot be mistaken for `harness`.
 */
export function validateTurnAssignment(value: unknown, context = "turn assignment"): TurnAssignment {
  if (!isRecord(value)) throw new Error(`${context} must be a mapping`);

  const unknown = Object.keys(value).filter((key) => key !== "harness" && key !== "model" && key !== "effort");
  if (unknown.length > 0) {
    throw new Error(`${context} has unknown field(s): ${unknown.sort().join(", ")}`);
  }

  const harness = value["harness"];
  if (typeof harness !== "string" || !TURN_ASSIGNMENT_HARNESSES.includes(harness as RuntimeKind)) {
    throw new Error(`${context}.harness must be one of ${TURN_ASSIGNMENT_HARNESSES.join(" | ")}`);
  }

  const model = value["model"];
  if (
    typeof model !== "string" ||
    model.length === 0 ||
    model !== model.trim() ||
    /[\u0000-\u001f\u007f]/u.test(model)
  ) {
    throw new Error(`${context}.model must be a non-empty exact model id without surrounding whitespace`);
  }

  const effort = value["effort"];
  if (typeof effort !== "string" || !TURN_ASSIGNMENT_EFFORTS.includes(effort as Effort)) {
    throw new Error(`${context}.effort must be one of ${TURN_ASSIGNMENT_EFFORTS.join(" | ")}`);
  }
  // `max` exists on Claude natively and on OpenCode as a per-model `variant`
  // (verified 2026-08-07: gpt-5.6-sol/luna/terra publish it, gpt-5.4* do not).
  // Harness-level acceptance here; the OpenCode adapter still refuses the exact
  // model/effort pair before provider construction when the model omits it.
  if (effort === "max" && harness !== "claude" && harness !== "opencode") {
    throw new Error(`${context}.effort max is unsupported by ${harness}; no effort alias is allowed`);
  }

  return { harness: harness as RuntimeKind, model, effort: effort as Effort };
}

export function isTurnAssignment(value: unknown): value is TurnAssignment {
  try {
    validateTurnAssignment(value);
    return true;
  } catch {
    return false;
  }
}

/** Collision-free canonical key used for membership and duplicate checks. */
export function turnAssignmentKey(assignment: TurnAssignment): string {
  const validated = validateTurnAssignment(assignment);
  return JSON.stringify([validated.harness, validated.model, validated.effort]);
}

export function turnAssignmentsEqual(left: TurnAssignment, right: TurnAssignment): boolean {
  return turnAssignmentKey(left) === turnAssignmentKey(right);
}

export function fixedAssignmentFromRole(role: Pick<RoleConfig, "runtime" | "model" | "effort">): TurnAssignment {
  return validateTurnAssignment({
    harness: role.runtime,
    model: role.model,
    effort: role.effort,
  });
}

/**
 * Resolve the tuple an adapter must execute and fail closed on a harness
 * mismatch. The RoleConfig fallback is temporary compatibility for callers
 * not yet migrated to explicit plan assignments; adapters never read role
 * model/effort fields directly.
 */
export function resolveTurnRequestAssignment(
  request: Pick<TurnRequest, "assignment" | "context" | "role">,
  adapterKind: RuntimeKind,
): TurnAssignment {
  const assignment =
    request.assignment === undefined
      ? fixedAssignmentFromRole(request.role)
      : validateTurnAssignment(request.assignment, "turn request assignment");
  if (assignment.harness !== adapterKind) {
    throw new Error(
      `turn request assignment harness ${JSON.stringify(assignment.harness)} does not match ` +
        `${JSON.stringify(adapterKind)} adapter`,
    );
  }

  if (request.context.execution !== undefined) {
    const facts = validateTurnExecutionFacts(request.context.execution);
    if (!turnAssignmentsEqual(facts.assignment, assignment)) {
      throw new Error("turn execution facts assignment does not match the turn request assignment");
    }
    if (facts.role !== request.role.name) {
      throw new Error("turn execution facts role does not match the turn request role");
    }
    const configuredDelegation = validateDelegationAllow(
      request.role.delegation.allow,
      "turn request role delegation.allow",
    );
    if (JSON.stringify(facts.roleDelegation.allow) !== JSON.stringify(configuredDelegation)) {
      throw new Error("turn execution facts delegation does not match the turn request role");
    }
  }
  return assignment;
}

/**
 * Construct the only valid in-turn capability snapshot. Assignment and role
 * identity come from the authorized turn; support tiers and resolved names
 * are always derived from runtimeCapabilityProfile().
 */
export function buildTurnExecutionFacts(
  assignmentValue: TurnAssignment,
  role: Pick<RoleConfig, "name" | "delegation">,
  requiredValues: readonly RuntimeCapability[] = [],
): TurnExecutionFacts {
  const assignment = validateTurnAssignment(assignmentValue);
  const roleName = validateExecutionRole(role.name, "turn execution facts.role");
  const requiredCapabilities = validateRuntimeCapabilities(
    [...requiredValues],
    "turn execution facts.requiredCapabilities",
  );
  const profile = runtimeCapabilityProfile(assignment.harness);
  for (const capability of requiredCapabilities) {
    if (!hasRuntimeCapability(profile, capability)) {
      throw new Error(`${assignment.harness} lacks required capability ${capability}`);
    }
  }
  return {
    role: roleName,
    assignment,
    resolvedCapabilities: resolvedRuntimeCapabilities(assignment.harness),
    requiredCapabilities,
    roleDelegation: {
      allow: validateDelegationAllow(role.delegation.allow, "turn execution facts.roleDelegation.allow"),
    },
  };
}

/** Validate facts before they cross a native prompt/context boundary. */
export function validateTurnExecutionFacts(value: unknown, context = "turn execution facts"): TurnExecutionFacts {
  if (!isRecord(value)) throw new Error(`${context} must be a mapping`);
  const unknown = Object.keys(value).filter(
    (key) =>
      key !== "role" &&
      key !== "assignment" &&
      key !== "resolvedCapabilities" &&
      key !== "requiredCapabilities" &&
      key !== "roleDelegation",
  );
  if (unknown.length > 0) {
    throw new Error(`${context} has unknown field(s): ${unknown.sort().join(", ")}`);
  }

  const role = validateExecutionRole(value["role"], `${context}.role`);
  const assignment = validateTurnAssignment(value["assignment"], `${context}.assignment`);
  const resolvedCapabilities = validateRuntimeCapabilities(
    value["resolvedCapabilities"],
    `${context}.resolvedCapabilities`,
  );
  const canonicalResolved = resolvedRuntimeCapabilities(assignment.harness);
  if (JSON.stringify(resolvedCapabilities) !== JSON.stringify(canonicalResolved)) {
    throw new Error(
      `${context}.resolvedCapabilities must exactly match ${runtimeCapabilityProfile(assignment.harness).ref}`,
    );
  }
  const requiredCapabilities = validateRuntimeCapabilities(
    value["requiredCapabilities"],
    `${context}.requiredCapabilities`,
  );
  for (const capability of requiredCapabilities) {
    if (!resolvedCapabilities.includes(capability)) {
      throw new Error(`${context}.requiredCapabilities includes unsupported ${JSON.stringify(capability)}`);
    }
  }
  const roleDelegation = value["roleDelegation"];
  if (!isRecord(roleDelegation)) {
    throw new Error(`${context}.roleDelegation must be a mapping`);
  }
  const delegationUnknown = Object.keys(roleDelegation).filter((key) => key !== "allow");
  if (delegationUnknown.length > 0) {
    throw new Error(`${context}.roleDelegation has unknown field(s): ${delegationUnknown.sort().join(", ")}`);
  }
  const allow = validateDelegationAllow(roleDelegation["allow"], `${context}.roleDelegation.allow`);
  return {
    role,
    assignment,
    resolvedCapabilities,
    requiredCapabilities,
    roleDelegation: { allow },
  };
}

function validateExecutionRole(value: unknown, context: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9](?:[A-Za-z0-9._/-]{0,126}[A-Za-z0-9])?$/u.test(value)) {
    throw new Error(`${context} must be a stable role identifier`);
  }
  return value;
}

function validateDelegationAllow(value: unknown, context: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${context} must be an array`);
  const allow = value.map((entry, index) => {
    if (typeof entry !== "string" || !/^[a-z0-9](?:[a-z0-9._/-]{0,126}[a-z0-9])?$/u.test(entry)) {
      throw new Error(`${context}[${index}] must be a lowercase stable delegation identifier`);
    }
    return entry;
  });
  const duplicate = allow.find((entry, index) => allow.indexOf(entry) !== index);
  if (duplicate !== undefined) {
    throw new Error(`${context} duplicates ${JSON.stringify(duplicate)}`);
  }
  return allow.sort();
}

/**
 * Provider ownership is not the harness. Native harnesses have one known
 * family. Pi's model namespace is mapped to a known family when possible and
 * otherwise remains pi-namespaced so it cannot accidentally claim a known
 * independent provider.
 */
export function configuredProviderFamily(assignment: TurnAssignment): string {
  const validated = validateTurnAssignment(assignment);
  if (validated.harness === "claude") return "anthropic";
  if (validated.harness === "codex") return "openai";
  // Cursor is a multi-provider harness like pi, but its roster is Cursor's
  // own routed namespace (`auto`, `composer-2.5`, `cursor-grok-4.5-*` are
  // first-party; `claude-*`/`gpt-*` are routed third-party). The vendor
  // relationship that matters for builder != reviewer independence is
  // Anysphere's, so the family stays cursor-namespaced and never claims to be
  // an independent Anthropic or OpenAI turn.
  if (validated.harness === "cursor") return "cursor";
  // Grok Build is a native single-vendor harness: xAI models over xAI's own
  // CLI. Falling through would label it `pi/...` and let it be counted as an
  // independent turn against a pi-hosted xAI model, which is the same vendor.
  if (validated.harness === "grok") return "xai";

  const separator = validated.model.indexOf("/");
  const namespace = (separator === -1 ? validated.model : validated.model.slice(0, separator)).toLowerCase();
  if (namespace === "openai" || namespace === "openai-codex") return "openai";
  if (namespace === "anthropic") return "anthropic";
  if (isAssignmentCandidateId(namespace)) return `pi/${namespace}`;
  return "pi/unknown";
}

/**
 * Bind provider-ownership evidence to the exact atomic assignment. This is
 * especially important for pi: the harness can execute models from multiple
 * providers, so a free-form family label would let a candidate manufacture
 * (or evade) cross-provider independence.
 */
export function validateAssignmentProviderFamily(
  assignmentValue: TurnAssignment,
  providerFamilyValue: unknown,
  context = "assignment provider family",
): string {
  const assignment = validateTurnAssignment(assignmentValue, `${context} assignment`);
  const providerFamily = validateProviderFamily(providerFamilyValue, context);
  const expected = configuredProviderFamily(assignment);
  if (providerFamily !== expected) {
    throw new Error(
      `${context} must be ${JSON.stringify(expected)} for ` +
        `${assignment.harness} model ${JSON.stringify(assignment.model)}`,
    );
  }
  return providerFamily;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
