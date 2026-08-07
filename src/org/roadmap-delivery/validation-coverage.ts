import { stableHash } from "../../loop/episode-plan.js";
import type { ValidationAffectedStructure, ValidationCatalogCase } from "./validation-catalog.js";
import type { ValidationObligation } from "./validation-contract.js";
import { RoadmapDeliveryError } from "./failure.js";
import { assertExactObjectKeys } from "./authority-core.js";
import { assertStringList } from "./validation-values.js";

export function assertAffectedStructureShape(
  affected: ValidationAffectedStructure,
  label: string,
  allowEmpty: boolean,
): void {
  assertExactObjectKeys(
    affected,
    ["journeyIds", "boundaryIds", "contractIds", "invariantIds", "interfaceIds", "stateOwnerIds", "controlPointIds"],
    label,
  );
  const rows: Array<[string, string[]]> = [
    ["journeys", affected.journeyIds],
    ["boundaries", affected.boundaryIds],
    ["contracts", affected.contractIds],
    ["invariants", affected.invariantIds],
    ["interfaces", affected.interfaceIds],
    ["state owners", affected.stateOwnerIds],
    ["control points", affected.controlPointIds],
  ];
  for (const [name, values] of rows) {
    assertStringList(values, `${label} ${name}`, allowEmpty || name === "control points");
  }
}

export function emptyAffectedStructure(): ValidationAffectedStructure {
  return {
    journeyIds: [],
    boundaryIds: [],
    contractIds: [],
    invariantIds: [],
    interfaceIds: [],
    stateOwnerIds: [],
    controlPointIds: [],
  };
}

export function mergeAffectedStructure(target: ValidationAffectedStructure, source: ValidationAffectedStructure): void {
  for (const key of affectedStructureKeys()) {
    target[key] = [...new Set([...target[key], ...source[key]])].sort();
  }
}

export function assertAffectedStructureEqual(
  actual: ValidationAffectedStructure,
  expected: ValidationAffectedStructure,
): void {
  for (const key of affectedStructureKeys()) {
    const left = [...actual[key]].sort();
    const right = [...expected[key]].sort();
    if (stableHash(left) !== stableHash(right)) {
      throw new RoadmapDeliveryError(
        "validation_contract_invalid",
        `validation obligations do not exactly cover affected ${key}: expected ${right.join(",")}`,
      );
    }
  }
}

export function assertCoverageSupported(obligation: ValidationObligation, entry: ValidationCatalogCase): void {
  for (const key of affectedStructureKeys()) {
    const supported = new Set(entry.affected[key]);
    const unsupported = obligation.covers[key].filter((id) => !supported.has(id));
    if (unsupported.length > 0) {
      throw new RoadmapDeliveryError(
        "validation_contract_invalid",
        `${obligation.caseId} does not cover ${key}: ${unsupported.join(",")}`,
      );
    }
  }
}

export function affectedContains(superset: ValidationAffectedStructure, subset: ValidationAffectedStructure): boolean {
  return affectedStructureKeys().every((key) => subset[key].every((id) => superset[key].includes(id)));
}

function affectedStructureKeys(): Array<keyof ValidationAffectedStructure> {
  return [
    "journeyIds",
    "boundaryIds",
    "contractIds",
    "invariantIds",
    "interfaceIds",
    "stateOwnerIds",
    "controlPointIds",
  ];
}
