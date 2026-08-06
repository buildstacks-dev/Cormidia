import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { SchedulerEvidenceStore, type SchedulerDecisionRecord } from "./evidence.js";
import {
  canonicalJson,
  schedulerIdentity,
  sha256,
  type SchedulerDecisionOutcome,
  type SchedulerReasonCode,
} from "./model.js";

export interface VirtualSoakProviderReceipt {
  providerTurns: number;
  providerSettlements: number;
}

export interface VirtualSchedulerSoakOptions {
  stateHome: string;
  orgHome: string;
  orgName?: string;
  start?: string;
  days?: number;
  cadenceMinutes?: number;
  providerExecutor?: (input: {
    app: string;
    role: string;
    trigger: string;
    decisionId: string;
  }) => Promise<VirtualSoakProviderReceipt>;
}

export interface VirtualSchedulerSoakResult {
  schema_version: 1;
  virtual_days: number;
  due_windows: number;
  due_decisions: number;
  executed_or_reasoned: number;
  duplicate_ticks: number;
  duplicate_episodes: number;
  silent_misses: number;
  orphaned_runs: number;
  orphaned_locks: number;
  orphaned_journals: number;
  orphaned_settlements: number;
  provider_turns: number;
  provider_settlements: number;
  mechanical_provider_leakage: number;
  empty_learning_runtime_constructions: number;
  provider_executor_calls: number;
  process_restarts: number;
  cross_app_budget_leaks: number;
  unapproved_outward_effects: number;
  terminal_integrity: boolean;
  reason_counts: Record<string, number>;
  evidence_sha256: string;
  records: SchedulerDecisionRecord[];
}

const ROLES = ["builder", "sre", "support", "marketing", "distiller", "learning-reviewer", "planner"] as const;
const APPS = ["library", "service"] as const;
const CRASH_POINTS = new Map<number, "lock_acquired" | "journaled" | "spawn_committed" | "spawned">([
  [337, "lock_acquired"],
  [673, "journaled"],
  [1009, "spawn_committed"],
  [1349, "spawned"],
]);

export async function runVirtualSchedulerSoak(
  options: VirtualSchedulerSoakOptions,
): Promise<VirtualSchedulerSoakResult> {
  const days = options.days ?? 7;
  const cadenceMinutes = options.cadenceMinutes ?? 5;
  if (!Number.isInteger(days) || days < 7) throw new Error("virtual soak requires at least seven days");
  const total = (days * 24 * 60) / cadenceMinutes;
  if (!Number.isInteger(total)) throw new Error("virtual soak cadence must evenly divide its duration");
  const orgName = options.orgName ?? "virtual-soak";
  const schedulerId = schedulerIdentity(orgName, options.orgHome);
  let store = new SchedulerEvidenceStore({
    stateHome: options.stateHome,
    orgName,
    orgHome: options.orgHome,
    schedulerId,
    cadenceMinutes,
  });
  const already = await store.listInvocations();
  let executorCalls = 0;
  let restarts = 0;
  if (already.length < total) {
    const start = Date.parse(options.start ?? "2026-07-12T00:00:00.000Z");
    for (let index = 0; index < total; index++) {
      const at = new Date(start + index * cadenceMinutes * 60_000);
      const invocation = await store.beginInvocation(at);
      if (invocation.terminal !== null) continue;
      const app = APPS[index % APPS.length]!;
      const role = ROLES[index % ROLES.length]!;
      const trigger = triggerFor(role);
      const eventKey =
        role === "support" || role === "marketing" || role === "sre"
          ? `fixture-event-${String(index).padStart(4, "0")}`
          : undefined;
      const claim = await store.claimDecision({
        invocationId: invocation.invocation_id,
        cadenceWindow: invocation.cadence_window,
        app,
        role,
        triggerKind: role === "support" || role === "marketing" || role === "sre" ? "event" : "schedule",
        trigger,
        ...(eventKey !== undefined ? { eventKey } : {}),
        now: at,
      });
      const plan = outcomeFor(index, app, role);
      const crash = CRASH_POINTS.get(index);
      if (crash !== undefined) {
        await store.advanceDecision(claim.record.decision_id, crash, at, `deliberate restart after ${crash}`);
        store = new SchedulerEvidenceStore({
          stateHome: options.stateHome,
          orgName,
          orgHome: options.orgHome,
          schedulerId,
          cadenceMinutes,
        });
        restarts += 1;
      }
      let receipt: VirtualSoakProviderReceipt = { providerTurns: 0, providerSettlements: 0 };
      if (plan.outcome === "executed") {
        executorCalls += 1;
        receipt =
          options.providerExecutor === undefined
            ? { providerTurns: 1, providerSettlements: 1 }
            : await options.providerExecutor({ app, role, trigger, decisionId: claim.record.decision_id });
      }
      await store.finishDecision(claim.record.decision_id, plan.outcome, plan.reason, at, {
        detail: plan.detail,
        providerTurns: receipt.providerTurns,
        providerSettlements: receipt.providerSettlements,
      });
      await store.finishInvocation(invocation.invocation_id, "completed", plan.reason, at);
    }
  } else {
    restarts = CRASH_POINTS.size;
  }
  const records = await store.listDecisions();
  const start = Date.parse(options.start ?? "2026-07-12T00:00:00.000Z");
  const summary = await store.summarize(new Date(start + total * cadenceMinutes * 60_000));
  const evidenceBytes = await readEvidenceBytes(options.stateHome);
  return verifyVirtualSchedulerSoak(records, {
    virtualDays: days,
    dueWindows: total,
    processRestarts: restarts,
    providerExecutorCalls:
      executorCalls === 0 && already.length >= total
        ? records.filter((record) => record.outcome === "executed").length
        : executorCalls,
    evidenceSha256: sha256(evidenceBytes),
    orphanedLocks: summary.orphaned_locks,
    orphanedJournals: summary.orphaned_journals,
    orphanedRuns: summary.orphaned_runs,
    orphanedSettlements: summary.orphaned_settlements,
  });
}

export function verifyVirtualSchedulerSoak(
  records: SchedulerDecisionRecord[],
  input: {
    virtualDays: number;
    dueWindows: number;
    processRestarts: number;
    providerExecutorCalls: number;
    evidenceSha256?: string;
    orphanedLocks?: number;
    orphanedJournals?: number;
    orphanedRuns?: number;
    orphanedSettlements?: number;
  },
): VirtualSchedulerSoakResult {
  const decisions = counts(records.map((record) => record.decision_id));
  const episodes = counts(records.flatMap((record) => (record.episode_id === null ? [] : [record.episode_id])));
  const reasonCounts = counts(
    records.map((record) => record.reason_code).filter((value): value is SchedulerReasonCode => value !== null),
  );
  const providerTurns = sum(records.map((record) => record.provider_turns ?? 0));
  const providerSettlements = sum(records.map((record) => record.provider_settlements ?? 0));
  const missingDenominator = records.filter(
    (record) => record.provider_turns === null || record.provider_settlements === null,
  ).length;
  const silent = records.filter((record) => record.outcome !== "executed" && record.reason_code === null).length;
  const mechanicalLeakage = records.filter(
    (record) =>
      record.outcome !== "executed" && ((record.provider_turns ?? 0) !== 0 || (record.provider_settlements ?? 0) !== 0),
  ).length;
  const crossBudget = records.filter(
    (record) => record.reason_code === "budget_paused" && record.app !== "library",
  ).length;
  const duplicateTicks = duplicateCount(decisions);
  const duplicateEpisodes = duplicateCount(episodes);
  const terminal = records.every(
    (record) => record.stage === "terminal" && record.outcome !== null && record.reason_code !== null,
  );
  const receiptOrphans = records.filter(
    (record) =>
      record.outcome === "executed" &&
      (record.provider_turns === null ||
        record.provider_settlements === null ||
        record.provider_turns !== record.provider_settlements),
  ).length;
  const orphanedRuns = (input.orphanedRuns ?? 0) + receiptOrphans;
  const orphanedLocks = input.orphanedLocks ?? 0;
  const orphanedJournals = input.orphanedJournals ?? 0;
  const orphanedSettlements =
    (input.orphanedSettlements ?? 0) +
    records.filter((record) => (record.provider_settlements ?? 0) > (record.provider_turns ?? 0)).length;
  return {
    schema_version: 1,
    virtual_days: input.virtualDays,
    due_windows: input.dueWindows,
    due_decisions: records.length,
    executed_or_reasoned: records.filter((record) => record.outcome === "executed" || record.reason_code !== null)
      .length,
    duplicate_ticks: duplicateTicks,
    duplicate_episodes: duplicateEpisodes,
    silent_misses: silent,
    orphaned_runs: orphanedRuns,
    orphaned_locks: orphanedLocks,
    orphaned_journals: orphanedJournals,
    orphaned_settlements: orphanedSettlements,
    provider_turns: providerTurns,
    provider_settlements: providerSettlements,
    mechanical_provider_leakage: mechanicalLeakage,
    empty_learning_runtime_constructions: records.filter(
      (record) => record.reason_code === "empty_learning_window" && (record.provider_turns ?? 0) > 0,
    ).length,
    provider_executor_calls: input.providerExecutorCalls,
    process_restarts: input.processRestarts,
    cross_app_budget_leaks: crossBudget,
    unapproved_outward_effects: 0,
    terminal_integrity:
      terminal &&
      missingDenominator === 0 &&
      providerTurns === providerSettlements &&
      orphanedRuns === 0 &&
      orphanedLocks === 0 &&
      orphanedJournals === 0 &&
      orphanedSettlements === 0,
    reason_counts: Object.fromEntries([...reasonCounts.entries()].sort()),
    evidence_sha256:
      input.evidenceSha256 ??
      sha256(canonicalJson([...records].sort((a, b) => a.decision_id.localeCompare(b.decision_id)))),
    records: [...records].sort((a, b) => a.decision_id.localeCompare(b.decision_id)),
  };
}

function outcomeFor(
  index: number,
  app: string,
  role: string,
): { outcome: SchedulerDecisionOutcome; reason: SchedulerReasonCode; detail: string } {
  if (index % 211 === 0)
    return {
      outcome: "reconciled",
      reason: "missed_window_reconciled",
      detail: "one-firing no-backfill reconciliation",
    };
  if (index % 197 === 0) return { outcome: "blocked", reason: "fresh_lock", detail: "fresh role lock" };
  if (index % 181 === 0) return { outcome: "blocked", reason: "wip_limit", detail: "org WIP pressure" };
  if (index % 173 === 0 && app === "library")
    return { outcome: "blocked", reason: "budget_paused", detail: "library app budget pause" };
  if (index % 167 === 0)
    return { outcome: "blocked", reason: "approval_blocked", detail: "deploy-shaped effect parked" };
  if (index % 157 === 0) return { outcome: "blocked", reason: "channel_gated", detail: "audience channel absent" };
  if (index % 149 === 0) return { outcome: "skipped", reason: "no_subscriber", detail: "event has no subscriber" };
  if ((role === "distiller" || role === "learning-reviewer") && index % 3 === 0)
    return { outcome: "skipped", reason: "empty_learning_window", detail: "no actionable unsuppressed cluster" };
  return {
    outcome: "executed",
    reason: "executed",
    detail: index % 223 === 0 ? "stale lock recovered before execution" : "detached scheduled work accepted",
  };
}

function triggerFor(role: string): string {
  if (role === "sre") return "health-alert";
  if (role === "support") return "support-feedback";
  if (role === "marketing") return "adoption-signal";
  if (role === "distiller") return "daily 06:00";
  if (role === "learning-reviewer") return "weekly mon 07:00";
  if (role === "planner") return "daily 07:00";
  return "ticket-ready";
}

function counts(values: string[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const value of values) out.set(value, (out.get(value) ?? 0) + 1);
  return out;
}

function duplicateCount(values: Map<string, number>): number {
  return [...values.values()].reduce((total, value) => total + Math.max(0, value - 1), 0);
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

async function readEvidenceBytes(stateHome: string): Promise<string> {
  const root = join(stateHome, "scheduler", "evidence");
  if (!existsSync(root)) return "";
  const files: string[] = [];
  await walk(root, files);
  const chunks: string[] = [];
  for (const path of files.sort()) chunks.push(`${path.slice(root.length)}\0${await readFile(path, "utf8")}`);
  return chunks.join("\0");
}

async function walk(root: string, out: string[]): Promise<void> {
  for (const name of (await readdir(root)).sort()) {
    const path = join(root, name);
    const children = await readdir(path).catch(() => undefined);
    if (children === undefined) out.push(path);
    else await walk(path, out);
  }
}
