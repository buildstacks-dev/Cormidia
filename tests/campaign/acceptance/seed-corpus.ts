// campaign/acceptance/seed-corpus.ts — materialize a committed seed manifest
// into a scenario repository.
//
// S-ACC-2 is explicit that the staleness is a fixture and must be deterministic:
// "generated from a committed manifest, not hand-drifted, so the scenario is
// re-runnable". A hand-drifted corpus makes run 2 incomparable to run 1, which
// destroys the only thing a distribution is for.
//
// The `sealed` block of a manifest is ANSWER KEY MATERIAL and is deliberately
// NOT written out. It names which tool is the single-source plant and which
// pair conflicts, so J-1/J-2 can be scored as set comparisons rather than
// judgments — and it must reach the scorer without ever reaching the scenario
// repository a grader can read (CORMIDIA-C-B28-001 §2).

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";

export class SeedCorpusError extends Error {
  constructor(
    readonly code: "manifest-unreadable" | "manifest-malformed" | "empty-corpus",
    message: string,
  ) {
    super(`seed corpus refused (${code}): ${message}`);
    this.name = "SeedCorpusError";
  }
}

export interface SeedItem {
  slug: string;
  title: string;
  body: string[];
  /** Present on tutorial corpora; recorded for the report, never materialized. */
  staleness?: string;
  n?: number;
}

export interface SeedSupportFile {
  /** Repo-relative path. Support files are fixture plumbing, never answer-key material. */
  path: string;
  /** Exact lines written with one terminal newline. */
  body: string[];
}

export interface SeedManifest {
  schema_version: 1;
  corpus: string;
  /** Directory inside the scenario repo the items are written under. */
  root: string;
  items: SeedItem[];
  /** Deterministic non-corpus files needed to make the seeded repository operable. */
  support_files?: SeedSupportFile[];
  /** Answer-key material. Never written into the scenario repository. */
  sealed?: Record<string, unknown>;
}

export async function readSeedManifest(path: string): Promise<SeedManifest> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    throw new SeedCorpusError("manifest-unreadable", `${path}: ${(error as Error).message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new SeedCorpusError("manifest-malformed", `${path}: not valid JSON`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new SeedCorpusError("manifest-malformed", `${path}: not a JSON object`);
  }
  const record = parsed as Record<string, unknown>;
  if (record["schema_version"] !== 1 || typeof record["corpus"] !== "string" || typeof record["root"] !== "string") {
    throw new SeedCorpusError("manifest-malformed", `${path}: missing schema_version, corpus or root`);
  }
  const items = record["items"];
  if (!Array.isArray(items) || items.length === 0) {
    throw new SeedCorpusError("empty-corpus", `${path}: a corpus that seeds nothing is not a fixture`);
  }
  for (const [index, item] of items.entries()) {
    const entry = item as Record<string, unknown>;
    if (typeof entry["slug"] !== "string" || typeof entry["title"] !== "string" || !Array.isArray(entry["body"])) {
      throw new SeedCorpusError("manifest-malformed", `${path}: items[${index}] needs slug, title and body`);
    }
    assertSafeRelativePath(`${record["root"]}/${entry["slug"]}.md`, `${path}: items[${index}]`);
    if (!(entry["body"] as unknown[]).every((line) => typeof line === "string")) {
      throw new SeedCorpusError("manifest-malformed", `${path}: items[${index}].body must contain only strings`);
    }
  }
  const supportFiles = record["support_files"];
  if (supportFiles !== undefined && !Array.isArray(supportFiles)) {
    throw new SeedCorpusError("manifest-malformed", `${path}: support_files must be an array`);
  }
  for (const [index, file] of (supportFiles ?? []).entries()) {
    const entry = file as Record<string, unknown>;
    if (typeof entry["path"] !== "string" || !Array.isArray(entry["body"])) {
      throw new SeedCorpusError("manifest-malformed", `${path}: support_files[${index}] needs path and body`);
    }
    assertSafeRelativePath(entry["path"], `${path}: support_files[${index}]`);
    if (!(entry["body"] as unknown[]).every((line) => typeof line === "string")) {
      throw new SeedCorpusError(
        "manifest-malformed",
        `${path}: support_files[${index}].body must contain only strings`,
      );
    }
  }
  return parsed as SeedManifest;
}

function assertSafeRelativePath(path: string, context: string): void {
  if (
    path.length === 0 ||
    isAbsolute(path) ||
    path.includes("\\") ||
    path.split("/").some((part) => part.length === 0 || part === "." || part === "..")
  ) {
    throw new SeedCorpusError("manifest-malformed", `${context} has unsafe repo-relative path ${JSON.stringify(path)}`);
  }
}

/** Deterministic file content for one item — same manifest, same bytes. */
export function renderSeedItem(item: SeedItem): string {
  return `# ${item.title}\n\n${item.body.join("\n")}\n`;
}

export interface MaterializedSeed {
  corpus: string;
  /** Repo-relative paths written, sorted. */
  paths: string[];
}

/**
 * Write every item under `<repoDir>/<manifest.root>/`. Returns the paths so a
 * caller can commit exactly what was seeded rather than `git add -A`, which
 * would sweep in anything else sitting in the tree.
 */
export async function materializeSeedCorpus(manifest: SeedManifest, repoDir: string): Promise<MaterializedSeed> {
  const paths: string[] = [];
  const outputs = [
    ...manifest.items.map((item) => ({ relative: `${manifest.root}/${item.slug}.md`, contents: renderSeedItem(item) })),
    ...(manifest.support_files ?? []).map((file) => ({ relative: file.path, contents: `${file.body.join("\n")}\n` })),
  ];
  const duplicates = outputs.filter(
    ({ relative }, index) => outputs.findIndex((entry) => entry.relative === relative) !== index,
  );
  if (duplicates.length > 0) {
    throw new SeedCorpusError(
      "manifest-malformed",
      `duplicate output path(s): ${[...new Set(duplicates.map(({ relative }) => relative))].join(", ")}`,
    );
  }
  for (const { relative, contents } of outputs) {
    assertSafeRelativePath(relative, manifest.corpus);
    const absolute = join(repoDir, relative);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, contents, "utf8");
    paths.push(relative);
  }
  return { corpus: manifest.corpus, paths: paths.sort() };
}

/** The manifest's answer-key material, or `{}` when it declares none. Kept
 *  separate from the materialized bytes so the two can never be confused. */
export function sealedSeedMaterial(manifest: SeedManifest): Record<string, unknown> {
  return structuredClone(manifest.sealed ?? {});
}
