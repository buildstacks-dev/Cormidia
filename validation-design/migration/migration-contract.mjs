import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { CORPUS_SCHEMA, FakeRepositoryPort, compile, migrate } from "validation-architect";
import { parse } from "yaml";

import { readRepoRegularBytes, readRepoRegularText } from "./migration-source-filesystem.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const designRoot = join(repoRoot, "validation-design");
const legacyRoot = join(here, "legacy");

export const MIGRATION = Object.freeze({
  packageVersion: "0.4.6",
  productRevision: "c4d9eb341cccaff59af84eb2589bfa37cbbfd1d7",
  upstreamRevision: "52a7b26b5b4de934612640c3d47ba7c738596ece",
  artifact: Object.freeze({
    path: "vendor/validation-architect-0.4.6.tgz",
    sha256: "1e396fdb7fe2e6ea2e479628e344c6283a5ae7f4cb95a86dfba8601a7cfd66c5",
    integrity: "sha512-6wRhOH8+80Knr1H7FTYYjAZcpGpG4ZiveCXSv6ddk1eaab11Rd5tiFr0l3CSR1TcTw/lSVEjXtV2pRVOYpcFHA==",
    bytes: 268_051,
    entries: 124,
  }),
  modelNames: Object.freeze([
    "project.yaml",
    "owners.yaml",
    "sources.yaml",
    "structures.yaml",
    "policy.yaml",
    "controls.yaml",
    "families.yaml",
    "backlog.yaml",
  ]),
  viewNames: Object.freeze([
    "case-catalog.md",
    "harness-backlog.md",
    "owner-briefing.md",
    "owner-backlog.md",
    "planned-trace.md",
  ]),
  retiredRootNames: Object.freeze(["validation-policy.yaml", "case-catalog.yaml", "case-catalog-generator.awk"]),
  legacySourceHashes: Object.freeze({
    "case-catalog-generator.awk": "07a8ca3fd5975d9b3ee65ec04cb2cef81eada5a3afbff64934fbebc7b5568f05",
    "case-catalog.md": "69777f75c509997fb378b86c8b119827a0f81c0fa0d975a9f138965f10d71059",
    "case-catalog.yaml": "0da6e3dd2751b619a5f7b47053d8cfb2298f83cddc659b8762cc8b3477d952a0",
    "harness-backlog.md": "213bf2e521d842920577aba2e41fb040a78885e534ca1c8d8ea59f68953924ca",
    "validation-policy.yaml": "9ecb34132c47d1e1488388e6a3e3785bff6a5bb93fab2ccc1ed04f5a8dfb5964",
  }),
  supportSourceHashes: Object.freeze({
    host_policy_sha256: "c0ea9e20b3b0b3ffb11c2c69a4592fc07b5d952ed2020d4b8eb11e705458efa5",
    authority_domain_split_sha256: "4fbe1377b38f58f887551712e1cc31b735d90251037979e64037012564829545",
    migration_bootstrap_decision_sha256: "c80624b77822e3fa6900693f3fb766167af70bc1a10974c42a6731de911a73dc",
  }),
  // Fill both only after review.yaml is deterministically rematerialized at
  // the final preparation squash. Migration refuses final output while null.
  finalPins: Object.freeze({
    reviewSha256: "959bc5dab145523cb70faa9828a6d73561c0f4e1dcd85f7fb6bf076c697adf2a",
    modelIdentity: "2ea4d12b7f6b0fc7c29eb26562fa79b6044ed2fc53026211e52a35b45a219c81",
  }),
  repoRoot,
  designRoot,
  legacyRoot,
});

export const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const sha512Integrity = (value) => `sha512-${createHash("sha512").update(value).digest("base64")}`;
export const stableJson = (value) => `${JSON.stringify(value, null, 2)}\n`;
export const structurallyEqual = (left, right) => JSON.stringify(left) === JSON.stringify(right);

export async function resolvedPackageVersion() {
  const packagePath = fileURLToPath(import.meta.resolve("validation-architect/package.json"));
  const metadata = JSON.parse(await readFile(packagePath, "utf8"));
  if (metadata === null || typeof metadata !== "object" || typeof metadata.version !== "string") {
    throw new Error("resolved validation-architect package metadata lacks a string version");
  }
  return metadata.version;
}

function safeReviewedPath(path) {
  return (
    typeof path === "string" &&
    path.length > 0 &&
    !path.startsWith("/") &&
    !path.includes("\\") &&
    !path.includes("\0") &&
    !path.split("/").includes("..")
  );
}

export async function readMigrationInputs() {
  const legacyEntries = await Promise.all(
    Object.keys(MIGRATION.legacySourceHashes).map(async (name) => [
      name,
      await readRepoRegularText(MIGRATION.repoRoot, `validation-design/migration/legacy/${name}`),
    ]),
  );
  const legacy = Object.fromEntries(legacyEntries);
  const [reviewText, hostPolicyText, domainSplitText, bootstrapDecisionText, artifact] = await Promise.all([
    readRepoRegularText(MIGRATION.repoRoot, "validation-design/migration/review.yaml"),
    readRepoRegularText(MIGRATION.repoRoot, "docs/qualification/host-policy.yaml"),
    readRepoRegularText(MIGRATION.repoRoot, "research/2026-08-16_validation-authority-domain-split.md"),
    readRepoRegularText(MIGRATION.repoRoot, "research/2026-08-15_validation-architect-model-migration-bootstrap.md"),
    readRepoRegularBytes(MIGRATION.repoRoot, MIGRATION.artifact.path),
  ]);
  const review = parse(reviewText);
  if (review === null || typeof review !== "object" || !Array.isArray(review.sources)) {
    throw new Error("review.yaml must parse to an object with a sources array");
  }
  for (const [index, source] of review.sources.entries()) {
    if (source === null || typeof source !== "object" || Array.isArray(source)) {
      throw new Error(`review.sources[${index}] must be an object`);
    }
    if (typeof source.id !== "string" || source.id.length === 0) {
      throw new Error(`review.sources[${index}].id must be a non-empty string`);
    }
    if (source.path !== undefined && !safeReviewedPath(source.path)) {
      throw new Error(`review.sources[${index}].path must be a safe non-empty relative path when present`);
    }
  }
  const reviewedSourcePaths = [...new Set(review.sources.map((source) => source.path).filter(Boolean))].sort();
  for (const path of reviewedSourcePaths) {
    if (!safeReviewedPath(path)) throw new Error(`reviewed source path is unsafe: ${String(path)}`);
  }
  const reviewedSourceText = Object.fromEntries(
    await Promise.all(
      reviewedSourcePaths.map(async (path) => [path, await readRepoRegularText(MIGRATION.repoRoot, path)]),
    ),
  );
  return {
    legacy,
    catalogMarkdown: legacy["case-catalog.md"],
    backlogMarkdown: legacy["harness-backlog.md"],
    manifest: parse(legacy["case-catalog.yaml"]),
    reviewText,
    review,
    reviewedSourceText,
    hostPolicyText,
    hostPolicy: parse(hostPolicyText),
    domainSplitText,
    bootstrapDecisionText,
    artifact,
  };
}

export function assertPinnedInputs(input, options = {}) {
  const problems = [];
  for (const [name, digest] of Object.entries(MIGRATION.legacySourceHashes)) {
    const actual = sha256(input.legacy[name]);
    if (actual !== digest) problems.push(`legacy/${name} expected ${digest}, found ${actual}`);
  }
  if (input.review.product?.revision !== MIGRATION.productRevision) {
    problems.push(
      `review product revision expected ${MIGRATION.productRevision}, found ${String(input.review.product?.revision)}`,
    );
  }
  const artifactSha = sha256(input.artifact);
  if (artifactSha !== MIGRATION.artifact.sha256)
    problems.push(`artifact SHA-256 expected ${MIGRATION.artifact.sha256}, found ${artifactSha}`);
  const artifactIntegrity = sha512Integrity(input.artifact);
  if (artifactIntegrity !== MIGRATION.artifact.integrity)
    problems.push(`artifact integrity expected ${MIGRATION.artifact.integrity}, found ${artifactIntegrity}`);
  if (input.artifact.byteLength !== MIGRATION.artifact.bytes)
    problems.push(`artifact size expected ${MIGRATION.artifact.bytes}, found ${input.artifact.byteLength}`);
  const supportDigests = {
    host_policy_sha256: sha256(input.hostPolicyText),
    authority_domain_split_sha256: sha256(input.domainSplitText),
    migration_bootstrap_decision_sha256: sha256(input.bootstrapDecisionText),
  };
  for (const [name, digest] of Object.entries(MIGRATION.supportSourceHashes)) {
    if (supportDigests[name] !== digest) problems.push(`${name} expected ${digest}, found ${supportDigests[name]}`);
  }
  if (options.requireFinalPins === true) {
    const reviewDigest = sha256(input.reviewText);
    if (MIGRATION.finalPins.reviewSha256 === null) {
      problems.push("final review SHA-256 pin is pending 0.4.6 and the final preparation squash");
    } else if (reviewDigest !== MIGRATION.finalPins.reviewSha256) {
      problems.push(`review SHA-256 expected ${MIGRATION.finalPins.reviewSha256}, found ${reviewDigest}`);
    }
    if (MIGRATION.finalPins.modelIdentity === null) {
      problems.push("final model identity pin is pending 0.4.6 and the final preparation squash");
    } else if (options.modelIdentity !== MIGRATION.finalPins.modelIdentity) {
      problems.push(
        `model identity expected ${MIGRATION.finalPins.modelIdentity}, found ${String(options.modelIdentity)}`,
      );
    }
  }
  if (problems.length > 0) throw new Error(`migration input pin failure:\n- ${problems.join("\n- ")}`);
}

export function migrateReviewedCorpus(input, review = input.review) {
  return migrate(
    { kind: "legacy-catalog", catalogMarkdown: input.catalogMarkdown, backlogMarkdown: input.backlogMarkdown, review },
    CORPUS_SCHEMA,
  );
}

export async function compileModelFiles(modelFiles) {
  return compile(new FakeRepositoryPort({ revision: MIGRATION.productRevision, files: modelFiles }));
}

export function buildMigrationLedger(input, migration, compilation) {
  return {
    schema: "cormidia/validation-architect-migration-ledger/v1",
    public_api: `validation-architect@${MIGRATION.packageVersion} migrate(kind=legacy-catalog,to=${CORPUS_SCHEMA}) + compile()`,
    product_revision: MIGRATION.productRevision,
    model_identity: compilation.identity,
    upstream: {
      revision: MIGRATION.upstreamRevision,
      package: `validation-architect@${MIGRATION.packageVersion}`,
      artifact_path: MIGRATION.artifact.path,
      artifact_sha256: MIGRATION.artifact.sha256,
      artifact_integrity: MIGRATION.artifact.integrity,
      artifact_bytes: MIGRATION.artifact.bytes,
      artifact_entries: MIGRATION.artifact.entries,
    },
    source: {
      archived_inputs_sha256: MIGRATION.legacySourceHashes,
      reviewed_mapping_sha256: sha256(input.reviewText),
      reviewed_sources_sha256: Object.entries(input.reviewedSourceText).map(([path, content]) => ({
        path,
        sha256: sha256(content),
      })),
      ...MIGRATION.supportSourceHashes,
      catalog_migration_input_sha256: sha256(input.catalogMarkdown),
      normalization: "none; public migrate() received the exact archived UTF-8 catalog and backlog bytes",
    },
    compiler: {
      source_fingerprint: compilation.report.record.source_fingerprint,
      model_identity: compilation.report.record.model_identity,
      versions: compilation.report.record.versions,
      generated_views: compilation.report.record.generated_views,
      report_sha256: sha256(compilation.report.content),
    },
    counts: {
      legacy_family_sources: migration.evidence.migration_ledger.families.length,
      canonical_family_outputs: migration.evidence.imported_family_ids.length,
      legacy_ticket_sources: migration.evidence.migration_ledger.tickets.length,
      actionable_ticket_sources: migration.evidence.migration_ledger.tickets.filter(
        (ticket) => ticket.disposition === "actionable",
      ).length,
      historical_ticket_sources: migration.evidence.migration_ledger.tickets.filter(
        (ticket) => ticket.disposition === "historical",
      ).length,
    },
    review_evidence: migration.evidence.review_evidence,
    families: migration.evidence.migration_ledger.families,
    tickets: migration.evidence.migration_ledger.tickets,
  };
}
