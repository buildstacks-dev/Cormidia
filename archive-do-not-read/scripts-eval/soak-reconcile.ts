import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { hashFile, type CampaignManifest } from "./core.js";
import { readTurnRecords } from "../../src/runtime/telemetry.js";
import type { RunEnvelope } from "../../src/runtime/runlog/envelope.js";

export interface RealtimeSoakStateEvidence {
  started_at: string;
  ends_at: string;
  ticks: Array<{ index: number; due_at: string; recorded_at: string; reason: "not_useful_due" | "useful_turn" }>;
  turns: Array<{ index: number; tick_index: number; run_id: string; cost_usd: number; wall_clock_ms: number; tokens_in: number; tokens_out: number; usage_quality: string; status: string }>;
  restart: { due_at: string; prior_pid: number; exit_requested_at?: string; replacement_pid?: number; receipt_at?: string };
}

export interface SoakReconciliation {
  passed: boolean;
  provider_settlements: number;
  mechanical_settlements: number;
  context_rendered_bytes: number;
  context_sources: Record<string, number>;
  duplicate_ticks: number;
  silent_misses: number;
  orphaned_runs: number;
  orphaned_settlements: number;
  distinct_process_restart: boolean;
  missing: string[];
  receipt: Record<string, unknown>;
}

export async function reconcileRealtimeSoak(input: {
  campaign: CampaignManifest;
  campaignSha256: string;
  campaignRoot: string;
  state: RealtimeSoakStateEvidence;
}): Promise<SoakReconciliation> {
  if (!input.campaign.soak) throw new Error("soak_reconciliation_requires_schedule");
  const totalTicks = Math.ceil(input.campaign.soak.duration_hours * 60 / input.campaign.soak.tick_interval_minutes);
  const tickIds = input.state.ticks.map((tick) => tick.index);
  const duplicateTicks = tickIds.length - new Set(tickIds).size;
  const silentMisses = Array.from({ length: totalTicks }, (_, index) => index + 1).filter((index) => !tickIds.includes(index)).length;
  const startedAt = Date.parse(input.state.started_at);
  const endsAt = Date.parse(input.state.ends_at);
  const restartDueAt = Date.parse(input.state.restart.due_at);
  const expectedDurationMs = input.campaign.soak.duration_hours * 3_600_000;
  const expectedRestartMs = input.campaign.soak.deliberate_restart_hour * 3_600_000;
  const tickIntervalMs = input.campaign.soak.tick_interval_minutes * 60_000;
  const invalidTickSchedule = !Number.isFinite(startedAt) || !Number.isFinite(endsAt) || endsAt - startedAt !== expectedDurationMs ||
    !Number.isFinite(restartDueAt) || restartDueAt - startedAt !== expectedRestartMs ||
    input.state.ticks.some((tick) => !Number.isInteger(tick.index) || tick.index < 1 || tick.index > totalTicks || !["not_useful_due", "useful_turn"].includes(tick.reason) || Date.parse(tick.due_at) !== startedAt + (tick.index - 1) * tickIntervalMs || !Number.isFinite(Date.parse(tick.recorded_at)) || Date.parse(tick.recorded_at) < Date.parse(tick.due_at));
  const usefulTickIds = input.state.ticks.filter((tick) => tick.reason === "useful_turn").map((tick) => tick.index);
  const invalidTurnRecords = input.state.turns.some((turn, ordinal) => turn.index !== ordinal + 1 || !Number.isInteger(turn.tick_index) || !usefulTickIds.includes(turn.tick_index) || turn.status !== "completed" || !Number.isFinite(turn.cost_usd) || turn.cost_usd < 0 || !Number.isFinite(turn.wall_clock_ms) || turn.wall_clock_ms < 0 || !Number.isInteger(turn.tokens_in) || turn.tokens_in < 0 || !Number.isInteger(turn.tokens_out) || turn.tokens_out < 0 || !["complete", "estimated"].includes(turn.usage_quality));
  const invalidUsefulSchedule = usefulTickIds.length !== input.campaign.soak.useful_turn_cap || new Set(usefulTickIds).size !== usefulTickIds.length || new Set(input.state.turns.map((turn) => turn.tick_index)).size !== input.state.turns.length;
  const runIds = input.state.turns.map((turn) => turn.run_id);
  const runIdSet = new Set(runIds);
  const providerTurnIds: string[] = [];
  const envelopeSha256: Record<string, string> = {};
  const terminalStatuses: Record<string, string> = {};
  const providerTurnByRun = new Map<string, string>();
  const contextManifestSha256: Record<string, string> = {};
  const contextSources: Record<string, number> = {};
  let orphanedRuns = runIds.length - runIdSet.size;
  let invalidContextManifests = 0;
  const terminal = new Set(["completed", "failed", "blocked", "cancelled", "timed_out"]);
  for (const runId of runIdSet) {
    const envelopePath = join(input.campaignRoot, "state", "runs", "service", runId, "envelope.json");
    if (!existsSync(envelopePath)) { orphanedRuns += 1; continue; }
    try {
      const envelope = JSON.parse(readFileSync(envelopePath, "utf8")) as RunEnvelope;
      envelopeSha256[runId] = `sha256:${hashFile(envelopePath)}`;
      terminalStatuses[runId] = envelope.status;
      if (envelope.run_id !== runId || envelope.app !== "service" || !terminal.has(envelope.status) || !Array.isArray(envelope.provider_turn_ids) || envelope.provider_turn_ids.length !== 1) orphanedRuns += 1;
      for (const providerTurnId of envelope.provider_turn_ids ?? []) {
        providerTurnIds.push(providerTurnId);
        providerTurnByRun.set(runId, providerTurnId);
      }
    } catch { orphanedRuns += 1; }
    const contextPath = join(input.campaignRoot, "state", "runs", "service", runId, "context-manifest.json");
    if (!existsSync(contextPath)) { invalidContextManifests += 1; continue; }
    try {
      const context = JSON.parse(readFileSync(contextPath, "utf8")) as Record<string, unknown>;
      const renderedBytes = context.rendered_bytes;
      if (context.schema_version !== 1 || context.run_id !== runId || context.app !== "service" || context.route !== "standard" || typeof context.episode_id !== "string" || context.episode_id.length === 0 || typeof context.render_sha256 !== "string" || !/^[a-f0-9]{64}$/.test(context.render_sha256) || !Number.isInteger(renderedBytes) || Number(renderedBytes) <= 0 || !Array.isArray(context.components)) { invalidContextManifests += 1; continue; }
      contextSources[`run:${runId}`] = Number(renderedBytes);
      contextManifestSha256[runId] = `sha256:${hashFile(contextPath)}`;
    } catch { invalidContextManifests += 1; }
  }
  const runsRoot = join(input.campaignRoot, "state", "runs", "service");
  if (existsSync(runsRoot)) orphanedRuns += readdirSync(runsRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory() && !runIdSet.has(entry.name)).length;
  const providerIdSet = new Set(providerTurnIds);
  const rows = await readTurnRecords(join(input.campaignRoot, "state"));
  const serviceRows = rows.filter((row) => row.app === "service");
  const mechanicalSettlements = serviceRows.filter((row) => row.providerTurnId === undefined).length;
  const settlementIds = serviceRows.map((row) => row.providerTurnId).filter((id): id is string => typeof id === "string");
  const uniqueSettlementIds = new Set(settlementIds);
  const duplicateSettlements = settlementIds.length - uniqueSettlementIds.size;
  const foreignSettlements = [...uniqueSettlementIds].filter((id) => !providerIdSet.has(id)).length;
  const orphanedSettlements = duplicateSettlements + foreignSettlements;
  const providerSettlements = [...uniqueSettlementIds].filter((id) => providerIdSet.has(id)).length;
  const settlementMeasurementInvalid = input.state.turns.some((turn) => {
    const providerTurnId = providerTurnByRun.get(turn.run_id);
    const row = serviceRows.find((candidate) => candidate.providerTurnId === providerTurnId);
    return providerTurnId === undefined || row === undefined || row.runId !== turn.run_id || row.status !== "completed" || row.costUsd !== turn.cost_usd || row.wallClockMs !== turn.wall_clock_ms || row.tokensIn !== turn.tokens_in || row.tokensOut !== turn.tokens_out || row.usageQuality !== turn.usage_quality;
  });
  const exitRequestedAt = typeof input.state.restart.exit_requested_at === "string" ? Date.parse(input.state.restart.exit_requested_at) : Number.NaN;
  const receiptAt = typeof input.state.restart.receipt_at === "string" ? Date.parse(input.state.restart.receipt_at) : Number.NaN;
  const distinctProcessRestart = Number.isFinite(exitRequestedAt) && exitRequestedAt >= restartDueAt && Number.isFinite(receiptAt) && receiptAt >= exitRequestedAt && Number.isInteger(input.state.restart.prior_pid) && input.state.restart.prior_pid > 0 && Number.isInteger(input.state.restart.replacement_pid) && Number(input.state.restart.replacement_pid) > 0 && input.state.restart.replacement_pid !== input.state.restart.prior_pid;
  const missing: string[] = [];
  if (input.state.ticks.length !== totalTicks || duplicateTicks !== 0 || silentMisses !== 0 || invalidTickSchedule) missing.push("soak_ticks");
  if (input.state.turns.length !== input.campaign.soak.useful_turn_cap) missing.push("soak_useful_turns");
  if (invalidUsefulSchedule || invalidTurnRecords) missing.push("soak_turn_records");
  if (!distinctProcessRestart) missing.push("soak_restart_receipt");
  if (providerTurnIds.length !== input.state.turns.length || providerIdSet.size !== providerTurnIds.length || providerSettlements !== input.state.turns.length) missing.push("soak_provider_settlements");
  if (settlementMeasurementInvalid) missing.push("soak_settlement_measurements");
  if (mechanicalSettlements !== 0) missing.push("soak_mechanical_settlements");
  if (invalidContextManifests !== 0 || Object.keys(contextSources).length !== input.state.turns.length) missing.push("soak_context_manifests");
  if (duplicateTicks !== 0) missing.push("soak_duplicate_ticks");
  if (silentMisses !== 0) missing.push("soak_silent_misses");
  if (orphanedRuns !== 0) missing.push("soak_orphaned_runs");
  if (orphanedSettlements !== 0) missing.push("soak_orphaned_settlements");
  const passed = missing.length === 0;
  const terminalIntegrity = input.state.turns.length === input.campaign.soak.useful_turn_cap && orphanedRuns === 0 && invalidTurnRecords === false ? 1 : 0;
  const contextRenderedBytes = Object.values(contextSources).reduce((sum, value) => sum + value, 0);
  const receipt = { schema_version: 1, evidence_kind: "soak-accounting", campaign_id: input.campaign.campaign_id, campaign_sha256: input.campaignSha256, attempt_id: "soak-realtime-48h-v1-real-1", case_id: "soak/realtime-48h/v1", repetition_id: "real-1", due_tick_ids: [...tickIds].sort((a, b) => a - b), useful_tick_ids: [...usefulTickIds].sort((a, b) => a - b), run_ids: [...runIdSet].sort(), provider_turn_ids: [...providerIdSet].sort(), settlement_ids: [...uniqueSettlementIds].sort(), envelope_sha256: envelopeSha256, context_manifest_sha256: contextManifestSha256, context_sources: contextSources, context_rendered_bytes: contextRenderedBytes, terminal_statuses: terminalStatuses, restart_due_at: input.state.restart.due_at, exit_requested_at: input.state.restart.exit_requested_at, prior_pid: input.state.restart.prior_pid, receipt_at: input.state.restart.receipt_at, replacement_pid: input.state.restart.replacement_pid, provider_turns: input.state.turns.length, provider_settlements: providerSettlements, mechanical_settlements: mechanicalSettlements, duplicate_ticks: duplicateTicks, silent_misses: silentMisses, orphaned_runs: orphanedRuns, orphaned_settlements: orphanedSettlements, distinct_process_restart: distinctProcessRestart, terminal_integrity: terminalIntegrity, passed, missing: [...missing] };
  return { passed, provider_settlements: providerSettlements, mechanical_settlements: mechanicalSettlements, context_rendered_bytes: contextRenderedBytes, context_sources: contextSources, duplicate_ticks: duplicateTicks, silent_misses: silentMisses, orphaned_runs: orphanedRuns, orphaned_settlements: orphanedSettlements, distinct_process_restart: distinctProcessRestart, missing, receipt };
}
