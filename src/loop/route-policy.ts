import type { EfficiencyRoute } from "./efficiency.js";
import type { TicketTier } from "./pipelines.js";

export interface RouteExecutionBounds {
  environmentRetries: number;
  toolCalls: number;
  claimAttempts: number;
  repairAttempts: number;
  reviewCycles: number;
}

export const ROUTE_EXECUTION_BOUNDS: Readonly<Record<TicketTier, RouteExecutionBounds>> = {
  quick: { environmentRetries: 0, toolCalls: 40, claimAttempts: 2, repairAttempts: 1, reviewCycles: 1 },
  standard: { environmentRetries: 1, toolCalls: 100, claimAttempts: 3, repairAttempts: 2, reviewCycles: 2 },
  deep: { environmentRetries: 2, toolCalls: 200, claimAttempts: 3, repairAttempts: 3, reviewCycles: 3 },
};

const ROUTE_RANK: Record<EfficiencyRoute, number> = {
  deterministic: -1,
  quick: 0,
  standard: 1,
  deep: 2,
};

export function assertMonotonicRoute(from: EfficiencyRoute, to: EfficiencyRoute): void {
  if (ROUTE_RANK[to] < ROUTE_RANK[from]) {
    throw new Error(`route reassessment cannot reduce depth (${from} -> ${to})`);
  }
}

export function executionBoundsFor(route: TicketTier): RouteExecutionBounds {
  return ROUTE_EXECUTION_BOUNDS[route];
}
