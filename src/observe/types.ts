import type { CostAggregate, CostScope } from "../runtime/cost.js";
import type { AppEntry } from "../org/apps.js";
import type { ApprovalGrant, ApprovalItem } from "../org/approvals.js";
import type { ParentTaskRecord } from "../org/parent-task.js";
import type { GhIssue, GhPullRequest, GhReview } from "../loop/github.js";
import type { RunlogEvent } from "../runtime/runlog/events.js";
import type { StatusRow } from "../runtime/runlog/status.js";
import type { InvocationRecord, TurnRecord } from "../runtime/telemetry.js";
import type { TurnLock } from "../org/locks.js";

export const OBSERVE_SCHEMA_VERSION = 1 as const;

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
}

export interface SourceRefView {
  source: string;
  ref: string;
}

export interface SourceHealthView {
  id: "local_files" | "github" | "approvals" | "ledger" | "scheduler";
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
  /** Month-to-date settled-ledger aggregate for this app (#89, #90). */
  cost: CostAggregate;
  channels: { support: string[]; marketing: string[] };
  channel_gates: string[];
  observed_at: string;
  source_refs: SourceRefView[];
}

export interface ActivityView {
  id: string;
  app: string;
  kind: ActivityKind;
  status: string;
  title: string;
  trigger: string | null;
  trace_id: string | null;
  parent_task_id: string | null;
  started_at: string | null;
  latest_at: string | null;
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
  started_at: string;
  ended_at: string | null;
  prompt: ArtifactRefView;
  prompt_sha256: string;
  required_stages: string[];
  observed_stages: string[];
  missing_required_stages: string[];
  trace_ids: string[];
  ticket_refs: string[];
  completion_integrity: CompletionIntegrityView;
  observed_at: string;
  source_refs: SourceRefView[];
}

export interface TraceView {
  id: string;
  trace_id: string;
  app: string;
  ticket: string | null;
  parent_task_id: string | null;
  pipeline: string;
  pass_ids: string[];
  required_passes: string[] | null;
  observed_passes: string[];
  skipped_passes: Array<{ pass: string; reason: string }>;
  missing_passes: string[];
  status: string;
  started_at: string;
  finished_at: string | null;
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
  started_at: string;
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
  lock: { pid: number; heartbeat_at: string; fresh: boolean } | null;
  observed_at: string;
  quality_reason: string | null;
}

export interface EventView {
  id: string;
  ts: string;
  event: string;
  severity: string;
  span_id: string;
  parent_span_id: string | null;
  error_code: string | null;
  detail: Record<string, string | number | boolean>;
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
  operon_end_to_end_complete: boolean;
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
}

export interface ObserveSnapshotV1 {
  schema_version: typeof OBSERVE_SCHEMA_VERSION;
  generated_at: string;
  cursor: string;
  filters: ObserveFiltersV1;
  org: OrgView;
  sources: SourceHealthView[];
  apps: AppView[];
  intake: ActivityView[];
  delivery: DeliveryTicketView[];
  parent_tasks: ParentTaskView[];
  traces: TraceView[];
  passes: PassView[];
  approvals: ApprovalView[];
  invocations: InvocationView[];
  totals: TotalsView;
  attention: AttentionItemView[];
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
  invocations: InvocationRecord[];
  schedule: Record<string, string>;
  locks: TurnLock[];
  inbox: Array<{ filename: string; app: string | null; kind: string | null; error?: string }>;
  github: GitHubAppSnapshot[];
  source_health: SourceHealthView[];
}
