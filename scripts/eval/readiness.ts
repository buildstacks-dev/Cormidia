import type { RuntimeKind } from "../../src/runtime/types.js";
import { probeRuntimeReadiness, type RuntimeReadinessProbe, type RuntimeReadinessResult } from "../../src/runtime/readiness.js";
import type { CampaignManifest } from "./core.js";

/** Run every distinct declared adapter/model readiness probe without a model turn. */
export async function checkCampaignReadiness(campaign: CampaignManifest, probe: RuntimeReadinessProbe = probeRuntimeReadiness): Promise<RuntimeReadinessResult[]> {
  const models = new Map<RuntimeKind, Set<string>>();
  for (const assignment of campaign.assignments) {
    if (!isRuntime(assignment.runtime)) throw new Error(`unsupported_campaign_runtime:${assignment.runtime}`);
    const set = models.get(assignment.runtime) ?? new Set<string>(); set.add(assignment.model); models.set(assignment.runtime, set);
  }
  const results = await Promise.all([...models].sort(([a], [b]) => a.localeCompare(b)).map(([runtime, values]) => probe({ runtime, models: [...values].sort() })));
  const failed = results.filter((result) => result.status !== "ready");
  if (failed.length > 0) throw new CampaignReadinessError(results);
  return results;
}

export class CampaignReadinessError extends Error {
  constructor(readonly results: RuntimeReadinessResult[]) {
    super(`campaign_adapter_readiness_failed: ${results.filter((result) => result.status !== "ready").map((result) => `${result.runtime}=${result.status}`).join(",")}`);
    this.name = "CampaignReadinessError";
  }
}

function isRuntime(value: string): value is RuntimeKind { return value === "claude" || value === "codex" || value === "pi"; }
