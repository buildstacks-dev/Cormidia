// Job journal — CORMIDIA-C-B23-002 (docs/jobs/design.md §6).
//
// The journal is the SOLE completion authority. Nothing is ever inferred from
// the presence of an output file, because a half-written file is
// indistinguishable from a complete one — that is the INV-015 tightening this
// subsystem carries. Every write goes through the loop's atomic writer, so a
// crash leaves either the previous journal or the next one, never a torn one.
//
// The config hash is bound at first write. A later run whose config hash differs
// refuses and names the drift rather than resuming against a different graph:
// resuming would silently execute a plan the completed steps were never part of.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { writeLoopFileAtomic } from "../loop/durable.js";
import type { JobConfig } from "./types.js";

export const JOB_JOURNAL_VERSION = 1 as const;

export type JobStepStatus = "completed" | "completed_unverified" | "failed" | "started" | "awaiting_checkpoint";

export interface JobJournalEvent {
  step: string;
  status: JobStepStatus;
  attempt: number;
  at: string;
  /** Present on terminal provider events; absent on `started`. */
  summary?: string;
  /** Machine-readable cause on `failed`. */
  reasonCode?: string;
}

export interface JobJournal {
  schemaVersion: typeof JOB_JOURNAL_VERSION;
  job: string;
  app: string | null;
  configHash: string;
  createdAt: string;
  updatedAt: string;
  events: JobJournalEvent[];
}

export class JobJournalError extends Error {
  constructor(
    readonly code: "job_journal_corrupt" | "job_config_drifted" | "job_journal_identity_mismatch",
    message: string,
  ) {
    super(message);
    this.name = "JobJournalError";
  }
}

export function jobJournalPath(stateHome: string, jobId: string): string {
  return join(stateHome, "jobs", jobId, "journal.json");
}

export function jobConfigSnapshotPath(stateHome: string, jobId: string): string {
  return join(stateHome, "jobs", jobId, "config-snapshot.yaml");
}

/**
 * Reads the journal, or returns undefined when this job has never run.
 *
 * A journal bound to a different config hash is a typed refusal, never a
 * resume — the whole point of binding the hash.
 */
export async function readJobJournal(stateHome: string, config: JobConfig): Promise<JobJournal | undefined> {
  const path = jobJournalPath(stateHome, config.job);
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }

  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    throw new JobJournalError("job_journal_corrupt", `${path}: journal is not valid JSON`);
  }
  const journal = assertJournalShape(value, path);

  if (journal.job !== config.job) {
    throw new JobJournalError(
      "job_journal_identity_mismatch",
      `${path}: journal belongs to job "${journal.job}", not "${config.job}"`,
    );
  }
  if (journal.configHash !== config.configHash) {
    throw new JobJournalError(
      "job_config_drifted",
      `${path}: this job's config changed since its last run ` +
        `(journal ${journal.configHash.slice(0, 12)}, config ${config.configHash.slice(0, 12)}). ` +
        `${succeededStepCount(journal)} step(s) already completed under the previous graph. ` +
        "Resume is refused: use a new job id, or remove the journal to start over.",
    );
  }
  return journal;
}

export function newJobJournal(config: JobConfig, at: Date): JobJournal {
  const stamp = at.toISOString();
  return {
    schemaVersion: JOB_JOURNAL_VERSION,
    job: config.job,
    app: config.app,
    configHash: config.configHash,
    createdAt: stamp,
    updatedAt: stamp,
    events: [],
  };
}

export async function writeJobJournal(stateHome: string, journal: JobJournal): Promise<void> {
  await writeLoopFileAtomic(jobJournalPath(stateHome, journal.job), `${JSON.stringify(journal, null, 2)}\n`);
}

/** Distinct steps with a terminal success, for the drift message only. Kept
 * local rather than importing progress.ts, which imports this module. */
function succeededStepCount(journal: JobJournal): number {
  const latest = new Map<string, JobStepStatus>();
  for (const event of journal.events) latest.set(event.step, event.status);
  return [...latest.values()].filter((status) => status === "completed" || status === "completed_unverified").length;
}

function assertJournalShape(value: unknown, path: string): JobJournal {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new JobJournalError("job_journal_corrupt", `${path}: journal is not a JSON object`);
  }
  const record = value as Record<string, unknown>;
  if (record["schemaVersion"] !== JOB_JOURNAL_VERSION) {
    throw new JobJournalError(
      "job_journal_corrupt",
      `${path}: unsupported journal schemaVersion ${String(record["schemaVersion"])}`,
    );
  }
  for (const field of ["job", "configHash", "createdAt", "updatedAt"]) {
    if (typeof record[field] !== "string") {
      throw new JobJournalError("job_journal_corrupt", `${path}: journal.${field} must be a string`);
    }
  }
  if (!Array.isArray(record["events"])) {
    throw new JobJournalError("job_journal_corrupt", `${path}: journal.events must be an array`);
  }
  return value as JobJournal;
}
