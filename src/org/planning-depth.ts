// Historical quick/standard/deep compatibility projection. It is retained for
// old evidence/evals and structured request display only. It never selects
// EpisodePlan steps, assignments, passes, budgets, retries, or a planner-turn
// bypass; the accepted EpisodePlan is the sole live workflow authority.

export type PlanningDepth = "quick" | "standard" | "deep";
export type PlanningLevel = "low" | "medium" | "high";
export type PlanningReversibility = "reversible" | "costly-to-reverse" | "irreversible";
export type ExternalConsequence = "none" | "internal" | "customer-public-production";
export type ExpectedTicketBand = "1-2" | "3-6" | "7+";
export type PlanningWorkLifecycle = "existing-ticket" | "bounded-goal" | "milestone" | "strategy";

/** The ticket-count range each requested band actually covers. This is what
 *  makes the token-free planning preview able to say whether the requested
 *  decomposition can possibly fit the stage ticket budget BEFORE a provider
 *  turn is spent (ENH-011). `max: null` is the open-ended `7+` band. */
export function expectedTicketBandRange(band: ExpectedTicketBand): { min: number; max: number | null } {
  if (band === "1-2") return { min: 1, max: 2 };
  if (band === "3-6") return { min: 3, max: 6 };
  return { min: 7, max: null };
}

export interface PlanningDepthInput {
  goal: string;
  stage: "bootstrap" | "growth" | "mature";
  riskTier?: PlanningLevel;
  ambiguity?: PlanningLevel;
  coupling?: PlanningLevel;
  reversibility?: PlanningReversibility;
  externalConsequence?: ExternalConsequence;
  expectedTickets?: ExpectedTicketBand;
  sensitiveDomains?: string[];
  /** What kind of planning decision remains. This affects the legacy product-
   *  planning projection only; it never authorizes a planner-turn bypass. */
  workLifecycle?: PlanningWorkLifecycle;
  /** Attributable current-human minimum. It may raise, never lower, the
   *  lifecycle-selected planning depth. Execution safety floors are separate. */
  minimumDepth?: PlanningDepth;
}
