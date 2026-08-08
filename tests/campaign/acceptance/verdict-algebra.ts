// campaign/acceptance/verdict-algebra.ts — the axis_score truth table, read
// from policy rather than encoded here (CORMIDIA-INV-ACC-5/6;
// `validation-policy.yaml` → `verdict_semantics.axis_score`).
//
// This is INV-008 pointed at the harness. The failure it prevents is not a
// crash: a campaign that coerces `ungraded` to `0` still emits a tidy report,
// and a human reads it and believes the org scored zero on an axis nobody
// measured. Conflating "we did not measure it" with "it was absent" is how a
// suite starts lying.
//
// The rules live in the policy file so a change is a policy edit a human sees,
// not a runner constant. This module LOADS them and refuses to run against a
// policy whose threshold declaration is anything other than the ratified
// "NONE" — introducing a threshold anywhere but a ratified rubric edit is
// exactly what rubric §5 forbids.

import { loadValidationPolicy, PolicyLoadError } from "../../policy/policy-loader.js";

export type AxisScoreValue = 0 | 1 | 2 | 3 | "ungraded";

export const UNGRADED = "ungraded" as const;

export type UngradedReason =
  | "citation-missing"
  | "evidence-missing"
  | "no-legal-grader"
  | "malformed-result"
  | "artifact-not-in-read-set"
  | "key-leaked"
  | "arm-command-failed"
  | "reconciliation-open"
  | "threshold-unratified";

export interface AxisScorePolicy {
  values: readonly AxisScoreValue[];
  rules: readonly string[];
  /** The ratified deferral text. No number is ever parsed out of it. */
  thresholds: string;
}

export class VerdictAlgebraError extends Error {
  constructor(message: string) {
    super(`verdict algebra refused: ${message}`);
    this.name = "VerdictAlgebraError";
  }
}

/** Read the ratified truth table. Fails closed on a policy that dropped it. */
export function loadAxisScorePolicy(repoRoot: string): AxisScorePolicy {
  const policy = loadValidationPolicy(repoRoot);
  const block = policy.verdict_semantics["axis_score"];
  if (typeof block !== "object" || block === null || Array.isArray(block)) {
    throw new PolicyLoadError("missing relied-on field: verdict_semantics.axis_score");
  }
  const record = block as Record<string, unknown>;
  const values = record["values"];
  const rules = record["rules"];
  const thresholds = record["thresholds"];
  if (!Array.isArray(values) || !Array.isArray(rules) || typeof thresholds !== "string") {
    throw new PolicyLoadError("verdict_semantics.axis_score must carry values, rules and thresholds");
  }
  return { values: values as AxisScoreValue[], rules: rules as string[], thresholds };
}

/**
 * v0 declares NO threshold (rubric §5, ratified). A policy that introduced one
 * outside a ratified rubric edit must stop the lane rather than start grading
 * against it.
 */
export function assertNoThresholdRatified(policy: AxisScorePolicy): void {
  if (!/^NONE\./.test(policy.thresholds.trim())) {
    throw new VerdictAlgebraError(
      `verdict_semantics.axis_score.thresholds no longer declares NONE; a threshold may only arrive through a ` +
        `ratified rubric edit (acceptance/rubric.md §5), never through the runner`,
    );
  }
}

/** A grader's raw claim about one axis, before the algebra is applied. */
export interface RawAxisResult {
  axis: string;
  score: AxisScoreValue;
  justification?: string;
  citations?: readonly string[];
  ungradedReason?: UngradedReason;
  /** True when this axis's verdict would depend on an unratified threshold. */
  thresholdDependent?: boolean;
}

export interface AxisResult {
  axis: string;
  score: AxisScoreValue;
  justification: string | null;
  citations: string[];
  ungradedReason: UngradedReason | null;
  /** Always `inconclusive` while thresholds are unratified. */
  verdict: "inconclusive";
}

/**
 * Apply the truth table to one raw result. A numeric score arriving without its
 * mandatory evidence citation is DISCARDED — the number is not retained and the
 * axis reports `ungraded` (B-29 §3, rubric §5).
 */
export function normalizeAxisResult(raw: RawAxisResult, policy: AxisScorePolicy): AxisResult {
  if (!policy.values.includes(raw.score)) {
    throw new VerdictAlgebraError(`axis ${raw.axis} scored ${JSON.stringify(raw.score)}, which is not a policy value`);
  }
  const citations = [...(raw.citations ?? [])];
  const ungraded = (reason: UngradedReason): AxisResult => ({
    axis: raw.axis,
    score: UNGRADED,
    justification: null,
    citations: [],
    ungradedReason: reason,
    verdict: "inconclusive",
  });

  if (raw.score === UNGRADED) return ungraded(raw.ungradedReason ?? "evidence-missing");
  if (raw.justification === undefined || raw.justification.trim().length === 0 || citations.length === 0) {
    return ungraded("citation-missing");
  }
  return {
    axis: raw.axis,
    score: raw.score,
    justification: raw.justification,
    citations,
    ungradedReason: null,
    verdict: "inconclusive",
  };
}

export interface AxisAggregate {
  /** Axes that produced a number. NAMED, never implied. */
  gradedAxisIds: string[];
  gradedDenominator: number;
  ungradedAxisIds: string[];
  /** Sum over graded axes only. `null` when nothing was graded. */
  total: number | null;
  mean: number | null;
  /** How a surface must render this scenario's headline. Never `0`. */
  display: string;
}

/**
 * Aggregate over an axis set. `ungraded` never enters as a numeric value, and
 * the graded denominator is always named — a report averaging axes across
 * scenarios with different denominators is the adversarial seed this closes.
 */
export function aggregateAxisScores(results: readonly AxisResult[]): AxisAggregate {
  const graded = results.filter((result) => result.score !== UNGRADED);
  const ungradedAxisIds = results.filter((result) => result.score === UNGRADED).map((result) => result.axis);
  const gradedAxisIds = graded.map((result) => result.axis);
  if (graded.length === 0) {
    return {
      gradedAxisIds,
      gradedDenominator: 0,
      ungradedAxisIds,
      total: null,
      mean: null,
      // Leads with the word, never a numeral: a headline that opened with a
      // digit is exactly how a fully-unmeasured scenario reads as a failure.
      display: `ungraded — no axis produced a score (graded denominator: none of ${String(results.length)})`,
    };
  }
  const total = graded.reduce((sum, result) => sum + (result.score as number), 0);
  return {
    gradedAxisIds,
    gradedDenominator: graded.length,
    ungradedAxisIds,
    total,
    mean: Math.round((total / graded.length) * 1000) / 1000,
    display: `${total}/${graded.length * 3} over ${graded.length} graded axes (${ungradedAxisIds.length} ungraded)`,
  };
}

export interface ScenarioCompletenessInput {
  results: readonly AxisResult[];
  ceilingExhausted?: boolean;
  killed?: boolean;
  /** Axes whose grader run is absent entirely. */
  missingGraderRuns?: readonly string[];
}

export interface ScenarioCompleteness {
  completeness: "complete" | "incomplete";
  reasons: string[];
}

/** Ceiling exhaustion, a killed scenario, a missing grader run, or any
 *  `ungraded` axis ⇒ `incomplete` for that scenario. Never green, and the
 *  scenario stays in the report (CORMIDIA-INV-ACC-6). */
export function scenarioCompleteness(input: ScenarioCompletenessInput): ScenarioCompleteness {
  const reasons: string[] = [];
  if (input.ceilingExhausted === true) reasons.push("ceiling_exhausted");
  if (input.killed === true) reasons.push("scenario_killed");
  for (const axis of input.missingGraderRuns ?? []) reasons.push(`missing_grader_run:${axis}`);
  for (const result of input.results) {
    if (result.score === UNGRADED) reasons.push(`ungraded:${result.axis}:${result.ungradedReason ?? "unknown"}`);
  }
  if (input.results.length === 0) reasons.push("no_axis_results");
  return { completeness: reasons.length === 0 ? "complete" : "incomplete", reasons: reasons.sort() };
}

/** The campaign verdict while every threshold is unratified: data collection
 *  only. Never `pass`, never `fail` (rubric §5, B-27 §4). */
export function campaignVerdict(policy: AxisScorePolicy): "inconclusive" {
  assertNoThresholdRatified(policy);
  return "inconclusive";
}
