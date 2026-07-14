// Stateless dispatch tick: compute what is due, spawn detached turns, exit.

import { spawn as spawnChild } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { Trigger } from "../runtime/types.js";
import { GhCliOps } from "../loop/github.js";
import { loadApps, resolveTriggers, type AppEntry, type AppsFile } from "./apps.js";
import { enforceBudgetOverlay, isOverlayPaused } from "./budget.js";
import {
  EVENT_KINDS,
  EventStore,
  roleConsumedKey,
  type DueEvent,
  type EventKind,
  type GitHubEventSource,
} from "./events.js";
import { listJournals, readJournal, writeJournalPatch, type TurnEvent, type TurnJournal } from "./journal.js";
import { acquireLock, isStale, readLock, releaseLock, type TurnLock } from "./locks.js";
import { recoverStaleTurn } from "./recovery.js";
import { loadRoles, type RolesFile } from "./roles.js";
import { isDue, ScheduleStore } from "./schedule.js";
import { resolveTriggerRoute } from "./trigger-routing.js";
import { SchedulerEvidenceStore, type SchedulerInvocationRecord } from "./scheduler/evidence.js";
import {
  cadenceWindow,
  scheduledEpisodeId,
  schedulerDecisionId,
  schedulerIdentity,
  schedulerOrgId,
  type SchedulerReasonCode,
} from "./scheduler/model.js";

export interface DispatchTickOptions {
  orgRoot?: string;
  runtimeHome?: string;
  appsPath?: string;
  rolesPath?: string;
  now?: () => Date;
  eventSource?: GitHubEventSource;
  spawn?: DispatchSpawn;
  kill?: (pid: number, signal?: NodeJS.Signals) => Promise<void> | void;
  /** Liveness probe for a killed pid; defaults to a real `process.kill(pid,0)`
   *  check. Injectable so recovery gating is deterministic in tests. */
  pidAlive?: (pid: number) => boolean;
  /** How long to wait for a signalled turn to actually exit before escalating
   *  to SIGKILL, and the poll interval while waiting. */
  killGraceMs?: number;
  killPollMs?: number;
  wallClockCapMs?: number;
  dryRun?: boolean;
  schedulerFault?: (boundary: "after_scheduler_lock" | "after_tick_journal" | "after_child_spawn" | "after_terminal_receipt") => void | Promise<void>;
}

export type DispatchSpawn = (input: {
  role: string;
  app: string;
  turnId: string;
  runtimeHome: string;
}) => Promise<void>;

export interface DispatchTickResult {
  spawned: DueTurn[];
  skipped: string[];
  errors: string[];
  scheduler?: { invocationId: string; cadenceWindow: string };
}

export interface DueTurn {
  app: string;
  role: string;
  turnId: string;
  triggerKind: keyof Trigger;
  trigger: string;
  eventKey?: string;
  /** Full triggering event, persisted into the turn journal at spawn so the
   *  turn's briefs can quote the original payload with provenance (issue #26). */
  event?: TurnEvent;
  decisionId: string;
  cadenceWindow: string;
}

interface BlockedDecision {
  app: string;
  role: string;
  triggerKind: "schedule" | "event" | "mechanical";
  trigger: string;
  eventKey?: string;
  outcome: "blocked" | "skipped";
  reason: SchedulerReasonCode;
  detail: string;
}

/** An event whose every current subscriber holds a per-role consumption mark;
 *  the tick retires it (issue #25). */
interface RetirableEvent {
  app: string;
  kind: string;
  key: string;
}

export async function dispatchTick(options: DispatchTickOptions = {}): Promise<DispatchTickResult> {
  const now = options.now ?? (() => new Date());
  const orgRoot = resolve(options.orgRoot ?? process.cwd());
  const appsPath = resolve(options.appsPath ?? join(orgRoot, "apps.yaml"));
  const rolesPath = resolve(options.rolesPath ?? join(orgRoot, "roles.yaml"));
  const appsFile = await loadApps(appsPath);
  const rolesFile = await loadRoles(rolesPath);
  const runtimeHome = resolve(
    options.runtimeHome ?? process.env.OPERON_STATE_HOME ?? join(homedir(), ".operon", appsFile.org.name),
  );
  const spawn = options.spawn ?? ((input) => spawnDetached(input, orgRoot));
  const schedule = new ScheduleStore(runtimeHome);
  const eventStore = new EventStore(runtimeHome);
  const source = options.eventSource ?? new GhEventSource();
  const result: DispatchTickResult = { spawned: [], skipped: [], errors: [] };
  const tickAt = now();
  const schedulerId = schedulerIdentity(appsFile.org.name, orgRoot);
  const evidence = new SchedulerEvidenceStore({
    stateHome: runtimeHome,
    orgName: appsFile.org.name,
    orgHome: orgRoot,
    schedulerId,
  });
  const invocation = options.dryRun === true ? undefined : await evidence.beginInvocation(tickAt);
  if (invocation !== undefined) result.scheduler = { invocationId: invocation.invocation_id, cadenceWindow: invocation.cadence_window };
  if (invocation !== undefined && invocation.missed_windows > 0 && invocation.decision_ids.length === 0) {
    const missed = await evidence.claimDecision({
      invocationId: invocation.invocation_id,
      cadenceWindow: invocation.cadence_window,
      app: "__org__",
      role: "scheduler",
      triggerKind: "mechanical",
      trigger: "host-cadence",
      now: tickAt,
    });
    await evidence.finishDecision(missed.record.decision_id, "reconciled", "missed_window_reconciled", tickAt, {
      detail: `${invocation.missed_windows} missed host window(s) collapsed by one-firing policy`,
      providerTurns: 0,
      providerSettlements: 0,
    });
  }

  // Refresh the monthly budget auto-pause overlay every tick. Nothing else on
  // the automated (launchd) path writes it, so without this an app past 100%
  // of its monthly cap would be dispatched — and keep spending — indefinitely
  // (architecture.md §7). This is the sole writer of state/budget-overlay.json
  // under normal operation; computeDueTurns reads it below via isOverlayPaused.
  try {
    await enforceBudgetOverlay(runtimeHome, appsFile, tickAt);
  } catch (error) {
    result.errors.push(`budget overlay refresh failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  const killed = await killHungTurns(
    runtimeHome,
    tickAt,
    result,
    options.kill,
    spawn,
    options.wallClockCapMs,
    {
      pidAlive: options.pidAlive ?? defaultPidAlive,
      graceMs: options.killGraceMs ?? 5_000,
      pollMs: options.killPollMs ?? 250,
    },
  );
  const staleSpawns = await recoverableStaleLocks(
    runtimeHome,
    tickAt,
    result,
    spawn,
    killed.recovered,
  );
  const freshLocks = await freshLockCount(runtimeHome, tickAt);
  // Recovery re-spawns (from kill + stale-lock recovery) reuse a stale lock
  // whose heartbeat freshLockCount cannot yet see, so they must be counted
  // against org.maxConcurrentTurns explicitly — otherwise a tick that recovers
  // N turns would still spawn a full capacity of new turns on top of them,
  // exceeding the WIP limit that bounds concurrency and spend.
  const recoverySpawns = killed.spawns + staleSpawns;
  const capacity = Math.max(0, appsFile.org.maxConcurrentTurns - freshLocks - recoverySpawns);
  const { due, blocked, retirable } = await computeDueTurns({
    appsFile,
    rolesFile,
    runtimeHome,
    schedule,
    eventStore,
    source,
    now: tickAt,
    result,
    evidence,
    cadenceWindow: invocation?.cadence_window ?? cadenceWindow(tickAt),
    orgId: schedulerOrgId(appsFile.org.name, orgRoot),
  });

  if (capacity === 0) result.skipped.push("org WIP limit reached");
  if (invocation !== undefined) {
    for (const blocker of blocked) await recordBlockedDecision(evidence, invocation, blocker, tickAt);
  }

  // Retirement sweep: an event retires only when every CURRENT subscriber
  // holds a per-role consumption mark — evaluated fresh each tick against
  // roles.yaml, never snapshotted at spawn time, so a subscriber removed
  // mid-fan-out cannot strand an event live forever (issue #25). Dry-run
  // computes but never writes.
  if (options.dryRun !== true) {
    for (const event of retirable) {
      try {
        await eventStore.retireEvent(event.key);
        result.skipped.push(
          `${event.app}: event ${event.kind} (${event.key}) retired: all subscribers consumed`,
        );
      } catch (error) {
        result.errors.push(
          `${event.app}: retiring event ${event.key} failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  for (const [index, turn] of due.entries()) {
    if (options.dryRun === true) {
      if (index < capacity) result.spawned.push(turn);
      else result.skipped.push(`${turn.app}/${turn.role}: org WIP limit reached`);
      continue;
    }
    const claimed = await evidence.claimDecision({
      invocationId: invocation!.invocation_id,
      cadenceWindow: turn.cadenceWindow,
      app: turn.app,
      role: turn.role,
      triggerKind: turn.trigger === "blocked-retry" ? "recovery" : turn.triggerKind === "schedule" ? "schedule" : "event",
      trigger: turn.trigger,
      ...(turn.eventKey !== undefined ? { eventKey: turn.eventKey } : {}),
      now: tickAt,
    });
    const decisionId = claimed.record.decision_id;
    const executingTurn = claimed.record.episode_id === null ? turn : { ...turn, turnId: claimed.record.episode_id, decisionId };
    if (claimed.record.stage === "terminal" || claimed.record.stage === "spawned" || claimed.record.stage === "spawn_committed") {
      result.skipped.push(`${turn.app}/${turn.role}: scheduler decision already ${claimed.record.stage}`);
      continue;
    }
    if (index >= capacity) {
      await evidence.finishDecision(decisionId, "blocked", "wip_limit", tickAt, { detail: "org WIP limit reached" });
      result.skipped.push(`${turn.app}/${turn.role}: org WIP limit reached`);
      continue;
    }
    const lock = await acquireLock(runtimeHome, {
      app: turn.app,
      role: turn.role,
      turnId: executingTurn.turnId,
      now: tickAt,
    });
    if (!lock.acquired) {
      if (!isStale(lock.lock, tickAt)) {
        result.skipped.push(`${turn.app}/${turn.role}: fresh lock`);
        await evidence.finishDecision(decisionId, "blocked", "fresh_lock", tickAt, { detail: "existing role/app lock is fresh" });
      }
      continue;
    }
    await evidence.advanceDecision(decisionId, "lock_acquired", tickAt);
    await options.schedulerFault?.("after_scheduler_lock");

    await writeJournalPatch(runtimeHome, executingTurn.turnId, {
      role: turn.role,
      app: turn.app,
      phase: "assembling",
      attempt: 0,
      triggerKind: turn.triggerKind,
      trigger: turn.trigger,
      ...(turn.event !== undefined ? { event: turn.event } : {}),
      pid: lock.lock.pid,
    }, tickAt);
    await evidence.advanceDecision(decisionId, "journaled", tickAt);
    await options.schedulerFault?.("after_tick_journal");
    await evidence.advanceDecision(decisionId, "spawn_committed", tickAt);

    try {
      await spawn({
        role: turn.role,
        app: turn.app,
        turnId: executingTurn.turnId,
        runtimeHome,
      });
    } catch (error) {
      // Only a spawn failure releases the lock; the child never started.
      await releaseLock(runtimeHome, turn.app, turn.role);
      result.errors.push(error instanceof Error ? error.message : String(error));
      await evidence.finishDecision(decisionId, "failed", "spawn_failure", tickAt, {
        detail: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    await options.schedulerFault?.("after_child_spawn");
    await evidence.advanceDecision(decisionId, "spawned", tickAt);

    // The detached child is now running. A failure in post-spawn bookkeeping
    // (recordFired / markConsumed hitting a transient ENOSPC/EIO) must NOT
    // release the lock — doing so would leave the event unconsumed/schedule
    // un-recorded AND unlock the slot, so the next tick would dispatch a second
    // concurrent turn for the same (app, role) onto the shared managed clone.
    try {
      if (turn.triggerKind === "schedule") {
        await schedule.recordFired(turn.app, turn.role, turn.trigger, new Date(turn.cadenceWindow));
      }
      if (turn.eventKey !== undefined) {
        // Per-role consumption mark: this spawn consumes the event for THIS
        // role only, so co-subscribers pushed to a later tick by the WIP
        // limit still see it. The bare key (which poll filters on) is written
        // by the retirement sweep above once every current subscriber holds a
        // mark — never here (issue #25).
        await eventStore.markConsumed([roleConsumedKey(turn.eventKey, turn.role)]);
      }
    } catch (error) {
      result.errors.push(
        `${turn.app}/${turn.role}: post-spawn bookkeeping failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      await evidence.finishDecision(decisionId, "executed", "post_spawn_bookkeeping_failure", tickAt, {
        detail: error instanceof Error ? error.message : String(error),
      });
    }
    const current = (await evidence.listDecisions()).find((item) => item.decision_id === decisionId);
    if (current?.stage !== "terminal") await evidence.finishDecision(decisionId, "executed", "executed", tickAt);
    result.spawned.push(executingTurn);
  }
  if (invocation !== undefined) {
    const terminal = result.errors.length > 0 ? "failed" : "completed";
    const reason: SchedulerReasonCode = result.errors.length > 0
      ? "scheduler_state_failure"
      : due.length === 0 && blocked.length === 0 ? "no_due_work" : "executed";
    await evidence.finishInvocation(invocation.invocation_id, terminal, reason, tickAt);
    await options.schedulerFault?.("after_terminal_receipt");
  }
  return result;
}

async function computeDueTurns(input: {
  appsFile: AppsFile;
  rolesFile: RolesFile;
  runtimeHome: string;
  schedule: ScheduleStore;
  eventStore: EventStore;
  source: GitHubEventSource;
  now: Date;
  result: DispatchTickResult;
  evidence: SchedulerEvidenceStore;
  cadenceWindow: string;
  orgId: string;
}): Promise<{ due: DueTurn[]; blocked: BlockedDecision[]; retirable: RetirableEvent[] }> {
  const due: DueTurn[] = [];
  const blocked: BlockedDecision[] = [];
  const retirable: RetirableEvent[] = [];
  // One read per tick: per-role consumption marks filter out roles that have
  // already run for a still-live multi-subscriber event (issue #25).
  const consumed = new Set(await input.eventStore.readConsumed());
  for (const journal of await listJournals(input.runtimeHome)) {
    if (journal.phase === "blocked_on_gate") {
      due.push({ ...withDecision(input, {
        app: journal.app,
        role: journal.role,
        triggerKind: journal.triggerKind ?? "event",
        trigger: journal.trigger ?? "blocked-retry",
      }), turnId: journal.turnId });
    }
  }

  for (const app of input.appsFile.apps) {
    if (app.status !== "live") continue;
    if (await isOverlayPaused(input.runtimeHome, app.name)) {
      input.result.skipped.push(`${app.name}: budget overlay paused`);
      blocked.push({ app: app.name, role: "*", triggerKind: "mechanical", trigger: "budget-overlay", outcome: "blocked", reason: "budget_paused", detail: "app budget overlay paused" });
      continue;
    }

    const polled = await input.eventStore.poll(app, input.source);
    for (const error of polled.errors) {
      input.result.errors.push(`${error.app}/${error.kind}: ${error.code}: ${error.message}`);
    }

    const channels = app.channels ?? {};
    const subscribersByEvent = new Map<string, Set<string>>();
    for (const role of input.rolesFile.roles) {
      const triggers = resolveTriggers(role, app);
      for (const trigger of triggers) {
        if (trigger.manual === true) continue;
        if (trigger.event !== undefined) {
          const matches = polled.events.filter((event) => event.kind === trigger.event);
          for (const event of matches) {
            // Count the role as a subscriber even when it already consumed or
            // is gated below: a matching subscriber means the event is NOT
            // orphaned, and retirement needs the complete current subscriber
            // set (issue #25).
            const subscribers = subscribersByEvent.get(event.key) ?? new Set<string>();
            subscribers.add(role.name);
            subscribersByEvent.set(event.key, subscribers);
            if (consumed.has(roleConsumedKey(event.key, role.name))) continue;
            if (await input.evidence.hasSpawnedEvent(event.key, role.name)) continue;
            const route = resolveTriggerRoute({ role: role.name, trigger, channels });
            if (route.kind === "skip") {
              input.result.skipped.push(`${app.name}/${role.name}: ${route.reason}`);
              blocked.push({ app: app.name, role: role.name, triggerKind: "event", trigger: trigger.event, eventKey: event.key, outcome: "blocked", reason: "channel_gated", detail: route.reason });
              continue;
            }
            due.push(eventTurn(input, app, role.name, trigger.event, event));
          }
        }
        if (trigger.schedule !== undefined) {
          const stored = await input.schedule.lastFired(app.name, role.name, trigger.schedule);
          const evidenced = await input.evidence.lastSpawnedScheduleWindow(app.name, role.name, trigger.schedule);
          const last = [stored, evidenced].filter((value): value is Date => value !== undefined).sort((a, b) => b.getTime() - a.getTime())[0];
          if (!isDue(trigger.schedule, last, input.now)) continue;
          const route = resolveTriggerRoute({ role: role.name, trigger, channels });
          if (route.kind === "skip") {
              input.result.skipped.push(`${app.name}/${role.name}: ${route.reason}`);
              blocked.push({ app: app.name, role: role.name, triggerKind: "schedule", trigger: trigger.schedule, outcome: "blocked", reason: "channel_gated", detail: route.reason });
              continue;
            }
          due.push(scheduleTurn(input, app.name, role.name, trigger.schedule));
        }
      }
    }

    // An event kind that no role subscribes to is recorded, never lost: it
    // stays in the inbox (unconsumed) and surfaces on every tick so a missing
    // subscriber is observable rather than a silent drop. An event whose every
    // current subscriber already holds a per-role mark is ready to retire —
    // decided here, against TODAY'S roles.yaml, so subscriber-set drift after
    // a partial fan-out cannot strand the event live forever (issue #25).
    for (const event of polled.events) {
      const subscribers = subscribersByEvent.get(event.key);
      if (subscribers === undefined) {
        input.result.skipped.push(
          `${app.name}: event ${event.kind} (${event.key}) has no subscriber`,
        );
        blocked.push({ app: app.name, role: "*", triggerKind: "event", trigger: event.kind, eventKey: event.key, outcome: "skipped", reason: "no_subscriber", detail: "event has no current subscriber" });
      } else if (
        [...subscribers].every((name) => consumed.has(roleConsumedKey(event.key, name)))
      ) {
        retirable.push({ app: app.name, kind: event.kind, key: event.key });
      }
    }
  }

  return { due: due.sort(compareDue), blocked, retirable };
}

function eventTurn(input: { orgId: string; cadenceWindow: string }, app: AppEntry, role: string, trigger: string, event: DueEvent): DueTurn {
  return withDecision(input, {
    app: app.name,
    role,
    triggerKind: "event",
    trigger,
    eventKey: event.key,
    event: {
      kind: event.kind,
      key: event.key,
      // GitHub events keep their transport kind; file-drop inbox events carry
      // the parsed company-lifecycle kind, which is never in EVENT_KINDS.
      source: EVENT_KINDS.includes(event.kind as EventKind) ? "github-poll" : "file-drop-inbox",
      payload: journalEventPayload(event),
    },
  });
}

/** Journals are read by listJournals on every tick and rendered into every
 *  pass brief, and the company-event schema puts no upper bound on payload
 *  size — so an oversized payload is summarized instead of copied. The full
 *  content stays at the event source (the inbox file is never deleted;
 *  GitHub payloads are always small). */
const MAX_EVENT_PAYLOAD_BYTES = 16 * 1024;

function journalEventPayload(event: DueEvent): Record<string, unknown> {
  const raw = JSON.stringify(event.payload);
  const bytes = Buffer.byteLength(raw, "utf8");
  if (bytes <= MAX_EVENT_PAYLOAD_BYTES) return event.payload;
  return {
    truncated: true,
    original_bytes: bytes,
    note: `payload exceeded ${MAX_EVENT_PAYLOAD_BYTES} bytes; full content remains at the event source (${event.key})`,
    preview: raw.slice(0, 2048),
  };
}

function scheduleTurn(input: { orgId: string; cadenceWindow: string }, app: string, role: string, trigger: string): DueTurn {
  return withDecision(input, {
    app,
    role,
    triggerKind: "schedule",
    trigger,
  });
}

function withDecision(
  input: { orgId: string; cadenceWindow: string },
  turn: Omit<DueTurn, "turnId" | "decisionId" | "cadenceWindow">,
): DueTurn {
  const decisionId = schedulerDecisionId({
    orgId: input.orgId,
    cadenceWindow: input.cadenceWindow,
    app: turn.app,
    role: turn.role,
    triggerKind: turn.trigger === "blocked-retry" ? "recovery" : turn.triggerKind,
    trigger: turn.trigger,
    ...(turn.eventKey !== undefined ? { eventKey: turn.eventKey } : {}),
  });
  return { ...turn, decisionId, cadenceWindow: input.cadenceWindow, turnId: scheduledEpisodeId(decisionId) };
}

async function recordBlockedDecision(
  evidence: SchedulerEvidenceStore,
  invocation: SchedulerInvocationRecord,
  blocker: BlockedDecision,
  now: Date,
): Promise<void> {
  const claimed = await evidence.claimDecision({
    invocationId: invocation.invocation_id,
    cadenceWindow: invocation.cadence_window,
    app: blocker.app,
    role: blocker.role,
    triggerKind: blocker.triggerKind,
    trigger: blocker.trigger,
    ...(blocker.eventKey !== undefined ? { eventKey: blocker.eventKey } : {}),
    now,
  });
  if (claimed.record.stage !== "terminal") {
    await evidence.finishDecision(claimed.record.decision_id, blocker.outcome, blocker.reason, now, { detail: blocker.detail });
  }
}

function compareDue(a: DueTurn, b: DueTurn): number {
  const ap = a.trigger === "blocked-retry" ? 0 : a.triggerKind === "event" ? 1 : 2;
  const bp = b.trigger === "blocked-retry" ? 0 : b.triggerKind === "event" ? 1 : 2;
  return ap - bp || a.turnId.localeCompare(b.turnId);
}

async function recoverableStaleLocks(
  runtimeHome: string,
  now: Date,
  result: DispatchTickResult,
  spawn: DispatchSpawn,
  skipTurnIds: Set<string>,
): Promise<number> {
  let spawns = 0;
  for (const lock of await listLocks(runtimeHome)) {
    if (skipTurnIds.has(lock.turnId)) continue;
    if (!isStale(lock, now)) continue;
    try {
      const journal = await readJournal(runtimeHome, lock.turnId);
      const recovered = await recoverStaleTurn(runtimeHome, lock, journal, {
        now,
        spawn: async ({ journal: j }) => {
          await spawn({ role: j.role, app: j.app, turnId: j.turnId, runtimeHome });
        },
      });
      if (recovered.spawned === true) spawns += 1;
      result.skipped.push(`${lock.app}/${lock.role}: recovered ${recovered.decision.action}`);
    } catch (error) {
      result.errors.push(
        `${lock.app}/${lock.role}: recovery failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return spawns;
}

async function killHungTurns(
  runtimeHome: string,
  now: Date,
  result: DispatchTickResult,
  kill: DispatchTickOptions["kill"],
  spawn: DispatchSpawn,
  wallClockCapMs = 60 * 60 * 1000,
  death: { pidAlive: (pid: number) => boolean; graceMs: number; pollMs: number } = {
    pidAlive: defaultPidAlive,
    graceMs: 5_000,
    pollMs: 250,
  },
): Promise<{ recovered: Set<string>; spawns: number }> {
  const recovered = new Set<string>();
  let spawns = 0;
  for (const journal of await listJournals(runtimeHome)) {
    if (journal.phase !== "running" || journal.passStartedAt === undefined || journal.pid === undefined) {
      continue;
    }
    // Per-pass override wins when the running pass recorded one; otherwise the
    // org-wide default (60 min). Journals written before this field existed
    // simply fall through to the default — back-compatible.
    const capMs = journal.wallClockCapMs ?? wallClockCapMs;
    const age = now.getTime() - new Date(journal.passStartedAt).getTime();
    if (age <= capMs) continue;
    try {
      if (kill !== undefined) await kill(journal.pid);
      else process.kill(journal.pid, "SIGTERM");
      await writeJournalPatch(runtimeHome, journal.turnId, {
        role: journal.role,
        app: journal.app,
        message: "wall-clock cap exceeded; process killed for recovery",
      }, now);
      // Do NOT recover (git reset --hard + clean + respawn) until the killed
      // process is confirmed dead. SIGTERM only requests termination; if we
      // restart-clean and respawn while the old child (or its git/agent
      // subprocess) is still alive, two workers mutate one managed clone and
      // corrupt the tree. Escalate to SIGKILL, and if the pid still refuses to
      // die this tick, defer recovery to a later tick.
      const dead = await ensureProcessDead(journal.pid, { kill, ...death });
      if (!dead) {
        result.skipped.push(
          `${journal.app}/${journal.role}: killed hung turn ${journal.turnId}; pid ${journal.pid} still alive, deferring recovery`,
        );
        recovered.add(journal.turnId);
        continue;
      }
      const lock = await readLock(runtimeHome, journal.app, journal.role);
      const refreshed = await readJournal(runtimeHome, journal.turnId);
      const recovery = await recoverStaleTurn(runtimeHome, lock, refreshed, {
        now,
        spawn: async ({ journal: j }) => {
          await spawn({ role: j.role, app: j.app, turnId: j.turnId, runtimeHome });
        },
      });
      if (recovery.spawned === true) spawns += 1;
      result.skipped.push(
        `${journal.app}/${journal.role}: killed hung turn ${journal.turnId}; recovered ${recovery.decision.action}`,
      );
      recovered.add(journal.turnId);
    } catch (error) {
      result.errors.push(
        `${journal.app}/${journal.role}: kill failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return { recovered, spawns };
}

/** True while a pid is still running. `process.kill(pid, 0)` throws ESRCH once
 *  the process is gone; EPERM means it exists but we may not signal it. */
function defaultPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Confirm a signalled pid has exited before its worktree is reused: wait out
 *  the grace window, escalate to SIGKILL, then wait again. Returns false if the
 *  pid is still alive at the end, so the caller can defer recovery. */
async function ensureProcessDead(
  pid: number,
  opts: { kill: DispatchTickOptions["kill"]; pidAlive: (pid: number) => boolean; graceMs: number; pollMs: number },
): Promise<boolean> {
  if (!opts.pidAlive(pid)) return true;
  const pollMs = Math.max(0, opts.pollMs);
  const attempts = Math.max(1, Math.ceil(opts.graceMs / Math.max(1, pollMs)));
  for (let i = 0; i < attempts; i++) {
    if (!opts.pidAlive(pid)) return true;
    await delay(pollMs);
  }
  try {
    if (opts.kill !== undefined) await opts.kill(pid, "SIGKILL");
    else process.kill(pid, "SIGKILL");
  } catch {
    // Already gone between the last probe and the escalation.
  }
  for (let i = 0; i < attempts; i++) {
    if (!opts.pidAlive(pid)) return true;
    await delay(pollMs);
  }
  return !opts.pidAlive(pid);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function freshLockCount(runtimeHome: string, now: Date): Promise<number> {
  const locks = await listLocks(runtimeHome);
  return locks.filter((lock) => !isStale(lock, now)).length;
}

async function listLocks(runtimeHome: string): Promise<TurnLock[]> {
  const dir = join(runtimeHome, "locks");
  if (!existsSync(dir)) return [];
  const locks: TurnLock[] = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".lock")) continue;
    const [app, roleWithExt] = file.split("--");
    if (app === undefined || roleWithExt === undefined) continue;
    try {
      locks.push(await readLock(runtimeHome, app, roleWithExt.slice(0, -".lock".length)));
    } catch (error) {
      // A single torn lock (crash mid-heartbeat) must not throw the whole
      // tick; skip it and let the owning turn's next heartbeat repair it.
      console.warn(`locks: skipping unreadable ${file}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return locks;
}

class GhEventSource implements GitHubEventSource {
  async ticketReady(app: AppEntry): Promise<{ issueNumber: number }[]> {
    return (await new GhCliOps(app.repo).listIssues({ labels: ["op:ready"], state: "open" })).map(
      (issue) => ({ issueNumber: issue.number }),
    );
  }

  async prOpened(): Promise<{ prNumber: number; headSha: string }[]> {
    return [];
  }

  async ciFailed(): Promise<{ sha: string; check: string }[]> {
    return [];
  }

  async releaseShipped(): Promise<{ tag: string }[]> {
    return [];
  }
}

async function spawnDetached(input: {
  role: string;
  app: string;
  turnId: string;
  runtimeHome: string;
}, orgRoot: string): Promise<void> {
  const args = [
    "run-role",
    input.role,
    "--app",
    input.app,
    "--turn",
    input.turnId,
    "--org-home",
    orgRoot,
    "--state-home",
    input.runtimeHome,
  ];
  const command =
    process.argv[1]?.endsWith(".ts") === true
      ? {
          bin: process.execPath,
          args: ["--import", createRequire(import.meta.url).resolve("tsx"), process.argv[1], ...args],
        }
      : { bin: process.execPath, args: [process.argv[1] ?? "dist/cli.js", ...args] };
  const child = spawnChild(command.bin, command.args, {
    cwd: orgRoot,
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}
