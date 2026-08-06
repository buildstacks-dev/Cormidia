// Hard, synchronous admission for actions inside one paid provider turn.
// Route/config resolution decides the bounds; this primitive only enforces
// the effective values it is given.
//
// Two rings (epic #236, ratified 2026-08-03). Every stop is hard here — no
// action crosses a cap either way — but the ring decides what the ORCHESTRATOR
// may do next:
//
//   per_turn ("soft" ring)  the per-turn/per-pass bound was tighter than the
//                           episode's remaining allowance, so the episode can
//                           still afford another turn. The turn SUSPENDS and
//                           the org asks the human for the next turn's budget.
//   episode ("hard" ring)   the episode/ticket ceiling itself is what bound.
//                           There is nothing left to grant, so the stop is
//                           terminal and no escalation is offered. Without
//                           this ring, suspend -> grant -> suspend has no
//                           bound.
//
// The ring is derived, never declared: a dimension is `per_turn` only when its
// effective bound is strictly tighter than what the episode still allows.

import type { GateDecision, GateFn, RuntimeKind, ToolAction, TurnResult, TurnUsage } from "./types.js";

export const ERROR_TURN_BUDGET_EXHAUSTED = "error_turn_budget_exhausted";
/** Soft-ring stop: the turn is parked, not returned. Distinct from
 * ERROR_TURN_BUDGET_EXHAUSTED so the orchestrator can tell "ask for more" from
 * "there is no more". Both still contain "budget", so every existing
 * classifier that keys on that substring keeps working. */
export const ERROR_TURN_BUDGET_SUSPENDED = "error_turn_budget_suspended";

/** Which ring a stop belongs to — see the module header. */
export type BudgetRing = "per_turn" | "episode";

/** What the EPISODE still allows on each bounded dimension at the moment this
 * turn was admitted. Compared against the effective per-turn bounds to derive
 * a stop's ring; never enforced here (the episode ledger owns that). */
export interface EpisodeAllowance {
  equivalent_cost_usd: number;
  active_time_ms: number;
  tool_calls: number | null;
  provider_turns: number;
}

/** Cost arithmetic tolerance shared with the episode ledger. A reservation
 * clamped to the episode remainder lands within float noise of it, and that
 * must read as "the episode bound me", not "I had room to spare". */
const COST_RING_TOLERANCE_USD = 1e-9;

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
  /** App-resolved provider convenience policy actually supplied to this
   * harness. It never replaces Cormidia's gate or critical-op approvals. */
  permission_mode: string;
  configuration_ref: string;
}

export type BudgetStopDimension = "equivalent_cost_usd" | "tool_calls" | "active_time_ms" | "provider_turns";

export interface TurnBudgetStop {
  dimension: BudgetStopDimension;
  cap: number;
  observed: number;
  prevented_next_action: string;
  cost_measurement: "measured" | "estimated" | "unavailable";
  stopped_at: string;
  /** Which ring fired. Absent on records written before the rings existed;
   * readers must treat absence as `episode` (the pre-existing behaviour). */
  ring: BudgetRing;
  /** What the episode still allowed on this dimension, so a reader can see
   * WHY the ring is what it is without re-deriving it from the ledger. */
  episode_remaining: number | null;
}

export function costEnforcementFor(runtime: RuntimeKind): EffectiveTurnBounds["cost_enforcement"] {
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
  private readonly episodeAllowance: EpisodeAllowance;
  private admittedToolActions = 0;
  private latestUsage: TurnUsage | undefined;
  private terminalStop: TurnBudgetStop | undefined;

  constructor(input: {
    bounds: EffectiveTurnBounds;
    abort: (reason: unknown) => void;
    now: () => Date;
    initialToolActions?: number;
    /** Omitted only by callers with no episode ledger (deterministic
     * harnesses). Absent allowance means every stop is `episode`: refusing to
     * guess headroom keeps the fail-closed direction, because guessing the
     * other way would offer a human budget the episode cannot honour. */
    episodeAllowance?: EpisodeAllowance;
  }) {
    this.bounds = input.bounds;
    this.abort = input.abort;
    this.now = input.now;
    this.admittedToolActions = input.initialToolActions ?? 0;
    this.episodeAllowance = input.episodeAllowance ?? {
      equivalent_cost_usd: input.bounds.equivalent_cost_usd,
      active_time_ms: input.bounds.active_time_ms,
      tool_calls: input.bounds.tool_calls,
      provider_turns: input.bounds.provider_turns,
    };
  }

  /** True when this stop parks the turn for a budget decision rather than
   * terminalizing it. */
  get suspends(): boolean {
    return this.terminalStop?.ring === "per_turn";
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
      this.terminalStop === undefined &&
      Number.isFinite(usage.costUsd) &&
      usage.costUsd >= this.bounds.equivalent_cost_usd
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
    if (this.bounds.tool_calls !== null && this.admittedToolActions >= this.bounds.tool_calls) {
      return denial(
        this.stopNow({
          dimension: "tool_calls",
          cap: this.bounds.tool_calls,
          observed: this.admittedToolActions,
          preventedNextAction: action.tool,
        }),
      );
    }

    // Budget admission runs before the safety gate. A budget refusal is a
    // terminal local stop, not a critical-operation request, and must not mint
    // an approval item for an action that cannot execute. An admitted action
    // still traverses the unchanged safety gate exactly once.
    const decision = delegate(action);
    if (decision.allow) this.admittedToolActions += 1;
    return decision;
  }

  /** The per-turn ring parks the turn on the SAME transport status a gate
   * escalation uses (`blocked_on_gate`): both are "this turn is waiting on a
   * human decision, its work is preserved", and #236 ratified one pause
   * mechanism with two triggers. The episode ring keeps the pre-existing
   * terminal `failed` shape exactly. Either way `...result` is spread first,
   * so partial usage and the native session handle survive the stop. */
  normalizeResult(result: TurnResult): TurnResult {
    if (this.terminalStop === undefined) return result;
    const stop = this.terminalStop;
    const observed =
      `cap=${stop.cap}, observed=${stop.observed}, ` + `prevented_next_action=${stop.prevented_next_action}`;
    if (stop.ring === "per_turn") {
      return {
        ...result,
        status: "blocked_on_gate",
        errorCode: ERROR_TURN_BUDGET_SUSPENDED,
        summary:
          `Per-turn budget suspended this turn at ${stop.dimension}: ${observed}; ` +
          `episode_remaining=${stop.episode_remaining ?? "unbounded"}. ` +
          "Partial usage and the provider session are retained for resume.",
      };
    }
    return {
      ...result,
      status: "failed",
      errorCode: ERROR_TURN_BUDGET_EXHAUSTED,
      summary: `Hard turn budget stopped ${stop.dimension}: ${observed}; partial usage retained.`,
    };
  }

  /** A dimension is soft only when the per-turn bound is STRICTLY tighter than
   * what the episode still allows — i.e. there is headroom a human could grant.
   * Equality means the episode ceiling is what bound, which is the hard ring. */
  private ringFor(dimension: BudgetStopDimension): {
    ring: BudgetRing;
    episodeRemaining: number | null;
  } {
    if (dimension === "equivalent_cost_usd") {
      const remaining = this.episodeAllowance.equivalent_cost_usd;
      return {
        ring: this.bounds.equivalent_cost_usd < remaining - COST_RING_TOLERANCE_USD ? "per_turn" : "episode",
        episodeRemaining: remaining,
      };
    }
    if (dimension === "active_time_ms") {
      const remaining = this.episodeAllowance.active_time_ms;
      return {
        ring: this.bounds.active_time_ms < remaining ? "per_turn" : "episode",
        episodeRemaining: remaining,
      };
    }
    if (dimension === "tool_calls") {
      const remaining = this.episodeAllowance.tool_calls;
      if (remaining === null || this.bounds.tool_calls === null) {
        return { ring: "episode", episodeRemaining: remaining };
      }
      return {
        ring: this.bounds.tool_calls < remaining ? "per_turn" : "episode",
        episodeRemaining: remaining,
      };
    }
    // provider_turns is an episode dimension by construction: one turn cannot
    // hold a tighter turn count than the episode that authorized it.
    return { ring: "episode", episodeRemaining: this.episodeAllowance.provider_turns };
  }

  private stopNow(input: {
    dimension: BudgetStopDimension;
    cap: number;
    observed: number;
    preventedNextAction: string;
  }): TurnBudgetStop {
    if (this.terminalStop !== undefined) return this.terminalStop;
    const { ring, episodeRemaining } = this.ringFor(input.dimension);
    const stop: TurnBudgetStop = {
      dimension: input.dimension,
      cap: input.cap,
      observed: input.observed,
      prevented_next_action: input.preventedNextAction,
      cost_measurement: costMeasurement(this.latestUsage),
      stopped_at: this.now().toISOString(),
      ring,
      episode_remaining: episodeRemaining,
    };
    this.terminalStop = stop;
    this.abort({
      status: ring === "per_turn" ? "blocked_on_gate" : "failed",
      errorCode: ring === "per_turn" ? ERROR_TURN_BUDGET_SUSPENDED : ERROR_TURN_BUDGET_EXHAUSTED,
      reason:
        `${ring === "per_turn" ? "per-turn budget suspended" : "hard turn budget exhausted"} ` +
        `(${stop.dimension}: ${stop.observed}/${stop.cap}); prevented ${stop.prevented_next_action}`,
    });
    return stop;
  }
}

/** Budget admission never escalates through the SAFETY gate: `escalate: false`
 * is load-bearing (#229). A soft-ring stop does reach the approval queue, but
 * as an orchestrator-raised budget item after the turn is parked — never as a
 * critical-operation request for an action that cannot execute. */
function denial(stop: TurnBudgetStop): GateDecision {
  return {
    allow: false,
    escalate: false,
    reason:
      `${stop.ring === "per_turn" ? "per-turn budget suspended" : "hard turn budget exhausted"} ` +
      `(${stop.dimension}: ${stop.observed}/${stop.cap}); prevented ${stop.prevented_next_action}`,
  };
}

function costMeasurement(usage: TurnUsage | undefined): TurnBudgetStop["cost_measurement"] {
  if (usage === undefined || usage.quality === "unavailable") return "unavailable";
  return usage.costEstimated === true || usage.quality === "estimated" ? "estimated" : "measured";
}
