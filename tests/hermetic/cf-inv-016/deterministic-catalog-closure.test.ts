// Traceability: CF-INV-016 · HB-100 · invariants.md INV-016 (HB-108 registry-closure and seeded-detector slice).

import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ratifiedRoadmapValidationCatalog } from "../../../src/org/ratified-validation-catalog.js";
import { RATIFIED_VALIDATION_CATALOG_CONTENT_SHA256 } from "../../../src/org/roadmap-delivery/validation-catalog-revision.js";
import {
  auditRevisionCatalogClosure,
  REVISION_FAMILY_EVIDENCE,
  REVISION_REGISTRY_IDS,
} from "../../fixtures/revision-catalog-closure.js";
import {
  missingRevisionRegistryModelStructures,
  REVISION_REGISTRY_MODEL_STRUCTURE_IDS,
} from "../../fixtures/revision-catalog-crosswalk.js";
import { HOST_POLICY_RELATIVE_PATH } from "../../fixtures/validation-authority.js";
import { parseGeneratedTableIds } from "../../fixtures/revision-authority.js";

describe("HB-108 deterministic revision-catalog closure", () => {
  it("walks every accepted registry and deterministic case family to a seeded detector", async () => {
    const audit = await auditRevisionCatalogClosure(process.cwd());
    const catalog = ratifiedRoadmapValidationCatalog("catalog-audit");
    const acceptedCaseIds = new Set(catalog.cases.flatMap((entry) => [entry.canonicalId, ...entry.aliases]));
    expect(audit.walked_case_ids).toHaveLength(30);
    expect(REVISION_REGISTRY_IDS).toHaveLength(12);
    expect(new Set(REVISION_REGISTRY_IDS).size).toBe(REVISION_REGISTRY_IDS.length);
    expect(new Set(REVISION_REGISTRY_MODEL_STRUCTURE_IDS).size).toBe(REVISION_REGISTRY_MODEL_STRUCTURE_IDS.length);
    expect(catalog.cases.every((entry) => entry.negativeControlRequired)).toBe(true);
    expect(audit.walked_case_ids.filter((id) => !acceptedCaseIds.has(id))).toEqual([]);
    expect(audit.violations).toEqual([]);
  });

  it("negative control: an empty family walk is incomplete, never green", async () => {
    const audit = await auditRevisionCatalogClosure(process.cwd(), []);
    expect(audit.violations).toContain("revision_catalog_walk_empty");
  });

  it("negative control: a detector family whose seeded violation never fires is refused", async () => {
    const seeded = REVISION_FAMILY_EVIDENCE[0]!;
    const audit = await auditRevisionCatalogClosure(process.cwd(), [
      {
        ...seeded,
        seeded_detector_marker: "this seeded detector marker does not exist",
      },
    ]);
    expect(audit.violations).toContain(`revision_detector_never_fired:${seeded.case_ids.join(",")}`);
  });

  it("negative control: host-policy drift from the production catalog content pin is refused", async () => {
    const path = join(process.cwd(), HOST_POLICY_RELATIVE_PATH);
    const policy = await readFile(path, "utf8");
    const drifted = policy.replace(RATIFIED_VALIDATION_CATALOG_CONTENT_SHA256, "f".repeat(64));
    const audit = await auditRevisionCatalogClosure(process.cwd(), REVISION_FAMILY_EVIDENCE, drifted);
    expect(audit.violations).toContain("revision_catalog_pin_mismatch");
  });

  it("negative control: a drifted host revision id is refused", async () => {
    const path = join(process.cwd(), HOST_POLICY_RELATIVE_PATH);
    const policy = await readFile(path, "utf8");
    const drifted = policy.replace(
      "roadmap-validation-delivery-batching-2026-08-03",
      "roadmap-validation-delivery-batching-drift",
    );
    const audit = await auditRevisionCatalogClosure(process.cwd(), REVISION_FAMILY_EVIDENCE, drifted);
    expect(audit.violations).toContain("revision_id_mismatch");
  });

  it("negative control: prose mentioning an alias cannot substitute for an exact generated family row", () => {
    const markdown = [
      "| Family | Title | Protected meaning |",
      "| --- | --- | --- |",
      "| CF-REAL | Real | Mentions CF-B20-* only in prose. |",
      "",
    ].join("\n");
    expect([...parseGeneratedTableIds(markdown, "Family")]).toEqual(["CF-REAL"]);
    expect(parseGeneratedTableIds(markdown, "Family").has("CF-B20-*")).toBe(false);
  });

  it("negative control: prose cannot satisfy a missing mapped model structure", () => {
    const markdown = [
      "| Structure | Kind | Protected meaning |",
      "| --- | --- | --- |",
      "| M18 | operation | Mentions SM-ROADMAP and SM-VALIDATION only in prose. |",
      "",
    ].join("\n");
    const ids = parseGeneratedTableIds(markdown, "Structure");
    expect(missingRevisionRegistryModelStructures(ids)).toContain("M17");
  });

  it("negative control: every canonical registry identity requires its complete checked-model disposition", () => {
    const withoutValidationState = new Set(
      REVISION_REGISTRY_MODEL_STRUCTURE_IDS.filter((id) => id !== "SM-VALIDATION"),
    );
    expect(missingRevisionRegistryModelStructures(withoutValidationState)).toContain("M17");
    const withoutBoundaryContract = new Set(
      REVISION_REGISTRY_MODEL_STRUCTURE_IDS.filter((id) => id !== "CONTRACT-B-20"),
    );
    expect(missingRevisionRegistryModelStructures(withoutBoundaryContract)).toContain("CORMIDIA-C-B20-001");
    expect(
      missingRevisionRegistryModelStructures(new Set(), [{ registry_id: "EMPTY", model_structure_ids: [] }]),
    ).toEqual(["EMPTY"]);
    expect(
      missingRevisionRegistryModelStructures(new Set([""]), [{ registry_id: "BLANK", model_structure_ids: [""] }]),
    ).toEqual(["BLANK"]);
  });
});
