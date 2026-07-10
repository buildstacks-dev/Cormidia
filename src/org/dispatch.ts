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
import { EventStore, type DueEvent, type GitHubEventSource } from "./events.js";
import { listJournals, readJournal, writeJournalPatch, type TurnJournal } from "./journal.js";
import { acquireLock, isStale, readLock, releaseLock, type TurnLock } from "./locks.js";
import { recoverStaleTurn } from "./recovery.js";
import { loadRoles, type RolesFile } from "./roles.js";
import { isDue, ScheduleStore } from "./schedule.js";
import { resolveTriggerRoute } from "./trigger-routing.js";

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
}

export interface DueTurn {
  app: string;
  role: string;
  turnId: string;
  triggerKind: keyof Trigger;
  trigger: string;
  eventKey?: string;
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

  // Refresh the monthly budget auto-pause overlay every tick. Nothing else on
  // the automated (launchd) path writes it, so without this an app past 100%
  // of its monthly cap would be dispatched — and keep spending — indefinitely
  // (architecture.md §7). This is the sole writer of state/budget-overlay.json
  // under normal operation; computeDueTurns reads it below via isOverlayPaused.
  try {
    await enforceBudgetOverlay(runtimeHome, appsFile, now());
  } catch (error) {
    result.errors.push(`budget overlay refresh failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  const killed = await killHungTurns(
    runtimeHome,
    now(),
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
    now(),
    result,
    spawn,
    killed.recovered,
  );
  const freshLocks = await freshLockCount(runtimeHome, now());
  // Recovery re-spawns (from kill + stale-lock recovery) reuse a stale lock
  // whose heartbeat freshLockCount cannot yet see, so they must be counted
  // against org.maxConcurrentTurns explicitly — otherwise a tick that recovers
  // N turns would still spawn a full capacity of new turns on top of them,
  // exceeding the WIP limit that bounds concurrency and spend.
  const recoverySpawns = killed.spawns + staleSpawns;
  const capacity = Math.max(0, appsFile.org.maxConcurrentTurns - freshLocks - recoverySpawns);
  if (capacity === 0) {
    result.skipped.push("org WIP limit reached");
    return result;
  }

  const due = await computeDueTurns({
    appsFile,
    rolesFile,
    runtimeHome,
    schedule,
    eventStore,
    source,
    now: now(),
    result,
  });

  for (const turn of due.slice(0, capacity)) {
    if (options.dryRun === true) {
      result.spawned.push(turn);
      continue;
    }
    const lock = await acquireLock(runtimeHome, {
      app: turn.app,
      role: turn.role,
      turnId: turn.turnId,
      now: now(),
    });
    if (!lock.acquired) {
      if (!isStale(lock.lock, now())) result.skipped.push(`${turn.app}/${turn.role}: fresh lock`);
      continue;
    }

    await writeJournalPatch(runtimeHome, turn.turnId, {
      role: turn.role,
      app: turn.app,
      phase: "assembling",
      attempt: 0,
      triggerKind: turn.triggerKind,
      trigger: turn.trigger,
      pid: lock.lock.pid,
    }, now());

    try {
      await spawn({
        role: turn.role,
        app: turn.app,
        turnId: turn.turnId,
        runtimeHome,
      });
    } catch (error) {
      // Only a spawn failure releases the lock; the child never started.
      await releaseLock(runtimeHome, turn.app, turn.role);
      result.errors.push(error instanceof Error ? error.message : String(error));
      continue;
    }

    // The detached child is now running. A failure in post-spawn bookkeeping
    // (recordFired / markConsumed hitting a transient ENOSPC/EIO) must NOT
    // release the lock — doing so would leave the event unconsumed/schedule
    // un-recorded AND unlock the slot, so the next tick would dispatch a second
    // concurrent turn for the same (app, role) onto the shared managed clone.
    try {
      if (turn.triggerKind === "schedule") {
        await schedule.recordFired(turn.app, turn.role, turn.trigger, now());
      }
      if (turn.eventKey !== undefined) {
        await eventStore.markConsumed([turn.eventKey]);
      }
    } catch (error) {
      result.errors.push(
        `${turn.app}/${turn.role}: post-spawn bookkeeping failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    result.spawned.push(turn);
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
}): Promise<DueTurn[]> {
  const due: DueTurn[] = [];
  for (const journal of await listJournals(input.runtimeHome)) {
    if (journal.phase === "blocked_on_gate") {
      due.push({
        app: journal.app,
        role: journal.role,
        turnId: journal.turnId,
        triggerKind: journal.triggerKind ?? "event",
        trigger: journal.trigger ?? "blocked-retry",
      });
    }
  }

  for (const app of input.appsFile.apps) {
    if (app.status !== "live") continue;
    if (await isOverlayPaused(input.runtimeHome, app.name)) {
      input.result.skipped.push(`${app.name}: budget overlay paused`);
      continue;
    }

    const polled = await input.eventStore.poll(app, input.source);
    for (const error of polled.errors) {
      input.result.errors.push(`${error.app}/${error.kind}: ${error.code}: ${error.message}`);
    }

    const channels = app.channels ?? {};
    const subscribedEventKeys = new Set<string>();
    for (const role of input.rolesFile.roles) {
      const triggers = resolveTriggers(role, app);
      for (const trigger of triggers) {
        if (trigger.manual === true) continue;
        if (trigger.event !== undefined) {
          const matches = polled.events.filter((event) => event.kind === trigger.event);
          for (const event of matches) {
            // A matching subscriber exists even if it is then gated/unrouted:
            // this event is NOT orphaned, so don't record it as unsubscribed.
            subscribedEventKeys.add(event.key);
            const route = resolveTriggerRoute({ role: role.name, trigger, channels });
            if (route.kind === "skip") {
              input.result.skipped.push(`${app.name}/${role.name}: ${route.reason}`);
              continue;
            }
            due.push(eventTurn(app, role.name, trigger.event, event));
          }
        }
        if (trigger.schedule !== undefined) {
          const last = await input.schedule.lastFired(app.name, role.name, trigger.schedule);
          if (!isDue(trigger.schedule, last, input.now)) continue;
          const route = resolveTriggerRoute({ role: role.name, trigger, channels });
          if (route.kind === "skip") {
            input.result.skipped.push(`${app.name}/${role.name}: ${route.reason}`);
            continue;
          }
          due.push(scheduleTurn(app.name, role.name, trigger.schedule, input.now));
        }
      }
    }

    // An event kind that no role subscribes to is recorded, never lost: it
    // stays in the inbox (unconsumed) and surfaces on every tick so a missing
    // subscriber is observable rather than a silent drop.
    for (const event of polled.events) {
      if (!subscribedEventKeys.has(event.key)) {
        input.result.skipped.push(
          `${app.name}: event ${event.kind} (${event.key}) has no subscriber`,
        );
      }
    }
  }

  return due.sort(compareDue);
}

function eventTurn(app: AppEntry, role: string, trigger: string, event: DueEvent): DueTurn {
  return {
    app: app.name,
    role,
    turnId: mintTurnId("event", app.name, role),
    triggerKind: "event",
    trigger,
    eventKey: event.key,
  };
}

function scheduleTurn(app: string, role: string, trigger: string, now: Date): DueTurn {
  return {
    app,
    role,
    turnId: mintTurnId("schedule", app, role, now),
    triggerKind: "schedule",
    trigger,
  };
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

function mintTurnId(kind: string, app: string, role: string, now: Date = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return `${stamp}-${kind}-${app}-${role}`.replace(/[^A-Za-z0-9._-]+/g, "-");
}
