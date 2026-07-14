// Idempotent capture projector (docs/learning-loop/learning-loop-design.md §5;
// spec §4).
//
// Capture is a projection, not a new write path: the projector walks
// runs/<app>/<runId>/{envelope.json, events.jsonl} with a persistent cursor
// and emits learning events. Gate outcomes come from L1 `gate_results` (the
// authoritative rollup — it includes skipped gates) with L2 `gate.*` as the
// fallback for runs that never patched a rollup; pass verdicts come from L2
// `verdict.recorded` ONLY — they are not persisted anywhere else on disk.
//
// Exactly-once has two layers:
//   1. the cursor skips runs already projected (cheap, the common case);
//   2. every derived event has a DETERMINISTIC id and ts, and appends are
//      filtered against the ids already in the target file — so a crash
//      between append and cursor write re-derives byte-identical events and
//      drops them as duplicates instead of double-emitting.
// Only terminal runs project. A live run has no cursor entry and is retried
// on the next projection; the heartbeat/reconcile path (preflight #28)
// guarantees stalled runs eventually finalize.

import { existsSync } from "node:fs";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { readEnvelope, type GateResultEntry, type RunEnvelope } from "../../runtime/runlog/envelope.js";
import { readEvents, type RunlogEvent } from "../../runtime/runlog/events.js";
import { RUN_ID_RE } from "../../runtime/runlog/paths.js";
import { writeFileAtomic } from "../atomic.js";
import { readJournal } from "../journal.js";
import {
  journalEpisodeAnchor,
  ticketEpisodeAnchor,
  turnEpisodeAnchor,
  type EpisodeAnchor,
} from "./episodes.js";
import {
  appendLearningEventsDeduped,
  learningEventPath,
  type GateVerdictStatus,
  type LearningEvent,
} from "./events.js";

export interface CaptureCursor {
  schema_version: 1;
  /** `<app>/<runId>` → projection receipt. Presence means fully projected. */
  runs: Record<string, { projected_at: string; events: number; event_files?: string[] }>;
}

export interface ProjectCaptureOptions {
  stateHome: string;
  /** App → lifecycle stage (apps.yaml `status`), stamped on events when known. */
  appStages?: Record<string, string>;
  clock?: () => Date;
}

export interface CaptureProjectionResult {
  /** `read_only` previews pending projection work; `refreshed` performed the
   * idempotent projection writes. */
  mode: "read_only" | "refreshed";
  refreshRequired: boolean;
  /** Terminal runs projected this call. */
  runsProjected: number;
  /** Runs skipped via cursor receipt (already projected). */
  runsAlreadyProjected: number;
  /** Runs left for a later call: still running, or unreadable envelope. */
  runsPending: number;
  /** Exact retry identities/reasons; a scalar count cannot drive recovery. */
  pendingRuns: Array<{ app: string; runId: string; reason: "unreadable_envelope" | "still_running" }>;
  eventsEmitted: number;
  /** Events re-derived but already present in the target file (crash replay). */
  eventsDeduped: number;
  /** Cursor receipts whose promised event files were absent and rebuilt from
   * immutable run evidence. */
  runsRepaired: number;
  eventFilesRecovered: number;
  /** Legacy/path-mismatched receipts that an explicit refresh will rebind. */
  receiptsNeedingUpgrade: number;
  /** Incomplete projections that could not be fully reconstructed. */
  warnings: string[];
}

export function captureCursorPath(stateHome: string): string {
  return join(stateHome, "learning", "metrics", "capture-cursor.json");
}

export async function projectCaptureEvents(
  options: ProjectCaptureOptions,
): Promise<CaptureProjectionResult> {
  return captureEvents(options, true);
}

/** Read-only scan used by `operon learn report`. It derives enough from the
 * immutable run evidence to identify new/missing projections but never
 * appends events, rewrites the cursor, or projects episode records. */
export async function previewCaptureEvents(
  options: ProjectCaptureOptions,
): Promise<CaptureProjectionResult> {
  return captureEvents(options, false);
}

async function captureEvents(
  options: ProjectCaptureOptions,
  write: boolean,
): Promise<CaptureProjectionResult> {
  const { stateHome } = options;
  const clock = options.clock ?? ((): Date => new Date());
  const cursor = await readCursor(stateHome);
  const result: CaptureProjectionResult = {
    mode: write ? "refreshed" : "read_only",
    refreshRequired: false,
    runsProjected: 0,
    runsAlreadyProjected: 0,
    runsPending: 0,
    pendingRuns: [],
    eventsEmitted: 0,
    eventsDeduped: 0,
    runsRepaired: 0,
    eventFilesRecovered: 0,
    receiptsNeedingUpgrade: 0,
    warnings: [],
  };

  for (const { app, runId } of await listRuns(stateHome)) {
    const key = `${app}/${runId}`;
    const receipt = cursor.runs[key];
    if (
      receipt !== undefined &&
      (receipt.events === 0 || receiptFilesExist(stateHome, receipt.event_files))
    ) {
      result.runsAlreadyProjected += 1;
      continue;
    }

    let envelope: RunEnvelope;
    try {
      envelope = await readEnvelope(stateHome, app, runId);
    } catch {
      result.runsPending += 1; // no/torn envelope — retry on a later projection
      result.pendingRuns.push({ app, runId, reason: "unreadable_envelope" });
      continue;
    }
    if (envelope.status === "running") {
      result.runsPending += 1;
      result.pendingRuns.push({ app, runId, reason: "still_running" });
      continue;
    }

    const events = await deriveRunEvents(stateHome, envelope, options.appStages);
    const eventFiles = eventFileRefs(stateHome, events);
    if (receipt !== undefined && receipt.events > events.length) {
      result.warnings.push(
        `${key}: capture cursor records ${receipt.events} event(s), but surviving run evidence derives only ${events.length}`,
      );
    }
    const missingBefore = eventFiles.filter((path) => !existsSync(join(stateHome, path)));
    if (receipt !== undefined && missingBefore.length === 0) {
      // Legacy receipt migration: the event file exists, but older cursors did
      // not bind the receipt to its paths. Upgrade without re-appending.
      result.receiptsNeedingUpgrade += 1;
      result.refreshRequired ||= !write;
      if (write) {
        cursor.runs[key] = {
          ...receipt,
          event_files: eventFiles,
        };
      }
      result.runsAlreadyProjected += 1;
      continue;
    }
    result.refreshRequired ||= !write;
    if (write) {
      const { emitted, deduped } = await appendLearningEventsDeduped(stateHome, events);
      result.eventsEmitted += emitted;
      result.eventsDeduped += deduped;
      cursor.runs[key] = {
        projected_at: clock().toISOString(),
        events: events.length,
        event_files: eventFiles,
      };
    }
    if (receipt === undefined) {
      result.runsProjected += 1;
    } else {
      result.runsRepaired += 1;
      result.eventFilesRecovered += missingBefore.length;
    }
  }

  if (write) await writeCursor(stateHome, cursor);
  return result;
}

function eventFileRefs(stateHome: string, events: LearningEvent[]): string[] {
  return [
    ...new Set(events.map((event) => relative(stateHome, learningEventPath(stateHome, event)))),
  ].sort();
}

function receiptFilesExist(stateHome: string, refs: string[] | undefined): boolean {
  if (refs === undefined || refs.length === 0) return false;
  return refs.every((ref) => {
    const parts = ref.split(/[\\/]/);
    return (
      parts[0] === "learning" &&
      parts[1] === "events" &&
      !parts.includes("..") &&
      existsSync(join(stateHome, ref))
    );
  });
}

// ---------------------------------------------------------------------------
// derivation
// ---------------------------------------------------------------------------

async function deriveRunEvents(
  stateHome: string,
  envelope: RunEnvelope,
  appStages: Record<string, string> | undefined,
): Promise<LearningEvent[]> {
  const l2 = await readRunEvents(stateHome, envelope);
  const anchor = await deriveEpisodeAnchor(stateHome, envelope);
  const base = {
    episode_id: anchor.episodeId,
    turn_id: envelope.trace_id,
    run_id: envelope.run_id,
    app: envelope.app,
    agent_role: envelope.role,
    pipeline: envelope.pipeline,
    pass: envelope.pass,
    stage: appStages?.[envelope.app] ?? null,
    risk_tier: null,
    release_disposition: null,
    source_channel: "internal",
    trust: "trusted",
  } as const;

  const out: LearningEvent[] = [];

  // Gate outcomes. L1 gate_results is the rollup written by the gate phase;
  // when a run predates it (or the phase crashed before patching), the L2
  // gate.passed/gate.failed stream still carries the outcomes — but never
  // read both, or every gate double-counts.
  const gateResults = envelope.gate_results ?? [];
  if (gateResults.length > 0) {
    const ts = envelope.finished_at ?? envelope.started_at;
    gateResults.forEach((gate, i) => {
      out.push({
        ...base,
        event_id: `evt_${envelope.run_id}_gate${i}_${idSegment(gate.gate)}`,
        ts,
        type: "gate_verdict",
        emitter: "verifier",
        ...(gate.status === "failed" ? { error_class: `gate.${gate.gate}` } : {}),
        payload: {
          gate: gate.gate,
          status: gateStatus(gate),
          ...(gate.detail !== undefined ? { detail: gate.detail } : {}),
        },
      });
    });
  } else {
    for (const { event, index } of indexed(l2)) {
      if (event.event !== "gate.passed" && event.event !== "gate.failed") continue;
      const gate = String(event.detail?.["gate"] ?? "unknown");
      const status: GateVerdictStatus = event.event === "gate.passed" ? "pass" : "fail";
      out.push({
        ...base,
        event_id: `evt_${envelope.run_id}_l2-${index}`,
        ts: event.ts,
        type: "gate_verdict",
        emitter: "verifier",
        ...(status === "fail" ? { error_class: `gate.${gate}` } : {}),
        payload: { ...(event.detail ?? {}), gate, status },
      });
    }
  }

  // Pass verdicts: L2 verdict.recorded only (spec §4).
  for (const { event, index } of indexed(l2)) {
    if (event.event !== "verdict.recorded") continue;
    out.push({
      ...base,
      event_id: `evt_${envelope.run_id}_l2-${index}`,
      ts: event.ts,
      type: "pass_verdict",
      emitter: "orchestrator",
      payload: { ...(event.detail ?? {}) },
    });
  }

  return out;
}

/** Build runs anchor on their ticket; dispatched turns anchor on the
 *  journal's persisted TurnEvent (issue #26); schedule-triggered turns are
 *  their own episode (spec §5, design §8.1). Shared with the M2 episode
 *  projector, which needs the anchor's kind and source ref too. */
export async function deriveEpisodeAnchor(
  stateHome: string,
  envelope: RunEnvelope,
): Promise<EpisodeAnchor> {
  if (envelope.ticket !== undefined) {
    return ticketEpisodeAnchor(envelope.app, envelope.ticket);
  }
  try {
    const journal = await readJournal(stateHome, envelope.trace_id);
    return journalEpisodeAnchor(envelope.app, journal, envelope.trace_id);
  } catch {
    // No journal for this trace (loop passes journal under ticket state, not
    // state/turns) — fall through to the turn-anchored id.
  }
  return turnEpisodeAnchor(envelope.app, envelope.trace_id);
}

async function readRunEvents(stateHome: string, envelope: RunEnvelope): Promise<RunlogEvent[]> {
  try {
    return await readEvents(stateHome, envelope.app, envelope.run_id);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error; // mid-file corruption stays loud (readEvents contract)
  }
}

function gateStatus(gate: GateResultEntry): GateVerdictStatus {
  return gate.status === "passed" ? "pass" : gate.status === "failed" ? "fail" : "skip";
}

function indexed(events: RunlogEvent[]): Array<{ event: RunlogEvent; index: number }> {
  return events.map((event, index) => ({ event, index }));
}

function idSegment(part: string): string {
  const cleaned = part.replace(/[^A-Za-z0-9.-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned === "" ? "unknown" : cleaned;
}

// ---------------------------------------------------------------------------
// run listing + cursor
// ---------------------------------------------------------------------------

/** Reserved runlog namespace for M5 replay attempts (replay.ts executes
 *  under it). Declared here — the projection side — because the exclusion
 *  is what makes the reservation real. */
export const REPLAY_RUNLOG_APP = "learning-replay";

export async function listRuns(
  stateHome: string,
): Promise<Array<{ app: string; runId: string }>> {
  const root = join(stateHome, "runs");
  if (!existsSync(root)) return [];
  const out: Array<{ app: string; runId: string }> = [];
  const apps = (await readdir(root, { withFileTypes: true }))
    // The reserved replay namespace (M5) never enters capture or episode
    // projection: a replay attempt must not become evidence in the store it
    // is judged against. Reconcile still walks it — spend recovery is about
    // money, not evidence.
    .filter((entry) => entry.isDirectory() && entry.name !== REPLAY_RUNLOG_APP)
    .map((entry) => entry.name)
    .sort();
  for (const app of apps) {
    const runIds = (await readdir(join(root, app), { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && RUN_ID_RE.test(entry.name))
      .map((entry) => entry.name)
      .sort();
    out.push(...runIds.map((runId) => ({ app, runId })));
  }
  return out;
}

async function readCursor(stateHome: string): Promise<CaptureCursor> {
  const path = captureCursorPath(stateHome);
  if (!existsSync(path)) return { schema_version: 1, runs: {} };
  const parsed = JSON.parse(await readFile(path, "utf8")) as CaptureCursor;
  if (parsed.schema_version !== 1 || typeof parsed.runs !== "object" || parsed.runs === null) {
    throw new Error(`learning: ${path} is not a valid v1 capture cursor`);
  }
  return parsed;
}

async function writeCursor(stateHome: string, cursor: CaptureCursor): Promise<void> {
  const path = captureCursorPath(stateHome);
  await mkdir(dirname(path), { recursive: true });
  await writeFileAtomic(path, JSON.stringify(cursor, null, 2) + "\n");
}
