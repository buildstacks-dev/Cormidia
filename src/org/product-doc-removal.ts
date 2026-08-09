import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { lstat, mkdir, readFile, rename, rm, unlink } from "node:fs/promises";
import { basename, join } from "node:path";
import { writeLoopFileAtomic } from "../loop/durable.js";
import { PRODUCT_DOC_PATHS } from "./product-doc-scaffold.js";

interface RemovalEntry {
  path: string;
  staged: string;
  scaffold_sha256: string;
}

interface RemovalMarker {
  schema_version: 1;
  kind: "product-doc-removal-staging";
  entries: RemovalEntry[];
}

export interface ProductDocRemovalStage {
  root: string;
  directory: string;
  marker: RemovalMarker;
}

const STAGING_DIR = ".cormidia/bootstrap/product-doc-remove-staging";
const MARKER_FILE = "transaction.json";

export function productDocRemovalStagingBlocker(workdir: string): string | undefined {
  return existsSync(join(workdir, STAGING_DIR))
    ? `${STAGING_DIR}: incomplete product-doc removal staging exists; execute the disposition command to recover it`
    : undefined;
}

export async function recoverProductDocRemoval(workdir: string, committedRemove: boolean): Promise<void> {
  const directory = join(workdir, STAGING_DIR);
  if (!existsSync(directory)) return;
  for (const relative of [".cormidia", ".cormidia/bootstrap", STAGING_DIR]) {
    if ((await lstat(join(workdir, relative))).isSymbolicLink()) {
      throw new Error(`app product-docs: ${relative} is a symbolic link; removal recovery refused`);
    }
  }
  const stage = { root: workdir, directory, marker: await readMarker(directory) };
  if (committedRemove) {
    await rm(directory, { recursive: true });
    return;
  }
  await rollbackProductDocRemoval(stage);
}

export async function stageProductDocRemoval(
  workdir: string,
  documents: Array<{ path: string; scaffold_sha256: string }>,
  removePaths: string[],
  afterStage?: (index: number) => Promise<void> | void,
): Promise<ProductDocRemovalStage> {
  const directory = join(workdir, STAGING_DIR);
  const marker: RemovalMarker = {
    schema_version: 1,
    kind: "product-doc-removal-staging",
    entries: removePaths.map((path, index) => {
      const document = documents.find((candidate) => candidate.path === path);
      if (document === undefined) throw new Error(`app product-docs: no scaffold hash for ${path}`);
      return { path, staged: `${index}-${basename(path)}`, scaffold_sha256: document.scaffold_sha256 };
    }),
  };
  await mkdir(directory);
  const stage = { root: workdir, directory, marker };
  try {
    await writeLoopFileAtomic(join(directory, MARKER_FILE), `${JSON.stringify(marker, null, 2)}\n`);
    for (const [index, entry] of marker.entries.entries()) {
      const stagedPath = join(directory, entry.staged);
      await rename(join(workdir, entry.path), stagedPath);
      if ((await lstat(stagedPath)).isSymbolicLink()) {
        throw new Error(`app product-docs: ${entry.path} became a symbolic link before removal`);
      }
      if (sha256(await readFile(stagedPath)) !== entry.scaffold_sha256) {
        throw new Error(`app product-docs: ${entry.path} changed after preview; replacement preserved`);
      }
      await afterStage?.(index);
    }
    return stage;
  } catch (error) {
    return rollbackAfterFailure(stage, error);
  }
}

export async function rollbackProductDocRemoval(stage: ProductDocRemovalStage): Promise<void> {
  for (const entry of [...stage.marker.entries].reverse()) {
    const stagedPath = join(stage.directory, entry.staged);
    if (!existsSync(stagedPath)) continue;
    const originalPath = join(stage.root, entry.path);
    if (!existsSync(originalPath)) {
      await rename(stagedPath, originalPath);
      continue;
    }
    if (sha256(await readFile(stagedPath)) === entry.scaffold_sha256) {
      await unlink(stagedPath);
      continue;
    }
    throw new Error(`app product-docs: recovery conflict for ${entry.path}; replacement preserved at ${stagedPath}`);
  }
  await rm(stage.directory, { recursive: true });
}

export async function commitProductDocRemoval(stage: ProductDocRemovalStage): Promise<void> {
  await rm(stage.directory, { recursive: true });
}

async function rollbackAfterFailure(stage: ProductDocRemovalStage, original: unknown): Promise<never> {
  try {
    await rollbackProductDocRemoval(stage);
  } catch (recovery) {
    throw new Error(`${message(original)}; removal recovery also failed: ${message(recovery)}`, { cause: recovery });
  }
  throw original;
}

async function readMarker(directory: string): Promise<RemovalMarker> {
  const path = join(directory, MARKER_FILE);
  if ((await lstat(path)).isSymbolicLink()) throw new Error("app product-docs: removal marker is a symbolic link");
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`app product-docs: unreadable removal staging marker: ${message(error)}`);
  }
  if (!isMarker(value)) throw new Error("app product-docs: invalid removal staging marker; no files were discarded");
  return value;
}

function isMarker(value: unknown): value is RemovalMarker {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const marker = value as Partial<RemovalMarker>;
  if (
    marker.schema_version !== 1 ||
    marker.kind !== "product-doc-removal-staging" ||
    !Array.isArray(marker.entries) ||
    marker.entries.length === 0
  ) {
    return false;
  }
  let priorPosition = -1;
  return marker.entries.every((entry, index) => {
    if (
      typeof entry.path !== "string" ||
      typeof entry.staged !== "string" ||
      typeof entry.scaffold_sha256 !== "string"
    ) {
      return false;
    }
    const position = PRODUCT_DOC_PATHS.indexOf(entry.path as (typeof PRODUCT_DOC_PATHS)[number]);
    if (position <= priorPosition) return false;
    priorPosition = position;
    return entry.staged === `${index}-${basename(entry.path)}` && /^[0-9a-f]{64}$/.test(entry.scaffold_sha256);
  });
}

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function message(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}
