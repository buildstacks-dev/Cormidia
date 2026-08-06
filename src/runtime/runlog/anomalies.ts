// L1/L2 anomaly detectors (docs/loop/design.md §9).

import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { RunEnvelope } from "./envelope.js";
import { readEvents, type RunlogEvent } from "./events.js";

type AnomalyFlag =
  | "low_tokens_high_time"
  | "single_turn_long_run"
  | "bash_heavy"
  | "environment_retry"
  | "cold_cache"
  | "stale_running"
  | "missing_finalization";

interface Anomaly {
  flag: AnomalyFlag;
  runId: string;
  app: string;
  pipeline: string;
  pass: string;
  recommendation: string;
  detail: string;
}

export interface RunEvidence {
  envelope: RunEnvelope;
  events: RunlogEvent[];
}

const ANOMALY_RECOMMENDATIONS: Record<AnomalyFlag, string> = {
  low_tokens_high_time: "Check for environment stalls before spending more model time.",
  single_turn_long_run: "Split the pass or add a tighter maxTurns/wall-clock guard.",
  bash_heavy: "Review shell-heavy behavior; prefer targeted scripts and cached checks.",
  environment_retry: "Fix the underlying docker/install/wait loop before rerunning the role.",
  cold_cache: "Diff the rendered context prefix; a cache-stability invalidator likely changed between passes.",
  stale_running: "Confirm the owner is dead, cancel descendants, and finalize the run with its last checkpoint.",
  missing_finalization: "Inspect the cancellation/finalization path; a caller exited without a terminal envelope.",
};

const CACHE_TTL_MS = 5 * 60 * 1000;
const STALE_HEARTBEAT_MS = 3 * 60 * 1000;

export async function analyzeRunlogs(root: string, options: { app?: string } = {}): Promise<Anomaly[]> {
  const evidence = await loadRunEvidence(root, options.app);
  const anomalies = evidence.flatMap((run) => detectRunAnomalies(run));
  anomalies.push(...detectColdCache(evidence));
  return anomalies.sort((a, b) => a.app.localeCompare(b.app) || a.runId.localeCompare(b.runId));
}

export function detectRunAnomalies(run: RunEvidence): Anomaly[] {
  const elapsedSeconds = (run.envelope.wall_clock_ms ?? 0) / 1000;
  const totalTokens = (run.envelope.usage?.tokens_in ?? 0) + (run.envelope.usage?.tokens_out ?? 0);
  const bashCount = run.envelope.tool_counts?.["bash"] ?? 0;
  const environmentRetryCount = run.events.filter(isEnvironmentRetry).length;
  const flags: AnomalyFlag[] = [];

  if (run.envelope.status === "running") {
    const last = new Date(run.envelope.last_seen_at ?? run.envelope.started_at).getTime();
    const ageMs = Date.now() - last;
    if (Number.isFinite(ageMs) && ageMs > STALE_HEARTBEAT_MS) {
      flags.push("stale_running", "missing_finalization");
    }
  }

  if (elapsedSeconds > 300 && totalTokens < 1000) flags.push("low_tokens_high_time");
  if (elapsedSeconds > 300) flags.push("single_turn_long_run");
  if (bashCount >= 20) flags.push("bash_heavy");
  if (environmentRetryCount >= 3) flags.push("environment_retry");

  return flags.map((flag) =>
    anomaly(run.envelope, flag, detailsFor(flag, { elapsedSeconds, totalTokens, bashCount, environmentRetryCount })),
  );
}

async function loadRunEvidence(root: string, appFilter?: string): Promise<RunEvidence[]> {
  const runsRoot = join(root, "runs");
  if (!existsSync(runsRoot)) return [];
  const apps = appFilter === undefined ? await childDirs(runsRoot) : [appFilter];
  const runs: RunEvidence[] = [];
  for (const app of apps) {
    const appDir = join(runsRoot, app);
    if (!existsSync(appDir)) continue;
    for (const runId of await childDirs(appDir)) {
      const envelope = JSON.parse(await readFile(join(appDir, runId, "envelope.json"), "utf8")) as RunEnvelope;
      const events = await readEvents(root, app, runId).catch(() => []);
      runs.push({ envelope, events });
    }
  }
  return runs;
}

function detectColdCache(runs: readonly RunEvidence[]): Anomaly[] {
  const out: Anomaly[] = [];
  const groups = new Map<string, RunEvidence[]>();
  for (const run of runs) {
    const key = `${run.envelope.app}\0${run.envelope.trace_id}\0${run.envelope.pipeline}`;
    const list = groups.get(key) ?? [];
    list.push(run);
    groups.set(key, list);
  }

  for (const group of groups.values()) {
    group.sort((a, b) => a.envelope.started_at.localeCompare(b.envelope.started_at));
    for (let i = 1; i < group.length; i++) {
      const current = group[i]!;
      const previous = group[i - 1]!;
      const currentUsage = current.envelope.usage;
      if (currentUsage?.cache_read_tokens === undefined) continue;
      if (currentUsage.cache_read_tokens !== 0) continue;
      if (previous.envelope.model !== undefined && current.envelope.model !== undefined) {
        if (previous.envelope.model !== current.envelope.model) continue;
      }
      const gap = new Date(current.envelope.started_at).getTime() - new Date(previous.envelope.started_at).getTime();
      if (gap >= 0 && gap <= CACHE_TTL_MS) {
        out.push(anomaly(current.envelope, "cold_cache", `prior pass ${previous.envelope.pass} ran ${gap}ms earlier`));
      }
    }
  }
  return out;
}

function isEnvironmentRetry(event: RunlogEvent): boolean {
  if (event.event !== "tool.called") return false;
  const detail = event.detail ?? {};
  return detail["environment_retry"] === true || detail["category"] === "environment_retry";
}

function anomaly(envelope: RunEnvelope, flag: AnomalyFlag, detail: string): Anomaly {
  return {
    flag,
    runId: envelope.run_id,
    app: envelope.app,
    pipeline: envelope.pipeline,
    pass: envelope.pass,
    recommendation: ANOMALY_RECOMMENDATIONS[flag],
    detail,
  };
}

function detailsFor(
  flag: AnomalyFlag,
  input: { elapsedSeconds: number; totalTokens: number; bashCount: number; environmentRetryCount: number },
): string {
  if (flag === "low_tokens_high_time") {
    return `${input.elapsedSeconds.toFixed(0)}s with ${input.totalTokens} tokens`;
  }
  if (flag === "single_turn_long_run") return `${input.elapsedSeconds.toFixed(0)}s single pass`;
  if (flag === "bash_heavy") return `${input.bashCount} bash calls`;
  if (flag === "environment_retry") return `${input.environmentRetryCount} environment retry events`;
  if (flag === "stale_running") return "running envelope heartbeat is older than 3m";
  if (flag === "missing_finalization") return "running envelope has no terminal timestamp/status";
  return "";
}

async function childDirs(path: string): Promise<string[]> {
  return (await readdir(path, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}
