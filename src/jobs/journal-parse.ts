// Strict job-journal trust-boundary parser shared by runner and observe.

import {
  JOB_JOURNAL_VERSION,
  JobJournalError,
  type JobJournal,
  type JobJournalEvent,
  type JobStepStatus,
} from "./journal.js";

export function parseJobJournal(value: unknown, path: string): JobJournal {
  if (!isRecord(value)) throw new JobJournalError("job_journal_corrupt", `${path}: journal is not a JSON object`);
  const record = value;
  if (record["schemaVersion"] !== JOB_JOURNAL_VERSION) {
    throw new JobJournalError(
      "job_journal_corrupt",
      `${path}: unsupported journal schemaVersion ${String(record["schemaVersion"])}`,
    );
  }
  const job = requiredString(record["job"], `${path}: journal.job`);
  const configHash = requiredString(record["configHash"], `${path}: journal.configHash`);
  const createdAt = requiredString(record["createdAt"], `${path}: journal.createdAt`);
  const updatedAt = requiredString(record["updatedAt"], `${path}: journal.updatedAt`);
  if (!Array.isArray(record["events"])) {
    throw new JobJournalError("job_journal_corrupt", `${path}: journal.events must be an array`);
  }
  const app = record["app"];
  if (app !== null && typeof app !== "string") {
    throw new JobJournalError("job_journal_corrupt", `${path}: journal.app must be a string or null`);
  }
  const events = record["events"].map((event, index) => parseEvent(event, `${path}: journal.events[${index}]`));
  return { schemaVersion: JOB_JOURNAL_VERSION, job, app, configHash, createdAt, updatedAt, events };
}

function parseEvent(value: unknown, context: string): JobJournalEvent {
  if (!isRecord(value)) throw new JobJournalError("job_journal_corrupt", `${context} must be an object`);
  const record = value;
  const step = requiredString(record["step"], `${context}.step`);
  const at = requiredString(record["at"], `${context}.at`);
  const attempt = record["attempt"];
  if (typeof attempt !== "number" || !Number.isSafeInteger(attempt) || attempt < 0) {
    throw new JobJournalError("job_journal_corrupt", `${context}.attempt must be a non-negative integer`);
  }
  const status = parseStatus(record["status"], `${context}.status`);
  const summary = optionalString(record["summary"], `${context}.summary`);
  const reasonCode = optionalString(record["reasonCode"], `${context}.reasonCode`);
  return {
    step,
    status,
    attempt,
    at,
    ...(summary === undefined ? {} : { summary }),
    ...(reasonCode === undefined ? {} : { reasonCode }),
  };
}

function parseStatus(value: unknown, context: string): JobStepStatus {
  switch (value) {
    case "completed":
    case "completed_unverified":
    case "failed":
    case "started":
    case "awaiting_checkpoint":
      return value;
    default:
      throw new JobJournalError("job_journal_corrupt", `${context} is not a recognized job step status`);
  }
}

function optionalString(value: unknown, context: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new JobJournalError("job_journal_corrupt", `${context} must be a string`);
  return value;
}

function requiredString(value: unknown, context: string): string {
  if (typeof value !== "string") throw new JobJournalError("job_journal_corrupt", `${context} must be a string`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
