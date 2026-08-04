// CF-OPS-CONT — owner-ratified contention shape over the real dispatcher,
// lock/journal stores, run envelopes, settlement ledger, and scheduler evidence.

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { dispatchTick, type DueTurn } from "../../src/org/dispatch.js";
import type { GitHubEventSource } from "../../src/org/events.js";
import { writeJournalPatch } from "../../src/org/journal.js";
import { readLock, releaseLock } from "../../src/org/locks.js";
import { SchedulerEvidenceStore } from "../../src/org/scheduler/evidence.js";
import { schedulerIdentity } from "../../src/org/scheduler/model.js";
import { finalizeRun, startRun } from "../../src/runtime/runlog/envelope.js";
import { recordTurnOnce, toRecord } from "../../src/runtime/telemetry.js";
import type { RoleConfig, TurnResult } from "../../src/runtime/types.js";
import { makeTempOrgHome } from "../fixtures/org-home.js";

export interface ContentionRigResult {
  due_candidates: number;
  apps: number;
  wip_limit: number;
  first_admitted: string[];
  max_live_observed: number;
  duplicate_pair_admissions: number;
  priority_preserved: boolean;
  typed_non_admissions: number;
  reconsidered_after_capacity: number;
  provider_turns: number | null;
  provider_settlements: number | null;
  duplicate_decisions: number;
  duplicate_episodes: number;
  orphaned_locks: number;
  orphaned_journals: number;
  orphaned_runs: number;
  orphaned_settlements: number;
  settlement_idempotence_refusals: number;
  terminal_integrity: boolean;
}

export function evaluateContentionRig(result: ContentionRigResult): string[] {
  return [
    ...(result.due_candidates < 10 ? ["CF-OPS-CONT:insufficient_due_candidates"] : []),
    ...(result.apps < 3 ? ["CF-OPS-CONT:insufficient_apps"] : []),
    ...(result.max_live_observed > result.wip_limit ? ["CF-OPS-CONT:wip_exceeded"] : []),
    ...(result.duplicate_pair_admissions > 0 ? ["CF-OPS-CONT:duplicate_pair_admission"] : []),
    ...(!result.priority_preserved ? ["CF-OPS-CONT:priority_drift"] : []),
    ...(result.typed_non_admissions !== result.due_candidates - result.first_admitted.length ? ["CF-OPS-CONT:untyped_non_admission"] : []),
    ...(result.reconsidered_after_capacity < 1 ? ["CF-OPS-CONT:eligible_work_not_reconsidered"] : []),
    ...(result.provider_turns === null || result.provider_turns !== result.provider_settlements ? ["CF-OPS-CONT:settlement_disagreement"] : []),
    ...(result.duplicate_decisions > 0 || result.duplicate_episodes > 0 ? ["CF-OPS-CONT:duplicate_evidence"] : []),
    ...(result.orphaned_locks + result.orphaned_journals + result.orphaned_runs + result.orphaned_settlements > 0 ? ["CF-OPS-CONT:orphaned_state"] : []),
    ...(result.settlement_idempotence_refusals < 2 ? ["CF-OPS-CONT:settlement_idempotence_unproven"] : []),
    ...(!result.terminal_integrity ? ["CF-OPS-CONT:terminal_integrity_failed"] : []),
  ];
}

const APPS = ["contend-a", "contend-b", "contend-c"] as const;
const ROLES = ["builder", "planner", "sre", "support"] as const;
const AT = new Date("2026-07-31T18:00:00.000Z");
const SOURCE: GitHubEventSource = {
  ticketReady: async (app) => [{ issueNumber: APPS.indexOf(app.name as typeof APPS[number]) + 101 }],
  prOpened: async () => [], ciFailed: async () => [], releaseShipped: async () => [],
};

export async function runContentionRig(): Promise<ContentionRigResult> {
  const home = await makeTempOrgHome({ name: "contention-rig" });
  try {
    await writeFile(join(home.orgHome, "apps.yaml"), appsYaml(), "utf8");
    await writeFile(join(home.orgHome, "roles.yaml"), rolesYaml(), "utf8");
    const common = { orgRoot: home.orgHome, runtimeHome: home.stateHome, eventSource: SOURCE };
    const preview = await dispatchTick({ ...common, now: () => AT, dryRun: true, spawn: async () => undefined });
    const first = await dispatchTick({ ...common, now: () => AT, spawn: async () => undefined });
    const schedulerId = schedulerIdentity("contention-rig", home.orgHome);
    const store = new SchedulerEvidenceStore({ stateHome: home.stateHome, orgName: "contention-rig", orgHome: home.orgHome, schedulerId });
    const firstDecisions = await store.listDecisions();
    const firstPairs = first.spawned.map((turn) => `${turn.app}\0${turn.role}`);
    const duplicateAdmissions = firstPairs.length - new Set(firstPairs).size;
    const refused = await settleTogether(home.stateHome, first.spawned, store, new Date(AT.getTime() + 1_000));

    const laterAt = new Date(AT.getTime() + 5 * 60_000);
    const second = await dispatchTick({ ...common, now: () => laterAt, spawn: async () => undefined });
    const blockedPairs = new Set(firstDecisions.filter((row) => row.reason_code === "wip_limit").map((row) => `${row.app}\0${row.role}\0${row.trigger}`));
    const reconsidered = second.spawned.filter((turn) => blockedPairs.has(`${turn.app}\0${turn.role}\0${turn.trigger}`)).length;
    const refusedSecond = await settleTogether(home.stateHome, second.spawned, store, new Date(laterAt.getTime() + 1_000));
    const summary = await store.summarize(new Date(laterAt.getTime() + 2_000));
    const all = await store.listDecisions();
    const terminal = all.every((row) => row.stage === "terminal" && row.outcome !== null && row.reason_code !== null);
    return {
      due_candidates: firstDecisions.length,
      apps: APPS.length,
      wip_limit: 2,
      first_admitted: first.spawned.map((turn) => `${turn.app}/${turn.role}/${turn.triggerKind}:${turn.trigger}`),
      max_live_observed: Math.max(first.spawned.length, second.spawned.length),
      duplicate_pair_admissions: duplicateAdmissions,
      priority_preserved: JSON.stringify(first.spawned.map(identity)) === JSON.stringify(preview.spawned.map(identity)),
      typed_non_admissions: firstDecisions.filter((row) => !first.spawned.some((turn) => turn.decisionId === row.decision_id) && row.outcome !== null && row.reason_code !== null).length,
      reconsidered_after_capacity: reconsidered,
      provider_turns: summary.provider_turns,
      provider_settlements: summary.provider_settlements,
      duplicate_decisions: summary.duplicate_decisions,
      duplicate_episodes: summary.duplicate_episodes,
      orphaned_locks: summary.orphaned_locks,
      orphaned_journals: summary.orphaned_journals,
      orphaned_runs: summary.orphaned_runs,
      orphaned_settlements: summary.orphaned_settlements,
      settlement_idempotence_refusals: refused + refusedSecond,
      terminal_integrity: terminal && summary.provider_settlement_agreement === true,
    };
  } finally {
    await home.cleanup();
  }
}

async function settleTogether(
  stateHome: string,
  turns: DueTurn[],
  store: SchedulerEvidenceStore,
  at: Date,
): Promise<number> {
  const results = await Promise.all(turns.map(async (turn, index) => {
    const runId = `contention-${at.getTime()}-${index}`;
    const providerTurnId = `provider-${turn.turnId}`;
    const role = roleConfig(turn.role);
    const result = turnResult(turn.role);
    await startRun(stateHome, {
      runId, traceId: turn.turnId, app: turn.app, pipeline: "contention", pass: "settle", role: turn.role,
      runtime: "claude", model: role.model, providerTurnIds: [providerTurnId],
    }, new Date(at.getTime() - 500));
    await finalizeRun(stateHome, turn.app, runId, { status: "completed", verdictSummary: "contention fixture settled" }, at);
    await writeJournalPatch(stateHome, turn.turnId, { app: turn.app, role: turn.role, phase: "running" }, new Date(at.getTime() - 400));
    await writeJournalPatch(stateHome, turn.turnId, { app: turn.app, role: turn.role, phase: "collecting" }, new Date(at.getTime() - 200));
    await writeJournalPatch(stateHome, turn.turnId, { app: turn.app, role: turn.role, phase: "done" }, at);
    const record = toRecord(role, result, at, {
      app: turn.app, trigger: turn.triggerKind, runId, providerTurnId, traceId: turn.turnId, pipeline: "contention", pass: "settle",
    });
    const first = await recordTurnOnce(stateHome, record);
    const duplicate = await recordTurnOnce(stateHome, record);
    await store.recordTurnReceipt(turn.turnId, at, result.summary);
    const lock = await readLock(stateHome, turn.app, turn.role);
    await releaseLock(stateHome, turn.app, turn.role, lock);
    return first && !duplicate ? 1 : 0;
  }));
  return results.reduce<number>((sum, item) => sum + item, 0);
}

function identity(turn: DueTurn): string { return `${turn.app}/${turn.role}/${turn.triggerKind}:${turn.trigger}`; }
function roleConfig(name: string): RoleConfig { return { name, runtime: "claude", model: "claude-scripted-model", effort: "medium", delegation: { allow: [] }, triggers: [], outputs: [], maxTurnBudgetUsd: 1 }; }
function turnResult(role: string): TurnResult { return { status: "completed", summary: `${role} settled`, artifacts: [], session: { runtime: "claude", id: `session-${role}` }, usage: { tokensIn: 10, tokensOut: 2, costUsd: 0.01, subagentTurns: 0, wallClockMs: 100, quality: "complete" }, escalations: [] }; }

function appsYaml(): string {
  return [
    "schema_version: 1", "org:", "  name: contention-rig", "  max_concurrent_turns: 2",
    "defaults:", "  budget_usd_month: 1000", "apps:",
    ...APPS.flatMap((app) => [`  ${app}:`, `    repo: fixture/${app}`, "    status: live", "    budget_usd_month: 1000", "    cadence: {}", "    channels:", "      support: [fixture]"]), "",
  ].join("\n");
}
function rolesYaml(): string {
  return [
    "defaults:", "  max_turn_budget_usd: 1", "roles:",
    ...ROLES.flatMap((role) => [
      `  ${role}:`, "    runtime: claude", "    model: claude-scripted-model", "    effort: medium", "    delegation: {allow: []}", "    triggers:",
      ...(role === "builder" ? ["      - event: ticket-ready"] : []),
      "      - schedule: \"* * * * *\"", "    outputs: [notes]",
    ]), "",
  ].join("\n");
}
