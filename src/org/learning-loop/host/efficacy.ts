// Phase 4 deterministic efficacy and post-activation recommendations.
// Extends ExperimentRecord/EvalResult lineage; no provider or side-effect API.

import type { EvalResult } from "./eval-result.js";
export type EfficacyRecommendation = "retain" | "revise" | "disable" | "roll_back";

/** Existing replay verdicts map into the same retain/revise/disable decision
 * vocabulary. Counts alone never enter this function. */
export function recommendationForEval(result: EvalResult, activated: boolean): EfficacyRecommendation {
  if (result.verdict === "improved" && result.guardrails.every((guardrail) => guardrail.pass)) return "retain";
  if (result.verdict === "regressed") return activated ? "roll_back" : "disable";
  return "revise";
}
