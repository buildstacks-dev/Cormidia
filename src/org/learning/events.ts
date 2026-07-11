// Learning event schema + JSONL sink (docs/learning-loop/learning-loop-spec.md
// §4; design §5 "Capture").
//
// Events live in the STATE home (high churn), one file per (UTC date, stream):
//   <stateHome>/learning/events/<date>/<stream>.jsonl
// The stream is the turn id when the event has one, else the emitter — the
// reader scans the whole tree, so the split is for humans and retention, not
// lookup. Reads follow the same torn-tail-line contract as runlog L2
// (src/runtime/runlog/events.ts readEvents): a malformed FINAL line is a torn
// append and is dropped; a malformed line anywhere else is corruption and
// throws loudly.

import { existsSync } from "node:fs";
import { appendFile, mkdir, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { readJsonLinesTolerant } from "./records.js";

/** Spec §4 type enum, plus `pass_verdict`: capture explicitly persists L2
 *  `verdict.recorded` (design §5 — verdicts exist nowhere else on disk), but
 *  the draft enum predates that and has no member for it. Recorded as a spec
 *  delta in the M1a PR. `canary_assigned` is the M5 sticky-assignment event
 *  (design §8.4): emitted once per episode at first governed resolve while a
 *  canary is active. */
export type LearningEventType =
  | "error"
  | "human_correction"
  | "gate_verdict"
  | "pass_verdict"
  | "env_fact"
  | "tool_outcome"
  | "retro_note"
  | "artifact_created"
  | "concept_loaded"
  | "context_evicted"
  | "conflict_resolved"
  | "provisional_expired"
  | "canary_assigned"
  | "episode_opened"
  | "episode_closed"
  | "late_outcome"
  | "publish_committed";

export type LearningEmitter =
  | "agent"
  | "orchestrator"
  | "verifier"
  | "resolver"
  | "publisher"
  | "human";

/** Metric-bearing events must come from these emitters (spec §4); agent
 *  self-reports are advisory distillation input only (design §10). */
export const METRIC_EMITTERS: readonly LearningEmitter[] = [
  "orchestrator",
  "verifier",
  "resolver",
  "publisher",
  "human",
];

export type LearningTrust = "trusted" | "untrusted" | "legacy";

/** qgates status vocabulary (spec §4); the projector maps L1's
 *  `passed | failed | skipped` onto it. */
export type GateVerdictStatus = "pass" | "fail" | "skip";

export interface LearningEvent {
  event_id: string;
  episode_id: string;
  turn_id?: string;
  run_id?: string;
  ts: string;
  app: string;
  agent_role?: string;
  pipeline?: string;
  pass?: string;
  /** App lifecycle stage from the registry (apps.yaml `status`); null when
   *  the capture site had no registry in hand. */
  stage?: string | null;
  /** Risk tier is assigned by classification (M6); capture stamps null. */
  risk_tier?: string | null;
  release_disposition?: string | null;
  /** Resolver-pinned bundle versions/lineage arrive with M4; optional now so
   *  capture-only events don't fake them. */
  bundle_versions?: Record<string, string>;
  bundle_lineage?: string;
  type: LearningEventType;
  error_class?: string;
  cause_hypothesis?: string;
  emitter: LearningEmitter;
  source_channel: string;
  trust: LearningTrust;
  payload?: Record<string, unknown>;
}

export interface LearningEventSink {
  emit(event: LearningEvent): Promise<void>;
}

export function learningEventsDir(stateHome: string): string {
  return join(stateHome, "learning", "events");
}

/** `<events-dir>/<YYYY-MM-DD of event.ts>/<stream>.jsonl`. */
export function learningEventPath(stateHome: string, event: LearningEvent): string {
  const date = event.ts.slice(0, 10);
  const stream = sanitizeIdSegment(event.turn_id ?? event.emitter);
  return join(learningEventsDir(stateHome), date, `${stream}.jsonl`);
}

export function createLearningEventSink(stateHome: string): LearningEventSink {
  return {
    async emit(event: LearningEvent): Promise<void> {
      const path = learningEventPath(stateHome, event);
      await mkdir(dirname(path), { recursive: true });
      await appendFile(path, JSON.stringify(event) + "\n", "utf8");
    },
  };
}

/** Append events whose deterministic `event_id` is not already present in
 *  their target file — the exactly-once layer shared by every projector: a
 *  crash between append and cursor write re-derives byte-identical events and
 *  drops them as duplicates instead of double-emitting. */
export async function appendLearningEventsDeduped(
  stateHome: string,
  events: LearningEvent[],
): Promise<{ emitted: number; deduped: number }> {
  const byPath = new Map<string, LearningEvent[]>();
  for (const event of events) {
    const path = learningEventPath(stateHome, event);
    const bucket = byPath.get(path);
    if (bucket === undefined) byPath.set(path, [event]);
    else bucket.push(event);
  }

  let emitted = 0;
  let deduped = 0;
  for (const [path, bucket] of byPath) {
    const existing = existsSync(path)
      ? new Set((await readLearningEventFile(path)).map((event) => event.event_id))
      : new Set<string>();
    // Batch-internal dedup too: two same-id events in one call are one event.
    const fresh = bucket.filter((event) => {
      if (existing.has(event.event_id)) return false;
      existing.add(event.event_id);
      return true;
    });
    deduped += bucket.length - fresh.length;
    if (fresh.length === 0) continue;
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, fresh.map((event) => JSON.stringify(event)).join("\n") + "\n", "utf8");
    emitted += fresh.length;
  }
  return { emitted, deduped };
}

/** Every learning event across all dates/streams, in (date, stream, line)
 *  order. Per-file torn-tail contract; see module header. */
export async function readLearningEvents(stateHome: string): Promise<LearningEvent[]> {
  const events: LearningEvent[] = [];
  for (const path of await listLearningEventFiles(stateHome)) {
    events.push(...(await readLearningEventFile(path)));
  }
  return events;
}

export async function listLearningEventFiles(stateHome: string): Promise<string[]> {
  const root = learningEventsDir(stateHome);
  if (!existsSync(root)) return [];
  const paths: string[] = [];
  const dates = (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  for (const date of dates) {
    const files = (await readdir(join(root, date)))
      .filter((name) => name.endsWith(".jsonl"))
      .sort();
    paths.push(...files.map((name) => join(root, date, name)));
  }
  return paths;
}

export async function readLearningEventFile(path: string): Promise<LearningEvent[]> {
  return readJsonLinesTolerant<LearningEvent>(path);
}

/** Sanitize an id (turn id, journal id, event-id segment) into a safe
 *  filename/identifier segment — shared by every component that derives
 *  paths or deterministic event ids from ids, so the dedupe keys and file
 *  names they produce can never disagree. */
export function sanitizeIdSegment(part: string): string {
  const cleaned = part.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "");
  return cleaned === "" ? "unknown" : cleaned;
}
