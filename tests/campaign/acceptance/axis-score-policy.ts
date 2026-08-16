import type { QualificationHostPolicy } from "../../../src/org/qualification-host-policy.js";
import { PolicyLoadError } from "../../policy/cf-reg-278/policy-loader.js";
import type { AxisScorePolicy, AxisScoreValue } from "./verdict-algebra.js";

/** Freeze the already-validated host snapshot into the runner's axis policy. */
export function axisScorePolicyFromHost(host: QualificationHostPolicy): AxisScorePolicy {
  const block = host.outcome_acceptance.axis_score;
  const values: AxisScoreValue[] = [];
  for (const value of block.values) {
    if (value !== 0 && value !== 1 && value !== 2 && value !== 3 && value !== "ungraded") {
      throw new PolicyLoadError("outcome_acceptance.axis_score contains a non-canonical value");
    }
    values.push(value);
  }
  return { values, rules: [...block.rules], thresholds: block.thresholds };
}
