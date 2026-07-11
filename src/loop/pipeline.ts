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
  telemetry?: { orgDir: string; trigger?: TriggerKind };
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
    const results = await Promise.all(stage.map((pass) => runPass(pass, options, clock)));
    records.push(...results);
    for (const record of results) await options.afterPass?.(record);
    if (results.some((r) => r.result.status !== "completed")) {
      return { passes: records, aborted: true };
    }
  }
  return { passes: records, aborted: false };
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
  const passHooks: TurnHooks = {
    gate: options.gateForRole?.(role) ?? options.hooks.gate,
    onEvent: (e) => {
      sessionLog(e);
      if (e.type === "tool_use" || e.type === "subagent") bridged.push(e);
      options.hooks.onEvent?.(e);
    },
  };

  // Fresh session per pass: req.session is never set.
  const runtime = options.runtimeFor(role);
  const verdictSchema = options.verdictSchemaFor?.(pass);
  const result = await runtime.runTurn(
    {
      role,
      workdir: options.workdir,
      task,
      context: options.context,
      ...(verdictSchema !== undefined ? { verdictSchema } : {}),
      ...(pass.maxTurns !== undefined ? { maxTurns: pass.maxTurns } : {}),
      ...(options.networkAccess === true ? { networkAccess: true } : {}),
    },
    passHooks,
  );

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
    // Infra failure — machine code, distinct population from merit (§9).
    await events.append({
      type: "pass.failed",
      severity: "error",
      errorCode: verdictOutcome.ok ? "error_turn_failed" : verdictOutcome.errorCode,
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
      ...(verdictOutcome.ok ? {} : { errorCode: verdictOutcome.errorCode }),
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

function toEnvelopeUsage(usage: TurnUsage): EnvelopeUsage {
  const envelope: EnvelopeUsage = {
    tokens_in: usage.tokensIn,
    tokens_out: usage.tokensOut,
    cost_usd: usage.costUsd,
    subagent_turns: usage.subagentTurns,
  };
  if (usage.costEstimated) envelope.cost_estimated = true;
  if (usage.cacheReadTokens !== undefined) envelope.cache_read_tokens = usage.cacheReadTokens;
  if (usage.cacheCreationTokens !== undefined) envelope.cache_write_tokens = usage.cacheCreationTokens;
  return envelope;
}
