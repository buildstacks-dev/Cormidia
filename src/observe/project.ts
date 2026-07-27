import { basename } from "node:path";
import { parseDependsOn, selectReadyTickets, type SchedulableTicket } from "../loop/scheduling.js";
import type { ApprovalGrant, ApprovalItem } from "../org/approvals.js";
import { scrubSecrets, truncatePreview } from "../runtime/runlog/redact.js";
import type { StatusRow } from "../runtime/runlog/status.js";
import { settlementKey, settlementIdentity } from "../runtime/telemetry.js";
import { aggregateCost, normalizeUsageQuality, providerPassRef, worstUsageQuality, type CostAggregate } from "../runtime/cost.js";
import type { TurnRecord } from "../runtime/telemetry.js";
import { ACTIVITY_ORDER, ORDER_SEPARATOR, buildOrderKey, compareStable, orderRows, orderingView, sectionScope } from "./order.js";
import {
  OBSERVE_SCHEMA_VERSION,
  type ActivityKind,
  type ActivityStreamMetaView,
  type ActivityView,
  type ApprovalView,
  type ArtifactRefView,
  type AttentionGroupView,
  type AttentionItemView,
  type AttentionOccurrenceView,
  type CompletionIntegrityView,
  type DeliveryState,
  type DeliveryTicketView,
  type DurationView,
  type GraphNodeState,
  type ScopeStatementView,
  type TraceNodeView,
  type EventKind,
  type EventOutcome,
  type EventView,
  type IndexedPass,
  type ObserveProjectionInput,
  type ObserveSnapshotV1,
  type OrderDirection,
  type ParentTaskView,
  type PassView,
  type PendingIntakeItemView,
  type PendingIntakeState,
  type PullRequestView,
  type SourceRefView,
  type TimePolicyView,
  type TraceView,
  type UsageQuality,
} from "./types.js";

export const PASS_STALE_AFTER_MS = 3 * 60 * 1000;
/** Reuses the tolerance already encoded in `passLiveness` rather than
 *  inventing a second constant. Ordinary NTP jitter must not flood the header. */
export const CLOCK_SKEW_TOLERANCE_MS = 30_000;
const ACTIVITY_HISTORY_CAP = 200;
const PENDING_INTAKE_CAP = 200;
const ATTENTION_OCCURRENCE_CAP = 500;

/**
 * The ONE instant normalizer. Every instant-valued emission routes through it,
 * so `<time datetime>` always carries a single canonical machine-readable form
 * and a raw-string sort is a correct instant sort. Sources genuinely vary: the
 * approvals path emits `...T10:00:00Z` with no milliseconds, and GitHub can
 * emit a non-UTC offset.
 *
 * Absent -> null. Unparseable -> null (never 'Invalid Date', never epoch zero).
 * No timezone conversion, no locale formatting, no offset arithmetic happens
 * here or anywhere else in the projection: only the browser knows the
 * operator's zone.
 */
function instant(value: string | Date | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

/** True when a value was recorded but could not be read as an instant. */
function unreadableInstant(value: string | null | undefined): boolean {
  return value !== null && value !== undefined && value !== "" && instant(value) === null;
}

function ascendingNullsLast(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return compareStable(a, b);
}

/** Nulls stay LAST in both directions — an undated record is not "oldest". */
function descendingNullsLast(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return compareStable(b, a);
}

const EVENT_KINDS: Record<string, EventKind> = {
  "run.started": "run", "run.completed": "run",
  "pass.started": "pass", "pass.completed": "pass", "pass.failed": "pass",
  "pass.cancelled": "pass", "pass.timed_out": "pass",
  // Heartbeats get their OWN kind so coalescing them can never swallow a
  // pass outcome carried on the same pass.
  "pass.heartbeat": "heartbeat",
  "gate.started": "gate", "gate.passed": "gate", "gate.failed": "gate",
  "tool.called": "tool",
  "subagent.started": "subagent", "subagent.completed": "subagent",
  "ticket.transition": "ticket",
  "verdict.recorded": "verdict",
  "plan.ticket_finalized": "plan",
  "escalation.raised": "escalation",
  "telemetry.settle_skipped": "telemetry", "telemetry.settle_failed": "telemetry",
};

const EVENT_OUTCOMES: Record<string, EventOutcome> = {
  "run.started": "pending", "run.completed": "success",
  "pass.started": "pending", "pass.completed": "success",
  "pass.failed": "failure", "pass.cancelled": "failure", "pass.timed_out": "failure",
  "pass.heartbeat": "not_applicable",
  "gate.started": "pending", "gate.passed": "success", "gate.failed": "failure",
  "subagent.started": "pending", "subagent.completed": "success",
  "ticket.transition": "not_applicable",
  "verdict.recorded": "not_applicable",
  "plan.ticket_finalized": "not_applicable",
  "escalation.raised": "not_applicable",
  // A benign exactly-once skip is NOT a failure, whatever its severity.
  "telemetry.settle_skipped": "not_applicable",
  "telemetry.settle_failed": "failure",
};

/** Total over RunlogEventType; a legacy or future event string never throws. */
function eventKind(event: string): EventKind {
  return EVENT_KINDS[event] ?? "other";
}

/**
 * Derived from the typed event and typed `detail` fields only — never from
 * `severity`, which would turn a benign `telemetry.settle_skipped` (severity
 * `warn`) red and would call a failed tool call at severity `info` a success.
 */
function eventOutcome(event: string, detail: Record<string, string | number | boolean>): EventOutcome {
  if (event === "tool.called") {
    // Absent `success` is genuinely unknown: neither a truthy nor a falsy
    // default may invent an outcome the adapter did not report.
    if (detail["success"] === true) return "success";
    if (detail["success"] === false) return "failure";
    return "unknown";
  }
  return EVENT_OUTCOMES[event] ?? "unknown";
}

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

/**
 * Every settled ledger row, grouped by `(app, runId)`. Built ONCE per snapshot:
 * a `input.ledger.filter(...)` inside the trace loop would be O(traces × ledger)
 * and visible on a real org home.
 */
function ledgerRowsByRun(rows: readonly TurnRecord[]): Map<string, TurnRecord[]> {
  const byRun = new Map<string, TurnRecord[]>();
  for (const row of rows) {
    if (row.runId === undefined) continue;
    const key = settlementKey(row.app, row.runId);
    byRun.set(key, [...(byRun.get(key) ?? []), row]);
  }
  return byRun;
}

/**
 * THE per-scope cost aggregate. `snapshot.totals`, `TraceView` and
 * `ParentTaskView` all call this, so a per-row figure can never contradict the
 * header the way an envelope-summing row once did (#89).
 *
 * Ledger-first, and settlement-aware in both directions:
 *
 *  - A settled row contributes its recorded cost (or a counted unknown when the
 *    row is `unmeasured`).
 *  - A genuine provider pass with NO settled row contributes a counted unknown
 *    keyed on its own pass id. Without this, `aggregateCost([])` would return
 *    `coverage: "none"` — an AUTHORITATIVE zero — for a scope whose provider
 *    turns simply never reached the ledger, and the client would render an
 *    unobservable turn as `$0.00` (invariant 4).
 *  - A mechanical pass (`quality: "none"`) contributes an authoritative zero and
 *    is never counted as an unknown turn (#88).
 */
function costForPasses(
  passes: readonly PassView[],
  byRun: Map<string, TurnRecord[]>,
): { cost: CostAggregate; usage_quality: UsageQuality; rows: TurnRecord[]; scope: { settled_provider_turns: number; unsettled_provider_turns: number } } {
  const rows: TurnRecord[] = [];
  const contributions: Array<{ costUsd: number | null; quality: string; ref: string }> = [];
  let unsettledProviderTurns = 0;
  for (const pass of passes) {
    const settled = byRun.get(settlementKey(pass.app, pass.run_id)) ?? [];
    if (pass.usage.quality === "none") {
      // An authoritative zero. Never an unknown turn, never a settlement gap.
      contributions.push({ costUsd: 0, quality: "none", ref: pass.id });
      continue;
    }
    if (settled.length === 0) {
      unsettledProviderTurns += 1;
      contributions.push({ costUsd: null, quality: "unavailable", ref: pass.id });
      continue;
    }
    for (const row of settled) {
      rows.push(row);
      contributions.push({
        costUsd: row.unmeasured === true ? null : row.costUsd,
        quality: row.unmeasured === true ? "unavailable" : row.usageQuality,
        ref: settlementIdentity(row) ?? pass.id,
      });
    }
  }
  const cost = aggregateCost(contributions);
  return {
    cost,
    // A scope with no pass evidence AT ALL is genuinely unknown; a scope whose
    // passes all invoked no provider is an authoritative zero. The two are never
    // conflated in either direction (invariant 4).
    usage_quality: passes.length === 0 ? "unavailable" : cost.usage_quality,
    rows,
    scope: {
      settled_provider_turns: cost.provider_turns - unsettledProviderTurns,
      unsettled_provider_turns: unsettledProviderTurns,
    },
  };
}

/**
 * A recorded interval, or a typed reason it is not one. Reads only the two
 * recorded instants: never `Date.now()` (which would make a running trace's
 * duration non-deterministic) and never `Math.abs` or a clamp on a backwards
 * pair (which would present recorded clock skew as a real measurement).
 *
 * `subject` NAMES the entity being measured. A parent task rendering "Trace not
 * finished" tells the operator a different record is running than the one they
 * are looking at, which is an identity error in operator-facing text even
 * though the interval arithmetic is identical.
 */
function durationBetween(startedAt: string | null, finishedAt: string | null, subject = "Trace"): DurationView {
  if (startedAt === null || finishedAt === null) {
    return finishedAt === null && startedAt !== null
      ? { ms: null, quality: "running", unknown_reason: `${subject} not finished` }
      : { ms: null, quality: "unrecorded", unknown_reason: "Start or finish instant not recorded" };
  }
  const start = Date.parse(startedAt);
  const finish = Date.parse(finishedAt);
  if (!Number.isFinite(start) || !Number.isFinite(finish)) {
    return { ms: null, quality: "unrecorded", unknown_reason: "Unreadable instant" };
  }
  if (finish < start) {
    return { ms: null, quality: "clock_skew", unknown_reason: "Finish instant precedes start (clock skew)" };
  }
  return { ms: finish - start, quality: "measured", unknown_reason: null };
}

/**
 * The graph state token for an OBSERVED pass. Derived only from typed fields —
 * never from a title, branch, prompt, or timestamp text (invariant 2).
 *
 * A pass whose start instant was recorded but is UNREADABLE reaches here with
 * `started_at === null` and a non-null `quality_reason`. That is a corrupt
 * record, not a clean pre-start state, so it maps to `unknown` rather than
 * `not_started`.
 */
function graphState(pass: PassView): GraphNodeState {
  if (pass.status === "running") return "running";
  if (pass.status === "completed") return "completed";
  if (pass.status === "blocked") return "blocked";
  if (pass.status.startsWith("failed") || pass.status === "timed_out" || pass.status === "cancelled") return "failed";
  if (pass.started_at === null) return pass.quality_reason === null ? "not_started" : "unknown";
  return "unknown";
}

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
  const byRun = ledgerRowsByRun(input.ledger);
  const traces = projectTraces(passes, observedAt, byRun).filter((trace) => traceMatches(trace, input.filters));
  const parentTasks = projectParentTasks(input, passes, traces, observedAt, byRun).filter((task) =>
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
      // Deliberately NOT narrowed by `filters.since`/`parent_task`/`ticket`: the
      // app card is a month-to-date, app-wide budget fact and the client labels
      // it as such under a historical selection rather than rescoping it into a
      // different, smaller number that looks like the same one (invariant 14).
      const costWindow = {
        basis: "month_to_date" as const,
        start_utc: `${observedAt.slice(0, 7)}-01T00:00:00.000Z`,
        end_utc: observedAt,
        app_wide: true as const,
      };
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
        cost_window: costWindow,
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
  // Two typed collections instead of one apparently-ordered concatenation. The
  // recorded chronology is dated by type; pending intake is explicitly not a
  // sequence and carries its own count and state (#94).
  const direction: OrderDirection = input.filters.order ?? "newest_first";
  const activityRows = projectActivityHistory(input, passes, observedAt, direction).filter((activity) =>
    (input.filters.app === undefined || activity.app === input.filters.app) &&
    (input.filters.parent_task === undefined || activity.parent_task_id === input.filters.parent_task),
  );
  const pendingRows = projectPendingIntake(input, observedAt).filter((item) =>
    input.filters.app === undefined || item.app === input.filters.app,
  );
  const activityHistory = sectionScope(
    "Recorded activity",
    activityRows,
    ACTIVITY_HISTORY_CAP,
    orderingView("occurred_at", "id_asc", direction),
  );
  const pendingIntake = sectionScope(
    "Pending intake",
    pendingRows,
    PENDING_INTAKE_CAP,
    orderingView("occurred_at", "filename_asc", "newest_first"),
  );
  const invocations = input.invocations
    .filter((record) => input.filters.app === undefined || record.app === input.filters.app)
    .filter((record) => input.filters.parent_task === undefined || record.parentTaskId === input.filters.parent_task)
    .map((record, index) => ({
      id: `invocation:${record.at}:${record.kind}:${index}`,
      kind: record.kind,
      app: record.app ?? null,
      parent_task_id: record.parentTaskId ?? null,
      at: instant(record.at) ?? record.at,
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
  // The SAME helper every per-entity row uses, so the header and a row can no
  // longer disagree about the same passes.
  const totalsCost = costForPasses(passes, byRun);
  const cost = totalsCost.cost;
  const costScope = totalsCost.scope;
  // Mechanical passes are not provider turns, so they belong to neither side of
  // settlement coverage (#88).
  const providerPasses = passes.filter((pass) => pass.usage.quality !== "none");
  const quality = aggregateQuality(providerPasses.map((pass) => pass.usage.quality));
  const activity = projectActivityMeta(input.passes, passes, observedAt);

  const snapshot: ObserveSnapshotV1 = {
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
    activity_history: activityHistory,
    pending_intake: {
      scope: pendingIntake.scope,
      rows: pendingIntake.rows,
      counts: countPendingStates(pendingRows),
    },
    delivery,
    parent_tasks: parentTasks,
    traces,
    // `cap` is null: the projection does not truncate traces, so this `total` is
    // the honest pre-client-filter denominator the client badge must quote even
    // when its own display cap or search narrows what is on screen.
    traces_scope: sectionScope(
      "Execution traces",
      traces,
      null,
      orderingView("order_key", "trace id ascending (app-scoped composite id)", "newest_first"),
    ).scope,
    passes,
    approvals,
    invocations,
    activity,
    time_policy: {
      source_timezone: "UTC",
      // What the CLIENT should display by default, and it is read: the bundle
      // applies this unless the operator pinned a zone with `?tz=`. Declaring
      // "UTC" here while the client defaulted to viewer-local made the field
      // both wrong and dead.
      display_timezone: "viewer_local",
      instant_format: "iso8601-utc-ms",
      skew: null,
    },
    totals: {
      active_passes: passes.filter((pass) => pass.status === "running").length,
      pending_approvals: approvals.filter((approval) => approval.status === "pending").length,
      delivery_ready: delivery.filter((ticket) => ticket.state === "ready").length,
      recorded_cost_usd: cost.known_cost_usd,
      cost,
      cost_scope: costScope,
      // `none` and `unavailable` are never conflated (invariant 4). Passes that
      // all invoked no provider are an AUTHORITATIVE zero (`none`); only a scope
      // with no pass evidence at all is genuinely `unavailable`. Mirrors
      // aggregateCost in src/runtime/cost.ts, which returns `none` for zero
      // provider turns.
      usage_quality: providerPasses.length > 0 ? quality : passes.length > 0 ? "none" : "unavailable",
      // Only genuine provider turns can have incomplete usage. A mechanical
      // pass invoked no provider, so it is never counted here (#88).
      incomplete_usage_passes: providerPasses.filter((pass) => pass.usage.quality !== "complete").length,
      scope_statement: scopeStatement(input, apps, observedAt),
    },
    attention: attention.items,
    attention_groups: attention.groups,
  };
  // Skew is data on the snapshot, not an attention item: #91 owns the attention
  // surface, and a header warning is the right place for a clock fact.
  snapshot.time_policy = { ...snapshot.time_policy, skew: collectSkew(snapshot, input.now.getTime()) };
  return snapshot;
}

/**
 * What the header totals cover. `apps` is the POST-filter list, so a statement
 * can never claim org-wide coverage for a single-app total; and `basis` is
 * `since_filter` whenever rows before `since` were dropped, so "all recorded"
 * is never asserted over a truncated range.
 */
function scopeStatement(
  input: ObserveProjectionInput,
  apps: Array<{ name: string }>,
  observedAt: string,
): ScopeStatementView {
  const filters: string[] = [];
  const f = input.filters;
  if (f.app !== undefined) filters.push(`app=${f.app}`);
  if (f.parent_task !== undefined) filters.push(`parent_task=${f.parent_task}`);
  if (f.ticket !== undefined) filters.push(`ticket=${f.ticket}`);
  if (f.status !== undefined) filters.push(`status=${f.status}`);
  if (f.role !== undefined) filters.push(`role=${f.role}`);
  if (f.since !== undefined) filters.push(`since=${f.since}`);
  if (f.order !== undefined) filters.push(`order=${f.order}`);
  return {
    apps: apps.map((app) => app.name),
    app_filter: f.app ?? null,
    time_range: {
      start_utc: f.since ?? null,
      end_utc: observedAt,
      basis: f.since === undefined ? "all_recorded" : "since_filter",
    },
    filters: filters.sort(compareStable),
  };
}

function countPendingStates(rows: PendingIntakeItemView[]): Record<PendingIntakeState, number> {
  const counts: Record<PendingIntakeState, number> = { pending: 0, corrupt: 0, awaiting_promotion: 0 };
  for (const row of rows) counts[row.state] += 1;
  return counts;
}

/**
 * Metadata only — no second copy of the events, no persisted index, no store.
 * `total_events` is the authoritative denominator for the client's disclosure,
 * and freshness reads `latest_heartbeat_at` here, so visual heartbeat
 * coalescing in the client can never change what "fresh" means.
 */
function projectActivityMeta(indexed: IndexedPass[], passes: PassView[], observedAt: string): ActivityStreamMetaView {
  const events = passes.flatMap((pass) => pass.events);
  const dated = events.map((event) => event.ts_utc).filter((value): value is string => value !== null);
  const heartbeats = events
    .filter((event) => event.kind === "heartbeat")
    .map((event) => event.ts_utc)
    .filter((value): value is string => value !== null);
  const reasons: string[] = [];
  for (const pass of indexed) {
    if (pass.events_corrupt !== undefined) reasons.push(`${passId(pass.row.app, pass.row.runId)}: ${pass.events_corrupt}`);
  }
  for (const pass of passes) {
    const artifact = pass.artifacts.find((entry) => entry.kind === "events");
    if (artifact !== undefined && artifact.expired) reasons.push(`${pass.id}: structured events expired by retention`);
  }
  return {
    order: "newest_first",
    order_key_fields: [...ACTIVITY_ORDER.key_fields],
    tie_break: ACTIVITY_ORDER.tie_break,
    total_events: events.length,
    undated_events: events.filter((event) => event.ts_utc === null).length,
    clock_skew_event_ids: events
      .filter((event) => event.ts_utc !== null && event.ts_utc > observedAt)
      .map((event) => event.id)
      .sort(compareStable),
    completeness: reasons.length === 0 ? "complete" : "partial",
    incomplete_reasons: [...new Set(reasons)].sort(compareStable),
    latest_event_at: dated.sort(compareStable).at(-1) ?? null,
    latest_heartbeat_at: heartbeats.sort(compareStable).at(-1) ?? null,
  };
}

/**
 * Walks the finished snapshot for canonical instants that are meaningfully in
 * the future and reports them as a warning. The 30s tolerance is the one
 * already encoded in `passLiveness`, so ordinary NTP jitter never floods the
 * header. Never produces a negative duration (invariant 11).
 */
function collectSkew(snapshot: ObserveSnapshotV1, nowMs: number): TimePolicyView["skew"] {
  const canonical = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
  const sources: string[] = [];
  let maxFuture = 0;
  const walk = (value: unknown, owner: string, path: string): void => {
    if (typeof value === "string") {
      if (!canonical.test(value)) return;
      const ahead = Date.parse(value) - nowMs;
      if (ahead <= CLOCK_SKEW_TOLERANCE_MS) return;
      maxFuture = Math.max(maxFuture, ahead);
      sources.push(owner === "" ? path : `${owner}.${path}`);
      return;
    }
    if (Array.isArray(value)) {
      for (const entry of value) walk(entry, owner, path);
      return;
    }
    if (value === null || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    // The nearest enclosing `id` qualifies the field path, so a report reads
    // `pass:alpha:run-1.started_at` rather than an anonymous index chain.
    const nextOwner = typeof record["id"] === "string" ? record["id"] : owner;
    for (const [key, entry] of Object.entries(record)) {
      if (key === "generated_at" || key === "observed_at" || key === "cursor") continue;
      walk(entry, nextOwner, key);
    }
  };
  // Only the entities that carry SOURCE instants. Traces and activity rows are
  // derived from these, so walking them too would report one skewed clock many
  // times over.
  walk(snapshot.passes, "", "passes");
  walk(snapshot.approvals, "", "approvals");
  walk(snapshot.parent_tasks, "", "parent_tasks");
  walk(snapshot.pending_intake.rows, "", "pending_intake");
  if (sources.length === 0) return null;
  return {
    future_instants: sources.length,
    max_future_ms: Math.max(0, maxFuture),
    sources: [...new Set(sources)].sort(compareStable),
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
  const events: EventView[] = indexed.events.map((event, index) => {
    const detail = scrubEventDetail(event.detail ?? {});
    const tsUtc = instant(event.ts);
    const tool = detail["tool"];
    return {
      id: `${row.app}:${row.runId}:event:${index}`,
      ts: event.ts,
      seq: index,
      ts_utc: tsUtc,
      order_key: buildOrderKey({ ts_utc: tsUtc, app: row.app, run_id: row.runId, seq: index }),
      kind: eventKind(event.event),
      outcome: eventOutcome(event.event, detail),
      // Already scrubbed by scrubEventDetail; still never raw tool arguments.
      tool_name: event.event === "tool.called" && typeof tool === "string" ? tool : null,
      coalesce_key: event.event === "pass.heartbeat" ? `heartbeat:${passId(row.app, row.runId)}` : null,
      event: event.event,
      severity: event.severity,
      span_id: event.span_id,
      parent_span_id: event.parent_span_id ?? null,
      error_code: event.error_code ?? null,
      detail,
    };
  });
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
    started_at: instant(row.startedAt),
    finished_at: instant(indexed.envelope_finished_at),
    last_heartbeat_at: instant(row.lastSeenAt),
    // Clamped: a skewed clock produces a warning, never a negative duration.
    wall_clock_ms: status === "running" ? null : Math.max(0, row.durationMs),
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
      heartbeat_at: instant(lock.heartbeatAt),
      fresh: now.getTime() - new Date(lock.heartbeatAt).getTime() <= 2 * 60 * 1000,
    },
    observed_at: instant(now)!,
    quality_reason: passQualityReason(indexed, status),
  };
}

/** A recorded-but-unreadable timestamp is disclosed on the entity that carries
 *  it. It is never rendered as 'Invalid Date' and never coerced to epoch zero. */
function passQualityReason(indexed: IndexedPass, status: string): string | null {
  const reasons: string[] = [];
  if (indexed.events_corrupt !== undefined) reasons.push(indexed.events_corrupt);
  else if (status.startsWith("corrupt")) reasons.push("Envelope is unreadable");
  const unreadable = ([
    ["started_at", indexed.row.startedAt],
    ["last_seen_at", indexed.row.lastSeenAt],
    ["finished_at", indexed.envelope_finished_at],
  ] as const).filter(([, value]) => unreadableInstant(value)).map(([field]) => field);
  if (unreadable.length > 0) reasons.push(`Recorded timestamp is unreadable: ${unreadable.join(", ")}`);
  return reasons.length === 0 ? null : reasons.join("; ");
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

function projectTraces(passes: PassView[], observedAt: string, byRun: Map<string, TurnRecord[]>): TraceView[] {
  const groups = new Map<string, PassView[]>();
  for (const pass of passes) {
    const key = `${pass.app}\u0000${pass.trace_id}`;
    groups.set(key, [...(groups.get(key) ?? []), pass]);
  }
  const projected = [...groups.values()].map<TraceView>((group) => {
    const ordered = [...group].sort((a, b) => ascendingNullsLast(a.started_at, b.started_at) || compareStable(a.id, b.id));
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
    const startedAt = ordered[0]!.started_at;
    const finishedAt = group.every((pass) => pass.finished_at !== null)
      ? [...group].map((pass) => pass.finished_at!).sort(compareStable).at(-1) ?? null
      : null;
    // Observed passes first in the already-stable `ordered` sequence, then
    // skipped, then missing. `missing` is empty whenever the manifest was not
    // recorded, so a legacy trace emits ZERO `not_observed` nodes rather than a
    // fabricated pipeline of grey pending stages (invariant 13, design.md §5.3).
    const graphNodes: TraceNodeView[] = [
      ...ordered.map<Omit<TraceNodeView, "order">>((pass) => ({
        kind: "pass",
        pass_id: pass.id,
        pass: pass.pass,
        role: pass.role,
        runtime: pass.runtime,
        model: pass.model,
        status: pass.status,
        liveness: pass.liveness,
        state_token: graphState(pass),
        reason: null,
      })),
      ...[...skipped].sort((a, b) => compareStable(a.pass, b.pass)).map<Omit<TraceNodeView, "order">>((entry) => ({
        kind: "skipped",
        pass_id: null,
        pass: entry.pass,
        role: null,
        runtime: null,
        model: null,
        status: "skipped",
        liveness: null,
        state_token: "skipped",
        // Verbatim. A completeness diff would report this deliberate routing
        // decision as a gap and lose the reason entirely.
        reason: entry.reason,
      })),
      ...[...missing].sort(compareStable).map<Omit<TraceNodeView, "order">>((pass) => ({
        kind: "missing",
        pass_id: null,
        pass,
        role: null,
        runtime: null,
        model: null,
        status: "not_observed",
        liveness: null,
        state_token: "not_observed",
        reason: null,
      })),
    ].map((entry, order) => ({ order, ...entry }));
    const aggregate = costForPasses(group, byRun);
    return {
      id: `trace:${raw!.app}:${raw!.trace_id}`,
      trace_id: raw!.trace_id,
      app: raw!.app,
      ticket: raw!.ticket,
      parent_task_id: raw!.parent_task_id,
      // Real identity only: the trace's OWN recorded parent task. Matching a
      // task's `trace_ids` on a bare trace id would claim the beta trace for an
      // alpha task whenever the two share an id (invariants 2 and 3).
      parent_session_id: raw!.parent_task_id === null ? null : `task:${raw!.parent_task_id}`,
      pipeline: raw!.pipeline,
      pass_ids: ordered.map((pass) => pass.id),
      required_passes: required,
      observed_passes: [...new Set(indexed)],
      skipped_passes: skipped,
      missing_passes: missing,
      status,
      started_at: startedAt,
      finished_at: finishedAt,
      // Reuses the shared key builder for its '0'/'1' dated-before-undated prefix
      // — that prefix is what puts an undated trace LAST under a descending sort
      // rather than first by lexicographic accident. Identity is deliberately
      // EXCLUDED from the key: `orderRows` applies the direction sign to the
      // whole primary key, so folding app/trace id in would reverse the tie-break
      // too, and "ties by trace id ascending" would be a false claim.
      order_key: buildOrderKey({ ts_utc: startedAt, app: "", run_id: "", seq: 0 }),
      duration: durationBetween(startedAt, finishedAt),
      manifest: required === null ? "not_recorded" : "recorded",
      pass_counts: {
        observed: ordered.length,
        skipped: skipped.length,
        missing: missing.length,
        required: required === null ? null : required.length,
      },
      active_passes: group.filter((pass) => pass.status === "running").length,
      cost: aggregate.cost,
      recorded_cost_usd: aggregate.cost.known_cost_usd,
      usage_quality: aggregate.usage_quality,
      graph_nodes: graphNodes,
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
  });
  // ONE ordering primitive, the same one the activity chronology uses. Sorting
  // on `order_key` rather than on the raw instant is what puts undated traces
  // LAST under newest-first, and `orderRows`' always-ascending identity
  // tie-break is what keeps two same-instant traces from silently reversing —
  // which `[...traces].sort(byStartedAt).reverse()` would do.
  return orderRows(projected, (trace) => trace.order_key, (trace) => trace.id, "newest_first");
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

function projectParentTasks(input: ObserveProjectionInput, passes: PassView[], traces: TraceView[], observedAt: string, byRun: Map<string, TurnRecord[]>): ParentTaskView[] {
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
    const taskCost = costForPasses(taskPasses, byRun);
    return {
      id: `task:${record.taskId}`,
      task_id: record.taskId,
      app: record.app ?? null,
      objective: truncatePreview(scrubSecrets(record.objective), 320),
      completion_criteria: record.completionCriteria !== undefined ? truncatePreview(scrubSecrets(record.completionCriteria), 400) : null,
      status: record.status,
      execution_mode: record.executionMode,
      started_at: instant(record.startedAt),
      ended_at: instant(record.endedAt),
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
      duration: durationBetween(instant(record.startedAt), instant(record.endedAt), "Parent task"),
      // Counted from the already-correlated pass/trace sets — never from text,
      // titles, or timestamp proximity (invariant 2).
      trace_count: taskTraces.length,
      pass_count: taskPasses.length,
      active_passes: taskPasses.filter((pass) => pass.status === "running").length,
      cost: taskCost.cost,
      recorded_cost_usd: taskCost.cost.known_cost_usd,
      usage_quality: taskCost.usage_quality,
      observed_at: observedAt,
      source_refs: [{ source: "parent_task", ref: `tasks/${record.taskId}/task.json` }],
    };
  }).sort((a, b) => descendingNullsLast(a.started_at, b.started_at) || compareStable(a.id, b.id));
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
    raised_at: instant(item.raisedAt)!,
    decided_at: instant(item.decidedAt),
    expires_at: instant(grant?.expiresAt),
    scope: grant?.scope === undefined ? null : `${grant.scope.kind}:${grant.scope.rule}${grant.scope.pathContains === undefined ? "" : `:${grant.scope.pathContains}`}`,
    reason: item.reason !== undefined ? truncatePreview(scrubSecrets(item.reason), 240) : null,
    execution_state: item.execution?.state ?? null,
    execution_attempts: item.execution?.attempts ?? 0,
    execution_actor: item.execution?.actor ?? null,
    execution_result: item.execution?.result === undefined ? null : truncatePreview(scrubSecrets(item.execution.result), 240),
    execution_failure_cause: item.execution?.failureCause ?? null,
    execution_next_action: item.execution?.nextAction ?? null,
    execution_remote_ref: item.execution?.remoteRef ?? null,
    execution_attempted_at: instant(item.execution?.attemptedAt),
    execution_finished_at: instant(item.execution?.finishedAt),
    observed_at: instant(now)!,
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
      // Same total order as the activity stream: a raw `ts` string compare has
      // no tie-break and sorts a non-UTC offset wrong, so the two surfaces
      // could disagree about which event is latest.
      const latestEvent = entry.passes.flatMap((pass) => pass.events).sort((a, b) => compareStable(b.order_key, a.order_key))[0];
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
  // Which review is "latest" decides `review_integrity`, so it must be an
  // instant compare, not a raw-string one: GitHub can emit a non-UTC offset,
  // and the `?? ""` fallback silently ranked an undated review as oldest-wins.
  const latest = [...reviews]
    .sort((a, b) => descendingNullsLast(instant(a.submittedAt), instant(b.submittedAt)))[0];
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
      submitted_at: instant(review.submittedAt),
      author: review.author ?? null,
    })),
    review_integrity: reviewIntegrity,
    checks: checks.map((check) => ({ name: check.name, state: check.state, link: check.link ?? null })),
    check_integrity: checkIntegrity,
  };
}

// Plain-language labels. Closed vocabulary with a TOTAL fallback: an operator
// must never have to know an internal pipeline name to read the section, and a
// label is never null or empty (#94).
const TRIGGER_LABELS: Readonly<Record<string, string>> = Object.freeze({
  schedule: "Ran on a schedule",
  event: "Woken by a company event",
  manual: "Started by a human command",
});
const TRIGGER_SOURCE_LABELS: Readonly<Record<string, string>> = Object.freeze({
  schedule: "Org schedule",
  event: "Company event file drop",
  manual: "Human operator command",
});
/** The four contract kinds in docs/scheduler/event-schemas.md. */
const EVENT_KIND_LABELS: Readonly<Record<string, string>> = Object.freeze({
  "health-alert": "Service health alert",
  "support-feedback": "User feedback from a support channel",
  "adoption-signal": "Product adoption signal",
  "launch-calendar": "Planned launch date",
});

function triggerLabel(trigger: string | null): string {
  if (trigger === null) return "Trigger not recorded";
  return TRIGGER_LABELS[trigger] ?? `Trigger: ${trigger}`;
}

function triggerSourceLabel(trigger: string | null): string {
  if (trigger === null) return "Recorded run evidence";
  return TRIGGER_SOURCE_LABELS[trigger] ?? "Recorded run evidence";
}

function eventKindLabel(kind: string | null): string {
  if (kind === null) return "Company event: kind not recorded";
  return EVENT_KIND_LABELS[kind] ?? `Company event: ${kind}`;
}

function activityLabel(kind: ActivityKind): string {
  if (kind === "planning") return "Planning activity";
  if (kind === "learning") return "Learning activity";
  if (kind === "onboarding") return "Onboarding activity";
  if (kind === "company_event") return "Company-event activity";
  if (kind === "scheduled_role") return "Scheduled role activity";
  return "Role activity";
}

/**
 * RECORDED executions only. Every row is dated by construction: a trace whose
 * passes carry no readable instant cannot produce an `occurred_at`, so it is
 * excluded rather than collapsed to the empty string and sorted to an arbitrary
 * end of what reads as a chronology (#94).
 */
function projectActivityHistory(
  input: ObserveProjectionInput,
  passes: PassView[],
  observedAt: string,
  direction: OrderDirection,
): ActivityView[] {
  const rows: ActivityView[] = [];
  const traces = new Map<string, PassView[]>();
  for (const pass of passes.filter((candidate) => candidate.ticket === null)) {
    const key = `${pass.app}${ORDER_SEPARATOR}${pass.trace_id}`;
    traces.set(key, [...(traces.get(key) ?? []), pass]);
  }
  for (const group of traces.values()) {
    const ordered = [...group].sort((a, b) => ascendingNullsLast(a.started_at, b.started_at) || compareStable(a.id, b.id));
    const first = ordered[0]!;
    const latest = [...group].sort((a, b) =>
      descendingNullsLast(a.finished_at ?? a.started_at, b.finished_at ?? b.started_at) || compareStable(a.id, b.id),
    )[0]!;
    const startedAt = first.started_at;
    const occurredAt = latest.finished_at ?? latest.started_at;
    // The type invariant made visible: no readable instant, no chronology.
    if (startedAt === null || occurredAt === null) continue;
    const trigger = ledgerTrigger(input, first);
    const roles = [...new Set(group.map((pass) => pass.role))].sort(compareStable);
    rows.push({
      id: `intake:trace:${first.app}:${first.trace_id}`,
      app: first.app,
      kind: activityKind(first),
      status: traceStatus(group, []),
      title: `${first.pipeline} · ${roles.join(", ")}`,
      summary: `${activityLabel(activityKind(first))} by ${roles.join(", ")}`,
      trigger,
      trigger_label: triggerLabel(trigger),
      source_label: triggerSourceLabel(trigger),
      pipeline: first.pipeline,
      trace_id: first.trace_id,
      parent_task_id: first.parent_task_id,
      // Real identity only. The trace form is byte-identical to projectTraces'
      // `trace:${app}:${trace_id}` template, so a cross-app trace-id collision
      // can never collapse two rows onto one session (invariant 3).
      session_ref: first.parent_task_id !== null
        ? { id: `task:${first.parent_task_id}`, kind: "task" as const }
        : { id: `trace:${first.app}:${first.trace_id}`, kind: "trace" as const },
      started_at: startedAt,
      latest_at: occurredAt,
      occurred_at: occurredAt,
      result_refs: group.flatMap((pass) => pass.result_refs),
      observed_at: observedAt,
      quality_reason: null,
    });
  }
  return orderRows(rows, (row) => row.occurred_at, (row) => row.id, direction);
}

const PENDING_STATE_LABELS: Readonly<Record<PendingIntakeState, string>> = Object.freeze({
  pending: "Pending — not yet consumed",
  corrupt: "Corrupt — unreadable on disk",
  awaiting_promotion: "Awaiting promotion",
});

/**
 * Undated (or independently-timed) work waiting to be picked up. Explicitly NOT
 * a sequence: it is ordered only within its own section so the list is stable,
 * and `discovered_at` is a filesystem observation that may be DISPLAYED but is
 * never a correlation key and is never promoted into `occurred_at`.
 */
function projectPendingIntake(input: ObserveProjectionInput, observedAt: string): PendingIntakeItemView[] {
  const rows: PendingIntakeItemView[] = [];
  for (const app of input.apps) {
    if (app.status !== "onboarding") continue;
    rows.push({
      id: `intake:onboarding:${app.name}`,
      app: app.name,
      source: "app_lifecycle",
      source_label: "App registry (apps.yaml)",
      state: "awaiting_promotion",
      state_label: PENDING_STATE_LABELS.awaiting_promotion,
      event_kind: null,
      event_id: null,
      title: `${app.name} onboarding`,
      trigger_label: "Recorded app lifecycle state",
      occurred_at: null,
      discovered_at: null,
      timestamp_basis: "none",
      result_refs: [{ source: "org", ref: "apps.yaml" }],
      observed_at: observedAt,
      quality_reason: "Lifecycle is authoritative from apps.yaml; promotion is not an observer action",
    });
  }
  for (const item of input.inbox) {
    if (item.app === null && item.error === undefined) continue;
    const occurredAt = instant(item.occurred_at);
    const discoveredAt = instant(item.discovered_at);
    const state: PendingIntakeState = item.error === undefined ? "pending" : "corrupt";
    // The basis says which clock the operator is actually reading. A received
    // time is never presented as an event time.
    const basis = occurredAt !== null ? "occurred" : discoveredAt !== null ? "discovered" : "none";
    rows.push({
      id: `intake:event:${item.filename}`,
      app: item.app ?? "unattributed",
      source: "event_inbox",
      source_label: "Company event file drop",
      state,
      state_label: PENDING_STATE_LABELS[state],
      event_kind: item.kind,
      event_id: item.event_id ?? null,
      title: truncatePreview(scrubSecrets(item.kind === null ? item.filename : `${item.kind} · ${item.filename}`), 180),
      trigger_label: truncatePreview(scrubSecrets(eventKindLabel(item.kind)), 180),
      occurred_at: occurredAt,
      discovered_at: discoveredAt,
      timestamp_basis: basis,
      result_refs: [{ source: "event_inbox", ref: `state/events/inbox/${item.filename}` }],
      observed_at: observedAt,
      quality_reason: item.error ?? (unreadableInstant(item.occurred_at) ? "Recorded event timestamp is unreadable" : null),
    });
  }
  // Section-local presentation order ONLY. This ordering must never be used to
  // correlate or group anything (invariant 2).
  return orderRows(rows, (row) => row.occurred_at ?? row.discovered_at ?? "", (row) => row.id, "newest_first");
}

/**
 * One emission: the flat item the snapshot has always carried, plus the
 * occurrence-level facts that legitimately differ within a cause group.
 */
interface AttentionSpec {
  severity: AttentionItemView["severity"];
  kind: string;
  /** ALWAYS read from a typed, closed-vocabulary field — never from `title`,
   *  `detail`, a timestamp, or any model-produced text (invariant 2). */
  cause: string;
  groupable: boolean;
  app: string | null;
  entityId: string | null;
  entityKind: AttentionOccurrenceView["entity_kind"];
  /** The flat item's title/detail — unchanged from before grouping existed.
   *  `snapshot.attention` keeps the complete unaggregated truth. */
  title: string;
  detail: string;
  /** Cause-level strings for the group card: identical for every occurrence by
   *  construction, so the card never copies the first occurrence's text. */
  groupTitle: string;
  groupDetail: string;
  /** Entity-level concise label, e.g. `builder/implement` or `#12 Fix flake`. */
  summary: string;
  /** Per-occurrence divergent text (liveness/terminal/quality reason). */
  occurrenceDetail: string;
  /** A real durable instant, or null. NEVER the snapshot time, which is
   *  identical for every item and therefore useless as an ordering key. */
  occurredAt: string | null;
  evidenceRefs: SourceRefView[];
  observedAt: string;
  /** Correlation facts carried for the group's `affected` summary. Real
   *  identity fields only — never parsed out of any label. */
  traceId?: string | null;
  ticket?: string | null;
}

interface AttentionEmission {
  item: AttentionItemView;
  occurrence: AttentionOccurrenceView;
  spec: AttentionSpec;
  causeKey: string;
  groupId: string;
}

/** Group ids stay in `[A-Za-z0-9:_.-]` so a follow-up `?attention_open=<id>`
 *  URL parameter is possible without changing the key. */
function idSafe(value: string): string {
  return value.replace(/[^A-Za-z0-9:_.-]/g, "_");
}

function attention(spec: AttentionSpec): AttentionEmission {
  const scope = spec.app ?? "*org*";
  const causeKey = spec.groupable
    ? [spec.kind, spec.cause, scope].join(ORDER_SEPARATOR)
    : [spec.kind, spec.cause, scope, spec.entityId ?? spec.title].join(ORDER_SEPARATOR);
  const groupId = spec.groupable
    ? `attention-group:${idSafe(spec.kind)}:${idSafe(spec.cause)}:${idSafe(spec.app ?? "org")}`
    // Without the entity id appended, two independently actionable conditions
    // would collide on one id (e.g. two returned tickets on the same app).
    : `attention-group:${idSafe(spec.kind)}:${idSafe(spec.cause)}:${idSafe(spec.app ?? "org")}:${idSafe(spec.entityId ?? spec.title)}`;
  const item: AttentionItemView = {
    id: `attention:${spec.kind}:${spec.entityId ?? spec.title}`,
    severity: spec.severity,
    kind: spec.kind,
    app: spec.app,
    entity_id: spec.entityId,
    title: truncatePreview(scrubSecrets(spec.title), 180),
    detail: truncatePreview(scrubSecrets(spec.detail), 400),
    observed_at: spec.observedAt,
    group_id: groupId,
  };
  const occurrence: AttentionOccurrenceView = {
    id: spec.entityId ?? item.id,
    app: spec.app,
    entity_id: spec.entityId,
    entity_kind: spec.entityKind,
    summary: truncatePreview(scrubSecrets(spec.summary), 180),
    detail: truncatePreview(scrubSecrets(spec.occurrenceDetail), 400),
    occurred_at: spec.occurredAt,
    evidence_refs: spec.evidenceRefs,
  };
  return { item, occurrence, spec, causeKey, groupId };
}

function projectAttention(
  input: ObserveProjectionInput,
  passes: PassView[],
  delivery: DeliveryTicketView[],
  approvals: ApprovalView[],
  observedAt: string,
): { items: AttentionItemView[]; groups: AttentionGroupView[] } {
  const out: AttentionEmission[] = [];
  for (const approval of approvals.filter((item) => item.status === "pending")) {
    out.push(attention({
      severity: "warning", kind: "pending_approval", cause: approval.rule, groupable: true,
      app: approval.app, entityId: approval.id, entityKind: "approval",
      title: `Approval ${approval.approval_id} is waiting`, detail: approval.rule,
      groupTitle: "Approval is waiting", groupDetail: approval.rule,
      summary: `${approval.approval_id} · ${approval.role}`,
      occurrenceDetail: approval.reason ?? "No reason recorded",
      occurredAt: approval.raised_at, evidenceRefs: approval.source_refs, observedAt,
    }));
  }
  for (const approval of approvals.filter((item) => item.execution_state === "failed" || item.execution_state === "ambiguous")) {
    out.push(attention({
      severity: "error", kind: "approval_delivery", cause: approval.execution_state!, groupable: true,
      app: approval.app, entityId: approval.id, entityKind: "approval",
      title: `Approval ${approval.approval_id} delivery is ${approval.execution_state}`,
      detail:
        `attempt ${approval.execution_attempts}; actor ${approval.execution_actor ?? "unrecorded"}; ` +
        `result ${approval.execution_result ?? "unrecorded"}; next ${approval.execution_next_action ?? "unrecorded"}`,
      groupTitle: `Approval delivery is ${approval.execution_state}`,
      groupDetail: "Delivery requires reconciliation before the action can be trusted",
      summary: `${approval.approval_id} · ${approval.role}`,
      occurrenceDetail:
        `attempt ${approval.execution_attempts}; actor ${approval.execution_actor ?? "unrecorded"}; ` +
        `result ${approval.execution_result ?? "unrecorded"}; next ${approval.execution_next_action ?? "unrecorded"}`,
      occurredAt: approval.execution_finished_at ?? approval.execution_attempted_at ?? approval.raised_at,
      evidenceRefs: approval.source_refs, observedAt,
    }));
  }
  for (const pass of passes) {
    const passRefs: SourceRefView[] = [{ source: "runs", ref: `runs/${pass.app}/${pass.run_id}/` }, ...pass.result_refs];
    const passSummary = `${pass.role}/${pass.pass}`;
    const correlation = { traceId: pass.trace_id, ticket: pass.ticket };
    if (pass.liveness === "stalled") {
      out.push(attention({
        severity: "error", kind: "stale_pass", cause: "stalled", groupable: true,
        app: pass.app, entityId: pass.id, entityKind: "pass",
        title: `${pass.role}/${pass.pass} is stalled`, detail: pass.liveness_reason,
        groupTitle: "Pass is stalled", groupDetail: "No heartbeat within the liveness threshold",
        summary: passSummary, occurrenceDetail: pass.liveness_reason,
        occurredAt: pass.started_at, evidenceRefs: passRefs, observedAt, ...correlation,
      }));
    }
    if (pass.status.startsWith("failed") || pass.status === "timed_out" || pass.status === "cancelled") {
      out.push(attention({
        // Cause-level title: `${role}/${pass} ${status}` differs per occurrence
        // and therefore belongs on the occurrence, not the group.
        severity: "error", kind: "failed_pass", cause: pass.status, groupable: true,
        app: pass.app, entityId: pass.id, entityKind: "pass",
        title: `${pass.role}/${pass.pass} ${pass.status}`, detail: pass.terminal_reason ?? "No terminal reason recorded",
        groupTitle: `Pass ${pass.status}`, groupDetail: "A terminal pass did not complete",
        summary: passSummary, occurrenceDetail: pass.terminal_reason ?? "No terminal reason recorded",
        occurredAt: pass.started_at, evidenceRefs: passRefs, observedAt, ...correlation,
      }));
    }
    // `none` is an authoritative zero for a pass that invoked no provider: it
    // raises NO item and is excluded from provider-turn counts. Widening this
    // to `!== "complete"` is the classic none/unavailable conflation (#88).
    if (pass.usage.quality === "partial" || pass.usage.quality === "unavailable") {
      out.push(attention({
        severity: "warning", kind: "usage_incomplete", cause: pass.usage.quality, groupable: true,
        app: pass.app, entityId: pass.id, entityKind: "pass",
        title: `Usage is ${pass.usage.quality}`, detail: "Unknown cost is not free",
        groupTitle: `Usage is ${pass.usage.quality}`, groupDetail: "Unknown cost is not free",
        summary: passSummary,
        occurrenceDetail: pass.usage.settled ? "Settled into the ledger with incomplete usage" : "Not settled into the ledger",
        occurredAt: pass.started_at, evidenceRefs: passRefs, observedAt, ...correlation,
      }));
    }
    if (pass.quality_reason !== null) {
      out.push(attention({
        severity: "error", kind: "corrupt_run", cause: "degraded_run_evidence", groupable: true,
        app: pass.app, entityId: pass.id, entityKind: "pass",
        title: "Run evidence is degraded", detail: pass.quality_reason,
        groupTitle: "Run evidence is degraded", groupDetail: "Durable run evidence could not be read in full",
        summary: passSummary, occurrenceDetail: pass.quality_reason,
        occurredAt: pass.started_at, evidenceRefs: passRefs, observedAt, ...correlation,
      }));
    }
  }
  for (const ticket of delivery.filter((item) => item.state === "returned")) {
    out.push(attention({
      // Independently actionable: two returned tickets are two decisions, so
      // they must never collapse into one card.
      severity: "warning", kind: "returned_ticket", cause: "returned", groupable: false,
      app: ticket.app, entityId: ticket.id, entityKind: "ticket",
      title: `Ticket #${ticket.issue_number} was returned`, detail: ticket.title,
      groupTitle: `Ticket #${ticket.issue_number} was returned`, groupDetail: ticket.title,
      summary: `#${ticket.issue_number} ${ticket.title}`, occurrenceDetail: ticket.quality_reason ?? "Returned for rework",
      occurredAt: ticket.observed_at, evidenceRefs: ticket.source_refs, observedAt, ticket: `#${ticket.issue_number}`,
    }));
  }
  for (const ticket of delivery.filter((item) => item.state === "merged" && item.quality_reason !== null)) {
    out.push(attention({
      severity: "warning", kind: "delivery_integrity", cause: "delivery_integrity", groupable: false,
      app: ticket.app, entityId: ticket.id, entityKind: "ticket",
      title: `Ticket #${ticket.issue_number} completion needs attention`, detail: ticket.quality_reason!,
      groupTitle: `Ticket #${ticket.issue_number} completion needs attention`, groupDetail: ticket.quality_reason!,
      summary: `#${ticket.issue_number} ${ticket.title}`, occurrenceDetail: ticket.quality_reason!,
      occurredAt: ticket.observed_at, evidenceRefs: ticket.source_refs, observedAt, ticket: `#${ticket.issue_number}`,
    }));
  }
  for (const source of input.source_health.filter((source) => source.status !== "healthy")) {
    out.push(attention({
      severity: source.status === "unavailable" ? "error" : "warning",
      kind: "source_health", cause: source.id, groupable: false,
      app: null, entityId: `source:${source.id}`, entityKind: "source",
      title: `${source.id} is ${source.status}`, detail: source.detail,
      groupTitle: `${source.id} is ${source.status}`, groupDetail: source.detail,
      summary: source.id, occurrenceDetail: source.detail,
      occurredAt: source.observed_at,
      // No durable run directory exists for a source; a plausible-looking path
      // would be a fabricated reference.
      evidenceRefs: [], observedAt,
    }));
  }
  for (const run of input.corrupt_runs) {
    out.push(attention({
      severity: "error", kind: "corrupt_run", cause: "corrupt_envelope", groupable: true,
      app: run.app, entityId: passId(run.app, run.run_id), entityKind: "pass",
      title: "Envelope is corrupt", detail: run.detail,
      groupTitle: "Envelope is corrupt", groupDetail: "The run envelope could not be parsed",
      summary: run.run_id, occurrenceDetail: run.detail,
      occurredAt: null, evidenceRefs: [{ source: "runs", ref: `runs/${run.app}/${run.run_id}/` }], observedAt,
    }));
  }
  for (const task of input.corrupt_tasks) {
    out.push(attention({
      severity: "error", kind: "corrupt_task", cause: "corrupt_task", groupable: false,
      app: null, entityId: `task:${task.task_id}`, entityKind: "task",
      title: "Parent task record is corrupt", detail: task.detail,
      groupTitle: "Parent task record is corrupt", groupDetail: task.detail,
      summary: task.task_id, occurrenceDetail: task.detail,
      occurredAt: null, evidenceRefs: [{ source: "task", ref: `tasks/${task.task_id}/task.json` }], observedAt,
    }));
  }
  for (const event of input.inbox.filter((item) => item.error !== undefined)) {
    out.push(attention({
      severity: "error", kind: "corrupt_intake", cause: "corrupt_intake", groupable: true,
      app: event.app, entityId: `event:${event.filename}`, entityKind: "intake_event",
      title: "Intake event is corrupt", detail: event.error!,
      groupTitle: "Intake event is corrupt", groupDetail: "A company-event file could not be read",
      summary: event.filename, occurrenceDetail: event.error!,
      occurredAt: instant(event.discovered_at),
      evidenceRefs: [{ source: "event_inbox", ref: `state/events/inbox/${event.filename}` }], observedAt,
    }));
  }
  // Dedupe BEFORE counting. `corrupt_run` is emitted from two call sites and
  // both can produce the same item id; grouping before this step would inflate
  // every occurrence_count.
  const deduped = uniqueBy(out, (emission) => emission.item.id);
  return { items: deduped.map((emission) => emission.item), groups: groupAttention(deduped) };
}

const SEVERITY_RANK: Record<AttentionItemView["severity"], number> = { error: 0, warning: 1 };

/**
 * Group by (kind, cause, app) — all typed, closed-vocabulary identity fields —
 * plus the entity id for independently actionable kinds. Nothing here reads
 * `title`, `detail`, a timestamp, or model-produced text.
 *
 * Ordering is fully declared and permutation-stable: severity rank, then
 * occurrence count descending, then `cause_key` ascending by CODE UNIT.
 * `localeCompare` is deliberately not used — it is ICU/locale-sensitive and
 * would make the same durable state render differently on two machines.
 */
function groupAttention(emissions: AttentionEmission[]): AttentionGroupView[] {
  const buckets = new Map<string, AttentionEmission[]>();
  for (const emission of emissions) {
    buckets.set(emission.causeKey, [...(buckets.get(emission.causeKey) ?? []), emission]);
  }
  const groups = [...buckets.entries()].map(([causeKey, members]) => {
    const head = members[0]!;
    const occurrences = [...members]
      .map((member) => member.occurrence)
      .sort((a, b) => ascendingNullsLast(a.occurred_at, b.occurred_at) || compareStable(a.id, b.id));
    const dated = occurrences.map((occurrence) => occurrence.occurred_at).filter((value): value is string => value !== null);
    const delivered = occurrences.slice(0, ATTENTION_OCCURRENCE_CAP);
    const passRefs = members.filter((member) => member.spec.entityKind === "pass");
    return {
      id: head.groupId,
      cause_key: causeKey,
      kind: head.spec.kind,
      cause: head.spec.cause,
      severity: head.spec.severity,
      groupable: head.spec.groupable,
      scope: { app: head.spec.app },
      title: truncatePreview(scrubSecrets(head.spec.groupTitle), 180),
      detail: truncatePreview(scrubSecrets(head.spec.groupDetail), 400),
      // ALWAYS the true total, independent of the delivery cap.
      occurrence_count: members.length,
      affected: {
        passes: sortedUnique(passRefs.map((member) => member.occurrence.id)),
        traces: sortedUnique(members.map((member) => member.spec.traceId ?? null)),
        tickets: sortedUnique(members.map((member) => member.spec.ticket ?? null)),
        // Deduped by LABEL — but occurrences are never deduped by label, since
        // occurrence identity is (app, runId) / approval id / repo#issue only.
        labels: sortedUnique(members.map((member) => member.occurrence.summary)),
      },
      earliest_occurred_at: dated[0] ?? null,
      latest_occurred_at: dated.at(-1) ?? null,
      occurrences: delivered,
      occurrences_delivered: delivered.length,
      occurrences_truncated: delivered.length < occurrences.length,
      observed_at: head.item.observed_at,
    } satisfies AttentionGroupView;
  });
  return groups.sort((a, b) =>
    SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
    b.occurrence_count - a.occurrence_count ||
    compareStable(a.cause_key, b.cause_key),
  );
}

function sortedUnique(values: Array<string | null>): string[] {
  return [...new Set(values.filter((value): value is string => value !== null && value !== ""))].sort(compareStable);
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

/** Delegates to the shared runtime primitive: an unsettled provider pass is
 *  contributed to the cost aggregate under this exact id by BOTH the Observer
 *  and Reports, so the two surfaces cannot name the same pass differently. */
function passId(app: string, runId: string): string {
  return providerPassRef(app, runId);
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
  // An undated pass cannot be proven to fall inside a since-window, so it is
  // excluded rather than admitted on an empty-string comparison.
  if (filters.since !== undefined && (pass.started_at === null || pass.started_at < filters.since)) return false;
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
