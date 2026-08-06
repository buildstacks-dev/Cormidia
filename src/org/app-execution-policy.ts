import type { BudgetCeiling } from "../loop/episode-plan.js";
import { ROUTE_EXECUTION_BOUNDS, type RouteExecutionBounds } from "../loop/route-policy.js";
import type { TicketTier } from "../loop/pipelines.js";
import type { RoleConfig } from "../runtime/types.js";
import {
  CLAUDE_PERMISSION_MODES,
  CODEX_PERMISSION_MODES,
  SHIPPED_PROVIDER_PERMISSION_MODES,
  type ClaudePermissionMode,
  type CodexPermissionMode,
  type ProviderPermissionModes,
} from "../runtime/permission-mode.js";

export type AppEpisodeKind = "generic" | "ticket";

export interface AppPerTurnLimits {
  /** Null inherits the role/assignment ceiling. A number is an app-level
   * narrowing and therefore becomes the soft ring when episode headroom is
   * greater. */
  equivalentCostUsd: number | null;
  activeTimeMs: number | null;
  toolCalls: number | null;
  modelTurns: number | null;
}

export interface AppEpisodeHardCeiling {
  maxProviderTurns: number;
  /** Null means the current app-ledger remainder remains the cost ceiling. */
  maxEquivalentCostUsd: number | null;
  maxActiveTimeMs: number;
  maxHumanDecisions: number;
}

export interface AppExecutionLimits {
  perTurn: AppPerTurnLimits;
  genericEpisode: AppEpisodeHardCeiling;
  ticketEpisode: AppEpisodeHardCeiling;
  routeExecution: Record<TicketTier, RouteExecutionBounds>;
}

export interface AppRuntimePolicy {
  permissionModes: ProviderPermissionModes;
  limits: AppExecutionLimits;
}

const SHIPPED_GENERIC_EPISODE: Readonly<AppEpisodeHardCeiling> = {
  maxProviderTurns: 8,
  maxEquivalentCostUsd: null,
  maxActiveTimeMs: 60 * 60_000,
  maxHumanDecisions: 2,
};

const SHIPPED_TICKET_EPISODE: Readonly<AppEpisodeHardCeiling> = {
  maxProviderTurns: 12,
  maxEquivalentCostUsd: null,
  maxActiveTimeMs: 2 * 60 * 60_000,
  maxHumanDecisions: 2,
};

export function shippedAppRuntimePolicy(): AppRuntimePolicy {
  return {
    permissionModes: { ...SHIPPED_PROVIDER_PERMISSION_MODES },
    limits: {
      perTurn: {
        equivalentCostUsd: null,
        activeTimeMs: null,
        toolCalls: null,
        modelTurns: null,
      },
      genericEpisode: { ...SHIPPED_GENERIC_EPISODE },
      ticketEpisode: { ...SHIPPED_TICKET_EPISODE },
      routeExecution: cloneRouteBounds(ROUTE_EXECUTION_BOUNDS),
    },
  };
}

export function parseAppRuntimePolicy(
  input: {
    permissionModes?: unknown;
    limits?: unknown;
  },
  err: (message: string) => Error,
): AppRuntimePolicy {
  const defaults = shippedAppRuntimePolicy();
  const policy: AppRuntimePolicy = {
    permissionModes: parsePermissionModes(input.permissionModes, defaults.permissionModes, err),
    limits: parseExecutionLimits(input.limits, defaults.limits, err),
  };
  assertPolicyMonotonic(policy, err);
  return policy;
}

export function appRuntimePolicyYaml(policy: AppRuntimePolicy): Record<string, unknown> {
  return {
    permission_modes: {
      codex: policy.permissionModes.codex,
      claude: policy.permissionModes.claude,
    },
    limits: {
      per_turn: {
        equivalent_cost_usd: policy.limits.perTurn.equivalentCostUsd,
        active_time_ms: policy.limits.perTurn.activeTimeMs,
        tool_calls: policy.limits.perTurn.toolCalls,
        model_turns: policy.limits.perTurn.modelTurns,
      },
      generic_episode: episodeYaml(policy.limits.genericEpisode),
      ticket_episode: episodeYaml(policy.limits.ticketEpisode),
      route_execution: Object.fromEntries(
        (["quick", "standard", "deep"] as const).map((route) => [
          route,
          routeBoundsYaml(policy.limits.routeExecution[route]),
        ]),
      ),
    },
  };
}

/** Revalidate an already-camelized in-memory policy at the same boundary as
 * YAML. Production entries normally arrive through parseAppRuntimePolicy;
 * this keeps programmatic registrations and test/embedding callers from
 * smuggling an invalid typed cast into a paid turn. */
export function normalizeAppRuntimePolicy(policy: AppRuntimePolicy, err: (message: string) => Error): AppRuntimePolicy {
  let yaml: Record<string, unknown>;
  try {
    yaml = appRuntimePolicyYaml(policy);
  } catch (error) {
    throw err(`runtimePolicy is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
  return parseAppRuntimePolicy(
    {
      permissionModes: yaml["permission_modes"],
      limits: yaml["limits"],
    },
    err,
  );
}

/** Apply app-scoped permission and per-turn cost policy to ephemeral role
 * views. The committed roles.yaml bytes remain the org authority; app policy
 * can only narrow cost and select a non-bypass provider convenience mode. */
export function resolveAppRoles(roles: readonly RoleConfig[], policy: AppRuntimePolicy): RoleConfig[] {
  return roles.map((role) => ({
    ...role,
    maxTurnBudgetUsd:
      policy.limits.perTurn.equivalentCostUsd === null
        ? role.maxTurnBudgetUsd
        : Math.min(role.maxTurnBudgetUsd, policy.limits.perTurn.equivalentCostUsd),
    permissionModes: { ...policy.permissionModes },
    turnExecutionLimits: {
      activeTimeMs: policy.limits.perTurn.activeTimeMs,
      toolCalls: policy.limits.perTurn.toolCalls,
      modelTurns: policy.limits.perTurn.modelTurns,
    },
    routeExecutionLimits: cloneRouteBounds(policy.limits.routeExecution),
  }));
}

export function effectiveEpisodeHardCeiling(
  policy: AppRuntimePolicy,
  kind: AppEpisodeKind,
  constraints: Pick<BudgetCeiling, "maxEquivalentCostUsd"> & Partial<BudgetCeiling>,
): BudgetCeiling {
  const configured = kind === "ticket" ? policy.limits.ticketEpisode : policy.limits.genericEpisode;
  const cost =
    configured.maxEquivalentCostUsd === null
      ? constraints.maxEquivalentCostUsd
      : Math.min(constraints.maxEquivalentCostUsd, configured.maxEquivalentCostUsd);
  return {
    maxProviderTurns: Math.min(
      constraints.maxProviderTurns ?? configured.maxProviderTurns,
      configured.maxProviderTurns,
    ),
    maxEquivalentCostUsd: cost,
    ...(constraints.maxMechanicalOverheadUsd === undefined
      ? {}
      : { maxMechanicalOverheadUsd: Math.min(constraints.maxMechanicalOverheadUsd, cost) }),
    maxActiveTimeMs: Math.min(constraints.maxActiveTimeMs ?? configured.maxActiveTimeMs, configured.maxActiveTimeMs),
    maxHumanDecisions: Math.min(
      constraints.maxHumanDecisions ?? configured.maxHumanDecisions,
      configured.maxHumanDecisions,
    ),
  };
}

function parsePermissionModes(
  raw: unknown,
  defaults: ProviderPermissionModes,
  err: (message: string) => Error,
): ProviderPermissionModes {
  if (raw === undefined) return { ...defaults };
  const spec = mapping(raw, "execution.permission_modes", err);
  assertOnlyKeys(spec, ["codex", "claude"], "execution.permission_modes", err);
  const codex = spec["codex"] ?? defaults.codex;
  const claude = spec["claude"] ?? defaults.claude;
  if (typeof codex !== "string" || !CODEX_PERMISSION_MODES.includes(codex as CodexPermissionMode)) {
    throw err(
      `execution.permission_modes.codex must be one of ${CODEX_PERMISSION_MODES.join(" | ")}; ` +
        "approval/sandbox bypass modes are unsupported",
    );
  }
  if (typeof claude !== "string" || !CLAUDE_PERMISSION_MODES.includes(claude as ClaudePermissionMode)) {
    throw err(
      `execution.permission_modes.claude must be one of ${CLAUDE_PERMISSION_MODES.join(" | ")}; ` +
        "bypassPermissions is unsupported",
    );
  }
  return { codex: codex as CodexPermissionMode, claude: claude as ClaudePermissionMode };
}

function parseExecutionLimits(
  raw: unknown,
  defaults: AppExecutionLimits,
  err: (message: string) => Error,
): AppExecutionLimits {
  if (raw === undefined) return structuredClone(defaults);
  const spec = mapping(raw, "execution.limits", err);
  assertOnlyKeys(spec, ["per_turn", "generic_episode", "ticket_episode", "route_execution"], "execution.limits", err);
  return {
    perTurn: parsePerTurn(spec["per_turn"], defaults.perTurn, err),
    genericEpisode: parseEpisode(spec["generic_episode"], defaults.genericEpisode, "generic_episode", err),
    ticketEpisode: parseEpisode(spec["ticket_episode"], defaults.ticketEpisode, "ticket_episode", err),
    routeExecution: parseRouteExecution(spec["route_execution"], defaults.routeExecution, err),
  };
}

function parsePerTurn(raw: unknown, defaults: AppPerTurnLimits, err: (message: string) => Error): AppPerTurnLimits {
  if (raw === undefined) return { ...defaults };
  const spec = mapping(raw, "execution.limits.per_turn", err);
  assertOnlyKeys(
    spec,
    ["equivalent_cost_usd", "active_time_ms", "tool_calls", "model_turns"],
    "execution.limits.per_turn",
    err,
  );
  return {
    equivalentCostUsd: nullablePositive(
      spec["equivalent_cost_usd"],
      defaults.equivalentCostUsd,
      "execution.limits.per_turn.equivalent_cost_usd",
      err,
    ),
    activeTimeMs: nullablePositiveInteger(
      spec["active_time_ms"],
      defaults.activeTimeMs,
      "execution.limits.per_turn.active_time_ms",
      err,
    ),
    toolCalls: nullablePositiveInteger(
      spec["tool_calls"],
      defaults.toolCalls,
      "execution.limits.per_turn.tool_calls",
      err,
    ),
    modelTurns: nullablePositiveInteger(
      spec["model_turns"],
      defaults.modelTurns,
      "execution.limits.per_turn.model_turns",
      err,
    ),
  };
}

function parseEpisode(
  raw: unknown,
  defaults: AppEpisodeHardCeiling,
  field: string,
  err: (message: string) => Error,
): AppEpisodeHardCeiling {
  if (raw === undefined) return { ...defaults };
  const prefix = `execution.limits.${field}`;
  const spec = mapping(raw, prefix, err);
  assertOnlyKeys(spec, ["provider_turns", "equivalent_cost_usd", "active_time_ms", "human_decisions"], prefix, err);
  return {
    maxProviderTurns: positiveInteger(
      spec["provider_turns"],
      defaults.maxProviderTurns,
      `${prefix}.provider_turns`,
      err,
    ),
    maxEquivalentCostUsd: nullablePositive(
      spec["equivalent_cost_usd"],
      defaults.maxEquivalentCostUsd,
      `${prefix}.equivalent_cost_usd`,
      err,
    ),
    maxActiveTimeMs: positiveInteger(spec["active_time_ms"], defaults.maxActiveTimeMs, `${prefix}.active_time_ms`, err),
    maxHumanDecisions: nonNegativeInteger(
      spec["human_decisions"],
      defaults.maxHumanDecisions,
      `${prefix}.human_decisions`,
      err,
    ),
  };
}

function parseRouteExecution(
  raw: unknown,
  defaults: Record<TicketTier, RouteExecutionBounds>,
  err: (message: string) => Error,
): Record<TicketTier, RouteExecutionBounds> {
  if (raw === undefined) return cloneRouteBounds(defaults);
  const spec = mapping(raw, "execution.limits.route_execution", err);
  assertOnlyKeys(spec, ["quick", "standard", "deep"], "execution.limits.route_execution", err);
  return Object.fromEntries(
    (["quick", "standard", "deep"] as const).map((route) => {
      const value = spec[route];
      if (value === undefined) return [route, { ...defaults[route] }];
      const prefix = `execution.limits.route_execution.${route}`;
      const row = mapping(value, prefix, err);
      assertOnlyKeys(
        row,
        ["environment_retries", "tool_calls", "claim_attempts", "repair_attempts", "review_cycles"],
        prefix,
        err,
      );
      return [
        route,
        {
          environmentRetries: nonNegativeInteger(
            row["environment_retries"],
            defaults[route].environmentRetries,
            `${prefix}.environment_retries`,
            err,
          ),
          toolCalls: positiveInteger(row["tool_calls"], defaults[route].toolCalls, `${prefix}.tool_calls`, err),
          claimAttempts: positiveInteger(
            row["claim_attempts"],
            defaults[route].claimAttempts,
            `${prefix}.claim_attempts`,
            err,
          ),
          repairAttempts: nonNegativeInteger(
            row["repair_attempts"],
            defaults[route].repairAttempts,
            `${prefix}.repair_attempts`,
            err,
          ),
          reviewCycles: nonNegativeInteger(
            row["review_cycles"],
            defaults[route].reviewCycles,
            `${prefix}.review_cycles`,
            err,
          ),
        },
      ];
    }),
  ) as Record<TicketTier, RouteExecutionBounds>;
}

function assertPolicyMonotonic(policy: AppRuntimePolicy, err: (message: string) => Error): void {
  const turn = policy.limits.perTurn.equivalentCostUsd;
  for (const [name, ceiling] of [
    ["generic_episode", policy.limits.genericEpisode],
    ["ticket_episode", policy.limits.ticketEpisode],
  ] as const) {
    if (turn !== null && ceiling.maxEquivalentCostUsd !== null && turn > ceiling.maxEquivalentCostUsd) {
      throw err(
        `execution limits are non-monotonic: per_turn.equivalent_cost_usd (${turn}) ` +
          `exceeds ${name}.equivalent_cost_usd (${ceiling.maxEquivalentCostUsd})`,
      );
    }
  }
  for (const [name, ceiling] of [
    ["generic_episode", policy.limits.genericEpisode],
    ["ticket_episode", policy.limits.ticketEpisode],
  ] as const) {
    const active = policy.limits.perTurn.activeTimeMs;
    if (active !== null && active > ceiling.maxActiveTimeMs) {
      throw err(
        `execution limits are non-monotonic: per_turn.active_time_ms (${active}) ` +
          `exceeds ${name}.active_time_ms (${ceiling.maxActiveTimeMs})`,
      );
    }
  }

  const fields = ["environmentRetries", "toolCalls", "claimAttempts", "repairAttempts", "reviewCycles"] as const;
  for (const [narrower, wider] of [
    ["quick", "standard"],
    ["standard", "deep"],
  ] as const) {
    for (const field of fields) {
      const left = policy.limits.routeExecution[narrower][field];
      const right = policy.limits.routeExecution[wider][field];
      if (left > right) {
        throw err(
          `execution limits are non-monotonic: ${wider}.${snake(field)} (${right}) ` +
            `is narrower than ${narrower}.${snake(field)} (${left})`,
        );
      }
    }
  }
}

function mapping(raw: unknown, field: string, err: (message: string) => Error): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw err(`${field} must be a mapping`);
  return raw as Record<string, unknown>;
}

function assertOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  field: string,
  err: (message: string) => Error,
): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) throw err(`${field}: unknown key(s): ${unknown.sort().join(", ")}`);
}

function nullablePositive(
  value: unknown,
  fallback: number | null,
  field: string,
  err: (message: string) => Error,
): number | null {
  if (value === undefined) return fallback;
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw err(`${field} must be null or a positive finite number`);
  }
  return value;
}

function positiveInteger(value: unknown, fallback: number, field: string, err: (message: string) => Error): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || (value as number) <= 0) throw err(`${field} must be a positive integer`);
  return value as number;
}

function nullablePositiveInteger(
  value: unknown,
  fallback: number | null,
  field: string,
  err: (message: string) => Error,
): number | null {
  if (value === undefined) return fallback;
  if (value === null) return null;
  return positiveInteger(value, 1, field, err);
}

function nonNegativeInteger(value: unknown, fallback: number, field: string, err: (message: string) => Error): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw err(`${field} must be a non-negative integer`);
  return value as number;
}

function cloneRouteBounds(
  value: Readonly<Record<TicketTier, RouteExecutionBounds>>,
): Record<TicketTier, RouteExecutionBounds> {
  return {
    quick: { ...value.quick },
    standard: { ...value.standard },
    deep: { ...value.deep },
  };
}

function episodeYaml(value: AppEpisodeHardCeiling): Record<string, unknown> {
  return {
    provider_turns: value.maxProviderTurns,
    equivalent_cost_usd: value.maxEquivalentCostUsd,
    active_time_ms: value.maxActiveTimeMs,
    human_decisions: value.maxHumanDecisions,
  };
}

function routeBoundsYaml(value: RouteExecutionBounds): Record<string, unknown> {
  return {
    environment_retries: value.environmentRetries,
    tool_calls: value.toolCalls,
    claim_attempts: value.claimAttempts,
    repair_attempts: value.repairAttempts,
    review_cycles: value.reviewCycles,
  };
}

function snake(value: string): string {
  return value.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}
