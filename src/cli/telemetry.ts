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

import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { formatDuration, readStatusRows, type StatusRow } from "../runtime/runlog/status.js";
import { resolveOperonHomes } from "../org/home.js";
import { extractHomeFlags } from "./home-flags.js";

export async function cmdTelemetry(args: string[]): Promise<number> {
  const common = extractHomeFlags(args, "telemetry");
  const parsed = parseArgs(common.rest);
  const stateHome = common.stateHome ? resolve(common.stateHome) : (await resolveOperonHomes(common)).stateHome;

  const rows = await readStatusRows(stateHome, parsed.app !== undefined ? { app: parsed.app } : {});
  const report = buildReport(rows, parsed.app ?? null, parsed.date ?? null);

  if (parsed.html !== undefined) {
    const target = resolve(parsed.html);
    await writeFile(target, renderHtml(report), "utf8");
    console.log(`telemetry: wrote ${target}`);
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
}

interface TraceGroup {
  traceId: string;
  passes: PassView[];
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
}

const NO_TICKET = "(no ticket)";

function buildReport(rows: StatusRow[], app: string | null, date: string | null): TelemetryReport {
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
      trace = { traceId: view.traceId, passes: [] };
      ticket.traces.push(trace);
    }
    trace.passes.push(view);
  }

  const byRole = new Map<string, TotalLine>();
  const byModel = new Map<string, TotalLine>();
  const byTicket = new Map<string, TotalLine>();
  for (const view of views) {
    accumulate(byRole, view.role, view);
    accumulate(byModel, view.model ?? "(unknown model)", view);
    accumulate(byTicket, view.ticket ?? NO_TICKET, view);
  }

  return {
    app,
    date,
    passCount: views.length,
    tickets: [...tickets.values()],
    running: views.filter((view) => view.running),
    totals: { byRole: [...byRole.values()], byModel: [...byModel.values()], byTicket: [...byTicket.values()] },
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
    line = { key, costUsd: 0, costEstimated: false, passes: 0, escalations: 0 };
    map.set(key, line);
  }
  line.costUsd += view.costUsd;
  line.costEstimated = line.costEstimated || view.costEstimated;
  line.passes += 1;
  line.escalations += view.escalations;
}

// ---------------------------------------------------------------------------
// shared formatting
// ---------------------------------------------------------------------------

/** "~" marks an estimated (non-provider-reported) cost, matching `operon
 *  status` — the operator must never read a heuristic as a real charge. */
function formatCost(costUsd: number, estimated: boolean): string {
  return `${estimated ? "~" : ""}$${costUsd.toFixed(2)}`;
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
  if (report.passCount === 0) return `telemetry: no run records${scope}`;

  const lines: string[] = [`Telemetry over runs/ — ${report.passCount} pass(es)${scope}`];

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
        `  ${label.padEnd(6)} ${line.key.padEnd(26)} ${formatCost(line.costUsd, line.costEstimated).padStart(9)}  ${String(line.passes).padStart(3)} pass(es)  ${String(line.escalations).padStart(3)} esc`,
      );
    }
  }

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
    formatCost(view.costUsd, view.costEstimated).padStart(9),
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
    tickets: report.tickets.map((ticket) => ({
      ticket: ticket.ticket,
      traces: ticket.traces.map((trace) => ({
        trace_id: trace.traceId,
        passes: trace.passes.map(passToJson),
      })),
    })),
    running: report.running.map(passToJson),
    totals: {
      by_role: report.totals.byRole.map((line) => totalToJson("role", line)),
      by_model: report.totals.byModel.map((line) => totalToJson("model", line)),
      by_ticket: report.totals.byTicket.map((line) => totalToJson("ticket", line)),
    },
  };
}

function passToJson(view: PassView): unknown {
  return {
    run_id: view.runId,
    app: view.app,
    ticket: view.ticket ?? null,
    trace_id: view.traceId,
    pipeline: view.pipeline,
    pass: view.pass,
    role: view.role,
    model: view.model ?? null,
    status: view.status,
    started_at: view.startedAt,
    wall_clock_ms: view.running ? null : view.durationMs,
    tokens_in: view.tokensIn,
    tokens_out: view.tokensOut,
    cache_read_tokens: view.cacheReadTokens ?? null,
    cache_hit_ratio: view.cacheHitRatio,
    cost_usd: view.costUsd,
    cost_estimated: view.costEstimated,
    escalations: view.escalations,
  };
}

function totalToJson(keyName: string, line: TotalLine): unknown {
  return {
    [keyName]: line.key,
    cost_usd: line.costUsd,
    cost_estimated: line.costEstimated,
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
  if (status.startsWith("failed")) return "failed";
  return "other";
}

function renderHtml(report: TelemetryReport): string {
  const filters = [
    ...(report.app !== null ? [`app: ${report.app}`] : []),
    ...(report.date !== null ? [`date: ${report.date}`] : []),
  ];
  const subtitle = `${report.passCount} pass(es)${filters.length > 0 ? ` — ${filters.join(", ")}` : ""}`;

  const body = [
    `<h1>Operon telemetry</h1>`,
    `<p class="muted">${esc(subtitle)} · read-only view over <code>runs/</code></p>`,
    ...report.tickets.map(renderTicketSection),
    renderPassTable(report),
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
      return `<div class="trace"><div class="trace-id">trace ${esc(trace.traceId)}</div>\n${bars}</div>`;
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

function renderPassTable(report: TelemetryReport): string {
  const rows = report.tickets
    .flatMap((ticket) => ticket.traces.flatMap((trace) => trace.passes))
    .map(
      (view) =>
        `<tr><td><code>${esc(view.runId)}</code></td><td>${esc(`${view.pipeline}/${view.pass}`)}</td><td><span class="dot ${statusClass(view.status)}"></span>${esc(view.status)}</td><td class="num">${esc(formatWall(view))}</td><td class="num">${view.tokensIn}/${view.tokensOut}</td><td class="num">${esc(formatRatio(view.cacheHitRatio))}</td><td class="num">${esc(formatCost(view.costUsd, view.costEstimated))}</td><td class="num">${view.escalations}</td><td class="summary">${esc(view.verdictSummary ?? "")}</td></tr>`,
    )
    .join("\n");
  return `<section><h2>Passes</h2><div class="scroll"><table>
<thead><tr><th>Run</th><th>Pipeline/pass</th><th>Status</th><th>Wall</th><th>Tokens in/out</th><th>Cache</th><th>Cost</th><th>Esc</th><th>Verdict</th></tr></thead>
<tbody>${rows}</tbody></table></div></section>`;
}

function renderCostSection(report: TelemetryReport): string {
  const table = (title: string, lines: TotalLine[]): string => {
    const rows = lines
      .map(
        (line) =>
          `<tr><td>${esc(line.key)}</td><td class="num">${esc(formatCost(line.costUsd, line.costEstimated))}</td><td class="num">${line.passes}</td><td class="num">${line.escalations}</td></tr>`,
      )
      .join("\n");
    return `<div class="cost-table"><h3>${esc(title)}</h3><table>
<thead><tr><th>${esc(title)}</th><th>Cost</th><th>Passes</th><th>Esc</th></tr></thead>
<tbody>${rows}</tbody></table></div>`;
  };
  return `<section><h2>Cost attribution</h2><div class="cost-grid">
${table("By role", report.totals.byRole)}
${table("By model", report.totals.byModel)}
${table("By ticket", report.totals.byTicket)}
</div></section>`;
}

function renderRunningSection(report: TelemetryReport): string {
  if (report.running.length === 0) return "";
  const items = report.running
    .map((view) => `<li><code>${esc(view.runId)}</code> ${esc(`${view.app} ${view.pipeline}/${view.pass}`)} — started ${esc(view.startedAt)}</li>`)
    .join("\n");
  return `<section><h2>Still running</h2><p class="muted">${esc(RUNNING_CAVEAT)}.</p><ul>${items}</ul></section>`;
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
`;
