// Stable OS-process identity for durable liveness records (B-07). A PID alone
// can be reused after its owner exits; pairing it with the kernel-observed
// process start value distinguishes the new process from the recorded holder.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

let ownStartIdentity: string | undefined;

export function processStartIdentity(pid: number): string | undefined {
  if (!Number.isInteger(pid) || pid <= 0) return undefined;
  if (pid === process.pid && ownStartIdentity !== undefined) return ownStartIdentity;
  let identity: string | undefined;
  if (process.platform === "linux") {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
      const close = stat.lastIndexOf(")");
      const fieldsFromState = stat.slice(close + 2).trim().split(/\s+/);
      const startTicks = fieldsFromState[19]; // proc(5) field 22; array begins at field 3
      if (startTicks !== undefined) identity = `linux-start-ticks:${startTicks}`;
    } catch {
      identity = undefined;
    }
  } else {
    try {
      const started = execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 1_000,
      }).trim();
      if (started !== "") identity = `${process.platform}-lstart:${started.replace(/\s+/g, " ")}`;
    } catch {
      identity = undefined;
    }
  }
  if (pid === process.pid && identity !== undefined) ownStartIdentity = identity;
  return identity;
}

export function currentProcessStartIdentity(): string {
  const identity = processStartIdentity(process.pid);
  if (identity === undefined) {
    throw new Error(`process start identity unavailable for pid ${process.pid}`);
  }
  return identity;
}

/** False proves death or PID reuse. Undefined means the platform probe could
 * not decide and callers must fall back to their age/freshness policy. */
export function processIdentityStatus(
  pid: number,
  expectedStartIdentity: string,
): "match" | "mismatch" | "unknown" {
  const actual = processStartIdentity(pid);
  return actual === undefined ? "unknown" : actual === expectedStartIdentity ? "match" : "mismatch";
}
