// Shared primitives for the token-free lifecycle plane. These helpers stay in
// the org layer and deliberately import no runtime factory or adapter. Every
// public lifecycle operation emits a deterministic mechanical execution step.

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { lstat, mkdir, open, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { admitEpisode, finalizeEpisode, recordMechanicalStep, type ExecutionStatus } from "../loop/efficiency.js";

export const LIFECYCLE_SCHEMA_VERSION = 1 as const;
export const LIFECYCLE_POLICY_VERSION = "lifecycle/v1";

export type LifecycleFaultPoint =
  | "before_archive_creation"
  | "after_archive_creation"
  | "before_archive_checksum"
  | "after_archive_checksum"
  | "before_archive_rename"
  | "after_archive_rename"
  | "before_registry_write"
  | "after_registry_write"
  | "before_config_write"
  | "after_config_write"
  | "after_config_ratification_intent"
  | "after_config_ratification_record"
  | "after_config_ratification_complete"
  | "before_git_fetch"
  | "after_git_fetch"
  | "before_ref_validation"
  | "after_ref_validation"
  | "before_worktree_creation"
  | "after_worktree_creation"
  | "before_commit"
  | "after_commit"
  | "before_push"
  | "after_push"
  | "before_pull_request_update"
  | "after_pull_request_update"
  | "before_issue_update"
  | "after_issue_update"
  | "before_branch_update"
  | "after_branch_update";

/** Test-only injection is passed as an in-memory function. No CLI flag or
 * environment variable exposes a production fault-control surface. */
export type LifecycleFaultHook = (point: LifecycleFaultPoint) => void | Promise<void>;

export interface LifecycleBlocker {
  code: "active_run" | "stale_run" | "active_journal" | "active_lock" | "pending_approval" | "invalid_state";
  ids: string[];
  forceEligible: boolean;
  remediation: string;
}

export interface LifecycleCheck {
  id: string;
  status: "pass" | "fail" | "blocked";
  detail: string;
  remediation?: string;
}

export function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonicalValue(item)]),
    );
  }
  return value;
}

/** Stable public JSON: sorted object keys, preserved array order, final LF. */
export function stableJson(value: unknown): string {
  return `${JSON.stringify(canonicalValue(value), null, 2)}\n`;
}

export async function writeLifecycleFileAtomic(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${sha256(`${path}\0${contents}`).slice(0, 12)}.tmp`;
  try {
    await writeFile(temporary, contents, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

/** Cross-process lifecycle serialization with crash recovery. A live PID is
 * never crossed; a lock left by a killed process is reclaimed on the next
 * execute attempt. Corrupt lock files fail closed. */
export async function acquireLifecycleOperationLock(
  stateHome: string,
  key: string,
  operation: string,
): Promise<() => Promise<void>> {
  assertSafeSegment(key, "lifecycle lock");
  const path = resolve(stateHome, "lifecycle", "locks", `${key}.lock`);
  await mkdir(dirname(path), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const handle = await open(path, "wx", 0o600);
      await handle.writeFile(
        stableJson({ schema_version: LIFECYCLE_SCHEMA_VERSION, key, operation, pid: process.pid }),
      );
      return async () => {
        await handle.close();
        await rm(path, { force: true });
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      let owner: unknown;
      try {
        await assertRegularFile(path, `${operation} lock`);
        owner = JSON.parse(await readFile(path, "utf8"));
      } catch (readError) {
        throw new Error(
          `${operation}: corrupt lifecycle lock ${path}: ${readError instanceof Error ? readError.message : String(readError)}`,
        );
      }
      const pid = owner && typeof owner === "object" ? (owner as Record<string, unknown>)["pid"] : undefined;
      if (typeof pid !== "number" || !Number.isSafeInteger(pid) || pid <= 0) {
        throw new Error(`${operation}: corrupt lifecycle lock ${path}`);
      }
      if (processIsAlive(pid)) throw new Error(`${operation}: concurrent lifecycle operation holds ${path}`);
      await rm(path, { force: true });
    }
  }
  throw new Error(`${operation}: could not acquire lifecycle lock ${path}`);
}

export function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

export function assertSafeSegment(value: string, label: string): void {
  if (
    value.length === 0 ||
    value === "." ||
    value === ".." ||
    value.includes("/") ||
    value.includes("\\") ||
    !/^[A-Za-z0-9._-]+$/.test(value)
  ) {
    throw new Error(`${label}: unsafe path segment ${JSON.stringify(value)}`);
  }
}

export function assertSafeRelativePath(value: string, label = "lifecycle path"): void {
  const normalized = value.replaceAll("\\", "/");
  if (
    value.length === 0 ||
    isAbsolute(value) ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.includes("/../") ||
    normalized.includes("\0")
  ) {
    throw new Error(`${label}: traversal is forbidden: ${JSON.stringify(value)}`);
  }
}

export function isInside(candidate: string, ancestor: string): boolean {
  const rel = relative(resolve(ancestor), resolve(candidate));
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !rel.startsWith(sep));
}

export async function assertRegularFile(path: string, label: string): Promise<void> {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink())
    throw new Error(`${label}: expected a regular non-symlink file: ${path}`);
}

export async function assertDirectoryNoSymlink(path: string, label: string): Promise<string> {
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new Error(`${label}: expected a non-symlink directory: ${path}`);
  return realpath(path);
}

export async function fingerprintFiles(paths: readonly string[]): Promise<string> {
  const records: string[] = [];
  for (const path of [...paths].sort()) {
    if (!existsSync(path)) {
      records.push(`${resolve(path)}\0missing`);
      continue;
    }
    await assertRegularFile(path, "lifecycle fingerprint");
    const content = await readFile(path);
    records.push(`${resolve(path)}\0${content.byteLength}\0${sha256(content)}`);
  }
  return sha256(records.join("\n"));
}

export async function emitLifecycleStep(input: {
  stateHome: string;
  app: string;
  operation: string;
  inputFingerprint: string;
  status: ExecutionStatus;
  reason: string;
  nextStep?: string;
  startedAt?: Date;
  finishedAt?: Date;
}): Promise<void> {
  const key = sha256(`${input.operation}\0${input.inputFingerprint}\0${input.status}`).slice(0, 20);
  const episodeId = `lifecycle:${input.app}:${key}`;
  const now = input.startedAt ?? new Date();
  await admitEpisode({
    root: input.stateHome,
    episodeId,
    app: input.app,
    route: "deterministic",
    policyVersion: LIFECYCLE_POLICY_VERSION,
    factors: [
      {
        kind: "evidence_quality",
        evidence: `deterministic lifecycle operation ${input.operation}`,
        policy_rule: "deterministic_lifecycle",
      },
    ],
    passes: [],
    now,
  });
  await recordMechanicalStep({
    root: input.stateHome,
    episodeId,
    app: input.app,
    runId: `lifecycle-${key}`,
    operation: input.operation,
    startedAt: now,
    finishedAt: input.finishedAt ?? new Date(),
    status: input.status,
    reason: input.reason,
    ...(input.nextStep !== undefined ? { nextStep: input.nextStep } : {}),
    inputFingerprint: input.inputFingerprint,
  });
  await finalizeEpisode({
    root: input.stateHome,
    episodeId,
    status: input.status === "completed" ? "completed" : input.status === "blocked" ? "blocked" : "failed",
    reason: input.reason,
    ...(input.nextStep !== undefined ? { nextStep: input.nextStep } : {}),
    now: input.finishedAt ?? new Date(),
  });
}
