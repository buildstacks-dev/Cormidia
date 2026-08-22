// Evidence synchronization: ingest the primary episode projection into the
// kernel and acknowledge the exposure sets of every closed episode whose
// pinned resolves still await one. Run after the episode projector folds
// records (`learn report --refresh`, `learn inspect`) and before the
// scheduled reviewer prepares its window, so the kernel's exposure lineage
// catches up with what the turns actually loaded.

import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { IngestReceipt } from "@cormidia/learning-loop";
import { ingestEpisodes } from "./candidates.js";
import { acknowledgeEpisodeExposures, listResolutionSidecars, type ResolutionSidecar } from "./context.js";
import type { CormidiaLearningLoop } from "./loop.js";

export interface EvidenceSyncResult {
  readonly ingest: IngestReceipt;
  readonly acknowledged: readonly ResolutionSidecar[];
  readonly pending: readonly string[];
}

async function closedEpisodeIds(stateHome: string): Promise<Set<string>> {
  const dir = join(stateHome, "learning", "episodes");
  const closed = new Set<string>();
  if (!existsSync(dir)) return closed;
  for (const name of (await readdir(dir)).filter((entry) => entry.endsWith(".json"))) {
    try {
      const parsed: unknown = JSON.parse(await readFile(join(dir, name), "utf8"));
      if (parsed === null || typeof parsed !== "object") continue;
      const id: unknown = Reflect.get(parsed, "episode_id");
      if (Reflect.get(parsed, "status") === "closed" && typeof id === "string") closed.add(id);
    } catch {
      // A corrupt record is evidence health the ingest reports; skip it here.
    }
  }
  return closed;
}

export async function syncKernelEvidence(learning: CormidiaLearningLoop): Promise<EvidenceSyncResult> {
  const ingest = await ingestEpisodes(learning);
  const closed = await closedEpisodeIds(learning.stateHome);
  const sidecars = await listResolutionSidecars(learning.stateDir);
  const acknowledged: ResolutionSidecar[] = [];
  const pending: string[] = [];
  const episodes = new Set(sidecars.filter((sidecar) => sidecar.exposure_id === undefined).map((s) => s.episode_id));
  for (const episodeId of [...episodes].sort()) {
    if (!closed.has(episodeId)) {
      pending.push(episodeId);
      continue;
    }
    acknowledged.push(...(await acknowledgeEpisodeExposures(learning, episodeId)));
  }
  return { ingest, acknowledged, pending };
}
