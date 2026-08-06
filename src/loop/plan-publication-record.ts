// Durable publication evidence for an orchestrator-published plan (#128).
//
// publishPlanProjection returns issue numbers only to its caller; before this
// record, the planner run -> published tickets edge existed nowhere on disk —
// the human-readable summary string was the only witness. This file is the
// LOCAL half of that edge; the permanent half is the `Planned-by:` trailer
// stamped into every ticket body, which travels with the repo and survives
// every retention sweep.
//
// The record is caller-owned evidence written into the final planning pass's
// run directory AFTER the envelope is terminal — deliberately a sibling file,
// never an envelope patch: updateEnvelope refuses terminal envelopes by
// contract (envelope.ts), and issue numbers only exist after publication,
// which follows finalize. Writes go through tmp+rename like every other run
// artifact so a reader never sees a torn record.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { runPaths } from "../runtime/runlog/paths.js";
import { writeLoopFileAtomic } from "./durable.js";
import type { PlanProvenance, PublishedTicket } from "./plan-tickets.js";

export const PUBLISHED_TICKETS_FILENAME = "published-tickets.json";

export interface PublishedTicketsRecord {
  schema_version: 1;
  app: string;
  /** Planning execution identity — byte-identical to the ticket-body
   *  `Planned-by:` trailer, so the two halves of the edge cross-check. */
  episode_id: string;
  run_id: string;
  trace_id: string;
  published_at: string;
  published: Array<{
    index: number;
    issue_number: number;
    title: string;
    ready: boolean;
    labels: string[];
  }>;
}

export function publishedTicketsPath(root: string, app: string, runId: string): string {
  return join(runPaths(root, app, runId).dir, PUBLISHED_TICKETS_FILENAME);
}

export async function writePublishedTicketsRecord(
  root: string,
  app: string,
  provenance: PlanProvenance,
  published: readonly PublishedTicket[],
  now: Date,
): Promise<PublishedTicketsRecord> {
  const record: PublishedTicketsRecord = {
    schema_version: 1,
    app,
    episode_id: provenance.episodeId,
    run_id: provenance.runId,
    trace_id: provenance.traceId,
    published_at: now.toISOString(),
    published: published.map((ticket) => ({
      index: ticket.index,
      issue_number: ticket.issueNumber,
      title: ticket.title,
      ready: ticket.ready,
      labels: [...ticket.labels],
    })),
  };
  await writeLoopFileAtomic(publishedTicketsPath(root, app, provenance.runId), JSON.stringify(record, null, 2) + "\n");
  return record;
}

/** Absent (retention-swept, pre-#128, or publish never ran) → undefined;
 *  a torn/invalid file is an error — writeLoopFileAtomic means it never
 *  happens from this writer, so corruption is worth surfacing, not masking.
 *  Validation is structural over EVERY field a consumer cross-checks: a
 *  wrong-typed episode_id must fail the read, never flow into an identity
 *  comparison and silently conclude the provenance edge is broken. */
export async function readPublishedTicketsRecord(
  root: string,
  app: string,
  runId: string,
): Promise<PublishedTicketsRecord | undefined> {
  let raw: string;
  try {
    raw = await readFile(publishedTicketsPath(root, app, runId), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`published-tickets record for ${app}/${runId} is not valid JSON`);
  }
  if (!isPublishedTicketsRecord(parsed)) {
    throw new Error(`published-tickets record for ${app}/${runId} is not a valid v1 record`);
  }
  return parsed;
}

function isPublishedTicketsRecord(value: unknown): value is PublishedTicketsRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    record["schema_version"] === 1 &&
    typeof record["app"] === "string" &&
    typeof record["episode_id"] === "string" &&
    typeof record["run_id"] === "string" &&
    typeof record["trace_id"] === "string" &&
    typeof record["published_at"] === "string" &&
    Array.isArray(record["published"]) &&
    record["published"].every((entry: unknown) => {
      if (typeof entry !== "object" || entry === null) return false;
      const ticket = entry as Record<string, unknown>;
      return (
        typeof ticket["index"] === "number" &&
        typeof ticket["issue_number"] === "number" &&
        typeof ticket["title"] === "string" &&
        typeof ticket["ready"] === "boolean" &&
        Array.isArray(ticket["labels"]) &&
        ticket["labels"].every((label: unknown) => typeof label === "string")
      );
    })
  );
}
