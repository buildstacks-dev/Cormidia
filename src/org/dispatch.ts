// Stateless dispatch tick: compute what is due, spawn detached turns, exit.

import { spawn as spawnChild } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { Trigger } from "../runtime/types.js";
import { GhCliOps } from "../loop/github.js";
import { loadApps, resolveTriggers, type AppEntry, type AppsFile } from "./apps.js";
import { isOverlayPaused } from "./budget.js";
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
  kill?: (pid: number) => Promise<void> | void;
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
    options.runtimeHome ?? process.env.OPERON_HOME ?? join(homedir(), ".operon", appsFile.org.name),
  );
  const schedule = new ScheduleStore(runtimeHome);
  const eventStore = new EventStore(runtimeHome);
  const source = options.eventSource ?? new GhEventSource();
  const result: DispatchTickResult = { spawned: [], skipped: [], errors: [] };

  const recoveredFromKill = await killHungTurns(
    runtimeHome,
    now(),
    result,
    options.kill,
    options.spawn ?? spawnDetached,
    options.wallClockCapMs,
  );
  await recoverableStaleLocks(
    runtimeHome,
    now(),
    result,
    options.spawn ?? spawnDetached,
    recoveredFromKill,
  );
  const freshLocks = await freshLockCount(runtimeHome, now());
  const capacity = Math.max(0, appsFile.org.maxConcurrentTurns - freshLocks);
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
      await (options.spawn ?? spawnDetached)({
        role: turn.role,
        app: turn.app,
        turnId: turn.turnId,
        runtimeHome,
      });
      if (turn.triggerKind === "schedule") {
        await schedule.recordFired(turn.app, turn.role, turn.trigger, now());
      }
      if (turn.eventKey !== undefined) {
        await eventStore.markConsumed([turn.eventKey]);
      }
      result.spawned.push(turn);
    } catch (error) {
      await releaseLock(runtimeHome, turn.app, turn.role);
      result.errors.push(error instanceof Error ? error.message : String(error));
    }
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

    for (const role of input.rolesFile.roles) {
      const triggers = resolveTriggers(role, app);
      for (const trigger of triggers) {
        if (trigger.manual === true) continue;
        if (trigger.event !== undefined) {
          const matches = polled.events.filter((event) => event.kind === trigger.event);
          for (const event of matches) {
            const route = resolveTriggerRoute({ role: role.name, trigger });
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
          const route = resolveTriggerRoute({ role: role.name, trigger });
          if (route.kind === "skip") {
            input.result.skipped.push(`${app.name}/${role.name}: ${route.reason}`);
            continue;
          }
          due.push(scheduleTurn(app.name, role.name, trigger.schedule, input.now));
        }
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
): Promise<void> {
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
      result.skipped.push(`${lock.app}/${lock.role}: recovered ${recovered.decision.action}`);
    } catch (error) {
      result.errors.push(
        `${lock.app}/${lock.role}: recovery failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

async function killHungTurns(
  runtimeHome: string,
  now: Date,
  result: DispatchTickResult,
  kill: DispatchTickOptions["kill"],
  spawn: DispatchSpawn,
  wallClockCapMs = 60 * 60 * 1000,
): Promise<Set<string>> {
  const recovered = new Set<string>();
  for (const journal of await listJournals(runtimeHome)) {
    if (journal.phase !== "running" || journal.passStartedAt === undefined || journal.pid === undefined) {
      continue;
    }
    const age = now.getTime() - new Date(journal.passStartedAt).getTime();
    if (age <= wallClockCapMs) continue;
    try {
      if (kill !== undefined) await kill(journal.pid);
      else process.kill(journal.pid, "SIGTERM");
      await writeJournalPatch(runtimeHome, journal.turnId, {
        role: journal.role,
        app: journal.app,
        message: "wall-clock cap exceeded; process killed for recovery",
      }, now);
      const lock = await readLock(runtimeHome, journal.app, journal.role);
      const refreshed = await readJournal(runtimeHome, journal.turnId);
      const recovery = await recoverStaleTurn(runtimeHome, lock, refreshed, {
        now,
        spawn: async ({ journal: j }) => {
          await spawn({ role: j.role, app: j.app, turnId: j.turnId, runtimeHome });
        },
      });
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
  return recovered;
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
    locks.push(await readLock(runtimeHome, app, roleWithExt.slice(0, -".lock".length)));
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
}): Promise<void> {
  const args = ["run-role", input.role, "--app", input.app, "--turn", input.turnId, "--home", input.runtimeHome];
  const command =
    process.argv[1]?.endsWith(".ts") === true
      ? { bin: "pnpm", args: ["dev", ...args] }
      : { bin: process.execPath, args: [process.argv[1] ?? "dist/cli.js", ...args] };
  const child = spawnChild(command.bin, command.args, {
    cwd: process.cwd(),
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

function mintTurnId(kind: string, app: string, role: string, now: Date = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return `${stamp}-${kind}-${app}-${role}`.replace(/[^A-Za-z0-9._-]+/g, "-");
}
