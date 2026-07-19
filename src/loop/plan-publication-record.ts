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

import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runPaths } from "../runtime/runlog/paths.js";
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
  const path = publishedTicketsPath(root, app, provenance.runId);
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(record, null, 2) + "\n", "utf8");
  await rename(tmp, path);
  return record;
}

/** Absent (retention-swept, pre-#128, or publish never ran) → undefined;
 *  a torn/invalid file is an error — tmp+rename means it never happens
 *  from this writer, so corruption is worth surfacing, not masking. */
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
  const parsed = JSON.parse(raw) as PublishedTicketsRecord;
  if (parsed.schema_version !== 1 || typeof parsed.run_id !== "string" || !Array.isArray(parsed.published)) {
    throw new Error(`published-tickets record for ${app}/${runId} is not a valid v1 record`);
  }
  return parsed;
}
