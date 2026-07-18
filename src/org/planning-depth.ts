// Deterministic adaptive planning-depth policy. Prompt length is deliberately
// absent: a three-word auth migration can be deep, while a long bounded docs
// cleanup can be quick. The router is code-owned/versioned; human-ratified
// prompts and safety gates remain unchanged.

import type { PassConfig } from "../loop/pipelines.js";
import { decideExecutionRoute } from "../loop/route-policy.js";
import type { AdmissionFactor } from "../loop/efficiency.js";
import type { RoleConfig } from "../runtime/types.js";
import type { TurnRecord } from "../runtime/telemetry.js";

export const PLANNING_DEPTH_POLICY_VERSION = "planning-depth/v2";

export type PlanningDepth = "quick" | "standard" | "deep";
export type PlanningLevel = "low" | "medium" | "high";
export type PlanningReversibility = "reversible" | "costly-to-reverse" | "irreversible";
export type ExternalConsequence = "none" | "internal" | "customer-public-production";
export type ExpectedTicketBand = "1-2" | "3-6" | "7+";
export type PlanningWorkLifecycle = "existing-ticket" | "bounded-goal" | "milestone" | "strategy";
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
  /** What kind of planning decision remains. Existing scoped tickets need no
   *  pre-ticket provider pass; strategies may earn competing perspectives. */
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

export interface PlanningPassRationale {
  pass: string;
  expectedRiskReduction: string;
  evidence: string;
}

export type PlanningPassRoute = {
  disposition: Exclude<PlanningDisposition, "direct-execution">;
  pipeline: "plan-bootstrap" | "plan";
  selectedPasses: string[];
  skippedPasses: Array<{ pass: string; reason: string }>;
  passRationales: PlanningPassRationale[];
} | {
  disposition: "direct-execution";
  pipeline: null;
  selectedPasses: [];
  skippedPasses: Array<{ pass: string; reason: string }>;
  passRationales: [];
};

export interface PlanningOutcomeMeasurement {
  status: "measured" | "unavailable";
  selectedPassCount: number;
  comparableEpisodes: number;
  lowerPassEpisodes: number;
  comparableDownstreamFailureRate: number | null;
  lowerPassDownstreamFailureRate: number | null;
  observedFailureRateDelta: number | null;
  basis: string;
}

export interface PlanningCostEstimate {
  estimatedCostUsd: number | null;
  upperBoundUsd: number;
  basis: string;
  outcomeMeasurement: PlanningOutcomeMeasurement;
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

export function routePlanningPasses(
  decision: PlanningDepthDecision,
  stage: PlanningDepthInput["stage"],
  availablePipelines: readonly string[],
): PlanningPassRoute {
  const all = ["visionary", "pm-a", "pm-b", "arbitrator", "decomposer"];
  if (decision.disposition === "direct-execution") {
    return {
      disposition: "direct-execution",
      pipeline: null,
      selectedPasses: [],
      skippedPasses: all.map((pass) => ({
        pass,
        reason: "an already-scoped ticket goes directly to the ordinary build/review loop",
      })),
      passRationales: [],
    };
  }
  const hasBootstrap = availablePipelines.includes("plan-bootstrap");
  if (decision.depth === "quick" && stage === "bootstrap" && hasBootstrap) {
    return {
      disposition: decision.disposition,
      pipeline: "plan-bootstrap",
      selectedPasses: ["bootstrap-plan"],
      skippedPasses: [],
      passRationales: passRationales(decision, ["bootstrap-plan"]),
    };
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
  return {
    disposition: decision.disposition,
    pipeline: "plan",
    selectedPasses,
    skippedPasses: all
      .filter((pass) => !selectedPasses.includes(pass))
      .map((pass) => ({ pass, reason: planningSkipReason(decision.depth, pass) })),
    passRationales: passRationales(decision, selectedPasses),
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
    const exact = usableCosts(
      input.history.filter(
        (row) => (row.pipeline === "plan" || row.pipeline === "plan-bootstrap") && row.pass === pass.id,
      ),
    );
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
    outcomeMeasurement: measureDownstreamOutcomes(input.selectedPasses.length, input.history),
  };
}

export function zeroPlanningCostEstimate(history: readonly TurnRecord[]): PlanningCostEstimate {
  return {
    estimatedCostUsd: 0,
    upperBoundUsd: 0,
    basis: "direct execution selects no planning provider passes",
    outcomeMeasurement: measureDownstreamOutcomes(0, history),
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
  if (workLifecycle === "existing-ticket" && depth === "quick") return "direct-execution";
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
    return ["existing scoped ticket bypasses pre-ticket planning and enters build/review"];
  }
  const factors = [`${input.workLifecycle} lifecycle selects ${input.depth} planning`];
  if (input.ambiguity === "high") factors.push("high ambiguity earns competing product perspectives");
  if (input.reversibility === "costly-to-reverse" || input.reversibility === "irreversible") {
    factors.push(`${input.reversibility} decision earns competing product perspectives`);
  }
  return factors;
}

function passRationales(
  decision: PlanningDepthDecision,
  selectedPasses: readonly string[],
): PlanningPassRationale[] {
  const evidence = `${decision.workLifecycle}; ambiguity=${decision.factors.ambiguity}; reversibility=${decision.factors.reversibility}`;
  return selectedPasses.map((pass) => ({
    pass,
    evidence,
    expectedRiskReduction:
      pass === "bootstrap-plan"
        ? "shape the greenfield milestone into the smallest observable ticket set"
        : pass === "visionary"
          ? "resolve the milestone or product boundary before ticket decomposition"
          : pass === "pm-a"
            ? "turn the selected product boundary into one coherent delivery strategy"
            : pass === "pm-b"
              ? "surface a genuinely competing strategy before a costly decision is committed"
              : pass === "arbitrator"
                ? "resolve recorded strategy disagreement into one decision"
                : "produce binary acceptance criteria and bounded ticket scope for the build handoff",
  }));
}

function measureDownstreamOutcomes(
  selectedPassCount: number,
  history: readonly TurnRecord[],
): PlanningOutcomeMeasurement {
  const byTask = new Map<string, TurnRecord[]>();
  for (const row of history) {
    if (row.parentTaskId === undefined) continue;
    const rows = byTask.get(row.parentTaskId) ?? [];
    rows.push(row);
    byTask.set(row.parentTaskId, rows);
  }
  const episodes = [...byTask.values()].flatMap((rows) => {
    const downstream = rows.filter((row) => row.pipeline !== "plan" && row.pipeline !== "plan-bootstrap");
    if (downstream.length === 0) return [];
    return [{
      passCount: rows.filter((row) => row.pipeline === "plan" || row.pipeline === "plan-bootstrap").length,
      failed: downstream.some((row) => row.status !== "completed"),
    }];
  });
  const comparable = episodes.filter((episode) => episode.passCount === selectedPassCount);
  const lower = episodes.filter((episode) => episode.passCount < selectedPassCount);
  const comparableRate = failureRate(comparable);
  const lowerRate = failureRate(lower);
  const measured = comparableRate !== null && lowerRate !== null;
  return {
    status: measured ? "measured" : "unavailable",
    selectedPassCount,
    comparableEpisodes: comparable.length,
    lowerPassEpisodes: lower.length,
    comparableDownstreamFailureRate: comparableRate,
    lowerPassDownstreamFailureRate: lowerRate,
    observedFailureRateDelta: measured ? lowerRate - comparableRate : null,
    basis: measured
      ? "parent-task-linked downstream provider outcomes; delta is observational, not a causal claim"
      : "no parent-task-linked comparable and lower-pass downstream outcome cohorts; expected pass benefits remain hypotheses",
  };
}

function failureRate(episodes: ReadonlyArray<{ failed: boolean }>): number | null {
  if (episodes.length === 0) return null;
  return episodes.filter((episode) => episode.failed).length / episodes.length;
}
