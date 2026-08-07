import { stableHash } from "../../loop/episode-plan.js";
import type { AcceptedAuthority, AuthorityRef } from "./authority-core.js";
import { renderAuthorityRef, sameAuthorityRef } from "./authority-store.js";
import { VALIDATION_LAYERS, type ValidationCatalog, type ValidationCatalogId } from "./validation-catalog.js";
import { affectedContains } from "./validation-coverage.js";
import { RoadmapDeliveryError } from "./failure.js";

const RATIFIED_HARNESS_REVISION_ID = "roadmap-validation-delivery-batching-2026-08-03" as const;
/** Content root for the complete deterministic HB-100..108 catalog. */
export const RATIFIED_VALIDATION_CATALOG_CONTENT_SHA256 =
  "58b677769721a28840733bd9e7da8aa729194fa6d1b1ed533128f17e56aa4880" as const;

export function assertValidationCatalogRevision(
  catalog: ValidationCatalog,
  current: AcceptedAuthority<ValidationCatalog> | undefined,
): void {
  const proposedRef: AuthorityRef = {
    kind: "validation_catalog",
    id: catalog.catalogId,
    version: catalog.version,
    sha256: stableHash(catalog),
  };
  if (catalog.harnessRevisionId !== RATIFIED_HARNESS_REVISION_ID) {
    throw new RoadmapDeliveryError(
      "validation_catalog_stale",
      `catalog must bind ratified harness revision ${RATIFIED_HARNESS_REVISION_ID}`,
    );
  }
  const contentHash = stableHash(validationCatalogContent(catalog));
  if (contentHash !== RATIFIED_VALIDATION_CATALOG_CONTENT_SHA256) {
    throw new RoadmapDeliveryError(
      "validation_catalog_stale",
      `catalog content ${contentHash} is not the ratified ${RATIFIED_VALIDATION_CATALOG_CONTENT_SHA256}`,
    );
  }
  if (current === undefined) {
    if (catalog.version !== 1 || catalog.predecessor !== null) {
      throw new RoadmapDeliveryError(
        "validation_catalog_stale",
        "the first validation catalog must be v1 with no predecessor",
      );
    }
    return;
  }
  if (sameAuthorityRef(current.ref, proposedRef)) return;
  if (
    catalog.catalogId !== current.value.catalogId ||
    catalog.version !== current.value.version + 1 ||
    catalog.predecessor === null ||
    !sameAuthorityRef(catalog.predecessor, current.ref)
  ) {
    throw new RoadmapDeliveryError(
      "validation_catalog_stale",
      `validation catalog must advance ${renderAuthorityRef(current.ref)} by exactly one version`,
    );
  }
  if (Date.parse(catalog.acceptedAt) < Date.parse(current.value.acceptedAt)) {
    throw new RoadmapDeliveryError("validation_catalog_stale", "validation catalog acceptance moved backward");
  }
  assertValidationCatalogTightens(catalog, current.value);
}

function validationCatalogContent(
  catalog: ValidationCatalog,
): Omit<ValidationCatalog, "schemaVersion" | "version" | "predecessor" | "app" | "acceptedAt"> {
  const {
    schemaVersion: _schemaVersion,
    version: _version,
    predecessor: _predecessor,
    app: _app,
    acceptedAt: _acceptedAt,
    ...content
  } = catalog;
  return content;
}

function assertValidationCatalogTightens(next: ValidationCatalog, prior: ValidationCatalog): void {
  const requireIds = <T extends ValidationCatalogId>(
    nextEntries: readonly T[],
    priorEntries: readonly T[],
    label: string,
  ): Map<string, T> => {
    const nextById = new Map(nextEntries.map((entry) => [entry.canonicalId, entry]));
    for (const old of priorEntries) {
      const replacement = nextById.get(old.canonicalId);
      if (replacement === undefined || old.aliases.some((alias) => !replacement.aliases.includes(alias))) {
        throw new RoadmapDeliveryError(
          "validation_catalog_stale",
          `${label} ${old.canonicalId} or one of its canonical aliases was removed`,
        );
      }
    }
    return nextById;
  };
  requireIds(next.journeys, prior.journeys, "journey");
  requireIds(next.contracts, prior.contracts, "contract");
  requireIds(next.interfaces, prior.interfaces, "interface");
  requireIds(next.stateOwners, prior.stateOwners, "state owner");
  requireIds(next.controlPoints, prior.controlPoints, "control point");

  const boundaries = requireIds(next.boundaries, prior.boundaries, "boundary");
  for (const old of prior.boundaries) {
    const replacement = boundaries.get(old.canonicalId)!;
    if (
      (old.requiresSharedDetector && !replacement.requiresSharedDetector) ||
      (old.sharedDetectorId !== null && replacement.sharedDetectorId !== old.sharedDetectorId) ||
      (!old.routineEligible && replacement.routineEligible)
    ) {
      throw new RoadmapDeliveryError("validation_catalog_stale", `boundary ${old.canonicalId} policy was weakened`);
    }
  }

  const invariants = requireIds(next.invariants, prior.invariants, "invariant");
  for (const old of prior.invariants) {
    if (old.floor && !invariants.get(old.canonicalId)!.floor) {
      throw new RoadmapDeliveryError("validation_catalog_stale", `invariant ${old.canonicalId} lost its floor`);
    }
  }

  const cases = requireIds(next.cases, prior.cases, "case");
  for (const old of prior.cases) {
    const replacement = cases.get(old.canonicalId)!;
    const oldLayer = VALIDATION_LAYERS.indexOf(old.cheapestFalsifyingLayer);
    const nextLayer = VALIDATION_LAYERS.indexOf(replacement.cheapestFalsifyingLayer);
    if (
      nextLayer > oldLayer ||
      old.detectorId !== replacement.detectorId ||
      (old.negativeControlRequired && !replacement.negativeControlRequired) ||
      (!old.routineEligible && replacement.routineEligible) ||
      !affectedContains(replacement.affected, old.affected)
    ) {
      throw new RoadmapDeliveryError("validation_catalog_stale", `case ${old.canonicalId} policy was weakened`);
    }
  }

  const templates = new Map(next.templates.map((entry) => [`${entry.templateId}\0${entry.version}`, entry]));
  for (const old of prior.templates) {
    const replacement = templates.get(`${old.templateId}\0${old.version}`);
    if (replacement === undefined || stableHash(replacement) !== stableHash(old)) {
      throw new RoadmapDeliveryError("validation_catalog_stale", `template ${old.templateId}@${old.version} changed`);
    }
  }

  const waiverClasses = requireIds(
    next.waiverClasses.map((entry) => ({ ...entry, canonicalId: entry.classId })),
    prior.waiverClasses.map((entry) => ({ ...entry, canonicalId: entry.classId })),
    "waiver class",
  );
  for (const old of prior.waiverClasses) {
    const replacement = waiverClasses.get(old.classId)!;
    if (
      replacement.maxDurationMs > old.maxDurationMs ||
      replacement.maxWaiversPerContract > old.maxWaiversPerContract ||
      replacement.allowedTemplateKinds.some((kind) => !old.allowedTemplateKinds.includes(kind))
    ) {
      throw new RoadmapDeliveryError("validation_catalog_stale", `waiver class ${old.classId} was widened`);
    }
  }
}
