import { FakeRepositoryPort, check } from "validation-architect";
import { join } from "node:path";

import { MIGRATION, compileModelFiles } from "./migration-contract.mjs";
import { preflightWriteTargets } from "./migration-filesystem.mjs";
import { assertExactMigrationOutput, assertExactViews } from "./migration-output.mjs";
import { runReaderNegativeControls } from "./migration-reader-controls.mjs";
import { generatedArtifactProblems } from "./migration-reader.mjs";
import { assertExactModelInventoryNames, graphOf, redFindings } from "./migration-repository.mjs";
import { readRepoRegularText } from "./migration-source-filesystem.mjs";

const clone = (value) => structuredClone(value);

function detected(controls, id, detail) {
  controls.push({ id, result: "detected", detail });
}

function expectThrow(controls, id, operation) {
  try {
    operation();
  } catch (error) {
    detected(controls, id, error instanceof Error ? error.message : String(error));
    return;
  }
  throw new Error(`negative control ${id} did not fail`);
}

async function expectAsyncThrow(controls, id, operation) {
  try {
    await operation();
  } catch (error) {
    detected(controls, id, error instanceof Error ? error.message : String(error));
    return;
  }
  throw new Error(`negative control ${id} did not fail`);
}

function expectProblems(controls, id, problems, match) {
  const selected = problems.find((problem) => problem.includes(match));
  if (!selected) throw new Error(`negative control ${id} did not detect ${match}: ${problems.join("; ")}`);
  detected(controls, id, selected);
}

function outputShapeControls(migration, compilation, controls) {
  expectThrow(controls, "preexisting-extra-model-entry", () =>
    assertExactModelInventoryNames([...MIGRATION.modelNames, "unexpected.yaml"]),
  );
  const unexpected = clone(migration);
  unexpected.files.push({ path: "package.json", content: "{}\n" });
  expectThrow(controls, "unexpected-model-output", () => assertExactMigrationOutput(unexpected));

  const duplicate = clone(migration);
  duplicate.files.push(clone(duplicate.files[0]));
  expectThrow(controls, "duplicate-model-output", () => assertExactMigrationOutput(duplicate));

  const missing = clone(migration);
  missing.files.pop();
  expectThrow(controls, "missing-model-output", () => assertExactMigrationOutput(missing));

  const nonString = clone(migration);
  nonString.files[0].content = null;
  expectThrow(controls, "non-string-model-output", () => assertExactMigrationOutput(nonString));

  const views = { ...compilation.views, "unexpected.md": "unexpected\n" };
  expectThrow(controls, "unexpected-generated-view", () => assertExactViews(views));

  const missingView = { ...compilation.views };
  delete missingView[MIGRATION.viewNames[0]];
  expectThrow(controls, "missing-generated-view", () => assertExactViews(missingView));
}

async function writeGuardControls(controls) {
  await expectAsyncThrow(controls, "write-target-directory", () => preflightWriteTargets([MIGRATION.designRoot]));
  await expectAsyncThrow(controls, "write-nonregular-ancestor", () =>
    preflightWriteTargets([join(MIGRATION.designRoot, "migration", "review.yaml", "child")]),
  );
  await expectAsyncThrow(controls, "write-symlink-ancestor", () =>
    preflightWriteTargets([join(MIGRATION.repoRoot, "node_modules", "validation-architect", "child")]),
  );
  await expectAsyncThrow(controls, "write-target-escape", () =>
    preflightWriteTargets([join(MIGRATION.repoRoot, "..", "escaped")]),
  );
  const duplicate = join(MIGRATION.designRoot, "migration", "semantic-equivalence.yaml");
  await expectAsyncThrow(controls, "write-target-duplicate", () => preflightWriteTargets([duplicate, duplicate]));
}

async function sourceReadControls(controls) {
  await expectAsyncThrow(controls, "reviewed-source-escape", () =>
    readRepoRegularText(MIGRATION.repoRoot, "../escaped.md"),
  );
  await expectAsyncThrow(controls, "reviewed-source-nonregular", () =>
    readRepoRegularText(MIGRATION.repoRoot, "validation-design"),
  );
  await expectAsyncThrow(controls, "reviewed-source-symlink", () =>
    readRepoRegularText(MIGRATION.repoRoot, "node_modules/validation-architect/package.json"),
  );
}

async function generatedArtifactControls(modelFiles, views, reportText, compilation, controls) {
  const staleViews = { ...modelFiles, ...views };
  staleViews["validation-design/case-catalog.md"] = `${staleViews["validation-design/case-catalog.md"]}\nSTALE\n`;
  const staleCompile = await compileModelFiles(staleViews);
  if (!staleCompile.findings.some((finding) => finding.code === "GENERATED_VIEW_STALE")) {
    throw new Error("stale generated view was not detected");
  }
  detected(controls, "stale-generated-view", "GENERATED_VIEW_STALE");

  expectProblems(
    controls,
    "stale-compiler-report",
    generatedArtifactProblems(compilation, views, `${reportText}\nSTALE\n`),
    "compiler-report.json",
  );
  expectProblems(
    controls,
    "missing-compiler-report",
    generatedArtifactProblems(compilation, views, undefined),
    "compiler-report.json",
  );
}

async function implementationControls(model, factFiles, controls) {
  const landedFamily = model.families.find(
    (family) =>
      family.status === "implementable" &&
      family.planned_tests?.some((path) => factFiles[path] !== undefined) &&
      model.tickets.find((ticket) => ticket.id === family.ticket)?.status === "landed",
  );
  if (!landedFamily) throw new Error("no landed test family available for absence control");
  const missingPath = landedFamily.planned_tests.find((path) => factFiles[path] !== undefined);
  const missingFiles = { ...factFiles };
  delete missingFiles[missingPath];
  const missing = await check(new FakeRepositoryPort({ revision: MIGRATION.productRevision, files: missingFiles }), {
    testsRoot: "tests",
  });
  const missingFinding = graphOf(missing).findings.find(
    (finding) =>
      ["PLANNED_IMPLEMENTATION_DRIFT", "LANDED_STATUS_FALSE"].includes(finding.code) &&
      [landedFamily.id, landedFamily.ticket].includes(finding.subject_id),
  );
  if (missing.verdict !== "fail" || !missingFinding) {
    throw new Error("landed missing implementation did not turn its exact family/ticket red");
  }
  detected(controls, "landed-implementation-absence", `${landedFamily.id}:${missingPath}`);

  const headerFamily = model.families.find(
    (family) =>
      model.tickets.find((ticket) => ticket.id === family.ticket)?.status === "landed" &&
      family.planned_tests?.some((path) => /^\s*(?:\/\/[^\n]*|\/\*[\s\S]*?\*\/)/.test(factFiles[path] ?? "")),
  );
  const headerPath = headerFamily?.planned_tests.find((path) =>
    /^\s*(?:\/\/[^\n]*|\/\*[\s\S]*?\*\/)/.test(factFiles[path] ?? ""),
  );
  if (!headerPath) throw new Error("landed header negative control has no observed comment header");
  const headerFiles = { ...factFiles };
  const original = headerFiles[headerPath];
  headerFiles[headerPath] = original.replace(/^\s*(\/\/[^\n]*|\/\*[\s\S]*?\*\/)/, "// CF-HEADER-LIE — HB-HEADER-LIE");
  if (headerFiles[headerPath] === original) throw new Error("legacy-header seed did not mutate the first comment");
  const header = await check(new FakeRepositoryPort({ revision: MIGRATION.productRevision, files: headerFiles }), {
    testsRoot: "tests",
  });
  const headerGraph = graphOf(header);
  if (redFindings(headerGraph).length > 0 || headerGraph.nodes.some((node) => node.id === "CF-HEADER-LIE")) {
    throw new Error("legacy header text displaced planned_tests authority");
  }
  detected(controls, "legacy-header-non-authority", `${headerPath} remains linked only through planned_tests`);

  const orphan = await check(
    new FakeRepositoryPort({
      revision: MIGRATION.productRevision,
      files: {
        ...factFiles,
        "tests/cf-header-only/header-only.test.ts": "// CF-J01-S — HB-015\nit('header only', () => {});\n",
      },
    }),
    { testsRoot: "tests" },
  );
  if (!graphOf(orphan).findings.some((finding) => finding.code === "ORPHAN_TEST" && finding.level === "red")) {
    throw new Error("unplanned header-only spec did not turn red");
  }
  detected(controls, "unplanned-header-only-spec", "ORPHAN_TEST");
}

export async function runRepositoryNegativeControls({
  migration,
  compilation,
  model,
  modelFiles,
  views,
  reportText,
  factFiles,
  readerRecord,
  bundleText,
}) {
  const controls = [];
  await writeGuardControls(controls);
  await sourceReadControls(controls);
  outputShapeControls(migration, compilation, controls);
  await generatedArtifactControls(modelFiles, views, reportText, compilation, controls);
  controls.push(...runReaderNegativeControls(model, views, readerRecord, bundleText, compilation.identity));
  await implementationControls(model, factFiles, controls);
  return controls;
}
