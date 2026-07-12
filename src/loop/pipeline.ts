// Pass executor (build plan M2.8; docs/loop.md §2, §4, §9, §10).
//
// Executes a loaded pipeline against a Runtime: fresh session per pass
// (req.session is never set — passes communicate only through durable
// artifacts, §2 rule 1); task = assembled brief + versioned pass template
// (§2); per-pass model/effort overrides copy the base RoleConfig, never
// mutate it — and cannot cross providers by construction, because the
// override touches model/effort only while `runtime` stays the role's own
// (§2 rule 3). Same-parallel_group passes run concurrently (§2 rule 4);
// the caller's gate propagates unchanged to every call.
//
// Every pass leaves its full run record (§9 — "if something executes, its
// logs exist"): L1 envelope opened → updated → finalized, L2 pass events,
// L3 brief/output verbatim plus session.log fed by onEvent. This is what
// closes the "library nobody calls" gap: the writers aren't optional
// utilities, they are the executor's own discipline.
//
// The loop layer never imports src/org (one-way imports): role resolution
// arrives as a plain name→RoleConfig map, runtimes as a factory.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  ContextBundle,
  RoleConfig,
  Runtime,
  TurnEvent,
  TurnHooks,
  TurnResult,
  TurnProgress,
  TurnUsage,
} from "../runtime/types.js";
import {
  recordTurnOnce,
  toRecord,
  type TriggerKind,
} from "../runtime/telemetry.js";
import {
  finalizeRun,
  startRun,
  updateEnvelope,
  type EnvelopeStatus,
  type EnvelopeUsage,
} from "../runtime/runlog/envelope.js";
import { gitHeadOf } from "../runtime/git.js";
import { createEventWriter, type EventWriter } from "../runtime/runlog/events.js";
import { createSessionLogSink, writeBrief, writeOutput } from "../runtime/runlog/forensics.js";
import { mintRunId } from "../runtime/runlog/paths.js";
import {
  parallelStages,
  selectPasses,
  type PassConfig,
  type PassSelection,
  type PipelineConfig,
} from "./pipelines.js";

export interface RunlogTarget {
  /** Org runtime home the runs/ tree lives under. */
  root: string;
  app: string;
  ticket?: string;
  /** turnId — one per pipeline execution; every pass's L2 trace_id. */
  traceId: string;
}

export interface ExecutePipelineOptions {
  pipeline: PipelineConfig;
  selection: PassSelection;
  /** Resolved role configs by name (the org layer resolves; loop consumes). */
  roles: Record<string, RoleConfig>;
  runtimeFor: (role: RoleConfig) => Runtime;
  /** Assembled brief per pass (src/loop/brief.ts is the usual producer). */
  briefFor: (pass: PassConfig) => string;
  /** Directory the pass templates live under (pipelines.yaml's sibling). */
  promptsDir: string;
  context: ContextBundle;
  workdir: string;
  /** Parent cancellation for the whole pipeline. */
  signal?: AbortSignal;
  /** Grace after abort for an adapter to return its final partial usage. */
  cancellationGraceMs?: number;
  /** gate propagates unchanged to every pass; onEvent (when present) still
   *  fires after the executor's own session-log sink. */
  hooks: TurnHooks;
  /** Optional role-aware gate factory. Manual build-loop ticks use this to
   *  compose the critical-op gate with the durable approval store for the
   *  actual role running each pass. */
  gateForRole?: (role: RoleConfig) => TurnHooks["gate"];
  runlog: RunlogTarget;
  /** Injected clock (FakeClock-compatible); defaults to the wall clock. */
  clock?: () => Date;
  /** Optional native structured-output schema per pass. */
  verdictSchemaFor?: (pass: PassConfig) => Record<string, unknown> | undefined;
  /** Explicit per-turn network grant; omitted/false keeps the sandbox offline. */
  networkAccess?: boolean;
  /** Ledger settlement target (telemetry doc Defect B). When present, every
   *  pass settles its measured usage into `<orgDir>/telemetry/` exactly once,
   *  keyed on its runId, at the moment the provider turn returns — regardless
   *  of the pipeline's terminal status. Failed, blocked, and aborted passes
   *  consume budget too. Callers that pass this MUST NOT sum pass usage into a
   *  second turn-level ledger row. */
  telemetry?: {
    orgDir: string;
    trigger?: TriggerKind;
    /** Learning-loop attribution (M5): stamped on every settled row so the
     *  learning budget overlay can roll replay spend up per experiment and
     *  per candidate. */
    experimentRef?: string;
    candidateRef?: string;
  };
  /** Runs after a pass completes and before the next sequential stage starts. */
  afterPass?: (record: PassRunRecord) => void | Promise<void>;
  /** Parse + record the pass's typed verdict, AFTER the turn and BEFORE the
   *  envelope is finalized. The loop layer owns verdict semantics (kinds,
   *  reformat retry, side effects); the executor only needs the ok/failed
   *  outcome so an unparseable verdict finalizes the pass as an infra failure
   *  (distinct error_code), never a merit outcome (docs/loop.md §6, §13 row
   *  11). `verdict.recorded` (§9) is emitted by the callback into the pass's
   *  own L2 writer. Never throws for a parse failure — it returns
   *  `{ok:false,…}` and the executor rethrows the typed error once the record
   *  is durable. */
  recordVerdict?: (ctx: VerdictRecordContext) => Promise<VerdictRecordOutcome>;
}

/** Everything the loop's verdict recorder needs, handed to it by the executor
 *  once the turn is done: the pass's run context plus the SAME runtime and
 *  hooks the turn used, so a reformat retry can resume the just-finished
 *  session (docs/loop.md §6). */
export interface VerdictRecordContext {
  pass: PassConfig;
  runId: string;
  result: TurnResult;
  /** The resolved (per-pass-overridden) role. */
  role: RoleConfig;
  /** The exact runtime instance that ran the turn — required to resume it. */
  runtime: Runtime;
  /** The pass hooks (the conformance gate is preserved) for the reformat turn. */
  hooks: TurnHooks;
  workdir: string;
  context: ContextBundle;
  /** The pass's own L2 writer — `verdict.recorded` lands in this run record. */
  events: EventWriter;
  clock: () => Date;
}

export type VerdictRecordOutcome =
  | { ok: true; extraUsage?: TurnUsage }
  | { ok: false; errorCode: string; error: Error };

export interface PassRunRecord {
  pass: PassConfig;
  runId: string;
  result: TurnResult;
}

export interface PipelineRunResult {
  /** Executed passes in completion-stage order. When a stage ends with any
   *  non-completed pass, later stages do not run (bounded, never silent —
   *  the ticket state machine owns remediation, §7). */
  passes: PassRunRecord[];
  aborted: boolean;
}

export async function executePipeline(
  options: ExecutePipelineOptions,
): Promise<PipelineRunResult> {
  const clock = options.clock ?? ((): Date => new Date());
  const stages = parallelStages(selectPasses(options.pipeline, options.selection));

  const records: PassRunRecord[] = [];
  for (const stage of stages) {
    if (options.signal?.aborted) return { passes: records, aborted: true };
    const stageController = new AbortController();
    const unlink = forwardAbort(options.signal, stageController);
    const stageOptions = { ...options, signal: stageController.signal };
    const results = await Promise.all(
      stage.map(async (pass) => {
        const result = await runPass(pass, stageOptions, clock);
        if (result.result.status !== "completed" && !stageController.signal.aborted) {
          stageController.abort(`parallel stage stopped by ${pass.id}=${result.result.status}`);
        }
        return result;
      }),
    ).finally(unlink);
    records.push(...results);
    for (const record of results) await options.afterPass?.(record);
    if (results.some((r) => r.result.status !== "completed")) {
      return { passes: records, aborted: true };
    }
  }
  return { passes: records, aborted: false };
}

const HEARTBEAT_INTERVAL_MS = 30_000;
/** Default per-pass wall-clock cap when pipelines.yaml sets none — matches
 *  the dispatcher's hung-turn default. */
const DEFAULT_PASS_WALL_CLOCK_MINUTES = 60;
export const ERROR_WALL_CLOCK_EXCEEDED = "error_wall_clock_exceeded";

// Long enough for adapters to terminate their owned process/session tree and
// return the last provider checkpoint; still bounded so a broken adapter
// cannot hold finalization indefinitely.
const DEFAULT_CANCELLATION_GRACE_MS = 2_000;

interface AbortDescriptor {
  status: "cancelled" | "timed_out";
  errorCode: string;
  reason: string;
}

interface TurnOutcome {
  result?: TurnResult;
  error?: unknown;
}

async function runOwnedTurn(options: {
  runtime: Runtime;
  request: Parameters<Runtime["runTurn"]>[0];
  hooks: TurnHooks;
  signal: AbortSignal;
  role: RoleConfig;
  passId: string;
  graceMs: number;
  latestProgress: () => TurnProgress | undefined;
}): Promise<TurnResult> {
  if (options.signal.aborted) {
    return stoppedResult(abortDescriptor(options.signal.reason), options.role, options.passId, options.latestProgress());
  }

  const outcome: Promise<TurnOutcome> = Promise.resolve()
    .then(() => options.runtime.runTurn(options.request, options.hooks))
    .then(
      (result): TurnOutcome => ({ result }),
      (error: unknown): TurnOutcome => ({ error }),
    );
  const aborted = abortPromise(options.signal);
  const first = await Promise.race([outcome, aborted]);
  if ("result" in first && first.result !== undefined) return first.result;
  if ("error" in first) {
    return failedResult(first.error, options.role, options.passId, options.latestProgress());
  }

  const descriptor = abortDescriptor(options.signal.reason);
  const settledDuringGrace = await Promise.race([
    outcome.then((value) => ({ value })),
    delay(options.graceMs).then(() => ({ value: undefined })),
  ]);
  void outcome.then(() => {});
  return stoppedResult(
    descriptor,
    options.role,
    options.passId,
    options.latestProgress(),
    settledDuringGrace.value?.result,
  );
}

async function runPass(
  pass: PassConfig,
  options: ExecutePipelineOptions,
  clock: () => Date,
): Promise<PassRunRecord> {
  const base = options.roles[pass.role];
  if (base === undefined) {
    throw new Error(
      `executePipeline: pass "${pass.id}" needs role "${pass.role}" but the roles map ` +
        `defines: ${Object.keys(options.roles).join(", ")}`,
    );
  }
  // Copy, never mutate; `runtime` is deliberately not overridable (§2 rule 3).
  const role: RoleConfig = {
    ...base,
    ...(pass.model !== undefined ? { model: pass.model } : {}),
    ...(pass.effort !== undefined ? { effort: pass.effort } : {}),
  };

  const { root, app, ticket, traceId } = options.runlog;
  const runId = mintRunId(clock(), options.pipeline.name, pass.id);
  const brief = options.briefFor(pass);
  // template "" = brief-only task. Only a synthesized pipeline can carry it
  // (runRole's plain turn) — the loader rejects empty templates in config.
  const template =
    pass.template === "" ? undefined : await readFile(join(options.promptsDir, pass.template), "utf8");
  const task = template === undefined ? brief : `${brief}\n\n---\n\n${template}`;

  // Replay seed (learning design §9.4): captured while the episode runs,
  // never reconstructed from logs afterward. Absent for non-git workdirs.
  const gitHead = gitHeadOf(options.workdir);
  await startRun(
    root,
    {
      runId,
      traceId,
      app,
      ...(ticket !== undefined ? { ticket } : {}),
      pipeline: options.pipeline.name,
      pass: pass.id,
      role: role.name,
      model: role.model,
      ...(gitHead !== undefined ? { gitHead } : {}),
    },
    clock(),
  );
  await writeBrief(root, app, runId, brief);

  const events = createEventWriter(
    root,
    {
      runId,
      trace_id: traceId,
      span_id: pass.id,
      app,
      ...(ticket !== undefined ? { ticket } : {}),
      pipeline: options.pipeline.name,
      pass: pass.id,
      role: role.name,
      model: role.model,
    },
    clock,
  );
  await events.append({ type: "run.started" });
  await events.append({ type: "pass.started" });

  const sessionLog = createSessionLogSink(root, app, runId);
  // The harness fires TurnEvents synchronously via onEvent; L2 appends are
  // async. We buffer the tool/subagent events during the turn and flush them
  // to L2 in order afterward (§9: fan-out trees reconstruct without opening
  // transcripts). session.log still receives every event live.
  const bridged: TurnEvent[] = [];
  let latestProgress: TurnProgress | undefined;
  let checkpointWrites = Promise.resolve();
  const passHooks: TurnHooks = {
    gate: options.gateForRole?.(role) ?? options.hooks.gate,
    onEvent: (e) => {
      sessionLog(e);
      if (e.type === "tool_use" || e.type === "subagent") bridged.push(e);
      options.hooks.onEvent?.(e);
    },
    onProgress: (progress) => {
      latestProgress = mergeProgress(latestProgress, progress);
      if (latestProgress.usage !== undefined) {
        const usage = toEnvelopeUsage(latestProgress.usage, latestProgress.usage.quality ?? "partial");
        checkpointWrites = checkpointWrites.then(() =>
          updateEnvelope(root, app, runId, {
            usage,
            lastSeenAt: progress.at ?? clock().toISOString(),
          }).then(() => undefined),
        );
      }
      options.hooks.onProgress?.(progress);
    },
  };

  // Fresh session per pass: req.session is never set.
  const runtime = options.runtimeFor(role);
  const verdictSchema = options.verdictSchemaFor?.(pass);

  // Heartbeat: stamp the envelope while the provider turn runs so a live
  // pass is distinguishable from a hung one (Stage 3 — the episode stalled
  // five hours with no way to tell). Failures are swallowed: a heartbeat
  // must never kill the turn it observes.
  const heartbeat = setInterval(() => {
    checkpointWrites = checkpointWrites.then(() =>
      updateEnvelope(root, app, runId, { lastSeenAt: clock().toISOString() })
        .then(() => undefined)
        .catch(() => undefined),
    );
  }, HEARTBEAT_INTERVAL_MS);
  heartbeat.unref?.();

  // Wall-clock watchdog now aborts the owned provider session instead of
  // abandoning it. The adapter receives the same signal and has a bounded
  // grace period to return partial usage before finalization.
  const capMs = (pass.wallClockMinutes ?? DEFAULT_PASS_WALL_CLOCK_MINUTES) * 60_000;
  const passController = new AbortController();
  const unlinkParent = forwardAbort(options.signal, passController);
  const timeout = setTimeout(() => {
    passController.abort({
      status: "timed_out",
      errorCode: ERROR_WALL_CLOCK_EXCEEDED,
      reason: `pass "${pass.id}" exceeded its ${Math.round(capMs / 60_000)}-minute wall-clock cap`,
    } satisfies AbortDescriptor);
  }, capMs);
  timeout.unref?.();
  let result: TurnResult;
  try {
    result = await runOwnedTurn({
      runtime,
      request: {
        role,
        workdir: options.workdir,
        task,
        context: options.context,
        signal: passController.signal,
        ...(verdictSchema !== undefined ? { verdictSchema } : {}),
        ...(pass.maxTurns !== undefined ? { maxTurns: pass.maxTurns } : {}),
        ...(options.networkAccess === true ? { networkAccess: true } : {}),
      },
      hooks: passHooks,
      signal: passController.signal,
      role,
      passId: pass.id,
      graceMs: options.cancellationGraceMs ?? DEFAULT_CANCELLATION_GRACE_MS,
      latestProgress: () => latestProgress,
    });
  } finally {
    clearTimeout(timeout);
    unlinkParent();
    clearInterval(heartbeat);
  }

  await checkpointWrites;

  await writeOutput(root, app, runId, result.summary);
  const toolCounts = await flushBridgedEvents(bridged, events, pass.id);
  await updateEnvelope(root, app, runId, {
    usage: toEnvelopeUsage(result.usage),
    previews: { task, output: result.summary },
    ...(Object.keys(toolCounts).length > 0 ? { tool_counts: toolCounts } : {}),
  });

  for (const escalation of result.escalations) {
    await events.append({
      type: "escalation.raised",
      severity: "warn",
      detail: { tool: escalation.action.tool, reason: escalation.reason },
    });
  }

  // Verdict recording runs before finalize so an unparseable verdict finalizes
  // the pass as an infra failure, not a completed pass (§6, §13 row 11).
  let settledUsage = result.usage;
  let verdictOutcome: VerdictRecordOutcome = { ok: true };
  if (options.recordVerdict !== undefined && result.status === "completed") {
    verdictOutcome = await options.recordVerdict({
      pass,
      runId,
      result,
      role,
      runtime,
      hooks: passHooks,
      workdir: options.workdir,
      context: options.context,
      events,
      clock,
    });
    // A verdict reformat retry is an extra runTurn; fold its spend into the
    // pass usage so analyze/status don't undercount it (the retry cost was
    // previously discarded).
    if (verdictOutcome.ok && verdictOutcome.extraUsage !== undefined) {
      settledUsage = sumTurnUsage(result.usage, verdictOutcome.extraUsage);
      await updateEnvelope(root, app, runId, {
        usage: toEnvelopeUsage(settledUsage),
      });
    }
  }

  const status = verdictOutcome.ok ? envelopeStatus(result) : "failed";
  if (status === "failed") {
    // Infra failure — machine code, distinct population from merit (§9). The
    // adapter's own code (budget overrun, watchdog) beats the generic one:
    // budget exhaustion must read as budget exhaustion.
    await events.append({
      type: "pass.failed",
      severity: "error",
      errorCode: verdictOutcome.ok
        ? result.errorCode ?? "error_turn_failed"
        : verdictOutcome.errorCode,
    });
  } else if (status === "cancelled" || status === "timed_out") {
    await events.append({
      type: status === "cancelled" ? "pass.cancelled" : "pass.timed_out",
      severity: "warn",
      errorCode: result.errorCode ?? (status === "cancelled" ? "error_cancelled" : ERROR_WALL_CLOCK_EXCEEDED),
      detail: { reason: result.summary },
    });
  } else {
    await events.append({
      type: "pass.completed",
      ...(result.status === "blocked_on_gate" ? { detail: { outcome: "blocked_on_gate" } } : {}),
    });
  }
  await events.append({ type: "run.completed" });
  await finalizeRun(
    root,
    app,
    runId,
    {
      status,
      verdictSummary: result.summary,
      ...(verdictOutcome.ok
        ? result.status !== "completed" && result.errorCode !== undefined
          ? { errorCode: result.errorCode }
          : {}
        : { errorCode: verdictOutcome.errorCode }),
      ...(status === "cancelled" || status === "timed_out" ? { reason: result.summary } : {}),
    },
    clock(),
  );

  // Settle the pass's measured spend into the org ledger exactly once, after
  // the run record is durable and regardless of terminal status — a blocked or
  // failed pass consumed budget too (Defect B). Idempotency is keyed on
  // (app, runId). The settled status matches the envelope's: a verdict-infra
  // failure is `failed` in both records, never completed-in-one-store.
  if (options.telemetry !== undefined) {
    const settled = await recordTurnOnce(
      options.telemetry.orgDir,
      toRecord(
        role,
        { ...result, status: verdictOutcome.ok ? result.status : "failed", usage: settledUsage },
        clock(),
        {
          app,
          ...(options.telemetry.trigger !== undefined ? { trigger: options.telemetry.trigger } : {}),
          runId,
          traceId,
          pipeline: options.pipeline.name,
          pass: pass.id,
          // A watchdog-abandoned turn's spend is unknown, not zero.
          ...(result.usage.quality === "unavailable" ? { unmeasured: true } : {}),
          ...(options.telemetry.experimentRef !== undefined
            ? { experimentRef: options.telemetry.experimentRef }
            : {}),
          ...(options.telemetry.candidateRef !== undefined
            ? { candidateRef: options.telemetry.candidateRef }
            : {}),
        },
      ),
    );
    if (!settled) {
      // Something else already settled this (app, runId) — normally impossible
      // (reconcile refuses in-flight envelopes). Loud, never silent: the
      // dropped row means the ledger may carry a stale status for this pass.
      await events.append({
        type: "telemetry.settle_skipped",
        severity: "warn",
        detail: { runId, reason: "a ledger row with this app+runId already exists" },
      });
    }
  }

  // The record is durable; NOW surface the loud typed failure to the caller.
  if (!verdictOutcome.ok) throw verdictOutcome.error;

  return { pass, runId, result };
}

/** Drain the buffered tool/subagent TurnEvents into L2 (§9): `tool.called`
 *  with name/duration/success/args-hash (+ optional category tag) and a tally
 *  of tool counts for the envelope; `subagent.started`/`.completed` nested
 *  under the pass span. Structured fields are used when the adapter set them;
 *  otherwise phase is inferred from the detail text and a span id synthesized,
 *  so today's detail-only adapters still produce a fan-out tree. */
async function flushBridgedEvents(
  bridged: readonly TurnEvent[],
  events: EventWriter,
  passSpanId: string,
): Promise<Record<string, number>> {
  const toolCounts: Record<string, number> = {};
  let subCounter = 0;
  let lastSubSpan: string | undefined;

  for (const e of bridged) {
    if (e.type === "tool_use") {
      const tool = e.name ?? toolNameFromDetail(e.detail);
      toolCounts[tool] = (toolCounts[tool] ?? 0) + 1;
      await events.toolCalled({
        tool,
        durationMs: e.durationMs ?? 0,
        success: e.success ?? true,
        ...(e.args !== undefined ? { args: e.args } : {}),
        ...(e.category !== undefined ? { category: e.category } : {}),
        // A subagent-issued tool call nests under its subagent span.
        ...(e.spanId !== undefined ? { spanId: e.spanId, parentSpanId: passSpanId } : {}),
      });
    } else {
      const phase: "started" | "completed" =
        e.phase ?? (/\b(complete|completed|finish|finished|end|ended|done)\b/i.test(e.detail) ? "completed" : "started");
      let spanId: string;
      if (e.spanId !== undefined) {
        spanId = e.spanId;
        if (phase === "started") lastSubSpan = spanId;
      } else if (phase === "completed" && lastSubSpan !== undefined) {
        spanId = lastSubSpan;
      } else {
        spanId = `${passSpanId}/sub-${(subCounter += 1)}`;
        lastSubSpan = spanId;
      }
      await events.append({
        type: phase === "completed" ? "subagent.completed" : "subagent.started",
        spanId,
        parentSpanId: passSpanId,
        ...(e.name !== undefined ? { detail: { subagent: e.name } } : {}),
      });
    }
  }
  return toolCounts;
}

/** Best-effort tool name when the adapter only gave us a detail string. */
function toolNameFromDetail(detail: string): string {
  const token = detail.trim().split(/[\s:(]/, 1)[0];
  return token !== undefined && token.length > 0 ? token : "unknown";
}

function envelopeStatus(result: TurnResult): Exclude<EnvelopeStatus, "running"> {
  if (result.status === "completed") return "completed";
  if (result.status === "blocked_on_gate") return "blocked";
  if (result.status === "cancelled") return "cancelled";
  if (result.status === "timed_out") return "timed_out";
  return "failed";
}

/** Sum two turn usages (base + a verdict reformat retry). Optional split
 *  fields are added only when either side reports them; `costEstimated` is
 *  sticky (an estimate anywhere makes the total an estimate). */
function sumTurnUsage(base: TurnUsage, extra: TurnUsage): TurnUsage {
  const sum: TurnUsage = {
    tokensIn: base.tokensIn + extra.tokensIn,
    tokensOut: base.tokensOut + extra.tokensOut,
    costUsd: base.costUsd + extra.costUsd,
    subagentTurns: base.subagentTurns + extra.subagentTurns,
    wallClockMs: base.wallClockMs + extra.wallClockMs,
    quality: leastCompleteUsageQuality(base.quality, extra.quality),
  };
  if (base.tokensInUncached !== undefined || extra.tokensInUncached !== undefined) {
    sum.tokensInUncached = (base.tokensInUncached ?? 0) + (extra.tokensInUncached ?? 0);
  }
  if (base.cacheCreationTokens !== undefined || extra.cacheCreationTokens !== undefined) {
    sum.cacheCreationTokens = (base.cacheCreationTokens ?? 0) + (extra.cacheCreationTokens ?? 0);
  }
  if (base.cacheReadTokens !== undefined || extra.cacheReadTokens !== undefined) {
    sum.cacheReadTokens = (base.cacheReadTokens ?? 0) + (extra.cacheReadTokens ?? 0);
  }
  if (base.costEstimated || extra.costEstimated) sum.costEstimated = true;
  return sum;
}

function leastCompleteUsageQuality(
  left: TurnUsage["quality"],
  right: TurnUsage["quality"],
): NonNullable<TurnUsage["quality"]> {
  const rank = { complete: 0, estimated: 1, partial: 2, unavailable: 3 } as const;
  const a = left ?? "complete";
  const b = right ?? "complete";
  return rank[a] >= rank[b] ? a : b;
}

function toEnvelopeUsage(usage: TurnUsage, quality?: TurnUsage["quality"]): EnvelopeUsage {
  const envelope: EnvelopeUsage = {
    tokens_in: usage.tokensIn,
    tokens_out: usage.tokensOut,
    cost_usd: usage.costUsd,
    subagent_turns: usage.subagentTurns,
  };
  if (usage.costEstimated) envelope.cost_estimated = true;
  if (usage.cacheReadTokens !== undefined) envelope.cache_read_tokens = usage.cacheReadTokens;
  if (usage.cacheCreationTokens !== undefined) envelope.cache_write_tokens = usage.cacheCreationTokens;
  envelope.quality = quality ?? usage.quality ?? (usage.costEstimated ? "estimated" : "complete");
  return envelope;
}

function forwardAbort(parent: AbortSignal | undefined, child: AbortController): () => void {
  if (parent === undefined) return () => {};
  const abort = (): void => {
    if (!child.signal.aborted) child.abort(parent.reason);
  };
  if (parent.aborted) abort();
  else parent.addEventListener("abort", abort, { once: true });
  return () => parent.removeEventListener("abort", abort);
}

function abortPromise(signal: AbortSignal): Promise<TurnOutcome> {
  return new Promise((resolve) => {
    const done = (): void => resolve({});
    if (signal.aborted) done();
    else signal.addEventListener("abort", done, { once: true });
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function abortDescriptor(reason: unknown): AbortDescriptor {
  if (isAbortDescriptor(reason)) return reason;
  return {
    status: "cancelled",
    errorCode: "error_cancelled",
    reason: typeof reason === "string" && reason.length > 0 ? reason : "operator cancellation",
  };
}

function isAbortDescriptor(value: unknown): value is AbortDescriptor {
  if (value === null || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    (record["status"] === "cancelled" || record["status"] === "timed_out") &&
    typeof record["errorCode"] === "string" &&
    typeof record["reason"] === "string"
  );
}

function stoppedResult(
  descriptor: AbortDescriptor,
  role: RoleConfig,
  passId: string,
  progress: TurnProgress | undefined,
  settled?: TurnResult,
): TurnResult {
  const usage = settled?.usage ?? progress?.usage ?? unavailableUsage();
  return {
    status: descriptor.status,
    errorCode: descriptor.errorCode,
    summary: descriptor.reason,
    artifacts: settled?.artifacts ?? [],
    session: settled?.session ?? progress?.session ?? { runtime: role.runtime, id: `${descriptor.status}-${passId}` },
    usage: {
      ...usage,
      quality: usage.quality === "unavailable" ? "unavailable" : "partial",
    },
    escalations: settled?.escalations ?? [],
  };
}

function failedResult(
  error: unknown,
  role: RoleConfig,
  passId: string,
  progress: TurnProgress | undefined,
): TurnResult {
  const message = error instanceof Error ? error.message : String(error);
  const usage = progress?.usage ?? unavailableUsage();
  return {
    status: "failed",
    errorCode: "error_runtime_failed",
    summary: message,
    artifacts: [],
    session: progress?.session ?? { runtime: role.runtime, id: `failed-${passId}` },
    usage: {
      ...usage,
      quality: progress?.usage === undefined ? "unavailable" : "partial",
    },
    escalations: [],
  };
}

function unavailableUsage(): TurnUsage {
  return {
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
    subagentTurns: 0,
    wallClockMs: 0,
    quality: "unavailable",
  };
}

function mergeProgress(previous: TurnProgress | undefined, next: TurnProgress): TurnProgress {
  return {
    ...(previous ?? {}),
    ...next,
    ...(next.usage !== undefined ? { usage: next.usage } : {}),
    ...(next.session !== undefined ? { session: next.session } : {}),
  };
}
