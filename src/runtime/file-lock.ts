// One filesystem-lock primitive shared across the codebase's hand-rolled locks
// (F-008). Codifies the model the settlement/ledger lock already embodies
// (src/runtime/telemetry.ts): atomic O_EXCL acquisition, a pid+nonce+timestamp
// payload, reclamation that NEVER breaks a proven-live holder, and a release
// that verifies its ownership token before unlinking so a holder finishing late
// can never delete a successor's lock.
//
// The three legacy locks (TurnLock, settlement, app git-clone) each grew their
// own copy with divergent reclamation policies; the app git-clone lock is the
// first to be re-expressed as a configuration of this primitive. Import
// direction stays legal (org -> runtime): callers in src/org and src/loop may
// depend on this leaf.

import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rm, stat } from "node:fs/promises";
import { dirname } from "node:path";

/** Injectable time source so a lock's wait deadline and back-off are
 *  deterministic under test (fake clock) without touching the wall clock. */
export interface FileLockClock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const realFileLockClock: FileLockClock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/** The ownership token every lock file carries. `pid` drives the liveness
 *  probe; `nonce` makes release verifiable. */
export interface FileLockToken {
  pid: number;
  nonce: string;
}

interface FileLockPayload extends FileLockToken {
  at: string;
}

/** Raised when a lock is held by a *live* holder past the max wait. The waiter
 *  never force-breaks a live holder; it surfaces this so the caller can fail the
 *  operation and retry later, rather than running its critical section
 *  concurrently with the holder. */
export class FileLockBusyError extends Error {
  constructor(public readonly lockPath: string) {
    super(`file lock busy: ${lockPath}`);
    this.name = "FileLockBusyError";
  }
}

export interface FileLockOptions {
  /** Reclaim a holder aged past this window when its pid is
   *  unreadable/inconclusive. A proven-live holder is never reclaimed. */
  staleMs: number;
  /** Max wait before a live holder past the deadline yields FileLockBusyError.
   *  Should sit ABOVE `staleMs` so a genuinely stale holder is reclaimed by the
   *  liveness/stale predicate first, and a live holder is never force-broken. */
  maxWaitMs: number;
  /** Back-off range between contention retries (ms). Defaults to 40..100. */
  retryMinMs?: number;
  retryMaxMs?: number;
  clock?: FileLockClock;
}

/** Acquire the lock at `lockPath`, returning the ownership token to release
 *  with. Reclaims only a holder proven dead or aged past the window (never a
 *  live one); a live holder held past `maxWaitMs` yields FileLockBusyError. */
export async function acquireFileLock(lockPath: string, options: FileLockOptions): Promise<FileLockToken> {
  const clock = options.clock ?? realFileLockClock;
  const retryMin = options.retryMinMs ?? 40;
  const retrySpan = Math.max(0, (options.retryMaxMs ?? 100) - retryMin);
  const token: FileLockToken = { pid: process.pid, nonce: randomUUID() };
  const deadline = clock.now() + options.maxWaitMs;
  await mkdir(dirname(lockPath), { recursive: true });
  for (;;) {
    try {
      const fh = await open(lockPath, "wx");
      try {
        const payload: FileLockPayload = { ...token, at: new Date(clock.now()).toISOString() };
        await fh.writeFile(`${JSON.stringify(payload)}\n`, "utf8");
      } finally {
        await fh.close();
      }
      return token;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      // Reclaim ONLY a holder proven dead or aged past the window — never a
      // live one. A live holder must keep the lock so we do not run our
      // critical section concurrently with it.
      if (await reclaimIfStale(lockPath, clock.now(), options.staleMs)) continue;
      if (clock.now() > deadline) {
        // Past the max wait and the holder is still live (a dead/stale holder
        // would have been reclaimed above). Fail rather than force-break a live
        // holder; the caller retries later.
        throw new FileLockBusyError(lockPath);
      }
      await clock.sleep(retryMin + Math.floor(Math.random() * (retrySpan + 1)));
    }
  }
}

/** Release the lock, but only if it is still OURS. A holder that finishes after
 *  its lock was reclaimed and re-acquired by a successor must never delete that
 *  successor's lock (the release-by-path corruption in F-001). */
export async function releaseFileLock(lockPath: string, token: FileLockToken): Promise<void> {
  try {
    const payload = JSON.parse(await readFile(lockPath, "utf8")) as Partial<FileLockPayload>;
    if (payload.nonce !== token.nonce) return;
  } catch {
    // Vanished or unreadable: nothing of ours to remove, and never authority to
    // unlink a lock another process may have just created at the same path.
    return;
  }
  await rm(lockPath, { force: true });
}

/** RAII shape: acquire, run `fn`, release exactly once. */
export async function withFileLock<T>(
  lockPath: string,
  options: FileLockOptions,
  fn: () => Promise<T>,
): Promise<T> {
  const token = await acquireFileLock(lockPath, options);
  try {
    return await fn();
  } finally {
    await releaseFileLock(lockPath, token);
  }
}

/** True iff the lock was reclaimed (removed). Reclaims a holder proven dead, or
 *  a lock aged past the stale window when its pid is unreadable/inconclusive —
 *  and NEVER a proven-live holder. A vanished/unreadable path is "retry the
 *  create", never authority to unlink a lock another process may have just
 *  created. Mirrors settlementLockIsStale in src/runtime/telemetry.ts. */
async function reclaimIfStale(lockPath: string, nowMs: number, staleMs: number): Promise<boolean> {
  let contents: string;
  let mtimeMs: number;
  try {
    const [text, stats] = await Promise.all([readFile(lockPath, "utf8"), stat(lockPath)]);
    contents = text;
    mtimeMs = stats.mtimeMs;
  } catch {
    return false;
  }
  let pid: number | undefined;
  let atMs: number | undefined;
  try {
    const payload = JSON.parse(contents) as Partial<FileLockPayload>;
    if (typeof payload.pid === "number") pid = payload.pid;
    if (typeof payload.at === "string") atMs = new Date(payload.at).getTime();
  } catch {
    // Torn/partial write — fall back to filesystem mtime for the age check.
  }
  // Age from the payload timestamp when trustworthy (fake-clock testable), else
  // from filesystem mtime (a just-created, not-yet-written lock stays fresh, so
  // we never reclaim a lock another process just opened).
  const ageMs = atMs !== undefined && Number.isFinite(atMs) ? nowMs - atMs : Date.now() - mtimeMs;
  const old = ageMs > staleMs;
  if (pid === undefined || !Number.isInteger(pid) || pid <= 0) {
    if (old) {
      await rm(lockPath, { force: true });
      return true;
    }
    return false;
  }
  if (holderIsStale(pid, old)) {
    await rm(lockPath, { force: true });
    return true;
  }
  return false;
}

/** Whether a lock owned by `pid` is reclaimable. A live pid (probe succeeds, or
 *  EPERM — cannot signal but exists) is NEVER stale. A proven-dead pid (ESRCH)
 *  is stale immediately; any other probe error falls back to the age window.
 *  Mirrors settlementLockIsStale in src/runtime/telemetry.ts. */
function holderIsStale(pid: number, old: boolean): boolean {
  if (pid === process.pid) return false;
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === "ESRCH" || (code !== "EPERM" && old);
  }
}
