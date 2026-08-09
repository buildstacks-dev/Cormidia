import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { writeLoopFileAtomic } from "../loop/durable.js";
import { planningAppDir } from "./planning-artifact-path.js";
import {
  assertCoverageRecord,
  coverageRecordDigest,
  isCoverageRecord,
  type PlanningCoverageRecord,
} from "./planning-coverage-model.js";

export async function readCoverageRecord(
  root: string,
  app: string,
  scopeId: string,
): Promise<PlanningCoverageRecord | undefined> {
  const path = coveragePath(root, app, scopeId);
  const current = existsSync(path) ? await parseRecord(path, app, scopeId) : undefined;
  if (current !== undefined) {
    assertCoverageRecord(current);
    await verifyHistory(root, current);
  }
  const recovered = await recoverOrphanOnRead(root, app, scopeId, current);
  if (recovered !== undefined) {
    assertCoverageRecord(recovered);
    await verifyHistory(root, recovered);
    return recovered;
  }
  if (current === undefined) return undefined;
  return current;
}

async function recoverOrphanOnRead(
  root: string,
  app: string,
  scopeId: string,
  current: PlanningCoverageRecord | undefined,
): Promise<PlanningCoverageRecord | undefined> {
  const directory = historyDirectory(root, app, scopeId);
  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  const currentRevision = current?.revision ?? 0;
  const successors = entries
    .map((entry) => /^revision-(\d+)\.json$/.exec(entry))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => Number(match[1]))
    .filter((revision) => revision > currentRevision)
    .sort((left, right) => left - right);
  if (successors.length === 0) return undefined;
  if (successors.length !== 1 || successors[0] !== currentRevision + 1) {
    throw new Error(`planning coverage has conflicting or non-contiguous orphan revisions after ${currentRevision}`);
  }
  const orphan = await parseRecord(historyPath(root, app, scopeId, successors[0]!), app, scopeId);
  assertCoverageRecord(orphan);
  const expectedRevision = currentRevision + 1;
  if (orphan.revision !== expectedRevision) {
    throw new Error(
      `planning coverage orphan filename/body revision mismatch: expected ${expectedRevision}, found ${orphan.revision}`,
    );
  }
  const expectedPredecessor = current === undefined ? null : coverageRecordDigest(current);
  if (orphan.predecessor_digest !== expectedPredecessor) {
    throw new Error(`planning coverage orphan revision ${orphan.revision} is not predecessor-bound to current`);
  }
  await verifyHistory(root, orphan);
  await writeLoopFileAtomic(coveragePath(root, app, scopeId), `${JSON.stringify(orphan, null, 2)}\n`);
  return orphan;
}

export async function persistCoverageRecord(
  record: PlanningCoverageRecord,
  root: string,
  afterRevisionPersisted?: () => void | Promise<void>,
): Promise<PlanningCoverageRecord> {
  assertCoverageRecord(record);
  const contents = `${JSON.stringify(record, null, 2)}\n`;
  const revisionPath = historyPath(root, record.app, record.scope_id, record.revision);
  if (existsSync(revisionPath)) {
    const existingContents = await readFile(revisionPath, "utf8");
    if (existingContents !== contents) return promoteMatchingOrphan(record, root, existingContents);
  } else {
    await writeLoopFileAtomic(revisionPath, contents);
  }
  await afterRevisionPersisted?.();
  await writeLoopFileAtomic(coveragePath(root, record.app, record.scope_id), contents);
  return record;
}

export function coverageLockPath(root: string, app: string, scopeId: string): string {
  return join(planningAppDir(root, app), "locks", `coverage-${scopeId}.lock`);
}

async function verifyHistory(root: string, current: PlanningCoverageRecord): Promise<void> {
  let successor = current;
  for (let revision = current.revision; revision >= 1; revision -= 1) {
    const path = historyPath(root, current.app, current.scope_id, revision);
    const record = await parseRecord(path, current.app, current.scope_id);
    assertCoverageRecord(record);
    if (record.revision !== revision) throw new Error(`planning coverage history revision mismatch at ${path}`);
    if (revision === current.revision && coverageRecordDigest(record) !== coverageRecordDigest(current)) {
      throw new Error("planning coverage current record differs from its immutable revision");
    }
    if (successor.revision !== revision && successor.predecessor_digest !== coverageRecordDigest(record)) {
      throw new Error(`planning coverage predecessor digest mismatch at revision ${successor.revision}`);
    }
    successor = record;
  }
  if (successor.predecessor_digest !== null) throw new Error("planning coverage initial revision has a predecessor");
}

async function parseRecord(path: string, app: string, scopeId: string): Promise<PlanningCoverageRecord> {
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as unknown;
    if (!isCoverageRecord(value) || value.app !== app || value.scope_id !== scopeId) throw new Error("shape mismatch");
    return value;
  } catch (error) {
    throw new Error(`planning coverage is unreadable or corrupt at ${path}`, { cause: error });
  }
}

async function promoteMatchingOrphan(
  candidate: PlanningCoverageRecord,
  root: string,
  existingContents: string,
): Promise<PlanningCoverageRecord> {
  const path = coveragePath(root, candidate.app, candidate.scope_id);
  const orphan = JSON.parse(existingContents) as unknown;
  if (!isCoverageRecord(orphan)) throw new Error(`planning coverage revision ${candidate.revision} is immutable`);
  assertCoverageRecord(orphan);
  if (coverageIntentDigest(orphan) !== coverageIntentDigest(candidate)) {
    throw new Error(`planning coverage revision ${candidate.revision} is immutable and belongs to another mutation`);
  }
  if (candidate.revision === 1) {
    if (existsSync(path) || orphan.predecessor_digest !== null) {
      throw new Error("planning coverage initial orphan cannot be promoted over existing state");
    }
  } else {
    const current = await parseRecord(path, candidate.app, candidate.scope_id);
    if (current.revision !== candidate.revision - 1 || orphan.predecessor_digest !== coverageRecordDigest(current)) {
      throw new Error(`planning coverage orphan revision ${candidate.revision} is not predecessor-bound to current`);
    }
  }
  await writeLoopFileAtomic(path, existingContents);
  return orphan;
}

function coverageIntentDigest(record: PlanningCoverageRecord): string {
  return coverageRecordDigest({ ...record, updated_at: "(transaction-time)" });
}

function coveragePath(root: string, app: string, scopeId: string): string {
  return join(planningAppDir(root, app), "coverage", `${scopeId}.json`);
}

function historyPath(root: string, app: string, scopeId: string, revision: number): string {
  return join(historyDirectory(root, app, scopeId), `revision-${revision}.json`);
}

function historyDirectory(root: string, app: string, scopeId: string): string {
  return join(dirname(coveragePath(root, app, scopeId)), scopeId);
}
