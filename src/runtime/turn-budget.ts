// Hard, synchronous admission for actions inside one paid provider turn.
// Route/config resolution decides the bounds; this primitive only enforces
// the effective values it is given. A refusal never escalates to approvals.

import type {
  GateDecision,
  GateFn,
  RuntimeKind,
  ToolAction,
  TurnResult,
  TurnUsage,
} from "./types.js";

export const ERROR_TURN_BUDGET_EXHAUSTED = "error_turn_budget_exhausted";

export interface EffectiveTurnBounds {
  provider_turns: number;
  equivalent_cost_usd: number;
  tool_calls: number | null;
  active_time_ms: number;
  model_turns: number | null;
  cost_enforcement:
    | "native_cap_and_progress"
    | "estimated_progress_no_strict_provider_cap"
    | "measured_progress_no_strict_provider_cap";
  /** The full provider-turn exposure reserved before runtime construction.
   * Adapters without a native strict cap cannot promise a smaller monetary
   * increment, so this conservative reservation is their hard admission. */
  equivalent_cost_reserve_usd: number;
}

export type BudgetStopDimension =
  | "equivalent_cost_usd"
  | "tool_calls"
  | "active_time_ms"
  | "provider_turns";

export interface TurnBudgetStop {
  dimension: BudgetStopDimension;
  cap: number;
  observed: number;
  prevented_next_action: string;
  cost_measurement: "measured" | "estimated" | "unavailable";
  stopped_at: string;
}

export function costEnforcementFor(
  runtime: RuntimeKind,
): EffectiveTurnBounds["cost_enforcement"] {
  if (runtime === "claude") return "native_cap_and_progress";
  if (runtime === "codex") return "estimated_progress_no_strict_provider_cap";
  return "measured_progress_no_strict_provider_cap";
}

/** One instance owns one pass. Gate admission is synchronous because provider
 * tool hooks are synchronous; observation is cumulative and monotonic. */
export class HardTurnBudget {
  readonly bounds: EffectiveTurnBounds;
  private readonly abort: (reason: unknown) => void;
  private readonly now: () => Date;
  private admittedToolActions = 0;
  private latestUsage: TurnUsage | undefined;
  private terminalStop: TurnBudgetStop | undefined;

  constructor(input: {
    bounds: EffectiveTurnBounds;
    abort: (reason: unknown) => void;
    now: () => Date;
    initialToolActions?: number;
  }) {
    this.bounds = input.bounds;
    this.abort = input.abort;
    this.now = input.now;
    this.admittedToolActions = input.initialToolActions ?? 0;
  }

  get toolActions(): number {
    return this.admittedToolActions;
  }

  get stop(): TurnBudgetStop | undefined {
    return this.terminalStop === undefined ? undefined : { ...this.terminalStop };
  }

  observeUsage(usage: TurnUsage): TurnBudgetStop | undefined {
    this.latestUsage = usage;
    if (
      this.terminalStop === undefined
      && Number.isFinite(usage.costUsd)
      && usage.costUsd >= this.bounds.equivalent_cost_usd
    ) {
      return this.stopNow({
        dimension: "equivalent_cost_usd",
        cap: this.bounds.equivalent_cost_usd,
        observed: usage.costUsd,
        preventedNextAction: "provider_continuation",
      });
    }
    return this.stop;
  }

  stopActiveTime(observedMs: number): TurnBudgetStop {
    return this.stopNow({
      dimension: "active_time_ms",
      cap: this.bounds.active_time_ms,
      observed: observedMs,
      preventedNextAction: "provider_continuation",
    });
  }

  admitTool(action: ToolAction, delegate: GateFn): GateDecision {
    if (this.terminalStop !== undefined) return denial(this.terminalStop);
    if (
      this.bounds.tool_calls !== null
      && this.admittedToolActions >= this.bounds.tool_calls
    ) {
      return denial(this.stopNow({
        dimension: "tool_calls",
        cap: this.bounds.tool_calls,
        observed: this.admittedToolActions,
        preventedNextAction: action.tool,
      }));
    }

    // Budget admission runs before the safety gate. A budget refusal is a
    // terminal local stop, not a critical-operation request, and must not mint
    // an approval item for an action that cannot execute. An admitted action
    // still traverses the unchanged safety gate exactly once.
    const decision = delegate(action);
    if (decision.allow) this.admittedToolActions += 1;
    return decision;
  }

  normalizeResult(result: TurnResult): TurnResult {
    if (this.terminalStop === undefined) return result;
    const stop = this.terminalStop;
    return {
      ...result,
      status: "failed",
      errorCode: ERROR_TURN_BUDGET_EXHAUSTED,
      summary:
        `Hard turn budget stopped ${stop.dimension}: cap=${stop.cap}, observed=${stop.observed}, ` +
        `prevented_next_action=${stop.prevented_next_action}; partial usage retained.`,
    };
  }

  private stopNow(input: {
    dimension: BudgetStopDimension;
    cap: number;
    observed: number;
    preventedNextAction: string;
  }): TurnBudgetStop {
    if (this.terminalStop !== undefined) return this.terminalStop;
    const stop: TurnBudgetStop = {
      dimension: input.dimension,
      cap: input.cap,
      observed: input.observed,
      prevented_next_action: input.preventedNextAction,
      cost_measurement: costMeasurement(this.latestUsage),
      stopped_at: this.now().toISOString(),
    };
    this.terminalStop = stop;
    this.abort({
      status: "failed",
      errorCode: ERROR_TURN_BUDGET_EXHAUSTED,
      reason:
        `hard turn budget exhausted (${stop.dimension}: ${stop.observed}/${stop.cap}); ` +
        `prevented ${stop.prevented_next_action}`,
    });
    return stop;
  }
}

function denial(stop: TurnBudgetStop): GateDecision {
  return {
    allow: false,
    escalate: false,
    reason:
      `hard turn budget exhausted (${stop.dimension}: ${stop.observed}/${stop.cap}); ` +
      `prevented ${stop.prevented_next_action}`,
  };
}

function costMeasurement(
  usage: TurnUsage | undefined,
): TurnBudgetStop["cost_measurement"] {
  if (usage === undefined || usage.quality === "unavailable") return "unavailable";
  return usage.costEstimated === true || usage.quality === "estimated"
    ? "estimated"
    : "measured";
}
