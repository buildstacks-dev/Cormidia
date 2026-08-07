import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { writeLoopFileAtomic, writeLoopFileOnce } from "../../loop/durable.js";
import { stableHash } from "../../loop/episode-plan.js";
import { withFileLock } from "../../runtime/file-lock.js";
import { planningAppDir } from "../planning-artifact-path.js";
import {
  ROADMAP_DELIVERY_SCHEMA_VERSION,
  assertId,
  type AcceptedAuthority,
  type AuthorityRef,
} from "./authority-core.js";
import { executionUnitJournalPath } from "./authority-paths.js";
import { requireAuthority, sameAuthorityRef } from "./authority-store.js";
import {
  addExecutionUnitUsage,
  assertExecutionUnitJournal,
  assertUsageWithinBudget,
  initialExecutionUnitJournal,
  isTerminalJournalState,
  type ExecutionBatchDisposition,
  type ExecutionUnitJournal,
  type ExecutionUnitJournalState,
} from "./execution-journal-model.js";
import { assertExecutionBatchShape, type ExecutionBatch, type ExecutionUnit } from "./execution-model.js";
import { RoadmapDeliveryError } from "./failure.js";
import { ROADMAP_MUTATION_LOCK } from "./roadmap-plan.js";

export async function readExecutionUnitJournal(
  root: string,
  app: string,
  batchId: string,
  unitId: string,
): Promise<ExecutionUnitJournal | undefined> {
  const path = executionUnitJournalPath(root, app, batchId, unitId);
  if (!existsSync(path)) return undefined;
  const value = JSON.parse(await readFile(path, "utf8")) as ExecutionUnitJournal;
  assertExecutionUnitJournal(value);
  return value;
}

export async function ensureExecutionUnitJournal(
  root: string,
  batch: AcceptedAuthority<ExecutionBatch>,
  unit: ExecutionUnit,
): Promise<ExecutionUnitJournal> {
  const path = executionUnitJournalPath(root, batch.value.app, batch.ref.id, unit.unitId);
  const initial = initialExecutionUnitJournal(batch, unit);
  const won = await writeLoopFileOnce(path, `${JSON.stringify(initial, null, 2)}\n`);
  const current = won ? initial : await readExecutionUnitJournal(root, batch.value.app, batch.ref.id, unit.unitId);
  if (
    current === undefined ||
    current.unitIdentityHash !== initial.unitIdentityHash ||
    !sameAuthorityRef(current.batchRef, batch.ref)
  ) {
    throw new RoadmapDeliveryError("unit_journal_conflict", `${unit.unitId} journal differs from batch authority`);
  }
  return current;
}

export async function transitionExecutionUnitJournal(input: {
  root: string;
  app: string;
  batchRef: AuthorityRef;
  unitId: string;
  expectedStates: ExecutionUnitJournalState[];
  nextState: ExecutionUnitJournalState;
  usageDelta?: Partial<ExecutionUnitJournal["usage"]>;
  episodeBindingRef?: AuthorityRef;
  claimSettlementId?: string;
  evidenceRefs?: AuthorityRef[];
  candidateHead?: string;
  pullRequestNumber?: number;
  outcome?: "completed" | "returned" | "failed";
  now: Date;
}): Promise<ExecutionUnitJournal> {
  return withFileLock(
    executionUnitJournalLockPath(input.root, input.app, input.batchRef.id, input.unitId),
    ROADMAP_MUTATION_LOCK,
    async () => {
      const batch = await requireAuthority<ExecutionBatch>(
        input.root,
        input.app,
        input.batchRef,
        "execution_batch",
        "batch_hard_constraint_failed",
      );
      assertExecutionBatchShape(batch.value);
      const unit = batch.value.units.find((candidate) => candidate.unitId === input.unitId);
      if (unit === undefined) {
        throw new RoadmapDeliveryError("unit_journal_conflict", `${input.unitId} is not in the batch`);
      }
      const current =
        (await readExecutionUnitJournal(input.root, input.app, batch.ref.id, input.unitId)) ??
        initialExecutionUnitJournal(batch, unit);
      if (!input.expectedStates.includes(current.state)) {
        if (current.state === input.nextState && input.outcome === current.outcome) {
          if (isTerminalJournalState(current.state)) {
            await writeBatchDispositionIfComplete(input.root, batch, input.now);
          }
          return current;
        }
        throw new RoadmapDeliveryError(
          "unit_journal_conflict",
          `${input.unitId} is ${current.state}, expected ${input.expectedStates.join("|")}`,
        );
      }
      const usage = addExecutionUnitUsage(current.usage, input.usageDelta ?? {});
      assertUsageWithinBudget(usage, current.budget);
      const next: ExecutionUnitJournal = {
        ...current,
        state: input.nextState,
        usage,
        ...(input.episodeBindingRef === undefined ? {} : { episodeBindingRef: input.episodeBindingRef }),
        ...(input.claimSettlementId === undefined ? {} : { claimSettlementId: input.claimSettlementId }),
        ...(input.evidenceRefs === undefined ? {} : { evidenceRefs: [...input.evidenceRefs] }),
        ...(input.candidateHead === undefined ? {} : { candidateHead: input.candidateHead }),
        ...(input.pullRequestNumber === undefined ? {} : { pullRequestNumber: input.pullRequestNumber }),
        ...(input.outcome === undefined ? {} : { outcome: input.outcome }),
        updatedAt: input.now.toISOString(),
      };
      assertExecutionUnitJournal(next);
      await writeLoopFileAtomic(
        executionUnitJournalPath(input.root, input.app, batch.ref.id, input.unitId),
        `${JSON.stringify(next, null, 2)}\n`,
      );
      if (isTerminalJournalState(next.state)) {
        await writeBatchDispositionIfComplete(input.root, batch, input.now);
      }
      return next;
    },
  );
}

async function writeBatchDispositionIfComplete(
  root: string,
  batch: AcceptedAuthority<ExecutionBatch>,
  now: Date,
): Promise<void> {
  const journals = await Promise.all(
    batch.value.units.map((unit) => readExecutionUnitJournal(root, batch.value.app, batch.ref.id, unit.unitId)),
  );
  if (journals.some((journal) => journal === undefined || !isTerminalJournalState(journal.state))) return;
  const value: ExecutionBatchDisposition = {
    schemaVersion: ROADMAP_DELIVERY_SCHEMA_VERSION,
    app: batch.value.app,
    batchRef: batch.ref,
    units: journals.map((journal) => ({
      unitId: journal!.unitId,
      outcome: journal!.outcome!,
      journalHash: stableHash(journal),
    })),
    completedAt:
      journals
        .map((journal) => journal!.updatedAt)
        .sort()
        .at(-1) ?? now.toISOString(),
  };
  const path = executionBatchDispositionPath(root, batch.value.app, batch.ref.id);
  const won = await writeLoopFileOnce(path, `${JSON.stringify(value, null, 2)}\n`);
  if (!won) {
    const existing = JSON.parse(await readFile(path, "utf8")) as ExecutionBatchDisposition;
    if (stableHash(existing) !== stableHash(value)) {
      throw new RoadmapDeliveryError(
        "unit_journal_conflict",
        "execution-batch disposition differs from terminal journals",
      );
    }
  }
}

export function executionBatchDispositionPath(root: string, app: string, batchId: string): string {
  assertId(batchId, "execution batch disposition id");
  return join(planningAppDir(root, app), "execution-batch-dispositions", `${batchId}.json`);
}

function executionUnitJournalLockPath(root: string, app: string, batchId: string, unitId: string): string {
  return join(planningAppDir(root, app), "execution-unit-journals", batchId, `${unitId}.lock`);
}
