import type { SchedulerDefinitionInput } from "./definition.js";
import { SchedulerEvidenceStore, type SchedulerEvidenceSummary } from "./evidence.js";
import { schedulerDefinitionStatus, type SchedulerDefinitionStatus } from "./lifecycle.js";
import type { SchedulerManager } from "./manager.js";
import { DEFAULT_SCHEDULER_CADENCE_MINUTES, type SchedulerReasonCode } from "./model.js";

export interface SchedulerOperationalStatus {
  schema_version: 1;
  healthy: boolean;
  measurement_valid: boolean;
  reason_codes: SchedulerReasonCode[];
  definition: SchedulerDefinitionStatus;
  evidence: SchedulerEvidenceSummary;
  blocking_reasons: SchedulerReasonCode[];
  local_alerts_requiring_attention: number;
}

export async function schedulerOperationalStatus(input: SchedulerDefinitionInput & {
  manager: SchedulerManager;
  now?: Date;
  runtime?: boolean;
}): Promise<SchedulerOperationalStatus> {
  const now = input.now ?? new Date();
  const definition = await schedulerDefinitionStatus(input);
  const store = new SchedulerEvidenceStore({
    stateHome: input.stateHome,
    orgName: input.orgName,
    orgHome: input.orgHome,
    schedulerId: definition.scheduler_id,
    cadenceMinutes: input.cadenceMinutes ?? DEFAULT_SCHEDULER_CADENCE_MINUTES,
  });
  const evidence = await store.summarize(now);
  const reasons = new Set<SchedulerReasonCode>(definition.reason_codes);
  // Once intentionally uninstalled, historical runtime measurements remain
  // available in `evidence` but are not current operational reasons. Mixing
  // last_tick_failed/overdue into not_installed made an intentional stop look
  // like a still-running broken scheduler (#209).
  if (definition.installed) {
    if (evidence.last_invocation === null) reasons.add("measurement_unavailable");
    if (evidence.overdue === true) reasons.add("overdue_tick");
    if (evidence.corrupt_records.length > 0) reasons.add("scheduler_state_corrupt");
    else if (!evidence.measurement_valid) reasons.add("measurement_unavailable");
    if (evidence.duplicate_decisions > 0) reasons.add("duplicate_scheduler_decision");
    if (evidence.duplicate_episodes > 0) reasons.add("duplicate_scheduler_episode");
    if (evidence.orphaned_locks > 0) reasons.add("orphan_scheduler_lock");
    if (evidence.orphaned_journals > 0) reasons.add("orphan_scheduler_journal");
    if (evidence.orphaned_runs > 0) reasons.add("orphan_scheduler_run");
    if (evidence.orphaned_settlements > 0) reasons.add("orphan_scheduler_settlement");
    if (evidence.provider_settlement_agreement === false) reasons.add("scheduler_state_failure");
    try {
      const invocations = await store.listInvocations();
      if (invocations.at(-1)?.terminal === "failed") reasons.add("last_tick_failed");
    } catch {
      reasons.add("scheduler_state_corrupt");
    }
  }
  const recentlyTicking = evidence.last_completed_tick !== null
    && now.getTime() - Date.parse(evidence.last_completed_tick) <= definition.configured_cadence_minutes * 2 * 60_000;
  if (definition.installed && recentlyTicking && evidence.overdue !== true) reasons.add("healthy_recent_tick");
  if (definition.installed && input.runtime === false) reasons.add("measurement_unavailable");
  const blocking = [...reasons].filter((reason) => !["definition_valid", "healthy_recent_tick", "missed_window_reconciled"].includes(reason)).sort();
  const measurementValid = evidence.measurement_valid
    && evidence.last_invocation !== null
    && input.runtime !== false
    && definition.active !== null;
  const healthy = definition.definition_valid
    && definition.installation_state_valid
    && definition.active === true
    && measurementValid
    && recentlyTicking
    && evidence.provider_settlement_agreement !== false
    && blocking.length === 0;
  return {
    schema_version: 1,
    healthy,
    measurement_valid: measurementValid,
    reason_codes: [...reasons].sort(),
    definition,
    evidence,
    blocking_reasons: blocking,
    local_alerts_requiring_attention: evidence.alerts.filter((alert) => !alert.resolved).length,
  };
}
