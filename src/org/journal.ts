// Turn journal and crash-recovery decision table (architecture.md §3).

import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { SessionHandle, Trigger } from "../runtime/types.js";
import { writeFileAtomic } from "./atomic.js";

export type JournalPhase =
  | "assembling"
  | "running"
  | "collecting"
  | "done"
  | "blocked_on_gate"
  | "failed"
  | "cancelled"
  | "timed_out";

/** The event that triggered a dispatched turn, persisted at dispatch time so
 *  the turn's briefs can quote the original payload with a provenance stamp
 *  instead of trigger metadata only (issue #26). */
export interface TurnEvent {
  kind: string;
  key: string;
  source: "github-poll" | "file-drop-inbox";
  payload: Record<string, unknown>;
}

/** Durable, operator-facing evidence for a provider stop that left useful
 * work in an isolated checkout. It deliberately records state and a read-only
 * inspection command; recovery never stages or commits provider output. */
export interface TurnRecoveryEvidence {
  reasonCode: string;
  path: string;
  branch: string;
  dirty: boolean;
  statusEntries: number;
  recoveryCommand: string;
}

export interface TurnJournal {
  turnId: string;
  role: string;
  app: string;
  trigger?: string;
  triggerKind?: keyof Trigger;
  event?: TurnEvent;
  phase: JournalPhase;
  attempt: number;
  startedAt: string;
  updatedAt: string;
  passStartedAt?: string;
  /** Wall-clock kill cap (ms) recorded by the turn runner at pass-start from
   *  the active pass's `wall_clock_minutes` (src/loop/pipelines.ts). When
   *  present, killHungTurns kills against this instead of the 60-min default;
   *  absent journals fall back to the default (back-compatible). */
  wallClockCapMs?: number;
  session?: SessionHandle;
  worktree?: string;
  worktreeBranch?: string;
  ticketRef?: string;
  escalationIds?: string[];
  pid?: number;
  processStartIdentity?: string;
  processNonce?: string;
  processGroupId?: number;
  message?: string;
  errorCode?: string;
  recovery?: TurnRecoveryEvidence;
}

export type RecoveryDecision =
  | { action: "resume"; reason: string; nextAttempt: number }
  | { action: "preserve_inspect"; reason: string; nextAttempt: number }
  | { action: "recollect"; reason: string; nextAttempt: number }
  | { action: "fail_incident"; reason: string; nextAttempt: number };

const TERMINAL_JOURNAL_PHASES = new Set<JournalPhase>([
  "done",
  "blocked_on_gate",
  "failed",
  "cancelled",
  "timed_out",
]);
const ERROR_TERMINAL_JOURNAL_PHASES = new Set<JournalPhase>([
  "blocked_on_gate",
  "failed",
  "cancelled",
  "timed_out",
]);

/**
 * A turn journal is a forward-only recovery record, not a freely mutable
 * status field. Error exits may terminalize from the phase in which they
 * fail, but the productive path cannot skip running or collecting and a
 * terminal record cannot be reopened under the same turn identity.
 */
export function assertJournalPhaseTransition(
  previous: JournalPhase | undefined,
  next: JournalPhase,
): void {
  if (previous === undefined) {
    if (next === "assembling") return;
    throw new Error(`error_illegal_journal_phase_transition: new -> ${next}`);
  }
  if (previous === next) return;
  if (TERMINAL_JOURNAL_PHASES.has(previous)) {
    throw new Error(`error_illegal_journal_phase_transition: ${previous} -> ${next}`);
  }
  if (ERROR_TERMINAL_JOURNAL_PHASES.has(next)) return;
  if (previous === "collecting" && next === "done") return;
  if (previous === "assembling" && next === "running") return;
  if (previous === "running" && next === "collecting") return;
  throw new Error(`error_illegal_journal_phase_transition: ${previous} -> ${next}`);
}

export async function writeJournalPatch(
  root: string,
  turnId: string,
  patch: Partial<TurnJournal> & Pick<TurnJournal, "role" | "app">,
  now: Date = new Date(),
): Promise<TurnJournal> {
  const path = journalPath(root, turnId);
  const existing = existsSync(path) ? await readJournal(root, turnId) : undefined;
  const nextPhase = patch.phase ?? existing?.phase ?? "assembling";
  assertJournalPhaseTransition(existing?.phase, nextPhase);
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
    ...(existing?.event !== undefined ? { event: existing.event } : {}),
    ...(existing?.passStartedAt !== undefined ? { passStartedAt: existing.passStartedAt } : {}),
    ...(existing?.wallClockCapMs !== undefined ? { wallClockCapMs: existing.wallClockCapMs } : {}),
    ...(existing?.session !== undefined ? { session: existing.session } : {}),
    ...(existing?.worktree !== undefined ? { worktree: existing.worktree } : {}),
    ...(existing?.worktreeBranch !== undefined ? { worktreeBranch: existing.worktreeBranch } : {}),
    ...(existing?.ticketRef !== undefined ? { ticketRef: existing.ticketRef } : {}),
    ...(existing?.escalationIds !== undefined ? { escalationIds: existing.escalationIds } : {}),
    ...(existing?.pid !== undefined ? { pid: existing.pid } : {}),
    ...(existing?.processStartIdentity !== undefined ? { processStartIdentity: existing.processStartIdentity } : {}),
    ...(existing?.processNonce !== undefined ? { processNonce: existing.processNonce } : {}),
    ...(existing?.processGroupId !== undefined ? { processGroupId: existing.processGroupId } : {}),
    ...(existing?.message !== undefined ? { message: existing.message } : {}),
    ...(existing?.errorCode !== undefined ? { errorCode: existing.errorCode } : {}),
    ...(existing?.recovery !== undefined ? { recovery: existing.recovery } : {}),
    ...patch,
    turnId,
    role: patch.role,
    app: patch.app,
    phase: nextPhase,
    attempt: patch.attempt ?? existing?.attempt ?? 0,
    startedAt: existing?.startedAt ?? patch.startedAt ?? now.toISOString(),
    updatedAt: now.toISOString(),
  };
  await mkdir(dirname(path), { recursive: true });
  await writeFileAtomic(path, `${JSON.stringify(next, null, 2)}\n`);
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
  // Skip a single torn/unreadable journal (e.g. a write interrupted by a
  // crash or SIGKILL) instead of letting it throw and wedge every future
  // tick. The owning turn re-writes its journal atomically on the next patch.
  const journals: TurnJournal[] = [];
  for (const file of files) {
    try {
      journals.push(await readJournal(root, file.slice(0, -5)));
    } catch (error) {
      console.warn(`journal: skipping unreadable ${file}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return journals;
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
    return { action: "preserve_inspect", reason: "no usable session handle; worktree state is ambiguous", nextAttempt };
  }
  return { action: "preserve_inspect", reason: `phase ${journal.phase} has ambiguous worktree state`, nextAttempt };
}

export function journalPath(root: string, turnId: string): string {
  return join(root, "state", "turns", `${turnId}.json`);
}

function sessionExpired(journal: TurnJournal, now: Date, retentionDays: number): boolean {
  const ageMs = now.getTime() - new Date(journal.updatedAt).getTime();
  return ageMs > retentionDays * 24 * 60 * 60 * 1000;
}
