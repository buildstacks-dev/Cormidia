import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { writeLoopFileAtomic, writeLoopFileOnce } from "../../loop/durable.js";
import { stableHash } from "../../loop/episode-plan.js";
import type { AuthorityRef } from "./authority-core.js";
import { sameAuthorityRef, sameNullableAuthorityRef } from "./authority-store.js";
import { VALIDATION_CONTRACT_SCHEMA_VERSION, type ValidationContract } from "./validation-contract.js";
import { validationContractLifecyclePath } from "./authority-paths.js";
import { RoadmapDeliveryError } from "./failure.js";
import {
  isValidationContractLifecycleRecord,
  type ValidationContractLifecycleRecord,
  type ValidationContractLifecycleState,
} from "./validation-lifecycle-record.js";
import { requireDateTime } from "./validation-values.js";

export async function readValidationContractLifecycle(
  root: string,
  app: string,
  unitId: string,
  contractId: string,
  version: number,
): Promise<ValidationContractLifecycleRecord | undefined> {
  const path = validationContractLifecyclePath(root, app, unitId, contractId, version);
  if (!existsSync(path)) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    throw new RoadmapDeliveryError(
      "authority_corrupt",
      `validation lifecycle is unreadable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!isValidationContractLifecycleRecord(parsed)) {
    throw new RoadmapDeliveryError("authority_corrupt", "validation lifecycle record is invalid");
  }
  return parsed;
}

export async function ensureValidationProposalLifecycle(root: string, contract: ValidationContract): Promise<void> {
  const path = validationContractLifecyclePath(
    root,
    contract.app,
    contract.unitId,
    contract.contractId,
    contract.version,
  );
  const proposalHash = stableHash(contract);
  const record: ValidationContractLifecycleRecord = {
    schemaVersion: VALIDATION_CONTRACT_SCHEMA_VERSION,
    app: contract.app,
    unitId: contract.unitId,
    contractId: contract.contractId,
    version: contract.version,
    proposalHash,
    acceptedRef: null,
    predecessor: contract.predecessor,
    state: "proposed",
    transitions: [{ state: "proposed", at: contract.proposedAt, authorityRef: null }],
  };
  const won = await writeLoopFileOnce(path, `${JSON.stringify(record, null, 2)}\n`);
  if (won) return;
  const existing = await readValidationContractLifecycle(
    root,
    contract.app,
    contract.unitId,
    contract.contractId,
    contract.version,
  );
  if (
    existing === undefined ||
    existing.proposalHash !== proposalHash ||
    existing.app !== contract.app ||
    existing.unitId !== contract.unitId ||
    !sameNullableAuthorityRef(existing.predecessor, contract.predecessor)
  ) {
    throw new RoadmapDeliveryError(
      "authority_conflict",
      `validation proposal ${contract.contractId}@${contract.version} already differs`,
    );
  }
}

export async function transitionValidationLifecycle(
  root: string,
  contract: ValidationContract,
  next: ValidationContractLifecycleState,
  at: string,
  authorityRef: AuthorityRef | null,
): Promise<void> {
  await transitionPersistedValidationLifecycle(root, contract, next, at, authorityRef);
}

export async function transitionPersistedValidationLifecycle(
  root: string,
  contract: ValidationContract,
  next: ValidationContractLifecycleState,
  at: string,
  authorityRef: AuthorityRef | null,
): Promise<void> {
  const current = await readValidationContractLifecycle(
    root,
    contract.app,
    contract.unitId,
    contract.contractId,
    contract.version,
  );
  if (current === undefined) {
    throw new RoadmapDeliveryError("authority_corrupt", "validation lifecycle proposal is missing");
  }
  if (current.state === next) {
    const latestRef = current.transitions.at(-1)?.authorityRef ?? null;
    if (
      (next === "accepted" &&
        (authorityRef === null ||
          current.acceptedRef === null ||
          !sameAuthorityRef(current.acceptedRef, authorityRef))) ||
      (next === "superseded" &&
        (authorityRef === null || latestRef === null || !sameAuthorityRef(latestRef, authorityRef))) ||
      (next !== "accepted" && next !== "superseded" && authorityRef !== null)
    ) {
      throw new RoadmapDeliveryError("authority_conflict", `validation lifecycle ${next} replay differs`);
    }
    return;
  }
  const allowed: Record<ValidationContractLifecycleState, ValidationContractLifecycleState[]> = {
    proposed: ["validated"],
    validated: ["accepted"],
    accepted: ["superseded"],
    superseded: [],
  };
  if (!allowed[current.state].includes(next)) {
    throw new RoadmapDeliveryError(
      "validation_contract_stale",
      `illegal validation lifecycle transition ${current.state} → ${next}`,
    );
  }
  requireDateTime(at, `validation ${next} transition`);
  const lastAt = Date.parse(current.transitions.at(-1)!.at);
  if (Date.parse(at) < lastAt) {
    throw new RoadmapDeliveryError("validation_contract_stale", "validation lifecycle moved backward in time");
  }
  if ((next === "accepted" || next === "superseded") && authorityRef === null) {
    throw new RoadmapDeliveryError("authority_corrupt", `validation ${next} transition lacks authority ref`);
  }
  const updated: ValidationContractLifecycleRecord = {
    ...current,
    state: next,
    acceptedRef: next === "accepted" ? authorityRef : current.acceptedRef,
    transitions: [...current.transitions, { state: next, at, authorityRef }],
  };
  await writeLoopFileAtomic(
    validationContractLifecyclePath(root, contract.app, contract.unitId, contract.contractId, contract.version),
    `${JSON.stringify(updated, null, 2)}\n`,
  );
}
