// Human dashboard over L1 envelopes + L2 events only (docs/loop/design.md §9).

import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { readEvents } from "./events.js";
import { classifyEnvelopeUsage } from "./envelope.js";
import { truncatePreview } from "./redact.js";
import { formatDurableVerdictDigest, summarizeDurableVerdict, type DurableVerdictDigest } from "../../loop/verdicts.js";
import type { PlanningRouteEvidence, RunEnvelope, SessionEvidence, TracePlanEvidence } from "./envelope.js";
import type { Artifact, AuthorityEvidence, Effort, RuntimeKind, UsageQuality } from "../types.js";

export interface StatusRow {
  runId: string;
  app: string;
  /** Correlation ids the telemetry view groups on (envelope ticket/trace_id). */
  ticket?: string;
  traceId: string;
  parentTaskId?: string;
  pipeline: string;
  pass: string;
  role: string;
  runtime?: RuntimeKind;
  model?: string;
  effort?: Effort;
  workdir?: string;
  gitHead?: string;
  gitBranch?: string;
  status: string;
  durationMs: number;
  tokensIn: number;
  tokensOut: number;
  /** Cache-priced input tokens, when the adapter reported them (§9). */
  cacheReadTokens?: number;
  costUsd: number;
  /** cost_usd is a local estimate (e.g. codex), not a provider-reported charge. */
  costEstimated: boolean;
  usageQuality: UsageQuality;
  escalations: number;
  toolCalls: number;
  startedAt: string;
  /** Heartbeat stamp (Stage 3) — present while (and after) the executor's
   *  30s heartbeat ran, so a reader can tell live from stalled. */
  lastSeenAt?: string;
  /** Redacted at write time; structured JSON is complete, prose is bounded. */
  verdictSummary?: string;
  /** ENH-010: the same verdict projected for a human. Present only when
   *  `verdictSummary` is a structured verdict; the raw record stays
   *  authoritative. A durable "approve, no findings" is only auditable if the
   *  rationale and evidence reach the operator's default surface. */
  verdictDigest?: DurableVerdictDigest;
  previews?: Record<string, string>;
  terminalReason?: string;
  session?: SessionEvidence;
  artifacts?: Artifact[];
  gateResults?: RunEnvelope["gate_results"];
  refs: RunEnvelope["refs"];
  tracePlan?: TracePlanEvidence;
  planningRoute?: PlanningRouteEvidence;
  authority?: AuthorityEvidence;
}

export async function readStatusRows(
  root: string,
  options: { app?: string; limit?: number } = {},
): Promise<StatusRow[]> {
  const runsRoot = join(root, "runs");
  if (!existsSync(runsRoot)) return [];
  const apps = options.app !== undefined ? [options.app] : await childDirs(runsRoot);
  const rows: StatusRow[] = [];

  for (const app of apps) {
    const appDir = join(runsRoot, app);
    if (!existsSync(appDir)) continue;
    for (const runId of await childDirs(appDir)) {
      let envelope: RunEnvelope;
      try {
        envelope = await readEnvelopeFile(join(appDir, runId, "envelope.json"));
      } catch (error) {
        // Distinguish "no envelope yet" (a turn still in flight — skip
        // quietly) from a torn/invalid envelope (a crashed turn — exactly the
        // run the operator most needs to see). Surface the corruption as a
        // visible row instead of silently dropping the run from the dashboard.
        if (isNotFound(error)) continue;
        rows.push(unreadableRow(runId, app));
        continue;
      }
      const events = await readEvents(root, app, runId).catch(() => []);
      rows.push({
        runId,
        app,
        ...(envelope.ticket !== undefined ? { ticket: envelope.ticket } : {}),
        traceId: envelope.trace_id,
        ...(envelope.parent_task_id !== undefined ? { parentTaskId: envelope.parent_task_id } : {}),
        pipeline: envelope.pipeline,
        pass: envelope.pass,
        role: envelope.role,
        ...(envelope.runtime !== undefined ? { runtime: envelope.runtime } : {}),
        ...(envelope.model !== undefined ? { model: envelope.model } : {}),
        ...(envelope.effort !== undefined ? { effort: envelope.effort } : {}),
        ...(envelope.workdir !== undefined ? { workdir: envelope.workdir } : {}),
        ...(envelope.git_head !== undefined ? { gitHead: envelope.git_head } : {}),
        ...(envelope.git_branch !== undefined ? { gitBranch: envelope.git_branch } : {}),
        status: statusLabel(envelope),
        durationMs: envelope.wall_clock_ms ?? 0,
        tokensIn: envelope.usage?.tokens_in ?? 0,
        tokensOut: envelope.usage?.tokens_out ?? 0,
        ...(envelope.usage?.cache_read_tokens !== undefined
          ? { cacheReadTokens: envelope.usage.cache_read_tokens }
          : {}),
        costUsd: envelope.usage?.cost_usd ?? 0,
        costEstimated: envelope.usage?.cost_estimated === true,
        usageQuality: usageQuality(envelope),
        escalations: events.filter((event) => event.event === "escalation.raised").length,
        toolCalls: Object.values(envelope.tool_counts ?? {}).reduce((sum, count) => sum + count, 0),
        startedAt: envelope.started_at,
        ...(envelope.last_seen_at !== undefined ? { lastSeenAt: envelope.last_seen_at } : {}),
        ...(envelope.verdict_summary !== undefined ? { verdictSummary: envelope.verdict_summary } : {}),
        ...verdictDigestFor(envelope.verdict_summary),
        ...(envelope.previews !== undefined ? { previews: envelope.previews } : {}),
        ...(envelope.terminal_reason !== undefined ? { terminalReason: envelope.terminal_reason } : {}),
        ...(envelope.session !== undefined ? { session: envelope.session } : {}),
        ...(envelope.artifacts !== undefined ? { artifacts: envelope.artifacts } : {}),
        ...(envelope.gate_results !== undefined ? { gateResults: envelope.gate_results } : {}),
        refs: envelope.refs,
        ...(envelope.trace_plan !== undefined ? { tracePlan: envelope.trace_plan } : {}),
        ...(envelope.planning_route !== undefined ? { planningRoute: envelope.planning_route } : {}),
        ...(envelope.authority !== undefined ? { authority: envelope.authority } : {}),
      });
    }
  }

  rows.sort((a, b) => b.startedAt.localeCompare(a.startedAt) || b.runId.localeCompare(a.runId));
  return options.limit === undefined ? rows : rows.slice(0, options.limit);
}

/** Envelope-only view: the ledger is not in scope here, so settlement cannot be
 *  consulted. classifyEnvelopeUsage owns the derivation (#88). */
function usageQuality(envelope: RunEnvelope): UsageQuality {
  return classifyEnvelopeUsage(envelope);
}

export function formatStatusRows(rows: readonly StatusRow[]): string {
  const header =
    "RUN ID                         APP        PIPE/PASS                 STATUS                 DUR     TOKENS               COST   ESC";
  const lines = rows.map((row) => {
    const pipePass = `${row.pipeline}/${row.pass}`;
    const tokens = `${row.tokensIn}/${row.tokensOut}`;
    return [
      row.runId.padEnd(30),
      row.app.padEnd(10),
      pipePass.padEnd(25),
      row.status.padEnd(22),
      formatDuration(row.durationMs).padStart(7),
      tokens.padStart(10),
      formatStatusCost(row).padStart(18),
      String(row.escalations).padStart(5),
    ].join(" ");
  });
  const attention = rows
    .filter((row) => terminalAttentionStatus(row.status))
    .map(
      (row) =>
        `  ${row.runId} ${row.pipeline}/${row.pass} ${row.status} — ` +
        truncatePreview(
          row.terminalReason ??
            (row.verdictDigest === undefined
              ? row.verdictSummary
              : formatDurableVerdictDigest(row.verdictDigest).replace(/\n/g, " · ")) ??
            "No terminal reason recorded",
          240,
        ),
    );
  // ENH-010: a judgment surfaces here whether or not it needs attention. An
  // approving reviewer verdict is the one an operator most needs to audit, and
  // it never appears above because an approved pass is not terminal.
  const verdicts = rows
    .filter((row) => row.verdictDigest !== undefined)
    .flatMap((row) => [
      `  ${row.runId} ${row.pipeline}/${row.pass} (${row.role}) — ${row.verdictDigest!.headline}`,
      ...formatDurableVerdictDigest(row.verdictDigest!)
        .split("\n")
        .slice(1)
        .map((line) => `    ${truncatePreview(line, 240)}`),
    ]);
  return [
    header,
    ...lines,
    ...(attention.length === 0 ? [] : ["", "TERMINAL ATTENTION", ...attention]),
    ...(verdicts.length === 0 ? [] : ["", "VERDICTS", ...verdicts]),
  ].join("\n");
}

function verdictDigestFor(verdictSummary: string | undefined): { verdictDigest?: DurableVerdictDigest } {
  if (verdictSummary === undefined) return {};
  const digest = summarizeDurableVerdict(verdictSummary);
  return digest === undefined ? {} : { verdictDigest: digest };
}

function terminalAttentionStatus(status: string): boolean {
  return status === "blocked" || status === "cancelled" || status === "timed_out" || status.startsWith("failed(");
}

function formatStatusCost(row: StatusRow): string {
  // A pass that invoked no provider costs an authoritative $0.00 — not an
  // unknown that an operator has to go chase (#88).
  if (row.usageQuality === "none") return "$0.00";
  if (row.usageQuality === "unavailable") return "unavailable";
  const amount = `${row.costEstimated || row.usageQuality === "estimated" ? "~" : ""}$${row.costUsd.toFixed(2)}`;
  return row.usageQuality === "partial" ? `${amount} partial` : amount;
}

function statusLabel(envelope: RunEnvelope): string {
  if (envelope.status === "failed") return `failed(${envelope.error_code ?? "error_unknown"})`;
  return envelope.status;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, "0")}s`;
}

async function childDirs(path: string): Promise<string[]> {
  return (await readdir(path, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

async function readEnvelopeFile(path: string): Promise<RunEnvelope> {
  return JSON.parse(await readFile(path, "utf8")) as RunEnvelope;
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "ENOENT";
}

/** A run whose envelope.json exists but cannot be parsed — shown, never
 *  dropped, so a corrupt/torn telemetry record stays visible to the operator. */
function unreadableRow(runId: string, app: string): StatusRow {
  return {
    runId,
    app,
    traceId: "?",
    pipeline: "?",
    pass: "?",
    role: "?",
    status: "corrupt(envelope)",
    durationMs: 0,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
    costEstimated: false,
    usageQuality: "unavailable",
    escalations: 0,
    toolCalls: 0,
    startedAt: "",
    refs: { events: "events.jsonl", brief: "brief.md", output: "output.md" },
  };
}
