// Filesystem lock for one turn per (role, app), with heartbeat staleness.

import { existsSync } from "node:fs";
import { mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface TurnLock {
  app: string;
  role: string;
  pid: number;
  turnId: string;
  startedAt: string;
  heartbeatAt: string;
}

export interface AcquireLockResult {
  acquired: boolean;
  lock: TurnLock;
}

export const DEFAULT_STALE_MS = 2 * 60 * 1000;

export async function acquireLock(
  root: string,
  input: { app: string; role: string; turnId: string; now?: Date; pid?: number },
): Promise<AcquireLockResult> {
  const now = input.now ?? new Date();
  const lock: TurnLock = {
    app: input.app,
    role: input.role,
    pid: input.pid ?? process.pid,
    turnId: input.turnId,
    startedAt: now.toISOString(),
    heartbeatAt: now.toISOString(),
  };
  const path = lockPath(root, input.app, input.role);
  await mkdir(dirname(path), { recursive: true });
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
    return { acquired: false, lock: await readLock(root, input.app, input.role) };
  }
}

export async function readLock(root: string, app: string, role: string): Promise<TurnLock> {
  return JSON.parse(await readFile(lockPath(root, app, role), "utf8")) as TurnLock;
}

export async function heartbeatLock(
  root: string,
  app: string,
  role: string,
  now: Date = new Date(),
): Promise<TurnLock> {
  const lock = await readLock(root, app, role);
  const next = { ...lock, heartbeatAt: now.toISOString() };
  await writeFile(lockPath(root, app, role), `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

export async function releaseLock(root: string, app: string, role: string): Promise<void> {
  await rm(lockPath(root, app, role), { force: true });
}

export function isStale(lock: TurnLock, now: Date = new Date(), staleMs = DEFAULT_STALE_MS): boolean {
  return now.getTime() - new Date(lock.heartbeatAt).getTime() > staleMs;
}

export function lockExists(root: string, app: string, role: string): boolean {
  return existsSync(lockPath(root, app, role));
}

export function lockPath(root: string, app: string, role: string): string {
  return join(root, "locks", `${app}--${role}.lock`);
}
