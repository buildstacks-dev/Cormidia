import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { isDeepStrictEqual } from "node:util";

import { SPEC_SUFFIXES } from "validation-architect";
import { parse } from "yaml";

import { MIGRATION } from "./migration-contract.mjs";
import { lstatIfExists } from "./migration-filesystem.mjs";
import { readRepoRegularText } from "./migration-source-filesystem.mjs";

async function exactModelInventory() {
  const modelRoot = join(MIGRATION.designRoot, "model");
  const rootEntry = await lstatIfExists(modelRoot);
  if (rootEntry === null || !rootEntry.isDirectory() || rootEntry.isSymbolicLink()) {
    throw new Error("validation-design/model must be one real directory");
  }
  const entries = await readdir(modelRoot, { withFileTypes: true });
  const names = entries.map((entry) => entry.name).sort();
  assertExactModelInventoryNames(names);
  for (const entry of entries) {
    if (!entry.isFile() || entry.isSymbolicLink()) throw new Error(`model entry is not a regular file: ${entry.name}`);
  }
}

export function assertExactModelInventoryNames(names) {
  if (
    !Array.isArray(names) ||
    names.some((name) => typeof name !== "string") ||
    names.length !== new Set(names).size ||
    !isDeepStrictEqual([...names].sort(), [...MIGRATION.modelNames].sort())
  ) {
    const observed = Array.isArray(names) ? names.join(", ") : String(names);
    throw new Error(`model directory differs from the exact eight-file inventory: ${observed}`);
  }
}

export async function readCommittedCorpus() {
  await exactModelInventory();
  const modelFiles = Object.fromEntries(
    await Promise.all(
      MIGRATION.modelNames.map(async (name) => [
        `validation-design/model/${name}`,
        await readRepoRegularText(MIGRATION.repoRoot, `validation-design/model/${name}`),
      ]),
    ),
  );
  const views = Object.fromEntries(
    await Promise.all(
      MIGRATION.viewNames.map(async (name) => [
        `validation-design/${name}`,
        await readRepoRegularText(MIGRATION.repoRoot, `validation-design/${name}`),
      ]),
    ),
  );
  const reportText = await readRepoRegularText(MIGRATION.repoRoot, "validation-design/compiler-report.json");
  const parsedFiles = Object.fromEntries(
    MIGRATION.modelNames.map((name) => [name, parse(modelFiles[`validation-design/model/${name}`])]),
  );
  return { modelFiles, views, reportText, parsedFiles };
}

async function walk(root) {
  const output = [];
  const rootEntry = await lstatIfExists(root);
  if (rootEntry === null || !rootEntry.isDirectory() || rootEntry.isSymbolicLink()) {
    throw new Error(`repository facts root must be one real directory: ${root}`);
  }
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    const current = await lstatIfExists(path);
    if (current === null || current.isSymbolicLink()) {
      throw new Error(`repository facts path must not be absent or a symlink: ${path}`);
    }
    if (current.isDirectory()) output.push(...(await walk(path)));
    else if (current.isFile()) output.push(path);
    else throw new Error(`repository facts path must be a regular file or directory: ${path}`);
  }
  return output;
}

export async function repositoryFactsFiles(modelFiles, views, reportText, model) {
  const files = { ...modelFiles, ...views, "validation-design/compiler-report.json": reportText };
  for (const file of await walk(join(MIGRATION.repoRoot, "tests"))) {
    if (SPEC_SUFFIXES.some((suffix) => file.endsWith(suffix))) {
      const path = relative(MIGRATION.repoRoot, file);
      files[path] = await readRepoRegularText(MIGRATION.repoRoot, path);
    }
  }
  const paths = [
    ...model.sources.map((source) => source.path).filter(Boolean),
    ...model.families.map((family) => family.evidence?.path).filter(Boolean),
  ];
  for (const path of [...new Set(paths)]) {
    try {
      files[path] = await readRepoRegularText(MIGRATION.repoRoot, path);
    } catch {
      // Public check turns every missing/unreadable declared source red.
    }
  }
  return files;
}

export function reviewSourceTexts(input) {
  return Object.fromEntries(
    input.review.sources
      .filter((source) => typeof source.path === "string")
      .map((source) => [source.id, input.reviewedSourceText[source.path]]),
  );
}

export function graphOf(result) {
  return result.extensions["validation-architect.relationship-trace"];
}

export function redFindings(graph) {
  return graph.findings.filter((finding) => finding.level === "red" || finding.level === "unresolved");
}
