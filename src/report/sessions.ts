import { scrubSecrets, truncatePreview } from "../runtime/runlog/redact.js";
import { settlementKey } from "../runtime/telemetry.js";
import { aggregateCost, normalizeUsageQuality, worstUsageQuality } from "../runtime/cost.js";
import { classifyEnvelopeUsage } from "../runtime/runlog/envelope.js";
import type { LedgerRowSource } from "./ledger-source.js";
import type { ReportDetailFacts } from "./detail-source.js";
import type {
  CompletionIntegrity,
  ReportSessionDetailV1,
  ReportSessionSummaryV1,
  ReportTurnV1,
  ReportUsageQuality,
  SourceRefView,
} from "./types.js";

export interface GroupedSessions {
  sessions: ReportSessionDetailV1[];
  unattributed: ReportTurnV1[];
}

export function groupReportSessions(
  rows: readonly LedgerRowSource[],
  details: ReportDetailFacts,
  appScope?: string,
): GroupedSessions {
  const groups = new Map<string, ReportTurnV1[]>();
  const unattributed: ReportTurnV1[] = [];
  for (const source of rows) {
    const turn = ledgerTurn(source, details);
    const id = groupingId(turn);
    if (id === null) unattributed.push(turn);
    else groups.set(id, [...(groups.get(id) ?? []), turn]);
  }
  for (const item of details.unsettled) {
    const turn = envelopeTurn(item.envelope, item.events);
    const id = groupingId(turn);
    if (id === null) unattributed.push(turn);
    else groups.set(id, [...(groups.get(id) ?? []), turn]);
  }
  const sessions = [...groups.entries()].map(([id, activities]) => {
    const ordered = [...activities].sort(activityOrder);
    return { summary: summarize(id, ordered, details, appScope), activities: ordered };
  }).sort((a, b) => (b.summary.ended_at ?? b.summary.started_at ?? "").localeCompare(a.summary.ended_at ?? a.summary.started_at ?? "") || a.summary.id.localeCompare(b.summary.id));
  unattributed.sort(activityOrder);
  return { sessions, unattributed };
}

function ledgerTurn(source: LedgerRowSource, details: ReportDetailFacts): ReportTurnV1 {
  const row = source.record;
  const joined = row.app !== undefined && row.runId !== undefined ? details.envelopes.get(settlementKey(row.app, row.runId)) : undefined;
  const envelope = joined?.envelope;
  const unavailable = row.unmeasured === true || normalizedQuality(row.usageQuality) === "unavailable";
  const warnings: string[] = [];
  if (row.runId === undefined || row.app === undefined) warnings.push("legacy correlation missing");
  if (row.app !== undefined && row.runId !== undefined && envelope === undefined) warnings.push("execution detail expired by retention or is unreadable");
  if (unavailable) warnings.push("usage unavailable; stored zero placeholders are not known zero");
  const ownsPassEvidence =
    envelope?.provider_turn_ids === undefined ||
    row.providerTurnId === undefined ||
    envelope.provider_turn_ids[0] === row.providerTurnId;
  if (!ownsPassEvidence) warnings.push("pass-level tool and gate evidence is attached to the first provider turn only");
  const refs = envelopeRefs(envelope);
  const gates = envelope?.gate_results ?? [];
  return {
    id: `ledger:${source.day}:${source.line}`,
    source: { day: source.day, line: source.line },
    activity_type: "provider_turn",
    app: row.app ?? null,
    run_id: row.runId ?? null,
    provider_turn_id: row.providerTurnId ?? null,
    execution_step_id: row.executionStepId ?? null,
    episode_id: row.episodeId ?? envelope?.episode_id ?? null,
    trace_id: row.traceId ?? envelope?.trace_id ?? null,
    parent_task_id: row.parentTaskId ?? envelope?.parent_task_id ?? null,
    ticket: envelope?.ticket ?? null,
    role: row.role,
    runtime: row.runtime,
    model: row.model,
    effort: envelope?.effort ?? null,
    pipeline: row.pipeline ?? envelope?.pipeline ?? null,
    pass: row.pass ?? envelope?.pass ?? null,
    trigger: row.trigger ?? null,
    started_at: envelope?.started_at ?? null,
    settled_at: row.at,
    finished_at: envelope?.finished_at ?? null,
    wall_clock_ms: finiteOrNull(row.wallClockMs),
    status: row.status,
    usage_quality: unavailable ? "unavailable" : normalizedQuality(row.usageQuality),
    tokens_in: unavailable ? null : row.tokensIn,
    tokens_out: unavailable ? null : row.tokensOut,
    tokens_in_uncached: unavailable ? null : row.tokensInUncached ?? null,
    cache_read_tokens: unavailable ? null : row.cacheReadTokens ?? null,
    cache_creation_tokens: unavailable ? null : row.cacheCreationTokens ?? null,
    cost_usd: unavailable ? null : row.costUsd,
    cost_estimated: row.costEstimated === true || row.usageQuality === "estimated",
    subagent_turns: row.subagentTurns,
    tool_calls: ownsPassEvidence ? joined?.events?.toolCalls ?? (envelope === undefined ? null : Object.values(envelope.tool_counts ?? {}).reduce((a, b) => a + b, 0)) : null,
    escalations: ownsPassEvidence ? Math.max(row.escalations, joined?.events?.escalations ?? 0) : row.escalations,
    gate_passes: envelope === undefined || !ownsPassEvidence ? null : gates.filter((gate) => gate.status === "passed").length,
    gate_failures: envelope === undefined || !ownsPassEvidence ? null : gates.filter((gate) => gate.status === "failed").length,
    refs,
    native_session_ref: envelope?.session?.native_ref ?? null,
    envelope_available: envelope !== undefined,
    events_available: joined?.events !== null && joined?.events !== undefined,
    warnings,
  };
}

function envelopeTurn(envelope: ReportDetailFacts["unsettled"][number]["envelope"], events: ReportDetailFacts["unsettled"][number]["events"]): ReportTurnV1 {
  const usage = envelope.usage;
  // These envelopes have no ledger settlement by construction (they are the
  // `unsettled` set), so classifyEnvelopeUsage can decide `none` structurally.
  // This replaces a role/pipeline/pass substring match on "gate" that missed
  // provision/setup entirely — 14 of the 26 falsely-unknown passes in the
  // buildstacks-site campaign (#88).
  const quality = classifyEnvelopeUsage(envelope);
  const isMechanical = quality === "none";
  const gates = envelope.gate_results ?? [];
  const warnings = isMechanical
    ? ["no provider was invoked; cost is an authoritative zero"]
    : ["no matching ledger settlement; excluded from authoritative accounting totals"];
  if (!isMechanical && usage !== undefined && envelope.status !== "running") warnings.push("terminal envelope has recorded usage; explicit operon budget --reconcile may recover it");
  return {
    id: `envelope:${envelope.app}:${envelope.run_id}`,
    source: { day: null, line: null },
    activity_type: isMechanical ? "mechanical_pass" : "provider_turn",
    app: envelope.app,
    run_id: envelope.run_id,
    provider_turn_id: null,
    execution_step_id: envelope.execution_step_ids?.[0] ?? null,
    episode_id: envelope.episode_id ?? null,
    trace_id: envelope.trace_id,
    parent_task_id: envelope.parent_task_id ?? null,
    ticket: envelope.ticket ?? null,
    role: envelope.role,
    runtime: envelope.runtime ?? null,
    model: envelope.model ?? null,
    effort: envelope.effort ?? null,
    pipeline: envelope.pipeline,
    pass: envelope.pass,
    trigger: null,
    started_at: envelope.started_at,
    settled_at: null,
    finished_at: envelope.finished_at ?? null,
    wall_clock_ms: envelope.wall_clock_ms ?? null,
    status: envelope.status,
    usage_quality: normalizedQuality(quality),
    // A mechanical pass consumed no tokens and cost nothing, and that is known
    // rather than missing — so it reports 0, not null, even on a legacy
    // envelope that predates the explicit `none` usage record (#88).
    tokens_in: isMechanical ? usage?.tokens_in ?? 0 : quality === "unavailable" || usage === undefined ? null : usage.tokens_in,
    tokens_out: isMechanical ? usage?.tokens_out ?? 0 : quality === "unavailable" || usage === undefined ? null : usage.tokens_out,
    tokens_in_uncached: null,
    cache_read_tokens: usage?.cache_read_tokens ?? null,
    cache_creation_tokens: usage?.cache_write_tokens ?? null,
    cost_usd: isMechanical ? usage?.cost_usd ?? 0 : quality === "unavailable" || usage === undefined ? null : usage.cost_usd,
    cost_estimated: usage?.cost_estimated === true,
    subagent_turns: usage?.subagent_turns ?? 0,
    tool_calls: events?.toolCalls ?? (Object.values(envelope.tool_counts ?? {}).reduce((a, b) => a + b, 0)),
    escalations: events?.escalations ?? 0,
    gate_passes: gates.filter((gate) => gate.status === "passed").length,
    gate_failures: gates.filter((gate) => gate.status === "failed").length,
    refs: envelopeRefs(envelope),
    native_session_ref: envelope.session?.native_ref ?? null,
    envelope_available: true,
    events_available: events !== null,
    warnings,
  };
}

function groupingId(turn: ReportTurnV1): string | null {
  if (turn.app === null || turn.run_id === null) return null;
  if (turn.parent_task_id !== null) return `task:${turn.parent_task_id}`;
  if (turn.trace_id !== null && turn.trace_id.length > 0 && turn.trace_id !== "?") return `trace:${turn.app}:${turn.trace_id}`;
  return `run:${turn.app}:${turn.run_id}`;
}

function summarize(id: string, activities: ReportTurnV1[], details: ReportDetailFacts, appScope?: string): ReportSessionSummaryV1 {
  const taskId = id.startsWith("task:") ? id.slice(5) : undefined;
  const task = taskId === undefined ? undefined : details.tasks.get(taskId);
  const apps = [...new Set(activities.map((activity) => activity.app).filter((value): value is string => value !== null))].sort();
  const refs = uniqueRefs([...(task === undefined ? [] : taskRefs(task)), ...activities.flatMap((activity) => activity.refs)]);
  const provider = activities.filter((activity) => activity.activity_type === "provider_turn");
  const settledProvider = provider.filter((activity) => activity.settled_at !== null);
  const observable = settledProvider.filter((activity) => activity.tokens_in !== null && activity.tokens_out !== null);
  // Known cost survives an unobservable turn; the unknown component is counted
  // and referenced rather than summed in as zero (#90).
  const cost = aggregateCost(
    settledProvider.map((activity) => ({
      costUsd: activity.cost_usd,
      quality: activity.usage_quality,
      ref: activity.provider_turn_id ?? activity.run_id ?? activity.id,
    })),
  );
  const outcome = task?.status ?? sessionOutcome(activities);
  const completion = task === undefined ? traceCompletion(activities) : taskCompletion(task);
  const warnings = [...new Set(activities.flatMap((activity) => activity.warnings))];
  const scopePartial = appScope !== undefined && (task?.app !== undefined && task.app !== appScope || task !== undefined && task.refs.traces.length > 0 && apps.length === 1);
  if (scopePartial) warnings.push("app-scoped slice of a broader parent task");
  return {
    id,
    kind: id.startsWith("task:") ? "parent_task" : id.startsWith("trace:") ? "standalone_trace" : "orphan_run",
    label: task === undefined ? id : `${task.taskId} · ${truncatePreview(scrubSecrets(task.objective), 120)}`,
    objective_preview: task === undefined ? null : truncatePreview(scrubSecrets(task.objective), 320),
    apps,
    scope_partial: scopePartial,
    started_at: earliest(activities.map((activity) => activity.started_at ?? activity.settled_at)),
    ended_at: task?.endedAt ?? latest(activities.map((activity) => activity.finished_at ?? activity.settled_at)),
    outcome,
    completion_integrity: completion,
    execution_mode: task === undefined ? "not_recorded" : task.executionMode === "external_manual" ? "manual" : task.executionMode,
    provider_turns: provider.length,
    mechanical_passes: activities.filter((activity) => activity.activity_type === "mechanical_pass").length,
    known_input_tokens: observable.reduce((sum, activity) => sum + activity.tokens_in!, 0),
    known_output_tokens: observable.reduce((sum, activity) => sum + activity.tokens_out!, 0),
    recorded_equivalent_cost_usd: cost.known_cost_usd,
    cost,
    usage_quality: cost.provider_turns === 0 ? "unavailable" : cost.usage_quality,
    refs,
    warnings: [...new Set(warnings)].sort(),
  };
}

function taskCompletion(task: NonNullable<ReportDetailFacts["tasks"] extends Map<string, infer T> ? T : never>): CompletionIntegrity {
  if (task.status !== "completed") return "incomplete";
  if (task.completionState === undefined) return "unknown";
  return task.completionState.implementation === "complete" && ["green", "unknown"].includes(task.completionState.ci) ? "complete" : "incomplete";
}

function traceCompletion(activities: ReportTurnV1[]): CompletionIntegrity {
  if (activities.some((activity) => ["running", "failed", "cancelled", "timed_out", "blocked", "blocked_on_gate"].includes(activity.status))) return "incomplete";
  return activities.length > 0 && activities.every((activity) => activity.status === "completed") ? "complete" : "unknown";
}

function sessionOutcome(activities: ReportTurnV1[]): string {
  for (const status of ["running", "failed", "timed_out", "cancelled", "blocked_on_gate", "blocked"]) if (activities.some((activity) => activity.status === status)) return status;
  return activities.every((activity) => activity.status === "completed") ? "completed" : "unknown";
}

function envelopeRefs(envelope: ReportDetailFacts["unsettled"][number]["envelope"] | undefined): SourceRefView[] {
  if (envelope === undefined) return [];
  const refs: SourceRefView[] = [
    { source: "run", ref: `runs/${envelope.app}/${envelope.run_id}/envelope.json` },
    ...(envelope.ticket === undefined ? [] : [{ source: "ticket", ref: envelope.ticket }]),
    ...(envelope.git_branch === undefined ? [] : [{ source: "branch", ref: envelope.git_branch }]),
    ...(envelope.artifacts ?? []).map((artifact) => ({ source: artifact.kind, ref: scrubSecrets(artifact.ref) })),
  ];
  return uniqueRefs(refs);
}

function taskRefs(task: NonNullable<ReportDetailFacts["tasks"] extends Map<string, infer T> ? T : never>): SourceRefView[] {
  return Object.entries(task.refs).flatMap(([source, refs]) => refs.map((ref) => ({ source, ref: scrubSecrets(ref) })));
}

function uniqueRefs(refs: SourceRefView[]): SourceRefView[] {
  const map = new Map(refs.map((ref) => [`${ref.source}\0${ref.ref}`, ref]));
  return [...map.values()].sort((a, b) => a.source.localeCompare(b.source) || a.ref.localeCompare(b.ref));
}

/** Delegates to the shared primitive so Report and Observe can never rank the
 *  same qualities differently (#89). */
export function normalizedQuality(value: string | undefined): ReportUsageQuality {
  return normalizeUsageQuality(value);
}

export function worstQuality(values: readonly ReportUsageQuality[]): ReportUsageQuality {
  return values.reduce<ReportUsageQuality>((worst, value) => worstUsageQuality(worst, value), "complete");
}

function earliest(values: Array<string | null>): string | null { return values.filter((v): v is string => v !== null).sort()[0] ?? null; }
function latest(values: Array<string | null>): string | null { return values.filter((v): v is string => v !== null).sort().at(-1) ?? null; }
function finiteOrNull(value: number): number | null { return Number.isFinite(value) ? value : null; }
function activityOrder(a: ReportTurnV1, b: ReportTurnV1): number { return (a.started_at ?? a.settled_at ?? "").localeCompare(b.started_at ?? b.settled_at ?? "") || a.id.localeCompare(b.id); }
