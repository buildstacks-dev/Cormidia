// Historical quick/standard/deep compatibility projection. It is retained for
// old evidence/evals and structured request display only. It never selects
// EpisodePlan steps, assignments, passes, budgets, retries, or a planner-turn
// bypass; the accepted EpisodePlan is the sole live workflow authority.

import type { PlanningDecompositionRequest } from "./planning-decomposition.js";

export type PlanningDepth = "quick" | "standard" | "deep";
export type PlanningLevel = "low" | "medium" | "high";
export type PlanningReversibility = "reversible" | "costly-to-reverse" | "irreversible";
export type ExternalConsequence = "none" | "internal" | "customer-public-production";
export type PlanningWorkLifecycle = "existing-ticket" | "bounded-goal" | "milestone" | "strategy";

export interface PlanningDepthInput {
  goal: string;
  stage: "bootstrap" | "growth" | "mature";
  riskTier?: PlanningLevel;
  ambiguity?: PlanningLevel;
  coupling?: PlanningLevel;
  reversibility?: PlanningReversibility;
  externalConsequence?: ExternalConsequence;
  expectedTickets?: PlanningDecompositionRequest;
  sensitiveDomains?: string[];
  /** What kind of planning decision remains. This affects the legacy product-
   *  planning projection only; it never authorizes a planner-turn bypass. */
  workLifecycle?: PlanningWorkLifecycle;
  /** Attributable current-human minimum. It may raise, never lower, the
   *  lifecycle-selected planning depth. Execution safety floors are separate. */
  minimumDepth?: PlanningDepth;
}
