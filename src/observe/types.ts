import type { CostAggregate, CostScope } from "../runtime/cost.js";
import type { AppEntry } from "../org/apps.js";
import type { ApprovalGrant, ApprovalItem } from "../org/approvals.js";
import type { ParentTaskRecord } from "../org/parent-task.js";
import type { GhIssue, GhPullRequest, GhReview } from "../loop/github.js";
import type { RunlogEvent } from "../runtime/runlog/events.js";
import type { StatusRow } from "../runtime/runlog/status.js";
import type { InvocationRecord, TurnRecord } from "../runtime/telemetry.js";
import type { TurnLock } from "../org/locks.js";
import type { BudgetRow } from "../org/budget.js";
import type { ValidationCampaignReadResult } from "../org/validation-campaign.js";
import type { RoadmapExplanationV1 } from "../org/roadmap-explanation.js";

/** Bumped 1 → 2 once for the observer-diagnostics workstream (#91/#93/#94/#97).
 *  Additive fields alone would not have required it, but `intake` was REMOVED
 *  and replaced by the two typed collections `activity_history` +
 *  `pending_intake`, which is a breaking read-model change. The observer
 *  persists no cache and has no consumer outside the bundled client that ships
 *  in the same package, so exactly one bump covers the whole workstream.
 *  Rationale recorded in docs/live-ui/design.md §6.3.
 *
 *  The observer-traces workstream (#95/#96/#98) rides the SAME bump: every one
 *  of its read-model changes is additive (`TraceNodeView`, per-entity duration /
 *  counts / cost, `traces_scope`, `scope_statement`, `cost_window`) and nothing
 *  was removed or retyped, so a second bump would signal a break that did not
 *  happen. One bump covers the branch. */
export const OBSERVE_SCHEMA_VERSION = 2 as const;

export type SourceStatus = "healthy" | "degraded" | "unavailable";
/** `none` is an authoritative zero for a pass that invoked no provider (#88).
 *  Mirrors UsageQuality in src/runtime/types.ts. */
export type UsageQuality = "complete" | "partial" | "estimated" | "unavailable" | "none";
export type Liveness = "live" | "stalled" | "terminal" | "unknown";
export type ActivityKind =
  | "onboarding"
  | "planning"
  | "scheduled_role"
  | "company_event"
  | "manual_role"
  | "learning";
export type DeliveryState =
  | "backlog"
  | "ready"
  | "building"
  | "in_review"
  | "blocked_on_approval"
  | "returned"
  | "merged"
  | "closed_unknown";

export interface ObserveFiltersV1 {
  app?: string;
  parent_task?: string;
  ticket?: number;
  status?: string;
  role?: string;
  since?: string;
  /** Operator-pinned direction for the recorded-activity chronology. The
   *  projection is the single orderer and the single source of the direction
   *  label, so the client can never drift from what it was handed. */
  order?: OrderDirection;
}

// --- Shared scope / ordering primitives -----------------------------------
// Every ordered or capped collection in the read model declares its scope,
// ordering direction, stable tie-breaker, and completeness. Declaring them here
// (not in the client) is what makes them assertable in project.test.ts and
// reusable across sections instead of being reinvented per bare list.

export type OrderDirection = "newest_first" | "chronological";

export interface OrderingView {
  sort_key: string;
  direction: OrderDirection;
  label: string;
  tie_breaker: string;
}

export interface SectionScopeView {
  label: string;
  /** The PRE-cap, pre-client-filter count. The honest denominator. */
  total: number;
  returned: number;
  truncated: boolean;
  cap: number | null;
  ordering: OrderingView | null;
}

/**
 * Why a duration is not a number. A recorded interval is only measurable when
 * BOTH endpoints were recorded and readable and the finish does not precede the
 * start. Every other case is a typed, displayable reason — never a negative
 * number, never `Math.abs`, never a substituted `Date.now()` (invariant 11).
 */
export type DurationQuality = "measured" | "running" | "unrecorded" | "clock_skew";

export interface DurationView {
  ms: number | null;
  quality: DurationQuality;
  /** Verbatim operator-facing cause; null exactly when `quality` is `measured`. */
  unknown_reason: string | null;
}

/**
 * The single closed vocabulary for an execution-graph node. The legend, the
 * stylesheet, and the tests all read THIS array, so a state the projection can
 * emit but the legend does not explain (or a legend row for a state that can
 * never occur) is a mechanical test failure rather than a reading an operator
 * has to discover is wrong.
 */
export const GRAPH_NODE_STATES = Object.freeze([
  "not_started",
  "running",
  "completed",
  "blocked",
  "failed",
  "skipped",
  "not_observed",
  "unknown",
] as const);
export type GraphNodeState = (typeof GRAPH_NODE_STATES)[number];

/**
 * One node in a trace's execution graph. Identity, typed status, and the
 * routing reason ONLY — no previews, no verdict text, no artifacts, no tool
 * arguments. Adding a preview here would leak L3 evidence into the SSE payload
 * through a path the pass-level redaction tests do not cover (invariant 5).
 */
export interface TraceNodeView {
  order: number;
  kind: "pass" | "skipped" | "missing";
  /** Composite pass identity, or null for a node that was never executed. */
  pass_id: string | null;
  pass: string;
  role: string | null;
  runtime: string | null;
  model: string | null;
  status: string;
  liveness: Liveness | null;
  state_token: GraphNodeState;
  /** Verbatim `trace_plan.skipped_passes[].reason`. Never truncated, never
   *  title-cased, never re-derived from a completeness diff. */
  reason: string | null;
}

/**
 * What the header totals actually cover. Deliberately NOT named
 * `SectionScopeView` — that type means label/total/returned/truncated/cap and
 * answers "is this list complete", where this one answers "what does this
 * number include". The client composes the client-owned trace scope on top.
 */
export interface ScopeStatementView {
  /** The post-filter app names the totals cover — never every configured app. */
  apps: string[];
  app_filter: string | null;
  time_range: {
    start_utc: string | null;
    end_utc: string;
    basis: "all_recorded" | "since_filter";
  };
  /** Canonical sorted `key=value` list derived ONLY from ObserveFiltersV1, so
   *  identical filter state is a byte-identical statement. */
  filters: string[];
}

/** The read model DECLARES its timezone contract, exactly as the ratified
 *  sibling `ReportRange.display_timezone` does (docs/reporting/design.md
 *  §320-326). The client must never have to assume UTC. */
export interface TimePolicyView {
  source_timezone: "UTC";
  /** The default display zone the client APPLIES — it is read, not decorative.
   *  `viewer_local` renders each instant in the viewer's zone with a visible
   *  zone token and exact UTC in the title; an explicit `?tz=` pins the
   *  operator's choice over it. */
  display_timezone: "UTC" | "viewer_local";
  instant_format: "iso8601-utc-ms";
  /** Clock skew is a warning, never a negative duration (invariant 11). */
  skew: { future_instants: number; max_future_ms: number; sources: string[] } | null;
}

export interface SourceRefView {
  source: string;
  ref: string;
}

export interface SourceHealthView {
  id: "local_files" | "github" | "approvals" | "ledger" | "scheduler" | "roadmap_delivery";
  status: SourceStatus;
  observed_at: string;
  detail: string;
  last_success_at: string | null;
}

export interface OrgView {
  name: string;
  state_home_id: string;
  max_concurrent_turns: number;
  active_passes: number;
  read_only: true;
}

export interface AppView {
  id: string;
  name: string;
  repo: string;
  lifecycle: AppEntry["status"];
  budget_usd_month: number;
  recorded_monthly_cost_usd: number;
  usage_quality: UsageQuality;
  /** Month rollup status and the ACTUAL durable overlay state are separate:
   *  an exceeded rollup can precede the overlay transaction, and a paused
   *  overlay must stay visible until enforcement removes it. */
  budget_status: BudgetRow["status"];
  budget_paused: boolean;
  /** Month-to-date settled-ledger aggregate for this app (#89, #90). */
  cost: CostAggregate;
  /** The projection ASSERTS that the budget figures above are an app-wide
   *  month-to-date fact, so the client can LABEL them under a historical
   *  selection instead of inventing the claim or silently rescoping them
   *  (invariant 14). Never narrowed by `filters.since`/`parent_task`/`ticket`. */
  cost_window: {
    basis: "month_to_date";
    start_utc: string;
    end_utc: string;
    app_wide: true;
  };
  channels: { support: string[]; marketing: string[] };
  channel_gates: string[];
  observed_at: string;
  source_refs: SourceRefView[];
}

/**
 * A RECORDED execution. Dated-ness is a TYPE invariant here: `started_at`,
 * `latest_at`, and the declared sort key `occurred_at` are non-nullable, so
 * pushing an undated row into a chronology is a compile error rather than a
 * test-only guarantee. Undated pending work lives in `PendingIntakeItemView`,
 * whose `occurred_at` IS nullable — the asymmetry is the point (#94).
 */
export interface ActivityView {
  id: string;
  app: string;
  kind: ActivityKind;
  status: string;
  title: string;
  /** Plain language, no internal pipeline names — e.g. "Planning activity by planner". */
  summary: string;
  trigger: string | null;
  /** Closed-vocabulary plain-language label; never null, never empty. */
  trigger_label: string;
  source_label: string;
  pipeline: string;
  trace_id: string | null;
  parent_task_id: string | null;
  /** Real identity only: the parent task id, or the `trace:${app}:${trace_id}`
   *  template projectTraces already emits. Never derived from title/branch/time. */
  session_ref: { id: string; kind: "task" | "trace" } | null;
  started_at: string;
  latest_at: string;
  /** The declared sort key. Equals `latest_at`. */
  occurred_at: string;
  result_refs: SourceRefView[];
  observed_at: string;
  quality_reason: string | null;
}

export type IntakeSource = "event_inbox" | "app_lifecycle";
export type PendingIntakeState = "pending" | "corrupt" | "awaiting_promotion";
export type TimestampBasis = "occurred" | "discovered" | "none";

export interface PendingIntakeItemView {
  id: string;
  app: string;
  source: IntakeSource;
  source_label: string;
  state: PendingIntakeState;
  state_label: string;
  event_kind: string | null;
  event_id: string | null;
  title: string;
  trigger_label: string;
  /** Nullable by design — a pending item may have no recorded event time. */
  occurred_at: string | null;
  /** Filesystem observation. DISPLAY-ONLY and explicitly NOT a correlation key
   *  (docs/live-ui/design.md §6.4). */
  discovered_at: string | null;
  timestamp_basis: TimestampBasis;
  result_refs: SourceRefView[];
  observed_at: string;
  quality_reason: string | null;
}

export interface DeliveryTicketView {
  id: string;
  app: string;
  repo: string;
  issue_number: number;
  title: string;
  url: string | null;
  state: DeliveryState;
  labels: string[];
  priority: number | null;
  tier: string | null;
  dependencies: number[];
  dependency_blocked: boolean;
  scheduler_rank: number | null;
  active_pass_ids: string[];
  branch: string | null;
  pull_requests: PullRequestView[];
  latest_event: string | null;
  observed_at: string;
  quality_reason: string | null;
  source_refs: SourceRefView[];
}

export interface PullRequestView {
  number: number;
  url: string | null;
  state: string;
  head_ref: string;
  head_sha: string | null;
  merge_commit: string | null;
  reviews: Array<{
    state: string;
    commit_id: string | null;
    submitted_at: string | null;
    author: string | null;
  }>;
  review_integrity: "fresh_approved" | "stale_approval" | "changes_requested" | "missing" | "unknown";
  checks: Array<{ name: string; state: string; link: string | null }>;
  check_integrity: "green" | "red" | "pending" | "unknown";
}

export interface ParentTaskView {
  id: string;
  task_id: string;
  app: string | null;
  objective: string;
  completion_criteria: string | null;
  status: ParentTaskRecord["status"];
  execution_mode: ParentTaskRecord["executionMode"];
  started_at: string | null;
  ended_at: string | null;
  prompt: ArtifactRefView;
  prompt_sha256: string;
  required_stages: string[];
  observed_stages: string[];
  missing_required_stages: string[];
  trace_ids: string[];
  ticket_refs: string[];
  completion_integrity: CompletionIntegrityView;
  duration: DurationView;
  trace_count: number;
  pass_count: number;
  active_passes: number;
  /** Ledger-first, through the same `costForPasses` helper `TotalsView` and
   *  `TraceView` use, so a per-row figure can never contradict the header (#89). */
  cost: CostAggregate;
  recorded_cost_usd: number;
  usage_quality: UsageQuality;
  observed_at: string;
  source_refs: SourceRefView[];
}

export interface TraceView {
  /** The composite navigable identity. `trace_id` alone is NOT globally unique
   *  — two apps routinely carry the same trace id (invariant 3). */
  id: string;
  trace_id: string;
  app: string;
  ticket: string | null;
  parent_task_id: string | null;
  /** `task:${parent_task_id}` when this trace is claimed by a parent task, else
   *  null. Set ONLY from the trace's own recorded `parent_task_id` — never by
   *  matching a task's `trace_ids` on a bare, app-ambiguous trace id. This is
   *  the session the history index must navigate to, because `sessions()` emits
   *  no standalone entry for a claimed trace. */
  parent_session_id: string | null;
  pipeline: string;
  pass_ids: string[];
  required_passes: string[] | null;
  observed_passes: string[];
  skipped_passes: Array<{ pass: string; reason: string }>;
  missing_passes: string[];
  status: string;
  started_at: string | null;
  finished_at: string | null;
  /** Opaque total-order key from `buildOrderKey`. Clients sort on it, never
   *  parse it. The '0'/'1' prefix is what puts undated traces LAST under a
   *  newest-first sort rather than first by lexicographic accident. */
  order_key: string;
  duration: DurationView;
  /** `not_recorded` means no pass in this trace carried a trace plan. Expected
   *  stages are then UNKNOWN and `graph_nodes` contains zero `missing` nodes —
   *  the mechanical form of "never fabricate stages for a legacy trace"
   *  (design.md §5.3, invariant 13). */
  manifest: "recorded" | "not_recorded";
  pass_counts: {
    observed: number;
    skipped: number;
    missing: number;
    /** null exactly when `manifest` is `not_recorded`. */
    required: number | null;
  };
  active_passes: number;
  cost: CostAggregate;
  recorded_cost_usd: number;
  usage_quality: UsageQuality;
  graph_nodes: TraceNodeView[];
  completion_integrity: CompletionIntegrityView;
  observed_at: string;
}

export interface ArtifactRefView {
  kind: "brief" | "prompt" | "output" | "events" | "activity_log" | "envelope" | "task";
  label: string;
  available: boolean;
  expired: boolean;
  href: string | null;
  sensitive: boolean;
  sha256: string | null;
}

export interface PassView {
  id: string;
  app: string;
  run_id: string;
  trace_id: string;
  parent_task_id: string | null;
  ticket: string | null;
  pipeline: string;
  pass: string;
  role: string;
  runtime: string | null;
  model: string | null;
  effort: string | null;
  status: string;
  liveness: Liveness;
  liveness_reason: string;
  /** Nullable: a recorded-but-unreadable instant is null with the reason
   *  disclosed in `quality_reason`, never 'Invalid Date' and never epoch zero. */
  started_at: string | null;
  finished_at: string | null;
  last_heartbeat_at: string | null;
  wall_clock_ms: number | null;
  workdir: string | null;
  git_branch: string | null;
  git_head: string | null;
  usage: {
    tokens_in: number | null;
    tokens_out: number | null;
    cache_read_tokens: number | null;
    cache_write_tokens: number | null;
    cost_usd: number | null;
    cost_estimated: boolean;
    quality: UsageQuality;
    settled: boolean;
  };
  previews: Record<string, string>;
  verdict_summary: string | null;
  terminal_reason: string | null;
  gates: Array<{ gate: string; status: string; detail: string | null }>;
  events: EventView[];
  tool_calls: number;
  subagents: number;
  escalations: number;
  artifacts: ArtifactRefView[];
  result_refs: SourceRefView[];
  session: {
    id: string | null;
    native_ref: string | null;
    transcript: string;
    transcript_note: string;
  } | null;
  authority: StatusRow["authority"] | null;
  trace_plan: StatusRow["tracePlan"] | null;
  planning_route: StatusRow["planningRoute"] | null;
  lock: { pid: number; heartbeat_at: string | null; fresh: boolean } | null;
  observed_at: string;
  quality_reason: string | null;
}

/** Classification of a structured event, derived ONLY from the typed `event`
 *  string — never from free text. `pass.heartbeat` gets its own kind so visual
 *  coalescing can never swallow a real pass outcome. */
export type EventKind =
  | "run" | "pass" | "heartbeat" | "gate" | "tool" | "subagent"
  | "ticket" | "verdict" | "plan" | "escalation" | "telemetry" | "other";

/** Derived from the typed event plus typed `detail` fields — never from
 *  `severity` alone: `telemetry.settle_skipped` is a benign exactly-once skip
 *  carried at severity `warn`, and calling it a failure would be a lie. */
export type EventOutcome = "success" | "failure" | "pending" | "unknown" | "not_applicable";

export interface EventView {
  id: string;
  ts: string;
  /** 0-based line index in that pass's events.jsonl — the true append order. */
  seq: number;
  /** Canonical UTC ISO with milliseconds, or null when absent/unparseable. */
  ts_utc: string | null;
  /** Opaque total-order key. Clients sort on it and NEVER parse it. */
  order_key: string;
  kind: EventKind;
  outcome: EventOutcome;
  /** Only from the already-scrubbed `detail.tool`. Never raw tool arguments. */
  tool_name: string | null;
  /** Non-null only for heartbeats; lets the client collapse ADJACENT runs. */
  coalesce_key: string | null;
  event: string;
  severity: string;
  span_id: string;
  parent_span_id: string | null;
  error_code: string | null;
  detail: Record<string, string | number | boolean>;
}

/** METADATA ONLY — no second copy of the events, no persisted index, no store
 *  (invariant 1). `total_events` is the authoritative denominator for the
 *  client's "showing N of M" disclosure. */
export interface ActivityStreamMetaView {
  order: "newest_first";
  order_key_fields: string[];
  tie_break: string;
  total_events: number;
  undated_events: number;
  clock_skew_event_ids: string[];
  completeness: "complete" | "partial";
  incomplete_reasons: string[];
  latest_event_at: string | null;
  /** Freshness reads this, so visual heartbeat coalescing can never change it. */
  latest_heartbeat_at: string | null;
}

export interface ApprovalView {
  id: string;
  approval_id: string;
  app: string;
  role: string;
  rule: string;
  status: "pending" | "granted" | "denied" | "expired" | "consumed" | "revoked";
  ticket_ref: string | null;
  turn_id: string | null;
  raised_at: string;
  decided_at: string | null;
  expires_at: string | null;
  scope: string | null;
  reason: string | null;
  execution_state: "approved" | "executing" | "executed" | "failed" | "ambiguous" | null;
  execution_attempts: number;
  execution_actor: string | null;
  execution_result: string | null;
  execution_failure_cause: string | null;
  execution_next_action: string | null;
  execution_remote_ref: string | null;
  execution_attempted_at: string | null;
  execution_finished_at: string | null;
  observed_at: string;
  source_refs: SourceRefView[];
}

export interface InvocationView {
  id: string;
  kind: InvocationRecord["kind"];
  app: string | null;
  parent_task_id: string | null;
  at: string;
  dry_run: boolean;
  items_claimed: number | null;
  outcome: string;
  wall_clock_ms: number;
}

export interface CompletionIntegrityView {
  required_stages: "complete" | "incomplete" | "unknown";
  usage: UsageQuality;
  reviewer: "completed" | "missing" | "not_required" | "unknown";
  manual_fallback: "none" | "present" | "not_recorded";
  durable_outcome: string;
  cormidia_end_to_end_complete: boolean;
  reasons: string[];
}

export interface AttentionItemView {
  id: string;
  severity: "warning" | "error";
  kind: string;
  app: string | null;
  entity_id: string | null;
  title: string;
  detail: string;
  observed_at: string;
  /** The provable join between this flat list and `attention_groups`. The flat
   *  list keeps the complete unaggregated truth; grouping stays mechanically
   *  verifiable instead of being a client-side reinterpretation (#91). */
  group_id: string;
}

export interface AttentionOccurrenceView {
  id: string;
  app: string | null;
  entity_id: string | null;
  entity_kind: "pass" | "ticket" | "approval" | "source" | "task" | "intake_event";
  /** Entity-level concise label, e.g. `builder/implement`, `#12 Fix flake`. */
  summary: string;
  /** The per-occurrence divergent text (liveness/terminal/quality reason). */
  detail: string;
  /** A real durable timestamp (pass start, approval raised, ticket observed) or
   *  null — NOT the snapshot time, which is identical for every item and
   *  therefore useless as an ordering key. */
  occurred_at: string | null;
  evidence_refs: SourceRefView[];
}

/**
 * One card per (cause, scope). `cause` is always read from a typed,
 * closed-vocabulary field — never from `title`/`detail`/timestamps or any
 * model-produced text (invariant 2).
 */
export interface AttentionGroupView {
  id: string;
  cause_key: string;
  kind: string;
  cause: string;
  severity: "warning" | "error";
  /** False for independently actionable conditions (a returned ticket, a
   *  degraded source): those always render as singleton groups. */
  groupable: boolean;
  scope: { app: string | null };
  /** Cause-level, shared by every occurrence — never copied from the first one. */
  title: string;
  detail: string;
  /** ALWAYS the true total, even when `occurrences` is capped. */
  occurrence_count: number;
  /** `labels` holds concise role/pass labels (`builder/implement`, `#12 Fix
   *  flake`) — NOT role names. It was called `roles`, which made the rendered
   *  line ("affected: builder/implement") mislabel its own contents. */
  affected: { passes: string[]; traces: string[]; tickets: string[]; labels: string[] };
  earliest_occurred_at: string | null;
  latest_occurred_at: string | null;
  occurrences: AttentionOccurrenceView[];
  occurrences_delivered: number;
  occurrences_truncated: boolean;
  observed_at: string;
}

export interface TotalsView {
  active_passes: number;
  pending_approvals: number;
  delivery_ready: number;
  /** Known recorded cost from the settled ledger. Equals `cost.known_cost_usd`;
   *  a real floor even when `cost.coverage` is `partial` (#89, #90). */
  recorded_cost_usd: number;
  usage_quality: UsageQuality;
  incomplete_usage_passes: number;
  /** The authoritative settled-ledger aggregate for the current filters — the
   *  same object Reports and CLI telemetry project (#89). */
  cost: CostAggregate;
  /** Settlement coverage disclosed with the total (#89). */
  cost_scope: CostScope;
  /** What this number covers: apps, time range, and filters. The server-side
   *  half of "totals always state app, time range, filters, and trace scope";
   *  trace scope is client-owned because session selection lives only in the
   *  client, and is composed on top of this. */
  scope_statement: ScopeStatementView;
}

export interface ObserveSnapshotV1 {
  schema_version: typeof OBSERVE_SCHEMA_VERSION;
  generated_at: string;
  cursor: string;
  filters: ObserveFiltersV1;
  org: OrgView;
  sources: SourceHealthView[];
  apps: AppView[];
  /** Dated, recorded executions. Split from the old single `intake` list so an
   *  undated pending event can never interleave into a chronology (#94). */
  activity_history: { scope: SectionScopeView; rows: ActivityView[] };
  /** Undated inbox files and lifecycle states awaiting promotion. Explicitly
   *  NOT a sequence. */
  pending_intake: {
    scope: SectionScopeView;
    rows: PendingIntakeItemView[];
    counts: Record<PendingIntakeState, number>;
  };
  delivery: DeliveryTicketView[];
  parent_tasks: ParentTaskView[];
  /** A FLAT array, deliberately: `sessions()`, the filter dropdowns, the graph,
   *  and the history index all read one collection, so there is no second store
   *  (invariant 1). Completeness and ordering are declared alongside it. */
  traces: TraceView[];
  /** `cap` is null — the projection does not truncate traces. The client's
   *  display cap is disclosed by the client badge ON TOP of this honest total. */
  traces_scope: SectionScopeView;
  passes: PassView[];
  approvals: ApprovalView[];
  invocations: InvocationView[];
  activity: ActivityStreamMetaView;
  time_policy: TimePolicyView;
  totals: TotalsView;
  attention: AttentionItemView[];
  attention_groups: AttentionGroupView[];
  /** Durable triggered-validation evidence. Inconclusive is never a pass. */
  validation_campaigns: ValidationCampaignReadResult;
  roadmap_explanation: RoadmapExplanationV1;
}

export interface GitHubAppSnapshot {
  app: string;
  repo: string;
  issues: GhIssue[];
  pull_requests: Array<{
    pull_request: GhPullRequest;
    reviews: GhReview[];
    checks?: Array<{ name: string; state: string; link?: string }>;
  }>;
  observed_at: string;
  error?: string;
}

export interface IndexedPass {
  row: StatusRow;
  envelope_finished_at?: string;
  events: RunlogEvent[];
  events_corrupt?: string;
  artifacts: Record<string, { available: boolean; size: number; sha256?: string }>;
}

export interface ObserveProjectionInput {
  now: Date;
  cursor: string;
  filters: ObserveFiltersV1;
  org_name: string;
  state_home: string;
  max_concurrent_turns: number;
  apps: AppEntry[];
  passes: IndexedPass[];
  corrupt_runs: Array<{ app: string; run_id: string; detail: string }>;
  parent_tasks: ParentTaskRecord[];
  parent_task_prompts: Record<string, boolean>;
  corrupt_tasks: Array<{ task_id: string; detail: string }>;
  approvals: Array<{ item: ApprovalItem; grant?: ApprovalGrant }>;
  ledger: TurnRecord[];
  budget_rows?: BudgetRow[];
  budget_paused_apps?: string[];
  invocations: InvocationRecord[];
  schedule: Record<string, string>;
  locks: TurnLock[];
  inbox: Array<{
    filename: string;
    app: string | null;
    kind: string | null;
    event_id?: string;
    /** Only set when the payload carried a PARSEABLE instant. */
    occurred_at?: string;
    /** File mtime — a received time, never an event time, never a join key. */
    discovered_at?: string;
    source?: string;
    error?: string;
  }>;
  github: GitHubAppSnapshot[];
  source_health: SourceHealthView[];
  validation_campaigns?: ValidationCampaignReadResult;
  roadmap_explanation?: RoadmapExplanationV1;
}
