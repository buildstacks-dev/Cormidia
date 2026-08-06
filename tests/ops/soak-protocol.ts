// CF-OPS-SOAK / CF-OPS-ROT — resumable seven-calendar-day evidence protocol.
// This module never starts provider work. A human starts the campaign and the
// ordinary sandbox org runs normally; checkpoints only read durable state.

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { lstat, mkdir, readFile, readdir } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { loadApps } from "../../src/org/apps.js";
import { ApprovalStore } from "../../src/org/approvals.js";
import { writeFileAtomic } from "../../src/org/atomic.js";
import { SchedulerEvidenceStore } from "../../src/org/scheduler/evidence.js";
import { canonicalJson, schedulerIdentity } from "../../src/org/scheduler/model.js";
import { writeValidationCampaignReport, type ValidationCampaignReportV1 } from "../../src/org/validation-campaign.js";
import { indexLocalSources } from "../../src/observe/file-index.js";
import { readTurnRecords } from "../../src/runtime/telemetry.js";
import { readRoadmapExplanation, type UnitRecoveryState } from "../../src/org/roadmap-explanation.js";

export const SOAK_REQUIRED_CASES = ["CF-OPS-SOAK", "CF-OPS-ROT"] as const;
export const SOAK_MAX_PROVIDER_TURNS = 24;
export const SOAK_MAX_EQUIV_USD = 15;
const DAY_MS = 86_400_000;

export interface SoakConfigV1 {
  schema_version: 1;
  campaign_id: string;
  human_authorization: { human_initiated: true; authorized_by: string; authorized_at: string; purpose: string };
  state_home: string;
  org_home: string;
  policy_path: string;
  commit: string;
  timezone: string;
  sandbox: { org: string; apps: string[]; repos: string[] };
}

export interface SoakSleepCycle {
  slept_at: string;
  woke_at: string;
  overnight: boolean;
}

export interface SoakRotationEvidenceV1 {
  schema_version: 1;
  runtime: "codex";
  cause: "provider_auth_rotation";
  observed_without_injection: true;
  interrupted_at: string;
  resumed_at: string;
  session_id_before: string;
  session_id_after: string;
  checkpoint_before_sha256: string;
  checkpoint_after_sha256: string;
  evidence_refs: string[];
}

export interface SoakCheckpointV1 {
  checkpoint_id: string;
  captured_at: string;
  sleep_cycle?: SoakSleepCycle;
  rotation?: SoakRotationEvidenceV1;
  scheduler: {
    measurement_valid: boolean;
    reason_counts: Record<string, number>;
    duplicate_decisions: number;
    duplicate_episodes: number;
    orphaned_locks: number;
    orphaned_journals: number;
    orphaned_runs: number;
    orphaned_settlements: number;
    provider_settlement_agreement: boolean | null;
    active_locks: number;
    wip_limit: number;
  };
  spend: { provider_turns: number; equiv_usd: number; partial_usage_rows: number };
  state_growth: { files: number; bytes: number };
  retention: { completed_sweeps: number; sweeps_with_errors: number };
  source_health: Array<{ id: string; status: "healthy" | "degraded" | "unavailable" }>;
  roadmap_delivery: {
    batches_observed: number;
    batches_complete: number;
    batches_every_unit_successful: number;
    units_observed: number;
    stale_frontier_refusals: number;
    session_reuse: {
      consider_exact_reuse: number;
      rerun_without_session: number;
      no_cross_unit_reuse: number;
    };
    cache_evidence: { hit: number; miss: number; unknown: number };
    recovery_states: Record<UnitRecoveryState, number>;
  };
  human_decision_rows: number;
}

export interface SoakStateV1 {
  schema_version: 1;
  campaign_id: string;
  started_at: string;
  commit: string;
  config_sha256: string;
  policy_sha256: string;
  timezone: string;
  sandbox: SoakConfigV1["sandbox"];
  baseline: { provider_turns: number; equiv_usd: number; human_decision_rows: number };
  checkpoints: SoakCheckpointV1[];
}

export interface SoakEvaluation {
  collected_case_ids: string[];
  missing_reason_codes: string[];
  violation_ids: string[];
}

export async function loadSoakConfig(env: NodeJS.ProcessEnv = process.env): Promise<SoakConfigV1> {
  if (env["CORMIDIA_SOAK"] !== "1") throw new Error("soak refused: CORMIDIA_SOAK=1 is required");
  const configured = env["CORMIDIA_SOAK_CONFIG"];
  if (configured === undefined || !isAbsolute(configured))
    throw new Error("soak refused: CORMIDIA_SOAK_CONFIG must be an absolute reviewed file");
  const value: unknown = JSON.parse(await readFile(resolve(configured), "utf8"));
  validateConfig(value);
  return value;
}

export function soakStatePath(stateHome: string, campaignId: string): string {
  safeCampaignId(campaignId);
  return join(resolve(stateHome), "validation", "soaks", campaignId, "state.json");
}

export async function startSoak(config: SoakConfigV1, now: Date = new Date()): Promise<SoakStateV1> {
  validateConfig(config);
  const path = soakStatePath(config.state_home, config.campaign_id);
  if (existsSync(path)) throw new Error(`soak campaign already exists: ${config.campaign_id}`);
  const apps = await loadApps(join(config.org_home, "apps.yaml"));
  assertSandboxMatches(
    config,
    apps.org.name,
    apps.apps.map((app) => app.name),
    apps.apps.map((app) => app.repo),
  );
  const ledger = await readTurnRecords(config.state_home);
  const policySha256 = createHash("sha256")
    .update(await readFile(config.policy_path))
    .digest("hex");
  const state: SoakStateV1 = {
    schema_version: 1,
    campaign_id: config.campaign_id,
    started_at: now.toISOString(),
    commit: config.commit,
    config_sha256: configDigest(config),
    policy_sha256: policySha256,
    timezone: config.timezone,
    sandbox: structuredClone(config.sandbox),
    baseline: {
      provider_turns: providerRows(ledger).length,
      equiv_usd: money(providerRows(ledger).reduce((sum, row) => sum + row.costUsd, 0)),
      human_decision_rows: (await new ApprovalStore(config.state_home).listDecidedReadOnly()).length,
    },
    checkpoints: [],
  };
  await persistState(config.state_home, state);
  await persistReport(config, state, false, now);
  return structuredClone(state);
}

export async function readSoakState(stateHome: string, campaignId: string): Promise<SoakStateV1> {
  const value: unknown = JSON.parse(await readFile(soakStatePath(stateHome, campaignId), "utf8"));
  validateState(value);
  return value;
}

/** Test seam and recovery seam: append already-captured, typed evidence. */
export async function recordSoakCheckpoint(
  config: SoakConfigV1,
  checkpoint: SoakCheckpointV1,
  now: Date = new Date(checkpoint.captured_at),
): Promise<SoakStateV1> {
  validateCheckpoint(checkpoint);
  const state = await readSoakState(config.state_home, config.campaign_id);
  await assertCampaignBinding(config, state);
  if (checkpoint.captured_at < state.started_at) throw new Error("soak checkpoint predates campaign start");
  if (state.checkpoints.some((item) => item.checkpoint_id === checkpoint.checkpoint_id))
    throw new Error(`duplicate soak checkpoint: ${checkpoint.checkpoint_id}`);
  if (checkpoint.sleep_cycle !== undefined) {
    const derived = deriveSleepCycle(checkpoint.sleep_cycle.slept_at, checkpoint.sleep_cycle.woke_at, config.timezone);
    if (derived.overnight !== checkpoint.sleep_cycle.overnight)
      throw new Error("soak sleep overnight flag does not match the configured local timezone");
  }
  if (checkpoint.spend.provider_turns > SOAK_MAX_PROVIDER_TURNS || checkpoint.spend.equiv_usd > SOAK_MAX_EQUIV_USD) {
    throw new Error("soak hard spend ceiling exceeded; checkpoint refused and campaign remains incomplete");
  }
  state.checkpoints.push(structuredClone(checkpoint));
  state.checkpoints.sort((left, right) => left.captured_at.localeCompare(right.captured_at));
  assertCumulativeCheckpoints(state.checkpoints);
  await persistState(config.state_home, state);
  await persistReport(config, state, false, now);
  return structuredClone(state);
}

export async function captureSoakCheckpoint(
  config: SoakConfigV1,
  input: { checkpointId: string; sleptAt?: string; wokeAt?: string; rotation?: SoakRotationEvidenceV1 },
  now: Date = new Date(),
): Promise<SoakStateV1> {
  const state = await readSoakState(config.state_home, config.campaign_id);
  const apps = await loadApps(join(config.org_home, "apps.yaml"));
  const store = new SchedulerEvidenceStore({
    stateHome: config.state_home,
    orgHome: config.org_home,
    orgName: apps.org.name,
    schedulerId: schedulerIdentity(apps.org.name, config.org_home),
  });
  const [summary, local, ledger, decided, growth, retention, activeLocks] = await Promise.all([
    store.summarize(now),
    indexLocalSources({ orgName: apps.org.name, stateHome: config.state_home, appsFile: apps, filters: {}, now }),
    readTurnRecords(config.state_home),
    new ApprovalStore(config.state_home).listDecidedReadOnly(),
    measureTree(config.state_home),
    retentionHealth(config.state_home),
    countFiles(join(config.state_home, "locks"), ".lock"),
  ]);
  const roadmapExplanation = await readRoadmapExplanation(config.state_home, config.sandbox.apps);
  const campaignRows = providerRows(ledger).slice(state.baseline.provider_turns);
  const sleepCycle =
    input.sleptAt === undefined && input.wokeAt === undefined
      ? undefined
      : deriveSleepCycle(input.sleptAt, input.wokeAt, config.timezone);
  const checkpoint: SoakCheckpointV1 = {
    checkpoint_id: input.checkpointId,
    captured_at: now.toISOString(),
    ...(sleepCycle === undefined ? {} : { sleep_cycle: sleepCycle }),
    ...(input.rotation === undefined ? {} : { rotation: input.rotation }),
    scheduler: {
      measurement_valid: summary.measurement_valid,
      reason_counts: summary.reason_counts,
      duplicate_decisions: summary.duplicate_decisions,
      duplicate_episodes: summary.duplicate_episodes,
      orphaned_locks: summary.orphaned_locks,
      orphaned_journals: summary.orphaned_journals,
      orphaned_runs: summary.orphaned_runs,
      orphaned_settlements: summary.orphaned_settlements,
      provider_settlement_agreement: summary.provider_settlement_agreement,
      active_locks: activeLocks,
      wip_limit: apps.org.maxConcurrentTurns,
    },
    spend: {
      provider_turns: campaignRows.length,
      equiv_usd: money(campaignRows.reduce((sum, row) => sum + row.costUsd, 0)),
      partial_usage_rows: campaignRows.filter((row) => row.usageQuality === "partial").length,
    },
    state_growth: growth,
    retention,
    source_health: local.source_health.map((source) => ({ id: source.id, status: source.status })),
    roadmap_delivery: summarizeRoadmapDelivery(
      roadmapExplanation,
      (summary.reason_counts["frontier_stale"] ?? 0) + (summary.reason_counts["batch_frontier_stale"] ?? 0),
    ),
    human_decision_rows: decided.length - state.baseline.human_decision_rows,
  };
  return recordSoakCheckpoint(config, checkpoint, now);
}

export async function finishSoak(config: SoakConfigV1, now: Date = new Date()): Promise<ValidationCampaignReportV1> {
  const state = await readSoakState(config.state_home, config.campaign_id);
  await assertCampaignBinding(config, state);
  return persistReport(config, state, true, now);
}

export function evaluateSoak(state: SoakStateV1, now: Date): SoakEvaluation {
  const checkpoints = state.checkpoints;
  const missing = new Set<string>();
  const violations = new Set<string>();
  const elapsed = now.getTime() - Date.parse(state.started_at);
  if (elapsed < 7 * DAY_MS) missing.add("soak_duration_incomplete");
  if (checkpoints.length < 2) missing.add("state_growth_series_missing");
  const sleeps = checkpoints.flatMap((item) => (item.sleep_cycle === undefined ? [] : [item.sleep_cycle]));
  if (new Set(sleeps.map((item) => `${item.slept_at}\0${item.woke_at}`)).size < 3)
    missing.add("sleep_cycle_count_incomplete");
  if (!sleeps.some((item) => item.overnight)) missing.add("overnight_sleep_missing");
  if (!checkpoints.some((item) => (item.scheduler.reason_counts["missed_window_reconciled"] ?? 0) > 0))
    missing.add("missed_window_reconciliation_unobserved");
  if (!checkpoints.some((item) => item.scheduler.measurement_valid)) missing.add("scheduler_measurement_missing");
  if (!checkpoints.some((item) => item.scheduler.provider_settlement_agreement === true))
    missing.add("settlement_evidence_missing");
  if (!checkpoints.some((item) => item.spend.partial_usage_rows > 0))
    missing.add("partial_usage_settlement_unobserved");
  if (!checkpoints.some((item) => item.retention.completed_sweeps > 0)) missing.add("retention_sweep_unobserved");
  const requiredSources = ["local_files", "approvals", "ledger"];
  if (
    !requiredSources.every((id) =>
      checkpoints.some((item) => item.source_health.some((source) => source.id === id && source.status === "healthy")),
    )
  ) {
    missing.add("source_health_incomplete");
  }
  const rotation = checkpoints
    .flatMap((item) => (item.rotation === undefined ? [] : [item.rotation]))
    .some(validRotation);
  if (!rotation) missing.add("natural_codex_rotation_unobserved");
  const last = checkpoints.at(-1);
  if (
    last !== undefined &&
    (last.spend.provider_turns >= SOAK_MAX_PROVIDER_TURNS || last.spend.equiv_usd >= SOAK_MAX_EQUIV_USD)
  )
    missing.add("soak_spend_ceiling_exhausted");

  for (const item of checkpoints) {
    if (item.scheduler.duplicate_decisions > 0 || item.scheduler.duplicate_episodes > 0)
      violations.add("CF-OPS-SOAK:duplicate_admission");
    if (item.scheduler.active_locks > item.scheduler.wip_limit) violations.add("CF-OPS-SOAK:wip_exceeded");
    if (
      item.scheduler.orphaned_locks +
        item.scheduler.orphaned_journals +
        item.scheduler.orphaned_runs +
        item.scheduler.orphaned_settlements >
      0
    )
      violations.add("CF-OPS-SOAK:orphaned_state");
    if (item.scheduler.provider_settlement_agreement === false) violations.add("CF-OPS-SOAK:settlement_disagreement");
    if (item.retention.sweeps_with_errors > 0) violations.add("CF-OPS-SOAK:retention_error");
    if (item.source_health.some((source) => source.status === "degraded"))
      violations.add("CF-OPS-SOAK:source_degraded");
    if (item.roadmap_delivery.batches_complete > item.roadmap_delivery.batches_observed)
      violations.add("CF-OPS-SOAK:batch_completion_exceeds_observed");
    if (item.roadmap_delivery.batches_every_unit_successful > item.roadmap_delivery.batches_complete)
      violations.add("CF-OPS-SOAK:batch_success_exceeds_completion");
    if (
      Object.values(item.roadmap_delivery.cache_evidence).reduce((sum, count) => sum + count, 0) !==
      item.roadmap_delivery.units_observed
    )
      violations.add("CF-OPS-SOAK:cache_evidence_accounting_mismatch");
    if (
      Object.values(item.roadmap_delivery.recovery_states).reduce((sum, count) => sum + count, 0) !==
      item.roadmap_delivery.units_observed
    )
      violations.add("CF-OPS-SOAK:recovery_state_accounting_mismatch");
    if (item.human_decision_rows !== 0) violations.add("CF-OPS-SOAK:sleep_permission_delta");
  }
  const soakComplete =
    ![...missing].some((code) => code !== "natural_codex_rotation_unobserved") && violations.size === 0;
  const collected = [
    ...(soakComplete ? ["CF-OPS-SOAK"] : []),
    ...(rotation && violations.size === 0 ? ["CF-OPS-ROT"] : []),
  ];
  return {
    collected_case_ids: collected,
    missing_reason_codes: [...missing].sort(),
    violation_ids: [...violations].sort(),
  };
}

async function persistReport(
  config: SoakConfigV1,
  state: SoakStateV1,
  terminal: boolean,
  now: Date,
): Promise<ValidationCampaignReportV1> {
  const evaluation = evaluateSoak(state, now);
  const last = state.checkpoints.at(-1);
  const missingCases = SOAK_REQUIRED_CASES.filter((id) => !evaluation.collected_case_ids.includes(id));
  const exhausted =
    last !== undefined &&
    (last.spend.provider_turns >= SOAK_MAX_PROVIDER_TURNS || last.spend.equiv_usd >= SOAK_MAX_EQUIV_USD);
  const complete = terminal && missingCases.length === 0 && !exhausted;
  const report: ValidationCampaignReportV1 = {
    schema_version: 1,
    campaign_id: config.campaign_id,
    lane: "L5",
    campaign_kind: "seven-day-laptop-soak",
    trigger: "human-initiated qualification",
    status: terminal ? "completed" : "running",
    started_at: state.started_at,
    finished_at: terminal ? now.toISOString() : null,
    policy: { path: config.policy_path, sha256: state.policy_sha256 },
    target: {
      commit: config.commit,
      apps: [...config.sandbox.apps],
      scopes: ["scheduler", "locks", "settlement", "retention", "source-health", "permissions"],
      tuples: [],
    },
    spend: {
      max_provider_turns: SOAK_MAX_PROVIDER_TURNS,
      max_equiv_usd: SOAK_MAX_EQUIV_USD,
      observed_provider_turns: last?.spend.provider_turns ?? 0,
      observed_equiv_usd: last?.spend.equiv_usd ?? 0,
      ceiling_exhausted: exhausted,
    },
    coverage: {
      required_case_ids: [...SOAK_REQUIRED_CASES],
      collected_case_ids: evaluation.collected_case_ids,
      missing_case_ids: missingCases,
    },
    outcome: {
      completeness: complete ? "complete" : "incomplete",
      verdict: evaluation.violation_ids.length > 0 ? "fail" : complete ? "pass" : "inconclusive",
      decision_status: "ratified",
      violation_ids: evaluation.violation_ids,
      reason_codes: evaluation.missing_reason_codes,
    },
    evidence_refs: [soakStatePath(config.state_home, config.campaign_id), "docs/qualification/validation-triage.md"],
    profile: {
      identity: "cormidia/unattended-sandbox/v1",
      sandbox_target: `${config.sandbox.org}:${config.sandbox.apps.join(",")}`,
      permitted_auto_grant_categories: ["campaign_budget"],
      human_decision_rows: 0,
    },
  };
  await writeValidationCampaignReport(config.state_home, report);
  return report;
}

function deriveSleepCycle(sleptAt: string | undefined, wokeAt: string | undefined, timezone: string): SoakSleepCycle {
  if (sleptAt === undefined || wokeAt === undefined) throw new Error("sleep evidence requires both sleptAt and wokeAt");
  const slept = instant(sleptAt, "sleptAt");
  const woke = instant(wokeAt, "wokeAt");
  if (Date.parse(woke) <= Date.parse(slept)) throw new Error("wokeAt must follow sleptAt");
  const day = (value: string): string =>
    new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(
      new Date(value),
    );
  return { slept_at: slept, woke_at: woke, overnight: day(slept) !== day(woke) };
}

function validRotation(value: SoakRotationEvidenceV1): boolean {
  try {
    validateRotation(value);
    return true;
  } catch {
    return false;
  }
}

function validateRotation(value: SoakRotationEvidenceV1): void {
  if (
    value.schema_version !== 1 ||
    value.runtime !== "codex" ||
    value.cause !== "provider_auth_rotation" ||
    value.observed_without_injection !== true
  )
    throw new Error("rotation evidence is not a natural Codex auth rotation");
  instant(value.interrupted_at, "rotation.interrupted_at");
  instant(value.resumed_at, "rotation.resumed_at");
  if (Date.parse(value.resumed_at) <= Date.parse(value.interrupted_at))
    throw new Error("rotation resume must follow interruption");
  if (value.session_id_before === "" || value.session_id_before !== value.session_id_after)
    throw new Error("rotation must preserve exact session identity");
  if (
    !/^[a-f0-9]{64}$/.test(value.checkpoint_before_sha256) ||
    value.checkpoint_before_sha256 !== value.checkpoint_after_sha256
  )
    throw new Error("rotation must preserve exact checkpoint identity");
  if (!Array.isArray(value.evidence_refs) || value.evidence_refs.length === 0)
    throw new Error("rotation requires evidence refs");
}

function validateConfig(value: unknown): asserts value is SoakConfigV1 {
  const root = object(value, "soak config");
  exact(root, [
    "schema_version",
    "campaign_id",
    "human_authorization",
    "state_home",
    "org_home",
    "policy_path",
    "commit",
    "timezone",
    "sandbox",
  ]);
  if (root["schema_version"] !== 1) throw new Error("soak schema_version must be 1");
  safeCampaignId(required(root["campaign_id"], "campaign_id"));
  for (const name of ["state_home", "org_home", "policy_path"] as const)
    if (!isAbsolute(required(root[name], name))) throw new Error(`${name} must be absolute`);
  if (!/^[a-f0-9]{40}$/.test(required(root["commit"], "commit"))) throw new Error("commit must be an exact git oid");
  const auth = object(root["human_authorization"], "human_authorization");
  exact(auth, ["human_initiated", "authorized_by", "authorized_at", "purpose"]);
  if (auth["human_initiated"] !== true) throw new Error("soak must be human initiated");
  required(auth["authorized_by"], "authorized_by");
  instant(auth["authorized_at"], "authorized_at");
  required(auth["purpose"], "purpose");
  required(root["timezone"], "timezone");
  new Intl.DateTimeFormat("en-US", { timeZone: root["timezone"] as string }).format(new Date());
  const sandbox = object(root["sandbox"], "sandbox");
  exact(sandbox, ["org", "apps", "repos"]);
  required(sandbox["org"], "sandbox.org");
  uniqueList(sandbox["apps"], "sandbox.apps");
  uniqueList(sandbox["repos"], "sandbox.repos");
}

function validateState(value: unknown): asserts value is SoakStateV1 {
  const root = object(value, "soak state");
  exact(root, [
    "schema_version",
    "campaign_id",
    "started_at",
    "commit",
    "config_sha256",
    "policy_sha256",
    "timezone",
    "sandbox",
    "baseline",
    "checkpoints",
  ]);
  if (root["schema_version"] !== 1) throw new Error("unsupported soak state");
  safeCampaignId(required(root["campaign_id"], "campaign_id"));
  instant(root["started_at"], "started_at");
  if (!/^[a-f0-9]{40}$/.test(required(root["commit"], "commit")))
    throw new Error("soak state commit must be an exact oid");
  for (const name of ["config_sha256", "policy_sha256"] as const)
    if (!/^[a-f0-9]{64}$/.test(required(root[name], name))) throw new Error(`${name} must be a lowercase sha256`);
  required(root["timezone"], "timezone");
  const sandbox = object(root["sandbox"], "sandbox");
  exact(sandbox, ["org", "apps", "repos"]);
  required(sandbox["org"], "sandbox.org");
  uniqueList(sandbox["apps"], "sandbox.apps");
  uniqueList(sandbox["repos"], "sandbox.repos");
  const baseline = object(root["baseline"], "baseline");
  exact(baseline, ["provider_turns", "equiv_usd", "human_decision_rows"]);
  for (const value of Object.values(baseline))
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
      throw new Error("soak baseline counters must be non-negative");
  if (!Array.isArray(root["checkpoints"])) throw new Error("soak checkpoints must be an array");
  const checkpoints = root["checkpoints"] as SoakCheckpointV1[];
  for (const item of checkpoints) validateCheckpoint(item);
  if (new Set(checkpoints.map((item) => item.checkpoint_id)).size !== checkpoints.length)
    throw new Error("soak checkpoint ids must be unique");
  assertCumulativeCheckpoints(checkpoints);
}

function validateCheckpoint(value: SoakCheckpointV1): void {
  required(value.checkpoint_id, "checkpoint_id");
  instant(value.captured_at, "captured_at");
  if (value.sleep_cycle !== undefined) {
    instant(value.sleep_cycle.slept_at, "slept_at");
    instant(value.sleep_cycle.woke_at, "woke_at");
    if (typeof value.sleep_cycle.overnight !== "boolean") throw new Error("overnight must be boolean");
  }
  if (value.rotation !== undefined) validateRotation(value.rotation);
  for (const amount of [
    value.spend.provider_turns,
    value.spend.equiv_usd,
    value.spend.partial_usage_rows,
    value.state_growth.files,
    value.state_growth.bytes,
    value.human_decision_rows,
    value.roadmap_delivery.batches_observed,
    value.roadmap_delivery.batches_complete,
    value.roadmap_delivery.batches_every_unit_successful,
    value.roadmap_delivery.units_observed,
    value.roadmap_delivery.stale_frontier_refusals,
    ...Object.values(value.roadmap_delivery.session_reuse),
    ...Object.values(value.roadmap_delivery.cache_evidence),
    ...Object.values(value.roadmap_delivery.recovery_states),
  ])
    if (!Number.isFinite(amount) || amount < 0) throw new Error("soak checkpoint counters must be non-negative");
}

function summarizeRoadmapDelivery(
  explanation: Awaited<ReturnType<typeof readRoadmapExplanation>>,
  staleFrontierRefusals: number,
): SoakCheckpointV1["roadmap_delivery"] {
  const batches = explanation.apps.flatMap((app) => app.batches);
  const units = explanation.apps.flatMap((app) => app.delivery_units);
  const cache = { hit: 0, miss: 0, unknown: 0 };
  const recoveryStates: Record<UnitRecoveryState, number> = {
    not_started: 0,
    in_progress: 0,
    rerun_without_session: 0,
    consider_exact_session_reuse: 0,
    no_cross_unit_reuse: 0,
    terminal_completed: 0,
    terminal_returned: 0,
    terminal_failed: 0,
    unavailable: 0,
  };
  for (const unit of units) {
    cache[unit.cache_evidence.measurement] += 1;
    recoveryStates[unit.recovery.state] += 1;
  }
  return {
    batches_observed: batches.length,
    batches_complete: batches.filter((batch) => batch.complete).length,
    batches_every_unit_successful: batches.filter((batch) => batch.every_unit_success === true).length,
    units_observed: units.length,
    stale_frontier_refusals: staleFrontierRefusals,
    session_reuse: {
      consider_exact_reuse: recoveryStates.consider_exact_session_reuse,
      rerun_without_session: recoveryStates.rerun_without_session,
      no_cross_unit_reuse: recoveryStates.no_cross_unit_reuse,
    },
    cache_evidence: cache,
    recovery_states: recoveryStates,
  };
}

function assertSandboxMatches(config: SoakConfigV1, org: string, apps: string[], repos: string[]): void {
  if (
    config.sandbox.org !== org ||
    JSON.stringify([...config.sandbox.apps].sort()) !== JSON.stringify([...apps].sort()) ||
    JSON.stringify([...config.sandbox.repos].sort()) !== JSON.stringify([...repos].sort())
  )
    throw new Error("soak sandbox identity does not exactly match org apps.yaml");
}

function assertCumulativeCheckpoints(checkpoints: SoakCheckpointV1[]): void {
  const ordered = [...checkpoints].sort((left, right) => left.captured_at.localeCompare(right.captured_at));
  for (let index = 1; index < ordered.length; index += 1) {
    const prior = ordered[index - 1]!;
    const current = ordered[index]!;
    if (
      current.spend.provider_turns < prior.spend.provider_turns ||
      current.spend.equiv_usd < prior.spend.equiv_usd ||
      current.spend.partial_usage_rows < prior.spend.partial_usage_rows ||
      current.human_decision_rows < prior.human_decision_rows ||
      current.retention.completed_sweeps < prior.retention.completed_sweeps
    ) {
      throw new Error("soak cumulative checkpoint evidence cannot decrease");
    }
  }
}

async function persistState(stateHome: string, state: SoakStateV1): Promise<void> {
  const path = soakStatePath(stateHome, state.campaign_id);
  await mkdir(dirname(path), { recursive: true });
  await writeFileAtomic(path, `${JSON.stringify(state, null, 2)}\n`);
}

async function assertCampaignBinding(config: SoakConfigV1, state: SoakStateV1): Promise<void> {
  if (state.config_sha256 !== configDigest(config)) throw new Error("soak config drifted after campaign start");
  const policySha256 = createHash("sha256")
    .update(await readFile(config.policy_path))
    .digest("hex");
  if (state.policy_sha256 !== policySha256) throw new Error("soak policy drifted after campaign start");
}

function configDigest(config: SoakConfigV1): string {
  return createHash("sha256").update(canonicalJson(config)).digest("hex");
}

async function retentionHealth(stateHome: string): Promise<{ completed_sweeps: number; sweeps_with_errors: number }> {
  const root = join(stateHome, "state", "retention", "sweeps");
  if (!existsSync(root)) return { completed_sweeps: 0, sweeps_with_errors: 0 };
  let completed = 0;
  let errors = 0;
  for (const name of (await readdir(root)).filter((entry) => entry.endsWith(".json"))) {
    try {
      const row = JSON.parse(await readFile(join(root, name), "utf8")) as { status?: unknown; errors?: unknown[] };
      if (row.status === "completed" || row.status === "completed_with_errors") completed += 1;
      if (row.status === "completed_with_errors" || (Array.isArray(row.errors) && row.errors.length > 0)) errors += 1;
    } catch {
      errors += 1;
    }
  }
  return { completed_sweeps: completed, sweeps_with_errors: errors };
}

async function measureTree(root: string): Promise<{ files: number; bytes: number }> {
  let files = 0;
  let bytes = 0;
  async function walk(dir: string): Promise<void> {
    if (!existsSync(dir)) return;
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      const info = await lstat(path);
      if (info.isSymbolicLink()) continue;
      if (info.isDirectory()) await walk(path);
      else if (info.isFile()) {
        files += 1;
        bytes += info.size;
      }
    }
  }
  await walk(root);
  return { files, bytes };
}

async function countFiles(root: string, suffix: string): Promise<number> {
  return existsSync(root) ? (await readdir(root)).filter((name) => name.endsWith(suffix)).length : 0;
}
function providerRows<T extends { providerTurnId?: string }>(rows: T[]): T[] {
  return rows.filter((row) => row.providerTurnId !== undefined);
}
function money(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
function safeCampaignId(value: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) throw new Error("invalid soak campaign id");
}
function object(value: unknown, name: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} must be an object`);
  return value as Record<string, unknown>;
}
function exact(value: Record<string, unknown>, keys: string[]): void {
  const allowed = new Set(keys);
  const extra = Object.keys(value).filter((key) => !allowed.has(key));
  if (extra.length > 0) throw new Error(`unknown ${extra.join(", ")}`);
}
function required(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${name} must be non-empty`);
  return value;
}
function instant(value: unknown, name: string): string {
  const out = required(value, name);
  if (!Number.isFinite(Date.parse(out))) throw new Error(`${name} must be an instant`);
  return out;
}
function uniqueList(value: unknown, name: string): string[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((item) => typeof item !== "string" || item === "") ||
    new Set(value).size !== value.length
  )
    throw new Error(`${name} must be a non-empty unique string array`);
  return value as string[];
}
