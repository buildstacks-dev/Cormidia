// L1 envelope lifecycle (build plan M2.5; docs/loop.md §9).
//
// One envelope.json per executed pass: ids, status, timings, token/cost
// rollups, gate results, tool counts, truncated previews — and REFERENCES
// to the L3 files, never their content (the predecessor's wf_*.json
// monolith lesson). Dashboards read L1+L2 only, so everything preview-like
// passes through redaction here, unconditionally.
//
// telemetry.ts stays (standing decision in TODO.md): envelopes are
// per-pass observability; per-turn cost still flows through recordTurn.
//
// The clock is always a parameter (FakeClock-compatible) — nothing here
// calls Date.now(). Writes go through tmp+rename so a reader never sees a
// half-written envelope.

import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { runPaths } from "./paths.js";
import { scrubSecrets, truncatePreview } from "./redact.js";

/** Terminal statuses: infra errors are `failed` (+ error_code); merit
 *  outcomes (findings, blocked-with-evidence) are their own statuses —
 *  infra and merit never conflate (§9). */
export type EnvelopeStatus = "running" | "completed" | "failed" | "blocked";
const TERMINAL: EnvelopeStatus[] = ["completed", "failed", "blocked"];

export interface EnvelopeUsage {
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  /** True when cost_usd is a local heuristic estimate, not a provider-reported
   *  figure (e.g. codex/gpt-5.5 prices from a static table). Persisted so the
   *  dashboard can mark it honestly instead of showing it as a real charge. */
  cost_estimated?: boolean;
  /** Cache visibility (§9): input tokens come in three price classes. */
  cache_read_tokens?: number;
  cache_write_tokens?: number;
  subagent_turns?: number;
}

export interface GateResultEntry {
  gate: string;
  status: "passed" | "failed" | "skipped";
  detail?: string;
}

export interface RunEnvelope {
  schema_version: 1;
  run_id: string;
  /** turnId — one per pipeline execution; L2 events correlate on it. */
  trace_id: string;
  app: string;
  ticket?: string;
  pipeline: string;
  pass: string;
  role: string;
  model?: string;
  /** Workdir HEAD at pass start — the replay seed commit (learning-loop
   *  spec §7). Absent for non-git workdirs and pre-M2b runs. */
  git_head?: string;
  status: EnvelopeStatus;
  started_at: string;
  finished_at?: string;
  /** Heartbeat: stamped periodically while the pass runs, so a reader can
   *  tell a live pass from a hung one (Stage 3) — the episode lost five
   *  hours to a stall indistinguishable from progress. */
  last_seen_at?: string;
  wall_clock_ms?: number;
  usage?: EnvelopeUsage;
  /** tool name → call count. Never args (§9) — those live hashed in L2. */
  tool_counts?: Record<string, number>;
  gate_results?: GateResultEntry[];
  /** Truncated + scrubbed, ~120 chars. */
  verdict_summary?: string;
  /** Named previews (task, output, …) — truncated + scrubbed, always. */
  previews?: Record<string, string>;
  /** Machine error code on infra failures (§9 infra-vs-merit). */
  error_code?: string;
  /** REFERENCES to the L3/L2 siblings, relative to the run dir. A ref is a
   *  promise: `session_log` is declared while the run is live (the sink may
   *  still produce it) and dropped at finalize when no file was written —
   *  adapters that emit no TurnEvents leave nothing for the sink to append
   *  (telemetry doc Defect C). */
  refs: { events: string; brief: string; output: string; session_log?: string };
}

export interface StartRunMeta {
  runId: string;
  traceId: string;
  app: string;
  ticket?: string;
  pipeline: string;
  pass: string;
  role: string;
  model?: string;
  /** Workdir HEAD at pass start — the replay seed (learning-loop design
   *  §9.4: capture for replay while the episode runs, never reconstruct
   *  afterward). Absent when the workdir is not a git checkout. */
  gitHead?: string;
}

/** Everything updateEnvelope may patch mid-run. Provided keys replace;
 *  `previews` and `tool_counts` merge (they accumulate across a pass). */
export interface EnvelopePatch {
  usage?: EnvelopeUsage;
  tool_counts?: Record<string, number>;
  gate_results?: GateResultEntry[];
  previews?: Record<string, string>;
  /** Heartbeat stamp (ISO). */
  lastSeenAt?: string;
}

export interface FinalizeOutcome {
  status: Exclude<EnvelopeStatus, "running">;
  verdictSummary?: string;
  errorCode?: string;
  usage?: EnvelopeUsage;
}

export async function startRun(
  root: string,
  meta: StartRunMeta,
  now: Date,
): Promise<RunEnvelope> {
  const paths = runPaths(root, meta.app, meta.runId);
  await mkdir(paths.dir, { recursive: true });

  const envelope: RunEnvelope = {
    schema_version: 1,
    run_id: meta.runId,
    trace_id: meta.traceId,
    app: meta.app,
    ...(meta.ticket !== undefined ? { ticket: meta.ticket } : {}),
    pipeline: meta.pipeline,
    pass: meta.pass,
    role: meta.role,
    ...(meta.model !== undefined ? { model: meta.model } : {}),
    ...(meta.gitHead !== undefined ? { git_head: meta.gitHead } : {}),
    status: "running",
    started_at: now.toISOString(),
    refs: {
      events: "events.jsonl",
      brief: "brief.md",
      output: "output.md",
      session_log: "session.log",
    },
  };
  await writeEnvelope(paths.envelope, envelope);
  return envelope;
}

export async function updateEnvelope(
  root: string,
  app: string,
  runId: string,
  patch: EnvelopePatch,
): Promise<RunEnvelope> {
  const envelope = await readEnvelope(root, app, runId);
  if (TERMINAL.includes(envelope.status)) {
    throw new Error(
      `runlog: envelope ${runId} is already ${envelope.status} — updates after finalize are a bug`,
    );
  }

  if (patch.usage !== undefined) envelope.usage = patch.usage;
  if (patch.lastSeenAt !== undefined) envelope.last_seen_at = patch.lastSeenAt;
  if (patch.gate_results !== undefined) envelope.gate_results = patch.gate_results;
  if (patch.tool_counts !== undefined) {
    envelope.tool_counts = { ...envelope.tool_counts, ...patch.tool_counts };
  }
  if (patch.previews !== undefined) {
    const redacted: Record<string, string> = {};
    for (const [name, text] of Object.entries(patch.previews)) {
      redacted[name] = truncatePreview(scrubSecrets(text));
    }
    envelope.previews = { ...envelope.previews, ...redacted };
  }

  await writeEnvelope(runPaths(root, app, runId).envelope, envelope);
  return envelope;
}

export async function finalizeRun(
  root: string,
  app: string,
  runId: string,
  outcome: FinalizeOutcome,
  now: Date,
): Promise<RunEnvelope> {
  const envelope = await readEnvelope(root, app, runId);
  if (TERMINAL.includes(envelope.status)) {
    throw new Error(`runlog: envelope ${runId} is already ${envelope.status} — double finalize`);
  }

  envelope.status = outcome.status;
  envelope.finished_at = now.toISOString();
  envelope.wall_clock_ms = now.getTime() - new Date(envelope.started_at).getTime();
  if (outcome.usage !== undefined) envelope.usage = outcome.usage;
  if (outcome.verdictSummary !== undefined) {
    envelope.verdict_summary = truncatePreview(scrubSecrets(outcome.verdictSummary));
  }
  if (outcome.errorCode !== undefined) envelope.error_code = outcome.errorCode;
  // Keep the session_log ref only when the sink actually produced the file —
  // a terminal envelope must never reference a file that does not exist.
  if (!existsSync(runPaths(root, app, runId).sessionLog)) {
    delete envelope.refs.session_log;
  }

  await writeEnvelope(runPaths(root, app, runId).envelope, envelope);
  return envelope;
}

export async function readEnvelope(
  root: string,
  app: string,
  runId: string,
): Promise<RunEnvelope> {
  const path = runPaths(root, app, runId).envelope;
  const parsed = JSON.parse(await readFile(path, "utf8")) as RunEnvelope;
  if (parsed.schema_version !== 1 || typeof parsed.run_id !== "string" || !parsed.status) {
    throw new Error(`runlog: ${path} is not a valid v1 envelope`);
  }
  return parsed;
}

/** tmp+rename: a dashboard reading mid-write sees the old envelope, never
 *  a truncated one. */
async function writeEnvelope(path: string, envelope: RunEnvelope): Promise<void> {
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(envelope, null, 2) + "\n", "utf8");
  await rename(tmp, path);
}
