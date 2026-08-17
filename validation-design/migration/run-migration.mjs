#!/usr/bin/env node

// Sole legacy-to-model conversion path for #465. The reviewed mapping is
// static input; every model/view/report byte comes from the public package API.

import { stringify } from "yaml";

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
import {
  assertExactMigrationOutput,
  assertExactViews,
  completeRepositoryFiles,
  writeMigrationArtifacts,
} from "./migration-output.mjs";
import { reviewedLegacyMeaningProblems } from "./migration-model-equivalence.mjs";
import { reviewEquivalenceProblems } from "./migration-review-equivalence.mjs";
import { reviewSourceTexts } from "./migration-repository.mjs";
import { reviewFidelityProblems } from "./review-fidelity.mjs";

function assertNoProblems(label, problems) {
  if (problems.length > 0) throw new Error(`${label} failed:\n- ${problems.join("\n- ")}`);
}

async function main() {
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
    throw new Error("two identical public migrate() calls produced different data");
  }
  const modelFiles = assertExactMigrationOutput(firstMigration);

  const firstCompile = await compileModelFiles(modelFiles);
  const secondCompile = await compileModelFiles(modelFiles);
  assertExactViews(firstCompile.views);
  assertExactViews(secondCompile.views);
  if (
    !structurallyEqual(firstCompile, secondCompile) ||
    !firstCompile.accepted ||
    !firstCompile.identity ||
    firstCompile.report.record.accepted !== true ||
    firstCompile.report.record.diagnostics.length !== 0
  ) {
    throw new Error("two identical public compile() calls were not accepted and byte-identical");
  }
  const closedCompile = await compileModelFiles(completeRepositoryFiles(modelFiles, firstCompile.views));
  if (
    !closedCompile.accepted ||
    closedCompile.findings.length !== 0 ||
    closedCompile.identity !== firstCompile.identity ||
    closedCompile.report.content !== firstCompile.report.content
  ) {
    throw new Error("generated views and canonical compiler report do not close over the migrated model");
  }

  // This is deliberately immediately before the first write. Parent must fill
  // both final pins after 0.4.6 and the final preparation squash are fixed.
  assertPinnedInputs(input, { requireFinalPins: true, modelIdentity: firstCompile.identity });
  const ledger = buildMigrationLedger(input, firstMigration, firstCompile);
  const ledgerText = stringify(ledger, { lineWidth: 0 });
  await writeMigrationArtifacts({ migration: firstMigration, compilation: firstCompile, ledgerText });

  process.stdout.write(
    `Migrated ${ledger.counts.legacy_family_sources} family sources to ${ledger.counts.canonical_family_outputs} outputs and ${ledger.counts.legacy_ticket_sources} ticket sources at ${MIGRATION.productRevision}; model ${firstCompile.identity}.\n`,
  );
}

await main();
