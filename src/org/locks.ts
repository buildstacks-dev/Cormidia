// Filesystem lock for one turn per (role, app), with heartbeat staleness.

import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, open, readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { writeFileAtomic } from "./atomic.js";
import { currentProcessStartIdentity, processIdentityStatus, processStartIdentity } from "../runtime/process-identity.js";

export interface TurnLock {
  app: string;
  role: string;
  pid: number;
  /** Present on every new lock; optional only for legacy on-disk records. */
  processStartIdentity?: string;
  nonce?: string;
  turnId: string;
  startedAt: string;
  heartbeatAt: string;
}

export interface AcquireLockResult {
  acquired: boolean;
  lock: TurnLock;
}

export const DEFAULT_STALE_MS = 2 * 60 * 1000;

/** Contention (two roles on one app due in the same tick) is ordinary, not an
 *  error. Bounds the retry so that even a lock released-then-reacquired under us
 *  in a tight loop terminates in a holder-unknown result rather than spinning. */
const ACQUIRE_CONTENTION_RETRIES = 8;

export async function acquireLock(
  root: string,
  input: { app: string; role: string; turnId: string; now?: Date; pid?: number },
): Promise<AcquireLockResult> {
  const now = input.now ?? new Date();
  const ownerPid = input.pid ?? process.pid;
  const ownerStart = ownerPid === process.pid
    ? currentProcessStartIdentity()
    : processStartIdentity(ownerPid);
  const lock: TurnLock = {
    app: input.app,
    role: input.role,
    pid: ownerPid,
    ...(ownerStart !== undefined ? { processStartIdentity: ownerStart } : {}),
    nonce: randomUUID(),
    turnId: input.turnId,
    startedAt: now.toISOString(),
    heartbeatAt: now.toISOString(),
  };
  const path = lockPath(root, input.app, input.role);
  await mkdir(dirname(path), { recursive: true });
  for (let attempt = 0; ; attempt += 1) {
    try {
      const fh = await open(path, "wx");
      try {
        await fh.writeFile(`${JSON.stringify(lock, null, 2)}\n`, "utf8");
      } finally {
        await fh.close();
      }
      return { acquired: true, lock };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      // Someone holds it — ordinary contention. Read the holder to report it. If
      // the lock vanished between our EEXIST and the read (a concurrent
      // release), it is now free: retry the exclusive create rather than let an
      // unhandled ENOENT abort the whole dispatch tick (F-007). O_EXCL keeps the
      // reacquire atomic — only one waiter can win the create.
      const holder = await readLockOrUndefined(root, input.app, input.role);
      if (holder !== undefined) return { acquired: false, lock: holder };
      if (attempt < ACQUIRE_CONTENTION_RETRIES) continue;
      // Persistent release/reacquire churn: never throw on contention. Report a
      // holder-unknown result that reads as stale so callers route it through
      // stale-lock recovery instead of skipping it as a fresh lock.
      return { acquired: false, lock: unknownStaleHolder(input.app, input.role) };
    }
  }
}

export async function readLock(root: string, app: string, role: string): Promise<TurnLock> {
  return JSON.parse(await readFile(lockPath(root, app, role), "utf8")) as TurnLock;
}

/** Read the current holder, or undefined when the lock is gone or its payload is
 *  not yet readable — a vanished/torn file during a concurrent release or a
 *  mid-write acquire. Never throws on those ordinary races, so a check-then-act
 *  caller cannot turn contention into an unhandled ENOENT (F-007). */
export async function readLockOrUndefined(
  root: string,
  app: string,
  role: string,
): Promise<TurnLock | undefined> {
  try {
    return await readLock(root, app, role);
  } catch {
    return undefined;
  }
}

/** A synthetic holder that reads as stale (epoch heartbeat), returned only when
 *  the real holder could not be read after repeated contention. Callers gate on
 *  isStale, so this routes through stale-lock recovery rather than a fresh skip. */
function unknownStaleHolder(app: string, role: string): TurnLock {
  const epoch = new Date(0).toISOString();
  return { app, role, pid: -1, turnId: "", startedAt: epoch, heartbeatAt: epoch };
}

export async function heartbeatLock(
  root: string,
  app: string,
  role: string,
  now: Date = new Date(),
): Promise<TurnLock> {
  const lock = await readLock(root, app, role);
  const next = { ...lock, heartbeatAt: now.toISOString() };
  await writeFileAtomic(lockPath(root, app, role), `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

/** A detached run-role child adopts the scheduler's pre-spawn lock for the
 * same deterministic turn. The turn id is the handoff token; all OS liveness
 * fields are replaced together before the child starts provider work. */
export async function adoptLock(
  root: string,
  app: string,
  role: string,
  turnId: string,
  now: Date = new Date(),
): Promise<TurnLock> {
  const existing = await readLock(root, app, role);
  if (existing.turnId !== turnId) {
    throw new Error(`turn lock busy for ${app}/${role}: ${existing.turnId}`);
  }
  const adopted: TurnLock = {
    ...existing,
    pid: process.pid,
    processStartIdentity: currentProcessStartIdentity(),
    nonce: randomUUID(),
    startedAt: now.toISOString(),
    heartbeatAt: now.toISOString(),
  };
  await writeFileAtomic(lockPath(root, app, role), `${JSON.stringify(adopted, null, 2)}\n`);
  return adopted;
}

export async function releaseLock(root: string, app: string, role: string): Promise<void> {
  await rm(lockPath(root, app, role), { force: true });
}

export function isStale(lock: TurnLock, now: Date = new Date(), staleMs = DEFAULT_STALE_MS): boolean {
  if (lock.processStartIdentity !== undefined) {
    const identity = processIdentityStatus(lock.pid, lock.processStartIdentity);
    if (identity === "mismatch") return true;
  }
  return now.getTime() - new Date(lock.heartbeatAt).getTime() > staleMs;
}

export function lockExists(root: string, app: string, role: string): boolean {
  return existsSync(lockPath(root, app, role));
}

export function lockPath(root: string, app: string, role: string): string {
  return join(root, "locks", `${app}--${role}.lock`);
}
