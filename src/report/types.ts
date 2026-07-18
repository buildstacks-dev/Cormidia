import type { AppStatus } from "../org/apps.js";
import type { CostAggregate } from "../runtime/cost.js";

export const REPORT_SCHEMA_VERSION = 1 as const;

export type ReportPreset = "7d" | "30d" | "90d" | "1y" | "all" | "custom";
export type ReportBucketKind = "day" | "week" | "month";
/** `none` is an authoritative zero for a pass that invoked no provider — see
 *  UsageQuality in src/runtime/types.ts (#88). */
export type ReportUsageQuality = "complete" | "estimated" | "partial" | "unavailable" | "none";
export type CompletionIntegrity = "complete" | "incomplete" | "unknown";

export interface ReportRangeV1 {
  preset: ReportPreset;
  from_inclusive: string;
  to_exclusive: string;
  display_timezone: "UTC";
  bucket: ReportBucketKind;
  open_interval: boolean;
}

export interface ReportSourceDiagnosticV1 {
  kind: "corrupt_line" | "torn_tail" | "unreadable_day" | "concurrent_write" | "invalid_row" | "invalid_timestamp" | "future_timestamp";
  day: string;
  line: number | null;
  detail: string;
}

export interface ReportQualityV1 {
  overall: ReportUsageQuality;
  observable_turns: number;
  unknown_usage_turns: number;
  estimated_cost_turns: number;
  partial_usage_turns: number;
  unmeasured_turns: number;
  legacy_turns: number;
  unattributed_turns: number;
  duplicate_rows: number;
  duplicate_keys: string[];
  duplicate_known_tokens: number;
  duplicate_recorded_cost_usd: number;
  corrupt_lines: number;
  torn_tails: number;
  unreadable_days: string[];
  concurrent_write_days: string[];
  future_timestamp_rows: number;
  missing_envelopes: number;
  unsettled_passes: number;
  terminal_unsettled_usage_passes: number;
  retained_from: string | null;
  retained_to: string | null;
  diagnostics: ReportSourceDiagnosticV1[];
  notices: string[];
}

export interface ReportHeadlineV1 {
  /** The canonical settled-ledger cost aggregate for this scope, range, and
   *  filters. Live Observer and CLI telemetry project the same object from the
   *  same rows so no two surfaces can disagree about known cost or coverage
   *  (#89). `recorded_equivalent_cost_usd` below is its `known_cost_usd`. */
  cost: CostAggregate;
  /** Settlement coverage disclosed with the total, so an operator can see how
   *  much of the scope actually reached the ledger (#89). */
  cost_scope: { settled_provider_turns: number; unsettled_provider_turns: number };
  known_input_tokens: number;
  known_output_tokens: number;
  known_total_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  provider_reported_cost_usd: number;
  operon_estimated_cost_usd: number;
  partial_recorded_cost_usd: number;
  recorded_equivalent_cost_usd: number;
  unknown_cost_turns: number;
  provider_turns: number;
  unknown_usage_turns: number;
  sessions: number;
  completed_sessions: number;
  completion_integrity_sessions: number;
}

export interface ReportBucketV1 {
  start: string;
  end: string;
  source_quality: "readable" | "gap";
  known_input_tokens: number | null;
  known_output_tokens: number | null;
  provider_reported_cost_usd: number | null;
  operon_estimated_cost_usd: number | null;
  partial_recorded_cost_usd: number | null;
  provider_turns: number;
  unknown_usage_turns: number;
}

export interface ReportBreakdownV1 {
  key: string;
  label: string;
  known_input_tokens: number;
  known_output_tokens: number;
  known_total_tokens: number;
  recorded_equivalent_cost_usd: number;
  provider_reported_cost_usd: number;
  operon_estimated_cost_usd: number;
  partial_recorded_cost_usd: number;
  turns: number;
  sessions: number;
  unknown_usage_turns: number;
  known_token_share: number | null;
}

export interface SourceRefView {
  source: string;
  ref: string;
}

export interface ReportTurnV1 {
  id: string;
  source: { day: string | null; line: number | null };
  activity_type: "provider_turn" | "mechanical_pass";
  app: string | null;
  run_id: string | null;
  provider_turn_id: string | null;
  execution_step_id: string | null;
  episode_id: string | null;
  trace_id: string | null;
  parent_task_id: string | null;
  ticket: string | null;
  role: string;
  runtime: string | null;
  model: string | null;
  effort: string | null;
  pipeline: string | null;
  pass: string | null;
  trigger: string | null;
  started_at: string | null;
  settled_at: string | null;
  finished_at: string | null;
  wall_clock_ms: number | null;
  status: string;
  usage_quality: ReportUsageQuality;
  tokens_in: number | null;
  tokens_out: number | null;
  tokens_in_uncached: number | null;
  cache_read_tokens: number | null;
  cache_creation_tokens: number | null;
  cost_usd: number | null;
  cost_estimated: boolean;
  subagent_turns: number;
  tool_calls: number | null;
  escalations: number;
  gate_passes: number | null;
  gate_failures: number | null;
  refs: SourceRefView[];
  native_session_ref: string | null;
  envelope_available: boolean;
  events_available: boolean;
  warnings: string[];
}

/** One duplicated provider execution step and its attributed settled cost (#92). */
export interface ReportRepeatedWorkStepV1 {
  execution_step_id: string;
  /** The earlier step whose input_fingerprint this one matched. */
  repeated_from_step_id: string;
  provider_turn_id: string | null;
  run_id: string;
  operation: string;
  origin_status: string | null;
  origin_error_code: string | null;
  /** `recovery_defect` — the origin step was interrupted, cancelled, or timed
   *  out, so the orchestrator lost durable work and had to redo it.
   *  `retry` — the origin failed on its own terms and was legitimately retried. */
  cause: "recovery_defect" | "retry";
  /** Settled ledger cost for this repeat, or null when it never settled. */
  cost_usd: number | null;
}

/** The calculation inputs behind repeated_work_cost_usd, so the number can be
 *  audited rather than trusted (#92). */
export interface ReportRepeatedWorkV1 {
  /** Identifies how duplication was determined. */
  fingerprint: "execution_step_input_fingerprint/v1";
  /** Total attributed cost; null only when a repeated step's own settlement is
   *  missing — never merely because some other turn was estimated. */
  cost_usd: number | null;
  recovery_defect_cost_usd: number | null;
  retry_cost_usd: number | null;
  repeated_steps: ReportRepeatedWorkStepV1[];
  considered_provider_steps: number;
  missing_inputs: string[];
}

export interface ReportEvidenceMetricV1 {
  status: "valid" | "invalid_measurement";
  numerator: number;
  denominator: number;
  value: number | null;
  excluded_ids: string[];
  missing_inputs: string[];
}

export interface ReportEfficiencyEpisodeV1 {
  episode_id: string;
  app: string;
  evidence: "durable" | "legacy_inferred";
  planned_route: string | null;
  current_route: string | null;
  final_route: string | null;
  terminal_status: string | null;
  provider_turns: number;
  mechanical_steps: number;
  input_tokens: number | null;
  output_tokens: number | null;
  equivalent_cost_usd: number | null;
  active_time_ms: number | null;
  elapsed_time_ms: number | null;
  human_wait_ms: number | null;
  productive_provider_turns: number | null;
  repeated_work_cost_usd: number | null;
  /** Calculation inputs and duplicated-step references behind the number (#92). */
  repeated_work: ReportRepeatedWorkV1;
  route_variances: number;
  issues: string[];
}

export interface ReportEfficiencyV1 {
  episodes: ReportEfficiencyEpisodeV1[];
  metrics: {
    terminal_integrity: ReportEvidenceMetricV1;
    execution_step_terminal_integrity: ReportEvidenceMetricV1;
    ledger_coverage: ReportEvidenceMetricV1;
    productive_pass_ratio: ReportEvidenceMetricV1;
  };
  context_by_category: Array<{
    category: string;
    rendered_bytes: number;
    components: number;
    run_ids: string[];
  }>;
  repeated_work_cost_usd: number | null;
  /** Calculation inputs and duplicated-step references behind the number (#92). */
  repeated_work: ReportRepeatedWorkV1;
  issues: {
    missing_route_episode_ids: string[];
    missing_context_manifest_run_ids: string[];
    invalid_context_manifest_run_ids: string[];
    missing_execution_step_run_ids: string[];
    orphan_execution_step_ids: string[];
    pending_execution_step_ids: string[];
    incomplete_run_ids: string[];
    unattributed_pass_ids: string[];
    duplicate_settlement_keys: string[];
    duplicate_provider_turn_ids: string[];
    duplicate_execution_step_ids: string[];
    unsettled_provider_step_ids: string[];
    mechanical_with_settlement_step_ids: string[];
    corrupt_evidence_files: string[];
    partial_or_unavailable_provider_turn_ids: string[];
    repeated_provider_step_ids: string[];
  };
}

export interface ReportSessionSummaryV1 {
  id: string;
  kind: "parent_task" | "standalone_trace" | "orphan_run";
  label: string;
  objective_preview: string | null;
  apps: string[];
  scope_partial: boolean;
  started_at: string | null;
  ended_at: string | null;
  outcome: string;
  completion_integrity: CompletionIntegrity;
  execution_mode: "operon" | "mixed" | "manual" | "not_recorded";
  provider_turns: number;
  mechanical_passes: number;
  known_input_tokens: number;
  known_output_tokens: number;
  recorded_equivalent_cost_usd: number;
  /** Known cost plus the separately-counted unknown component for this session
   *  (#90). `recorded_equivalent_cost_usd` is its `known_cost_usd`. */
  cost: CostAggregate;
  usage_quality: ReportUsageQuality;
  refs: SourceRefView[];
  warnings: string[];
}

export interface ReportSessionDetailV1 {
  summary: ReportSessionSummaryV1;
  activities: ReportTurnV1[];
}

export interface ReportHealthV1 {
  session_outcomes: Array<{ status: string; sessions: number }>;
  pass_outcomes: Array<{ status: string; passes: number }>;
  completion_integrity: Array<{ status: CompletionIntegrity; sessions: number }>;
  provider_turn_wall_ms: { median: number | null; p90: number | null; n: number };
  provider_turn_cost_usd: { median: number | null; p90: number | null; n: number };
  completed_session_cost_usd: { median: number | null; p90: number | null; n: number };
  gate_passes: number;
  gate_failures: number;
  escalations: number;
  interrupted_turns: number;
  fallback_sessions: number;
}

export interface ReportAppRowV1 {
  app: string;
  repo: string;
  lifecycle: AppStatus;
  known_tokens: number;
  recorded_equivalent_cost_usd: number;
  provider_turns: number;
  sessions: number;
  completed_sessions: number;
  failed_sessions: number;
  current_month_spend_usd: number;
  monthly_budget_usd: number;
  budget_percent: number;
  budget_status: "ok" | "warning" | "exceeded";
  usage_coverage: number | null;
  completion_coverage: number | null;
  most_recent_activity: string | null;
  known_token_share: number | null;
}

export interface ReportSnapshotV1 {
  schema_version: typeof REPORT_SCHEMA_VERSION;
  generated_at: string;
  summary_only: boolean;
  source_fingerprint: string;
  org: { name: string; state_home_id: string };
  scope: { kind: "org" | "app"; app: string | null };
  range: ReportRangeV1;
  quality: ReportQualityV1;
  headline: ReportHeadlineV1;
  trend: ReportBucketV1[];
  breakdowns: {
    by_app: ReportBreakdownV1[];
    by_role: ReportBreakdownV1[];
    by_runtime_model: ReportBreakdownV1[];
    by_pipeline_pass: ReportBreakdownV1[];
    by_trigger: ReportBreakdownV1[];
    by_status: ReportBreakdownV1[];
    by_usage_quality: ReportBreakdownV1[];
  };
  health: ReportHealthV1;
  efficiency: ReportEfficiencyV1;
  apps: ReportAppRowV1[];
  sessions: {
    total: number;
    returned: number;
    next_cursor: string | null;
    items: ReportSessionSummaryV1[];
  };
  session_details: ReportSessionDetailV1[];
  unattributed_turns: ReportTurnV1[];
}

export interface ReportQuery {
  app?: string;
  period?: Exclude<ReportPreset, "custom">;
  since?: string;
  until?: string;
  bucket?: "auto" | ReportBucketKind;
  summaryOnly?: boolean;
}
