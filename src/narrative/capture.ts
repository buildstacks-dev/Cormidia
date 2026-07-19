// Capture layer (#129): merge-write story.json under narrative/<app>/.
//
// The capture is what makes narrative outlive its sources. The fold reads
// live state; this layer merges each fresh story with what was previously
// captured, on one rule: STRUCTURE follows the fresh fold, QUOTES AND
// MOMENTS ARE NEVER LOST. A run dir swept between renders removes the
// moment from the fresh fold — the merge keeps the captured one. A story
// whose sources are entirely gone simply keeps its capture (the CLI
// re-renders markdown from it without a fresh counterpart).

import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { hashedFileStem } from "../runtime/runlog/paths.js";
import { writeLoopFileAtomic } from "../loop/durable.js";
import { NARRATIVE_SCHEMA_VERSION, type NarrativeStory } from "./types.js";

export function narrativeDir(stateHome: string, app: string): string {
  return join(stateHome, "narrative", app);
}

/** Path-safe, collision-proof story file stem: readable prefix + 8-hex id
 *  hash (episode ids contain `:` and unvalidated app names). Delegates to
 *  the runlog helper so org-layer retention can verify the same binding
 *  without importing this presentation leaf. */
export function storySlug(storyId: string): string {
  return hashedFileStem(storyId);
}

export async function readCapturedStory(
  stateHome: string,
  app: string,
  storyId: string,
): Promise<NarrativeStory | undefined> {
  const path = join(narrativeDir(stateHome, app), `${storySlug(storyId)}.json`);
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`narrative capture ${app}/${storySlug(storyId)}.json is not valid JSON`);
  }
  if (!isStory(parsed) || parsed.story_id !== storyId) {
    throw new Error(`narrative capture ${app}/${storySlug(storyId)}.json is not a valid v1 story`);
  }
  return parsed;
}

/** Every previously captured story for an app (for re-rendering after the
 *  sources expire). Corrupt captures are reported, never overwritten. */
export async function listCapturedStories(
  stateHome: string,
  app: string,
): Promise<{ stories: NarrativeStory[]; problems: string[] }> {
  const dir = narrativeDir(stateHome, app);
  const out: { stories: NarrativeStory[]; problems: string[] } = { stories: [], problems: [] };
  if (!existsSync(dir)) return out;
  for (const name of (await readdir(dir)).filter((f) => f.endsWith(".json")).sort()) {
    try {
      const parsed: unknown = JSON.parse(await readFile(join(dir, name), "utf8"));
      if (!isStory(parsed)) {
        out.problems.push(`narrative/${app}/${name}: not a valid v1 story`);
        continue;
      }
      out.stories.push(parsed);
    } catch {
      out.problems.push(`narrative/${app}/${name}: unreadable`);
    }
  }
  return out;
}

/** Merge fresh onto captured. Fresh structure wins; captured quotes/moments
 *  survive source expiry. Returns the story that should be persisted. */
export function mergeStory(captured: NarrativeStory | undefined, fresh: NarrativeStory): NarrativeStory {
  if (captured === undefined) return fresh;
  const freshByRun = new Map(fresh.moments.map((m) => [m.run_id, m]));

  // The one discriminator the guards below key on: a fresh fold that no
  // longer sees every run the capture knew about was computed from
  // PARTIALLY SWEPT sources — its view of story-level fields (opened,
  // status, title, closed) is a regression, not an update. A genuinely
  // newer fold (re-arm, extra passes) always contains the captured runs.
  const freshIsComplete = captured.moments.every((m) => freshByRun.has(m.run_id));
  const merged = { ...captured, ...fresh };
  if (!freshIsComplete && captured.status !== "in_progress") {
    // Terminal truth cannot be re-derived from partial sources; a partial
    // fold may only ADVANCE an in-progress capture, never flip a terminal one.
    merged.status = captured.status;
  }

  // Union of moments: fresh version of a run wins, but keeps the captured
  // quote when the fresh fold no longer has one (source swept). Captured
  // moments whose runs vanished from the fold stay.
  const moments = new Map(captured.moments.map((m) => [m.run_id, m]));
  for (const [runId, freshMoment] of freshByRun) {
    const prior = moments.get(runId);
    moments.set(
      runId,
      prior?.quote !== undefined && freshMoment.quote === undefined
        ? { ...freshMoment, quote: prior.quote }
        : freshMoment,
    );
  }
  merged.moments = [...moments.values()].sort(
    (a, b) => a.at.localeCompare(b.at) || a.run_id.localeCompare(b.run_id),
  );

  // Monotonic story-level fields — never regress regardless of which side
  // won the spread above.
  if (captured.opened.localeCompare(merged.opened) < 0) merged.opened = captured.opened;
  if (captured.closed !== undefined && (merged.closed === undefined || merged.closed.localeCompare(captured.closed) < 0)) {
    // A completed capture only loses `closed` when a complete fresh fold
    // says the story genuinely re-opened.
    if (!(freshIsComplete && fresh.status === "in_progress")) merged.closed = captured.closed;
  }
  // A partial fold's title regressed to the generic form when the planning
  // runs were swept; the enriched captured title subsumes it.
  if (captured.title.startsWith(merged.title) && captured.title.length > merged.title.length) {
    merged.title = captured.title;
  }

  // Never trade a captured quote/record for absence.
  if (merged.origin?.quote === undefined && captured.origin?.quote !== undefined) {
    merged.origin = captured.origin;
  }
  // Union planned tickets by issue number (fresh entry wins per issue) —
  // partially swept publication records must not shrink the set.
  if (captured.planned_tickets !== undefined || merged.planned_tickets !== undefined) {
    const byIssue = new Map<number, NonNullable<NarrativeStory["planned_tickets"]>[number]>();
    for (const entry of captured.planned_tickets ?? []) byIssue.set(entry.issue_number, entry);
    for (const entry of merged.planned_tickets ?? []) byIssue.set(entry.issue_number, entry);
    merged.planned_tickets = [...byIssue.values()].sort((a, b) => a.issue_number - b.issue_number);
  }
  if (merged.planned_by === undefined && captured.planned_by !== undefined) {
    merged.planned_by = captured.planned_by;
  }
  if (merged.delivery === undefined && captured.delivery !== undefined) merged.delivery = captured.delivery;
  // Cost can only shrink when ledger day-files were swept — keep the richer
  // settlement (more provider turns; then larger settled total).
  if (captured.cost !== undefined) {
    const freshCost = merged.cost;
    if (
      freshCost === undefined ||
      freshCost.provider_turns < captured.cost.provider_turns ||
      (freshCost.provider_turns === captured.cost.provider_turns && freshCost.usd < captured.cost.usd)
    ) {
      merged.cost = captured.cost;
    }
  }
  if (merged.captured_at.localeCompare(captured.captured_at) < 0) {
    merged.captured_at = captured.captured_at;
  }
  return merged;
}

export async function writeCapturedStory(stateHome: string, story: NarrativeStory): Promise<string> {
  const path = join(narrativeDir(stateHome, story.app), `${storySlug(story.story_id)}.json`);
  await writeLoopFileAtomic(path, JSON.stringify(story, null, 2) + "\n");
  return path;
}

function isStory(value: unknown): value is NarrativeStory {
  if (typeof value !== "object" || value === null) return false;
  const story = value as Record<string, unknown>;
  return (
    story["schema_version"] === NARRATIVE_SCHEMA_VERSION &&
    typeof story["story_id"] === "string" &&
    typeof story["app"] === "string" &&
    typeof story["title"] === "string" &&
    typeof story["opened"] === "string" &&
    typeof story["status"] === "string" &&
    typeof story["captured_at"] === "string" &&
    Array.isArray(story["moments"])
  );
}
