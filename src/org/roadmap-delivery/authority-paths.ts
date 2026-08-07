import { join } from "node:path";
import { planningAppDir } from "../planning-artifact-path.js";
import { assertId, assertVersion } from "./authority-core.js";
import { authorityPath } from "./authority-store.js";

export function roadmapAuthorityPath(root: string, app: string, id: string, version: number): string {
  return authorityPath(root, app, "roadmap_plan", id, version);
}

export function backlogSnapshotAuthorityPath(root: string, app: string, id: string, version: number): string {
  return authorityPath(root, app, "backlog_snapshot", id, version);
}

export function currentRoadmapPointerPath(root: string, app: string): string {
  return join(planningAppDir(root, app), "roadmap-current.json");
}

export function validationAuthorityPath(root: string, app: string, id: string, version: number): string {
  return authorityPath(root, app, "validation_contract", id, version);
}

export function currentValidationCatalogPointerPath(root: string, app: string): string {
  return join(planningAppDir(root, app), "validation-catalog-current.json");
}

export function currentValidationContractPointerPath(root: string, app: string, unitId: string): string {
  assertId(unitId, "validation unit id");
  return join(planningAppDir(root, app), "validation-current", `${unitId}.json`);
}

export function validationContractLifecyclePath(
  root: string,
  app: string,
  unitId: string,
  contractId: string,
  version: number,
): string {
  assertId(unitId, "validation unit id");
  assertId(contractId, "validation contract id");
  assertVersion(version, "validation contract version");
  return join(planningAppDir(root, app), "validation-lifecycle", unitId, contractId, `v${version}.json`);
}

export function readinessAuthorityPath(root: string, app: string, unitId: string, version: number): string {
  return authorityPath(root, app, "delivery_unit_readiness", unitId, version);
}

export function batchAuthorityPath(root: string, app: string, id: string, version: number): string {
  return authorityPath(root, app, "execution_batch", id, version);
}

export function executionUnitJournalPath(root: string, app: string, batchId: string, unitId: string): string {
  assertId(batchId, "execution batch id");
  assertId(unitId, "execution unit id");
  return join(planningAppDir(root, app), "execution-unit-journals", batchId, `${unitId}.json`);
}
