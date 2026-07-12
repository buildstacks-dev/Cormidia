// Manual role turn as a synthesized one-pass pipeline (build plan M2.9;
// docs/loop.md §2, §3; architecture.md §2 — the dispatcher spawns exactly
// this signature, so the contract is fixed here once).
//
// `dryRun` assembles and returns the brief without constructing any
// Runtime — the token-free path. A live run goes through the M2.8 executor
// so even a manual turn leaves its full §9 run record and passes the
// critical-ops gate (defaultGate unless the caller supplies hooks).
//
// `app`/`turnId` are accepted and passed through now. The org layer may pass
// a fully assembled ContextBundle; this loop-layer function never imports
// the org assembler directly, preserving src/org -> src/loop -> src/runtime.

import { basename, dirname } from "node:path";
import { defaultGate } from "../runtime/gate.js";
import { mintRunId } from "../runtime/runlog/paths.js";
import type { ContextBundle, RoleConfig, Runtime, TurnHooks } from "../runtime/types.js";
import type { TriggerKind } from "../runtime/telemetry.js";
import { assembleBrief } from "./brief.js";
import { executePipeline, type PassRunRecord } from "./pipeline.js";
import type { PipelineConfig } from "./pipelines.js";

const DEFAULT_BRIEF_BUDGET_TOKENS = 12_000;

export interface RunRoleRequest {
  role: RoleConfig;
  /** Target app slug — passed through to the run record when executing. */
  app?: string;
  /** Trace id for the run record; synthesized from the clock when absent. */
  turnId?: string;
  /** Optional pass template file appended to the brief (§2). */
  templatePath?: string;
  dryRun: boolean;
  workdir?: string;
  /** Org runtime home for run records — required for live runs only. */
  runlogRoot?: string;
  runtimeFor?: (role: RoleConfig) => Runtime;
  /** Defaults to the critical-ops defaultGate — manual turns are gated too. */
  hooks?: TurnHooks;
  /** Optional full context assembled by src/org callers. */
  context?: ContextBundle;
  briefBudgetTokens?: number;
  clock?: () => Date;
  /** Per-pass ledger settlement target — see ExecutePipelineOptions.telemetry. */
  telemetry?: { orgDir: string; trigger?: TriggerKind };
  /** Cooperative cancellation from the owning process/dispatcher. */
  signal?: AbortSignal;
}

export interface RunRoleResult {
  brief: string;
  executed: boolean;
  record?: PassRunRecord;
}

export async function runRole(request: RunRoleRequest): Promise<RunRoleResult> {
  const clock = request.clock ?? ((): Date => new Date());
  const context = request.context ?? { taste: [], memoryExcerpts: [] };
  const brief = assembleBrief(
    {
      ticket: {
        title: `Manual role turn: ${request.role.name}`,
        body: [
          `Goal: run one ${request.role.name} turn, invoked directly by the human operator`,
          `(operon run-role). There is no ticket behind this turn.`,
          `App: ${request.app ?? "(none — org-level turn)"}`,
          "",
          request.context === undefined
            ? "Runtime context: no app context supplied; this brief carries the invocation only."
            : `Runtime context: ${countLabel(context.taste.length, "taste layer")} and ` +
              `${countLabel(context.memoryExcerpts.length, "memory excerpt")} supplied through the adapter context channel.`,
        ].join("\n"),
      },
      ...(request.workdir !== undefined ? { repo: `Working directory: ${request.workdir}` } : {}),
    },
    { budgetTokens: request.briefBudgetTokens ?? DEFAULT_BRIEF_BUDGET_TOKENS },
  );

  if (request.dryRun) {
    return { brief, executed: false };
  }

  if (request.runtimeFor === undefined || request.runlogRoot === undefined) {
    throw new Error("runRole: a live run needs runtimeFor and runlogRoot (dryRun omits both)");
  }

  // One synthesized pass. template "" is the executor's brief-only marker —
  // only synthesizable here; the loader rejects empty templates in config.
  const pipeline: PipelineConfig = {
    name: "run-role",
    mechanical: false,
    passes: [
      {
        id: request.role.name,
        role: request.role.name,
        template: request.templatePath !== undefined ? basename(request.templatePath) : "",
      },
    ],
  };

  const result = await executePipeline({
    pipeline,
    selection: { tier: "standard" },
    roles: { [request.role.name]: request.role },
    runtimeFor: request.runtimeFor,
    briefFor: () => brief,
    promptsDir: request.templatePath !== undefined ? dirname(request.templatePath) : ".",
    context,
    workdir: request.workdir ?? process.cwd(),
    hooks: request.hooks ?? { gate: defaultGate },
    runlog: {
      root: request.runlogRoot,
      app: request.app ?? "adhoc",
      traceId: request.turnId ?? mintRunId(clock(), "manual", request.role.name),
    },
    clock,
    ...(request.telemetry !== undefined ? { telemetry: request.telemetry } : {}),
    ...(request.signal !== undefined ? { signal: request.signal } : {}),
  });

  const record = result.passes[0];
  return { brief, executed: true, ...(record !== undefined ? { record } : {}) };
}

function countLabel(count: number, label: string): string {
  return `${count} ${label}${count === 1 ? "" : "s"}`;
}
