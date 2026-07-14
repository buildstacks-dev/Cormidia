import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { link, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { writeFileAtomic } from "../atomic.js";
import type { SchedulerMissEvidence } from "../learning/efficiency-evidence.js";
import {
  DEFAULT_SCHEDULER_CADENCE_MINUTES,
  SCHEDULER_EVIDENCE_SCHEMA_VERSION,
  cadenceWindow,
  canonicalJson,
  scheduledEpisodeId,
  schedulerDecisionId,
  schedulerInvocationId,
  schedulerOrgId,
  sha256,
  type SchedulerDecisionOutcome,
  type SchedulerReasonCode,
} from "./model.js";

export type SchedulerDecisionStage =
  | "prepared"
  | "lock_acquired"
  | "journaled"
  | "spawn_committed"
  | "spawned"
  | "terminal";

export interface SchedulerInvocationRecord {
  schema_version: typeof SCHEDULER_EVIDENCE_SCHEMA_VERSION;
  invocation_id: string;
  scheduler_id: string;
  org_id: string;
  cadence_window: string;
  cadence_minutes: number;
  invoked_at: string;
  completed_at: string | null;
  terminal: "completed" | "failed" | null;
  reason_code: SchedulerReasonCode | null;
  missed_windows: number;
  reconciled_windows: number;
  decision_ids: string[];
}

export interface SchedulerDecisionRecord {
  schema_version: typeof SCHEDULER_EVIDENCE_SCHEMA_VERSION;
  decision_id: string;
  invocation_id: string;
  scheduler_id: string;
  org_id: string;
  cadence_window: string;
  app: string;
  role: string;
  trigger_kind: "schedule" | "event" | "recovery" | "mechanical";
  trigger: string;
  event_key: string | null;
  stage: SchedulerDecisionStage;
  outcome: SchedulerDecisionOutcome | null;
  reason_code: SchedulerReasonCode | null;
  episode_id: string | null;
  provider_turns: number | null;
  provider_settlements: number | null;
  created_at: string;
  updated_at: string;
  terminal_at: string | null;
  detail: string | null;
}

export interface SchedulerAlertRecord {
  schema_version: 1;
  alert_id: string;
  scheduler_id: string;
  org_id: string;
  reason_code: SchedulerReasonCode;
  evidence_id: string;
  occurred_at: string;
  detail: string;
  resolved: false;
}

export interface SchedulerEvidenceSummary {
  schema_version: 1;
  scheduler_id: string;
  org_id: string;
  cadence_minutes: number;
  last_due_window: string | null;
  last_invocation: string | null;
  last_completed_tick: string | null;
  next_expected_tick: string | null;
  overdue: boolean | null;
  missed_windows: number;
  counts: {
    due: number;
    executed: number;
    skipped: number;
    blocked: number;
    missed: number;
    reconciled: number;
  };
  reason_counts: Record<string, number>;
  duplicate_decisions: number;
  duplicate_episodes: number;
  orphaned_locks: number;
  orphaned_journals: number;
  orphaned_runs: number;
  orphaned_settlements: number;
  corrupt_records: string[];
  provider_turns: number | null;
  provider_settlements: number | null;
  provider_settlement_agreement: boolean | null;
  measurement_valid: boolean;
  missing_denominators: string[];
  alerts: SchedulerAlertRecord[];
  attribution: Array<{
    app: string;
    role: string;
    trigger: string;
    due: number;
    executed: number;
    blocked: number;
    skipped: number;
  }>;
}

export interface SchedulerDecisionInput {
  invocationId: string;
  cadenceWindow: string;
  app: string;
  role: string;
  triggerKind: SchedulerDecisionRecord["trigger_kind"];
  trigger: string;
  eventKey?: string;
  now: Date;
}

export async function readSchedulerMissEvidence(stateHome: string): Promise<SchedulerMissEvidence[]> {
  const dir = join(resolve(stateHome), "scheduler", "evidence", "decisions");
  if (!existsSync(dir)) return [];
  const out: SchedulerMissEvidence[] = [];
  for (const file of (await readdir(dir)).filter((name) => name.endsWith(".json")).sort()) {
    try {
      const value = JSON.parse(await readFile(join(dir, file), "utf8")) as unknown;
      if (!validDecision(value) || value.reason_code !== "missed_window_reconciled") continue;
      out.push({
        id: value.decision_id,
        app: value.app,
        episode_id: value.episode_id ?? value.decision_id,
        role: value.role,
        due_at: value.cadence_window,
        observed_at: value.updated_at,
        schedule_ref: `${value.trigger_kind}:${value.trigger}`,
      });
    } catch { /* scheduler health owns corrupt-record visibility */ }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

export class SchedulerEvidenceStore {
  readonly stateHome: string;
  readonly orgId: string;
  readonly schedulerId: string;
  readonly cadenceMinutes: number;
  private latestInvocation: SchedulerInvocationRecord | undefined;
  private latestInvocationLoaded = false;

  constructor(input: {
    stateHome: string;
    orgName: string;
    orgHome: string;
    schedulerId: string;
    cadenceMinutes?: number;
  }) {
    this.stateHome = resolve(input.stateHome);
    this.orgId = schedulerOrgId(input.orgName, input.orgHome);
    this.schedulerId = input.schedulerId;
    this.cadenceMinutes = input.cadenceMinutes ?? DEFAULT_SCHEDULER_CADENCE_MINUTES;
  }

  async beginInvocation(at: Date): Promise<SchedulerInvocationRecord> {
    const window = cadenceWindow(at, this.cadenceMinutes);
    const id = schedulerInvocationId({ orgId: this.orgId, cadenceWindow: window });
    const existing = await this.readInvocation(id);
    if (existing !== undefined) {
      this.latestInvocation = existing;
      this.latestInvocationLoaded = true;
      return existing;
    }
    if (!this.latestInvocationLoaded) {
      this.latestInvocation = (await this.listInvocations()).filter((item) => item.cadence_window < window).at(-1);
      this.latestInvocationLoaded = true;
    }
    const prior = this.latestInvocation;
    const missed = prior === undefined
      ? 0
      : Math.max(0, Math.floor((Date.parse(window) - Date.parse(prior.cadence_window)) / (this.cadenceMinutes * 60_000)) - 1);
    const record: SchedulerInvocationRecord = {
      schema_version: 1,
      invocation_id: id,
      scheduler_id: this.schedulerId,
      org_id: this.orgId,
      cadence_window: window,
      cadence_minutes: this.cadenceMinutes,
      invoked_at: at.toISOString(),
      completed_at: null,
      terminal: null,
      reason_code: missed > 0 ? "missed_window_reconciled" : null,
      missed_windows: missed,
      reconciled_windows: missed,
      decision_ids: [],
    };
    if (!(await writeRecordOnce(this.invocationPath(record.invocation_id), record))) {
      return this.mustInvocation(record.invocation_id);
    }
    this.latestInvocation = record;
    if (missed > 0) {
      await this.writeAlert("missed_window_reconciled", id, at, `${missed} missed host window(s) collapsed into one firing`);
    }
    return record;
  }

  async finishInvocation(
    invocationId: string,
    terminal: "completed" | "failed",
    reasonCode: SchedulerReasonCode,
    at: Date,
  ): Promise<SchedulerInvocationRecord> {
    const record = await this.mustInvocation(invocationId);
    if (record.terminal !== null) return record;
    const next = { ...record, terminal, reason_code: reasonCode, completed_at: at.toISOString() };
    await this.writeInvocation(next);
    if (this.latestInvocation?.invocation_id === next.invocation_id) this.latestInvocation = next;
    if (terminal === "failed") await this.writeAlert(reasonCode, invocationId, at, "scheduler invocation failed");
    return next;
  }

  async claimDecision(input: SchedulerDecisionInput): Promise<{ record: SchedulerDecisionRecord; created: boolean }> {
    const baseInput = {
      orgId: this.orgId,
      cadenceWindow: input.cadenceWindow,
      app: input.app,
      role: input.role,
      triggerKind: input.triggerKind,
      trigger: input.trigger,
      ...(input.eventKey !== undefined ? { eventKey: input.eventKey } : {}),
    };
    const baseId = schedulerDecisionId(baseInput);
    const existing = await this.readDecision(baseId);
    if (existing !== undefined && existing.stage !== "terminal") return { record: existing, created: false };
    if (existing?.outcome === "executed") return { record: existing, created: false };
    const prior = existing === undefined ? [] : (await this.listDecisions()).filter((item) =>
      item.cadence_window === input.cadenceWindow
      && item.app === input.app
      && item.role === input.role
      && item.trigger_kind === input.triggerKind
      && item.trigger === input.trigger
      && item.event_key === (input.eventKey ?? null),
    );
    const decisionId = prior.length === 0
      ? baseId
      : schedulerDecisionId({ ...baseInput, trigger: `${input.trigger}\0retry:${prior.length}` });
    const retryExisting = await this.readDecision(decisionId);
    if (retryExisting !== undefined) return { record: retryExisting, created: false };
    const record: SchedulerDecisionRecord = {
      schema_version: 1,
      decision_id: decisionId,
      invocation_id: input.invocationId,
      scheduler_id: this.schedulerId,
      org_id: this.orgId,
      cadence_window: input.cadenceWindow,
      app: input.app,
      role: input.role,
      trigger_kind: input.triggerKind,
      trigger: input.trigger,
      event_key: input.eventKey ?? null,
      stage: "prepared",
      outcome: null,
      reason_code: null,
      episode_id: scheduledEpisodeId(decisionId),
      provider_turns: null,
      provider_settlements: null,
      created_at: input.now.toISOString(),
      updated_at: input.now.toISOString(),
      terminal_at: null,
      detail: null,
    };
    if (!(await writeRecordOnce(this.decisionPath(record.decision_id), record))) {
      return { record: await this.mustDecision(record.decision_id), created: false };
    }
    const invocation = await this.mustInvocation(input.invocationId);
    if (!invocation.decision_ids.includes(decisionId)) {
      await this.writeInvocation({ ...invocation, decision_ids: [...invocation.decision_ids, decisionId].sort() });
    }
    return { record, created: true };
  }

  async advanceDecision(
    decisionId: string,
    stage: Exclude<SchedulerDecisionStage, "terminal">,
    at: Date,
    detail?: string,
  ): Promise<SchedulerDecisionRecord> {
    const record = await this.mustDecision(decisionId);
    if (record.stage === "terminal") return record;
    const next = { ...record, stage, updated_at: at.toISOString(), detail: detail ?? record.detail };
    await this.writeDecision(next);
    return next;
  }

  async finishDecision(
    decisionId: string,
    outcome: SchedulerDecisionOutcome,
    reasonCode: SchedulerReasonCode,
    at: Date,
    options: { detail?: string; providerTurns?: number; providerSettlements?: number } = {},
  ): Promise<SchedulerDecisionRecord> {
    const record = await this.mustDecision(decisionId);
    if (record.stage === "terminal") return record;
    const next: SchedulerDecisionRecord = {
      ...record,
      stage: "terminal",
      outcome,
      reason_code: reasonCode,
      updated_at: at.toISOString(),
      terminal_at: at.toISOString(),
      detail: options.detail ?? record.detail,
      provider_turns: options.providerTurns ?? (outcome === "executed" ? null : 0),
      provider_settlements: options.providerSettlements ?? (outcome === "executed" ? null : 0),
    };
    await this.writeDecision(next);
    if (["failed", "missed"].includes(outcome)) {
      await this.writeAlert(reasonCode, decisionId, at, next.detail ?? `${outcome} scheduler decision`);
    }
    return next;
  }

  async recordTurnReceipt(turnId: string, at: Date, summary?: string): Promise<SchedulerDecisionRecord | undefined> {
    const decision = (await this.listDecisions()).find((item) => item.episode_id === turnId);
    if (decision === undefined) return undefined;
    const providerTurnIds = await providerTurnIdsForTrace(this.stateHome, decision.app, turnId);
    const settledIds = await settlementIdsForTrace(this.stateHome, decision.app, turnId);
    const journal = await readJsonFile(join(this.stateHome, "state", "turns", `${turnId}.json`));
    const phase = typeof journal?.phase === "string" ? journal.phase : "failed";
    const emptyLearning = phase === "done" && providerTurnIds.size === 0 && /learning (?:distillation|review) (?:skipped|capped)/i.test(summary ?? "");
    const outcome: SchedulerDecisionOutcome = emptyLearning ? "skipped" : phase === "done" ? "executed" : phase === "blocked_on_gate" ? "blocked" : "failed";
    const reason: SchedulerReasonCode = emptyLearning ? "empty_learning_window" : phase === "done" ? "executed" : phase === "blocked_on_gate" ? "approval_blocked" : "scheduler_state_failure";
    const next: SchedulerDecisionRecord = {
      ...decision,
      stage: "terminal",
      outcome,
      reason_code: reason,
      provider_turns: emptyLearning || phase !== "done" ? providerTurnIds.size : providerTurnIds.size === 0 ? null : providerTurnIds.size,
      provider_settlements: emptyLearning || phase !== "done" ? settledIds.size : providerTurnIds.size === 0 ? null : settledIds.size,
      terminal_at: at.toISOString(),
      updated_at: at.toISOString(),
      detail: phase,
    };
    await this.writeDecision(next);
    return next;
  }

  async hasSpawnedEvent(eventKey: string, role: string): Promise<boolean> {
    return (await this.listDecisions()).some((item) =>
      item.event_key === eventKey
      && item.role === role
      && (["spawn_committed", "spawned"].includes(item.stage) || item.outcome === "executed"),
    );
  }

  async lastSpawnedScheduleWindow(app: string, role: string, trigger: string): Promise<Date | undefined> {
    const windows = (await this.listDecisions())
      .filter((item) => item.app === app && item.role === role && item.trigger === trigger && item.trigger_kind === "schedule")
      .filter((item) => ["spawn_committed", "spawned"].includes(item.stage) || item.outcome === "executed")
      .map((item) => item.cadence_window)
      .sort();
    return windows.length === 0 ? undefined : new Date(windows.at(-1)!);
  }

  async listInvocations(): Promise<SchedulerInvocationRecord[]> {
    const corrupt: string[] = [];
    const records = await this.listRecords<SchedulerInvocationRecord>(this.invocationsDir(), validInvocation, corrupt);
    if (corrupt.length > 0) throw new Error(`scheduler invocation evidence corrupt: ${corrupt.sort().join(", ")}`);
    return records;
  }

  async listDecisions(): Promise<SchedulerDecisionRecord[]> {
    const corrupt: string[] = [];
    const records = await this.listRecords<SchedulerDecisionRecord>(this.decisionsDir(), validDecision, corrupt);
    if (corrupt.length > 0) throw new Error(`scheduler decision evidence corrupt: ${corrupt.sort().join(", ")}`);
    return records;
  }

  async listAlerts(): Promise<SchedulerAlertRecord[]> {
    return this.listRecords<SchedulerAlertRecord>(this.alertsDir(), validAlert);
  }

  async summarize(now: Date): Promise<SchedulerEvidenceSummary> {
    const corrupt: string[] = [];
    const invocations = await this.listRecords<SchedulerInvocationRecord>(this.invocationsDir(), validInvocation, corrupt);
    const decisions = await this.listRecords<SchedulerDecisionRecord>(this.decisionsDir(), validDecision, corrupt);
    const alerts = await this.listRecords<SchedulerAlertRecord>(this.alertsDir(), validAlert, corrupt);
    const last = invocations.at(-1);
    const nextExpected = last === undefined ? null : new Date(Date.parse(last.cadence_window) + this.cadenceMinutes * 60_000).toISOString();
    const overdue = nextExpected === null ? null : now.getTime() > Date.parse(nextExpected) + this.cadenceMinutes * 60_000;
    const decisionCounts = countValues(decisions.map((item) => item.decision_id));
    const episodeCounts = countValues(decisions.flatMap((item) => item.episode_id === null ? [] : [item.episode_id]));
    const missing = decisions
      .filter((item) => item.outcome === "executed" && (item.provider_turns === null || item.provider_settlements === null))
      .map((item) => item.decision_id);
    missing.push(...invocations.filter((item) => item.terminal === null).map((item) => `invocation:${item.invocation_id}:terminal`));
    const providerTurns = missing.length === 0 ? sum(decisions.map((item) => item.provider_turns ?? 0)) : null;
    const providerSettlements = missing.length === 0 ? sum(decisions.map((item) => item.provider_settlements ?? 0)) : null;
    const orphans = await findOrphans(this.stateHome, new Set(decisions.map((item) => item.episode_id).filter((id): id is string => id !== null)), corrupt);
    const grouped = new Map<string, SchedulerEvidenceSummary["attribution"][number]>();
    for (const decision of decisions) {
      const key = `${decision.app}\0${decision.role}\0${decision.trigger}`;
      const row = grouped.get(key) ?? { app: decision.app, role: decision.role, trigger: decision.trigger, due: 0, executed: 0, blocked: 0, skipped: 0 };
      row.due += 1;
      if (decision.outcome === "executed") row.executed += 1;
      if (decision.outcome === "blocked") row.blocked += 1;
      if (decision.outcome === "skipped") row.skipped += 1;
      grouped.set(key, row);
    }
    return {
      schema_version: 1,
      scheduler_id: this.schedulerId,
      org_id: this.orgId,
      cadence_minutes: this.cadenceMinutes,
      last_due_window: last?.cadence_window ?? null,
      last_invocation: last?.invoked_at ?? null,
      last_completed_tick: [...invocations].reverse().find((item) => item.terminal === "completed")?.completed_at ?? null,
      next_expected_tick: nextExpected,
      overdue,
      missed_windows: sum(invocations.map((item) => item.missed_windows)),
      counts: {
        due: decisions.length,
        executed: decisions.filter((item) => item.outcome === "executed").length,
        skipped: decisions.filter((item) => item.outcome === "skipped").length,
        blocked: decisions.filter((item) => item.outcome === "blocked").length,
        missed: decisions.filter((item) => item.outcome === "missed").length + sum(invocations.map((item) => item.missed_windows)),
        reconciled: decisions.filter((item) => item.outcome === "reconciled").length + sum(invocations.map((item) => item.reconciled_windows)),
      },
      reason_counts: Object.fromEntries([...countValues(decisions.map((item) => item.reason_code).filter((code): code is SchedulerReasonCode => code !== null)).entries()].sort()),
      duplicate_decisions: duplicateCount(decisionCounts),
      duplicate_episodes: duplicateCount(episodeCounts),
      orphaned_locks: orphans.locks,
      orphaned_journals: orphans.journals,
      orphaned_runs: orphans.runs,
      orphaned_settlements: orphans.settlements,
      corrupt_records: corrupt.sort(),
      provider_turns: providerTurns,
      provider_settlements: providerSettlements,
      provider_settlement_agreement: providerTurns === null || providerSettlements === null ? null : providerTurns === providerSettlements,
      measurement_valid: corrupt.length === 0 && missing.length === 0,
      missing_denominators: missing.sort(),
      alerts,
      attribution: [...grouped.values()].sort((a, b) => a.app.localeCompare(b.app) || a.role.localeCompare(b.role) || a.trigger.localeCompare(b.trigger)),
    };
  }

  private async readInvocation(id: string): Promise<SchedulerInvocationRecord | undefined> {
    return this.readRecord(this.invocationPath(id), validInvocation);
  }

  private async mustInvocation(id: string): Promise<SchedulerInvocationRecord> {
    const record = await this.readInvocation(id);
    if (record === undefined) throw new Error(`scheduler invocation missing: ${id}`);
    return record;
  }

  private async readDecision(id: string): Promise<SchedulerDecisionRecord | undefined> {
    return this.readRecord(this.decisionPath(id), validDecision);
  }

  private async mustDecision(id: string): Promise<SchedulerDecisionRecord> {
    const record = await this.readDecision(id);
    if (record === undefined) throw new Error(`scheduler decision missing: ${id}`);
    return record;
  }

  private async writeInvocation(record: SchedulerInvocationRecord): Promise<void> {
    await writeRecord(this.invocationPath(record.invocation_id), record);
  }

  private async writeDecision(record: SchedulerDecisionRecord): Promise<void> {
    await writeRecord(this.decisionPath(record.decision_id), record);
  }

  private async writeAlert(reason: SchedulerReasonCode, evidenceId: string, at: Date, detail: string): Promise<void> {
    const alertId = `alert_${sha256(`${this.orgId}\0${reason}\0${evidenceId}`).slice(7, 31)}`;
    const path = join(this.alertsDir(), `${alertId}.json`);
    if (existsSync(path)) return;
    await writeRecord(path, {
      schema_version: 1,
      alert_id: alertId,
      scheduler_id: this.schedulerId,
      org_id: this.orgId,
      reason_code: reason,
      evidence_id: evidenceId,
      occurred_at: at.toISOString(),
      detail,
      resolved: false,
    } satisfies SchedulerAlertRecord);
  }

  private async readRecord<T>(path: string, validate: (value: unknown) => value is T): Promise<T | undefined> {
    if (!existsSync(path)) return undefined;
    const value = JSON.parse(await readFile(path, "utf8")) as unknown;
    if (!validate(value)) throw new Error(`scheduler record schema mismatch: ${path}`);
    return value;
  }

  private async listRecords<T>(dir: string, validate: (value: unknown) => value is T, corrupt: string[] = []): Promise<T[]> {
    if (!existsSync(dir)) return [];
    const out: T[] = [];
    for (const file of (await readdir(dir)).filter((name) => name.endsWith(".json")).sort()) {
      try {
        const value = JSON.parse(await readFile(join(dir, file), "utf8")) as unknown;
        if (!validate(value)) throw new Error("schema mismatch");
        out.push(value);
      } catch {
        corrupt.push(join(dir, file));
      }
    }
    return out.sort(byIdentity);
  }

  private root(): string { return join(this.stateHome, "scheduler", "evidence"); }
  private invocationsDir(): string { return join(this.root(), "invocations"); }
  private decisionsDir(): string { return join(this.root(), "decisions"); }
  private alertsDir(): string { return join(this.root(), "alerts"); }
  private invocationPath(id: string): string { return join(this.invocationsDir(), `${id}.json`); }
  private decisionPath(id: string): string { return join(this.decisionsDir(), `${id}.json`); }
}

async function writeRecord(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFileAtomic(path, canonicalJson(value));
}

async function writeRecordOnce(path: string, value: unknown): Promise<boolean> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    await writeFile(temp, canonicalJson(value), { encoding: "utf8", flag: "wx", mode: 0o600 });
    try {
      await link(temp, path);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
      throw error;
    }
  } finally {
    await rm(temp, { force: true }).catch(() => {});
  }
}

function validInvocation(value: unknown): value is SchedulerInvocationRecord {
  const row = record(value);
  return row?.schema_version === 1 && typeof row.invocation_id === "string" && typeof row.org_id === "string"
    && typeof row.cadence_window === "string" && Array.isArray(row.decision_ids);
}

function validDecision(value: unknown): value is SchedulerDecisionRecord {
  const row = record(value);
  return row?.schema_version === 1 && typeof row.decision_id === "string" && typeof row.invocation_id === "string"
    && typeof row.app === "string" && typeof row.role === "string" && typeof row.stage === "string";
}

function validAlert(value: unknown): value is SchedulerAlertRecord {
  const row = record(value);
  return row?.schema_version === 1 && typeof row.alert_id === "string" && typeof row.reason_code === "string";
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function byIdentity(a: unknown, b: unknown): number {
  return identity(a).localeCompare(identity(b));
}

function identity(value: unknown): string {
  const row = record(value);
  return String(row?.cadence_window ?? row?.decision_id ?? row?.invocation_id ?? row?.alert_id ?? "");
}

function countValues(values: string[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const value of values) out.set(value, (out.get(value) ?? 0) + 1);
  return out;
}

function duplicateCount(counts: Map<string, number>): number {
  return [...counts.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0);
}

function sum(values: number[]): number { return values.reduce((total, value) => total + value, 0); }

async function providerTurnIdsForTrace(stateHome: string, app: string, traceId: string): Promise<Set<string>> {
  const root = join(stateHome, "runs", app);
  const ids = new Set<string>();
  if (!existsSync(root)) return ids;
  for (const run of await readdir(root)) {
    const envelope = await readJsonFile(join(root, run, "envelope.json"));
    if (envelope?.trace_id !== traceId || !Array.isArray(envelope.provider_turn_ids)) continue;
    for (const id of envelope.provider_turn_ids) if (typeof id === "string") ids.add(id);
  }
  return ids;
}

async function settlementIdsForTrace(stateHome: string, app: string, traceId: string): Promise<Set<string>> {
  const root = join(stateHome, "telemetry");
  const ids = new Set<string>();
  if (!existsSync(root)) return ids;
  for (const file of (await readdir(root)).filter((name) => name.endsWith(".jsonl")).sort()) {
    const text = await readFile(join(root, file), "utf8");
    for (const line of text.split("\n").filter(Boolean)) {
      try {
        const row = JSON.parse(line) as Record<string, unknown>;
        if (row.app === app && row.traceId === traceId && typeof row.providerTurnId === "string") ids.add(row.providerTurnId);
      } catch { /* corrupt ledger rows are surfaced by reporting; not inferred as settlement */ }
    }
  }
  return ids;
}

async function readJsonFile(path: string): Promise<Record<string, unknown> | undefined> {
  if (!existsSync(path)) return undefined;
  try { return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>; }
  catch { return undefined; }
}

async function findOrphans(stateHome: string, episodes: Set<string>, corrupt: string[]): Promise<{ locks: number; journals: number; runs: number; settlements: number }> {
  let locks = 0; let journals = 0; let runs = 0; let settlements = 0;
  const lockDir = join(stateHome, "locks");
  if (existsSync(lockDir)) for (const file of (await readdir(lockDir)).filter((name) => name.endsWith(".lock"))) {
    try {
      const value = JSON.parse(await readFile(join(lockDir, file), "utf8")) as Record<string, unknown>;
      if (typeof value.turnId === "string" && value.turnId.startsWith("scheduled_") && !episodes.has(value.turnId)) locks += 1;
    } catch { corrupt.push(join(lockDir, file)); locks += 1; }
  }
  const journalDir = join(stateHome, "state", "turns");
  if (existsSync(journalDir)) for (const file of (await readdir(journalDir)).filter((name) => name.endsWith(".json"))) {
    const id = file.slice(0, -5);
    if (id.startsWith("scheduled_") && !episodes.has(id)) journals += 1;
  }
  const runsRoot = join(stateHome, "runs");
  if (existsSync(runsRoot)) for (const app of await readdir(runsRoot)) {
    const appRoot = join(runsRoot, app);
    for (const run of await readdir(appRoot).catch(() => [])) {
      const envelope = await readJsonFile(join(appRoot, run, "envelope.json"));
      if (typeof envelope?.trace_id === "string" && envelope.trace_id.startsWith("scheduled_") && !episodes.has(envelope.trace_id)) runs += 1;
    }
  }
  const telemetry = join(stateHome, "telemetry");
  if (existsSync(telemetry)) for (const file of (await readdir(telemetry)).filter((name) => name.endsWith(".jsonl"))) {
    for (const line of (await readFile(join(telemetry, file), "utf8")).split("\n").filter(Boolean)) {
      try {
        const row = JSON.parse(line) as Record<string, unknown>;
        if (typeof row.traceId === "string" && row.traceId.startsWith("scheduled_") && !episodes.has(row.traceId)) settlements += 1;
      } catch { corrupt.push(join(telemetry, file)); }
    }
  }
  return { locks, journals, runs, settlements };
}
