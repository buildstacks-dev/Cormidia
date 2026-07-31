import { lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

interface LockOwner { schema_version: 1; pid: number; acquired_at: string }

/** Atomic, process-owned lock for external-scheduler `--once` invocations.
 * A dead owner's directory is recoverable; corrupt or symlinked locks fail
 * closed so two runners can never both decide they own the same tick. */
export async function withSoakLock<T>(lockDir: string, work: () => T | Promise<T>, options: { pid?: number; processAlive?: (pid: number) => boolean; now?: () => Date } = {}): Promise<T> {
  const pid = options.pid ?? process.pid;
  const processAlive = options.processAlive ?? isProcessAlive;
  const now = options.now ?? (() => new Date());
  mkdirSync(dirname(lockDir), { recursive: true });
  acquire(false);
  try { return await work(); }
  finally { rmSync(lockDir, { recursive: true, force: true }); }

  function acquire(retried: boolean): void {
    try {
      mkdirSync(lockDir);
      writeFileSync(join(lockDir, "owner.json"), `${JSON.stringify({ schema_version: 1, pid, acquired_at: now().toISOString() } satisfies LockOwner)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const stat = lstatSync(lockDir);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("soak_lock_unsafe_type");
    let owner: LockOwner;
    try { owner = JSON.parse(readFileSync(join(lockDir, "owner.json"), "utf8")) as LockOwner; }
    catch { throw new Error("soak_lock_corrupt"); }
    if (owner.schema_version !== 1 || !Number.isInteger(owner.pid) || owner.pid <= 0 || !Number.isFinite(Date.parse(owner.acquired_at))) throw new Error("soak_lock_corrupt");
    if (processAlive(owner.pid)) throw new Error(`soak_tick_locked:${owner.pid}`);
    if (retried) throw new Error("soak_stale_lock_recovery_raced");
    rmSync(lockDir, { recursive: true, force: true });
    acquire(true);
  }
}

function isProcessAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
}
