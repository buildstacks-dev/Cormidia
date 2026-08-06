import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { writeLoopFileAtomic } from "./durable.js";
import { efficiencyEpisodeDir, fingerprint } from "./efficiency.js";

const EXECUTION_JOURNAL_VERSION = 1 as const;

const EXECUTION_BOUNDARIES = [
  "route",
  "contract",
  "implementation",
  "push",
  "gates",
  "pr",
  "findings",
  "approvals",
  "merge",
  "release",
] as const;

export type ExecutionBoundary = (typeof EXECUTION_BOUNDARIES)[number];
export type JournalStopKind = "cap_stop" | "cancelled" | "crash" | "provider_timeout";

interface ExecutionJournalStage {
  boundary: ExecutionBoundary;
  status: "completed" | "invalidated";
  artifact_sha256: string;
  completed_at: string;
  attempt: number;
  invalidated_at?: string;
  invalidation_reason?: string;
}

interface ExecutionJournalStop {
  kind: JournalStopKind;
  at: string;
  reason: string;
  next_boundary: ExecutionBoundary | null;
  durable_artifacts: string[];
}

export interface ExecutionJournal {
  schema_version: typeof EXECUTION_JOURNAL_VERSION;
  episode_id: string;
  app: string;
  ticket_ref: string;
  stages: ExecutionJournalStage[];
  status: "running" | "stopped" | "completed";
  next_boundary: ExecutionBoundary | null;
  stop: ExecutionJournalStop | null;
  updated_at: string;
}

interface ResumeDecision {
  nextBoundary: ExecutionBoundary | null;
  reused: ExecutionBoundary[];
  rerun: ExecutionBoundary[];
  invalidations: Array<{ boundary: ExecutionBoundary; reason: string }>;
}

function executionJournalPath(root: string, episodeId: string): string {
  return join(efficiencyEpisodeDir(root, episodeId), "execution-journal.json");
}

export async function readExecutionJournal(root: string, episodeId: string): Promise<ExecutionJournal | undefined> {
  const path = executionJournalPath(root, episodeId);
  if (!existsSync(path)) return undefined;
  const value: unknown = JSON.parse(await readFile(path, "utf8"));
  if (!isJournal(value) || value.episode_id !== episodeId) {
    throw new Error(`invalid execution journal for ${episodeId}`);
  }
  return value;
}

export async function recordExecutionBoundary(input: {
  root: string;
  episodeId: string;
  boundary: ExecutionBoundary;
  artifact: unknown;
  now: Date;
}): Promise<ExecutionJournal> {
  const journal = await requiredJournal(input.root, input.episodeId);
  const artifactHash = fingerprint(input.artifact);
  const index = EXECUTION_BOUNDARIES.indexOf(input.boundary);
  const prior = journal.stages.find((stage) => stage.boundary === input.boundary && stage.status === "completed");
  if (prior !== undefined) {
    if (prior.artifact_sha256 !== artifactHash) {
      throw new Error(
        `stale_artifact:${input.boundary}: existing ${prior.artifact_sha256}, observed ${artifactHash}; invalidate with a reason before rerun`,
      );
    }
    return journal;
  }
  const earlierIncomplete = EXECUTION_BOUNDARIES.slice(0, index).find(
    (boundary) => !journal.stages.some((stage) => stage.boundary === boundary && stage.status === "completed"),
  );
  if (earlierIncomplete !== undefined) {
    throw new Error(`illegal execution boundary ${input.boundary}; ${earlierIncomplete} is not complete`);
  }
  const attempts = journal.stages.filter((stage) => stage.boundary === input.boundary).length;
  const stage: ExecutionJournalStage = {
    boundary: input.boundary,
    status: "completed",
    artifact_sha256: artifactHash,
    completed_at: input.now.toISOString(),
    attempt: attempts + 1,
  };
  const stages = [...journal.stages, stage];
  const next = nextBoundary(stages);
  const updated: ExecutionJournal = {
    ...journal,
    stages,
    status: next === null ? "completed" : "running",
    next_boundary: next,
    stop: null,
    updated_at: input.now.toISOString(),
  };
  await writeJournal(input.root, updated);
  return updated;
}

async function invalidateExecutionFrom(input: {
  root: string;
  episodeId: string;
  boundary: ExecutionBoundary;
  reason: string;
  now: Date;
}): Promise<ExecutionJournal> {
  if (input.reason.trim() === "") throw new Error("invalidation_reason_required");
  const journal = await requiredJournal(input.root, input.episodeId);
  const start = EXECUTION_BOUNDARIES.indexOf(input.boundary);
  const stages = journal.stages.map((stage): ExecutionJournalStage => {
    if (stage.status !== "completed" || EXECUTION_BOUNDARIES.indexOf(stage.boundary) < start) return stage;
    return {
      ...stage,
      status: "invalidated",
      invalidated_at: input.now.toISOString(),
      invalidation_reason: input.reason,
    };
  });
  const updated: ExecutionJournal = {
    ...journal,
    stages,
    status: "running",
    next_boundary: input.boundary,
    stop: null,
    updated_at: input.now.toISOString(),
  };
  await writeJournal(input.root, updated);
  return updated;
}

export async function stopExecutionJournal(input: {
  root: string;
  episodeId: string;
  kind: JournalStopKind;
  reason: string;
  now: Date;
}): Promise<ExecutionJournal> {
  const journal = await requiredJournal(input.root, input.episodeId);
  const durable = journal.stages
    .filter((stage) => stage.status === "completed")
    .map((stage) => `${stage.boundary}:${stage.artifact_sha256}`);
  const updated: ExecutionJournal = {
    ...journal,
    status: "stopped",
    stop: {
      kind: input.kind,
      at: input.now.toISOString(),
      reason: input.reason,
      next_boundary: journal.next_boundary,
      durable_artifacts: durable,
    },
    updated_at: input.now.toISOString(),
  };
  await writeJournal(input.root, updated);
  return updated;
}

export async function resumeExecutionJournal(input: {
  root: string;
  episodeId: string;
  /** Current verifier-owned artifact values. Missing keys are not invalidated;
   * callers name only artifacts they can authoritatively observe. */
  artifacts?: Partial<Record<ExecutionBoundary, unknown>>;
  now: Date;
}): Promise<ResumeDecision> {
  let journal = await requiredJournal(input.root, input.episodeId);
  const invalidations: Array<{ boundary: ExecutionBoundary; reason: string }> = [];
  for (const boundary of EXECUTION_BOUNDARIES) {
    const current = input.artifacts?.[boundary];
    if (current === undefined) continue;
    const stage = journal.stages.find(
      (candidate) => candidate.boundary === boundary && candidate.status === "completed",
    );
    if (stage === undefined) continue;
    const observed = fingerprint(current);
    if (observed === stage.artifact_sha256) continue;
    const reason = `${boundary} artifact changed (${stage.artifact_sha256} -> ${observed})`;
    journal = await invalidateExecutionFrom({ ...input, boundary, reason });
    invalidations.push({ boundary, reason });
    break;
  }
  const next = journal.next_boundary;
  const nextIndex = next === null ? EXECUTION_BOUNDARIES.length : EXECUTION_BOUNDARIES.indexOf(next);
  return {
    nextBoundary: next,
    reused: EXECUTION_BOUNDARIES.slice(0, nextIndex).filter((boundary) =>
      journal.stages.some((stage) => stage.boundary === boundary && stage.status === "completed"),
    ),
    rerun: next === null ? [] : [...EXECUTION_BOUNDARIES.slice(nextIndex)],
    invalidations,
  };
}

async function requiredJournal(root: string, episodeId: string): Promise<ExecutionJournal> {
  const journal = await readExecutionJournal(root, episodeId);
  if (journal === undefined) throw new Error(`execution journal missing for ${episodeId}`);
  return journal;
}

function nextBoundary(stages: ExecutionJournalStage[]): ExecutionBoundary | null {
  return (
    EXECUTION_BOUNDARIES.find(
      (boundary) => !stages.some((stage) => stage.boundary === boundary && stage.status === "completed"),
    ) ?? null
  );
}

async function writeJournal(root: string, journal: ExecutionJournal): Promise<void> {
  await writeLoopFileAtomic(executionJournalPath(root, journal.episode_id), `${JSON.stringify(journal, null, 2)}\n`);
}

function isJournal(value: unknown): value is ExecutionJournal {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Partial<ExecutionJournal>;
  return (
    record.schema_version === EXECUTION_JOURNAL_VERSION &&
    typeof record.episode_id === "string" &&
    typeof record.app === "string" &&
    typeof record.ticket_ref === "string" &&
    Array.isArray(record.stages) &&
    ["running", "stopped", "completed"].includes(record.status ?? "")
  );
}
