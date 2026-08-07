import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { planningAppDir } from "../planning-artifact-path.js";
import type { AcceptedAuthority, AuthorityRef } from "./authority-core.js";
import { readAuthorityFile, requireAuthority } from "./authority-store.js";
import { ensureExecutionUnitJournal, readExecutionUnitJournal } from "./execution-journal.js";
import { isTerminalJournalState, type ExecutionUnitJournal } from "./execution-journal-model.js";
import { assertExecutionBatchShape, type ExecutionBatch, type ExecutionUnit } from "./execution-model.js";
import { RoadmapDeliveryError } from "./failure.js";

export async function readExecutionBatch(
  root: string,
  app: string,
  ref: AuthorityRef,
): Promise<AcceptedAuthority<ExecutionBatch>> {
  const batch = await requireAuthority<ExecutionBatch>(
    root,
    app,
    ref,
    "execution_batch",
    "batch_hard_constraint_failed",
  );
  assertExecutionBatchShape(batch.value);
  return batch;
}

export async function findActiveExecutionUnit(
  root: string,
  app: string,
  unitId: string,
): Promise<ActiveExecutionUnit | undefined> {
  return (await listActiveExecutionUnits(root, app)).find((entry) => entry.unit.unitId === unitId);
}

export interface ActiveExecutionUnit {
  batch: AcceptedAuthority<ExecutionBatch>;
  unit: ExecutionUnit;
  journal: ExecutionUnitJournal;
}

export async function listActiveExecutionUnits(root: string, app: string): Promise<ActiveExecutionUnit[]> {
  const directory = join(planningAppDir(root, app), "execution_batchs");
  if (!existsSync(directory)) return [];
  const found = new Map<string, ActiveExecutionUnit>();
  for (const batchId of (await readdir(directory)).sort()) {
    const batchDir = join(directory, batchId);
    let versions: string[];
    try {
      versions = await readdir(batchDir);
    } catch {
      continue;
    }
    for (const version of versions.filter((name) => /^v\d+\.json$/.test(name)).sort()) {
      const batch = await readAuthorityFile<ExecutionBatch>(join(batchDir, version));
      assertExecutionBatchShape(batch.value);
      for (const unit of batch.value.units) {
        const journal =
          (await readExecutionUnitJournal(root, app, batch.ref.id, unit.unitId)) ??
          (await ensureExecutionUnitJournal(root, batch, unit));
        if (isTerminalJournalState(journal.state)) continue;
        if (found.has(unit.unitId)) {
          throw new RoadmapDeliveryError(
            "batch_membership_active",
            `${unit.unitId} appears in multiple active batches`,
          );
        }
        found.set(unit.unitId, { batch, unit, journal });
      }
    }
  }
  return [...found.values()].sort((a, b) => a.unit.unitId.localeCompare(b.unit.unitId));
}

export async function assertNoActiveExecutionUnitOverlap(
  root: string,
  app: string,
  candidates: readonly ExecutionUnit[],
): Promise<void> {
  const candidateKeys = new Set(candidates.flatMap(executionUnitExclusiveKeys));
  const directory = join(planningAppDir(root, app), "execution_batchs");
  if (!existsSync(directory)) return;
  for (const batchId of await readdir(directory)) {
    const batchDir = join(directory, batchId);
    let versions: string[];
    try {
      versions = await readdir(batchDir);
    } catch {
      continue;
    }
    for (const version of versions.filter((name) => /^v\d+\.json$/.test(name))) {
      const batch = await readAuthorityFile<ExecutionBatch>(join(batchDir, version));
      assertExecutionBatchShape(batch.value);
      for (const unit of batch.value.units) {
        const journal = await readExecutionUnitJournal(root, app, batch.ref.id, unit.unitId);
        if (journal !== undefined && isTerminalJournalState(journal.state)) continue;
        if (executionUnitExclusiveKeys(unit).some((key) => candidateKeys.has(key))) {
          throw new RoadmapDeliveryError(
            "batch_membership_active",
            `${unit.unitId} overlaps an active execution unit in batch ${batch.ref.id}`,
          );
        }
      }
    }
  }
}

function executionUnitExclusiveKeys(unit: ExecutionUnit): string[] {
  return unit.kind === "direct_operation"
    ? [`direct:${unit.dedupeKey}`]
    : [`code-membership:${unit.membershipHash}`, ...(unit.issueNumbers ?? []).map((number) => `issue:${number}`)];
}
