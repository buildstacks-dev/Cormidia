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
import { appendFile, mkdir, readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";

/** Spec §4 type enum, plus `pass_verdict`: capture explicitly persists L2
 *  `verdict.recorded` (design §5 — verdicts exist nowhere else on disk), but
 *  the draft enum predates that and has no member for it. Recorded as a spec
 *  delta in the M1a PR. */
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
  const stream = sanitizeStream(event.turn_id ?? event.emitter);
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
  const lines = (await readFile(path, "utf8")).split("\n").filter((line) => line !== "");
  const events: LearningEvent[] = [];
  lines.forEach((line, i) => {
    try {
      events.push(JSON.parse(line) as LearningEvent);
    } catch {
      if (i !== lines.length - 1) {
        throw new Error(
          `learning: ${path}:${i + 1} is malformed mid-file — corruption, not a torn append`,
        );
      }
    }
  });
  return events;
}

function sanitizeStream(part: string): string {
  const cleaned = part.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "");
  return cleaned === "" ? "unknown" : cleaned;
}
