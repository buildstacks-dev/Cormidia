import { assertAuthorityRef, assertExactObjectKeys, assertId, assertVersion } from "./authority-core.js";
import { VALIDATION_LAYERS, type ValidationCatalog } from "./validation-catalog.js";
import { assertAffectedStructureShape } from "./validation-coverage.js";
import { RoadmapDeliveryError } from "./failure.js";
import { assertCanonicalAffectedStructure, assertCatalogIds, assertWaiverClassIds } from "./validation-identifiers.js";
import { assertMachineId, assertNonEmpty, assertStringList, requireDateTime } from "./validation-values.js";

const VALIDATION_CATALOG_SCHEMA_VERSION = 1 as const;

export function assertValidationCatalogShape(catalog: ValidationCatalog): void {
  assertExactObjectKeys(
    catalog,
    [
      "schemaVersion",
      "catalogId",
      "version",
      "predecessor",
      "app",
      "harnessRevisionId",
      "journeys",
      "boundaries",
      "contracts",
      "invariants",
      "interfaces",
      "stateOwners",
      "controlPoints",
      "cases",
      "templates",
      "waiverClasses",
      "acceptedAt",
    ],
    "validation catalog",
  );
  if (catalog.schemaVersion !== VALIDATION_CATALOG_SCHEMA_VERSION) {
    throw new RoadmapDeliveryError("validation_catalog_stale", "unsupported validation catalog schema");
  }
  assertId(catalog.catalogId, "validation catalog id");
  assertVersion(catalog.version, "validation catalog version");
  if (catalog.predecessor !== null) assertAuthorityRef(catalog.predecessor, "validation_catalog");
  requireDateTime(catalog.acceptedAt, "validation catalog acceptedAt");
  assertNonEmpty(catalog.app, "validation catalog app");
  assertNonEmpty(catalog.harnessRevisionId, "validation catalog harness revision");
  for (const entries of [
    catalog.journeys,
    catalog.boundaries,
    catalog.contracts,
    catalog.invariants,
    catalog.interfaces,
    catalog.stateOwners,
    catalog.controlPoints,
    catalog.cases,
    catalog.templates,
    catalog.waiverClasses,
  ]) {
    if (!Array.isArray(entries)) {
      throw new RoadmapDeliveryError("validation_contract_invalid", "validation catalog collection is missing");
    }
  }
  for (const entry of [
    ...catalog.journeys,
    ...catalog.contracts,
    ...catalog.interfaces,
    ...catalog.stateOwners,
    ...catalog.controlPoints,
  ])
    assertExactObjectKeys(entry, ["canonicalId", "aliases"], "validation catalog ID");
  for (const invariant of catalog.invariants) {
    assertExactObjectKeys(invariant, ["canonicalId", "aliases", "floor"], "validation invariant");
    if (typeof invariant.floor !== "boolean") {
      throw new RoadmapDeliveryError("validation_contract_invalid", "validation invariant floor is not explicit");
    }
  }
  for (const [label, entries] of [
    ["journey", catalog.journeys],
    ["boundary", catalog.boundaries],
    ["contract", catalog.contracts],
    ["invariant", catalog.invariants],
    ["interface", catalog.interfaces],
    ["state owner", catalog.stateOwners],
    ["control point", catalog.controlPoints],
    ["case", catalog.cases],
  ] as const) {
    if (!Array.isArray(entries)) {
      throw new RoadmapDeliveryError("validation_contract_invalid", `validation catalog ${label} IDs are missing`);
    }
    if (entries.length === 0) {
      throw new RoadmapDeliveryError("validation_contract_invalid", `validation catalog has no ${label} IDs`);
    }
    assertCatalogIds(entries, label);
  }
  for (const boundary of catalog.boundaries) {
    assertExactObjectKeys(
      boundary,
      ["canonicalId", "aliases", "requiresSharedDetector", "sharedDetectorId", "routineEligible"],
      `validation boundary ${String(boundary?.canonicalId)}`,
    );
    if (
      typeof boundary.requiresSharedDetector !== "boolean" ||
      typeof boundary.routineEligible !== "boolean" ||
      boundary.requiresSharedDetector !== (boundary.sharedDetectorId !== null)
    ) {
      throw new RoadmapDeliveryError(
        "validation_contract_invalid",
        `boundary ${boundary.canonicalId} shared-detector policy is inconsistent`,
      );
    }
    if (boundary.sharedDetectorId !== null) assertNonEmpty(boundary.sharedDetectorId, "shared detector id");
  }
  for (const entry of catalog.cases) {
    assertExactObjectKeys(
      entry,
      [
        "canonicalId",
        "aliases",
        "cheapestFalsifyingLayer",
        "affected",
        "detectorId",
        "negativeControlRequired",
        "routineEligible",
      ],
      `validation case ${String(entry?.canonicalId)}`,
    );
    if (
      typeof entry.negativeControlRequired !== "boolean" ||
      typeof entry.routineEligible !== "boolean" ||
      !VALIDATION_LAYERS.includes(entry.cheapestFalsifyingLayer)
    ) {
      throw new RoadmapDeliveryError("validation_contract_invalid", `case ${entry.canonicalId} has an invalid layer`);
    }
    assertAffectedStructureShape(entry.affected, `catalog case ${entry.canonicalId}`, true);
    assertCanonicalAffectedStructure(entry.affected, catalog, `catalog case ${entry.canonicalId}`);
    assertNonEmpty(entry.detectorId, `case ${entry.canonicalId} detector id`);
  }
  if (catalog.templates.length === 0) {
    throw new RoadmapDeliveryError("validation_contract_invalid", "validation catalog has no governed templates");
  }
  const templateKeys = new Set<string>();
  const templateAliases = new Map<string, string>();
  for (const template of catalog.templates) {
    assertExactObjectKeys(template, ["templateId", "aliases", "version", "kind"], "validation template");
    assertMachineId(template.templateId, "validation template id");
    assertVersion(template.version, "validation template version");
    if (template.kind !== "routine" && template.kind !== "custom") {
      throw new RoadmapDeliveryError("validation_contract_invalid", "validation template kind is invalid");
    }
    const key = `${template.templateId}\0${template.version}`;
    if (templateKeys.has(key)) {
      throw new RoadmapDeliveryError("validation_contract_invalid", `duplicate validation template ${key}`);
    }
    templateKeys.add(key);
    assertStringList(template.aliases, `template ${template.templateId} aliases`, true);
    for (const id of [template.templateId, ...template.aliases]) {
      const aliasKey = `${template.version}\0${id}`;
      const prior = templateAliases.get(aliasKey);
      if (prior !== undefined && prior !== template.templateId) {
        throw new RoadmapDeliveryError(
          "validation_contract_invalid",
          `template ID ${id}@${template.version} resolves ambiguously`,
        );
      }
      templateAliases.set(aliasKey, template.templateId);
    }
  }
  if (catalog.waiverClasses.length === 0) {
    throw new RoadmapDeliveryError("validation_contract_invalid", "validation catalog has no explicit waiver policy");
  }
  assertWaiverClassIds(catalog.waiverClasses);
  for (const waiverClass of catalog.waiverClasses) {
    assertExactObjectKeys(
      waiverClass,
      ["classId", "aliases", "maxDurationMs", "maxWaiversPerContract", "allowedTemplateKinds"],
      "validation waiver class",
    );
    if (
      !Number.isSafeInteger(waiverClass.maxDurationMs) ||
      waiverClass.maxDurationMs < 1 ||
      !Number.isSafeInteger(waiverClass.maxWaiversPerContract) ||
      waiverClass.maxWaiversPerContract < 1 ||
      !Array.isArray(waiverClass.allowedTemplateKinds) ||
      waiverClass.allowedTemplateKinds.length === 0 ||
      waiverClass.allowedTemplateKinds.some((kind) => kind !== "routine" && kind !== "custom")
    ) {
      throw new RoadmapDeliveryError(
        "validation_contract_invalid",
        `waiver class ${waiverClass.classId} is unbounded or invalid`,
      );
    }
  }
}
