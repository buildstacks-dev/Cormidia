// Tolerant read-only source readers for the narrative fold (#129).
//
// Every reader here degrades to absence instead of failing the whole render:
// a swept run dir, a torn envelope, or a missing journal must never cost the
// reader the rest of the story. Corruption is COLLECTED (problems[]) rather
// than masked or thrown, so the CLI can surface it without dying on it.
//
// All verbatim L3 text crossing into a quote passes through scrubSecrets —
// L3 is unredacted by design; narrative must be shareable. Envelope-derived
// text (verdict_summary, previews) was already scrubbed at write time, but
// scrubbing twice is harmless and keeps the invariant local and obvious.

import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { RunEnvelope } from "../runtime/runlog/envelope.js";
import { runPaths } from "../runtime/runlog/paths.js";
import { scrubSecrets } from "../runtime/runlog/redact.js";
import { readExecutionJournal, type ExecutionJournal } from "../loop/execution-journal.js";
import { readPublishedTicketsRecord, type PublishedTicketsRecord } from "../loop/plan-publication-record.js";
import { readTurnRecords, type TurnRecord } from "../runtime/telemetry.js";
import { readParentTaskPrompt } from "../org/parent-task.js";
import type { NarrativeQuote } from "./types.js";

export const MOMENT_QUOTE_MAX = 700;
export const ORIGIN_QUOTE_MAX = 900;

export interface AppRunSources {
  envelopes: RunEnvelope[];
  /** Keyed by the planning run id that wrote the record. */
  publishedTickets: Map<string, PublishedTicketsRecord>;
  problems: string[];
}

/** Read every parseable envelope for one app, newest layout tolerated:
 *  a run dir without envelope.json (mid-write, foreign file) is skipped
 *  loudly into problems, never thrown. */
export async function readAppRunSources(stateHome: string, app: string): Promise<AppRunSources> {
  const out: AppRunSources = { envelopes: [], publishedTickets: new Map(), problems: [] };
  const dir = join(stateHome, "runs", app);
  if (!existsSync(dir)) return out;
  for (const runId of (await readdir(dir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()) {
    try {
      const parsed = JSON.parse(await readFile(join(dir, runId, "envelope.json"), "utf8")) as RunEnvelope;
      // Identity binds to the directory, like every sibling reader
      // (readParentTask, readExecutionJournal, readPublishedTicketsRecord):
      // a copied/tampered envelope must never smuggle a foreign run_id into
      // path joins (readRunQuote) or collapse two dirs onto one moment key.
      if (parsed.schema_version !== 1 || parsed.run_id !== runId || parsed.app !== app) {
        out.problems.push(`runs/${app}/${runId}: not a valid v1 envelope for this run dir`);
        continue;
      }
      out.envelopes.push(parsed);
    } catch (error) {
      out.problems.push(
        `runs/${app}/${runId}: ${(error as NodeJS.ErrnoException).code === "ENOENT" ? "no envelope" : "unreadable envelope"}`,
      );
      continue;
    }
    try {
      const record = await readPublishedTicketsRecord(stateHome, app, runId);
      if (record !== undefined) out.publishedTickets.set(runId, record);
    } catch (error) {
      out.problems.push(`runs/${app}/${runId}: ${(error as Error).message}`);
    }
  }
  return out;
}

/** The execution journal for a build episode — absence is ordinary
 *  (non-ticket stories, swept efficiency dirs). */
export async function readDeliveryJournal(stateHome: string, episodeId: string): Promise<ExecutionJournal | undefined> {
  try {
    return await readExecutionJournal(stateHome, episodeId);
  } catch {
    return undefined; // invalid journal: the story renders without delivery
  }
}

/** All settled ledger rows, read once per render and joined per story. */
export async function readLedgerRows(stateHome: string): Promise<TurnRecord[]> {
  try {
    return await readTurnRecords(stateHome);
  } catch {
    return [];
  }
}

/** Bounded, redacted quote from an L3 file in a run dir; undefined once the
 *  file is retention-swept — the merge layer keeps the previously captured
 *  quote in that case. */
export async function readRunQuote(
  stateHome: string,
  app: string,
  runId: string,
  file: "output.md" | "brief.md" | "prompt.md",
  maxChars: number = MOMENT_QUOTE_MAX,
): Promise<NarrativeQuote | undefined> {
  const path = join(runPaths(stateHome, app, runId).dir, file);
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return undefined;
  }
  return boundQuote(`runs/${app}/${runId}/${file}`, raw, maxChars);
}

/** The exact outer prompt of a delegated parent task, when recorded. */
export async function readTaskOriginQuote(stateHome: string, taskId: string): Promise<NarrativeQuote | undefined> {
  try {
    const prompt = await readParentTaskPrompt(stateHome, taskId);
    return boundQuote(`tasks/${taskId}/prompt.md`, prompt, ORIGIN_QUOTE_MAX);
  } catch {
    return undefined;
  }
}

export function boundQuote(source: string, raw: string, maxChars: number): NarrativeQuote | undefined {
  const scrubbed = scrubSecrets(raw).trim();
  if (scrubbed === "") return undefined;
  const truncated = scrubbed.length > maxChars;
  return {
    source,
    text: truncated ? `${scrubbed.slice(0, maxChars)}…` : scrubbed,
    truncated,
  };
}

/** The leaf's ONE re-scrub for non-quote text landing in a capture (ticket
 *  titles, journal stop reasons, verdicts): write-time scrubbing used
 *  whatever pattern list existed THEN; captures outlive their sources by
 *  years, so they re-scrub with the current list at capture time. */
export function scrubCaptureText(raw: string): string {
  return scrubSecrets(raw);
}
