import { existsSync } from "node:fs";
import { join } from "node:path";
import { stableHash } from "../../loop/episode-plan.js";
import { withFileLock } from "../../runtime/file-lock.js";
import { planningAppDir } from "../planning-artifact-path.js";
import {
  ROADMAP_DELIVERY_SCHEMA_VERSION,
  assertId,
  type AcceptedAuthority,
  type AuthorityRef,
  type RoadmapDeliveryProjector,
} from "./authority-core.js";
import { batchAuthorityPath } from "./authority-paths.js";
import { persistAuthority, projectAccepted, readAuthorityFile } from "./authority-store.js";
import { assertNoActiveExecutionUnitOverlap } from "./active-execution-units.js";
import { resolveExecutionBatchMembers } from "./execution-batch-members.js";
import { ensureExecutionUnitJournal } from "./execution-journal.js";
import type { ExecutionBatch, ExecutionUnitBudget } from "./execution-model.js";
import { RoadmapDeliveryError } from "./failure.js";
import type { RoutingSnapshotEntry } from "./roadmap-model.js";
import { ROADMAP_MUTATION_LOCK } from "./roadmap-plan.js";
import { requireDateTime } from "./validation-values.js";

const DEFAULT_EXECUTION_BATCH_MAX_UNITS = 8;
const DEFAULT_EXECUTION_BATCH_MAX_MANIFEST_BYTES = 64 * 1024;

/** Token-free admission. This function neither builds an EpisodeIntent nor calls EpisodePlanner. */
export async function admitExecutionBatch(input: {
  root: string;
  app: string;
  batchId: string;
  roadmapRef?: AuthorityRef;
  expectedFrontierHash?: string;
  orderedUnitIds?: string[];
  readinessRefs?: AuthorityRef[];
  directUnitRefs?: AuthorityRef[];
  budgetsByUnit?: Readonly<Record<string, ExecutionUnitBudget>>;
  maxUnits?: number;
  maxManifestBytes?: number;
  routing: RoutingSnapshotEntry[];
  admittedAt: string;
  project?: RoadmapDeliveryProjector;
}): Promise<AcceptedAuthority<ExecutionBatch>> {
  assertId(input.batchId, "batch id");
  const { roadmap, frontierHash, units } = await resolveExecutionBatchMembers(input);
  if (units.length === 0) {
    throw new RoadmapDeliveryError("batch_hard_constraint_failed", "a batch must contain a unit");
  }
  const maxUnits = input.maxUnits ?? DEFAULT_EXECUTION_BATCH_MAX_UNITS;
  const maxManifestBytes = input.maxManifestBytes ?? DEFAULT_EXECUTION_BATCH_MAX_MANIFEST_BYTES;
  if (!Number.isInteger(maxUnits) || maxUnits <= 0 || units.length > maxUnits) {
    throw new RoadmapDeliveryError(
      "batch_manifest_too_large",
      `batch admits ${units.length} units; maximum is ${maxUnits}`,
    );
  }
  const batch: ExecutionBatch = {
    schemaVersion: ROADMAP_DELIVERY_SCHEMA_VERSION,
    batchId: input.batchId,
    version: 1,
    app: input.app,
    roadmapRef: roadmap?.ref ?? null,
    frontierHash,
    units,
    manifestLimits: { maxUnits, maxManifestBytes },
    admittedAt: requireDateTime(input.admittedAt, "batch admittedAt"),
  };
  if (Buffer.byteLength(JSON.stringify(batch), "utf8") > maxManifestBytes) {
    throw new RoadmapDeliveryError("batch_manifest_too_large", `batch manifest exceeds ${maxManifestBytes} bytes`);
  }
  const accepted = await withFileLock(batchMutationLockPath(input.root, input.app), ROADMAP_MUTATION_LOCK, async () => {
    const existingPath = batchAuthorityPath(input.root, input.app, batch.batchId, batch.version);
    if (existsSync(existingPath)) {
      const existing = await readAuthorityFile<ExecutionBatch>(existingPath);
      const replay = { ...batch, admittedAt: existing.value.admittedAt };
      if (stableHash(existing.value) !== stableHash(replay)) {
        throw new RoadmapDeliveryError("authority_conflict", `batch ${batch.batchId} already differs`);
      }
      for (const unit of units) await ensureExecutionUnitJournal(input.root, existing, unit);
      return existing;
    }
    await assertNoActiveExecutionUnitOverlap(input.root, input.app, units);
    const persisted = await persistAuthority(
      input.root,
      input.app,
      "execution_batch",
      batch.batchId,
      batch.version,
      batch,
    );
    for (const unit of units) await ensureExecutionUnitJournal(input.root, persisted, unit);
    return persisted;
  });
  await projectAccepted(input.root, input.app, accepted, input.project);
  return accepted;
}

function batchMutationLockPath(root: string, app: string): string {
  return join(planningAppDir(root, app), "execution-batch.lock");
}
