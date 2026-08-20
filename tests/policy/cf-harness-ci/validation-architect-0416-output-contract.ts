// Imported by validation-architect-0416-contract.test.ts: exact 0.4.16
// per-output oracle/risk review semantics without creating a second spec path.

import { compile, CORPUS_SCHEMA, FakeRepositoryPort, migrate, type LegacyModelImportInput } from "validation-architect";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";

const revision = "a".repeat(40);

interface ContractFixture {
  catalog: string;
  backlog: string;
  review: () => LegacyModelImportInput;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function migrateReview(fixture: ContractFixture, value: LegacyModelImportInput) {
  return migrate(
    { kind: "legacy-catalog", catalogMarkdown: fixture.catalog, backlogMarkdown: fixture.backlog, review: value },
    CORPUS_SCHEMA,
  );
}

async function migratedFamily(
  fixture: ContractFixture,
  value: LegacyModelImportInput,
  id: string,
): Promise<Record<string, unknown>> {
  const migrated = migrateReview(fixture, value);
  const files = Object.fromEntries(migrated.files.map((file) => [file.path, file.content]));
  const compiled = await compile(new FakeRepositoryPort({ revision, files }));
  expect(compiled.accepted, compiled.findings.map((finding) => finding.message).join("\n")).toBe(true);

  const familyFile = migrated.files.find((file) => file.path === "validation-design/model/families.yaml");
  if (!familyFile) throw new Error("0.4.16 migration omitted families.yaml");
  const document: unknown = parse(familyFile.content);
  if (!isRecord(document) || !Array.isArray(document["families"])) {
    throw new Error("0.4.16 migration produced malformed families.yaml");
  }
  const family = document["families"].find((candidate) => isRecord(candidate) && candidate["id"] === id);
  if (!isRecord(family)) throw new Error(`0.4.16 migration omitted family ${id}`);
  return family;
}

function splitOutput(value: LegacyModelImportInput, id: string) {
  const output = value.families["CF-SPLIT"]?.outputs?.find((candidate) => candidate.id === id);
  if (!output) throw new Error(`split family fixture output ${id} missing`);
  return output;
}

export function registerValidationArchitect0416OutputContractTests(fixture: ContractFixture): void {
  describe("Validation Architect 0.4.16 per-output oracle/risk review", () => {
    it("preserves distinct reviewed oracle and risk values on split outputs", async () => {
      const value = fixture.review();
      const l1 = splitOutput(value, "CF-SPLIT");
      l1.oracle = "exact contract refusal";
      l1.risk = "E1 contract regression";
      const l2 = splitOutput(value, "CF-SPLIT-L2");
      l2.oracle = "deterministic process state";
      l2.risk = "E2 hermetic integration drift";

      await expect(migratedFamily(fixture, value, "CF-SPLIT")).resolves.toMatchObject({
        oracle: "exact contract refusal",
        risk: "E1 contract regression",
      });
      await expect(migratedFamily(fixture, value, "CF-SPLIT-L2")).resolves.toMatchObject({
        oracle: "deterministic process state",
        risk: "E2 hermetic integration drift",
      });
    });

    it("falls back exactly to the legacy family oracle and risk when outputs omit overrides", async () => {
      const value = fixture.review();
      await expect(migratedFamily(fixture, value, "CF-SPLIT")).resolves.toMatchObject({
        oracle: "state",
        risk: "E1",
      });
      await expect(migratedFamily(fixture, value, "CF-SPLIT-L2")).resolves.toMatchObject({
        oracle: "state",
        risk: "E1",
      });
    });

    it.each([
      ["oracle", ""],
      ["oracle", "   "],
      ["risk", ""],
      ["risk", "   "],
    ] as const)("refuses a blank per-output %s review value %j", (field, invalidValue) => {
      const value = fixture.review();
      Object.assign(splitOutput(value, "CF-SPLIT"), { [field]: invalidValue });
      expect(() => migrateReview(fixture, value)).toThrow(new RegExp(`needs a non-empty reviewed ${field}`));
    });
  });
}
