import { createHash } from "node:crypto";
import { resolve } from "node:path";

export const SCHEDULER_SCHEMA_VERSION = 1 as const;
export const SCHEDULER_EVIDENCE_SCHEMA_VERSION = 1 as const;
export const DEFAULT_SCHEDULER_CADENCE_MINUTES = 5;

export type SchedulerBackend = "launchd" | "systemd";

export type SchedulerReasonCode =
  | "unsupported_platform"
  | "unsupported_backend"
  | "not_installed"
  | "definition_valid"
  | "inactive"
  | "stale_definition"
  | "malformed_definition"
  | "wrong_org"
  | "wrong_state_home"
  | "wrong_executable"
  | "cadence_drift"
  | "ownership_mismatch"
  | "scheduler_state_missing"
  | "scheduler_state_corrupt"
  | "duplicate_scheduler_decision"
  | "duplicate_scheduler_episode"
  | "orphan_scheduler_lock"
  | "orphan_scheduler_journal"
  | "orphan_scheduler_run"
  | "orphan_scheduler_settlement"
  | "healthy_recent_tick"
  | "overdue_tick"
  | "last_tick_failed"
  | "measurement_unavailable"
  | "fresh_lock"
  | "wip_limit"
  | "budget_paused"
  | "approval_blocked"
  | "channel_gated"
  | "no_subscriber"
  | "no_due_work"
  | "empty_learning_window"
  | "missed_window_reconciled"
  | "spawn_failure"
  | "post_spawn_bookkeeping_failure"
  | "scheduler_definition_failure"
  | "scheduler_state_failure"
  | "executed";

export type SchedulerDecisionOutcome =
  | "executed"
  | "skipped"
  | "blocked"
  | "missed"
  | "reconciled"
  | "failed";

export interface SchedulerCommand {
  executablePath: string;
  packageEntryPath: string;
  args: string[];
}

export interface SchedulerDefinitionMetadata {
  schema_version: typeof SCHEDULER_SCHEMA_VERSION;
  owner: "cormidia";
  scheduler_id: string;
  org_id: string;
  org_name: string;
  backend: SchedulerBackend;
  cadence_minutes: number;
  executable_path: string;
  package_entry_path: string;
  org_home: string;
  state_home: string;
  command_sha256: string;
}

export interface SchedulerExpectation {
  metadata: SchedulerDefinitionMetadata;
  command: SchedulerCommand;
  definition: string;
  definitionHash: string;
}

export function schedulerOrgId(orgName: string, orgHome: string): string {
  return `org_${digest(`${orgName}\0${resolve(orgHome)}`).slice(0, 20)}`;
}

export function schedulerIdentity(orgName: string, orgHome: string): string {
  const slug = orgName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32) || "org";
  return `dev.cormidia.dispatch.${slug}.${digest(resolve(orgHome)).slice(0, 12)}`;
}

export function cadenceWindow(at: Date, cadenceMinutes = DEFAULT_SCHEDULER_CADENCE_MINUTES): string {
  assertCadence(cadenceMinutes);
  const width = cadenceMinutes * 60_000;
  return new Date(Math.floor(at.getTime() / width) * width).toISOString();
}

export function schedulerInvocationId(input: {
  orgId: string;
  cadenceWindow: string;
}): string {
  return `tick_${digest(`${input.orgId}\0${input.cadenceWindow}`).slice(0, 24)}`;
}

export function schedulerDecisionId(input: {
  orgId: string;
  cadenceWindow: string;
  app: string;
  role: string;
  triggerKind: string;
  trigger: string;
  eventKey?: string;
}): string {
  return `decision_${digest([
    input.orgId,
    input.cadenceWindow,
    input.app,
    input.role,
    input.triggerKind,
    input.trigger,
    input.eventKey ?? "",
  ].join("\0")).slice(0, 28)}`;
}

export function scheduledEpisodeId(decisionId: string): string {
  return `scheduled_${digest(decisionId).slice(0, 28)}`;
}

export function sha256(value: string | Buffer): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function canonicalJson(value: unknown): string {
  return `${JSON.stringify(sortValue(value), null, 2)}\n`;
}

export function assertCadence(value: number): void {
  if (!Number.isInteger(value) || value < 1 || value > 24 * 60) {
    throw new Error(`scheduler: cadence must be an integer from 1 to 1440 minutes, got ${value}`);
  }
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, sortValue(item)]),
    );
  }
  return value;
}
