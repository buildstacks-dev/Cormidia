import { createHash } from "node:crypto";
import { basename } from "node:path";
import type { AppsFile } from "../org/apps.js";
import { rollupBudgets } from "../org/budget.js";
import { settlementIdentity, settlementKey } from "../runtime/telemetry.js";
import { aggregateCost } from "../runtime/cost.js";
import { classifyEnvelopeUsage } from "../runtime/runlog/envelope.js";
import { readReportDetails } from "./detail-source.js";
import { earliestLedgerDay, readLedgerRange, type LedgerRowSource } from "./ledger-source.js";
import { bucketStart, nextBucket, normalizeReportRange } from "./range.js";
import { groupReportSessions, normalizedQuality, worstQuality } from "./sessions.js";
import { deterministicCounts, nearestRank, share } from "./statistics.js";
import { buildEfficiencyReport } from "./efficiency.js";
import {
  REPORT_SCHEMA_VERSION,
  type ReportAppRowV1,
  type ReportBreakdownV1,
  type ReportBucketV1,
  type ReportQuery,
  type ReportSessionDetailV1,
  type ReportSnapshotV1,
  type ReportTurnV1,
  type ReportUsageQuality,
} from "./types.js";

export interface BuildReportOptions {
  orgName: string;
  stateHome: string;
  appsFile: AppsFile;
  query?: ReportQuery;
  now?: Date;
}

export async function buildReport(options: BuildReportOptions): Promise<ReportSnapshotV1> {
  const now = options.now ?? new Date();
  const query = options.query ?? {};
  if (query.app !== undefined && !options.appsFile.apps.some((app) => app.name === query.app)) {
    throw new Error(`report: unknown registered app "${query.app}"`);
  }
  const earliest = query.period === "all" ? await earliestLedgerDay(options.stateHome) : undefined;
  const range = normalizeReportRange(query, now, earliest);
  const ledger = await readLedgerRange(options.stateHome, range, now);
  const scopedRows = ledger.rows.filter(({ record }) => query.app === undefined || record.app === query.app);
  const details = await readReportDetails(options.stateHome, scopedRows, range, query.app);
  const grouped = groupReportSessions(scopedRows, details, query.app);
  const settledTurns = grouped.sessions.flatMap((session) => session.activities).filter((turn) => turn.activity_type === "provider_turn" && turn.settled_at !== null);
  const unattributedSettled = grouped.unattributed.filter((turn) => turn.settled_at !== null);
  const allTurns = [...settledTurns, ...unattributedSettled];
  const observable = allTurns.filter((turn) => turn.tokens_in !== null && turn.tokens_out !== null);
  const costKnown = allTurns.filter((turn) => turn.cost_usd !== null);
  const reported = costKnown.filter((turn) => !turn.cost_estimated && turn.usage_quality !== "partial");
  const estimated = costKnown.filter((turn) => turn.cost_estimated && turn.usage_quality !== "partial");
  const partial = costKnown.filter((turn) => turn.usage_quality === "partial");
  const sessions = grouped.sessions;
  const duplicate = duplicateFacts(scopedRows);
  const efficiency = await buildEfficiencyReport({
    stateHome: options.stateHome,
    rows: scopedRows,
    details,
    range,
    ...(query.app !== undefined ? { app: query.app } : {}),
    duplicateKeys: duplicate.keys,
  });
  const overallQuality = allTurns.length === 0 ? "unavailable" : worstQuality(allTurns.map((turn) => turn.usage_quality));
  const notices = qualityNotices(allTurns, ledger.diagnostics.length, details.missingEnvelopes.length, details.unsettled.length, duplicate.rows, range.open_interval);
  if (details.scanLimited) notices.push("Envelope-only activity scan reached its 20,000-run safety bound.");
  // The canonical aggregate. Every other surface projects this same object from
  // the same settled rows, so "unavailable" in one place and $104.66 in another
  // for identical scope is now a test failure rather than a campaign finding
  // (#89). Mechanical passes never reach `allTurns` (they carry no settlement),
  // so they are counted from the envelope side.
  const cost = aggregateCost(
    allTurns.map((turn) => ({
      costUsd: turn.cost_usd,
      quality: turn.usage_quality,
      ref: turn.provider_turn_id ?? turn.run_id ?? turn.id,
    })),
  );
  const headline = {
    cost,
    cost_scope: {
      settled_provider_turns: allTurns.length,
      unsettled_provider_turns: details.unsettled.filter(
        ({ envelope }) => classifyEnvelopeUsage(envelope) !== "none",
      ).length,
    },
    known_input_tokens: sumTurns(observable, "tokens_in"),
    known_output_tokens: sumTurns(observable, "tokens_out"),
    known_total_tokens: sumTurns(observable, "tokens_in") + sumTurns(observable, "tokens_out"),
    cache_read_tokens: observable.reduce((sum, turn) => sum + (turn.cache_read_tokens ?? 0), 0),
    cache_creation_tokens: observable.reduce((sum, turn) => sum + (turn.cache_creation_tokens ?? 0), 0),
    provider_reported_cost_usd: sumCost(reported),
    operon_estimated_cost_usd: sumCost(estimated),
    partial_recorded_cost_usd: sumCost(partial),
    recorded_equivalent_cost_usd: sumCost(costKnown),
    unknown_cost_turns: allTurns.filter((turn) => turn.cost_usd === null).length,
    provider_turns: allTurns.length,
    unknown_usage_turns: allTurns.filter((turn) => turn.tokens_in === null || turn.tokens_out === null).length,
    sessions: sessions.length,
    completed_sessions: sessions.filter((session) => session.summary.outcome === "completed").length,
    completion_integrity_sessions: sessions.filter((session) => session.summary.completion_integrity !== "unknown").length,
  };
  const budgetRows = await rollupBudgets(options.stateHome, options.appsFile, now);
  const allDetails = query.summaryOnly === true ? [] : sessions;
  const sourceFingerprint = createHash("sha256")
    .update(ledger.fingerprint)
    .update(JSON.stringify(detailsFingerprint(details)))
    .update(JSON.stringify(efficiency))
    .digest("hex");
  return {
    schema_version: REPORT_SCHEMA_VERSION,
    generated_at: now.toISOString(),
    summary_only: query.summaryOnly === true,
    source_fingerprint: sourceFingerprint,
    org: { name: options.orgName, state_home_id: basename(options.stateHome) },
    scope: { kind: query.app === undefined ? "org" : "app", app: query.app ?? null },
    range,
    quality: {
      overall: overallQuality,
      observable_turns: observable.length,
      unknown_usage_turns: headline.unknown_usage_turns,
      estimated_cost_turns: allTurns.filter((turn) => turn.cost_estimated).length,
      partial_usage_turns: allTurns.filter((turn) => turn.usage_quality === "partial").length,
      unmeasured_turns: scopedRows.filter(({ record }) => record.unmeasured === true).length,
      legacy_turns: scopedRows.filter(({ record }) => record.runId === undefined || record.usageQuality === undefined).length,
      unattributed_turns: unattributedSettled.length,
      duplicate_rows: duplicate.rows,
      duplicate_keys: duplicate.keys,
      duplicate_known_tokens: duplicate.tokens,
      duplicate_recorded_cost_usd: duplicate.cost,
      corrupt_lines: ledger.diagnostics.filter((item) => item.kind === "corrupt_line" || item.kind === "invalid_row" || item.kind === "invalid_timestamp").length,
      torn_tails: ledger.diagnostics.filter((item) => item.kind === "torn_tail").length,
      unreadable_days: ledger.diagnostics.filter((item) => item.kind === "unreadable_day").map((item) => item.day),
      concurrent_write_days: ledger.diagnostics.filter((item) => item.kind === "concurrent_write").map((item) => item.day),
      future_timestamp_rows: ledger.diagnostics.filter((item) => item.kind === "future_timestamp").length,
      missing_envelopes: details.missingEnvelopes.length + details.corruptEnvelopes.length,
      unsettled_passes: details.unsettled.length,
      terminal_unsettled_usage_passes: details.unsettled.filter(({ envelope }) => envelope.status !== "running" && envelope.usage !== undefined).length,
      retained_from: ledger.retainedFrom,
      retained_to: ledger.retainedTo,
      diagnostics: ledger.diagnostics,
      notices,
    },
    headline,
    trend: buildTrend(allTurns, range, ledger.diagnostics.filter((item) => item.kind === "unreadable_day").map((item) => item.day)),
    breakdowns: {
      by_app: breakdown(allTurns, sessions, (turn) => turn.app ?? "(unattributed)"),
      by_role: breakdown(allTurns, sessions, (turn) => turn.role || "(unknown role)"),
      by_runtime_model: breakdown(allTurns, sessions, (turn) => `${turn.runtime ?? "unknown"} / ${turn.model ?? "unknown"}`),
      by_pipeline_pass: breakdown(allTurns, sessions, (turn) => `${turn.pipeline ?? "unknown"} / ${turn.pass ?? "unknown"}`),
      by_trigger: breakdown(allTurns, sessions, (turn) => turn.trigger ?? "(not recorded)"),
      by_status: breakdown(allTurns, sessions, (turn) => turn.status),
      by_usage_quality: breakdown(allTurns, sessions, (turn) => turn.usage_quality),
    },
    health: buildHealth(sessions),
    efficiency,
    apps: buildAppRows(options.appsFile, budgetRows, sessions, allTurns, headline.known_total_tokens, query.app),
    sessions: {
      total: sessions.length,
      returned: sessions.length,
      next_cursor: null,
      items: sessions.map((session) => session.summary),
    },
    session_details: allDetails,
    unattributed_turns: query.summaryOnly === true ? [] : grouped.unattributed,
  };
}

function buildTrend(turns: ReportTurnV1[], range: ReportSnapshotV1["range"], unreadableDays: string[]): ReportBucketV1[] {
  const out: ReportBucketV1[] = [];
  let cursor = bucketStart(new Date(range.from_inclusive), range.bucket);
  const end = new Date(range.to_exclusive);
  while (cursor < end) {
    const next = nextBucket(cursor, range.bucket);
    const from = Math.max(cursor.getTime(), new Date(range.from_inclusive).getTime());
    const to = Math.min(next.getTime(), end.getTime());
    const selected = turns.filter((turn) => turn.settled_at !== null && new Date(turn.settled_at).getTime() >= from && new Date(turn.settled_at).getTime() < to);
    const gap = unreadableDays.some((day) => {
      const stamp = new Date(`${day}T00:00:00.000Z`).getTime();
      return stamp >= from && stamp < to;
    });
    const observable = selected.filter((turn) => turn.tokens_in !== null && turn.tokens_out !== null);
    out.push({
      start: new Date(from).toISOString(),
      end: new Date(to).toISOString(),
      source_quality: gap ? "gap" : "readable",
      known_input_tokens: gap && selected.length === 0 ? null : sumTurns(observable, "tokens_in"),
      known_output_tokens: gap && selected.length === 0 ? null : sumTurns(observable, "tokens_out"),
      provider_reported_cost_usd: gap && selected.length === 0 ? null : sumCost(selected.filter((turn) => turn.cost_usd !== null && !turn.cost_estimated && turn.usage_quality !== "partial")),
      operon_estimated_cost_usd: gap && selected.length === 0 ? null : sumCost(selected.filter((turn) => turn.cost_usd !== null && turn.cost_estimated && turn.usage_quality !== "partial")),
      partial_recorded_cost_usd: gap && selected.length === 0 ? null : sumCost(selected.filter((turn) => turn.cost_usd !== null && turn.usage_quality === "partial")),
      provider_turns: selected.length,
      unknown_usage_turns: selected.filter((turn) => turn.tokens_in === null || turn.tokens_out === null).length,
    });
    cursor = next;
  }
  return out;
}

function breakdown(turns: ReportTurnV1[], sessions: ReportSessionDetailV1[], keyOf: (turn: ReportTurnV1) => string): ReportBreakdownV1[] {
  const groups = new Map<string, ReportTurnV1[]>();
  const sessionByTurn = new Map(sessions.flatMap((session) => session.activities.map((turn) => [turn.id, session.summary.id] as const)));
  for (const turn of turns) {
    const key = keyOf(turn);
    groups.set(key, [...(groups.get(key) ?? []), turn]);
  }
  const denominator = turns.reduce((sum, turn) => sum + (turn.tokens_in ?? 0) + (turn.tokens_out ?? 0), 0);
  return [...groups.entries()].map(([key, values]) => {
    const knownInput = sumTurns(values.filter((turn) => turn.tokens_in !== null), "tokens_in");
    const knownOutput = sumTurns(values.filter((turn) => turn.tokens_out !== null), "tokens_out");
    const sessionCount = new Set(values.map((turn) => sessionByTurn.get(turn.id)).filter((value): value is string => value !== undefined)).size;
    return {
      key,
      label: key,
      known_input_tokens: knownInput,
      known_output_tokens: knownOutput,
      known_total_tokens: knownInput + knownOutput,
      recorded_equivalent_cost_usd: sumCost(values.filter((turn) => turn.cost_usd !== null)),
      provider_reported_cost_usd: sumCost(values.filter((turn) => turn.cost_usd !== null && !turn.cost_estimated && turn.usage_quality !== "partial")),
      operon_estimated_cost_usd: sumCost(values.filter((turn) => turn.cost_usd !== null && turn.cost_estimated && turn.usage_quality !== "partial")),
      partial_recorded_cost_usd: sumCost(values.filter((turn) => turn.cost_usd !== null && turn.usage_quality === "partial")),
      turns: values.length,
      sessions: sessionCount,
      unknown_usage_turns: values.filter((turn) => turn.tokens_in === null || turn.tokens_out === null).length,
      known_token_share: share(knownInput + knownOutput, denominator),
    };
  }).sort((a, b) => b.recorded_equivalent_cost_usd - a.recorded_equivalent_cost_usd || b.known_total_tokens - a.known_total_tokens || a.key.localeCompare(b.key));
}

function buildHealth(sessions: ReportSessionDetailV1[]): ReportSnapshotV1["health"] {
  const activities = sessions.flatMap((session) => session.activities);
  const provider = activities.filter((turn) => turn.activity_type === "provider_turn" && turn.settled_at !== null);
  const wall = provider.map((turn) => turn.wall_clock_ms).filter((value): value is number => value !== null);
  const costs = provider.map((turn) => turn.cost_usd).filter((value): value is number => value !== null && Number.isFinite(value));
  const completedCosts = sessions.filter((session) => session.summary.completion_integrity === "complete" && session.summary.usage_quality !== "unavailable").map((session) => session.summary.recorded_equivalent_cost_usd);
  return {
    session_outcomes: deterministicCounts(sessions.map((session) => session.summary.outcome)).map(({ status, count }) => ({ status, sessions: count })),
    pass_outcomes: deterministicCounts(activities.map((turn) => turn.status)).map(({ status, count }) => ({ status, passes: count })),
    completion_integrity: deterministicCounts(sessions.map((session) => session.summary.completion_integrity)).map(({ status, count }) => ({ status: status as "complete" | "incomplete" | "unknown", sessions: count })),
    provider_turn_wall_ms: { median: nearestRank(wall, 0.5), p90: nearestRank(wall, 0.9), n: wall.length },
    provider_turn_cost_usd: { median: nearestRank(costs, 0.5), p90: nearestRank(costs, 0.9), n: costs.length },
    completed_session_cost_usd: { median: nearestRank(completedCosts, 0.5), p90: nearestRank(completedCosts, 0.9), n: completedCosts.length },
    gate_passes: activities.reduce((sum, turn) => sum + (turn.gate_passes ?? 0), 0),
    gate_failures: activities.reduce((sum, turn) => sum + (turn.gate_failures ?? 0), 0),
    escalations: activities.reduce((sum, turn) => sum + turn.escalations, 0),
    interrupted_turns: provider.filter((turn) => ["failed", "cancelled", "timed_out"].includes(turn.status)).length,
    fallback_sessions: sessions.filter((session) => session.summary.execution_mode === "mixed" || session.summary.execution_mode === "manual").length,
  };
}

function buildAppRows(appsFile: AppsFile, budgets: Awaited<ReturnType<typeof rollupBudgets>>, sessions: ReportSessionDetailV1[], turns: ReportTurnV1[], denominator: number, appScope?: string): ReportAppRowV1[] {
  return appsFile.apps.filter((app) => appScope === undefined || app.name === appScope).map((app) => {
    const appTurns = turns.filter((turn) => turn.app === app.name);
    const appSessions = sessions.filter((session) => session.summary.apps.includes(app.name));
    const observable = appTurns.filter((turn) => turn.tokens_in !== null && turn.tokens_out !== null);
    const budget = budgets.find((row) => row.app === app.name)!;
    const knownTokens = observable.reduce((sum, turn) => sum + turn.tokens_in! + turn.tokens_out!, 0);
    return {
      app: app.name,
      repo: app.repo,
      lifecycle: app.status,
      known_tokens: knownTokens,
      recorded_equivalent_cost_usd: sumCost(appTurns.filter((turn) => turn.cost_usd !== null)),
      provider_turns: appTurns.length,
      sessions: appSessions.length,
      completed_sessions: appSessions.filter((session) => session.summary.outcome === "completed").length,
      failed_sessions: appSessions.filter((session) => ["failed", "timed_out", "cancelled"].includes(session.summary.outcome)).length,
      current_month_spend_usd: budget.spentUsd,
      monthly_budget_usd: budget.budgetUsd,
      budget_percent: budget.percent,
      // An unverifiable total (`unknown`, a malformed ledger row — A-004) is an
      // over-cap, fail-closed state; the report projects it as `exceeded` so its
      // public schema stays stable while never reading as `ok`.
      budget_status: budget.status === "unknown" ? "exceeded" : budget.status,
      usage_coverage: share(observable.length, appTurns.length),
      completion_coverage: share(appSessions.filter((session) => session.summary.completion_integrity !== "unknown").length, appSessions.length),
      most_recent_activity: appTurns.map((turn) => turn.settled_at).filter((value): value is string => value !== null).sort().at(-1) ?? null,
      known_token_share: share(knownTokens, denominator),
    };
  });
}

function duplicateFacts(rows: LedgerRowSource[]): { rows: number; keys: string[]; tokens: number; cost: number } {
  const seen = new Set<string>();
  const keys = new Set<string>();
  let duplicates = 0;
  let tokens = 0;
  let cost = 0;
  for (const { record } of rows) {
    const identity = settlementIdentity(record);
    if (identity === undefined) continue;
    const key = settlementKey(record.app, identity);
    if (!seen.has(key)) { seen.add(key); continue; }
    duplicates += 1;
    keys.add(`${record.app ?? "(unattributed)"}/${identity}`);
    if (record.unmeasured !== true && normalizedQuality(record.usageQuality) !== "unavailable") tokens += record.tokensIn + record.tokensOut;
    cost += record.costUsd;
  }
  return { rows: duplicates, keys: [...keys].sort(), tokens, cost };
}

function qualityNotices(turns: ReportTurnV1[], diagnostics: number, missing: number, unsettled: number, duplicates: number, open: boolean): string[] {
  const notices: string[] = [];
  if (turns.some((turn) => turn.usage_quality === "unavailable")) notices.push("Known token and cost totals exclude turns whose usage was unavailable or unmeasured.");
  if (turns.some((turn) => turn.usage_quality === "partial")) notices.push("Partial usage is a recorded lower bound and is split from complete/estimated cost.");
  if (turns.some((turn) => turn.cost_estimated)) notices.push("Operon-estimated equivalent cost is not a provider invoice.");
  if (diagnostics > 0) notices.push("One or more ledger source records was corrupt, torn, unreadable, concurrent, invalid, or future-dated.");
  if (missing > 0) notices.push("Some settled rows have no readable run envelope; accounting remains available but execution detail was retained incompletely.");
  if (unsettled > 0) notices.push("Envelope-only activity is shown outside authoritative ledger totals.");
  if (duplicates > 0) notices.push("Duplicate settlement keys remain included exactly as recorded so report totals agree with ledger consumers.");
  if (open) notices.push("The selected interval includes the current UTC day and may still change.");
  return notices;
}

function detailsFingerprint(details: Awaited<ReturnType<typeof readReportDetails>>): unknown {
  return {
    envelopes: [...details.envelopes].map(([key, value]) => [key, value.envelope]),
    missing: details.missingEnvelopes,
    corrupt: details.corruptEnvelopes,
    tasks: [...details.tasks].map(([key, value]) => [key, value]),
    unsettled: details.unsettled.map(({ envelope }) => envelope),
  };
}

function sumTurns(turns: ReportTurnV1[], key: "tokens_in" | "tokens_out"): number { return turns.reduce((sum, turn) => sum + (turn[key] ?? 0), 0); }
function sumCost(turns: ReportTurnV1[]): number { return turns.reduce((sum, turn) => sum + (turn.cost_usd ?? 0), 0); }
