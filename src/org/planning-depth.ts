// Deterministic adaptive planning-depth policy. Prompt length is deliberately
// absent: a three-word auth migration can be deep, while a long bounded docs
// cleanup can be quick. The router is code-owned/versioned; human-ratified
// prompts and safety gates remain unchanged.

import type { PassConfig } from "../loop/pipelines.js";
import { decideExecutionRoute } from "../loop/route-policy.js";
import type { RoleConfig } from "../runtime/types.js";
import type { TurnRecord } from "../runtime/telemetry.js";

export const PLANNING_DEPTH_POLICY_VERSION = "planning-depth/v1";

export type PlanningDepth = "quick" | "standard" | "deep";
export type PlanningLevel = "low" | "medium" | "high";
export type PlanningReversibility = "reversible" | "costly-to-reverse" | "irreversible";
export type ExternalConsequence = "none" | "internal" | "customer-public-production";
export type ExpectedTicketBand = "1-2" | "3-6" | "7+";

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
  /** Attributable current-human minimum. Hard floors may raise it. */
  minimumDepth?: PlanningDepth;
}

export interface PlanningDepthDecision {
  policyVersion: typeof PLANNING_DEPTH_POLICY_VERSION;
  depth: PlanningDepth;
  riskTier: PlanningLevel;
  factors: {
    ambiguity: PlanningLevel;
    coupling: PlanningLevel;
    reversibility: PlanningReversibility;
    externalConsequence: ExternalConsequence;
    expectedTickets: ExpectedTicketBand;
    sensitiveDomains: string[];
    minimumDepth?: PlanningDepth;
  };
  decisionFactors: string[];
}

export interface PlanningPassRoute {
  pipeline: "plan-bootstrap" | "plan";
  selectedPasses: string[];
  skippedPasses: Array<{ pass: string; reason: string }>;
}

export interface PlanningCostEstimate {
  estimatedCostUsd: number | null;
  upperBoundUsd: number;
  basis: string;
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
  let depth: PlanningDepth = route.route;
  const decisionFactors = [...route.decisionRules];

  if (input.minimumDepth !== undefined && DEPTH_RANK[input.minimumDepth] > DEPTH_RANK[depth]) {
    depth = input.minimumDepth;
    decisionFactors.push(`human minimum depth raised route to ${input.minimumDepth}`);
  } else if (input.minimumDepth !== undefined && DEPTH_RANK[input.minimumDepth] < DEPTH_RANK[depth]) {
    decisionFactors.push(`human ${input.minimumDepth} request could not lower the ${depth} safety floor`);
  }

  return {
    policyVersion: PLANNING_DEPTH_POLICY_VERSION,
    depth,
    riskTier,
    factors: {
      ambiguity,
      coupling,
      reversibility,
      externalConsequence,
      expectedTickets,
      sensitiveDomains,
      ...(input.minimumDepth !== undefined ? { minimumDepth: input.minimumDepth } : {}),
    },
    decisionFactors,
  };
}

export function routePlanningPasses(
  decision: PlanningDepthDecision,
  stage: PlanningDepthInput["stage"],
  availablePipelines: readonly string[],
): PlanningPassRoute {
  const hasBootstrap = availablePipelines.includes("plan-bootstrap");
  if (decision.depth === "quick" && stage === "bootstrap" && hasBootstrap) {
    return { pipeline: "plan-bootstrap", selectedPasses: ["bootstrap-plan"], skippedPasses: [] };
  }
  if (!availablePipelines.includes("plan")) {
    throw new Error(
      `adaptive planning needs pipeline "plan" for ${decision.depth}/${stage}; available: ${availablePipelines.join(", ")}`,
    );
  }
  const selectedPasses =
    decision.depth === "quick"
      ? ["decomposer"]
      : decision.depth === "standard"
        ? ["visionary", "pm-a", "decomposer"]
        : ["visionary", "pm-a", "pm-b", "arbitrator", "decomposer"];
  const all = ["visionary", "pm-a", "pm-b", "arbitrator", "decomposer"];
  return {
    pipeline: "plan",
    selectedPasses,
    skippedPasses: all
      .filter((pass) => !selectedPasses.includes(pass))
      .map((pass) => ({ pass, reason: planningSkipReason(decision.depth, pass) })),
  };
}

export function estimatePlanningCost(input: {
  selectedPasses: readonly PassConfig[];
  roles: Record<string, RoleConfig>;
  history: readonly TurnRecord[];
}): PlanningCostEstimate {
  let total = 0;
  let complete = true;
  const bases: string[] = [];
  let upperBoundUsd = 0;
  for (const pass of input.selectedPasses) {
    const role = input.roles[pass.role];
    if (role === undefined) continue;
    upperBoundUsd += role.maxTurnBudgetUsd;
    const exact = usableCosts(input.history.filter((row) => row.pipeline !== undefined && row.pass === pass.id));
    const comparable = exact.length > 0
      ? exact
      : usableCosts(input.history.filter((row) => row.role === role.name && row.model === (pass.model ?? role.model)));
    if (comparable.length === 0) {
      complete = false;
      bases.push(`${pass.id}: no historical comparable`);
      continue;
    }
    const median = medianOf(comparable);
    total += median;
    bases.push(`${pass.id}: median of ${comparable.length} comparable turn(s)`);
  }
  return {
    estimatedCostUsd: complete ? total : null,
    upperBoundUsd,
    basis: `${bases.join("; ") || "no selected pass history"}; role caps are an upper bound, not expected cost`,
  };
}

function usableCosts(rows: readonly TurnRecord[]): number[] {
  return rows
    .filter((row) => row.usageQuality !== "unavailable" && Number.isFinite(row.costUsd) && row.costUsd >= 0)
    .map((row) => row.costUsd);
}

function medianOf(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function planningSkipReason(depth: PlanningDepth, pass: string): string {
  if (depth === "quick") return "quick route uses one combined planner/decomposer pass";
  if (pass === "pm-b") return "standard route uses one PM perspective; no concrete disagreement trigger was recorded";
  if (pass === "arbitrator") return "standard route has no competing PM outputs to arbitrate";
  return `${pass} is not required by the ${depth} route`;
}
