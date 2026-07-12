// Historical telemetry view over runs/ (Stage 2 of
// docs/telemetry-review-and-proposed-fixes.md §5). Reads L1 envelopes + L2
// events only — never the org ledger — so it stays truthful even before the
// Stage 1 reconciliation completes, and never writes new telemetry.
//
// One report shape feeds three renderers (terminal, --json, --html). The
// HTML file must be fully self-contained (inline CSS, zero external
// requests) because operators open it from machines with no operon install;
// every interpolated string is HTML-escaped because envelope previews carry
// arbitrary model output.

import { existsSync } from "node:fs";
import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { formatDuration, readStatusRows, type StatusRow } from "../runtime/runlog/status.js";
import type { UsageQuality } from "../runtime/types.js";
import { listParentTasks, type ParentTaskRecord } from "../org/parent-task.js";
import { resolveOperonHomes } from "../org/home.js";
import { extractHomeFlags } from "./home-flags.js";

export async function cmdTelemetry(args: string[]): Promise<number> {
  const common = extractHomeFlags(args, "telemetry");
  const parsed = parseArgs(common.rest);
  const stateHome = common.stateHome ? resolve(common.stateHome) : (await resolveOperonHomes(common)).stateHome;

  const rows = await readStatusRows(stateHome, parsed.app !== undefined ? { app: parsed.app } : {});
  const parentTasks = await listParentTasks(stateHome);
  const report = buildReport(rows, parentTasks, parsed.app ?? null, parsed.date ?? null);

  if (parsed.html !== undefined) {
    const target = resolve(parsed.html);
    const evidenceDir = evidenceDirectoryName(target);
    const bundlePath = join(dirname(target), evidenceDir);
    await materializeEvidenceBundle(stateHome, bundlePath, report);
    await writeFile(target, renderHtml(report, evidenceDir), "utf8");
    console.log(`telemetry: wrote ${target} and ${bundlePath}`);
  }
  if (parsed.json) console.log(JSON.stringify(reportToJson(report), null, 2));
  else if (parsed.html === undefined) console.log(renderTerminal(report));
  return 0;
}

// ---------------------------------------------------------------------------
// argument parsing
// ---------------------------------------------------------------------------

interface ParsedTelemetryArgs {
  app?: string;
  date?: string;
  json: boolean;
  html?: string;
}

function parseArgs(args: string[]): ParsedTelemetryArgs {
  const out: ParsedTelemetryArgs = { json: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--app") out.app = needValue(args, ++i, "--app");
    else if (arg === "--date") out.date = parseDate(needValue(args, ++i, "--date"));
    else if (arg === "--json") out.json = true;
    else if (arg === "--html") out.html = needValue(args, ++i, "--html");
    else throw new Error(`telemetry: unknown argument "${arg}"`);
  }
  return out;
}

function parseDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("telemetry: --date must be YYYY-MM-DD");
  return value;
}

function needValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value || value.startsWith("--")) throw new Error(`telemetry: ${flag} requires a value`);
  return value;
}

// ---------------------------------------------------------------------------
// report model — the one shape all three renderers consume
// ---------------------------------------------------------------------------

interface PassView extends StatusRow {
  /** cache_read_tokens / tokens_in; null when either side is unavailable. */
  cacheHitRatio: number | null;
  running: boolean;
  /** Files actually copied beside an HTML report. */
  evidenceFiles?: string[];
}

interface TraceGroup {
  traceId: string;
  passes: PassView[];
  integrity: TraceIntegrity;
}

interface TraceIntegrity {
  requiredPasses: string[] | null;
  observedPasses: string[];
  missingPasses: string[];
  nonCompletedPasses: string[];
  skippedPasses: Array<{ pass: string; reason: string }>;
  complete: boolean | null;
}

interface TicketGroup {
  /** null = envelope had no ticket (manual run-role turns, company events). */
  ticket: string | null;
  traces: TraceGroup[];
}

interface TotalLine {
  key: string;
  costUsd: number;
  /** True when ANY contributing pass had an estimated cost — the sum is
   *  then itself only an estimate and is marked ~. */
  costEstimated: boolean;
  usageQuality: UsageQuality;
  incompletePasses: number;
  passes: number;
  escalations: number;
}

interface TelemetryReport {
  app: string | null;
  date: string | null;
  passCount: number;
  tickets: TicketGroup[];
  running: PassView[];
  totals: { byRole: TotalLine[]; byModel: TotalLine[]; byTicket: TotalLine[] };
  completionIntegrity: CompletionIntegrity;
  parentTasks: ParentTaskView[];
}

interface ParentTaskView {
  record: ParentTaskRecord;
  traces: string[];
  tickets: string[];
  branches: string[];
  prs: string[];
  reviews: string[];
  deployments: string[];
  observedStages: string[];
  missingRequiredStages: string[];
  operonEndToEndComplete: boolean;
  evidenceFiles?: string[];
}

interface CompletionIntegrity {
  requiredStages: "complete" | "incomplete" | "unknown";
  interruptedRuns: string[];
  inconsistentWorkdirs: string[];
  staleEnvelopes: string[];
  costTotals: "complete" | "partial" | "estimated" | "unavailable";
  reviewerPass: "completed" | "missing";
  manualFallback: "none" | "present" | "not_recorded";
  prState: "open" | "merged" | "closed" | "abandoned" | "none" | "mixed" | "referenced_not_verified" | "not_recorded";
}

const NO_TICKET = "(no ticket)";

function buildReport(
  rows: StatusRow[],
  taskRecords: ParentTaskRecord[],
  app: string | null,
  date: string | null,
): TelemetryReport {
  const views = rows
    .filter((row) => date === null || row.startedAt.slice(0, 10) === date)
    .map(toPassView)
    // readStatusRows sorts newest-first for the status dashboard; trace
    // blocks read top-down in execution order, so re-sort oldest-first.
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.runId.localeCompare(b.runId));

  // Maps preserve insertion order, and inputs arrive start-sorted, so
  // tickets/traces come out in first-pass start order with no extra sort.
  const tickets = new Map<string, TicketGroup>();
  for (const view of views) {
    const ticketKey = view.ticket ?? NO_TICKET;
    let ticket = tickets.get(ticketKey);
    if (ticket === undefined) {
      ticket = { ticket: view.ticket ?? null, traces: [] };
      tickets.set(ticketKey, ticket);
    }
    let trace = ticket.traces.find((t) => t.traceId === view.traceId);
    if (trace === undefined) {
      trace = { traceId: view.traceId, passes: [], integrity: emptyTraceIntegrity() };
      ticket.traces.push(trace);
    }
    trace.passes.push(view);
  }

  for (const ticket of tickets.values()) {
    for (const trace of ticket.traces) trace.integrity = traceIntegrity(trace.passes);
  }

  const byRole = new Map<string, TotalLine>();
  const byModel = new Map<string, TotalLine>();
  const byTicket = new Map<string, TotalLine>();
  for (const view of views) {
    accumulate(byRole, view.role, view);
    accumulate(byModel, view.model ?? "(unknown model)", view);
    accumulate(byTicket, view.ticket ?? NO_TICKET, view);
  }

  const parentTasks = buildParentTaskViews(taskRecords, views, [...tickets.values()], app, date);
  return {
    app,
    date,
    passCount: views.length,
    tickets: [...tickets.values()],
    running: views.filter((view) => view.running),
    totals: { byRole: [...byRole.values()], byModel: [...byModel.values()], byTicket: [...byTicket.values()] },
    completionIntegrity: completionIntegrity(views, [...tickets.values()], parentTasks),
    parentTasks,
  };
}

function toPassView(row: StatusRow): PassView {
  return {
    ...row,
    cacheHitRatio:
      row.cacheReadTokens !== undefined && row.tokensIn > 0 ? row.cacheReadTokens / row.tokensIn : null,
    running: row.status === "running",
  };
}

function accumulate(map: Map<string, TotalLine>, key: string, view: PassView): void {
  let line = map.get(key);
  if (line === undefined) {
    line = {
      key,
      costUsd: 0,
      costEstimated: false,
      usageQuality: "complete",
      incompletePasses: 0,
      passes: 0,
      escalations: 0,
    };
    map.set(key, line);
  }
  line.costUsd += view.costUsd;
  line.costEstimated = line.costEstimated || view.costEstimated;
  line.usageQuality = leastCompleteQuality(line.usageQuality, view.usageQuality);
  if (view.usageQuality !== "complete") line.incompletePasses += 1;
  line.passes += 1;
  line.escalations += view.escalations;
}

function emptyTraceIntegrity(): TraceIntegrity {
  return {
    requiredPasses: null,
    observedPasses: [],
    missingPasses: [],
    nonCompletedPasses: [],
    skippedPasses: [],
    complete: null,
  };
}

function traceIntegrity(passes: readonly PassView[]): TraceIntegrity {
  const plan = passes.find((view) => view.tracePlan !== undefined)?.tracePlan;
  const observedPasses = [...new Set(passes.map((view) => view.pass))];
  if (plan === undefined) return { ...emptyTraceIntegrity(), observedPasses };
  const missingPasses = plan.required_passes.filter((pass) => !observedPasses.includes(pass));
  const nonCompletedPasses = passes
    .filter((view) => view.status !== "completed")
    .map((view) => `${view.pass}=${view.status}`);
  return {
    requiredPasses: plan.required_passes,
    observedPasses,
    missingPasses,
    nonCompletedPasses,
    skippedPasses: plan.skipped_passes,
    complete: missingPasses.length === 0 && nonCompletedPasses.length === 0,
  };
}

function completionIntegrity(
  views: readonly PassView[],
  tickets: readonly TicketGroup[],
  parentTasks: readonly ParentTaskView[],
): CompletionIntegrity {
  const traces = tickets.flatMap((ticket) => ticket.traces);
  const traceStates = traces.map((trace) => trace.integrity.complete);
  const requiredStages = traceStates.some((state) => state === false)
    ? "incomplete"
    : traceStates.length > 0 && traceStates.every((state) => state === true)
      ? "complete"
      : "unknown";
  const inconsistentWorkdirs = traces
    .filter((trace) => new Set(trace.passes.map((view) => view.workdir).filter(Boolean)).size > 1)
    .map((trace) => trace.traceId);
  const qualities = views.map((view) => view.usageQuality);
  const costTotals = qualities.length === 0
    ? "unavailable"
    : qualities.reduce<UsageQuality>(leastCompleteQuality, "complete");
  return {
    requiredStages,
    interruptedRuns: views
      .filter((view) => ["running", "cancelled", "timed_out"].includes(view.status))
      .map((view) => view.runId),
    inconsistentWorkdirs,
    staleEnvelopes: views.filter((view) => view.running && livenessLabel(view, new Date()).startsWith("stalled")).map((view) => view.runId),
    costTotals,
    reviewerPass: views.some((view) => view.role === "reviewer" && view.status === "completed")
      ? "completed"
      : "missing",
    manualFallback:
      parentTasks.length === 0
        ? "not_recorded"
        : parentTasks.some((task) => task.record.executionMode !== "operon")
          ? "present"
          : "none",
    prState: parentPrState(parentTasks),
  };
}

function parentPrState(tasks: readonly ParentTaskView[]): CompletionIntegrity["prState"] {
  const states = uniqueStrings(
    tasks
      .map((task) => task.record.completionState?.pr)
      .filter((state): state is NonNullable<typeof state> => state !== undefined && state !== "unknown"),
  );
  if (states.length === 1) return states[0] as CompletionIntegrity["prState"];
  if (states.length > 1) return "mixed";
  return tasks.some((task) => task.prs.length > 0) ? "referenced_not_verified" : "not_recorded";
}

function buildParentTaskViews(
  records: readonly ParentTaskRecord[],
  views: readonly PassView[],
  tickets: readonly TicketGroup[],
  app: string | null,
  date: string | null,
): ParentTaskView[] {
  const traceIntegrityById = new Map(
    tickets.flatMap((ticket) => ticket.traces.map((trace) => [trace.traceId, trace.integrity] as const)),
  );
  return records
    .filter((record) => app === null || record.app === app || views.some((view) => view.parentTaskId === record.taskId && view.app === app))
    .filter((record) => date === null || record.startedAt.slice(0, 10) === date || views.some((view) => view.parentTaskId === record.taskId))
    .map((record) => {
      const taskPasses = views.filter((view) => view.parentTaskId === record.taskId);
      const traces = uniqueStrings([...record.refs.traces, ...taskPasses.map((view) => view.traceId)]);
      const observedSet = new Set(taskPasses.filter((view) => view.status === "completed").map((view) => view.role));
      const observedStages = [
        ...record.requiredStages.filter((stage) => observedSet.has(stage)),
        ...[...observedSet].filter((stage) => !record.requiredStages.includes(stage)),
      ];
      const missingRequiredStages = record.requiredStages.filter((stage) => !observedStages.includes(stage));
      const tickets = uniqueStrings([...record.refs.tickets, ...taskPasses.map((view) => view.ticket).filter(isString)]);
      const branches = uniqueStrings([...record.refs.branches, ...taskPasses.map((view) => view.gitBranch).filter(isString)]);
      const artifactRefs = taskPasses.flatMap((view) => view.artifacts ?? []);
      const prs = uniqueStrings([...record.refs.prs, ...artifactRefs.filter((artifact) => artifact.kind === "pr").map((artifact) => artifact.ref)]);
      const reviews = uniqueStrings([...record.refs.reviews, ...artifactRefs.filter((artifact) => artifact.kind === "review").map((artifact) => artifact.ref)]);
      const deployments = uniqueStrings(record.refs.deployments);
      const allTracesComplete = traces.length > 0 && traces.every((trace) => traceIntegrityById.get(trace)?.complete === true);
      return {
        record,
        traces,
        tickets,
        branches,
        prs,
        reviews,
        deployments,
        observedStages,
        missingRequiredStages,
        operonEndToEndComplete:
          record.status === "completed" &&
          record.executionMode === "operon" &&
          missingRequiredStages.length === 0 &&
          allTracesComplete,
      };
    });
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}

function isString(value: string | undefined): value is string {
  return value !== undefined;
}

function leastCompleteQuality(left: UsageQuality, right: UsageQuality): UsageQuality {
  const rank = { complete: 0, estimated: 1, partial: 2, unavailable: 3 } as const;
  return rank[left] >= rank[right] ? left : right;
}

// ---------------------------------------------------------------------------
// shared formatting
// ---------------------------------------------------------------------------

/** "~" marks an estimated (non-provider-reported) cost, matching `operon
 *  status` — the operator must never read a heuristic as a real charge. */
function formatCost(costUsd: number, estimated: boolean, quality?: UsageQuality): string {
  const resolved = quality ?? (estimated ? "estimated" : "complete");
  if (resolved === "unavailable") {
    return costUsd === 0 ? "unavailable" : `$${costUsd.toFixed(2)} recorded + unknown`;
  }
  const amount = `${estimated || resolved === "estimated" ? "~" : ""}$${costUsd.toFixed(2)}`;
  return resolved === "partial" ? `${amount} (partial)` : amount;
}

function formatRatio(ratio: number | null): string {
  return ratio === null ? "—" : `${Math.round(ratio * 100)}%`;
}

function formatWall(view: PassView): string {
  return view.running ? "—" : formatDuration(view.durationMs);
}

/** A running pass with a heartbeat younger than this reads as live; older
 *  (or absent — pre-Stage-3 records) reads as stalled/unknown. Three missed
 *  30-second heartbeats is decisively not "briefly busy". */
const STALL_AFTER_MS = 3 * 60 * 1000;

const RUNNING_CAVEAT = "live = heartbeat within 3m; stalled = heartbeat stopped; unknown = no heartbeat recorded";

function livenessLabel(view: PassView, now: Date): string {
  if (view.lastSeenAt === undefined) return "unknown (no heartbeat)";
  const age = now.getTime() - new Date(view.lastSeenAt).getTime();
  return age <= STALL_AFTER_MS
    ? "live"
    : `stalled (last heartbeat ${view.lastSeenAt})`;
}

// ---------------------------------------------------------------------------
// terminal renderer
// ---------------------------------------------------------------------------

function renderTerminal(report: TelemetryReport): string {
  const filters = [
    ...(report.app !== null ? [`app ${report.app}`] : []),
    ...(report.date !== null ? [`date ${report.date}`] : []),
  ];
  const scope = filters.length > 0 ? ` (${filters.join(", ")})` : "";
  if (report.passCount === 0 && report.parentTasks.length === 0) return `telemetry: no run records${scope}`;

  const lines: string[] = [`Telemetry over runs/ — ${report.passCount} pass(es)${scope}`];

  for (const task of report.parentTasks) {
    lines.push(
      "",
      `PARENT TASK ${task.record.taskId} — ${task.record.status}`,
      `  objective: ${task.record.objective}`,
      `  original prompt: ${task.record.promptRef} sha256:${task.record.promptSha256}`,
      `  native task: ${task.record.source?.nativeRef ?? "not recorded"}`,
      `  execution mode: ${task.record.executionMode}`,
      `  required stages: ${task.record.requiredStages.join(", ") || "none"}`,
      `  observed stages: ${task.observedStages.join(", ") || "none"}`,
      `  Operon end-to-end complete: ${task.operonEndToEndComplete ? "yes" : "no"}`,
      `  traces: ${task.traces.join(", ") || "none"}; tickets: ${task.tickets.join(", ") || "none"}; PRs: ${task.prs.join(", ") || "none"}`,
    );
  }

  for (const ticket of report.tickets) {
    lines.push("", `TICKET ${ticket.ticket ?? NO_TICKET}`);
    for (const trace of ticket.traces) {
      lines.push(`  trace ${trace.traceId}`);
      for (const view of trace.passes) {
        lines.push(`    ${passLine(view)}`);
      }
    }
  }

  lines.push("", "TOTALS");
  for (const [label, totals] of [
    ["role", report.totals.byRole],
    ["model", report.totals.byModel],
    ["ticket", report.totals.byTicket],
  ] as const) {
    for (const line of totals) {
      lines.push(
        `  ${label.padEnd(6)} ${line.key.padEnd(26)} ${formatCost(line.costUsd, line.costEstimated, line.usageQuality).padStart(18)}  ${String(line.passes).padStart(3)} pass(es)  ${String(line.escalations).padStart(3)} esc`,
      );
    }
  }
  lines.push(
    "",
    "COMPLETION INTEGRITY",
    `  required stages: ${report.completionIntegrity.requiredStages}`,
    `  interrupted runs: ${report.completionIntegrity.interruptedRuns.join(", ") || "none"}`,
    `  inconsistent workdirs: ${report.completionIntegrity.inconsistentWorkdirs.join(", ") || "none observed"}`,
    `  stale envelopes: ${report.completionIntegrity.staleEnvelopes.join(", ") || "none"}`,
    `  recorded cost completeness: ${report.completionIntegrity.costTotals}`,
    `  reviewer pass: ${report.completionIntegrity.reviewerPass}`,
    `  manual fallback: ${report.completionIntegrity.manualFallback}`,
    `  PR/review/merge state: ${report.completionIntegrity.prState}`,
  );

  if (report.running.length > 0) {
    const now = new Date();
    lines.push("", `STILL RUNNING (${RUNNING_CAVEAT})`);
    for (const view of report.running) {
      lines.push(
        `  ${view.runId}  ${view.app}  ${view.pipeline}/${view.pass}  started ${view.startedAt}  ${livenessLabel(view, now)}`,
      );
    }
  }
  return lines.join("\n");
}

function passLine(view: PassView): string {
  return [
    view.runId.padEnd(30),
    `${view.pipeline}/${view.pass}`.padEnd(22),
    view.status.padEnd(22),
    formatWall(view).padStart(7),
    `${view.tokensIn}/${view.tokensOut}`.padStart(12),
    `cache ${formatRatio(view.cacheHitRatio)}`.padStart(10),
    formatCost(view.costUsd, view.costEstimated, view.usageQuality).padStart(18),
    `${view.runtime ?? "?"}/${view.model ?? "?"}/${view.effort ?? "?"}`,
    `esc ${view.escalations}`,
  ].join(" ");
}

// ---------------------------------------------------------------------------
// --json renderer — stable snake_case field names (machine consumers)
// ---------------------------------------------------------------------------

function reportToJson(report: TelemetryReport): unknown {
  return {
    filters: { app: report.app, date: report.date },
    pass_count: report.passCount,
    parent_tasks: report.parentTasks.map(parentTaskToJson),
    tickets: report.tickets.map((ticket) => ({
      ticket: ticket.ticket,
      traces: ticket.traces.map((trace) => ({
        trace_id: trace.traceId,
        integrity: {
          required_passes: trace.integrity.requiredPasses,
          observed_passes: trace.integrity.observedPasses,
          missing_passes: trace.integrity.missingPasses,
          non_completed_passes: trace.integrity.nonCompletedPasses,
          skipped_passes: trace.integrity.skippedPasses,
          complete: trace.integrity.complete,
        },
        passes: trace.passes.map(passToJson),
      })),
    })),
    running: report.running.map(passToJson),
    totals: {
      by_role: report.totals.byRole.map((line) => totalToJson("role", line)),
      by_model: report.totals.byModel.map((line) => totalToJson("model", line)),
      by_ticket: report.totals.byTicket.map((line) => totalToJson("ticket", line)),
    },
    completion_integrity: {
      required_stages: report.completionIntegrity.requiredStages,
      interrupted_runs: report.completionIntegrity.interruptedRuns,
      inconsistent_workdirs: report.completionIntegrity.inconsistentWorkdirs,
      stale_envelopes: report.completionIntegrity.staleEnvelopes,
      cost_totals: report.completionIntegrity.costTotals,
      reviewer_pass: report.completionIntegrity.reviewerPass,
      manual_fallback: report.completionIntegrity.manualFallback,
      pr_state: report.completionIntegrity.prState,
    },
  };
}

function parentTaskToJson(task: ParentTaskView): unknown {
  return {
    task_id: task.record.taskId,
    app: task.record.app ?? null,
    objective: task.record.objective,
    completion_criteria: task.record.completionCriteria ?? null,
    original_prompt: {
      ref: task.record.promptRef,
      sha256: task.record.promptSha256,
    },
    source: task.record.source ?? null,
    repository: task.record.repository ?? null,
    charter: task.record.charter ?? null,
    status: task.record.status,
    started_at: task.record.startedAt,
    ended_at: task.record.endedAt ?? null,
    execution_mode: task.record.executionMode,
    completion_state: task.record.completionState ?? null,
    fallback_events: task.record.fallbackEvents,
    required_stages: task.record.requiredStages,
    observed_stages: task.observedStages,
    missing_required_stages: task.missingRequiredStages,
    operon_end_to_end_complete: task.operonEndToEndComplete,
    resulting: {
      tickets: task.tickets,
      traces: task.traces,
      branches: task.branches,
      prs: task.prs,
      reviews: task.reviews,
      deployments: task.deployments,
    },
  };
}

function passToJson(view: PassView): unknown {
  return {
    run_id: view.runId,
    app: view.app,
    ticket: view.ticket ?? null,
    trace_id: view.traceId,
    parent_task_id: view.parentTaskId ?? null,
    pipeline: view.pipeline,
    pass: view.pass,
    role: view.role,
    runtime: view.runtime ?? null,
    model: view.model ?? null,
    effort: view.effort ?? null,
    workdir: view.workdir ?? null,
    git_head: view.gitHead ?? null,
    git_branch: view.gitBranch ?? null,
    status: view.status,
    started_at: view.startedAt,
    wall_clock_ms: view.running ? null : view.durationMs,
    tokens_in: view.tokensIn,
    tokens_out: view.tokensOut,
    cache_read_tokens: view.cacheReadTokens ?? null,
    cache_hit_ratio: view.cacheHitRatio,
    cost_usd: view.costUsd,
    cost_estimated: view.costEstimated,
    usage_quality: view.usageQuality,
    escalations: view.escalations,
    tool_calls: view.toolCalls,
    terminal_reason: view.terminalReason ?? null,
    session: view.session ?? null,
    artifacts: view.artifacts ?? [],
    refs: view.refs,
    trace_plan: view.tracePlan ?? null,
  };
}

function totalToJson(keyName: string, line: TotalLine): unknown {
  return {
    [keyName]: line.key,
    cost_usd: line.costUsd,
    cost_estimated: line.costEstimated,
    usage_quality: line.usageQuality,
    incomplete_passes: line.incompletePasses,
    passes: line.passes,
    escalations: line.escalations,
  };
}

// ---------------------------------------------------------------------------
// --html renderer — one self-contained static file
// ---------------------------------------------------------------------------

/** Every interpolated string flows through this — previews and verdicts are
 *  model output and may contain markup. */
function esc(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function statusClass(status: string): string {
  if (status === "completed") return "completed";
  if (status === "running") return "running";
  if (status === "blocked") return "blocked";
  if (status === "cancelled" || status === "timed_out") return "failed";
  if (status.startsWith("failed")) return "failed";
  return "other";
}

function renderHtml(report: TelemetryReport, evidenceDir: string): string {
  const filters = [
    ...(report.app !== null ? [`app: ${report.app}`] : []),
    ...(report.date !== null ? [`date: ${report.date}`] : []),
  ];
  const subtitle = `${report.passCount} pass(es)${filters.length > 0 ? ` — ${filters.join(", ")}` : ""}`;

  const body = [
    `<h1>Operon telemetry</h1>`,
    `<p class="muted">${esc(subtitle)} · source run state was read-only; linked artifacts are copies in <code>${esc(evidenceDir)}</code></p>`,
    renderParentTasks(report, evidenceDir),
    ...report.tickets.map((ticket) => renderTicketSection(ticket)),
    renderCompletionIntegrity(report),
    renderPassTable(report, evidenceDir),
    renderCostSection(report),
    renderRunningSection(report),
  ].join("\n");

  // Deliberately script-free: the view is static, and no <script> element in
  // the document makes "no unescaped markup from previews" verifiable.
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Operon telemetry</title>
<style>${CSS}</style>
</head>
<body>
${body}
</body>
</html>
`;
}

function renderParentTasks(report: TelemetryReport, evidenceDir: string): string {
  if (report.parentTasks.length === 0) {
    return `<section><h2>Parent delegated task</h2><p class="muted">Not recorded by this run generation. Pass telemetry cannot reconstruct the exact outer operator prompt.</p></section>`;
  }
  return report.parentTasks.map((task) => {
    const taskLinks = [
      parentEvidenceLink(task, evidenceDir, "task.json", "Task record"),
      parentEvidenceLink(task, evidenceDir, task.record.promptRef, "Exact original operator prompt"),
    ].filter((link): link is string => link !== undefined);
    const native = task.record.source?.nativeRef !== undefined
      ? `<a href="${esc(task.record.source.nativeRef)}">${esc(task.record.source.nativeRef)}</a>`
      : "not recorded";
    return `<section><h2>Parent task ${esc(task.record.taskId)}</h2><dl class="integrity">
<dt>Objective</dt><dd>${esc(task.record.objective)}</dd>
<dt>Original prompt</dt><dd>${taskLinks.join(" · ") || `${esc(task.record.promptRef)} sha256:${esc(task.record.promptSha256)}`}</dd>
<dt>Native harness task</dt><dd>${native}</dd>
<dt>Started / ended / status</dt><dd>${esc(task.record.startedAt)} / ${esc(task.record.endedAt ?? "running")} / ${esc(task.record.status)}</dd>
<dt>Repository</dt><dd><code>${esc(task.record.repository?.workdir ?? "not recorded")}</code> · ${esc(task.record.repository?.branch ?? "unknown branch")} · <code>${esc(task.record.repository?.head ?? "unknown HEAD")}</code></dd>
<dt>Execution mode</dt><dd>${esc(task.record.executionMode)}${task.record.fallbackEvents.length > 0 ? ` — ${esc(task.record.fallbackEvents.map((event) => event.reason).join("; "))}` : ""}</dd>
<dt>Required / observed stages</dt><dd>${esc(task.record.requiredStages.join(", ") || "none")} / ${esc(task.observedStages.join(", ") || "none")}</dd>
<dt>Operon end-to-end complete?</dt><dd>${task.operonEndToEndComplete ? "yes" : `no${task.missingRequiredStages.length > 0 ? ` — missing ${esc(task.missingRequiredStages.join(", "))}` : ""}`}</dd>
<dt>Lifecycle state</dt><dd>${esc(task.record.completionState === undefined ? "not recorded" : `implementation ${task.record.completionState.implementation}; CI ${task.record.completionState.ci}; Operon review ${task.record.completionState.operonReview}; human review ${task.record.completionState.humanReview}; PR ${task.record.completionState.pr}; issues close on merge ${task.record.completionState.issuesCloseOnMerge.join(", ") || "none"}`)}</dd>
<dt>Results</dt><dd>tickets ${esc(task.tickets.join(", ") || "none")}; traces ${esc(task.traces.join(", ") || "none")}; branches ${esc(task.branches.join(", ") || "none")}; PRs ${esc(task.prs.join(", ") || "none")}; reviews ${esc(task.reviews.join(", ") || "none")}; deployments ${esc(task.deployments.join(", ") || "none")}</dd>
</dl></section>`;
  }).join("\n");
}

function parentEvidenceLink(
  task: ParentTaskView,
  evidenceDir: string,
  file: string,
  label: string,
): string | undefined {
  if (!task.evidenceFiles?.includes(file)) return undefined;
  const href = [evidenceDir, "tasks", task.record.taskId, file]
    .map((part) => encodeURIComponent(part))
    .join("/");
  return `<a href="${esc(href)}">${esc(label)}</a>`;
}

function renderTicketSection(ticket: TicketGroup): string {
  const passes = ticket.traces.flatMap((trace) => trace.passes);
  const starts = passes.map((view) => new Date(view.startedAt).getTime());
  const ends = passes.map((view, i) => starts[i]! + (view.running ? 0 : view.durationMs));
  const min = Math.min(...starts);
  const span = Math.max(Math.max(...ends) - min, 1);

  const rows = ticket.traces
    .map((trace) => {
      const bars = trace.passes
        .map((view) => {
          const left = ((new Date(view.startedAt).getTime() - min) / span) * 100;
          const width = view.running ? 0.75 : Math.max((view.durationMs / span) * 100, 0.75);
          const title = esc(
            `${view.runId} — ${view.pipeline}/${view.pass} — ${view.status} — ${formatWall(view)} — ${formatCost(view.costUsd, view.costEstimated)}${previewText(view)}`,
          );
          const pin =
            view.escalations > 0
              ? `<span class="pin" title="${esc(`${view.escalations} escalation(s) — see approvals/`)}">&#9650;</span>`
              : "";
          return `<div class="gantt-row"><span class="gantt-label">${esc(`${view.pass} (${view.role})`)}</span><span class="gantt-track"><span class="bar ${statusClass(view.status)}" style="left:${left.toFixed(2)}%;width:${width.toFixed(2)}%" title="${title}">${pin}</span></span></div>`;
        })
        .join("\n");
      const integrity = trace.integrity.complete === null
        ? "required-pass manifest unavailable (legacy trace)"
        : trace.integrity.complete
          ? "all selected passes completed"
          : `incomplete: ${[...trace.integrity.missingPasses.map((p) => `missing ${p}`), ...trace.integrity.nonCompletedPasses].join(", ")}`;
      const skipped = trace.integrity.skippedPasses.length === 0
        ? ""
        : `<div class="muted trace-skip">Skipped by routing: ${esc(trace.integrity.skippedPasses.map((entry) => `${entry.pass} — ${entry.reason}`).join("; "))}</div>`;
      return `<div class="trace"><div class="trace-id">trace ${esc(trace.traceId)} · ${esc(integrity)}</div>${skipped}\n${bars}</div>`;
    })
    .join("\n");

  return `<section><h2>Ticket ${esc(ticket.ticket ?? NO_TICKET)}</h2>\n${rows}</section>`;
}

function previewText(view: PassView): string {
  const parts = [
    ...(view.verdictSummary !== undefined ? [view.verdictSummary] : []),
    ...Object.values(view.previews ?? {}),
  ];
  return parts.length > 0 ? ` — ${parts.join(" · ")}` : "";
}

function renderPassTable(report: TelemetryReport, evidenceDir: string): string {
  const rows = report.tickets
    .flatMap((ticket) => ticket.traces.flatMap((trace) => trace.passes))
    .map(
      (view) =>
        `<tr><td><details><summary><code>${esc(view.runId)}</code></summary>${renderPassDetails(view, evidenceDir)}</details></td><td>${esc(`${view.pipeline}/${view.pass}`)}</td><td><span class="dot ${statusClass(view.status)}"></span>${esc(view.status)}</td><td>${esc(`${view.runtime ?? "unknown"} / ${view.model ?? "unknown"} / ${view.effort ?? "unknown"}`)}</td><td class="num">${esc(formatWall(view))}</td><td class="num">${view.tokensIn}/${view.tokensOut}</td><td class="num">${esc(formatRatio(view.cacheHitRatio))}</td><td class="num">${esc(formatCost(view.costUsd, view.costEstimated, view.usageQuality))}</td><td class="num">${view.toolCalls}</td><td class="num">${view.escalations}</td><td class="summary">${esc(view.verdictSummary ?? "")}</td></tr>`,
    )
    .join("\n");
  return `<section><h2>Passes</h2><div class="scroll"><table>
<thead><tr><th>Run + evidence</th><th>Pipeline/pass</th><th>Status</th><th>Harness / model / effort</th><th>Wall</th><th>Tokens in/out</th><th>Cache</th><th>Recorded cost</th><th>Tools</th><th>Esc</th><th>Verdict</th></tr></thead>
<tbody>${rows}</tbody></table></div></section>`;
}

function renderCostSection(report: TelemetryReport): string {
  const table = (title: string, lines: TotalLine[]): string => {
    const rows = lines
      .map(
        (line) =>
          `<tr><td>${esc(line.key)}</td><td class="num">${esc(formatCost(line.costUsd, line.costEstimated, line.usageQuality))}</td><td>${esc(line.usageQuality)}${line.incompletePasses > 0 ? ` (${line.incompletePasses} incomplete)` : ""}</td><td class="num">${line.passes}</td><td class="num">${line.escalations}</td></tr>`,
      )
      .join("\n");
    return `<div class="cost-table"><h3>${esc(title)}</h3><table>
<thead><tr><th>${esc(title)}</th><th>Recorded cost</th><th>Completeness</th><th>Passes</th><th>Esc</th></tr></thead>
<tbody>${rows}</tbody></table></div>`;
  };
  return `<section><h2>Cost attribution</h2><div class="cost-grid">
${table("By role", report.totals.byRole)}
${table("By model", report.totals.byModel)}
${table("By ticket", report.totals.byTicket)}
</div></section>`;
}

function renderPassDetails(view: PassView, evidenceDir: string): string {
  const links = [
    evidenceLink(view, evidenceDir, "envelope.json", "Envelope"),
    ...(view.refs.prompt !== undefined
      ? [evidenceLink(view, evidenceDir, view.refs.prompt, "Exact input prompt")]
      : []),
    evidenceLink(view, evidenceDir, view.refs.brief, "Assembled brief"),
    evidenceLink(view, evidenceDir, view.refs.output, "Output / verdict"),
    evidenceLink(view, evidenceDir, view.refs.events, "Event stream"),
    ...(view.refs.session_log !== undefined
      ? [evidenceLink(view, evidenceDir, view.refs.session_log, "Activity log (not full transcript)")]
      : []),
  ].filter((link): link is string => link !== undefined);
  const native =
    view.session?.native_ref !== undefined
      ? `<a href="${esc(view.session.native_ref)}">Native task/session</a>`
      : "No native task link";
  const artifacts = (view.artifacts ?? []).map((artifact) => `${artifact.kind}: ${artifact.ref}`).join("; ") || "none";
  return `<dl class="run-detail">
<dt>Started / duration</dt><dd>${esc(view.startedAt)} / ${esc(formatWall(view))}</dd>
<dt>Working directory</dt><dd><code>${esc(view.workdir ?? "not recorded (legacy run)")}</code></dd>
<dt>Git branch / HEAD</dt><dd><code>${esc(view.gitBranch ?? "unknown")}</code> / <code>${esc(view.gitHead ?? "unknown")}</code></dd>
<dt>Usage</dt><dd>${esc(view.usageQuality)} · ${esc(formatCost(view.costUsd, view.costEstimated, view.usageQuality))}</dd>
<dt>Terminal reason</dt><dd>${esc(view.terminalReason ?? "none recorded")}</dd>
<dt>Provider session</dt><dd>${esc(view.session?.id ?? "not recorded")} · ${native}</dd>
<dt>Full transcript</dt><dd>${esc(view.session?.transcript_note ?? "Unavailable: this run predates transcript availability metadata. session.log, if present, is activity only.")}</dd>
<dt>Artifacts</dt><dd>${esc(artifacts)}</dd>
<dt>Persisted evidence</dt><dd>${links.join(" · ") || "No copied evidence files"}</dd>
</dl>`;
}

function evidenceLink(
  view: PassView,
  evidenceDir: string,
  file: string,
  label: string,
): string | undefined {
  if (!view.evidenceFiles?.includes(file)) return undefined;
  const href = [evidenceDir, view.app, view.runId, file]
    .map((part) => encodeURIComponent(part))
    .join("/");
  return `<a href="${esc(href)}">${esc(label)}</a>`;
}

function renderCompletionIntegrity(report: TelemetryReport): string {
  const integrity = report.completionIntegrity;
  return `<section><h2>Completion integrity</h2><dl class="integrity">
<dt>Did every selected stage run?</dt><dd>${esc(integrity.requiredStages)}</dd>
<dt>Interrupted / still-running passes</dt><dd>${esc(integrity.interruptedRuns.join(", ") || "none")}</dd>
<dt>Unexpected workdir changes within a trace</dt><dd>${esc(integrity.inconsistentWorkdirs.join(", ") || "none observed")}</dd>
<dt>Stale envelopes</dt><dd>${esc(integrity.staleEnvelopes.join(", ") || "none")}</dd>
<dt>Are recorded cost totals complete?</dt><dd>${esc(integrity.costTotals)}</dd>
<dt>Did an Operon Reviewer pass complete?</dt><dd>${esc(integrity.reviewerPass)}</dd>
<dt>Manual/external fallback</dt><dd>${esc(integrity.manualFallback)}</dd>
<dt>PR approval / merge / issue-close state</dt><dd>${esc(integrity.prState)}</dd>
</dl></section>`;
}

function renderRunningSection(report: TelemetryReport): string {
  if (report.running.length === 0) return "";
  const items = report.running
    .map((view) => `<li><code>${esc(view.runId)}</code> ${esc(`${view.app} ${view.pipeline}/${view.pass}`)} — started ${esc(view.startedAt)} — ${esc(livenessLabel(view, new Date()))}</li>`)
    .join("\n");
  return `<section><h2>Still running</h2><p class="muted">${esc(RUNNING_CAVEAT)}.</p><ul>${items}</ul></section>`;
}

function evidenceDirectoryName(target: string): string {
  const file = basename(target);
  const stem = file.replace(/\.html?$/i, "") || "telemetry";
  return `${stem}.evidence`;
}

async function materializeEvidenceBundle(
  stateHome: string,
  bundlePath: string,
  report: TelemetryReport,
): Promise<void> {
  await rm(bundlePath, { recursive: true, force: true });
  for (const task of report.parentTasks) {
    const sourceDir = join(stateHome, "tasks", task.record.taskId);
    const targetDir = join(bundlePath, "tasks", task.record.taskId);
    const copied: string[] = [];
    for (const file of ["task.json", task.record.promptRef]) {
      const source = join(sourceDir, file);
      if (!existsSync(source)) continue;
      await mkdir(targetDir, { recursive: true });
      await copyFile(source, join(targetDir, file));
      copied.push(file);
    }
    task.evidenceFiles = copied;
  }
  const views = report.tickets.flatMap((ticket) => ticket.traces.flatMap((trace) => trace.passes));
  for (const view of views) {
    const sourceDir = join(stateHome, "runs", view.app, view.runId);
    const targetDir = join(bundlePath, view.app, view.runId);
    const candidates = [
      "envelope.json",
      view.refs.events,
      view.refs.brief,
      ...(view.refs.prompt !== undefined ? [view.refs.prompt] : []),
      view.refs.output,
      ...(view.refs.session_log !== undefined ? [view.refs.session_log] : []),
    ].filter((file, index, all) => all.indexOf(file) === index && basename(file) === file);
    const copied: string[] = [];
    for (const file of candidates) {
      const source = join(sourceDir, file);
      if (!existsSync(source)) continue;
      await mkdir(targetDir, { recursive: true });
      await copyFile(source, join(targetDir, file));
      copied.push(file);
    }
    view.evidenceFiles = copied;
  }
}

const CSS = `
:root {
  --bg: #ffffff; --fg: #1c1c1c; --muted: #6b6b6b; --line: #dcdcdc; --track: #f2f2f2;
  --completed: #2e7d32; --failed: #c62828; --blocked: #b26a00; --running: #1565c0; --other: #6a1b9a;
  color-scheme: light dark;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #141414; --fg: #e8e8e8; --muted: #9a9a9a; --line: #333333; --track: #222222;
    --completed: #66bb6a; --failed: #ef5350; --blocked: #ffb74d; --running: #64b5f6; --other: #ba68c8;
  }
}
body { margin: 2rem auto; max-width: 72rem; padding: 0 1rem; background: var(--bg); color: var(--fg);
  font: 14px/1.5 ui-sans-serif, system-ui, sans-serif; }
h1 { font-size: 1.4rem; } h2 { font-size: 1.1rem; margin-top: 2rem; } h3 { font-size: 0.95rem; }
code { font-family: ui-monospace, monospace; font-size: 0.85em; }
.muted { color: var(--muted); }
section { border-top: 1px solid var(--line); }
.trace { margin: 0.75rem 0; }
.trace-id { color: var(--muted); font-family: ui-monospace, monospace; font-size: 0.8rem; }
.gantt-row { display: flex; align-items: center; gap: 0.5rem; height: 1.4rem; }
.gantt-label { flex: 0 0 14rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 0.8rem; }
.gantt-track { position: relative; flex: 1; height: 0.85rem; background: var(--track); border-radius: 3px; }
.bar { position: absolute; top: 0; height: 100%; border-radius: 3px; min-width: 3px; }
.bar.completed { background: var(--completed); } .bar.failed { background: var(--failed); }
.bar.blocked { background: var(--blocked); } .bar.other { background: var(--other); }
.bar.running { background: transparent; border: 2px dashed var(--running); }
.pin { position: absolute; right: -0.3rem; top: -0.75rem; color: var(--failed); font-size: 0.7rem; }
.scroll { overflow-x: auto; }
table { border-collapse: collapse; width: 100%; margin: 0.5rem 0; }
th, td { text-align: left; padding: 0.3rem 0.6rem; border-bottom: 1px solid var(--line); white-space: nowrap; }
td.num { text-align: right; font-variant-numeric: tabular-nums; }
td.summary { white-space: normal; max-width: 20rem; }
.dot { display: inline-block; width: 0.6em; height: 0.6em; border-radius: 50%; margin-right: 0.4em; }
.dot.completed { background: var(--completed); } .dot.failed { background: var(--failed); }
.dot.blocked { background: var(--blocked); } .dot.running { background: var(--running); } .dot.other { background: var(--other); }
.cost-grid { display: flex; flex-wrap: wrap; gap: 1.5rem; }
.cost-table { flex: 1 1 18rem; }
.trace-skip { margin: 0.2rem 0 0.4rem; font-size: 0.78rem; }
.run-detail, .integrity { display: grid; grid-template-columns: minmax(9rem, auto) 1fr; gap: 0.15rem 0.8rem; margin: 0.5rem 0; }
.run-detail dt, .integrity dt { color: var(--muted); }
.run-detail dd, .integrity dd { margin: 0; white-space: normal; overflow-wrap: anywhere; }
a { color: var(--running); }
`;
