import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { ContractRecord } from "./core.js";
import { probeContract } from "./probes.js";
import type { ProbeOutcome } from "./probes.js";

export interface ContractObservation {
  id: string;
  declared_state: ContractRecord["state"];
  observed: ProbeOutcome;
  expected_failure: string | null;
  matches: boolean;
}

export interface ContractEvaluation {
  observations: ContractObservation[];
  knownRed: string[];
  failures: string[];
}

/** Evaluate the inventory without suppressing future contracts. Evidence is a
 * committed executable test/case artifact; the command that calls this first
 * runs the promoted tests, then verifies that the exact declared debt set has
 * neither grown nor passed unexpectedly. */
export function evaluateContracts(contracts: ContractRecord[], root: string, strict = false): ContractEvaluation {
  const observations = contracts.map((contract): ContractObservation => {
    const observed = probeContract(contract.id, root, existsSync(resolve(root, contract.evidence)));
    const expected = contract.state === "known_red" ? contract.expected_failure ?? null : null;
    const matches = contract.state === "required" ? observed === "passed" : observed === expected;
    return { id: contract.id, declared_state: contract.state, observed, expected_failure: expected, matches };
  });
  const knownRed = observations.filter((item) => item.declared_state === "known_red").map((item) => item.id).sort();
  const failures = observations.filter((item) => !item.matches).map((item) => `${item.id}: declared ${item.declared_state}${item.expected_failure ? `/${item.expected_failure}` : ""}, observed ${item.observed}`);
  if (strict && knownRed.length > 0) failures.push(`strict mode: ${knownRed.length} known-red contract(s) remain`);
  return { observations, knownRed, failures };
}
