// Filesystem lock for one turn per (role, app), with heartbeat staleness.

import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, open, readFile, readdir, rename, rm, rmdir, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { writeFileAtomic } from "./atomic.js";
import {
  currentProcessStartIdentity,
  processIdentityStatus,
  processStartIdentity,
} from "../runtime/process-identity.js";

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
const MUTATION_GUARD_STALE_MS = 30_000;
const MUTATION_GUARD_MAX_WAIT_MS = 30_000;

interface MutationGuard {
  directory: string;
  ownerFile: string;
}

export interface TurnLockMutationOptions {
  /** Sealed OS-boundary seam for hermetic lock-race tests. Production omits it. */
  currentStartIdentity?: () => string;
}

/**
 * Serialize create/adopt/heartbeat/release for one canonical turn-lock path.
 *
 * The guard is an atomically installed, pre-populated directory rather than a
 * second path-only lock file. Its nonce-named owner can be removed safely by a
 * late holder: `rmdir` then succeeds only while the directory is still empty,
 * and cannot remove a successor's non-empty guard. This closes the
 * compare-read/unlink race that a nonce check alone leaves open.
 */
async function withLockMutation<T>(
  path: string,
  fn: () => Promise<T>,
  options: TurnLockMutationOptions = {},
): Promise<T> {
  const guard = await acquireMutationGuard(`${path}.mutation`, options);
  try {
    return await fn();
  } finally {
    await releaseMutationGuard(guard);
  }
}

async function acquireMutationGuard(directory: string, options: TurnLockMutationOptions): Promise<MutationGuard> {
  const nonce = randomUUID();
  const ownerName = `owner-${nonce}.json`;
  const temporary = `${directory}.${process.pid}.${nonce}.tmp`;
  const payload = {
    pid: process.pid,
    processStartIdentity: (options.currentStartIdentity ?? currentProcessStartIdentity)(),
    nonce,
    at: new Date().toISOString(),
  };
  await mkdir(dirname(directory), { recursive: true });
  await mkdir(temporary);
  await writeFile(join(temporary, ownerName), `${JSON.stringify(payload)}\n`, "utf8");
  const deadline = Date.now() + MUTATION_GUARD_MAX_WAIT_MS;
  for (;;) {
    try {
      await rename(temporary, directory);
      return { directory, ownerFile: join(directory, ownerName) };
    } catch (error) {
      if (!existsSync(directory)) {
        await rm(temporary, { recursive: true, force: true });
        throw error;
      }
      if (await reclaimMutationGuard(directory)) continue;
      if (Date.now() > deadline) {
        await rm(temporary, { recursive: true, force: true });
        throw new Error(`turn lock mutation guard busy: ${directory}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }
}

async function reclaimMutationGuard(directory: string): Promise<boolean> {
  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch {
    return false;
  }
  if (entries.length === 0) {
    try {
      await rmdir(directory);
      return true;
    } catch {
      return false;
    }
  }
  if (entries.length !== 1 || !entries[0]!.startsWith("owner-") || !entries[0]!.endsWith(".json")) {
    return false;
  }
  const ownerFile = join(directory, entries[0]!);
  let reclaimable = false;
  try {
    const [payload, metadata] = await Promise.all([
      readFile(ownerFile, "utf8").then(
        (text) =>
          JSON.parse(text) as {
            pid?: unknown;
            processStartIdentity?: unknown;
            at?: unknown;
          },
      ),
      stat(ownerFile),
    ]);
    const ageBase = typeof payload.at === "string" ? new Date(payload.at).getTime() : metadata.mtimeMs;
    const old = Number.isFinite(ageBase) && Date.now() - ageBase > MUTATION_GUARD_STALE_MS;
    if (typeof payload.pid === "number" && typeof payload.processStartIdentity === "string") {
      const status = processIdentityStatus(payload.pid, payload.processStartIdentity);
      reclaimable = status === "mismatch" || (status === "unknown" && old);
    } else {
      reclaimable = old;
    }
  } catch {
    try {
      reclaimable = Date.now() - (await stat(ownerFile)).mtimeMs > MUTATION_GUARD_STALE_MS;
    } catch {
      return false;
    }
  }
  if (!reclaimable) return false;
  await rm(ownerFile, { force: true });
  try {
    await rmdir(directory);
    return true;
  } catch {
    return false;
  }
}

async function releaseMutationGuard(guard: MutationGuard): Promise<void> {
  await rm(guard.ownerFile, { force: true });
  try {
    await rmdir(guard.directory);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT" && code !== "ENOTEMPTY" && code !== "EEXIST") throw error;
  }
}

export async function acquireLock(
  root: string,
  input: { app: string; role: string; turnId: string; now?: Date; pid?: number },
): Promise<AcquireLockResult> {
  const now = input.now ?? new Date();
  const ownerPid = input.pid ?? process.pid;
  const ownerStart = ownerPid === process.pid ? currentProcessStartIdentity() : processStartIdentity(ownerPid);
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
  return withLockMutation(path, async () => {
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
        const holder = await readLockOrUndefined(root, input.app, input.role);
        if (holder !== undefined) return { acquired: false, lock: holder };
        if (attempt < ACQUIRE_CONTENTION_RETRIES) continue;
        return { acquired: false, lock: unknownStaleHolder(input.app, input.role) };
      }
    }
  });
}

export async function readLock(root: string, app: string, role: string): Promise<TurnLock> {
  return JSON.parse(await readFile(lockPath(root, app, role), "utf8")) as TurnLock;
}

/** Read the current holder, or undefined when the lock is gone or its payload is
 *  not yet readable — a vanished/torn file during a concurrent release or a
 *  mid-write acquire. Never throws on those ordinary races, so a check-then-act
 *  caller cannot turn contention into an unhandled ENOENT (F-007). */
export async function readLockOrUndefined(root: string, app: string, role: string): Promise<TurnLock | undefined> {
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
  const path = lockPath(root, app, role);
  return withLockMutation(path, async () => {
    const lock = await readLock(root, app, role);
    const next = { ...lock, heartbeatAt: now.toISOString() };
    await writeFileAtomic(path, `${JSON.stringify(next, null, 2)}\n`);
    return next;
  });
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
  const path = lockPath(root, app, role);
  return withLockMutation(path, async () => {
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
    await writeFileAtomic(path, `${JSON.stringify(adopted, null, 2)}\n`);
    return adopted;
  });
}

/** Remove only the lock whose full durable ownership token the caller holds.
 * A late release from a reclaimed turn must never delete its successor. */
export async function releaseLock(
  root: string,
  app: string,
  role: string,
  expected: TurnLock,
  mutationOptions: TurnLockMutationOptions = {},
): Promise<boolean> {
  const path = lockPath(root, app, role);
  return withLockMutation(
    path,
    async () => {
      const current = await readLockOrUndefined(root, app, role);
      if (
        current === undefined ||
        expected.nonce === undefined ||
        current.nonce !== expected.nonce ||
        current.turnId !== expected.turnId ||
        current.pid !== expected.pid ||
        current.processStartIdentity !== expected.processStartIdentity
      )
        return false;
      await rm(path, { force: true });
      return true;
    },
    mutationOptions,
  );
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
