// Historical quick/standard/deep compatibility projection. It is retained for
// old evidence/evals and structured request display only. It never selects
// EpisodePlan steps, assignments, passes, budgets, retries, or a planner-turn
// bypass; the accepted EpisodePlan is the sole live workflow authority.

import { decideExecutionRoute } from "../loop/route-policy.js";
import type { AdmissionFactor } from "../loop/efficiency.js";

export const PLANNING_DEPTH_POLICY_VERSION = "planning-depth/v2";

export type PlanningDepth = "quick" | "standard" | "deep";
export type PlanningLevel = "low" | "medium" | "high";
export type PlanningReversibility = "reversible" | "costly-to-reverse" | "irreversible";
export type ExternalConsequence = "none" | "internal" | "customer-public-production";
export type ExpectedTicketBand = "1-2" | "3-6" | "7+";
export type PlanningWorkLifecycle = "existing-ticket" | "bounded-goal" | "milestone" | "strategy";
/** `direct-execution` remains readable for historical planning records only.
 * Current episodes may skip the dedicated planner exclusively through the
 * explicit CreatorEpisodeScope contract in episode-plan.ts. */
export type PlanningDisposition = "direct-execution" | "shape-ticket" | "plan-milestone" | "plan-strategy";

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

export interface PlanningDepthDecision {
  policyVersion: typeof PLANNING_DEPTH_POLICY_VERSION;
  disposition: PlanningDisposition;
  workLifecycle: PlanningWorkLifecycle;
  /** Planning pass-set depth. This is deliberately distinct from the episode
   *  execution route: a sensitive but already-clear change may need deep
   *  execution safeguards without buying competing product strategy passes. */
  depth: PlanningDepth;
  executionRoute: PlanningDepth;
  riskTier: PlanningLevel;
  factors: {
    ambiguity: PlanningLevel;
    coupling: PlanningLevel;
    reversibility: PlanningReversibility;
    externalConsequence: ExternalConsequence;
    expectedTickets: ExpectedTicketBand;
    sensitiveDomains: string[];
    workLifecycle: PlanningWorkLifecycle;
    minimumDepth?: PlanningDepth;
  };
  executionFactors: AdmissionFactor[];
  executionDecisionFactors: string[];
  decisionFactors: string[];
}

const DEPTH_RANK: Record<PlanningDepth, number> = { quick: 0, standard: 1, deep: 2 };
export function decidePlanningDepth(input: PlanningDepthInput): PlanningDepthDecision {
  // `goal` is deliberately excluded from classification. It is product data,
  // not an action/risk declaration: “write an auth guide” and “execute a
  // credential migration” may share every keyword and still require opposite
  // routes. Callers provide structured factors; stage-aware defaults fill only
  // omitted factors.
  const sensitiveDomains = [...new Set(input.sensitiveDomains ?? [])].sort();
  const riskTier = input.riskTier ?? (input.stage === "bootstrap" ? "low" : "medium");
  const ambiguity = input.ambiguity ?? (input.stage === "bootstrap" ? "low" : "medium");
  const coupling = input.coupling ?? (input.stage === "bootstrap" ? "low" : "medium");
  const reversibility = input.reversibility ?? "reversible";
  const externalConsequence = input.externalConsequence ?? "none";
  const expectedTickets = input.expectedTickets ?? (input.stage === "bootstrap" ? "1-2" : "3-6");
  const workLifecycle = input.workLifecycle ?? defaultWorkLifecycle(input.stage, expectedTickets);
  const route = decideExecutionRoute({
    blastRadius: riskTier,
    reversibility: reversibility === "costly-to-reverse" ? "difficult" : reversibility,
    sensitiveDomains,
    uncertainty: ambiguity,
    componentCount: coupling === "high" || expectedTickets === "7+" ? 7 : coupling === "medium" || expectedTickets === "3-6" ? 3 : 1,
    externalSystemCount: coupling === "high" ? 3 : 0,
    releaseConsequence:
      externalConsequence === "customer-public-production" ? "production" : externalConsequence,
    novelty: "familiar",
    evidenceQuality: "high",
  });
  let depth = planningDepthFor({ stage: input.stage, workLifecycle, ambiguity, reversibility });
  let humanRaisedDepth = false;

  if (input.minimumDepth !== undefined && DEPTH_RANK[input.minimumDepth] > DEPTH_RANK[depth]) {
    depth = input.minimumDepth;
    humanRaisedDepth = true;
  }

  const decisionFactors = planningDecisionFactors({ workLifecycle, ambiguity, reversibility, depth });
  if (humanRaisedDepth) decisionFactors.push(`human minimum depth raised route to ${input.minimumDepth}`);
  const disposition = planningDisposition(workLifecycle, depth);

  return {
    policyVersion: PLANNING_DEPTH_POLICY_VERSION,
    disposition,
    workLifecycle,
    depth,
    executionRoute: route.route,
    riskTier,
    factors: {
      ambiguity,
      coupling,
      reversibility,
      externalConsequence,
      expectedTickets,
      sensitiveDomains,
      workLifecycle,
      ...(input.minimumDepth !== undefined ? { minimumDepth: input.minimumDepth } : {}),
    },
    executionFactors: route.factors,
    executionDecisionFactors: [...route.decisionRules],
    decisionFactors,
  };
}

function defaultWorkLifecycle(
  stage: PlanningDepthInput["stage"],
  expectedTickets: ExpectedTicketBand,
): PlanningWorkLifecycle {
  if (stage === "bootstrap") return "milestone";
  return expectedTickets === "1-2" ? "bounded-goal" : "milestone";
}

function planningDepthFor(input: {
  stage: PlanningDepthInput["stage"];
  workLifecycle: PlanningWorkLifecycle;
  ambiguity: PlanningLevel;
  reversibility: PlanningReversibility;
}): PlanningDepth {
  if (input.stage === "bootstrap") return "quick";
  if (
    input.workLifecycle === "strategy" ||
    input.ambiguity === "high" ||
    input.reversibility === "costly-to-reverse" ||
    input.reversibility === "irreversible"
  ) {
    return "deep";
  }
  if (input.workLifecycle === "existing-ticket") return "quick";
  return input.workLifecycle === "milestone" ? "standard" : "quick";
}

function planningDisposition(workLifecycle: PlanningWorkLifecycle, depth: PlanningDepth): PlanningDisposition {
  if (depth === "deep") return "plan-strategy";
  return workLifecycle === "milestone" ? "plan-milestone" : "shape-ticket";
}

function planningDecisionFactors(input: {
  workLifecycle: PlanningWorkLifecycle;
  ambiguity: PlanningLevel;
  reversibility: PlanningReversibility;
  depth: PlanningDepth;
}): string[] {
  if (input.workLifecycle === "existing-ticket" && input.depth === "quick") {
    return [
      "existing-ticket lifecycle keeps product shaping minimal; planner bypass still requires an explicit validated creator scope",
    ];
  }
  const factors = [`${input.workLifecycle} lifecycle selects ${input.depth} planning`];
  if (input.ambiguity === "high") factors.push("high ambiguity earns competing product perspectives");
  if (input.reversibility === "costly-to-reverse" || input.reversibility === "irreversible") {
    factors.push(`${input.reversibility} decision earns competing product perspectives`);
  }
  return factors;
}
