import { assertAuthorityRef, assertExactObjectKeys, type AuthorityRef } from "./authority-core.js";
import { sameAuthorityRef } from "./authority-store.js";
import { VALIDATION_CONTRACT_SCHEMA_VERSION } from "./validation-contract.js";

const ID = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const HASH = /^[a-f0-9]{64}$/;

export type ValidationContractLifecycleState = "proposed" | "validated" | "accepted" | "superseded";

export interface ValidationContractLifecycleRecord {
  schemaVersion: typeof VALIDATION_CONTRACT_SCHEMA_VERSION;
  app: string;
  unitId: string;
  contractId: string;
  version: number;
  proposalHash: string;
  acceptedRef: AuthorityRef | null;
  predecessor: AuthorityRef | null;
  state: ValidationContractLifecycleState;
  transitions: Array<{
    state: ValidationContractLifecycleState;
    at: string;
    authorityRef: AuthorityRef | null;
  }>;
}

export function isValidationContractLifecycleRecord(value: unknown): value is ValidationContractLifecycleRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  try {
    assertExactObjectKeys(
      row,
      [
        "schemaVersion",
        "app",
        "unitId",
        "contractId",
        "version",
        "proposalHash",
        "acceptedRef",
        "predecessor",
        "state",
        "transitions",
      ],
      "validation lifecycle",
    );
  } catch {
    return false;
  }
  if (
    row["schemaVersion"] !== VALIDATION_CONTRACT_SCHEMA_VERSION ||
    typeof row["app"] !== "string" ||
    row["app"].trim().length === 0 ||
    typeof row["unitId"] !== "string" ||
    !ID.test(row["unitId"]) ||
    typeof row["contractId"] !== "string" ||
    !ID.test(row["contractId"]) ||
    !Number.isSafeInteger(row["version"]) ||
    Number(row["version"]) < 1 ||
    typeof row["proposalHash"] !== "string" ||
    !HASH.test(row["proposalHash"] as string) ||
    !["proposed", "validated", "accepted", "superseded"].includes(String(row["state"])) ||
    !Array.isArray(row["transitions"]) ||
    row["transitions"].length === 0
  )
    return false;
  const version = Number(row["version"]);
  const predecessor = row["predecessor"];
  const acceptedRef = row["acceptedRef"];
  try {
    if (predecessor !== null) assertAuthorityRef(predecessor as AuthorityRef, "validation_contract");
    if (acceptedRef !== null) assertAuthorityRef(acceptedRef as AuthorityRef, "validation_contract");
  } catch {
    return false;
  }
  if (
    (version === 1) !== (predecessor === null) ||
    (predecessor !== null &&
      ((predecessor as AuthorityRef).id !== row["contractId"] ||
        (predecessor as AuthorityRef).version !== version - 1)) ||
    (acceptedRef !== null &&
      ((acceptedRef as AuthorityRef).id !== row["contractId"] ||
        (acceptedRef as AuthorityRef).version !== version ||
        (acceptedRef as AuthorityRef).sha256 !== row["proposalHash"]))
  )
    return false;

  const transitions = row["transitions"] as unknown[];
  const legalStates: ValidationContractLifecycleState[] = ["proposed", "validated", "accepted", "superseded"];
  if (transitions.length > legalStates.length) return false;
  let lastAt = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < transitions.length; index += 1) {
    const transition = transitions[index];
    if (transition === null || typeof transition !== "object" || Array.isArray(transition)) return false;
    const entry = transition as Record<string, unknown>;
    try {
      assertExactObjectKeys(entry, ["state", "at", "authorityRef"], "validation lifecycle transition");
    } catch {
      return false;
    }
    const expectedState = legalStates[index];
    const at = typeof entry["at"] === "string" ? Date.parse(entry["at"]) : Number.NaN;
    if (entry["state"] !== expectedState || !Number.isFinite(at) || at < lastAt) return false;
    lastAt = at;
    const transitionRef = entry["authorityRef"];
    if (expectedState === "proposed" || expectedState === "validated") {
      if (transitionRef !== null) return false;
    } else {
      try {
        assertAuthorityRef(transitionRef as AuthorityRef, "validation_contract");
      } catch {
        return false;
      }
      if (
        expectedState === "accepted" &&
        (acceptedRef === null || !sameAuthorityRef(transitionRef as AuthorityRef, acceptedRef as AuthorityRef))
      )
        return false;
      if (
        expectedState === "superseded" &&
        ((transitionRef as AuthorityRef).id !== row["contractId"] ||
          (transitionRef as AuthorityRef).version !== version + 1)
      )
        return false;
    }
  }
  const finalState = legalStates[transitions.length - 1];
  return (
    row["state"] === finalState &&
    (finalState === "proposed" || finalState === "validated" ? acceptedRef === null : acceptedRef !== null)
  );
}
