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
  TurnHooks,
  TurnResult,
  TurnUsage,
} from "../runtime/types.js";
import {
  finalizeRun,
  startRun,
  updateEnvelope,
  type EnvelopeStatus,
  type EnvelopeUsage,
} from "../runtime/runlog/envelope.js";
import { createEventWriter } from "../runtime/runlog/events.js";
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
  runlog: RunlogTarget;
  /** Injected clock (FakeClock-compatible); defaults to the wall clock. */
  clock?: () => Date;
  /** Optional native structured-output schema per pass. */
  verdictSchemaFor?: (pass: PassConfig) => Record<string, unknown> | undefined;
  /** Runs after a pass completes and before the next sequential stage starts. */
  afterPass?: (record: PassRunRecord) => void | Promise<void>;
}

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
  const passHooks: TurnHooks = {
    gate: options.hooks.gate, // unchanged — the conformance contract
    onEvent: (e) => {
      sessionLog(e);
      options.hooks.onEvent?.(e);
    },
  };

  // Fresh session per pass: req.session is never set.
  const verdictSchema = options.verdictSchemaFor?.(pass);
  const result = await options.runtimeFor(role).runTurn(
    {
      role,
      workdir: options.workdir,
      task,
      context: options.context,
      ...(verdictSchema !== undefined ? { verdictSchema } : {}),
      ...(pass.maxTurns !== undefined ? { maxTurns: pass.maxTurns } : {}),
    },
    passHooks,
  );

  await writeOutput(root, app, runId, result.summary);
  await updateEnvelope(root, app, runId, {
    usage: toEnvelopeUsage(result.usage),
    previews: { task, output: result.summary },
  });

  for (const escalation of result.escalations) {
    await events.append({
      type: "escalation.raised",
      severity: "warn",
      detail: { tool: escalation.action.tool, reason: escalation.reason },
    });
  }

  const status = envelopeStatus(result);
  if (status === "failed") {
    // Infra failure — machine code, distinct population from merit (§9).
    await events.append({ type: "pass.failed", severity: "error", errorCode: "error_turn_failed" });
  } else {
    await events.append({
      type: "pass.completed",
      ...(result.status === "blocked_on_gate" ? { detail: { outcome: "blocked_on_gate" } } : {}),
    });
  }
  await events.append({ type: "run.completed" });
  await finalizeRun(root, app, runId, { status, verdictSummary: result.summary }, clock());

  return { pass, runId, result };
}

function envelopeStatus(result: TurnResult): Exclude<EnvelopeStatus, "running"> {
  if (result.status === "completed") return "completed";
  if (result.status === "blocked_on_gate") return "blocked";
  return "failed";
}

function toEnvelopeUsage(usage: TurnUsage): EnvelopeUsage {
  return {
    tokens_in: usage.tokensIn,
    tokens_out: usage.tokensOut,
    cost_usd: usage.costUsd,
    subagent_turns: usage.subagentTurns,
  };
}
