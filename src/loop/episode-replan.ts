import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { withFileLock, type FileLockOptions } from "../runtime/file-lock.js";
import { writeLoopFileAtomic } from "./durable.js";
import {
  efficiencyEpisodeDir,
  readRouteRecord,
  routeRecordPath,
} from "./efficiency.js";
import {
  EpisodePlanPersistenceError,
  episodePlanHash,
  persistEpisodePlanRevisionFromReplan,
  readCurrentEpisodePlan,
  stableHash,
  type EpisodeIntent,
  type EpisodePlan,
  type EpisodePlanValidationPolicy,
} from "./episode-plan.js";

export const EPISODE_REPLAN_JOURNAL_VERSION = 1 as const;
export const EPISODE_REPLAN_EVENT_KINDS = [
  "failed_assumption",
  "new_scope",
  "assignment_unavailable",
  "failed_gate",
  "approval_constraint",
  "estimate_exhausted",
] as const;
export type EpisodeReplanEventKind = (typeof EPISODE_REPLAN_EVENT_KINDS)[number];

export interface EpisodeReplanTrigger {
  id: string;
  kind: EpisodeReplanEventKind;
  planVersion: number;
  detectedAt: string;
  summary: string;
  evidenceRefs: string[];
  affectedStepIds: string[];
}

export interface EpisodeReplanRecord {
  trigger: EpisodeReplanTrigger;
  triggerSha256: string;
  status: "pending" | "accepted" | "rejected";
  requestedAt: string;
  resolvedAt: string | null;
  revisionVersion: number | null;
  reason: string | null;
}

export interface EpisodeReplanJournal {
  schemaVersion: typeof EPISODE_REPLAN_JOURNAL_VERSION;
  episodeId: string;
  maxRevisions: number;
  records: EpisodeReplanRecord[];
  createdAt: string;
  updatedAt: string;
}

export type EpisodeReplanErrorCode =
  | "error_episode_replan_invalid"
  | "error_episode_replan_plan_missing"
  | "error_episode_replan_plan_version_changed"
  | "error_episode_replan_allowance_exhausted"
  | "error_episode_replan_request_missing"
  | "error_episode_replan_request_not_pending"
  | "error_episode_replan_execution_active"
  | "error_episode_replan_terminal"
  | "error_episode_replan_journal_corrupt";

export class EpisodeReplanError extends Error {
  constructor(readonly code: EpisodeReplanErrorCode, message: string) {
    super(message);
    this.name = "EpisodeReplanError";
  }
}

const DEFAULT_REPLAN_LOCK: FileLockOptions = {
  staleMs: 5 * 60_000,
  maxWaitMs: 2_000,
  retryMinMs: 20,
  retryMaxMs: 60,
};
const ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;

export function episodeReplanJournalPath(root: string, episodeId: string): string {
  return join(efficiencyEpisodeDir(root, episodeId), "replan-journal.json");
}

export function episodeReplanLockPath(root: string, episodeId: string): string {
  return join(efficiencyEpisodeDir(root, episodeId), "replan.lock");
}

export async function readEpisodeReplanJournal(
  root: string,
  episodeId: string,
): Promise<EpisodeReplanJournal | undefined> {
  const path = episodeReplanJournalPath(root, episodeId);
  if (!existsSync(path)) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, "utf8"));
  } catch {
    throw new EpisodeReplanError(
      "error_episode_replan_journal_corrupt",
      `replan journal for ${episodeId} is not valid JSON`,
    );
  }
  if (!isJournal(value) || value.episodeId !== episodeId) {
    throw new EpisodeReplanError(
      "error_episode_replan_journal_corrupt",
      `replan journal for ${episodeId} is not a strict matching v1 journal`,
    );
  }
  return value;
}

/**
 * Durably request a bounded forward-only revision. This operation never calls
 * a provider and never changes the accepted plan; it is safe to invoke from a
 * failed gate/approval handler after that handler has returned terminal
 * evidence to the plan executor.
 */
export async function requestEpisodeReplan(input: {
  root: string;
  episodeId: string;
  trigger: EpisodeReplanTrigger;
  maxRevisions?: number;
  now?: Date;
}): Promise<EpisodeReplanRecord> {
  validateTrigger(input.trigger);
  const maxRevisions = input.maxRevisions ?? 2;
  assertMaxRevisions(maxRevisions);
  const now = input.now ?? new Date();
  return withFileLock(
    episodeReplanLockPath(input.root, input.episodeId),
    DEFAULT_REPLAN_LOCK,
    async () => {
      const current = await readCurrentEpisodePlan(input.root, input.episodeId);
      if (current === undefined) {
        throw new EpisodeReplanError(
          "error_episode_replan_plan_missing",
          `episode ${input.episodeId} has no accepted plan to revise`,
        );
      }
      if (current.version !== input.trigger.planVersion) {
        throw new EpisodeReplanError(
          "error_episode_replan_plan_version_changed",
          `replan trigger targets v${input.trigger.planVersion}; current plan is v${current.version}`,
        );
      }
      await assertEpisodeAcceptsReplan(input.root, input.episodeId);
      const existing = await readEpisodeReplanJournal(input.root, input.episodeId);
      const journal = existing ?? newJournal(input.episodeId, maxRevisions, now);
      if (journal.maxRevisions !== maxRevisions) {
        throw new EpisodeReplanError(
          "error_episode_replan_invalid",
          `replan allowance is already fixed at ${journal.maxRevisions}`,
        );
      }
      const hash = stableHash(input.trigger);
      const prior = journal.records.find((record) => record.trigger.id === input.trigger.id);
      if (prior !== undefined) {
        if (prior.triggerSha256 !== hash) {
          throw new EpisodeReplanError(
            "error_episode_replan_invalid",
            `replan trigger id ${input.trigger.id} was reused with different content`,
          );
        }
        return prior;
      }
      // Version is the durable bound even if a historical journal is absent;
      // every accepted revision increments it exactly once.
      if (current.version - 1 >= maxRevisions ||
          journal.records.some((record) => record.status === "pending")) {
        throw new EpisodeReplanError(
          "error_episode_replan_allowance_exhausted",
          current.version - 1 >= maxRevisions
            ? `episode ${input.episodeId} exhausted its ${maxRevisions} revision allowance`
            : `episode ${input.episodeId} already has a pending replan request`,
        );
      }
      const record: EpisodeReplanRecord = {
        trigger: structuredClone(input.trigger),
        triggerSha256: hash,
        status: "pending",
        requestedAt: now.toISOString(),
        resolvedAt: null,
        revisionVersion: null,
        reason: null,
      };
      await writeJournal(input.root, {
        ...journal,
        records: [...journal.records, record],
        updatedAt: now.toISOString(),
      });
      return record;
    },
  );
}

/** Publish one already-proposed revision through the same deterministic plan
 * validator. Completed ids come only from durable executor evidence. */
export async function publishEpisodePlanRevision(input: {
  root: string;
  requestId: string;
  intent: EpisodeIntent;
  plan: EpisodePlan;
  policy: EpisodePlanValidationPolicy;
  now?: Date;
  /** Fault-injection/checkpoint seam. Throwing leaves the authorized immutable
   * plan published and the request pending; an identical retry reconciles it. */
  afterPlanPersisted?: () => void | Promise<void>;
}): Promise<EpisodeReplanRecord> {
  const now = input.now ?? new Date();
  return withFileLock(
    episodeReplanLockPath(input.root, input.intent.episodeId),
    DEFAULT_REPLAN_LOCK,
    async () => {
      const journal = await requireJournal(input.root, input.intent.episodeId);
      const index = journal.records.findIndex((record) => record.trigger.id === input.requestId);
      if (index < 0) {
        throw new EpisodeReplanError(
          "error_episode_replan_request_missing",
          `replan request ${input.requestId} does not exist`,
        );
      }
      const request = journal.records[index]!;
      if (request.status === "accepted") {
        const current = await readCurrentEpisodePlan(input.root, input.intent.episodeId);
        if (current?.version === request.revisionVersion && stableHash(current) === stableHash(input.plan)) {
          return request;
        }
      }
      if (request.status === "pending") {
        const current = await readCurrentEpisodePlan(input.root, input.intent.episodeId);
        // Crash recovery: immutable plan publication and pointer advancement
        // deliberately precede the replan-journal projection. If the process
        // died between those writes, the identical retry completes the
        // journal transition instead of rejecting its own already-published
        // revision as a version mismatch.
        if (
          current?.version === request.trigger.planVersion + 1 &&
          input.plan.version === current.version &&
          stableHash(current) === stableHash(input.plan)
        ) {
          const accepted: EpisodeReplanRecord = {
            ...request,
            status: "accepted",
            resolvedAt: now.toISOString(),
            revisionVersion: current.version,
            reason: null,
          };
          const records = [...journal.records];
          records[index] = accepted;
          await writeJournal(input.root, { ...journal, records, updatedAt: now.toISOString() });
          return accepted;
        }
      }
      if (request.status !== "pending") {
        throw new EpisodeReplanError(
          "error_episode_replan_request_not_pending",
          `replan request ${input.requestId} is ${request.status}`,
        );
      }
      const current = await readCurrentEpisodePlan(input.root, input.intent.episodeId);
      if (current === undefined) {
        throw new EpisodeReplanError(
          "error_episode_replan_plan_missing",
          `episode ${input.intent.episodeId} has no accepted plan to revise`,
        );
      }
      if (current.version !== request.trigger.planVersion || input.plan.version !== current.version + 1) {
        throw new EpisodeReplanError(
          "error_episode_replan_plan_version_changed",
          `request ${input.requestId} targets v${request.trigger.planVersion}; current is v${current.version} and proposal is v${input.plan.version}`,
        );
      }
      await assertEpisodeAcceptsReplan(input.root, input.intent.episodeId);
      try {
        // persistEpisodePlan acquires the shared plan/execution lock before it
        // reads journal authority. Keep the global order replan -> plan so a
        // provider step and a revision can never cross between that read and
        // current-pointer publication.
        await persistEpisodePlanRevisionFromReplan({
          root: input.root,
          plan: input.plan,
          intent: input.intent,
          policy: input.policy,
          authority: {
            requestId: input.requestId,
            expectedCurrentVersion: current.version,
            expectedCurrentPlanHash: episodePlanHash(current),
          },
        });
        await input.afterPlanPersisted?.();
      } catch (error) {
        if (
          error instanceof EpisodePlanPersistenceError &&
          error.code === "error_episode_plan_revision_execution_active"
        ) {
          throw new EpisodeReplanError(
            "error_episode_replan_execution_active",
            `episode ${input.intent.episodeId} has an unterminated step execution`,
          );
        }
        if (
          error instanceof EpisodePlanPersistenceError &&
          error.code === "error_episode_plan_revision_terminal"
        ) {
          throw new EpisodeReplanError(
            "error_episode_replan_terminal",
            `terminal episode ${input.intent.episodeId} cannot publish a plan revision`,
          );
        }
        throw error;
      }
      const accepted: EpisodeReplanRecord = {
        ...request,
        status: "accepted",
        resolvedAt: now.toISOString(),
        revisionVersion: input.plan.version,
        reason: null,
      };
      const records = [...journal.records];
      records[index] = accepted;
      await writeJournal(input.root, { ...journal, records, updatedAt: now.toISOString() });
      return accepted;
    },
  );
}

async function assertEpisodeAcceptsReplan(root: string, episodeId: string): Promise<void> {
  if (existsSync(routeRecordPath(root, episodeId))) {
    const route = await readRouteRecord(root, episodeId);
    if (route.terminal !== null) {
      throw new EpisodeReplanError(
        "error_episode_replan_terminal",
        `terminal episode ${episodeId} cannot be replanned`,
      );
    }
  }
  const execution = await import("./episode-plan-executor.js");
  const journal = await execution.readEpisodePlanExecutionJournal(root, episodeId);
  if (journal?.status === "completed") {
    throw new EpisodeReplanError(
      "error_episode_replan_terminal",
      `completed episode ${episodeId} cannot be replanned`,
    );
  }
}

export async function rejectEpisodeReplan(input: {
  root: string;
  episodeId: string;
  requestId: string;
  reason: string;
  now?: Date;
}): Promise<EpisodeReplanRecord> {
  if (input.reason.trim().length === 0) {
    throw new EpisodeReplanError("error_episode_replan_invalid", "replan rejection requires a reason");
  }
  const now = input.now ?? new Date();
  return withFileLock(
    episodeReplanLockPath(input.root, input.episodeId),
    DEFAULT_REPLAN_LOCK,
    async () => {
      const journal = await requireJournal(input.root, input.episodeId);
      const index = journal.records.findIndex((record) => record.trigger.id === input.requestId);
      if (index < 0) {
        throw new EpisodeReplanError("error_episode_replan_request_missing", `replan request ${input.requestId} does not exist`);
      }
      const request = journal.records[index]!;
      if (request.status !== "pending") {
        throw new EpisodeReplanError("error_episode_replan_request_not_pending", `replan request ${input.requestId} is ${request.status}`);
      }
      const rejected: EpisodeReplanRecord = {
        ...request,
        status: "rejected",
        resolvedAt: now.toISOString(),
        revisionVersion: null,
        reason: input.reason.trim(),
      };
      const records = [...journal.records];
      records[index] = rejected;
      await writeJournal(input.root, { ...journal, records, updatedAt: now.toISOString() });
      return rejected;
    },
  );
}

function newJournal(episodeId: string, maxRevisions: number, now: Date): EpisodeReplanJournal {
  return {
    schemaVersion: EPISODE_REPLAN_JOURNAL_VERSION,
    episodeId,
    maxRevisions,
    records: [],
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

async function requireJournal(root: string, episodeId: string): Promise<EpisodeReplanJournal> {
  const journal = await readEpisodeReplanJournal(root, episodeId);
  if (journal === undefined) {
    throw new EpisodeReplanError("error_episode_replan_request_missing", `episode ${episodeId} has no replan journal`);
  }
  return journal;
}

async function writeJournal(root: string, journal: EpisodeReplanJournal): Promise<void> {
  await writeLoopFileAtomic(
    episodeReplanJournalPath(root, journal.episodeId),
    `${JSON.stringify(journal, null, 2)}\n`,
  );
}

function validateTrigger(trigger: EpisodeReplanTrigger): void {
  if (!ID.test(trigger.id) || !EPISODE_REPLAN_EVENT_KINDS.includes(trigger.kind) ||
      !Number.isSafeInteger(trigger.planVersion) || trigger.planVersion < 1 ||
      !validTimestamp(trigger.detectedAt) || trigger.summary.trim().length === 0 ||
      !nonEmptyStrings(trigger.evidenceRefs) ||
      !Array.isArray(trigger.affectedStepIds) || trigger.affectedStepIds.some((id) => !ID.test(id))) {
    throw new EpisodeReplanError(
      "error_episode_replan_invalid",
      "replan trigger requires a typed event, current plan version, summary, evidence, and stable affected step ids",
    );
  }
}

function assertMaxRevisions(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > 4) {
    throw new EpisodeReplanError("error_episode_replan_invalid", "maxRevisions must be an integer from 1 through 4");
  }
}

function isJournal(value: unknown): value is EpisodeReplanJournal {
  if (!isRecord(value) || value["schemaVersion"] !== EPISODE_REPLAN_JOURNAL_VERSION ||
      typeof value["episodeId"] !== "string" || !Number.isSafeInteger(value["maxRevisions"]) ||
      !Array.isArray(value["records"]) || typeof value["createdAt"] !== "string" ||
      typeof value["updatedAt"] !== "string") return false;
  return value["records"].every((record) => isRecord(record) && isRecord(record["trigger"]) &&
    typeof record["triggerSha256"] === "string" &&
    ["pending", "accepted", "rejected"].includes(String(record["status"])) &&
    typeof record["requestedAt"] === "string" &&
    (record["resolvedAt"] === null || typeof record["resolvedAt"] === "string") &&
    (record["revisionVersion"] === null || Number.isSafeInteger(record["revisionVersion"])) &&
    (record["reason"] === null || typeof record["reason"] === "string"));
}

function nonEmptyStrings(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 &&
    value.every((entry) => typeof entry === "string" && entry.trim().length > 0);
}

function validTimestamp(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
