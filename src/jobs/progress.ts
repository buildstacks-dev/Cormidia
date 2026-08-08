// Journal interpretation — the read side of CORMIDIA-C-B30-002.
//
// Split from journal.ts because that module owns durable shape and IO while this
// one owns "what does the journal mean". Keeping them together pushed a single
// module past the public-symbol budget, which is the standard's smoke signal
// that one module was answering two questions.
//
// Every function here derives from journal events ONLY. Nothing consults the
// filesystem, because completion is never inferred from an output file's
// presence (docs/jobs/design.md §6).

import type { JobJournal, JobJournalEvent, JobStepStatus } from "./journal.js";
import type { JobConfig, JobStep } from "./types.js";

export function appendJobEvent(journal: JobJournal, event: JobJournalEvent): JobJournal {
  return { ...journal, events: [...journal.events, event], updatedAt: event.at };
}

/**
 * Steps that reached a terminal success.
 *
 * `completed_unverified` counts as success: the step ran and declared no checks.
 * That is a visible property of the result (the INV-008 tightening), not a
 * failure — but it is also never rendered as a bare `completed`.
 */
export function completedStepIds(journal: JobJournal): string[] {
  return [...latestByStep(journal)].filter(([, event]) => isSuccess(event.status)).map(([step]) => step);
}

/**
 * A step whose latest event is `started`: a process died mid-step.
 *
 * Its provider turn may already have been paid for, so the runner retries it at
 * most once under this same attempt number rather than treating it as never-run.
 * Skipping it would lose paid work; re-running it freely would double-spend.
 */
export function interruptedStep(journal: JobJournal): JobJournalEvent | undefined {
  const latest = journal.events.at(-1);
  return latest?.status === "started" ? latest : undefined;
}

export function checkpointAwaiting(journal: JobJournal): JobJournalEvent | undefined {
  const latest = journal.events.at(-1);
  return latest?.status === "awaiting_checkpoint" ? latest : undefined;
}

export function attemptsFor(journal: JobJournal, stepId: string): number {
  return journal.events.filter((event) => event.step === stepId && event.status === "started").length;
}

/** The first step whose terminal state is `failed`. A failed step stops the job;
 * downstream steps never run (design.md §6). */
export function failedStep(journal: JobJournal): JobJournalEvent | undefined {
  return [...latestByStep(journal).values()].find((event) => event.status === "failed");
}

/**
 * Dependency-ordered frontier: steps whose dependencies have all succeeded,
 * sorted by id so execution order is deterministic across runs.
 *
 * Deliberately local rather than `selectReadyEpisodeSteps`: that function is
 * typed over a full `EpisodePlan`, and fabricating one would mean inventing an
 * intentHash, estimatedBudget and derivedSafetyRoute that mean nothing for a
 * job — exactly the coupling docs/jobs/design.md §13 refuses. The logic is the
 * four lines below, and a fake plan would cost more than it saved.
 */
export function readyJobSteps(config: JobConfig, completed: readonly string[]): JobStep[] {
  const done = new Set(completed);
  return config.steps
    .filter((step) => !done.has(step.id) && step.dependsOn.every((id) => done.has(id)))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function latestByStep(journal: JobJournal): Map<string, JobJournalEvent> {
  const latest = new Map<string, JobJournalEvent>();
  for (const event of journal.events) latest.set(event.step, event);
  return latest;
}

function isSuccess(status: JobStepStatus): boolean {
  return status === "completed" || status === "completed_unverified";
}
