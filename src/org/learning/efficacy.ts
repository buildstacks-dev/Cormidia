// Phase 4 deterministic efficacy and post-activation recommendations.
// Extends ExperimentRecord/EvalResult lineage; no provider or side-effect API.

import { createHash } from "node:crypto";
import type { EvalResult } from "./eval-result.js";
import { requireEfficacyProtocol, type ExperimentRecord } from "./experiment.js";

export interface EfficacyObservation {
  pair: number;
  arm: "control" | "treatment";
  observed_at: string;
  weakness_score: number | null;
  guardrail_score: number | null;
  fingerprint_ref: string;
  /** Exact bytes visible to the acting agent, excluding verifier-only graders. */
  actor_visible_bytes: string;
  invalid_reason?: string;
}

export type EfficacyVerdict = "improved" | "inconclusive" | "regressed" | "invalid" | "missing";
export type EfficacyRecommendation = "retain" | "revise" | "disable" | "roll_back";

export interface EfficacyDecision {
  schema_version: 1;
  decision_id: string;
  experiment_ref: string;
  verdict: EfficacyVerdict;
  weakness_delta: number | null;
  guardrail_delta: number | null;
  promotable: boolean;
  recommendation: EfficacyRecommendation;
  attempted_pairs: number[];
  valid_pairs: number[];
  reasons: string[];
}

export function evaluateEfficacy(
  experiment: ExperimentRecord,
  observations: readonly EfficacyObservation[],
  resultAt: string,
  options: { activated?: boolean } = {},
): EfficacyDecision {
  const protocol = requireEfficacyProtocol(experiment);
  const declaredAt = Date.parse(protocol.declared_at);
  const decidedAt = Date.parse(resultAt);
  if (!Number.isFinite(decidedAt) || declaredAt >= decidedAt) {
    throw new Error("learning: experiment_not_declared_before_results");
  }
  if (observations.some((row) => {
    const observedAt = Date.parse(row.observed_at);
    return !Number.isFinite(observedAt) || observedAt <= declaredAt || observedAt >= decidedAt;
  })) {
    throw new Error("learning: observation_outside_declared_result_window");
  }
  const secrets = [
    experiment.treatment.fingerprint_ref,
    protocol.hidden_guardrail_commitment.sha256,
  ];
  if (observations.some((row) => secrets.some((secret) => row.actor_visible_bytes.includes(secret)))) {
    throw new Error("learning: actor_blindness_violated");
  }
  if (observations.some((row) =>
    row.fingerprint_ref !==
      (row.arm === "control" ? experiment.control.fingerprint_ref : experiment.treatment.fingerprint_ref)
  )) {
    throw new Error("learning: system_fingerprint_drift");
  }

  const byPair = new Map<number, EfficacyObservation[]>();
  for (const row of observations) byPair.set(row.pair, [...(byPair.get(row.pair) ?? []), row]);
  const attemptedPairs = [...byPair.keys()].sort((a, b) => a - b);
  const valid: Array<{ pair: number; control: EfficacyObservation; treatment: EfficacyObservation }> = [];
  const reasons: string[] = [];
  let invalid = false;
  let missing = false;
  for (const pair of attemptedPairs) {
    const rows = byPair.get(pair)!;
    const control = rows.find((row) => row.arm === "control");
    const treatment = rows.find((row) => row.arm === "treatment");
    if (rows.filter((row) => row.arm === "control").length > 1 || rows.filter((row) => row.arm === "treatment").length > 1) {
      invalid = true;
      reasons.push(`pair_${pair}:duplicate_arm`);
      continue;
    }
    if (control === undefined || treatment === undefined) {
      missing = true;
      reasons.push(`pair_${pair}:missing_arm`);
      continue;
    }
    if (control.invalid_reason !== undefined || treatment.invalid_reason !== undefined) {
      invalid = true;
      reasons.push(`pair_${pair}:invalid_measurement`);
      continue;
    }
    if (
      control.weakness_score === null || treatment.weakness_score === null ||
      control.guardrail_score === null || treatment.guardrail_score === null
    ) {
      missing = true;
      reasons.push(`pair_${pair}:missing_metric`);
      continue;
    }
    if (![control.weakness_score, treatment.weakness_score, control.guardrail_score, treatment.guardrail_score].every(Number.isFinite)) {
      invalid = true;
      reasons.push(`pair_${pair}:non_finite_metric`);
      continue;
    }
    valid.push({ pair, control, treatment });
  }

  let verdict: EfficacyVerdict;
  let weaknessDelta: number | null = null;
  let guardrailDelta: number | null = null;
  if (invalid) verdict = "invalid";
  else if (missing || valid.length === 0) verdict = "missing";
  else {
    weaknessDelta = mean(valid.map((pair) => pair.treatment.weakness_score! - pair.control.weakness_score!));
    guardrailDelta = mean(valid.map((pair) => pair.treatment.guardrail_score! - pair.control.guardrail_score!));
    if (guardrailDelta < 0 || weaknessDelta < 0) verdict = "regressed";
    else if (weaknessDelta > 0) verdict = "improved";
    else verdict = "inconclusive";
  }
  if (verdict === "improved") reasons.push("held_in_weakness_improved", "hidden_guardrails_preserved");
  if (verdict === "inconclusive") reasons.push("no_measured_improvement");
  if (verdict === "regressed") reasons.push(guardrailDelta !== null && guardrailDelta < 0 ? "hidden_guardrail_regressed" : "primary_metric_regressed");

  const recommendation: EfficacyRecommendation =
    verdict === "improved"
      ? "retain"
      : verdict === "regressed"
        ? (options.activated === true ? "roll_back" : "disable")
        : "revise";
  const canonical = JSON.stringify({
    experiment: experiment.experiment_id,
    verdict,
    weaknessDelta,
    guardrailDelta,
    attemptedPairs,
    validPairs: valid.map((pair) => pair.pair),
    reasons: [...new Set(reasons)].sort(),
  });
  return {
    schema_version: 1,
    decision_id: `eff_${digest(canonical).slice(0, 20)}`,
    experiment_ref: experiment.experiment_id,
    verdict,
    weakness_delta: weaknessDelta,
    guardrail_delta: guardrailDelta,
    promotable: verdict === "improved",
    recommendation,
    attempted_pairs: attemptedPairs,
    valid_pairs: valid.map((pair) => pair.pair),
    reasons: [...new Set(reasons)].sort(),
  };
}

/** Episode-sticky assignment used by deterministic sandbox trials. */
export function stickyEfficacyArm(
  episodeId: string,
  experimentId: string,
): "control" | "treatment" {
  return (Number.parseInt(digest(`${experimentId}\0${episodeId}`).slice(0, 2), 16) & 1) === 0
    ? "control"
    : "treatment";
}

/** Existing replay verdicts map into the same retain/revise/disable decision
 * vocabulary. Counts alone never enter this function. */
export function recommendationForEval(
  result: EvalResult,
  activated: boolean,
): EfficacyRecommendation {
  if (result.verdict === "improved" && result.guardrails.every((guardrail) => guardrail.pass)) return "retain";
  if (result.verdict === "regressed") return activated ? "roll_back" : "disable";
  return "revise";
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
