import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { ContractQualificationScope, ContractRecord } from "./core.js";
export type ProbeOutcome = "passed" | "evidence_absent" | (string & {});
export type ContractEvaluationScope = ContractQualificationScope | "all";

export interface ContractObservation {
  id: string;
  declared_state: ContractRecord["state"];
  observed: ProbeOutcome;
  expected_failure: string | null;
  matches: boolean;
}

export interface ContractEvaluation {
  qualificationScope: ContractEvaluationScope;
  inventoryTotal: number;
  evaluatedTotal: number;
  observations: ContractObservation[];
  knownRed: string[];
  failures: string[];
}

/** Evaluate the inventory after the executable contract suite has run. Each
 * known-red evidence test asserts its exact current typed failure and therefore
 * fails loudly if the product starts passing or fails differently. This stage
 * verifies evidence presence and the exact declared debt set without probing
 * source text or duplicating the behavioral runner. */
export function evaluateContracts(
  contracts: ContractRecord[],
  root: string,
  options: { strict?: boolean; qualificationScope?: ContractEvaluationScope } = {},
): ContractEvaluation {
  const strict = options.strict ?? false;
  const qualificationScope = options.qualificationScope ?? "all";
  const selected = qualificationScope === "all"
    ? contracts
    : contracts.filter((contract) => contract.qualification_scope === qualificationScope);
  const observations = selected.map((contract): ContractObservation => {
    const evidenceExists = existsSync(resolve(root, contract.evidence));
    const expected = contract.state === "known_red" ? contract.expected_failure ?? null : null;
    const observed: ProbeOutcome = evidenceExists
      ? contract.state === "known_red" ? expected as ProbeOutcome : "passed"
      : "evidence_absent";
    const matches = contract.state === "required" ? observed === "passed" : observed === expected;
    return { id: contract.id, declared_state: contract.state, observed, expected_failure: expected, matches };
  });
  const knownRed = observations.filter((item) => item.declared_state === "known_red").map((item) => item.id).sort();
  const failures = observations.filter((item) => !item.matches).map((item) => `${item.id}: declared ${item.declared_state}${item.expected_failure ? `/${item.expected_failure}` : ""}, observed ${item.observed}`);
  if (strict && knownRed.length > 0) failures.push(`${qualificationScope} strict mode: ${knownRed.length} known-red contract(s) remain`);
  return { qualificationScope, inventoryTotal: contracts.length, evaluatedTotal: selected.length, observations, knownRed, failures };
}
