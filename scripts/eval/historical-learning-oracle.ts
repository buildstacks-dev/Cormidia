import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { LearningEvent } from "../../src/org/learning/events.js";
import { sha256 } from "./core.js";

interface HistoricalRun { run_id: string; status: string; role: string; pipeline: string; pass: string; started_at: string; finished_at: string | null; artifact_fingerprint?: string; usage: { cost_usd: number | null } | null }
interface HistoricalAction { run_id: string; shell_commands: number; unique_shell_commands: number; repeated_shell_commands: number; environment_retries: number; tool_calls: number }
interface HistoricalApproval { id: string; classification: string }

export function projectHistoricalLearningOracle(root: string): LearningEvent[] {
  const runs = JSON.parse(readFileSync(join(root, "runs.json"), "utf8")) as HistoricalRun[];
  const actions = JSON.parse(readFileSync(join(root, "actions.json"), "utf8")) as HistoricalAction[];
  const approvals = JSON.parse(readFileSync(join(root, "approvals.json"), "utf8")) as HistoricalApproval[];
  const events: LearningEvent[] = [];
  for (const run of runs) {
    if (run.status === "cancelled") events.push(event(`cancel:${run.run_id}`, run.run_id, "execution.cancelled", "provider execution ended cancelled"));
    if (run.status === "running" && run.finished_at === null) events.push(event(`stale:${run.run_id}`, run.run_id, "execution.stale_finalization", "run had no truthful terminal record"));
    if (run.role === "reviewer" && duration(run) >= 10 * 60_000) events.push(event(`long:${run.run_id}`, run.run_id, "review.long_duration", "review active time exceeded the calibrated boundary"));
    if ((run.usage?.cost_usd ?? 0) > 8) events.push(event(`route:${run.run_id}`, run.run_id, "route.budget_overrun", "pass exceeded the quick equivalent-cost boundary"));
  }
  const fingerprints = new Map<string, HistoricalRun[]>();
  for (const run of runs) if (run.artifact_fingerprint) fingerprints.set(run.artifact_fingerprint, [...(fingerprints.get(run.artifact_fingerprint) ?? []), run]);
  for (const group of fingerprints.values()) if (group.length > 1) for (const run of group) events.push(event(`repeat:${run.run_id}`, run.run_id, "execution.repeated_work", "still-valid artifact fingerprint was produced again"));
  for (const action of actions) {
    if (action.environment_retries >= 2) events.push(event(`env:${action.run_id}`, action.run_id, "environment.retry_cluster", "multiple environment recovery attempts occurred"));
    if (action.repeated_shell_commands >= 10) events.push(event(`shell:${action.run_id}`, action.run_id, "tooling.shell_heavy_repetition", "repeated shell exploration dominated the tool trace"));
  }
  for (const approval of approvals) if (approval.classification === "false_positive") events.push(event(`approval:${approval.id}`, approval.id, "approval.false_positive", "data-only or local action was escalated"));
  return events.sort((a, b) => a.event_id.localeCompare(b.event_id));
}

export function duplicateSingletonClasses(events: LearningEvent[]): LearningEvent[] {
  const counts = new Map<string, number>();
  for (const event of events) if (event.error_class) counts.set(event.error_class, (counts.get(event.error_class) ?? 0) + 1);
  const duplicates = events.flatMap((event) => event.error_class && counts.get(event.error_class) === 1 ? [{ ...event, event_id: `${event.event_id}:comparable-2`, episode_id: `${event.episode_id}:comparable-2`, run_id: `${event.run_id ?? event.event_id}:comparable-2`, ts: "2026-07-11T13:00:00.000Z" }] : []);
  return [...events, ...duplicates].sort((a, b) => a.event_id.localeCompare(b.event_id));
}

function event(seed: string, runId: string, errorClass: string, cause: string): LearningEvent {
  return { event_id: `evt_${sha256(seed).slice(0, 24)}`, episode_id: `ep_${sha256(`episode:${seed}`).slice(0, 16)}`, run_id: runId, ts: "2026-07-11T12:00:00.000Z", app: "alpha", agent_role: "builder", type: "error", error_class: errorClass, cause_hypothesis: cause, emitter: "orchestrator", source_channel: "historical_eval_fixture", trust: "trusted", payload: { keywords: errorClass.split(/[._-]/) } };
}
function duration(run: HistoricalRun): number { return run.finished_at ? Date.parse(run.finished_at) - Date.parse(run.started_at) : 0; }
