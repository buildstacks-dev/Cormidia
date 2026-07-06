// Stale-lock recovery actions (architecture.md §3).

import { execFileSync } from "node:child_process";
import { releaseLock, type TurnLock } from "./locks.js";
import { decideRecovery, writeJournalPatch, type RecoveryDecision, type TurnJournal } from "./journal.js";

export interface RecoveryActionResult {
  decision: RecoveryDecision;
  spawned?: boolean;
}

export type RecoverySpawn = (input: { journal: TurnJournal; decision: RecoveryDecision }) => Promise<void>;

export async function recoverStaleTurn(
  root: string,
  lock: TurnLock,
  journal: TurnJournal,
  options: { now?: Date; spawn?: RecoverySpawn } = {},
): Promise<RecoveryActionResult> {
  const now = options.now ?? new Date();
  const decision = decideRecovery(journal, { now });
  if (decision.action === "resume") {
    await writeJournalPatch(
      root,
      journal.turnId,
      {
        role: journal.role,
        app: journal.app,
        phase: "running",
        attempt: decision.nextAttempt,
        message: "resuming interrupted turn; reassess repo state before continuing",
      },
      now,
    );
    await options.spawn?.({ journal, decision });
    return { decision, spawned: options.spawn !== undefined };
  }

  if (decision.action === "restart_clean") {
    if (journal.worktree !== undefined) restartClean(journal.worktree);
    await writeJournalPatch(
      root,
      journal.turnId,
      {
        role: journal.role,
        app: journal.app,
        phase: "assembling",
        attempt: decision.nextAttempt,
        message: "restart clean after stale lock",
      },
      now,
    );
    await options.spawn?.({ journal, decision });
    return { decision, spawned: options.spawn !== undefined };
  }

  if (decision.action === "recollect") {
    await writeJournalPatch(
      root,
      journal.turnId,
      {
        role: journal.role,
        app: journal.app,
        phase: "collecting",
        attempt: decision.nextAttempt,
        message: "recollecting already-completed turn artifacts",
      },
      now,
    );
    await options.spawn?.({ journal, decision });
    return { decision, spawned: options.spawn !== undefined };
  }

  await writeJournalPatch(
    root,
    journal.turnId,
    {
      role: journal.role,
      app: journal.app,
      phase: "failed",
      attempt: decision.nextAttempt,
      message: "attempt cap reached during recovery",
    },
    now,
  );
  await releaseLock(root, lock.app, lock.role);
  return { decision, spawned: false };
}

export function restartClean(worktree: string): void {
  git(worktree, "reset", "--hard");
  git(worktree, "clean", "-fd");
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}
