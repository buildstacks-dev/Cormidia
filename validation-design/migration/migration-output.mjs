import { join } from "node:path";

import { MIGRATION, sha256, stableJson, structurallyEqual } from "./migration-contract.mjs";
import { writeArtifactsSafely } from "./migration-filesystem.mjs";

function sameSet(left, right) {
  return structurallyEqual([...left].sort(), [...right].sort());
}

export function assertExactMigrationOutput(migration) {
  if (!Array.isArray(migration.files)) throw new Error("public migrate() output lacks a files array");
  const expected = MIGRATION.modelNames.map((name) => `validation-design/model/${name}`);
  const paths = migration.files.map((file) => file.path);
  if (paths.length !== new Set(paths).size) throw new Error("public migrate() returned duplicate model paths");
  if (!sameSet(paths, expected)) {
    throw new Error(`public migrate() paths differ from the exact eight-file set: ${paths.join(", ")}`);
  }
  for (const file of migration.files) {
    if (typeof file.path !== "string" || typeof file.content !== "string") {
      throw new Error("public migrate() returned a non-string model path or content");
    }
  }
  return Object.fromEntries(migration.files.map((file) => [file.path, file.content]));
}

export function assertExactViews(views) {
  if (views === null || typeof views !== "object" || Array.isArray(views)) {
    throw new Error("public compile() views must be a path-to-content object");
  }
  const names = Object.keys(views);
  if (!sameSet(names, MIGRATION.viewNames)) {
    throw new Error(`public compile() views differ from the exact five-view set: ${names.join(", ")}`);
  }
  for (const name of names) {
    if (typeof views[name] !== "string") throw new Error(`public compile() view ${name} is not a string`);
  }
  return views;
}

export function completeRepositoryFiles(modelFiles, views) {
  assertExactViews(views);
  return {
    ...modelFiles,
    ...Object.fromEntries(MIGRATION.viewNames.map((name) => [`validation-design/${name}`, views[name]])),
  };
}

export function buildReaderBundle(modelIdentity, views, reportText) {
  assertExactViews(views);
  const paths = [
    ...MIGRATION.viewNames.map((name) => `validation-design/${name}`),
    "validation-design/compiler-report.json",
  ];
  const bytes = {
    ...Object.fromEntries(MIGRATION.viewNames.map((name) => [`validation-design/${name}`, views[name]])),
    "validation-design/compiler-report.json": reportText,
  };
  return {
    schema: "cormidia/validation-architect-reader-bundle/v1",
    product_revision: MIGRATION.productRevision,
    model_identity: modelIdentity,
    artifacts: paths.map((path) => ({ path, sha256: sha256(bytes[path]) })),
    exclusions: [
      "validation-design/model/*.yaml",
      "validation-design/migration/**",
      "authored rationale and product documentation",
      "campaign transcript and repository history",
    ],
  };
}

export function readerBundleText(modelIdentity, views, reportText) {
  return stableJson(buildReaderBundle(modelIdentity, views, reportText));
}

export async function writeMigrationArtifacts({ migration, compilation, ledgerText }) {
  const modelFiles = assertExactMigrationOutput(migration);
  const views = assertExactViews(compilation.views);
  const bundleText = readerBundleText(compilation.identity, views, compilation.report.content);
  const artifacts = [
    ...MIGRATION.modelNames.map((name) => ({
      path: join(MIGRATION.designRoot, "model", name),
      content: modelFiles[`validation-design/model/${name}`],
    })),
    ...MIGRATION.viewNames.map((name) => ({ path: join(MIGRATION.designRoot, name), content: views[name] })),
    {
      path: join(MIGRATION.designRoot, "compiler-report.json"),
      content: compilation.report.content,
    },
    {
      path: join(MIGRATION.designRoot, "migration", "migration-ledger.yaml"),
      content: ledgerText,
    },
    {
      path: join(MIGRATION.designRoot, "reader-bundle-identity.json"),
      content: bundleText,
    },
  ];
  await writeArtifactsSafely(artifacts);
  return { modelFiles, bundleText };
}
