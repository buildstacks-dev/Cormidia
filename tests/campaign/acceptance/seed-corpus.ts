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
import { dirname, join } from "node:path";

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

export interface SeedManifest {
  schema_version: 1;
  corpus: string;
  /** Directory inside the scenario repo the items are written under. */
  root: string;
  items: SeedItem[];
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
  }
  return parsed as SeedManifest;
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
  for (const item of manifest.items) {
    const relative = `${manifest.root}/${item.slug}.md`;
    const absolute = join(repoDir, relative);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, renderSeedItem(item), "utf8");
    paths.push(relative);
  }
  return { corpus: manifest.corpus, paths: paths.sort() };
}

/** The manifest's answer-key material, or `{}` when it declares none. Kept
 *  separate from the materialized bytes so the two can never be confused. */
export function sealedSeedMaterial(manifest: SeedManifest): Record<string, unknown> {
  return structuredClone(manifest.sealed ?? {});
}
