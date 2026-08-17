#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { FakeRepositoryPort, check } from "validation-architect";
import { parse, stringify } from "yaml";

import { closureProblems } from "./migration-closure.mjs";
import { runClosureNegativeControls } from "./migration-closure-controls.mjs";
import {
  MIGRATION,
  assertPinnedInputs,
  buildMigrationLedger,
  compileModelFiles,
  migrateReviewedCorpus,
  readMigrationInputs,
  resolvedPackageVersion,
  structurallyEqual,
} from "./migration-contract.mjs";
import { lstatIfExists, retiredRootPresence, writeArtifactsSafely } from "./migration-filesystem.mjs";
import { runInputNegativeControls } from "./migration-input-controls.mjs";
import { ledgerBindingProblems, ledgerEquivalenceProblems } from "./migration-ledger-equivalence.mjs";
import {
  activeAuthorityProblems,
  assembleModel,
  modelEquivalenceProblems,
  policyProblems,
  retiredAuthorityProblems,
  reviewedLegacyMeaningProblems,
} from "./migration-model-equivalence.mjs";
import {
  assertExactMigrationOutput,
  assertExactViews,
  completeRepositoryFiles,
  readerBundleText,
} from "./migration-output.mjs";
import { freshReaderProblems, generatedArtifactProblems, readerReviewProblems } from "./migration-reader.mjs";
import { buildSemanticReport } from "./migration-report.mjs";
import { reviewEquivalenceProblems } from "./migration-review-equivalence.mjs";
import { runRepositoryNegativeControls } from "./migration-repository-controls.mjs";
import { graphOf, readCommittedCorpus, repositoryFactsFiles, reviewSourceTexts } from "./migration-repository.mjs";
import { reviewFidelityProblems } from "./review-fidelity.mjs";

function assertNoProblems(label, problems) {
  if (problems.length > 0) throw new Error(`${label} failed:\n- ${problems.join("\n- ")}`);
}

async function readRegularText(path, label, optional = false) {
  const entry = await lstatIfExists(path);
  if (entry === null && optional) return null;
  if (entry === null || !entry.isFile() || entry.isSymbolicLink()) {
    throw new Error(`${label} must be ${optional ? "absent or " : ""}one regular file`);
  }
  return readFile(path, "utf8");
}

function assertDeterministicCompilation(first, second) {
  assertExactViews(first.views);
  assertExactViews(second.views);
  if (!structurallyEqual(first, second)) throw new Error("two identical public compile() calls differed");
  if (
    !first.accepted ||
    !first.identity ||
    first.report.record.accepted !== true ||
    first.report.record.diagnostics.length !== 0
  ) {
    throw new Error("public compile() did not accept the exact migrated model without diagnostics");
  }
  const stale = first.findings.filter((finding) => finding.code === "GENERATED_VIEW_STALE");
  if (
    first.findings.length !== MIGRATION.viewNames.length ||
    stale.length !== MIGRATION.viewNames.length ||
    !structurallyEqual(stale.map((finding) => finding.concept).sort(), [...MIGRATION.viewNames].sort())
  ) {
    throw new Error("model-only compile did not report exactly the five absent generated views");
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== "--write")) {
    throw new Error("usage: node validation-design/migration/verify-migration.mjs [--write]");
  }
  const write = args[0] === "--write";
  const version = await resolvedPackageVersion();
  if (version !== MIGRATION.packageVersion) {
    throw new Error(`migration requires validation-architect ${MIGRATION.packageVersion}; resolved ${version}`);
  }
  const input = await readMigrationInputs();
  assertPinnedInputs(input);
  const fidelitySources = {
    backlogMarkdown: input.backlogMarkdown,
    systemMapText: input.reviewedSourceText["validation-design/system-map.md"],
    journeyAcceptanceText: input.reviewedSourceText["validation-design/contracts/journey-acceptance.md"],
    boundaryMapText: input.reviewedSourceText["validation-design/boundary-map.md"],
    sourceTexts: reviewSourceTexts(input),
  };
  assertNoProblems("review fidelity", reviewFidelityProblems({ review: input.review, ...fidelitySources }));
  assertNoProblems("review authority equivalence", reviewEquivalenceProblems(input));
  assertNoProblems("archived family-meaning fidelity", reviewedLegacyMeaningProblems(input));

  const firstMigration = migrateReviewedCorpus(input);
  const secondMigration = migrateReviewedCorpus(input);
  if (!structurallyEqual(firstMigration, secondMigration)) {
    throw new Error("two identical public migrate() calls differed");
  }
  const expectedModelFiles = assertExactMigrationOutput(firstMigration);
  assertExactMigrationOutput(secondMigration);
  const firstCompile = await compileModelFiles(expectedModelFiles);
  const secondCompile = await compileModelFiles(expectedModelFiles);
  assertDeterministicCompilation(firstCompile, secondCompile);
  const closedCompile = await compileModelFiles(completeRepositoryFiles(expectedModelFiles, firstCompile.views));
  if (
    !closedCompile.accepted ||
    closedCompile.findings.length !== 0 ||
    closedCompile.identity !== firstCompile.identity ||
    closedCompile.report.content !== firstCompile.report.content
  ) {
    throw new Error("generated views/report do not close over the exact migrated model");
  }

  assertPinnedInputs(input, { requireFinalPins: true, modelIdentity: firstCompile.identity });
  const committed = await readCommittedCorpus();
  if (!structurallyEqual(committed.modelFiles, expectedModelFiles)) {
    throw new Error("committed model bytes differ from public migrate() output");
  }
  assertNoProblems(
    "generated artifacts",
    generatedArtifactProblems(firstCompile, committed.views, committed.reportText),
  );
  const model = assembleModel(committed.parsedFiles);

  const ledgerPath = join(MIGRATION.designRoot, "migration", "migration-ledger.yaml");
  const ledgerText = await readRegularText(ledgerPath, "migration ledger");
  const ledger = parse(ledgerText);
  const expectedLedger = buildMigrationLedger(input, firstMigration, firstCompile);
  const expectedLedgerText = stringify(expectedLedger, { lineWidth: 0 });
  assertNoProblems(
    "migration ledger binding",
    ledgerBindingProblems(ledger, expectedLedger, ledgerText, expectedLedgerText),
  );
  assertNoProblems("review/model equivalence", modelEquivalenceProblems(input, model));
  assertNoProblems("ledger/model equivalence", ledgerEquivalenceProblems(input, model, ledger));
  assertNoProblems("policy equivalence", policyProblems(model.policy, model, input.hostPolicy));
  assertNoProblems("active authority", activeAuthorityProblems(model));
  assertNoProblems("retired authority", retiredAuthorityProblems(await retiredRootPresence()));
  assertNoProblems("fresh-reader projections", freshReaderProblems(model, committed.views));

  const bundleText = readerBundleText(firstCompile.identity, firstCompile.views, firstCompile.report.content);
  const committedBundleText = await readRegularText(
    join(MIGRATION.designRoot, "reader-bundle-identity.json"),
    "reader bundle identity",
  );
  if (committedBundleText !== bundleText) throw new Error("reader bundle identity bytes are missing or stale");
  const readerRecordText = await readRegularText(
    join(MIGRATION.designRoot, "migration", "reader-reviews.yaml"),
    "reader review record",
    true,
  );
  const readerRecord = readerRecordText === null ? null : parse(readerRecordText);
  if (readerRecordText !== null && readerRecord === null) {
    throw new Error("reader review record root must be an object");
  }
  assertNoProblems("reader reviews", readerReviewProblems(readerRecord, bundleText, firstCompile.identity));

  const factFiles = await repositoryFactsFiles(committed.modelFiles, committed.views, committed.reportText, model);
  const baseResult = await check(new FakeRepositoryPort({ revision: MIGRATION.productRevision, files: factFiles }), {
    testsRoot: "tests",
  });
  const baseGraph = graphOf(baseResult);
  assertNoProblems(
    "repository closure",
    closureProblems({
      result: baseResult,
      graph: baseGraph,
      model,
      factFiles,
      modelIdentity: firstCompile.identity,
      productRevision: MIGRATION.productRevision,
    }),
  );

  const controls = runInputNegativeControls({
    input,
    migration: firstMigration,
    model,
    ledger,
    expectedLedger,
    ledgerText,
    expectedLedgerText,
    fidelitySources,
  });
  controls.push(
    ...(await runRepositoryNegativeControls({
      migration: firstMigration,
      compilation: firstCompile,
      model,
      modelFiles: committed.modelFiles,
      views: committed.views,
      reportText: committed.reportText,
      factFiles,
      readerRecord,
      bundleText,
    })),
  );
  controls.push(
    ...runClosureNegativeControls({
      result: baseResult,
      graph: baseGraph,
      model,
      factFiles,
      modelIdentity: firstCompile.identity,
      productRevision: MIGRATION.productRevision,
    }),
  );
  const report = buildSemanticReport({
    input,
    version,
    compilation: firstCompile,
    model,
    ledger,
    baseResult,
    baseGraph,
    bundleText,
    readerRecord,
    readerRecordText,
    controls,
  });
  const reportText = stringify(report, { lineWidth: 0 });
  if (reportText.includes(MIGRATION.repoRoot)) {
    throw new Error("semantic-equivalence.yaml embeds the absolute checkout path");
  }
  const reportPath = join(MIGRATION.designRoot, "migration", "semantic-equivalence.yaml");
  if (write) await writeArtifactsSafely([{ path: reportPath, content: reportText }]);
  else if ((await readRegularText(reportPath, "semantic equivalence report")) !== reportText) {
    throw new Error("semantic-equivalence.yaml is missing or stale; run verify-migration.mjs --write after review");
  }
  process.stdout.write(
    `Verified exact migration/model/reader closure at ${MIGRATION.productRevision}; model ${firstCompile.identity}; ${controls.length} negative controls detected.\n`,
  );
}

await main();
