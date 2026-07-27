// L1 envelope lifecycle (build plan M2.5; docs/loop/design.md §9).
//
// One envelope.json per executed pass: ids, status, timings, token/cost
// rollups, gate results, tool counts, durable verdict material, truncated
// previews — and REFERENCES
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
import type {
  Artifact,
  AuthorityEvidence,
  Effort,
  RuntimeKind,
  SessionHandle,
  TurnAssignmentSource,
  UsageQuality,
} from "../types.js";

/** Terminal statuses: infra errors are `failed` (+ error_code); merit
 *  outcomes (findings, blocked-with-evidence) are their own statuses —
 *  infra and merit never conflate (§9). */
export type EnvelopeStatus =
  | "running"
  | "completed"
  | "failed"
  | "blocked"
  | "cancelled"
  | "timed_out";
const TERMINAL: EnvelopeStatus[] = ["completed", "failed", "blocked", "cancelled", "timed_out"];

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
  /** Whether the snapshot is final, partial, locally estimated, absent at the
   * provider boundary, or `none` — an authoritative zero for a pass that
   * invoked no provider at all (see UsageQuality in ../types.ts). */
  quality?: UsageQuality;
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
  /** Broader delegated operator task, when the top-level harness registered one. */
  parent_task_id?: string;
  /** End-to-end efficiency/admission identity. */
  episode_id?: string;
  /** Accepted plan version and provider-step identity that authorized this run. */
  plan_version?: number;
  plan_step_id?: string;
  app: string;
  ticket?: string;
  pipeline: string;
  pass: string;
  role: string;
  /** Runtime/harness and effort are separate from model identity. */
  runtime?: RuntimeKind;
  model?: string;
  effort?: Effort;
  /** Audit evidence for the atomic harness/model/effort assignment. */
  assignment_source?: TurnAssignmentSource;
  assignment_candidate_id?: string;
  selection_reason?: string;
  resolved_capabilities?: string[];
  /** Actual directory and Git identity observed at pass start. */
  workdir?: string;
  git_branch?: string;
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
  /**
   * Redacted durable verdict material. Structured JSON verdicts remain
   * complete, valid JSON strings; prose-only legacy summaries remain bounded
   * previews. This distinction keeps machine-readable truth out of the
   * presentation-only truncation path.
   */
  verdict_summary?: string;
  /** Named previews (task, output, …) — truncated + scrubbed, always. */
  previews?: Record<string, string>;
  /** Machine error code on infra failures (§9 infra-vs-merit). */
  error_code?: string;
  /** Human-readable terminal cause (signal, timeout, provider failure). */
  terminal_reason?: string;
  /** Native provider session identity and honest transcript availability. */
  session?: SessionEvidence;
  /** Structured durable artifacts returned by the runtime. */
  artifacts?: Artifact[];
  /** The pass set selected for this trace and the configured passes omitted
   * by tier/trigger routing. Duplicated per pass so each envelope remains
   * independently auditable. */
  trace_plan?: TracePlanEvidence;
  planning_route?: PlanningRouteEvidence;
  /** Content-bound effective delegated authority for this run. */
  authority?: AuthorityEvidence;
  /** One parent pass can contain multiple adapter invocations. */
  provider_turn_ids?: string[];
  /** Provider and mechanical terminal execution records owned by the episode. */
  execution_step_ids?: string[];
  /** REFERENCES to the L3/L2 siblings, relative to the run dir. A ref is a
   *  promise: `session_log` is declared while the run is live (the sink may
   *  still produce it) and dropped at finalize when no file was written —
   *  adapters that emit no TurnEvents leave nothing for the sink to append
   *  (telemetry doc Defect C). */
  refs: {
    events: string;
    brief: string;
    prompt?: string;
    output: string;
    session_log?: string;
    context_manifest?: string;
    /** Caller-owned, content-bound input selection/consumption evidence. */
    input_manifest?: string;
  };
}

export interface TracePlanEvidence {
  required_passes: string[];
  skipped_passes: Array<{ pass: string; reason: string }>;
}

export interface PlanningRouteEvidence {
  policy_version: string;
  depth: "quick" | "standard" | "deep";
  /** Episode execution route after safety floors. Kept separate from the
   *  lifecycle-selected planning pass depth. */
  episode_route?: "quick" | "standard" | "deep";
  disposition?: string;
  risk_tier: string;
  factors: Record<string, unknown>;
  decision_factors: string[];
  execution_admission_factors?: Array<{ kind: string; evidence: string; policy_rule: string }>;
  execution_decision_factors?: string[];
  selected_passes: string[];
  skipped_passes: Array<{ pass: string; reason: string }>;
  pass_rationales?: Array<{ pass: string; expected_risk_reduction: string; evidence: string }>;
  estimated_cost_usd: number | null;
  estimated_cost_upper_bound_usd: number;
  estimate_basis: string;
  outcome_measurement?: {
    status: "measured" | "unavailable";
    selected_pass_count: number;
    comparable_episodes: number;
    lower_pass_episodes: number;
    comparable_downstream_failure_rate: number | null;
    lower_pass_downstream_failure_rate: number | null;
    observed_failure_rate_delta: number | null;
    basis: string;
  };
}

export interface SessionEvidence extends SessionHandle {
  /** A native task/session link when the harness exposes one. */
  native_ref?: string;
  transcript: "native_task" | "provider_session" | "unavailable";
  transcript_note: string;
}

export interface StartRunMeta {
  runId: string;
  traceId: string;
  parentTaskId?: string;
  episodeId?: string;
  planVersion?: number;
  planStepId?: string;
  app: string;
  ticket?: string;
  pipeline: string;
  pass: string;
  role: string;
  runtime?: RuntimeKind;
  model?: string;
  effort?: Effort;
  assignmentSource?: TurnAssignmentSource;
  assignmentCandidateId?: string;
  selectionReason?: string;
  resolvedCapabilities?: string[];
  workdir?: string;
  gitBranch?: string;
  tracePlan?: TracePlanEvidence;
  planningRoute?: PlanningRouteEvidence;
  authority?: AuthorityEvidence;
  providerTurnIds?: string[];
  executionStepIds?: string[];
  inputManifestRef?: string;
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
  session?: SessionEvidence;
  artifacts?: Artifact[];
  providerTurnIds?: string[];
  executionStepIds?: string[];
  contextManifestRef?: string;
}

export interface FinalizeOutcome {
  status: Exclude<EnvelopeStatus, "running">;
  verdictSummary?: string;
  errorCode?: string;
  usage?: EnvelopeUsage;
  reason?: string;
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
    ...(meta.parentTaskId !== undefined ? { parent_task_id: meta.parentTaskId } : {}),
    ...(meta.episodeId !== undefined ? { episode_id: meta.episodeId } : {}),
    ...(meta.planVersion !== undefined ? { plan_version: meta.planVersion } : {}),
    ...(meta.planStepId !== undefined ? { plan_step_id: meta.planStepId } : {}),
    app: meta.app,
    ...(meta.ticket !== undefined ? { ticket: meta.ticket } : {}),
    pipeline: meta.pipeline,
    pass: meta.pass,
    role: meta.role,
    ...(meta.runtime !== undefined ? { runtime: meta.runtime } : {}),
    ...(meta.model !== undefined ? { model: meta.model } : {}),
    ...(meta.effort !== undefined ? { effort: meta.effort } : {}),
    ...(meta.assignmentSource !== undefined ? { assignment_source: meta.assignmentSource } : {}),
    ...(meta.assignmentCandidateId !== undefined
      ? { assignment_candidate_id: meta.assignmentCandidateId }
      : {}),
    ...(meta.selectionReason !== undefined
      ? { selection_reason: scrubSecrets(meta.selectionReason) }
      : {}),
    ...(meta.resolvedCapabilities !== undefined
      ? { resolved_capabilities: [...meta.resolvedCapabilities] }
      : {}),
    ...(meta.workdir !== undefined ? { workdir: meta.workdir } : {}),
    ...(meta.gitBranch !== undefined ? { git_branch: meta.gitBranch } : {}),
    ...(meta.tracePlan !== undefined ? { trace_plan: meta.tracePlan } : {}),
    ...(meta.planningRoute !== undefined ? { planning_route: meta.planningRoute } : {}),
    ...(meta.authority !== undefined ? { authority: meta.authority } : {}),
    ...(meta.providerTurnIds !== undefined ? { provider_turn_ids: [...meta.providerTurnIds] } : {}),
    ...(meta.executionStepIds !== undefined ? { execution_step_ids: [...meta.executionStepIds] } : {}),
    ...(meta.gitHead !== undefined ? { git_head: meta.gitHead } : {}),
    status: "running",
    started_at: now.toISOString(),
    refs: {
      events: "events.jsonl",
      brief: "brief.md",
      prompt: "prompt.md",
      output: "output.md",
      session_log: "session.log",
      ...(meta.inputManifestRef !== undefined ? { input_manifest: meta.inputManifestRef } : {}),
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
  if (patch.session !== undefined) envelope.session = patch.session;
  if (patch.artifacts !== undefined) {
    envelope.artifacts = patch.artifacts.map((artifact) => ({
      ...artifact,
      ref: scrubSecrets(artifact.ref),
      summary: scrubSecrets(artifact.summary),
    }));
  }
  if (patch.providerTurnIds !== undefined) {
    envelope.provider_turn_ids = [...new Set([...(envelope.provider_turn_ids ?? []), ...patch.providerTurnIds])];
  }
  if (patch.executionStepIds !== undefined) {
    envelope.execution_step_ids = [...new Set([...(envelope.execution_step_ids ?? []), ...patch.executionStepIds])];
  }
  if (patch.contextManifestRef !== undefined) {
    envelope.refs.context_manifest = patch.contextManifestRef;
  }
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
    envelope.verdict_summary = durableVerdictSummary(outcome.verdictSummary);
  }
  if (outcome.errorCode !== undefined) envelope.error_code = outcome.errorCode;
  if (outcome.reason !== undefined) envelope.terminal_reason = scrubSecrets(outcome.reason);
  // Keep the session_log ref only when the sink actually produced the file —
  // a terminal envelope must never reference a file that does not exist.
  if (!existsSync(runPaths(root, app, runId).sessionLog)) {
    delete envelope.refs.session_log;
  }

  await writeEnvelope(runPaths(root, app, runId).envelope, envelope);
  return envelope;
}

/**
 * Preserve a structured verdict as complete JSON while retaining the legacy
 * bounded-summary behavior for prose verdicts. Redaction is applied to parsed
 * string values instead of raw JSON bytes so even a multi-line secret match
 * cannot consume a closing quote/brace and leave corrupt durable material.
 */
function durableVerdictSummary(text: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return truncatePreview(scrubSecrets(text));
  }

  const stored = JSON.stringify(scrubJsonStrings(parsed));
  if (stored === undefined) {
    throw new Error("runlog: structured verdict cannot be serialized");
  }
  // Write-time invariant: never commit structured verdict material that a
  // reader cannot parse. Keep this explicit even though JSON.stringify owns
  // serialization, so future storage changes cannot silently reintroduce
  // prefix truncation.
  try {
    JSON.parse(stored);
  } catch (error) {
    throw new Error("runlog: structured verdict did not survive JSON serialization", {
      cause: error,
    });
  }
  return stored;
}

function scrubJsonStrings(value: unknown): unknown {
  if (typeof value === "string") return scrubSecrets(value);
  if (Array.isArray(value)) return value.map(scrubJsonStrings);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .map(([key, entry]) => [scrubSecrets(key), scrubJsonStrings(entry)]),
    );
  }
  return value;
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

/**
 * The ONE place an envelope's usage quality is derived. Report, Observe, and
 * the status/telemetry CLIs all route through this so a mechanical pass cannot
 * be `none` on one surface and `unavailable` on another (#88, #89).
 *
 * Passes written since #88 carry `quality: "none"` explicitly. Older envelopes
 * are recognized structurally rather than by sniffing the pass name for
 * "gate" — the two previous copies of that heuristic disagreed with each other
 * and both missed `provision/setup` entirely, which is exactly the pass the
 * buildstacks-site campaign flagged 14 times. A pass that invoked a provider
 * always records `runtime` and `model` at admission (src/loop/pipeline.ts), so
 * their joint absence — with no usage and no ledger settlement — is a sound
 * structural signal that no provider was ever constructed.
 */
export function classifyEnvelopeUsage(
  envelope: Pick<RunEnvelope, "usage" | "status" | "runtime" | "model">,
  options: { settledProviderTurns?: number } = {},
): UsageQuality {
  if (envelope.usage?.quality !== undefined) return envelope.usage.quality;
  const settled = options.settledProviderTurns ?? 0;
  if (
    envelope.usage === undefined &&
    envelope.runtime === undefined &&
    envelope.model === undefined &&
    settled === 0
  ) {
    return "none";
  }
  if (envelope.usage === undefined) return "unavailable";
  if (envelope.usage.cost_estimated === true) return "estimated";
  return envelope.status === "running" ? "partial" : "complete";
}

/** tmp+rename: a dashboard reading mid-write sees the old envelope, never
 *  a truncated one. */
async function writeEnvelope(path: string, envelope: RunEnvelope): Promise<void> {
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(envelope, null, 2) + "\n", "utf8");
  await rename(tmp, path);
}
