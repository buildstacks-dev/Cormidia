// Shared durable job-state projection — CF-J22-A / HB-145.
//
// Both `cormidia-job` and `cormidia observe` consume this projection. The
// display vocabulary therefore comes from one function, and the durable
// `completed_unverified` event can never be collapsed to bare `completed` by
// one surface while the other remains honest.

import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { JobJournal, JobJournalEvent, JobStepStatus } from "./journal.js";
import { parseJobJournal } from "./journal-parse.js";

export type JobStepDisplayStatus =
  | "awaiting checkpoint"
  | "completed"
  | "completed (unverified)"
  | "failed"
  | "running";

export interface JobStepStateView {
  step: string;
  durable_status: JobStepStatus;
  display_status: JobStepDisplayStatus;
  attempt: number;
  updated_at: string;
  reason_code: string | null;
  summary: string | null;
}

export interface JobJournalView {
  id: string;
  job: string;
  app: string | null;
  updated_at: string;
  steps: JobStepStateView[];
}

export interface JobJournalIndex {
  records: JobJournalView[];
  errors: string[];
}

export function projectJobJournal(journal: JobJournal): JobJournalView {
  const latest = new Map<string, JobJournalEvent>();
  for (const event of journal.events) latest.set(event.step, event);
  return {
    id: `job:${journal.job}`,
    job: journal.job,
    app: journal.app,
    updated_at: journal.updatedAt,
    steps: [...latest.values()].map(projectStep),
  };
}

export function formatJobStepStates(steps: readonly JobStepStateView[]): string[] {
  return steps.map((step) => `${step.step}: ${step.display_status}`);
}

export async function indexJobJournals(stateHome: string): Promise<JobJournalIndex> {
  const root = join(stateHome, "jobs");
  if (!existsSync(root)) return { records: [], errors: [] };
  const records: JobJournalView[] = [];
  const errors: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const path = join(root, entry.name, "journal.json");
    try {
      const value: unknown = JSON.parse(await readFile(path, "utf8"));
      records.push(projectJobJournal(parseJobJournal(value, path)));
    } catch (error) {
      errors.push(`${entry.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { records: records.sort((left, right) => left.job.localeCompare(right.job)), errors };
}

function projectStep(event: JobJournalEvent): JobStepStateView {
  return {
    step: event.step,
    durable_status: event.status,
    display_status: displayStatus(event.status),
    attempt: event.attempt,
    updated_at: event.at,
    reason_code: event.reasonCode ?? null,
    summary: event.summary ?? null,
  };
}

function displayStatus(status: JobStepStatus): JobStepDisplayStatus {
  switch (status) {
    case "awaiting_checkpoint":
      return "awaiting checkpoint";
    case "completed":
      return "completed";
    case "completed_unverified":
      return "completed (unverified)";
    case "failed":
      return "failed";
    case "started":
      return "running";
  }
}
