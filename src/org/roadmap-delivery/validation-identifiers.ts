import { stableHash } from "../../loop/episode-plan.js";
import type {
  ValidationAffectedStructure,
  ValidationCatalog,
  ValidationCatalogId,
  ValidationCatalogTemplate,
  ValidationWaiverClass,
} from "./validation-catalog.js";
import { RoadmapDeliveryError } from "./failure.js";
import { assertMachineId, assertStringList } from "./validation-values.js";

export function assertCatalogIds(entries: readonly ValidationCatalogId[], label: string): void {
  const seen = new Map<string, string>();
  for (const entry of entries) {
    assertMachineId(entry.canonicalId, `${label} canonical id`);
    assertStringList(entry.aliases, `${label} ${entry.canonicalId} aliases`, true);
    for (const id of [entry.canonicalId, ...entry.aliases]) {
      const prior = seen.get(id);
      if (prior !== undefined) {
        throw new RoadmapDeliveryError(
          "validation_contract_invalid",
          `${label} id ${id} resolves ambiguously to ${prior} and ${entry.canonicalId}`,
        );
      }
      seen.set(id, entry.canonicalId);
    }
  }
}

export function assertWaiverClassIds(entries: readonly ValidationWaiverClass[]): void {
  assertCatalogIds(
    entries.map((entry) => ({ canonicalId: entry.classId, aliases: entry.aliases })),
    "waiver class",
  );
}

export function resolveValidationId(entries: readonly ValidationCatalogId[], id: string, label: string): string {
  const matches = entries.filter((entry) => entry.canonicalId === id || entry.aliases.includes(id));
  if (matches.length !== 1) {
    throw new RoadmapDeliveryError("validation_id_unknown", `unknown or ambiguous ${label} ID ${id}`);
  }
  return matches[0]!.canonicalId;
}

export function resolveWaiverClassId(entries: readonly ValidationWaiverClass[], id: string): string {
  return resolveValidationId(
    entries.map((entry) => ({ canonicalId: entry.classId, aliases: entry.aliases })),
    id,
    "waiver class",
  );
}

export function resolveTemplateId(entries: readonly ValidationCatalogTemplate[], id: string, version: number): string {
  const matches = entries.filter(
    (entry) => entry.version === version && (entry.templateId === id || entry.aliases.includes(id)),
  );
  if (matches.length !== 1) {
    throw new RoadmapDeliveryError(
      "validation_id_unknown",
      `unknown or ambiguous validation template ${id}@${version}`,
    );
  }
  return matches[0]!.templateId;
}

export function canonicalizeAffectedStructure(
  affected: ValidationAffectedStructure,
  catalog: ValidationCatalog,
): ValidationAffectedStructure {
  return {
    journeyIds: affected.journeyIds.map((id) => resolveValidationId(catalog.journeys, id, "journey")),
    boundaryIds: affected.boundaryIds.map((id) => resolveValidationId(catalog.boundaries, id, "boundary")),
    contractIds: affected.contractIds.map((id) => resolveValidationId(catalog.contracts, id, "contract")),
    invariantIds: affected.invariantIds.map((id) => resolveValidationId(catalog.invariants, id, "invariant")),
    interfaceIds: affected.interfaceIds.map((id) => resolveValidationId(catalog.interfaces, id, "interface")),
    stateOwnerIds: affected.stateOwnerIds.map((id) => resolveValidationId(catalog.stateOwners, id, "state owner")),
    controlPointIds: affected.controlPointIds.map((id) =>
      resolveValidationId(catalog.controlPoints, id, "control point"),
    ),
  };
}

export function assertCanonicalAffectedStructure(
  affected: ValidationAffectedStructure,
  catalog: ValidationCatalog,
  label: string,
): void {
  const canonical = canonicalizeAffectedStructure(affected, catalog);
  if (stableHash(canonical) !== stableHash(affected)) {
    throw new RoadmapDeliveryError("validation_contract_invalid", `${label} did not persist canonical validation IDs`);
  }
}
