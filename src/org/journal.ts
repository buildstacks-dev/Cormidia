// Turn journal and crash-recovery decision table (architecture.md §3).

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { SessionHandle, Trigger } from "../runtime/types.js";

export type JournalPhase =
  | "assembling"
  | "running"
  | "collecting"
  | "done"
  | "blocked_on_gate"
  | "failed";

export interface TurnJournal {
  turnId: string;
  role: string;
  app: string;
  trigger?: string;
  triggerKind?: keyof Trigger;
  phase: JournalPhase;
  attempt: number;
  startedAt: string;
  updatedAt: string;
  passStartedAt?: string;
  session?: SessionHandle;
  worktree?: string;
  ticketRef?: string;
  escalationIds?: string[];
  pid?: number;
  message?: string;
}

export type RecoveryDecision =
  | { action: "resume"; reason: string; nextAttempt: number }
  | { action: "restart_clean"; reason: string; nextAttempt: number }
  | { action: "recollect"; reason: string; nextAttempt: number }
  | { action: "fail_incident"; reason: string; nextAttempt: number };

export async function writeJournalPatch(
  root: string,
  turnId: string,
  patch: Partial<TurnJournal> & Pick<TurnJournal, "role" | "app">,
  now: Date = new Date(),
): Promise<TurnJournal> {
  const path = journalPath(root, turnId);
  const existing = existsSync(path) ? await readJournal(root, turnId) : undefined;
  const next: TurnJournal = {
    ...(existing ?? {
      turnId,
      role: patch.role,
      app: patch.app,
      phase: "assembling" as const,
      attempt: 0,
      startedAt: now.toISOString(),
      updatedAt: now.toISOString(),
    }),
    ...(existing?.trigger !== undefined ? { trigger: existing.trigger } : {}),
    ...(existing?.triggerKind !== undefined ? { triggerKind: existing.triggerKind } : {}),
    ...(existing?.passStartedAt !== undefined ? { passStartedAt: existing.passStartedAt } : {}),
    ...(existing?.session !== undefined ? { session: existing.session } : {}),
    ...(existing?.worktree !== undefined ? { worktree: existing.worktree } : {}),
    ...(existing?.ticketRef !== undefined ? { ticketRef: existing.ticketRef } : {}),
    ...(existing?.escalationIds !== undefined ? { escalationIds: existing.escalationIds } : {}),
    ...(existing?.pid !== undefined ? { pid: existing.pid } : {}),
    ...(existing?.message !== undefined ? { message: existing.message } : {}),
    ...patch,
    turnId,
    role: patch.role,
    app: patch.app,
    phase: patch.phase ?? existing?.phase ?? "assembling",
    attempt: patch.attempt ?? existing?.attempt ?? 0,
    startedAt: existing?.startedAt ?? patch.startedAt ?? now.toISOString(),
    updatedAt: now.toISOString(),
  };
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

export async function readJournal(root: string, turnId: string): Promise<TurnJournal> {
  return JSON.parse(await readFile(journalPath(root, turnId), "utf8")) as TurnJournal;
}

export async function listJournals(root: string): Promise<TurnJournal[]> {
  const dir = join(root, "state", "turns");
  if (!existsSync(dir)) return [];
  const { readdir } = await import("node:fs/promises");
  const files = (await readdir(dir)).filter((file) => file.endsWith(".json")).sort();
  return Promise.all(files.map((file) => readJournal(root, file.slice(0, -5))));
}

export function decideRecovery(
  journal: TurnJournal,
  options: { now?: Date; sessionRetentionDays?: number; resumeFailed?: boolean } = {},
): RecoveryDecision {
  const now = options.now ?? new Date();
  const nextAttempt = journal.attempt + 1;
  if (journal.attempt >= 3) {
    return { action: "fail_incident", reason: "attempt cap reached", nextAttempt: journal.attempt };
  }
  if (journal.phase === "collecting") {
    return { action: "recollect", reason: "model already finished; rerun collection only", nextAttempt: journal.attempt };
  }
  if (journal.phase === "running") {
    if (
      journal.session !== undefined &&
      journal.attempt < 2 &&
      options.resumeFailed !== true &&
      !sessionExpired(journal, now, options.sessionRetentionDays ?? 30)
    ) {
      return { action: "resume", reason: "running turn has resumable session", nextAttempt: journal.attempt };
    }
    return { action: "restart_clean", reason: "no usable session handle", nextAttempt };
  }
  return { action: "restart_clean", reason: `phase ${journal.phase} restarts clean`, nextAttempt };
}

export function journalPath(root: string, turnId: string): string {
  return join(root, "state", "turns", `${turnId}.json`);
}

function sessionExpired(journal: TurnJournal, now: Date, retentionDays: number): boolean {
  const ageMs = now.getTime() - new Date(journal.updatedAt).getTime();
  return ageMs > retentionDays * 24 * 60 * 60 * 1000;
}
