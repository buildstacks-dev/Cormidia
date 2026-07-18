import { basename } from "node:path";
import { parseDependsOn, selectReadyTickets, type SchedulableTicket } from "../loop/scheduling.js";
import type { ApprovalGrant, ApprovalItem } from "../org/approvals.js";
import { scrubSecrets, truncatePreview } from "../runtime/runlog/redact.js";
import type { StatusRow } from "../runtime/runlog/status.js";
import { settlementKey, settlementIdentity } from "../runtime/telemetry.js";
import { aggregateCost, normalizeUsageQuality, worstUsageQuality } from "../runtime/cost.js";
import {
  OBSERVE_SCHEMA_VERSION,
  type ActivityKind,
  type ActivityView,
  type ApprovalView,
  type ArtifactRefView,
  type AttentionItemView,
  type CompletionIntegrityView,
  type DeliveryState,
  type DeliveryTicketView,
  type EventView,
  type IndexedPass,
  type ObserveProjectionInput,
  type ObserveSnapshotV1,
  type ParentTaskView,
  type PassView,
  type PullRequestView,
  type TraceView,
  type UsageQuality,
} from "./types.js";

export const PASS_STALE_AFTER_MS = 3 * 60 * 1000;

const QUALITY_RANK: Record<UsageQuality, number> = {
  // `none` is the identity element: a known zero that can never drag an
  // aggregate down, and that loses to any genuine provider quality (#88).
  // Mirrors the shared table in src/runtime/cost.ts.
  none: -1,
  complete: 0,
  estimated: 1,
  partial: 2,
  unavailable: 3,
};

export function projectObserveSnapshot(input: ObserveProjectionInput): ObserveSnapshotV1 {
  const observedAt = input.now.toISOString();
  const ledger = aggregatePassSettlements(input.ledger);
  const passes = input.passes
    .map((indexed) => projectPass(
      indexed,
      ledger.get(settlementKey(indexed.row.app, indexed.row.runId)),
      input.locks.find((lock) => lock.app === indexed.row.app && lock.turnId === indexed.row.traceId),
      input.now,
    ))
    .filter((pass) => passMatches(pass, input.filters));
  const traces = projectTraces(passes, observedAt).filter((trace) => traceMatches(trace, input.filters));
  const parentTasks = projectParentTasks(input, passes, traces, observedAt).filter((task) =>
    input.filters.parent_task === undefined || task.task_id === input.filters.parent_task,
  );
  const approvals = input.approvals
    .map(({ item, grant }) => projectApproval(item, grant, input.now))
    .filter((approval) => input.filters.app === undefined || approval.app === input.filters.app);
  const github = input.github.filter((source) => input.filters.app === undefined || source.app === input.filters.app);
  const delivery = projectDelivery(github, passes, input.max_concurrent_turns, observedAt).filter((ticket) =>
    (input.filters.ticket === undefined || ticket.issue_number === input.filters.ticket) &&
    (input.filters.status === undefined || ticket.state === input.filters.status),
  );
  const apps = input.apps
    .filter((app) => input.filters.app === undefined || app.name === input.filters.app)
    .map((app) => {
      const rows = input.ledger.filter((row) => row.app === app.name && row.at.slice(0, 7) === observedAt.slice(0, 7));
      // Month-to-date spend from the settled ledger. An unobservable turn is
      // counted and referenced, never summed in as zero (#90).
      const cost = aggregateCost(
        rows.map((row) => ({
          costUsd: row.unmeasured === true ? null : row.costUsd,
          quality: row.unmeasured === true ? "unavailable" : row.usageQuality,
          ref: settlementIdentity(row) ?? "unattributed",
        })),
      );
      const channelGates: string[] = [];
      if ((app.channels?.support ?? []).length === 0) channelGates.push("Support disabled: no support channel configured");
      if ((app.channels?.marketing ?? []).length === 0) channelGates.push("Marketing disabled: no marketing channel configured");
      return {
        id: `app:${app.name}`,
        name: app.name,
        repo: app.repo,
        lifecycle: app.status,
        budget_usd_month: app.budgetUsdMonth,
        recorded_monthly_cost_usd: cost.known_cost_usd,
        cost,
        usage_quality: rows.length === 0 ? "unavailable" as const : cost.usage_quality,
        channels: {
          support: [...(app.channels?.support ?? [])],
          marketing: [...(app.channels?.marketing ?? [])],
        },
        channel_gates: channelGates,
        observed_at: observedAt,
        source_refs: [{ source: "org", ref: "apps.yaml" }],
      };
    });
  const intake = projectIntake(input, passes, observedAt).filter((activity) =>
    (input.filters.app === undefined || activity.app === input.filters.app) &&
    (input.filters.parent_task === undefined || activity.parent_task_id === input.filters.parent_task),
  );
  const invocations = input.invocations
    .filter((record) => input.filters.app === undefined || record.app === input.filters.app)
    .filter((record) => input.filters.parent_task === undefined || record.parentTaskId === input.filters.parent_task)
    .map((record, index) => ({
      id: `invocation:${record.at}:${record.kind}:${index}`,
      kind: record.kind,
      app: record.app ?? null,
      parent_task_id: record.parentTaskId ?? null,
      at: record.at,
      dry_run: record.dryRun === true,
      items_claimed: record.itemsClaimed ?? null,
      outcome: truncatePreview(scrubSecrets(record.outcome), 240),
      wall_clock_ms: record.wallClockMs,
    }));
  const attention = projectAttention(input, passes, delivery, approvals, observedAt);

  // The header total is projected from the settled ledger, filtered to exactly
  // the passes on screen — not re-derived from envelope usage. That divergence
  // is what let the same page show "unavailable" in the header and $104.66 in
  // App lifecycle for one completed campaign (#89).
  const visibleRuns = new Set(passes.map((pass) => settlementKey(pass.app, pass.run_id)));
  const scopedLedger = input.ledger.filter(
    (row) => row.runId !== undefined && visibleRuns.has(settlementKey(row.app, row.runId)),
  );
  const cost = aggregateCost(
    scopedLedger.map((row) => ({
      costUsd: row.unmeasured === true ? null : row.costUsd,
      quality: row.unmeasured === true ? "unavailable" : row.usageQuality,
      ref: settlementIdentity(row) ?? "unattributed",
    })),
  );
  const settledRuns = new Set(
    scopedLedger.map((row) => settlementKey(row.app, row.runId!)),
  );
  // Mechanical passes are not provider turns, so they belong to neither side of
  // settlement coverage (#88).
  const providerPasses = passes.filter((pass) => pass.usage.quality !== "none");
  const costScope = {
    settled_provider_turns: cost.provider_turns,
    unsettled_provider_turns: providerPasses.filter(
      (pass) => !settledRuns.has(settlementKey(pass.app, pass.run_id)),
    ).length,
  };
  const quality = aggregateQuality(providerPasses.map((pass) => pass.usage.quality));

  return {
    schema_version: OBSERVE_SCHEMA_VERSION,
    generated_at: observedAt,
    cursor: input.cursor,
    filters: input.filters,
    org: {
      name: input.org_name,
      state_home_id: basename(input.state_home),
      max_concurrent_turns: input.max_concurrent_turns,
      active_passes: passes.filter((pass) => pass.status === "running").length,
      read_only: true,
    },
    sources: input.source_health,
    apps,
    intake,
    delivery,
    parent_tasks: parentTasks,
    traces,
    passes,
    approvals,
    invocations,
    totals: {
      active_passes: passes.filter((pass) => pass.status === "running").length,
      pending_approvals: approvals.filter((approval) => approval.status === "pending").length,
      delivery_ready: delivery.filter((ticket) => ticket.state === "ready").length,
      recorded_cost_usd: cost.known_cost_usd,
      cost,
      cost_scope: costScope,
      usage_quality: providerPasses.length === 0 ? "unavailable" : quality,
      // Only genuine provider turns can have incomplete usage. A mechanical
      // pass invoked no provider, so it is never counted here (#88).
      incomplete_usage_passes: providerPasses.filter((pass) => pass.usage.quality !== "complete").length,
    },
    attention,
  };
}

/** Observe remains pass-oriented, so multiple provider-turn settlements under
 * one parent run are aggregated for its pass card without changing ledger
 * identity or hiding the provider-turn rows from Reports. */
function aggregatePassSettlements(rows: ObserveProjectionInput["ledger"]): Map<string, ObserveProjectionInput["ledger"][number]> {
  const grouped = new Map<string, ObserveProjectionInput["ledger"][number]>();
  for (const row of rows) {
    if (row.runId === undefined) continue;
    const key = settlementKey(row.app, row.runId);
    const existing = grouped.get(key);
    if (existing === undefined) {
      grouped.set(key, { ...row });
      continue;
    }
    grouped.set(key, {
      ...existing,
      at: existing.at > row.at ? existing.at : row.at,
      status: row.status,
      tokensIn: existing.tokensIn + row.tokensIn,
      tokensOut: existing.tokensOut + row.tokensOut,
      costUsd: existing.costUsd + row.costUsd,
      usageQuality: worseUsageQuality(existing.usageQuality, row.usageQuality),
      subagentTurns: existing.subagentTurns + row.subagentTurns,
      wallClockMs: existing.wallClockMs + row.wallClockMs,
      escalations: existing.escalations + row.escalations,
      ...(existing.tokensInUncached !== undefined || row.tokensInUncached !== undefined
        ? { tokensInUncached: (existing.tokensInUncached ?? 0) + (row.tokensInUncached ?? 0) }
        : {}),
      ...(existing.cacheCreationTokens !== undefined || row.cacheCreationTokens !== undefined
        ? { cacheCreationTokens: (existing.cacheCreationTokens ?? 0) + (row.cacheCreationTokens ?? 0) }
        : {}),
      ...(existing.cacheReadTokens !== undefined || row.cacheReadTokens !== undefined
        ? { cacheReadTokens: (existing.cacheReadTokens ?? 0) + (row.cacheReadTokens ?? 0) }
        : {}),
      ...(existing.costEstimated === true || row.costEstimated === true ? { costEstimated: true } : {}),
      ...(existing.unmeasured === true || row.unmeasured === true ? { unmeasured: true } : {}),
    });
  }
  return grouped;
}

function worseUsageQuality(left: string | undefined, right: string | undefined): UsageQuality {
  return worstUsageQuality(left, right);
}

function projectPass(
  indexed: IndexedPass,
  settled: ObserveProjectionInput["ledger"][number] | undefined,
  lock: ObserveProjectionInput["locks"][number] | undefined,
  now: Date,
): PassView {
  const row = indexed.row;
  const status = row.status;
  const liveness = passLiveness(row, now);
  const usageQuality = settled !== undefined
    ? normalizeQuality(settled.usageQuality)
    : normalizeQuality(row.usageQuality);
  const events: EventView[] = indexed.events.map((event, index) => ({
    id: `${row.app}:${row.runId}:event:${index}`,
    ts: event.ts,
    event: event.event,
    severity: event.severity,
    span_id: event.span_id,
    parent_span_id: event.parent_span_id ?? null,
    error_code: event.error_code ?? null,
    detail: scrubEventDetail(event.detail ?? {}),
  }));
  const refs = artifactRefs(indexed);
  const resultRefs = (row.artifacts ?? []).map((artifact) => ({ source: artifact.kind, ref: artifact.ref }));
  return {
    id: passId(row.app, row.runId),
    app: row.app,
    run_id: row.runId,
    trace_id: row.traceId,
    parent_task_id: row.parentTaskId ?? null,
    ticket: row.ticket ?? null,
    pipeline: row.pipeline,
    pass: row.pass,
    role: row.role,
    runtime: row.runtime ?? null,
    model: row.model ?? null,
    effort: row.effort ?? null,
    status,
    liveness: liveness.state,
    liveness_reason: liveness.reason,
    started_at: row.startedAt,
    finished_at: indexed.envelope_finished_at ?? null,
    last_heartbeat_at: row.lastSeenAt ?? null,
    wall_clock_ms: status === "running" ? null : row.durationMs,
    workdir: row.workdir ?? null,
    git_branch: row.gitBranch ?? null,
    git_head: row.gitHead ?? null,
    usage: {
      tokens_in: settled?.tokensIn ?? (row.usageQuality === "unavailable" ? null : row.tokensIn),
      tokens_out: settled?.tokensOut ?? (row.usageQuality === "unavailable" ? null : row.tokensOut),
      cache_read_tokens: settled?.cacheReadTokens ?? row.cacheReadTokens ?? null,
      cache_write_tokens: settled?.cacheCreationTokens ?? null,
      cost_usd: settled?.costUsd ?? (row.usageQuality === "unavailable" ? null : row.costUsd),
      cost_estimated: settled?.costEstimated === true || row.costEstimated,
      quality: usageQuality,
      settled: settled !== undefined,
    },
    previews: Object.fromEntries(Object.entries(row.previews ?? {}).map(([key, value]) => [key, truncatePreview(scrubSecrets(value), 240)])),
    verdict_summary: row.verdictSummary !== undefined ? truncatePreview(scrubSecrets(row.verdictSummary), 240) : null,
    terminal_reason: row.terminalReason !== undefined ? truncatePreview(scrubSecrets(row.terminalReason), 240) : null,
    gates: (row.gateResults ?? []).map((gate) => ({
      gate: scrubSecrets(gate.gate),
      status: gate.status,
      detail: gate.detail !== undefined ? truncatePreview(scrubSecrets(gate.detail), 400) : null,
    })),
    events,
    tool_calls: events.filter((event) => event.event === "tool.called").length,
    subagents: events.filter((event) => event.event === "subagent.started").length,
    escalations: events.filter((event) => event.event === "escalation.raised").length,
    artifacts: refs,
    result_refs: resultRefs,
    session: row.session === undefined ? null : {
      id: row.session.id ?? null,
      native_ref: row.session.native_ref ?? null,
      transcript: row.session.transcript,
      transcript_note: scrubSecrets(row.session.transcript_note),
    },
    authority: row.authority ?? null,
    trace_plan: row.tracePlan ?? null,
    planning_route: row.planningRoute ?? null,
    lock: lock === undefined ? null : {
      pid: lock.pid,
      heartbeat_at: lock.heartbeatAt,
      fresh: now.getTime() - new Date(lock.heartbeatAt).getTime() <= 2 * 60 * 1000,
    },
    observed_at: now.toISOString(),
    quality_reason: indexed.events_corrupt ?? (status.startsWith("corrupt") ? "Envelope is unreadable" : null),
  };
}

export function passLiveness(row: StatusRow, now: Date): { state: PassView["liveness"]; reason: string } {
  if (row.status !== "running") return { state: "terminal", reason: `Pass status is ${row.status}` };
  if (row.lastSeenAt === undefined) return { state: "unknown", reason: "Running legacy envelope has no recorded heartbeat" };
  const stamp = new Date(row.lastSeenAt).getTime();
  if (!Number.isFinite(stamp)) return { state: "unknown", reason: "Heartbeat timestamp is invalid" };
  const age = now.getTime() - stamp;
  if (age < -30_000) return { state: "unknown", reason: `Heartbeat is ${Math.abs(age)}ms in the future; clock skew suspected` };
  if (age <= PASS_STALE_AFTER_MS) return { state: "live", reason: `Heartbeat age ${Math.max(0, age)}ms is within the 180000ms threshold` };
  return { state: "stalled", reason: `Heartbeat age ${age}ms exceeds the 180000ms threshold` };
}

function artifactRefs(indexed: IndexedPass): ArtifactRefView[] {
  const row = indexed.row;
  const definitions: Array<[ArtifactRefView["kind"], string, string, boolean]> = [
    ["envelope", "Envelope", "envelope", false],
    ["events", "Structured events", "events", false],
    ["brief", "Exact brief", "brief", true],
    ["prompt", "Exact prompt", "prompt", true],
    ["output", "Exact output", "output", true],
    ["activity_log", "Activity log—not transcript", "activity_log", true],
  ];
  return definitions.map(([kind, label, key, sensitive]) => {
    const artifact = indexed.artifacts[key];
    const available = artifact?.available === true;
    return {
      kind,
      label,
      available,
      expired: !available && row.status !== "running",
      href: available ? `/api/v1/artifacts/${encodeURIComponent(row.app)}/${encodeURIComponent(row.runId)}/${kind}` : null,
      sensitive,
      sha256: artifact?.sha256 ?? null,
    };
  });
}

function projectTraces(passes: PassView[], observedAt: string): TraceView[] {
  const groups = new Map<string, PassView[]>();
  for (const pass of passes) {
    const key = `${pass.app}\u0000${pass.trace_id}`;
    groups.set(key, [...(groups.get(key) ?? []), pass]);
  }
  return [...groups.values()].map<TraceView>((group) => {
    const ordered = [...group].sort((a, b) => a.started_at.localeCompare(b.started_at) || a.id.localeCompare(b.id));
    const sourceRows = ordered;
    const indexed = sourceRows.map((pass) => pass.pass);
    const raw = group[0];
    const required = findTraceRequired(group);
    const skipped = findTraceSkipped(group);
    const missing = required === null ? [] : required.filter((pass) => !indexed.includes(pass));
    const status = traceStatus(group, missing);
    const usage = aggregateQuality(group.map((pass) => pass.usage.quality));
    const reasons: string[] = [];
    if (required === null) reasons.push("Trace manifest not recorded; required stages are unknown");
    if (missing.length > 0) reasons.push(`Missing selected passes: ${missing.join(", ")}`);
    if (group.some((pass) => pass.status !== "completed")) reasons.push("One or more observed passes did not complete");
    return {
      id: `trace:${raw!.app}:${raw!.trace_id}`,
      trace_id: raw!.trace_id,
      app: raw!.app,
      ticket: raw!.ticket,
      parent_task_id: raw!.parent_task_id,
      pipeline: raw!.pipeline,
      pass_ids: ordered.map((pass) => pass.id),
      required_passes: required,
      observed_passes: [...new Set(indexed)],
      skipped_passes: skipped,
      missing_passes: missing,
      status,
      started_at: ordered[0]!.started_at,
      finished_at: group.every((pass) => pass.finished_at !== null)
        ? [...group].map((pass) => pass.finished_at!).sort().at(-1) ?? null
        : null,
      completion_integrity: {
        required_stages: required === null ? "unknown" : missing.length === 0 && group.every((pass) => pass.status === "completed") ? "complete" : "incomplete",
        usage,
        reviewer: group.some((pass) => pass.role === "reviewer" && pass.status === "completed") ? "completed" : "unknown",
        manual_fallback: "not_recorded",
        durable_outcome: status,
        operon_end_to_end_complete: required !== null && missing.length === 0 && group.every((pass) => pass.status === "completed"),
        reasons,
      },
      observed_at: observedAt,
    };
  }).sort((a, b) => b.started_at.localeCompare(a.started_at));
}

function findTraceRequired(group: PassView[]): string[] | null {
  return group.find((pass) => pass.trace_plan !== null)?.trace_plan?.required_passes ?? null;
}

function findTraceSkipped(group: PassView[]): Array<{ pass: string; reason: string }> {
  return group.find((pass) => pass.trace_plan !== null)?.trace_plan?.skipped_passes ?? [];
}

function traceStatus(group: PassView[], missing: string[]): string {
  if (group.some((pass) => pass.status === "running")) return "running";
  if (group.some((pass) => pass.status.startsWith("failed") || pass.status === "timed_out" || pass.status === "cancelled")) return "failed";
  if (group.some((pass) => pass.status === "blocked")) return "blocked";
  if (missing.length > 0) return "incomplete";
  return group.every((pass) => pass.status === "completed") ? "completed" : "unknown";
}

function projectParentTasks(input: ObserveProjectionInput, passes: PassView[], traces: TraceView[], observedAt: string): ParentTaskView[] {
  return input.parent_tasks.map<ParentTaskView>((record) => {
    const taskPasses = passes.filter((pass) => pass.parent_task_id === record.taskId);
    const taskTraces = traces.filter((trace) => trace.parent_task_id === record.taskId);
    const observedStages = [...new Set(taskPasses.filter((pass) => pass.status === "completed").map((pass) => pass.role))];
    const missing = record.requiredStages.filter((stage) => !observedStages.includes(stage));
    const usage = aggregateQuality(taskPasses.map((pass) => pass.usage.quality));
    const reasons: string[] = [];
    if (record.status !== "completed") reasons.push(`Parent task is ${record.status}`);
    if (record.executionMode !== "operon") reasons.push(`Execution mode is ${record.executionMode}`);
    if (missing.length > 0) reasons.push(`Missing required stages: ${missing.join(", ")}`);
    if (taskTraces.length === 0) reasons.push("No correlated trace recorded");
    if (taskTraces.some((trace) => !trace.completion_integrity.operon_end_to_end_complete)) reasons.push("One or more correlated traces is incomplete");
    const complete = reasons.length === 0;
    return {
      id: `task:${record.taskId}`,
      task_id: record.taskId,
      app: record.app ?? null,
      objective: truncatePreview(scrubSecrets(record.objective), 320),
      completion_criteria: record.completionCriteria !== undefined ? truncatePreview(scrubSecrets(record.completionCriteria), 400) : null,
      status: record.status,
      execution_mode: record.executionMode,
      started_at: record.startedAt,
      ended_at: record.endedAt ?? null,
      prompt: {
        kind: "task",
        label: "Exact original operator prompt",
        available: input.parent_task_prompts[record.taskId] === true,
        expired: input.parent_task_prompts[record.taskId] !== true,
        href: input.parent_task_prompts[record.taskId] === true ? `/api/v1/tasks/${encodeURIComponent(record.taskId)}/prompt` : null,
        sensitive: true,
        sha256: record.promptSha256,
      } as const,
      prompt_sha256: record.promptSha256,
      required_stages: record.requiredStages,
      observed_stages: observedStages,
      missing_required_stages: missing,
      trace_ids: [...new Set([...record.refs.traces, ...taskPasses.map((pass) => pass.trace_id)])],
      ticket_refs: [...new Set([...record.refs.tickets, ...taskPasses.map((pass) => pass.ticket).filter((value): value is string => value !== null)])],
      completion_integrity: {
        required_stages: missing.length === 0 ? "complete" : "incomplete",
        usage,
        reviewer: record.requiredStages.includes("reviewer")
          ? observedStages.includes("reviewer") ? "completed" : "missing"
          : "not_required",
        manual_fallback: record.executionMode === "operon" ? "none" : "present",
        durable_outcome: record.completionState?.pr ?? "not_recorded",
        operon_end_to_end_complete: complete,
        reasons,
      },
      observed_at: observedAt,
      source_refs: [{ source: "parent_task", ref: `tasks/${record.taskId}/task.json` }],
    };
  }).sort((a, b) => b.started_at.localeCompare(a.started_at));
}

function projectApproval(item: ApprovalItem, grant: ApprovalGrant | undefined, now: Date): ApprovalView {
  let status: ApprovalView["status"];
  if (item.status === "pending") status = "pending";
  else if (item.status === "denied") status = "denied";
  else if (grant?.revokedAt !== undefined) status = "revoked";
  else if (grant?.consumedAt !== undefined || grant?.uses === 0) status = "consumed";
  else if (grant !== undefined && new Date(grant.expiresAt).getTime() <= now.getTime()) status = "expired";
  else status = "granted";
  return {
    id: `approval:${item.id}`,
    approval_id: item.id,
    app: item.app,
    role: item.role,
    rule: item.rule,
    status,
    ticket_ref: item.ticketRef ?? null,
    turn_id: item.turnId ?? null,
    raised_at: item.raisedAt,
    decided_at: item.decidedAt ?? null,
    expires_at: grant?.expiresAt ?? null,
    scope: grant?.scope === undefined ? null : `${grant.scope.kind}:${grant.scope.rule}${grant.scope.pathContains === undefined ? "" : `:${grant.scope.pathContains}`}`,
    reason: item.reason !== undefined ? truncatePreview(scrubSecrets(item.reason), 240) : null,
    execution_state: item.execution?.state ?? null,
    execution_attempts: item.execution?.attempts ?? 0,
    execution_actor: item.execution?.actor ?? null,
    execution_result: item.execution?.result === undefined ? null : truncatePreview(scrubSecrets(item.execution.result), 240),
    execution_failure_cause: item.execution?.failureCause ?? null,
    execution_next_action: item.execution?.nextAction ?? null,
    execution_remote_ref: item.execution?.remoteRef ?? null,
    execution_attempted_at: item.execution?.attemptedAt ?? null,
    execution_finished_at: item.execution?.finishedAt ?? null,
    observed_at: now.toISOString(),
    source_refs: [{ source: "approvals", ref: `approvals/${item.status === "pending" ? "pending" : "decided"}/${item.id}.json` }],
  };
}

function projectDelivery(
  github: ObserveProjectionInput["github"],
  passes: PassView[],
  maxConcurrent: number,
  observedAt: string,
): DeliveryTicketView[] {
  const out: DeliveryTicketView[] = [];
  for (const source of github) {
    const mapped = source.issues.map((issue) => {
      const labels = [...issue.labels];
      const ticketPasses = passes.filter((pass) => pass.app === source.app && ticketNumber(pass.ticket) === issue.number);
      const linkedPrNumbers = new Set(
        ticketPasses.flatMap((pass) => pass.result_refs.filter((ref) => ref.source === "pr").map((ref) => explicitNumber(ref.ref)).filter(isNumber)),
      );
      const prs = source.pull_requests
        .filter(({ pull_request }) =>
          linkedPrNumbers.has(pull_request.number) ||
          pull_request.closingIssueNumbers?.includes(issue.number) === true
        )
        .map(({ pull_request, reviews, checks }) => projectPullRequest(pull_request, reviews, checks ?? []));
      const mappedState = deliveryState(issue.state, labels, prs);
      const deps = parseDependsOn(issue.body);
      return {
        issue,
        labels,
        passes: ticketPasses,
        prs,
        state: mappedState.state,
        qualityReason: mappedState.reason,
        deps,
      };
    });
    const schedulable: SchedulableTicket[] = mapped.map((entry) => {
      const value = priority(entry.labels);
      return {
        id: entry.issue.number,
        phase: deliveryPhase(entry.state),
        dependsOn: entry.deps,
        ...(value !== null ? { priority: value } : {}),
      };
    });
    const selected = selectReadyTickets(schedulable, Math.max(maxConcurrent, schedulable.length));
    const ranks = new Map(selected.map((item, index) => [item.id, index + 1]));
    const merged = new Set(mapped.filter((entry) => entry.state === "merged").map((entry) => entry.issue.number));
    for (const entry of mapped) {
      const latestEvent = entry.passes.flatMap((pass) => pass.events).sort((a, b) => b.ts.localeCompare(a.ts))[0];
      const branches = [...new Set(entry.passes.map((pass) => pass.git_branch).filter((value): value is string => value !== null))];
      out.push({
        id: `ticket:${source.app}:${entry.issue.number}`,
        app: source.app,
        repo: source.repo,
        issue_number: entry.issue.number,
        title: truncatePreview(scrubSecrets(entry.issue.title), 180),
        url: entry.issue.url ?? null,
        state: entry.state,
        labels: entry.labels,
        priority: priority(entry.labels),
        tier: tier(entry.labels),
        dependencies: entry.deps,
        dependency_blocked: entry.deps.some((dep) => !merged.has(dep)),
        scheduler_rank: ranks.get(entry.issue.number) ?? null,
        active_pass_ids: entry.passes.filter((pass) => pass.status === "running").map((pass) => pass.id),
        branch: branches.length === 1 ? branches[0]! : null,
        pull_requests: entry.prs,
        latest_event: latestEvent === undefined ? null : `${latestEvent.event} at ${latestEvent.ts}`,
        observed_at: source.observed_at || observedAt,
        quality_reason: entry.qualityReason ?? (branches.length > 1 ? "Multiple correlated branches recorded" : null),
        source_refs: [{ source: "github_issue", ref: `${source.repo}#${entry.issue.number}` }],
      });
    }
  }
  return out.sort((a, b) => deliveryOrder(a.state) - deliveryOrder(b.state) || (a.scheduler_rank ?? 9999) - (b.scheduler_rank ?? 9999) || a.issue_number - b.issue_number);
}

function projectPullRequest(
  pr: ObserveProjectionInput["github"][number]["pull_requests"][number]["pull_request"],
  reviews: ObserveProjectionInput["github"][number]["pull_requests"][number]["reviews"],
  checks: Array<{ name: string; state: string; link?: string }>,
): PullRequestView {
  const latest = [...reviews].sort((a, b) => (b.submittedAt ?? "").localeCompare(a.submittedAt ?? ""))[0];
  const reviewIntegrity: PullRequestView["review_integrity"] = latest === undefined
    ? "missing"
    : latest.state === "CHANGES_REQUESTED"
      ? "changes_requested"
      : latest.state === "APPROVED" && latest.commitId !== undefined && pr.headRefOid !== undefined
        ? latest.commitId === pr.headRefOid ? "fresh_approved" : "stale_approval"
        : "unknown";
  const checkStates = checks.map((check) => check.state.toUpperCase());
  const checkIntegrity: PullRequestView["check_integrity"] = checks.length === 0
    ? "unknown"
    : checkStates.some((state) => ["FAILURE", "FAILED", "ERROR", "CANCELLED", "TIMED_OUT"].includes(state))
      ? "red"
      : checkStates.every((state) => ["SUCCESS", "PASS", "PASSED", "NEUTRAL", "SKIPPED"].includes(state))
        ? "green"
        : "pending";
  return {
    number: pr.number,
    url: pr.url ?? null,
    state: pr.state,
    head_ref: pr.headRefName,
    head_sha: pr.headRefOid ?? null,
    merge_commit: pr.mergeCommitOid ?? null,
    reviews: reviews.map((review) => ({
      state: review.state,
      commit_id: review.commitId ?? null,
      submitted_at: review.submittedAt ?? null,
      author: review.author ?? null,
    })),
    review_integrity: reviewIntegrity,
    checks: checks.map((check) => ({ name: check.name, state: check.state, link: check.link ?? null })),
    check_integrity: checkIntegrity,
  };
}

function projectIntake(input: ObserveProjectionInput, passes: PassView[], observedAt: string): ActivityView[] {
  const out: ActivityView[] = [];
  for (const app of input.apps) {
    if (app.status === "onboarding") {
      out.push({
        id: `intake:onboarding:${app.name}`,
        app: app.name,
        kind: "onboarding",
        status: "onboarding",
        title: `${app.name} onboarding`,
        trigger: null,
        trace_id: null,
        parent_task_id: null,
        started_at: null,
        latest_at: null,
        result_refs: [{ source: "org", ref: "apps.yaml" }],
        observed_at: observedAt,
        quality_reason: "Lifecycle is authoritative from apps.yaml; promotion is not an observer action",
      });
    }
  }
  const traces = new Map<string, PassView[]>();
  for (const pass of passes.filter((candidate) => candidate.ticket === null)) {
    const key = `${pass.app}\u0000${pass.trace_id}`;
    traces.set(key, [...(traces.get(key) ?? []), pass]);
  }
  for (const group of traces.values()) {
    const first = [...group].sort((a, b) => a.started_at.localeCompare(b.started_at))[0]!;
    const latest = [...group].sort((a, b) => (b.finished_at ?? b.started_at).localeCompare(a.finished_at ?? a.started_at))[0]!;
    out.push({
      id: `intake:trace:${first.app}:${first.trace_id}`,
      app: first.app,
      kind: activityKind(first),
      status: traceStatus(group, []),
      title: `${first.pipeline} · ${[...new Set(group.map((pass) => pass.role))].join(", ")}`,
      trigger: ledgerTrigger(input, first),
      trace_id: first.trace_id,
      parent_task_id: first.parent_task_id,
      started_at: first.started_at,
      latest_at: latest.finished_at ?? latest.started_at,
      result_refs: group.flatMap((pass) => pass.result_refs),
      observed_at: observedAt,
      quality_reason: null,
    });
  }
  for (const item of input.inbox) {
    if (item.app === null) continue;
    out.push({
      id: `intake:event:${item.filename}`,
      app: item.app,
      kind: "company_event",
      status: item.error === undefined ? "pending" : "corrupt",
      title: item.kind === null ? item.filename : `${item.kind} · ${item.filename}`,
      trigger: item.kind,
      trace_id: null,
      parent_task_id: null,
      started_at: null,
      latest_at: null,
      result_refs: [{ source: "event_inbox", ref: `state/events/inbox/${item.filename}` }],
      observed_at: observedAt,
      quality_reason: item.error ?? null,
    });
  }
  return out.sort((a, b) => (b.latest_at ?? b.started_at ?? "").localeCompare(a.latest_at ?? a.started_at ?? ""));
}

function projectAttention(
  input: ObserveProjectionInput,
  passes: PassView[],
  delivery: DeliveryTicketView[],
  approvals: ApprovalView[],
  observedAt: string,
): AttentionItemView[] {
  const out: AttentionItemView[] = [];
  for (const approval of approvals.filter((item) => item.status === "pending")) {
    out.push(attention("warning", "pending_approval", approval.app, approval.id, `Approval ${approval.approval_id} is waiting`, approval.rule, observedAt));
  }
  for (const approval of approvals.filter((item) => item.execution_state === "failed" || item.execution_state === "ambiguous")) {
    out.push(attention(
      "error",
      "approval_delivery",
      approval.app,
      approval.id,
      `Approval ${approval.approval_id} delivery is ${approval.execution_state}`,
      `attempt ${approval.execution_attempts}; actor ${approval.execution_actor ?? "unrecorded"}; ` +
        `result ${approval.execution_result ?? "unrecorded"}; next ${approval.execution_next_action ?? "unrecorded"}`,
      observedAt,
    ));
  }
  for (const pass of passes) {
    if (pass.liveness === "stalled") out.push(attention("error", "stale_pass", pass.app, pass.id, `${pass.role}/${pass.pass} is stalled`, pass.liveness_reason, observedAt));
    if (pass.status.startsWith("failed") || pass.status === "timed_out" || pass.status === "cancelled") {
      out.push(attention("error", "failed_pass", pass.app, pass.id, `${pass.role}/${pass.pass} ${pass.status}`, pass.terminal_reason ?? "No terminal reason recorded", observedAt));
    }
    if (pass.usage.quality === "partial" || pass.usage.quality === "unavailable") {
      out.push(attention("warning", "usage_incomplete", pass.app, pass.id, `Usage is ${pass.usage.quality}`, "Unknown cost is not free", observedAt));
    }
    if (pass.quality_reason !== null) out.push(attention("error", "corrupt_run", pass.app, pass.id, "Run evidence is degraded", pass.quality_reason, observedAt));
  }
  for (const ticket of delivery.filter((item) => item.state === "returned")) {
    out.push(attention("warning", "returned_ticket", ticket.app, ticket.id, `Ticket #${ticket.issue_number} was returned`, ticket.title, observedAt));
  }
  for (const ticket of delivery.filter((item) => item.state === "merged" && item.quality_reason !== null)) {
    out.push(attention("warning", "delivery_integrity", ticket.app, ticket.id, `Ticket #${ticket.issue_number} completion needs attention`, ticket.quality_reason!, observedAt));
  }
  for (const source of input.source_health.filter((source) => source.status !== "healthy")) {
    out.push(attention(source.status === "unavailable" ? "error" : "warning", "source_health", null, `source:${source.id}`, `${source.id} is ${source.status}`, source.detail, observedAt));
  }
  for (const run of input.corrupt_runs) out.push(attention("error", "corrupt_run", run.app, passId(run.app, run.run_id), "Envelope is corrupt", run.detail, observedAt));
  for (const task of input.corrupt_tasks) out.push(attention("error", "corrupt_task", null, `task:${task.task_id}`, "Parent task record is corrupt", task.detail, observedAt));
  for (const event of input.inbox.filter((item) => item.error !== undefined)) out.push(attention("error", "corrupt_intake", event.app, `event:${event.filename}`, "Intake event is corrupt", event.error!, observedAt));
  return uniqueBy(out, (item) => item.id);
}

function attention(severity: AttentionItemView["severity"], kind: string, app: string | null, entityId: string | null, title: string, detail: string, observedAt: string): AttentionItemView {
  return {
    id: `attention:${kind}:${entityId ?? title}`,
    severity,
    kind,
    app,
    entity_id: entityId,
    title: truncatePreview(scrubSecrets(title), 180),
    detail: truncatePreview(scrubSecrets(detail), 400),
    observed_at: observedAt,
  };
}

function deliveryState(issueState: string, labels: string[], prs: PullRequestView[]): { state: DeliveryState; reason?: string } {
  const operation = labels.filter((label) => ["op:ready", "op:building", "op:in-review", "op:blocked", "op:returned"].includes(label));
  if (operation.length > 1) return { state: "closed_unknown", reason: `Conflicting delivery labels: ${operation.join(", ")}` };
  if (prs.some((pr) => pr.state === "MERGED")) {
    return issueState === "CLOSED"
      ? { state: "merged" }
      : { state: "merged", reason: "Explicitly correlated PR is merged, but the issue remains open; finalization is incomplete" };
  }
  if (issueState === "CLOSED") {
    return { state: "closed_unknown", reason: "Issue is closed but no explicitly correlated merged PR is recorded" };
  }
  const label = operation[0];
  if (label === "op:ready") return { state: "ready" };
  if (label === "op:building") return { state: "building" };
  if (label === "op:in-review") return { state: "in_review" };
  if (label === "op:blocked") return { state: "blocked_on_approval" };
  if (label === "op:returned") return { state: "returned" };
  return { state: "backlog" };
}

function deliveryPhase(state: DeliveryState): SchedulableTicket["phase"] {
  if (state === "ready") return "ready";
  if (state === "building") return "building";
  if (state === "in_review") return "reviewing";
  if (state === "blocked_on_approval") return "blocked";
  if (state === "returned") return "returned";
  if (state === "merged") return "merged";
  return "blocked";
}

function deliveryOrder(state: DeliveryState): number {
  return ["ready", "building", "in_review", "blocked_on_approval", "returned", "merged", "backlog", "closed_unknown"].indexOf(state);
}

function priority(labels: string[]): number | null {
  if (labels.includes("p1")) return 1;
  if (labels.includes("p2")) return 2;
  if (labels.includes("p3")) return 3;
  return null;
}

function tier(labels: string[]): string | null {
  const label = labels.find((candidate) => ["quick", "standard", "deep", "op:tier-quick", "op:tier-standard", "op:tier-deep"].includes(candidate));
  return label?.replace("op:tier-", "") ?? null;
}

function activityKind(pass: PassView): ActivityKind {
  if (pass.pipeline.includes("plan") || pass.role === "planner") return "planning";
  if (pass.role === "distiller" || pass.role === "learning-reviewer" || pass.pipeline.includes("learning")) return "learning";
  return "manual_role";
}

function ledgerTrigger(input: ObserveProjectionInput, pass: PassView): string | null {
  return input.ledger.find((row) => row.app === pass.app && row.runId === pass.run_id)?.trigger ?? null;
}

function aggregateQuality(qualities: UsageQuality[]): UsageQuality {
  return qualities.reduce<UsageQuality>((worst, value) => QUALITY_RANK[value] > QUALITY_RANK[worst] ? value : worst, "complete");
}

/** Delegates to the shared primitive so Observe and Report cannot classify the
 *  same stored quality differently (#89). */
function normalizeQuality(value: string | undefined): UsageQuality {
  return normalizeUsageQuality(value);
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function passId(app: string, runId: string): string {
  return `pass:${app}:${runId}`;
}

function ticketNumber(ticket: string | null): number | null {
  if (ticket === null) return null;
  const match = /^#?(\d+)$/.exec(ticket.trim());
  return match === null ? null : Number(match[1]);
}

function explicitNumber(ref: string): number | null {
  const match = /(?:\/pull\/|^#)(\d+)$/.exec(ref.trim());
  return match === null ? null : Number(match[1]);
}

function isNumber(value: number | null): value is number {
  return value !== null;
}

function scrubEventDetail(detail: Record<string, string | number | boolean>): Record<string, string | number | boolean> {
  return Object.fromEntries(Object.entries(detail).map(([key, value]) => [key, typeof value === "string" ? truncatePreview(scrubSecrets(value), 400) : value]));
}

function passMatches(pass: PassView, filters: ObserveProjectionInput["filters"]): boolean {
  if (filters.app !== undefined && pass.app !== filters.app) return false;
  if (filters.parent_task !== undefined && pass.parent_task_id !== filters.parent_task) return false;
  if (filters.ticket !== undefined && ticketNumber(pass.ticket) !== filters.ticket) return false;
  if (filters.status !== undefined && pass.status !== filters.status) return false;
  if (filters.role !== undefined && pass.role !== filters.role) return false;
  if (filters.since !== undefined && pass.started_at < filters.since) return false;
  return true;
}

function traceMatches(trace: TraceView, filters: ObserveProjectionInput["filters"]): boolean {
  if (filters.app !== undefined && trace.app !== filters.app) return false;
  if (filters.parent_task !== undefined && trace.parent_task_id !== filters.parent_task) return false;
  if (filters.ticket !== undefined && ticketNumber(trace.ticket) !== filters.ticket) return false;
  return true;
}

function uniqueBy<T>(values: T[], key: (value: T) => string): T[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const id = key(value);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}
