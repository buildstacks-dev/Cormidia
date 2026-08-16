import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { RATIFIED_VALIDATION_CATALOG_CONTENT_SHA256 } from "../../src/org/roadmap-delivery/validation-catalog-revision.js";
import { ratifiedRoadmapValidationCatalog } from "../../src/org/ratified-validation-catalog.js";
import { missingRevisionRegistryModelStructures, REVISION_REGISTRY_IDS } from "./revision-catalog-crosswalk.js";
import { loadRevisionAuthorityFacts } from "./revision-authority.js";

export { REVISION_REGISTRY_IDS } from "./revision-catalog-crosswalk.js";

export interface RevisionFamilyEvidence {
  case_ids: readonly string[];
  model_family_ids: readonly string[];
  test_path: string;
  seeded_detector_marker: string;
}

export interface RevisionCatalogAudit {
  walked_case_ids: string[];
  violations: string[];
}

export const REVISION_FAMILY_EVIDENCE: readonly RevisionFamilyEvidence[] = [
  {
    case_ids: [
      "CF-J03-S",
      "CF-J03-R",
      "CF-J03-I",
      "CF-J03-RC",
      "CF-J03-A",
      "CF-SM-ROADMAP-L/I/R/C",
      "CF-B20-*",
      "CF-C-B20",
      "CF-S1-env",
    ],
    model_family_ids: [
      "CF-J03-S",
      "CF-J03-R",
      "CF-J03-I",
      "CF-J03-RC",
      "CF-J03-A",
      "CF-SM-ROADMAP-L",
      "CF-SM-ROADMAP-I",
      "CF-SM-ROADMAP-R",
      "CF-SM-ROADMAP-C",
      "CF-B20",
      "CF-C-B20",
      "CF-S1-env",
    ],
    test_path:
      "tests/hermetic/cf-b20-cf-c-b20-cf-c-opplan-cf-j03-i-cf-j03-r-cf-j03-rc-cf-j03-s-cf-sm-roadmap-c-cf-sm-roadmap-i-cf-sm-roadmap-l-cf-sm-roadmap-r/roadmap-authority.test.ts",
    seeded_detector_marker: "turns red for unaccounted and multiply-assigned issues",
  },
  {
    case_ids: ["CF-J04-S", "CF-J04-R", "CF-J04-I", "CF-J04-RC", "CF-J04-A"],
    model_family_ids: ["CF-J04-S", "CF-J04-R", "CF-J04-I", "CF-J04-RC", "CF-J04-A"],
    test_path:
      "tests/hermetic/cf-c-oploop-cf-inv-005-cf-inv-016-cf-j04-a-cf-j04-i-cf-j04-r-cf-j04-s/delivery-unit-atomic-loop.test.ts",
    seeded_detector_marker: "rolls every member back when a seeded subset label transition fails",
  },
  {
    case_ids: [
      "CF-J20-S",
      "CF-J20-R",
      "CF-J20-I",
      "CF-J20-RC",
      "CF-J20-A",
      "CF-SM-BATCH-L/I/R/C",
      "CF-B22-*",
      "CF-C-B22",
      "CF-C-OPBATCH",
    ],
    model_family_ids: [
      "CF-J20-S",
      "CF-J20-R",
      "CF-J20-I",
      "CF-J20-RC",
      "CF-J20-A",
      "CF-SM-BATCH-L",
      "CF-SM-BATCH-I",
      "CF-SM-BATCH-R",
      "CF-SM-BATCH-C",
      "CF-B22",
      "CF-C-B22",
      "CF-C-OPBATCH",
    ],
    test_path:
      "tests/hermetic/cf-b22-cf-c-b22-cf-c-opbatch-cf-j20-i-cf-j20-r-cf-j20-rc-cf-j20-s-cf-sm-batch-c-cf-sm-batch-i-cf-sm-batch-l-cf-sm-batch-r/execution-unit-batching.test.ts",
    seeded_detector_marker: "Seeded negative control: the complete governed shortcut still cannot",
  },
  {
    case_ids: ["CF-SM-VALIDATION-L/I/R/C", "CF-B21-*", "CF-C-B21", "CF-C-OPVALIDATION", "CF-S10-env"],
    model_family_ids: [
      "CF-SM-VALIDATION-L",
      "CF-SM-VALIDATION-I",
      "CF-SM-VALIDATION-R",
      "CF-SM-VALIDATION-C",
      "CF-B21",
      "CF-C-B21",
      "CF-C-OPVALIDATION",
      "CF-S10-env",
    ],
    test_path:
      "tests/hermetic/cf-b21-cf-c-b21-cf-c-opvalidation-cf-hb102-manual-review-cf-inv-016-cf-s10-env-cf-sm-validation-c-cf-sm-validation-i-cf-sm-validation-l-cf-sm-validation-r/validation-contract-authority.test.ts",
    seeded_detector_marker: "negative control",
  },
  {
    case_ids: ["CF-INV-016"],
    model_family_ids: ["CF-INV-016"],
    test_path:
      "tests/hermetic/cf-b22-cf-c-b22-cf-inv-004-cf-inv-006-cf-inv-008-cf-inv-016-cf-j20-i-cf-j20-r-cf-j20-rc-cf-j20-s/session-cache-affinity.test.ts",
    seeded_detector_marker: "Seeded negative control: role is the only changed field",
  },
  {
    case_ids: ["CF-IF-XSURF"],
    model_family_ids: ["CF-IF-XSURF"],
    test_path: "tests/hermetic/cf-if-xsurf-cf-inv-008/cross-surface-roadmap-explanation.test.ts",
    seeded_detector_marker: "negative control: a corrupt batch disposition cannot project false completion",
  },
] as const;

export async function auditRevisionCatalogClosure(
  root: string,
  families: readonly RevisionFamilyEvidence[] = REVISION_FAMILY_EVIDENCE,
  hostPolicyOverride?: string,
): Promise<RevisionCatalogAudit> {
  const authority = await loadRevisionAuthorityFacts(root, hostPolicyOverride);
  const violations: string[] = [];
  const walked = families.flatMap((family) => family.case_ids);
  if (families.length === 0 || walked.length === 0) violations.push("revision_catalog_walk_empty");
  if (new Set(walked).size !== walked.length) violations.push("revision_catalog_case_duplicate");

  const active = authority.hostPolicy.active_revision_catalog;
  if (active.revision_id !== ratifiedRoadmapValidationCatalog("catalog-audit").harnessRevisionId) {
    violations.push("revision_id_mismatch");
  }
  const registeredIds = new Set(active.registered_structure_ids);
  for (const id of REVISION_REGISTRY_IDS) {
    if (!registeredIds.has(id)) violations.push(`revision_registry_missing:${id}`);
  }
  const expectedRegistry = new Set<string>(REVISION_REGISTRY_IDS);
  for (const id of registeredIds) {
    if (!expectedRegistry.has(id)) violations.push(`revision_registry_unexpected:${id}`);
  }
  if (active.catalog_slice_content_sha256 !== RATIFIED_VALIDATION_CATALOG_CONTENT_SHA256) {
    violations.push("revision_catalog_pin_mismatch");
  }
  if (authority.modelStructureIds !== null) {
    for (const id of missingRevisionRegistryModelStructures(authority.modelStructureIds))
      violations.push(`revision_model_structure_missing:${id}`);
  }
  for (const family of families) {
    if (family.case_ids.length === 0) violations.push(`revision_family_walk_empty:${family.test_path}`);
    const familyIds = authority.kind === "model" ? family.model_family_ids : family.case_ids;
    for (const id of familyIds) {
      if (!authority.familyIds.has(id)) violations.push(`revision_catalog_case_missing:${id}`);
    }
    let source = "";
    try {
      source = await readFile(join(root, family.test_path), "utf8");
    } catch {
      violations.push(`revision_detector_source_missing:${family.test_path}`);
      continue;
    }
    if (!source.includes(family.seeded_detector_marker)) {
      violations.push(`revision_detector_never_fired:${family.case_ids.join(",")}`);
    }
  }
  return { walked_case_ids: [...walked], violations: violations.sort() };
}
